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

const CHAVE = randomBytes(32).toString('base64');
const TOKEN_FALSO = 'EAAG' + 'z'.repeat(190);

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
 const marca = randomUUID().slice(0, 8).replace(/-/g, '');
 const adminPassword = randomBytes(32).toString('base64url');
 const env = { CORE_MARKETING_KEY: CHAVE };

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
   await client.query('DELETE FROM marketing_sync_runs WHERE actor_subject=$1 OR actor_subject IS NULL', ['local-bootstrap']);
   await client.query('DELETE FROM marketing_credentials WHERE label=$1', [`Teste ${marca}`]);
   await client.query('COMMIT');
  } finally { client.release(); }
  server.closeAllConnections();
  await new Promise(r => server.close(r));
  await pool.end();
 }
});
