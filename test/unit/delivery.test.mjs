import test from 'node:test';
import assert from 'node:assert/strict';
import { validateProject, projectIssues } from '../../apps/api/src/platform/delivery-model.mjs';
import { createGithubAdapter } from '../../apps/api/src/integrations/github.mjs';
import { createDeliveryOptions } from '../../apps/api/src/integrations/delivery-options.mjs';
import { createCore } from '../../apps/api/src/app.mjs';
import { deliveryRoutes, _internals } from '../../apps/api/src/modules/delivery.mjs';
import { CAPABILITIES } from '../../apps/api/src/modules/catalog.mjs';

const component = (overrides = {}) => ({ id:'web',name:'Web',kind:'frontend',path:'.',stack:'nextjs',runtime:'node',manager:'npm',build:'',start:'',output:'',port:null,depends_on:[],bindings:[],...overrides });
const project = (overrides = {}) => ({ name:'Synthetic project',owner:'Team',layout:'single',repository_id:null,components:[component()],...overrides });
const inventories = { github:{status:'ok',items:[{id:'12',name:'org/repo'}]},vercel:{status:'ok',items:[{id:'prj_1',name:'Web',type:'app'}]},easypanel:{status:'ok',items:[{id:'project/db',name:'DB',type:'postgres'}]} };
const binding = {environment:'production',provider:'vercel',target_id:'prj_1',branch:'main'};

test('drafts, monorepos and library dependencies have honest configuration state', () => {
 assert.ok(projectIssues(validateProject(project())).some(s => s.includes('Repositório')));
 const result = validateProject(project({layout:'monorepo',repository_id:'12',components:[component({depends_on:['ui'],bindings:[binding]}),component({id:'ui',kind:'library',path:'packages/ui'})]}));
 assert.equal(projectIssues(result).length,0);
 assert.equal(result.components[1].path,'packages/ui');
});

test('rejects invalid layouts, path traversal, duplicate identifiers, cycles and unknown fields', () => {
 const bad = [project({evil:true}),project({layout:'invalid'}),project({components:[component({path:'../secrets'})]}),
  project({components:[component({path:'C:/secret'})]}),project({components:[component({path:'apps/../web'})]}),
  project({layout:'monorepo',components:[component(),component()]}),project({components:[component({depends_on:['missing']})]}),
  project({layout:'monorepo',components:[component({depends_on:['api']}),component({id:'api',depends_on:['web']})]}),
  project({components:[component({kind:'library',bindings:[binding]})]}),project({components:[component({bindings:[binding,binding]})]}),
  project({components:[component({port:70000})]}),project({components:[component({token:'secret'})]}),
  project({components:[component({bindings:[{...binding,branch:'../bad'}]})]})];
 for (const input of bad) assert.throws(() => validateProject(input),e => e.status === 400);
});

test('GitHub pagination is read-only, whitelisted and bounded; failures hide secrets', async () => {
 let calls = 0;
 const adapter = createGithubAdapter({token:'synthetic-secret',fetchImpl:async(url,init) => {
  calls++; assert.match(url,/^https:\/\/api.github.com\/user\/repos\?/); assert.equal(init.method,'GET'); assert.equal(init.redirect,'error');
  return Response.json([{id:calls,full_name:`org/repo${calls}`,default_branch:'main',private:true,token:'hidden'}],{headers:calls===1 ? {link:'<next>; rel="next"'} : {}});
 }});
 const result = await adapter.listRepositories(); assert.equal(calls,2);assert.equal(result.repositories.length,2);assert.equal(result.truncated,false); assert.ok(!JSON.stringify(result).includes('hidden'));
 await assert.rejects(createGithubAdapter({token:'secret',fetchImpl:async()=>{throw Error('secret')}}).listRepositories(),e=>!e.message.includes('secret'));
 const capped = await createGithubAdapter({token:'test',fetchImpl:async()=>Response.json([],{headers:{link:'<next>; rel="next"'}})}).listRepositories();
 assert.equal(capped.truncated,true);
});

test('provider failures are isolated and options share a short cache', async () => {
 let calls = 0;
 const options = createDeliveryOptions({env:{GITHUB_TOKEN:'test',VERCEL_TOKEN:'test'},fetchImpl:async url=>{
  calls++;if(String(url).includes('github'))throw Error('secret');return Response.json({projects:[{id:'p',name:'Web',env:'secret'}]});
 }});
 const first = await options();await options();assert.equal(calls,2);assert.equal(first.github.status,'error');assert.equal(first.vercel.status,'ok');assert.equal(first.easypanel.status,'not_configured');assert.ok(!JSON.stringify(first).includes('secret'));
});

// ---------------------------------------------------------------------------
// Projeto técnico com dono
// ---------------------------------------------------------------------------
// O que os testes daqui para baixo protegem, regra por regra: o projeto NASCE de
// um dono que já existe (item do portfólio ou contratação) e nunca inventa item;
// o dono não troca por edição de cadastro; o checklist só pergunta o que o tipo do
// dono pode responder; ativar é o mesmo ato de /api/portfolio/:id/lifecycle, com a
// mesma permissão e a mesma trilha; e excluir virou arquivar, sem nenhum DELETE.

const ID_PROJETO = '11111111-1111-4111-8111-111111111111';
const CONTRATACAO = '22222222-2222-4222-8222-222222222222';
const ENCERRADA = '33333333-3333-4333-8333-333333333333';
const INEXISTENTE = '44444444-4444-4444-8444-444444444444';
const COM_PROJETO = '55555555-5555-4555-8555-555555555555';
const linhas = rows => ({ rows, rowCount: rows.length });
const PRONTIDAO = ['has_repository_connection','has_deploy_connection','has_email_template','has_offer','has_checkout_template','has_contract'];

/**
 * Um banco de mentira com o que esta fatia pergunta: itens do portfólio,
 * contratações e o projeto que nasce de um dos dois.
 *
 * O que ele NÃO tem é resposta para INSERT INTO products nem para UPDATE products
 * SET name: se o módulo voltar a inventar ou renomear item do portfólio, o teste
 * estoura em "SQL inesperado" em vez de passar em silêncio.
 */
function fakePool({ items = [], engagements = [], comProjeto = new Set() } = {}) {
 const itens = new Map(items), contratacoes = new Map(engagements);
 let saved = null, snapshot;
 const calls = [], audit = [], portfolio = [];
 const dono = () => {
  const item = saved?.product_id ? itens.get(saved.product_id) : null;
  const acordo = saved?.specification?.engagement_id ? contratacoes.get(saved.specification.engagement_id) : null;
  return { lifecycle_status: item?.lifecycle_status ?? null, product_name: item?.name ?? null, portfolio_kind: item?.portfolio_kind ?? null,
   engagement_label: acordo?.label ?? null, tenant_id: acordo?.tenant_id ?? null, engagement_archived_at: acordo?.archived_at ?? null };
 };
 const prontidao = () => Object.fromEntries(PRONTIDAO.map(coluna => [coluna, pool.readinessReady]));
 const pool = { calls, audit, portfolio, itens, contratacoes, failAudit: false, readinessReady: false, role: null,
  projeto: () => saved && structuredClone(saved),
  async query(sql, params = []) {
   calls.push(sql);
   if (sql === 'BEGIN') { snapshot = structuredClone(saved); return linhas([]); }
   if (sql === 'ROLLBACK') { saved = snapshot; return linhas([]); }
   if (sql === 'COMMIT') return linhas([]);
   // A sessão por senha entra como 'local-bootstrap' e nem chega a perguntar; a
   // resposta existe para quando o teste usar um operador com e-mail.
   if (sql.startsWith('SELECT role FROM operator_accounts')) return linhas(pool.role ? [{ role: pool.role }] : []);

   // O dono do lado do portfólio: existe, o ciclo de vida cabe e o tipo tem a capacidade?
   if (sql.startsWith('SELECT id,name FROM products WHERE id=$1 AND lifecycle_status IN')) {
    const item = itens.get(params[0]);
    const cabe = item && sql.includes(`'${item.lifecycle_status}'`) && params[1].includes(item.portfolio_kind);
    return linhas(cabe ? [{ id: params[0], name: item.name }] : []);
   }
   if (sql.startsWith('SELECT name,portfolio_kind FROM products WHERE id=$1')) {
    const item = itens.get(params[0]);
    return linhas(item ? [{ name: item.name, portfolio_kind: item.portfolio_kind }] : []);
   }
   // "Este dono já tem projeto?" — uma pergunta para cada lado do dono.
   if (sql.startsWith('SELECT 1 FROM delivery_projects WHERE product_id=$1')) return linhas(comProjeto.has(params[0]) ? [{ um: 1 }] : []);
   if (sql.startsWith('SELECT 1 FROM delivery_projects d WHERE')) return linhas(comProjeto.has(params[0]) ? [{ um: 1 }] : []);

   // O dono do lado da contratação.
   if (sql.startsWith('SELECT id,archived_at FROM client_engagements WHERE id=$1')) {
    const acordo = contratacoes.get(params[0]);
    return linhas(acordo ? [{ id: params[0], archived_at: acordo.archived_at ?? null }] : []);
   }
   if (sql.startsWith('SELECT label AS engagement_label')) {
    const acordo = contratacoes.get(params[0]) || {};
    return linhas([{ engagement_label: acordo.label ?? null, tenant_id: acordo.tenant_id ?? null, engagement_archived_at: acordo.archived_at ?? null }]);
   }

   // O projeto.
   if (sql.startsWith('SELECT id,product_id,specification,revision')) return linhas(saved ? [structuredClone(saved)] : []);
   if (sql.startsWith('SELECT d.id,d.product_id')) {
    const arquivado = Boolean(saved?.specification?.archived_at);
    const escondido = arquivado && params[0] === false;
    return linhas(saved && !escondido ? [{ ...structuredClone(saved), ...dono(), ...prontidao() }] : []);
   }
   if (sql.startsWith('INSERT INTO delivery_projects')) {
    saved = { id: ID_PROJETO, product_id: params[0] ?? null, specification: structuredClone(params[1]), revision: 1, updated_at: '2026-09-25T12:00:00.000Z' };
    return linhas([structuredClone(saved)]);
   }
   if (sql.startsWith('UPDATE delivery_projects')) {
    saved.specification = structuredClone(params[0]);
    if (sql.includes('product_id=$3')) saved.product_id = params[2] ?? null;
    saved.revision += 1;
    return linhas([structuredClone(saved)]);
   }
   if (sql.startsWith('SELECT lifecycle_status,name AS product_name,portfolio_kind FROM products WHERE id=$1')) {
    const item = itens.get(params[0]) || {};
    return linhas([{ lifecycle_status: item.lifecycle_status ?? null, product_name: item.name ?? null, portfolio_kind: item.portfolio_kind ?? null }]);
   }
   if (sql.startsWith('INSERT INTO delivery_audit')) { if (pool.failAudit) throw Error('private'); audit.push(params); return linhas([]); }

   // Ativar o item do portfólio, pelas mesmas colunas e pela mesma trilha do módulo do portfólio.
   if (sql.startsWith('SELECT id,name,portfolio_kind,brand_family,tags,lifecycle_status')) {
    const item = itens.get(params[0]);
    return linhas(item ? [{ id: params[0], ...item }] : []);
   }
   if (sql.startsWith("UPDATE products SET lifecycle_status='active'")) {
    const item = itens.get(params[0]);
    itens.set(params[0], { ...item, lifecycle_status: 'active', revision: item.revision + 1 });
    return linhas([{ id: params[0], ...itens.get(params[0]) }]);
   }
   if (sql.startsWith('INSERT INTO portfolio_audit')) { portfolio.push(params); return linhas([]); }
   throw Error('SQL inesperado: ' + sql.trim().slice(0, 80));
  },
  async connect() { return { ...pool, query: pool.query.bind(pool), release() {} }; },
 };
 return pool;
}

const mundo = () => fakePool({
 items: [
  ['educare', { name: 'Educare', portfolio_kind: 'product', lifecycle_status: 'draft', revision: 3 }],
  ['skiller', { name: 'Skiller', portfolio_kind: 'service_line', lifecycle_status: 'draft', revision: 1 }],
  ['sites', { name: 'Sites', portfolio_kind: 'service_line', lifecycle_status: 'active', revision: 1 }],
  ['velho', { name: 'Velho', portfolio_kind: 'product', lifecycle_status: 'archived', revision: 1 }],
 ],
 engagements: [
  [CONTRATACAO, { label: 'Consultoria', tenant_id: 'tenant-1' }],
  [ENCERRADA, { label: 'Encerrada', archived_at: '2026-01-01T00:00:00.000Z' }],
  [COM_PROJETO, { label: 'Já tem projeto', tenant_id: 'tenant-2' }],
 ],
 comProjeto: new Set(['sites', COM_PROJETO]),
});

/** Sobe o servidor de verdade e devolve o `request` já autenticado. */
async function subir(pool) {
 const password = 'synthetic-password-long-enough-for-test';
 const server = createCore({ pool, adminPassword: password, deployRegistry: [], deliveryOptions: { options: async () => inventories } });
 await new Promise(r => server.listen(0, '127.0.0.1', r));
 const origin = `http://127.0.0.1:${server.address().port}`;
 const request = (path, method = 'GET', body, headers = {}) =>
  fetch(origin + path, { method, headers: { origin, 'Content-Type': 'application/json', ...headers }, body: body ? JSON.stringify(body) : undefined });
 const login = await request('/api/login', 'POST', { password });
 const cookie = login.headers.get('set-cookie').split(';')[0];
 return { request, headers: { cookie }, origin, async fechar() { server.closeAllConnections(); await new Promise(r => server.close(r)); } };
}

const projeto = extras => project({ repository_id: '12', components: [component({ bindings: [binding] })], ...extras });
const mensagem = async resposta => (await resposta.json()).message;

test('HTTP: sessão, CSRF, dono obrigatório, revisões e transação auditada', async () => {
 const pool = mundo();
 const password = 'synthetic-password-long-enough-for-test';
 let optionsCalls = 0;
 const server = createCore({ pool, adminPassword: password, deployRegistry: [], deliveryOptions: { options: async () => { optionsCalls++; return inventories; } } });
 await new Promise(r => server.listen(0, '127.0.0.1', r));
 const origin = `http://127.0.0.1:${server.address().port}`;
 const request = (path, method = 'GET', body, headers = {}) =>
  fetch(origin + path, { method, headers: { origin, 'Content-Type': 'application/json', ...headers }, body: body ? JSON.stringify(body) : undefined });
 try {
  assert.equal((await request('/api/delivery/options')).status, 401); assert.equal(optionsCalls, 0);
  assert.equal((await request('/api/delivery/projects', 'POST', projeto())).status, 401); assert.equal(pool.calls.length, 0);
  const login = await request('/api/login', 'POST', { password });
  const cookie = login.headers.get('set-cookie').split(';')[0]; const headers = { cookie };
  assert.equal((await request('/api/delivery/projects', 'POST', projeto(), { cookie, origin: 'https://evil.invalid' })).status, 403);
  assert.equal((await request('/api/delivery/options?url=bad', 'GET', null, headers)).status, 400);

  // SEM DONO NÃO NASCE PROJETO, e a recusa diz onde o item novo nasce.
  const semDono = await request('/api/delivery/projects', 'POST', projeto(), headers);
  assert.equal(semDono.status, 400);
  assert.match(await mensagem(semDono), /Portfólio/);
  // Um dono só: os dois juntos é a mesma recusa do registro de conexões.
  assert.equal((await request('/api/delivery/projects', 'POST', projeto({ product_id: 'educare', engagement_id: CONTRATACAO }), headers)).status, 400);
  // Item que não existe, item arquivado, item que já tem projeto.
  assert.equal((await request('/api/delivery/projects', 'POST', projeto({ product_id: 'fantasma' }), headers)).status, 404);
  assert.equal((await request('/api/delivery/projects', 'POST', projeto({ product_id: 'velho' }), headers)).status, 404);
  const repetido = await request('/api/delivery/projects', 'POST', projeto({ product_id: 'sites' }), headers);
  assert.equal(repetido.status, 409); assert.match(await mensagem(repetido), /já tem projeto técnico/);
  // Contratação que não existe, arquivada, e a que já tem projeto.
  assert.equal((await request('/api/delivery/projects', 'POST', projeto({ engagement_id: INEXISTENTE }), headers)).status, 404);
  assert.equal((await request('/api/delivery/projects', 'POST', projeto({ engagement_id: ENCERRADA }), headers)).status, 409);
  const duplicada = await request('/api/delivery/projects', 'POST', projeto({ engagement_id: COM_PROJETO }), headers);
  assert.equal(duplicada.status, 409); assert.match(await mensagem(duplicada), /contratação já tem projeto/);
  // Nenhuma dessas recusas gravou coisa alguma.
  assert.equal(pool.audit.length, 0);
  assert.equal(pool.projeto(), null);

  // As recusas de destino continuam valendo — agora com dono no corpo.
  assert.equal((await request('/api/delivery/projects', 'POST', projeto({ product_id: 'educare', repository_id: 'unknown' }), headers)).status, 400);
  assert.equal((await request('/api/delivery/projects', 'POST', project({ product_id: 'educare', components: [component({ bindings: [{ ...binding, target_id: 'unknown' }] })] }), headers)).status, 400);
  assert.equal((await request('/api/delivery/projects', 'POST', project({ product_id: 'educare', components: [component({ kind: 'database', bindings: [binding] })] }), headers)).status, 400);

  const create = await request('/api/delivery/projects', 'POST', projeto({ product_id: 'educare' }), headers);
  assert.equal(create.status, 201);
  const record = (await create.json()).project;
  assert.equal(record.product_id, 'educare');
  assert.equal(record.repository_name, 'org/repo');
  assert.equal(record.product_lifecycle_status, 'draft');
  assert.equal(record.deployment_status, 'not_observed');
  assert.deepEqual(record.belongs_to, { kind: 'item', id: 'educare', name: 'Educare', item_kind: 'product', item_kind_label: 'plataforma', lifecycle_status: 'draft' });
  assert.equal(pool.audit.length, 1);
  // A REGRA CENTRAL DA FATIA: item do portfólio não nasce nem é renomeado por aqui.
  assert.ok(!pool.calls.some(sql => /INSERT INTO products/i.test(sql)), 'projeto técnico não inventa item do portfólio');
  assert.ok(!pool.calls.some(sql => /UPDATE products SET name/i.test(sql)), 'o nome do item é do Portfólio');

  const endpoint = '/api/delivery/projects/' + record.id;
  assert.equal((await request(endpoint, 'PUT', projeto({ revision: 1 }), headers)).status, 200);
  assert.equal(pool.audit.length, 2);
  assert.equal((await request(endpoint, 'PUT', projeto({ revision: 1 }), headers)).status, 409);
  // O DONO NÃO MUDA POR AQUI: a recusa manda para onde a troca se faz.
  const troca = await request(endpoint, 'PUT', projeto({ revision: 2, product_id: 'skiller' }), headers);
  assert.equal(troca.status, 409);
  assert.match(await mensagem(troca), /Reatribuir/);
  assert.equal(pool.projeto().product_id, 'educare');
  // Repetir o MESMO dono é salvar, não trocar.
  assert.equal((await request(endpoint, 'PUT', projeto({ revision: 2, product_id: 'educare' }), headers)).status, 200);

  pool.failAudit = true;
  const quebrado = await request(endpoint, 'PUT', projeto({ name: 'Rollback test', revision: 3 }), headers);
  assert.equal(quebrado.status, 500);
  assert.ok(!(await quebrado.text()).includes('private'));
  pool.failAudit = false;
  const listed = await (await request('/api/delivery/projects', 'GET', null, headers)).json();
  assert.equal(listed.projects[0].revision, 3);
  assert.notEqual(listed.projects[0].name, 'Rollback test');

  // Ativar: checklist pendente recusa; completo ativa o item e deixa a trilha do portfólio.
  assert.equal((await request(endpoint + '/activate', 'POST', { revision: 3 }, headers)).status, 409);
  pool.readinessReady = true;
  assert.equal((await request(endpoint + '/activate', 'POST', { revision: 3 }, headers)).status, 200);
  assert.equal(pool.itens.get('educare').lifecycle_status, 'active');
  assert.equal(pool.itens.get('educare').revision, 4, 'ativar sobe a revisão do item');
  assert.equal(pool.portfolio.at(-1)[2], 'activated');
  const jaAtivo = await request(endpoint + '/activate', 'POST', { revision: 3 }, headers);
  assert.equal(jaAtivo.status, 409);
  // Sem "Este produto/plataforma": o rótulo do tipo muda de gênero, o nome do item não.
  assert.match(await mensagem(jaAtivo), /Educare já está ativo/);

  // EXCLUIR VIROU ARQUIVAR: o verbo DELETE não existe mais nesta rota.
  assert.equal((await request(endpoint, 'DELETE', null, headers)).status, 405);
  assert.equal((await request(endpoint + '/archive', 'POST', { revision: 4 }, headers)).status, 409, 'revisão velha não arquiva');
  assert.equal((await request(endpoint + '/archive', 'POST', { revision: 3 }, headers)).status, 200);
  assert.ok(pool.projeto().specification.archived_at, 'arquivar marca a data, não apaga a linha');
  assert.equal((await (await request('/api/delivery/projects', 'GET', null, headers)).json()).projects.length, 0);
  assert.equal((await (await request('/api/delivery/projects?include_archived=1', 'GET', null, headers)).json()).projects.length, 1);
  assert.equal((await request(endpoint + '/restore', 'POST', { revision: 4 }, headers)).status, 200);
  assert.equal((await (await request('/api/delivery/projects', 'GET', null, headers)).json()).projects.length, 1);

  // Nada nesta sessão inteira apagou uma linha.
  assert.ok(!pool.calls.some(sql => sql.trim().toUpperCase().startsWith('DELETE')), 'nenhum DELETE restou no módulo');
 } finally { server.closeAllConnections(); await new Promise(r => server.close(r)); }
});

test('HTTP: projeto de contratação nasce sem item, e o checklist só pergunta o que a contratação responde', async () => {
 const pool = mundo();
 const { request, headers, fechar } = await subir(pool);
 try {
  const create = await request('/api/delivery/projects', 'POST', projeto({ engagement_id: CONTRATACAO }), headers);
  assert.equal(create.status, 201);
  const record = (await create.json()).project;
  assert.equal(record.product_id, null, 'contratação não ganha item do portfólio de brinde');
  assert.equal(record.belongs_to.kind, 'engagement');
  assert.equal(record.belongs_to.name, 'Consultoria');
  assert.equal(record.belongs_to.tenant_id, 'tenant-1');
  // Quatro perguntas: as que toda entrega responde. Oferta, checkout, contrato e
  // e-mails são cadastros de quem vende, e contratação não vende.
  assert.deepEqual(record.readiness.items.map(item => item.key), ['identity', 'source', 'services', 'deploy']);
  // A contratação continua na especificação depois de salvar de novo — é onde ela
  // mora, porque a 034 não deixou coluna para ela (conferido em produção).
  assert.equal((await request('/api/delivery/projects/' + record.id, 'PUT', projeto({ revision: 1 }), headers)).status, 200);
  assert.equal(pool.projeto().specification.engagement_id, CONTRATACAO);
  // Não há o que ativar: contratação não é item do portfólio.
  pool.readinessReady = true;
  const ativar = await request(`/api/delivery/projects/${record.id}/activate`, 'POST', { revision: 2 }, headers);
  assert.equal(ativar.status, 409);
  assert.match(await mensagem(ativar), /contratação/);
  assert.ok(!pool.calls.some(sql => /INSERT INTO products/i.test(sql)));
 } finally { await fechar(); }
});

test('adotar é a única mudança de dono: projeto órfão escolhe um, projeto com dono não troca', async () => {
 const pool = mundo();
 const { request, headers, fechar } = await subir(pool);
 try {
  // Cadastro anterior a esta regra: existe e não tem dono nenhum.
  await pool.query('INSERT INTO delivery_projects(product_id,specification) VALUES($1,$2)', [null, { name: 'Órfão', owner: '', layout: 'single', components: [] }]);
  const orfao = (await (await request('/api/delivery/projects', 'GET', null, headers)).json()).projects[0];
  assert.equal(orfao.belongs_to.kind, 'none');
  assert.ok(orfao.issues[0].includes('sem dono'), 'a tela precisa ver que falta dono');
  const endpoint = '/api/delivery/projects/' + orfao.id;
  // Salvar sem escolher continua recusando, com a frase do projeto que já existe.
  const insistindo = await request(endpoint, 'PUT', projeto({ revision: 1 }), headers);
  assert.equal(insistindo.status, 400);
  assert.match(await mensagem(insistindo), /sem dono/);
  // Adotando: agora tem dono, e o dono entrou pela coluna do banco.
  assert.equal((await request(endpoint, 'PUT', projeto({ revision: 1, product_id: 'skiller' }), headers)).status, 200);
  assert.equal(pool.projeto().product_id, 'skiller');
  // E adotado uma vez, não se adota de novo.
  assert.equal((await request(endpoint, 'PUT', projeto({ revision: 2, engagement_id: CONTRATACAO }), headers)).status, 409);
  assert.equal(pool.projeto().product_id, 'skiller');
 } finally { await fechar(); }
});

// Os handlers, sem HTTP: rota transacional recebe { client, params, body, operator },
// e é assim que dá para perguntar por permissão e pela trilha sem subir servidor.
function rotas() {
 const mapa = new Map();
 const guardar = metodo => (path, fn) => mapa.set(`${metodo} ${path}`, fn);
 deliveryRoutes({ get: guardar('GET'), post: guardar('POST'), put: guardar('PUT'), delete: guardar('DELETE') },
  { options: async () => inventories, settings: async () => ({}), resource: async () => ({}) });
 return mapa;
}

test('excluir virou arquivar: o módulo não registra mais nenhuma rota DELETE', () => {
 const mapa = rotas();
 assert.ok(![...mapa.keys()].some(chave => chave.startsWith('DELETE')), 'nenhum DELETE registrado');
 assert.ok(mapa.has('POST /api/delivery/projects/:id/archive'));
 assert.ok(mapa.has('POST /api/delivery/projects/:id/restore'));
});

const clienteDeProjeto = (projetoSalvo, { role = 'owner' } = {}) => {
 const sqls = [], auditoria = [];
 return { sqls, auditoria, salvo: projetoSalvo, query: async (sql, values = []) => {
  sqls.push(sql);
  if (sql.startsWith('SELECT role FROM operator_accounts')) return linhas([{ role }]);
  if (sql.startsWith('SELECT id,product_id,specification,revision')) return linhas(projetoSalvo ? [structuredClone(projetoSalvo)] : []);
  if (sql.startsWith('UPDATE delivery_projects')) { projetoSalvo.specification = structuredClone(values[0]); projetoSalvo.revision += 1; return linhas([structuredClone(projetoSalvo)]); }
  if (sql.startsWith('INSERT INTO delivery_audit')) { auditoria.push(values); return linhas([]); }
  throw Error('SQL inesperado: ' + sql.trim().slice(0, 80));
 } };
};

test('arquivar tira o projeto de circulação sem apagar linha, e restaurar devolve', async () => {
 const mapa = rotas();
 const arquivar = mapa.get('POST /api/delivery/projects/:id/archive');
 const restaurar = mapa.get('POST /api/delivery/projects/:id/restore');
 const operator = { subject: 'op-1', email: 'op@tzolkin.test' };
 const salvo = { id: INEXISTENTE, product_id: 'educare', specification: { name: 'Educare', components: [] }, revision: 2, updated_at: null };
 const cliente = clienteDeProjeto(salvo);
 const chamada = (rota, revision) => rota({ client: cliente, params: { id: INEXISTENTE }, body: { revision }, operator });

 await assert.rejects(() => chamada(arquivar, 1), e => e.status === 409 && /Reabra/.test(e.message));
 const arquivado = await chamada(arquivar, 2);
 assert.equal(arquivado.type, 'delivery.project_archived');
 assert.ok(salvo.specification.archived_at, 'arquivar grava a data na especificação');
 assert.equal(cliente.auditoria.length, 1, 'arquivar entra na mesma trilha das outras edições');
 assert.equal(cliente.auditoria[0][1], 3, 'a trilha cita a revisão nova');
 await assert.rejects(() => chamada(arquivar, 3), e => e.status === 409 && /já está arquivado/.test(e.message));
 const restaurado = await chamada(restaurar, 3);
 assert.equal(restaurado.type, 'delivery.project_restored');
 assert.equal(salvo.specification.archived_at, undefined);
 await assert.rejects(() => chamada(restaurar, 4), e => e.status === 409 && /não está arquivado/.test(e.message));
 assert.ok(!cliente.sqls.some(sql => sql.trim().toUpperCase().startsWith('DELETE')), 'arquivar não apaga nada');

 // Projeto que não existe, revisão inválida e campo desconhecido continuam recusados.
 const vazio = clienteDeProjeto(null);
 await assert.rejects(() => arquivar({ client: vazio, params: { id: INEXISTENTE }, body: { revision: 1 }, operator }), e => e.status === 404);
 await assert.rejects(() => arquivar({ client: vazio, params: { id: 'nao-uuid' }, body: { revision: 1 }, operator }), e => e.status === 400);
 await assert.rejects(() => arquivar({ client: vazio, params: { id: INEXISTENTE }, body: { revision: 0 }, operator }), e => e.status === 400);
 await assert.rejects(() => arquivar({ client: vazio, params: { id: INEXISTENTE }, body: { revision: 1, motivo: 'x' }, operator }), e => e.status === 400);

 // Escrita de operação: visitante não arquiva projeto de ninguém.
 const visitante = clienteDeProjeto({ ...salvo }, { role: 'viewer' });
 await assert.rejects(() => arquivar({ client: visitante, params: { id: INEXISTENTE }, body: { revision: 2 }, operator }), e => e.status === 403);
 assert.equal(visitante.sqls.length, 1, 'a recusa de permissão vem antes de ler o projeto');
});

const clienteDeAtivacao = ({ role = 'owner', projetoLido, item, pronto = true }) => {
 const sqls = [], trilha = [];
 return { sqls, trilha, query: async (sql, values = []) => {
  sqls.push(sql);
  if (sql.startsWith('SELECT role FROM operator_accounts')) return linhas([{ role }]);
  if (sql.startsWith('SELECT d.id,d.product_id')) return linhas(projetoLido ? [{ ...structuredClone(projetoLido), ...Object.fromEntries(PRONTIDAO.map(c => [c, pronto])) }] : []);
  if (sql.startsWith('SELECT id,name,portfolio_kind,brand_family,tags,lifecycle_status')) return linhas(item ? [{ id: values[0], ...item }] : []);
  if (sql.startsWith("UPDATE products SET lifecycle_status='active'")) return linhas([{ id: values[0], ...item, lifecycle_status: 'active', revision: item.revision + 1 }]);
  if (sql.startsWith('INSERT INTO portfolio_audit')) { trilha.push(values); return linhas([]); }
  throw Error('SQL inesperado: ' + sql.trim().slice(0, 80));
 } };
};

test('ativar pelo checklist é o mesmo ato do Portfólio: permissão de dono, tipo conferido e a mesma trilha', async () => {
 const ativar = rotas().get('POST /api/delivery/projects/:id/activate');
 const operator = { subject: 'op-1', email: 'op@tzolkin.test' };
 const projetoLido = { id: INEXISTENTE, product_id: 'skiller', specification: { name: 'Skiller', owner: 'Equipe', components: [{ id: 'web' }] }, revision: 2, portfolio_kind: 'service_line', lifecycle_status: 'draft' };
 const item = { name: 'Skiller', portfolio_kind: 'service_line', lifecycle_status: 'draft', revision: 7 };
 const chamar = cliente => ativar({ client: cliente, params: { id: INEXISTENTE }, body: { revision: 2 }, operator });

 // Ativar é o mesmo ato de /api/portfolio/:id/lifecycle, e pede a mesma coisa.
 const membro = clienteDeAtivacao({ role: 'member', projetoLido, item });
 await assert.rejects(() => chamar(membro), e => e.status === 403);
 assert.equal(membro.sqls.length, 1, 'sem permissão, nada é lido');

 const cliente = clienteDeAtivacao({ role: 'owner', projetoLido, item });
 const resultado = await chamar(cliente);
 assert.equal(resultado.type, 'delivery.product_activated');
 assert.equal(resultado.body.lifecycle_status, 'active');
 assert.equal(resultado.body.revision, 8, 'a revisão do item sobe, como no Portfólio');
 const [entity, id, action, antes, depois, subject, email] = cliente.trilha[0];
 assert.deepEqual([entity, id, action], ['product', 'skiller', 'activated']);
 assert.equal(antes.lifecycle_status, 'draft'); assert.equal(depois.lifecycle_status, 'active');
 assert.deepEqual([subject, email], ['op-1', 'op@tzolkin.test']);
 assert.ok(cliente.sqls.some(sql => /revision=revision\+1/.test(sql)), 'a revisão do item é lida e reescrita com trava');

 // O TIPO É LIDO AGORA, com trava: reclassificar o item muda o checklist. Uma linha
 // de serviço que não tem template de e-mail não passa; um item interno passa, porque
 // a pergunta de e-mail não é dele.
 const semEmail = { ...projetoLido };
 const parcial = { ...Object.fromEntries(PRONTIDAO.map(c => [c, true])), has_email_template: false };
 const clienteParcial = { sqls: [], trilha: [], query: async (sql, values = []) => {
  clienteParcial.sqls.push(sql);
  if (sql.startsWith('SELECT role FROM operator_accounts')) return linhas([{ role: 'owner' }]);
  if (sql.startsWith('SELECT d.id,d.product_id')) return linhas([{ ...semEmail, ...parcial }]);
  if (sql.startsWith('SELECT id,name,portfolio_kind,brand_family,tags,lifecycle_status')) return linhas([{ id: values[0], ...item }]);
  throw Error('SQL inesperado: ' + sql.trim().slice(0, 80));
 } };
 await assert.rejects(() => chamar(clienteParcial), e => e.status === 409 && /E-mails/.test(e.message));
 assert.ok(!clienteParcial.sqls.some(sql => sql.startsWith('UPDATE products')), 'checklist pendente não ativa nada');

 // Mesmo projeto, item interno: a pergunta de e-mail não existe e ele ativa.
 const interno = clienteDeAtivacao({ projetoLido: semEmail, item: { ...item, portfolio_kind: 'internal' }, pronto: true });
 assert.equal((await chamar(interno)).type, 'delivery.product_activated');

 // Item já ativo, item arquivado e projeto arquivado: cada um com a sua recusa.
 await assert.rejects(() => chamar(clienteDeAtivacao({ projetoLido, item: { ...item, lifecycle_status: 'active' } })),
  e => e.status === 409 && /Skiller já está ativo/.test(e.message));
 await assert.rejects(() => chamar(clienteDeAtivacao({ projetoLido, item: { ...item, lifecycle_status: 'archived' } })),
  e => e.status === 409 && /Portfólio/.test(e.message));
 await assert.rejects(() => chamar(clienteDeAtivacao({ projetoLido: { ...projetoLido, specification: { ...projetoLido.specification, archived_at: '2026-01-01T00:00:00.000Z' } }, item })),
  e => e.status === 409 && /arquivado/.test(e.message));
 // Revisão velha do projeto não ativa.
 await assert.rejects(() => ativar({ client: clienteDeAtivacao({ projetoLido, item }), params: { id: INEXISTENTE }, body: { revision: 1 }, operator }),
  e => e.status === 409 && /Reabra/.test(e.message));
});

test('o checklist só pergunta o que o tipo do dono pode responder', () => {
 const { readiness, CHECKLIST } = _internals;
 const linha = (portfolio_kind, extras = {}) => ({ portfolio_kind,
  specification: { name: 'x', owner: 'y', components: [{ id: 'web' }] },
  has_repository_connection: true, has_deploy_connection: true,
  has_email_template: false, has_offer: false, has_checkout_template: false, has_contract: false, ...extras });
 const chaves = kind => readiness(linha(kind)).items.map(item => item.key);
 const comercial = ['identity', 'source', 'services', 'deploy', 'emails', 'checkout', 'contracts'];
 assert.deepEqual(chaves('product'), comercial);
 assert.deepEqual(chaves('platform'), comercial);
 // Consultoria e assessoria é trabalho sob contrato, como a linha de serviço.
 assert.deepEqual(chaves('advisory'), chaves('service_line'));
 // Linha de serviço vende por contrato, não por checkout: sem oferta e sem contrato de acesso.
 assert.deepEqual(chaves('service_line'), ['identity', 'source', 'services', 'deploy', 'emails']);
 // Item interno não fala com cliente nenhum.
 assert.deepEqual(chaves('internal'), ['identity', 'source', 'services', 'deploy']);
 // Contratação não tem tipo de portfólio, e é o que a faz cair no checklist curto
 // sem nenhum "if" sobre dono espalhado pelo módulo.
 assert.deepEqual(chaves(null), ['identity', 'source', 'services', 'deploy']);
 assert.deepEqual(chaves(undefined), ['identity', 'source', 'services', 'deploy']);

 assert.equal(readiness(linha('internal')).ready, true);
 assert.equal(readiness(linha('service_line')).ready, false, 'falta o template de e-mail');
 assert.equal(readiness(linha('product')).ready, false);
 assert.equal(readiness(linha('internal', { has_deploy_connection: false })).ready, false);
 // Repositório escolhido no cadastro vale tanto quanto conexão de código confirmada.
 assert.equal(readiness(linha('internal', { has_repository_connection: false })).ready, false);
 assert.equal(readiness({ ...linha('internal', { has_repository_connection: false }), specification: { name: 'x', owner: 'y', repository_id: '12', components: [{ id: 'web' }] } }).ready, true);
 assert.equal(readiness(linha('service_line')).completed, 4);
 assert.equal(readiness(linha('service_line')).total, 5);

 // A decisão registrada: e-mail é pergunta de quem tem ciclo comercial. Está anotada
 // em open_questions porque é escolha, não dedução.
 assert.equal(CHECKLIST.find(item => item.key === 'emails').capability, 'commercial');
 // Capacidade escrita errada sumiria com a pergunta em silêncio.
 for (const item of CHECKLIST) if (item.capability) assert.ok(Object.hasOwn(CAPABILITIES, item.capability), `capacidade desconhecida: ${item.capability}`);
});

test('um projeto pertence a um dono só, e a recusa sai antes do banco', () => {
 const { donoPedido, donoDe, present } = _internals;
 assert.equal(donoPedido({}), null);
 assert.equal(donoPedido({ product_id: '', engagement_id: null }), null);
 assert.deepEqual(donoPedido({ product_id: 'educare' }), { product_id: 'educare', engagement_id: null });
 assert.deepEqual(donoPedido({ engagement_id: CONTRATACAO }), { product_id: null, engagement_id: CONTRATACAO });
 assert.throws(() => donoPedido({ product_id: 'educare', engagement_id: CONTRATACAO }), e => e.status === 400 && /um dono só/.test(e.message));
 assert.throws(() => donoPedido({ product_id: 'Educare' }), e => e.status === 400);
 assert.throws(() => donoPedido({ engagement_id: 'nao-uuid' }), e => e.status === 400);

 // De quem é, do jeito que a tela precisa perguntar.
 assert.deepEqual(donoDe({ product_id: 'skiller', product_name: 'Skiller', portfolio_kind: 'service_line', lifecycle_status: 'draft' }),
  { kind: 'item', id: 'skiller', name: 'Skiller', item_kind: 'service_line', item_kind_label: 'linha de serviço', lifecycle_status: 'draft' });
 const acordo = donoDe({ product_id: null, specification: { engagement_id: CONTRATACAO }, engagement_label: 'Consultoria', tenant_id: 'tenant-1', engagement_archived_at: '2026-01-01T00:00:00.000Z' });
 assert.deepEqual(acordo, { kind: 'engagement', id: CONTRATACAO, name: 'Consultoria', tenant_id: 'tenant-1', archived: true });
 assert.equal(donoDe({ specification: {} }).kind, 'none');

 // A tela vê o problema antes de o servidor recusar.
 const orfao = present({ id: ID_PROJETO, product_id: null, specification: { name: 'x', components: [] }, revision: 1 });
 assert.ok(orfao.issues[0].includes('sem dono'));
 const arquivada = present({ id: ID_PROJETO, product_id: null, specification: { name: 'x', components: [], engagement_id: CONTRATACAO }, engagement_archived_at: '2026-01-01T00:00:00.000Z', revision: 1 });
 assert.ok(arquivada.issues.some(issue => /contratação dona/.test(issue)));
});
