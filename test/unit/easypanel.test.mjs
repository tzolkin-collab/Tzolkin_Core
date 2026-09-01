import test from 'node:test';
import assert from 'node:assert/strict';
import { createEasypanelAdapter, normalizeInventory } from '../../apps/api/src/integrations/easypanel.mjs';
import { createCore } from '../../apps/api/src/app.mjs';
const fixture = [{ name: 'tzolkin', env: 'secret', services: [{ name: 'core', type: 'app', password: 'secret', env: 'private' }] }];
const config = { baseUrl: 'https://panel.example.invalid', token: 'synthetic-test-token' };

test('EasyPanel uses only documented GET and never follows redirects', async () => {
 let calls = 0;
 const result = await createEasypanelAdapter({ ...config, fetchImpl: async (url, options) => {
  calls++;
  assert.equal(url.href, config.baseUrl + '/api/listProjectsAndServices');
  assert.equal(options.method, 'GET');
  assert.equal(options.redirect, 'error');
  assert.equal(options.headers.Authorization, 'Bearer ' + config.token);
  return Response.json(fixture);
 } }).inventory();
 assert.equal(calls, 1);
 assert.deepEqual(result.projects, [{ name: 'tzolkin', services: [{ name: 'core', type: 'app' }] }]);
 assert.ok(!JSON.stringify(result).includes('secret'));
});

test('EasyPanel refuses HTTP, embedded credentials, query and arbitrary paths', () => {
 for (const baseUrl of ['http://panel.test', 'https://u:p@panel.test', 'https://panel.test?token=x', 'https://panel.test/other'])
  assert.throws(() => createEasypanelAdapter({ ...config, baseUrl }), /HTTPS/);
 assert.throws(() => createEasypanelAdapter({ ...config, token: '' }), /credencial/);
});

test('real response shape groups services by project and drops all configuration', () => {
 const data = normalizeInventory({
  projects: [{ name: 'one', createdAt: 'date' }, { name: 'two' }, { name: 'empty' }],
  services: [
   { projectName: 'two', name: 'db', type: 'postgres', token: 'secret', env: 'private', source: { password: 'secret' } },
   { projectName: 'one', name: 'web', type: 'app', enabled: true },
  ],
 });
 assert.deepEqual(data.projects, [
  { name: 'one', services: [{ name: 'web', type: 'app' }] },
  { name: 'two', services: [{ name: 'db', type: 'postgres' }] },
  { name: 'empty', services: [] },
 ]);
 assert.ok(!JSON.stringify(data).includes('secret'));
 assert.ok(!JSON.stringify(data).includes('enabled'));
});

test('flat response rejects orphan services and duplicate projects', () => {
 assert.throws(() => normalizeInventory({ projects: [{ name: 'x' }, { name: 'x' }], services: [] }), /incompatível/);
 assert.throws(() => normalizeInventory({ projects: [], services: [{ name: 'x', projectName: 'missing', type: 'app' }] }), /incompatível/);
});

test('EasyPanel errors never echo the provider body or fetch errors', async () => {
 for (const status of [401, 403, 404, 429, 500, 302]) {
  const adapter = createEasypanelAdapter({ ...config, fetchImpl: async () => new Response(config.token, { status }) });
  await assert.rejects(adapter.inventory(), error => !error.message.includes(config.token));
 }
 await assert.rejects(createEasypanelAdapter({ ...config, fetchImpl: async () => { throw Error(config.token); } }).inventory(), /HTTPS/);
});

test('EasyPanel rejects incompatible and excessive responses', async () => {
 for (const data of [null, { result: fixture }, [{ name: 'x' }], [{ name: 'x', services: [{}] }]])
  assert.throws(() => normalizeInventory(data), /incompatível/);
 const adapter = createEasypanelAdapter({ ...config, fetchImpl: async () => new Response(' '.repeat(1024 * 1024 + 1)) });
 await assert.rejects(adapter.inventory(), /incompatível/);
});

test('EasyPanel truncation is explicit and unknown types do not imply health', () => {
 const data = normalizeInventory(Array.from({ length: 101 }, () => ({ name: 'x', services: Array.from({ length: 201 }, () => ({ name: 's', type: 'future' })) })));
 assert.equal(data.omitted_projects, 1);
 assert.equal(data.omitted_services, 100);
 assert.equal(data.projects[0].services[0].type, 'unknown');
});

test('Core inventory enforces session, denies writes, caches and never touches DB', async () => {
 let calls = 0, now = 100;
 const password = 'synthetic-password-long-enough-for-test';
 const server = createCore({
  adminPassword: password, clock: () => now, deployRegistry: [],
  pool: { query() { throw Error('Database must not be used'); } },
  infrastructureOptions: { env: { EASYPANEL_URL: config.baseUrl, EASYPANEL_TOKEN: config.token }, fetchImpl: async () => { calls++; return Response.json(fixture); } },
 });
 await new Promise(resolve => server.listen(0, '127.0.0.1', resolve));
 const origin = `http://127.0.0.1:${server.address().port}`;
 const endpoint = origin + '/api/infrastructure/easypanel';
 try {
  assert.equal((await fetch(endpoint)).status, 401);
  assert.equal(calls, 0);
  const login = await fetch(origin + '/api/login', { method: 'POST', headers: { origin, 'Content-Type': 'application/json' }, body: JSON.stringify({ password }) });
  const cookie = login.headers.get('set-cookie').split(';')[0];
  const headers = { cookie, origin };
  assert.equal((await fetch(endpoint + '?url=https://evil.invalid', { headers })).status, 400);
  for (const method of ['POST', 'PUT']) assert.equal((await fetch(endpoint, { method, headers })).status, 405);
  for (let i = 0; i < 2; i++) {
   const data = await (await fetch(endpoint, { headers })).json();
   assert.equal(data.status, 'ok');
   assert.ok(!JSON.stringify(data).includes(config.token));
  }
  assert.equal(calls, 1);
  now += 30001;
  await fetch(endpoint, { headers });
  assert.equal(calls, 2);
  now += 3600001;
  assert.equal((await fetch(endpoint, { headers })).status, 401);
  assert.equal(calls, 2);
 } finally { server.closeAllConnections(); await new Promise(resolve => server.close(resolve)); }
});

test('unconfigured, partial configuration and provider outage degrade safely', async () => {
 const { infrastructureRoutes } = await import('../../apps/api/src/modules/infrastructure.mjs');
 for (const env of [{}, { EASYPANEL_URL: config.baseUrl }, { EASYPANEL_URL: config.baseUrl, EASYPANEL_TOKEN: config.token }]) {
  let handler;
  infrastructureRoutes({ get(path, fn) { handler = fn; } }, { env, fetchImpl: async () => { throw Error('secret'); } });
  await handler({ url: new URL('http://localhost/api/infrastructure/easypanel'), reply(status, data) {
   assert.equal(status, 200);
   assert.equal(data.status, Object.keys(env).length ? 'error' : 'not_configured');
   assert.ok(!JSON.stringify(data).includes('secret'));
  } });
 }
});
