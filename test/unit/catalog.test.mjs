import test from 'node:test';
import assert from 'node:assert/strict';
import { listProducts, findProduct } from '../../apps/api/src/modules/catalog.mjs';

test('catalog only exposes active products', async () => {
 const queries = [];
 const client = { query: async (sql, params) => {
  queries.push([sql, params]);
  return { rows: sql.includes('ORDER BY name') ? [{ id: 'sites', name: 'TZOLKIN Sites' }] : [] };
 }};
 assert.deepEqual((await listProducts(client)).rows, [{ id: 'sites', name: 'TZOLKIN Sites' }]);
 assert.equal(await findProduct(client, 'project-draft'), null);
 assert.match(queries[0][0], /lifecycle_status='active'/);
 assert.match(queries[1][0], /lifecycle_status='active'/);
});
