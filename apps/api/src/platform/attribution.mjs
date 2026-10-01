import { fail, input, text } from './http.mjs';

// Atribuição estendida do intake comercial: o que liga um lead à campanha, ao anúncio e
// à sessão que o trouxe. Ver docs/ATTRIBUTION.md.
//
// POR QUE EXISTE. O Core sincroniza da Meta só números por campanha e por dia (gasto,
// impressões, cliques, leads). A Meta não tem dado por PESSOA para lead de site, então o
// que une "este lead" a "esta campanha" precisa viajar com o lead e ficar na tabela:
// os IDs do anúncio (não os nomes, que mudam), os UTMs, a sessão e o consentimento.
//
// COMPATIBILIDADE COM A IDEMPOTÊNCIA. O hash do pedido (commercial-intake.mjs) é
// calculado sobre o pedido normalizado. Um campo novo que entrasse como `null` mudaria
// o hash de um reenvio já em andamento e ele tomaria 409 depois do deploy. Por isso
// aqui só entra no resultado o que FOI enviado: pedido antigo gera o mesmo hash de antes.

const opt = (v, max) => (v == null || v === '' ? undefined : text(v, 1, max));
const padrao = (v, re, msg) => {
 if (v == null || v === '') return undefined;
 if (typeof v !== 'string' || !re.test(v)) throw fail(400, msg);
 return v;
};

const ID_META = /^[0-9]{5,25}$/;                    // campaign.id / adset.id / ad.id da Meta
const FBP = /^fb\.[0-9]\.[0-9]{10,13}\.[0-9]{5,20}$/;
const FBC = /^fb\.[0-9]\.[0-9]{10,13}\.[A-Za-z0-9_-]{10,500}$/;
const CLIQUE = /^[A-Za-z0-9_-]{5,500}$/;            // fbclid / gclid
const SESSAO = /^[A-Za-z0-9_-]{8,64}$/;
const TZOLKIN = /^[a-z0-9][a-z0-9._-]{0,79}$/;      // utm_tzolkin: "<produto>.<nicho>", ex.: sites.corretor
const EVENTO = /^[A-Za-z][A-Za-z0-9_]{1,40}$/;
const EVENTO_ID = /^[A-Za-z0-9_.:-]{1,80}$/;

export const CHAVES_BASE = ['source_system', 'source_ref', 'channel', 'utm_source', 'utm_medium', 'utm_campaign', 'utm_content', 'landing_page', 'referrer', 'created_at'];
export const CHAVES_ESTENDIDAS = ['utm_term', 'utm_tzolkin', 'meta_campaign_id', 'meta_adset_id', 'meta_ad_id', 'fbclid', 'gclid', 'fbc', 'fbp', 'session_key', 'first_touch_at', 'last_touch', 'session', 'geo'];
export const CHAVES_ATRIBUICAO = [...CHAVES_BASE, ...CHAVES_ESTENDIDAS];

const CHAVES_TOQUE = ['at', 'utm_source', 'utm_medium', 'utm_campaign', 'utm_content', 'utm_term', 'utm_tzolkin', 'meta_campaign_id', 'meta_adset_id', 'meta_ad_id', 'landing_page', 'referrer'];
const CHAVES_SESSAO = ['first_seen_at', 'last_seen_at', 'pageviews', 'duration_seconds', 'consent', 'events'];
const CHAVES_GEO = ['city', 'region', 'country', 'latitude', 'longitude', 'precision'];

const limpa = o => Object.fromEntries(Object.entries(o).filter(([, v]) => v !== undefined));
const objeto = (v, nome) => {
 if (v == null) return undefined;
 if (typeof v !== 'object' || Array.isArray(v)) throw fail(400, `${nome} inválido.`);
 return v;
};
const inteiro = (v, min, max, nome) => {
 if (v == null) return undefined;
 if (!Number.isInteger(v) || v < min || v > max) throw fail(400, `${nome} inválido.`);
 return v;
};

function toque(t, date) {
 input(t, CHAVES_TOQUE);
 const r = limpa({
  at: t.at == null ? undefined : date(t.at) ?? undefined,
  utm_source: opt(t.utm_source, 200), utm_medium: opt(t.utm_medium, 200), utm_campaign: opt(t.utm_campaign, 500),
  utm_content: opt(t.utm_content, 500), utm_term: opt(t.utm_term, 500),
  utm_tzolkin: padrao(opt(t.utm_tzolkin, 80)?.toLowerCase(), TZOLKIN, 'utm_tzolkin inválido.'),
  meta_campaign_id: padrao(t.meta_campaign_id == null ? undefined : String(t.meta_campaign_id), ID_META, 'ID de campanha inválido.'),
  meta_adset_id: padrao(t.meta_adset_id == null ? undefined : String(t.meta_adset_id), ID_META, 'ID de conjunto inválido.'),
  meta_ad_id: padrao(t.meta_ad_id == null ? undefined : String(t.meta_ad_id), ID_META, 'ID de anúncio inválido.'),
  landing_page: opt(t.landing_page, 500), referrer: opt(t.referrer, 1000),
 });
 return Object.keys(r).length ? r : undefined;
}

function sessao(s, date) {
 input(s, CHAVES_SESSAO);
 if (s.consent != null && !['granted', 'denied', 'pending'].includes(s.consent)) throw fail(400, 'Consentimento da sessão inválido.');
 if (s.events != null && (!Array.isArray(s.events) || s.events.length > 20)) throw fail(400, 'Eventos da sessão inválidos.');
 const eventos = s.events?.map(e => {
  input(e, ['name', 'at', 'event_id']);
  return limpa({
   name: padrao(e.name, EVENTO, 'Nome de evento inválido.'),
   at: e.at == null ? undefined : date(e.at) ?? undefined,
   event_id: padrao(e.event_id, EVENTO_ID, 'event_id inválido.'),
  });
 });
 return limpa({
  first_seen_at: s.first_seen_at == null ? undefined : date(s.first_seen_at) ?? undefined,
  last_seen_at: s.last_seen_at == null ? undefined : date(s.last_seen_at) ?? undefined,
  pageviews: inteiro(s.pageviews, 0, 10000, 'pageviews'),
  duration_seconds: inteiro(s.duration_seconds, 0, 86400, 'duration_seconds'),
  consent: s.consent ?? undefined,
  events: eventos?.length ? eventos : undefined,
 });
}

function geo(g) {
 input(g, CHAVES_GEO);
 const temCoordenada = g.latitude != null || g.longitude != null;
 if (temCoordenada) {
  if (typeof g.latitude !== 'number' || typeof g.longitude !== 'number' || !Number.isFinite(g.latitude) || !Number.isFinite(g.longitude)
   || Math.abs(g.latitude) > 90 || Math.abs(g.longitude) > 180) throw fail(400, 'Coordenadas inválidas.');
 }
 if (g.precision != null && !['ip', 'cnpj', 'declared'].includes(g.precision)) throw fail(400, 'Precisão da localização inválida.');
 // Quem diz de onde veio a coordenada tem que dizer o quão confiável ela é: IP não é GPS.
 if ((temCoordenada || g.city != null) && g.precision == null) throw fail(400, 'Localização exige a precisão (ip, cnpj ou declared).');
 // Coordenada por IP é do provedor, não da pessoa: guardar mais que ~1 km de resolução seria precisão inventada.
 const arredonda = v => (g.precision === 'ip' ? Math.round(v * 100) / 100 : Math.round(v * 10000) / 10000);
 return limpa({
  city: opt(g.city, 80), region: opt(g.region, 80),
  country: padrao(g.country, /^[A-Z]{2}$/, 'País inválido.'),
  latitude: temCoordenada ? arredonda(g.latitude) : undefined,
  longitude: temCoordenada ? arredonda(g.longitude) : undefined,
  precision: g.precision ?? undefined,
 });
}

/**
 * Parte ESTENDIDA da atribuição, validada. Devolve só o que foi enviado (ver o topo do
 * arquivo). `date` é o validador de data do intake (recusa data no futuro).
 */
export function atribuicaoEstendida(a, date) {
 const sess = a.session == null ? undefined : sessao(objeto(a.session, 'session'), date);
 const r = limpa({
  utm_term: opt(a.utm_term, 500),
  utm_tzolkin: padrao(opt(a.utm_tzolkin, 80)?.toLowerCase(), TZOLKIN, 'utm_tzolkin inválido.'),
  meta_campaign_id: padrao(a.meta_campaign_id == null ? undefined : String(a.meta_campaign_id), ID_META, 'ID de campanha inválido.'),
  meta_adset_id: padrao(a.meta_adset_id == null ? undefined : String(a.meta_adset_id), ID_META, 'ID de conjunto inválido.'),
  meta_ad_id: padrao(a.meta_ad_id == null ? undefined : String(a.meta_ad_id), ID_META, 'ID de anúncio inválido.'),
  fbclid: padrao(a.fbclid, CLIQUE, 'fbclid inválido.'),
  gclid: padrao(a.gclid, CLIQUE, 'gclid inválido.'),
  fbc: padrao(a.fbc, FBC, 'fbc inválido.'),
  fbp: padrao(a.fbp, FBP, 'fbp inválido.'),
  session_key: padrao(a.session_key, SESSAO, 'session_key inválida.'),
  first_touch_at: a.first_touch_at == null ? undefined : date(a.first_touch_at) ?? undefined,
  last_touch: a.last_touch == null ? undefined : toque(objeto(a.last_touch, 'last_touch'), date),
  session: sess && Object.keys(sess).length ? sess : undefined,
  geo: a.geo == null ? undefined : (g => (Object.keys(g).length ? g : undefined))(geo(objeto(a.geo, 'geo'))),
 });
 // fbp e fbc vêm de COOKIES que o pixel da Meta grava depois do aceite. Sem o consentimento
 // registrado na sessão o emissor não pode mandá-los: a regra mora aqui e não só no site,
 // porque o Core é quem guarda. (UTM, fbclid e gclid vêm da URL e não passam por esta guarda.)
 if ((r.fbp || r.fbc) && r.session?.consent !== 'granted') {
  throw fail(400, 'Cookies de anúncio (fbp, fbc) exigem consentimento registrado na sessão.');
 }
 return r;
}
