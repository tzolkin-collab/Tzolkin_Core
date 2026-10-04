import { createHash, randomBytes } from 'node:crypto';
import { fail, isUuid, json, input } from '../platform/http.mjs';
import { digest } from '../platform/session.mjs';
import { readKey, seal, open } from '../platform/secrets.mjs';
import * as G from '../platform/google-calendar.mjs';

// Google Agenda e Meet. Cada operador conecta a PRÓPRIA conta; a sala é criada na agenda de quem clicou.
// Depende da migração 049; sem ela tudo responde "indisponível" e nada quebra. Admin interno, como o resto do Core.

export const MENSAGEM_049 = 'Google Agenda e Meet ainda não estão disponíveis neste banco: falta aplicar a migração 049.';
const TABELAS = ['google_calendar_connections', 'google_calendar_flows'];

/** Mesma ideia do detector da agenda: lembra o "sim", e reverifica o "não" depois de `ttl`. */
export function criarDetectorGoogle({ relogio = Date.now, ttl = 60000 } = {}) {
 let ok = false, em = -Infinity;
 return async function disponivel(db) {
  if (ok) return true;
  if (relogio() - em < ttl) return false;
  em = relogio();
  const r = await db.query(
   `SELECT (SELECT count(*)::int FROM information_schema.tables WHERE table_schema = current_schema() AND table_name = ANY($1)) AS tabelas,
           (SELECT count(*)::int FROM information_schema.columns WHERE table_schema = current_schema() AND table_name = 'service_activities' AND column_name IN ('google_event_id','google_owner_subject')) AS colunas`, [TABELAS]);
  const l = r.rows[0] || {};
  ok = l.tabelas === TABELAS.length && l.colunas === 2;
  return ok;
 };
}

const nomeDaChave = env => (String(env.CORE_SECRETS_KEY ?? '').trim() ? 'CORE_SECRETS_KEY' : 'META_MARKETING_KEY');
const temChave = env => { try { readKey(env, nomeDaChave(env)); return true; } catch { return false; } };
const temCliente = env => Boolean(String(env.GOOGLE_CLIENT_ID ?? '').trim() && String(env.GOOGLE_CLIENT_SECRET ?? '').trim());
const origem = (env, url) => { try { return new URL(env.PUBLIC_ORIGIN).origin; } catch { return url.origin; } };

/** Lista de e-mails convidados: no máximo 20, sem repetir, todos válidos. */
export function convidadosInput(valor) {
 if (valor === undefined || valor === null || valor === '') return [];
 const lista = (Array.isArray(valor) ? valor : String(valor).split(/[,;\s]+/)).map(e => String(e).trim().toLowerCase()).filter(Boolean);
 if (lista.length > 20) throw fail(400, 'No máximo 20 convidados.');
 for (const e of lista) if (!G.EMAIL.test(e)) throw fail(400, `E-mail de convidado inválido: ${e.slice(0, 60)}`);
 return [...new Set(lista)];
}

export function googleCalendarRoutes(router, { env = process.env, fetcher = fetch, detector = criarDetectorGoogle(), clock = Date.now } = {}) {
 const configurado = () => temCliente(env);

 async function conexao(db, subject) {
  return (await db.query('SELECT * FROM google_calendar_connections WHERE operator_subject=$1 AND revoked_at IS NULL', [subject])).rows[0] || null;
 }
 async function acessoDe(db, subject) {
  const c = await conexao(db, subject);
  if (!c) throw fail(409, 'Conecte sua conta Google em Configurações → Integrações para usar o Meet.');
  const refreshToken = open({ ciphertext: c.token_ciphertext, iv: c.token_iv, tag: c.token_tag }, readKey(env, nomeDaChave(env)));
  try {
   return await G.tokenDeAcesso({ clientId: env.GOOGLE_CLIENT_ID, clientSecret: env.GOOGLE_CLIENT_SECRET, refreshToken, fetcher });
  } catch (e) {
   if (e.reconectar) await db.query('UPDATE google_calendar_connections SET revoked_at=now(), last_error=$2, updated_at=now() WHERE operator_subject=$1', [subject, 'Conexão expirada ou revogada.']).catch(() => {});
   throw e;
  }
 }

 router.get('/api/google/calendar/status', async ({ pool, operator, reply }) => {
  const migracao = await detector(pool);
  const base = { cliente: configurado(), chave: temChave(env), migracao };
  if (!migracao) return reply(200, { ...base, disponivel: false, conectado: false });
  const c = await conexao(pool, operator.subject);
  reply(200, { ...base, disponivel: base.cliente && base.chave, conectado: Boolean(c), email: c?.email ?? null, desde: c?.connected_at ?? null });
 });

 router.post('/api/google/calendar/authorize', async ({ client, url, operator }) => {
  if (!await detector(client)) throw fail(409, MENSAGEM_049);
  if (!configurado()) throw fail(503, 'Defina GOOGLE_CLIENT_ID e GOOGLE_CLIENT_SECRET no servidor para conectar o Google.');
  readKey(env, nomeDaChave(env));   // sem chave não há onde guardar o token que vai voltar: falha aqui, não depois da autorização
  const state = randomBytes(32).toString('base64url'), verifier = randomBytes(48).toString('base64url');
  const retorno = origem(env, url) + G.ENDERECO_DE_RETORNO;
  await client.query(`INSERT INTO google_calendar_flows(state_hash,operator_subject,redirect_uri,code_verifier,expires_at) VALUES($1,$2,$3,$4,now()+interval '10 minutes')`,
   [digest(state), operator.subject, retorno, verifier]);
  const challenge = createHash('sha256').update(verifier).digest('base64url');
  return { body: { url: G.urlDeAutorizacao({ clientId: env.GOOGLE_CLIENT_ID, redirectUri: retorno, state, challenge, email: operator.email || null }) } };
 }, { transactional: true, body: false, audit: false });

 // Retorno do Google. Público (o cookie pode não viajar num redirecionamento de outro site); quem autentica é o `state`: hash, 10 min, uso único.
 // Sempre termina num redirecionamento com um código curto. Mensagem do Google nunca vai para a URL.
 router.get(G.ENDERECO_DE_RETORNO, async ({ url, pool, res }) => {
  const voltar = codigo => { res.writeHead(302, { Location: `/?secao=integracoes&google=${codigo}`, 'Cache-Control': 'no-store' }); res.end(); };
  const state = url.searchParams.get('state');
  if (typeof state !== 'string' || !/^[A-Za-z0-9_-]{32,100}$/.test(state)) return voltar('expired');
  const fluxo = (await pool.query(`UPDATE google_calendar_flows SET consumed_at=now() WHERE state_hash=$1 AND consumed_at IS NULL AND expires_at>now() RETURNING operator_subject,redirect_uri,code_verifier`, [digest(state)])).rows[0];
  if (!fluxo) return voltar('expired');
  const code = url.searchParams.get('code');
  if (url.searchParams.get('error') || !code) return voltar('denied');
  if (!/^[\x21-\x7e]{10,2000}$/.test(code)) return voltar('error');
  if (!configurado() || !temChave(env)) return voltar('config');
  try {
   const t = await G.trocarCodigo({ clientId: env.GOOGLE_CLIENT_ID, clientSecret: env.GOOGLE_CLIENT_SECRET, code, verifier: fluxo.code_verifier, redirectUri: fluxo.redirect_uri, fetcher });
   const s = seal(t.refreshToken, readKey(env, nomeDaChave(env)));
   await pool.query(
    `INSERT INTO google_calendar_connections(operator_subject,email,token_ciphertext,token_iv,token_tag,scopes)
     VALUES($1,$2,$3,$4,$5,$6)
     ON CONFLICT (operator_subject) DO UPDATE SET email=EXCLUDED.email, token_ciphertext=EXCLUDED.token_ciphertext, token_iv=EXCLUDED.token_iv,
      token_tag=EXCLUDED.token_tag, scopes=EXCLUDED.scopes, connected_at=now(), updated_at=now(), revoked_at=NULL, last_error=NULL`,
    [fluxo.operator_subject, t.email, s.ciphertext, s.iv, s.tag, t.escopos]);
   return voltar('ok');
  } catch (e) {
   return voltar(e.status === 409 && !e.reconectar ? 'scope' : 'error');
  }
 }, { auth: 'public', body: false });

 router.post('/api/google/calendar/disconnect', async ({ client, operator }) => {
  const c = await conexao(client, operator.subject);
  if (!c) throw fail(409, 'Nenhuma conta Google conectada.');
  try { await G.revogar({ token: open({ ciphertext: c.token_ciphertext, iv: c.token_iv, tag: c.token_tag }, readKey(env, nomeDaChave(env))), fetcher }); } catch { /* sem a chave, só esquece */ }
  await client.query('UPDATE google_calendar_connections SET revoked_at=now(), updated_at=now() WHERE operator_subject=$1', [operator.subject]);
  return { response: { ok: true } };
 }, { transactional: true, body: false, audit: false });

 // Cria o evento no Google Agenda da pessoa, com a sala do Meet, e grava o link na atividade. Uma vez só por atividade.
 router.post('/api/tracking/:id/meet', async ({ pool, params, req, reply, operator }) => {
  if (!isUuid(params.id)) throw fail(400, 'Atividade inválida.');
  if (!await detector(pool)) throw fail(409, MENSAGEM_049);
  const corpo = await json(req); input(corpo, ['convidados']);
  const convidados = convidadosInput(corpo.convidados);
  const a = (await pool.query('SELECT * FROM service_activities WHERE id=$1', [params.id])).rows[0];
  if (!a) throw fail(404, 'Atividade não encontrada.');
  if (a.google_event_id) throw fail(409, 'Esta atividade já tem uma sala do Meet.');
  if (a.status === 'cancelled') throw fail(409, 'Atividade cancelada não ganha sala do Meet.');
  const acesso = await acessoDe(pool, operator.subject);
  // `requestId` estável por atividade: se o pedido se repetir, o Google devolve a mesma sala em vez de criar outra.
  const criado = await G.criarEventoComMeet({ acesso, requestId: 'tzk-' + a.id, fetcher, evento: { titulo: a.title, descricao: a.description, local: a.location, inicio: a.starts_at, fim: a.ends_at, convidados } });
  const r = (await pool.query(
   `UPDATE service_activities SET meeting_url=$2, google_event_id=$3, google_owner_subject=$4, revision=revision+1, updated_at=now()
     WHERE id=$1 AND google_event_id IS NULL RETURNING *`, [params.id, criado.link, criado.id, operator.subject])).rows[0];
  if (!r) throw fail(409, 'Esta atividade já tem uma sala do Meet.');
  reply(200, { activity: r, meet: criado.link });
 });

 /** Acompanha a atividade no Google (horário, título, textos; cancelamento apaga o evento). Melhor esforço: nunca lança e nunca atrasa a resposta. */
 async function sincronizar(pool, atividade, acao = 'atualizar') {
  try {
   if (!atividade?.google_event_id || !atividade.google_owner_subject) return { ignorado: true };
   if (!await detector(pool)) return { ignorado: true };
   const acesso = await acessoDe(pool, atividade.google_owner_subject);
   if (acao === 'cancelar') { await G.removerEvento({ acesso, id: atividade.google_event_id, fetcher }); return { ok: true }; }
   await G.atualizarEvento({ acesso, id: atividade.google_event_id, fetcher, evento: { titulo: atividade.title, descricao: atividade.description, local: atividade.location, inicio: atividade.starts_at, fim: atividade.ends_at } });
   return { ok: true };
  } catch (e) {
   console.error('[google-calendar] sincronização falhou:', e?.message);
   return { falhou: true };
  }
 }
 return { sincronizar, detector };
}
