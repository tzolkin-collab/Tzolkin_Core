import test from 'node:test';
import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import pg from 'pg';
import { createCore } from '../apps/api/src/app.mjs';

// Requisitos de etapa: o que a etapa exige para o registro entrar nela ou sair dela. Todo requisito daqui mora num funil
// criado só para este teste (nicho `gate-<marca>`), então não bloqueia nenhum outro arquivo da suíte.
test('requisitos de etapa, contra PostgreSQL isolado', async t => {
 const url = process.env.DATABASE_URL_TEST;
 if (!url || !/^\/tzolkin_test_commercial_[0-9a-f]{12}$/.test(new URL(url).pathname)) return t.skip('DATABASE_URL_TEST dedicada não configurada');
 const pool = new pg.Pool({ connectionString: url, max: 6 });
 const password = 'test-only-bootstrap-' + randomUUID();
 const server = createCore({ pool, adminPassword: password });
 await new Promise(r => server.listen(0, '127.0.0.1', r));
 const origin = 'http://127.0.0.1:' + server.address().port;
 const marca = randomUUID().slice(0, 8);
 const nicho = `gate-${marca}`;
 const campoChave = `orcamento_${marca}`;
 let cookie, key, funil, dono; const etapas = {};
 const request = async (path, method = 'GET', body, headers = {}) => {
  const r = await fetch(origin + path, { method, headers: { 'content-type': 'application/json', origin, cookie: cookie || '', ...headers }, ...(body ? { body: JSON.stringify(body) } : {}) });
  return { status: r.status, body: await r.json() };
 };
 const novoLead = async rotulo => {
  const ref = randomUUID();
  const r = await request('/v1/commercial/intake', 'POST', {
   lead: { name: `Pessoa ${rotulo}`, email: `gate-${rotulo}-${marca}@example.invalid`, whatsapp: '5511999990000' },
   organization: { name: `Empresa ${rotulo} ${marca}`, organization_type: 'company' },
   commercial: { product_id: 'sites', service_model: 'on_demand', label: 'Teste de requisitos' },
   attribution: { source_system: 'tzolkin-site', source_ref: ref, channel: 'institutional-form', utm_tzolkin: `sites.${nicho}` },
   privacy: { contact_allowed: false, source: 'teste' },
  }, { authorization: 'Bearer ' + key.api_key, 'idempotency-key': randomUUID(), origin: '', cookie: '' });
  assert.equal(r.status, 200, JSON.stringify(r.body));
  return r.body.lead_id;
 };
 const lead = async id => (await request('/api/commercial/leads/' + id)).body;
 const moverLead = async (id, etapa) => request(`/api/commercial/leads/${id}/stage`, 'PUT', { version: (await lead(id)).lead.version, stage_id: etapas[etapa] });
 const qualificar = async id => { await request(`/api/commercial/leads/${id}/qualify`, 'POST', { version: (await lead(id)).lead.version, value_minor: 1000 }); return (await pool.query('SELECT * FROM commercial_opportunities WHERE lead_id=$1', [id])).rows[0]; };
 const moverOpp = async (id, etapa, extra = {}) => { const o = (await pool.query('SELECT version FROM commercial_opportunities WHERE id=$1', [id])).rows[0]; return request(`/api/commercial/opportunities/${id}/move`, 'PUT', { version: o.version, stage_id: etapas[etapa], ...extra }); };
 const requisito = async (corpo, esperado = 200) => { const r = await request('/api/commercial/stage-requirements', 'POST', { pipeline_id: funil, ...corpo }); assert.equal(r.status, esperado, JSON.stringify(r.body)); return r.body.id; };
 const tarefas = async campo => (await pool.query(`SELECT * FROM commercial_tasks WHERE ${campo.col}=$1 ORDER BY created_at,id`, [campo.id])).rows;
 const concluir = async id => { const t = (await pool.query('SELECT version FROM commercial_tasks WHERE id=$1', [id])).rows[0]; return request('/api/commercial/tasks/' + id, 'PUT', { version: t.version, done: true }); };
 const desligar = async id => { const r = (await pool.query('SELECT version FROM stage_requirements WHERE id=$1', [id])).rows[0]; return request('/api/commercial/stage-requirements/' + id, 'PUT', { version: r.version, is_active: false }); };
 try {
  await t.test('prepara: chave do Sites, funil só deste teste, responsável e campos próprios', async () => {
   const login = await fetch(origin + '/api/login', { method: 'POST', headers: { 'content-type': 'application/json', origin }, body: JSON.stringify({ password }) });
   cookie = login.headers.get('set-cookie').split(';')[0];
   const e = await request('/api/app-clients', 'POST', { product_id: 'sites', label: 'Teste de requisitos', scopes: ['commercial:intake'], expires_at: new Date(Date.now() + 86400000).toISOString() });
   assert.equal(e.status, 200, JSON.stringify(e.body)); key = e.body;
   const p = await request('/api/commercial/pipelines', 'POST', { space_id: 'sites', slug: nicho, name: `Funil de requisitos ${marca}` });
   assert.equal(p.status, 200, JSON.stringify(p.body)); funil = p.body.id;
   for (const s of (await request('/api/commercial/pipelines?space_id=sites')).body.pipelines.find(x => x.id === funil).stages) etapas[s.name] = s.id;
   dono = (await pool.query("INSERT INTO operator_accounts(email,name,role,status,source) VALUES($1,'Dono gate','member','active','manual') RETURNING id", [`gate-dono-${marca}@example.invalid`])).rows[0].id;
   for (const entidade of ['lead', 'opportunity']) assert.equal((await request('/api/commercial/space-fields', 'POST', { space_id: 'sites', entity: entidade, key: campoChave, label: 'Orçamento', type: 'NUMBER' })).status, 200);
   assert.equal((await request('/api/commercial/stage-requirements?pipeline_id=' + funil, 'GET', null, { cookie: '' })).status, 401);
  });

  await t.test('cadastro do requisito: gate, tipo, etapa, campo e prazo são conferidos', async () => {
   const base = { stage_id: etapas['Em contato'], gate: 'ENTER', kind: 'ACTION', title: 'Qualquer um' };
   await requisito({ ...base, gate: 'DEPOIS' }, 400);
   await requisito({ ...base, kind: 'TAREFA' }, 400);
   await requisito({ ...base, title: 'x' }, 400);
   await requisito({ ...base, stage_id: randomUUID() }, 400);
   const outro = (await request('/api/commercial/pipelines?space_id=mentorias')).body.pipelines[0];
   await requisito({ ...base, stage_id: outro.stages[0].id }, 400);
   await requisito({ ...base, field_key: 'x' }, 400);
   await requisito({ ...base, due_days: -1 }, 400);
   await requisito({ ...base, due_days: 1.5 }, 400);
   await requisito({ ...base, owner_id: randomUUID() }, 400);
   await requisito({ ...base, extra: 1 }, 400);
   await requisito({ ...base, kind: 'FIELD', field_key: 'nao_existe' }, 400);
   await requisito({ ...base, kind: 'FIELD' }, 400);
   await requisito({ ...base, kind: 'FIELD', field_key: campoChave, due_days: 3 }, 400);
   assert.equal((await request('/api/commercial/stage-requirements', 'POST', { pipeline_id: randomUUID(), ...base })).status, 404);
   assert.equal((await request('/api/commercial/stage-requirements')).status, 400, 'a listagem exige o funil');
  });

  await t.test('exigir tarefa para ENTRAR: a tentativa cria a tarefa (uma só), bloqueia, e concluir libera', async () => {
   const req = await requisito({ stage_id: etapas['Em contato'], gate: 'ENTER', kind: 'ACTION', title: 'Confirmar o telefone', tag: 'Cadastro', owner_id: dono, due_days: 2 });
   const id = await novoLead('entrar');
   const antes = (await lead(id)).lead.stage_id;
   const r = await moverLead(id, 'Em contato');
   assert.equal(r.status, 200, JSON.stringify(r.body));
   assert.equal(r.body.ok, false); assert.equal(r.body.blocked, true);
   assert.deepEqual(r.body.blockers.map(b => [b.requirement_id, b.kind, b.gate, b.title]), [[req, 'ACTION', 'ENTER', 'Confirmar o telefone']]);
   assert.equal((await lead(id)).lead.stage_id, antes, 'o lead não andou');
   const [tarefa] = await tarefas({ col: 'lead_id', id });
   assert.equal(r.body.blockers[0].task_id, tarefa.id);
   assert.deepEqual([tarefa.title, tarefa.tag, tarefa.source, tarefa.requirement_id, tarefa.owner_id, tarefa.opportunity_id], ['Confirmar o telefone', 'Cadastro', 'requisito', req, dono, null]);
   const dias = (new Date(tarefa.due_at) - Date.now()) / 86_400_000; assert.ok(dias > 1.9 && dias < 2.1);
   assert.equal((await moverLead(id, 'Em contato')).body.blocked, true, 'tentar de novo continua bloqueado');
   assert.equal((await tarefas({ col: 'lead_id', id })).length, 1, 'e não cria outra tarefa');
   assert.equal((await concluir(tarefa.id)).status, 200);
   const livre = await moverLead(id, 'Em contato');
   assert.equal(livre.status, 200); assert.equal(livre.body.ok, true);
   assert.equal((await lead(id)).lead.stage_id, etapas['Em contato']);
   await desligar(req);
  });

  await t.test('exigir tarefa para SAIR, e duas tarefas na mesma fronteira: todas precisam fechar', async () => {
   const a = await requisito({ stage_id: etapas['Em contato'], gate: 'EXIT', kind: 'ACTION', title: 'Registrar o contato' });
   const b = await requisito({ stage_id: etapas['Em contato'], gate: 'EXIT', kind: 'ACTION', title: 'Anotar o interesse' });
   const id = await novoLead('sair');
   assert.equal((await moverLead(id, 'Em contato')).body.ok, true, 'entrar não é exigido: só sair');
   const bloqueado = await moverLead(id, 'Novos');
   assert.equal(bloqueado.body.blocked, true);
   assert.deepEqual(bloqueado.body.blockers.map(x => x.title), ['Registrar o contato', 'Anotar o interesse']);
   const pendentes = await tarefas({ col: 'lead_id', id });
   const t1 = pendentes.find(t => t.title === 'Registrar o contato');
   const t2 = pendentes.find(t => t.title === 'Anotar o interesse');
   assert.ok(t1 && t2, 'cada requisito de saída gerou sua própria tarefa');
   await concluir(t1.id);
   assert.deepEqual((await moverLead(id, 'Novos')).body.blockers.map(x => x.title), ['Anotar o interesse'], 'fechar só uma não basta');
   await concluir(t2.id);
   assert.equal((await moverLead(id, 'Novos')).body.ok, true);
   await desligar(a); await desligar(b);
  });

  await t.test('exigir campo próprio: bloqueia sem criar tarefa, e preencher libera (lead e oportunidade)', async () => {
   const doLead = await requisito({ stage_id: etapas['Em contato'], gate: 'ENTER', kind: 'FIELD', field_key: campoChave, title: 'Informar o orçamento' });
   const id = await novoLead('campo');
   const r = await moverLead(id, 'Em contato');
   assert.equal(r.body.blocked, true);
   assert.deepEqual(r.body.blockers.map(b => [b.kind, b.field_key, b.task_id]), [['FIELD', campoChave, null]]);
   assert.equal((await tarefas({ col: 'lead_id', id })).length, 0, 'requisito de campo não cria tarefa');
   const l = (await lead(id)).lead;
   assert.equal((await request(`/api/commercial/custom-data/lead/${id}`, 'PUT', { version: l.version, custom_data: { [campoChave]: 5000 } })).status, 200);
   assert.equal((await moverLead(id, 'Em contato')).body.ok, true);
   await desligar(doLead);
   // na oportunidade o campo olhado é o da oportunidade
   const daOpp = await requisito({ stage_id: etapas['Proposta'], gate: 'ENTER', kind: 'FIELD', field_key: campoChave, title: 'Orçamento da proposta' });
   const lead2 = await novoLead('campo-opp');
   const opp = await qualificar(lead2);
   const bloq = await moverOpp(opp.id, 'Proposta');
   assert.equal(bloq.body.blocked, true, JSON.stringify(bloq.body));
   const atual = (await pool.query('SELECT version FROM commercial_opportunities WHERE id=$1', [opp.id])).rows[0].version;
   assert.equal((await request(`/api/commercial/custom-data/opportunity/${opp.id}`, 'PUT', { version: atual, custom_data: { [campoChave]: 9000 } })).status, 200);
   assert.equal((await moverOpp(opp.id, 'Proposta')).body.ok, true);
   assert.equal((await pool.query('SELECT s.name FROM commercial_opportunities o JOIN pipeline_stages s ON s.id=o.stage_id WHERE o.id=$1', [opp.id])).rows[0].name, 'Proposta');
   await desligar(daOpp);
  });

  await t.test('requisito em etapa de oportunidade: a tarefa nasce na oportunidade (com o lead), e ganhar só cria a contratação depois', async () => {
   const req = await requisito({ stage_id: etapas['Ganho'], gate: 'ENTER', kind: 'ACTION', title: 'Contrato assinado e arquivado' });
   const id = await novoLead('ganho');
   const opp = await qualificar(id);
   const bloq = await moverOpp(opp.id, 'Ganho');
   assert.equal(bloq.status, 200); assert.equal(bloq.body.blocked, true);
   const [tarefa] = await tarefas({ col: 'opportunity_id', id: opp.id });
   assert.deepEqual([tarefa.title, tarefa.source, tarefa.lead_id, tarefa.requirement_id], ['Contrato assinado e arquivado', 'requisito', id, req]);
   assert.equal((await pool.query('SELECT count(*)::int n FROM client_engagements WHERE source_ref=$1', [opp.id])).rows[0].n, 0, 'bloqueado não cria contratação');
   assert.equal((await lead(id)).lead.status, 'qualified', 'nem muda o lead');
   assert.ok((await lead(id)).tasks.some(x => x.id === tarefa.id && x.source === 'requisito'), 'a tarefa aparece no detalhe do lead');
   assert.equal((await concluir(tarefa.id)).status, 200);
   const ganho = await moverOpp(opp.id, 'Ganho');
   assert.equal(ganho.body.ok, true, JSON.stringify(ganho.body)); assert.ok(ganho.body.engagement_id);
   await desligar(req);
  });

  await t.test('perder, descartar e qualificar nunca ficam presos; requisito desligado não bloqueia', async () => {
   const naPerda = await requisito({ stage_id: etapas['Perdido'], gate: 'ENTER', kind: 'ACTION', title: 'Registrar aprendizado' });
   const exigeSair = await requisito({ stage_id: etapas['Qualificação'], gate: 'EXIT', kind: 'ACTION', title: 'Fechar pendências' });
   const l1 = await novoLead('perder');
   const opp = await qualificar(l1);
   const motivo = (await pool.query('SELECT id FROM lost_reasons ORDER BY name LIMIT 1')).rows[0].id;
   const perdido = await moverOpp(opp.id, 'Perdido', { lost_reason_id: motivo });
   assert.equal(perdido.body.ok, true, 'perder não passa pelo bloqueio');
   const l2 = await novoLead('descartar');
   assert.equal((await request(`/api/commercial/leads/${l2}/discard`, 'POST', { version: (await lead(l2)).lead.version, lost_reason_id: motivo })).status, 200);
   // o requisito de SAIR de "Qualificação" bloqueia andar para "Proposta", mas não impediu de qualificar (entrar em Qualificação)
   const l3 = await novoLead('qualifica-livre');
   const opp3 = await qualificar(l3);
   assert.ok(opp3, 'qualificar não é bloqueado');
   assert.equal((await moverOpp(opp3.id, 'Proposta')).body.blocked, true);
   await desligar(exigeSair);
   assert.equal((await moverOpp(opp3.id, 'Proposta')).body.ok, true, 'desligado, não bloqueia mais');
   await desligar(naPerda);
  });

  await t.test('editar o requisito: título, tag e versão; etapa, gate e tipo não mudam; no máximo 10 por etapa', async () => {
   const id = await requisito({ stage_id: etapas['Negociação'], gate: 'ENTER', kind: 'ACTION', title: 'Primeiro' });
   const v = (await pool.query('SELECT version FROM stage_requirements WHERE id=$1', [id])).rows[0].version;
   assert.equal((await request('/api/commercial/stage-requirements/' + id, 'PUT', { version: v, title: 'Renomeado', tag: 'Vendas', due_days: 5 })).status, 200);
   assert.equal((await request('/api/commercial/stage-requirements/' + id, 'PUT', { version: v, title: 'Velho' })).status, 409);
   for (const proibido of [{ gate: 'EXIT' }, { kind: 'FIELD' }, { stage_id: etapas['Ganho'] }])
    assert.equal((await request('/api/commercial/stage-requirements/' + id, 'PUT', { version: v + 1, ...proibido })).status, 400, JSON.stringify(proibido));
   const lista = (await request('/api/commercial/stage-requirements?pipeline_id=' + funil)).body.requirements.find(r => r.id === id);
   assert.deepEqual([lista.title, lista.tag, lista.due_days, lista.stage_name, lista.is_active], ['Renomeado', 'Vendas', 5, 'Negociação', true]);
   for (let i = 0; i < 9; i++) await requisito({ stage_id: etapas['Negociação'], gate: 'EXIT', kind: 'ACTION', title: `Extra ${i}` });
   await requisito({ stage_id: etapas['Negociação'], gate: 'EXIT', kind: 'ACTION', title: 'Passou do limite' }, 409);
   await pool.query('UPDATE stage_requirements SET is_active=false WHERE pipeline_id=$1', [funil]);
  });
 } finally {
  await pool.query('UPDATE stage_requirements SET is_active=false WHERE pipeline_id=$1', [funil]).catch(() => {});
  server.closeAllConnections(); await new Promise(r => server.close(r)); await pool.end();
 }
});
