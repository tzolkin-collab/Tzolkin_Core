import test from 'node:test';
import assert from 'node:assert/strict';
import {
 methodAvailable, availableMethods, assertMethods,
 computeTotal, installmentOptions, installmentSum, RANKS,
} from '../../apps/api/src/platform/payment-model.mjs';

const erro = (fn, status, trecho) => {
 try { fn(); assert.fail('deveria ter lançado'); }
 catch (error) { assert.equal(error.status, status); if (trecho) assert.match(error.message, trecho); }
};
const oferta = (amount_minor, currency = 'brl') => ({ amount_minor, currency });

test('disponibilidade de método respeita provedor e moeda', () => {
 assert.equal(methodAvailable('stripe', 'card', 'usd'), true);
 assert.equal(methodAvailable('stripe', 'card', 'brl'), true);
 // Pix e boleto na Stripe são BRL. Prometer em dólar no editor seria mentira
 // que o comprador descobre no fim do funil.
 assert.equal(methodAvailable('stripe', 'pix', 'usd'), false);
 assert.equal(methodAvailable('stripe', 'pix', 'brl'), true);
 assert.equal(methodAvailable('stripe', 'boleto', 'usd'), false);
 // O Asaas é BRL e só BRL, o que billing.mjs já impõe na oferta.
 assert.equal(methodAvailable('asaas', 'card', 'usd'), false);
 assert.equal(methodAvailable('asaas', 'pix', 'brl'), true);
 // Carteira anda sobre cartão na Stripe; no Asaas não existe.
 assert.equal(methodAvailable('asaas', 'wallet', 'brl'), false);
 assert.equal(methodAvailable('stripe', 'wallet', 'brl'), true);
 assert.equal(methodAvailable('paypal', 'card', 'brl'), false);

 assert.deepEqual(availableMethods('stripe', 'usd'), ['card', 'wallet']);
 assert.deepEqual(availableMethods('asaas', 'brl'), ['card', 'pix', 'boleto']);
});

test('método impossível é recusado ao salvar, nomeando o culpado', () => {
 assert.deepEqual(assertMethods('stripe', 'brl', ['card', 'pix']), ['card', 'pix']);
 erro(() => assertMethods('stripe', 'usd', ['card', 'pix']), 400, /pix não está disponível para stripe em USD/);
 erro(() => assertMethods('asaas', 'brl', ['wallet']), 400, /wallet/);
});

test('total soma bumps e aplica cupom em aritmética inteira', () => {
 assert.deepEqual(computeTotal({ offer: oferta(19900) }), {
  currency: 'brl', base_amount_minor: 19900, bump_amount_minor: 0, discount_minor: 0, total_amount_minor: 19900,
 });
 const comBumps = computeTotal({ offer: oferta(19900), bumps: [oferta(4900), oferta(1000)] });
 assert.equal(comBumps.bump_amount_minor, 5900);
 assert.equal(comBumps.total_amount_minor, 25800);

 // Percentual incide sobre oferta + bumps, e trunca para baixo: nunca cobra
 // meio centavo nem arredonda a favor da casa.
 const percentual = computeTotal({ offer: oferta(19999), coupon: { kind: 'percent', percent_off: 10 } });
 assert.equal(percentual.discount_minor, 1999);
 assert.equal(percentual.total_amount_minor, 18000);
 assert.ok(Number.isInteger(percentual.total_amount_minor));

 const fixo = computeTotal({ offer: oferta(19900), coupon: { kind: 'fixed', amount_off_minor: 5000, currency: 'brl' } });
 assert.equal(fixo.total_amount_minor, 14900);
});

test('cupom maior que a compra zera e nunca vira crédito', () => {
 const zerado = computeTotal({ offer: oferta(5000), coupon: { kind: 'fixed', amount_off_minor: 9900, currency: 'brl' } });
 assert.equal(zerado.discount_minor, 5000, 'o desconto é aparado no bruto');
 assert.equal(zerado.total_amount_minor, 0);
 assert.equal(computeTotal({ offer: oferta(5000), coupon: { kind: 'percent', percent_off: 100 } }).total_amount_minor, 0);
});

test('moeda divergente é recusada em vez de somada', () => {
 erro(() => computeTotal({ offer: oferta(19900, 'brl'), bumps: [oferta(4900, 'usd')] }), 400, /moeda diferente/);
 erro(() => computeTotal({ offer: oferta(19900, 'brl'), coupon: { kind: 'fixed', amount_off_minor: 100, currency: 'usd' } }), 400, /moeda diferente/);
 erro(() => computeTotal({ offer: { amount_minor: 199.9, currency: 'brl' } }), 400, /sem valor válido/);
});

test('a soma das parcelas fecha exatamente com o total, em qualquer valor', () => {
 // O centavo perdido: 100,00 em 3x é 33,33 + 33,33 + 33,34, não 3 × 33,33.
 const tres = installmentOptions({ total_minor: 10000, max: 3 }).find(o => o.installments === 3);
 assert.deepEqual(tres, { installments: 3, first_minor: 3334, rest_minor: 3333, total_minor: 10000 });

 for (const total of [1, 999, 10000, 10001, 19999, 123457, 999999]) {
  for (const opcao of installmentOptions({ total_minor: total, max: 12 })) {
   assert.equal(installmentSum(opcao), total, `${total} em ${opcao.installments}x não fecha`);
   assert.ok(Number.isInteger(opcao.first_minor) && Number.isInteger(opcao.rest_minor));
  }
 }
});

test('parcelamento para quando a parcela fica pequena demais', () => {
 // 10,00 com piso de 5,00 só admite 1x e 2x.
 assert.deepEqual(installmentOptions({ total_minor: 1000, max: 12 }).map(o => o.installments), [1, 2]);
 assert.deepEqual(installmentOptions({ total_minor: 100, max: 12 }).map(o => o.installments), [1]);
 erro(() => installmentOptions({ total_minor: 0 }), 400, /Total inválido/);
 erro(() => installmentOptions({ total_minor: 10000, max: 22 }), 400, /fora do intervalo/);
});

test('a régua de estado é a mesma do webhook', () => {
 // Divergir daqui significaria a tela do pedido e a da cobrança contando
 // histórias diferentes sobre o mesmo dinheiro.
 assert.deepEqual(RANKS, { created: 10, open: 20, confirmed: 30, received: 40 });
});
