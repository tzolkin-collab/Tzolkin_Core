import test from 'node:test';
import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import pg from 'pg';
import { createCore } from '../apps/api/src/app.mjs';

// Fase 5: eventos, automações e tarefas, contra PostgreSQL isolado. Todas as automações daqui filtram por um funil
// criado só para este teste (nicho `auto-<marca>` no utm_tzolkin), então não mexem em nenhum outro arquivo da suíte.
test('eventos, automações e tarefas, contra PostgreSQL isolado', async t => {
 const url = process.env.DATABASE_URL_TEST;
 if (!url || !/^\/tzolkin_test_commercial_[0-9a-f]{12}$/.test(new URL(url).pathname)) return t.skip('DATABASE_URL_TEST dedicada não configurada');
 const pool = new pg.Pool({ connectionString: url, max: 6 });
 const password = 'test-only-bootstrap-' + randomUUID();
 const server = createCore({ pool, adminPassword: password });
 await new Promise(r => server.listen(0, '127.0.0.1', r));
 const origin = 'http://127.0.0.1:' + server.address().port;
 const marca = randomUUID().slice(0, 8);
 const nicho = `auto-${marca}`;
 let cookie, key, funil, etapas = {}, dono, dono2;
 const criadas = [];
 const request = async (path, method = 'GET', body, headers = {}) => {
  const r = await fetch(origin + path, { method, headers: { 'content-type': 'application/json', origin, cookie: cookie || '', ...headers }, ...(body ? { body: JSON.stringify(body) } : {}) });
  return { status: r.status, body: await r.json() };
 };
 const intake = (rotulo, extra = {}, chave = randomUUID(), corpo) => request('/v1/commercial/intake', 'POST', corpo ?? {
  lead: { name: `Pessoa ${rotulo}`, email: `auto-${rotulo}-${marca}@example.invalid`, whatsapp: '5511999990000' },
  organization: { name: `Empresa ${rotulo} ${marca}`, organization_type: 'company' },
  commercial: { product_id: 'sites', service_model: 'on_demand', label: 'Teste de automação' },
  attribution: { source_system: 'tzolkin-site', source_ref: chave, channel: 'institutional-form', utm_tzolkin: `sites.${nicho}`, ...extra },
  privacy: { contact_allowed: false, source: 'teste' },
 }, { authorization: 'Bearer ' + key.api_key, 'idempotency-key': chave, origin: '', cookie: '' });
 const automacao = async (corpo, esperado = 200) => {
  const r = await request('/api/commercial/automations', 'POST', { space_id: 'sites', pipeline_id: funil, ...corpo });
  assert.equal(r.status, esperado, JSON.stringify(r.body));
  if (r.status === 200) criadas.push(r.body.id);
  return r.body.id;
 };
 const tarefa = (title, delay_days = 0) => ({ action: 'tarefa.criar', title, tag: 'Auto', delay_days });
 const tarefas = async leadId => (await pool.query('SELECT * FROM commercial_tasks WHERE lead_id=$1 ORDER BY created_at,id', [leadId])).rows;
 const execucoes = async id => (await request(`/api/commercial/automations/${id}/runs`)).body.runs;
 const lead = async id => (await request('/api/commercial/leads/' + id)).body;
 const acao = async (id, caminho, metodo, corpo = {}) => request(`/api/commercial/leads/${id}/${caminho}`, metodo, { version: (await lead(id)).lead.version, ...corpo });
 try {
  await t.test('prepara: chave do Sites, funil só deste teste, dois responsáveis ativos', async () => {
   const login = await fetch(origin + '/api/login', { method: 'POST', headers: { 'content-type': 'application/json', origin }, body: JSON.stringify({ password }) });
   cookie = login.headers.get('set-cookie').split(';')[0];
   const e = await request('/api/app-clients', 'POST', { product_id: 'sites', label: 'Teste de automações', scopes: ['commercial:intake'], expires_at: new Date(Date.now() + 86400000).toISOString() });
   assert.equal(e.status, 200, JSON.stringify(e.body)); key = e.body;
   const p = await request('/api/commercial/pipelines', 'POST', { space_id: 'sites', slug: nicho, name: `Funil de teste ${marca}` });
   assert.equal(p.status, 200, JSON.stringify(p.body)); funil = p.body.id;
   for (const s of (await request('/api/commercial/pipelines?space_id=sites')).body.pipelines.find(x => x.id === funil).stages) etapas[s.name] = s.id;
   dono = (await pool.query("INSERT INTO operator_accounts(email,name,role,status,source) VALUES($1,'Dono um','member','active','manual') RETURNING id", [`auto-dono1-${marca}@example.invalid`])).rows[0].id;
   dono2 = (await pool.query("INSERT INTO operator_accounts(email,name,role,status,source) VALUES($1,'Dono dois','member','active','manual') RETURNING id", [`auto-dono2-${marca}@example.invalid`])).rows[0].id;
   assert.equal((await request('/api/commercial/automations', 'GET', null, { cookie: '' })).status, 401);
   const cat = (await request('/api/commercial/automations?space_id=sites')).body.catalog;
   assert.equal(Object.keys(cat.events).length, 10); assert.deepEqual(Object.keys(cat.actions), ['tarefa.criar', 'responsavel.atribuir']);
  });

  await t.test('cadastro de automação: evento, ações, responsável, funil e etapa são conferidos', async () => {
   const base = { name: 'Teste', trigger_event: 'lead.criado', actions: [tarefa('Ligar')] };
   await automacao({ ...base, trigger_event: 'lead.inventado' }, 400);
   await automacao({ ...base, actions: [] }, 400);
   await automacao({ ...base, actions: [{ action: 'email.enviar' }] }, 400);
   await automacao({ ...base, actions: [tarefa('Ligar', 400)] }, 400);
   await automacao({ ...base, name: 'x' }, 400);
   await automacao({ ...base, extra: 1 }, 400);
   await automacao({ ...base, actions: [{ action: 'responsavel.atribuir', owner_id: randomUUID() }] }, 400);
   await automacao({ ...base, stage_id: etapas['Novos'], pipeline_id: null }, 400);
   const mentorias = (await request('/api/commercial/pipelines?space_id=mentorias')).body.pipelines[0];
   await automacao({ ...base, pipeline_id: mentorias.id }, 400);
   await automacao({ ...base, stage_id: mentorias.stages[0].id }, 400);
   const r = await request('/api/commercial/automations', 'POST', { ...base, space_id: 'core' });
   assert.equal(r.status, 409, 'espaço interno não tem ciclo comercial');
   assert.equal((await request('/api/commercial/automations', 'POST', { ...base, space_id: 'nao-existe' })).status, 404);
  });

  let leadAuto, autoCriar, autoDono;
  await t.test('lead.criado: cria a tarefa (com prazo) e atribui o responsável, só no funil da automação', async () => {
   autoCriar = await automacao({ name: 'Ligar em 2 dias', trigger_event: 'lead.criado', actions: [tarefa('Ligar para o lead', 2)] });
   autoDono = await automacao({ name: 'Dono do funil', trigger_event: 'lead.criado', actions: [{ action: 'responsavel.atribuir', owner_id: dono }] });
   const r = await intake('criado');
   assert.equal(r.status, 200, JSON.stringify(r.body)); leadAuto = r.body.lead_id;
   const [t1] = await tarefas(leadAuto);
   assert.equal(t1.title, 'Ligar para o lead'); assert.equal(t1.source, 'automacao'); assert.equal(t1.automation_id, autoCriar); assert.equal(t1.tag, 'Auto');
   const dias = (new Date(t1.due_at) - Date.now()) / 86_400_000; assert.ok(dias > 1.9 && dias < 2.1, `prazo em ${dias} dias`);
   assert.equal((await pool.query('SELECT owner_id FROM commercial_leads WHERE id=$1', [leadAuto])).rows[0].owner_id, dono);
   assert.deepEqual((await execucoes(autoCriar)).map(x => [x.event, x.result, x.lead_id]), [['lead.criado', 'OK', leadAuto]]);
   const lista = (await request('/api/commercial/automations?space_id=sites')).body.automations.find(a => a.id === autoCriar);
   assert.equal(lista.last_result, 'OK');
   // lead do funil padrão (sem o nicho): nenhuma automação roda
   const fora = await intake('fora', { utm_tzolkin: 'sites' });
   assert.equal((await tarefas(fora.body.lead_id)).length, 0);
   assert.equal((await execucoes(autoCriar)).length, 1);
   // reenvio da mesma chave devolve o lead e não roda de novo
   const chave = randomUUID();
   const primeiro = await intake('repete', {}, chave); const repetido = await intake('repete', {}, chave);
   assert.equal(repetido.body.lead_id, primeiro.body.lead_id);
   assert.equal((await tarefas(primeiro.body.lead_id)).length, 1, 'um reenvio não duplica a tarefa');
  });

  await t.test('automação desligada não roda; ligada de novo, volta a rodar; o histórico fica', async () => {
   const v = (await request('/api/commercial/automations?space_id=sites')).body.automations.find(a => a.id === autoCriar).version;
   assert.equal((await request(`/api/commercial/automations/${autoCriar}`, 'PUT', { version: v, is_enabled: false })).status, 200);
   const desligada = await intake('desligada');
   assert.equal((await tarefas(desligada.body.lead_id)).length, 0);
   assert.equal((await request(`/api/commercial/automations/${autoCriar}`, 'PUT', { version: v, is_enabled: true })).status, 409, 'versão velha');
   assert.equal((await request(`/api/commercial/automations/${autoCriar}`, 'PUT', { version: v + 1, is_enabled: true })).status, 200);
   const ligada = await intake('ligada');
   assert.equal((await tarefas(ligada.body.lead_id)).length, 1);
   assert.equal((await request(`/api/commercial/automations/${autoCriar}`, 'PUT', { version: v + 2, trigger_event: 'lead.criado' })).status, 400, 'o evento não muda');
   assert.equal((await request(`/api/commercial/automations/${autoCriar}`, 'DELETE')).status, 405, 'automação não se apaga');
  });

  await t.test('filtro de etapa: só dispara na etapa escolhida', async () => {
   const naEtapa = await automacao({ name: 'Ao entrar em contato', trigger_event: 'lead.mudou_de_etapa', stage_id: etapas['Em contato'], actions: [tarefa('Confirmar interesse')] });
   const r = await intake('etapa'); const id = r.body.lead_id;
   const antes = (await tarefas(id)).length;
   assert.equal((await acao(id, 'stage', 'PUT', { stage_id: etapas['Em contato'] })).status, 200);
   assert.deepEqual((await tarefas(id)).slice(antes).map(x => x.title), ['Confirmar interesse']);
   assert.equal((await acao(id, 'stage', 'PUT', { stage_id: etapas['Novos'] })).status, 200);
   assert.equal((await tarefas(id)).length, antes + 1, 'voltar para "Novos" não dispara');
   assert.equal((await execucoes(naEtapa)).length, 1);
  });

  await t.test('uma automação que falha não derruba o lead, desfaz só ela e as outras seguem', async () => {
   const quebra = await automacao({ name: 'Quebra', trigger_event: 'lead.criado', actions: [tarefa('Não pode ficar'), { action: 'responsavel.atribuir', owner_id: dono2 }] });
   const depois = await automacao({ name: 'Depois da quebra', trigger_event: 'lead.criado', actions: [tarefa('Segue rodando')] });
   await pool.query("UPDATE operator_accounts SET status='suspended' WHERE id=$1", [dono2]);
   const r = await intake('quebra');
   assert.equal(r.status, 200, 'o lead do site chega mesmo com a automação falhando');
   const titulos = (await tarefas(r.body.lead_id)).map(x => x.title);
   assert.ok(titulos.includes('Ligar para o lead') && titulos.includes('Segue rodando'), titulos.join(', '));
   assert.ok(!titulos.includes('Não pode ficar'), 'o que a automação que falhou já tinha feito foi desfeito');
   const [falha] = await execucoes(quebra);
   assert.equal(falha.result, 'FAILED'); assert.match(falha.note, /ativo/);
   assert.equal((await execucoes(depois))[0].result, 'OK');
   assert.equal((await request('/api/commercial/automations?space_id=sites')).body.automations.find(a => a.id === quebra).last_result, 'FAILED');
   // desliga a que quebra para não poluir os testes seguintes
   const v = (await request('/api/commercial/automations?space_id=sites')).body.automations.find(a => a.id === quebra).version;
   await request(`/api/commercial/automations/${quebra}`, 'PUT', { version: v, is_enabled: false });
  });

  await t.test('oportunidade criada, ganha e contratação criada disparam; perdida também', async () => {
   const aCriada = await automacao({ name: 'Opp criada', trigger_event: 'oportunidade.criada', actions: [tarefa('Preparar proposta')] });
   const aGanha = await automacao({ name: 'Opp ganha', trigger_event: 'oportunidade.ganha', actions: [tarefa('Enviar boas-vindas')] });
   const aContrato = await automacao({ name: 'Contratação criada', trigger_event: 'contratacao.criada', actions: [tarefa('Abrir projeto')] });
   const aPerdida = await automacao({ name: 'Opp perdida', trigger_event: 'oportunidade.perdida', actions: [tarefa('Registrar aprendizado')] });
   const aMudou = await automacao({ name: 'Opp mudou', trigger_event: 'oportunidade.mudou_de_etapa', stage_id: etapas['Proposta'], actions: [tarefa('Acompanhar proposta')] });
   const ganho = (await intake('ganho')).body.lead_id;
   assert.equal((await acao(ganho, 'qualify', 'POST', { value_minor: 1000 })).status, 200);
   const opp = (await pool.query('SELECT * FROM commercial_opportunities WHERE lead_id=$1', [ganho])).rows[0];
   let ts = await tarefas(ganho);
   const preparar = ts.find(x => x.title === 'Preparar proposta');
   assert.ok(preparar, 'tarefa de "oportunidade criada"'); assert.equal(preparar.opportunity_id, opp.id); assert.equal(preparar.lead_id, ganho);
   const mover = async (o, nome, extra = {}) => request(`/api/commercial/opportunities/${o.id}/move`, 'PUT', { version: o.version, stage_id: etapas[nome], ...extra });
   const atual = async () => (await pool.query('SELECT * FROM commercial_opportunities WHERE id=$1', [opp.id])).rows[0];
   assert.equal((await mover(await atual(), 'Proposta')).status, 200);
   assert.ok((await tarefas(ganho)).some(x => x.title === 'Acompanhar proposta'), 'filtro de etapa de destino');
   assert.equal((await mover(await atual(), 'Negociação')).status, 200);
   assert.equal((await tarefas(ganho)).filter(x => x.title === 'Acompanhar proposta').length, 1, 'outra etapa não dispara');
   const g = await mover(await atual(), 'Ganho'); assert.equal(g.status, 200, JSON.stringify(g.body));
   ts = (await tarefas(ganho)).map(x => x.title);
   assert.ok(ts.includes('Enviar boas-vindas') && ts.includes('Abrir projeto'), ts.join(', '));
   assert.equal((await execucoes(aContrato)).length, 1);
   // reabrir e ganhar de novo: "ganha" dispara outra vez, mas a contratação já existe e "criada" não
   assert.equal((await mover(await atual(), 'Negociação')).status, 200);
   assert.equal((await mover(await atual(), 'Ganho')).status, 200);
   assert.equal((await execucoes(aContrato)).length, 1, 'a contratação não foi criada de novo');
   assert.equal((await execucoes(aGanha)).length, 2);
   // perdida
   const perdido = (await intake('perdido')).body.lead_id;
   await acao(perdido, 'qualify', 'POST', {});
   const oppP = (await pool.query('SELECT * FROM commercial_opportunities WHERE lead_id=$1', [perdido])).rows[0];
   const motivo = (await pool.query('SELECT id FROM lost_reasons ORDER BY name LIMIT 1')).rows[0].id;
   assert.equal((await mover(oppP, 'Perdido', { lost_reason_id: motivo })).status, 200);
   assert.ok((await tarefas(perdido)).some(x => x.title === 'Registrar aprendizado'));
   assert.equal((await execucoes(aPerdida)).length, 1); assert.equal((await execucoes(aCriada)).length, 2);
   assert.equal((await execucoes(aMudou)).length, 1);
   // oportunidade criada à mão (sem lead): a tarefa fica só na oportunidade
   const empresa = (await pool.query('SELECT tenant_id FROM commercial_leads WHERE id=$1', [ganho])).rows[0].tenant_id;
   const manual = await request('/api/commercial/opportunities', 'POST', { pipeline_id: funil, tenant_id: empresa, title: `Venda manual ${marca}`, value_minor: 1 });
   assert.equal(manual.status, 200, JSON.stringify(manual.body));
   const daManual = (await pool.query('SELECT * FROM commercial_tasks WHERE opportunity_id=$1', [manual.body.id])).rows;
   assert.deepEqual(daManual.map(x => [x.title, x.lead_id]), [['Preparar proposta', null]]);
  });

  await t.test('tarefas: criar à mão, concluir, reabrir, versão e permissões; o detalhe do lead traz as do lead', async () => {
   const id = (await intake('tarefas')).body.lead_id;
   assert.equal((await request('/api/commercial/tasks')).status, 400, 'sem lead nem oportunidade não lista tudo');
   assert.equal((await request('/api/commercial/tasks?lead_id=x')).status, 400);
   assert.equal((await request('/api/commercial/tasks', 'POST', { title: 'Sem alvo' })).status, 400);
   assert.equal((await request('/api/commercial/tasks', 'POST', { lead_id: randomUUID(), title: 'Lead inexistente' })).status, 404);
   const c = await request('/api/commercial/tasks', 'POST', { lead_id: id, title: 'Mandar o portfólio', tag: 'Vendas', due_at: '2026-12-01T12:00:00Z', owner_id: dono });
   assert.equal(c.status, 200, JSON.stringify(c.body));
   assert.equal((await request('/api/commercial/tasks', 'POST', { lead_id: id, title: 'Dono inativo', owner_id: dono2 })).status, 400);
   const outroLead = (await intake('outra-empresa')).body.lead_id;
   const oppDoOutro = await (async () => { await acao(outroLead, 'qualify', 'POST', {}); return (await pool.query('SELECT id FROM commercial_opportunities WHERE lead_id=$1', [outroLead])).rows[0].id; })();
   assert.equal((await request('/api/commercial/tasks', 'POST', { lead_id: id, opportunity_id: oppDoOutro, title: 'Cruzada' })).status, 400, 'lead e oportunidade de empresas diferentes');
   let lista = (await request('/api/commercial/tasks?lead_id=' + id)).body.tasks;
   const minha = lista.find(x => x.id === c.body.id);
   assert.equal(minha.source, 'manual'); assert.equal(minha.owner_name, 'Dono um'); assert.equal(minha.done_at, null);
   assert.equal((await request('/api/commercial/tasks/' + minha.id, 'PUT', { version: minha.version, done: true })).status, 200);
   assert.equal((await request('/api/commercial/tasks/' + minha.id, 'PUT', { version: minha.version, done: false })).status, 409, 'versão velha');
   lista = (await request('/api/commercial/tasks?lead_id=' + id + '&status=done')).body.tasks;
   assert.deepEqual(lista.map(x => x.title), ['Mandar o portfólio']); assert.ok(lista[0].done_at);
   assert.equal((await request('/api/commercial/tasks?lead_id=' + id + '&status=open')).body.tasks.some(x => x.id === minha.id), false);
   assert.equal((await request('/api/commercial/tasks/' + minha.id, 'PUT', { version: lista[0].version, done: false })).status, 200);
   assert.equal((await request('/api/commercial/tasks/' + minha.id, 'PUT', { version: lista[0].version + 1, title: 'x' })).status, 400);
   assert.equal((await request('/api/commercial/tasks/' + randomUUID(), 'PUT', { version: 1 })).status, 404);
   assert.equal((await request('/api/commercial/tasks?lead_id=' + id, 'GET', null, { cookie: '' })).status, 401);
   const detalhe = await lead(id);
   assert.ok(detalhe.tasks.some(x => x.id === minha.id && x.owner_name === 'Dono um'));
  });
 } finally {
  // Desliga tudo o que o teste criou: nenhuma automação sobra ligada para os arquivos seguintes.
  await pool.query('UPDATE automations SET is_enabled=false WHERE id = ANY($1::uuid[])', [criadas]).catch(() => {});
  server.closeAllConnections(); await new Promise(r => server.close(r)); await pool.end();
 }
});
