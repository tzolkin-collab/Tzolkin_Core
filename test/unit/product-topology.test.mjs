import test from 'node:test';
import assert from 'node:assert/strict';
import { productTopologyRoutes } from '../../apps/api/src/modules/product-topology.mjs';

test('topologia correlaciona evidências reais por produto sem gravar uma associação implícita', async () => {
 let handler;
 productTopologyRoutes({ get(path, fn) { assert.equal(path, '/api/products/topology'); handler = fn; } }, {
  options: async () => ({
   github: { status: 'ok', items: [{ id: '1', name: 'tzolkin/skiller', default_branch: 'main' }] },
   vercel: { status: 'ok', items: [{ id: 'v1', name: 'skiller-frontend', type: 'app', repository: 'tzolkin/skiller' }] },
   easypanel: { status: 'ok', items: [{ id: 'other/skiller', name: 'other / skiller', type: 'app' }] },
  }),
  dns: { readZone: async () => ({ status: 'ok', zone: 'tzolkin.cloud', records: [{ name: 'skiller', type: 'CNAME', ttl: 60, records: [{ disabled: false }] }] }) },
 });
 const queries = [
  { rows: [{ id: 'skiller', name: 'TZOLKIN Skiller', lifecycle_status: 'active' }] },
  { rows: [] },
  { rows: [] },
  { rows: [{ product_id: 'skiller', provider: 'stripe', total: 1 }] },
  { rows: [] },
 ];
 let output;
 await handler({ pool: { query: async () => queries.shift() }, url: { searchParams: new URLSearchParams() }, reply: (_status, body) => { output = body; } });
 const skiller = output.products[0];
 assert.deepEqual(skiller.connections.frontend, [{ provider: 'vercel', id: 'v1', name: 'skiller-frontend', repository: 'tzolkin/skiller', source: 'detected', confidence: 'high' }]);
 assert.equal(skiller.connections.backend[0].id, 'other/skiller');
 assert.equal(skiller.connections.repositories.length, 1);
 assert.equal(skiller.connections.repositories[0].name, 'tzolkin/skiller');
 assert.equal(skiller.connections.domains[0].name, 'skiller.tzolkin.cloud');
 assert.deepEqual(skiller.connections.checkout, [{ provider: 'stripe', offers: 1, source: 'configured' }]);
 assert.deepEqual(skiller.connections.emails, []);
});

test('topologia avisa quando uma conexão confirmada desaparece do inventário', async () => {
 let handler;
 productTopologyRoutes({ get(_path, fn) { handler = fn; } }, {
  options: async () => ({ github: { status: 'ok', items: [] }, vercel: { status: 'ok', items: [] }, easypanel: { status: 'ok', items: [] } }),
  dns: { readZone: async () => ({ status: 'ok', zone: 'tzolkin.cloud', records: [] }) },
 });
 const queries = [
  { rows: [{ id: 'skiller', name: 'TZOLKIN Skiller', lifecycle_status: 'active' }] },
  { rows: [] },
  { rows: [{ id: '11111111-1111-4111-8111-111111111111', product_id: 'skiller', resource_type: 'domain', provider: 'hostinger', external_id: 'skiller.tzolkin.cloud', display_name: 'skiller.tzolkin.cloud', environment: 'production', url: 'https://skiller.tzolkin.cloud' }] },
  { rows: [] },
  { rows: [] },
 ];
 let output;
 await handler({ pool: { query: async () => queries.shift() }, url: { searchParams: new URLSearchParams() }, reply: (_status, body) => { output = body; } });
 assert.equal(output.products[0].connections.domains[0].source, 'confirmed');
 assert.equal(output.products[0].connections.domains[0].reconciliation, 'missing');
});
