import { fail, input, isUuid, text } from '../platform/http.mjs';
import { commercialPermission } from './commercial-keys.mjs';
import { capabilitiesOf } from './catalog.mjs';
import { carryOver, fieldsOf } from '../platform/space-fields.mjs';
import { emitEvent } from '../platform/automations.mjs';

// Fase 3 do funil (plano de leads da Kalidash, adaptado: leadFlow.ts moveLeadStage / qualifyLead / discardLead /
// restoreLead, agora no servidor). O lead anda só entre as etapas de tipo LEAD; qualificar o transforma em
// oportunidade na primeira etapa aberta; descartar exige motivo; restaurar volta para aberto. Ganhar a oportunidade
// cria a contratação (`onOpportunityMoved`, chamado pela rota de mover oportunidade).
//
// O `status` de sempre do lead (open, qualified, won, lost, archived) continua sendo a verdade do ciclo e acompanha:
// qualificar = qualified, descartar ou perder = lost, ganhar = won. O histórico do lead guarda cada passo.
// Estas rotas não passam por audit_events (exige empresa e o lead já é auditado pela própria linha do histórico).

const MAX_MINOR = 100_000_000_000;
const MODELS = ['on_demand', 'education', 'consulting', 'advisory', 'product', 'unclassified'];

const uuid = v => { if (!isUuid(v)) throw fail(400, 'Identificador inválido.'); return v; };
const dateOrNull = v => {
 if (v == null || v === '') return null;
 const t = typeof v === 'string' ? Date.parse(v) : NaN;
 if (!Number.isFinite(t)) throw fail(400, 'Data inválida.');
 return new Date(t).toISOString();
};
const noteOrNull = v => {
 if (v == null || v === '') return null;
 if (typeof v !== 'string' || v.trim().length < 2 || v.length > 2000 || /[\u0000-\u0008\u000b\u000c\u000e-\u001f]/.test(v)) throw fail(400, 'Texto inválido.');
 return v.trim();
};

const log = (client, leadId, kind, operator, note, details) => client.query(
 'INSERT INTO commercial_activities(lead_id,kind,note,details,actor_subject,actor_email) VALUES($1,$2,$3,$4,$5,$6)',
 [leadId, kind, note, details, operator?.subject ?? 'sistema', operator?.email ?? null]);

async function lockedLead(client, id, version) {
 const lead = (await client.query('SELECT * FROM commercial_leads WHERE id=$1 FOR UPDATE', [uuid(id)])).rows[0];
 if (!lead) throw fail(404, 'Lead não encontrado.');
 if (version !== lead.version) throw fail(409, 'Lead alterado em outra sessão. Reabra o detalhe.');
 return lead;
}

async function lostReason(client, id) {
 const found = (await client.query('SELECT id,name FROM lost_reasons WHERE id=$1 AND is_active', [uuid(id ?? null)])).rows[0];
 if (!found) throw fail(400, 'Motivo de perda inválido.');
 return found;
}

async function activeOwner(client, id) {
 if (id == null) return null;
 if (!(await client.query("SELECT id FROM operator_accounts WHERE id=$1 AND status='active' AND role IN ('owner','member')", [uuid(id)])).rowCount)
  throw fail(400, 'Responsável inválido.');
 return id;
}

/**
 * Efeitos de mover uma oportunidade, no mesmo banco e na mesma transação da rota:
 *  - o lead de origem acompanha (ganho = won, perdido = lost com o motivo, aberta = qualified);
 *  - ganhar cria a contratação (uma só, mesmo que reabra e ganhe de novo) e promove a empresa de prospect a cliente.
 * Devolve o id da contratação quando houve (criada agora ou já existente), senão null.
 */
async function moveEffects(client, opp, to, reasonName, operator) {
 if (opp.lead_id) {
  const status = to.kind === 'WON' ? 'won' : to.kind === 'LOST' ? 'lost' : 'qualified';
  await client.query('UPDATE commercial_leads SET status=$2,loss_reason=$3,version=version+1,updated_at=now() WHERE id=$1',
   [opp.lead_id, status, to.kind === 'LOST' ? reasonName : null]);
  await log(client, opp.lead_id, 'opportunity_moved', operator, to.kind === 'LOST' ? reasonName : null, { opportunity_id: opp.id, stage_id: to.id, stage_name: to.name, kind: to.kind });
 }
 if (to.kind !== 'WON') return { engagementId: null, created: false };

 if (opp.engagement_id) return { engagementId: opp.engagement_id, created: false };
 const tenant = (await client.query('SELECT id,relationship_kind,lifecycle_status FROM tenants WHERE id=$1 FOR UPDATE', [opp.tenant_id])).rows[0];
 const space = (await client.query('SELECT pr.id,pr.portfolio_kind FROM pipelines p JOIN products pr ON pr.id=p.space_id WHERE p.id=$1', [opp.pipeline_id])).rows[0];
 const lead = opp.lead_id ? (await client.query('SELECT service_model FROM commercial_leads WHERE id=$1', [opp.lead_id])).rows[0] : null;
 // Contratação do tipo produto só existe em espaço que vende produto; nos demais, o tipo do lead que não serve vira não classificado.
 let model = lead && MODELS.includes(lead.service_model) ? lead.service_model : 'unclassified';
 if (model === 'product' && !capabilitiesOf(space.portfolio_kind).includes('product_engagement')) model = 'unclassified';

 // O rótulo é único por empresa: uma segunda venda com o mesmo título ganha " (2)", " (3)"…
 const base = opp.title.slice(0, 110);
 let label = base;
 for (let n = 2; (await client.query('SELECT 1 FROM client_engagements WHERE tenant_id=$1 AND label=$2', [opp.tenant_id, label])).rowCount; n += 1) label = `${base} (${n})`;
 // Os valores da oportunidade sobem para a contratação quando o espaço define o mesmo campo para ela.
 const customData = carryOver(await fieldsOf(client, space.id, 'engagement'), opp.custom_data);
 const engagement = (await client.query(
  `INSERT INTO client_engagements(tenant_id,product_id,service_model,status,label,source_system,source_ref,custom_data)
   VALUES($1,$2,$3,'active',$4,'commercial_opportunity',$5,$6)
   RETURNING id,tenant_id,product_id,service_model,status,label,revision,created_at,updated_at,archived_at,custom_data`,
  [opp.tenant_id, space.id, model, label, opp.id, customData])).rows[0];
 await client.query(
  `INSERT INTO portfolio_audit(entity,entity_id,action,before,after,actor_subject,actor_email) VALUES('engagement',$1,'created',NULL,$2,$3,$4)`,
  [engagement.id, engagement, operator?.subject ?? null, operator?.email ?? null]);
 await client.query('UPDATE commercial_opportunities SET engagement_id=$2 WHERE id=$1', [opp.id, engagement.id]);
 if (tenant.relationship_kind === 'prospect')
  await client.query("UPDATE tenants SET relationship_kind='customer',lifecycle_status=CASE WHEN lifecycle_status='lead' THEN 'onboarding' ELSE lifecycle_status END WHERE id=$1", [tenant.id]);
 if (opp.lead_id) await log(client, opp.lead_id, 'engagement_created', operator, null, { opportunity_id: opp.id, engagement_id: engagement.id, label });
 return { engagementId: engagement.id, created: true };
}

/** Efeitos de mover a oportunidade (lead acompanha, ganhar cria a contratação) e, depois, os eventos para as automações. */
export async function onOpportunityMoved(client, opp, to, reasonName, operator) {
 const { engagementId, created } = await moveEffects(client, opp, to, reasonName, operator);
 const space = (await client.query('SELECT space_id FROM pipelines WHERE id=$1', [opp.pipeline_id])).rows[0].space_id;
 const ctx = { spaceId: space, tenantId: opp.tenant_id, leadId: opp.lead_id, opportunityId: opp.id, pipelineId: opp.pipeline_id, stageId: to.id };
 await emitEvent(client, 'oportunidade.mudou_de_etapa', ctx);
 if (to.kind === 'WON') await emitEvent(client, 'oportunidade.ganha', ctx);
 if (to.kind === 'LOST') await emitEvent(client, 'oportunidade.perdida', ctx);
 if (created) await emitEvent(client, 'contratacao.criada', ctx);
 return engagementId;
}

export function commercialLeadflowRoutes(router) {
 // Mover o lead entre as etapas de tipo LEAD do funil dele. Ir para qualquer etapa que não seja a primeira conta como
 // o primeiro contato (grava a data uma vez). Qualquer movimento marca o lead como visto.
 router.put('/api/commercial/leads/:id/stage', async ({ client, params, body, operator }) => {
  await commercialPermission(client, operator, true);
  input(body, ['version', 'stage_id']);
  const lead = await lockedLead(client, params.id, body.version);
  if (lead.status !== 'open') throw fail(409, 'Só um lead aberto muda de etapa.');
  if (!lead.pipeline_id) throw fail(409, 'Este lead não está em um funil.');
  const to = (await client.query('SELECT id,name,kind,pipeline_id FROM pipeline_stages WHERE id=$1', [uuid(body.stage_id)])).rows[0];
  if (!to || to.pipeline_id !== lead.pipeline_id) throw fail(400, 'A etapa não pertence ao funil deste lead.');
  if (to.kind !== 'LEAD') throw fail(400, 'O lead só anda entre etapas de lead. Para seguir adiante, qualifique.');
  if (to.id === lead.stage_id) throw fail(400, 'O lead já está nesta etapa.');
  const from = lead.stage_id ? (await client.query('SELECT id,name FROM pipeline_stages WHERE id=$1', [lead.stage_id])).rows[0] : null;
  const first = (await client.query("SELECT id FROM pipeline_stages WHERE pipeline_id=$1 AND kind='LEAD' ORDER BY position LIMIT 1", [lead.pipeline_id])).rows[0];
  await client.query(
   `UPDATE commercial_leads SET stage_id=$2,was_seen=true,first_contact_at=CASE WHEN $3::boolean THEN COALESCE(first_contact_at,now()) ELSE first_contact_at END,version=version+1,updated_at=now() WHERE id=$1`,
   [lead.id, to.id, to.id !== first.id]);
  await log(client, lead.id, 'stage_changed', operator, null, { from: from && { id: from.id, name: from.name }, to: { id: to.id, name: to.name } });
  await emitEvent(client, 'lead.mudou_de_etapa', { spaceId: lead.product_id, tenantId: lead.tenant_id, leadId: lead.id, pipelineId: lead.pipeline_id, stageId: to.id });
  return { body: { ok: true } };
 }, { transactional: true, audit: false });

 // Qualificar: o lead vira oportunidade na primeira etapa aberta do funil dele, com o valor e o responsável informados
 // (ou os que o lead já tinha). Uma oportunidade por lead.
 router.post('/api/commercial/leads/:id/qualify', async ({ client, params, body, operator }) => {
  await commercialPermission(client, operator, true);
  input(body, ['version', 'value_minor', 'owner_id', 'expected_close_at']);
  const lead = await lockedLead(client, params.id, body.version);
  if (lead.status !== 'open') throw fail(409, 'Só um lead aberto pode ser qualificado.');
  if (!lead.pipeline_id) throw fail(409, 'Este lead não está em um funil.');
  const pipeline = (await client.query('SELECT id,is_active FROM pipelines WHERE id=$1', [lead.pipeline_id])).rows[0];
  if (!pipeline.is_active) throw fail(409, 'O funil deste lead está arquivado.');
  if ((await client.query('SELECT 1 FROM commercial_opportunities WHERE lead_id=$1', [lead.id])).rowCount) throw fail(409, 'Este lead já virou oportunidade.');
  const first = (await client.query("SELECT id,name FROM pipeline_stages WHERE pipeline_id=$1 AND kind='OPEN' ORDER BY position LIMIT 1", [pipeline.id])).rows[0];
  if (!first) throw fail(409, 'O funil não tem etapa aberta.');
  let value = body.value_minor ?? lead.estimated_value_minor ?? 0;
  value = Number(value);
  if (!Number.isInteger(value) || value < 0 || value > MAX_MINOR) throw fail(400, 'Valor inválido.');
  const owner = Object.hasOwn(body, 'owner_id') ? await activeOwner(client, body.owner_id) : lead.owner_id;
  const closes = Object.hasOwn(body, 'expected_close_at') ? dateOrNull(body.expected_close_at) : lead.expected_close_at;
  const org = (await client.query('SELECT name FROM tenants WHERE id=$1', [lead.tenant_id])).rows[0].name;
  // Os valores do lead sobem para a oportunidade quando o espaço define o mesmo campo (mesma chave e mesmo tipo).
  const customData = carryOver(await fieldsOf(client, lead.product_id, 'opportunity'), lead.custom_data);
  const title = (lead.interest && lead.interest !== 'Contato comercial' ? `${org} · ${lead.interest}` : org).slice(0, 200);
  const opp = (await client.query(
   `INSERT INTO commercial_opportunities(pipeline_id,stage_id,tenant_id,stakeholder_id,lead_id,title,value_minor,origin,owner_id,expected_close_at,custom_data)
    VALUES($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11) RETURNING id`,
   [pipeline.id, first.id, lead.tenant_id, lead.stakeholder_id, lead.id, title, value, lead.origin, owner, closes, customData])).rows[0];
  await client.query(
   `UPDATE commercial_leads SET status='qualified',owner_id=$2,estimated_value_minor=$3,expected_close_at=$4,was_seen=true,version=version+1,updated_at=now() WHERE id=$1`,
   [lead.id, owner, value || lead.estimated_value_minor, closes]);
  await log(client, lead.id, 'qualified', operator, null, { opportunity_id: opp.id, stage_id: first.id, stage_name: first.name, value_minor: value });
  await emitEvent(client, 'lead.qualificado', { spaceId: lead.product_id, tenantId: lead.tenant_id, leadId: lead.id, pipelineId: pipeline.id, stageId: lead.stage_id });
  await emitEvent(client, 'oportunidade.criada', { spaceId: lead.product_id, tenantId: lead.tenant_id, leadId: lead.id, opportunityId: opp.id, pipelineId: pipeline.id, stageId: first.id });
  return { body: { opportunity_id: opp.id } };
 }, { transactional: true, audit: false });

 // Descartar: sai do funil de leads com um motivo da lista. O lead continua no histórico e dá para restaurar.
 router.post('/api/commercial/leads/:id/discard', async ({ client, params, body, operator }) => {
  await commercialPermission(client, operator, true);
  input(body, ['version', 'lost_reason_id', 'note']);
  const lead = await lockedLead(client, params.id, body.version);
  if (lead.status !== 'open') throw fail(409, 'Só um lead aberto pode ser descartado.');
  const reason = await lostReason(client, body.lost_reason_id);
  await client.query("UPDATE commercial_leads SET status='lost',loss_reason=$2,version=version+1,updated_at=now() WHERE id=$1", [lead.id, reason.name]);
  await log(client, lead.id, 'discarded', operator, noteOrNull(body.note), { lost_reason_id: reason.id, reason: reason.name });
  await emitEvent(client, 'lead.descartado', { spaceId: lead.product_id, tenantId: lead.tenant_id, leadId: lead.id, pipelineId: lead.pipeline_id, stageId: lead.stage_id });
  return { body: { ok: true } };
 }, { transactional: true, audit: false });

 // Restaurar: volta a aberto um lead descartado que nunca virou oportunidade.
 router.post('/api/commercial/leads/:id/restore', async ({ client, params, body, operator }) => {
  await commercialPermission(client, operator, true);
  input(body, ['version']);
  const lead = await lockedLead(client, params.id, body.version);
  if (lead.status !== 'lost') throw fail(409, 'Só um lead descartado pode ser restaurado.');
  if ((await client.query('SELECT 1 FROM commercial_opportunities WHERE lead_id=$1', [lead.id])).rowCount) throw fail(409, 'Este lead virou oportunidade; reabra a oportunidade.');
  await client.query("UPDATE commercial_leads SET status='open',loss_reason=NULL,version=version+1,updated_at=now() WHERE id=$1", [lead.id]);
  await log(client, lead.id, 'restored', operator, null, { previous_reason: lead.loss_reason });
  await emitEvent(client, 'lead.restaurado', { spaceId: lead.product_id, tenantId: lead.tenant_id, leadId: lead.id, pipelineId: lead.pipeline_id, stageId: lead.stage_id });
  return { body: { ok: true } };
 }, { transactional: true, audit: false });

 router.get('/api/commercial/lost-reasons', async ({ pool, reply, operator }) => {
  await commercialPermission(pool, operator);
  return reply(200, { lost_reasons: (await pool.query('SELECT id,name FROM lost_reasons WHERE is_active ORDER BY name')).rows });
 });
}
