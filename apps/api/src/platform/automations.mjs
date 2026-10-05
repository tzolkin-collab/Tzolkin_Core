import { fail, input, isUuid, isProductId, text } from './http.mjs';
import { enfileirarParaLead } from './email-saida.mjs';

// Eventos e automações (fase 5). Regras puras: o catálogo de eventos e de ações, a validação das ações e o
// motor `emitEvent`, que roda as automações ligadas a um evento dentro da transação de quem emitiu.
//
// Princípios copiados da Kalidash (gatilhos-personalizados.md §2): a automação nunca substitui o manual e nunca
// faz o que a regra manual não deixaria; falha de automação nunca derruba a ação que a disparou.

export const EVENTS = Object.freeze({
 'lead.criado': 'Lead criado',
 'lead.mudou_de_etapa': 'Lead mudou de etapa',
 'lead.qualificado': 'Lead qualificado',
 'lead.descartado': 'Lead descartado',
 'lead.restaurado': 'Lead restaurado',
 'oportunidade.criada': 'Oportunidade criada',
 'oportunidade.mudou_de_etapa': 'Oportunidade mudou de etapa',
 'oportunidade.ganha': 'Oportunidade ganha',
 'oportunidade.perdida': 'Oportunidade perdida',
 'contratacao.criada': 'Contratação criada',
});

export const ACTIONS = Object.freeze({
 'tarefa.criar': 'Criar tarefa',
 'responsavel.atribuir': 'Atribuir responsável',
 'email.enviar': 'Enviar e-mail ao lead',
});
// Eventos em que existe um lead com e-mail para receber a mensagem.
export const EVENTOS_COM_LEAD = Object.freeze(['lead.criado', 'lead.mudou_de_etapa', 'lead.qualificado', 'lead.descartado', 'lead.restaurado']);
export const MAX_ACTIONS = 5;

/**
 * Valida a lista de ações de uma automação e devolve a forma normalizada. O atraso (`delay_days`) só existe para o
 * prazo da tarefa: não há agendador, então nenhuma outra ação pode "esperar".
 */
export function validateActions(actions) {
 if (!Array.isArray(actions) || actions.length < 1 || actions.length > MAX_ACTIONS) throw fail(400, `Informe de 1 a ${MAX_ACTIONS} ações.`);
 return actions.map(a => {
  if (!a || typeof a !== 'object' || Array.isArray(a)) throw fail(400, 'Ação inválida.');
  if (a.action === 'tarefa.criar') {
   input(a, ['action', 'title', 'tag', 'delay_days']);
   const delay = a.delay_days ?? 0;
   if (!Number.isInteger(delay) || delay < 0 || delay > 365) throw fail(400, 'O prazo da tarefa vai de 0 a 365 dias.');
   return { action: 'tarefa.criar', title: text(a.title, 2, 200), tag: a.tag == null || a.tag === '' ? 'Geral' : text(a.tag, 1, 40), delay_days: delay };
  }
  if (a.action === 'email.enviar') {
   input(a, ['action', 'template']);
   if (!isProductId(a.template)) throw fail(400, 'Escolha o template do e-mail.');
   return { action: 'email.enviar', template: a.template };
  }
  if (a.action === 'responsavel.atribuir') {
   input(a, ['action', 'owner_id']);
   if (!isUuid(a.owner_id)) throw fail(400, 'Escolha o responsável.');
   return { action: 'responsavel.atribuir', owner_id: a.owner_id };
  }
  throw fail(400, 'Ação desconhecida.');
 });
}

const ownerAtivo = async (client, id) =>
 (await client.query("SELECT 1 FROM operator_accounts WHERE id=$1 AND status='active' AND role IN ('owner','member')", [id])).rowCount > 0;

/** Executa uma ação sobre o registro do evento. Lança com mensagem clara; quem chama grava o resultado. */
async function runAction(client, action, ctx, automationId, event) {
 if (action.action === 'tarefa.criar') {
  if (!ctx.leadId && !ctx.opportunityId) throw new Error('Sem lead nem oportunidade para ligar a tarefa.');
  const due = action.delay_days > 0 ? new Date(Date.now() + action.delay_days * 86_400_000).toISOString() : null;
  await client.query(
   `INSERT INTO commercial_tasks(tenant_id,lead_id,opportunity_id,title,tag,due_at,source,automation_id) VALUES($1,$2,$3,$4,$5,$6,'automacao',$7)`,
   [ctx.tenantId, ctx.leadId ?? null, ctx.opportunityId ?? null, action.title, action.tag, due, automationId]);
  return `Tarefa "${action.title}" criada${due ? ` (prazo em ${action.delay_days} dias)` : ''}`;
 }
 if (action.action === 'responsavel.atribuir') {
  if (!(await ownerAtivo(client, action.owner_id))) throw new Error('O responsável escolhido não está mais ativo.');
  let alterados = 0;
  if (ctx.leadId) alterados += (await client.query('UPDATE commercial_leads SET owner_id=$2,version=version+1,updated_at=now() WHERE id=$1', [ctx.leadId, action.owner_id])).rowCount;
  if (ctx.opportunityId) alterados += (await client.query('UPDATE commercial_opportunities SET owner_id=$2,version=version+1,updated_at=now() WHERE id=$1', [ctx.opportunityId, action.owner_id])).rowCount;
  if (!alterados) throw new Error('Sem lead nem oportunidade para atribuir.');
  return 'Responsável atribuído';
 }
 if (action.action === 'email.enviar') {
  if (!ctx.leadId) throw new Error('Enviar e-mail só funciona em evento de lead.');
  // Não envia: grava na fila, na MESMA transação do evento. Quem envia é o consumidor da fila.
  return enfileirarParaLead(client, { modelo: action.template, spaceId: ctx.spaceId, leadId: ctx.leadId, automationId, evento: event });
 }
 throw new Error(`Ação desconhecida: ${action.action}`);
}

/**
 * Emite um evento e roda as automações ligadas a ele: do mesmo espaço, do funil e da etapa quando a automação filtra.
 * Cada automação roda dentro do próprio savepoint: se uma ação falhar, desfaz só aquela automação e registra FAILED; as
 * outras e a gravação de quem emitiu seguem. O motor inteiro também é blindado: qualquer erro nele (por exemplo, migração
 * 044 ainda não aplicada) é registrado no log e nunca derruba a transação, porque o intake do site passa por aqui.
 *
 * `ctx`: { spaceId, tenantId, leadId?, opportunityId?, pipelineId?, stageId? }. Devolve quantas automações rodaram.
 */
export async function emitEvent(client, event, ctx) {
 if (!EVENTS[event]) throw new Error(`Evento desconhecido: ${event}`);
 try {
  await client.query('SAVEPOINT emit_event');
  const lista = (await client.query(
   `SELECT id,name,actions FROM automations
     WHERE is_enabled AND trigger_event=$1 AND space_id=$2
       AND (pipeline_id IS NULL OR pipeline_id=$3) AND (stage_id IS NULL OR stage_id=$4)
     ORDER BY created_at,id`, [event, ctx.spaceId, ctx.pipelineId ?? null, ctx.stageId ?? null])).rows;
  let rodadas = 0;
  for (const auto of lista) {
   const notas = []; let resultado = 'OK';
   await client.query('SAVEPOINT automacao');
   try {
    for (const acao of auto.actions) notas.push(await runAction(client, acao, ctx, auto.id, event));
    await client.query('RELEASE SAVEPOINT automacao');
   } catch (erro) {
    await client.query('ROLLBACK TO SAVEPOINT automacao');
    resultado = 'FAILED'; notas.length = 0; notas.push(String(erro.message || erro).slice(0, 500));
   }
   await client.query(
    'INSERT INTO automation_runs(automation_id,event,lead_id,opportunity_id,tenant_id,result,note) VALUES($1,$2,$3,$4,$5,$6,$7)',
    [auto.id, event, ctx.leadId ?? null, ctx.opportunityId ?? null, ctx.tenantId ?? null, resultado, notas.join(' · ').slice(0, 1000)]);
   rodadas += 1;
  }
  await client.query('RELEASE SAVEPOINT emit_event');
  return rodadas;
 } catch (erro) {
  try { await client.query('ROLLBACK TO SAVEPOINT emit_event'); await client.query('RELEASE SAVEPOINT emit_event'); } catch { /* a transação já caiu: quem chamou decide */ }
  console.error('[automacoes] evento', event, 'falhou:', erro?.message);
  return 0;
 }
}
