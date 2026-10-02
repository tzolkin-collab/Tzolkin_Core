import test from 'node:test';
import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import { readFileSync } from 'node:fs';
import pg from 'pg';
import { createCore } from '../apps/api/src/app.mjs';
import { DEFAULT_STAGES } from '../apps/api/src/modules/commercial-pipelines.mjs';

// A semente da migração 040 e DEFAULT_STAGES (usada ao criar um funil pela API) são duas escritas da mesma lista.
test('a semente da migração 040 e DEFAULT_STAGES são a mesma lista de etapas', () => {
 const sql = readFileSync(new URL('../db/migrations/040_funil_por_espaco.sql', import.meta.url), 'utf8');
 const inicio = sql.indexOf('(VALUES'), fim = sql.indexOf(') AS s(name');
 assert.ok(inicio > 0 && fim > inicio, 'bloco VALUES da semente não encontrado');
 const bloco = sql.slice(inicio, fim);
 const linhas = [...bloco.matchAll(/\('([^']+)',\s*'([A-Z]+)',\s*\d+,\s*([0-9]+|NULL::integer)\)/g)].map(m => [m[1], m[2], m[3].startsWith('NULL') ? null : Number(m[3])]);
 assert.deepEqual(linhas, DEFAULT_STAGES);
});

test('funil por espaço: migração, funis, etapas, oportunidades e chegada do lead, contra PostgreSQL isolado', async t => {
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
 const intake = (corpo, k = randomUUID()) => request('/v1/commercial/intake', 'POST', corpo, { authorization: 'Bearer ' + key.api_key, 'idempotency-key': k, origin: '', cookie: '' });
 const lead = (utm_tzolkin, extra = {}) => {
  const ref = randomUUID();
  return {
   lead: { name: 'Pessoa de teste', email: `funil-${ref.slice(0, 8)}@example.invalid`, whatsapp: '5511999999999', message: 'Teste' },
   organization: { organization_type: 'person' },
   commercial: { product_id: 'sites', service_model: 'on_demand', label: 'Teste de funil' },
   attribution: { source_system: 'tzolkin-site', source_ref: ref, channel: 'institutional-form', ...(utm_tzolkin ? { utm_tzolkin } : {}), ...extra },
   privacy: { contact_allowed: false, source: 'teste' },
  };
 };
 const ordem = async pipelineId => (await pool.query('SELECT name,kind,position FROM pipeline_stages WHERE pipeline_id=$1 ORDER BY position', [pipelineId])).rows;
 const lista = async space => (await request('/api/commercial/pipelines?space_id=' + space)).body.pipelines;
 let padrao, corretor;
 try {
  await t.test('sem sessão é 401; depois do login a chave de intake do Sites é emitida', async () => {
   assert.equal((await request('/api/commercial/pipelines')).status, 401);
   const login = await fetch(origin + '/api/login', { method: 'POST', headers: { 'content-type': 'application/json', origin }, body: JSON.stringify({ password }) });
   cookie = login.headers.get('set-cookie').split(';')[0];
   const emitida = await request('/api/app-clients', 'POST', { product_id: 'sites', label: 'Teste de funil', scopes: ['commercial:intake'], expires_at: new Date(Date.now() + 86400000).toISOString() });
   assert.equal(emitida.status, 200, JSON.stringify(emitida.body));
   key = emitida.body;
  });

  await t.test('a migração semeou o funil padrão com as 8 etapas nos espaços comerciais, e não no interno', async () => {
   const sites = await lista('sites');
   padrao = sites.find(p => p.slug === 'padrao');
   assert.ok(padrao, 'o espaço sites deve ter o funil padrão semeado');
   assert.equal(padrao.slug, 'padrao'); assert.equal(padrao.is_default, true); assert.equal(padrao.space_name.length > 0, true);
   assert.deepEqual(padrao.stages.map(s => [s.name, s.kind, s.probability]), DEFAULT_STAGES);
   // A suíte completa divide um só banco entre arquivos: os números das etapas podem já ter leads de outro teste.
   assert.ok(padrao.stages.every(s => Number.isInteger(s.leads) && Number.isInteger(s.opportunities) && Number.isFinite(s.value_minor)));
   assert.equal((await lista('core')).length, 0, 'espaço interno não tem funil');
   const sem = (await pool.query("SELECT count(*)::int n FROM pipelines p JOIN products x ON x.id=p.space_id WHERE x.portfolio_kind='internal'")).rows[0].n;
   assert.equal(sem, 0);
  });

  await t.test('criar funil: etapas padrão, não é o padrão, identificador único por espaço, só em espaço comercial', async () => {
   const criado = await request('/api/commercial/pipelines', 'POST', { space_id: 'sites', slug: 'corretor', name: 'Corretores', offer_name: 'Landing page para corretor' });
   assert.equal(criado.status, 200, JSON.stringify(criado.body));
   corretor = (await lista('sites')).find(p => p.slug === 'corretor');
   assert.equal(corretor.is_default, false);
   assert.deepEqual(corretor.stages.map(s => s.name), DEFAULT_STAGES.map(s => s[0]));
   assert.equal((await request('/api/commercial/pipelines', 'POST', { space_id: 'sites', slug: 'corretor', name: 'Outro' })).status, 409);
   assert.equal((await request('/api/commercial/pipelines', 'POST', { space_id: 'core', slug: 'x', name: 'Funil interno' })).status, 409);
   assert.equal((await request('/api/commercial/pipelines', 'POST', { space_id: 'sites', slug: 'Maiúscula', name: 'Ruim' })).status, 400);
   assert.equal((await request('/api/commercial/pipelines', 'POST', { space_id: 'sites', slug: 'x', name: 'Ok', tenant_id: randomUUID() })).status, 400);
   assert.equal((await request('/api/commercial/pipelines', 'POST', { space_id: 'nao-existe', slug: 'x', name: 'Ok' })).status, 404);
  });

  await t.test('funil padrão: troca, nunca fica sem, arquivar o padrão é recusado, versão otimista', async () => {
   assert.equal((await request('/api/commercial/pipelines/' + corretor.id, 'PUT', { version: corretor.version + 5, name: 'X' })).status, 409);
   assert.equal((await request('/api/commercial/pipelines/' + padrao.id, 'PUT', { version: padrao.version, is_active: false })).status, 409);
   assert.equal((await request('/api/commercial/pipelines/' + padrao.id, 'PUT', { version: padrao.version, is_default: false })).status, 409);
   assert.equal((await request('/api/commercial/pipelines/' + corretor.id, 'PUT', { version: corretor.version, is_default: true })).status, 200);
   let atuais = await lista('sites');
   assert.equal(atuais.find(p => p.slug === 'corretor').is_default, true);
   assert.equal(atuais.find(p => p.slug === 'padrao').is_default, false);
   // volta ao original para os próximos testes
   const p1 = atuais.find(p => p.slug === 'padrao');
   assert.equal((await request('/api/commercial/pipelines/' + p1.id, 'PUT', { version: p1.version, is_default: true })).status, 200);
   atuais = await lista('sites');
   padrao = atuais.find(p => p.slug === 'padrao'); corretor = atuais.find(p => p.slug === 'corretor');
   assert.equal(atuais.filter(p => p.is_default).length, 1);
   // arquivar o que não é padrão é permitido e reversível
   assert.equal((await request('/api/commercial/pipelines/' + corretor.id, 'PUT', { version: corretor.version, is_active: false })).status, 200);
   corretor = (await lista('sites')).find(p => p.slug === 'corretor');
   assert.equal(corretor.is_active, false);
   assert.equal((await request('/api/commercial/pipelines/' + corretor.id, 'PUT', { version: corretor.version, is_default: true })).status, 409, 'funil arquivado não vira padrão');
   assert.equal((await request('/api/commercial/pipelines/' + corretor.id, 'PUT', { version: corretor.version, is_active: true })).status, 200);
   corretor = (await lista('sites')).find(p => p.slug === 'corretor');
  });

  await t.test('etapas: entram no fim do próprio tipo, nome único, WON e LOST únicas, reordenar dentro do tipo, ordem sempre LEAD, OPEN, WON, LOST', async () => {
   const base = '/api/commercial/pipelines/' + corretor.id + '/stages';
   assert.equal((await request(base, 'POST', { name: 'Visita', kind: 'OPEN', probability: 50 })).status, 200);
   let nomes = (await ordem(corretor.id)).map(s => s.name);
   assert.deepEqual(nomes, ['Novos', 'Em contato', 'Qualificação', 'Proposta', 'Negociação', 'Assinatura do contrato', 'Visita', 'Ganho', 'Perdido']);
   assert.equal((await request(base, 'POST', { name: 'visita', kind: 'OPEN' })).status, 409, 'nome repetido, sem diferenciar caixa');
   assert.equal((await request(base, 'POST', { name: 'Outro ganho', kind: 'WON' })).status, 409);
   assert.equal((await request(base, 'POST', { name: 'Outra perda', kind: 'LOST' })).status, 409);
   assert.equal((await request(base, 'POST', { name: 'Triagem', kind: 'LEAD' })).status, 200);
   nomes = (await ordem(corretor.id)).map(s => s.name);
   assert.deepEqual(nomes.slice(0, 3), ['Novos', 'Em contato', 'Triagem']);
   const antes = await ordem(corretor.id);
   const visita = (await lista('sites')).find(p => p.slug === 'corretor').stages.find(s => s.name === 'Visita');
   // mover a Visita para o início das etapas OPEN
   assert.equal((await request(`${base}/${visita.id}`, 'PUT', { position: 0, color: '#112233', stale_days: 7 })).status, 200);
   const depois = await ordem(corretor.id);
   assert.deepEqual(depois.map(s => s.name), ['Novos', 'Em contato', 'Triagem', 'Visita', 'Qualificação', 'Proposta', 'Negociação', 'Assinatura do contrato', 'Ganho', 'Perdido']);
   assert.ok(depois.every((s, i) => s.position === i), 'posições contíguas');
   const ranks = { LEAD: 0, OPEN: 1, WON: 2, LOST: 3 };
   assert.ok(depois.every((s, i) => i === 0 || ranks[s.kind] >= ranks[depois[i - 1].kind]), 'tipos em ordem');
   assert.equal(antes.length + 0, depois.length);
   assert.equal((await request(`${base}/${visita.id}`, 'PUT', { position: 99 })).status, 400);
   assert.equal((await request(`${base}/${visita.id}`, 'PUT', { name: 'Proposta' })).status, 409);
   assert.equal((await request(`${base}/${visita.id}`, 'PUT', { color: 'vermelho' })).status, 400);
   assert.equal((await request(`${base}/${visita.id}`, 'PUT', { kind: 'WON' })).status, 400, 'o tipo da etapa não muda');
  });

  await t.test('apagar etapa: só vazia e nunca a última do tipo', async () => {
   const base = '/api/commercial/pipelines/' + corretor.id + '/stages';
   const etapas = (await lista('sites')).find(p => p.slug === 'corretor').stages;
   const triagem = etapas.find(s => s.name === 'Triagem'), ganho = etapas.find(s => s.kind === 'WON');
   assert.equal((await request(`${base}/${ganho.id}`, 'DELETE')).status, 409, 'última etapa de ganho');
   assert.equal((await request(`${base}/${triagem.id}`, 'DELETE')).status, 200);
   assert.deepEqual((await ordem(corretor.id)).map(s => s.position), [...Array(9).keys()]);
   assert.equal((await request(`${base}/${randomUUID()}`, 'DELETE')).status, 404);
  });

  await t.test('lead novo entra no funil do espaço: padrão, e o nicho do utm_tzolkin escolhe o funil de mesmo slug', async () => {
   const antes = (await lista('sites')).find(p => p.slug === 'padrao').stages.find(s => s.name === 'Novos').leads;
   const semUtm = await intake(lead());
   assert.equal(semUtm.status, 200, JSON.stringify(semUtm.body));
   const nicho = await intake(lead('sites.corretor'));
   assert.equal(nicho.status, 200, JSON.stringify(nicho.body));
   const inexistente = await intake(lead('sites.nao-existe'));
   const outroEspaco = await intake(lead('skiller.corretor'));
   assert.equal(inexistente.status, 200); assert.equal(outroEspaco.status, 200);
   const atual = await lista('sites');
   const idPadrao = atual.find(p => p.slug === 'padrao'), idCorretor = atual.find(p => p.slug === 'corretor');
   const novos = p => p.stages.find(s => s.name === 'Novos').leads;
   assert.equal(novos(idCorretor), 1, 'só o lead do nicho corretor');
   assert.equal(novos(idPadrao) - antes, 3, 'sem utm, nicho inexistente e prefixo de outro espaço caem no padrão');
   // a listagem de leads filtra por funil e etapa
   const porFunil = await request('/api/commercial/leads?pipeline_id=' + idCorretor.id);
   assert.equal(porFunil.body.leads.length, 1);
   assert.equal(porFunil.body.leads[0].stage_id, idCorretor.stages.find(s => s.name === 'Novos').id);
   // A contagem da etapa conta leads abertos, e a tela pede só os abertos ao filtrar por etapa: os dois precisam bater.
   const porEtapa = await request('/api/commercial/leads?limit=100&status=open&stage_id=' + idPadrao.stages.find(s => s.name === 'Novos').id);
   assert.equal(porEtapa.body.leads.length, antes + 3);
   assert.equal((await request('/api/commercial/leads?stage_id=nao-uuid')).status, 400);
   const l = (await pool.query('SELECT origin,was_seen FROM commercial_leads WHERE id=$1', [nicho.body.lead_id])).rows[0];
   assert.deepEqual(l, { origin: 'INBOUND', was_seen: false });
  });

  await t.test('etapa com lead dentro não se apaga', async () => {
   const funil = (await lista('sites')).find(p => p.slug === 'corretor');
   const novos = funil.stages.find(s => s.name === 'Novos');
   assert.equal((await request(`/api/commercial/pipelines/${funil.id}/stages/${novos.id}`, 'DELETE')).status, 409);
  });

  await t.test('espaço sem funil ativo: o lead entra sem funil, como antes', async () => {
   await pool.query("UPDATE pipelines SET is_active=false, is_default=false WHERE space_id='sites'");
   const r = await intake(lead());
   assert.equal(r.status, 200);
   const row = (await pool.query('SELECT pipeline_id,stage_id FROM commercial_leads WHERE id=$1', [r.body.lead_id])).rows[0];
   assert.deepEqual(row, { pipeline_id: null, stage_id: null });
   await pool.query("UPDATE pipelines SET is_active=true WHERE space_id='sites'");
   await pool.query("UPDATE pipelines SET is_default=true WHERE id=$1", [padrao.id]);
  });

  await t.test('oportunidades: criar manual, mover, perder exige motivo, fechar e reabrir, versão otimista', async () => {
   const tenant = (await pool.query('SELECT id FROM tenants ORDER BY created_at LIMIT 1')).rows[0].id;
   const funil = (await lista('sites')).find(p => p.slug === 'padrao');
   const etapa = nome => funil.stages.find(s => s.name === nome).id;
   const criada = await request('/api/commercial/opportunities', 'POST', { pipeline_id: funil.id, tenant_id: tenant, title: 'Site institucional', value_minor: 450000, expected_close_at: '2026-12-01T00:00:00Z' });
   assert.equal(criada.status, 200, JSON.stringify(criada.body));
   const id = criada.body.id;
   const ver = async () => (await request('/api/commercial/opportunities?pipeline_id=' + funil.id)).body.opportunities.find(o => o.id === id);
   let o = await ver();
   assert.equal(o.stage_name, 'Qualificação'); assert.equal(o.origin, 'OUTBOUND'); assert.equal(o.value_minor, 450000); assert.equal(o.version, 1);
   // validações
   assert.equal((await request('/api/commercial/opportunities', 'POST', { pipeline_id: funil.id, tenant_id: tenant, title: 'x', value_minor: -1 })).status, 400);
   assert.equal((await request('/api/commercial/opportunities', 'POST', { pipeline_id: funil.id, tenant_id: tenant, title: 'Ok', value_minor: 1.5 })).status, 400, 'centavos inteiros');
   assert.equal((await request('/api/commercial/opportunities', 'POST', { pipeline_id: funil.id, tenant_id: randomUUID(), title: 'Ok' })).status, 404);
   const mover = (corpo, v = o.version) => request(`/api/commercial/opportunities/${id}/move`, 'PUT', { version: v, ...corpo });
   assert.equal((await mover({ stage_id: etapa('Proposta') }, 99)).status, 409);
   assert.equal((await mover({ stage_id: etapa('Qualificação') })).status, 400, 'já está nesta etapa');
   assert.equal((await mover({ stage_id: etapa('Novos') })).status, 400, 'não volta para etapa de lead');
   assert.equal((await mover({ stage_id: corretor.stages[0].id })).status, 400, 'etapa de outro funil');
   assert.equal((await mover({ stage_id: etapa('Proposta') })).status, 200);
   o = await ver(); assert.equal(o.stage_name, 'Proposta'); assert.equal(o.version, 2); assert.equal(o.closed_at, null);
   // perder
   assert.equal((await mover({ stage_id: etapa('Perdido') })).status, 400, 'sem motivo');
   assert.equal((await mover({ stage_id: etapa('Perdido'), lost_reason_id: randomUUID() })).status, 400, 'motivo inexistente');
   assert.equal((await mover({ stage_id: etapa('Negociação'), lost_reason_id: randomUUID() })).status, 400, 'motivo fora da etapa de perda');
   const motivo = (await pool.query("SELECT id FROM lost_reasons WHERE name='Sem orçamento'")).rows[0].id;
   assert.equal((await mover({ stage_id: etapa('Perdido'), lost_reason_id: motivo })).status, 200);
   o = await ver(); assert.equal(o.stage_kind, 'LOST'); assert.ok(o.closed_at); assert.equal(o.lost_reason_id, motivo);
   // reabrir limpa o fechamento e o motivo
   assert.equal((await mover({ stage_id: etapa('Negociação') })).status, 200);
   o = await ver(); assert.equal(o.closed_at, null); assert.equal(o.lost_reason_id, null);
   // ganhar fecha (a suíte divide um só banco entre arquivos: os totais da etapa se comparam por diferença)
   const ganhoAntes = (await lista('sites')).find(p => p.slug === 'padrao').stages.find(s => s.name === 'Ganho');
   assert.equal((await mover({ stage_id: etapa('Ganho') })).status, 200);
   o = await ver(); assert.equal(o.stage_kind, 'WON'); assert.ok(o.closed_at);
   // totais por etapa e filtros
   const totais = (await lista('sites')).find(p => p.slug === 'padrao').stages.find(s => s.name === 'Ganho');
   assert.equal(totais.opportunities - ganhoAntes.opportunities, 1); assert.equal(totais.value_minor - ganhoAntes.value_minor, 450000);
   assert.ok((await request('/api/commercial/opportunities?stage_id=' + etapa('Ganho'))).body.opportunities.some(x => x.id === id));
   assert.equal((await request('/api/commercial/opportunities?limit=0')).status, 400);
   assert.equal((await request('/api/commercial/opportunities?x=1')).status, 400);
  });
 } finally { server.closeAllConnections(); await new Promise(r => server.close(r)); await pool.end(); }
});
