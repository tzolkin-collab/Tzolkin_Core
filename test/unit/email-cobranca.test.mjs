// E-mail de cobrança: do evento do Stripe até a fila. Nada envia; tudo é checado sem rede.
import test from 'node:test';
import assert from 'node:assert/strict';
import { createHmac } from 'node:crypto';
import { readFileSync } from 'node:fs';
import { extrairDoStripe, processarEmailDeCobranca, formatarValor } from '../../apps/api/src/platform/email-cobranca.mjs';
import { VARIAVEIS_DE_COBRANCA, VARIAVEIS_CONHECIDAS, EVENTOS_DE_COBRANCA, rodapeDeCobranca } from '../../apps/api/src/platform/email-modelo.mjs';
import { paymentWebhookRoutes } from '../../apps/api/src/modules/payment-webhooks.mjs';
import { emailFilaRoutes } from '../../apps/api/src/modules/email-fila.mjs';
import { createStripeCheckoutAdapter } from '../../apps/api/src/integrations/stripe-checkout.mjs';
import { EMAIL_EVENTS } from '../../apps/api/src/modules/billing.mjs';

const SESSAO = (extra = {}, metadata = { product_id: 'sites', offer_slug: 'pro-mensal' }) => ({
 id: 'evt_1', type: 'checkout.session.completed',
 data: { object: { id: 'cs_test_1', mode: 'subscription', payment_status: 'paid', payment_intent: 'pi_1', subscription: 'sub_1', customer: 'cus_1', customer_details: { email: ' Maria@Exemplo.com ', name: 'Maria Souza' }, amount_total: 4900, currency: 'BRL', metadata, ...extra } },
});

// ---------- extração ----------
test('checkout.session.completed pago: registra a compra (e-mail em minúsculas, ids do Stripe) e pede payment_confirmed', () => {
 const i = extrairDoStripe(SESSAO());
 assert.equal(i.evento, 'payment_confirmed'); assert.equal(i.chave, 'cs_test_1');
 assert.deepEqual(i.compra, { session: 'cs_test_1', payment_intent: 'pi_1', subscription: 'sub_1', customer: 'cus_1', email: 'maria@exemplo.com', name: 'Maria Souza', product_id: 'sites', offer_slug: 'pro-mensal', amount_cents: 4900, currency: 'brl' });
 assert.deepEqual(i.procura, { session: 'cs_test_1' });
 assert.equal(extrairDoStripe(SESSAO({ payment_status: 'no_payment_required' })).evento, 'payment_confirmed');
});

test('sessão ainda não paga só registra a compra; o e-mail sai no async_payment_succeeded', () => {
 const pendente = extrairDoStripe(SESSAO({ payment_status: 'unpaid' }));
 assert.equal(pendente.evento, null); assert.ok(pendente.compra);
 const ok = SESSAO({ payment_status: 'paid' }); ok.type = 'checkout.session.async_payment_succeeded';
 assert.equal(extrairDoStripe(ok).evento, 'payment_confirmed');
});

test('sessão que não é do checkout do Core (sem metadata válida) ou sem e-mail do comprador não é com a gente', () => {
 assert.equal(extrairDoStripe(SESSAO({}, {})), null);
 assert.equal(extrairDoStripe(SESSAO({}, { product_id: 'Sites!', offer_slug: 'x' })), null);
 assert.equal(extrairDoStripe(SESSAO({ customer_details: { name: 'Sem e-mail' } })), null);
 assert.equal(extrairDoStripe(SESSAO({ customer_details: { email: 'sem-arroba' } })), null);
 assert.equal(extrairDoStripe(SESSAO({ id: '' })), null);
 for (const lixo of [null, undefined, {}, { type: 'x' }, { type: 'invoice.paid', data: {} }, { type: 'invoice.paid', data: { object: 'texto' } }]) assert.equal(extrairDoStripe(lixo), null);
});

test('eventos seguintes chegam só com ids: renovação, falha, estorno e cancelamento', () => {
 const fatura = (extra, tipo = 'invoice.paid') => ({ type: tipo, data: { object: { id: 'in_9', subscription: 'sub_1', billing_reason: 'subscription_cycle', amount_paid: 4900, amount_due: 4900, currency: 'brl', ...extra } } });
 const ren = extrairDoStripe(fatura({}));
 assert.deepEqual([ren.evento, ren.chave, ren.procura, ren.valores.amount_cents, ren.compra], ['renewal', 'in_9', { subscription: 'sub_1' }, 4900, undefined]);
 assert.equal(extrairDoStripe(fatura({ billing_reason: 'subscription_create' })), null, 'a 1ª fatura é a própria compra: não manda renovação');
 assert.equal(extrairDoStripe(fatura({ subscription: null })), null, 'fatura avulsa não é assinatura nossa');
 assert.equal(extrairDoStripe(fatura({ subscription: null, parent: { subscription_details: { subscription: 'sub_novo' } } })).procura.subscription, 'sub_novo', 'API nova do Stripe: o id fica em outro campo');
 const falha = extrairDoStripe(fatura({ next_payment_attempt: Date.parse('2026-10-10T15:00:00Z') / 1000 }, 'invoice.payment_failed'));
 assert.deepEqual([falha.evento, falha.valores.due_date, falha.valores.amount_cents], ['overdue', '10/10/2026', 4900]);
 assert.equal(extrairDoStripe(fatura({}, 'invoice.payment_failed')).valores.due_date, '', 'sem data: vazio, sem lançar');
 const est = extrairDoStripe({ type: 'charge.refunded', data: { object: { id: 'ch_1', payment_intent: 'pi_1', amount_refunded: 1500, currency: 'brl' } } });
 assert.deepEqual([est.evento, est.procura, est.valores.amount_cents, est.chave], ['refunded', { payment_intent: 'pi_1' }, 1500, 'ch_1']);
 assert.equal(extrairDoStripe({ type: 'charge.refunded', data: { object: { id: 'ch_1', payment_intent: null } } }), null);
 const can = extrairDoStripe({ type: 'customer.subscription.deleted', data: { object: { id: 'sub_1' } } });
 assert.deepEqual([can.evento, can.procura, can.chave], ['canceled', { subscription: 'sub_1' }, 'sub_1']);
 for (const t of ['invoice.finalized', 'charge.dispute.created', 'customer.subscription.updated', 'payment_intent.created']) assert.equal(extrairDoStripe({ type: t, data: { object: { id: 'x_1', subscription: 'sub_1' } } }), null, t);
});

test('valor em reais e vocabulário: o que a tela e o código dizem é a mesma lista', () => {
 assert.equal(formatarValor(4900, 'brl'), 'R$ 49,00'); assert.equal(formatarValor(150, 'BRL'), 'R$ 1,50');
 assert.match(formatarValor(1000, 'usd'), /US\$\s?10,00/); assert.equal(formatarValor(-1, 'brl'), ''); assert.equal(formatarValor(null, 'brl'), '');
 assert.ok(!formatarValor(4900, 'brl').includes(' '), 'espaço normal, não o inseparável');
 assert.ok(formatarValor(500, 'xx1').includes('5,00'), 'moeda estranha não lança');
 assert.deepEqual([...VARIAVEIS_DE_COBRANCA], ['name', 'email', 'product_name', 'plan', 'amount', 'due_date']);
 assert.deepEqual([...VARIAVEIS_CONHECIDAS], ['name', 'email', 'product_name', 'company_name', 'plan', 'amount', 'due_date']);
 for (const e of EVENTOS_DE_COBRANCA) assert.ok(EMAIL_EVENTS.includes(e), e + ' existe em billing.mjs');
 assert.ok(!EVENTOS_DE_COBRANCA.includes('welcome'));
 assert.match(rodapeDeCobranca('Tzolkin'), /sua compra de Tzolkin/);
});

// ---------- banco ----------
const MODELO = { subject: 'Pagamento de {{amount}} confirmado, {{name}}', body: 'Olá {{name}},\n\nrecebemos {{amount}} pelo plano {{plan}} de {{product_name}}.\n\nVencimento: {{due_date}}', preheader: 'Obrigado' };
function clienteDeCobranca({ owner = 'core', templates = { payment_confirmed: 'pagamento-ok', renewal: 'renovacao', overdue: 'atraso', refunded: 'estorno', canceled: 'cancelado' }, modelo = MODELO, compra = 'achar', jaNaFila = false, ofertaSumiu = false } = {}) {
 const sql = [];
 const linhaCompra = { product_id: 'sites', offer_slug: 'pro-mensal', customer_email: 'maria@exemplo.com', customer_name: 'Maria Souza', amount_cents: '4900', currency: 'brl' };
 return {
  sql,
  async query(texto, p = []) {
   sql.push({ texto, p });
   if (texto.startsWith('INSERT INTO billing_purchases')) return { rows: [] };
   if (texto.includes('FROM billing_purchases')) return { rows: compra === 'achar' ? [linhaCompra] : [] };
   if (texto.includes('FROM billing_offers')) return { rows: ofertaSumiu ? [] : [{ payload: { name: 'Plano Pro', email_owner: owner, email_templates: templates } }] };
   if (texto.includes('FROM email_templates')) return { rows: modelo ? [{ payload: modelo }] : [] };
   if (texto.includes('FROM products')) return { rows: [{ name: 'Tzolkin' }] };
   if (texto.startsWith('INSERT INTO email_outbox')) return { rows: jaNaFila ? [] : [{ id: 'mail-1' }] };
   return { rows: [] };
  },
 };
}
const enfileirado = c => c.sql.find(q => q.texto.startsWith('INSERT INTO email_outbox'));

test('pagamento confirmado: grava a compra, renderiza com as variáveis de cobrança e ENFILEIRA (não envia)', async () => {
 const c = clienteDeCobranca();
 const r = await processarEmailDeCobranca(c, extrairDoStripe(SESSAO()));
 assert.deepEqual(r, { enfileirado: true });
 const compra = c.sql.find(q => q.texto.startsWith('INSERT INTO billing_purchases'));
 assert.match(compra.texto, /ON CONFLICT \(provider,session_id\) DO NOTHING/);
 assert.deepEqual(compra.p.slice(0, 8), ['cs_test_1', 'pi_1', 'sub_1', 'cus_1', 'sites', 'pro-mensal', 'maria@exemplo.com', 'Maria Souza']);
 const [chave, tipo, produto, modelo, evento, , lead, para, nome, assunto, texto, html, por] = enfileirado(c).p;
 assert.equal(chave, 'cobranca:stripe:payment_confirmed:cs_test_1');
 assert.deepEqual([tipo, produto, modelo, evento, lead, para, nome, por], ['automacao', 'sites', 'pagamento-ok', 'payment_confirmed', null, 'maria@exemplo.com', 'Maria Souza', 'cobranca']);
 assert.equal(assunto, 'Pagamento de R$ 49,00 confirmado, Maria Souza');
 assert.match(texto, /recebemos R\$ 49,00 pelo plano Plano Pro de Tzolkin\./); assert.match(texto, /Você recebeu este e-mail por causa da sua compra de Tzolkin/);
 assert.match(html, /<p style=/);
 assert.ok(!c.sql.some(q => /fetch|resend/i.test(q.texto)));
});

test('só sai e-mail quando a oferta manda o Core enviar E tem template para o evento', async () => {
 const provedor = clienteDeCobranca({ owner: 'provider' });
 assert.deepEqual(await processarEmailDeCobranca(provedor, extrairDoStripe(SESSAO())), { enfileirado: false, motivo: 'os e-mails desta oferta são do provedor' });
 assert.ok(!enfileirado(provedor));
 assert.ok(provedor.sql.some(q => q.texto.startsWith('INSERT INTO billing_purchases')), 'a compra é registrada mesmo assim (os eventos seguintes precisam dela)');
 const semRegra = clienteDeCobranca({ templates: { overdue: 'atraso' } });
 assert.match((await processarEmailDeCobranca(semRegra, extrairDoStripe(SESSAO()))).motivo, /não tem template para este evento/);
 const semModelo = clienteDeCobranca({ modelo: null });
 assert.match((await processarEmailDeCobranca(semModelo, extrairDoStripe(SESSAO()))).motivo, /template "pagamento-ok" não existe/);
 const semOferta = clienteDeCobranca({ ofertaSumiu: true });
 assert.match((await processarEmailDeCobranca(semOferta, extrairDoStripe(SESSAO()))).motivo, /oferta não encontrada/);
 const invalido = clienteDeCobranca({ modelo: { subject: 'Oi {{company_name}}', body: 'x' } });
 const r = await processarEmailDeCobranca(invalido, extrairDoStripe(SESSAO()));
 assert.equal(r.enfileirado, false); assert.match(r.motivo, /template "pagamento-ok" inválido.*\{\{company_name\}\} não existe neste tipo de e-mail/);
 assert.ok(!enfileirado(invalido), 'template ruim nunca vira e-mail quebrado');
});

test('pagamento assíncrono: a compra é registrada na hora, o e-mail só quando confirmar; reentrega não duplica', async () => {
 const pendente = clienteDeCobranca();
 const r1 = await processarEmailDeCobranca(pendente, extrairDoStripe(SESSAO({ payment_status: 'unpaid' })));
 assert.deepEqual([r1.enfileirado, /quando o pagamento for confirmado/.test(r1.motivo)], [false, true]);
 assert.ok(pendente.sql.some(q => q.texto.startsWith('INSERT INTO billing_purchases')) && !enfileirado(pendente));
 const dup = clienteDeCobranca({ jaNaFila: true });
 assert.deepEqual(await processarEmailDeCobranca(dup, extrairDoStripe(SESSAO())), { enfileirado: false, motivo: 'já estava na fila' });
});

test('renovação, falha, estorno e cancelamento acham a compra pelos ids do Stripe e usam o template de cada evento', async () => {
 const casos = [
  [{ type: 'invoice.paid', data: { object: { id: 'in_1', subscription: 'sub_1', billing_reason: 'subscription_cycle', amount_paid: 4900, currency: 'brl' } } }, 'renewal', 'renovacao', 'cobranca:stripe:renewal:in_1', 'sub_1'],
  [{ type: 'invoice.payment_failed', data: { object: { id: 'in_2', subscription: 'sub_1', amount_due: 4900, currency: 'brl', next_payment_attempt: Date.parse('2026-10-12T15:00:00Z') / 1000 } } }, 'overdue', 'atraso', 'cobranca:stripe:overdue:in_2', 'sub_1'],
  [{ type: 'charge.refunded', data: { object: { id: 'ch_1', payment_intent: 'pi_1', amount_refunded: 2000, currency: 'brl' } } }, 'refunded', 'estorno', 'cobranca:stripe:refunded:ch_1', null],
  [{ type: 'customer.subscription.deleted', data: { object: { id: 'sub_1' } } }, 'canceled', 'cancelado', 'cobranca:stripe:canceled:sub_1', 'sub_1'],
 ];
 for (const [corpo, evento, modelo, chave, sub] of casos) {
  const c = clienteDeCobranca({ modelo: { subject: `${evento} {{amount}} {{due_date}}`, body: 'Olá {{name}}' } });
  assert.equal((await processarEmailDeCobranca(c, extrairDoStripe(corpo))).enfileirado, true, evento);
  const busca = c.sql.find(q => q.texto.includes('FROM billing_purchases'));
  assert.deepEqual(busca.p, [null, sub, evento === 'refunded' ? 'pi_1' : null], `procura de ${evento}`);
  assert.ok(!c.sql.some(q => q.texto.startsWith('INSERT INTO billing_purchases')), 'evento seguinte não cria compra');
  const [k, , , m, ev, , , para, , assunto] = enfileirado(c).p;
  assert.deepEqual([k, m, ev, para], [chave, modelo, evento, 'maria@exemplo.com']);
  if (evento === 'overdue') assert.equal(assunto, 'overdue R$ 49,00 12/10/2026');
  if (evento === 'refunded') assert.equal(assunto, 'refunded R$ 20,00', 'estorno mostra o valor ESTORNADO, não o da compra');
 }
 const semCompra = clienteDeCobranca({ compra: 'nenhuma' });
 assert.deepEqual(await processarEmailDeCobranca(semCompra, extrairDoStripe(casos[3][0])), { enfileirado: false, motivo: 'compra não feita pelo checkout do Core' });
 assert.deepEqual(await processarEmailDeCobranca(clienteDeCobranca(), null), { enfileirado: false, motivo: 'evento sem relação com e-mail' });
});

// ---------- webhook ----------
const SEGREDO = 'whsec_teste-do-webhook-1234567890';
const assinar = corpo => { const t = Math.floor(Date.now() / 1000); return `t=${t},v1=${createHmac('sha256', SEGREDO).update(`${t}.${corpo}`).digest('hex')}`; };
function webhook({ falharEmail = null } = {}) {
 const rotas = {}, log = [];
 paymentWebhookRoutes({ get: () => {}, post: (p, h) => { rotas[p] = h; } }, { env: { STRIPE_WEBHOOK_SECRET: SEGREDO }, clock: Date.now });
 const q = async (texto, p = []) => {
  log.push(texto.trim().split(/\s+/).slice(0, 3).join(' '));
  if (texto.includes('INSERT INTO payment_webhook_events')) return { rowCount: 1, rows: [{ id: 1 }] };
  if (texto.includes('INSERT INTO payment_charges')) return { rowCount: 1, rows: [{ state_rank: 30 }] };
  if (texto.startsWith('INSERT INTO billing_purchases') && falharEmail) throw falharEmail;
  if (texto.includes('FROM billing_purchases')) return { rows: [{ product_id: 'sites', offer_slug: 'pro-mensal', customer_email: 'maria@exemplo.com', customer_name: 'Maria', amount_cents: '4900', currency: 'brl' }] };
  if (texto.includes('FROM billing_offers')) return { rows: [{ payload: { name: 'Plano Pro', email_owner: 'core', email_templates: { payment_confirmed: 'pagamento-ok' } } }] };
  if (texto.includes('FROM email_templates')) return { rows: [{ payload: MODELO }] };
  if (texto.includes('FROM products')) return { rows: [{ name: 'Tzolkin' }] };
  if (texto.startsWith('INSERT INTO email_outbox')) return { rows: [{ id: 'm' }] };
  return { rows: [], rowCount: 0 };
 };
 const pool = { async connect() { return { query: q, release() {} }; } };
 const chamar = async corpo => {
  const texto = JSON.stringify(corpo); let saida;
  const req = { headers: { 'stripe-signature': assinar(texto) }, async *[Symbol.asyncIterator]() { yield Buffer.from(texto); } };
  await rotas['/api/webhooks/stripe']({ req, url: new URL('http://x.test/api/webhooks/stripe'), pool, reply: (s, c) => { saida = { s, c }; } });
  return saida;
 };
 return { chamar, log };
}

test('webhook do Stripe: o e-mail é enfileirado DENTRO da transação (entre BEGIN e COMMIT) e a resposta segue 200', async () => {
 const w = webhook();
 const r = await w.chamar(SESSAO());
 assert.equal(r.s, 200);
 const i = n => w.log.findIndex(l => l.startsWith(n));
 assert.ok(i('BEGIN') < i('INSERT INTO email_outbox') && i('INSERT INTO email_outbox') < i('COMMIT'), 'enfileira antes de confirmar: ou tudo ou nada');
 assert.ok(w.log.includes('SAVEPOINT email_cobranca') && w.log.includes('RELEASE SAVEPOINT email_cobranca'));
});

test('webhook do Stripe: falha no gancho de e-mail NUNCA impede o registro do webhook (o provedor reentregaria sem fim)', async () => {
 const silencio = console.error; const erros = []; console.error = (...a) => erros.push(a.join(' '));
 try {
  const quebra = webhook({ falharEmail: new Error('disco cheio') });
  const r = await quebra.chamar(SESSAO());
  assert.equal(r.s, 200); assert.ok(quebra.log.includes('COMMIT') && !quebra.log.includes('ROLLBACK'), 'a transação do webhook segue e confirma');
  assert.ok(quebra.log.includes('ROLLBACK TO SAVEPOINT'), 'só o gancho é desfeito');
  assert.ok(erros.some(e => e.includes('[email-cobranca] falhou: disco cheio')));
  erros.length = 0;
  const semTabela = webhook({ falharEmail: Object.assign(new Error('relation does not exist'), { code: '42P01' }) });
  assert.equal((await semTabela.chamar(SESSAO())).s, 200);
  assert.equal(erros.length, 0, 'migração 052 ausente: ignora em silêncio');
 } finally { console.error = silencio; }
});

test('webhook do Stripe: evento sem relação com e-mail não toca em nada de e-mail', async () => {
 const w = webhook();
 const r = await w.chamar({ id: 'evt_9', type: 'invoice.finalized', data: { object: { id: 'in_3', amount_paid: 0, currency: 'brl' } } });
 assert.equal(r.s, 200);
 assert.ok(!w.log.some(l => l.startsWith('INSERT INTO billing') || l.startsWith('INSERT INTO email_outbox')));
});

// ---------- checkout, pré-visualização, migração ----------
test('o checkout grava produto e oferta na sessão do Stripe (é o que liga a cobrança à oferta)', async () => {
 let corpoEnviado;
 const adapter = createStripeCheckoutAdapter({ secretKey: 'sk_test_x', fetchImpl: async (url, o) => { corpoEnviado = new URLSearchParams(o.body); return { ok: true, json: async () => ({ id: 'cs_1', url: 'https://x' }) }; } });
 await adapter.createSession({ uiMode: 'hosted', mode: 'payment', lineItem: { name: 'Oferta', amountMinor: 4900, currency: 'brl' }, successUrl: 'https://s', cancelUrl: 'https://c', metadata: { product_id: 'sites', offer_slug: 'pro-mensal' } });
 assert.equal(corpoEnviado.get('metadata[product_id]'), 'sites'); assert.equal(corpoEnviado.get('metadata[offer_slug]'), 'pro-mensal');
 await adapter.createSession({ uiMode: 'hosted', mode: 'payment', lineItem: { name: 'Oferta', amountMinor: 4900, currency: 'brl' }, successUrl: 'https://s', cancelUrl: 'https://c' });
 assert.ok(![...corpoEnviado.keys()].some(k => k.startsWith('metadata')), 'sem metadata, nada é inventado');
 const gateway = readFileSync(new URL('../../apps/api/src/modules/checkout-gateway.mjs', import.meta.url), 'utf8');
 assert.match(gateway, /metadata:\s*\{\s*product_id:\s*productId,\s*offer_slug:\s*offerSlug\s*\}/, 'o gateway passa só ids, nada pessoal');
});

test('pré-visualização de template de cobrança usa as variáveis de cobrança, e lead segue com as de lead', async () => {
 const rotas = {};
 emailFilaRoutes({ get: () => {}, post: (p, h) => { rotas[p] = h; } }, { env: {}, clock: Date.now });
 const pool = modelo => ({ query: async sql => (sql.includes('FROM products') ? { rows: [{ name: 'Tzolkin' }] } : { rows: [{ payload: modelo }] }) });
 const corpo = b => ({ headers: { 'content-type': 'application/json' }, async *[Symbol.asyncIterator]() { yield Buffer.from(JSON.stringify(b)); } });
 const ver = async modelo => { let s; await rotas['/api/emails/preview']({ pool: pool(modelo), req: corpo({ product_id: 'sites', slug: 'modelo-x' }), reply: (st, c) => { s = c; } }); return s; };
 const c = await ver({ event: 'payment_confirmed', subject: 'Recebemos {{amount}} do plano {{plan}}', body: 'Vence {{due_date}}' });
 assert.equal(c.assunto, 'Recebemos R$ 49,00 do plano Plano Pro'); assert.deepEqual(c.variaveis, ['name', 'email', 'product_name', 'plan', 'amount', 'due_date']);
 await assert.rejects(ver({ event: 'welcome', subject: 'Plano {{plan}}', body: 'x' }), e => e.status === 400 && /\{\{plan\}\}/.test(e.message));
 const lead = await ver({ event: 'welcome', subject: 'Oi {{name}}', body: 'x' });
 assert.deepEqual(lead.variaveis, ['name', 'email', 'product_name', 'company_name']);
});

test('migração 052: só adiciona; compra única por sessão; oferta com chave composta; e-mail em minúsculas', () => {
 const sql = readFileSync(new URL('../../db/migrations/052_compras_do_checkout.sql', import.meta.url), 'utf8').replace(/--.*$/gm, '');
 assert.ok(!/\bDROP\b|\bDELETE\b|\bTRUNCATE\b|ALTER TABLE payment_charges/i.test(sql));
 assert.match(sql, /UNIQUE \(provider, session_id\)/); assert.match(sql, /FOREIGN KEY \(product_id, offer_slug\) REFERENCES billing_offers \(product_id, slug\)/);
 assert.match(sql, /customer_email = lower\(customer_email\)/);
 const web = readFileSync(new URL('../../apps/api/src/modules/payment-webhooks.mjs', import.meta.url), 'utf8');
 assert.match(web, /registrar\(pool, evento, corpoJson\)/); assert.match(web, /SAVEPOINT email_cobranca/);
});
