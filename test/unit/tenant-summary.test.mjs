// Ficha da empresa sem banco: roteador falso, pool falso.
//
// O que estes testes protegem, em ordem de custo de errar:
//  1. a ficha de uma empresa nunca lê dado de outra (toda consulta leva o id da URL);
//  2. uma seção indisponível — sem permissão, tabela ausente — não derruba a ficha;
//  3. id inválido e parâmetro estranho são recusados antes de consultar;
//  4. quem não tem sessão de operador não chega ao handler;
//  5. nada de contato, hash ou identificador de acesso sai pela resposta.
import test from 'node:test';
import assert from 'node:assert/strict';
import { tenantSummaryRoutes, mesCorrente, _internals } from '../../apps/api/src/modules/tenant-summary.mjs';
import { createCore } from '../../apps/api/src/app.mjs';

const BOOT = { subject: 'local-bootstrap' };
const TENANT = '10000000-0000-4000-8000-000000000001';
const OUTRA = '10000000-0000-4000-8000-000000000002';
const CONTRATACAO = '30000000-0000-4000-8000-000000000003';
// 30/09/2026 23:30 em Brasília já é 01/10 em UTC: o mês tem de ser setembro.
const RELOGIO = () => Date.parse('2026-09-30T23:30:00-03:00');

function rota(opcoes = { clock: RELOGIO }) {
 let handler;
 tenantSummaryRoutes({ get: (caminho, h) => { assert.equal(caminho, '/api/tenants/:id/summary'); handler = h; } }, opcoes);
 return handler;
}

// Pool falso roteado por trecho de SQL. `respostas` é uma lista [trecho, linhas|função|Error].
function poolFalso(respostas = []) {
 const chamadas = [];
 return {
  chamadas,
  query: async (sql, params) => {
   chamadas.push({ sql, params });
   for (const [trecho, resposta] of respostas) {
    if (!sql.includes(trecho)) continue;
    if (resposta instanceof Error) throw resposta;
    const linhas = typeof resposta === 'function' ? resposta(sql, params) : resposta;
    return { rows: linhas, rowCount: linhas.length };
   }
   return { rows: [], rowCount: 0 };
  },
 };
}

const semBanco = () => ({ query: async () => assert.fail('o banco não deveria ser consultado') });
const erroPg = code => Object.assign(new Error('erro do banco'), { code });

const empresa = { id: TENANT, name: 'Empresa A', slug: 'empresa-a', organization_type: 'company', relationship_kind: 'customer', lifecycle_status: 'active', status: 'active' };

// Uma linha para cada seção, para a ficha completa passar por todas as consultas.
const bancoCompleto = (extra = []) => poolFalso([
 ...extra,
 ['FROM tenants WHERE id=$1', [empresa]],
 ['FROM organization_stakeholders', [{ id: 's1', name: 'Pessoa A', role: 'decision_maker', title: null, is_primary: true, contact_allowed: false }]],
 ['FROM client_engagements e LEFT JOIN products', [
  { id: CONTRATACAO, label: 'Mentoria', service_model: 'education', status: 'active', revision: 1, product_id: 'mentorias', product_name: 'TZOLKIN Mentorias', portfolio_kind: 'service_line', product_lifecycle_status: 'active' },
  { id: '30000000-0000-4000-8000-000000000004', label: 'Assessoria', service_model: 'advisory', status: 'planned', revision: 2, product_id: null, product_name: null, portfolio_kind: null, product_lifecycle_status: null },
 ]],
 ['FROM service_deploy_bindings', [{ engagement_id: CONTRATACAO, provider: 'vercel', external_project_id: 'prj_1', external_project_name: 'site-a', environment: 'production' }]],
 ['FROM marketing_campaign_bindings', [{ engagement_id: CONTRATACAO, provider: 'meta', external_id: 'c1', name: 'Campanha A', spend_cents: '12837', currency: 'BRL' }]],
 ['FROM service_time_logs', [{ minutes: 150, logs: 3, activities: 2 }]],
 ['FROM entitlements', [{ product_id: 'educare', product_name: 'Educare', plan: 'anual', rights: [] }]],
 ['FROM memberships', [{ product_id: 'educare', product_name: 'Educare', active: 4 }]],
 ['FROM commercial_contracts', [{ id: 'k1', lead_id: 'l1', product_id: 'sites', title: 'Site', status: 'active', amount_minor: '1500000', currency: 'BRL', starts_on: '2026-09-01', ends_on: null }]],
 ['FROM commercial_leads', [{ id: 'l1', name: 'Lead A', status: 'won', utm_source: 'instagram', utm_campaign: 'setembro' }]],
]);

const url = (consulta = '') => new URL(`http://127.0.0.1/api/tenants/x/summary${consulta}`);

async function ficha(pool, { id = TENANT, operator = BOOT, consulta = '', handler = rota() } = {}) {
 let resposta;
 await handler({ pool, params: { id }, url: url(consulta), operator, reply: (status, body) => { resposta = { status, body }; } });
 return resposta;
}

test('Ficha da empresa: entrada', async t => {
 await t.test('id que não é UUID é recusado antes de tocar o banco', async () => {
  for (const id of ['empresa-a', '123', `${TENANT}x`, "10000000-0000-4000-8000-00000000000' OR 1=1", ''])
   await assert.rejects(() => ficha(semBanco(), { id }), e => e.status === 400, id);
 });

 await t.test('parâmetro de consulta estranho é recusado antes de tocar o banco', async () => {
  // Um ?tenant_id=outra não pode virar um segundo filtro nem trocar de empresa.
  await assert.rejects(() => ficha(semBanco(), { consulta: `?tenant_id=${OUTRA}` }), e => e.status === 400);
 });

 await t.test('empresa inexistente é 404 e para na primeira consulta', async () => {
  const pool = poolFalso();
  await assert.rejects(() => ficha(pool), e => e.status === 404 && /Empresa não encontrada/.test(e.message));
  assert.equal(pool.chamadas.length, 1, 'sem empresa, nenhuma seção é consultada');
  assert.deepEqual(pool.chamadas[0].params, [TENANT]);
 });
});

test('Ficha da empresa: isolamento', async t => {
 await t.test('toda consulta recebe o id da URL como $1 e filtra por ele', async () => {
  const pool = bancoCompleto();
  const { status } = await ficha(pool);
  assert.equal(status, 200);
  // Uma consulta por entrada de SQL: nenhuma seção ficou de fora do teste.
  assert.equal(pool.chamadas.length, Object.keys(_internals.SQL).length);
  for (const { sql, params } of pool.chamadas) {
   assert.equal(params[0], TENANT, `consulta sem o id da empresa: ${sql.slice(0, 80)}`);
   assert.match(sql, /WHERE (?:[a-z]+\.)?(?:tenant_id|id)=\$1\b/, `consulta sem filtro pela empresa: ${sql.slice(0, 80)}`);
   assert.ok(!params.includes(OUTRA));
  }
 });

 await t.test('o id que vai ao banco é o da URL, não um de outra empresa', async () => {
  const pool = bancoCompleto([['FROM tenants WHERE id=$1', (_, p) => (p[0] === OUTRA ? [{ ...empresa, id: OUTRA }] : [])]]);
  const { body } = await ficha(pool, { id: OUTRA });
  assert.equal(body.tenant.id, OUTRA);
  assert.ok(pool.chamadas.every(c => c.params[0] === OUTRA));
 });

 await t.test('a checagem comercial é a única consulta que não é da empresa', async () => {
  const pool = bancoCompleto([['FROM operator_accounts', [{ role: 'member' }]]]);
  const { body } = await ficha(pool, { operator: { subject: 'google:1', email: 'Membro@tzolkin.test' } });
  assert.equal(body.contracts.available, true);
  const fora = pool.chamadas.filter(c => c.params[0] !== TENANT);
  assert.equal(fora.length, 1);
  assert.match(fora[0].sql, /FROM operator_accounts/);
  assert.deepEqual(fora[0].params, ['membro@tzolkin.test']);
 });
});

test('Ficha da empresa: seções', async t => {
 await t.test('ficha completa: todas as seções disponíveis, dinheiro em centavos inteiros', async () => {
  const { body } = await ficha(bancoCompleto());
  for (const s of ['people', 'engagements', 'deploys', 'campaigns', 'hours', 'access', 'contracts', 'origin'])
   assert.equal(body[s].available, true, s);
  assert.equal(body.tenant.name, 'Empresa A');
  assert.deepEqual(body.engagements.items.map(e => e.service_model), ['education', 'advisory'], 'educação entra como qualquer outra');
  assert.deepEqual(body.engagements.items[0].product, { id: 'mentorias', name: 'TZOLKIN Mentorias', portfolio_kind: 'service_line', lifecycle_status: 'active' });
  assert.equal(body.engagements.items[1].product, null, 'serviço sem item continua na ficha');
  assert.equal(body.contracts.items[0].amount_minor, 1500000);
  assert.equal(body.campaigns.items[0].spend_cents, 12837);
  assert.deepEqual({ minutes: body.hours.minutes, by_engagement: body.hours.by_engagement }, { minutes: 150, by_engagement: false });
 });

 await t.test('mês corrente é o de Brasília, e é ele que vai para horas e campanhas', async () => {
  assert.equal(mesCorrente(RELOGIO), '2026-09');
  const pool = bancoCompleto();
  const { body } = await ficha(pool);
  assert.equal(body.hours.month, '2026-09');
  for (const trecho of ['FROM service_time_logs', 'FROM marketing_campaign_bindings'])
   assert.deepEqual(pool.chamadas.find(c => c.sql.includes(trecho)).params, [TENANT, '2026-09-01']);
 });

 await t.test('sem permissão comercial: contratos e origem indisponíveis, o resto vem', async () => {
  // Operador sem e-mail é recusado por commercialPermission sem consultar nada.
  const pool = bancoCompleto();
  const { status, body } = await ficha(pool, { operator: { subject: 'sem-email', email: null } });
  assert.equal(status, 200);
  for (const s of ['contracts', 'origin']) {
   assert.equal(body[s].available, false, s);
   assert.match(body[s].reason, /permissão/);
   assert.equal(body[s].items, undefined, `${s} não pode vazar linhas`);
  }
  for (const s of ['people', 'engagements', 'deploys', 'campaigns', 'hours', 'access']) assert.equal(body[s].available, true, s);
  assert.equal(body.engagements.items.length, 2);
  assert.ok(!pool.chamadas.some(c => /commercial_(contracts|leads)/.test(c.sql)), 'recusado não consulta a tabela comercial');
 });

 await t.test('papel recusado pelo cadastro de operadores também só apaga a parte comercial', async () => {
  const recusa = Object.assign(new Error('Sem permissão para esta operação.'), { status: 403 });
  const pool = bancoCompleto([['FROM operator_accounts', recusa]]);
  const { body } = await ficha(pool, { operator: { subject: 'google:2', email: 'x@tzolkin.test' } });
  assert.equal(body.contracts.available, false);
  assert.equal(body.origin.available, false);
  assert.equal(body.people.available, true);
 });

 await t.test('tabela ausente vira seção indisponível, não erro 500', async () => {
  const pool = bancoCompleto([['FROM marketing_campaign_bindings', erroPg('42P01')], ['FROM commercial_leads', erroPg('42703')]]);
  const { status, body } = await ficha(pool);
  assert.equal(status, 200);
  assert.deepEqual(body.campaigns, { available: false, reason: _internals.MOTIVOS.ausente });
  assert.deepEqual(body.origin, { available: false, reason: _internals.MOTIVOS.ausente });
  assert.equal(body.deploys.available, true);
  assert.equal(body.contracts.available, true);
 });

 await t.test('falha inesperada numa seção não derruba a ficha nem vaza a mensagem do banco', async () => {
  const pool = bancoCompleto([['FROM service_deploy_bindings', new Error('connection reset by peer 10.0.0.7')]]);
  const { status, body } = await ficha(pool);
  assert.equal(status, 200);
  assert.deepEqual(body.deploys, { available: false, reason: _internals.MOTIVOS.falha });
  assert.ok(!JSON.stringify(body).includes('10.0.0.7'));
 });

 await t.test('a própria empresa não é seção: falha ao ler a empresa propaga', async () => {
  await assert.rejects(() => ficha(poolFalso([['FROM tenants', erroPg('57P01')]])), e => e.code === '57P01');
 });
});

test('Ficha da empresa: nada além do que as telas já mostram', () => {
 // Pessoas: os campos do /api/overview. Leads: sem contato nem hash. Acesso: contado.
 const proibidos = /\b(email|phone|whatsapp|message|privacy|request_hash|token_hash|token|subject|acceptance_reference|scope)\b/;
 for (const [nome, sql] of Object.entries(_internals.SQL)) assert.doesNotMatch(sql, proibidos, nome);
});

test('Ficha da empresa: somente leitura', () => {
 for (const [nome, sql] of Object.entries(_internals.SQL))
  assert.doesNotMatch(sql, /\b(INSERT|UPDATE|DELETE|FOR UPDATE)\b/i, nome);
});

test('Ficha da empresa: sem sessão de operador o roteador recusa antes do handler', async () => {
 const pool = { query: async () => assert.fail('sem sessão não se consulta o banco'), connect: async () => assert.fail('sem sessão não se abre conexão') };
 const server = createCore({ pool, adminPassword: 'senha-sintetica-do-teste-unitario-1234' });
 await new Promise(r => server.listen(0, '127.0.0.1', r));
 const origin = `http://127.0.0.1:${server.address().port}`;
 try {
  for (const headers of [{}, { cookie: 'core_session=' + 'a'.repeat(43) }, { authorization: 'Bearer ' + 'b'.repeat(43) }]) {
   const r = await fetch(`${origin}/api/tenants/${TENANT}/summary`, { headers });
   assert.equal(r.status, 401, JSON.stringify(headers));
  }
  // Rota só de leitura: outro método não chega a nada.
  const post = await fetch(`${origin}/api/tenants/${TENANT}/summary`, { method: 'POST', headers: { origin } });
  assert.equal(post.status, 401);
 } finally {
  server.closeAllConnections();
  await new Promise(r => server.close(r));
 }
});
