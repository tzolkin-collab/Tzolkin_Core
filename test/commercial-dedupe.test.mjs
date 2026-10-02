import test from 'node:test';
import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import pg from 'pg';
import { createCore } from '../apps/api/src/app.mjs';

test('dedupe de pessoa e empresa no intake, contra PostgreSQL isolado', async t => {
 const url = process.env.DATABASE_URL_TEST;
 if (!url || !/^\/tzolkin_test_commercial_[0-9a-f]{12}$/.test(new URL(url).pathname)) return t.skip('DATABASE_URL_TEST dedicada não configurada');
 const pool = new pg.Pool({ connectionString: url, max: 6 });
 const password = 'test-only-bootstrap-' + randomUUID();
 const server = createCore({ pool, adminPassword: password });
 await new Promise(r => server.listen(0, '127.0.0.1', r));
 const origin = 'http://127.0.0.1:' + server.address().port;
 let cookie, key;
 const request = async (path, method = 'GET', body, headers = {}) => {
  const r = await fetch(origin + path, { method, headers: { 'content-type': 'application/json', origin, cookie: cookie || '', ...headers }, ...(body ? { body: JSON.stringify(body) } : {}) });
  return { status: r.status, body: await r.json() };
 };
 const intake = corpo => request('/v1/commercial/intake', 'POST', corpo, { authorization: 'Bearer ' + key.api_key, 'idempotency-key': randomUUID(), origin: '', cookie: '' });
 const sufixo = randomUUID().slice(0, 8);
 const lead = ({ email, nome = 'Maria Dedupe', empresa, telefone = '5511999990000' }) => {
  const ref = randomUUID();
  return {
   lead: { name: nome, ...(email ? { email } : {}), whatsapp: telefone, message: 'Teste' },
   organization: empresa ? { name: empresa, organization_type: 'company' } : { organization_type: 'person' },
   commercial: { product_id: 'sites', service_model: 'on_demand', label: 'Teste de dedupe' },
   attribution: { source_system: 'tzolkin-site', source_ref: ref, channel: 'institutional-form' },
   privacy: { contact_allowed: false, source: 'teste' },
  };
 };
 const contagem = async email => (await pool.query(
  `SELECT (SELECT count(*) FROM stakeholders WHERE lower(email)=$1)::int pessoas,
          (SELECT count(*) FROM commercial_leads WHERE lower(email)=$1)::int leads`, [email.toLowerCase()])).rows[0];
 try {
  await t.test('chave de intake do Sites emitida', async () => {
   const login = await fetch(origin + '/api/login', { method: 'POST', headers: { 'content-type': 'application/json', origin }, body: JSON.stringify({ password }) });
   cookie = login.headers.get('set-cookie').split(';')[0];
   const emitida = await request('/api/app-clients', 'POST', { product_id: 'sites', label: 'Teste de dedupe', scopes: ['commercial:intake'], expires_at: new Date(Date.now() + 86400000).toISOString() });
   assert.equal(emitida.status, 200, JSON.stringify(emitida.body));
   key = emitida.body;
  });

  await t.test('mesmo e-mail (com outra caixa) e mesma empresa: um contato e uma empresa, dois leads', async () => {
   const email = `Dedupe-${sufixo}@Example.invalid`;
   const a = await intake(lead({ email, empresa: `Imobiliária ${sufixo}` }));
   const b = await intake(lead({ email: email.toLowerCase(), nome: 'Maria D.', empresa: `imobiliária ${sufixo}` }));
   assert.equal(a.status, 200, JSON.stringify(a.body)); assert.equal(b.status, 200, JSON.stringify(b.body));
   assert.notEqual(a.body.lead_id, b.body.lead_id);
   assert.equal(b.body.stakeholder_id, a.body.stakeholder_id);
   assert.equal(b.body.tenant_id, a.body.tenant_id);
   assert.deepEqual(await contagem(email), { pessoas: 1, leads: 2 });
   const vinculos = (await pool.query('SELECT count(*)::int n FROM organization_stakeholders WHERE tenant_id=$1', [a.body.tenant_id])).rows[0].n;
   assert.equal(vinculos, 1);
   // o contato existente não é renomeado nem perde o vínculo principal
   assert.equal((await pool.query('SELECT name FROM stakeholders WHERE id=$1', [a.body.stakeholder_id])).rows[0].name, 'Maria Dedupe');
   assert.equal((await pool.query('SELECT is_primary FROM organization_stakeholders WHERE tenant_id=$1', [a.body.tenant_id])).rows[0].is_primary, true);
  });

  await t.test('mesmo e-mail com empresa diferente: mesma pessoa, outra empresa', async () => {
   const email = `dedupe-duas-${sufixo}@example.invalid`;
   const a = await intake(lead({ email, empresa: `Empresa A ${sufixo}` }));
   const b = await intake(lead({ email, empresa: `Empresa B ${sufixo}` }));
   assert.equal(b.body.stakeholder_id, a.body.stakeholder_id);
   assert.notEqual(b.body.tenant_id, a.body.tenant_id);
   assert.deepEqual(await contagem(email), { pessoas: 1, leads: 2 });
   const novo = (await pool.query('SELECT is_primary FROM organization_stakeholders WHERE tenant_id=$1 AND stakeholder_id=$2', [b.body.tenant_id, a.body.stakeholder_id])).rows[0];
   assert.equal(novo.is_primary, true, 'a empresa nova nasce com a pessoa como contato principal');
  });

  await t.test('e-mails diferentes não se juntam, e o mesmo nome de empresa em outra pessoa vira outra empresa', async () => {
   const a = await intake(lead({ email: `dedupe-x-${sufixo}@example.invalid`, empresa: `Mesma Razão ${sufixo}` }));
   const b = await intake(lead({ email: `dedupe-y-${sufixo}@example.invalid`, empresa: `Mesma Razão ${sufixo}` }));
   assert.notEqual(a.body.stakeholder_id, b.body.stakeholder_id);
   assert.notEqual(a.body.tenant_id, b.body.tenant_id);
  });

  await t.test('telefone sozinho não identifica a pessoa; lead sem e-mail cria pessoa nova', async () => {
   const a = await intake(lead({ email: `dedupe-tel-${sufixo}@example.invalid`, telefone: '5511988887777' }));
   const b = await intake(lead({ telefone: '5511988887777', nome: 'Outra Pessoa' }));
   assert.equal(b.status, 200, JSON.stringify(b.body));
   assert.notEqual(b.body.stakeholder_id, a.body.stakeholder_id);
  });

  await t.test('cliente que volta sai com a marca e o histórico guarda o que foi encontrado', async () => {
   const email = `dedupe-volta-${sufixo}@example.invalid`;
   const primeiro = await intake(lead({ email, empresa: `Cliente ${sufixo}` }));
   assert.equal(primeiro.body.returning_client, false);
   const ativa = await pool.query("UPDATE tenants SET relationship_kind='customer', lifecycle_status='active' WHERE id=$1", [primeiro.body.tenant_id]);
   assert.equal(ativa.rowCount, 1);
   const volta = await intake(lead({ email, empresa: `Cliente ${sufixo}` }));
   assert.equal(volta.body.returning_client, true);
   // a empresa deixou de ser lead: o lead novo reaproveita a mesma empresa sem rebaixá-la
   assert.equal(volta.body.tenant_id, primeiro.body.tenant_id);
   const t2 = (await pool.query('SELECT relationship_kind,lifecycle_status FROM tenants WHERE id=$1', [primeiro.body.tenant_id])).rows[0];
   assert.deepEqual(t2, { relationship_kind: 'customer', lifecycle_status: 'active' });
   const nota = (await pool.query("SELECT details FROM commercial_activities WHERE lead_id=$1 AND kind='received'", [volta.body.lead_id])).rows[0].details;
   assert.equal(nota.matched_person, true); assert.equal(nota.matched_organization, true); assert.equal(nota.returning_client, true);
  });

  await t.test('dois envios simultâneos do mesmo e-mail novo criam uma só pessoa', async () => {
   const email = `dedupe-paralelo-${sufixo}@example.invalid`;
   const respostas = await Promise.all([1, 2, 3].map(() => intake(lead({ email }))));
   assert.deepEqual(respostas.map(r => r.status), [200, 200, 200], JSON.stringify(respostas.map(r => r.body)));
   assert.equal(new Set(respostas.map(r => r.body.stakeholder_id)).size, 1);
   assert.deepEqual(await contagem(email), { pessoas: 1, leads: 3 });
  });
 } finally { server.closeAllConnections(); await new Promise(r => server.close(r)); await pool.end(); }
});
