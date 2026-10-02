import test from 'node:test';
import assert from 'node:assert/strict';
import pg from 'pg';
import { randomBytes, randomUUID } from 'node:crypto';
import { createCore } from '../apps/api/src/server.mjs';
import { testConnectionString } from '../apps/api/src/platform/database.mjs';

// Reclassificar a organização (PUT /api/tenants): nome, relacionamento, ciclo de vida e tipo, com o antes e o depois na trilha.
test('reclassificar a organização, contra PostgreSQL isolado', async t => {
 const pool = new pg.Pool({ connectionString: testConnectionString().connectionString, max: 3 });
 const adminPassword = randomBytes(32).toString('base64url');
 const server = createCore({ pool, adminPassword });
 await new Promise(r => server.listen(0, '127.0.0.1', r));
 const origin = `http://127.0.0.1:${server.address().port}`;
 const marca = randomUUID().slice(0, 8);
 const login = await fetch(origin + '/api/login', { method: 'POST', headers: { origin, 'Content-Type': 'application/json' }, body: JSON.stringify({ password: adminPassword }) });
 assert.equal(login.status, 200);
 const cookie = login.headers.get('set-cookie').split(';')[0];
 const chamar = async (metodo, rota, body) => { const r = await fetch(origin + rota, { method: metodo, headers: { cookie, origin, 'Content-Type': 'application/json' }, ...(body ? { body: JSON.stringify(body) } : {}) }); return { status: r.status, body: await r.json().catch(() => ({})) }; };
 const put = body => chamar('PUT', '/api/tenants', body);
 const linha = async id => (await pool.query('SELECT name,slug,status,relationship_kind,lifecycle_status,organization_type FROM tenants WHERE id=$1', [id])).rows[0];
 const trilha = async id => (await pool.query('SELECT type,details FROM audit_events WHERE tenant_id=$1 ORDER BY created_at,id', [id])).rows;
 try {
  const criada = await chamar('POST', '/api/tenants', { name: `Reclass ${marca}`, slug: `reclass-${marca}`, relationship_kind: 'prospect', lifecycle_status: 'lead', organization_type: 'company' });
  assert.equal(criada.status, 200, JSON.stringify(criada.body));
  const id = criada.body.tenant_id;

  await t.test('muda relacionamento, ciclo de vida, tipo e nome de uma vez, e a trilha guarda só o que mudou', async () => {
   const r = await put({ tenant_id: id, name: `Reclass Novo ${marca}`, relationship_kind: 'customer', lifecycle_status: 'onboarding', organization_type: 'company' });
   assert.equal(r.status, 200, JSON.stringify(r.body));
   assert.deepEqual(await linha(id), { name: `Reclass Novo ${marca}`, slug: `reclass-${marca}`, status: 'active', relationship_kind: 'customer', lifecycle_status: 'onboarding', organization_type: 'company' });
   const ev = (await trilha(id)).filter(e => e.type === 'tenant.updated');
   assert.equal(ev.length, 1);
   assert.deepEqual(ev[0].details, {
    before: { name: `Reclass ${marca}`, relationship_kind: 'prospect', lifecycle_status: 'lead' },
    after: { name: `Reclass Novo ${marca}`, relationship_kind: 'customer', lifecycle_status: 'onboarding' },
   });
  });

  await t.test('o identificador (slug) não muda, e campo desconhecido é recusado', async () => {
   assert.equal((await put({ tenant_id: id, slug: 'outro-slug' })).status, 400);
   assert.equal((await put({ tenant_id: id, id: randomUUID() })).status, 400);
   assert.equal((await linha(id)).slug, `reclass-${marca}`);
  });

  await t.test('só a situação continua como antes (suspender e reativar), com o mesmo tipo de evento', async () => {
   assert.equal((await put({ tenant_id: id, status: 'suspended' })).status, 200);
   assert.equal((await linha(id)).status, 'suspended');
   assert.equal((await put({ tenant_id: id, status: 'active' })).status, 200);
   const tipos = (await trilha(id)).map(e => e.type);
   assert.deepEqual(tipos.filter(x => x === 'tenant.status_changed').length, 2);
   assert.equal((await trilha(id)).filter(e => e.type === 'tenant.status_changed').every(e => e.details === null), true);
   assert.equal((await put({ tenant_id: id, status: 'apagada' })).status, 400);
  });

  await t.test('valor fora da lista, nome curto, corpo vazio e empresa inexistente', async () => {
   for (const ruim of [{ relationship_kind: 'amigo' }, { lifecycle_status: 'quase' }, { organization_type: 'governo' }, { name: 'x' }, { name: '' }, {}])
    assert.equal((await put({ tenant_id: id, ...ruim })).status, 400, JSON.stringify(ruim));
   assert.equal((await put({ tenant_id: 'não é uuid', name: 'Algum nome' })).status, 400);
   assert.equal((await put({ tenant_id: randomUUID(), name: 'Algum nome' })).status, 404);
   assert.equal((await linha(id)).relationship_kind, 'customer', 'as recusas não mexeram em nada');
  });

  await t.test('pedir o que já é não grava evento de alteração', async () => {
   const antes = (await trilha(id)).length;
   const r = await put({ tenant_id: id, relationship_kind: 'customer', lifecycle_status: 'onboarding' });
   assert.equal(r.status, 200);
   assert.equal((await trilha(id)).filter(e => e.type === 'tenant.updated').length, 1, 'continua o evento de antes');
   assert.ok((await trilha(id)).length >= antes);
  });

  await t.test('a organização interna não se reclassifica e "interna" não vale para as outras', async () => {
   const interna = (await pool.query("SELECT id FROM tenants WHERE relationship_kind='internal' OR organization_type='internal' LIMIT 1")).rows[0]?.id;
   assert.ok(interna, 'o banco de teste tem a organização interna');
   assert.equal((await put({ tenant_id: interna, relationship_kind: 'customer' })).status, 409);
   assert.equal((await put({ tenant_id: interna, lifecycle_status: 'paused' })).status, 409);
   assert.equal((await put({ tenant_id: id, relationship_kind: 'internal' })).status, 400);
   assert.equal((await put({ tenant_id: id, organization_type: 'internal' })).status, 400);
   assert.equal((await linha(id)).relationship_kind, 'customer');
  });

  await t.test('sem sessão é 401', async () => {
   const r = await fetch(origin + '/api/tenants', { method: 'PUT', headers: { origin, 'Content-Type': 'application/json' }, body: JSON.stringify({ tenant_id: id, name: 'Sem sessão' }) });
   assert.equal(r.status, 401);
  });
 } finally { server.closeAllConnections(); await new Promise(r => server.close(r)); await pool.end(); }
});
