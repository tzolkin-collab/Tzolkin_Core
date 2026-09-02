// Webhooks de pagamento. Nenhuma chamada sai desta máquina: os eventos são
// forjados localmente e assinados com o mesmo segredo que o Core valida.
// Cria e remove apenas registros sintéticos desta execução.
import test from 'node:test';
import assert from 'node:assert/strict';
import pg from 'pg';
import { createHmac, randomBytes, randomUUID } from 'node:crypto';
import { createCore } from '../apps/api/src/server.mjs';
import { testConnectionString } from '../apps/api/src/platform/database.mjs';
import { verifyStripe, verifyAsaas, normalize } from '../apps/api/src/integrations/payment-webhooks.mjs';

const STRIPE_SECRET = 'whsec_' + randomBytes(24).toString('hex');
const ASAAS_TOKEN = randomBytes(24).toString('hex');
const AGORA = 1_780_000_000_000;

const assinar = (corpo, secret = STRIPE_SECRET, t = Math.floor(AGORA / 1000)) =>
 `t=${t},v1=${createHmac('sha256', secret).update(`${t}.${corpo}`).digest('hex')}`;

test('Webhook verification suite', async t => {
 const corpo = JSON.stringify({ id: 'evt_1', type: 'invoice.paid' });

 await t.test('stripe accepts its own signature', () => {
  assert.deepEqual(verifyStripe({ header: assinar(corpo), rawBody: corpo, secret: STRIPE_SECRET, now: AGORA }), { ok: true });
 });

 await t.test('stripe rejects a tampered body', () => {
  const header = assinar(corpo);
  const r = verifyStripe({ header, rawBody: corpo + ' ', secret: STRIPE_SECRET, now: AGORA });
  assert.equal(r.ok, false);
  assert.equal(r.reason, 'assinatura_invalida');
 });

 await t.test('stripe rejects a replay outside the 5 minute window', () => {
  const header = assinar(corpo, STRIPE_SECRET, Math.floor(AGORA / 1000) - 400);
  assert.equal(verifyStripe({ header, rawBody: corpo, secret: STRIPE_SECRET, now: AGORA }).reason, 'fora_da_janela');
 });

 await t.test('stripe rejects a signature made with another secret', () => {
  const header = assinar(corpo, 'whsec_outro');
  assert.equal(verifyStripe({ header, rawBody: corpo, secret: STRIPE_SECRET, now: AGORA }).ok, false);
 });

 await t.test('stripe ignores schemes other than v1 and duplicated t', () => {
  assert.equal(verifyStripe({ header: `t=${Math.floor(AGORA/1000)},v0=abc`, rawBody: corpo, secret: STRIPE_SECRET, now: AGORA }).reason, 'sem_v1');
  // Um `t` repetido não pode sobrescrever o primeiro.
  const bom = assinar(corpo);
  const comLixo = bom + ',t=1';
  assert.equal(verifyStripe({ header: comLixo, rawBody: corpo, secret: STRIPE_SECRET, now: AGORA }).ok, true);
 });

 await t.test('missing secret is distinguished from invalid signature', () => {
  assert.equal(verifyStripe({ header: assinar(corpo), rawBody: corpo, secret: '', now: AGORA }).reason, 'sem_segredo');
  assert.equal(verifyAsaas({ header: ASAAS_TOKEN, token: '' }).reason, 'sem_segredo');
 });

 await t.test('asaas compares the token', () => {
  assert.deepEqual(verifyAsaas({ header: ASAAS_TOKEN, token: ASAAS_TOKEN }), { ok: true });
  assert.equal(verifyAsaas({ header: 'errado', token: ASAAS_TOKEN }).ok, false);
  assert.equal(verifyAsaas({ header: undefined, token: ASAAS_TOKEN }).reason, 'sem_token');
 });

 await t.test('normalizes both providers into the same vocabulary', () => {
  const s = normalize('stripe', { id: 'evt_2', type: 'invoice.paid', data: { object: { id: 'in_1', amount_paid: 4990, currency: 'BRL' } } });
  assert.equal(s.state, 'received'); assert.equal(s.charge_ref, 'in_1');
  assert.equal(s.amount_cents, 4990); assert.equal(s.currency, 'brl');

  // O Asaas manda reais decimais; o Core guarda centavos inteiros.
  const a = normalize('asaas', { id: 'evt_3', event: 'PAYMENT_RECEIVED', payment: { id: 'pay_1', value: 49.9 } });
  assert.equal(a.state, 'received'); assert.equal(a.amount_cents, 4990); assert.equal(a.currency, 'brl');

  // CONFIRMED e RECEIVED são estados diferentes de propósito.
  assert.equal(normalize('asaas', { id: 'e', event: 'PAYMENT_CONFIRMED', payment: { id: 'p' } }).state, 'confirmed');
 });

 await t.test('unknown events are reported as unhandled, not rejected', () => {
  const e = normalize('stripe', { id: 'evt_4', type: 'radar.early_fraud_warning.created', data: { object: {} } });
  assert.equal(e.handled, false);
  assert.equal(e.state, null);
 });

 await t.test('malformed bodies are refused', () => {
  assert.equal(normalize('stripe', { type: 'invoice.paid' }), null);
  assert.equal(normalize('asaas', { id: 'x' }), null);
  assert.equal(normalize('stripe', []), null);
  assert.equal(normalize('outro', { id: 'x', type: 'y' }), null);
 });
});

test('Webhook endpoint suite', async t => {
 const pool = new pg.Pool({ connectionString: testConnectionString().connectionString, max: 3 });
 const env = { STRIPE_WEBHOOK_SECRET: STRIPE_SECRET, ASAAS_WEBHOOK_TOKEN: ASAAS_TOKEN };
 const adminPassword = randomBytes(32).toString('base64url');
 const server = createCore({ pool, adminPassword, webhookEnv: env, clock: () => AGORA });
 await new Promise(r => server.listen(0, '127.0.0.1', r));
 const origin = `http://127.0.0.1:${server.address().port}`;
 const marca = randomUUID().slice(0, 8);
 const criados = [];

 const enviar = (rota, corpo, headers = {}) =>
  fetch(origin + rota, { method: 'POST', headers: { 'Content-Type': 'application/json', ...headers }, body: corpo });

 const stripe = (tipo, chargeRef, extra = {}) => {
  const id = `evt_${marca}_${criados.length}`; criados.push(id);
  return JSON.stringify({ id, type: tipo, data: { object: { id: chargeRef, ...extra } } });
 };
 const asaas = (evento, chargeRef, extra = {}) => {
  const id = `evt_${marca}_${criados.length}`; criados.push(id);
  return JSON.stringify({ id, event: evento, payment: { id: chargeRef, ...extra } });
 };

 try {
  await t.test('rejects an unsigned request', async () => {
   const r = await enviar('/api/webhooks/stripe', stripe('invoice.paid', 'in_x'));
   assert.equal(r.status, 401);
  });

  await t.test('rejects a wrong asaas token', async () => {
   const r = await enviar('/api/webhooks/asaas', asaas('PAYMENT_RECEIVED', 'pay_x'), { 'asaas-access-token': 'errado' });
   assert.equal(r.status, 401);
  });

  await t.test('accepts a signed stripe event and records it', async () => {
   const corpo = stripe('invoice.finalized', `in_${marca}`, { amount_paid: 4990, currency: 'brl' });
   const r = await enviar('/api/webhooks/stripe', corpo, { 'stripe-signature': assinar(corpo) });
   assert.equal(r.status, 200);
   assert.deepEqual(await r.json(), { received: true, outcome: 'applied' });
  });

  await t.test('the same event delivered twice is a duplicate, still 2xx', async () => {
   const corpo = asaas('PAYMENT_CREATED', `pay_${marca}`, { value: 100 });
   const primeira = await enviar('/api/webhooks/asaas', corpo, { 'asaas-access-token': ASAAS_TOKEN });
   const segunda = await enviar('/api/webhooks/asaas', corpo, { 'asaas-access-token': ASAAS_TOKEN });
   assert.equal((await primeira.json()).outcome, 'applied');
   assert.equal(segunda.status, 200);
   assert.equal((await segunda.json()).outcome, 'duplicate');
  });

  await t.test('an unknown event answers 2xx as unhandled — never break the queue', async () => {
   const corpo = stripe('radar.early_fraud_warning.created', 'x_1');
   const r = await enviar('/api/webhooks/stripe', corpo, { 'stripe-signature': assinar(corpo) });
   assert.equal(r.status, 200);
   assert.equal((await r.json()).outcome, 'unhandled');
  });

  // O motivo da fila NON_SEQUENTIALLY.
  await t.test('a late event does not push the state backwards', async () => {
   const ref = `pay_${marca}_ordem`;
   const recebido = asaas('PAYMENT_RECEIVED', ref, { value: 50 });
   await enviar('/api/webhooks/asaas', recebido, { 'asaas-access-token': ASAAS_TOKEN });

   const confirmado = asaas('PAYMENT_CONFIRMED', ref, { value: 50 });
   const r = await enviar('/api/webhooks/asaas', confirmado, { 'asaas-access-token': ASAAS_TOKEN });
   assert.equal(r.status, 200);
   assert.equal((await r.json()).outcome, 'stale', 'evento atrasado é registrado, não aplicado');

   const { rows } = await pool.query('SELECT state FROM payment_charges WHERE provider=$1 AND charge_ref=$2', ['asaas', ref]);
   assert.equal(rows[0].state, 'received', 'o estado não pode retroceder para confirmed');
  });

  await t.test('a refund marks the charge without erasing the progress', async () => {
   const ref = `pay_${marca}_estorno`;
   await enviar('/api/webhooks/asaas', asaas('PAYMENT_RECEIVED', ref, { value: 10 }), { 'asaas-access-token': ASAAS_TOKEN });
   await enviar('/api/webhooks/asaas', asaas('PAYMENT_REFUNDED', ref), { 'asaas-access-token': ASAAS_TOKEN });
   const { rows } = await pool.query('SELECT state, refunded_at FROM payment_charges WHERE provider=$1 AND charge_ref=$2', ['asaas', ref]);
   assert.equal(rows[0].state, 'received', 'estorno não apaga o que foi recebido');
   assert.ok(rows[0].refunded_at, 'e a data do estorno fica registrada');
  });

  await t.test('the operator endpoint requires a session', async () => {
   assert.equal((await fetch(origin + '/api/payments/webhooks')).status, 401);
  });

  await t.test('the operator sees what arrived and the configured state', async () => {
   const login = await fetch(origin + '/api/login', {
    method: 'POST', headers: { origin, 'Content-Type': 'application/json' },
    body: JSON.stringify({ password: adminPassword }),
   });
   const cookie = login.headers.get('set-cookie').split(';')[0];
   const data = await (await fetch(origin + '/api/payments/webhooks', { headers: { cookie } })).json();
   assert.deepEqual(data.configured, { stripe: true, asaas: true });
   assert.equal(data.execution, 'record_only');
   assert.ok(data.events.some(e => criados.includes(e.event_id)));
   // Nem o segredo nem o token podem chegar ao navegador.
   const bruto = JSON.stringify(data);
   assert.ok(!bruto.includes(STRIPE_SECRET) && !bruto.includes(ASAAS_TOKEN));
  });
 } finally {
  const client = await pool.connect();
  try {
   await client.query('BEGIN');
   await client.query('DELETE FROM payment_webhook_events WHERE event_id LIKE $1', [`evt_${marca}%`]);
   await client.query('DELETE FROM payment_charges WHERE charge_ref LIKE $1 OR charge_ref = $2', [`%${marca}%`, 'x_1']);
   await client.query('COMMIT');
  } finally { client.release(); }
  server.closeAllConnections();
  await new Promise(r => server.close(r));
  await pool.end();
 }
});
