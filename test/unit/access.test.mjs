import test from 'node:test';
import assert from 'node:assert/strict';
import { accessRoutes } from '../../apps/api/src/modules/access.mjs';

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
   assert.deepEqual(values, [tenant, 'person', 'sites']);
   return { rowCount: 1, rows: [{ plan: 'test', rights: ['read'], version: 1 }] };
  } },
  url: new URL(`http://localhost/v1/context?tenant_id=${tenant}&subject=person`),
  productId: 'sites',
  reply(status, body) {
   assert.equal(status, 200);
   assert.equal(body.membership_scope, 'product');
   assert.equal(body.product_id, 'sites');
  },
 });
});
