import { randomUUID } from 'node:crypto';
import { fail, input, onlyParams } from '../platform/http.mjs';
import { createEvolutionAdapter } from '../integrations/evolution.mjs';
import { CORPO_MAXIMO } from '../integrations/payment-webhooks.mjs';
import { enfileirar } from '../platform/whatsapp-saida.mjs';
import { extrairMensagens, registrarMensagem, verificarSegredo, MENSAGEM_063, MENSAGEM_064 } from '../platform/whatsapp-entrada.mjs';
import { vivo } from '../platform/env-vivo.mjs';
import { agendarTurno } from './whatsapp-agentes-fila.mjs';

// Webhook da Evolution (mensagens recebidas) e rotas da aba "Conversas" do WhatsApp.
//
// O webhook é uma das poucas rotas sem sessão: prova a origem pelo segredo (EVOLUTION_WEBHOOK_SECRET), enviado pela Evolution no cabeçalho
// `x-webhook-secret` (ou `Authorization: Bearer`). Sem segredo configurado, recusa (503); com segredo errado, 401 sem dizer o motivo.
// Só registra: não responde ao lead, não cria lead, não dispara automação.

const NUMERO = /^[0-9]{10,15}$/;
const INSTANCIA = /^[A-Za-z0-9_.-]{1,64}$/;
const iso = ms => new Date(ms).toISOString();
const ator = o => o?.email || o?.subject || 'desconhecido';

async function corpoCru(req) {
 const partes = []; let bytes = 0;
 for await (const parte of req) { bytes += parte.length; if (bytes > CORPO_MAXIMO) throw fail(413, 'Requisição muito grande.'); partes.push(parte); }
 return Buffer.concat(partes).toString('utf8');
}

export function whatsappEntradaRoutes(router, { env = vivo.env, clock = Date.now, criarAdaptador = createEvolutionAdapter } = {}) {
 // A instância pedida (?instance=) ou, sem ela, a padrão do Core. Mensagem antiga, gravada sem instância, é da padrão.
 const padrao = () => String(env.EVOLUTION_INSTANCE ?? '').trim();
 const instanciaDe = valor => { const v = valor == null || valor === '' ? padrao() : String(valor); if (!INSTANCIA.test(v)) throw fail(400, 'Instância inválida.'); return v; };

 router.post('/api/webhooks/evolution', async ({ req, pool, reply }) => {
  const prova = verificarSegredo({ cabecalho: req.headers['x-webhook-secret'], autorizacao: req.headers.authorization, segredo: String(env.EVOLUTION_WEBHOOK_SECRET ?? '').trim() });
  // Falha de autenticidade NÃO recebe 2xx, e o motivo fica interno: dizer "sem segredo" x "segredo errado" ajudaria quem sonda.
  if (!prova.ok) throw fail(prova.reason === 'sem_segredo' ? 503 : 401, 'Webhook não autenticado.');
  let corpo;
  try { corpo = JSON.parse(await corpoCru(req)); } catch (e) { if (e?.status) throw e; throw fail(400, 'JSON inválido.'); }
  const { mensagens } = extrairMensagens(corpo);
  let registradas = 0;
  try {
   for (const m of mensagens) {
    const r = await registrarMensagem(pool, m);
    if (!r.novo) continue;
    registradas++;
    // Texto de verdade, que não pediu para sair: o agente (se houver um para este funil) responde daqui a alguns segundos.
    if (!r.saiu && !m.midia && r.inboxId) await agendarTurno(pool, { instancia: m.instancia, numero: m.numero, inboxId: r.inboxId, env });
   }
  }
  catch (e) { if (e?.code === '42P01') throw fail(503, MENSAGEM_063); if (e?.code === '42703') throw fail(503, MENSAGEM_064); throw e; }   // 5xx: a Evolution tenta de novo depois de aplicada
  // 2xx inclusive para o que não guardamos (grupo, status, evento de outro tipo): recusar derrubaria a entrega do que importa.
  return reply(200, { received: true, registradas });
 }, { auth: 'public', webhook: true, body: false });

 // Instâncias do servidor da Evolution, com o estado de cada uma e o que há por ler. Com a chave global lista todas; com a chave de uma instância
 // só (a Evolution recusa a lista), cai para a instância padrão, que é o que o Core sempre usou.
 router.get('/api/whatsapp/instances', async ({ pool, reply }) => {
  const adaptador = criarAdaptador({ env });
  if (!adaptador.configured) return reply(200, { configurada: false, instancias: [], padrao: padrao() });
  let instancias = [], todas = true;
  const lista = await adaptador.listInstances();
  if (lista.ok && lista.instances.length) instancias = lista.instances;
  else {
   todas = false;
   const estado = await adaptador.connectionState();
   instancias = [{ name: padrao(), state: estado.ok ? estado.state : 'close', number: null, profile: null }];
  }
  let naoLidas = new Map();
  try { naoLidas = new Map((await pool.query('SELECT coalesce(instance, $1) AS instance, count(*)::int AS n FROM whatsapp_inbox WHERE read_at IS NULL GROUP BY 1', [padrao()])).rows.map(r => [r.instance, r.n])); }
  catch (e) { if (e?.code !== '42P01' && e?.code !== '42703') throw e; }
  reply(200, { configurada: true, todas, padrao: padrao(), instancias: instancias.map(i => ({ ...i, nao_lidas: naoLidas.get(i.name) ?? 0, conectada: i.state === 'open' })) });
 }, { body: false });

 // Conversas: uma por número, da mais recente, com o que não foi lido.
 router.get('/api/whatsapp/conversations', async ({ pool, url, reply }) => {
  onlyParams(url.searchParams, ['instance']);
  const instancia = instanciaDe(url.searchParams.get('instance'));
  try {
   const linhas = (await pool.query(
    `SELECT c.*, (SELECT l.name FROM commercial_leads l WHERE l.id=c.lead_id) AS lead_name FROM (
       SELECT from_number AS number,
              (array_agg(push_name ORDER BY received_at DESC) FILTER (WHERE push_name IS NOT NULL))[1] AS name,
              max(received_at) AS last_at,
              count(*) FILTER (WHERE read_at IS NULL)::int AS unread,
              (array_agg(body_text ORDER BY received_at DESC))[1] AS last_text,
              (array_agg(lead_id ORDER BY received_at DESC) FILTER (WHERE lead_id IS NOT NULL))[1] AS lead_id
         FROM whatsapp_inbox WHERE coalesce(instance, $1) = $2 GROUP BY from_number ORDER BY max(received_at) DESC LIMIT 50) c`, [padrao(), instancia])).rows;
   reply(200, { disponivel: true, conversas: linhas, nao_lidas: linhas.reduce((n, c) => n + c.unread, 0) });
  } catch (e) { if (e?.code === '42P01') return reply(200, { disponivel: false, conversas: [], nao_lidas: 0 }); if (e?.code === '42703') return reply(200, { disponivel: false, conversas: [], nao_lidas: 0, falha: MENSAGEM_064 }); throw e; }
 }, { body: false });

 // A conversa inteira: o que o lead mandou e o que o Core mandou, na ordem do tempo.
 router.get('/api/whatsapp/conversations/:number', async ({ pool, params, url, reply }) => {
  if (!NUMERO.test(params.number)) throw fail(400, 'Número inválido.');
  onlyParams(url.searchParams, ['instance']);
  const instancia = instanciaDe(url.searchParams.get('instance'));
  try {
   const mensagens = (await pool.query(
    `SELECT * FROM (
       SELECT id, 'in' AS direcao, body_text AS texto, received_at AS em, NULL::text AS status, NULL::text AS erro FROM whatsapp_inbox WHERE from_number=$1 AND coalesce(instance, $2) = $3
       UNION ALL
       SELECT id, 'out', body_text, coalesce(sent_at, created_at), status, last_error FROM whatsapp_outbox WHERE to_number=$1 AND coalesce(instance, $2) = $3
     ) t ORDER BY em DESC LIMIT 100`, [params.number, padrao(), instancia])).rows.reverse();
   const bloqueado = (await pool.query('SELECT 1 FROM whatsapp_suppressions WHERE number=$1 AND revoked_at IS NULL', [params.number])).rows.length > 0;
   const lead = (await pool.query('SELECT lead_id, push_name FROM whatsapp_inbox WHERE from_number=$1 AND coalesce(instance, $2) = $3 ORDER BY received_at DESC LIMIT 1', [params.number, padrao(), instancia])).rows[0] ?? null;
   let comPessoa = false;
   try { comPessoa = (await pool.query('SELECT 1 FROM ai_handoffs WHERE instance=$1 AND number=$2 AND released_at IS NULL', [instancia, params.number])).rows.length > 0; } catch (e) { if (e?.code !== '42P01') throw e; }
   reply(200, { number: params.number, instance: instancia, com_pessoa: comPessoa, mensagens, bloqueado, lead_id: lead?.lead_id ?? null, name: lead?.push_name ?? null });
  } catch (e) { if (e?.code === '42P01') throw fail(409, MENSAGEM_063); if (e?.code === '42703') throw fail(409, MENSAGEM_064); throw e; }
 }, { body: false });

 router.post('/api/whatsapp/conversations/:number/lida', async ({ client, params, url, operator }) => {
  if (!NUMERO.test(params.number)) throw fail(400, 'Número inválido.');
  onlyParams(url.searchParams, ['instance']);
  const instancia = instanciaDe(url.searchParams.get('instance'));
  try {
   const r = await client.query('UPDATE whatsapp_inbox SET read_at=$2, read_by=$3 WHERE from_number=$1 AND read_at IS NULL AND coalesce(instance, $4) = $5', [params.number, iso(clock()), ator(operator), padrao(), instancia]);
   return { response: { ok: true, marcadas: r.rowCount ?? 0 } };
  } catch (e) { if (e?.code === '42P01') throw fail(409, MENSAGEM_063); if (e?.code === '42703') throw fail(409, MENSAGEM_064); throw e; }
 }, { transactional: true, body: false, audit: false });

 // Responder: não envia na hora. Entra na fila de saída (062), com o mesmo ritmo e o mesmo interruptor (WHATSAPP_ENVIO).
 router.post('/api/whatsapp/conversations/:number/responder', async ({ client, params, body, operator }) => {
  if (!NUMERO.test(params.number)) throw fail(400, 'Número inválido.');
  input(body, ['text', 'instance']);
  const instancia = instanciaDe(body.instance);
  const texto = String(body.text ?? '').trim();
  if (!texto || texto.length > 4096) throw fail(400, 'Escreva a mensagem (até 4096 caracteres).');
  try {
   if ((await client.query('SELECT 1 FROM whatsapp_suppressions WHERE number=$1 AND revoked_at IS NULL', [params.number])).rows.length) throw fail(409, 'Este número pediu para não receber mensagens (ou não tem WhatsApp).');
   const origem = (await client.query('SELECT lead_id, product_id, push_name FROM whatsapp_inbox WHERE from_number=$1 AND coalesce(instance, $2) = $3 ORDER BY received_at DESC LIMIT 1', [params.number, padrao(), instancia])).rows[0] ?? null;
   const g = await enfileirar(client, { chave: `wa:resposta:${randomUUID()}`, tipo: 'lead', produto: origem?.product_id ?? null, evento: 'resposta.manual', lead: origem?.lead_id ?? null, para: params.number, nome: origem?.push_name ?? null, texto, por: ator(operator), instancia });
   // Quando uma PESSOA responde, o agente sai da conversa até alguém devolver (ai_handoffs); sem a migração 066 isto é só ignorado.
   await client.query('SAVEPOINT passagem');
   try { await client.query("INSERT INTO ai_handoffs(instance,number,reason,created_by) VALUES($1,$2,'pessoa_respondeu',$3) ON CONFLICT DO NOTHING", [instancia, params.number, ator(operator)]); await client.query('RELEASE SAVEPOINT passagem'); }
   catch (e) { await client.query('ROLLBACK TO SAVEPOINT passagem'); await client.query('RELEASE SAVEPOINT passagem'); if (e?.code !== '42P01') throw e; }
   return { response: { ok: true, id: g.id } };
  } catch (e) { if (e?.code === '42P01') throw fail(409, 'A fila de WhatsApp ainda não está disponível neste banco: falta aplicar a migração 062.'); throw e; }
 }, { transactional: true, audit: false });
}
