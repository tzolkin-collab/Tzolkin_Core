// Adaptador Meta Graph / Marketing API — SOMENTE LEITURA.
//
// Não cria campanha, não pausa, não altera orçamento, não sobe criativo.
// Coleta o que já existe no Gerenciador de Anúncios para o Core saber quanto
// se gastou e em quê. Qualquer escrita seria dinheiro saindo por uma rota
// automática, e isso exige decisão explícita que ainda não foi tomada.
//
// A credencial fica no servidor e viaja no cabeçalho `Authorization`, nunca na
// query string: URL entra em log de proxy, em histórico e em Referer.
// Exceção inevitável: `oauth/access_token` só aceita os parâmetros na query —
// é o contrato do endpoint. Por isso essa chamada é a única que carrega o
// app secret, é server-to-server, e o resultado nunca volta ao navegador.
//
// Ver docs/INTEGRATIONS.md

const BASE = 'https://graph.facebook.com';
const VERSION = 'v21.0';
const TIMEOUT_MS = 12000;

// Objetivos publicados pela API, traduzidos sem inventar categoria.
const OBJETIVOS = {
 OUTCOME_TRAFFIC: 'tráfego', OUTCOME_ENGAGEMENT: 'engajamento', OUTCOME_LEADS: 'leads',
 OUTCOME_SALES: 'vendas', OUTCOME_AWARENESS: 'reconhecimento', OUTCOME_APP_PROMOTION: 'aplicativo',
 LINK_CLICKS: 'cliques', CONVERSIONS: 'conversões', LEAD_GENERATION: 'leads',
 BRAND_AWARENESS: 'reconhecimento', REACH: 'alcance', VIDEO_VIEWS: 'vídeo',
 POST_ENGAGEMENT: 'engajamento', MESSAGES: 'mensagens',
};

const ESTADOS = {
 ACTIVE: 'ativa', PAUSED: 'pausada', DELETED: 'excluída', ARCHIVED: 'arquivada',
 IN_PROCESS: 'em processamento', WITH_ISSUES: 'com problemas',
 CAMPAIGN_PAUSED: 'campanha pausada', ADSET_PAUSED: 'conjunto pausado',
 PENDING_REVIEW: 'em revisão', DISAPPROVED: 'reprovada',
};

// Erro de provedor nunca carrega a credencial nem o corpo bruto da resposta.
function mensagemDeFalha(status, codigo) {
 if (status === 401 || codigo === 190) return 'Token da Meta inválido ou expirado. Reconecte pelo script de conexão.';
 if (status === 403 || codigo === 200) return 'Token da Meta sem permissão para este recurso (falta `ads_read`?).';
 if (status === 429 || codigo === 17 || codigo === 613) return 'Limite de requisições da Meta atingido. Tente mais tarde.';
 if (status === 404) return 'Recurso não encontrado na Meta.';
 if (status >= 500) return 'Meta indisponível no momento.';
 return 'Não foi possível consultar a Meta.';
}

/**
 * Converte valor monetário decimal em centavos inteiros, sem ponto flutuante.
 *
 * A Meta devolve `spend` como string decimal ("1234.56") na moeda da conta,
 * enquanto `daily_budget` já vem em unidade menor. São formatos diferentes na
 * mesma API — misturá-los é como se erra o valor de uma campanha inteira.
 *
 * Arredondamento meio-para-cima na terceira casa; BigInt em todo o caminho,
 * porque `12.34 * 100` em ponto flutuante dá 1233.9999999999998.
 */
export function decimalParaCentavos(valor) {
 if (valor == null || valor === '') return null;
 const texto = String(valor).trim();
 const m = texto.match(/^(-)?(\d+)(?:\.(\d+))?$/);
 if (!m) return null;
 const [, sinal, inteiro, fracao = ''] = m;
 const centavos = (fracao + '00').slice(0, 2);
 let total = BigInt(inteiro) * 100n + BigInt(centavos);
 // Terceira casa decide o arredondamento da segunda.
 if (fracao.length > 2 && Number(fracao[2]) >= 5) total += 1n;
 if (total > BigInt(Number.MAX_SAFE_INTEGER)) return null;
 return Number(sinal ? -total : total);
}

/** Campos que já chegam em unidade menor: só validar que é inteiro. */
export function unidadeMenorParaCentavos(valor) {
 if (valor == null || valor === '') return null;
 const texto = String(valor).trim();
 if (!/^-?\d+$/.test(texto)) return null;
 const n = Number(texto);
 return Number.isSafeInteger(n) ? n : null;
}

const texto = (v, max = 300) => (typeof v === 'string' && v && v.length <= max ? v : null);
const inteiro = v => { const n = Number(v); return Number.isSafeInteger(n) && n >= 0 ? n : null; };
const iso = v => { const t = Date.parse(v); return Number.isFinite(t) ? new Date(t).toISOString() : null; };

/** Conta de anúncios normalizada. `act_123` é o formato que os demais endpoints exigem. */
function normalizarConta(conta) {
 const id = texto(conta.id, 64);
 return {
  provider: 'meta',
  external_id: id,
  account_ref: id ? id.replace(/^act_/, '') : null,
  name: texto(conta.name, 200),
  currency: texto(conta.currency, 8),
  // 1 = ativa; os demais são graus de bloqueio. Guardamos o número e o rótulo.
  account_status: inteiro(conta.account_status),
  active: conta.account_status === 1,
  business_name: texto(conta.business?.name, 200),
  timezone: texto(conta.timezone_name, 64),
 };
}

function normalizarCampanha(campanha, contaId) {
 const objetivo = texto(campanha.objective, 64);
 const estado = texto(campanha.effective_status || campanha.status, 40);
 return {
  provider: 'meta',
  external_id: texto(campanha.id, 64),
  account_external_id: contaId,
  name: texto(campanha.name, 240),
  objective: objetivo,
  objective_label: OBJETIVOS[objetivo] || null,
  status: texto(campanha.status, 40),
  effective_status: estado,
  status_label: ESTADOS[estado] || null,
  // Orçamentos já vêm em unidade menor da moeda da conta.
  daily_budget_cents: unidadeMenorParaCentavos(campanha.daily_budget),
  lifetime_budget_cents: unidadeMenorParaCentavos(campanha.lifetime_budget),
  budget_remaining_cents: unidadeMenorParaCentavos(campanha.budget_remaining),
  start_time: iso(campanha.start_time),
  stop_time: iso(campanha.stop_time),
  created_time: iso(campanha.created_time),
  updated_time: iso(campanha.updated_time),
 };
}

/**
 * Insight diário por campanha. `actions` é uma lista heterogênea; extraímos só
 * o que tem significado comercial estável e guardamos o resto como contagem
 * total, em vez de escolher uma métrica e chamá-la de "conversões".
 */
function normalizarInsight(linha, moeda) {
 const acoes = Array.isArray(linha.actions) ? linha.actions : [];
 const somaDe = tipos => {
  const encontradas = acoes.filter(a => tipos.includes(a.action_type));
  if (!encontradas.length) return null;
  return encontradas.reduce((total, a) => total + (inteiro(a.value) ?? 0), 0);
 };
 return {
  provider: 'meta',
  campaign_external_id: texto(linha.campaign_id, 64),
  campaign_name: texto(linha.campaign_name, 240),
  date_start: /^\d{4}-\d{2}-\d{2}$/.test(linha.date_start) ? linha.date_start : null,
  date_stop: /^\d{4}-\d{2}-\d{2}$/.test(linha.date_stop) ? linha.date_stop : null,
  // `spend` é string decimal na moeda da conta — conversão explícita.
  spend_cents: decimalParaCentavos(linha.spend),
  currency: moeda,
  impressions: inteiro(linha.impressions),
  clicks: inteiro(linha.clicks),
  reach: inteiro(linha.reach),
  frequency: linha.frequency == null ? null : decimalParaCentavos(linha.frequency),
  leads: somaDe(['lead', 'onsite_conversion.lead_grouped', 'offsite_conversion.fb_pixel_lead']),
  purchases: somaDe(['purchase', 'offsite_conversion.fb_pixel_purchase']),
  messaging: somaDe(['onsite_conversion.messaging_conversation_started_7d']),
  actions_total: acoes.length ? acoes.reduce((t, a) => t + (inteiro(a.value) ?? 0), 0) : null,
 };
}

/**
 * Troca um token de curta duração (~1h) por um de longa duração (~60 dias).
 * É o passo do guia que o usuário referenciou. Server-to-server, e o retorno
 * nunca chega ao navegador.
 *
 * Um token de Usuário do Sistema (Business Manager) não precisa desta troca:
 * ele já nasce sem expiração. Por isso `expires_in` ausente é resultado válido,
 * não erro — significa "não expira".
 */
export async function exchangeLongLivedToken({ appId, appSecret, shortLivedToken, baseUrl = BASE, version = VERSION, fetchImpl = fetch }) {
 if (!appId || !appSecret || !shortLivedToken) throw new Error('Informe app id, app secret e o token de curta duração.');
 const url = new URL(`/${version}/oauth/access_token`, baseUrl);
 url.searchParams.set('grant_type', 'fb_exchange_token');
 url.searchParams.set('client_id', String(appId));
 url.searchParams.set('client_secret', String(appSecret));
 url.searchParams.set('fb_exchange_token', String(shortLivedToken));
 const response = await fetchImpl(url, { method: 'GET', redirect: 'error', signal: AbortSignal.timeout(TIMEOUT_MS) });
 const corpo = await response.json().catch(() => ({}));
 if (!response.ok) throw Object.assign(new Error(mensagemDeFalha(response.status, corpo?.error?.code)), { providerStatus: response.status });
 const token = texto(corpo.access_token, 1000);
 if (!token) throw new Error('A Meta não devolveu um token na troca.');
 const segundos = inteiro(corpo.expires_in);
 return {
  access_token: token,
  // Sem `expires_in` a Meta está dizendo "não expira" (token de sistema).
  expires_at: segundos ? new Date(Date.now() + segundos * 1000).toISOString() : null,
  token_type: segundos ? 'long_lived_user' : 'system_user',
 };
}

export function createMetaGraphAdapter({ token, baseUrl = BASE, version = VERSION, fetchImpl = fetch, appId = null, appSecret = null }) {
 if (!token) throw Object.assign(new Error('Token da Meta não configurado.'), { status: 503 });

 const get = async (path, params = {}) => {
  const url = new URL(`/${version}${path}`, baseUrl);
  for (const [chave, valor] of Object.entries(params)) if (valor != null) url.searchParams.set(chave, String(valor));
  const response = await fetchImpl(url, {
   method: 'GET', redirect: 'error',
   // Cabeçalho, não query: o token não entra em log de proxy nem em Referer.
   headers: { Authorization: `Bearer ${token}`, Accept: 'application/json' },
   signal: AbortSignal.timeout(TIMEOUT_MS),
  });
  const corpo = await response.json().catch(() => ({}));
  if (!response.ok) throw Object.assign(
   new Error(mensagemDeFalha(response.status, corpo?.error?.code)),
   { providerStatus: response.status, providerCode: corpo?.error?.code ?? null });
  return corpo;
 };

 // Paginação por cursor. Teto explícito: sem ele, uma conta grande puxaria
 // milhares de linhas numa requisição de painel.
 const paginar = async (path, params, limitePaginas = 10) => {
  let itens = [];
  let corpo = await get(path, params);
  itens = itens.concat(corpo.data || []);
  let paginas = 1;
  while (corpo.paging?.cursors?.after && corpo.paging?.next && paginas < limitePaginas) {
   corpo = await get(path, { ...params, after: corpo.paging.cursors.after });
   itens = itens.concat(corpo.data || []);
   paginas += 1;
  }
  return { itens, truncado: Boolean(corpo.paging?.next) && paginas >= limitePaginas };
 };

 return {
  provider: 'meta',

  /**
   * Estado do próprio token: validade, escopos e tipo. É o que transforma
   * "persistente" em algo verificável — sem isto, a coleta só descobre que o
   * token morreu quando ela para.
   *
   * Exige app id e secret para montar o app access token que o endpoint pede.
   */
  async debugToken() {
   if (!appId || !appSecret) return { checked: false, reason: 'app_credentials_missing' };
   const corpo = await get('/debug_token', { input_token: token, access_token: `${appId}|${appSecret}` });
   const d = corpo.data || {};
   const expira = inteiro(d.expires_at);
   return {
    checked: true,
    valid: Boolean(d.is_valid),
    // 0 é o código da Meta para "não expira" (Usuário do Sistema).
    expires_at: expira ? new Date(expira * 1000).toISOString() : null,
    never_expires: expira === 0 || expira == null,
    scopes: Array.isArray(d.scopes) ? d.scopes.filter(s => typeof s === 'string').slice(0, 60) : [],
    type: texto(d.type, 40),
    app_id: texto(d.app_id, 40),
    // `error` aqui é diagnóstico da Meta sobre o token, não exceção nossa.
    error: texto(d.error?.message, 300),
   };
  },

  /** Contas de anúncio ao alcance do token. */
  async listAdAccounts({ limit = 100 } = {}) {
   const { itens } = await paginar('/me/adaccounts', {
    fields: 'id,name,account_status,currency,timezone_name,business{name}', limit,
   });
   return itens.map(normalizarConta).filter(c => c.external_id);
  },

  /**
   * Campanhas da conta. Traz PAUSADAS e ARQUIVADAS de propósito: campanha
   * parada continua tendo gasto histórico, e escondê-la esconde dinheiro.
   */
  async listCampaigns(accountId, { limit = 100 } = {}) {
   if (!/^act_\d+$/.test(String(accountId))) throw new Error('Conta de anúncios inválida.');
   const { itens, truncado } = await paginar(`/${accountId}/campaigns`, {
    fields: 'id,name,objective,status,effective_status,daily_budget,lifetime_budget,budget_remaining,start_time,stop_time,created_time,updated_time',
    limit,
   });
   return { campaigns: itens.map(c => normalizarCampanha(c, String(accountId))).filter(c => c.external_id), truncated: truncado };
  },

  /**
   * Métricas por campanha e por dia. `time_increment=1` é o que permite
   * somar por período depois sem pedir de novo à Meta.
   */
  async listCampaignInsights(accountId, { since, until, currency = null, limit = 200 } = {}) {
   if (!/^act_\d+$/.test(String(accountId))) throw new Error('Conta de anúncios inválida.');
   if (!/^\d{4}-\d{2}-\d{2}$/.test(String(since)) || !/^\d{4}-\d{2}-\d{2}$/.test(String(until)))
    throw new Error('Período inválido: use AAAA-MM-DD.');
   const { itens, truncado } = await paginar(`/${accountId}/insights`, {
    level: 'campaign',
    fields: 'campaign_id,campaign_name,spend,impressions,clicks,reach,frequency,actions',
    time_range: JSON.stringify({ since, until }),
    time_increment: 1,
    limit,
   });
   return {
    insights: itens.map(l => normalizarInsight(l, currency)).filter(i => i.campaign_external_id && i.date_start),
    truncated: truncado,
   };
  },
 };
}

export const _internals = { normalizarConta, normalizarCampanha, normalizarInsight, mensagemDeFalha, OBJETIVOS, ESTADOS };
