import { fail, input, json, isProductId, isUuid } from '../platform/http.mjs';
import { enviarEmail, ErroDeEmail, enderecoValido } from '../platform/email.mjs';
import { renderizar, ErroDeModelo, VARIAVEIS_DO_LEAD } from '../platform/email-modelo.mjs';
import { MENSAGEM_051 } from '../platform/email-saida.mjs';
import { vivo } from '../platform/env-vivo.mjs';

// Consumidor da fila de e-mail e rotas da tela "E-mails → Atividade". A fila é preenchida pelas automações (platform/email-saida.mjs).
//
// RITMO E SEGURANÇA
//  - No máximo `lote` e-mails por ciclo (padrão 10 a cada 30 s = 20 por minuto): um lote grande de leads não vira rajada.
//  - Cada e-mail é "reservado" (status sending) antes de enviar, com FOR UPDATE SKIP LOCKED: dois consumidores (ou dois ciclos) nunca
//    pegam o mesmo. Reserva que ficou presa (processo caiu no meio) volta para a fila depois de 5 minutos.
//  - Falha de rede ou do provedor (5xx): tenta de novo com espera crescente (1 min, 5 min, 30 min, 2 h) e desiste depois de 5 tentativas.
//    Recusa do provedor (422/401: domínio não verificado, chave ruim): não adianta insistir, vira "falhou" com o motivo, e dá para reenviar.
//  - E-mail que ficou mais de 48 h na fila (e-mail ainda não configurado, por exemplo) é CANCELADO em vez de sair atrasado e fora de contexto.
//  - Endereço na lista de supressão nunca recebe.

export const ESPERAS_MS = Object.freeze([60000, 300000, 1800000, 7200000]);
export const MAX_TENTATIVAS = 5;
export const VALIDADE_MS = 48 * 3600000;
const RESERVA_PRESA_MS = 5 * 60000;

const iso = ms => new Date(ms).toISOString();
const ator = o => o?.email || o?.subject || 'desconhecido';

/** Um ciclo da fila. Nunca lança: devolve o que fez. `enviar` é injetável (testes). */
export async function processarFila(pool, { env = vivo.env, enviar = enviarEmail, agora = Date.now, lote = 10 } = {}) {
 const t = agora();
 const saida = { reenfileirados: 0, expirados: 0, enviados: 0, falhas: 0, suprimidos: 0, adiados: 0 };
 try {
  // 1) reserva presa volta; 2) o que passou da validade é cancelado (mesmo sem e-mail configurado)
  saida.reenfileirados = (await pool.query("UPDATE email_outbox SET status='queued', locked_at=NULL WHERE status='sending' AND locked_at < $1 RETURNING id", [iso(t - RESERVA_PRESA_MS)])).rowCount ?? 0;
  saida.expirados = (await pool.query("UPDATE email_outbox SET status='cancelled', last_error='Expirou na fila: ficou mais de 48 horas sem poder ser enviado.' WHERE status='queued' AND kind='automacao' AND created_at < $1 RETURNING id", [iso(t - VALIDADE_MS)])).rowCount ?? 0;
  const configurado = String(env.EMAIL_PROVIDER ?? '').trim().toLowerCase() === 'resend' && String(env.EMAIL_API_KEY ?? '').trim() && String(env.EMAIL_FROM ?? '').trim();
  if (!configurado) return { ...saida, desligado: true };
  const pegos = (await pool.query(
   `UPDATE email_outbox SET status='sending', locked_at=$2, attempts=attempts+1
     WHERE id IN (SELECT id FROM email_outbox WHERE status='queued' AND next_attempt_at <= $2 ORDER BY next_attempt_at, created_at LIMIT $1 FOR UPDATE SKIP LOCKED)
     RETURNING id,to_email,subject,body_text,body_html,attempts`, [lote, iso(t)])).rows;
  for (const m of pegos) {
   try {
    const barrado = (await pool.query('SELECT 1 FROM email_suppressions WHERE email=$1 AND revoked_at IS NULL', [m.to_email])).rows.length > 0;
    if (barrado) { await pool.query("UPDATE email_outbox SET status='suppressed', locked_at=NULL, last_error='Endereço na lista de supressão.' WHERE id=$1", [m.id]); saida.suprimidos++; continue; }
    const r = await enviar({ env, para: m.to_email, assunto: m.subject, texto: m.body_text, html: m.body_html });
    await pool.query("UPDATE email_outbox SET status='sent', locked_at=NULL, sent_at=$2, provider_message_id=$3, last_error=NULL WHERE id=$1", [m.id, iso(agora()), r?.id ?? null]);
    saida.enviados++;
   } catch (e) {
    const recusa = e instanceof ErroDeEmail && [400, 401, 403, 422, 503].includes(e.status);   // insistir não adianta
    const msg = String(e?.message || 'erro desconhecido').slice(0, 300);
    if (recusa || m.attempts >= MAX_TENTATIVAS) {
     await pool.query("UPDATE email_outbox SET status='failed', locked_at=NULL, last_error=$2 WHERE id=$1", [m.id, msg]);
     saida.falhas++;
    } else {
     const espera = ESPERAS_MS[Math.min(m.attempts - 1, ESPERAS_MS.length - 1)];
     await pool.query("UPDATE email_outbox SET status='queued', locked_at=NULL, next_attempt_at=$2, last_error=$3 WHERE id=$1", [m.id, iso(agora() + espera), msg]);
     saida.adiados++;
    }
   }
  }
 } catch (e) {
  if (e?.code === '42P01') return { ...saida, indisponivel: true };   // migração 051 ainda não aplicada
  console.error('[email-fila] ciclo falhou:', e?.message);
  return { ...saida, erro: true };
 }
 return saida;
}

/** Liga o consumidor. Ciclos não se sobrepõem; o temporizador não segura o processo vivo. Devolve a função que desliga. */
export function iniciarFilaDeEmail({ pool, env = vivo.env, enviar = enviarEmail, log = console, cadaMs = 30000 } = {}) {
 let ocupado = false;
 const ciclo = async () => {
  if (ocupado) return;
  ocupado = true;
  try {
   await vivo.garantir(pool);   // sem pedido de tela por perto, é o próprio ciclo que relê as credenciais definidas pela tela
   const r = await processarFila(pool, { env, enviar });
   if (r.enviados || r.falhas || r.suprimidos) log.log(`[email-fila] ${JSON.stringify(r)}`);
  } catch (e) { log.error('[email-fila] falhou:', e?.message); }
  finally { ocupado = false; }
 };
 const t = setInterval(ciclo, cadaMs); t.unref?.();
 return () => clearInterval(t);
}

const VALORES_DE_EXEMPLO = { name: 'Maria Souza', email: 'maria@exemplo.com', company_name: 'Empresa Exemplo' };

export function emailFilaRoutes(router, { env = vivo.env, fetchImpl = fetch, clock = Date.now } = {}) {
 const ultimoTeste = new Map();

 async function carregarModelo(db, product, slug) {
  if (!isProductId(product) || !isProductId(slug)) throw fail(400, 'Produto ou template inválido.');
  const p = (await db.query('SELECT name FROM products WHERE id=$1', [product])).rows[0];
  if (!p) throw fail(404, 'Produto não encontrado.');
  const t = (await db.query('SELECT payload FROM email_templates WHERE product_id=$1 AND slug=$2', [product, slug])).rows[0];
  if (!t) throw fail(404, 'Template não encontrado.');
  return { modelo: t.payload, produto: p.name };
 }
 const renderDeExemplo = (modelo, produto) => {
  try { return renderizar(modelo, { ...VALORES_DE_EXEMPLO, product_name: produto }, { permitidas: VARIAVEIS_DO_LEAD }); }
  catch (e) { if (e instanceof ErroDeModelo) throw fail(400, e.message); throw e; }
 };

 // Atividade: o que está na fila e o que já saiu.
 router.get('/api/emails/outbox', async ({ pool, reply }) => {
  let itens = [], contagem = [], suprimidos = 0;
  try {
   itens = (await pool.query('SELECT id,kind,to_email,subject,status,attempts,last_error,product_id,template_slug,event,created_at,sent_at FROM email_outbox ORDER BY created_at DESC LIMIT 50')).rows;
   contagem = (await pool.query("SELECT status,count(*)::int AS n FROM email_outbox WHERE created_at > now() - interval '30 days' GROUP BY status")).rows;
   suprimidos = (await pool.query('SELECT count(*)::int AS n FROM email_suppressions WHERE revoked_at IS NULL')).rows[0].n;
  } catch (e) { if (e?.code === '42P01') return reply(200, { disponivel: false, itens: [], contagem: {}, suprimidos: 0 }); throw e; }
  const configurado = String(env.EMAIL_PROVIDER ?? '').trim() && String(env.EMAIL_API_KEY ?? '').trim() && String(env.EMAIL_FROM ?? '').trim();
  reply(200, { disponivel: true, envio_configurado: Boolean(configurado), itens, contagem: Object.fromEntries(contagem.map(c => [c.status, c.n])), suprimidos });
 }, { body: false });

 // Pré-visualização: o que o modelo vira com dados de exemplo. Não envia nada.
 router.post('/api/emails/preview', async ({ pool, req, reply }) => {
  const b = await json(req); input(b, ['product_id', 'slug']);
  const { modelo, produto } = await carregarModelo(pool, b.product_id, b.slug);
  const r = renderDeExemplo(modelo, produto);
  reply(200, { assunto: r.assunto, texto: r.texto, variaveis: VARIAVEIS_DO_LEAD });
 });

 // Teste: manda o modelo, com dados de exemplo, SÓ para o e-mail de quem está logado.
 router.post('/api/emails/teste', async ({ pool, req, reply, operator }) => {
  const b = await json(req); input(b, ['product_id', 'slug']);
  const para = String(operator?.email ?? '').trim().toLowerCase();
  if (!enderecoValido(para)) throw fail(409, 'Sua sessão não tem um e-mail para receber o teste.');
  const agora = clock(), chave = operator.subject || para;
  if (agora - (ultimoTeste.get(chave) ?? -Infinity) < 30000) throw fail(429, 'Aguarde alguns segundos antes de pedir outro teste.');
  const { modelo, produto } = await carregarModelo(pool, b.product_id, b.slug);
  const r = renderDeExemplo(modelo, produto);
  ultimoTeste.set(chave, agora);
  try { await enviarEmail({ env, para, assunto: `[Teste] ${r.assunto}`, texto: r.texto, html: r.html, fetchImpl }); }
  catch (e) { ultimoTeste.delete(chave); if (e instanceof ErroDeEmail) throw fail(e.status, e.message); throw e; }
  reply(200, { ok: true, para, mensagem: `Teste enviado para ${para}, com dados de exemplo. Confira a caixa de entrada (e o spam).` });
 });

 // Para de enviar a um endereço (e tira da fila o que ainda não saiu para ele).
 router.post('/api/emails/suppress', async ({ client, body, operator }) => {
  input(body, ['email', 'reason']);
  const email = String(body.email ?? '').trim().toLowerCase();
  if (!enderecoValido(email)) throw fail(400, 'E-mail inválido.');
  const reason = body.reason ?? 'manual';
  if (!['manual', 'pediu_para_sair', 'invalido'].includes(reason)) throw fail(400, 'Motivo inválido.');
  try {
   await client.query('INSERT INTO email_suppressions(email,reason,created_by) VALUES($1,$2,$3) ON CONFLICT DO NOTHING', [email, reason, ator(operator)]);
   const tirados = (await client.query("UPDATE email_outbox SET status='suppressed', locked_at=NULL, last_error='Endereço na lista de supressão.' WHERE to_email=$1 AND status='queued' RETURNING id", [email])).rowCount ?? 0;
   return { response: { ok: true, email, tirados_da_fila: tirados } };
  } catch (e) { if (e?.code === '42P01') throw fail(409, MENSAGEM_051); throw e; }
 }, { transactional: true, audit: false });

 // Reenviar um que falhou (depois de corrigir a causa, por exemplo o domínio no Resend).
 router.post('/api/emails/outbox/:id/reenviar', async ({ client, params }) => {
  if (!isUuid(params.id)) throw fail(400, 'Identificador inválido.');
  try {
   const r = await client.query("UPDATE email_outbox SET status='queued', attempts=0, next_attempt_at=$2, last_error=NULL, locked_at=NULL WHERE id=$1 AND status='failed' RETURNING id", [params.id, iso(clock())]);
   if (!r.rowCount) throw fail(409, 'Só dá para reenviar um e-mail que falhou.');
   return { response: { ok: true } };
  } catch (e) { if (e?.code === '42P01') throw fail(409, MENSAGEM_051); throw e; }
 }, { transactional: true, body: false, audit: false });
}
