import { randomUUID } from 'node:crypto';
import { fail, isUuid } from '../platform/http.mjs';
import { commercialPermission } from './commercial-keys.mjs';
import { createEvolutionAdapter } from '../integrations/evolution.mjs';
import { registrarMensagem } from '../platform/whatsapp-entrada.mjs';
import { aceitarLead } from './commercial-intake.mjs';
import { agendarTurno } from './whatsapp-agentes-fila.mjs';
import { descreverMensagem, telefoneDaConversa, ehConversaDePessoa } from './whatsapp-chat.mjs';
import { vivo } from '../platform/env-vivo.mjs';

// Conectar uma instância do WhatsApp a um funil. Desenho: docs/WHATSAPP-FLUXOS-DESENHO.md, seção 10 (padrão do Kommo: a conversa nova vira
// lead na etapa de entrada do funil, e as automações já ligadas ao funil andam sozinhas).
//
// COMO FUNCIONA: a cada ciclo (30 s) a captura olha, em cada instância conectada, as conversas que ganharam mensagem DELA depois da última
// olhada. Para cada mensagem nova: guarda na caixa de entrada (o mesmo que o webhook faria; a mesma mensagem vinda pelos dois não duplica),
// cria o lead no funil se aquele telefone ainda não é lead de ninguém (pelo MESMO caminho do intake do site: aceitarLead), liga a mensagem ao
// lead e agenda o turno do agente de IA. Por consulta, e não por webhook, então funciona mesmo com o webhook desconfigurado.
// Só vale o que chega DEPOIS de conectar: o histórico antigo não é importado.

const MAX_CONVERSAS_POR_CICLO = 10;
const INSTANCIA = /^[A-Za-z0-9_.-]{1,64}$/;
const iso = ms => new Date(ms).toISOString();
const ator = o => o?.email || o?.subject || 'desconhecido';
export const MENSAGEM_071 = 'A conexão da instância com o funil ainda não está disponível neste banco: falta aplicar a migração 071.';

async function comTransacao(pool, fn) {
 const client = await pool.connect();
 try { await client.query('BEGIN'); const r = await fn(client); await client.query('COMMIT'); return r; }
 catch (e) { await client.query('ROLLBACK').catch(() => {}); throw e; }
 finally { client.release(); }
}

/** Corpo do intake para uma conversa que começou no WhatsApp. O funil certo sai de `utm_tzolkin` = `<espaço>.<slug do funil>`. */
export function corpoDoLeadDaConversa({ numero, nome, texto, ligacao, instancia }) {
 const apelido = (nome && nome.trim().length >= 2 ? nome.trim() : `+${numero}`).slice(0, 200);
 return {
  lead: { name: apelido, whatsapp: numero, ...(texto ? { message: String(texto).slice(0, 300) } : {}) },
  organization: { name: apelido, organization_type: 'person' },
  stakeholder: { role: 'contact' },
  commercial: { product_id: ligacao.space_id, service_model: 'on_demand', label: 'Conversa iniciada no WhatsApp' },
  attribution: { source_system: 'whatsapp', source_ref: `${instancia}:${numero}`, channel: 'whatsapp', utm_tzolkin: `${ligacao.space_id}.${ligacao.slug}` },
  privacy: { source: 'whatsapp', contact_allowed: false },
 };
}

async function capturarDaInstancia(pool, l, { env, agora, criarAdaptador, criarLead, agendar, registrar }, saida) {
 const desde = new Date(l.last_scan_at).getTime();
 const ad = criarAdaptador({ env, instance: l.instance });
 if (!ad.configured) return;
 const chats = await ad.findChats({ take: 40 });
 if (!chats.ok) return;
 const novas = chats.chats
  .filter(c => ehConversaDePessoa(c.remoteJid) && c.lastMessage?.key?.fromMe === false && Number(c.lastMessage?.messageTimestamp) * 1000 > desde)
  .slice(0, MAX_CONVERSAS_POR_CICLO);
 for (const c of novas) {
  const numero = telefoneDaConversa(c.remoteJid, c.lastMessage?.key?.remoteJidAlt);
  if (!numero) continue;
  const hist = await ad.findMessages({ where: { key: { remoteJid: c.remoteJid } }, page: 1, offset: 10 });
  if (!hist.ok) continue;
  const entradas = hist.messages.filter(m => !m.fromMe && m.id && m.timestamp && m.timestamp * 1000 > desde).sort((a, b) => a.timestamp - b.timestamp);
  const nome = (typeof c.pushName === 'string' && c.pushName.trim()) || (typeof c.lastMessage?.pushName === 'string' && c.lastMessage.pushName.trim()) || null;
  for (const m of entradas) {
   const d = descreverMensagem(m.message, m.messageType);
   if (!d) continue;
   const r = await registrar(pool, { id: m.id, instancia: l.instance, numero, nome, texto: d.texto, midia: d.midia, em: new Date(m.timestamp * 1000) });
   if (!r.novo) continue;
   saida.mensagens++;
   let leadId = r.lead;
   if (!leadId) {
    const x = await comTransacao(pool, client => criarLead(client, { pool, productId: l.space_id, key: randomUUID(), body: corpoDoLeadDaConversa({ numero, nome, texto: d.texto, ligacao: l, instancia: l.instance }) }));
    leadId = x.body?.lead_id ?? null;
    if (x.body?.created) saida.leads++;
    try { x.afterCommit?.(); } catch { /* o aviso de lead novo nunca derruba a captura */ }
    if (leadId) await pool.query('UPDATE whatsapp_inbox SET lead_id=$1, product_id=$2 WHERE id=$3', [leadId, l.space_id, r.inboxId]);
   }
   if (leadId && !r.saiu && !d.midia && r.inboxId) { const a = await agendar(pool, { instancia: l.instance, numero, inboxId: r.inboxId, env }); if (a?.agendado) saida.turnos++; }
  }
 }
 await pool.query('UPDATE whatsapp_instance_funnels SET last_scan_at=$2 WHERE instance=$1', [l.instance, iso(agora() - 60000)]);
}

/** Um ciclo da captura. Nunca lança: devolve o que fez. As dependências são injetáveis (testes). */
export async function capturarConversas(pool, { env = vivo.env, agora = Date.now, criarAdaptador = createEvolutionAdapter, criarLead = aceitarLead, agendar = agendarTurno, registrar = registrarMensagem } = {}) {
 const saida = { instancias: 0, mensagens: 0, leads: 0, turnos: 0, erros: 0 };
 try {
  const ligacoes = (await pool.query(
   `SELECT f.instance, f.space_id, f.pipeline_id, f.last_scan_at, p.slug
      FROM whatsapp_instance_funnels f JOIN pipelines p ON p.id = f.pipeline_id WHERE f.create_leads AND p.is_active ORDER BY f.instance`)).rows;
  for (const l of ligacoes) {
   try { await capturarDaInstancia(pool, l, { env, agora, criarAdaptador, criarLead, agendar, registrar }, saida); saida.instancias++; }
   catch (e) { saida.erros++; console.error('[captura]', l.instance, 'falhou:', e?.message); }
  }
 } catch (e) {
  if (e?.code === '42P01' || e?.code === '42703') return { ...saida, indisponivel: true };   // migração 071 ainda não aplicada
  console.error('[captura] ciclo falhou:', e?.message);
  return { ...saida, erro: true };
 }
 return saida;
}

/** Liga a captura. Ciclos não se sobrepõem; o temporizador não segura o processo vivo. Devolve a função que desliga. */
export function iniciarCaptura({ pool, env = vivo.env, log = console, cadaMs = 30000 } = {}) {
 let ocupado = false;
 const ciclo = async () => {
  if (ocupado) return;
  ocupado = true;
  try {
   await vivo.garantir(pool);
   const r = await capturarConversas(pool, { env });
   if (r.mensagens || r.leads || r.erros) log.log(`[captura] ${JSON.stringify(r)}`);
  } catch (e) { log.error('[captura] falhou:', e?.message); }
  finally { ocupado = false; }
 };
 const t = setInterval(ciclo, cadaMs); t.unref?.();
 return () => clearInterval(t);
}

// ---------- conexões (usadas pela tela e pelo MCP) ----------
export const funisAtivos = async db => (await db.query('SELECT p.id, p.name, p.slug, p.space_id, pr.name AS space_name FROM pipelines p JOIN products pr ON pr.id = p.space_id WHERE p.is_active ORDER BY pr.name, p.position, p.name')).rows;

export async function listarConexoes(db) {
 const funis = await funisAtivos(db);
 try {
  const conexoes = (await db.query(
   `SELECT f.instance, f.space_id, pr.name AS space_name, f.pipeline_id, p.name AS pipeline_name, f.create_leads, f.updated_at
      FROM whatsapp_instance_funnels f JOIN pipelines p ON p.id = f.pipeline_id JOIN products pr ON pr.id = f.space_id ORDER BY f.instance`)).rows;
  return { disponivel: true, conexoes, funis };
 } catch (e) { if (e?.code === '42P01') return { disponivel: false, conexoes: [], funis, aviso: MENSAGEM_071 }; throw e; }
}

/** Conecta (ou reconecta, ou desliga com `create_leads: false`) uma instância a um funil. Dentro da transação de quem chama. */
export async function salvarConexao(client, { instance, pipeline_id, create_leads = true, por = null }) {
 if (typeof instance !== 'string' || !INSTANCIA.test(instance)) throw fail(400, 'Instância inválida.');
 if (!isUuid(pipeline_id)) throw fail(400, 'Escolha o funil.');
 if (typeof create_leads !== 'boolean') throw fail(400, 'Valor inválido em "criar leads".');
 const funil = (await client.query('SELECT id, space_id FROM pipelines WHERE id=$1 AND is_active', [pipeline_id])).rows[0];
 if (!funil) throw fail(400, 'O funil não existe ou está arquivado.');
 try {
  // Ligar de novo NÃO importa o que chegou enquanto estava desligado: a marca de leitura volta para agora.
  await client.query(
   `INSERT INTO whatsapp_instance_funnels(instance, space_id, pipeline_id, create_leads, created_by) VALUES($1,$2,$3,$4,$5)
    ON CONFLICT (instance) DO UPDATE SET space_id=EXCLUDED.space_id, pipeline_id=EXCLUDED.pipeline_id, create_leads=EXCLUDED.create_leads, updated_at=now(),
     last_scan_at = CASE WHEN whatsapp_instance_funnels.create_leads = false AND EXCLUDED.create_leads THEN now() ELSE whatsapp_instance_funnels.last_scan_at END`,
   [instance, funil.space_id, funil.id, create_leads, por]);
 } catch (e) { if (e?.code === '42P01') throw fail(409, MENSAGEM_071); throw e; }
 return { ok: true, instance, space_id: funil.space_id, pipeline_id: funil.id, create_leads };
}

export function whatsappConexoesRoutes(router) {
 router.get('/api/whatsapp/conexoes', async ({ pool, reply, operator }) => {
  await commercialPermission(pool, operator);
  reply(200, await listarConexoes(pool));
 }, { body: false });

 router.put('/api/whatsapp/conexoes/:instance', async ({ client, params, body, operator }) => {
  await commercialPermission(client, operator, true);
  return { body: await salvarConexao(client, { instance: params.instance, pipeline_id: body?.pipeline_id, create_leads: body?.create_leads ?? true, por: ator(operator) }) };
 }, { transactional: true, audit: false });
}
