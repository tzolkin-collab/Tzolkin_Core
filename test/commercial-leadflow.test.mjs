import test from 'node:test';
import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import pg from 'pg';
import { createCore } from '../apps/api/src/app.mjs';

// Fase 3 do funil: mover, qualificar, descartar e restaurar o lead; ganhar a oportunidade cria a contratação.
test('fluxo do lead no funil e contratação ao ganhar, contra PostgreSQL isolado', async t => {
 const url = process.env.DATABASE_URL_TEST;
 if (!url || !/^\/tzolkin_test_commercial_[0-9a-f]{12}$/.test(new URL(url).pathname)) return t.skip('DATABASE_URL_TEST dedicada não configurada');
 const pool = new pg.Pool({ connectionString: url, max: 6 });
 const password = 'test-only-bootstrap-' + randomUUID();
 const server = createCore({ pool, adminPassword: password });
 await new Promise(r => server.listen(0, '127.0.0.1', r));
 const origin = 'http://127.0.0.1:' + server.address().port;
 let cookie, key;
 const marca = randomUUID().slice(0, 8);
 const request = async (path, method = 'GET', body, headers = {}) => {
  const r = await fetch(origin + path, { method, headers: { 'content-type': 'application/json', origin, cookie: cookie || '', ...headers }, ...(body ? { body: JSON.stringify(body) } : {}) });
  return { status: r.status, body: await r.json() };
 };
 const intake = corpo => request('/v1/commercial/intake', 'POST', corpo, { authorization: 'Bearer ' + key.api_key, 'idempotency-key': randomUUID(), origin: '', cookie: '' });
 const novoLead = async (rotulo, interesse = 'Landing page') => {
  const ref = randomUUID();
  const r = await intake({
   lead: { name: `Pessoa ${rotulo}`, email: `fluxo-${rotulo}-${marca}@example.invalid`, whatsapp: '5511999990000', message: 'Teste' },
   organization: { name: `Empresa ${rotulo} ${marca}`, organization_type: 'company' },
   commercial: { product_id: 'sites', service_model: 'on_demand', label: interesse },
   attribution: { source_system: 'tzolkin-site', source_ref: ref, channel: 'institutional-form' },
   privacy: { contact_allowed: false, source: 'teste' },
  });
  assert.equal(r.status, 200, JSON.stringify(r.body));
  return r.body;
 };
 const lead = async id => (await request('/api/commercial/leads/' + id)).body;
 const versao = async id => (await lead(id)).lead.version;
 const etapas = {};
 const acao = async (id, caminho, metodo, corpo = {}) => request(`/api/commercial/leads/${id}/${caminho}`, metodo, { version: await versao(id), ...corpo });
 const oportunidade = async leadId => (await pool.query('SELECT * FROM commercial_opportunities WHERE lead_id=$1', [leadId])).rows[0];
 const mover = (opp, nome, extra = {}) => request(`/api/commercial/opportunities/${opp.id}/move`, 'PUT', { version: opp.version, stage_id: etapas[nome], ...extra });
 const recarregar = async id => (await pool.query('SELECT * FROM commercial_opportunities WHERE id=$1', [id])).rows[0];
 let motivo;
 try {
  await t.test('prepara: chave de intake do Sites, etapas do funil padrão e um motivo de perda', async () => {
   const login = await fetch(origin + '/api/login', { method: 'POST', headers: { 'content-type': 'application/json', origin }, body: JSON.stringify({ password }) });
   cookie = login.headers.get('set-cookie').split(';')[0];
   const emitida = await request('/api/app-clients', 'POST', { product_id: 'sites', label: 'Teste do fluxo', scopes: ['commercial:intake'], expires_at: new Date(Date.now() + 86400000).toISOString() });
   assert.equal(emitida.status, 200, JSON.stringify(emitida.body));
   key = emitida.body;
   const padrao = (await request('/api/commercial/pipelines?space_id=sites')).body.pipelines.find(p => p.slug === 'padrao');
   for (const s of padrao.stages) etapas[s.name] = s.id;
   const motivos = (await request('/api/commercial/lost-reasons')).body.lost_reasons;
   assert.ok(motivos.length >= 5); motivo = motivos[0];
   assert.equal((await request('/api/commercial/lost-reasons', 'GET', null, { cookie: '' })).status, 401);
  });

  await t.test('mover entre etapas de lead: grava o primeiro contato uma vez, marca como visto e registra no histórico', async () => {
   const { lead_id: id } = await novoLead('mover');
   const antes = (await lead(id)).lead;
   assert.equal(antes.stage_id, etapas['Novos']); assert.equal(antes.was_seen, false); assert.equal(antes.first_contact_at, null);
   const r = await acao(id, 'stage', 'PUT', { stage_id: etapas['Em contato'] });
   assert.equal(r.status, 200, JSON.stringify(r.body));
   const depois = (await lead(id)).lead;
   assert.equal(depois.stage_id, etapas['Em contato']); assert.equal(depois.was_seen, true);
   assert.ok(depois.first_contact_at); assert.equal(depois.version, antes.version + 1);
   // voltar para a primeira etapa não apaga nem refaz a data do primeiro contato
   assert.equal((await acao(id, 'stage', 'PUT', { stage_id: etapas['Novos'] })).status, 200);
   assert.equal((await lead(id)).lead.first_contact_at, depois.first_contact_at);
   const passos = (await lead(id)).activities.filter(a => a.kind === 'stage_changed').map(a => [a.details.from.name, a.details.to.name]);
   assert.deepEqual(passos.reverse(), [['Novos', 'Em contato'], ['Em contato', 'Novos']]);
   // recusas
   assert.equal((await acao(id, 'stage', 'PUT', { stage_id: etapas['Novos'] })).status, 400, 'já está nesta etapa');
   assert.equal((await acao(id, 'stage', 'PUT', { stage_id: etapas['Proposta'] })).status, 400, 'lead não pula para etapa aberta');
   assert.equal((await request(`/api/commercial/leads/${id}/stage`, 'PUT', { version: 1, stage_id: etapas['Em contato'] })).status, 409, 'versão velha');
   assert.equal((await acao(id, 'stage', 'PUT', { stage_id: randomUUID() })).status, 400);
   const outroFunil = (await request('/api/commercial/pipelines?space_id=mentorias')).body.pipelines[0];
   if (outroFunil) assert.equal((await acao(id, 'stage', 'PUT', { stage_id: outroFunil.stages[1].id })).status, 400, 'etapa de outro funil');
  });

  await t.test('qualificar cria a oportunidade na primeira etapa aberta, leva valor e responsável, e só uma vez', async () => {
   const { lead_id: id } = await novoLead('qualificar', 'Site institucional');
   const r = await acao(id, 'qualify', 'POST', { value_minor: 450000, expected_close_at: '2026-12-01T00:00:00Z' });
   assert.equal(r.status, 200, JSON.stringify(r.body));
   const opp = await oportunidade(id);
   assert.equal(opp.id, r.body.opportunity_id); assert.equal(opp.stage_id, etapas['Qualificação']);
   assert.equal(Number(opp.value_minor), 450000); assert.equal(opp.title, `Empresa qualificar ${marca} · Site institucional`);
   assert.equal(opp.origin, 'INBOUND');
   const l = (await lead(id)).lead;
   assert.equal(l.status, 'qualified'); assert.equal(Number(l.estimated_value_minor), 450000);
   assert.ok((await lead(id)).activities.some(a => a.kind === 'qualified' && a.details.opportunity_id === opp.id));
   assert.equal((await acao(id, 'qualify', 'POST', {})).status, 409, 'só um lead aberto');
   assert.equal((await acao(id, 'stage', 'PUT', { stage_id: etapas['Em contato'] })).status, 409, 'lead qualificado não anda mais como lead');
   assert.equal((await acao(id, 'discard', 'POST', { lost_reason_id: motivo.id })).status, 409);
   // valor inválido e responsável inexistente não deixam rastro
   const { lead_id: outro } = await novoLead('qualificar-invalido');
   assert.equal((await acao(outro, 'qualify', 'POST', { value_minor: -1 })).status, 400);
   assert.equal((await acao(outro, 'qualify', 'POST', { value_minor: 1.5 })).status, 400);
   assert.equal((await acao(outro, 'qualify', 'POST', { owner_id: randomUUID() })).status, 400);
   assert.equal(await oportunidade(outro), undefined); assert.equal((await lead(outro)).lead.status, 'open');
  });

  await t.test('a oportunidade anda; ganhar cria UMA contratação, promove a empresa e o lead vira ganho', async () => {
   const { lead_id: id, tenant_id: tenant } = await novoLead('ganhar', 'Loja virtual');
   await acao(id, 'qualify', 'POST', { value_minor: 900000 });
   let opp = await oportunidade(id);
   const antes = (await pool.query('SELECT relationship_kind,lifecycle_status FROM tenants WHERE id=$1', [tenant])).rows[0];
   assert.deepEqual(antes, { relationship_kind: 'prospect', lifecycle_status: 'lead' });
   assert.equal((await mover(opp, 'Proposta')).status, 200);
   assert.equal((await lead(id)).lead.status, 'qualified');
   opp = await recarregar(opp.id);
   const ganho = await mover(opp, 'Ganho');
   assert.equal(ganho.status, 200, JSON.stringify(ganho.body));
   const engId = ganho.body.engagement_id; assert.ok(engId);
   const eng = (await pool.query('SELECT * FROM client_engagements WHERE id=$1', [engId])).rows[0];
   assert.equal(eng.tenant_id, tenant); assert.equal(eng.product_id, 'sites'); assert.equal(eng.status, 'active');
   assert.equal(eng.service_model, 'on_demand'); assert.equal(eng.label, `Empresa ganhar ${marca} · Loja virtual`);
   assert.equal(eng.source_system, 'commercial_opportunity');
   assert.equal((await recarregar(opp.id)).engagement_id, engId);
   assert.deepEqual((await pool.query('SELECT relationship_kind,lifecycle_status FROM tenants WHERE id=$1', [tenant])).rows[0], { relationship_kind: 'customer', lifecycle_status: 'onboarding' });
   const l = (await lead(id)).lead; assert.equal(l.status, 'won');
   const historico = (await lead(id)).activities.map(a => a.kind);
   assert.ok(historico.includes('engagement_created') && historico.includes('opportunity_moved'));
   assert.equal((await pool.query("SELECT count(*)::int n FROM portfolio_audit WHERE entity='engagement' AND entity_id=$1 AND action='created'", [engId])).rows[0].n, 1);
   // reabrir e ganhar de novo não cria outra contratação
   opp = await recarregar(opp.id);
   assert.equal((await mover(opp, 'Negociação')).status, 200);
   assert.equal((await lead(id)).lead.status, 'qualified');
   opp = await recarregar(opp.id);
   const denovo = await mover(opp, 'Ganho');
   assert.equal(denovo.body.engagement_id, engId);
   assert.equal((await pool.query('SELECT count(*)::int n FROM client_engagements WHERE tenant_id=$1', [tenant])).rows[0].n, 1);
  });

  await t.test('perder exige motivo; o lead acompanha e guarda o motivo; reabrir limpa', async () => {
   const { lead_id: id } = await novoLead('perder');
   await acao(id, 'qualify', 'POST', {});
   let opp = await oportunidade(id);
   assert.equal((await mover(opp, 'Perdido')).status, 400, 'sem motivo');
   const perdido = await mover(opp, 'Perdido', { lost_reason_id: motivo.id });
   assert.equal(perdido.status, 200, JSON.stringify(perdido.body)); assert.equal(perdido.body.engagement_id, null);
   const l = (await lead(id)).lead; assert.equal(l.status, 'lost'); assert.equal(l.loss_reason, motivo.name);
   assert.equal((await pool.query('SELECT count(*)::int n FROM client_engagements WHERE source_ref=$1', [opp.id])).rows[0].n, 0, 'perder não cria contratação');
   assert.equal((await acao(id, 'restore', 'POST')).status, 409, 'virou oportunidade: reabre pela oportunidade');
   opp = await recarregar(opp.id);
   assert.equal((await mover(opp, 'Qualificação')).status, 200);
   const reaberto = (await lead(id)).lead; assert.equal(reaberto.status, 'qualified'); assert.equal(reaberto.loss_reason, null);
  });

  await t.test('segunda venda com o mesmo título para a mesma empresa ganha "(2)" no rótulo', async () => {
   const { lead_id: id, tenant_id: tenant } = await novoLead('repetida', 'Manutenção');
   await acao(id, 'qualify', 'POST', {});
   const primeira = await mover(await oportunidade(id), 'Ganho');
   const rotulo = (await pool.query('SELECT label FROM client_engagements WHERE id=$1', [primeira.body.engagement_id])).rows[0].label;
   const criada = await request('/api/commercial/opportunities', 'POST', { pipeline_id: (await oportunidade(id)).pipeline_id, tenant_id: tenant, title: rotulo, value_minor: 1000 });
   assert.equal(criada.status, 200, JSON.stringify(criada.body));
   const segunda = await mover(await recarregar(criada.body.id), 'Ganho');
   assert.equal(segunda.status, 200, JSON.stringify(segunda.body));
   assert.equal((await pool.query('SELECT label FROM client_engagements WHERE id=$1', [segunda.body.engagement_id])).rows[0].label, `${rotulo} (2)`);
   assert.equal((await pool.query('SELECT status FROM commercial_leads WHERE id=$1', [id])).rows[0].status, 'won', 'a segunda, sem lead, não mexe no lead da primeira');
  });

  await t.test('descartar exige motivo da lista; restaurar volta a aberto; só se estiver descartado', async () => {
   const { lead_id: id } = await novoLead('descartar');
   assert.equal((await acao(id, 'discard', 'POST', {})).status, 400, 'sem motivo');
   assert.equal((await acao(id, 'discard', 'POST', { lost_reason_id: randomUUID() })).status, 400, 'motivo que não existe');
   assert.equal((await acao(id, 'restore', 'POST')).status, 409, 'aberto não restaura');
   const d = await acao(id, 'discard', 'POST', { lost_reason_id: motivo.id, note: 'Pediu para não ser contatado' });
   assert.equal(d.status, 200, JSON.stringify(d.body));
   const descartado = await lead(id);
   assert.equal(descartado.lead.status, 'lost'); assert.equal(descartado.lead.loss_reason, motivo.name);
   const ev = descartado.activities.find(a => a.kind === 'discarded');
   assert.equal(ev.note, 'Pediu para não ser contatado'); assert.equal(ev.details.reason, motivo.name);
   assert.equal((await acao(id, 'discard', 'POST', { lost_reason_id: motivo.id })).status, 409, 'já descartado');
   assert.equal((await acao(id, 'stage', 'PUT', { stage_id: etapas['Em contato'] })).status, 409);
   const r = await acao(id, 'restore', 'POST');
   assert.equal(r.status, 200, JSON.stringify(r.body));
   const volta = (await lead(id)).lead; assert.equal(volta.status, 'open'); assert.equal(volta.loss_reason, null);
   assert.ok((await lead(id)).activities.some(a => a.kind === 'restored'));
  });

  await t.test('sem sessão nada disso funciona', async () => {
   const { lead_id: id } = await novoLead('anonimo');
   for (const [caminho, metodo] of [['stage', 'PUT'], ['qualify', 'POST'], ['discard', 'POST'], ['restore', 'POST']])
    assert.equal((await request(`/api/commercial/leads/${id}/${caminho}`, metodo, { version: 1 }, { cookie: '' })).status, 401, caminho);
  });
 } finally { server.closeAllConnections(); await new Promise(r => server.close(r)); await pool.end(); }
});
