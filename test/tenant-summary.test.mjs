// Ficha da empresa, ponta a ponta no PostgreSQL: sessão, cadastro pelas rotas
// reais e o que GET /api/tenants/:id/summary devolve para duas empresas.
//
// Roda só no banco descartável (node scripts/test-commercial.mjs test/tenant-summary.test.mjs).
// A senha do operador é gerada aqui; nenhuma credencial real entra e nenhum
// provedor externo é chamado.
import test from 'node:test';
import assert from 'node:assert/strict';
import pg from 'pg';
import { randomBytes, randomUUID } from 'node:crypto';
import { createCore } from '../apps/api/src/server.mjs';
import { testConnectionString } from '../apps/api/src/platform/database.mjs';

const hoje = () => new Intl.DateTimeFormat('en-CA', { timeZone: 'America/Sao_Paulo', year: 'numeric', month: '2-digit', day: '2-digit' }).format(new Date());

test('Ficha da empresa conectada', async t => {
 const pool = new pg.Pool({ connectionString: testConnectionString().connectionString, max: 3 });
 const adminPassword = randomBytes(32).toString('base64url');
 const server = createCore({ pool, adminPassword });
 await new Promise(r => server.listen(0, '127.0.0.1', r));
 const origin = `http://127.0.0.1:${server.address().port}`;
 const marca = randomUUID().slice(0, 8);

 const login = await fetch(origin + '/api/login', {
  method: 'POST', headers: { origin, 'Content-Type': 'application/json' }, body: JSON.stringify({ password: adminPassword }),
 });
 assert.equal(login.status, 200);
 const cookie = login.headers.get('set-cookie').split(';')[0];
 const get = rota => fetch(origin + rota, { headers: { cookie } });
 const enviar = metodo => (rota, body) => fetch(origin + rota, {
  method: metodo, headers: { cookie, origin, 'Content-Type': 'application/json' }, body: JSON.stringify(body),
 });
 const post = enviar('POST'), put = enviar('PUT');
 const ficha = async id => { const r = await get(`/api/tenants/${id}/summary`); assert.equal(r.status, 200); return r.json(); };
 const ok = async (resposta, contexto) => { const corpo = await resposta.json(); assert.equal(resposta.status, 200, `${contexto}: ${corpo.message}`); return corpo; };

 const empresa = {}, A = {}, B = {}, atividades = [], campanhas = [`ca_${marca}`, `cb_${marca}`];
 try {
  await t.test('prepara duas empresas pelas rotas reais', async () => {
   empresa.a = (await ok(await post('/api/tenants', { name: `Ficha A ${marca}`, slug: `ficha-a-${marca}`, relationship_kind: 'customer' }), 'empresa A')).tenant_id;
   empresa.b = (await ok(await post('/api/tenants', { name: `Ficha B ${marca}`, slug: `ficha-b-${marca}`, relationship_kind: 'prospect', lifecycle_status: 'lead' }), 'empresa B')).tenant_id;
   const contratar = (tenant, body, nome) => post('/api/engagements', { tenant_id: tenant, ...body }).then(r => ok(r, nome));

   // A: mentoria encerrada e arquivada, mentoria em curso, assessoria sem item e produto.
   A.arquivada = await contratar(empresa.a, { product_id: 'mentorias', service_model: 'education', status: 'completed', label: `Mentoria antiga ${marca}` }, 'mentoria antiga');
   await ok(await post(`/api/engagements/${A.arquivada.id}/archive`, { revision: A.arquivada.revision }), 'arquivar');
   A.mentoria = await contratar(empresa.a, { product_id: 'mentorias', service_model: 'education', status: 'active', label: `Mentoria ${marca}` }, 'mentoria');
   A.assessoria = await contratar(empresa.a, { product_id: null, service_model: 'advisory', status: 'planned', label: `Assessoria ${marca}` }, 'assessoria');
   A.produto = await contratar(empresa.a, { product_id: 'skiller', service_model: 'product', status: 'active', label: `Skiller ${marca}` }, 'produto');
   B.consultoria = await contratar(empresa.b, { product_id: 'consultorias', service_model: 'consulting', status: 'active', label: `Consultoria B ${marca}` }, 'consultoria B');

   for (const [tenant, nome] of [[empresa.a, `Pessoa A ${marca}`], [empresa.b, `Pessoa B ${marca}`]])
    await ok(await post('/api/stakeholders', { tenant_id: tenant, name: nome, role: 'decision_maker', title: 'Diretoria', is_primary: true, contact_allowed: false }), nome);

   // Deploys: um da contratação em curso de A, um da arquivada de A e um de B.
   for (const [id, engagement] of [[`prj-a-${marca}`, A.assessoria.id], [`prj-arquivada-${marca}`, A.arquivada.id], [`prj-b-${marca}`, B.consultoria.id]])
    await ok(await put('/api/service-deploy-bindings', { provider: 'vercel', external_project_id: id, external_project_name: id, engagement_id: engagement, environment: 'production' }), id);

   // Campanhas: a coleta real depende da Meta; aqui as linhas entram direto, como a coleta gravaria.
   await pool.query("INSERT INTO marketing_accounts(provider,external_id,name,currency) VALUES('meta',$1,'Conta de teste','BRL')", [`act_${marca}`]);
   await pool.query("INSERT INTO marketing_campaigns(provider,external_id,account_external_id,name) VALUES('meta',$1,$3,$4),('meta',$2,$3,$5)",
    [campanhas[0], campanhas[1], `act_${marca}`, `Campanha A ${marca}`, `Campanha B ${marca}`]);
   await pool.query("INSERT INTO marketing_campaign_bindings(provider,external_campaign_id,engagement_id,active,origin) VALUES('meta',$1,$2,true,'manual'),('meta',$3,$4,true,'manual')",
    [campanhas[0], A.mentoria.id, campanhas[1], B.consultoria.id]);
   await pool.query("INSERT INTO marketing_campaign_insights(provider,campaign_external_id,date_start,spend_cents,currency) VALUES('meta',$1,$3,12345,'BRL'),('meta',$2,$3,999,'BRL')",
    [campanhas[0], campanhas[1], hoje()]);

   // Horas: uma atividade por empresa, com apontamento hoje.
   for (const [tenant, minutos] of [[empresa.a, 90], [empresa.b, 45]]) {
    const id = randomUUID(); atividades.push(id);
    await ok(await post('/api/tracking', { id, tenant_id: tenant, category: 'mentoria', kind: 'sessao', title: `Sessão ${marca}`, starts_at: `${hoje()}T10:00:00-03:00`, ends_at: `${hoje()}T11:00:00-03:00` }), 'atividade');
    await ok(await post(`/api/tracking/${id}/time`, { id: randomUUID(), minutes: minutos, worked_on: hoje(), note: 'Sessão realizada' }), 'apontamento');
   }

   // Comercial: lead com atribuição e contrato, como a captação e o painel gravariam.
   for (const [tenant, letra] of [[empresa.a, 'A'], [empresa.b, 'B']]) {
    const lead = (await pool.query(
     `INSERT INTO commercial_leads(tenant_id,product_id,name,email,whatsapp,message,status,source_system,source_ref,privacy)
      VALUES($1,'sites',$2,$3,$4,$5,'won','tzolkin-site',$6,'{"contact_allowed":false}') RETURNING id`,
     [tenant, `Lead ${letra} ${marca}`, `lead-${letra.toLowerCase()}-${marca}@exemplo.test`, `55319999${letra === 'A' ? '1' : '2'}0000`, `mensagem reservada ${letra} ${marca}`, `ref-${letra}-${marca}`])).rows[0].id;
    await pool.query("INSERT INTO commercial_attributions(lead_id,source_system,channel,utm_source,utm_campaign) VALUES($1,'tzolkin-site','social','instagram',$2)", [lead, `campanha-${letra}-${marca}`]);
    await pool.query("INSERT INTO commercial_contracts(lead_id,tenant_id,product_id,title,scope,amount_minor,currency,starts_on) VALUES($1,$2,'sites',$3,'Escopo de teste',1500000,'BRL','2026-09-01')",
     [lead, tenant, `Contrato ${letra} ${marca}`]);
   }

   // Acesso só em B: A é empresa de serviço e não pode ganhar painel de zeros.
   await ok(await put('/api/entitlements', { tenant_id: empresa.b, product_id: 'educare', plan: 'anual', rights: ['dashboard.read'], active: true }), 'contrato de acesso');
   await ok(await put('/api/memberships', { tenant_id: empresa.b, product_id: 'educare', subject: `test:${marca}`, active: true }), 'vínculo');
  });

  await t.test('a ficha de A traz todas as contratações não arquivadas de A e nada de B', async () => {
   const corpo = await ficha(empresa.a);
   assert.equal(corpo.tenant.id, empresa.a);
   assert.equal(corpo.tenant.relationship_kind, 'customer');

   const ids = corpo.engagements.items.map(e => e.id).sort();
   assert.deepEqual(ids, [A.mentoria.id, A.assessoria.id, A.produto.id].sort(), 'todas as não arquivadas, de qualquer service_model');
   assert.ok(!ids.includes(A.arquivada.id), 'arquivada não aparece');
   assert.deepEqual(corpo.engagements.items.map(e => e.service_model).sort(), ['advisory', 'education', 'product']);
   const porId = Object.fromEntries(corpo.engagements.items.map(e => [e.id, e]));
   assert.deepEqual(porId[A.mentoria.id].product, { id: 'mentorias', name: porId[A.mentoria.id].product.name, portfolio_kind: 'service_line', lifecycle_status: 'active' });
   assert.equal(porId[A.assessoria.id].product, null);
   assert.equal(porId[A.produto.id].product.id, 'skiller');

   assert.deepEqual(corpo.deploys.items.map(d => [d.external_project_id, d.engagement_id]), [[`prj-a-${marca}`, A.assessoria.id]], 'deploy da arquivada e de B ficam fora');
   assert.deepEqual(corpo.campaigns.items.map(c => [c.external_id, c.engagement_id, c.spend_cents]), [[campanhas[0], A.mentoria.id, 12345]]);
   assert.equal(typeof corpo.campaigns.items[0].spend_cents, 'number');
   assert.deepEqual([corpo.hours.minutes, corpo.hours.logs, corpo.hours.activities, corpo.hours.by_engagement], [90, 1, 1, false]);
   assert.deepEqual(corpo.people.items.map(p => p.name), [`Pessoa A ${marca}`]);
   assert.deepEqual(Object.keys(corpo.people.items[0]).sort(), ['contact_allowed', 'id', 'is_primary', 'name', 'role', 'title']);
   assert.equal(corpo.contracts.available, true);
   assert.deepEqual(corpo.contracts.items.map(c => [c.title, c.amount_minor, c.starts_on]), [[`Contrato A ${marca}`, 1500000, '2026-09-01']]);
   assert.deepEqual(corpo.origin.items.map(l => [l.name, l.utm_source, l.utm_campaign]), [[`Lead A ${marca}`, 'instagram', `campanha-A-${marca}`]]);
   assert.deepEqual([corpo.access.entitlements, corpo.access.memberships], [[], []]);

   const texto = JSON.stringify(corpo);
   for (const deB of [empresa.b, B.consultoria.id, `Ficha B ${marca}`, `Consultoria B ${marca}`, `Pessoa B ${marca}`, `prj-b-${marca}`, campanhas[1], `Lead B ${marca}`, `Contrato B ${marca}`, `campanha-B-${marca}`])
    assert.ok(!texto.includes(deB), `a ficha de A vazou dado de B: ${deB}`);
   // Contato, mensagem e preferência do lead não saem pela ficha.
   for (const reservado of [`lead-a-${marca}@exemplo.test`, '553199991', `mensagem reservada A ${marca}`, 'privacy', 'request_hash'])
    assert.ok(!texto.includes(reservado), `a ficha expôs ${reservado}`);
  });

  await t.test('a ficha de B traz só B, com acesso', async () => {
   const corpo = await ficha(empresa.b);
   assert.deepEqual(corpo.engagements.items.map(e => e.id), [B.consultoria.id]);
   assert.equal(corpo.hours.minutes, 45);
   assert.deepEqual(corpo.access.entitlements.map(e => [e.product_id, e.plan]), [['educare', 'anual']]);
   assert.deepEqual(corpo.access.memberships.map(m => [m.product_id, m.active]), [['educare', 1]]);
   assert.ok(!JSON.stringify(corpo.access).includes(`test:${marca}`), 'identificador de acesso não sai, só a contagem');
   const texto = JSON.stringify(corpo);
   for (const deA of [empresa.a, A.mentoria.id, A.assessoria.id, A.produto.id, A.arquivada.id, `prj-a-${marca}`, campanhas[0], `Lead A ${marca}`, `Contrato A ${marca}`])
    assert.ok(!texto.includes(deA), `a ficha de B vazou dado de A: ${deA}`);
  });

  await t.test('entrada: id inválido 400, empresa inexistente 404, sem sessão 401', async () => {
   assert.equal((await get('/api/tenants/nao-e-uuid/summary')).status, 400);
   assert.equal((await get(`/api/tenants/${randomUUID()}/summary`)).status, 404);
   assert.equal((await get(`/api/tenants/${empresa.a}/summary?tenant_id=${empresa.b}`)).status, 400);
   assert.equal((await fetch(`${origin}/api/tenants/${empresa.a}/summary`)).status, 401);
  });

  await t.test('ler a ficha não grava auditoria', async () => {
   const contar = async () => (await pool.query('SELECT count(*)::int n FROM audit_events WHERE tenant_id=$1', [empresa.a])).rows[0].n;
   const antes = await contar();
   await ficha(empresa.a);
   assert.equal(await contar(), antes);
  });

  await t.test('contratação criada aparece na ficha seguinte e grava portfolio_audit', async () => {
   const criada = await ok(await post('/api/engagements', { tenant_id: empresa.a, product_id: 'consultorias', service_model: 'consulting', status: 'planned', label: `Consultoria nova ${marca}` }), 'nova');
   const corpo = await ficha(empresa.a);
   const nova = corpo.engagements.items.find(e => e.id === criada.id);
   assert.ok(nova, 'a nova contratação precisa aparecer na ficha');
   assert.deepEqual([nova.label, nova.service_model, nova.status, nova.product.id], [`Consultoria nova ${marca}`, 'consulting', 'planned', 'consultorias']);
   assert.equal(corpo.engagements.items.length, 4);

   const trilha = (await pool.query("SELECT action,actor_subject,after FROM portfolio_audit WHERE entity='engagement' AND entity_id=$1", [criada.id])).rows;
   assert.equal(trilha.length, 1);
   assert.equal(trilha[0].action, 'created');
   assert.equal(trilha[0].actor_subject, 'local-bootstrap');
   assert.equal(trilha[0].after.tenant_id, empresa.a);

   assert.ok(!(await ficha(empresa.b)).engagements.items.some(e => e.id === criada.id), 'não aparece na ficha de outra empresa');
   // Nome repetido na mesma empresa é o 409 que o diálogo mostra.
   const repetida = await post('/api/engagements', { tenant_id: empresa.a, product_id: null, service_model: 'advisory', status: 'active', label: `Consultoria nova ${marca}` });
   assert.equal(repetida.status, 409);
  });
 } finally {
  const client = await pool.connect();
  try {
   await client.query('BEGIN');
   const tenants = Object.values(empresa);
   const contratacoes = (await client.query('SELECT id FROM client_engagements WHERE tenant_id=ANY($1::uuid[])', [tenants])).rows.map(r => r.id);
   await client.query("DELETE FROM portfolio_audit WHERE entity='engagement' AND entity_id=ANY($1::text[])", [contratacoes]);
   await client.query('DELETE FROM marketing_campaign_insights WHERE campaign_external_id=ANY($1::text[])', [campanhas]);
   await client.query('DELETE FROM marketing_campaign_bindings WHERE external_campaign_id=ANY($1::text[])', [campanhas]);
   await client.query('DELETE FROM marketing_campaigns WHERE external_id=ANY($1::text[])', [campanhas]);
   await client.query('DELETE FROM marketing_accounts WHERE external_id=$1', [`act_${marca}`]);
   await client.query('DELETE FROM service_deploy_bindings WHERE engagement_id=ANY($1::uuid[])', [contratacoes]);
   for (const tabela of ['service_time_logs', 'service_activity_audit']) await client.query(`DELETE FROM ${tabela} WHERE activity_id=ANY($1::uuid[])`, [atividades]);
   await client.query('DELETE FROM service_activities WHERE id=ANY($1::uuid[])', [atividades]);
   await client.query('DELETE FROM commercial_contracts WHERE tenant_id=ANY($1::uuid[])', [tenants]);
   await client.query('DELETE FROM commercial_leads WHERE tenant_id=ANY($1::uuid[])', [tenants]);
   const pessoas = (await client.query('DELETE FROM organization_stakeholders WHERE tenant_id=ANY($1::uuid[]) RETURNING stakeholder_id', [tenants])).rows.map(r => r.stakeholder_id);
   await client.query('DELETE FROM stakeholders WHERE id=ANY($1::uuid[])', [pessoas]);
   for (const tabela of ['memberships', 'entitlements', 'audit_events', 'client_engagements']) await client.query(`DELETE FROM ${tabela} WHERE tenant_id=ANY($1::uuid[])`, [tenants]);
   await client.query('DELETE FROM tenants WHERE id=ANY($1::uuid[])', [tenants]);
   await client.query('COMMIT');
  } catch (error) { await client.query('ROLLBACK'); throw error; } finally { client.release(); }
  server.closeAllConnections();
  await new Promise(r => server.close(r));
  await pool.end();
 }
});
