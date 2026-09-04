import test from 'node:test';
import assert from 'node:assert/strict';
import { productResourceBindingRoutes } from '../../apps/api/src/modules/product-resource-bindings.mjs';

const binding = {
 id: '11111111-1111-4111-8111-111111111111', product_id: 'skiller', resource_type: 'domain',
 provider: 'hostinger', external_id: 'skiller.tzolkin.cloud', display_name: 'skiller.tzolkin.cloud',
 environment: 'production', url: 'https://skiller.tzolkin.cloud', created_at: new Date(), updated_at: new Date(),
};

function routes() {
 const handlers = {};
 const router = {
  get(path, fn) { handlers[`GET ${path}`] = fn; },
  put(path, fn) { handlers[`PUT ${path}`] = fn; },
  delete(path, fn) { handlers[`DELETE ${path}`] = fn; },
 };
 productResourceBindingRoutes(router);
 return handlers;
}

test('lista conexões com recorte opcional por produto', async () => {
 const handler = routes()['GET /api/product-resource-bindings'];
 let query, output;
 await handler({
  pool: { query: async (...args) => { query = args; return { rows: [binding] }; } },
  url: { searchParams: new URLSearchParams('product_id=skiller') },
  reply: (status, body) => { output = { status, body }; },
 });
 assert.equal(query[1][0], 'skiller');
 assert.deepEqual(output, { status: 200, body: { bindings: [binding] } });
});

test('confirma conexão de produto e grava auditoria do operador', async () => {
 const handler = routes()['PUT /api/product-resource-bindings'];
 const queries = [];
 const client = { query: async (sql, values) => {
  queries.push({ sql, values });
  if (sql.startsWith('SELECT id,name FROM products')) return { rows: [{ id: 'skiller' }] };
  if (sql.startsWith('INSERT INTO product_resource_bindings')) return { rows: [binding] };
  return { rows: [] };
 } };
 const result = await handler({ client, body: {
  product_id: 'skiller', resource_type: 'domain', provider: 'hostinger', external_id: 'skiller.tzolkin.cloud',
  display_name: 'skiller.tzolkin.cloud', environment: 'production', url: 'https://skiller.tzolkin.cloud',
 }, operator: { email: 'ops@tzolkin.com' } });
 assert.equal(result.type, 'product.resource.created');
 assert.equal(queries.at(-1).values[3], 'ops@tzolkin.com');
 assert.equal(queries.at(-1).values[2], 'created');
});

test('remove conexão somente por id válido e preserva trilha de auditoria', async () => {
 const handler = routes()['DELETE /api/product-resource-bindings/:id'];
 const queries = [];
 const client = { query: async (sql, values) => {
  queries.push({ sql, values });
  if (sql.includes('FOR UPDATE')) return { rows: [binding] };
  return { rows: [] };
 } };
 const result = await handler({ client, params: { id: binding.id }, operator: { subject: 'google:ops' } });
 assert.equal(result.type, 'product.resource.deleted');
 assert.ok(queries.some(item => item.sql.startsWith('DELETE FROM product_resource_bindings')));
 assert.equal(queries.at(-1).values[2], 'deleted');
});

test('recusa URL sem HTTPS', async () => {
 const handler = routes()['PUT /api/product-resource-bindings'];
 await assert.rejects(() => handler({ client: {}, body: {
  product_id: 'skiller', resource_type: 'domain', provider: 'hostinger', external_id: 'skiller.tzolkin.cloud',
  display_name: 'Skiller', environment: 'production', url: 'http://skiller.tzolkin.cloud',
 } }), error => error.status === 400 && /HTTPS/.test(error.message));
});

test('não transfere silenciosamente um recurso confirmado para outro produto', async () => {
 const handler = routes()['PUT /api/product-resource-bindings'];
 const client = { query: async sql => {
  if (sql.startsWith('SELECT id,name FROM products')) return { rows: [{ id: 'educare' }] };
  if (sql.includes('resource_type=$1')) return { rows: [binding] };
  throw new Error('A escrita não deveria ser executada.');
 } };
 await assert.rejects(() => handler({ client, body: {
  product_id: 'educare', resource_type: 'domain', provider: 'hostinger', external_id: 'skiller.tzolkin.cloud',
  display_name: 'skiller.tzolkin.cloud', environment: 'production', url: 'https://skiller.tzolkin.cloud',
 } }), error => error.status === 409 && /outro produto/.test(error.message));
});
