import { randomUUID } from 'node:crypto';
import { fail, isUuid } from '../platform/http.mjs';
import { commercialPermission } from './commercial-keys.mjs';
import { createEvolutionAdapter, mensagensDaPessoa } from '../integrations/evolution.mjs';
import { enfileirar, carregarLead } from '../platform/whatsapp-saida.mjs';
import { emitEvent, EVENTS } from '../platform/automations.mjs';
import { vivo } from '../platform/env-vivo.mjs';
import { validarFluxo, validarDados, iniciarFluxo, textoDoPasso, JANELA_FINAL_MIN, ESPERA_EM_TESTE_MIN, MENSAGEM_070, GATILHOS_DE_FLUXO } from '../platform/fluxos.mjs';

// O motor dos fluxos de WhatsApp e as rotas da aba "Fluxos". Desenho: docs/WHATSAPP-FLUXOS-DESENHO.md (seção 4.0).
//
// COMO ANDA: a cada ciclo (15 s) o consumidor pega as execuções que já podem andar (`run_after` chegou) e, em UMA transação por execução:
//  1. Se o fluxo manda parar quando a pessoa responde e já enviou algo, confere se ela respondeu (primeiro no banco, que o webhook enche;
//     sem webhook, pergunta à Evolution). Respondeu: encerra e emite `fluxo.respondeu` para as automações.
//  2. Anda os passos: MENSAGEM só ENFILEIRA em whatsapp_outbox (a fila já cuida de ritmo, bloqueio e do interruptor WHATSAPP_ENVIO; o fluxo
//     nunca fala com a Evolution para enviar); ESPERA grava a hora do próximo passo e sai, e a espera sobrevive a reinício.
//  3. Acabando os passos, observa por 24 h: se a pessoa respondeu, `respondeu`; senão `sem_resposta` (e emite `fluxo.sem_resposta`).
// EM TESTE o fluxo anda inteiro mas NÃO enfileira nada: só registra o que enviaria, e cada espera vale no máximo 1 minuto.
// Número que pediu para não receber nunca recebe: o fluxo encerra com o motivo.

const RESERVA_PRESA_MS = 5 * 60000;
const MAX_TENTATIVAS = 5;
const iso = ms => new Date(ms).toISOString();
const previa = t => (t.length > 60 ? `${t.slice(0, 57)}…` : t);
const acrescentar = (log, entrada) => [...(Array.isArray(log) ? log : []), entrada].slice(-40);
const ator = o => o?.email || o?.subject || 'desconhecido';

async function comTransacao(pool, fn) {
 const client = await pool.connect();
 try { await client.query('BEGIN'); const r = await fn(client); await client.query('COMMIT'); return r; }
 catch (e) { await client.query('ROLLBACK').catch(() => {}); throw e; }
 finally { client.release(); }
}

/** A pessoa escreveu depois que o fluxo começou? Primeiro o banco (webhook); sem resposta lá, a própria Evolution. */
async function respondeu(db, run, { env, criarAdaptador }) {
 const desde = new Date(run.started_at).getTime();
 try {
  if ((await db.query('SELECT 1 FROM whatsapp_inbox WHERE right(from_number, 8) = $1 AND received_at > $2 LIMIT 1', [run.number.slice(-8), iso(desde)])).rows.length) return true;
 } catch (e) { if (e?.code !== '42P01' && e?.code !== '42703') throw e; }
 const ad = criarAdaptador({ env, instance: run.instance || String(env.EVOLUTION_INSTANCE ?? '').trim() });
 if (!ad.configured) return false;
 const r = await mensagensDaPessoa(ad, { telefone: run.number, page: 1, offset: 20 });
 return r.ok && r.messages.some(m => !m.fromMe && m.timestamp && m.timestamp * 1000 > desde);
}

async function valoresDaPessoa(client, run) {
 if (run.lead_id) { const l = await carregarLead(client, run.space_id, run.lead_id); return { nome: l.nome, valores: l.valores }; }
 const produto = (await client.query('SELECT name FROM products WHERE id=$1', [run.space_id])).rows[0]?.name ?? '';
 const nome = String(run.input?.nome_informado ?? '').trim();
 return { nome, valores: { name: nome, first_name: nome.split(/\s+/)[0] || '', email: '', whatsapp: run.number, company_name: '', product_name: produto } };
}

async function emitirDoFluxo(client, run, evento, emitir) {
 if (!run.lead_id) return;
 const l = (await client.query('SELECT tenant_id, pipeline_id, stage_id FROM commercial_leads WHERE id=$1', [run.lead_id])).rows[0];
 if (l) await emitir(client, evento, { spaceId: run.space_id, tenantId: l.tenant_id, leadId: run.lead_id, pipelineId: l.pipeline_id, stageId: l.stage_id });
}

/** Anda UMA execução, dentro da transação do chamador. Devolve o que aconteceu: enviou | esperando | respondeu | sem_resposta | suprimido | erro | concluido. */
export async function avancar(client, run, { env, agora, criarAdaptador, emitir }) {
 const t = agora();
 const passos = Array.isArray(run.steps) ? run.steps : [];
 const dados = run.input ?? {};
 let i = run.step, log = run.log, ultimo = run.last_sent_at ? new Date(run.last_sent_at).getTime() : null, enviou = 0;
 const salvar = (campos, params) => client.query(`UPDATE whatsapp_flow_runs SET ${campos}, log=$2::jsonb, attempts=0, locked_at=NULL WHERE id=$1`, [run.id, JSON.stringify(log), ...params]);
 const encerrar = async (status, outcome, nota, evento) => {
  log = acrescentar(log, { em: iso(t), nota });
  await salvar('status=$3, outcome=$4, step=$5, last_sent_at=$6, finished_at=$7', [status, outcome, i, ultimo ? iso(ultimo) : null, iso(t)]);
  if (evento) await emitirDoFluxo(client, run, evento, emitir);
  return outcome ?? 'concluido';
 };

 // 1) respondeu? (só depois de ter enviado algo; quem não manda parar ao responder segue até o fim)
 if (run.stop_on_reply && ultimo && await respondeu(client, run, { env, criarAdaptador })) return encerrar('stopped', 'respondeu', 'A pessoa respondeu: fluxo encerrado.', 'fluxo.respondeu');
 // Na janela final (já mandou tudo) e sem resposta: é o resultado.
 if (i >= passos.length) return run.stop_on_reply ? encerrar('done', 'sem_resposta', 'Sem resposta depois de todas as mensagens.', 'fluxo.sem_resposta') : encerrar('done', null, 'Fluxo concluído.', null);

 // 2) passos
 let pessoa = null;
 while (i < passos.length) {
  const p = passos[i];
  if (p.tipo === 'espera') {
   const minutos = run.dry_run ? Math.min(p.minutos, ESPERA_EM_TESTE_MIN) : p.minutos;
   i++; log = acrescentar(log, { em: iso(t), nota: `Espera de ${p.minutos} min${run.dry_run ? ' (em teste vale 1 min)' : ''}` });
   await salvar('step=$3, run_after=$4, last_sent_at=$5', [i, iso(t + minutos * 60000), ultimo ? iso(ultimo) : null]);
   return enviou ? 'enviou' : 'esperando';
  }
  if (!run.dry_run && (await client.query('SELECT 1 FROM whatsapp_suppressions WHERE number=$1 AND revoked_at IS NULL', [run.number])).rows.length)
   return encerrar('stopped', 'suprimido', 'Este número pediu para não receber mensagens: fluxo encerrado.', null);
  pessoa ??= await valoresDaPessoa(client, run);
  const texto = textoDoPasso(p, pessoa.valores, dados);
  if (!texto) return encerrar('failed', 'erro', `A mensagem do passo ${i + 1} ficou vazia depois de preencher os dados.`, null);
  if (!run.dry_run) await enfileirar(client, { chave: `fluxo:${run.id}:${i}`, tipo: 'lead', produto: run.space_id, evento: 'fluxo', automacao: run.automation_id, lead: run.lead_id, para: run.number, nome: pessoa.nome, texto, por: `fluxo:${run.id}`, instancia: run.instance });
  log = acrescentar(log, { em: iso(t), nota: `${run.dry_run ? 'Teste, não enviada' : 'Na fila'}: ${previa(texto)}` });
  ultimo = t; i++; enviou++;
 }
 // 3) acabaram os passos: sem "parar ao responder", acabou; com ele, observa por 24 h antes de dar o resultado
 if (!run.stop_on_reply) return encerrar('done', null, 'Fluxo concluído.', null);
 const janela = run.dry_run ? ESPERA_EM_TESTE_MIN : JANELA_FINAL_MIN;
 log = acrescentar(log, { em: iso(t), nota: `Todas as mensagens enviadas: observando por ${run.dry_run ? '1 min (teste)' : '24 h'} se a pessoa responde.` });
 await salvar('step=$3, run_after=$4, last_sent_at=$5', [i, iso(t + janela * 60000), iso(ultimo)]);
 return 'enviou';
}

/** Um ciclo do consumidor. Nunca lança: devolve o que fez. */
export async function processarFluxos(pool, { env = vivo.env, agora = Date.now, lote = 10, criarAdaptador = createEvolutionAdapter, emitir = emitEvent } = {}) {
 const t = agora();
 const saida = { andaram: 0, enviaram: 0, esperando: 0, respondeu: 0, sem_resposta: 0, suprimidos: 0, falhas: 0 };
 try {
  const pegas = (await pool.query(
   `UPDATE whatsapp_flow_runs SET locked_at=$2, attempts=attempts+1
     WHERE id IN (SELECT id FROM whatsapp_flow_runs WHERE status='running' AND run_after <= $2 AND (locked_at IS NULL OR locked_at < $3) ORDER BY run_after LIMIT $1 FOR UPDATE SKIP LOCKED)
     RETURNING *`, [lote, iso(t), iso(t - RESERVA_PRESA_MS)])).rows;
  for (const run of pegas) {
   try {
    const r = await comTransacao(pool, client => avancar(client, run, { env, agora, criarAdaptador, emitir }));
    saida.andaram++;
    if (r === 'enviou') saida.enviaram++; else if (r === 'esperando') saida.esperando++; else if (r === 'respondeu') saida.respondeu++; else if (r === 'sem_resposta') saida.sem_resposta++; else if (r === 'suprimido') saida.suprimidos++; else if (r === 'erro') saida.falhas++;
   } catch (e) {
    // Erro nosso ou da Evolution: a transação foi desfeita; tenta de novo em 1 min e desiste depois de 5 tentativas.
    console.error('[fluxos] execução falhou:', e?.message);
    saida.falhas++;
    await pool.query(
     `UPDATE whatsapp_flow_runs SET locked_at=NULL, run_after=$2,
        status=CASE WHEN attempts >= $3 THEN 'failed' ELSE status END, outcome=CASE WHEN attempts >= $3 THEN 'erro' ELSE outcome END,
        finished_at=CASE WHEN attempts >= $3 THEN $4::timestamptz ELSE finished_at END,
        log=$5::jsonb WHERE id=$1`,
     [run.id, iso(t + 60000), MAX_TENTATIVAS, iso(t), JSON.stringify(acrescentar(run.log, { em: iso(t), nota: `Falhou: ${String(e?.message ?? 'erro').slice(0, 120)}` }))]).catch(() => {});
   }
  }
 } catch (e) {
  if (e?.code === '42P01' || e?.code === '42703') return { ...saida, indisponivel: true };   // migração 070 ainda não aplicada
  console.error('[fluxos] ciclo falhou:', e?.message);
  return { ...saida, erro: true };
 }
 return saida;
}

/** Liga o consumidor. Ciclos não se sobrepõem; o temporizador não segura o processo vivo. Devolve a função que desliga. */
export function iniciarFluxosDeWhatsapp({ pool, env = vivo.env, log = console, cadaMs = 15000 } = {}) {
 let ocupado = false;
 const ciclo = async () => {
  if (ocupado) return;
  ocupado = true;
  try {
   await vivo.garantir(pool);
   const r = await processarFluxos(pool, { env });
   if (r.andaram || r.falhas) log.log(`[fluxos] ${JSON.stringify(r)}`);
  } catch (e) { log.error('[fluxos] falhou:', e?.message); }
  finally { ocupado = false; }
 };
 const t = setInterval(ciclo, cadaMs); t.unref?.();
 return () => clearInterval(t);
}

const COLUNAS = 'f.id, f.space_id, p.name AS space_name, f.name, f.status, f.stop_on_reply, f.instance, f.steps, f.version, f.updated_at, f.automation_id';
const ESPACOS_SQL = "SELECT id, name FROM products WHERE lifecycle_status IN ('active','draft') AND portfolio_kind IN ('product','platform','service_line','advisory') ORDER BY name";

/** Funis ativos com as etapas de cada um (para escolher o gatilho). */
async function funisComEtapas(db) {
 const funis = (await db.query('SELECT p.id, p.name, p.space_id, pr.name AS space_name FROM pipelines p JOIN products pr ON pr.id=p.space_id WHERE p.is_active ORDER BY pr.name, p.position, p.name')).rows;
 if (!funis.length) return [];
 const etapas = (await db.query('SELECT id, pipeline_id, name FROM pipeline_stages WHERE pipeline_id = ANY($1::uuid[]) ORDER BY position', [funis.map(f => f.id)])).rows;
 return funis.map(f => ({ ...f, etapas: etapas.filter(e => e.pipeline_id === f.id).map(e => ({ id: e.id, name: e.name })) }));
}

/** Todos os fluxos, com o resultado de cada um, o gatilho (da automação por trás) e o que a tela precisa para montar o formulário. */
export async function listarFluxos(db) {
 const espacos = (await db.query(ESPACOS_SQL)).rows, funis = await funisComEtapas(db);
 try {
  const fluxos = (await db.query(
   `SELECT ${COLUNAS}, a.trigger_event AS gatilho_evento, a.pipeline_id AS gatilho_funil, a.stage_id AS gatilho_etapa, a.is_enabled AS gatilho_ativo,
      (SELECT count(*)::int FROM whatsapp_flow_runs r WHERE r.flow_id = f.id AND r.status = 'running') AS em_andamento,
      (SELECT count(*)::int FROM whatsapp_flow_runs r WHERE r.flow_id = f.id AND NOT r.dry_run) AS iniciados,
      (SELECT count(*)::int FROM whatsapp_flow_runs r WHERE r.flow_id = f.id AND NOT r.dry_run AND r.outcome = 'respondeu') AS responderam,
      (SELECT count(*)::int FROM whatsapp_flow_runs r WHERE r.flow_id = f.id AND NOT r.dry_run AND r.outcome = 'sem_resposta') AS sem_resposta
      FROM whatsapp_flows f JOIN products p ON p.id = f.space_id LEFT JOIN automations a ON a.id = f.automation_id ORDER BY p.name, lower(f.name)`)).rows
   .map(({ gatilho_evento, gatilho_funil, gatilho_etapa, gatilho_ativo, ...f }) => ({ ...f, gatilho: gatilho_evento ? { event: gatilho_evento, pipeline_id: gatilho_funil, stage_id: gatilho_etapa, ativo: gatilho_ativo } : null }));
  return { disponivel: true, fluxos, espacos, funis, eventos: Object.fromEntries(GATILHOS_DE_FLUXO.map(e => [e, EVENTS[e]])) };
 } catch (e) { if (e?.code === '42P01') return { disponivel: false, fluxos: [], espacos, funis, eventos: {}, aviso: MENSAGEM_070 }; throw e; }
}

/** O gatilho do fluxo vira (ou atualiza) uma automação do espaço, que inicia o fluxo. Sem gatilho, a automação por trás é desligada. */
async function manterGatilho(client, { flowId, spaceId, nome, status, gatilho, automationId }) {
 const ligada = ['teste', 'ativo'].includes(status);
 if (!gatilho) { if (automationId) await client.query('UPDATE automations SET is_enabled=false, version=version+1, updated_at=now() WHERE id=$1', [automationId]); return automationId; }
 if (gatilho.pipeline_id) {
  const f = (await client.query('SELECT space_id FROM pipelines WHERE id=$1 AND is_active', [gatilho.pipeline_id])).rows[0];
  if (!f || f.space_id !== spaceId) throw fail(400, 'O funil do gatilho não é deste espaço (ou está arquivado).');
 }
 if (gatilho.stage_id && !(await client.query('SELECT 1 FROM pipeline_stages WHERE id=$1 AND pipeline_id=$2', [gatilho.stage_id, gatilho.pipeline_id])).rowCount) throw fail(400, 'A etapa do gatilho não é deste funil.');
 const acoes = JSON.stringify([{ action: 'fluxo.iniciar', flow_id: flowId, dados: {} }]);
 const titulo = `Fluxo: ${nome}`.slice(0, 120);
 if (automationId) {
  await client.query('UPDATE automations SET name=$2, trigger_event=$3, pipeline_id=$4, stage_id=$5, actions=$6::jsonb, is_enabled=$7, version=version+1, updated_at=now() WHERE id=$1',
   [automationId, titulo, gatilho.event, gatilho.pipeline_id, gatilho.stage_id, acoes, ligada]);
  return automationId;
 }
 const r = await client.query('INSERT INTO automations(space_id,pipeline_id,stage_id,name,trigger_event,actions,is_enabled) VALUES($1,$2,$3,$4,$5,$6::jsonb,$7) RETURNING id',
  [spaceId, gatilho.pipeline_id, gatilho.stage_id, titulo, gatilho.event, acoes, ligada]);
 return r.rows[0].id;
}

/** Cria (sem `id`) ou edita um fluxo, com o gatilho. Dentro da transação de quem chama. Lança 400/404/409 com mensagem para a tela. */
export async function salvarFluxo(client, { id = null, body, por = null }) {
 const f = validarFluxo(body);
 try {
  if (!id) {
   if (f.status === 'arquivado') throw fail(400, 'Um fluxo novo não nasce arquivado.');
   if (!(await client.query(ESPACOS_SQL)).rows.some(e => e.id === body.space_id)) throw fail(400, 'Espaço inválido.');
   const r = await client.query('INSERT INTO whatsapp_flows(space_id,name,status,stop_on_reply,instance,steps,created_by) VALUES($1,$2,$3,$4,$5,$6,$7) RETURNING id',
    [body.space_id, f.name, f.status, f.stop_on_reply, f.instance, JSON.stringify(f.steps), por]);
   const automationId = await manterGatilho(client, { flowId: r.rows[0].id, spaceId: body.space_id, nome: f.name, status: f.status, gatilho: f.gatilho, automationId: null });
   if (automationId) await client.query('UPDATE whatsapp_flows SET automation_id=$2 WHERE id=$1', [r.rows[0].id, automationId]);
   return { id: r.rows[0].id };
  }
  const antigo = (await client.query('SELECT id, space_id, version, automation_id FROM whatsapp_flows WHERE id=$1 FOR UPDATE', [id])).rows[0];
  if (!antigo) throw fail(404, 'Fluxo não encontrado.');
  if (body.version !== antigo.version) throw fail(409, 'Fluxo alterado em outra sessão. Reabra a tela.');
  if (body.space_id && body.space_id !== antigo.space_id) throw fail(400, 'O espaço de um fluxo não muda: crie outro fluxo.');
  // Quem já está dentro termina com os passos de quando entrou (cada execução guarda a própria cópia).
  await client.query('UPDATE whatsapp_flows SET name=$2,status=$3,stop_on_reply=$4,instance=$5,steps=$6,version=version+1,updated_at=now() WHERE id=$1',
   [id, f.name, f.status, f.stop_on_reply, f.instance, JSON.stringify(f.steps)]);
  const automationId = await manterGatilho(client, { flowId: id, spaceId: antigo.space_id, nome: f.name, status: f.status, gatilho: f.gatilho, automationId: antigo.automation_id });
  if (automationId && automationId !== antigo.automation_id) await client.query('UPDATE whatsapp_flows SET automation_id=$2 WHERE id=$1', [id, automationId]);
  return { id, ok: true };
 } catch (e) {
  if (e?.code === '42P01') throw fail(409, MENSAGEM_070);
  if (e?.code === '23505') throw fail(409, 'Já existe um fluxo com este nome neste espaço.');
  throw e;
 }
}

export function whatsappFluxosRoutes(router) {
 const uuid = v => { if (!isUuid(v)) throw fail(400, 'Identificador inválido.'); return v; };

 router.get('/api/whatsapp/fluxos', async ({ pool, reply, operator }) => {
  await commercialPermission(pool, operator);
  reply(200, await listarFluxos(pool));
 }, { body: false });

 router.post('/api/whatsapp/fluxos', async ({ client, body, operator }) => {
  await commercialPermission(client, operator, true);
  return { body: await salvarFluxo(client, { body, por: ator(operator) }) };
 }, { transactional: true, audit: false });

 router.put('/api/whatsapp/fluxos/:id', async ({ client, params, body, operator }) => {
  await commercialPermission(client, operator, true);
  uuid(params.id);
  return { body: await salvarFluxo(client, { id: params.id, body, por: ator(operator) }) };
 }, { transactional: true, audit: false });

 // As últimas execuções: quem está no fluxo, em que passo, o que já aconteceu e o resultado.
 router.get('/api/whatsapp/fluxos/:id/execucoes', async ({ pool, params, reply, operator }) => {
  await commercialPermission(pool, operator);
  uuid(params.id);
  try {
   const execucoes = (await pool.query(
    `SELECT r.id, r.lead_id, l.name AS lead_name, r.number, r.status, r.outcome, r.step, jsonb_array_length(r.steps) AS passos, r.dry_run, r.run_after, r.started_at, r.finished_at, r.log
       FROM whatsapp_flow_runs r LEFT JOIN commercial_leads l ON l.id = r.lead_id WHERE r.flow_id = $1 ORDER BY r.started_at DESC LIMIT 30`, [params.id])).rows;
   reply(200, { execucoes });
  } catch (e) { if (e?.code === '42P01') return reply(200, { execucoes: [], aviso: MENSAGEM_070 }); throw e; }
 }, { body: false });

 // Início manual para TESTAR: um número seu, sem lead. Só em fluxo em teste ou ativo.
 router.post('/api/whatsapp/fluxos/:id/iniciar-teste', async ({ client, params, body, operator }) => {
  await commercialPermission(client, operator, true);
  uuid(params.id);
  return { body: await iniciarTeste(client, { id: params.id, numero: body?.number, nome: body?.name, dados: body?.dados }) };
 }, { transactional: true, audit: false });
}

/** Início manual de um fluxo para um número, sem lead. Em teste não envia nada; em ativo envia de verdade. */
export async function iniciarTeste(client, { id, numero, nome, dados }) {
 const f = (await client.query('SELECT id, space_id, status FROM whatsapp_flows WHERE id=$1', [id]).catch(e => { if (e?.code === '42P01') throw fail(409, MENSAGEM_070); throw e; })).rows[0];
 if (!f) throw fail(404, 'Fluxo não encontrado.');
 if (!['teste', 'ativo'].includes(f.status)) throw fail(409, 'Coloque o fluxo em teste ou ativo para iniciar.');
 const limpos = validarDados(dados);
 try { return { ok: true, mensagem: await iniciarFluxo(client, { flowId: f.id, spaceId: f.space_id, numero, nome: nome ?? '', dados: limpos, evento: 'manual', chave: `fluxo:manual:${randomUUID()}` }) }; }
 catch (e) { throw fail(400, e.message); }
}
