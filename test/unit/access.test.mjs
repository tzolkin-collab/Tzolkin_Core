import test from 'node:test';
import assert from 'node:assert/strict';
import { accessRoutes, authenticateApp } from '../../apps/api/src/modules/access.mjs';

test('access response declares the product membership scope', async () => {
 let handler;
 accessRoutes({ get(path, callback, options) {
  assert.equal(path, '/v1/context');
  assert.equal(options.auth, 'service');
  handler = callback;
 } });
 const tenant = '12345678-1234-4234-8234-123456789012';
 await handler({
  pool: { async query(sql, values) {
   assert.match(sql, /m.product_id=e.product_id/);
   assert.match(sql, /portfolio_kind=ANY\(\$4/);
   // Só tipos que dão acesso: linha de serviço e item interno nunca respondem 200.
   assert.deepEqual(values, [tenant, 'person', 'skiller', ['product', 'platform']]);
   return { rowCount: 1, rows: [{ plan: 'test', rights: ['read'], version: 1 }] };
  } },
  url: new URL(`http://localhost/v1/context?tenant_id=${tenant}&subject=person`),
  productId: 'skiller',
  reply(status, body) {
   assert.equal(status, 200);
   assert.equal(body.membership_scope, 'product');
   assert.equal(body.product_id, 'skiller');
  },
 });
});

test('app key is authenticated against the kinds its scope requires', async () => {
 const calls = [];
 const pool = { query: async (sql, values) => { calls.push({ sql, values }); return { rows: [{ product_id: 'sites' }] }; } };
 await authenticateApp(pool, 'token-de-teste', 'context:read');
 await authenticateApp(pool, 'token-de-teste', 'commercial:intake');
 assert.match(calls[0].sql, /portfolio_kind=ANY\(\$3/);
 assert.deepEqual(calls[0].values.slice(1), ['context:read', ['product', 'platform']]);
 assert.deepEqual(calls[1].values.slice(1), ['commercial:intake', ['product', 'platform', 'service_line']]);
 // Escopo que não existe não chega ao banco.
 assert.equal(await authenticateApp({ query: async () => assert.fail('não deveria consultar') }, 'token-de-teste', 'admin'), null);
});
