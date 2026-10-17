// Responsável da atividade (migração 060): quem pode ser escolhido, quem é avisado e quem NÃO é.
//
// O ponto de ter um responsável é o aviso chegar só a ele. Por isso a maior parte destes testes é sobre o que NÃO sai:
// trocar para quem já era, tirar o responsável, atribuir a si mesmo, e lembrete de atividade que tem dono não vai ao grupo.
import test from 'node:test';
import assert from 'node:assert/strict';
import { trackingRoutes } from '../../apps/api/src/modules/tracking.mjs';
import { notificarPessoa } from '../../apps/api/src/modules/push.mjs';
import { enviarLembretes } from '../../apps/api/src/modules/agenda-jobs.mjs';
import { criarDetector, criarDetectorResponsavel, MENSAGEM_060 } from '../../apps/api/src/platform/agenda-recursos.mjs';
import { payloadAtribuicao } from '../../apps/api/src/platform/webpush.mjs';

const ID = '00000000-0000-4000-8000-000000000001';
const TENANT = '00000000-0000-4000-8000-0000000000a1';
const ANA = { id: '00000000-0000-4000-8000-0000000000b1', email: 'ana@tzolkin.test', name: 'Ana', role: 'member', status: 'active' };
const BIA = { id: '00000000-0000-4000-8000-0000000000b2', email: 'bia@tzolkin.test', name: 'Bia', role: 'owner', status: 'active' };
const LEITOR = { id: '00000000-0000-4000-8000-0000000000b3', email: 'leitor@tzolkin.test', name: 'Leo', role: 'viewer', status: 'active' };
const SUSPENSA = { id: '00000000-0000-4000-8000-0000000000b4', email: 'sus@tzolkin.test', name: 'Sue', role: 'member', status: 'suspended' };
const CONTAS = [ANA, BIA, LEITOR, SUSPENSA];
const base = { id: ID, tenant_id: TENANT, category: 'mentoria', kind: 'sessao', title: 'Mentoria Alfa', starts_at: '2026-10-05T13:00:00-03:00', ends_at: '2026-10-05T14:00:00-03:00' };
const corpo = b => ({ headers: { 'content-type': 'application/json' }, async *[Symbol.asyncIterator]() { yield Buffer.from(JSON.stringify(b)); } });
const espera = () => new Promise(r => setTimeout(r, 5));

// ---------- detector ----------
test('detector da 060: verdadeiro fica; falso só é reverificado depois do prazo', async () => {
 let agora = 0, perguntas = 0, existe = false;
 const db = { query: async () => { perguntas++; return { rows: [{ n: existe ? 1 : 0 }] }; } };
 const detector = criarDetectorResponsavel({ relogio: () => agora, ttl: 1000 });
 assert.equal(await detector(db), false);
 assert.equal(await detector(db), false); assert.equal(perguntas, 1, 'falso é lembrado por um tempo');
 agora = 1500; existe = true;
 assert.equal(await detector(db), true, 'depois do prazo enxerga a migração recém-aplicada');
 existe = false; agora = 99999;
 assert.equal(await detector(db), true); assert.equal(perguntas, 2, 'verdadeiro nunca volta a falso nem pergunta de novo');
});

// ---------- aviso ----------
test('o aviso de atribuição diz o que é, de quem e por quem; a marca colapsa reatribuições', () => {
 const p = payloadAtribuicao({ titulo: 'Mentoria Alfa', empresa: 'Empresa Alfa', inicio: Date.parse('2026-10-05T17:30:00Z'), por: 'Gustavo', atividadeId: ID });
 assert.match(p.title, /^Atividade atribuída a você — Mentoria Alfa$/);
 assert.match(p.body, /Empresa Alfa/); assert.match(p.body, /por Gustavo/);
 assert.equal(p.tag, `agenda:atribuida:${ID}`); assert.equal(p.view, 'tracking');
});

test('notificarPessoa: só os aparelhos daquela pessoa, e sem pessoa não sai para ninguém', async () => {
 const consultas = [];
 const pool = { query: async (sql, params) => { consultas.push({ sql, params }); if (sql.startsWith('UPDATE')) return { rows: [] }; return { rows: [{ id: 's1', endpoint: 'https://push.test/1', p256dh: 'p', auth: 'a' }] }; } };
 const enviados = [];
 const r = await notificarPessoa(pool, 'agenda.lembrete', 'Ana@Tzolkin.test', { title: 't' }, async (assinatura, payload) => { enviados.push({ assinatura, payload }); });
 assert.equal(r.enviados, 1);
 assert.deepEqual(consultas[0].params, ['agenda.lembrete', 'Ana@Tzolkin.test']);
 assert.match(consultas[0].sql, /lower\(s\.operator_email\) = lower\(\$2\)/, 'compara o e-mail sem diferenciar maiúscula');
 assert.match(consultas[0].sql, /operator_sessions/, 'segundo caminho: o subject da sessão da mesma pessoa');
 const antes = consultas.length;
 assert.deepEqual(await notificarPessoa(pool, 'agenda.lembrete', null, {}, async () => assert.fail()), { enviados: 0, revogados: 0, falhas: 0 });
 assert.equal(consultas.length, antes, 'sem e-mail nem consulta o banco: NÃO cai para "todo mundo"');
 await assert.rejects(notificarPessoa(pool, 'topico.inventado', 'a@b.c', {}, () => {}), /Tópico desconhecido/);
});

// ---------- lembrete ----------
const bancoDoJob = linhas => {
 const log = [];
 const q = async (sql, params = []) => { log.push({ sql, params }); if (sql.includes('WITH padrao')) return { rows: linhas }; if (sql.includes('information_schema')) return { rows: [{ campos: 3, colunas: 5, tabelas: 4 }] }; return { rows: [], rowCount: 0 }; };
 return { log, query: q };
};
const vencido = extra => ({ id: ID, title: 'Mentoria Alfa', starts_at: new Date('2026-10-05T17:30:00Z'), empresa: 'Empresa Alfa', minutos: 15, responsavel_email: null, ...extra });

test('lembrete: com responsável vai só a ele; sem, a quem assinou o tópico, como antes', async () => {
 const db = bancoDoJob([vencido({ responsavel_email: 'ana@tzolkin.test' }), vencido({ id: '00000000-0000-4000-8000-000000000002' })]);
 const doTopico = [], dePessoa = [];
 const r = await enviarLembretes(db, {
  enviar: () => {}, detector: criarDetector(), responsavel: async () => true, agora: () => Date.parse('2026-10-05T17:15:30Z'),
  notificar: async (p, topico) => { doTopico.push(topico); return { enviados: 3 }; },
  notificarUm: async (p, topico, email) => { dePessoa.push({ topico, email }); return { enviados: 1 }; },
 });
 assert.deepEqual(dePessoa, [{ topico: 'agenda.lembrete', email: 'ana@tzolkin.test' }], 'a atividade com dono só avisa o dono');
 assert.equal(doTopico.length, 1, 'a atividade sem dono continua indo ao tópico');
 assert.equal(r.enviados, 4);
});

test('lembrete: antes da 060 o SQL nem menciona o responsável (a coluna não existe)', async () => {
 const sem = bancoDoJob([]); const com = bancoDoJob([]);
 const base = { enviar: () => {}, detector: criarDetector(), agora: () => Date.parse('2026-10-05T17:15:30Z'), notificar: async () => ({ enviados: 0 }) };
 await enviarLembretes(sem, { ...base, responsavel: async () => false });
 await enviarLembretes(com, { ...base, responsavel: async () => true });
 const sqlSem = sem.log.find(q => q.sql.includes('WITH padrao')).sql, sqlCom = com.log.find(q => q.sql.includes('WITH padrao')).sql;
 assert.doesNotMatch(sqlSem, /responsible_id|operator_accounts/);
 assert.match(sqlCom, /LEFT JOIN operator_accounts r ON r\.id=a\.responsible_id/);
 assert.match(sqlCom, /r\.status='active'/, 'responsável suspenso não conta: cai no comportamento de sem responsável');
});

// ---------- rotas ----------
function montar({ migracao = true, contas = CONTAS, anterior = null, avisos = [] } = {}) {
 const r = {}, roteador = { get(p, h) { r['GET ' + p] = h; }, post(p, h) { r['POST ' + p] = h; }, put(p, h) { r['PUT ' + p] = h; }, delete(p, h) { r['DELETE ' + p] = h; } };
 const log = [];
 const responder = (sql, params = []) => {
  log.push({ sql, params });
  if (sql.includes('information_schema')) return { rows: [{ campos: 3, colunas: 5, tabelas: 4 }] };
  if (sql.includes('FROM operator_accounts WHERE id=$1')) return { rows: contas.filter(c => c.id === params[0]) };
  if (sql.includes('FROM tenants WHERE id=$1')) return { rows: [{ name: 'Empresa Alfa' }] };
  if (sql.startsWith('SELECT responsible_id FROM service_activities')) return { rows: [{ responsible_id: anterior }] };
  if (sql.startsWith('INSERT INTO service_activities')) return { rows: [{ ...base, revision: 1 }] };
  if (sql.startsWith('UPDATE service_activities')) return { rows: [{ ...base, revision: 2, responsible_id: params[0] }] };
  return { rows: [] };
 };
 const pool = { query: async (sql, p) => responder(sql, p), connect: async () => ({ query: async (sql, p) => responder(sql, p), release() {} }) };
 trackingRoutes(roteador, { detector: async () => ({ campos: true, lembretes: true }), registro: async () => true, vinculos: async () => false,
  responsavel: async () => migracao, avisarAtribuicao: async (db, aviso) => { avisos.push(aviso); } });
 const chamar = async (rota, extra) => { let resposta; await r[rota]({ pool, reply: (s, b) => { resposta = { status: s, body: b }; }, operator: { email: 'gustavo@tzolkin.test', subject: 's-g', name: 'Gustavo' }, ...extra }); return resposta; };
 return { chamar, log, avisos };
}

test('criar com responsável: grava a coluna e avisa só ele, com a empresa e quem atribuiu', async () => {
 const m = montar();
 const r = await m.chamar('POST /api/tracking', { req: corpo({ ...base, responsible_id: ANA.id }) });
 assert.equal(r.status, 200);
 const insert = m.log.find(q => q.sql.startsWith('INSERT INTO service_activities'));
 assert.match(insert.sql, /responsible_id/); assert.ok(insert.params.includes(ANA.id));
 await espera();
 assert.equal(m.avisos.length, 1);
 assert.deepEqual({ email: m.avisos[0].email, empresa: m.avisos[0].empresa, por: m.avisos[0].por }, { email: ANA.email, empresa: 'Empresa Alfa', por: 'Gustavo' });
});

test('criar sem responsável: não pergunta pela migração nem avisa ninguém (nada muda para quem não usa)', async () => {
 const m = montar({ migracao: false });
 const r = await m.chamar('POST /api/tracking', { req: corpo(base) });
 assert.equal(r.status, 200);
 await espera(); assert.equal(m.avisos.length, 0);
});

test('responsável inválido: leitor, conta suspensa e conta que não existe são recusados em português, antes de gravar', async () => {
 for (const id of [LEITOR.id, SUSPENSA.id, '00000000-0000-4000-8000-0000000000ff']) {
  const m = montar();
  await assert.rejects(m.chamar('POST /api/tracking', { req: corpo({ ...base, responsible_id: id }) }), e => e.status === 400 && /conta ativa de Administrador ou Membro/.test(e.message));
  assert.ok(!m.log.some(q => q.sql.startsWith('INSERT INTO service_activities')), 'nada foi gravado');
 }
});

test('antes da 060: pedir responsável dá 409 com a mensagem da migração, e sem consultar contas', async () => {
 const m = montar({ migracao: false });
 await assert.rejects(m.chamar('POST /api/tracking', { req: corpo({ ...base, responsible_id: ANA.id }) }), e => e.status === 409 && e.message === MENSAGEM_060);
 await assert.rejects(m.chamar('PUT /api/tracking/:id/responsible', { params: { id: ID }, req: corpo({ responsible_id: ANA.id, revision: 1 }) }), e => e.status === 409 && e.message === MENSAGEM_060);
 assert.ok(!m.log.some(q => q.sql.includes('FROM operator_accounts')));
});

test('trocar o responsável: sobe a revisão, deixa de/para na trilha e avisa só quem passou a ser responsável', async () => {
 const m = montar({ anterior: ANA.id });
 const r = await m.chamar('PUT /api/tracking/:id/responsible', { params: { id: ID }, req: corpo({ responsible_id: BIA.id, revision: 1 }) });
 assert.equal(r.status, 200); assert.equal(r.body.activity.revision, 2);
 const trilha = m.log.find(q => q.sql.startsWith('INSERT INTO service_activity_audit'));
 assert.equal(trilha.params[1], 'responsible_changed');
 assert.deepEqual(trilha.params[3], { de: ANA.id, para: BIA.id, revision: 1 });
 await espera();
 assert.deepEqual(m.avisos.map(a => a.email), [BIA.email], 'a Ana, que saiu, não recebe nada');
});

test('o que NÃO avisa: manter o mesmo, tirar o responsável, e atribuir a si mesmo', async () => {
 const igual = montar({ anterior: ANA.id });
 await igual.chamar('PUT /api/tracking/:id/responsible', { params: { id: ID }, req: corpo({ responsible_id: ANA.id, revision: 1 }) });
 const tirar = montar({ anterior: ANA.id });
 const r = await tirar.chamar('PUT /api/tracking/:id/responsible', { params: { id: ID }, req: corpo({ responsible_id: null, revision: 1 }) });
 assert.equal(r.status, 200);
 assert.deepEqual(tirar.log.find(q => q.sql.startsWith('INSERT INTO service_activity_audit')).params[3], { de: ANA.id, para: null, revision: 1 });
 const proprio = montar({ anterior: null });
 await proprio.chamar('PUT /api/tracking/:id/responsible', { params: { id: ID }, req: corpo({ responsible_id: BIA.id, revision: 1 }), operator: { email: 'BIA@tzolkin.test', subject: 's-b', name: 'Bia' } });
 await espera();
 assert.equal(igual.avisos.length + tirar.avisos.length + proprio.avisos.length, 0);
});

test('revisão velha: 409 e nada avisado', async () => {
 // O UPDATE não acha a linha (revisão não bate): o servidor responde 409 e ninguém é avisado.
 const roteador = {}; const avisos = [];
 trackingRoutes({ get() {}, post() {}, put(p, h) { roteador['PUT ' + p] = h; }, delete() {} }, {
  detector: async () => ({ campos: true, lembretes: true }), registro: async () => true, vinculos: async () => false, responsavel: async () => true,
  avisarAtribuicao: async (db, a) => avisos.push(a) });
 const client = { query: async sql => sql.includes('FROM operator_accounts') ? { rows: [ANA] } : sql.startsWith('SELECT responsible_id') ? { rows: [{ responsible_id: null }] } : { rows: [] }, release() {} };
 await assert.rejects(roteador['PUT /api/tracking/:id/responsible']({ pool: { connect: async () => client, query: async () => ({ rows: [] }) }, params: { id: ID }, req: corpo({ responsible_id: ANA.id, revision: 9 }), reply() {}, operator: { email: 'x@y.z' } }), e => e.status === 409);
 await espera(); assert.equal(avisos.length, 0);
});

test('GET /api/tracking oferece só quem pode ser escolhido e diz se a migração existe', async () => {
 const pedido = { url: new URL('http://x/api/tracking?month=2026-10'), operator: { email: 'g@x.y', subject: 's' } };
 const consultas = [];
 const r = {}; trackingRoutes({ get(p, h) { r['GET ' + p] = h; }, post() {}, put() {}, delete() {} }, { detector: async () => ({ campos: true, lembretes: true }), registro: async () => true, vinculos: async () => false, responsavel: async () => true });
 let resposta;
 await r['GET /api/tracking']({ ...pedido, reply: (s, b) => { resposta = b; }, pool: { query: async sql => { consultas.push(sql); return sql.includes('FROM operator_accounts') ? { rows: [{ id: ANA.id, name: 'Ana', email: ANA.email, role: 'member' }] } : { rows: [] }; } } });
 assert.equal(resposta.agenda_responsavel, true);
 assert.deepEqual(resposta.responsaveis.map(x => x.id), [ANA.id]);
 const sqlContas = consultas.find(s => s.includes('FROM operator_accounts'));
 assert.match(sqlContas, /status='active'/); assert.match(sqlContas, /role IN \('owner','member'\)/, 'Leitor e suspenso nunca aparecem na lista');
});

test('a migração 060 só acrescenta uma coluna, com chave para a conta, sem apagar nada', async () => {
 const { readFileSync } = await import('node:fs');
 const sql = readFileSync('db/migrations/060_responsavel_da_atividade.sql', 'utf8');
 assert.match(sql, /ADD COLUMN IF NOT EXISTS responsible_id uuid REFERENCES operator_accounts\(id\)/);
 const codigo = sql.replace(/--.*$/gm, '').replace(/'[^']*'/g, '');   // sem comentário nem o texto do COMMENT
 assert.doesNotMatch(codigo, /\bDROP\b|\bDELETE\b|\bTRUNCATE\b/i, 'nada é apagado');
 assert.doesNotMatch(codigo, /responsible_id uuid[^;]*NOT NULL/i, 'a coluna não é obrigatória: toda atividade que existe fica sem responsável');
});

test('MCP: criar_atividade, editar_atividade e listar_atividades aceitam responsible_id por UUID ou e-mail e auditam troca', async () => {
 const { mcpRoutes, _internals: mcp } = await import('../../apps/api/src/modules/mcp.mjs');
 for (const n of ['listar_atividades', 'criar_atividade', 'editar_atividade']) {
  assert.ok(mcp.TOOLS.find(t => t.name === n).inputSchema.properties.responsible_id, `${n} expõe responsible_id`);
 }
 const rotas = new Map();
 const router = { get: (p, h) => rotas.set(`GET ${p}`, h), post: (p, h) => rotas.set(`POST ${p}`, h), delete: (p, h) => rotas.set(`DELETE ${p}`, h) };
 const auditoria = [];
 let gravada = { ...base, revision: 1, responsible_id: null };
 const query = async (sql, params = []) => {
  if (sql === 'BEGIN' || sql === 'COMMIT' || sql === 'ROLLBACK') return {};
  if (sql.includes('FROM operator_accounts')) {
   const alvo = String(params[0]).toLowerCase();
   return { rows: CONTAS.filter(c => c.id === alvo || c.email.toLowerCase() === alvo) };
  }
  if (sql.includes('INSERT INTO service_activities')) {
   const cols = sql.match(/INSERT INTO service_activities\(([^)]+)\)/)[1].split(',').map(s => s.trim());
   gravada = { revision: 1 };
   cols.forEach((c, i) => { gravada[c] = params[i]; });
   return { rows: [gravada] };
  }
  if (sql.includes('SELECT * FROM service_activities WHERE id = $1')) return { rows: [gravada] };
  if (sql.includes('UPDATE service_activities SET')) {
   gravada = { ...gravada, responsible_id: params[2], revision: gravada.revision + 1 };
   return { rows: [gravada] };
  }
  if (sql.includes('INSERT INTO service_activity_audit')) {
   auditoria.push({ acao: params[1], detalhes: JSON.parse(params[3]) });
   return {};
  }
  return { rows: [] };
 };
 const pool = { query, connect: async () => ({ query, release() {} }) };
 mcpRoutes(router, { pool, env: { SPARK_MCP_TOKEN: 'token-mcp-1234567890123' }, responsavel: async () => true, tags: async () => false });
 const chamar = async (name, args) => {
  let out;
  await rotas.get('POST /api/mcp')({
   pool,
   req: {
    headers: { authorization: 'Bearer token-mcp-1234567890123', 'content-type': 'application/json' },
    async *[Symbol.asyncIterator]() { yield Buffer.from(JSON.stringify({ jsonrpc: '2.0', id: 1, method: 'tools/call', params: { name, arguments: args } })); },
   },
   reply: (st, b) => { out = b; },
  });
  return out;
 };

 // Criar informando e-mail da Ana -> resolve para ANA.id
 const rCriar = await chamar('criar_atividade', {
  tenant_id: TENANT, kind: 'tarefa', title: 'Revisar escopo', starts_at: '2026-10-10 10:00', ends_at: '2026-10-10 11:00', responsible_id: 'ANA@tzolkin.test',
 });
 assert.equal(rCriar.result.isError, false);
 assert.equal(JSON.parse(rCriar.result.content[0].text).activity.responsible_id, ANA.id);

 // Editar trocando de Ana para Bia -> grava responsible_changed na trilha
 const rEditar = await chamar('editar_atividade', { id: gravada.id, responsible_id: BIA.id });
 assert.equal(rEditar.result.isError, false);
 assert.equal(JSON.parse(rEditar.result.content[0].text).activity.responsible_id, BIA.id);
 const trilhaResp = auditoria.find(a => a.acao === 'responsible_changed');
 assert.ok(trilhaResp, 'registrou responsible_changed');
 assert.equal(trilhaResp.detalhes.de, ANA.id);
 assert.equal(trilhaResp.detalhes.para, BIA.id);

 // Leitor recusado
 const rInvalido = await chamar('editar_atividade', { id: gravada.id, responsible_id: LEITOR.email });
 assert.equal(rInvalido.result.isError, true);
 assert.match(rInvalido.result.content[0].text, /conta ativa de Administrador ou Membro/);
});
