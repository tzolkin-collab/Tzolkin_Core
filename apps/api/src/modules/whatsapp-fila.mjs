import { fail, input, isUuid } from '../platform/http.mjs';
import { createEvolutionAdapter, normalizarNumero } from '../integrations/evolution.mjs';
import { MENSAGEM_062 } from '../platform/whatsapp-saida.mjs';
import { vivo } from '../platform/env-vivo.mjs';

// Consumidor da fila de WhatsApp e rotas da tela "WhatsApp". A fila é preenchida pelas automações (platform/whatsapp-saida.mjs).
// Mesmo desenho da fila de e-mail (modules/email-fila.mjs), com as diferenças que o WhatsApp pede:
//
//  - SÓ ENVIA COM O ENVIO LIGADO: WHATSAPP_ENVIO=ligado. Sem isso a fila apenas acumula (a tela diz "envio desligado"); mensagem nenhuma
//    sai por acidente ao aplicar a migração ou ao configurar a Evolution.
//  - RITMO BAIXO: no máximo `lote` (3) por ciclo de 30 s e uma pausa entre uma mensagem e outra. A Evolution não é a API oficial: rajada é
//    o que derruba o número.
//  - INSTÂNCIA DESCONECTADA não gasta tentativa: a mensagem espera na fila (e expira em 48 h, como o e-mail).
//  - RETENTATIVA POR MOTIVO: unavailable e rate_limited repetem (1 min, 5 min, 30 min, 2 h, até 5 tentativas); rejected (número sem WhatsApp,
//    texto inválido), unauthorized e not_found não adiantam repetir: viram "falhou" com o motivo, e dá para reenviar. Número que não tem
//    WhatsApp entra sozinho na lista de supressão.

export const ESPERAS_MS = Object.freeze([60000, 300000, 1800000, 7200000]);
export const MAX_TENTATIVAS = 5;
export const VALIDADE_MS = 48 * 3600000;
const RESERVA_PRESA_MS = 5 * 60000;
const PAUSA_ENTRE_MENSAGENS_MS = 4000;

const iso = ms => new Date(ms).toISOString();
const ator = o => o?.email || o?.subject || 'desconhecido';
const MOTIVOS = Object.freeze({
 unauthorized: 'A Evolution recusou a chave de acesso.',
 not_found: 'A instância não existe na Evolution.',
 rejected: 'A Evolution recusou esta mensagem (o número pode não ter WhatsApp).',
 rate_limited: 'A Evolution pediu para ir mais devagar.',
 unavailable: 'A Evolution não respondeu.',
 invalid: 'Resposta inesperada da Evolution.',
 not_configured: 'A Evolution não está configurada.',
 invalid_config: 'A configuração da Evolution está inválida.',
});
export const envioLigado = env => String(env.WHATSAPP_ENVIO ?? '').trim().toLowerCase() === 'ligado';

/** Um ciclo da fila. Nunca lança: devolve o que fez. `adaptador` e `pausar` são injetáveis (testes). */
export async function processarFila(pool, { env = vivo.env, adaptador = createEvolutionAdapter({ env }), agora = Date.now, lote = 3, pausar = ms => new Promise(r => setTimeout(r, ms)) } = {}) {
 const t = agora();
 const saida = { reenfileirados: 0, expirados: 0, enviados: 0, falhas: 0, suprimidos: 0, adiados: 0 };
 try {
  saida.reenfileirados = (await pool.query("UPDATE whatsapp_outbox SET status='queued', locked_at=NULL WHERE status='sending' AND locked_at < $1 RETURNING id", [iso(t - RESERVA_PRESA_MS)])).rowCount ?? 0;
  saida.expirados = (await pool.query("UPDATE whatsapp_outbox SET status='cancelled', last_error='Expirou na fila: ficou mais de 48 horas sem poder ser enviada.' WHERE status='queued' AND created_at < $1 RETURNING id", [iso(t - VALIDADE_MS)])).rowCount ?? 0;
  if (!envioLigado(env)) return { ...saida, desligado: true };
  if (!adaptador.configured) return { ...saida, desligado: true };
  const estado = await adaptador.connectionState();
  if (!estado.ok || !estado.connected) return { ...saida, desconectado: true };
  const pegos = (await pool.query(
   `UPDATE whatsapp_outbox SET status='sending', locked_at=$2, attempts=attempts+1
     WHERE id IN (SELECT id FROM whatsapp_outbox WHERE status='queued' AND next_attempt_at <= $2 ORDER BY next_attempt_at, created_at LIMIT $1 FOR UPDATE SKIP LOCKED)
     RETURNING id,to_number,body_text,attempts`, [lote, iso(t)])).rows;
  let primeira = true;
  for (const m of pegos) {
   if (!primeira) await pausar(PAUSA_ENTRE_MENSAGENS_MS);
   primeira = false;
   try {
    const barrado = (await pool.query('SELECT 1 FROM whatsapp_suppressions WHERE number=$1 AND revoked_at IS NULL', [m.to_number])).rows.length > 0;
    if (barrado) { await pool.query("UPDATE whatsapp_outbox SET status='suppressed', locked_at=NULL, last_error='Número na lista de supressão.' WHERE id=$1", [m.id]); saida.suprimidos++; continue; }
    const r = await adaptador.sendText({ number: m.to_number, text: m.body_text });
    if (r.ok) {
     await pool.query("UPDATE whatsapp_outbox SET status='sent', locked_at=NULL, sent_at=$2, provider_message_id=$3, last_error=NULL WHERE id=$1", [m.id, iso(agora()), r.messageId ?? null]);
     saida.enviados++;
     continue;
    }
    const repete = ['unavailable', 'rate_limited', 'invalid'].includes(r.reason);
    const msg = (MOTIVOS[r.reason] || 'Falha desconhecida.').slice(0, 300);
    if (!repete || m.attempts >= MAX_TENTATIVAS) {
     await pool.query("UPDATE whatsapp_outbox SET status='failed', locked_at=NULL, last_error=$2 WHERE id=$1", [m.id, msg]);
     // Número sem WhatsApp: nunca mais tenta (fica na lista de supressão, e dá para revogar).
     if (r.reason === 'rejected' && r.detail !== 'invalid_text') await pool.query("INSERT INTO whatsapp_suppressions(number,reason,created_by) VALUES($1,'sem_whatsapp','fila') ON CONFLICT DO NOTHING", [m.to_number]);
     saida.falhas++;
    } else {
     const espera = ESPERAS_MS[Math.min(m.attempts - 1, ESPERAS_MS.length - 1)];
     await pool.query("UPDATE whatsapp_outbox SET status='queued', locked_at=NULL, next_attempt_at=$2, last_error=$3 WHERE id=$1", [m.id, iso(agora() + espera), msg]);
     saida.adiados++;
    }
   } catch (e) {
    // Erro nosso (banco, por exemplo), não da Evolution: devolve para a fila sem gastar a tentativa à toa.
    console.error('[whatsapp-fila] mensagem falhou:', e?.message);
    await pool.query("UPDATE whatsapp_outbox SET status='queued', locked_at=NULL, next_attempt_at=$2, last_error='Erro interno ao enviar.' WHERE id=$1", [m.id, iso(agora() + ESPERAS_MS[0])]).catch(() => {});
    saida.adiados++;
   }
  }
 } catch (e) {
  if (e?.code === '42P01') return { ...saida, indisponivel: true };   // migração 062 ainda não aplicada
  console.error('[whatsapp-fila] ciclo falhou:', e?.message);
  return { ...saida, erro: true };
 }
 return saida;
}

/** Liga o consumidor. Ciclos não se sobrepõem; o temporizador não segura o processo vivo. Devolve a função que desliga. */
export function iniciarFilaDeWhatsapp({ pool, env = vivo.env, log = console, cadaMs = 30000 } = {}) {
 let ocupado = false;
 const ciclo = async () => {
  if (ocupado) return;
  ocupado = true;
  try {
   await vivo.garantir(pool);
   const r = await processarFila(pool, { env });
   if (r.enviados || r.falhas || r.suprimidos) log.log(`[whatsapp-fila] ${JSON.stringify(r)}`);
  } catch (e) { log.error('[whatsapp-fila] falhou:', e?.message); }
  finally { ocupado = false; }
 };
 const t = setInterval(ciclo, cadaMs); t.unref?.();
 return () => clearInterval(t);
}

export function whatsappFilaRoutes(router, { env = vivo.env, clock = Date.now, criarAdaptador = createEvolutionAdapter } = {}) {
 // Atividade: o que está na fila e o que já saiu. Não chama a Evolution (a lista abre rápido); o estado da conexão é /api/whatsapp/status.
 router.get('/api/whatsapp/outbox', async ({ pool, reply }) => {
  let itens = [], contagem = [], suprimidos = 0;
  try {
   itens = (await pool.query('SELECT id,kind,to_number,to_name,body_text,status,attempts,last_error,product_id,event,lead_id,created_at,sent_at FROM whatsapp_outbox ORDER BY created_at DESC LIMIT 50')).rows;
   contagem = (await pool.query("SELECT status,count(*)::int AS n FROM whatsapp_outbox WHERE created_at > now() - interval '30 days' GROUP BY status")).rows;
   suprimidos = (await pool.query('SELECT count(*)::int AS n FROM whatsapp_suppressions WHERE revoked_at IS NULL')).rows[0].n;
  } catch (e) { if (e?.code === '42P01') return reply(200, { disponivel: false, itens: [], contagem: {}, suprimidos: 0 }); throw e; }
  reply(200, { disponivel: true, configurada: createEvolutionAdapter({ env }).configured, envio_ligado: envioLigado(env), itens, contagem: Object.fromEntries(contagem.map(c => [c.status, c.n])), suprimidos });
 }, { body: false });

 // Estado da conexão da instância (consulta a Evolution, sem enviar nada).
 router.get('/api/whatsapp/status', async ({ reply }) => {
  const adaptador = criarAdaptador({ env });
  if (!adaptador.configured) return reply(200, { configurada: false, conectada: false, motivo: MOTIVOS.not_configured });
  const r = await adaptador.connectionState();
  if (!r.ok) return reply(200, { configurada: true, conectada: false, motivo: MOTIVOS[r.reason] || 'Falha desconhecida.' });
  reply(200, { configurada: true, conectada: r.connected, estado: r.state, instancia: adaptador.instance });
 }, { body: false });

 // Para de enviar a um número (e tira da fila o que ainda não saiu para ele).
 router.post('/api/whatsapp/suppress', async ({ client, body, operator }) => {
  input(body, ['number', 'reason']);
  const number = normalizarNumero(String(body.number ?? ''));
  if (!number) throw fail(400, 'Número inválido.');
  const reason = body.reason ?? 'manual';
  if (!['manual', 'pediu_para_sair', 'sem_whatsapp'].includes(reason)) throw fail(400, 'Motivo inválido.');
  try {
   await client.query('INSERT INTO whatsapp_suppressions(number,reason,created_by) VALUES($1,$2,$3) ON CONFLICT DO NOTHING', [number, reason, ator(operator)]);
   const tirados = (await client.query("UPDATE whatsapp_outbox SET status='suppressed', locked_at=NULL, last_error='Número na lista de supressão.' WHERE to_number=$1 AND status='queued' RETURNING id", [number])).rowCount ?? 0;
   return { response: { ok: true, number, tirados_da_fila: tirados } };
  } catch (e) { if (e?.code === '42P01') throw fail(409, MENSAGEM_062); throw e; }
 }, { transactional: true, audit: false });

 // Reenviar uma que falhou (depois de corrigir a causa, por exemplo reconectar a instância).
 router.post('/api/whatsapp/outbox/:id/reenviar', async ({ client, params }) => {
  if (!isUuid(params.id)) throw fail(400, 'Identificador inválido.');
  try {
   const r = await client.query("UPDATE whatsapp_outbox SET status='queued', attempts=0, next_attempt_at=$2, last_error=NULL, locked_at=NULL WHERE id=$1 AND status='failed' RETURNING id", [params.id, iso(clock())]);
   if (!r.rowCount) throw fail(409, 'Só dá para reenviar uma mensagem que falhou.');
   return { response: { ok: true } };
  } catch (e) { if (e?.code === '42P01') throw fail(409, MENSAGEM_062); throw e; }
 }, { transactional: true, body: false, audit: false });
}
