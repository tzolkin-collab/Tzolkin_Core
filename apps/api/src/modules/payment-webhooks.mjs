// Recebimento de webhooks de pagamento.
//
// Estas são as ÚNICAS rotas do Core alcançáveis sem sessão e sem header Origin —
// tem que ser, senão o provedor não chega. Em troca, cada uma prova a origem
// pelo mecanismo do próprio provedor antes de qualquer efeito.
//
// O que estas rotas fazem: registram. Só isso. Não emitem cobrança, não alteram
// contrato, não escrevem no Notion, não mandam e-mail.
//
// Ver docs/BILLING.md#5-requisitos-inegociáveis-para-qualquer-implementação-decidido
import { fail, onlyParams } from '../platform/http.mjs';
import { verifyStripe, verifyAsaas, normalize, RANKS, CORPO_MAXIMO } from '../integrations/payment-webhooks.mjs';

// Corpo CRU: a assinatura da Stripe é sobre os bytes recebidos.
// Reserializar o JSON muda espaços e ordem, e invalida a verificação.
async function rawBody(req) {
 const partes = []; let bytes = 0;
 for await (const parte of req) {
  bytes += parte.length;
  if (bytes > CORPO_MAXIMO) throw fail(413, 'Requisição muito grande.');
  partes.push(parte);
 }
 return Buffer.concat(partes).toString('utf8');
}

const MARCAS = { overdue: 'overdue_at', refunded: 'refunded_at', disputed: 'disputed_at', canceled: 'canceled_at' };

/**
 * Grava o evento e concilia o estado da cobrança, numa transação só.
 * Devolve o desfecho para o histórico — nunca lança por evento desconhecido.
 */
async function registrar(pool, evento) {
 const client = await pool.connect();
 try {
  await client.query('BEGIN');

  // Deduplicação: os dois provedores entregam "pelo menos uma vez".
  // O UNIQUE(provider,event_id) é quem decide, não uma consulta prévia —
  // consulta prévia teria corrida entre duas entregas simultâneas.
  const inserido = await client.query(
   `INSERT INTO payment_webhook_events(provider,event_id,event_type,charge_ref,outcome,detail)
    VALUES($1,$2,$3,$4,'unhandled','{}'::jsonb)
    ON CONFLICT (provider,event_id) DO NOTHING RETURNING id`,
   [evento.provider, evento.event_id, evento.event_type, evento.charge_ref]);
  if (!inserido.rowCount) { await client.query('COMMIT'); return 'duplicate'; }

  let desfecho = evento.handled ? 'applied' : 'unhandled';

  if (evento.handled && evento.charge_ref && evento.state) {
   const rank = RANKS[evento.state];
   // O progresso só avança. Com fila NON_SEQUENTIALLY, um CONFIRMED atrasado
   // chegando depois do RECEIVED não pode rebaixar o estado.
   const upsert = await client.query(
    `INSERT INTO payment_charges(provider,charge_ref,state,state_rank,amount_cents,currency)
     VALUES($1,$2,$3,$4,$5,$6)
     ON CONFLICT (provider,charge_ref) DO UPDATE SET
       state = CASE WHEN EXCLUDED.state_rank > payment_charges.state_rank
                    THEN EXCLUDED.state ELSE payment_charges.state END,
       state_rank = GREATEST(payment_charges.state_rank, EXCLUDED.state_rank),
       amount_cents = COALESCE(EXCLUDED.amount_cents, payment_charges.amount_cents),
       currency = COALESCE(EXCLUDED.currency, payment_charges.currency),
       updated_at = now()
     RETURNING state_rank`,
    [evento.provider, evento.charge_ref, evento.state, rank, evento.amount_cents, evento.currency]);
   // Se a régua não subiu até onde este evento pedia, ele chegou tarde.
   if (Number(upsert.rows[0].state_rank) > rank) desfecho = 'stale';
  }

  if (evento.handled && evento.charge_ref && evento.mark) {
   const coluna = MARCAS[evento.mark];
   // Estorno, contestação e cancelamento convivem com o progresso: marcam
   // uma data e NÃO apagam o estado alcançado. COALESCE preserva a primeira
   // ocorrência — reentrega não reescreve a data original.
   await client.query(
    `INSERT INTO payment_charges(provider,charge_ref,state,state_rank,${coluna})
     VALUES($1,$2,'created',$3,now())
     ON CONFLICT (provider,charge_ref) DO UPDATE SET
       ${coluna} = COALESCE(payment_charges.${coluna}, now()), updated_at = now()`,
    [evento.provider, evento.charge_ref, RANKS.created]);
  }

  await client.query('UPDATE payment_webhook_events SET outcome=$2 WHERE id=$1', [inserido.rows[0].id, desfecho]);
  await client.query('COMMIT');
  return desfecho;
 } catch (error) { await client.query('ROLLBACK'); throw error; } finally { client.release(); }
}

export function paymentWebhookRoutes(router, { env = process.env, clock = Date.now } = {}) {
 const receber = provider => async ({ req, url, pool, reply }) => {
  onlyParams(url.searchParams, []);
  const corpo = await rawBody(req);

  const prova = provider === 'stripe'
   ? verifyStripe({ header: req.headers['stripe-signature'], rawBody: corpo, secret: env.STRIPE_WEBHOOK_SECRET, now: clock() })
   : verifyAsaas({ header: req.headers['asaas-access-token'], token: env.ASAAS_WEBHOOK_TOKEN });

  // Falha de autenticidade NÃO recebe 2xx: quem não provou origem não entra
  // no histórico e não vira estado. O motivo fica interno — devolver "assinatura
  // inválida" x "sem segredo" ajudaria quem está sondando.
  if (!prova.ok) throw fail(prova.reason === 'sem_segredo' ? 503 : 401, 'Webhook não autenticado.');

  let corpoJson;
  try { corpoJson = JSON.parse(corpo); } catch { throw fail(400, 'JSON inválido.'); }
  const evento = normalize(provider, corpoJson);
  if (!evento) throw fail(400, 'Evento não reconhecido.');

  const outcome = await registrar(pool, evento);
  // 2xx inclusive para 'unhandled'. O Asaas interrompe a fila depois de 15
  // falhas seguidas, e os eventos expiram em 14 dias: recusar o que não
  // tratamos derrubaria também a entrega do que tratamos.
  return reply(200, { received: true, outcome });
 };

 router.post('/api/webhooks/stripe', receber('stripe'), { auth: 'public', webhook: true, body: false });
 router.post('/api/webhooks/asaas', receber('asaas'), { auth: 'public', webhook: true, body: false });

 // Leitura para o operador: o que chegou e em que estado cada cobrança ficou.
 router.get('/api/payments/webhooks', async ({ url, pool, reply }) => {
  onlyParams(url.searchParams, []);
  const [eventos, cobrancas] = await Promise.all([
   pool.query(`SELECT provider,event_id,event_type,charge_ref,outcome,received_at
                 FROM payment_webhook_events ORDER BY received_at DESC LIMIT 50`),
   pool.query(`SELECT provider,charge_ref,state,amount_cents,currency,
                      overdue_at,refunded_at,disputed_at,canceled_at,updated_at
                 FROM payment_charges ORDER BY updated_at DESC LIMIT 50`),
  ]);
  return reply(200, {
   configured: {
    stripe: Boolean(env.STRIPE_WEBHOOK_SECRET),
    asaas: Boolean(env.ASAAS_WEBHOOK_TOKEN),
   },
   events: eventos.rows,
   charges: cobrancas.rows,
   execution: 'record_only',
  });
 }, { body: false });
}
