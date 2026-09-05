// Aritmética de cobrança e disponibilidade de método. Puro: sem rede, sem banco.
//
// Todo dinheiro aqui é inteiro em centavos, do começo ao fim. Não existe float
// em nenhum ponto — meio centavo não existe e arredondar duas vezes é como se
// perde um centavo entre a soma das parcelas e o total.
//
// O vocabulário de estado é o mesmo de integrations/payment-webhooks.mjs, de
// propósito: um segundo vocabulário divergiria do webhook em três meses.
import { fail } from './http.mjs';
import { METHODS } from './checkout-model.mjs';

export const RANKS = { created: 10, open: 20, confirmed: 30, received: 40 };

// O que cada provedor realmente faz, e em que moeda.
//   - wallet (Apple/Google Pay) não é um meio próprio na Stripe: anda sobre
//     `card`. Fica na lista porque é um interruptor de exibição no editor.
//   - o Asaas é BRL e só BRL, o que billing.mjs já impõe na oferta.
const SUPPORT = {
 stripe: { card: null, wallet: null, pix: ['brl'], boleto: ['brl'] },
 asaas:  { card: ['brl'], pix: ['brl'], boleto: ['brl'] },
};

export function methodAvailable(provider, method, currency) {
 const moedas = SUPPORT[provider]?.[method];
 if (moedas === undefined) return false;
 return moedas === null || moedas.includes(String(currency).toLowerCase());
}

export const availableMethods = (provider, currency) =>
 METHODS.filter(method => methodAvailable(provider, method, currency));

// Recusa no momento de salvar, não na hora de pagar: o operador descobre o erro
// enquanto edita, e não pelo comprador que não conseguiu concluir.
export function assertMethods(provider, currency, methods) {
 const invalido = methods.find(method => !methodAvailable(provider, method, currency));
 if (invalido) throw fail(400, `${invalido} não está disponível para ${provider} em ${String(currency).toUpperCase()}.`);
 return methods;
}

// Preço nunca vem do cliente: `offer` e `bumps` são linhas do banco, `coupon`
// é a linha resgatada no servidor. Esta função só soma o que já foi confiado.
export function computeTotal({ offer, bumps = [], coupon = null }) {
 if (!Number.isInteger(offer?.amount_minor) || offer.amount_minor < 0) throw fail(400, 'Oferta sem valor válido.');
 const currency = String(offer.currency).toLowerCase();
 for (const bump of bumps) {
  if (!Number.isInteger(bump?.amount_minor) || bump.amount_minor < 0) throw fail(400, 'Order bump sem valor válido.');
  if (String(bump.currency).toLowerCase() !== currency) throw fail(400, 'Order bump em moeda diferente da oferta.');
 }
 const base_amount_minor = offer.amount_minor;
 const bump_amount_minor = bumps.reduce((soma, bump) => soma + bump.amount_minor, 0);
 const bruto = base_amount_minor + bump_amount_minor;

 let discount_minor = 0;
 if (coupon) {
  if (coupon.kind === 'percent') discount_minor = Math.floor((bruto * coupon.percent_off) / 100);
  else {
   if (String(coupon.currency).toLowerCase() !== currency) throw fail(400, 'Cupom em moeda diferente da oferta.');
   discount_minor = coupon.amount_off_minor;
  }
  // Piso em zero. Um cupom maior que a compra zera a conta; nunca gera crédito,
  // nunca vira negativo — a constraint da 023 também recusaria.
  if (discount_minor > bruto) discount_minor = bruto;
 }
 return { currency, base_amount_minor, bump_amount_minor, discount_minor, total_amount_minor: bruto - discount_minor };
}

// SÓ PARA O ASAAS. Na Stripe os planos de parcelamento vêm dela, no próprio
// PaymentIntent, e o Payment Element os renderiza — calcular aqui produziria uma
// segunda tabela de parcelas que discordaria da que o comprador vê. A assimetria
// é deliberada: não "unifique" as duas.
export function installmentOptions({ total_minor, max = 12, min_installment_minor = 500 }) {
 if (!Number.isInteger(total_minor) || total_minor <= 0) throw fail(400, 'Total inválido para parcelamento.');
 if (!Number.isInteger(max) || max < 1 || max > 21) throw fail(400, 'Número de parcelas fora do intervalo.');
 const opcoes = [];
 for (let n = 1; n <= max; n++) {
  const parcela = Math.floor(total_minor / n);
  if (n > 1 && parcela < min_installment_minor) break;
  // O resto vai na primeira parcela. É o que faz Σ parcelas === total, sempre.
  const resto = total_minor - parcela * n;
  opcoes.push({ installments: n, first_minor: parcela + resto, rest_minor: parcela, total_minor });
 }
 return opcoes;
}

export const installmentSum = ({ installments, first_minor, rest_minor }) => first_minor + rest_minor * (installments - 1);
