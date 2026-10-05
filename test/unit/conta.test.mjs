// Configurações → Perfil e sessão, Acessos, Auditoria e "só administrador troca credencial".
import test from 'node:test';
import assert from 'node:assert/strict';
import { papelDoOperador, podeAdministrar, accountRoutes } from '../../apps/api/src/modules/accounts.mjs';
import { contaRoutes } from '../../apps/api/src/modules/conta.mjs';
import { integrationsCredentialsRoutes } from '../../apps/api/src/modules/integrations-credentials.mjs';
import { criarEnvVivo } from '../../apps/api/src/platform/env-vivo.mjs';
import { digest } from '../../apps/api/src/platform/session.mjs';
import { randomBytes } from 'node:crypto';

const LOCAL = { subject: 'local-bootstrap', email: null };
const dono = { subject: 'g-1', email: 'Dono@Exemplo.test' };
const membro = { subject: 'g-2', email: 'membro@exemplo.test' };
const leitor = { subject: 'g-3', email: 'leitor@exemplo.test' };
const doAmbiente = { subject: 'g-4', email: 'ambiente@exemplo.test' };
const semEmail = { subject: 'g-5', email: null };
const CONTAS = { 'dono@exemplo.test': { role: 'owner', name: 'Gustavo' }, 'membro@exemplo.test': { role: 'member', name: 'Lucas' }, 'leitor@exemplo.test': { role: 'viewer', name: null } };
const banco = (extra = {}) => ({
 log: [],
 async query(sql, p = []) {
  this.log.push({ sql, p });
  if (sql.includes('FROM operator_accounts WHERE email=$1')) { const c = CONTAS[p[0]]; return c ? { rowCount: 1, rows: [c] } : { rowCount: 0, rows: [] }; }
  for (const [trecho, fn] of Object.entries(extra)) if (sql.includes(trecho)) { const r = fn(p, sql); if (r instanceof Error) throw r; return r; }
  return { rows: [], rowCount: 0 };
 },
});

test('papel de quem está logado: local e ambiente contam como administrador; o cadastro manda quando existe; sem e-mail não administra', async () => {
 const db = banco();
 assert.deepEqual(await papelDoOperador(db, LOCAL), { papel: 'owner', nome: null, origem: 'local', administra: true });
 assert.deepEqual(await papelDoOperador(db, dono), { papel: 'owner', nome: 'Gustavo', origem: 'cadastro', administra: true });
 assert.deepEqual(await papelDoOperador(db, membro), { papel: 'member', nome: 'Lucas', origem: 'cadastro', administra: false });
 assert.equal((await papelDoOperador(db, leitor)).administra, false);
 assert.deepEqual(await papelDoOperador(db, doAmbiente), { papel: 'owner', nome: null, origem: 'ambiente', administra: true }, 'entrou pelo ambiente e não tem conta ativa: o primeiro acesso não se tranca');
 assert.deepEqual(await papelDoOperador(db, semEmail), { papel: 'member', nome: null, origem: 'ambiente', administra: false });
 assert.equal(await podeAdministrar(db, dono), true); assert.equal(await podeAdministrar(db, membro), false);
 assert.match(db.log.find(q => q.sql.includes('operator_accounts')).sql, /status='active'/, 'conta suspensa não vale como cadastro');
});

test('gerenciar contas segue exigindo administrador (a regra de antes, agora pela mesma função)', async () => {
 const rotas = {};
 accountRoutes({ get: () => {}, put: (p, h) => { rotas[p] = h; } }, { env: {} });
 const db = banco({ "role='owner' AND status='active'": () => ({ rows: [{ email: 'dono@exemplo.test' }], rowCount: 1 }) });
 await assert.rejects(rotas['/api/accounts']({ client: db, body: { email: 'novo@exemplo.test' }, operator: membro }), e => e.status === 403 && /Apenas administradores/.test(e.message));
 await assert.rejects(rotas['/api/accounts']({ client: db, body: { email: 'novo@exemplo.test' }, operator: leitor }), e => e.status === 403);
 const r = await rotas['/api/accounts']({ client: db, body: { email: 'novo@exemplo.test', role: 'member' }, operator: dono });
 assert.equal(r.type, 'operator_account.saved');
 await rotas['/api/accounts']({ client: db, body: { email: 'novo2@exemplo.test' }, operator: LOCAL });
});

function montarConta({ modo = 'google-oidc', db = banco(), agora = Date.parse('2026-10-05T12:00:00Z') } = {}) {
 const rotas = {}, regs = {};
 const reg = m => (p, h, o) => { rotas[`${m} ${p}`] = h; regs[`${m} ${p}`] = o; };
 contaRoutes({ get: reg('GET'), post: reg('POST') }, { env: {}, clock: () => agora });
 return { rotas, regs, db, sessions: { mode: modo } };
}
const reply = () => { const s = {}; return { fn: (st, c) => { s.status = st; s.corpo = c; }, s }; };

test('/api/me: papel, como entrou e até quando vale a sessão — sem token nem hash', async () => {
 const TOKEN = 'token-secreto-da-sessao-1234567890';
 const db = banco({
  'FROM operator_sessions WHERE token_hash': p => (p[0] === digest(TOKEN) ? { rows: [{ created_at: '2026-10-05T08:00:00Z', expires_at: '2026-10-05T16:00:00Z' }] } : { rows: [] }),
  'count(*)::int': () => ({ rows: [{ n: 2 }] }),
 });
 const m = montarConta({ db });
 const r = reply();
 await m.rotas['GET /api/me']({ pool: db, url: new URL('http://x.test/api/me'), reply: r.fn, operator: dono, sessions: m.sessions, sessionToken: TOKEN });
 assert.deepEqual(r.s.corpo, { email: 'Dono@Exemplo.test', nome: 'Gustavo', modo: 'google', papel: 'owner', papel_rotulo: 'Administrador', origem: 'cadastro', pode_administrar: true, sessao: { criada_em: '2026-10-05T08:00:00Z', expira_em: '2026-10-05T16:00:00Z', outras_ativas: 2 } });
 const texto = JSON.stringify(r.s.corpo);
 assert.ok(!texto.includes(TOKEN) && !texto.includes(digest(TOKEN)));
 // outras sessões: só as da mesma pessoa, ainda válidas, e nunca a atual
 const contagem = db.log.find(q => q.sql.includes('count(*)::int'));
 assert.deepEqual(contagem.p, ['g-1', digest(TOKEN), '2026-10-05T12:00:00.000Z']); assert.match(contagem.sql, /subject=\$1 AND token_hash<>\$2 AND revoked_at IS NULL AND expires_at>\$3/);
 const rm = reply();
 await m.rotas['GET /api/me']({ pool: db, url: new URL('http://x.test/api/me'), reply: rm.fn, operator: membro, sessions: m.sessions, sessionToken: TOKEN });
 assert.deepEqual([rm.s.corpo.papel_rotulo, rm.s.corpo.pode_administrar], ['Membro', false]);
 // senha local: uma sessão só, sem consulta de sessões
 const local = montarConta({ modo: 'local-password' });
 const rl = reply();
 await local.rotas['GET /api/me']({ pool: local.db, url: new URL('http://x.test/api/me'), reply: rl.fn, operator: LOCAL, sessions: local.sessions, sessionToken: 'x' });
 assert.deepEqual([rl.s.corpo.modo, rl.s.corpo.origem, rl.s.corpo.sessao], ['senha-local', 'local', null]);
 assert.ok(!local.db.log.some(q => q.sql.includes('operator_sessions')));
});

test('encerrar as outras sessões: só as da mesma pessoa, a atual segue; no acesso por senha local não se aplica', async () => {
 const TOKEN = 'token-atual-da-sessao-1234567890';
 const db = banco({ 'UPDATE operator_sessions SET revoked_at': () => ({ rowCount: 3, rows: [{}, {}, {}] }) });
 const m = montarConta({ db });
 const r = await m.rotas['POST /api/me/sessoes/encerrar-outras']({ client: db, operator: dono, sessions: m.sessions, sessionToken: TOKEN });
 assert.deepEqual(r.response, { ok: true, encerradas: 3 });
 const up = db.log.find(q => q.sql.includes('UPDATE operator_sessions'));
 assert.deepEqual(up.p, ['g-1', digest(TOKEN)]); assert.match(up.sql, /token_hash<>\$2/, 'a sessão atual fica');
 assert.equal(m.regs['POST /api/me/sessoes/encerrar-outras'].transactional, true);
 const local = montarConta({ modo: 'local-password' });
 await assert.rejects(local.rotas['POST /api/me/sessoes/encerrar-outras']({ client: local.db, operator: LOCAL, sessions: local.sessions, sessionToken: 'x' }), e => e.status === 409 && /Sair/.test(e.message));
});

test('auditoria: junta a trilha das empresas e a das credenciais em ordem, sem valores, e avisa o que não entra', async () => {
 const db = banco({
  'FROM audit_events': () => ({ rows: [{ type: 'engagement.created', actor_email: 'a@x.test', created_at: '2026-10-05T10:00:00Z', empresa: 'Alfa' }, { type: 'lead.moved', actor_email: 'b@x.test', created_at: '2026-10-05T08:00:00Z', empresa: null }] }),
  'FROM integration_credentials_history': () => ({ rows: [{ provider: 'stripe', nome: 'STRIPE_SECRET_KEY', action: 'set', actor: 'dono@exemplo.test', created_at: '2026-10-05T09:00:00Z' }, { provider: 'vercel', nome: 'VERCEL_TOKEN', action: 'removed', actor: 'dono@exemplo.test', created_at: '2026-10-05T07:00:00Z' }] }),
 });
 const m = montarConta({ db });
 const r = reply();
 await m.rotas['GET /api/audit']({ pool: db, url: new URL('http://x.test/api/audit'), reply: r.fn });
 assert.deepEqual(r.s.corpo.itens.map(i => [i.tipo, i.fonte]), [['engagement.created', 'empresas'], ['credencial.definida', 'integracoes'], ['lead.moved', 'empresas'], ['credencial.removida', 'integracoes']]);
 assert.equal(r.s.corpo.itens[1].onde, 'stripe · STRIPE_SECRET_KEY');
 assert.deepEqual(r.s.corpo.fora_da_trilha, ['alterações de contas e times']);
 assert.ok(!db.log.some(q => /details|ciphertext|token_/.test(q.sql)), 'a consulta nem lê detalhes nem valores');
 const lim = reply();
 await m.rotas['GET /api/audit']({ pool: db, url: new URL('http://x.test/api/audit?limite=1'), reply: lim.fn });
 assert.equal(lim.s.corpo.itens.length, 1);
 await assert.rejects(m.rotas['GET /api/audit']({ pool: db, url: new URL('http://x.test/api/audit?outro=1'), reply: reply().fn }), e => e.status === 400);
 // sem a migração 050: só não há a fonte das credenciais
 const antigo = banco({ 'FROM audit_events': () => ({ rows: [{ type: 't', actor_email: null, created_at: '2026-10-05T10:00:00Z', empresa: null }] }), 'FROM integration_credentials_history': () => Object.assign(new Error('relation'), { code: '42P01' }) });
 const a = reply();
 await montarConta({ db: antigo }).rotas['GET /api/audit']({ pool: antigo, url: new URL('http://x.test/api/audit'), reply: a.fn });
 assert.equal(a.s.corpo.itens.length, 1);
});

// ---------- só administrador troca credencial ----------
const CHAVE = randomBytes(32).toString('base64');
function montarCred(db) {
 const rotas = {};
 const reg = m => (p, h) => { rotas[`${m} ${p}`] = h; };
 const v = criarEnvVivo({ base: { CORE_SECRETS_KEY: CHAVE }, log: { log() {}, error() {} } });
 integrationsCredentialsRoutes({ get: reg('GET'), post: reg('POST'), put: reg('PUT'), delete: reg('DELETE') }, { vivo: v, env: { CORE_SECRETS_KEY: CHAVE }, fetchImpl: async () => ({ ok: true, status: 200, json: async () => ({ projects: [] }) }) });
 return rotas;
}
const corpo = b => ({ headers: { 'content-type': 'application/json' }, async *[Symbol.asyncIterator]() { yield Buffer.from(JSON.stringify(b)); } });

test('credenciais de integração: só o administrador testa, salva, remove e gera chaves; qualquer um lê o estado e sabe se pode alterar', async () => {
 const rotas = montarCred();
 const db = banco();
 const valores = { provider: 'vercel', valores: { VERCEL_TOKEN: 'token-longo-1234567' } };
 const proibido = e => e.status === 403 && /Só administradores/.test(e.message);
 await assert.rejects(rotas['PUT /api/integrations/credentials']({ client: db, body: valores, operator: membro }), proibido);
 await assert.rejects(rotas['PUT /api/integrations/credentials']({ client: db, body: valores, operator: leitor }), proibido);
 await assert.rejects(rotas['DELETE /api/integrations/credentials/:provider/:nome']({ client: db, params: { provider: 'vercel', nome: 'VERCEL_TOKEN' }, operator: membro, url: new URL('http://x.test/x') }), proibido);
 await assert.rejects(rotas['POST /api/integrations/credentials/push/gerar']({ client: db, body: {}, operator: membro }), proibido);
 await assert.rejects(rotas['POST /api/integrations/credentials/test']({ pool: db, req: corpo(valores), reply: () => {}, operator: membro }), proibido);
 assert.ok(!db.log.some(q => /INSERT|UPDATE/.test(q.sql)), 'recusado antes de tocar em qualquer coisa');
 // administrador (cadastro, ambiente e local) passa
 for (const op of [dono, doAmbiente, LOCAL]) {
  let saida;
  await rotas['POST /api/integrations/credentials/test']({ pool: db, req: corpo(valores), reply: (s, c) => { saida = c; }, operator: op });
  assert.equal(saida.ok, true);
 }
 assert.equal((await rotas['PUT /api/integrations/credentials']({ client: db, body: valores, operator: dono })).response.ok, true);
 // leitura: aberta, mas diz se a pessoa pode alterar (a tela desabilita os botões)
 for (const [op, pode] of [[dono, true], [membro, false], [doAmbiente, true]]) {
  let saida;
  await rotas['GET /api/integrations/credentials']({ pool: db, reply: (s, c) => { saida = c; }, operator: op });
  assert.equal(saida.pode_alterar, pode, op.email);
 }
});
