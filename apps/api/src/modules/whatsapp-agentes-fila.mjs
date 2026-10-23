import { fail, onlyParams } from '../platform/http.mjs';
import { commercialPermission } from './commercial-keys.mjs';
import { createAnthropicAdapter } from '../integrations/anthropic.mjs';
import { executarTurno } from '../platform/agentes-motor.mjs';
import { vivo } from '../platform/env-vivo.mjs';

// A fila de turnos dos agentes de IA e as rotas que a tela usa para acompanhá-los e para passar a conversa a uma pessoa.
//
//  - O webhook (modules/whatsapp-entrada.mjs) chama `agendarTurno` a cada mensagem nova. O turno só roda DEPOIS de uns segundos sem
//    mensagem nova do lead (debounce), e há no máximo um turno aberto por conversa e agente.
//  - SÓ RODA COM AGENTES_EXECUCAO=ligado E com a chave da Anthropic. Desligado, nada é agendado e nada chama o modelo.
//  - A resposta do agente entra na fila de saída (whatsapp_outbox), que respeita o ritmo e o interruptor WHATSAPP_ENVIO.

export const DEBOUNCE_MS = 8000;
export const MAX_TENTATIVAS = 3;
const REPETE_EM_MS = 60_000;
const TURNO_PRESO_MS = 5 * 60_000;
export const execucaoLigada = env => String(env.AGENTES_EXECUCAO ?? '').trim().toLowerCase() === 'ligado';
const iso = ms => new Date(ms).toISOString();
const ator = o => o?.email || o?.subject || 'desconhecido';
const NUMERO = /^[0-9]{10,15}$/;
const INSTANCIA = /^[A-Za-z0-9_.-]{1,64}$/;

/**
 * Chamado pelo webhook com a mensagem recém-guardada. Acha o agente ligado que atende essa instância e o funil do lead e deixa um turno
 * marcado para daqui a pouco. Nunca lança: falha aqui não pode derrubar o recebimento da mensagem.
 */
export async function agendarTurno(db, { instancia, numero, inboxId, env, agora = Date.now }) {
 try {
  if (!execucaoLigada(env)) return { agendado: false, motivo: 'execucao_desligada' };
  const padrao = String(env.EVOLUTION_INSTANCE ?? '').trim(), nome = instancia || padrao || '';
  const lead = (await db.query('SELECT l.id,l.pipeline_id FROM commercial_leads l JOIN whatsapp_inbox i ON i.lead_id=l.id WHERE i.id=$1', [inboxId])).rows[0];
  if (!lead?.pipeline_id) return { agendado: false, motivo: 'sem_lead_em_funil' };
  if ((await db.query('SELECT 1 FROM ai_handoffs WHERE instance=$1 AND number=$2 AND released_at IS NULL', [nome, numero])).rows.length) return { agendado: false, motivo: 'com_uma_pessoa' };
  const agente = (await db.query('SELECT id FROM ai_agents WHERE is_active AND coalesce(instance,$1)=$2 AND $3::uuid = ANY(pipelines) ORDER BY created_at LIMIT 1', [padrao, nome, lead.pipeline_id])).rows[0];
  if (!agente) return { agendado: false, motivo: 'sem_agente' };
  await db.query(
   `INSERT INTO ai_agent_jobs(agent_id,instance,number,inbox_id,lead_id,run_after) VALUES($1,$2,$3,$4,$5,$6)
    ON CONFLICT (agent_id, instance, number) WHERE status IN ('queued','running')
    DO UPDATE SET inbox_id=EXCLUDED.inbox_id, run_after=EXCLUDED.run_after WHERE ai_agent_jobs.status='queued'`,
   [agente.id, nome, numero, inboxId, lead.id, iso(agora() + DEBOUNCE_MS)]);
  return { agendado: true };
 } catch (e) {
  if (e?.code !== '42P01' && e?.code !== '42703') console.error('[agentes] não consegui agendar o turno:', e?.message);
  return { agendado: false, motivo: 'erro' };
 }
}

/** Um ciclo: pega os turnos que já podem rodar e roda cada um. Nunca lança: devolve o que fez. */
export async function processarTurnos(pool, { env = vivo.env, modelo = createAnthropicAdapter({ env }), agora = Date.now, lote = 2 } = {}) {
 const t = agora();
 const saida = { respondidos: 0, pulados: 0, falhas: 0, adiados: 0, reenfileirados: 0 };
 try {
  if (!execucaoLigada(env)) return { ...saida, desligado: true };
  if (!modelo.configured) return { ...saida, desligado: true, semChave: true };
  saida.reenfileirados = (await pool.query("UPDATE ai_agent_jobs SET status='queued', locked_at=NULL WHERE status='running' AND locked_at < $1 AND attempts < $2 RETURNING id", [iso(t - TURNO_PRESO_MS), MAX_TENTATIVAS])).rowCount ?? 0;
  await pool.query("UPDATE ai_agent_jobs SET status='failed', finished_at=now(), note='O turno travou e esgotou as tentativas.' WHERE status='running' AND locked_at < $1 AND attempts >= $2", [iso(t - TURNO_PRESO_MS), MAX_TENTATIVAS]);
  const pegos = (await pool.query(
   `UPDATE ai_agent_jobs SET status='running', locked_at=$2, started_at=COALESCE(started_at,$2), attempts=attempts+1
     WHERE id IN (SELECT id FROM ai_agent_jobs WHERE status='queued' AND run_after <= $2 ORDER BY run_after LIMIT $1 FOR UPDATE SKIP LOCKED)
     RETURNING id,agent_id,instance,number,inbox_id,lead_id,attempts`, [lote, iso(t)])).rows;
  for (const job of pegos) {
   let r;
   try { r = await executarTurno({ db: pool, env, modelo, job, agora: () => new Date(agora()) }); }
   catch (e) { console.error('[agentes] turno falhou:', e?.message); r = { resultado: 'falhou', motivo: 'Erro interno no turno.', repetir: true, ferramentas: [], uso: { input: 0, output: 0 } }; }
   const dados = [JSON.stringify(r.ferramentas ?? []), r.uso?.input ?? 0, r.uso?.output ?? 0, r.modelo ?? null, r.resposta ?? null, String(r.motivo ?? '').slice(0, 500) || null, job.id];
   if (r.resultado === 'falhou' && r.repetir && job.attempts < MAX_TENTATIVAS) {
    await pool.query("UPDATE ai_agent_jobs SET status='queued', locked_at=NULL, run_after=$2, note=$3 WHERE id=$1", [job.id, iso(agora() + REPETE_EM_MS * job.attempts), String(r.motivo).slice(0, 500)]);
    saida.adiados++;
    continue;
   }
   await pool.query(`UPDATE ai_agent_jobs SET status=$8, locked_at=NULL, finished_at=now(), tools_used=$1::jsonb, input_tokens=input_tokens+$2, output_tokens=output_tokens+$3, model=$4, reply=$5, note=$6 WHERE id=$7`, [...dados, r.resultado === 'respondeu' ? 'done' : r.resultado === 'pulou' ? 'skipped' : 'failed']);
   if (r.resultado === 'respondeu') saida.respondidos++; else if (r.resultado === 'pulou') saida.pulados++; else saida.falhas++;
  }
 } catch (e) {
  if (e?.code === '42P01' || e?.code === '42703') return { ...saida, indisponivel: true };
  console.error('[agentes] ciclo falhou:', e?.message);
  return { ...saida, erro: true };
 }
 return saida;
}

/** Liga o consumidor. Ciclos não se sobrepõem; o temporizador não segura o processo vivo. Devolve a função que desliga. */
export function iniciarAgentes({ pool, env = vivo.env, log = console, cadaMs = 5000 } = {}) {
 let ocupado = false;
 const ciclo = async () => {
  if (ocupado) return;
  ocupado = true;
  try {
   await vivo.garantir(pool);
   const r = await processarTurnos(pool, { env });
   if (r.respondidos || r.falhas) log.log(`[agentes] ${JSON.stringify(r)}`);
  } catch (e) { log.error('[agentes] falhou:', e?.message); }
  finally { ocupado = false; }
 };
 const t = setInterval(ciclo, cadaMs); t.unref?.();
 return () => clearInterval(t);
}

export function agentesExecucaoRoutes(router, { env = vivo.env } = {}) {
 const padrao = () => String(env.EVOLUTION_INSTANCE ?? '').trim();
 const instanciaDe = v => { const x = v == null || v === '' ? padrao() : String(v); if (!INSTANCIA.test(x) && x !== '') throw fail(400, 'Instância inválida.'); return x; };

 // O que a tela de agentes mostra: se a execução está ligada, se há chave e os últimos turnos.
 router.get('/api/whatsapp/agents/execucao', async ({ pool, reply, operator }) => {
  await commercialPermission(pool, operator);
  const estado = { ligada: execucaoLigada(env), com_chave: createAnthropicAdapter({ env }).configured, envio_ligado: String(env.WHATSAPP_ENVIO ?? '').trim().toLowerCase() === 'ligado' };
  try {
   const turnos = (await pool.query(
    `SELECT j.id,j.status,j.instance,j.number,j.model,j.input_tokens,j.output_tokens,j.tools_used,j.reply,j.note,j.attempts,j.created_at,j.finished_at,a.name AS agent_name
       FROM ai_agent_jobs j JOIN ai_agents a ON a.id=j.agent_id ORDER BY j.created_at DESC LIMIT 30`)).rows;
   reply(200, { disponivel: true, ...estado, turnos });
  } catch (e) { if (e?.code === '42P01') return reply(200, { disponivel: false, ...estado, turnos: [], aviso: 'A execução dos agentes ainda não está disponível neste banco: falta aplicar a migração 066.' }); throw e; }
 }, { body: false });

 // Assumir: a conversa passa a ser de uma pessoa e nenhum agente responde nela.
 router.post('/api/whatsapp/conversations/:number/assumir', async ({ client, params, url, operator }) => {
  await commercialPermission(client, operator, true);
  if (!NUMERO.test(params.number)) throw fail(400, 'Número inválido.');
  onlyParams(url.searchParams, ['instance']);
  const instancia = instanciaDe(url.searchParams.get('instance'));
  try {
   await client.query("INSERT INTO ai_handoffs(instance,number,reason,created_by) VALUES($1,$2,'manual',$3) ON CONFLICT DO NOTHING", [instancia, params.number, ator(operator)]);
   return { response: { ok: true } };
  } catch (e) { if (e?.code === '42P01') throw fail(409, 'A execução dos agentes ainda não está disponível neste banco: falta aplicar a migração 066.'); throw e; }
 }, { transactional: true, body: false, audit: false });

 // Devolver ao agente: fecha a passagem. O agente volta a responder a partir da próxima mensagem do lead.
 router.post('/api/whatsapp/conversations/:number/devolver', async ({ client, params, url, operator }) => {
  await commercialPermission(client, operator, true);
  if (!NUMERO.test(params.number)) throw fail(400, 'Número inválido.');
  onlyParams(url.searchParams, ['instance']);
  const instancia = instanciaDe(url.searchParams.get('instance'));
  try {
   const r = await client.query('UPDATE ai_handoffs SET released_at=now(), released_by=$3 WHERE instance=$1 AND number=$2 AND released_at IS NULL', [instancia, params.number, ator(operator)]);
   return { response: { ok: true, devolvidas: r.rowCount ?? 0 } };
  } catch (e) { if (e?.code === '42P01') throw fail(409, 'A execução dos agentes ainda não está disponível neste banco: falta aplicar a migração 066.'); throw e; }
 }, { transactional: true, body: false, audit: false });
}
