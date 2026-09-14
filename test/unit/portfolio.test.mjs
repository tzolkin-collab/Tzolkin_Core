// Portfólio e contratações sem banco: roteador falso, cliente falso.
//
// O que estes testes protegem, em ordem de custo de errar:
//  1. nada que apague ou corte acesso passa sem checagem (arquivar, voltar a rascunho);
//  2. edição concorrente não sobrescreve em silêncio (revisão);
//  3. validação barata vem antes de consulta ao banco;
//  4. quem só lê não escreve, e só administrador arquiva.
import test from 'node:test';
import assert from 'node:assert/strict';
import { portfolioRoutes, _internals } from '../../apps/api/src/modules/portfolio.mjs';

const BOOT = { subject: 'local-bootstrap' };
const TENANT = '10000000-0000-4000-8000-000000000001';
const CONTRATACAO = '30000000-0000-4000-8000-000000000003';

function rotas() {
 const mapa = new Map();
 const registrar = metodo => (caminho, handler) => mapa.set(`${metodo} ${caminho}`, handler);
 portfolioRoutes({ get: registrar('GET'), post: registrar('POST'), put: registrar('PUT') });
 return mapa;
}

// Cliente falso roteado por trecho de SQL. `respostas` é uma lista [trecho, linhas|função].
function clienteFalso(respostas = []) {
 const chamadas = [];
 return {
  chamadas,
  query: async (sql, params) => {
   chamadas.push({ sql, params });
   for (const [trecho, resposta] of respostas) {
    if (sql.includes(trecho)) {
     const linhas = typeof resposta === 'function' ? resposta(sql, params) : resposta;
     return { rows: linhas, rowCount: linhas.length };
    }
   }
   return { rows: [], rowCount: 0 };
  },
 };
}

const semBanco = () => ({ query: async () => assert.fail('o banco não deveria ser consultado') });

const item = (extra = {}) => ({
 id: 'consultoria-dados', name: 'Consultoria de dados', portfolio_kind: 'service_line', brand_family: 'tzolkin',
 lifecycle_status: 'active', revision: 3, archived_at: null, archived_from: null, ...extra,
});

const semDependentes = { contratos: 0, acessos: 0, chaves: 0, contratos_comerciais: 0, contratacoes: 0 };

test('Portfólio: criar', async t => {
 const criar = rotas().get('POST /api/portfolio');

 await t.test('nasce rascunho e deixa trilha', async () => {
  const client = clienteFalso([
   ['INSERT INTO products', (_, p) => [{ id: p[0], name: p[1], portfolio_kind: p[2], brand_family: p[3], lifecycle_status: 'draft', revision: 1 }]],
  ]);
  const r = await criar({ client, operator: BOOT, body: { id: 'consultoria-dados', name: 'Consultoria de dados', portfolio_kind: 'service_line' } });
  assert.equal(r.type, 'portfolio.created');
  assert.equal(r.body.lifecycle_status, 'draft', 'item novo não entra em venda sem decisão');
  assert.match(client.chamadas[0].sql, /'draft'/);
  assert.deepEqual(client.chamadas[0].params, ['consultoria-dados', 'Consultoria de dados', 'service_line', 'tzolkin']);
  assert.match(client.chamadas[1].sql, /INSERT INTO portfolio_audit/);
  assert.equal(client.chamadas[1].params[0], 'product');
  assert.equal(client.chamadas[1].params[2], 'created');
 });

 await t.test('entrada inválida é recusada antes de tocar o banco', async () => {
  for (const body of [
   { id: 'Maiusculo', name: 'Item', portfolio_kind: 'product' },
   { id: '1comeca-com-numero', name: 'Item', portfolio_kind: 'product' },
   { id: 'valido', name: 'Item', portfolio_kind: 'business_unit' },
   { id: 'valido', name: 'I', portfolio_kind: 'product' },
   { id: 'valido', name: 'Item', portfolio_kind: 'product', brand_family: 'Família Com Espaço' },
   { id: 'valido', name: 'Item', portfolio_kind: 'product', lifecycle_status: 'active' },
  ]) {
   await assert.rejects(() => criar({ client: semBanco(), operator: BOOT, body }), e => e.status === 400, JSON.stringify(body));
  }
 });

 await t.test('quem só lê não cria', async () => {
  const client = clienteFalso([['FROM operator_accounts', [{ role: 'viewer' }]]]);
  await assert.rejects(
   () => criar({ client, operator: { email: 'leitura@tzolkin.test' }, body: { id: 'x-item', name: 'Item', portfolio_kind: 'product' } }),
   e => e.status === 403);
 });
});

test('Portfólio: editar', async t => {
 const editar = rotas().get('PUT /api/portfolio/:id');

 await t.test('revisão velha vira 409, não sobrescreve', async () => {
  const client = clienteFalso([['FROM products WHERE id=$1 FOR UPDATE', [item({ revision: 4 })]]]);
  await assert.rejects(
   () => editar({ client, operator: BOOT, params: { id: 'consultoria-dados' }, body: { name: 'Novo nome', portfolio_kind: 'service_line', revision: 3 } }),
   e => e.status === 409 && /outra pessoa/.test(e.message));
  assert.ok(!client.chamadas.some(c => c.sql.startsWith('UPDATE')), 'nada pode ser gravado');
 });

 await t.test('item arquivado não é editado', async () => {
  const client = clienteFalso([['FOR UPDATE', [item({ lifecycle_status: 'archived', archived_at: new Date(), archived_from: 'active' })]]]);
  await assert.rejects(
   () => editar({ client, operator: BOOT, params: { id: 'consultoria-dados' }, body: { name: 'Novo nome', portfolio_kind: 'service_line', revision: 3 } }),
   e => e.status === 409 && /Restaure/.test(e.message));
 });

 await t.test('o identificador não é editável', async () => {
  await assert.rejects(
   () => editar({ client: semBanco(), operator: BOOT, params: { id: 'consultoria-dados' }, body: { id: 'outro-id', name: 'Nome', portfolio_kind: 'service_line', revision: 3 } }),
   e => e.status === 400);
 });

 await t.test('edição válida sobe a revisão e registra antes e depois', async () => {
  const antes = item();
  const client = clienteFalso([
   ['FOR UPDATE', [antes]],
   ['UPDATE products', (_, p) => [{ ...antes, name: p[1], portfolio_kind: p[2], revision: 4 }]],
  ]);
  const r = await editar({ client, operator: BOOT, params: { id: 'consultoria-dados' }, body: { name: 'Dados e BI', portfolio_kind: 'product', revision: 3 } });
  assert.equal(r.body.revision, 4);
  assert.match(client.chamadas[1].sql, /revision=revision\+1/);
  const trilha = client.chamadas.find(c => c.sql.includes('portfolio_audit'));
  assert.equal(trilha.params[2], 'updated');
  assert.equal(trilha.params[3].name, 'Consultoria de dados', 'antes');
  assert.equal(trilha.params[4].name, 'Dados e BI', 'depois');
 });
});

test('Portfólio: arquivar e restaurar', async t => {
 const r = rotas();
 const arquivar = r.get('POST /api/portfolio/:id/archive');
 const restaurar = r.get('POST /api/portfolio/:id/restore');

 await t.test('bloqueia com dependente vivo e diz qual', async () => {
  const client = clienteFalso([
   ['FOR UPDATE', [item()]],
   ['AS contratos', [{ ...semDependentes, contratos: 2, contratacoes: 1 }]],
  ]);
  await assert.rejects(
   () => arquivar({ client, operator: BOOT, params: { id: 'consultoria-dados' }, body: { revision: 3 } }),
   e => e.status === 409 && /contratos de produto ativos: 2/.test(e.message) && /contratações em curso: 1/.test(e.message));
  assert.ok(!client.chamadas.some(c => c.sql.startsWith('UPDATE')));
 });

 await t.test('o próprio Core não é arquivado', async () => {
  const client = clienteFalso([['FOR UPDATE', [item({ id: 'core', portfolio_kind: 'platform' })]]]);
  await assert.rejects(
   () => arquivar({ client, operator: BOOT, params: { id: 'core' }, body: { revision: 3 } }),
   e => e.status === 409 && /Core/.test(e.message));
 });

 await t.test('arquivar guarda o estado anterior; restaurar volta a ele', async () => {
  const client = clienteFalso([
   ['FOR UPDATE', [item({ lifecycle_status: 'draft' })]],
   ['AS contratos', [semDependentes]],
   ['UPDATE products', [item({ lifecycle_status: 'archived', archived_from: 'draft', archived_at: new Date(), revision: 4 })]],
  ]);
  await arquivar({ client, operator: BOOT, params: { id: 'consultoria-dados' }, body: { revision: 3 } });
  const update = client.chamadas.find(c => c.sql.startsWith('UPDATE'));
  assert.match(update.sql, /archived_from=lifecycle_status/, 'lado direito do UPDATE lê a linha antiga');

  const client2 = clienteFalso([
   ['FOR UPDATE', [item({ lifecycle_status: 'archived', archived_from: 'draft', archived_at: new Date(), revision: 4 })]],
   ['UPDATE products', [item({ lifecycle_status: 'draft', revision: 5 })]],
  ]);
  const volta = await restaurar({ client: client2, operator: BOOT, params: { id: 'consultoria-dados' }, body: { revision: 4 } });
  assert.match(client2.chamadas.find(c => c.sql.startsWith('UPDATE')).sql, /lifecycle_status=archived_from/);
  assert.equal(volta.body.lifecycle_status, 'draft', 'rascunho arquivado não volta ativo');
 });

 await t.test('membro edita, mas não arquiva', async () => {
  const client = clienteFalso([['FROM operator_accounts', [{ role: 'member' }]]]);
  await assert.rejects(
   () => arquivar({ client, operator: { email: 'membro@tzolkin.test' }, params: { id: 'consultoria-dados' }, body: { revision: 3 } }),
   e => e.status === 403);
 });
});

test('Portfólio: rascunho e ativo', async t => {
 const estado = rotas().get('POST /api/portfolio/:id/lifecycle');

 await t.test('item com projeto técnico é ativado pelo checklist, não por aqui', async () => {
  const client = clienteFalso([
   ['FOR UPDATE', [item({ lifecycle_status: 'draft' })]],
   ['FROM delivery_projects', [{ '?column?': 1 }]],
  ]);
  await assert.rejects(
   () => estado({ client, operator: BOOT, params: { id: 'consultoria-dados' }, body: { lifecycle_status: 'active', revision: 3 } }),
   e => e.status === 409 && /checklist/.test(e.message));
 });

 await t.test('voltar a rascunho também exige ninguém dependendo', async () => {
  const client = clienteFalso([
   ['FOR UPDATE', [item()]],
   ['AS contratos', [{ ...semDependentes, acessos: 3 }]],
  ]);
  await assert.rejects(
   () => estado({ client, operator: BOOT, params: { id: 'consultoria-dados' }, body: { lifecycle_status: 'draft', revision: 3 } }),
   e => e.status === 409 && /vínculos de acesso ativos: 3/.test(e.message));
 });

 await t.test('arquivado não muda de estado sem restaurar', async () => {
  const client = clienteFalso([['FOR UPDATE', [item({ lifecycle_status: 'archived', archived_from: 'active', archived_at: new Date() })]]]);
  await assert.rejects(
   () => estado({ client, operator: BOOT, params: { id: 'consultoria-dados' }, body: { lifecycle_status: 'active', revision: 3 } }),
   e => e.status === 409);
 });
});

test('Contratações', async t => {
 const r = rotas();
 const criar = r.get('POST /api/engagements');
 const editar = r.get('PUT /api/engagements/:id');
 const arquivar = r.get('POST /api/engagements/:id/archive');
 const base = { tenant_id: TENANT, product_id: null, service_model: 'advisory', status: 'active', label: 'Assessoria mensal' };

 await t.test('categorias antigas e tipos fora da lista são recusados antes do banco', async () => {
  for (const service_model of ['subscription', 'mentorship', 'saas']) {
   await assert.rejects(() => criar({ client: semBanco(), operator: BOOT, body: { ...base, service_model } }), e => e.status === 400);
  }
 });

 await t.test('contratação do tipo produto exige o produto, antes do banco', async () => {
  await assert.rejects(
   () => criar({ client: semBanco(), operator: BOOT, body: { ...base, service_model: 'product', product_id: null } }),
   e => e.status === 400 && /precisa indicar o produto/.test(e.message));
 });

 await t.test('nome repetido na mesma empresa vira 409, não sobrescreve outra', async () => {
  const client = {
   query: async sql => {
    if (sql.startsWith('INSERT INTO client_engagements')) throw Object.assign(new Error('duplicate'), { code: '23505' });
    return { rows: [], rowCount: 0 };
   },
  };
  await assert.rejects(() => criar({ client, operator: BOOT, body: base }), e => e.status === 409 && /já tem uma contratação/.test(e.message));
 });

 await t.test('criar grava e deixa trilha com a empresa como tenant', async () => {
  const client = clienteFalso([
   ['SELECT id,name FROM products', [{ id: 'barber', name: 'TZOLKIN Barber' }]],
   ['INSERT INTO client_engagements', (_, p) => [{ id: CONTRATACAO, tenant_id: p[0], product_id: p[1], service_model: p[2], status: p[3], label: p[4], revision: 1 }]],
  ]);
  const res = await criar({ client, operator: BOOT, body: { ...base, service_model: 'product', product_id: 'barber', label: 'TZOLKIN Barber' } });
  assert.equal(res.type, 'engagement.created');
  assert.equal(res.tenant, TENANT, 'audit_events do app.mjs precisa do tenant');
  assert.ok(!client.chamadas.some(c => /ON CONFLICT/.test(c.sql)), 'o upsert por rótulo acabou');
  assert.equal(client.chamadas.find(c => c.sql.includes('portfolio_audit')).params[0], 'engagement');
 });

 await t.test('editar com revisão velha vira 409', async () => {
  const client = clienteFalso([['FROM client_engagements WHERE id=$1 FOR UPDATE', [{ id: CONTRATACAO, tenant_id: TENANT, product_id: null, service_model: 'advisory', status: 'active', label: 'Assessoria', revision: 7, archived_at: null }]]]);
  await assert.rejects(
   () => editar({ client, operator: BOOT, params: { id: CONTRATACAO }, body: { product_id: null, service_model: 'advisory', status: 'completed', label: 'Assessoria', revision: 6 } }),
   e => e.status === 409 && /outra pessoa/.test(e.message));
 });

 await t.test('produto que não mudou não é reconferido: contratação antiga segue editável', async () => {
  const antes = { id: CONTRATACAO, tenant_id: TENANT, product_id: 'produto-antigo', service_model: 'product', status: 'active', label: 'Venda antiga', revision: 2, archived_at: null };
  const client = clienteFalso([
   ['FOR UPDATE', [antes]],
   ['UPDATE client_engagements', [{ ...antes, status: 'completed', revision: 3 }]],
  ]);
  const res = await editar({ client, operator: BOOT, params: { id: CONTRATACAO }, body: { product_id: 'produto-antigo', service_model: 'product', status: 'completed', label: 'Venda antiga', revision: 2 } });
  assert.equal(res.body.status, 'completed');
  assert.ok(!client.chamadas.some(c => c.sql.startsWith('SELECT id,name FROM products')), 'não consulta disponibilidade de produto inalterado');
 });

 await t.test('a empresa da contratação não é editável', async () => {
  await assert.rejects(
   () => editar({ client: semBanco(), operator: BOOT, params: { id: CONTRATACAO }, body: { tenant_id: TENANT, service_model: 'advisory', status: 'active', label: 'X', revision: 1 } }),
   e => e.status === 400);
 });

 await t.test('arquivar não muda a situação da contratação', async () => {
  const antes = { id: CONTRATACAO, tenant_id: TENANT, product_id: null, service_model: 'on_demand', status: 'completed', label: 'Projeto', revision: 1, archived_at: null };
  const client = clienteFalso([
   ['FOR UPDATE', [antes]],
   ['UPDATE client_engagements', [{ ...antes, archived_at: new Date(), revision: 2 }]],
  ]);
  const res = await arquivar({ client, operator: BOOT, params: { id: CONTRATACAO }, body: { revision: 1 } });
  const update = client.chamadas.find(c => c.sql.startsWith('UPDATE'));
  assert.ok(!/status=/.test(update.sql), 'situação de negócio fica como estava');
  assert.equal(res.body.status, 'completed');
  assert.equal(res.type, 'engagement.archived');
 });

 await t.test('só administrador arquiva contratação', async () => {
  const client = clienteFalso([['FROM operator_accounts', [{ role: 'member' }]]]);
  await assert.rejects(
   () => arquivar({ client, operator: { email: 'membro@tzolkin.test' }, params: { id: CONTRATACAO }, body: { revision: 1 } }),
   e => e.status === 403);
 });
});

test('Mensagem de dependentes lista só o que está vivo', () => {
 assert.doesNotThrow(() => _internals.exigirSemDependentes(semDependentes, 'arquivar'));
 assert.throws(
  () => _internals.exigirSemDependentes({ ...semDependentes, chaves: 1 }, 'arquivar'),
  e => e.status === 409 && /chaves de integração ativas: 1/.test(e.message) && !/contratos de produto/.test(e.message));
});
