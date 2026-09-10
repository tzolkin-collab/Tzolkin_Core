// Campanhas de marketing, ponta a ponta: sessão, coleta, atribuição e o que
// a API devolve. O adaptador da Meta é falso — nenhum teste toca a rede.
//
// A senha do operador é gerada aqui, no teste. Nenhuma credencial real entra.
import test from 'node:test';
import assert from 'node:assert/strict';
import pg from 'pg';
import { randomBytes, randomUUID } from 'node:crypto';
import { createCore } from '../apps/api/src/server.mjs';
import { testConnectionString } from '../apps/api/src/platform/database.mjs';
import { guardarCredencial } from '../apps/api/src/modules/marketing.mjs';
import http from 'node:http';
import { digest } from '../apps/api/src/platform/session.mjs';

const CHAVE = randomBytes(32).toString('base64');
const TOKEN_FALSO = 'EAAG' + 'z'.repeat(190);

// O banco de teste hoje É o de produção: não há DATABASE_URL_TEST no .env.
// guardarCredencial revoga a credencial ativa (uma por provedor), então rodar
// estes testes com um token real conectado o desligaria em produção. Havendo
// credencial ativa que não seja de teste, o conjunto é pulado.
const AVISO_BANCO_REAL = 'há credencial real da Meta ativa neste banco; defina DATABASE_URL_TEST para rodar sem tocá-la';
async function credencialRealAtiva(pool) {
 const r = await pool.query(
  "SELECT count(*)::int c FROM marketing_credentials WHERE provider='meta' AND active " +
  "AND label NOT LIKE 'Teste %' AND label NOT LIKE 'Painel %' AND label NOT LIKE 'Trocado %'");
 return r.rows[0].c > 0;
}

// Adaptador falso com o mesmo contrato do real.
function adaptadorFalso(marca) {
 return {
  provider: 'meta',
  async debugToken() {
   return { checked: true, valid: true, expires_at: null, never_expires: true, scopes: ['ads_read'], type: 'SYSTEM_USER', error: null };
  },
  async listAdAccounts() {
   return [{ provider: 'meta', external_id: `act_${marca}`, account_ref: marca, name: 'Conta de teste',
    currency: 'BRL', account_status: 1, active: true, business_name: 'TZOLKIN', timezone: 'America/Sao_Paulo' }];
  },
  async listCampaigns() {
   return { truncated: false, campaigns: [
    { provider: 'meta', external_id: `c1_${marca}`, account_external_id: `act_${marca}`, name: 'Campanha um',
      objective: 'OUTCOME_LEADS', status: 'ACTIVE', effective_status: 'ACTIVE',
      daily_budget_cents: 5000, lifetime_budget_cents: null, budget_remaining_cents: 3000,
      start_time: null, stop_time: null, created_time: null, updated_time: null },
    { provider: 'meta', external_id: `c2_${marca}`, account_external_id: `act_${marca}`, name: 'Campanha dois',
      objective: 'OUTCOME_TRAFFIC', status: 'PAUSED', effective_status: 'PAUSED',
      daily_budget_cents: null, lifetime_budget_cents: 120000, budget_remaining_cents: null,
      start_time: null, stop_time: null, created_time: null, updated_time: null },
   ] };
  },
  async listCampaignInsights() {
   return { truncated: false, insights: [
    { provider: 'meta', campaign_external_id: `c1_${marca}`, campaign_name: 'Campanha um',
      date_start: '2026-09-01', date_stop: '2026-09-01', spend_cents: 12837, currency: 'BRL',
      impressions: 4210, clicks: 96, reach: 3900, leads: 7, purchases: null, messaging: null, actions_total: 59 },
    { provider: 'meta', campaign_external_id: `c1_${marca}`, campaign_name: 'Campanha um',
      date_start: '2026-09-02', date_stop: '2026-09-02', spend_cents: 9100, currency: 'BRL',
      impressions: 3000, clicks: 71, reach: 2800, leads: 4, purchases: null, messaging: null, actions_total: 40 },
   ] };
  },
 };
}

test('Campanhas de marketing', async t => {
 const pool = new pg.Pool({ connectionString: testConnectionString().connectionString, max: 3 });
 if (await credencialRealAtiva(pool)) { t.skip(AVISO_BANCO_REAL); await pool.end(); return; }
 const inicio = (await pool.query('SELECT now() AS t')).rows[0].t;
 const marca = randomUUID().slice(0, 8).replace(/-/g, '');
 const adminPassword = randomBytes(32).toString('base64url');
 const env = { META_MARKETING_KEY: CHAVE };

 const server = createCore({
  pool, adminPassword,
  marketingOptions: { env, adapter: adaptadorFalso(marca) },
 });
 await new Promise(r => server.listen(0, '127.0.0.1', r));
 const origin = `http://127.0.0.1:${server.address().port}`;

 const login = await fetch(origin + '/api/login', {
  method: 'POST', headers: { origin, 'Content-Type': 'application/json' },
  body: JSON.stringify({ password: adminPassword }),
 });
 const cookie = login.headers.get('set-cookie').split(';')[0];
 const get = rota => fetch(origin + rota, { headers: { cookie } });
 const post = rota => fetch(origin + rota, { method: 'POST', headers: { cookie, origin } });
 const put = (rota, body) => fetch(origin + rota, {
  method: 'PUT', headers: { cookie, origin, 'Content-Type': 'application/json' }, body: JSON.stringify(body),
 });

 try {
  await t.test('exige sessão de operador', async () => {
   assert.equal((await fetch(origin + '/api/marketing/overview')).status, 401);
  });

  await t.test('sem credencial devolve estado vazio honesto, não erro', async () => {
   const r = await get('/api/marketing/overview');
   assert.equal(r.status, 200);
   const corpo = await r.json();
   assert.equal(corpo.configured, false);
   assert.deepEqual(corpo.campaigns, []);
   assert.equal(corpo.last_sync, null);
  });

  await t.test('mutação de outra origem é recusada (CSRF)', async () => {
   const r = await fetch(origin + '/api/marketing/sync', {
    method: 'POST', headers: { cookie, origin: 'https://outro.example' },
   });
   assert.equal(r.status, 403);
  });

  // A credencial entra pelo mesmo caminho do script de conexão.
  await t.test('credencial é gravada cifrada e o token não volta pela API', async () => {
   const client = await pool.connect();
   try {
    await client.query('BEGIN');
    await guardarCredencial(client, {
     token: TOKEN_FALSO, label: `Teste ${marca}`, tokenType: 'system_user',
     scopes: ['ads_read'], expiresAt: null, appId: null,
    }, env);
    await client.query('COMMIT');
   } finally { client.release(); }

   // No banco não existe o token em claro.
   const linha = (await pool.query(
    'SELECT token_ciphertext, token_fingerprint FROM marketing_credentials WHERE label=$1', [`Teste ${marca}`])).rows[0];
   assert.ok(!linha.token_ciphertext.toString('utf8').includes('EAAG'));

   const corpo = await (await get('/api/marketing/credential')).json();
   const texto = JSON.stringify(corpo);
   assert.ok(!texto.includes(TOKEN_FALSO), 'o token não pode sair pela API');
   assert.ok(!texto.includes('token_ciphertext'));
   assert.equal(corpo.configured, true);
   assert.equal(corpo.never_expires, true);
   assert.equal(corpo.can_read_ads, true);
   assert.equal(corpo.fingerprint, linha.token_fingerprint);
  });

  await t.test('coleta grava contas, campanhas e métricas por dia', async () => {
   const r = await post('/api/marketing/sync?since=2026-09-01&until=2026-09-30');
   assert.equal(r.status, 200);
   const corpo = await r.json();
   assert.equal(corpo.status, 'ok');
   assert.equal(corpo.accounts, 1);
   assert.equal(corpo.campaigns, 2);
   assert.equal(corpo.insights_written, 2);
  });

  await t.test('recoletar o mesmo período não duplica: atualiza', async () => {
   await post('/api/marketing/sync?since=2026-09-01&until=2026-09-30');
   const n = await pool.query(
    'SELECT count(*)::int c FROM marketing_campaign_insights WHERE campaign_external_id=$1', [`c1_${marca}`]);
   assert.equal(n.rows[0].c, 2, 'a Meta revisa números; o mesmo dia atualiza em vez de empilhar');
  });

  await t.test('a visão geral soma o gasto do período em centavos inteiros', async () => {
   const corpo = await (await get('/api/marketing/overview?since=2026-09-01&until=2026-09-30')).json();
   const minhas = corpo.campaigns.filter(c => c.external_id.endsWith(marca));
   assert.equal(minhas.length, 2);
   const c1 = minhas.find(c => c.external_id === `c1_${marca}`);
   assert.equal(Number(c1.spend_cents), 12837 + 9100);
   assert.equal(Number(c1.clicks), 167);
   assert.equal(Number(c1.dias), 2);
   // Campanha pausada aparece: gasto histórico não pode sumir da tela.
   assert.ok(minhas.some(c => c.effective_status === 'PAUSED'));
   assert.equal(corpo.last_sync.status, 'ok');
  });

  await t.test('campanha nasce sem dono e o gasto entra como não atribuído', async () => {
   const corpo = await (await get('/api/marketing/overview?since=2026-09-01&until=2026-09-30')).json();
   const c1 = corpo.campaigns.find(c => c.external_id === `c1_${marca}`);
   assert.equal(c1.product_id, null);
   assert.equal(c1.engagement_id, null);
   assert.ok(corpo.summary.unassigned_spend_cents >= 21937);
  });

  const produto = (await pool.query("SELECT id FROM products WHERE lifecycle_status IN ('active','draft') LIMIT 1")).rows[0];

  await t.test('atribuir a produto E contratação ao mesmo tempo é recusado', async () => {
   const contratacao = (await pool.query('SELECT id FROM client_engagements LIMIT 1')).rows[0];
   if (!contratacao) return;
   const r = await put(`/api/marketing/campaigns/c1_${marca}/binding`, {
    product_id: produto.id, engagement_id: contratacao.id,
   });
   assert.equal(r.status, 400);
   assert.match((await r.json()).message, /OU/);
  });

  await t.test('atribuir a um produto vincula e registra o autor', async () => {
   const r = await put(`/api/marketing/campaigns/c1_${marca}/binding`, { product_id: produto.id, note: 'teste' });
   assert.equal(r.status, 200);
   const corpo = await (await get(`/api/products/${produto.id}/campaigns?since=2026-09-01&until=2026-09-30`)).json();
   const minha = corpo.campaigns.find(c => c.external_id === `c1_${marca}`);
   assert.ok(minha, 'a campanha tem de aparecer no contexto do produto');
   assert.equal(Number(minha.spend_cents), 21937);
   const trilha = await pool.query(
    'SELECT action,product_id FROM marketing_binding_audit WHERE external_campaign_id=$1', [`c1_${marca}`]);
   assert.equal(trilha.rows[0].action, 'bound');
   assert.equal(trilha.rows[0].product_id, produto.id);
  });

  await t.test('produto inexistente é recusado, não cria vínculo fantasma', async () => {
   const r = await put(`/api/marketing/campaigns/c2_${marca}/binding`, { product_id: 'produto-que-nao-existe' });
   assert.equal(r.status, 404);
  });

  await t.test('desvincular usa UPDATE, não DELETE: a linha continua com histórico', async () => {
   const r = await put(`/api/marketing/campaigns/c1_${marca}/binding`, {});
   assert.equal(r.status, 200);
   const linha = (await pool.query(
    'SELECT active,product_id FROM marketing_campaign_bindings WHERE external_campaign_id=$1', [`c1_${marca}`])).rows[0];
   assert.equal(linha.active, false, 'a linha permanece — a role de produção não tem DELETE');
   assert.equal(linha.product_id, null);
   const trilha = await pool.query(
    "SELECT action FROM marketing_binding_audit WHERE external_campaign_id=$1 AND action='unbound'", [`c1_${marca}`]);
   assert.equal(trilha.rowCount, 1);
  });

  await t.test('desvincular duas vezes é conflito, não sucesso silencioso', async () => {
   assert.equal((await put(`/api/marketing/campaigns/c1_${marca}/binding`, {})).status, 409);
  });

  await t.test('período inválido é recusado', async () => {
   assert.equal((await get('/api/marketing/overview?since=ontem&until=2026-09-30')).status, 400);
   assert.equal((await get('/api/marketing/overview?since=2026-09-30&until=2026-09-01')).status, 400);
   assert.equal((await get('/api/marketing/overview?foo=1')).status, 400);
  });

  await t.test('alvos trazem a taxonomia que separa serviço de mentoria e assessoria', async () => {
   const corpo = await (await get('/api/marketing/targets')).json();
   assert.ok(Array.isArray(corpo.products));
   for (const modelo of ['on_demand', 'education', 'consulting', 'advisory']) {
    assert.ok(corpo.service_models.includes(modelo), `${modelo} precisa ser um contexto distinto`);
   }
   assert.equal(corpo.suggestion_is_advisory, true, 'sugestão é conselho, não atribuição');
  });
 } finally {
  const client = await pool.connect();
  try {
   await client.query('BEGIN');
   await client.query('DELETE FROM marketing_binding_audit WHERE external_campaign_id LIKE $1', [`%${marca}`]);
   await client.query('DELETE FROM marketing_campaign_bindings WHERE external_campaign_id LIKE $1', [`%${marca}`]);
   await client.query('DELETE FROM marketing_campaign_insights WHERE campaign_external_id LIKE $1', [`%${marca}`]);
   await client.query('DELETE FROM marketing_campaigns WHERE external_id LIKE $1', [`%${marca}`]);
   await client.query('DELETE FROM marketing_accounts WHERE external_id LIKE $1', [`%${marca}`]);
   await client.query('DELETE FROM marketing_sync_runs WHERE actor_subject=$1 AND started_at >= $2', ['local-bootstrap', inicio]);
   await client.query('DELETE FROM marketing_credentials WHERE label=$1', [`Teste ${marca}`]);
   await client.query('COMMIT');
  } finally { client.release(); }
  server.closeAllConnections();
  await new Promise(r => server.close(r));
  await pool.end();
 }
});

// Graph de mentira: um servidor local. Permite exercitar troca e conferência
// de verdade, inclusive provar que o token viaja no cabeçalho.
function grafoFalso() {
 const recebidas = [];
 const servidor = http.createServer((req, res) => {
  const url = new URL(req.url, 'http://127.0.0.1');
  recebidas.push({ path: url.pathname, query: url.search, auth: req.headers.authorization || null });
  res.writeHead(200, { 'Content-Type': 'application/json' });
  if (url.pathname.endsWith('/oauth/access_token')) {
   return res.end(JSON.stringify({ access_token: 'TOKEN-LONGO-' + 'y'.repeat(60), expires_in: 5184000 }));
  }
  if (url.pathname.endsWith('/debug_token')) {
   return res.end(JSON.stringify({ data: { is_valid: true, expires_at: 0, scopes: ['ads_read'], type: 'SYSTEM_USER' } }));
  }
  res.end(JSON.stringify({ data: [] }));
 });
 return { servidor, recebidas };
}

test('Conectar credencial pelo painel', async t => {
 const pool = new pg.Pool({ connectionString: testConnectionString().connectionString, max: 3 });
 if (await credencialRealAtiva(pool)) { t.skip(AVISO_BANCO_REAL); await pool.end(); return; }
 const inicio = (await pool.query('SELECT now() AS t')).rows[0].t;
 const marca = randomUUID().slice(0, 8).replace(/-/g, '');
 const adminPassword = randomBytes(32).toString('base64url');

 const { servidor, recebidas } = grafoFalso();
 await new Promise(r => servidor.listen(0, '127.0.0.1', r));
 const grafo = `http://127.0.0.1:${servidor.address().port}`;
 const env = { META_MARKETING_KEY: CHAVE, META_GRAPH_BASE: grafo };

 const server = createCore({ pool, adminPassword, marketingOptions: { env, adapter: adaptadorFalso(marca) } });
 await new Promise(r => server.listen(0, '127.0.0.1', r));
 const origin = `http://127.0.0.1:${server.address().port}`;

 // Core sem chave de cifragem: reproduz exatamente o estado de produção hoje.
 const semChave = createCore({ pool, adminPassword, marketingOptions: { env: { META_GRAPH_BASE: grafo } } });
 await new Promise(r => semChave.listen(0, '127.0.0.1', r));
 const origemSemChave = `http://127.0.0.1:${semChave.address().port}`;

 const entrar = async alvo => {
  const r = await fetch(alvo + '/api/login', {
   method: 'POST', headers: { origin: alvo, 'Content-Type': 'application/json' },
   body: JSON.stringify({ password: adminPassword }),
  });
  return r.headers.get('set-cookie').split(';')[0];
 };
 const cookie = await entrar(origin);
 const cookieSemChave = await entrar(origemSemChave);
 const conectar = (corpo, alvo = origin, ck = cookie) => fetch(alvo + '/api/marketing/credential', {
  method: 'POST', headers: { cookie: ck, origin: alvo, 'Content-Type': 'application/json' },
  body: JSON.stringify(corpo),
 });

 const TOKEN_UI = 'EAAX' + 'k'.repeat(120);

 try {
  await t.test('exige sessão', async () => {
   const r = await fetch(origin + '/api/marketing/credential', {
    method: 'POST', headers: { origin, 'Content-Type': 'application/json' }, body: '{}',
   });
   assert.equal(r.status, 401);
  });

  await t.test('recusa mutação de outra origem', async () => {
   const r = await fetch(origin + '/api/marketing/credential', {
    method: 'POST', headers: { cookie, origin: 'https://outro.example', 'Content-Type': 'application/json' },
    body: JSON.stringify({ token: TOKEN_UI }),
   });
   assert.equal(r.status, 403);
  });

  await t.test('sem chave de cifragem recusa antes de tocar na Meta', async () => {
   const antes = recebidas.length;
   const r = await conectar({ token: TOKEN_UI, label: `X ${marca}` }, origemSemChave, cookieSemChave);
   assert.equal(r.status, 503);
   assert.match((await r.json()).message, /META_MARKETING_KEY/);
   assert.equal(recebidas.length, antes, 'não pode consultar a Meta sem ter onde guardar');
  });

  await t.test('token malformado é recusado', async () => {
   assert.equal((await conectar({ token: 'curto' })).status, 400);
   assert.equal((await conectar({ token: TOKEN_UI + ' com espaco' })).status, 400);
   assert.equal((await conectar({ token: TOKEN_UI, campo_estranho: 1 })).status, 400);
   assert.equal((await conectar({ token: TOKEN_UI, exchange: true })).status, 400, 'troca sem app id/secret');
  });

  await t.test('conecta, confere na Meta e não devolve o token', async () => {
   const r = await conectar({ token: TOKEN_UI, label: `Painel ${marca}`, app_id: '1234567890', app_secret: 'segredo' });
   assert.equal(r.status, 200);
   const corpo = await r.json();
   const texto = JSON.stringify(corpo);
   assert.ok(!texto.includes(TOKEN_UI), 'o token não pode voltar na resposta');
   assert.ok(!texto.includes('segredo'), 'a chave secreta do app também não');
   assert.equal(corpo.configured, true);
   assert.equal(corpo.verified, true);
   assert.equal(corpo.never_expires, true, 'expires_at 0 na Meta significa não expira');
   assert.equal(corpo.connected_via, 'panel');
   assert.ok(corpo.fingerprint);

   const chamada = recebidas.find(c => c.path.includes('debug_token'));
   assert.ok(chamada, 'o token precisa ser conferido antes de gravar');
   assert.equal(chamada.auth, `Bearer ${TOKEN_UI}`, 'vai no cabeçalho');
  });

  await t.test('o banco guarda cifrado, nunca em claro', async () => {
   const linha = (await pool.query(
    'SELECT token_ciphertext,connected_via,connected_by_subject FROM marketing_credentials WHERE label=$1',
    [`Painel ${marca}`])).rows[0];
   assert.ok(!linha.token_ciphertext.toString('utf8').includes('EAAX'));
   assert.equal(linha.connected_via, 'panel');
   assert.equal(linha.connected_by_subject, 'local-bootstrap');
  });

  await t.test('troca de token curto acontece no servidor', async () => {
   const r = await conectar({
    token: 'EAAcurto' + 'z'.repeat(30), label: `Trocado ${marca}`,
    exchange: true, app_id: '1234567890', app_secret: 'segredo',
   });
   assert.equal(r.status, 200);
   const corpo = await r.json();
   assert.ok(!JSON.stringify(corpo).includes('TOKEN-LONGO'), 'nem o token trocado volta');
   assert.ok(recebidas.some(c => c.path.endsWith('/oauth/access_token')));
  });

  await t.test('conectar de novo revoga a anterior: uma ativa por provedor', async () => {
   const ativas = await pool.query(
    "SELECT count(*)::int c FROM marketing_credentials WHERE provider='meta' AND active");
   assert.equal(ativas.rows[0].c, 1);
   const antiga = await pool.query(
    'SELECT active,revoked_at FROM marketing_credentials WHERE label=$1', [`Painel ${marca}`]);
   assert.equal(antiga.rows[0].active, false);
   assert.ok(antiga.rows[0].revoked_at, 'a anterior fica no histórico, não é apagada');
  });

  await t.test('revogar desativa sem apagar, e revogar duas vezes é conflito', async () => {
   const revogar = () => fetch(origin + '/api/marketing/credential/revoke', {
    method: 'POST', headers: { cookie, origin },
   });
   assert.equal((await revogar()).status, 200);
   const linhas = await pool.query(
    'SELECT count(*)::int c FROM marketing_credentials WHERE label LIKE $1', [`%${marca}`]);
   assert.equal(linhas.rows[0].c, 2, 'as duas linhas continuam no banco');
   assert.equal((await revogar()).status, 409);
  });

  await t.test('depois de revogar, a tela volta ao estado vazio honesto', async () => {
   const corpo = await (await fetch(origin + '/api/marketing/overview', { headers: { cookie } })).json();
   assert.equal(corpo.configured, false);
   assert.equal(corpo.key_configured, true);
  });
 } finally {
  await pool.query('DELETE FROM marketing_credentials WHERE label LIKE $1', [`%${marca}`]);
  for (const s2 of [server, semChave]) { s2.closeAllConnections(); await new Promise(r => s2.close(r)); }
  await new Promise(r => servidor.close(r));
  await pool.end();
 }
});

test('Conectar com Facebook (OAuth)', async t => {
 const pool = new pg.Pool({ connectionString: testConnectionString().connectionString, max: 3 });
 if (await credencialRealAtiva(pool)) { t.skip(AVISO_BANCO_REAL); await pool.end(); return; }
 const inicio = (await pool.query('SELECT now() AS t')).rows[0].t;
 const adminPassword = randomBytes(32).toString('base64url');

 const { servidor, recebidas } = grafoFalso();
 await new Promise(r => servidor.listen(0, '127.0.0.1', r));
 const grafo = `http://127.0.0.1:${servidor.address().port}`;
 const env = {
  META_MARKETING_KEY: CHAVE, META_GRAPH_BASE: grafo,
  META_APP_ID: '1234567890', META_APP_SECRET: 'segredo-do-app-de-teste',
 };
 const server = createCore({ pool, adminPassword, marketingOptions: { env } });
 await new Promise(r => server.listen(0, '127.0.0.1', r));
 const origin = `http://127.0.0.1:${server.address().port}`;

 const semApp = createCore({ pool, adminPassword, marketingOptions: { env: { META_MARKETING_KEY: CHAVE } } });
 await new Promise(r => semApp.listen(0, '127.0.0.1', r));
 const origemSemApp = `http://127.0.0.1:${semApp.address().port}`;

 const entrar = async alvo => {
  const r = await fetch(alvo + '/api/login', {
   method: 'POST', headers: { origin: alvo, 'Content-Type': 'application/json' },
   body: JSON.stringify({ password: adminPassword }),
  });
  return r.headers.get('set-cookie').split(';')[0];
 };
 const cookie = await entrar(origin);
 const cookieSemApp = await entrar(origemSemApp);
 const autorizar = (alvo = origin, ck = cookie) =>
  fetch(alvo + '/api/marketing/meta/authorize', { method: 'POST', headers: { cookie: ck, origin: alvo } });
 // O retorno vem do navegador, redirecionado pela Meta: sem cookie de propósito,
 // que é como ele chega em desenvolvimento (SameSite=Strict).
 const retornar = qs => fetch(origin + '/api/marketing/meta/callback?' + qs, { redirect: 'manual' });
 const destinoDe = r => r.headers.get('location');
 const iniciar = async () => new URL((await (await autorizar()).json()).url).searchParams.get('state');

 try {
  await t.test('iniciar exige sessão e a origem exata', async () => {
   const semSessao = await fetch(origin + '/api/marketing/meta/authorize', { method: 'POST', headers: { origin } });
   assert.equal(semSessao.status, 401);
   const outraOrigem = await fetch(origin + '/api/marketing/meta/authorize', {
    method: 'POST', headers: { cookie, origin: 'https://outro.example' },
   });
   assert.equal(outraOrigem.status, 403);
  });

  await t.test('sem app da Meta configurado, não inicia fluxo', async () => {
   const r = await autorizar(origemSemApp, cookieSemApp);
   assert.equal(r.status, 503);
   assert.match((await r.json()).message, /META_APP_ID/);
  });

  await t.test('a tela sabe se o OAuth está disponível', async () => {
   const com = await (await fetch(origin + '/api/marketing/overview', { headers: { cookie } })).json();
   assert.equal(com.oauth_available, true);
   const sem = await (await fetch(origemSemApp + '/api/marketing/overview', { headers: { cookie: cookieSemApp } })).json();
   assert.equal(sem.oauth_available, false);
  });

  let state;
  await t.test('autorizar devolve o diálogo da Meta e guarda o state só como hash', async () => {
   const r = await autorizar();
   assert.equal(r.status, 200);
   const url = new URL((await r.json()).url);
   assert.equal(url.hostname, 'www.facebook.com');
   assert.equal(url.searchParams.get('redirect_uri'), origin + '/api/marketing/meta/callback');
   assert.equal(url.searchParams.get('client_secret'), null);
   state = url.searchParams.get('state');
   assert.ok(state && state.length >= 32);
   const cru = await pool.query('SELECT 1 FROM marketing_oauth_states WHERE state_hash=$1', [state]);
   assert.equal(cru.rowCount, 0, 'o state não pode ser guardado em claro');
   const hash = await pool.query('SELECT redirect_uri FROM marketing_oauth_states WHERE state_hash=$1', [digest(state)]);
   assert.equal(hash.rowCount, 1);
  });

  await t.test('retorno válido troca o código no servidor e grava a credencial por OAuth', async () => {
   const antes = recebidas.length;
   const r = await retornar(`code=codigo-de-teste-12345&state=${state}`);
   assert.equal(r.status, 302);
   assert.equal(destinoDe(r), '/?view=campaigns&meta=ok');
   const chamadas = recebidas.slice(antes);
   assert.ok(chamadas.some(c => c.path.endsWith('/oauth/access_token') && c.query.includes('code=codigo-de-teste-12345')), 'troca do código');
   assert.ok(chamadas.some(c => c.path.endsWith('/oauth/access_token') && c.query.includes('fb_exchange_token')), 'troca por token longo');
   assert.ok(chamadas.some(c => c.path.endsWith('/debug_token')), 'conferência antes de gravar');
   const cred = (await pool.query(
    "SELECT connected_via, connected_by_subject, token_ciphertext FROM marketing_credentials WHERE provider='meta' AND active")).rows[0];
   assert.equal(cred.connected_via, 'oauth');
   assert.equal(cred.connected_by_subject, 'local-bootstrap', 'o autor vem do state, não do cookie');
   assert.ok(!cred.token_ciphertext.toString('utf8').includes('TOKEN-LONGO'), 'gravado cifrado');
  });

  await t.test('o mesmo state não serve duas vezes', async () => {
   const r = await retornar(`code=codigo-de-teste-12345&state=${state}`);
   assert.equal(destinoDe(r), '/?view=campaigns&meta=expired');
  });

  await t.test('state inventado não passa', async () => {
   const r = await retornar(`code=codigo-de-teste-12345&state=${'a'.repeat(43)}`);
   assert.equal(destinoDe(r), '/?view=campaigns&meta=expired');
   const lixo = await retornar('code=codigo-de-teste-12345&state=' + encodeURIComponent('<script>'));
   assert.equal(destinoDe(lixo), '/?view=campaigns&meta=expired');
  });

  await t.test('recusa na Meta queima o state e não grava nada', async () => {
   const contar = async () => (await pool.query(
    "SELECT count(*)::int c FROM marketing_credentials WHERE connected_via='oauth'")).rows[0].c;
   const antes = await contar();
   const novo = await iniciar();
   const r = await retornar(`error=access_denied&error_reason=user_denied&state=${novo}`);
   assert.equal(destinoDe(r), '/?view=campaigns&meta=denied');
   const reuso = await retornar(`code=codigo-de-teste-12345&state=${novo}`);
   assert.equal(destinoDe(reuso), '/?view=campaigns&meta=expired', 'recusa também consome o state');
   assert.equal(await contar(), antes);
  });

  await t.test('o redirecionamento nunca carrega token nem mensagem do provedor', async () => {
   const novo = await iniciar();
   const r = await retornar(`error=access_denied&error_description=${encodeURIComponent('detalhe interno da Meta')}&state=${novo}`);
   const destino = destinoDe(r);
   assert.ok(!destino.includes('detalhe'), 'mensagem do provedor fica fora da URL');
   assert.match(destino, /^\/\?view=campaigns&meta=[a-z]+$/);
  });
 } finally {
  await pool.query(
   "DELETE FROM marketing_credentials WHERE connected_via='oauth' AND connected_by_subject='local-bootstrap' AND created_at >= $1", [inicio]);
  await pool.query(
   "DELETE FROM marketing_oauth_states WHERE operator_subject='local-bootstrap' AND created_at >= $1", [inicio]);
  for (const s2 of [server, semApp]) { s2.closeAllConnections(); await new Promise(r => s2.close(r)); }
  await new Promise(r => servidor.close(r));
  await pool.end();
 }
});
