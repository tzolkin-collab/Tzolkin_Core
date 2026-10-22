import { randomUUID } from 'node:crypto';
import { fail, input } from '../platform/http.mjs';
import { CORPO_MAXIMO } from '../integrations/payment-webhooks.mjs';
import { enfileirar } from '../platform/whatsapp-saida.mjs';
import { extrairMensagens, registrarMensagem, verificarSegredo, MENSAGEM_063 } from '../platform/whatsapp-entrada.mjs';
import { vivo } from '../platform/env-vivo.mjs';

// Webhook da Evolution (mensagens recebidas) e rotas da aba "Conversas" do WhatsApp.
//
// O webhook é uma das poucas rotas sem sessão: prova a origem pelo segredo (EVOLUTION_WEBHOOK_SECRET), enviado pela Evolution no cabeçalho
// `x-webhook-secret` (ou `Authorization: Bearer`). Sem segredo configurado, recusa (503); com segredo errado, 401 sem dizer o motivo.
// Só registra: não responde ao lead, não cria lead, não dispara automação.

const NUMERO = /^[0-9]{10,15}$/;
const iso = ms => new Date(ms).toISOString();
const ator = o => o?.email || o?.subject || 'desconhecido';

async function corpoCru(req) {
 const partes = []; let bytes = 0;
 for await (const parte of req) { bytes += parte.length; if (bytes > CORPO_MAXIMO) throw fail(413, 'Requisição muito grande.'); partes.push(parte); }
 return Buffer.concat(partes).toString('utf8');
}

export function whatsappEntradaRoutes(router, { env = vivo.env, clock = Date.now } = {}) {
 router.post('/api/webhooks/evolution', async ({ req, pool, reply }) => {
  const prova = verificarSegredo({ cabecalho: req.headers['x-webhook-secret'], autorizacao: req.headers.authorization, segredo: String(env.EVOLUTION_WEBHOOK_SECRET ?? '').trim() });
  // Falha de autenticidade NÃO recebe 2xx, e o motivo fica interno: dizer "sem segredo" x "segredo errado" ajudaria quem sonda.
  if (!prova.ok) throw fail(prova.reason === 'sem_segredo' ? 503 : 401, 'Webhook não autenticado.');
  let corpo;
  try { corpo = JSON.parse(await corpoCru(req)); } catch (e) { if (e?.status) throw e; throw fail(400, 'JSON inválido.'); }
  const { mensagens } = extrairMensagens(corpo, { instancia: String(env.EVOLUTION_INSTANCE ?? '').trim() });
  let registradas = 0;
  try { for (const m of mensagens) if ((await registrarMensagem(pool, m)).novo) registradas++; }
  catch (e) { if (e?.code === '42P01') throw fail(503, MENSAGEM_063); throw e; }   // 5xx: a Evolution tenta de novo depois de aplicada
  // 2xx inclusive para o que não guardamos (grupo, status, evento de outro tipo): recusar derrubaria a entrega do que importa.
  return reply(200, { received: true, registradas });
 }, { auth: 'public', webhook: true, body: false });

 // Conversas: uma por número, da mais recente, com o que não foi lido.
 router.get('/api/whatsapp/conversations', async ({ pool, reply }) => {
  try {
   const linhas = (await pool.query(
    `SELECT c.*, (SELECT l.name FROM commercial_leads l WHERE l.id=c.lead_id) AS lead_name FROM (
       SELECT from_number AS number,
              (array_agg(push_name ORDER BY received_at DESC) FILTER (WHERE push_name IS NOT NULL))[1] AS name,
              max(received_at) AS last_at,
              count(*) FILTER (WHERE read_at IS NULL)::int AS unread,
              (array_agg(body_text ORDER BY received_at DESC))[1] AS last_text,
              (array_agg(lead_id ORDER BY received_at DESC) FILTER (WHERE lead_id IS NOT NULL))[1] AS lead_id
         FROM whatsapp_inbox GROUP BY from_number ORDER BY max(received_at) DESC LIMIT 50) c`)).rows;
   reply(200, { disponivel: true, conversas: linhas, nao_lidas: linhas.reduce((n, c) => n + c.unread, 0) });
  } catch (e) { if (e?.code === '42P01') return reply(200, { disponivel: false, conversas: [], nao_lidas: 0 }); throw e; }
 }, { body: false });

 // A conversa inteira: o que o lead mandou e o que o Core mandou, na ordem do tempo.
 router.get('/api/whatsapp/conversations/:number', async ({ pool, params, reply }) => {
  if (!NUMERO.test(params.number)) throw fail(400, 'Número inválido.');
  try {
   const mensagens = (await pool.query(
    `SELECT * FROM (
       SELECT id, 'in' AS direcao, body_text AS texto, received_at AS em, NULL::text AS status, NULL::text AS erro FROM whatsapp_inbox WHERE from_number=$1
       UNION ALL
       SELECT id, 'out', body_text, coalesce(sent_at, created_at), status, last_error FROM whatsapp_outbox WHERE to_number=$1
     ) t ORDER BY em DESC LIMIT 100`, [params.number])).rows.reverse();
   const bloqueado = (await pool.query('SELECT 1 FROM whatsapp_suppressions WHERE number=$1 AND revoked_at IS NULL', [params.number])).rows.length > 0;
   const lead = (await pool.query('SELECT lead_id, push_name FROM whatsapp_inbox WHERE from_number=$1 ORDER BY received_at DESC LIMIT 1', [params.number])).rows[0] ?? null;
   reply(200, { number: params.number, mensagens, bloqueado, lead_id: lead?.lead_id ?? null, name: lead?.push_name ?? null });
  } catch (e) { if (e?.code === '42P01') throw fail(409, MENSAGEM_063); throw e; }
 }, { body: false });

 router.post('/api/whatsapp/conversations/:number/lida', async ({ client, params, operator }) => {
  if (!NUMERO.test(params.number)) throw fail(400, 'Número inválido.');
  try {
   const r = await client.query('UPDATE whatsapp_inbox SET read_at=$2, read_by=$3 WHERE from_number=$1 AND read_at IS NULL', [params.number, iso(clock()), ator(operator)]);
   return { response: { ok: true, marcadas: r.rowCount ?? 0 } };
  } catch (e) { if (e?.code === '42P01') throw fail(409, MENSAGEM_063); throw e; }
 }, { transactional: true, body: false, audit: false });

 // Responder: não envia na hora. Entra na fila de saída (062), com o mesmo ritmo e o mesmo interruptor (WHATSAPP_ENVIO).
 router.post('/api/whatsapp/conversations/:number/responder', async ({ client, params, body, operator }) => {
  if (!NUMERO.test(params.number)) throw fail(400, 'Número inválido.');
  input(body, ['text']);
  const texto = String(body.text ?? '').trim();
  if (!texto || texto.length > 4096) throw fail(400, 'Escreva a mensagem (até 4096 caracteres).');
  try {
   if ((await client.query('SELECT 1 FROM whatsapp_suppressions WHERE number=$1 AND revoked_at IS NULL', [params.number])).rows.length) throw fail(409, 'Este número pediu para não receber mensagens (ou não tem WhatsApp).');
   const origem = (await client.query('SELECT lead_id, product_id, push_name FROM whatsapp_inbox WHERE from_number=$1 ORDER BY received_at DESC LIMIT 1', [params.number])).rows[0] ?? null;
   const g = await enfileirar(client, { chave: `wa:resposta:${randomUUID()}`, tipo: 'lead', produto: origem?.product_id ?? null, evento: 'resposta.manual', lead: origem?.lead_id ?? null, para: params.number, nome: origem?.push_name ?? null, texto, por: ator(operator) });
   return { response: { ok: true, id: g.id } };
  } catch (e) { if (e?.code === '42P01') throw fail(409, 'A fila de WhatsApp ainda não está disponível neste banco: falta aplicar a migração 062.'); throw e; }
 }, { transactional: true, audit: false });
}
