// Mensagens de WhatsApp que chegam pelo webhook da Evolution API: o que vale a pena guardar, e onde. Funções puras onde dá, para testar sem rede.
import { timingSafeEqual } from 'node:crypto';

export const MENSAGEM_063 = 'A caixa de entrada de WhatsApp ainda não está disponível neste banco: falta aplicar a migração 063.';

/** Palavras que, sozinhas, são um pedido para parar de receber. */
const PEDIDOS_DE_SAIDA = new Set(['sair', 'parar', 'pare', 'stop', 'cancelar', 'descadastrar', 'remover']);
export const ehPedidoDeSaida = texto => PEDIDOS_DE_SAIDA.has(String(texto).toLowerCase().normalize('NFD').replace(/\p{M}/gu, '').replace(/[^a-z]/g, ''));

/** Compara o segredo do cabeçalho com o configurado, sem vazar nada pelo tempo. */
export function verificarSegredo({ cabecalho, autorizacao, segredo }) {
 if (!segredo) return { ok: false, reason: 'sem_segredo' };
 const enviado = String(cabecalho || String(autorizacao || '').replace(/^Bearer\s+/i, '') || '');
 if (!enviado) return { ok: false, reason: 'sem_token' };
 const a = Buffer.from(enviado), b = Buffer.from(String(segredo));
 return a.length === b.length && timingSafeEqual(a, b) ? { ok: true } : { ok: false, reason: 'token_invalido' };
}

const textoDe = m => m?.conversation ?? m?.extendedTextMessage?.text ?? m?.imageMessage?.caption ?? m?.videoMessage?.caption ?? m?.documentMessage?.caption ?? m?.buttonsResponseMessage?.selectedDisplayText ?? m?.listResponseMessage?.title ?? null;
const MIDIA = ['imageMessage', 'videoMessage', 'audioMessage', 'documentMessage', 'stickerMessage', 'contactMessage', 'locationMessage'];

/**
 * Do corpo do webhook, as mensagens RECEBIDAS de uma pessoa (nada de grupo, status, mensagem nossa nem de outra instância).
 * Devolve { evento, mensagens: [{ id, numero, nome, texto, midia, em }] }; `mensagens` vazio = nada a guardar (também é sucesso).
 */
export function extrairMensagens(corpo, { instancia } = {}) {
 const evento = String(corpo?.event ?? '').toLowerCase().replace(/_/g, '.');
 if (evento !== 'messages.upsert') return { evento, mensagens: [] };
 if (instancia && corpo?.instance && String(corpo.instance) !== String(instancia)) return { evento, mensagens: [] };
 const lista = Array.isArray(corpo.data) ? corpo.data : corpo.data ? [corpo.data] : [];
 const mensagens = [];
 for (const d of lista) {
  const chave = d?.key ?? {};
  if (chave.fromMe === true) continue;
  const jid = String(chave.remoteJid ?? '');
  const m = jid.match(/^(\d{10,15})@s\.whatsapp\.net$/);   // grupos (@g.us), status e @lid ficam de fora
  if (!m || typeof chave.id !== 'string' || !chave.id || chave.id.length > 200) continue;
  const midia = MIDIA.some(k => d.message?.[k]);
  const texto = String(textoDe(d.message) ?? '').trim().slice(0, 4096) || (midia ? '[mídia]' : '');
  if (!texto) continue;
  const segundos = Number(d.messageTimestamp);
  mensagens.push({ id: chave.id, numero: m[1], nome: typeof d.pushName === 'string' ? d.pushName.trim().slice(0, 200) || null : null, texto, midia, em: Number.isFinite(segundos) && segundos > 0 ? new Date(segundos * 1000) : new Date() });
 }
 return { evento, mensagens };
}

/**
 * Guarda uma mensagem recebida: liga ao lead pelo telefone (últimos 8 dígitos), grava sem duplicar e, se for um pedido de sair, bloqueia o
 * número e tira da fila o que ainda não saiu para ele. Devolve { novo, lead, saiu }.
 */
export async function registrarMensagem(db, m) {
 const lead = (await db.query(
  `SELECT l.id, l.product_id FROM commercial_leads l LEFT JOIN stakeholders s ON s.id=l.stakeholder_id
    WHERE right(regexp_replace(coalesce(l.whatsapp, s.phone, ''), '\\D', '', 'g'), 8) = $1 ORDER BY l.created_at DESC LIMIT 1`, [m.numero.slice(-8)])).rows[0] ?? null;
 const r = await db.query(
  `INSERT INTO whatsapp_inbox(provider_message_id,from_number,push_name,body_text,has_media,lead_id,product_id,received_at)
   VALUES($1,$2,$3,$4,$5,$6,$7,$8) ON CONFLICT (provider_message_id) DO NOTHING RETURNING id`,
  [m.id, m.numero, m.nome, m.texto, m.midia, lead?.id ?? null, lead?.product_id ?? null, m.em.toISOString()]);
 const novo = r.rows.length > 0;
 const saiu = novo && !m.midia && ehPedidoDeSaida(m.texto);
 if (saiu) {
  await db.query("INSERT INTO whatsapp_suppressions(number,reason,created_by) VALUES($1,'pediu_para_sair','webhook') ON CONFLICT DO NOTHING", [m.numero]);
  await db.query("UPDATE whatsapp_outbox SET status='suppressed', locked_at=NULL, last_error='Número na lista de supressão.' WHERE to_number=$1 AND status='queued'", [m.numero]);
 }
 return { novo, lead: lead?.id ?? null, saiu };
}
