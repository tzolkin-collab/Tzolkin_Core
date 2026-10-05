// E-mail de cobrança: do evento do Stripe até uma linha na fila de e-mail (email_outbox). Nada aqui envia: o consumidor da fila envia.
//
// COMO O EVENTO VIRA E-MAIL
//  1. O checkout do Core grava na sessão do Stripe o produto e a oferta (metadata).
//  2. `checkout.session.completed` traz o comprador e a metadata: vira UMA linha em `billing_purchases` e, se já está pago,
//     o e-mail "payment_confirmed". Pagamento assíncrono (`unpaid`) só gera o e-mail em `async_payment_succeeded`.
//  3. Os eventos seguintes chegam só com ids do Stripe. Acha-se a compra por esses ids:
//       invoice.paid (ciclo da assinatura)  -> renewal          (por assinatura)
//       invoice.payment_failed              -> overdue          (por assinatura)
//       charge.refunded                     -> refunded         (por intenção de pagamento)
//       customer.subscription.deleted       -> canceled         (por assinatura)
//  4. Só envia quem a oferta manda enviar: `email_owner = 'core'` E template definido para aquele evento. Se o responsável é o
//     provedor (o Stripe manda o dele), nada é enfileirado: sem duplicidade.
//  5. A chave de idempotência é por evento e objeto: o mesmo evento reentregue não vira dois e-mails.
//
// NÃO AUTOMATIZADOS (e por quê): `charge_created` e `due_reminder` (exigem avisar ANTES do vencimento: precisa de agendador) e
// `welcome` (é e-mail de lead, em outra automação). Compra fora do checkout do Core não tem metadata: não há como saber a oferta.
import { renderizar, ErroDeModelo, VARIAVEIS_DE_COBRANCA, rodapeDeCobranca } from './email-modelo.mjs';
import { enfileirar } from './email-saida.mjs';
import { enderecoValido } from './email.mjs';
import { isProductId } from './http.mjs';

const texto = (v, max = 255) => (typeof v === 'string' && v && v.length <= max ? v : null);
const inteiro = v => (Number.isSafeInteger(v) && v >= 0 ? v : null);
const moeda = v => (typeof v === 'string' && /^[a-zA-Z]{3}$/.test(v) ? v.toLowerCase() : null);
const idDe = v => (typeof v === 'string' ? texto(v) : texto(v?.id));   // o Stripe manda o id ou o objeto expandido

/** 4900 + "brl" -> "R$ 49,00". Moeda estranha cai num formato simples, sem lançar. */
export function formatarValor(centavos, codigo) {
 if (!Number.isSafeInteger(centavos) || centavos < 0) return '';
 const c = String(codigo || 'brl').toUpperCase();
 try { return new Intl.NumberFormat('pt-BR', { style: 'currency', currency: c }).format(centavos / 100).replace(/ /g, ' '); }
 catch { return `${(centavos / 100).toFixed(2).replace('.', ',')} ${c}`; }
}
const dataBr = unix => (Number.isSafeInteger(unix) && unix > 0 ? new Date(unix * 1000).toLocaleDateString('pt-BR', { timeZone: 'America/Sao_Paulo' }) : '');

/**
 * Lê o corpo (já autenticado) de um evento do Stripe e diz o que ele significa para e-mail. Devolve null se não é com a gente.
 * Função pura. { evento, chave, procura: {session?, subscription?, payment_intent?}, compra?, valores: {amount_cents, currency, due_date} }
 */
export function extrairDoStripe(corpo) {
 const tipo = corpo?.type, o = corpo?.data?.object;
 if (!tipo || !o || typeof o !== 'object') return null;

 if (tipo === 'checkout.session.completed' || tipo === 'checkout.session.async_payment_succeeded') {
  const session = texto(o.id); if (!session) return null;
  const produto = o.metadata?.product_id, oferta = o.metadata?.offer_slug;
  if (!isProductId(produto) || !isProductId(oferta)) return null;           // sessão que não é do checkout do Core
  const email = String(o.customer_details?.email ?? o.customer_email ?? '').trim().toLowerCase();
  if (!enderecoValido(email)) return null;                                  // sem e-mail não há a quem escrever (nem registro de compra)
  const pago = ['paid', 'no_payment_required'].includes(o.payment_status);
  return {
   evento: pago ? 'payment_confirmed' : null, chave: session, procura: { session },
   compra: { session, payment_intent: idDe(o.payment_intent), subscription: idDe(o.subscription), customer: idDe(o.customer), email, name: texto(o.customer_details?.name, 160), product_id: produto, offer_slug: oferta, amount_cents: inteiro(o.amount_total), currency: moeda(o.currency) },
   valores: { amount_cents: inteiro(o.amount_total), currency: moeda(o.currency), due_date: '' },
  };
 }
 const assinatura = idDe(o.subscription) ?? idDe(o.parent?.subscription_details?.subscription);   // versões novas da API movem o campo
 if (tipo === 'invoice.paid') {
  if (o.billing_reason !== 'subscription_cycle' || !assinatura || !texto(o.id)) return null;     // a 1ª fatura é a própria compra
  return { evento: 'renewal', chave: o.id, procura: { subscription: assinatura }, valores: { amount_cents: inteiro(o.amount_paid), currency: moeda(o.currency), due_date: '' } };
 }
 if (tipo === 'invoice.payment_failed') {
  if (!assinatura || !texto(o.id)) return null;
  return { evento: 'overdue', chave: o.id, procura: { subscription: assinatura }, valores: { amount_cents: inteiro(o.amount_due), currency: moeda(o.currency), due_date: dataBr(o.next_payment_attempt) } };
 }
 if (tipo === 'charge.refunded') {
  const pi = idDe(o.payment_intent); if (!pi || !texto(o.id)) return null;
  return { evento: 'refunded', chave: o.id, procura: { payment_intent: pi }, valores: { amount_cents: inteiro(o.amount_refunded), currency: moeda(o.currency), due_date: '' } };
 }
 if (tipo === 'customer.subscription.deleted') {
  const sub = texto(o.id); if (!sub) return null;
  return { evento: 'canceled', chave: sub, procura: { subscription: sub }, valores: { amount_cents: null, currency: null, due_date: '' } };
 }
 return null;
}

/**
 * Aplica a intenção no banco, DENTRO da transação do webhook: registra a compra e/ou enfileira o e-mail.
 * Nunca lança por falta de regra (devolve o motivo). Erro de banco sobe para quem chama decidir (o webhook o engole num savepoint).
 * @returns {Promise<{enfileirado:boolean, motivo?:string}>}
 */
export async function processarEmailDeCobranca(client, intencao) {
 if (!intencao) return { enfileirado: false, motivo: 'evento sem relação com e-mail' };
 const c = intencao.compra;
 if (c) {
  await client.query(
   `INSERT INTO billing_purchases(provider,session_id,payment_intent_id,subscription_id,customer_id,product_id,offer_slug,customer_email,customer_name,amount_cents,currency)
    VALUES('stripe',$1,$2,$3,$4,$5,$6,$7,$8,$9,$10) ON CONFLICT (provider,session_id) DO NOTHING`,
   [c.session, c.payment_intent, c.subscription, c.customer, c.product_id, c.offer_slug, c.email, c.name, c.amount_cents, c.currency]);
 }
 if (!intencao.evento) return { enfileirado: false, motivo: 'ainda não pago: o e-mail sai quando o pagamento for confirmado' };

 const { session, subscription, payment_intent: pi } = intencao.procura;
 const compra = (await client.query(
  `SELECT product_id,offer_slug,customer_email,customer_name,amount_cents,currency FROM billing_purchases
    WHERE provider='stripe' AND (session_id=$1 OR subscription_id=$2 OR payment_intent_id=$3) ORDER BY id LIMIT 1`, [session ?? null, subscription ?? null, pi ?? null])).rows[0];
 if (!compra) return { enfileirado: false, motivo: 'compra não feita pelo checkout do Core' };

 const oferta = (await client.query('SELECT payload FROM billing_offers WHERE product_id=$1 AND slug=$2', [compra.product_id, compra.offer_slug])).rows[0]?.payload;
 if (!oferta) return { enfileirado: false, motivo: 'oferta não encontrada' };
 if (oferta.email_owner !== 'core') return { enfileirado: false, motivo: 'os e-mails desta oferta são do provedor' };
 const slug = oferta.email_templates?.[intencao.evento];
 if (!slug) return { enfileirado: false, motivo: 'a oferta não tem template para este evento' };

 const modelo = (await client.query('SELECT payload FROM email_templates WHERE product_id=$1 AND slug=$2', [compra.product_id, slug])).rows[0]?.payload;
 if (!modelo) return { enfileirado: false, motivo: `o template "${slug}" não existe` };
 const produto = (await client.query('SELECT name FROM products WHERE id=$1', [compra.product_id])).rows[0]?.name ?? '';

 const centavos = intencao.valores.amount_cents ?? (compra.amount_cents == null ? null : Number(compra.amount_cents));
 let r;
 try {
  r = renderizar(modelo, {
   name: compra.customer_name || '', email: compra.customer_email, product_name: produto, plan: oferta.name || '',
   amount: formatarValor(centavos, intencao.valores.currency || compra.currency), due_date: intencao.valores.due_date || '',
  }, { permitidas: VARIAVEIS_DE_COBRANCA, rodape: rodapeDeCobranca(produto) });
 } catch (e) {
  if (e instanceof ErroDeModelo) return { enfileirado: false, motivo: `template "${slug}" inválido: ${e.message}` };
  throw e;
 }
 const g = await enfileirar(client, {
  chave: `cobranca:stripe:${intencao.evento}:${intencao.chave}`, tipo: 'automacao', produto: compra.product_id, modelo: slug, evento: intencao.evento,
  para: compra.customer_email, nome: compra.customer_name, assunto: r.assunto, texto: r.texto, html: r.html, por: 'cobranca',
 });
 return g.criado ? { enfileirado: true } : { enfileirado: false, motivo: 'já estava na fila' };
}
