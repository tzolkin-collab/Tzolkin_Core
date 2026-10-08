// Google Agenda e Meet: conversa com o Google (simulada), rotas, segredo cifrado e sincronização. Nada sai da máquina.
import test from 'node:test';
import assert from 'node:assert/strict';
import { randomBytes } from 'node:crypto';
import * as G from '../../apps/api/src/platform/google-calendar.mjs';
import { googleCalendarRoutes, criarDetectorGoogle, convidadosInput, MENSAGEM_049 } from '../../apps/api/src/modules/google-calendar.mjs';
import { trackingRoutes } from '../../apps/api/src/modules/tracking.mjs';
import { criarDetector } from '../../apps/api/src/platform/agenda-recursos.mjs';
import { digest } from '../../apps/api/src/platform/session.mjs';
import { open, seal } from '../../apps/api/src/platform/secrets.mjs';

const CHAVE = randomBytes(32);
const ENV = { GOOGLE_CLIENT_ID: '123-abc.apps.googleusercontent.com', GOOGLE_CLIENT_SECRET: 'segredo-do-cliente-google', PUBLIC_ORIGIN: 'https://core.exemplo.test', CORE_SECRETS_KEY: CHAVE.toString('base64') };
const ID = '00000000-0000-4000-8000-000000000001';
const OPERADOR = { subject: 'op-1', email: 'gustavo@exemplo.test' };
const corpo = b => ({ headers: { 'content-type': 'application/json' }, async *[Symbol.asyncIterator]() { yield Buffer.from(JSON.stringify(b)); } });
const resposta = (corpoJson, status = 200) => ({ ok: status < 400, status, json: async () => corpoJson });
const idToken = email => 'x.' + Buffer.from(JSON.stringify({ email })).toString('base64url') + '.y';
const esperarJa = async () => {};

// ---------- conversa com o Google ----------
test('o pedido de autorização pede só eventos, uso contínuo (offline), consentimento e PKCE', () => {
 const u = new URL(G.urlDeAutorizacao({ clientId: 'c', redirectUri: 'https://x.test/volta', state: 's', challenge: 'ch', email: 'a@b.test' }));
 assert.equal(u.origin + u.pathname, 'https://accounts.google.com/o/oauth2/v2/auth');
 assert.equal(u.searchParams.get('scope'), 'openid email https://www.googleapis.com/auth/calendar.events');
 assert.equal(u.searchParams.get('access_type'), 'offline'); assert.equal(u.searchParams.get('prompt'), 'consent');
 assert.equal(u.searchParams.get('code_challenge_method'), 'S256'); assert.equal(u.searchParams.get('code_challenge'), 'ch');
 assert.equal(u.searchParams.get('login_hint'), 'a@b.test');
 assert.ok(![...u.searchParams.keys()].includes('client_secret'));
});

test('trocar o código: devolve refresh token e e-mail; exige a permissão de eventos; invalid_grant pede reconexão', async () => {
 const ok = await G.trocarCodigo({ clientId: 'c', clientSecret: 's', code: 'k', verifier: 'v', redirectUri: 'r', fetcher: async () => resposta({ refresh_token: 'rt-1', scope: 'openid email https://www.googleapis.com/auth/calendar.events', id_token: idToken('eu@exemplo.test') }) });
 assert.deepEqual([ok.refreshToken, ok.email], ['rt-1', 'eu@exemplo.test']);
 await assert.rejects(G.trocarCodigo({ clientId: 'c', clientSecret: 's', code: 'k', verifier: 'v', redirectUri: 'r', fetcher: async () => resposta({ scope: 'openid', id_token: idToken('a@b.test') }) }), /uso contínuo/);
 await assert.rejects(G.trocarCodigo({ clientId: 'c', clientSecret: 's', code: 'k', verifier: 'v', redirectUri: 'r', fetcher: async () => resposta({ refresh_token: 'rt', scope: 'openid email' }) }), e => e.status === 409 && /criar eventos/.test(e.message));
 await assert.rejects(G.tokenDeAcesso({ clientId: 'c', clientSecret: 's', refreshToken: 'rt', fetcher: async () => resposta({ error: 'invalid_grant' }, 400) }), e => e.reconectar === true && e.status === 409);
});

test('criar evento com Meet: pede a sala, avisa convidados só se houver, e espera o link se ele demorar', async () => {
 const chamadas = [];
 const fetcher = async (url, o) => { chamadas.push({ url: String(url), o }); return resposta({ id: 'ev1', hangoutLink: 'https://meet.google.com/abc-defg-hij' }); };
 const r = await G.criarEventoComMeet({ acesso: 'AT', requestId: 'tzk-1', fetcher, evento: { titulo: 'Mentoria', descricao: 'Pauta', inicio: '2026-10-05T13:00:00Z', fim: '2026-10-05T14:00:00Z', convidados: ['a@b.test'] } });
 assert.deepEqual(r, { id: 'ev1', link: 'https://meet.google.com/abc-defg-hij' });
 assert.match(chamadas[0].url, /conferenceDataVersion=1&sendUpdates=all$/);
 const enviado = JSON.parse(chamadas[0].o.body);
 assert.equal(enviado.conferenceData.createRequest.requestId, 'tzk-1'); assert.equal(enviado.conferenceData.createRequest.conferenceSolutionKey.type, 'hangoutsMeet');
 assert.deepEqual(enviado.attendees, [{ email: 'a@b.test' }]); assert.equal(enviado.start.timeZone, 'America/Sao_Paulo'); assert.equal(enviado.summary, 'Mentoria');
 assert.equal(chamadas[0].o.headers.authorization, 'Bearer AT');
 await G.criarEventoComMeet({ acesso: 'AT', requestId: 'r', fetcher, evento: { titulo: 'x', inicio: '2026-10-05T13:00:00Z', fim: '2026-10-05T14:00:00Z' } });
 assert.match(chamadas[1].url, /sendUpdates=none$/); assert.ok(!('attendees' in JSON.parse(chamadas[1].o.body)));
 // link atrasado: consulta de novo
 let n = 0;
 const lento = async url => (n++ < 2 ? resposta({ id: 'ev2' }) : resposta({ id: 'ev2', conferenceData: { entryPoints: [{ entryPointType: 'video', uri: 'https://meet.google.com/zzz' }] } }));
 assert.equal((await G.criarEventoComMeet({ acesso: 'A', requestId: 'r', fetcher: lento, esperar: esperarJa, evento: { titulo: 'x', inicio: '2026-10-05T13:00:00Z', fim: '2026-10-05T14:00:00Z' } })).link, 'https://meet.google.com/zzz');
 await assert.rejects(G.criarEventoComMeet({ acesso: 'A', requestId: 'r', fetcher: async () => resposta({ id: 'ev3' }), esperar: esperarJa, evento: { titulo: 'x', inicio: '2026-10-05T13:00:00Z', fim: '2026-10-05T14:00:00Z' } }), /ainda não devolveu o link/);
});

test('erros do Google viram mensagens claras; apagar evento que já não existe não é erro', async () => {
 await assert.rejects(G.criarEventoComMeet({ acesso: 'A', requestId: 'r', fetcher: async () => resposta({}, 401), evento: { titulo: 'x', inicio: '2026-10-05T13:00:00Z', fim: '2026-10-05T14:00:00Z' } }), e => e.reconectar && /Conecte de novo/.test(e.message));
 await assert.rejects(G.atualizarEvento({ acesso: 'A', id: 'e', fetcher: async () => resposta({}, 404), evento: { titulo: 'x', inicio: '2026-10-05T13:00:00Z', fim: '2026-10-05T14:00:00Z' } }), e => e.status === 404);
 await G.removerEvento({ acesso: 'A', id: 'e', fetcher: async () => resposta({}, 410) });
 await assert.rejects(G.removerEvento({ acesso: 'A', id: 'e', fetcher: async () => resposta({}, 500) }), /não respondeu/);
});

// ---------- rotas ----------
function montar({ env = ENV, fetcher, disponivel = true, linhas = {} } = {}) {
 const rotas = {}, regs = {};
 const roteador = { get: (p, h, o) => { rotas['GET ' + p] = h; regs['GET ' + p] = o; }, post: (p, h, o) => { rotas['POST ' + p] = h; regs['POST ' + p] = o; }, put: (p, h, o) => { rotas['PUT ' + p] = h; } };
 const log = [];
 const db = {
  log,
  query: async (sql, params = []) => {
   log.push({ sql, params });
   if (sql.includes('information_schema')) return { rows: [{ tabelas: disponivel ? 2 : 0, colunas: disponivel ? 2 : 0 }] };
   for (const [trecho, fn] of Object.entries(linhas)) if (sql.includes(trecho)) return fn(params, sql) ?? { rows: [], rowCount: 0 };
   return { rows: [], rowCount: 0 };
  },
 };
 const google = googleCalendarRoutes(roteador, { env, fetcher, detector: criarDetectorGoogle() });
 return { rotas, regs, db, log, google };
}
const chamar = async (h, ctx) => { let saida; const r = await h({ reply: (s, c) => { saida = { s, c }; }, ...ctx }); return saida || r; };
test('status: sem a migração 049 diz indisponível; com ela, mostra se há conta conectada e o e-mail, sem token', async () => {
 const sem = montar({ disponivel: false });
 assert.deepEqual((await chamar(sem.rotas['GET /api/google/calendar/status'], { pool: sem.db, operator: OPERADOR, url: new URL('http://127.0.0.1:3100/x') })).c, { cliente: true, chave: true, migracao: false, retorno: 'https://core.exemplo.test/api/google/calendar/callback', disponivel: false, conectado: false });
 const com = montar({ linhas: { google_calendar_connections: () => ({ rows: [{ email: 'eu@exemplo.test', connected_at: '2026-10-04T12:00:00Z', token_ciphertext: Buffer.from('x') }] }) } });
 const r = (await chamar(com.rotas['GET /api/google/calendar/status'], { pool: com.db, operator: OPERADOR, url: new URL('http://127.0.0.1:3100/x') })).c;
 assert.deepEqual([r.disponivel, r.conectado, r.email], [true, true, 'eu@exemplo.test']);
 assert.ok(!JSON.stringify(r).includes('ciphertext') && !JSON.stringify(r).includes('token'));
 const semChave = montar({ env: { ...ENV, CORE_SECRETS_KEY: '' } });
 assert.equal((await chamar(semChave.rotas['GET /api/google/calendar/status'], { pool: semChave.db, operator: OPERADOR, url: new URL('http://127.0.0.1:3100/x') })).c.disponivel, false, 'sem a chave de cifra não dá para guardar o token');
});

test('conectar: grava só o hash do state, usa PKCE e o endereço de retorno do PUBLIC_ORIGIN', async () => {
 const m = montar();
 const r = await m.rotas['POST /api/google/calendar/authorize']({ client: m.db, url: new URL('http://127.0.0.1:3100/x'), operator: OPERADOR });
 const u = new URL(r.body.url);
 assert.equal(u.searchParams.get('redirect_uri'), 'https://core.exemplo.test/api/google/calendar/callback');
 const state = u.searchParams.get('state');
 const gravacao = m.log.find(q => q.sql.includes('INSERT INTO google_calendar_flows'));
 assert.equal(gravacao.params[0], digest(state), 'o state em claro não vai ao banco');
 assert.ok(!gravacao.params.includes(state));
 assert.equal(m.regs['POST /api/google/calendar/authorize'].transactional, true);
 const semCliente = montar({ env: { ...ENV, GOOGLE_CLIENT_ID: '' } });
 await assert.rejects(semCliente.rotas['POST /api/google/calendar/authorize']({ client: semCliente.db, url: new URL('http://x.test/'), operator: OPERADOR }), e => e.status === 503 && /GOOGLE_CLIENT_ID/.test(e.message));
 const semMigracao = montar({ disponivel: false });
 await assert.rejects(semMigracao.rotas['POST /api/google/calendar/authorize']({ client: semMigracao.db, url: new URL('http://x.test/'), operator: OPERADOR }), e => e.status === 409 && e.message === MENSAGEM_049);
});

test('retorno do Google: state inválido ou usado expira; negado avisa; sucesso grava o refresh token CIFRADO', async () => {
 const destino = []; const res = { writeHead: (s, h) => destino.push([s, h.Location]), end() {} };
 const state = randomBytes(32).toString('base64url');
 const url = extra => new URL('https://core.exemplo.test/api/google/calendar/callback?' + new URLSearchParams(extra));
 const fluxo = { operator_subject: 'op-1', redirect_uri: 'https://core.exemplo.test/api/google/calendar/callback', code_verifier: 'ver' };
 const fetcher = async () => resposta({ refresh_token: 'REFRESH-SECRETO-123', scope: 'openid email https://www.googleapis.com/auth/calendar.events', id_token: idToken('eu@exemplo.test') });
 const m = montar({ fetcher, linhas: { 'UPDATE google_calendar_flows': () => ({ rows: [fluxo] }) } });
 const h = m.rotas['GET /api/google/calendar/callback'];
 assert.equal(m.regs['GET /api/google/calendar/callback'].auth, 'public');
 await h({ url: url({ state: 'curto', code: 'abcdefghij' }), pool: m.db, res });
 await h({ url: url({ state, error: 'access_denied' }), pool: m.db, res });
 await h({ url: url({ state, code: 'abcdefghij1234' }), pool: m.db, res });
 assert.deepEqual(destino.map(d => d[1]), ['/?secao=integracoes&google=expired', '/?secao=integracoes&google=denied', '/?secao=integracoes&google=ok']);
 const g = m.log.find(q => q.sql.includes('INSERT INTO google_calendar_connections'));
 assert.ok(!g.params.some(p => String(p).includes('REFRESH-SECRETO')), 'o token em claro não vai ao banco');
 const [sujeito, email, cifrado, iv, tag] = g.params;
 assert.deepEqual([sujeito, email], ['op-1', 'eu@exemplo.test']);
 assert.equal(open({ ciphertext: cifrado, iv, tag }, CHAVE), 'REFRESH-SECRETO-123', 'decifra com a chave');
 const usado = montar({ fetcher });   // state já consumido: o UPDATE não devolve linha
 await usado.rotas['GET /api/google/calendar/callback']({ url: url({ state, code: 'abcdefghij1234' }), pool: usado.db, res });
 assert.equal(destino.at(-1)[1], '/?secao=integracoes&google=expired');
});

function comConexao(fetcher, extras = {}) {
 // monta uma conexão cifrada de verdade para a rota decifrar
 const s = seal('REFRESH-1', CHAVE);
 return montar({ fetcher, linhas: {
  'FROM google_calendar_connections': () => ({ rows: [{ operator_subject: 'op-1', email: 'eu@exemplo.test', token_ciphertext: s.ciphertext, token_iv: s.iv, token_tag: s.tag }] }),
  ...extras,
 } });
}
const ATIVIDADE = { id: ID, title: 'Mentoria Alfa', description: 'Pauta', location: null, status: 'planned', starts_at: '2026-10-05T13:00:00.000Z', ends_at: '2026-10-05T14:00:00.000Z', google_event_id: null, google_owner_subject: null };

test('criar sala do Meet: usa a conta do operador, grava o link e o evento, e só uma vez por atividade', async () => {
 const chamadas = [];
 const fetcher = async (url, o) => { chamadas.push(String(url)); if (String(url).includes('/token')) return resposta({ access_token: 'AT-1' }); return resposta({ id: 'ev-9', hangoutLink: 'https://meet.google.com/abc-defg-hij' }); };
 const m = comConexao(fetcher, {
  'SELECT * FROM service_activities': () => ({ rows: [{ ...ATIVIDADE }] }),
  'UPDATE service_activities SET meeting_url': p => ({ rows: [{ ...ATIVIDADE, meeting_url: p[1], google_event_id: p[2], google_owner_subject: p[3], revision: 2 }] }),
 });
 const r = await chamar(m.rotas['POST /api/tracking/:id/meet'], { pool: m.db, params: { id: ID }, req: corpo({ convidados: 'Ana@Exemplo.test, ana@exemplo.test; bia@exemplo.test' }), operator: OPERADOR });
 assert.equal(r.c.meet, 'https://meet.google.com/abc-defg-hij'); assert.equal(r.c.activity.google_event_id, 'ev-9');
 const evento = chamadas.find(u => u.includes('/events'));
 assert.match(evento, /sendUpdates=all/);
 const upd = m.log.find(q => q.sql.includes('UPDATE service_activities SET meeting_url'));
 assert.deepEqual(upd.params, [ID, 'https://meet.google.com/abc-defg-hij', 'ev-9', 'op-1']);
 // já tem sala
 const ja = comConexao(fetcher, { 'SELECT * FROM service_activities': () => ({ rows: [{ ...ATIVIDADE, google_event_id: 'x' }] }) });
 await assert.rejects(chamar(ja.rotas['POST /api/tracking/:id/meet'], { pool: ja.db, params: { id: ID }, req: corpo({}), operator: OPERADOR }), e => e.status === 409 && /já tem/.test(e.message));
 // cancelada
 const cancelada = comConexao(fetcher, { 'SELECT * FROM service_activities': () => ({ rows: [{ ...ATIVIDADE, status: 'cancelled' }] }) });
 await assert.rejects(chamar(cancelada.rotas['POST /api/tracking/:id/meet'], { pool: cancelada.db, params: { id: ID }, req: corpo({}), operator: OPERADOR }), e => e.status === 409);
 // sem conexão
 const sem = montar({ fetcher, linhas: { 'SELECT * FROM service_activities': () => ({ rows: [{ ...ATIVIDADE }] }) } });
 await assert.rejects(chamar(sem.rotas['POST /api/tracking/:id/meet'], { pool: sem.db, params: { id: ID }, req: corpo({}), operator: OPERADOR }), e => e.status === 409 && /Conecte sua conta Google/.test(e.message));
 // sem a 049
 const antiga = montar({ disponivel: false });
 await assert.rejects(chamar(antiga.rotas['POST /api/tracking/:id/meet'], { pool: antiga.db, params: { id: ID }, req: corpo({}), operator: OPERADOR }), e => e.message === MENSAGEM_049);
});

test('conexão revogada no Google: avisa para reconectar e marca a conexão como revogada', async () => {
 const fetcher = async () => resposta({ error: 'invalid_grant' }, 400);
 const m = comConexao(fetcher, { 'SELECT * FROM service_activities': () => ({ rows: [{ ...ATIVIDADE }] }) });
 await assert.rejects(chamar(m.rotas['POST /api/tracking/:id/meet'], { pool: m.db, params: { id: ID }, req: corpo({}), operator: OPERADOR }), e => e.reconectar);
 assert.ok(m.log.some(q => q.sql.includes('UPDATE google_calendar_connections SET revoked_at=now()')));
});

test('convidados: aceita lista ou texto, minúsculas, sem repetir; recusa e-mail ruim e mais de 20', () => {
 assert.deepEqual(convidadosInput('A@b.test, a@b.test;c@d.test'), ['a@b.test', 'c@d.test']);
 assert.deepEqual(convidadosInput(undefined), []); assert.deepEqual(convidadosInput(''), []);
 assert.throws(() => convidadosInput('sem-arroba'), e => e.status === 400);
 assert.throws(() => convidadosInput(Array.from({ length: 21 }, (_, i) => `p${i}@x.test`)), e => e.status === 400);
});

test('sincronizar: atualiza horário e título, cancelar apaga o evento, sem evento não faz nada e erro nunca lança', async () => {
 const chamadas = [];
 const fetcher = async (url, o = {}) => { chamadas.push([o.method || 'GET', String(url)]); return String(url).includes('/token') ? resposta({ access_token: 'AT' }) : resposta({}); };
 const m = comConexao(fetcher);
 const viva = { ...ATIVIDADE, google_event_id: 'ev-1', google_owner_subject: 'op-1' };
 assert.deepEqual(await m.google.sincronizar(m.db, viva, 'atualizar'), { ok: true });
 assert.ok(chamadas.some(([met, u]) => met === 'PATCH' && u.includes('/events/ev-1')));
 assert.deepEqual(await m.google.sincronizar(m.db, viva, 'cancelar'), { ok: true });
 assert.ok(chamadas.some(([met, u]) => met === 'DELETE' && u.includes('/events/ev-1')));
 assert.deepEqual(await m.google.sincronizar(m.db, ATIVIDADE, 'atualizar'), { ignorado: true });
 const quebrado = comConexao(async () => { throw new Error('rede caiu'); });
 const silencio = console.error; console.error = () => {};
 try { assert.deepEqual(await quebrado.google.sincronizar(quebrado.db, viva, 'atualizar'), { falhou: true }); } finally { console.error = silencio; }
});

test('a atividade avisa o Google ao editar e ao cancelar, e a resposta não espera por ele', async () => {
 const chamadas = [];
 const google = { detector: async () => true, sincronizar: (pool, row, acao) => { chamadas.push([row.id, acao]); return new Promise(() => {}); } };   // nunca resolve: a rota não pode esperar
 const rotas = {};
 trackingRoutes({ get: (p, h) => { rotas['GET ' + p] = h; }, post: (p, h) => { rotas['POST ' + p] = h; }, put: (p, h) => { rotas['PUT ' + p] = h; }, delete: (p, h) => { rotas['DELETE ' + p] = h; } }, { detector: criarDetector(), google });
 const linha = { id: ID, title: 'Novo título', status: 'planned', revision: 2, google_event_id: 'ev' };
 const pool = { query: async sql => (sql.includes('information_schema') ? { rows: [{ campos: 3, colunas: 5, tabelas: 4 }] } : { rows: [] }), async connect() { return { query: async sql => (sql.includes('information_schema') ? { rows: [{ campos: 3, colunas: 5, tabelas: 4 }] } : sql.startsWith('UPDATE service_activities') ? { rows: [linha] } : { rows: [] }), release() {} }; } };
 let saida;
 await rotas['PUT /api/tracking/:id']({ pool, params: { id: ID }, req: corpo({ revision: 1, title: 'Novo título' }), reply: (s, c) => { saida = { s, c }; }, operator: OPERADOR });
 assert.equal(saida.s, 200);
 await rotas['PUT /api/tracking/:id/status']({ pool, params: { id: ID }, req: corpo({ status: 'cancelled', revision: 2 }), reply: (s, c) => { saida = { s, c }; }, operator: OPERADOR });
 assert.deepEqual(chamadas, [[ID, 'atualizar']], 'cancelar só dispara quando o status devolvido é cancelled');
 linha.status = 'cancelled';
 await rotas['PUT /api/tracking/:id/status']({ pool, params: { id: ID }, req: corpo({ status: 'cancelled', revision: 2 }), reply: (s, c) => { saida = { s, c }; }, operator: OPERADOR });
 assert.deepEqual(chamadas.at(-1), [ID, 'cancelar']);
});

test('migração 049: só adiciona, e o código lista exatamente as tabelas e colunas que ela cria', async () => {
 const { readFileSync } = await import('node:fs');
 const sql = readFileSync(new URL('../../db/migrations/049_google_calendar.sql', import.meta.url), 'utf8');
 assert.ok(!/\bDROP\b|\bDELETE\b|\bTRUNCATE\b/i.test(sql.replace(/--.*$/gm, '')), 'migração aditiva');
 for (const t of ['google_calendar_connections', 'google_calendar_flows']) assert.ok(sql.includes(`CREATE TABLE IF NOT EXISTS ${t}`), t);
 for (const c of ['google_event_id', 'google_owner_subject']) assert.ok(sql.includes(`ADD COLUMN IF NOT EXISTS ${c}`), c);
 assert.ok(!/token_plain|access_token/.test(sql), 'o token de acesso nunca é gravado');
 const fonte = readFileSync(new URL('../../apps/api/src/app.mjs', import.meta.url), 'utf8');
 assert.match(fonte, /googleCalendarRoutes\(router/);
});
