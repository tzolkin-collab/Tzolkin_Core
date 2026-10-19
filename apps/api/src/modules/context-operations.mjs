// Operações de Contexto: SDK/CDN auto-configurável (UTMs + auto-cadastro de formulários),
// atribuição de contratações a contextos e gestão completa multi-conta da Stripe por contexto.
import { fail, isProductId, isUuid, text } from '../platform/http.mjs';
import { readKey, seal } from '../platform/secrets.mjs';
import { vivo as vivoPadrao } from '../platform/env-vivo.mjs';

const STRIPE_BASE = 'https://api.stripe.com';
const STRIPE_TIMEOUT_MS = 10000;

// UTMs e IDs que vêm dos anúncios (Meta Ads, Google Ads etc.) — NUNCA podem ser sobrescritos pelo Core.
const UTMS_DE_ANUNCIO = new Set([
 'utm_source', 'utm_medium', 'utm_campaign', 'utm_content', 'utm_term',
 'meta_campaign_id', 'meta_adset_id', 'meta_ad_id', 'fbclid', 'gclid', 'fbc', 'fbp',
]);

const CAMPOS_LEAD_NATIVOS = new Set([
 'name', 'nome', 'full_name', 'fullname', 'email', 'e-mail', 'phone', 'telefone', 'whatsapp', 'celular',
 'company', 'company_name', 'companyname', 'empresa', 'organizacao', 'service', 'servico',
 'source', 'origem', 'notes', 'observacoes', 'mensagem', 'message',
 'utm_tzolkin', ...UTMS_DE_ANUNCIO,
]);

const normalizarChaveCampo = str =>
 String(str || '')
  .normalize('NFD').replace(/[\u0300-\u036f]/g, '')
  .toLowerCase()
  .replace(/[^a-z0-9_]+/g, '_')
  .replace(/^_+|_+$/g, '')
  .replace(/^([0-9])/, 'c_$1')
  .slice(0, 39);

const normalizarSlug = str =>
 String(str || '')
  .normalize('NFD').replace(/[\u0300-\u036f]/g, '')
  .toLowerCase()
  .replace(/[^a-z0-9_-]+/g, '-')
  .replace(/^-+|-+$/g, '')
  .slice(0, 48);

async function exigirProduto(db, productId) {
 if (!isProductId(productId)) throw fail(400, 'Contexto inválido.');
 const r = await db.query('SELECT id, name, portfolio_kind, lifecycle_status FROM products WHERE id = $1', [productId]);
 if (!r.rows.length) throw fail(404, 'Contexto não encontrado.');
 return r.rows[0];
}

async function lerEntradaEcossistema(db, id) {
 const r = await db.query('SELECT payload, imported_at FROM ecosystem_entries WHERE id = $1', [id]);
 return r.rows[0]?.payload || null;
}

async function salvarEntradaEcossistema(db, id, kind, payload, expectedVersion) {
 const versaoAtual = Number.isInteger(payload?.version) ? payload.version : 1;
 const proximaVersao = versaoAtual + 1;
 const payloadComVersao = { ...payload, version: proximaVersao, updated_at: new Date().toISOString() };

 if (expectedVersion !== undefined && expectedVersion !== null) {
  const r = await db.query(
   `UPDATE ecosystem_entries
       SET kind = $2, payload = $3::jsonb, imported_at = CURRENT_DATE
     WHERE id = $1 AND (payload->>'version')::int = $4
    RETURNING id`,
   [id, kind, JSON.stringify(payloadComVersao), Number(expectedVersion)]
  );
  if (!r.rows.length) {
   throw fail(409, 'O registro foi alterado por outro operador. Atualize a página antes de salvar.');
  }
  return payloadComVersao;
 }

 await db.query(
  `INSERT INTO ecosystem_entries(id, kind, payload, imported_at)
   VALUES($1, $2, $3::jsonb, CURRENT_DATE)
   ON CONFLICT (id) DO UPDATE SET kind = EXCLUDED.kind, payload = EXCLUDED.payload, imported_at = CURRENT_DATE`,
  [id, kind, JSON.stringify(payloadComVersao)]
 );
 return payloadComVersao;
}

 const MAX_CAMPOS_CUSTOMIZADOS = 50;
export async function garantirCamposExtrasLead(db, productId, campos = []) {
 if (!isProductId(productId) || !Array.isArray(campos) || !campos.length) return [];
 const existentesRes = await db.query(
  "SELECT key, label, type, required FROM space_fields WHERE space_id = $1 AND entity = 'lead' ORDER BY position, key",
  [productId]
 );
 const existentes = new Set(existentesRes.rows.map(r => r.key));
 let pos = existentesRes.rows.length;
 const criados = [];
 for (const item of campos) {
  if (existentes.size >= MAX_CAMPOS_CUSTOMIZADOS) break;
  const bruto = typeof item === 'string' ? item : item?.key || item?.name || '';
  const key = normalizarChaveCampo(bruto);
  if (!key || key.length < 2 || CAMPOS_LEAD_NATIVOS.has(key) || existentes.has(key)) continue;
  const labelBruto = typeof item === 'object' && item?.label ? String(item.label).trim() : key.replace(/_/g, ' ');
  const label = (labelBruto.length >= 2 ? labelBruto : `Campo ${key}`).slice(0, 80);
  const tipoBruto = typeof item === 'object' && item?.type ? String(item.type).toUpperCase() : 'TEXT';
  const type = ['TEXT', 'NUMBER', 'DATE', 'SELECT', 'MULTISELECT', 'BOOLEAN', 'LINK'].includes(tipoBruto) ? tipoBruto : 'TEXT';
  const ehLista = type === 'SELECT' || type === 'MULTISELECT';
  const options = ehLista
   ? JSON.stringify(Array.isArray(item?.options) && item.options.length ? item.options.slice(0, 50) : ['Opção 1'])
   : null;
  await db.query(
   `INSERT INTO space_fields(space_id, entity, key, label, type, options, required, position)
    VALUES($1, 'lead', $2, $3, $4, $5::jsonb, false, $6)
    ON CONFLICT (space_id, entity, key) DO NOTHING`,
   [productId, key, label, type, options, pos]
  );
  existentes.add(key);
  criados.push({ key, label, type });
  pos += 1;
 }
 return criados;
}

export async function lerSdkContexto(db, productId, origin = '') {
 const product = await exigirProduto(db, productId);
 const salvo = await lerEntradaEcossistema(db, `sdk:${productId}`);
 let pipelines = [];
 try {
  const pipeRes = await db.query(
   'SELECT id, slug, name, offer_name, is_default FROM pipelines WHERE space_id = $1 AND is_active ORDER BY is_default DESC, position, name',
   [productId]
  );
  pipelines = pipeRes.rows;
 } catch {
  pipelines = [];
 }
 const funilPadrao = pipelines.find(p => p.is_default) || pipelines[0] || null;
 const defaultNiche = salvo?.default_niche || funilPadrao?.slug || 'padrao';
 const utmTzolkinPadrao = salvo?.utm_tzolkin || `${productId}.${defaultNiche}`;

 // Filtra qualquer tentativa antiga de ter guardado UTMs de anúncio como fixas no Core
 const coreParamsSalvos = salvo?.core_params || salvo?.extra_params || {};
 const core_params = {};
 if (coreParamsSalvos && typeof coreParamsSalvos === 'object') {
  for (const [k, v] of Object.entries(coreParamsSalvos)) {
   const chave = normalizarChaveCampo(k);
   if (chave && !UTMS_DE_ANUNCIO.has(chave) && v != null && String(v).trim() !== '') {
    core_params[chave] = String(v).trim().slice(0, 160);
   }
  }
 }

 const route_rules = Array.isArray(salvo?.route_rules)
  ? salvo.route_rules.map(r => ({
     path_prefix: String(r?.path_prefix || '/').trim(),
     niche: normalizarSlug(r?.niche || defaultNiche) || defaultNiche,
     utm_tzolkin: `${productId}.${normalizarSlug(r?.niche || defaultNiche) || defaultNiche}`,
     offer_label: r?.offer_label ? String(r.offer_label).trim().slice(0, 120) : null,
    }))
  : [];

 const config = {
  enabled: salvo?.enabled !== false,
  utm_tzolkin: utmTzolkinPadrao,
  default_niche: defaultNiche,
  service_model: salvo?.service_model || (product.portfolio_kind === 'platform' || product.portfolio_kind === 'product' ? 'product' : 'on_demand'),
  core_params,
  extra_params: core_params,
  route_rules,
  preserve_ad_utms: true,
  auto_capture_forms: salvo?.auto_capture_forms !== false,
  enrich_payment_links: salvo?.enrich_payment_links !== false,
  allowed_origins: Array.isArray(salvo?.allowed_origins) ? salvo.allowed_origins : [],
  forms: Array.isArray(salvo?.forms) ? salvo.forms : [],
  updated_at: salvo?.updated_at || null,
 };

 let leadFields = [];
 try {
  const fieldsRes = await db.query(
   "SELECT id, space_id, entity, key, label, type, options, required, is_active, position FROM space_fields WHERE space_id = $1 AND entity = 'lead' ORDER BY position, label",
   [productId]
  );
  leadFields = fieldsRes.rows;
 } catch {
  leadFields = [];
 }

 const baseOrigin = origin || 'https://core.tzolkin.com.br';
 const snippet = `<script src="${baseOrigin}/sdk/tzolkin.js" data-tzolkin-context="${productId}" data-tzolkin-niche="${defaultNiche}" data-tzolkin-key="COLE_AQUI_CHAVE_APP_CLIENT" defer></script>`;
 const adUrlTemplate = `utm_tzolkin=${utmTzolkinPadrao}&meta_campaign_id={{campaign.id}}&meta_adset_id={{adset.id}}&meta_ad_id={{ad.id}}`;
 return { product, config, pipelines, lead_fields: leadFields, snippet, ad_url_template: adUrlTemplate };
}

export async function salvarSdkContexto(client, productId, body = {}, origin = '') {
 await exigirProduto(client, productId);
 const atual = (await lerEntradaEcossistema(client, `sdk:${productId}`)) || {};
 const defaultNiche = normalizarSlug(body.default_niche || atual.default_niche || 'padrao') || 'padrao';
 const rawTzolkin = String(body.utm_tzolkin || body.utm_defaults?.utm_tzolkin || `${productId}.${defaultNiche}`).trim().toLowerCase();
 const utm_tzolkin = rawTzolkin.startsWith(`${productId}.`) ? rawTzolkin.slice(0, 80) : `${productId}.${normalizarSlug(rawTzolkin) || defaultNiche}`;

 // Parâmetros adicionais do Core para o microsserviço — NUNCA aceita utm_source/medium/campaign/content/term (que vêm dos anúncios)
 const rawExtra = body.core_params ?? body.extra_params ?? atual.core_params ?? atual.extra_params ?? {};
 const core_params = {};
 if (rawExtra && typeof rawExtra === 'object') {
  for (const [k, v] of Object.entries(rawExtra)) {
   const chaveLimpa = normalizarChaveCampo(k);
   if (!chaveLimpa || UTMS_DE_ANUNCIO.has(chaveLimpa)) continue;
   if (v !== null && v !== undefined && String(v).trim() !== '') {
    core_params[chaveLimpa] = String(v).trim().slice(0, 160);
   }
  }
 }

 const route_rules = Array.isArray(body.route_rules)
  ? body.route_rules
     .map(r => {
      const pathPrefix = String(r?.path_prefix || '').trim();
      const niche = normalizarSlug(r?.niche || defaultNiche) || defaultNiche;
      if (!pathPrefix) return null;
      return {
       path_prefix: pathPrefix.startsWith('/') ? pathPrefix : `/${pathPrefix}`,
       niche,
       utm_tzolkin: `${productId}.${niche}`,
       offer_label: r?.offer_label ? String(r.offer_label).trim().slice(0, 120) : null,
      };
     })
     .filter(Boolean)
     .slice(0, 30)
  : (Array.isArray(atual.route_rules) ? atual.route_rules : []);

 const allowed_origins = Array.isArray(body.allowed_origins)
  ? body.allowed_origins.map(o => String(o || '').trim()).filter(Boolean).slice(0, 20)
  : (Array.isArray(atual.allowed_origins) ? atual.allowed_origins : []);
 const forms = Array.isArray(body.forms) ? body.forms : (Array.isArray(atual.forms) ? atual.forms : []);
 if (Array.isArray(body.custom_fields)) {
  await garantirCamposExtrasLead(client, productId, body.custom_fields);
 }
 for (const f of forms) {
  if (Array.isArray(f?.fields)) await garantirCamposExtrasLead(client, productId, f.fields);
 }
 const novo = {
  enabled: body.enabled !== undefined ? Boolean(body.enabled) : (atual.enabled !== false),
  utm_tzolkin,
  default_niche: defaultNiche,
  service_model: body.service_model || atual.service_model || null,
  core_params,
  extra_params: core_params,
  route_rules,
  preserve_ad_utms: true,
  auto_capture_forms: body.auto_capture_forms !== undefined ? Boolean(body.auto_capture_forms) : (atual.auto_capture_forms !== false),
  enrich_payment_links: body.enrich_payment_links !== undefined ? Boolean(body.enrich_payment_links) : (atual.enrich_payment_links !== false),
  allowed_origins,
  forms,
  version: atual.version || 1,
  updated_at: new Date().toISOString(),
 };
 await salvarEntradaEcossistema(client, `sdk:${productId}`, 'context_sdk', novo, body.expected_version);
 return lerSdkContexto(client, productId, origin);
}

export async function registrarFormularioSdk(client, productId, body = {}) {
 await exigirProduto(client, productId);
 const formId = normalizarSlug(body.form_id || body.id || body.name || 'formulario-site') || 'formulario-site';
 const name = String(body.name || formId).trim().slice(0, 120);
 const page_url = String(body.page_url || '').trim().slice(0, 300);
 const niche = body.niche ? normalizarSlug(body.niche) : null;
 const rawFields = Array.isArray(body.fields) ? body.fields : [];
 const fields = rawFields
  .map(f => {
   const key = normalizarChaveCampo(typeof f === 'string' ? f : f?.key || f?.name);
   if (!key) return null;
   return {
    key,
    label: String((typeof f === 'object' && f?.label) || key).trim().slice(0, 80),
    type: String((typeof f === 'object' && f?.type) || 'text').toLowerCase().slice(0, 24),
    native: CAMPOS_LEAD_NATIVOS.has(key),
   };
  })
  .filter(Boolean);

 const criados = await garantirCamposExtrasLead(client, productId, fields.filter(f => !f.native));
 const atual = (await lerEntradaEcossistema(client, `sdk:${productId}`)) || {};
 const formsAtuais = Array.isArray(atual.forms) ? [...atual.forms] : [];
 const idx = formsAtuais.findIndex(f => f.form_id === formId);
 const registro = {
  form_id: formId,
  name,
  page_url,
  niche,
  fields,
  last_seen_at: new Date().toISOString(),
 };
 if (idx >= 0) formsAtuais[idx] = { ...formsAtuais[idx], ...registro };
 else formsAtuais.push(registro);

 await salvarEntradaEcossistema(client, `sdk:${productId}`, 'context_sdk', {
  ...atual,
  forms: formsAtuais,
  updated_at: new Date().toISOString(),
 });
 return { form: registro, created_lead_fields: criados };
}

function gerarScriptSdk() {
 return `(function(){
  if (window.TzolkinSDK) return;
  var scriptEl = document.currentScript || document.querySelector('script[data-tzolkin-context]');
  var contextId = (scriptEl && scriptEl.getAttribute('data-tzolkin-context')) || window.TZOLKIN_CONTEXT || '';
  var scriptNiche = (scriptEl && scriptEl.getAttribute('data-tzolkin-niche')) || window.TZOLKIN_NICHE || '';
  var apiKey = (scriptEl && scriptEl.getAttribute('data-tzolkin-key')) || window.TZOLKIN_KEY || '';
  var origin = (scriptEl && scriptEl.getAttribute('data-tzolkin-origin')) || (scriptEl && scriptEl.src ? new URL(scriptEl.src).origin : window.location.origin);
  var AD_STORAGE_KEY = 'tz_attribution_v1';
  var CORE_STORAGE_KEY = 'tz_core_context_' + (contextId || 'default');
  var AD_PARAMS = ['utm_source','utm_medium','utm_campaign','utm_content','utm_term','utm_tzolkin','meta_campaign_id','meta_adset_id','meta_ad_id','fbclid','gclid'];
  var state = { context: contextId, config: null, adAttribution: {}, coreUtms: {} };

  function uuidV4() {
   if (typeof crypto !== 'undefined' && crypto.randomUUID) return crypto.randomUUID();
   return 'xxxxxxxx-xxxx-4xxx-yxxx-xxxxxxxxxxxx'.replace(/[xy]/g, function(c) {
    var r = Math.random() * 16 | 0, v = c === 'x' ? r : (r & 0x3 | 0x8);
    return v.toString(16);
   });
  }

  // 1. Captura e preserva INTACTOS os UTMs e IDs vindos dos anúncios (Meta Ads / Google Ads).
  // NUNCA sobrescreve utm_source, utm_medium, utm_campaign, utm_content, utm_term com valores fixos.
  function captureAdAttribution() {
   var saved = {};
   try { saved = JSON.parse(sessionStorage.getItem(AD_STORAGE_KEY) || '{}'); } catch (_) {}
   var query = new URLSearchParams(window.location.search);
   var fromUrl = {};
   for (var i = 0; i < AD_PARAMS.length; i++) {
    var k = AD_PARAMS[i];
    var v = query.get(k);
    if (v) fromUrl[k] = v.slice(0, 500);
   }
   var nowIso = new Date().toISOString();
   if (Object.keys(fromUrl).length > 0) {
    var next = Object.assign({}, saved, fromUrl);
    if (!next.landing_page) next.landing_page = window.location.pathname;
    if (!next.first_touch_at) next.first_touch_at = nowIso;
    if (document.referrer && !next.referrer) {
     try {
      var ref = new URL(document.referrer);
      if (ref.origin !== window.location.origin) next.referrer = (ref.origin + ref.pathname).slice(0, 1000);
     } catch (_) {}
    }
    saved = next;
    try { sessionStorage.setItem(AD_STORAGE_KEY, JSON.stringify(saved)); } catch (_) {}
   } else if (!saved.landing_page) {
    saved.landing_page = window.location.pathname;
    try { sessionStorage.setItem(AD_STORAGE_KEY, JSON.stringify(saved)); } catch (_) {}
   }
   state.adAttribution = saved;
   return saved;
  }

  // 2. Calcula os UTMs ADICIONAIS do Core para este microsserviço/rota (utm_tzolkin + core_params),
  // sem jamais alterar os UTMs que vieram do anúncio.
  function resolveCoreUtms(cfg) {
   var ad = captureAdAttribution();
   var path = window.location.pathname || '/';
   var matchedRule = null;
   if (cfg && Array.isArray(cfg.route_rules)) {
    for (var i = 0; i < cfg.route_rules.length; i++) {
     var r = cfg.route_rules[i];
     if (r && r.path_prefix && path.indexOf(r.path_prefix) === 0) {
      matchedRule = r;
      break;
     }
    }
   }
   var niche = (matchedRule && matchedRule.niche) || scriptNiche || (cfg && cfg.default_niche) || 'padrao';
   var coreTzolkin = (matchedRule && matchedRule.utm_tzolkin)
    || (scriptNiche && contextId ? contextId + '.' + scriptNiche : null)
    || (cfg && cfg.utm_tzolkin)
    || (contextId ? contextId + '.' + niche : '');

   // Se o próprio anúncio já trouxe utm_tzolkin válido para este contexto, respeita o do anúncio;
   // caso contrário, adiciona o utm_tzolkin do Core para o microsserviço/rota.
   var effectiveTzolkin = (ad.utm_tzolkin && (!contextId || ad.utm_tzolkin.indexOf(contextId + '.') === 0))
    ? ad.utm_tzolkin
    : coreTzolkin;

   var extras = Object.assign({}, (cfg && cfg.core_params) || {});
   if (matchedRule && matchedRule.offer_label && !extras.utm_offer) {
    extras.utm_offer = matchedRule.offer_label;
   }
   state.coreUtms = Object.assign({}, extras, effectiveTzolkin ? { utm_tzolkin: effectiveTzolkin } : {});
   try { sessionStorage.setItem(CORE_STORAGE_KEY, JSON.stringify(state.coreUtms)); } catch (_) {}
   return state.coreUtms;
  }

  function getCombinedUtms() {
   // Combina UTMs adicionais do Core + UTMs originais do anúncio (anúncio sempre vence em conflito)
   return Object.assign({}, state.coreUtms, state.adAttribution);
  }

  function enrichLinks() {
   if (state.config && state.config.enrich_payment_links === false) return;
   var combined = getCombinedUtms();
   var links = document.querySelectorAll('a[href*="buy.stripe.com"], a[href*="checkout.stripe.com"], a[data-tzolkin-checkout], a[data-tzolkin-propagate]');
   for (var i = 0; i < links.length; i++) {
    try {
     var u = new URL(links[i].href, window.location.origin);
     if (contextId && (u.hostname.indexOf('stripe.com') >= 0 || links[i].hasAttribute('data-tzolkin-checkout')) && !u.searchParams.get('client_reference_id')) {
      u.searchParams.set('client_reference_id', combined.utm_tzolkin || contextId);
     }
     var keys = Object.keys(combined);
     for (var j = 0; j < keys.length; j++) {
      var k = keys[j];
      if (k === 'landing_page' || k === 'referrer' || k === 'first_touch_at') continue;
      if (combined[k] && !u.searchParams.get(k)) u.searchParams.set(k, combined[k]);
     }
     links[i].href = u.toString();
    } catch (_) {}
   }
  }

  function registerForm(formEl) {
   if (!formEl || formEl.__tzolkinBound) return;
   formEl.__tzolkinBound = true;
   var formId = formEl.getAttribute('data-tzolkin-form') || formEl.id || formEl.getAttribute('name') || 'form-site';
   var formNiche = formEl.getAttribute('data-tzolkin-niche') || '';
   var inputs = formEl.querySelectorAll('input[name], select[name], textarea[name]');
   var fields = [];
   for (var i = 0; i < inputs.length; i++) {
    var name = inputs[i].getAttribute('name');
    if (!name || name.indexOf('utm_') === 0) continue;
    fields.push({ key: name, label: inputs[i].getAttribute('placeholder') || name, type: inputs[i].getAttribute('type') || 'text' });
   }
   if (apiKey && fields.length) {
    fetch(origin + '/v1/sdk/forms/register', {
     method: 'POST',
     headers: { 'Content-Type': 'application/json', 'Authorization': 'Bearer ' + apiKey },
     body: JSON.stringify({ context: contextId, form_id: formId, name: formId, page_url: window.location.pathname, niche: formNiche || null, fields: fields })
    }).catch(function(){});
   }
   formEl.addEventListener('submit', function(ev) {
    if (formEl.hasAttribute('data-tzolkin-prevent')) ev.preventDefault();
    var fd = new FormData(formEl);
    var payload = {};
    fd.forEach(function(val, key) { payload[key] = String(val || ''); });
    trackLead(payload, { formId: formId, niche: formNiche });
   });
  }

  function trackLead(data, opts) {
   if (!apiKey) return Promise.resolve({ ok: false, reason: 'missing_key' });
   var d = data || {};
   var options = typeof opts === 'string' ? { formId: opts } : (opts || {});
   var ad = captureAdAttribution();
   var core = state.coreUtms || {};
   var custom = {};
   var nativeMap = {
    name:1, nome:1, full_name:1, fullname:1, email:1, 'e-mail':1,
    phone:1, telefone:1, whatsapp:1, celular:1,
    company:1, company_name:1, companyname:1, empresa:1, organizacao:1,
    service:1, servico:1, notes:1, observacoes:1, mensagem:1, message:1
   };
   Object.keys(d).forEach(function(k) {
    if (!nativeMap[k] && k.indexOf('utm_') !== 0 && !AD_PARAMS.includes(k) && d[k] !== '') {
     custom[k] = d[k];
    }
   });
   var utmTzolkin = (options.niche && contextId ? contextId + '.' + options.niche : null)
    || ad.utm_tzolkin
    || core.utm_tzolkin
    || (contextId ? contextId + '.padrao' : undefined);

   var attribution = {
    source_system: contextId ? 'sdk-' + contextId : 'tzolkin-sdk',
    channel: options.formId || 'sdk-form',
    landing_page: ad.landing_page || window.location.pathname,
    created_at: new Date().toISOString()
   };
   if (ad.referrer) attribution.referrer = ad.referrer;
   if (ad.first_touch_at) attribution.first_touch_at = ad.first_touch_at;
   // UTMs do anúncio entram SOMENTE se vieram de fato na visita (sem nunca inventar ou sobrescrever!)
   var adKeys = ['utm_source','utm_medium','utm_campaign','utm_content','utm_term','meta_campaign_id','meta_adset_id','meta_ad_id','fbclid','gclid'];
   for (var i = 0; i < adKeys.length; i++) {
    var ak = adKeys[i];
    if (ad[ak]) attribution[ak] = ad[ak];
   }
   // UTM adicional do Core para identificar contexto e funil/nicho do microsserviço
   if (utmTzolkin) attribution.utm_tzolkin = utmTzolkin;

   var companyName = d.company || d.companyName || d.company_name || d.empresa || d.organizacao || '';
   var serviceModel = (state.config && state.config.service_model) || 'on_demand';
   var body = {
    lead: {
     name: d.name || d.nome || d.fullName || d.full_name || 'Contato Site',
     email: d.email || d['e-mail'] || undefined,
     whatsapp: d.whatsapp || d.phone || d.telefone || d.celular || undefined,
     message: d.message || d.mensagem || d.notes || d.observacoes || undefined
    },
    organization: companyName ? { name: companyName, organization_type: 'company' } : { organization_type: 'person' },
    commercial: {
     product_id: contextId,
     service_model: serviceModel,
     label: d.service || d.servico || options.formId || 'Contato via SDK'
    },
    attribution: attribution,
    privacy: { contact_allowed: false, source: 'sdk-form-no-preference-recorded' }
   };
   if (Object.keys(custom).length > 0) body.space_data = custom;

   return fetch(origin + '/v1/commercial/intake', {
    method: 'POST',
    headers: {
     'Content-Type': 'application/json',
     'Authorization': 'Bearer ' + apiKey,
     'Idempotency-Key': uuidV4()
    },
    body: JSON.stringify(body)
   }).then(function(r){ return r.json(); });
  }

  function init() {
   captureAdAttribution();
   resolveCoreUtms(null);
   if (!contextId) return;
   fetch(origin + '/v1/sdk/config?context=' + encodeURIComponent(contextId))
    .then(function(r){ return r.ok ? r.json() : null; })
    .then(function(res){
     if (res && res.config) {
      state.config = res.config;
      resolveCoreUtms(res.config);
      enrichLinks();
      var selector = res.config.auto_capture_forms !== false ? 'form' : 'form[data-tzolkin-form]';
      var forms = document.querySelectorAll(selector);
      for (var i = 0; i < forms.length; i++) registerForm(forms[i]);
     }
    }).catch(function(){});
  }

  window.TzolkinSDK = {
   getUtms: getCombinedUtms,
   getAdAttribution: function(){ return state.adAttribution; },
   getCoreUtms: function(){ return state.coreUtms; },
   trackLead: trackLead,
   registerForm: registerForm,
   enrichLinks: enrichLinks
  };
  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', init);
  else init();
 })();`;
}

// ============================================================================
// MULTI-ACCOUNT STRIPE & CONTEXT PAYMENTS
// ============================================================================

async function listarContasStripeRegistradas(db, vivo = vivoPadrao, env = process.env) {
 const salvo = await lerEntradaEcossistema(db, 'stripe_accounts');
 const lista = Array.isArray(salvo?.accounts) ? salvo.accounts : [];
 const contas = [];
 const chavePadrao = String(vivo.env.STRIPE_SECRET_KEY || env.STRIPE_SECRET_KEY || '').trim();
 contas.push({
  id: 'default',
  slug: 'default',
  label: 'Conta Principal do Core (STRIPE_SECRET_KEY)',
  env_var: 'STRIPE_SECRET_KEY',
  configured: Boolean(chavePadrao),
  mode: chavePadrao ? (chavePadrao.startsWith('sk_live_') ? 'live' : 'test') : null,
  account_id: salvo?.default_account_id || null,
  business_name: salvo?.default_business_name || 'Stripe Principal',
 });
 for (const item of lista) {
  if (!item?.id || item.id === 'default') continue;
  const val = String(vivo.env[item.env_var] || env[item.env_var] || '').trim();
  contas.push({
   id: item.id,
   slug: item.slug,
   label: item.label || item.slug,
   env_var: item.env_var,
   configured: Boolean(val),
   mode: val ? (val.startsWith('sk_live_') ? 'live' : 'test') : (item.mode || null),
   account_id: item.account_id || null,
   business_name: item.business_name || item.label || item.slug,
   created_at: item.created_at || null,
  });
 }
 return contas;
}

function resolverChaveStripeDaConta(conta, vivo = vivoPadrao, env = process.env) {
 if (!conta) return '';
 return String(vivo.env[conta.env_var] || env[conta.env_var] || '').trim();
}

async function chamarStripe(secretKey, method, path, paramsOrForm = {}, { baseUrl = STRIPE_BASE, fetchImpl = fetch } = {}) {
 const url = new URL(path, baseUrl);
 const headers = { Authorization: `Bearer ${secretKey}` };
 let body;
 if (method === 'GET') {
  for (const [k, v] of Object.entries(paramsOrForm)) {
   if (v !== undefined && v !== null) url.searchParams.set(k, String(v));
  }
 } else {
  headers['Content-Type'] = 'application/x-www-form-urlencoded';
  const form = new URLSearchParams();
  for (const [k, v] of Object.entries(paramsOrForm)) {
   if (v !== undefined && v !== null && v !== '') form.set(k, String(v));
  }
  body = form.toString();
 }
 const res = await fetchImpl(url, {
  method,
  redirect: 'error',
  headers,
  ...(body !== undefined ? { body } : {}),
  signal: AbortSignal.timeout(STRIPE_TIMEOUT_MS),
 });
 const data = await res.json().catch(() => ({}));
 if (!res.ok) {
  const msg = data?.error?.message || `Stripe retornou status ${res.status}.`;
  throw fail(res.status === 401 || res.status === 403 ? 422 : 502, msg);
 }
 return data;
}

export async function lerStripeContexto(db, productId, { vivo = vivoPadrao, env = process.env, fetchImpl = fetch } = {}) {
 const product = await exigirProduto(db, productId);
 const accounts = await listarContasStripeRegistradas(db, vivo, env);
 const cfgSalva = (await lerEntradaEcossistema(db, `payments:${productId}`)) || {};
 const gateway = ['stripe', 'asaas', 'contract_billing'].includes(cfgSalva.gateway)
  ? cfgSalva.gateway
  : (product.category === 'saas' ? 'stripe' : 'contract_billing');
 const stripe_account_id = accounts.some(a => a.id === cfgSalva.stripe_account_id) ? cfgSalva.stripe_account_id : 'default';
 const contaAtiva = accounts.find(a => a.id === stripe_account_id) || accounts[0];
 const secretKey = resolverChaveStripeDaConta(contaAtiva, vivo, env);
 const baseUrl = String(vivo.env.STRIPE_API_BASE || env.STRIPE_API_BASE || STRIPE_BASE).trim();

 const [offersRes, purchasesRes, receivablesRes] = await Promise.all([
  db.query('SELECT slug, payload, version, updated_at FROM billing_offers WHERE product_id = $1 ORDER BY slug', [productId]),
  db.query(
   `SELECT id, provider, COALESCE(payment_intent_id, session_id, id::text) AS external_id, 'received' AS status,
           customer_email, customer_name, amount_cents, currency, NULL::uuid AS tenant_id, created_at AS updated_at
    FROM billing_purchases WHERE product_id = $1 ORDER BY created_at DESC LIMIT 40`,
   [productId]
  ),
  db.query(
   `SELECT i.id, p.id AS plan_id, p.contract_id, p.tenant_id, t.name AS tenant_name,
           COALESCE(p.contract_snapshot->>'title', 'Contratação') AS engagement_title,
           i.sequence AS installment, i.sequence::text AS description, i.amount_minor, i.currency,
           i.due_on::text AS due_date, i.status, i.paid_on::text AS paid_at
    FROM service_installments i
    JOIN service_receivable_plans p ON p.id = i.plan_id
    JOIN tenants t ON t.id = p.tenant_id
    WHERE p.product_id = $1
    ORDER BY i.due_on DESC, i.sequence ASC LIMIT 60`,
   [productId]
  ).catch(() => ({ rows: [] })),
 ]);

 const localOffers = offersRes.rows.map(r => ({
  slug: r.slug,
  version: r.version,
  updated_at: r.updated_at,
  ...r.payload,
 }));
 const refsLocais = new Set(localOffers.map(o => o.offer_ref).filter(Boolean));
 const prodRefsLocais = new Set(localOffers.map(o => o.product_ref).filter(Boolean));

 const stripeLive = {
  connected: false,
  mode: contaAtiva?.mode || null,
  account: null,
  error: null,
  products: [],
  prices: [],
  payment_links: [],
  subscriptions: [],
  charges: [],
 };

 if (secretKey) {
  try {
   const [acct, prods, prices, links, subs, intents] = await Promise.all([
    chamarStripe(secretKey, 'GET', '/v1/account', {}, { baseUrl, fetchImpl }).catch(() => null),
    chamarStripe(secretKey, 'GET', '/v1/products', { limit: 50 }, { baseUrl, fetchImpl }).catch(() => ({ data: [] })),
    chamarStripe(secretKey, 'GET', '/v1/prices', { limit: 100, 'expand[]': 'data.product' }, { baseUrl, fetchImpl }).catch(() => ({ data: [] })),
    chamarStripe(secretKey, 'GET', '/v1/payment_links', { limit: 50 }, { baseUrl, fetchImpl }).catch(() => ({ data: [] })),
    chamarStripe(secretKey, 'GET', '/v1/subscriptions', { limit: 40, status: 'all' }, { baseUrl, fetchImpl }).catch(() => ({ data: [] })),
    chamarStripe(secretKey, 'GET', '/v1/payment_intents', { limit: 40 }, { baseUrl, fetchImpl }).catch(() => ({ data: [] })),
   ]);
   stripeLive.connected = true;
   if (acct) {
    stripeLive.account = {
     id: acct.id,
     business_name: acct.business_profile?.name || acct.settings?.dashboard?.display_name || acct.email || acct.id,
     email: acct.email || null,
     country: acct.country || 'BR',
     charges_enabled: Boolean(acct.charges_enabled),
    };
   }
   stripeLive.products = (prods.data || []).map(p => ({
    id: p.id,
    name: p.name,
    description: p.description || '',
    active: Boolean(p.active),
    context_match: p.metadata?.tzolkin_context === productId || p.id === cfgSalva.default_stripe_product_id || prodRefsLocais.has(p.id) || String(p.name || '').toLowerCase().includes(product.name.toLowerCase()),
    metadata: p.metadata || {},
   }));
   stripeLive.prices = (prices.data || []).map(pr => {
    const prodObj = typeof pr.product === 'object' && pr.product ? pr.product : null;
    const prodId = prodObj ? prodObj.id : String(pr.product || '');
    const prodName = prodObj?.name || stripeLive.products.find(x => x.id === prodId)?.name || prodId;
    const interval = pr.recurring?.interval || null;
    return {
     id: pr.id,
     product_id: prodId,
     product_name: prodName,
     nickname: pr.nickname || prodName,
     amount_minor: Number.isSafeInteger(pr.unit_amount) ? pr.unit_amount : 0,
     currency: String(pr.currency || 'brl').toUpperCase(),
     kind: interval ? 'subscription' : 'one_time',
     interval,
     active: Boolean(pr.active),
     linked_in_core: refsLocais.has(pr.id),
     context_match: pr.metadata?.tzolkin_context === productId || refsLocais.has(pr.id) || prodObj?.metadata?.tzolkin_context === productId,
    };
   });
   stripeLive.payment_links = (links.data || []).map(l => ({
    id: l.id,
    url: l.url,
    active: Boolean(l.active),
    context_match: l.metadata?.tzolkin_context === productId,
    metadata: l.metadata || {},
   }));
   stripeLive.subscriptions = (subs.data || []).map(s => ({
    id: s.id,
    status: s.status,
    customer: typeof s.customer === 'string' ? s.customer : s.customer?.id || '',
    current_period_end: s.current_period_end ? new Date(s.current_period_end * 1000).toISOString() : null,
    cancel_at_period_end: Boolean(s.cancel_at_period_end),
    amount_minor: s.items?.data?.[0]?.price?.unit_amount ?? 0,
    currency: String(s.currency || s.items?.data?.[0]?.price?.currency || 'brl').toUpperCase(),
    price_id: s.items?.data?.[0]?.price?.id || null,
    context_match: s.metadata?.tzolkin_context === productId || refsLocais.has(s.items?.data?.[0]?.price?.id),
   }));
   stripeLive.charges = (intents.data || []).map(pi => ({
    id: pi.id,
    status: pi.status,
    amount_minor: Number.isSafeInteger(pi.amount) ? pi.amount : 0,
    currency: String(pi.currency || 'brl').toUpperCase(),
    customer_email: pi.receipt_email || null,
    description: pi.description || null,
    created_at: pi.created ? new Date(pi.created * 1000).toISOString() : null,
    context_match: pi.metadata?.tzolkin_context === productId,
   }));
  } catch (e) {
   stripeLive.error = e?.message || 'Não foi possível consultar a Stripe no momento.';
  }
 }

 return {
  product,
  config: {
   gateway,
   stripe_account_id,
   default_stripe_product_id: cfgSalva.default_stripe_product_id || null,
   updated_at: cfgSalva.updated_at || null,
  },
  accounts,
  local_offers: localOffers,
  local_purchases: purchasesRes.rows,
  contract_receivables: receivablesRes.rows,
  stripe: stripeLive,
 };
}

const TEMPLATES_EMAIL_PADRAO = {
 welcome: 'welcome',
 charge_created: 'charge-created',
 payment_confirmed: 'payment-confirmed',
 due_reminder: 'due-reminder',
 overdue: 'overdue',
 renewal: 'renewal',
 canceled: 'canceled',
 refunded: 'refunded',
};

async function sincronizarOfertaNoCore(client, productId, { slug, name, offer_ref, product_ref, amount_minor, currency = 'BRL', kind = 'one_time', interval = null, payment_link_url = null, payment_link_id = null, stripe_account_id = 'default' }) {
 const offerSlug = normalizarSlug(slug || name || offer_ref) || `oferta-${Date.now()}`;
 const payload = {
  product_id: productId,
  slug: offerSlug,
  name: String(name || offerSlug).trim().slice(0, 100),
  provider: 'stripe',
  kind: kind === 'subscription' ? 'subscription' : 'one_time',
  amount_minor: Number(amount_minor) || 100,
  currency: ['BRL', 'USD', 'EUR', 'GBP'].includes(String(currency).toUpperCase()) ? String(currency).toUpperCase() : 'BRL',
  interval: kind === 'subscription' ? (interval === 'year' ? 'year' : 'month') : null,
  installments: 1,
  email_owner: 'core',
  email_templates: TEMPLATES_EMAIL_PADRAO,
  offer_ref: offer_ref || null,
  product_ref: product_ref || null,
  payment_link_url: payment_link_url || null,
  payment_link_id: payment_link_id || null,
  stripe_account_id,
 };
 await client.query(
  `INSERT INTO billing_offers(product_id, slug, payload, version, updated_at)
   VALUES($1, $2, $3::jsonb, 1, now())
   ON CONFLICT (product_id, slug) DO UPDATE
   SET payload = billing_offers.payload || EXCLUDED.payload,
       version = billing_offers.version + 1,
       updated_at = now()`,
  [productId, offerSlug, JSON.stringify(payload)]
 );
 return payload;
}

export async function executarAcaoStripeContexto(client, productId, body = {}, { vivo = vivoPadrao, env = process.env, fetchImpl = fetch, operator = null } = {}) {
 const product = await exigirProduto(client, productId);
 const action = String(body.action || '').trim();
 const cfgAtual = (await lerEntradaEcossistema(client, `payments:${productId}`)) || {};

 if (action === 'select_gateway') {
  const gateway = ['stripe', 'asaas', 'contract_billing'].includes(body.gateway) ? body.gateway : 'stripe';
  const stripe_account_id = String(body.stripe_account_id || cfgAtual.stripe_account_id || 'default').trim();
  const novo = {
   ...cfgAtual,
   gateway,
   stripe_account_id,
   default_stripe_product_id: body.default_stripe_product_id !== undefined ? body.default_stripe_product_id : (cfgAtual.default_stripe_product_id || null),
   version: cfgAtual.version || 1,
   updated_at: new Date().toISOString(),
  };
  await salvarEntradaEcossistema(client, `payments:${productId}`, 'context_payments', novo, body.expected_version);
  return { ok: true, action, config: novo };
 }

 if (action === 'connect_account') {
  const label = text(body.label || product.name, 2, 80);
  const slug = normalizarSlug(body.slug || label);
  if (!slug) throw fail(400, 'Informe um identificador válido para a conta Stripe.');
  const secretKey = String(body.secret_key || '').trim();
  if (!/^sk_(test|live)_[A-Za-z0-9]{10,}$/.test(secretKey)) {
   throw fail(400, 'Chave secreta da Stripe inválida (use sk_live_... ou sk_test_...).');
  }
  const baseUrl = String(vivo.env.STRIPE_API_BASE || env.STRIPE_API_BASE || STRIPE_BASE).trim();
  const acct = await chamarStripe(secretKey, 'GET', '/v1/account', {}, { baseUrl, fetchImpl });
  const envVar = `STRIPE_ACCT_${slug.toUpperCase().replace(/[^A-Z0-9_]/g, '_')}`;
  const nomeChaveMestra = String(env.CORE_SECRETS_KEY ?? '').trim() ? 'CORE_SECRETS_KEY' : 'META_MARKETING_KEY';
  let k;
  try { k = readKey(env, nomeChaveMestra); } catch { throw fail(503, 'Defina CORE_SECRETS_KEY no servidor para cifrar múltiplas contas Stripe.'); }
  const cifrado = seal(secretKey, k);
  const ator = operator?.email || operator?.subject || 'operador';
  await client.query('UPDATE integration_credentials SET revoked_at = now() WHERE nome = $1 AND revoked_at IS NULL', [envVar]);
  await client.query(
   'INSERT INTO integration_credentials(provider,nome,token_ciphertext,token_iv,token_tag,fingerprint,updated_by) VALUES($1,$2,$3,$4,$5,$6,$7)',
   ['stripe', envVar, cifrado.ciphertext, cifrado.iv, cifrado.tag, cifrado.fingerprint, ator]
  );
  await client.query(
   "INSERT INTO integration_credentials_history(provider,nome,action,fingerprint,actor) VALUES('stripe',$1,'set',$2,$3)",
   [envVar, cifrado.fingerprint, ator]
  );
  vivo.invalidar();

  const regAtual = (await lerEntradaEcossistema(client, 'stripe_accounts')) || { accounts: [] };
  const accounts = Array.isArray(regAtual.accounts) ? regAtual.accounts.filter(a => a.id !== `acct_${slug}`) : [];
  const novaConta = {
   id: `acct_${slug}`,
   slug,
   label,
   env_var: envVar,
   mode: secretKey.startsWith('sk_live_') ? 'live' : 'test',
   account_id: acct.id || null,
   business_name: acct.business_profile?.name || acct.settings?.dashboard?.display_name || label,
   created_at: new Date().toISOString(),
  };
  accounts.push(novaConta);
  await salvarEntradaEcossistema(client, 'stripe_accounts', 'stripe_registry', { ...regAtual, accounts });

  const novoCfg = {
   ...cfgAtual,
   gateway: 'stripe',
   stripe_account_id: novaConta.id,
   updated_at: new Date().toISOString(),
  };
  await salvarEntradaEcossistema(client, `payments:${productId}`, 'context_payments', novoCfg);
  return { ok: true, action, account: novaConta, config: novoCfg };
 }

 // Demais ações usam a conta Stripe ativa do contexto:
 const accounts = await listarContasStripeRegistradas(client, vivo, env);
 const stripeAccountId = String(body.stripe_account_id || cfgAtual.stripe_account_id || 'default');
 const contaAtiva = accounts.find(a => a.id === stripeAccountId) || accounts[0];
 const secretKey = resolverChaveStripeDaConta(contaAtiva, vivo, env);
 if (!secretKey) throw fail(409, 'Nenhuma chave da Stripe configurada para a conta selecionada neste contexto.');
 const baseUrl = String(vivo.env.STRIPE_API_BASE || env.STRIPE_API_BASE || STRIPE_BASE).trim();

 if (action === 'create_product') {
  const name = text(body.name || product.name, 2, 120);
  const description = body.description ? String(body.description).trim().slice(0, 300) : '';
  const criado = await chamarStripe(secretKey, 'POST', '/v1/products', {
   name,
   ...(description ? { description } : {}),
   'metadata[tzolkin_context]': productId,
  }, { baseUrl, fetchImpl });
  const novoCfg = {
   ...cfgAtual,
   gateway: 'stripe',
   stripe_account_id: contaAtiva.id,
   default_stripe_product_id: criado.id,
   updated_at: new Date().toISOString(),
  };
  await salvarEntradaEcossistema(client, `payments:${productId}`, 'context_payments', novoCfg);
  return { ok: true, action, stripe_product: criado };
 }

 if (action === 'update_product') {
  const stripeProductId = text(body.stripe_product_id, 3, 120);
  const atualizado = await chamarStripe(secretKey, 'POST', `/v1/products/${encodeURIComponent(stripeProductId)}`, {
   ...(body.name ? { name: text(body.name, 2, 120) } : {}),
   ...(body.description !== undefined ? { description: String(body.description || '').trim().slice(0, 300) } : {}),
   ...(body.active !== undefined ? { active: Boolean(body.active) } : {}),
   'metadata[tzolkin_context]': productId,
  }, { baseUrl, fetchImpl });
  return { ok: true, action, stripe_product: atualizado };
 }

 if (action === 'create_price') {
  let stripeProductId = body.stripe_product_id || cfgAtual.default_stripe_product_id;
  if (!stripeProductId) {
   const prodCriado = await chamarStripe(secretKey, 'POST', '/v1/products', {
    name: product.name,
    'metadata[tzolkin_context]': productId,
   }, { baseUrl, fetchImpl });
   stripeProductId = prodCriado.id;
  }
  const amountMinor = Number(body.amount_minor);
  if (!Number.isSafeInteger(amountMinor) || amountMinor < 50) throw fail(400, 'Informe o valor da oferta em centavos (mínimo 50).');
  const currency = ['BRL', 'USD', 'EUR', 'GBP'].includes(String(body.currency || 'BRL').toUpperCase())
   ? String(body.currency || 'BRL').toUpperCase()
   : 'BRL';
  const kind = body.kind === 'subscription' ? 'subscription' : 'one_time';
  const interval = kind === 'subscription' ? (body.interval === 'year' ? 'year' : 'month') : null;
  const nickname = text(body.name || body.nickname || `${product.name} - Oferta`, 2, 100);
  const preco = await chamarStripe(secretKey, 'POST', '/v1/prices', {
   product: stripeProductId,
   unit_amount: amountMinor,
   currency: currency.toLowerCase(),
   nickname,
   ...(interval ? { 'recurring[interval]': interval } : {}),
   'metadata[tzolkin_context]': productId,
  }, { baseUrl, fetchImpl });

  let linkCriado = null;
  if (body.create_payment_link !== false) {
   linkCriado = await chamarStripe(secretKey, 'POST', '/v1/payment_links', {
    'line_items[0][price]': preco.id,
    'line_items[0][quantity]': 1,
    allow_promotion_codes: true,
    'metadata[tzolkin_context]': productId,
    ...(body.redirect_url ? { 'after_completion[type]': 'redirect', 'after_completion[redirect][url]': String(body.redirect_url).trim() } : {}),
   }, { baseUrl, fetchImpl }).catch(() => null);
  }

  const ofertaCore = await sincronizarOfertaNoCore(client, productId, {
   slug: body.slug || nickname,
   name: nickname,
   offer_ref: preco.id,
   product_ref: stripeProductId,
   amount_minor: amountMinor,
   currency,
   kind,
   interval,
   payment_link_url: linkCriado?.url || null,
   payment_link_id: linkCriado?.id || null,
   stripe_account_id: contaAtiva.id,
  });

  return { ok: true, action, stripe_price: preco, payment_link: linkCriado, offer: ofertaCore };
 }

 if (action === 'create_payment_link') {
  const priceId = text(body.price_id || body.offer_ref, 3, 120);
  const linkCriado = await chamarStripe(secretKey, 'POST', '/v1/payment_links', {
   'line_items[0][price]': priceId,
   'line_items[0][quantity]': 1,
   allow_promotion_codes: true,
   'metadata[tzolkin_context]': productId,
   ...(body.redirect_url ? { 'after_completion[type]': 'redirect', 'after_completion[redirect][url]': String(body.redirect_url).trim() } : {}),
  }, { baseUrl, fetchImpl });

  await client.query(
   `UPDATE billing_offers
    SET payload = payload || $3::jsonb, version = version + 1, updated_at = now()
    WHERE product_id = $1 AND payload->>'offer_ref' = $2`,
   [productId, priceId, JSON.stringify({ payment_link_url: linkCriado.url, payment_link_id: linkCriado.id })]
  );
  return { ok: true, action, payment_link: linkCriado };
 }

 if (action === 'sync_offer') {
  const priceId = text(body.price_id || body.offer_ref, 3, 120);
  const preco = await chamarStripe(secretKey, 'GET', `/v1/prices/${encodeURIComponent(priceId)}`, { 'expand[]': 'product' }, { baseUrl, fetchImpl });
  const prodObj = typeof preco.product === 'object' && preco.product ? preco.product : null;
  const prodId = prodObj ? prodObj.id : String(preco.product || '');
  const nomeOferta = body.name || preco.nickname || prodObj?.name || priceId;
  const interval = preco.recurring?.interval || null;
  const ofertaCore = await sincronizarOfertaNoCore(client, productId, {
   slug: body.slug || nomeOferta,
   name: nomeOferta,
   offer_ref: preco.id,
   product_ref: prodId,
   amount_minor: Number.isSafeInteger(preco.unit_amount) ? preco.unit_amount : 100,
   currency: String(preco.currency || 'brl').toUpperCase(),
   kind: interval ? 'subscription' : 'one_time',
   interval,
   stripe_account_id: contaAtiva.id,
  });
  return { ok: true, action, offer: ofertaCore };
 }

 if (action === 'cancel_subscription') {
  const subId = text(body.subscription_id, 3, 120);
  const imediato = Boolean(body.immediate);
  const res = imediato
   ? await chamarStripe(secretKey, 'DELETE', `/v1/subscriptions/${encodeURIComponent(subId)}`, {}, { baseUrl, fetchImpl })
   : await chamarStripe(secretKey, 'POST', `/v1/subscriptions/${encodeURIComponent(subId)}`, { cancel_at_period_end: true }, { baseUrl, fetchImpl });
  return { ok: true, action, subscription: res };
 }

 throw fail(400, 'Ação da Stripe desconhecida.');
}

// ============================================================================
// VINCULAÇÃO DE CONTRATAÇÕES E CLIENTES AO CONTEXTO
// ============================================================================

export async function vincularContratacaoContexto(client, productId, body = {}) {
 const product = await exigirProduto(client, productId);
 if (body.engagement_id) {
  if (!isUuid(body.engagement_id)) throw fail(400, 'Identificador de contratação inválido.');
  const r = await client.query(
   `UPDATE client_engagements
    SET product_id = $1, revision = revision + 1, updated_at = now()
    WHERE id = $2
    RETURNING *`,
   [productId, body.engagement_id]
  );
  if (!r.rows.length) throw fail(404, 'Contratação não encontrada.');
  const eng = r.rows[0];
  await client.query("UPDATE tenants SET lifecycle_status = 'active' WHERE id = $1 AND lifecycle_status = 'lead'", [eng.tenant_id]);
  if (body.grant_access) {
   const planCode = String(body.plan_code || 'standard').trim().slice(0, 60);
   await client.query(
    `INSERT INTO entitlements(tenant_id, product_id, plan_code, active)
     VALUES($1, $2, $3, true)
     ON CONFLICT (tenant_id, product_id) DO UPDATE SET plan_code = EXCLUDED.plan_code, active = true, updated_at = now()`,
    [eng.tenant_id, productId, planCode]
   );
  }
  return { engagement: eng, tenant_id: eng.tenant_id, mode: 'linked' };
 }

 if (!isUuid(body.tenant_id)) throw fail(400, 'Empresa inválida.');
 const serviceModel = String(body.service_model || body.delivery_model || (product.portfolio_kind === 'platform' || product.portfolio_kind === 'product' ? 'product' : 'consulting')).trim();
 const status = String(body.status || 'active').trim();
 const label = text(body.label || body.title || product.name, 2, 120);
 const r = await client.query(
  `INSERT INTO client_engagements(tenant_id, product_id, service_model, status, label)
   VALUES($1, $2, $3, $4, $5)
   RETURNING *`,
  [body.tenant_id, productId, serviceModel, status, label]
 );
 if (status === 'active' || status === 'planned') {
  await client.query("UPDATE tenants SET lifecycle_status = 'active' WHERE id = $1 AND lifecycle_status = 'lead'", [body.tenant_id]);
 }
 if (body.grant_access || serviceModel === 'product') {
  const planCode = String(body.plan_code || 'standard').trim().slice(0, 60);
  await client.query(
   `INSERT INTO entitlements(tenant_id, product_id, plan_code, active)
    VALUES($1, $2, $3, true)
    ON CONFLICT (tenant_id, product_id) DO UPDATE SET plan_code = EXCLUDED.plan_code, active = true, updated_at = now()`,
   [body.tenant_id, productId, planCode]
  );
 }
 return { engagement: r.rows[0], tenant_id: body.tenant_id, mode: 'created' };
}

// ============================================================================
// REGISTRO DE ROTAS HTTP
// ============================================================================

export function contextOperationsRoutes(router, { vivo = vivoPadrao, env = process.env, fetchImpl = fetch } = {}) {
 // 1. Script CDN público auto-configurável por contexto
 router.get('/sdk/tzolkin.js', async ({ res }) => {
  const js = gerarScriptSdk();
  res.writeHead(200, {
   'Content-Type': 'application/javascript; charset=utf-8',
   'Cache-Control': 'public, max-age=300',
   'Access-Control-Allow-Origin': '*',
  });
  res.end(js);
 }, { auth: 'public', body: false });

 // 2. Configuração pública de UTMs e captura lida pelo script CDN nos sites
 router.get('/v1/sdk/config', async ({ pool, url, res }) => {
  const contextId = url.searchParams.get('context') || url.searchParams.get('product_id') || '';
  if (!isProductId(contextId)) {
   res.writeHead(400, { 'Content-Type': 'application/json; charset=utf-8', 'Access-Control-Allow-Origin': '*' });
   res.end(JSON.stringify({ message: 'Contexto inválido.' }));
   return;
  }
  const dados = await lerSdkContexto(pool, contextId, url.origin);
  res.writeHead(200, { 'Content-Type': 'application/json; charset=utf-8', 'Access-Control-Allow-Origin': '*' });
  res.end(JSON.stringify({
   context: dados.product.id,
   name: dados.product.name,
   config: {
    enabled: dados.config.enabled,
    utm_tzolkin: dados.config.utm_tzolkin,
    default_niche: dados.config.default_niche,
    service_model: dados.config.service_model,
    core_params: dados.config.core_params,
    route_rules: dados.config.route_rules,
    preserve_ad_utms: true,
    auto_capture_forms: dados.config.auto_capture_forms,
    enrich_payment_links: dados.config.enrich_payment_links,
   },
  }));
 }, { auth: 'public', body: false });

 // 3. Auto-cadastro de formulários enviado pelo SDK (autenticado pela chave do app do contexto)
 router.post('/v1/sdk/forms/register', async ({ client, productId, body }) => {
  const ctxId = isProductId(body?.context) ? body.context : productId;
  const resultado = await registrarFormularioSdk(client, ctxId, body);
  return { tenant: null, type: 'context.sdk.form_registered', response: { ok: true, ...resultado } };
 }, { auth: 'service', scope: 'commercial:intake', transactional: true, audit: false });

 // 4. Painel Admin: leitura e escrita do SDK/UTMs/Formulários do contexto
 router.get('/api/products/:productId/sdk', async ({ pool, params, url, reply }) => {
  const dados = await lerSdkContexto(pool, params.productId, url.origin);
  return reply(200, dados);
 }, { body: false });

 router.put('/api/products/:productId/sdk', async ({ client, params, body, url }) => {
  const dados = await salvarSdkContexto(client, params.productId, body, url.origin);
  return { tenant: null, type: 'context.sdk.updated', response: dados };
 }, { transactional: true, audit: false });

 // 5. Painel Admin: leitura e gestão completa da Stripe + Gateway do contexto
 router.get('/api/products/:productId/stripe-management', async ({ pool, params, reply }) => {
  const dados = await lerStripeContexto(pool, params.productId, { vivo, env, fetchImpl });
  return reply(200, dados);
 }, { body: false });

 router.post('/api/products/:productId/stripe-management', async ({ client, params, body, operator }) => {
  const res = await executarAcaoStripeContexto(client, params.productId, body, { vivo, env, fetchImpl, operator });
  return { tenant: null, type: 'context.stripe.action', response: res };
 }, { transactional: true, audit: false });

 // 6. Painel Admin: vincular contratação existente ou criar contratação direto no contexto
 router.post('/api/products/:productId/engagements/bind', async ({ client, params, body }) => {
  const res = await vincularContratacaoContexto(client, params.productId, body);
  return { tenant: res.tenant_id, type: 'engagement.context_bound', response: res };
 }, { transactional: true });
}
