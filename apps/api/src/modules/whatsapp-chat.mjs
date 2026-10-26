import { fail, onlyParams } from '../platform/http.mjs';
import { createEvolutionAdapter } from '../integrations/evolution.mjs';
import { vivo } from '../platform/env-vivo.mjs';

// Chat do WhatsApp lendo DIRETO da Evolution: a lista de conversas e o histórico, sem depender do webhook nem de a pessoa já ter
// escrito para o Core. Só leitura. Responder continua pela fila (POST /api/whatsapp/conversations/:número/responder), que respeita
// ritmo, bloqueio e o interruptor WHATSAPP_ENVIO.
//
// Formatos conferidos na Evolution 2.3.7: `findChats` devolve as conversas da mais recente para a mais antiga, com a última mensagem
// dentro; `findMessages` pagina por `offset` (tamanho) e `page` (número) e devolve da mais nova para a mais antiga. Uma conversa pode
// vir com o endereço @lid (identificador interno do WhatsApp); o telefone, quando existe, vem em `remoteJidAlt`.

const TAMANHO_DA_PAGINA = 40, MAX_CONVERSAS = 100, PADRAO_DE_CONVERSAS = 60;
const JID = /^[A-Za-z0-9._-]{5,40}@(s\.whatsapp\.net|lid)$/;
const INSTANCIA = /^[A-Za-z0-9_.-]{1,64}$/;
const TELEFONE = /^(\d{10,15})@s\.whatsapp\.net$/;
const iso = ms => new Date(ms).toISOString();

/** O telefone (só dígitos) de uma conversa: do próprio endereço, ou do `remoteJidAlt` quando o endereço é @lid. Senão null. */
export function telefoneDaConversa(jid, alt) {
 return String(jid ?? '').match(TELEFONE)?.[1] ?? String(alt ?? '').match(TELEFONE)?.[1] ?? null;
}

/** Conversa de grupo, status, canal ou lista de transmissão: fica de fora (o chat é com pessoas). */
export const ehConversaDePessoa = jid => JID.test(String(jid ?? ''));

const SEM_TEXTO = ['protocolMessage', 'senderKeyDistributionMessage', 'messageContextInfo'];
const DESEMBRULHAR = ['ephemeralMessage', 'viewOnceMessage', 'viewOnceMessageV2', 'documentWithCaptionMessage', 'editedMessage'];

/**
 * O que mostrar de uma mensagem: o texto (ou a legenda) e se é mídia. Mídia ainda não é baixada: aparece como "[imagem]", "[áudio]"...
 * Devolve null para o que não é conteúdo de conversa (apagar mensagem, chaves de criptografia).
 */
export function descreverMensagem(message, tipo) {
 let m = message && typeof message === 'object' ? message : {};
 for (let i = 0; i < 3; i++) { const k = DESEMBRULHAR.find(x => m[x]?.message); if (!k) break; m = m[k].message; }
 const so = Object.keys(m).filter(k => !SEM_TEXTO.includes(k));
 if (!so.length) return tipo && !SEM_TEXTO.includes(tipo) ? { texto: `[${tipo}]`, midia: false } : null;
 const t = v => (typeof v === 'string' && v.trim() ? v.trim() : null);
 if (t(m.conversation)) return { texto: t(m.conversation), midia: false };
 if (m.extendedTextMessage) return { texto: t(m.extendedTextMessage.text) ?? '[mensagem]', midia: false };
 if (m.imageMessage) return { texto: t(m.imageMessage.caption) ?? '[imagem]', midia: true };
 if (m.videoMessage) return { texto: t(m.videoMessage.caption) ?? '[vídeo]', midia: true };
 if (m.audioMessage) return { texto: m.audioMessage.ptt ? '[mensagem de voz]' : '[áudio]', midia: true };
 if (m.documentMessage) return { texto: t(m.documentMessage.caption) ?? t(m.documentMessage.fileName) ?? '[documento]', midia: true };
 if (m.stickerMessage) return { texto: '[figurinha]', midia: true };
 if (m.locationMessage || m.liveLocationMessage) return { texto: '[localização]', midia: false };
 if (m.contactMessage || m.contactsArrayMessage) return { texto: '[contato]', midia: false };
 if (m.reactionMessage) return t(m.reactionMessage.text) ? { texto: `reagiu com ${t(m.reactionMessage.text)}`, midia: false } : null;
 if (m.pollCreationMessage || m.pollCreationMessageV3) return { texto: `[enquete] ${t((m.pollCreationMessage ?? m.pollCreationMessageV3).name) ?? ''}`.trim(), midia: false };
 if (m.buttonsResponseMessage) return { texto: t(m.buttonsResponseMessage.selectedDisplayText) ?? '[resposta]', midia: false };
 if (m.listResponseMessage) return { texto: t(m.listResponseMessage.title) ?? '[resposta]', midia: false };
 if (m.placeholderMessage) return { texto: '[mensagem indisponível]', midia: false };
 return { texto: tipo ? `[${tipo.replace(/Message$/, '')}]` : '[mensagem]', midia: false };
}

/** Uma conversa da Evolution no formato da tela. `lead` (opcional) vem do banco, pelo telefone. */
export function montarConversa(chat, lead) {
 const ultima = chat?.lastMessage ?? {};
 const jid = String(chat?.remoteJid ?? '');
 const numero = telefoneDaConversa(jid, ultima?.key?.remoteJidAlt);
 const descricao = descreverMensagem(ultima.message, ultima.messageType);
 const minha = ultima?.key?.fromMe === true;
 const ts = Number(ultima.messageTimestamp);
 const quando = Number.isFinite(ts) && ts > 0 ? iso(ts * 1000) : (chat?.updatedAt ? new Date(chat.updatedAt).toISOString() : null);
 // O pushName da última mensagem NOSSA é o nome do nosso perfil, não o da pessoa.
 const nome = (typeof chat?.pushName === 'string' && chat.pushName.trim()) || (!minha && typeof ultima.pushName === 'string' && ultima.pushName.trim()) || null;
 return {
  jid, number: numero, name: nome, lead_id: lead?.id ?? null, lead_name: lead?.name ?? null,
  foto: typeof chat?.profilePicUrl === 'string' && /^https:\/\//.test(chat.profilePicUrl) ? chat.profilePicUrl : null,
  last_at: quando, last_text: descricao?.texto ?? '', last_from_me: minha, unread: Number.isInteger(chat?.unreadCount) ? chat.unreadCount : 0,
  sem_telefone: !numero,
 };
}

/** Uma mensagem da Evolution no formato da tela, ou null se não for conteúdo de conversa. */
export function montarMensagem(r) {
 const d = descreverMensagem(r?.message, r?.messageType);
 if (!d) return null;
 const ts = Number(r?.timestamp);
 return { id: r?.id ?? r?.key?.id ?? null, direcao: r?.fromMe === true ? 'out' : 'in', texto: d.texto, midia: d.midia, tipo: r?.messageType ?? null,
  em: Number.isFinite(ts) && ts > 0 ? iso(ts * 1000) : null, status: r?.fromMe === true ? (r?.status ?? null) : null };
}

const ultimos8 = telefone => String(telefone).slice(-8);

export function whatsappChatRoutes(router, { env = vivo.env, criarAdaptador = createEvolutionAdapter } = {}) {
 const padrao = () => String(env.EVOLUTION_INSTANCE ?? '').trim();
 const instanciaDe = valor => { const v = valor == null || valor === '' ? padrao() : String(valor); if (!INSTANCIA.test(v)) throw fail(400, 'Instância inválida.'); return v; };
 const motivo = r => (r.reason === 'unauthorized' ? 'A Evolution recusou a chave de acesso.' : r.reason === 'not_found' ? 'A instância não existe na Evolution.' : r.reason === 'rate_limited' ? 'A Evolution pediu para ir mais devagar.' : 'A Evolution não respondeu.');

 // Lead do funil de cada telefone (últimos 8 dígitos, como o webhook faz). Sem as tabelas, a lista segue sem o vínculo.
 async function leadsPorTelefone(pool, telefones) {
  const chaves = [...new Set(telefones.filter(Boolean).map(ultimos8))];
  if (!chaves.length) return new Map();
  try {
   const linhas = (await pool.query(
    `SELECT DISTINCT ON (k) k, id, name FROM (
       SELECT l.id, l.name, l.created_at, right(regexp_replace(coalesce(l.whatsapp, s.phone, ''), '\\D', '', 'g'), 8) AS k
         FROM commercial_leads l LEFT JOIN stakeholders s ON s.id = l.stakeholder_id) x
      WHERE k = ANY($1::text[]) ORDER BY k, created_at DESC`, [chaves])).rows;
   return new Map(linhas.map(l => [l.k, { id: l.id, name: l.name }]));
  } catch (e) { if (e?.code === '42P01' || e?.code === '42703') return new Map(); throw e; }
 }

 router.get('/api/whatsapp/chat/conversas', async ({ pool, url, reply }) => {
  onlyParams(url.searchParams, ['instance', 'limite']);
  const instancia = instanciaDe(url.searchParams.get('instance'));
  const bruto = url.searchParams.get('limite');
  const limite = bruto == null || bruto === '' ? PADRAO_DE_CONVERSAS : Number(bruto);
  if (!Number.isInteger(limite) || limite < 1 || limite > MAX_CONVERSAS) throw fail(400, `Informe de 1 a ${MAX_CONVERSAS} conversas.`);
  const adaptador = criarAdaptador({ env, instance: instancia });
  if (!adaptador.configured) return reply(200, { disponivel: false, conversas: [], nao_lidas: 0, falha: 'A Evolution não está configurada.' });
  // Pede a mais para compensar grupos e status, que ficam de fora.
  const r = await adaptador.findChats({ take: Math.min(200, limite * 2) });
  if (!r.ok) return reply(200, { disponivel: false, conversas: [], nao_lidas: 0, falha: motivo(r) });
  const doChat = r.chats.filter(c => ehConversaDePessoa(c.remoteJid)).slice(0, limite);
  const telefones = doChat.map(c => telefoneDaConversa(c.remoteJid, c.lastMessage?.key?.remoteJidAlt));
  const leads = await leadsPorTelefone(pool, telefones);
  const conversas = doChat.map((c, i) => montarConversa(c, telefones[i] ? leads.get(ultimos8(telefones[i])) : null))
   .sort((a, b) => String(b.last_at ?? '').localeCompare(String(a.last_at ?? '')));
  reply(200, { disponivel: true, instancia, conversas, nao_lidas: conversas.reduce((n, c) => n + c.unread, 0) });
 }, { body: false });

 // O histórico de uma conversa, uma página por vez (a mais recente primeiro; cada página sai da mais antiga para a mais nova).
 router.get('/api/whatsapp/chat/mensagens', async ({ pool, url, reply }) => {
  onlyParams(url.searchParams, ['jid', 'instance', 'pagina']);
  const jid = String(url.searchParams.get('jid') ?? '');
  if (!JID.test(jid)) throw fail(400, 'Conversa inválida.');
  const instancia = instanciaDe(url.searchParams.get('instance'));
  const brutoPagina = url.searchParams.get('pagina');
  const pagina = brutoPagina == null || brutoPagina === '' ? 1 : Number(brutoPagina);
  if (!Number.isInteger(pagina) || pagina < 1 || pagina > 10000) throw fail(400, 'Página inválida.');
  const adaptador = criarAdaptador({ env, instance: instancia });
  if (!adaptador.configured) throw fail(409, 'A Evolution não está configurada.');
  const r = await adaptador.findMessages({ where: { key: { remoteJid: jid } }, page: pagina, offset: TAMANHO_DA_PAGINA });
  if (!r.ok) throw fail(502, motivo(r));
  const mensagens = r.messages.map(montarMensagem).filter(Boolean).reverse();
  const alt = r.messages.map(m => m.key?.remoteJidAlt).find(Boolean);
  const numero = telefoneDaConversa(jid, alt);

  // O que o Core mandou e ainda não saiu (na fila, enviando, falhou) aparece no fim da primeira página, como pendente.
  let pendentes = [], bloqueado = false, comPessoa = false, lead = null;
  if (numero) {
   try {
    if (pagina === 1) pendentes = (await pool.query(
     "SELECT id, body_text, status, last_error, created_at FROM whatsapp_outbox WHERE to_number = $1 AND coalesce(instance, $2) = $3 AND status IN ('queued','sending','failed') ORDER BY created_at LIMIT 20", [numero, padrao(), instancia])).rows;
    bloqueado = (await pool.query('SELECT 1 FROM whatsapp_suppressions WHERE number = $1 AND revoked_at IS NULL', [numero])).rows.length > 0;
   } catch (e) { if (e?.code !== '42P01' && e?.code !== '42703') throw e; }
   try { comPessoa = (await pool.query('SELECT 1 FROM ai_handoffs WHERE instance = $1 AND number = $2 AND released_at IS NULL', [instancia, numero])).rows.length > 0; } catch (e) { if (e?.code !== '42P01' && e?.code !== '42703') throw e; }
   lead = (await leadsPorTelefone(pool, [numero])).get(ultimos8(numero)) ?? null;
  }
  const doCore = pendentes.map(p => ({ id: p.id, direcao: 'out', texto: p.body_text, midia: false, tipo: 'conversation', em: new Date(p.created_at).toISOString(), status: p.status === 'failed' ? 'FAILED' : 'QUEUED', erro: p.last_error ?? null, pendente: true }));
  reply(200, {
   jid, number: numero, instance: instancia, pagina: r.page, paginas: r.pages, total: r.total, tem_mais_antigas: r.page < r.pages,
   mensagens: pagina === 1 ? [...mensagens, ...doCore] : mensagens, com_pessoa: comPessoa, bloqueado, lead_id: lead?.id ?? null, lead_name: lead?.name ?? null,
  });
 }, { body: false });
}
