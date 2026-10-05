import { fail, input, isUuid } from '../platform/http.mjs';
import {
 TOPICOS, assinaturaValida, enderecoPushValido, topicosValidos, vapidConfig, senderDe, senderPadrao,
 payloadLeadNovo, payloadTeste,
} from '../platform/webpush.mjs';

// Push do painel: o operador assina o aparelho dele e o Core avisa quando algo
// acontece (hoje, lead novo). Ver docs/NOTIFICATIONS.md.
//
// Envio é sempre BEST-EFFORT: notificação é aviso, não pode derrubar a gravação
// de um lead nem a resposta de uma rota.

/**
 * Manda `payload` para as assinaturas dadas e registra o resultado em cada linha.
 *  - 404/410 do serviço de push: a assinatura morreu (a pessoa revogou ou limpou o
 *    navegador). Vira `revoked_at`, e o aparelho deixa de receber tentativa.
 *  - qualquer outro erro: conta como falha, mas a assinatura segue valendo (rede ou
 *    serviço fora do ar não é motivo para desligar o aparelho de ninguém).
 * Nunca lança.
 */
async function enviarLote(pool, linhas, payload, enviar) {
 const r = { enviados: 0, revogados: 0, falhas: 0 };
 for (const s of linhas) {
  try {
   await enviar({ endpoint: s.endpoint, keys: { p256dh: s.p256dh, auth: s.auth } }, payload);
   await pool.query('UPDATE push_subscriptions SET last_success_at=now(), failure_count=0 WHERE id=$1', [s.id]);
   r.enviados++;
  } catch (erro) {
   const status = erro?.statusCode;
   try {
    if (status === 404 || status === 410) {
     await pool.query('UPDATE push_subscriptions SET revoked_at=now(), updated_at=now() WHERE id=$1', [s.id]);
     r.revogados++;
    } else {
     await pool.query('UPDATE push_subscriptions SET last_failure_at=now(), failure_count=failure_count+1 WHERE id=$1', [s.id]);
     r.falhas++;
    }
   } catch { r.falhas++; }
  }
 }
 return r;
}

/** Envia a todos os aparelhos ativos que assinaram o tópico. */
export async function notificarTopico(pool, topico, payload, enviar) {
 if (!TOPICOS.includes(topico)) throw new Error('Tópico desconhecido: ' + topico);
 const { rows } = await pool.query(
  'SELECT id,endpoint,p256dh,auth FROM push_subscriptions WHERE revoked_at IS NULL AND $1 = ANY(topics)', [topico]);
 return enviarLote(pool, rows, payload, enviar);
}

/**
 * Aviso de lead novo. Chamado DEPOIS do commit do intake (ver `afterCommit` em
 * app.mjs), nunca dentro da transação. `enviar` nulo = push desligado: não faz nada.
 */
export async function notificarLeadNovo(pool, { productId, leadId, nome, organizacao }, enviar = senderPadrao()) {
 if (!enviar) return { desligado: true };
 let produto = productId;
 try {
  const achado = (await pool.query('SELECT name FROM products WHERE id=$1', [productId])).rows[0];
  if (achado?.name) produto = achado.name;
 } catch { /* sem o nome bonito, usa o id do produto */ }
 return notificarTopico(pool, 'commercial.lead', payloadLeadNovo({ produto, organizacao, nome, leadId }), enviar);
}

const agente = req => String(req?.headers?.['user-agent'] ?? '').slice(0, 300) || null;

export function pushRoutes(router, opcoes = {}) {
 // Lido a CADA pedido: as chaves definidas pela tela (ambiente vivo) valem sem reiniciar. Os testes injetam `config` e `enviar`.
 const lerConfig = () => ('config' in opcoes ? opcoes.config : vapidConfig());
 const lerEnviar = () => opcoes.enviar ?? senderDe(lerConfig());

 // Qualquer operador logado pode saber se o push está ligado e qual é a chave
 // pública (ela não é segredo: o navegador precisa dela para assinar).
 router.get('/api/push/config', async ({ reply }) => {
  const config = lerConfig();
  reply(200, { enabled: Boolean(config), publicKey: config?.publicKey ?? null, topics: TOPICOS });
 });

 // "Meus aparelhos". Nunca devolve endpoint nem chaves.
 router.get('/api/push/subscriptions', async ({ pool, operator, reply }) => {
  const r = await pool.query(
   `SELECT id,topics,user_agent,created_at,last_success_at,last_failure_at,failure_count
      FROM push_subscriptions WHERE operator_subject=$1 AND revoked_at IS NULL ORDER BY created_at DESC`,
   [operator.subject]);
  return reply(200, { subscriptions: r.rows });
 });

 // Assina (ou religa) o aparelho de quem está logado. Mesmo aparelho assinado de novo
 // por outro operador passa a ser dele: o endpoint é único.
 router.put('/api/push/subscriptions', async ({ client, body, operator, req }) => {
  if (!lerConfig()) throw fail(503, 'Notificações push ainda não estão configuradas neste servidor.');
  input(body, ['subscription', 'topics']);
  if (!assinaturaValida(body.subscription)) throw fail(400, 'Assinatura de push inválida.');
  const topics = body.topics === undefined ? ['commercial.lead'] : topicosValidos(body.topics);
  if (!topics) throw fail(400, 'Tópico inválido.');
  const s = body.subscription;
  const r = await client.query(
   `INSERT INTO push_subscriptions(operator_subject,operator_email,endpoint,p256dh,auth,topics,user_agent)
    VALUES($1,$2,$3,$4,$5,$6,$7)
    ON CONFLICT (endpoint) DO UPDATE SET operator_subject=EXCLUDED.operator_subject,
     operator_email=EXCLUDED.operator_email, p256dh=EXCLUDED.p256dh, auth=EXCLUDED.auth,
     topics=EXCLUDED.topics, user_agent=EXCLUDED.user_agent, revoked_at=NULL,
     failure_count=0, updated_at=now()
    RETURNING id`,
   [operator.subject, operator.email ?? null, s.endpoint, s.keys.p256dh, s.keys.auth, topics, agente(req)]);
  return { response: { ok: true, id: r.rows[0].id, topics } };
 }, { transactional: true, audit: false });

 // "Este aparelho está assinado?": o navegador manda o endereço da assinatura que ele tem, e o servidor diz se é de quem pediu
 // (e quais tópicos). Nunca devolve endpoint nem chaves, e só enxerga os aparelhos do próprio operador.
 router.post('/api/push/status', async ({ client, body, operator }) => {
  input(body, ['endpoint']);
  if (!enderecoPushValido(body.endpoint)) throw fail(400, 'Endereço de assinatura inválido.');
  const r = await client.query(
   'SELECT id,topics FROM push_subscriptions WHERE endpoint=$1 AND operator_subject=$2 AND revoked_at IS NULL', [body.endpoint, operator.subject]);
  return { response: r.rows[0] ? { subscribed: true, id: r.rows[0].id, topics: r.rows[0].topics } : { subscribed: false } };
 }, { transactional: true, audit: false });

 // Desliga um aparelho. Só o dono desliga (por sujeito, nunca por e-mail digitado).
 router.delete('/api/push/subscriptions/:id', async ({ client, params, operator }) => {
  if (!isUuid(params.id)) throw fail(400, 'Identificador inválido.');
  const r = await client.query(
   `UPDATE push_subscriptions SET revoked_at=now(), updated_at=now()
     WHERE id=$1 AND operator_subject=$2 AND revoked_at IS NULL`, [params.id, operator.subject]);
  if (!r.rowCount) throw fail(404, 'Aparelho não encontrado.');
  return { response: { ok: true } };
 }, { transactional: true, audit: false, body: false });

 // Teste: manda um aviso SÓ para os aparelhos de quem pediu. Serve para o operador
 // ver que funcionou, e nunca dispara nada para outras pessoas.
 router.post('/api/push/test', async ({ pool, operator, reply }) => {
  const enviar = lerEnviar();
  if (!enviar) throw fail(503, 'Notificações push ainda não estão configuradas neste servidor.');
  const r = await pool.query(
   `SELECT id,endpoint,p256dh,auth FROM push_subscriptions WHERE operator_subject=$1 AND revoked_at IS NULL`,
   [operator.subject]);
  if (!r.rows.length) throw fail(409, 'Nenhum aparelho seu está com as notificações ativas.');
  return reply(200, await enviarLote(pool, r.rows, payloadTeste(), enviar));
 });
}
