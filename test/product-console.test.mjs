// Contexto de produto: recorte, isolamento e negação de acesso.
// Usa banco real; cria e remove apenas registros sintéticos desta execução.
import test from 'node:test';
import assert from 'node:assert/strict';
import { randomUUID, randomBytes, createHash } from 'node:crypto';
import pg from 'pg';
import { createCore } from '../src/server.mjs';
import { testConnectionString } from '../src/platform/database.mjs';

test('Product console scoping suite', async t => {
 const pool = new pg.Pool({ connectionString: testConnectionString().connectionString, max: 3 });
 const adminPassword = randomBytes(32).toString('base64url');
 let time = Date.now();
 const server = createCore({ pool, adminPassword, clock: () => time });
 await new Promise(resolve => server.listen(0, '127.0.0.1', resolve));
 const origin = `http://127.0.0.1:${server.address().port}`;

 let cookie = '';
 const ids = [];
 const serviceToken = randomBytes(32).toString('base64url');
 const serviceHash = createHash('sha256').update(serviceToken).digest('hex');
 const subject = `test:${randomUUID()}`;
 const uncatalogued = `zz-test-${randomUUID()}`;

 const req = (path, method = 'GET', body, headers = {}) =>
  fetch(origin + path, {
   method,
   headers: { origin, 'Content-Type': 'application/json', cookie, ...headers },
   body: body === undefined ? undefined : JSON.stringify(body),
  });
 const openConsole = (product, headers) => req(`/api/products/${product}/console`, 'GET', undefined, headers);

 try {
  await t.test('anonymous request is rejected', async () => {
   assert.equal((await openConsole('sites', { cookie: '' })).status, 401);
  });

  await t.test('app service credential cannot open the product console', async () => {
   await pool.query('INSERT INTO app_clients(token_hash,product_id) VALUES($1,$2)', [serviceHash, 'sites']);
   const response = await openConsole('sites', { cookie: '', authorization: `Bearer ${serviceToken}` });
   assert.equal(response.status, 401);
  });

  await t.test('operator signs in', async () => {
   const response = await req('/api/login', 'POST', { password: adminPassword });
   assert.equal(response.status, 200);
   cookie = response.headers.get('set-cookie').split(';')[0];
  });

  await t.test('unknown product returns 404', async () => {
   assert.equal((await openConsole('nao-existe')).status, 404);
  });

  await t.test('malformed product id returns 400', async () => {
   assert.equal((await openConsole('Sites')).status, 400);
   assert.equal((await openConsole('9sites')).status, 400);
  });

  await t.test('unexpected query parameters are rejected', async () => {
   assert.equal((await req('/api/products/sites/console?tenant_id=1')).status, 400);
  });

  await t.test('empty product context reports zeroes, not fabricated data', async () => {
   const data = await (await openConsole('barber')).json();
   assert.equal(data.product.id, 'barber');
   assert.deepEqual(data.organizations, []);
   assert.equal(data.summary.organizations, 0);
   assert.equal(data.summary.active_contracts, 0);
   assert.equal(data.summary.reachable_memberships, 0);
  });

  await t.test('two organizations are created with contracts on different products', async () => {
   for (let n = 0; n < 2; n++) {
    const response = await req('/api/tenants', 'POST', { name: `Console ${n}`, slug: `test-${randomUUID()}` });
    assert.equal(response.status, 200);
    ids.push((await response.json()).tenant_id);
   }
   assert.equal((await req('/api/memberships', 'PUT',
    { tenant_id: ids[0], product_id: 'sites', subject, active: true })).status, 200);
   assert.equal((await req('/api/entitlements', 'PUT',
    { tenant_id: ids[0], product_id: 'sites', plan: 'console-test', rights: ['dashboard.read'], active: true })).status, 200);
   assert.equal((await req('/api/entitlements', 'PUT',
    { tenant_id: ids[1], product_id: 'educare', plan: 'console-test', rights: [], active: true })).status, 200);
  });

  await t.test('console lists only organizations contracted for that product', async () => {
   const sites = await (await openConsole('sites')).json();
   const rows = sites.organizations.filter(row => ids.includes(row.tenant_id));
   assert.equal(rows.length, 1);
   assert.equal(rows[0].tenant_id, ids[0]);
   assert.equal(rows[0].plan, 'console-test');
   assert.deepEqual(rows[0].rights, ['dashboard.read']);
   assert.equal(rows[0].contract_active, true);
   assert.equal(rows[0].active_memberships, 1);

   const educare = await (await openConsole('educare')).json();
   assert.deepEqual(educare.organizations.filter(row => row.tenant_id === ids[0]), []);
   assert.equal(educare.organizations.filter(row => row.tenant_id === ids[1]).length, 1);

   const barber = await (await openConsole('barber')).json();
   assert.deepEqual(barber.organizations.filter(row => ids.includes(row.tenant_id)), []);
  });

  await t.test('membership scope is declared as product-scoped', async () => {
   const sites = await (await openConsole('sites')).json();
   assert.equal(sites.membership_scope, 'product');
  });

  await t.test('people are counted per product, not per organization', async () => {
   // Mesma organização, segundo contrato: a pessoa vinculada em `sites` não conta em `commerce`.
   assert.equal((await req('/api/entitlements', 'PUT',
    { tenant_id: ids[0], product_id: 'commerce', plan: 'console-test', rights: [], active: true })).status, 200);
   const commerce = await (await openConsole('commerce')).json();
   const row = commerce.organizations.find(entry => entry.tenant_id === ids[0]);
   assert.equal(row.active_memberships, 0);
   assert.equal(row.total_memberships, 0);
   const sites = await (await openConsole('sites')).json();
   assert.equal(sites.organizations.find(entry => entry.tenant_id === ids[0]).active_memberships, 1);
   assert.equal(commerce.summary.reachable_memberships, 0);
  });

  await t.test('revoked contract stays visible but leaves the active count', async () => {
   await req('/api/entitlements', 'PUT',
    { tenant_id: ids[0], product_id: 'sites', plan: 'console-test', rights: [], active: false });
   const sites = await (await openConsole('sites')).json();
   const row = sites.organizations.find(entry => entry.tenant_id === ids[0]);
   assert.equal(row.contract_active, false);
   assert.equal(row.contract_version, 2);
   assert.ok(sites.summary.revoked_contracts >= 1);
   assert.equal(sites.organizations.filter(e => ids.includes(e.tenant_id) && e.contract_active).length, 0);
   await req('/api/entitlements', 'PUT',
    { tenant_id: ids[0], product_id: 'sites', plan: 'console-test', rights: ['dashboard.read'], active: true });
  });

  await t.test('suspended organization is flagged and excluded from active contracts', async () => {
   await req('/api/tenants', 'PUT', { tenant_id: ids[0], status: 'suspended' });
   const sites = await (await openConsole('sites')).json();
   const row = sites.organizations.find(entry => entry.tenant_id === ids[0]);
   assert.equal(row.status, 'suspended');
   assert.ok(sites.summary.suspended_organizations >= 1);
   assert.equal(
    sites.organizations.filter(e => ids.includes(e.tenant_id) && e.contract_active && e.status === 'active').length, 0);
   await req('/api/tenants', 'PUT', { tenant_id: ids[0], status: 'active' });
  });

  await t.test('catalogued product carries its Notion record; uncatalogued one carries null', async () => {
   const sites = await (await openConsole('sites')).json();
   assert.equal(sites.product.catalog.id, 'sites');
   assert.ok(sites.product.catalog.imported_at);
   await pool.query('INSERT INTO products(id,name) VALUES($1,$2)', [uncatalogued, 'Produto sintético de teste']);
   const plain = await (await openConsole(uncatalogued)).json();
   assert.equal(plain.product.catalog, null);
   assert.deepEqual(plain.organizations, []);
  });

  await t.test('expired session is rejected server-side', async () => {
   time += 3600001;
   assert.equal((await openConsole('sites')).status, 401);
  });
 } finally {
  const client = await pool.connect();
  try {
   await client.query('BEGIN');
   await client.query('DELETE FROM app_clients WHERE token_hash=$1', [serviceHash]);
   for (const table of ['audit_events', 'memberships', 'entitlements'])
    await client.query(`DELETE FROM ${table} WHERE tenant_id=ANY($1::uuid[])`, [ids]);
   await client.query('DELETE FROM tenants WHERE id=ANY($1::uuid[])', [ids]);
   await client.query('DELETE FROM products WHERE id=$1', [uncatalogued]);
   await client.query('COMMIT');
  } finally { client.release(); }
  server.closeAllConnections();
  await new Promise(resolve => server.close(resolve));
  await pool.end();
 }
});
