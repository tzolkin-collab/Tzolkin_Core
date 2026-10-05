// Auditoria de contas, times e sessões (operator_audit, migração 053).
import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { registrarAuditoria, resumirConta, resumirTime } from '../../apps/api/src/platform/auditoria-operadores.mjs';
import { accountRoutes } from '../../apps/api/src/modules/accounts.mjs';
import { contaRoutes } from '../../apps/api/src/modules/conta.mjs';
import { digest } from '../../apps/api/src/platform/session.mjs';

const DONO = { subject: 'g-1', email: 'dono@exemplo.test' };

// ---------- resumos ----------
test('resumo de conta: criada, e só o que mudou (papel, situação, nome)', () => {
 assert.equal(resumirConta(null, { role: 'member', status: 'active', name: 'Lucas' }), 'Conta criada: Membro, ativa, nome Lucas');
 assert.equal(resumirConta(null, { role: 'viewer', status: 'active', name: null }), 'Conta criada: Leitor, ativa');
 assert.equal(resumirConta({ role: 'member', status: 'active', name: 'Lucas' }, { role: 'owner', status: 'active', name: 'Lucas' }), 'Papel: Membro → Administrador');
 assert.equal(resumirConta({ role: 'member', status: 'active', name: 'Lucas' }, { role: 'member', status: 'suspended', name: 'Lucas' }), 'Situação: Ativa → Suspensa');
 assert.equal(resumirConta({ role: 'member', status: 'active', name: null }, { role: 'owner', status: 'suspended', name: 'Lu' }), 'Papel: Membro → Administrador · Situação: Ativa → Suspensa · Nome: — → Lu');
 assert.equal(resumirConta({ role: 'member', status: 'active', name: 'A' }, { role: 'member', status: 'active', name: 'A' }), '', 'nada mudou: sem resumo, sem registro');
});

test('resumo de time: criado, nome, descrição, quem entrou, saiu ou mudou de papel', () => {
 const m = (email, role = 'member') => ({ email, role });
 assert.equal(resumirTime(null, { name: 'Vendas', description: null, membros: [m('a@x.co')] }), 'Time criado · Entraram: a@x.co');
 const antes = { name: 'Vendas', description: 'x', membros: [m('a@x.co'), m('b@x.co', 'lead'), m('c@x.co')] };
 assert.equal(resumirTime(antes, { name: 'Comercial', description: 'x', membros: [m('a@x.co'), m('b@x.co', 'member'), m('d@x.co')] }),
  'Nome: Vendas → Comercial · Entraram: d@x.co · Saíram: c@x.co · Papel no time: b@x.co (Líder → Membro)');
 assert.equal(resumirTime(antes, { ...antes, description: 'y' }), 'Descrição alterada');
 assert.equal(resumirTime(antes, { ...antes }), '', 'nada mudou');
});

// ---------- gravação ----------
test('registrarAuditoria grava em savepoint e nunca lança; tabela ausente é silêncio, outro erro vai ao log', async () => {
 const log = [];
 const ok = { async query(sql, p) { log.push(sql.trim().split(/\s+/).slice(0, 2).join(' ')); if (sql.startsWith('INSERT')) this.p = p; return { rows: [] }; } };
 assert.equal(await registrarAuditoria(ok, { acao: 'conta.criada', alvo: 'a@x.co', operator: DONO, detalhes: { resumo: 'r' } }), true);
 assert.deepEqual(log, ['SAVEPOINT auditoria_operadores', 'INSERT INTO', 'RELEASE SAVEPOINT']);
 assert.deepEqual(ok.p, ['conta.criada', 'a@x.co', 'g-1', 'dono@exemplo.test', '{"resumo":"r"}']);
 const semTabela = { async query(sql) { if (sql.startsWith('INSERT')) throw Object.assign(new Error('relation'), { code: '42P01' }); return { rows: [] }; } };
 const erros = []; const antigo = console.error; console.error = (...a) => erros.push(a.join(' '));
 try {
  assert.equal(await registrarAuditoria(semTabela, { acao: 'time.salvo', alvo: 'vendas' }), false);
  assert.equal(erros.length, 0, 'sem a 053: em silêncio');
  const quebrado = { async query(sql) { if (sql.startsWith('INSERT')) throw new Error('disco cheio'); return { rows: [] }; } };
  assert.equal(await registrarAuditoria(quebrado, { acao: 'time.salvo', alvo: 'vendas' }), false);
  assert.ok(erros.some(e => e.includes('disco cheio')));
 } finally { console.error = antigo; }
 assert.equal(await registrarAuditoria(ok, { acao: 'x', alvo: 'a'.repeat(500) }), true);
 assert.equal(ok.p[1].length, 320, 'alvo longo é cortado');
});

function banco({ conta = null, time = null, membros = [] } = {}) {
 const log = [];
 return {
  log,
  async query(sql, p = []) {
   log.push({ sql, p });
   if (sql.includes('FROM operator_accounts WHERE email=$1 AND status')) return { rowCount: 1, rows: [{ role: 'owner', name: 'Dono' }] };
   if (sql.includes('SELECT role,status,name FROM operator_accounts')) return { rows: conta ? [conta] : [] };
   if (sql.includes("role='owner' AND status='active'")) return { rowCount: 2, rows: [{ email: 'dono@exemplo.test' }, { email: 'outro@exemplo.test' }] };
   if (sql.includes('SELECT id,name,description FROM teams')) return { rows: time ? [{ id: 't1', ...time }] : [] };
   if (sql.includes('FROM team_members tm JOIN operator_accounts')) return { rows: membros };
   if (sql.includes('INSERT INTO teams')) return { rows: [{ id: 't1' }] };
   if (sql.includes('SELECT id FROM operator_accounts WHERE email=$1')) return { rowCount: 1, rows: [{ id: 'acc-' + p[0] }] };
   return { rows: [], rowCount: 0 };
  },
 };
}
const auditorias = db => db.log.filter(q => q.sql.startsWith('INSERT INTO operator_audit'));

test('criar e alterar conta registram o antes e o depois; salvar sem mudar nada não registra', async () => {
 const rotas = {};
 accountRoutes({ get: () => {}, put: (p, h) => { rotas[p] = h; } }, { env: {} });
 const nova = banco();
 await rotas['/api/accounts']({ client: nova, body: { email: 'Lucas@Exemplo.test', name: 'Lucas', role: 'member' }, operator: DONO });
 const [a] = auditorias(nova);
 assert.deepEqual([a.p[0], a.p[1], a.p[2], a.p[3]], ['conta.criada', 'lucas@exemplo.test', 'g-1', 'dono@exemplo.test']);
 const d = JSON.parse(a.p[4]);
 assert.deepEqual(d.depois, { role: 'member', status: 'active', name: 'Lucas' }); assert.equal(d.antes, null); assert.equal(d.resumo, 'Conta criada: Membro, ativa, nome Lucas');
 const muda = banco({ conta: { role: 'member', status: 'active', name: 'Lucas' } });
 await rotas['/api/accounts']({ client: muda, body: { email: 'lucas@exemplo.test', name: 'Lucas', role: 'owner', status: 'suspended' }, operator: DONO });
 const [b] = auditorias(muda);
 assert.equal(b.p[0], 'conta.alterada'); assert.equal(JSON.parse(b.p[4]).resumo, 'Papel: Membro → Administrador · Situação: Ativa → Suspensa');
 const igual = banco({ conta: { role: 'member', status: 'active', name: 'Lucas' } });
 await rotas['/api/accounts']({ client: igual, body: { email: 'lucas@exemplo.test', name: 'Lucas', role: 'member', status: 'active' }, operator: DONO });
 assert.equal(auditorias(igual).length, 0, 'sem mudança, sem ruído');
 // o registro vem DEPOIS de a conta ser gravada e na mesma transação (mesmo client)
 const ordem = nova.log.map(q => q.sql.trim().split(/\s+/).slice(0, 3).join(' '));
 assert.ok(ordem.indexOf('INSERT INTO operator_accounts(email,name,role,status,source)') < ordem.indexOf('INSERT INTO operator_audit(action,target,actor_subject,actor_email,details)'));
 // nada de segredo no que se grava
 assert.ok(!/senha|token|hash|secret/i.test(auditorias(muda).map(q => q.p[4]).join('')));
});

test('a conta é alterada mesmo se a 053 não existe (o registro é opcional)', async () => {
 const rotas = {};
 accountRoutes({ get: () => {}, put: (p, h) => { rotas[p] = h; } }, { env: {} });
 const db = banco();
 const original = db.query.bind(db);
 db.query = async (sql, p) => { if (sql.startsWith('INSERT INTO operator_audit')) throw Object.assign(new Error('relation'), { code: '42P01' }); return original(sql, p); };
 const r = await rotas['/api/accounts']({ client: db, body: { email: 'lucas@exemplo.test', role: 'member' }, operator: DONO });
 assert.equal(r.type, 'operator_account.saved');
 assert.ok(db.log.some(q => q.sql.startsWith('INSERT INTO operator_accounts')));
});

test('salvar time registra criação, entradas, saídas e mudança de papel; sem mudança, nada', async () => {
 const rotas = {};
 accountRoutes({ get: () => {}, put: (p, h) => { rotas[p] = h; } }, { env: {} });
 const novo = banco();
 await rotas['/api/teams']({ client: novo, body: { slug: 'vendas', name: 'Vendas', members: [{ email: 'B@x.co', role: 'lead' }, { email: 'a@x.co' }] }, operator: DONO });
 const [a] = auditorias(novo);
 assert.deepEqual([a.p[0], a.p[1]], ['time.salvo', 'vendas']);
 assert.equal(JSON.parse(a.p[4]).resumo, 'Time criado · Entraram: a@x.co, b@x.co');
 const existente = banco({ time: { name: 'Vendas', description: null }, membros: [{ email: 'a@x.co', role: 'member' }, { email: 'c@x.co', role: 'member' }] });
 await rotas['/api/teams']({ client: existente, body: { slug: 'vendas', name: 'Vendas', members: [{ email: 'a@x.co', role: 'lead' }, { email: 'b@x.co' }] }, operator: DONO });
 assert.equal(JSON.parse(auditorias(existente)[0].p[4]).resumo, 'Entraram: b@x.co · Saíram: c@x.co · Papel no time: a@x.co (Membro → Líder)');
 const sem = banco({ time: { name: 'Vendas', description: null }, membros: [{ email: 'a@x.co', role: 'member' }] });
 await rotas['/api/teams']({ client: sem, body: { slug: 'vendas', name: 'Vendas', members: [{ email: 'a@x.co' }] }, operator: DONO });
 assert.equal(auditorias(sem).length, 0);
 const soNome = banco({ time: { name: 'Vendas', description: null }, membros: [{ email: 'a@x.co', role: 'member' }] });
 await rotas['/api/teams']({ client: soNome, body: { slug: 'vendas', name: 'Vendas BR' }, operator: DONO });   // sem `members`: a composição não muda
 assert.equal(JSON.parse(auditorias(soNome)[0].p[4]).resumo, 'Nome: Vendas → Vendas BR');
});

// ---------- leitura e sessões ----------
function conta(db, { agora = Date.parse('2026-10-05T12:00:00Z') } = {}) {
 const rotas = {};
 contaRoutes({ get: (p, h) => { rotas['GET ' + p] = h; }, post: (p, h) => { rotas['POST ' + p] = h; } }, { env: {}, clock: () => agora });
 return rotas;
}
test('a Auditoria lê a terceira fonte devolvendo só o resumo (nunca o jsonb), em ordem com as outras', async () => {
 const db = { log: [], async query(sql) { this.log.push(sql); if (sql.includes('FROM audit_events')) return { rows: [{ type: 'lead.moved', actor_email: 'a@x.co', created_at: '2026-10-05T10:00:00Z', empresa: 'Alfa' }] };
  if (sql.includes('integration_credentials_history')) return { rows: [] };
  if (sql.includes('FROM operator_audit')) return { rows: [{ action: 'conta.alterada', target: 'lucas@exemplo.test', actor_email: 'dono@exemplo.test', resumo: 'Papel: Membro → Administrador', created_at: '2026-10-05T11:00:00Z' }, { action: 'time.salvo', target: 'vendas', actor_email: 'dono@exemplo.test', resumo: null, created_at: '2026-10-05T09:00:00Z' }] };
  return { rows: [] }; } };
 let saida;
 await conta(db)['GET /api/audit']({ pool: db, url: new URL('http://x.test/api/audit'), reply: (s, c) => { saida = c; } });
 assert.deepEqual(saida.itens.map(i => [i.tipo, i.fonte, i.resumo ?? null]), [['conta.alterada', 'operadores', 'Papel: Membro → Administrador'], ['lead.moved', 'empresas', null], ['time.salvo', 'operadores', null]]);
 assert.equal(saida.itens[0].onde, 'lucas@exemplo.test'); assert.deepEqual(saida.fora_da_trilha, []);
 const q = db.log.find(s => s.includes('FROM operator_audit'));
 assert.match(q, /details->>'resumo'/); assert.ok(!/SELECT[^;]*\bdetails\b[^-]/.test(q.replace("details->>'resumo'", '')), 'o jsonb inteiro não é lido');
 // sem a 053: só avisa
 const antigo = { async query(sql) { if (sql.includes('FROM operator_audit')) throw Object.assign(new Error('relation'), { code: '42P01' }); return { rows: [] }; } };
 let s2; await conta(antigo)['GET /api/audit']({ pool: antigo, url: new URL('http://x.test/api/audit'), reply: (s, c) => { s2 = c; } });
 assert.deepEqual(s2.itens, []); assert.match(s2.fora_da_trilha[0], /migração 053/);
});

test('encerrar as outras sessões deixa rastro com a quantidade; sem sessão encerrada, sem rastro', async () => {
 const TOKEN = 'token-da-sessao-atual-1234567890';
 const montar = n => ({ log: [], async query(sql, p) { this.log.push({ sql, p }); if (sql.includes('UPDATE operator_sessions')) return { rowCount: n, rows: Array.from({ length: n }, () => ({})) }; return { rows: [] }; } });
 const um = montar(1), tres = montar(3), nenhuma = montar(0);
 const r = conta(um);
 for (const db of [um, tres, nenhuma]) await r['POST /api/me/sessoes/encerrar-outras']({ client: db, operator: DONO, sessions: { mode: 'google-oidc' }, sessionToken: TOKEN });
 const reg = db => db.log.find(q => q.sql.startsWith('INSERT INTO operator_audit'));
 assert.equal(JSON.parse(reg(um).p[4]).resumo, '1 sessão encerrada pela própria pessoa');
 assert.equal(JSON.parse(reg(tres).p[4]).quantidade, 3); assert.equal(reg(tres).p[0], 'sessoes.encerradas');
 assert.equal(reg(nenhuma), undefined);
 assert.ok(!JSON.stringify(reg(tres).p).includes(TOKEN) && !JSON.stringify(reg(tres).p).includes(digest(TOKEN)), 'nem token nem hash no rastro');
});

test('migração 053: só adiciona, ações em lista fechada, detalhes com teto de tamanho', () => {
 const sql = readFileSync(new URL('../../db/migrations/053_auditoria_de_operadores.sql', import.meta.url), 'utf8').replace(/--.*$/gm, '');
 assert.ok(!/\bDROP\b|\bDELETE\b|\bTRUNCATE\b/i.test(sql));
 for (const a of ['conta.criada', 'conta.alterada', 'time.salvo', 'sessoes.encerradas']) assert.ok(sql.includes(`'${a}'`), a);
 assert.match(sql, /pg_column_size\(details\) <= 8192/);
});
