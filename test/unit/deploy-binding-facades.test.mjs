// As duas fachadas legadas de deploy: mesmo contrato de resposta de sempre,
// gravando no registro único.
//
// O que estes testes protegem:
//  1. as chaves da resposta não mudam — uma aba aberta com o app.js antigo lista
//     e vincula como sempre fez;
//  2. a leitura passou para product_resource_bindings, só o que está ativo;
//  3. a escrita também, com trilha — e nenhuma das duas toca mais nas tabelas
//     antigas, que ficam como espelho velho até o dono decidir se saem;
//  4. a recusa que a tela de hoje conhece continua a mesma (contratação
//     inexistente é 400; contratação arquivada continua aceitando vínculo);
//  5. vincular um projeto que já tem dono não troca o dono em silêncio.
import test from 'node:test';
import assert from 'node:assert/strict';
import { productDeployBindingRoutes } from '../../apps/api/src/modules/product-deploy-bindings.mjs';
import { serviceDeployBindingRoutes } from '../../apps/api/src/modules/service-deploy-bindings.mjs';

const CONTRATACAO = '33333333-3333-4333-8333-333333333333';
const BOOT = { subject: 'local-bootstrap' };
const MOMENTO = new Date('2026-09-24T17:02:16.454Z');

const conexao = (extra = {}) => ({
 id: '11111111-1111-4111-8111-111111111111', product_id: 'skiller', engagement_id: null,
 resource_type: 'frontend', provider: 'vercel', external_id: 'prj_abc123', external_id_kind: 'provider_id',
 display_name: 'skiller-frontend', environment: 'production', url: null, active: true,
 deactivated_at: null, unbind_reason: null, revision: 1, actor_subject: null, actor_email: null,
 created_at: MOMENTO, updated_at: MOMENTO, ...extra,
});

function rotas(registrar) {
 const handlers = {};
 registrar({
  get(path, fn) { handlers[`GET ${path}`] = fn; },
  put(path, fn) { handlers[`PUT ${path}`] = fn; },
 });
 return handlers;
}

function cliente({ produto = { id: 'skiller' }, contratacao = { id: CONTRATACAO }, existente = null, papel = null } = {}) {
 const queries = [];
 return { queries, query: async (sql, values = []) => {
  queries.push({ sql, values });
  if (sql.startsWith('SELECT role FROM operator_accounts')) return { rows: papel ? [{ role: papel }] : [] };
  if (sql.startsWith('SELECT id,name FROM products')) return { rows: produto ? [produto] : [] };
  if (sql.startsWith('SELECT id FROM client_engagements')) return { rows: contratacao ? [contratacao] : [], rowCount: contratacao ? 1 : 0 };
  if (sql.startsWith('SELECT * FROM product_resource_bindings')) return { rows: existente ? [existente] : [] };
  if (sql.startsWith('INSERT INTO product_resource_bindings')) return { rows: [conexao({
   product_id: values[0], engagement_id: values[1], resource_type: values[2], provider: values[3],
   external_id: values[4], external_id_kind: values[5], display_name: values[6], environment: values[7] })] };
  if (sql.startsWith('UPDATE product_resource_bindings')) return { rows: [conexao({ product_id: values[1], engagement_id: values[2] })] };
  if (sql.startsWith('INSERT INTO product_resource_audit')) return { rows: [] };
  assert.fail(`SQL inesperado: ${sql}`);
 } };
}

const escrita = client => client.queries.find(q => /^(INSERT INTO|UPDATE) product_resource_bindings/.test(q.sql));

test('as duas listagens leem o registro único, só o que está ativo, com as chaves de sempre', async () => {
 const casos = [
  [productDeployBindingRoutes, 'GET /api/product-deploy-bindings',
   { provider: 'vercel', external_project_id: 'prj_abc123', external_project_name: 'skiller-frontend', product_id: 'skiller', environment: 'production', updated_at: MOMENTO }],
  [serviceDeployBindingRoutes, 'GET /api/service-deploy-bindings',
   { provider: 'vercel', external_project_id: 'prj_abc123', external_project_name: 'site do cliente', engagement_id: CONTRATACAO,
     environment: 'production', updated_at: MOMENTO, label: 'Assessoria', service_model: 'advisory', status: 'active',
     tenant_id: '10000000-0000-4000-8000-000000000001', tenant_name: 'Empresa A' }],
 ];
 for (const [registrar, rota, linha] of casos) {
  let sql, saida;
  await rotas(registrar)[rota]({
   pool: { query: async texto => { sql = texto; return { rows: [linha] }; } },
   url: { searchParams: new URLSearchParams() },
   reply: (status, body) => { saida = { status, body }; },
  });
  assert.match(sql, /FROM product_resource_bindings/, rota);
  assert.match(sql, /active/, `${rota}: conexão desligada não é vínculo vivo`);
  assert.doesNotMatch(sql, /deploy_bindings/, `${rota}: a tabela antiga saiu da leitura`);
  assert.deepEqual(saida, { status: 200, body: { bindings: [linha] } }, rota);
 }
});

test('vincular pela tela antiga grava no registro único, com o tipo e o id certos', async () => {
 const client = cliente();
 const saida = await rotas(productDeployBindingRoutes)['PUT /api/product-deploy-bindings']({
  client, operator: BOOT,
  body: { provider: 'vercel', external_project_id: 'prj_abc123', external_project_name: 'skiller-frontend', product_id: 'skiller', environment: 'production' },
 });
 assert.equal(saida.type, 'product.deploy_binding.saved', 'o tipo do evento não muda');
 const gravou = escrita(client);
 assert.ok(gravou.sql.startsWith('INSERT INTO product_resource_bindings'));
 assert.deepEqual(gravou.values.slice(0, 8), ['skiller', null, 'frontend', 'vercel', 'prj_abc123', 'provider_id', 'skiller-frontend', 'production']);
 assert.ok(client.queries.some(q => q.sql.startsWith('INSERT INTO product_resource_audit')), 'a tela antiga gravava sem trilha; agora deixa trilha');
});

test('vínculo de contratação: easypanel vira backend e id igual ao nome é id nominal', async () => {
 const client = cliente();
 await rotas(serviceDeployBindingRoutes)['PUT /api/service-deploy-bindings']({
  client, operator: BOOT,
  body: { provider: 'easypanel', external_project_id: 'designer', external_project_name: 'designer', engagement_id: CONTRATACAO, environment: 'production' },
 });
 const gravou = escrita(client);
 assert.deepEqual(gravou.values.slice(0, 7), [null, CONTRATACAO, 'backend', 'easypanel', 'designer', 'name', 'designer']);
});

test('a recusa que a tela de hoje conhece continua a mesma', async () => {
 // Contratação inexistente é 400 aqui (a rota nova responde 404), e contratação
 // ARQUIVADA continua aceitando vínculo: posse não é estado de operação.
 await assert.rejects(() => rotas(serviceDeployBindingRoutes)['PUT /api/service-deploy-bindings']({
  client: cliente({ contratacao: null }), operator: BOOT,
  body: { provider: 'vercel', external_project_id: 'prj_abc123', external_project_name: 'site', engagement_id: CONTRATACAO, environment: 'production' },
 }), e => e.status === 400 && /Contratação não encontrada/.test(e.message));

 await assert.rejects(() => rotas(productDeployBindingRoutes)['PUT /api/product-deploy-bindings']({
  client: cliente({ produto: null }), operator: BOOT,
  body: { provider: 'vercel', external_project_id: 'prj_abc123', external_project_name: 'site', product_id: 'fantasma', environment: 'production' },
 }), e => e.status === 400 && /Produto não encontrado ou arquivado/.test(e.message));

 for (const [registrar, rota, body] of [
  [productDeployBindingRoutes, 'PUT /api/product-deploy-bindings', { provider: 'render', external_project_id: 'x', external_project_name: 'x', product_id: 'skiller', environment: 'production' }],
  [serviceDeployBindingRoutes, 'PUT /api/service-deploy-bindings', { provider: 'vercel', external_project_id: 'x', external_project_name: 'x', engagement_id: 'nao-e-uuid', environment: 'production' }],
 ]) await assert.rejects(() => rotas(registrar)[rota]({ client: cliente(), operator: BOOT, body }), e => e.status === 400, rota);
});

test('projeto que já tem dono não troca de dono em silêncio', async () => {
 const client = cliente({ existente: conexao({ product_id: null, engagement_id: CONTRATACAO }) });
 await assert.rejects(() => rotas(productDeployBindingRoutes)['PUT /api/product-deploy-bindings']({
  client, operator: BOOT,
  body: { provider: 'vercel', external_project_id: 'prj_abc123', external_project_name: 'skiller-frontend', product_id: 'skiller', environment: 'production' },
 }), e => e.status === 409 && /Reatribuir/.test(e.message));
 assert.equal(escrita(client), undefined, 'o 409 não pode gravar');
});

test('vincular pelas fachadas exige permissão de escrita', async () => {
 for (const [registrar, rota, body] of [
  [productDeployBindingRoutes, 'PUT /api/product-deploy-bindings', { provider: 'vercel', external_project_id: 'prj_abc123', external_project_name: 'site', product_id: 'skiller', environment: 'production' }],
  [serviceDeployBindingRoutes, 'PUT /api/service-deploy-bindings', { provider: 'vercel', external_project_id: 'prj_abc123', external_project_name: 'site', engagement_id: CONTRATACAO, environment: 'production' }],
 ]) {
  const client = cliente({ papel: 'viewer' });
  await assert.rejects(() => rotas(registrar)[rota]({ client, operator: { subject: 'google:2', email: 'leitor@tzolkin.test' }, body }),
   e => e.status === 403, rota);
  assert.equal(escrita(client), undefined, rota);
 }
});
