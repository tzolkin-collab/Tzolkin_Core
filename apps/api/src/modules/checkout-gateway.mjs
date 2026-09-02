// Gateway de checkout — a única rota pública do Core que cria uma sessão de
// pagamento de verdade.
//
// product-payments.mjs e stripe-catalog.mjs marcam 'configuration_only' /
// 'read_only' de propósito. Esta rota cruza essa linha: aqui sim nasce
// dinheiro em trânsito. Em troca, ela é a única rota pública que decide um
// valor — e nunca aceita esse valor de quem chama. Preço, moeda e nome vêm
// de billing_offers, lidos aqui a partir de product_id+offer_slug; o corpo
// da requisição não carrega preço nenhum.
//
// Só fluxo 1 (Tzolkin vende, Tzolkin recebe). Sem Connect, sem split — isso
// depende de D3 (ver docs/decisions/0003). Só ofertas Stripe por ora: Asaas
// não tem Checkout Session/Elements, cria cobrança por outro formato de API
// e fica para quando for desenhado (não fingido) aqui.
import { readFileSync } from 'node:fs';
import { fail, json, input, isProductId, onlyParams } from '../platform/http.mjs';
import { createStripeCheckoutAdapter } from '../integrations/stripe-checkout.mjs';

const WINDOW_MS = 5 * 60 * 1000;
const MAX_ATTEMPTS = 20;

// CSP própria desta única página pública: precisa do JS/iframe da Stripe, que
// a política estrita global (default-src 'self') bloqueia de propósito para
// o painel administrativo. A sobrescrita fica só nesta rota — o resto do
// Core continua sob a política estrita de platform/http.mjs.
// frame-ancestors 'self' e não 'none': a aba Checkout do painel embute esta
// página como prévia, e painel e checkout compartilham origem. 'self' continua
// barrando clickjacking de terceiro, que é o risco real numa página de pagamento
// — o que ele libera é só a nossa própria origem.
const CHECKOUT_CSP = "default-src 'self'; style-src 'self'; img-src 'self' https:; script-src 'self' https://js.stripe.com; frame-src https://js.stripe.com https://hooks.stripe.com; connect-src 'self' https://api.stripe.com; frame-ancestors 'self'; form-action 'self'";

/**
 * Limitador por IP dedicado a esta rota. O contador de platform/session.mjs
 * existe só para o login de bootstrap e diz explicitamente que não serve a
 * um ambiente exposto — teste de cartão roubado é o risco concreto de
 * qualquer endpoint público que cria sessão de pagamento: sem limite por IP,
 * cada tentativa é uma cobrança de verdade que a Stripe pode contestar.
 */
export function createIpThrottle({ windowMs = WINDOW_MS, maxAttempts = MAX_ATTEMPTS, clock = Date.now } = {}) {
 const hits = new Map();
 return ip => {
  const now = clock();
  for (const [key, entry] of hits) if (entry.resetAt < now) hits.delete(key);
  const entry = hits.get(ip);
  if (!entry || now > entry.resetAt) { hits.set(ip, { count: 1, resetAt: now + windowMs }); return true; }
  entry.count += 1;
  return entry.count <= maxAttempts;
 };
}

// Confia no primeiro X-Forwarded-For quando presente (deploy atrás de proxy
// reverso); cai para o socket direto fora desse cenário.
const clientIp = req => req.headers['x-forwarded-for']?.split(',')[0].trim() || req.socket.remoteAddress || 'unknown';

const ofertaPublica = row => ({ slug: row.slug, name: row.payload.name, amount_minor: row.payload.amount_minor, currency: row.payload.currency, kind: row.payload.kind, interval: row.payload.interval });
const templatePublico = row => ({ slug: row.slug, type: row.payload.type, branding: row.payload.branding });

async function lerOfertaETemplate(pool, productId, offerSlug, templateSlug) {
 const [produto, oferta, template] = await Promise.all([
  pool.query("SELECT id,name FROM products WHERE id=$1 AND lifecycle_status='active'", [productId]),
  pool.query('SELECT slug,payload FROM billing_offers WHERE product_id=$1 AND slug=$2', [productId, offerSlug]),
  templateSlug
   ? pool.query('SELECT slug,payload FROM checkout_templates WHERE product_id=$1 AND slug=$2', [productId, templateSlug])
   : pool.query(`SELECT slug,payload FROM checkout_templates WHERE product_id=$1 AND (payload->>'is_default')='true' LIMIT 1`, [productId]),
 ]);
 if (!produto.rows.length || !oferta.rows.length) throw fail(404, 'Oferta não encontrada.');
 if (!template.rows.length) throw fail(404, 'Nenhum template de checkout configurado para este produto.');
 return { produto: produto.rows[0], oferta: oferta.rows[0], template: template.rows[0] };
}

export function checkoutGatewayRoutes(router, { env = process.env, adapterFactory = createStripeCheckoutAdapter, throttle = createIpThrottle() } = {}) {
 router.get('/api/checkout/offer', async ({ url, pool, reply }) => {
  onlyParams(url.searchParams, ['product_id', 'offer_slug', 'template_slug']);
  const productId = url.searchParams.get('product_id'), offerSlug = url.searchParams.get('offer_slug'), templateSlug = url.searchParams.get('template_slug');
  if (!isProductId(productId) || !isProductId(offerSlug) || (templateSlug !== null && !isProductId(templateSlug))) throw fail(400, 'Identificador inválido.');
  const { produto, oferta, template } = await lerOfertaETemplate(pool, productId, offerSlug, templateSlug);
  // A publishable key não é segredo -- é feita para ir ao navegador. Só ela
  // (nunca a secreta) viaja nesta rota pública.
  return reply(200, { product: { id: produto.id, name: produto.name }, offer: ofertaPublica(oferta), template: templatePublico(template), stripe_publishable_key: env.STRIPE_PUBLISHABLE_KEY || null });
 }, { auth: 'public', body: false });

 router.post('/api/checkout/sessions', async ({ req, url, pool, reply }) => {
  onlyParams(url.searchParams, []);
  if (!throttle(clientIp(req))) throw fail(429, 'Muitas tentativas. Aguarde alguns minutos.');

  const body = await json(req);
  input(body, ['product_id', 'offer_slug', 'template_slug']);
  const { product_id: productId, offer_slug: offerSlug } = body;
  const templateSlug = body.template_slug ?? null;
  if (!isProductId(productId) || !isProductId(offerSlug) || (templateSlug !== null && !isProductId(templateSlug))) throw fail(400, 'Identificador inválido.');

  const { oferta, template } = await lerOfertaETemplate(pool, productId, offerSlug, templateSlug);
  const offer = oferta.payload, tpl = template.payload;

  if (offer.provider !== 'stripe') throw fail(400, 'Checkout automático por ora só cria sessão para ofertas na Stripe.');
  if (!['HOSTED', 'EMBEDDED'].includes(tpl.type)) throw fail(400, 'Este tipo de template ainda não cria sessão de pagamento.');
  if (!env.STRIPE_SECRET_KEY) throw fail(503, 'Stripe não configurada.');

  const uiMode = tpl.type === 'EMBEDDED' ? 'embedded' : 'hosted';
  const mode = offer.kind === 'subscription' ? 'subscription' : 'payment';
  const adapter = adapterFactory({ secretKey: env.STRIPE_SECRET_KEY });

  let session;
  try {
   session = await adapter.createSession({
    uiMode, mode,
    // Preço, moeda e nome vêm só daqui — do que acabou de ser lido de billing_offers.
    lineItem: { name: offer.name, amountMinor: offer.amount_minor, currency: offer.currency.toLowerCase(), interval: offer.interval },
    successUrl: `${url.origin}/c/${productId}/${offerSlug}?status=success&session_id={CHECKOUT_SESSION_ID}`,
    cancelUrl: `${url.origin}/c/${productId}/${offerSlug}?status=cancel`,
    returnUrl: `${url.origin}/c/${productId}/${offerSlug}?status=return&session_id={CHECKOUT_SESSION_ID}`,
   });
  } catch (error) { throw fail(502, error.message); }

  return reply(200, uiMode === 'embedded' ? { clientSecret: session.client_secret } : { url: session.url });
 }, { auth: 'public' });

 // A página pública em si. Serve o mesmo HTML estático para qualquer
 // oferta — quem escolhe o que mostrar é o client-side, a partir do
 // path e das duas rotas de leitura acima.
 router.get('/c/:productId/:offerSlug', async ({ res }) => {
  res.setHeader('Content-Security-Policy', CHECKOUT_CSP);
  res.writeHead(200, { 'Content-Type': 'text/html; charset=utf-8' });
  res.end(readFileSync(new URL('../../../web/public/checkout.html', import.meta.url)));
 }, { auth: 'public', body: false });
}

export const _internals = { clientIp };
