import test from 'node:test';
import assert from 'node:assert/strict';
import pg from 'pg';
import { randomBytes, randomUUID } from 'node:crypto';
import { createCore } from '../apps/api/src/server.mjs';
import { testConnectionString } from '../apps/api/src/platform/database.mjs';

// Pessoa com e-mail e telefone: o cadastro grava, recusa formato ruim e e-mail repetido, e a lista traz os dois.
test('pessoas com e-mail e telefone, contra PostgreSQL isolado', async t => {
 const pool = new pg.Pool({ connectionString: testConnectionString().connectionString, max: 3 });
 const adminPassword = randomBytes(32).toString('base64url');
 const server = createCore({ pool, adminPassword });
 await new Promise(r => server.listen(0, '127.0.0.1', r));
 const origin = `http://127.0.0.1:${server.address().port}`;
 const marca = randomUUID().slice(0, 8);
 const login = await fetch(origin + '/api/login', { method: 'POST', headers: { origin, 'Content-Type': 'application/json' }, body: JSON.stringify({ password: adminPassword }) });
 const cookie = login.headers.get('set-cookie').split(';')[0];
 const chamar = async (metodo, rota, body) => { const r = await fetch(origin + rota, { method: metodo, headers: { cookie, origin, 'Content-Type': 'application/json' }, ...(body ? { body: JSON.stringify(body) } : {}) }); return { status: r.status, body: await r.json().catch(() => ({})) }; };
 try {
  const empresa = (await chamar('POST', '/api/tenants', { name: `Contato ${marca}`, slug: `contato-${marca}`, relationship_kind: 'customer' })).body.tenant_id;
  const pessoa = extra => chamar('POST', '/api/stakeholders', { tenant_id: empresa, name: 'Pessoa Contato', role: 'contact', is_primary: false, contact_allowed: true, ...extra });
  const linha = async email => (await pool.query('SELECT name,email,phone FROM stakeholders WHERE lower(email)=$1', [email])).rows;

  await t.test('grava e-mail em minúsculas e telefone só com dígitos', async () => {
   const r = await pessoa({ name: 'Maria Contato', email: `Maria-${marca}@Exemplo.TEST`, phone: '(11) 99999-0000' });
   assert.equal(r.status, 200, JSON.stringify(r.body));
   assert.deepEqual(await linha(`maria-${marca}@exemplo.test`), [{ name: 'Maria Contato', email: `maria-${marca}@exemplo.test`, phone: '11999990000' }]);
  });

  await t.test('sem e-mail nem telefone continua valendo (campos vazios do formulário viram nulo)', async () => {
   const r = await pessoa({ name: 'Sem Contato', email: '', phone: '' });
   assert.equal(r.status, 200, JSON.stringify(r.body));
   const p = (await pool.query("SELECT email,phone FROM stakeholders WHERE name='Sem Contato' ORDER BY created_at DESC LIMIT 1")).rows[0];
   assert.deepEqual(p, { email: null, phone: null });
   assert.equal((await pessoa({ name: 'Sem Campos' })).status, 200, 'o cliente antigo, que não manda os campos, segue funcionando');
  });

  await t.test('e-mail ou telefone inválido é 400, e e-mail que já existe é 409 (não cria a mesma pessoa duas vezes)', async () => {
   for (const ruim of [{ email: 'sem-arroba' }, { email: 'a@b' }, { phone: '123' }, { phone: 'abcdefghijk' }, { phone: '1'.repeat(16) }])
    assert.equal((await pessoa({ name: 'Ruim', ...ruim })).status, 400, JSON.stringify(ruim));
   const repetido = await pessoa({ name: 'Outra Maria', email: `MARIA-${marca}@exemplo.test` });
   assert.equal(repetido.status, 409, JSON.stringify(repetido.body));
   assert.equal((await linha(`maria-${marca}@exemplo.test`)).length, 1);
  });

  await t.test('a lista (overview e bootstrap) traz e-mail e telefone de cada pessoa', async () => {
   const lista = (await chamar('GET', '/api/overview')).body.stakeholders;
   const maria = lista.find(s => s.name === 'Maria Contato' && s.tenant_id === empresa);
   assert.equal(maria.email, `maria-${marca}@exemplo.test`); assert.equal(maria.phone, '11999990000');
   const sem = lista.find(s => s.name === 'Sem Contato' && s.tenant_id === empresa);
   assert.equal(sem.email, null); assert.equal(sem.phone, null);
  });

  await t.test('o intake do site reaproveita a pessoa cadastrada à mão pelo e-mail', async () => {
   const chave = (await chamar('POST', '/api/app-clients', { product_id: 'sites', label: 'Teste de contato', scopes: ['commercial:intake'], expires_at: new Date(Date.now() + 86400000).toISOString() })).body;
   const ref = randomUUID();
   const r = await fetch(origin + '/v1/commercial/intake', { method: 'POST', headers: { 'content-type': 'application/json', authorization: 'Bearer ' + chave.api_key, 'idempotency-key': randomUUID() }, body: JSON.stringify({
    lead: { name: 'Maria do Site', email: `maria-${marca}@exemplo.test` }, organization: { organization_type: 'person' },
    commercial: { product_id: 'sites', service_model: 'on_demand', label: 'Teste' },
    attribution: { source_system: 'tzolkin-site', source_ref: ref, channel: 'institutional-form' }, privacy: { contact_allowed: false, source: 'teste' } }) });
   const corpo = await r.json();
   assert.equal(r.status, 200, JSON.stringify(corpo));
   assert.equal((await linha(`maria-${marca}@exemplo.test`)).length, 1, 'não criou outra pessoa');
  });

  await t.test('sem sessão é 401', async () => {
   const r = await fetch(origin + '/api/stakeholders', { method: 'POST', headers: { origin, 'Content-Type': 'application/json' }, body: JSON.stringify({ tenant_id: empresa, name: 'Anônimo', role: 'contact', is_primary: false, contact_allowed: true }) });
   assert.equal(r.status, 401);
  });
 } finally { server.closeAllConnections(); await new Promise(r => server.close(r)); await pool.end(); }
});
