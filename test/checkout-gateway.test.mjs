// Gateway de checkout. Nenhuma chamada sai desta máquina: o adaptador da
// Stripe é substituído por um stub local em todo o suite.
import test from 'node:test';
import assert from 'node:assert/strict';
import { randomBytes } from 'node:crypto';
import { createCore } from '../apps/api/src/app.mjs';
import { createIpThrottle } from '../apps/api/src/modules/checkout-gateway.mjs';

test('per-IP throttle allows up to the limit then blocks within the window', () => {
 let now = 0;
 const throttle = createIpThrottle({ windowMs: 1000, maxAttempts: 3, clock: () => now });
 assert.equal(throttle('1.2.3.4'), true);
 assert.equal(throttle('1.2.3.4'), true);
 assert.equal(throttle('1.2.3.4'), true);
 assert.equal(throttle('1.2.3.4'), false, 'quarta tentativa na mesma janela é recusada');
 assert.equal(throttle('5.6.7.8'), true, 'outro IP tem sua própria janela');
 now = 1001;
 assert.equal(throttle('1.2.3.4'), true, 'janela seguinte libera de novo');
});

test('checkout gateway HTTP suite', async t => {
 const OFFER = { slug: 'pro', payload: { name: 'Skiller Pro', amount_minor: 19990, currency: 'BRL', provider: 'stripe', kind: 'subscription', interval: 'month' } };
 const TEMPLATE = { slug: 'padrao', payload: { type: 'HOSTED', branding: { primary_color: '#111827', logo_url: '', border_radius: 12, font_family: 'system-ui' }, is_default: true } };
 const PRODUCT = { id: 'skiller', name: 'Skiller' };

 function mockPool({ offer = OFFER, template = TEMPLATE, product = PRODUCT } = {}) {
  return { query: async sql => {
   if (sql.includes('FROM products')) return { rows: product ? [product] : [] };
   if (sql.includes('FROM billing_offers')) return { rows: offer ? [offer] : [] };
   if (sql.includes('FROM checkout_templates')) return { rows: template ? [template] : [] };
   return { rows: [] };
  } };
 }

 let lastCall = null;
 const stubAdapterFactory = () => ({
  async createSession(args) { lastCall = args; return { url: 'https://checkout.stripe.com/c/test', client_secret: 'cs_test_123' }; },
 });

 async function boot({ rows, noKey, throttle } = {}) {
  const server = createCore({
   pool: mockPool(rows),
   adminPassword: randomBytes(32).toString('base64url'),
   checkoutOptions: {
    env: { STRIPE_SECRET_KEY: noKey ? undefined : 'sk_test_123' },
    adapterFactory: stubAdapterFactory,
    throttle: throttle ?? (() => true),
   },
  });
  await new Promise(r => server.listen(0, '127.0.0.1', r));
  return { server, origin: `http://127.0.0.1:${server.address().port}` };
 }
 const close = server => { server.closeAllConnections(); return new Promise(r => server.close(r)); };
 const pay = (origin, body) => fetch(`${origin}/api/checkout/sessions`, { method: 'POST', headers: { origin, 'Content-Type': 'application/json' }, body: JSON.stringify(body) });

 await t.test('offer lookup 404s when the offer or the template is missing', async () => {
  const { server, origin } = await boot({ rows: { template: null } });
  try { assert.equal((await fetch(`${origin}/api/checkout/offer?product_id=skiller&offer_slug=pro`)).status, 404); }
  finally { await close(server); }
 });

 await t.test('offer lookup exposes price and publishable key, never a secret', async () => {
  const { server, origin } = await boot();
  try {
   const data = await (await fetch(`${origin}/api/checkout/offer?product_id=skiller&offer_slug=pro`)).json();
   assert.equal(data.offer.amount_minor, 19990);
   assert.equal(data.template.type, 'HOSTED');
   assert.ok(!JSON.stringify(data).includes('sk_test_123'), 'a secret key nunca viaja para o navegador');
  } finally { await close(server); }
 });

 await t.test('a client-supplied price is rejected outright, before the adapter is ever called', async () => {
  const { server, origin } = await boot();
  try {
   const r = await pay(origin, { product_id: 'skiller', offer_slug: 'pro', amount_minor: 1 });
   assert.equal(r.status, 400);
   assert.equal(lastCall, null);
  } finally { await close(server); }
 });

 await t.test('session creation derives price from the server and picks subscription mode', async () => {
  const { server, origin } = await boot();
  try {
   const r = await pay(origin, { product_id: 'skiller', offer_slug: 'pro' });
   assert.equal(r.status, 200);
   assert.deepEqual(await r.json(), { url: 'https://checkout.stripe.com/c/test' });
   assert.equal(lastCall.mode, 'subscription');
   assert.equal(lastCall.lineItem.amountMinor, 19990);
   assert.equal(lastCall.lineItem.currency, 'brl');
  } finally { await close(server); }
 });

 await t.test('asaas offers are refused: no Checkout Session/Elements exists for them here', async () => {
  const { server, origin } = await boot({ rows: { offer: { slug: 'pro', payload: { ...OFFER.payload, provider: 'asaas' } } } });
  try { assert.equal((await pay(origin, { product_id: 'skiller', offer_slug: 'pro' })).status, 400); }
  finally { await close(server); }
 });

 await t.test('a missing Stripe credential answers honestly, not a fake success', async () => {
  const { server, origin } = await boot({ noKey: true });
  try { assert.equal((await pay(origin, { product_id: 'skiller', offer_slug: 'pro' })).status, 503); }
  finally { await close(server); }
 });

 await t.test('the rate limiter can reject before touching the database', async () => {
  const { server, origin } = await boot({ throttle: () => false });
  try { assert.equal((await pay(origin, { product_id: 'skiller', offer_slug: 'pro' })).status, 429); }
  finally { await close(server); }
 });

 await t.test('the public checkout page ships its own relaxed CSP, scoped to this one route', async () => {
  const { server, origin } = await boot();
  try {
   const page = await fetch(`${origin}/c/skiller/pro`);
   assert.equal(page.status, 200);
   const csp = page.headers.get('content-security-policy');
   assert.match(csp, /js\.stripe\.com/);
   // A aba Checkout do painel embute esta página como prévia (mesma origem),
   // mas terceiro nenhum pode emoldurar uma página de pagamento.
   assert.match(csp, /frame-ancestors 'self'/);
   assert.doesNotMatch(csp, /frame-ancestors [^;]*\*/);
   const api = await fetch(`${origin}/api/checkout/offer?product_id=skiller&offer_slug=pro`);
   assert.doesNotMatch(api.headers.get('content-security-policy'), /js\.stripe\.com/, 'a política relaxada não vaza para as rotas JSON');
  } finally { await close(server); }
 });
});
