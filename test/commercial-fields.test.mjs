import test from 'node:test';
import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import pg from 'pg';
import { createCore } from '../apps/api/src/app.mjs';

// Fase 4: campos próprios por espaço (definição, space_data no intake, edição e levar adiante), contra PostgreSQL isolado.
test('campos próprios por espaço, contra PostgreSQL isolado', async t => {
 const url = process.env.DATABASE_URL_TEST;
 if (!url || !/^\/tzolkin_test_commercial_[0-9a-f]{12}$/.test(new URL(url).pathname)) return t.skip('DATABASE_URL_TEST dedicada não configurada');
 const pool = new pg.Pool({ connectionString: url, max: 6 });
 const password = 'test-only-bootstrap-' + randomUUID();
 const server = createCore({ pool, adminPassword: password });
 await new Promise(r => server.listen(0, '127.0.0.1', r));
 const origin = 'http://127.0.0.1:' + server.address().port;
 const marca = randomUUID().slice(0, 8);
 let cookie; const chaves = {};
 const request = async (path, method = 'GET', body, headers = {}) => {
  const r = await fetch(origin + path, { method, headers: { 'content-type': 'application/json', origin, cookie: cookie || '', ...headers }, ...(body ? { body: JSON.stringify(body) } : {}) });
  return { status: r.status, body: await r.json() };
 };
 const intake = (espaco, corpo) => request('/v1/commercial/intake', 'POST', corpo, { authorization: 'Bearer ' + chaves[espaco].api_key, 'idempotency-key': randomUUID(), origin: '', cookie: '' });
 const payload = (espaco, rotulo, spaceData) => ({
  lead: { name: `Pessoa ${rotulo}`, email: `campos-${rotulo}-${marca}@example.invalid`, whatsapp: '5511999990000' },
  organization: { name: `Empresa ${rotulo} ${marca}`, organization_type: 'company' },
  commercial: { product_id: espaco, service_model: 'on_demand', label: 'Teste de campos' },
  attribution: { source_system: 'tzolkin-site', source_ref: randomUUID(), channel: 'institutional-form' },
  privacy: { contact_allowed: false, source: 'teste' },
  ...(spaceData === undefined ? {} : { space_data: spaceData }),
 });
 const campo = (space_id, entity, key, type, extra = {}) => request('/api/commercial/space-fields', 'POST', { space_id, entity, key, label: key.toUpperCase().replace(/_/g, ' '), type, ...extra });
 const campos = async (space, entity) => (await request(`/api/commercial/space-fields?space_id=${space}&entity=${entity}`)).body.fields;
 const leadRow = async id => (await pool.query('SELECT * FROM commercial_leads WHERE id=$1', [id])).rows[0];
 const detalhe = async id => (await request('/api/commercial/leads/' + id)).body;
 const k = nome => `${nome}_${marca}`;
 try {
  await t.test('prepara: chaves de intake de Sites e Mentorias; a migração semeou os 4 campos do formulário do site', async () => {
   const login = await fetch(origin + '/api/login', { method: 'POST', headers: { 'content-type': 'application/json', origin }, body: JSON.stringify({ password }) });
   cookie = login.headers.get('set-cookie').split(';')[0];
   for (const espaco of ['sites', 'mentorias']) {
    const e = await request('/api/app-clients', 'POST', { product_id: espaco, label: 'Teste de campos', scopes: ['commercial:intake'], expires_at: new Date(Date.now() + 86400000).toISOString() });
    assert.equal(e.status, 200, JSON.stringify(e.body)); chaves[espaco] = e.body;
   }
   const sites = (await campos('sites', 'lead')).filter(f => ['porte', 'funcionarios', 'instagram', 'site'].includes(f.key));
   assert.deepEqual(sites.map(f => [f.key, f.type, f.required, f.is_active]), [['porte', 'TEXT', false, true], ['funcionarios', 'TEXT', false, true], ['instagram', 'TEXT', false, true], ['site', 'TEXT', false, true]]);
   assert.equal((await request('/api/commercial/space-fields', 'GET', null, { cookie: '' })).status, 401);
  });

  await t.test('definir campo: tipos, lista com opções, chave única por espaço e entidade, só espaço comercial', async () => {
   for (const [tipo, extra] of [['TEXT', {}], ['NUMBER', {}], ['DATE', {}], ['BOOLEAN', {}], ['LINK', {}], ['SELECT', { options: ['A', 'B'] }], ['MULTISELECT', { options: ['X', 'Y'] }]]) {
    const r = await campo('sites', 'lead', k('tipo_' + tipo.toLowerCase()), tipo, extra);
    assert.equal(r.status, 200, `${tipo}: ${JSON.stringify(r.body)}`);
   }
   assert.equal((await campo('sites', 'lead', k('tipo_text'), 'TEXT')).status, 409, 'chave repetida no mesmo espaço e entidade');
   assert.equal((await campo('sites', 'opportunity', k('tipo_text'), 'TEXT')).status, 200, 'a mesma chave vale em outra entidade');
   assert.equal((await campo('mentorias', 'lead', k('tipo_text'), 'TEXT')).status, 200, 'e em outro espaço');
   assert.equal((await campo('sites', 'lead', k('sem_opcoes'), 'SELECT')).status, 400);
   assert.equal((await campo('sites', 'lead', k('texto_com_opcoes'), 'TEXT', { options: ['A'] })).status, 400);
   assert.equal((await campo('sites', 'lead', 'Chave Ruim', 'TEXT')).status, 400);
   assert.equal((await campo('sites', 'cliente', k('x'), 'TEXT')).status, 400);
   assert.equal((await campo('core', 'lead', k('interno'), 'TEXT')).status, 409, 'espaço interno não tem ciclo comercial');
   assert.equal((await campo('nao-existe', 'lead', k('x'), 'TEXT')).status, 404);
   assert.equal((await request('/api/commercial/space-fields', 'POST', { space_id: 'sites', entity: 'lead', key: k('extra'), label: 'Extra', type: 'TEXT', ordem: 1 })).status, 400);
  });

  await t.test('editar campo: rótulo, ativo e versão; chave, tipo e entidade não mudam; nada se apaga', async () => {
   const f = (await campos('sites', 'lead')).find(x => x.key === k('tipo_text'));
   assert.equal((await request(`/api/commercial/space-fields/${f.id}`, 'PUT', { version: f.version, label: 'Rótulo novo', required: false })).status, 200);
   assert.equal((await request(`/api/commercial/space-fields/${f.id}`, 'PUT', { version: f.version, label: 'Velha' })).status, 409, 'versão velha');
   for (const proibido of [{ key: 'outra' }, { type: 'NUMBER' }, { entity: 'opportunity' }, { space_id: 'mentorias' }])
    assert.equal((await request(`/api/commercial/space-fields/${f.id}`, 'PUT', { version: f.version + 1, ...proibido })).status, 400, JSON.stringify(proibido));
   assert.equal((await request(`/api/commercial/space-fields/${randomUUID()}`, 'PUT', { version: 1 })).status, 404);
   assert.equal((await request(`/api/commercial/space-fields/${f.id}`, 'DELETE')).status, 405, 'não existe rota de apagar');
   assert.equal((await campos('sites', 'lead')).find(x => x.id === f.id).label, 'Rótulo novo');
  });

  await t.test('intake com space_data guarda os valores no lead, e o reenvio idêntico devolve o mesmo lead', async () => {
   const dados = { porte: 'Pequena', funcionarios: '11-50', instagram: '@exemplo', site: 'exemplo.com.br', [k('tipo_number')]: 12.5, [k('tipo_date')]: '2026-10-02', [k('tipo_boolean')]: true, [k('tipo_link')]: 'https://exemplo.com', [k('tipo_select')]: 'B', [k('tipo_multiselect')]: ['X', 'Y'] };
   const corpo = payload('sites', 'completo', dados);
   const chave = randomUUID();
   const r = await request('/v1/commercial/intake', 'POST', corpo, { authorization: 'Bearer ' + chaves.sites.api_key, 'idempotency-key': chave, origin: '', cookie: '' });
   assert.equal(r.status, 200, JSON.stringify(r.body));
   assert.deepEqual((await leadRow(r.body.lead_id)).custom_data, dados);
   const repetido = await request('/v1/commercial/intake', 'POST', corpo, { authorization: 'Bearer ' + chaves.sites.api_key, 'idempotency-key': chave, origin: '', cookie: '' });
   assert.equal(repetido.body.lead_id, r.body.lead_id);
   const outraChave = await request('/v1/commercial/intake', 'POST', { ...corpo, space_data: { ...dados, porte: 'Grande' } }, { authorization: 'Bearer ' + chaves.sites.api_key, 'idempotency-key': chave, origin: '', cookie: '' });
   assert.equal(outraChave.status, 409, 'mesma chave de idempotência com outro conteúdo');
   // sem space_data o lead nasce com custom_data vazio, como antes
   const sem = await intake('sites', payload('sites', 'sem-dados'));
   assert.equal(sem.status, 200); assert.deepEqual((await leadRow(sem.body.lead_id)).custom_data, {});
   // vazio some, não vira chave
   const vazio = await intake('sites', payload('sites', 'vazio', { porte: '', instagram: null, funcionarios: '5' }));
   assert.deepEqual((await leadRow(vazio.body.lead_id)).custom_data, { funcionarios: '5' });
  });

  await t.test('intake recusa chave desconhecida, valor do tipo errado e space_data que não é objeto; nada é criado', async () => {
   const antes = (await pool.query("SELECT count(*)::int n FROM commercial_leads WHERE email LIKE $1", [`%-${marca}@example.invalid`])).rows[0].n;
   const tenantsAntes = (await pool.query('SELECT count(*)::int n FROM tenants')).rows[0].n;
   for (const ruim of [{ nao_existe: 'x' }, { [k('tipo_number')]: '12' }, { [k('tipo_select')]: 'C' }, { [k('tipo_date')]: '2026-02-30' }, { [k('tipo_link')]: 'exemplo.com' }, { [k('tipo_multiselect')]: ['Z'] }, 'texto', ['a']]) {
    const r = await intake('sites', payload('sites', 'ruim', ruim));
    assert.equal(r.status, 400, `${JSON.stringify(ruim)} → ${r.status} ${JSON.stringify(r.body)}`);
   }
   assert.equal((await pool.query("SELECT count(*)::int n FROM commercial_leads WHERE email LIKE $1", [`%-${marca}@example.invalid`])).rows[0].n, antes);
   assert.equal((await pool.query('SELECT count(*)::int n FROM tenants')).rows[0].n, tenantsAntes, 'a recusa não deixa empresa órfã');
   // campo de outro espaço não vale neste: a chave do tipo_text existe em mentorias, mas esta é de outro campo
   assert.equal((await intake('mentorias', payload('mentorias', 'cruzado', { porte: 'x' }))).status, 400, 'porte é campo do Sites, não de Mentorias');
  });

  await t.test('campo obrigatório: sem ele o intake é 400; desativado, deixa de valer; valor que já existe fica', async () => {
   const criado = await campo('mentorias', 'lead', k('obrigatorio'), 'TEXT', { required: true });
   assert.equal(criado.status, 200, JSON.stringify(criado.body));
   const sem = await intake('mentorias', payload('mentorias', 'sem-obrigatorio'));
   assert.equal(sem.status, 400); assert.match(sem.body.message, /obrigat/i);
   const com = await intake('mentorias', payload('mentorias', 'com-obrigatorio', { [k('obrigatorio')]: 'preenchido' }));
   assert.equal(com.status, 200, JSON.stringify(com.body));
   const f = (await campos('mentorias', 'lead')).find(x => x.key === k('obrigatorio'));
   assert.equal((await request(`/api/commercial/space-fields/${f.id}`, 'PUT', { version: f.version, is_active: false })).status, 200);
   assert.equal((await intake('mentorias', payload('mentorias', 'depois-de-desativar'))).status, 200, 'desativado não é mais exigido');
   assert.equal((await intake('mentorias', payload('mentorias', 'valor-em-desativado', { [k('obrigatorio')]: 'x' }))).status, 400, 'nem recebe valor novo');
   assert.deepEqual((await leadRow(com.body.lead_id)).custom_data, { [k('obrigatorio')]: 'preenchido' }, 'o valor antigo continua no lead');
   const detail = await detalhe(com.body.lead_id);
   assert.ok(detail.fields.some(x => x.key === k('obrigatorio') && x.is_active === false), 'o detalhe mostra o campo desativado, para o valor antigo aparecer');
  });

  await t.test('editar os valores de um lead: define, apaga, preserva o desativado, valida tipo e versão', async () => {
   const r = await intake('sites', payload('sites', 'edicao', { porte: 'Micro', instagram: '@antes' }));
   const id = r.body.lead_id;
   const edita = async (custom_data, version) => request(`/api/commercial/custom-data/lead/${id}`, 'PUT', { version: version ?? (await leadRow(id)).version, custom_data });
   assert.equal((await edita({ porte: 'Média', funcionarios: '51-200', instagram: '' })).status, 200);
   assert.deepEqual((await leadRow(id)).custom_data, { porte: 'Média', funcionarios: '51-200' });
   assert.equal((await edita({ [k('tipo_number')]: 'abc' })).status, 400);
   assert.equal((await edita({ nao_existe: 1 })).status, 400);
   assert.equal((await edita({ porte: 'x' }, 1)).status, 409, 'versão velha');
   assert.equal((await request(`/api/commercial/custom-data/pessoa/${id}`, 'PUT', { version: 1, custom_data: {} })).status, 404);
   assert.equal((await request(`/api/commercial/custom-data/lead/${id}`, 'PUT', { version: 1, custom_data: {}, extra: 1 })).status, 400);
   assert.ok((await detalhe(id)).activities.some(a => a.kind === 'custom_data_changed'));
   // campo obrigatório ativo não pode ser apagado na edição
   const obrig = await campo('sites', 'lead', k('exigido_na_edicao'), 'TEXT', { required: true });
   const exigido = (await campos('sites', 'lead')).find(x => x.key === k('exigido_na_edicao'));
   assert.equal((await edita({ [k('exigido_na_edicao')]: 'ok' })).status, 200);
   assert.equal((await edita({ [k('exigido_na_edicao')]: '' })).status, 400, 'não deixa apagar o obrigatório');
   assert.equal((await edita({ porte: 'Grande' })).status, 200, 'editar outro campo não exige o resto');
   assert.equal((await request(`/api/commercial/space-fields/${exigido.id}`, 'PUT', { version: exigido.version, required: false, is_active: false })).status, 200, obrig.status);
  });

  await t.test('os valores sobem do lead para a oportunidade e para a contratação, só onde o espaço define o mesmo campo', async () => {
   const chave = k('orcamento');
   for (const entidade of ['lead', 'opportunity', 'engagement']) assert.equal((await campo('sites', entidade, chave, 'NUMBER')).status, 200);
   assert.equal((await campo('sites', 'lead', k('so_no_lead'), 'TEXT')).status, 200);
   assert.equal((await campo('sites', 'lead', k('tipo_diferente'), 'TEXT')).status, 200);
   assert.equal((await campo('sites', 'opportunity', k('tipo_diferente'), 'NUMBER')).status, 200);
   const r = await intake('sites', payload('sites', 'sobe', { [chave]: 5000, [k('so_no_lead')]: 'fica', [k('tipo_diferente')]: 'texto' }));
   assert.equal(r.status, 200, JSON.stringify(r.body));
   const id = r.body.lead_id;
   const q = await request(`/api/commercial/leads/${id}/qualify`, 'POST', { version: (await leadRow(id)).version, value_minor: 100000 });
   assert.equal(q.status, 200, JSON.stringify(q.body));
   const opp = (await pool.query('SELECT * FROM commercial_opportunities WHERE lead_id=$1', [id])).rows[0];
   assert.deepEqual(opp.custom_data, { [chave]: 5000 }, 'só o campo que a oportunidade também define, com o mesmo tipo');
   // edita na oportunidade e ganha: a contratação recebe o valor da oportunidade
   assert.equal((await request(`/api/commercial/custom-data/opportunity/${opp.id}`, 'PUT', { version: opp.version, custom_data: { [chave]: 7500 } })).status, 200);
   const ganho = (await pool.query("SELECT id FROM pipeline_stages WHERE pipeline_id=$1 AND kind='WON'", [opp.pipeline_id])).rows[0].id;
   const atual = (await pool.query('SELECT version FROM commercial_opportunities WHERE id=$1', [opp.id])).rows[0].version;
   const g = await request(`/api/commercial/opportunities/${opp.id}/move`, 'PUT', { version: atual, stage_id: ganho });
   assert.equal(g.status, 200, JSON.stringify(g.body));
   const eng = (await pool.query('SELECT * FROM client_engagements WHERE id=$1', [g.body.engagement_id])).rows[0];
   assert.deepEqual(eng.custom_data, { [chave]: 7500 });
   // e a contratação tem edição própria, pela mesma rota, com a coluna `revision`
   assert.equal((await request(`/api/commercial/custom-data/engagement/${eng.id}`, 'PUT', { version: eng.revision, custom_data: { [chave]: 9000 } })).status, 200);
   assert.equal((await pool.query('SELECT custom_data FROM client_engagements WHERE id=$1', [eng.id])).rows[0].custom_data[chave], 9000);
   const d = await detalhe(id);
   assert.equal(d.opportunity.custom_data[chave], 7500); assert.equal(d.opportunity.engagement_custom_data[chave], 9000);
   assert.ok(Number.isInteger(d.opportunity.engagement_revision));
  });
 } finally { server.closeAllConnections(); await new Promise(r => server.close(r)); await pool.end(); }
});
