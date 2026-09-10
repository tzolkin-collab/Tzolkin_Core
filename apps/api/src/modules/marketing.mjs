// Campanhas de marketing: credencial, coleta e atribuição.
//
// O QUE ESTA ROTA NUNCA FAZ
// Não devolve o token ao navegador — em resposta nenhuma, nem parcial, nem
// mascarado. O painel recebe validade, escopos e impressão digital; com isso dá
// para operar (saber se vai expirar, se tem `ads_read`, se é o mesmo de antes)
// sem que a credencial saia do servidor.
//
// ATRIBUIÇÃO É DECISÃO, NÃO DETECÇÃO
// A heurística de nome só SUGERE, e a sugestão é calculada na leitura — nunca
// gravada. Vínculo no banco existe apenas quando alguém confirmou, e a trilha
// registra quem. Custo atribuído ao produto errado vira margem errada, e
// margem errada vira decisão de preço errada.
//
// Ver docs/INTEGRATIONS.md e db/migrations/026_marketing_campaigns.sql
import { fail, input, isProductId, isUuid, json, onlyParams, text } from '../platform/http.mjs';
import { readKey, seal, open, fingerprint, scrub } from '../platform/secrets.mjs';
import { createMetaGraphAdapter, exchangeLongLivedToken, buildAuthorizeUrl, exchangeCodeForToken } from '../integrations/meta-graph.mjs';
import { randomBytes } from 'node:crypto';
import { digest } from '../platform/session.mjs';
import { commercialPermission } from '../modules/commercial-keys.mjs';

const PROVIDER = 'meta';
const JANELA_PADRAO_DIAS = 90;

const hoje = (clock = Date.now) => new Date(clock()).toISOString().slice(0, 10);
const diasAtras = (n, clock = Date.now) => new Date(clock() - n * 86400000).toISOString().slice(0, 10);
const ehData = v => typeof v === 'string' && /^\d{4}-\d{2}-\d{2}$/.test(v) && Number.isFinite(Date.parse(v));

/**
 * Carrega a credencial ativa e devolve o token em claro APENAS para uso
 * imediato numa chamada de saída. Nunca retorne o campo `token` num `reply`.
 */
async function credencialAtiva(pool, env) {
 const r = await pool.query(
  `SELECT id,label,token_ciphertext,token_iv,token_tag,token_fingerprint,token_type,
          scopes,expires_at,app_id,last_verified_at,last_error,created_at,updated_at
     FROM marketing_credentials WHERE provider=$1 AND active`, [PROVIDER]);
 if (!r.rowCount) return null;
 const linha = r.rows[0];
 const token = open(
  { ciphertext: linha.token_ciphertext, iv: linha.token_iv, tag: linha.token_tag },
  readKey(env));
 return { linha, token };
}

/** Só o que pode ser mostrado. A separação é o ponto: o token não passa por aqui. */
export function credencialPublica(linha, clock = Date.now) {
 if (!linha) return { configured: false };
 const expira = linha.expires_at ? Date.parse(linha.expires_at) : null;
 const diasRestantes = expira ? Math.floor((expira - clock()) / 86400000) : null;
 return {
  configured: true,
  label: linha.label,
  token_type: linha.token_type,
  // Impressão digital, não o token. Serve para responder "trocaram a chave?".
  fingerprint: linha.token_fingerprint,
  scopes: linha.scopes || [],
  // `null` aqui significa "não expira" (Usuário do Sistema), não "não sei".
  expires_at: linha.expires_at,
  never_expires: linha.expires_at == null,
  days_remaining: diasRestantes,
  // A Meta não avisa: o Core precisa avisar antes de a coleta parar sozinha.
  expiring_soon: diasRestantes != null && diasRestantes <= 14,
  expired: diasRestantes != null && diasRestantes < 0,
  can_read_ads: (linha.scopes || []).includes('ads_read'),
  last_verified_at: linha.last_verified_at,
  last_error: linha.last_error,
  created_at: linha.created_at,
  connected_by: linha.connected_by_email || linha.connected_by_subject || null,
  connected_via: linha.connected_via || 'script',
 };
}

/**
 * A chave de cifragem existe? A tela precisa saber ANTES de alguém digitar um
 * token, senão o formulário aceita a credencial e falha ao gravar.
 */
export function chaveConfigurada(env) {
 try { readKey(env); return true; } catch { return false; }
}

/** OAuth depende do app da Meta: sem ID e segredo não existe diálogo de autorização. */
export function oauthConfigurado(env) {
 return Boolean(env.META_APP_ID && env.META_APP_SECRET);
}

/**
 * Sugere um vínculo por nome, sem gravar nada.
 * Conservadora de propósito: só sugere quando EXATAMENTE um candidato casa como
 * palavra inteira. Ambiguidade não vira palpite — vira nenhuma sugestão.
 */
export function sugerirVinculo(nomeCampanha, produtos, contratacoes) {
 const nome = String(nomeCampanha || '').toLowerCase();
 if (!nome) return null;
 const casa = rotulo => {
  const alvo = String(rotulo || '').toLowerCase().trim();
  if (alvo.length < 3) return false;
  return new RegExp(`(^|[^a-z0-9])${alvo.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}([^a-z0-9]|$)`).test(nome);
 };
 const candidatos = [
  ...produtos.filter(p => casa(p.name) || casa(p.id)).map(p => ({ kind: 'product', product_id: p.id, label: p.name })),
  ...contratacoes.filter(e => casa(e.label) || casa(e.tenant_name))
   .map(e => ({ kind: 'engagement', engagement_id: e.id, label: e.label, service_model: e.service_model })),
 ];
 return candidatos.length === 1 ? candidatos[0] : null;
}

// Consulta única de campanhas com gasto somado no período e o vínculo atual.
const SQL_CAMPANHAS = `
 SELECT c.provider, c.external_id, c.name, c.objective, c.status, c.effective_status,
        c.daily_budget_cents, c.lifetime_budget_cents, c.start_time, c.stop_time, c.collected_at,
        c.account_external_id, a.name AS account_name, a.currency,
        b.product_id, b.engagement_id, b.origin AS binding_origin, b.note AS binding_note,
        b.actor_email AS bound_by, b.updated_at AS bound_at,
        p.name AS product_name,
        e.label AS engagement_label, e.service_model, t.name AS tenant_name,
        COALESCE(i.spend_cents,0)::bigint AS spend_cents,
        COALESCE(i.impressions,0)::bigint AS impressions,
        COALESCE(i.clicks,0)::bigint AS clicks,
        COALESCE(i.leads,0)::bigint AS leads,
        COALESCE(i.purchases,0)::bigint AS purchases,
        i.dias
   FROM marketing_campaigns c
   JOIN marketing_accounts a ON a.provider=c.provider AND a.external_id=c.account_external_id
   LEFT JOIN marketing_campaign_bindings b
          ON b.provider=c.provider AND b.external_campaign_id=c.external_id AND b.active
   LEFT JOIN products p ON p.id=b.product_id
   LEFT JOIN client_engagements e ON e.id=b.engagement_id
   LEFT JOIN tenants t ON t.id=e.tenant_id
   LEFT JOIN LATERAL (
     SELECT SUM(spend_cents) spend_cents, SUM(impressions) impressions, SUM(clicks) clicks,
            SUM(leads) leads, SUM(purchases) purchases, count(*) dias
       FROM marketing_campaign_insights s
      WHERE s.provider=c.provider AND s.campaign_external_id=c.external_id
        AND s.date_start BETWEEN $1 AND $2
   ) i ON true
  WHERE c.provider=$3`;

export function marketingRoutes(router, { env = process.env, clock = Date.now, adapter = null } = {}) {

 const abrirAdaptador = async pool => {
  const credencial = await credencialAtiva(pool, env);
  if (!credencial) return null;
  if (adapter) return { credencial, api: adapter };
  return {
   credencial,
   api: createMetaGraphAdapter({
    token: credencial.token,
    appId: credencial.linha.app_id || env.META_APP_ID || null,
    appSecret: env.META_APP_SECRET || null,
    ...(env.META_GRAPH_BASE ? { baseUrl: env.META_GRAPH_BASE } : {}),
    ...(env.META_GRAPH_VERSION ? { version: env.META_GRAPH_VERSION } : {}),
   }),
  };
 };

 // ---------------------------------------------------------------------------
 // Visão geral: é a tela "Campanhas" do Core
 // ---------------------------------------------------------------------------
 router.get('/api/marketing/overview', async ({ url, pool, reply }) => {
  onlyParams(url.searchParams, ['since', 'until']);
  const since = url.searchParams.get('since') || diasAtras(JANELA_PADRAO_DIAS, clock);
  const until = url.searchParams.get('until') || hoje(clock);
  if (!ehData(since) || !ehData(until) || since > until) throw fail(400, 'Período inválido.');

  const cred = await pool.query(
   'SELECT * FROM marketing_credentials WHERE provider=$1 AND active', [PROVIDER]);

  // Sem credencial não é erro: é estado vazio honesto, como em stripe-catalog.
  if (!cred.rowCount) return reply(200, {
   ...credencialPublica(null), key_configured: chaveConfigurada(env), oauth_available: oauthConfigurado(env),
   accounts: [], campaigns: [], summary: null,
   last_sync: null, unassigned: 0, window: { since, until },
  });

  const [contas, campanhas, ultimaColeta] = await Promise.all([
   pool.query('SELECT * FROM marketing_accounts WHERE provider=$1 ORDER BY name', [PROVIDER]),
   pool.query(SQL_CAMPANHAS + ' ORDER BY COALESCE(i.spend_cents,0) DESC, c.name', [since, until, PROVIDER]),
   pool.query('SELECT * FROM marketing_sync_runs WHERE provider=$1 ORDER BY started_at DESC LIMIT 1', [PROVIDER]),
  ]);

  const linhas = campanhas.rows;
  const soma = campo => linhas.reduce((t, l) => t + Number(l[campo] || 0), 0);
  const semVinculo = linhas.filter(l => !l.product_id && !l.engagement_id);

  return reply(200, {
   ...credencialPublica(cred.rows[0], clock),
   key_configured: chaveConfigurada(env),
   oauth_available: oauthConfigurado(env),
   window: { since, until },
   accounts: contas.rows,
   campaigns: linhas,
   summary: {
    campaigns: linhas.length,
    // Gasto do período, em centavos inteiros. A moeda vem da conta.
    spend_cents: soma('spend_cents'),
    impressions: soma('impressions'),
    clicks: soma('clicks'),
    leads: soma('leads'),
    purchases: soma('purchases'),
    // Quanto do gasto ainda não tem dono: é a pendência que a tela cobra.
    unassigned_spend_cents: semVinculo.reduce((t, l) => t + Number(l.spend_cents || 0), 0),
   },
   unassigned: semVinculo.length,
   last_sync: ultimaColeta.rows[0] || null,
  });
 }, { body: false });

 // ---------------------------------------------------------------------------
 // Campanhas de UM produto  /  de UMA contratação
 // ---------------------------------------------------------------------------
 const porContexto = async ({ pool, reply, url, filtro, valor }) => {
  onlyParams(url.searchParams, ['since', 'until']);
  const since = url.searchParams.get('since') || diasAtras(JANELA_PADRAO_DIAS, clock);
  const until = url.searchParams.get('until') || hoje(clock);
  if (!ehData(since) || !ehData(until) || since > until) throw fail(400, 'Período inválido.');

  const r = await pool.query(
   `${SQL_CAMPANHAS} AND b.${filtro}=$4 ORDER BY COALESCE(i.spend_cents,0) DESC, c.name`,
   [since, until, PROVIDER, valor]);
  const soma = campo => r.rows.reduce((t, l) => t + Number(l[campo] || 0), 0);
  return reply(200, {
   window: { since, until },
   campaigns: r.rows,
   summary: {
    campaigns: r.rows.length, spend_cents: soma('spend_cents'),
    impressions: soma('impressions'), clicks: soma('clicks'),
    leads: soma('leads'), purchases: soma('purchases'),
   },
  });
 };

 router.get('/api/products/:productId/campaigns', async ({ params, pool, reply, url }) => {
  if (!isProductId(params.productId)) throw fail(400, 'Produto inválido.');
  return porContexto({ pool, reply, url, filtro: 'product_id', valor: params.productId });
 }, { body: false });

 router.get('/api/services/:engagementId/campaigns', async ({ params, pool, reply, url }) => {
  if (!isUuid(params.engagementId)) throw fail(400, 'Contratação inválida.');
  return porContexto({ pool, reply, url, filtro: 'engagement_id', valor: params.engagementId });
 }, { body: false });

 // ---------------------------------------------------------------------------
 // Alvos possíveis + sugestão (calculada, nunca gravada)
 // ---------------------------------------------------------------------------
 router.get('/api/marketing/targets', async ({ url, pool, reply }) => {
  onlyParams(url.searchParams, ['campaign_id']);
  const [produtos, contratacoes] = await Promise.all([
   pool.query("SELECT id,name,portfolio_kind FROM products WHERE lifecycle_status IN ('active','draft') ORDER BY name"),
   pool.query(`SELECT e.id,e.label,e.service_model,e.status,t.name AS tenant_name
                 FROM client_engagements e JOIN tenants t ON t.id=e.tenant_id
                ORDER BY t.name,e.label`),
  ]);
  const campanhaId = url.searchParams.get('campaign_id');
  let suggestion = null;
  if (campanhaId) {
   const c = await pool.query(
    'SELECT name FROM marketing_campaigns WHERE provider=$1 AND external_id=$2', [PROVIDER, campanhaId]);
   if (c.rowCount) suggestion = sugerirVinculo(c.rows[0].name, produtos.rows, contratacoes.rows);
  }
  return reply(200, {
   products: produtos.rows,
   engagements: contratacoes.rows,
   // A taxonomia que separa serviço sob demanda de mentoria, assessoria e
   // consultoria já existe em client_engagements.service_model.
   service_models: ['on_demand', 'education', 'consulting', 'advisory', 'product', 'unclassified'],
   suggestion,
   suggestion_is_advisory: true,
  });
 }, { body: false });

 // ---------------------------------------------------------------------------
 // Vincular / desvincular
 // ---------------------------------------------------------------------------
 router.put('/api/marketing/campaigns/:id/binding', async ({ client, params, body, operator }) => {
  await commercialPermission(client, operator, true);
  input(body, ['product_id', 'engagement_id', 'note']);
  const campanhaId = text(params.id, 1, 64);

  const campanha = await client.query(
   'SELECT external_id,name FROM marketing_campaigns WHERE provider=$1 AND external_id=$2',
   [PROVIDER, campanhaId]);
  if (!campanha.rowCount) throw fail(404, 'Campanha não encontrada.');

  const produto = body.product_id ?? null;
  const contratacao = body.engagement_id ?? null;
  if (produto != null && !isProductId(produto)) throw fail(400, 'Produto inválido.');
  if (contratacao != null && !isUuid(contratacao)) throw fail(400, 'Contratação inválida.');
  // A mesma regra do CHECK, aplicada antes para dar mensagem legível.
  if (produto && contratacao) throw fail(400, 'Uma campanha pertence a um produto OU a uma contratação, nunca aos dois.');

  const anterior = (await client.query(
   'SELECT product_id,engagement_id,active FROM marketing_campaign_bindings WHERE provider=$1 AND external_campaign_id=$2 FOR UPDATE',
   [PROVIDER, campanhaId])).rows[0] || null;

  // Nenhum dos dois = desvincular. UPDATE, nunca DELETE: a role de produção
  // não tem DELETE, e o histórico do vínculo tem valor contábil.
  const desvinculando = !produto && !contratacao;
  if (desvinculando && !anterior?.active) throw fail(409, 'Esta campanha já não tem vínculo.');

  if (produto && !(await client.query("SELECT 1 FROM products WHERE id=$1 AND lifecycle_status IN ('active','draft')", [produto])).rowCount)
   throw fail(404, 'Produto não encontrado.');
  if (contratacao && !(await client.query('SELECT 1 FROM client_engagements WHERE id=$1', [contratacao])).rowCount)
   throw fail(404, 'Contratação não encontrada.');

  await client.query(
   `INSERT INTO marketing_campaign_bindings
      (provider,external_campaign_id,product_id,engagement_id,active,origin,note,actor_subject,actor_email)
    VALUES($1,$2,$3,$4,$5,'manual',$6,$7,$8)
    ON CONFLICT (provider,external_campaign_id) DO UPDATE SET
      product_id=EXCLUDED.product_id, engagement_id=EXCLUDED.engagement_id,
      active=EXCLUDED.active, origin='manual', note=EXCLUDED.note,
      actor_subject=EXCLUDED.actor_subject, actor_email=EXCLUDED.actor_email, updated_at=now()`,
   [PROVIDER, campanhaId, produto, contratacao, !desvinculando,
    body.note == null ? null : text(body.note, 1, 300), operator?.subject ?? null, operator?.email ?? null]);

  await client.query(
   `INSERT INTO marketing_binding_audit
      (provider,external_campaign_id,action,product_id,engagement_id,previous,actor_subject,actor_email)
    VALUES($1,$2,$3,$4,$5,$6,$7,$8)`,
   [PROVIDER, campanhaId,
    desvinculando ? 'unbound' : (anterior?.active ? 'rebound' : 'bound'),
    produto, contratacao, anterior || {}, operator?.subject ?? null, operator?.email ?? null]);

  return { tenant: null, type: 'marketing.binding.saved' };
 }, { transactional: true, audit: false });

 // ---------------------------------------------------------------------------
 // Coleta
 // ---------------------------------------------------------------------------
 // Fora de transação de propósito: a rede vem primeiro, o banco depois.
 // Segurar uma conexão do pool durante várias chamadas à Meta esgota o pool.
 router.post('/api/marketing/sync', async ({ url, pool, reply, operator }) => {
  await commercialPermission(pool, operator, true, true);
  onlyParams(url.searchParams, ['since', 'until']);
  const since = url.searchParams.get('since') || diasAtras(JANELA_PADRAO_DIAS, clock);
  const until = url.searchParams.get('until') || hoje(clock);
  if (!ehData(since) || !ehData(until) || since > until) throw fail(400, 'Período inválido.');

  const aberto = await abrirAdaptador(pool);
  if (!aberto) throw fail(503, 'Nenhuma credencial da Meta conectada. Rode `npm run marketing:connect` no servidor.');
  const { api, credencial } = aberto;

  const coletado = { contas: [], campanhas: [], insights: [], truncado: false };
  let estado = 'ok';
  let erro = null;

  try {
   coletado.contas = await api.listAdAccounts();
   for (const conta of coletado.contas) {
    const { campaigns, truncated } = await api.listCampaigns(conta.external_id);
    coletado.campanhas.push(...campaigns);
    coletado.truncado ||= truncated;
    const { insights, truncated: cortou } = await api.listCampaignInsights(conta.external_id, {
     since, until, currency: conta.currency,
    });
    coletado.insights.push(...insights);
    coletado.truncado ||= cortou;
   }
  } catch (e) {
   // Falha no meio ainda grava o que veio: coleta parcial é melhor que nada,
   // desde que a tela saiba que foi parcial.
   estado = coletado.campanhas.length ? 'partial' : 'failed';
   // Esta mensagem é gravada no banco e mostrada no painel. Se a Meta ecoar o
   // token numa mensagem de erro, é exatamente aqui que ele vazaria.
   erro = scrub(e.message, credencial.token);
  }

  const client = await pool.connect();
  let escritos = 0;
  try {
   await client.query('BEGIN');
   for (const c of coletado.contas) {
    await client.query(
     `INSERT INTO marketing_accounts(provider,external_id,name,currency,account_status,active,business_name,timezone)
      VALUES($1,$2,$3,$4,$5,$6,$7,$8)
      ON CONFLICT (provider,external_id) DO UPDATE SET
        name=EXCLUDED.name, currency=EXCLUDED.currency, account_status=EXCLUDED.account_status,
        active=EXCLUDED.active, business_name=EXCLUDED.business_name, timezone=EXCLUDED.timezone,
        updated_at=now()`,
     [PROVIDER, c.external_id, c.name, c.currency, c.account_status, c.active, c.business_name, c.timezone]);
   }
   for (const c of coletado.campanhas) {
    await client.query(
     `INSERT INTO marketing_campaigns(provider,external_id,account_external_id,name,objective,status,
        effective_status,daily_budget_cents,lifetime_budget_cents,budget_remaining_cents,
        start_time,stop_time,created_time,updated_time,collected_at)
      VALUES($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,now())
      ON CONFLICT (provider,external_id) DO UPDATE SET
        account_external_id=EXCLUDED.account_external_id, name=EXCLUDED.name, objective=EXCLUDED.objective,
        status=EXCLUDED.status, effective_status=EXCLUDED.effective_status,
        daily_budget_cents=EXCLUDED.daily_budget_cents, lifetime_budget_cents=EXCLUDED.lifetime_budget_cents,
        budget_remaining_cents=EXCLUDED.budget_remaining_cents, start_time=EXCLUDED.start_time,
        stop_time=EXCLUDED.stop_time, updated_time=EXCLUDED.updated_time, collected_at=now()`,
     [PROVIDER, c.external_id, c.account_external_id, c.name, c.objective, c.status, c.effective_status,
      c.daily_budget_cents, c.lifetime_budget_cents, c.budget_remaining_cents,
      c.start_time, c.stop_time, c.created_time, c.updated_time]);
   }
   for (const i of coletado.insights) {
    // Recoletar o mesmo dia atualiza em vez de duplicar: a Meta revisa números
    // retroativamente por alguns dias, então o último valor é o que vale.
    const r = await client.query(
     `INSERT INTO marketing_campaign_insights(provider,campaign_external_id,date_start,date_stop,
        spend_cents,currency,impressions,clicks,reach,leads,purchases,messaging,actions_total,collected_at)
      VALUES($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,now())
      ON CONFLICT (provider,campaign_external_id,date_start) DO UPDATE SET
        date_stop=EXCLUDED.date_stop, spend_cents=EXCLUDED.spend_cents, currency=EXCLUDED.currency,
        impressions=EXCLUDED.impressions, clicks=EXCLUDED.clicks, reach=EXCLUDED.reach,
        leads=EXCLUDED.leads, purchases=EXCLUDED.purchases, messaging=EXCLUDED.messaging,
        actions_total=EXCLUDED.actions_total, collected_at=now()`,
     [PROVIDER, i.campaign_external_id, i.date_start, i.date_stop, i.spend_cents, i.currency,
      i.impressions, i.clicks, i.reach, i.leads, i.purchases, i.messaging, i.actions_total]);
    escritos += r.rowCount;
   }
   await client.query(
    `INSERT INTO marketing_sync_runs(provider,status,accounts_seen,campaigns_seen,insights_written,
       window_since,window_until,truncated,error,actor_subject,actor_email,finished_at)
     VALUES($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,now())`,
    [PROVIDER, estado, coletado.contas.length, coletado.campanhas.length, escritos,
     since, until, coletado.truncado, erro, operator?.subject ?? null, operator?.email ?? null]);
   await client.query(
    'UPDATE marketing_credentials SET last_verified_at=now(), last_error=$2, updated_at=now() WHERE id=$1',
    [credencial.linha.id, erro]);
   await client.query('COMMIT');
  } catch (e) { await client.query('ROLLBACK'); throw e; }
  finally { client.release(); }

  return reply(estado === 'failed' ? 502 : 200, {
   status: estado, accounts: coletado.contas.length, campaigns: coletado.campanhas.length,
   insights_written: escritos, truncated: coletado.truncado, window: { since, until }, error: erro,
  });
 });

 // ---------------------------------------------------------------------------
 // Saúde do token, conferida na Meta
 // ---------------------------------------------------------------------------

 // ---------------------------------------------------------------------------
 // Conectar a credencial pelo painel
 // ---------------------------------------------------------------------------
 // Fora de transação: a troca e a conferência na Meta são chamadas de rede, e
 // segurar conexão do pool durante rede esgota o pool. O corpo é lido aqui
 // porque só rota transacional recebe `body` pronto do app.mjs.
 //
 // O token entra e não volta: a resposta é a mesma forma pública do GET.
 // Nada neste caminho escreve o token em log.
 router.post('/api/marketing/credential', async ({ req, pool, reply, operator }) => {
  await commercialPermission(pool, operator, true, true);

  // Falha antes de tocar na Meta: sem chave não há onde guardar com segurança,
  // e é melhor dizer isso do que gravar em claro.
  readKey(env);

  const body = await json(req, 8192);
  input(body, ['token', 'label', 'exchange', 'app_id', 'app_secret']);

  // `text()` não serve: apara e limita a 200, e um token da Graph passa disso.
  const informado = typeof body.token === 'string' ? body.token.trim() : '';
  if (informado.length < 20 || informado.length > 1000 || /[\u0000-\u001f\s]/.test(informado))
   throw fail(400, 'Token inválido.');

  const rotulo = text(body.label ?? 'Meta Ads', 2, 120);
  const trocar = body.exchange === true;
  const appId = body.app_id == null || body.app_id === ''
   ? (env.META_APP_ID || null) : String(body.app_id).trim();
  const appSecret = body.app_secret == null || body.app_secret === ''
   ? (env.META_APP_SECRET || null) : String(body.app_secret).trim();
  if (appId != null && !/^\d{5,25}$/.test(appId)) throw fail(400, 'ID do app inválido.');
  if (trocar && (!appId || !appSecret))
   throw fail(400, 'A troca por token de longa duração exige ID e chave secreta do app.');

  let token = informado;
  let tipo = 'long_lived_user';
  let expiraEm = null;
  let escopos = [];

  if (trocar) {
   const trocado = await exchangeLongLivedToken({
    appId, appSecret, shortLivedToken: token,
    ...(env.META_GRAPH_BASE ? { baseUrl: env.META_GRAPH_BASE } : {}),
    ...(env.META_GRAPH_VERSION ? { version: env.META_GRAPH_VERSION } : {}),
   });
   token = trocado.access_token;
   expiraEm = trocado.expires_at;
   tipo = trocado.token_type;
  }

  // Conferir antes de gravar: guardar credencial que já não funciona só adia a
  // descoberta para a primeira coleta. Sem app id/secret não dá para conferir —
  // segue mesmo assim, e a tela diz que não foi conferida.
  if (appId && appSecret) {
   const estado = await createMetaGraphAdapter({
    token, appId, appSecret,
    ...(env.META_GRAPH_BASE ? { baseUrl: env.META_GRAPH_BASE } : {}),
    ...(env.META_GRAPH_VERSION ? { version: env.META_GRAPH_VERSION } : {}),
   }).debugToken();
   if (!estado.valid) throw fail(400, 'A Meta considera este token inválido' + (estado.error ? `: ${scrub(estado.error, token)}` : '.'));
   escopos = estado.scopes;
   if (estado.never_expires) { expiraEm = null; tipo = 'system_user'; }
   else if (estado.expires_at) expiraEm = estado.expires_at;
  }

  const client = await pool.connect();
  try {
   await client.query('BEGIN');
   const gravada = await guardarCredencial(client, {
    token, label: rotulo, tokenType: tipo, scopes: escopos, expiresAt: expiraEm, appId,
    operator, via: 'panel',
   }, env);
   await client.query('COMMIT');
   const linha = (await pool.query('SELECT * FROM marketing_credentials WHERE id=$1', [gravada.id])).rows[0];
   // A resposta é a forma pública: validade, escopos e impressão digital.
   return reply(200, { ...credencialPublica(linha, clock), verified: Boolean(appId && appSecret) });
  } catch (e) { await client.query('ROLLBACK'); throw e; }
  finally { client.release(); }
 });

 // ---------------------------------------------------------------------------
 // OAuth — "Conectar com Facebook", o mesmo fluxo que a Utmify usa
 // ---------------------------------------------------------------------------
 // O token vai da Meta direto para o servidor. Ninguém copia, cola nem vê.
 const RETORNO_META = '/api/marketing/meta/callback';
 const enderecoDeRetorno = url => env.META_REDIRECT_URI || (url.origin + RETORNO_META);
 const extrasGraph = () => ({
  ...(env.META_GRAPH_BASE ? { baseUrl: env.META_GRAPH_BASE } : {}),
  ...(env.META_GRAPH_VERSION ? { version: env.META_GRAPH_VERSION } : {}),
 });

 // Inicia o fluxo. POST, e não GET, para passar pela checagem de origem do
 // app.mjs: um GET poderia ser disparado por qualquer página que o operador
 // abrisse. A resposta é só o endereço; quem navega até a Meta é o navegador.
 router.post('/api/marketing/meta/authorize', async ({ client, url, operator }) => {
  await commercialPermission(client, operator, true, true);
  if (!oauthConfigurado(env))
   throw fail(503, 'Defina META_APP_ID e META_APP_SECRET no servidor para conectar com o Facebook.');
  // Sem chave não há onde guardar o token que vai voltar: melhor falhar aqui
  // do que depois de a pessoa autorizar na Meta.
  readKey(env);

  const state = randomBytes(32).toString('base64url');
  const retorno = enderecoDeRetorno(url);
  await client.query(
   `INSERT INTO marketing_oauth_states(state_hash,provider,redirect_uri,operator_subject,operator_email,expires_at)
    VALUES($1,$2,$3,$4,$5,now()+interval '10 minutes')`,
   [digest(state), PROVIDER, retorno, operator?.subject ?? null, operator?.email ?? null]);
  const destino = buildAuthorizeUrl({
   appId: String(env.META_APP_ID).trim(), redirectUri: retorno, state,
   ...(env.META_GRAPH_VERSION ? { version: env.META_GRAPH_VERSION } : {}),
  });
  return { body: { url: destino.href } };
 }, { transactional: true, body: false, audit: false });

 // Retorno da Meta. Público porque o cookie de sessão pode não vir junto — em
 // desenvolvimento ele é SameSite=Strict e não viaja num redirecionamento
 // vindo de facebook.com. Quem autentica é o `state`: criado por um dono
 // autenticado, guardado como hash, válido por 10 minutos, consumido uma vez.
 //
 // Sempre termina num redirecionamento para a tela com um código curto. A
 // mensagem de erro do provedor nunca vai para a URL: URL entra em histórico e
 // em log de proxy.
 router.get(RETORNO_META, async ({ url, pool, res }) => {
  const voltar = codigo => {
   res.writeHead(302, { Location: `/?view=campaigns&meta=${codigo}`, 'Cache-Control': 'no-store' });
   res.end();
  };
  const state = url.searchParams.get('state');
  if (typeof state !== 'string' || !/^[A-Za-z0-9_-]{32,100}$/.test(state)) return voltar('expired');

  // Consome antes de qualquer outra decisão: recusa e erro também queimam o
  // `state`, para que ele não possa ser reaproveitado.
  const fluxo = (await pool.query(
   `UPDATE marketing_oauth_states SET consumed_at=now()
     WHERE state_hash=$1 AND provider=$2 AND consumed_at IS NULL AND expires_at>now()
     RETURNING redirect_uri, operator_subject, operator_email`,
   [digest(state), PROVIDER])).rows[0];
  if (!fluxo) return voltar('expired');

  const code = url.searchParams.get('code');
  if (url.searchParams.get('error') || !code) return voltar('denied');
  if (!/^[\x21-\x7e]{10,2000}$/.test(code)) return voltar('error');
  if (!oauthConfigurado(env)) return voltar('config');

  const appId = String(env.META_APP_ID).trim();
  const appSecret = String(env.META_APP_SECRET);
  let token = null;
  try {
   const curto = await exchangeCodeForToken({ appId, appSecret, code, redirectUri: fluxo.redirect_uri, ...extrasGraph() });
   const longo = await exchangeLongLivedToken({ appId, appSecret, shortLivedToken: curto.access_token, ...extrasGraph() });
   token = longo.access_token;
   let tipo = longo.token_type;
   let expiraEm = longo.expires_at;

   // Conferir antes de gravar, como nos outros dois caminhos de conexão.
   const estado = await createMetaGraphAdapter({ token, appId, appSecret, ...extrasGraph() }).debugToken();
   if (!estado.valid) return voltar('invalid');
   if (estado.never_expires) { expiraEm = null; tipo = 'system_user'; }
   else if (estado.expires_at) expiraEm = estado.expires_at;

   const client = await pool.connect();
   try {
    await client.query('BEGIN');
    await guardarCredencial(client, {
     token, label: 'Meta Ads (Facebook Login)', tokenType: tipo, scopes: estado.scopes,
     expiresAt: expiraEm, appId,
     // O autor vem do state, não do cookie — que pode nem ter vindo.
     operator: { subject: fluxo.operator_subject, email: fluxo.operator_email }, via: 'oauth',
    }, env);
    await client.query('COMMIT');
   } catch (e) { await client.query('ROLLBACK'); throw e; }
   finally { client.release(); }

   // Autorizou, mas desmarcou a leitura de anúncios: grava mesmo assim (a tela
   // já mostra o aviso de `ads_read`), e o código diz o que aconteceu.
   return voltar(estado.scopes.includes('ads_read') ? 'ok' : 'scope');
  } catch {
   return voltar('error');
  } finally {
   token = null;
  }
 }, { auth: 'public', body: false });

 // Revogar sem apagar: a role de produção não tem DELETE, e o histórico de
 // qual token esteve ativo em cada período tem valor.
 router.post('/api/marketing/credential/revoke', async ({ client, operator, reply }) => {
  await commercialPermission(client, operator, true, true);
  const r = await client.query(
   'UPDATE marketing_credentials SET active=false, revoked_at=now(), updated_at=now() WHERE provider=$1 AND active RETURNING id',
   [PROVIDER]);
  if (!r.rowCount) throw fail(409, 'Não há credencial ativa para revogar.');
  return { body: { ok: true, revoked: r.rows[0].id } };
 }, { transactional: true, body: false, audit: false });

 router.get('/api/marketing/credential', async ({ pool, reply, url }) => {
  onlyParams(url.searchParams, ['verify']);
  const cred = await pool.query('SELECT * FROM marketing_credentials WHERE provider=$1 AND active', [PROVIDER]);
  const chave = chaveConfigurada(env);
  const oauth = oauthConfigurado(env);
  if (!cred.rowCount) return reply(200, { ...credencialPublica(null), key_configured: chave, oauth_available: oauth });
  const publico = { ...credencialPublica(cred.rows[0], clock), key_configured: chave, oauth_available: oauth };
  if (url.searchParams.get('verify') !== '1') return reply(200, publico);

  const aberto = await abrirAdaptador(pool);
  try {
   const estado = await aberto.api.debugToken();
   if (estado.checked) {
    await pool.query(
     `UPDATE marketing_credentials SET last_verified_at=now(), last_error=$2,
        expires_at=$3, scopes=$4, updated_at=now() WHERE id=$1`,
     [cred.rows[0].id, estado.error, estado.never_expires ? null : estado.expires_at,
      estado.scopes.length ? estado.scopes : cred.rows[0].scopes]);
   }
   return reply(200, { ...publico, live: estado });
  } catch (e) {
   const limpo = scrub(e.message, aberto?.credencial?.token);
   await pool.query('UPDATE marketing_credentials SET last_error=$2,updated_at=now() WHERE id=$1',
    [cred.rows[0].id, limpo]);
   return reply(200, { ...publico, live: { checked: true, valid: false, error: limpo } });
  }
 }, { body: false });
}

/**
 * Grava a credencial cifrada. Usada pelo script do servidor e pela rota do
 * painel — e nos dois casos o token só existe em memória até virar texto
 * cifrado. Nenhuma leitura posterior o devolve.
 */
export async function guardarCredencial(client, { token, label, tokenType, scopes, expiresAt, appId, operator = null, via = 'script' }, env = process.env) {
 const selado = seal(token, readKey(env));
 // Uma ativa por provedor: a anterior sai de cena antes de a nova entrar.
 await client.query(
  'UPDATE marketing_credentials SET active=false, revoked_at=now(), updated_at=now() WHERE provider=$1 AND active',
  [PROVIDER]);
 const r = await client.query(
  `INSERT INTO marketing_credentials
     (provider,label,token_ciphertext,token_iv,token_tag,token_fingerprint,token_type,scopes,
      expires_at,app_id,connected_by_subject,connected_by_email,connected_via)
   VALUES($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13)
   RETURNING id,label,token_fingerprint,token_type,scopes,expires_at,created_at`,
  [PROVIDER, label, selado.ciphertext, selado.iv, selado.tag, selado.fingerprint,
   tokenType, scopes || [], expiresAt, appId,
   operator?.subject ?? null, operator?.email ?? null, via]);
 return r.rows[0];
}

export const _internals = { credencialAtiva, SQL_CAMPANHAS, JANELA_PADRAO_DIAS };
