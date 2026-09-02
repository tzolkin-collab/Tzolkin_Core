// Verificação e normalização de webhooks de pagamento.
//
// Este módulo NÃO fala com provedor nenhum: ele só decide se um corpo cru é
// autêntico e o traduz para o vocabulário do Core. Nenhuma chamada de rede,
// o que o torna inteiramente testável sem stub.
//
// Ver docs/BILLING.md e docs/INTEGRATIONS.md
import { createHmac, timingSafeEqual } from 'node:crypto';

const TOLERANCIA_MS = 300000; // 5 min — mesma janela padrão das bibliotecas da Stripe.
export const CORPO_MAXIMO = 262144; // 256 KB

// Comparação em tempo constante, tolerante a tamanhos diferentes.
function iguais(a, b) {
 const x = Buffer.from(String(a)); const y = Buffer.from(String(b));
 // timingSafeEqual exige mesmo tamanho; comparar o tamanho antes vazaria isso.
 // Compara-se um digest de tamanho fixo dos dois lados.
 const dx = createHmac('sha256', 'cmp').update(x).digest();
 const dy = createHmac('sha256', 'cmp').update(y).digest();
 return timingSafeEqual(dx, dy);
}

/**
 * Stripe: header `Stripe-Signature` com `t=<unix>,v1=<hmac>`.
 * O HMAC é sobre `${t}.${corpo cru}` — reserializar o JSON invalida a assinatura.
 */
export function verifyStripe({ header, rawBody, secret, now = Date.now() }) {
 if (!secret) return { ok: false, reason: 'sem_segredo' };
 if (typeof header !== 'string' || !header) return { ok: false, reason: 'sem_assinatura' };
 const partes = Object.create(null);
 for (const par of header.split(',')) {
  const i = par.indexOf('=');
  if (i < 1) continue;
  const chave = par.slice(0, i).trim();
  // Só a primeira ocorrência vale: repetir `t` não pode sobrescrever.
  if (!(chave in partes)) partes[chave] = par.slice(i + 1).trim();
 }
 const t = partes.t;
 if (!/^\d{1,15}$/.test(t || '')) return { ok: false, reason: 'timestamp_invalido' };
 // Rejeitar fora da janela impede reenvio de uma captura antiga.
 if (Math.abs(now - Number(t) * 1000) > TOLERANCIA_MS) return { ok: false, reason: 'fora_da_janela' };
 // Esquemas que não sejam v1 são ignorados de propósito.
 if (!partes.v1) return { ok: false, reason: 'sem_v1' };
 const esperado = createHmac('sha256', secret).update(`${t}.${rawBody}`).digest('hex');
 return iguais(esperado, partes.v1) ? { ok: true } : { ok: false, reason: 'assinatura_invalida' };
}

/**
 * Asaas: token fixo no header `asaas-access-token`.
 * Mais fraco que a assinatura da Stripe — não tem timestamp, então não protege
 * contra reenvio. Vale enquanto não vazar; por isso fica no .env como credencial.
 */
export function verifyAsaas({ header, token }) {
 if (!token) return { ok: false, reason: 'sem_segredo' };
 if (typeof header !== 'string' || !header) return { ok: false, reason: 'sem_token' };
 return iguais(header, token) ? { ok: true } : { ok: false, reason: 'token_invalido' };
}

// ── Vocabulário do Core ───────────────────────────────────────────────────
// A régua do progresso. Só avança: ver o comentário da migração 011.
export const RANKS = { created: 10, open: 20, confirmed: 30, received: 40 };

// Fatos que convivem com o progresso em vez de substituí-lo.
const MARCA = { overdue: 'overdue_at', refunded: 'refunded_at', disputed: 'disputed_at', canceled: 'canceled_at' };

const STRIPE = {
 'checkout.session.completed': { state: 'confirmed' },
 'checkout.session.async_payment_succeeded': { state: 'received' },
 'checkout.session.async_payment_failed': { mark: 'canceled' },
 'checkout.session.expired': { mark: 'canceled' },
 'invoice.finalized': { state: 'open' },
 'invoice.paid': { state: 'received' },
 'invoice.payment_failed': { mark: 'overdue' },
 'invoice.payment_action_required': { mark: 'overdue' },
 'invoice.finalization_failed': { mark: 'canceled' },
 'invoice.marked_uncollectible': { mark: 'canceled' },
 'invoice.voided': { mark: 'canceled' },
 'charge.refunded': { mark: 'refunded' },
 'charge.dispute.created': { mark: 'disputed' },
 'customer.subscription.updated': {},
 'customer.subscription.deleted': {},
};

const ASAAS = {
 PAYMENT_CREATED: { state: 'open' },
 PAYMENT_UPDATED: {},
 // CONFIRMED e RECEIVED são diferentes de propósito: pago não é disponível.
 PAYMENT_CONFIRMED: { state: 'confirmed' },
 PAYMENT_RECEIVED: { state: 'received' },
 PAYMENT_OVERDUE: { mark: 'overdue' },
 PAYMENT_DELETED: { mark: 'canceled' },
 PAYMENT_RESTORED: {},
 PAYMENT_REFUNDED: { mark: 'refunded' },
 PAYMENT_PARTIALLY_REFUNDED: { mark: 'refunded' },
 PAYMENT_CHARGEBACK_REQUESTED: { mark: 'disputed' },
 PAYMENT_RECEIVED_IN_CASH_UNDONE: {},
};

const texto = (v, max = 200) => (typeof v === 'string' && v && v.length <= max ? v : null);
const inteiro = v => (Number.isSafeInteger(v) && v >= 0 ? v : null);
const moeda = v => (typeof v === 'string' && /^[a-zA-Z]{3}$/.test(v) ? v.toLowerCase() : null);

/**
 * Traduz o corpo do provedor para o vocabulário do Core.
 * Devolve `handled:false` para evento fora da lista — que ainda assim é
 * registrado e respondido com 2xx, para não derrubar a fila.
 */
export function normalize(provider, body) {
 if (!body || typeof body !== 'object' || Array.isArray(body)) return null;

 if (provider === 'stripe') {
  const id = texto(body.id); const tipo = texto(body.type, 120);
  if (!id || !tipo) return null;
  const objeto = body.data?.object || {};
  const regra = STRIPE[tipo];
  return {
   provider, event_id: id, event_type: tipo,
   charge_ref: texto(objeto.id),
   state: regra?.state ?? null, mark: regra?.mark ?? null, handled: Boolean(regra),
   amount_cents: inteiro(objeto.amount_paid ?? objeto.amount_total ?? objeto.amount),
   currency: moeda(objeto.currency),
  };
 }

 if (provider === 'asaas') {
  const id = texto(body.id); const tipo = texto(body.event, 120);
  if (!id || !tipo) return null;
  const pagamento = body.payment || {};
  const regra = ASAAS[tipo];
  return {
   provider, event_id: id, event_type: tipo,
   charge_ref: texto(pagamento.id),
   state: regra?.state ?? null, mark: regra?.mark ?? null, handled: Boolean(regra),
   // O Asaas manda reais como número decimal; o Core guarda centavos inteiros.
   amount_cents: typeof pagamento.value === 'number' && pagamento.value >= 0
    ? Math.round(pagamento.value * 100) : null,
   currency: 'brl',
  };
 }
 return null;
}

export const _internals = { iguais, MARCA, TOLERANCIA_MS };
