import { fail, input, isUuid, isProductId, onlyParams, text } from '../platform/http.mjs';
import { commercialPermission } from './commercial-keys.mjs';
import { capabilitiesOf } from './catalog.mjs';
import { onOpportunityMoved } from './commercial-leadflow.mjs';
import { emitEvent } from '../platform/automations.mjs';

// Funil por espaço (fase 1 do plano de leads da Kalidash, adaptada). Ver db/migrations/040_funil_por_espaco.sql
// e docs/design/2026-10-01-pipeline-por-espaco-e-atribuicao.md.
//
// Regras que moram aqui e só aqui:
//  - um funil pertence a um espaço com ciclo comercial; um espaço pode ter vários, e um deles é o padrão;
//  - as etapas têm tipo (LEAD, OPEN, WON, LOST) e ficam sempre nesta ordem; WON e LOST são únicas por funil;
//  - o funil sempre tem ao menos uma etapa de cada tipo, e etapa com registro dentro não se apaga;
//  - oportunidade nunca volta para etapa de lead; perder exige motivo; ganhar ou perder fecha, e reabrir limpa.
// Nenhuma rota daqui apaga funil: arquiva (is_active=false). O trabalho é auditado pelo versionamento de cada linha
// (audit_events exige empresa, e funil não tem empresa).

const SLUG = /^[a-z0-9][a-z0-9-]{0,39}$/;
const KINDS = ['LEAD', 'OPEN', 'WON', 'LOST'];
const RANK = { LEAD: 0, OPEN: 1, WON: 2, LOST: 3 };
const MAX_MINOR = 100_000_000_000;

/** Mesma lista da semente da migração 040 (um teste confere). [nome, tipo, probabilidade]. */
export const DEFAULT_STAGES = [
 ['Novos', 'LEAD', null], ['Em contato', 'LEAD', null],
 ['Qualificação', 'OPEN', 20], ['Proposta', 'OPEN', 40], ['Negociação', 'OPEN', 70], ['Assinatura do contrato', 'OPEN', 90],
 ['Ganho', 'WON', 100], ['Perdido', 'LOST', 0],
];

const uuid = v => { if (!isUuid(v)) throw fail(400, 'Identificador inválido.'); return v; };
const optionalText = (v, min, max) => (v == null || v === '' ? null : text(v, min, max));
const integer = (v, min, max, nome) => {
 if (v == null) return null;
 if (!Number.isInteger(v) || v < min || v > max) throw fail(400, `${nome} inválido.`);
 return v;
};
const dateOrNull = v => {
 if (v == null || v === '') return null;
 const t = typeof v === 'string' ? Date.parse(v) : NaN;
 if (!Number.isFinite(t)) throw fail(400, 'Data inválida.');
 return new Date(t).toISOString();
};
const hexColor = v => {
 if (v == null || v === '') return null;
 if (typeof v !== 'string' || !/^#[0-9a-fA-F]{6}$/.test(v)) throw fail(400, 'Cor inválida (use #RRGGBB).');
 return v;
};

export async function spaceOf(client, id) {
 if (!isProductId(id)) throw fail(400, 'Espaço inválido.');
 const row = (await client.query("SELECT id,name,portfolio_kind FROM products WHERE id=$1 AND lifecycle_status IN ('active','draft')", [id])).rows[0];
 if (!row) throw fail(404, 'Espaço não encontrado.');
 if (!capabilitiesOf(row.portfolio_kind).includes('commercial')) throw fail(409, 'Este espaço não tem ciclo comercial.');
 return row;
}

async function activeOwner(client, id) {
 if (id == null) return null;
 if (!(await client.query("SELECT id FROM operator_accounts WHERE id=$1 AND status='active' AND role IN ('owner','member')", [uuid(id)])).rowCount)
  throw fail(400, 'Responsável inválido.');
 return id;
}

async function stagesOf(client, pipelineId, lock = false) {
 return (await client.query(`SELECT id,name,kind,position FROM pipeline_stages WHERE pipeline_id=$1 ORDER BY position,created_at${lock ? ' FOR UPDATE' : ''}`, [pipelineId])).rows;
}

/** Grava as posições 0..n-1 na ordem recebida (não há índice único em position, então não há conflito no meio). */
async function renumber(client, orderedIds) {
 for (const [position, id] of orderedIds.entries()) await client.query('UPDATE pipeline_stages SET position=$2 WHERE id=$1', [id, position]);
}

const byKindThenPosition = (a, b) => RANK[a.kind] - RANK[b.kind] || a.position - b.position;

async function insertDefaultStages(client, pipelineId) {
 for (const [position, [name, kind, probability]] of DEFAULT_STAGES.entries())
  await client.query('INSERT INTO pipeline_stages(pipeline_id,name,kind,position,probability) VALUES($1,$2,$3,$4,$5)', [pipelineId, name, kind, position, probability]);
}

/**
 * Escolhe o funil e a etapa de entrada de um lead novo do espaço `spaceId`. O nicho do `utm_tzolkin`
 * (`<espaço>.<nicho>`) escolhe o funil de mesmo slug; sem casamento, o funil padrão do espaço. Espaço sem funil
 * devolve `null` e o lead segue sem funil, como antes. O prefixo precisa ser o próprio espaço.
 */
export async function placeLead(client, spaceId, utmTzolkin) {
 const niche = typeof utmTzolkin === 'string' && utmTzolkin.startsWith(`${spaceId}.`) ? utmTzolkin.slice(spaceId.length + 1).split('.')[0] : null;
 const one = async (sql, params) => (await client.query(sql, params)).rows[0];
 let pipeline = niche && SLUG.test(niche) ? await one('SELECT id FROM pipelines WHERE space_id=$1 AND slug=$2 AND is_active', [spaceId, niche]) : null;
 pipeline ??= await one('SELECT id FROM pipelines WHERE space_id=$1 AND is_default AND is_active', [spaceId]);
 if (!pipeline) return null;
 const stage = await one("SELECT id FROM pipeline_stages WHERE pipeline_id=$1 AND kind='LEAD' ORDER BY position LIMIT 1", [pipeline.id]);
 return stage ? { pipelineId: pipeline.id, stageId: stage.id } : null;
}

async function listPipelines({ pool, url, reply, operator }) {
 await commercialPermission(pool, operator);
 onlyParams(url.searchParams, ['space_id']);
 const spaceId = url.searchParams.get('space_id');
 if (spaceId && !isProductId(spaceId)) throw fail(400, 'Espaço inválido.');
 const pipelines = (await pool.query(
  `SELECT p.id,p.space_id,pr.name AS space_name,p.slug,p.name,p.offer_name,p.is_default,p.is_active,p.position,p.version
     FROM pipelines p JOIN products pr ON pr.id=p.space_id
    WHERE ($1::text IS NULL OR p.space_id=$1) ORDER BY pr.name,p.position,p.name`, [spaceId])).rows;
 if (!pipelines.length) return reply(200, { pipelines: [] });
 const stages = (await pool.query(
  `SELECT s.id,s.pipeline_id,s.name,s.kind,s.position,s.color,s.probability,s.stale_days,
          (SELECT count(*)::int FROM commercial_leads l WHERE l.stage_id=s.id AND l.status='open') AS leads,
          (SELECT count(*)::int FROM commercial_opportunities o WHERE o.stage_id=s.id) AS opportunities,
          (SELECT COALESCE(sum(o.value_minor),0)::text FROM commercial_opportunities o WHERE o.stage_id=s.id) AS value_minor
     FROM pipeline_stages s WHERE s.pipeline_id=ANY($1::uuid[]) ORDER BY s.pipeline_id,s.position`, [pipelines.map(p => p.id)])).rows;
 return reply(200, {
  pipelines: pipelines.map(p => ({
   ...p,
   stages: stages.filter(s => s.pipeline_id === p.id).map(({ pipeline_id, value_minor, ...s }) => ({ ...s, value_minor: Number(value_minor) })),
  })),
 });
}

async function listOpportunities({ pool, url, reply, operator }) {
 await commercialPermission(pool, operator);
 onlyParams(url.searchParams, ['pipeline_id', 'stage_id', 'offset', 'limit']);
 const pipelineId = url.searchParams.get('pipeline_id'), stageId = url.searchParams.get('stage_id');
 if (pipelineId) uuid(pipelineId);
 if (stageId) uuid(stageId);
 const limit = Number(url.searchParams.get('limit') || 25), offset = Number(url.searchParams.get('offset') || 0);
 if (!Number.isInteger(limit) || limit < 1 || limit > 100 || !Number.isInteger(offset) || offset < 0 || offset > 100000) throw fail(400, 'Paginação inválida.');
 const rows = (await pool.query(
  `SELECT o.id,o.pipeline_id,o.stage_id,s.name AS stage_name,s.kind AS stage_kind,o.tenant_id,t.name AS organization_name,
          o.stakeholder_id,k.name AS contact_name,o.lead_id,o.title,o.value_minor::text AS value_minor,o.currency,o.origin,o.owner_id,
          a.name AS owner_name,o.expected_close_at,o.entered_stage_at,o.closed_at,o.lost_reason_id,o.version,o.created_at
     FROM commercial_opportunities o
     JOIN pipeline_stages s ON s.id=o.stage_id JOIN tenants t ON t.id=o.tenant_id
     LEFT JOIN stakeholders k ON k.id=o.stakeholder_id LEFT JOIN operator_accounts a ON a.id=o.owner_id
    WHERE ($1::uuid IS NULL OR o.pipeline_id=$1) AND ($2::uuid IS NULL OR o.stage_id=$2)
    ORDER BY o.created_at DESC,o.id DESC LIMIT $3 OFFSET $4`, [pipelineId, stageId, limit + 1, offset])).rows;
 return reply(200, {
  opportunities: rows.slice(0, limit).map(o => ({ ...o, value_minor: Number(o.value_minor) })),
  has_more: rows.length > limit, offset, limit,
 });
}

export function commercialPipelineRoutes(router) {
 router.get('/api/commercial/pipelines', listPipelines);
 router.get('/api/commercial/opportunities', listOpportunities);

 router.post('/api/commercial/pipelines', async ({ client, body, operator }) => {
  await commercialPermission(client, operator, true);
  input(body, ['space_id', 'slug', 'name', 'offer_name']);
  const space = await spaceOf(client, body.space_id);
  if (typeof body.slug !== 'string' || !SLUG.test(body.slug)) throw fail(400, 'Identificador do funil inválido (minúsculas, números e hífen).');
  const name = text(body.name, 2, 120), offer = optionalText(body.offer_name, 2, 160);
  if ((await client.query('SELECT 1 FROM pipelines WHERE space_id=$1 AND slug=$2', [space.id, body.slug])).rowCount) throw fail(409, 'Já existe um funil com este identificador neste espaço.');
  const hasDefault = (await client.query('SELECT 1 FROM pipelines WHERE space_id=$1 AND is_default AND is_active', [space.id])).rowCount > 0;
  const position = Number((await client.query('SELECT COALESCE(max(position),-1)+1 AS n FROM pipelines WHERE space_id=$1', [space.id])).rows[0].n);
  const id = (await client.query('INSERT INTO pipelines(space_id,slug,name,offer_name,is_default,position) VALUES($1,$2,$3,$4,$5,$6) RETURNING id', [space.id, body.slug, name, offer, !hasDefault, position])).rows[0].id;
  await insertDefaultStages(client, id);
  return { body: { id } };
 }, { transactional: true, audit: false });

 router.put('/api/commercial/pipelines/:id', async ({ client, params, body, operator }) => {
  await commercialPermission(client, operator, true);
  uuid(params.id);
  input(body, ['version', 'name', 'offer_name', 'is_active', 'is_default']);
  const old = (await client.query('SELECT * FROM pipelines WHERE id=$1 FOR UPDATE', [params.id])).rows[0];
  if (!old) throw fail(404, 'Funil não encontrado.');
  if (body.version !== old.version) throw fail(409, 'Funil alterado em outra sessão. Reabra a tela.');
  for (const campo of ['is_active', 'is_default']) if (body[campo] != null && typeof body[campo] !== 'boolean') throw fail(400, 'Valor inválido.');
  const name = body.name == null ? old.name : text(body.name, 2, 120);
  const offer = Object.hasOwn(body, 'offer_name') ? optionalText(body.offer_name, 2, 160) : old.offer_name;
  const active = body.is_active ?? old.is_active;
  let isDefault = body.is_default ?? old.is_default;
  if (body.is_default === true && !active) throw fail(409, 'Reative o funil antes de torná-lo o padrão.');
  if (!active && old.is_default) throw fail(409, 'Este é o funil padrão. Defina outro como padrão antes de arquivá-lo.');
  if (body.is_default === false && old.is_default) throw fail(409, 'O espaço precisa de um funil padrão: defina outro como padrão.');
  if (!active) isDefault = false;
  if (isDefault && !old.is_default) await client.query('UPDATE pipelines SET is_default=false,updated_at=now() WHERE space_id=$1 AND is_default AND id<>$2', [old.space_id, old.id]);
  await client.query('UPDATE pipelines SET name=$2,offer_name=$3,is_active=$4,is_default=$5,version=version+1,updated_at=now() WHERE id=$1', [old.id, name, offer, active, isDefault]);
  return { body: { ok: true } };
 }, { transactional: true, audit: false });

 router.post('/api/commercial/pipelines/:id/stages', async ({ client, params, body, operator }) => {
  await commercialPermission(client, operator, true);
  uuid(params.id);
  input(body, ['name', 'kind', 'color', 'probability', 'stale_days']);
  if (!(await client.query('SELECT id FROM pipelines WHERE id=$1 FOR UPDATE', [params.id])).rowCount) throw fail(404, 'Funil não encontrado.');
  if (!KINDS.includes(body.kind)) throw fail(400, 'Tipo de etapa inválido.');
  const name = text(body.name, 2, 80), color = hexColor(body.color);
  const probability = integer(body.probability, 0, 100, 'Probabilidade'), staleDays = integer(body.stale_days, 1, 3650, 'Dias parado');
  const stages = await stagesOf(client, params.id, true);
  if (stages.some(s => s.name.toLowerCase() === name.toLowerCase())) throw fail(409, 'Já existe uma etapa com este nome neste funil.');
  if ((body.kind === 'WON' || body.kind === 'LOST') && stages.some(s => s.kind === body.kind)) throw fail(409, `O funil já tem a etapa ${body.kind === 'WON' ? 'de ganho' : 'de perda'}.`);
  const id = (await client.query('INSERT INTO pipeline_stages(pipeline_id,name,kind,position,color,probability,stale_days) VALUES($1,$2,$3,$4,$5,$6,$7) RETURNING id', [params.id, name, body.kind, stages.length, color, probability, staleDays])).rows[0].id;
  // A etapa entra no fim do próprio tipo; a ordem geral é sempre LEAD, OPEN, WON, LOST.
  const ordered = [...stages, { id, kind: body.kind, position: stages.length }].sort(byKindThenPosition);
  await renumber(client, ordered.map(s => s.id));
  return { body: { id } };
 }, { transactional: true, audit: false });

 router.put('/api/commercial/pipelines/:id/stages/:stageId', async ({ client, params, body, operator }) => {
  await commercialPermission(client, operator, true);
  uuid(params.id); uuid(params.stageId);
  input(body, ['name', 'color', 'probability', 'stale_days', 'position']);
  await client.query('SELECT id FROM pipelines WHERE id=$1 FOR UPDATE', [params.id]);
  const stages = await stagesOf(client, params.id, true);
  const stage = stages.find(s => s.id === params.stageId);
  if (!stage) throw fail(404, 'Etapa não encontrada.');
  const full = (await client.query('SELECT name,color,probability,stale_days FROM pipeline_stages WHERE id=$1', [stage.id])).rows[0];
  const name = body.name == null ? full.name : text(body.name, 2, 80);
  if (stages.some(s => s.id !== stage.id && s.name.toLowerCase() === name.toLowerCase())) throw fail(409, 'Já existe uma etapa com este nome neste funil.');
  const color = Object.hasOwn(body, 'color') ? hexColor(body.color) : full.color;
  const probability = Object.hasOwn(body, 'probability') ? integer(body.probability, 0, 100, 'Probabilidade') : full.probability;
  const staleDays = Object.hasOwn(body, 'stale_days') ? integer(body.stale_days, 1, 3650, 'Dias parado') : full.stale_days;
  await client.query('UPDATE pipeline_stages SET name=$2,color=$3,probability=$4,stale_days=$5 WHERE id=$1', [stage.id, name, color, probability, staleDays]);
  if (body.position != null) {
   // `position` é o lugar dentro do tipo da etapa (0 = primeira); não dá para sair do próprio tipo.
   const group = stages.filter(s => s.kind === stage.kind).sort(byKindThenPosition);
   const to = integer(body.position, 0, group.length - 1, 'Posição');
   const moved = group.filter(s => s.id !== stage.id);
   moved.splice(to, 0, stage);
   // A ordem geral é sempre LEAD, OPEN, WON, LOST (a ordem de KINDS); só o tipo da etapa movida muda por dentro.
   const ordered = KINDS.flatMap(kind => (kind === stage.kind ? moved : stages.filter(s => s.kind === kind).sort(byKindThenPosition)));
   await renumber(client, ordered.map(s => s.id));
  }
  return { body: { ok: true } };
 }, { transactional: true, audit: false });

 router.delete('/api/commercial/pipelines/:id/stages/:stageId', async ({ client, params, operator }) => {
  await commercialPermission(client, operator, true);
  uuid(params.id); uuid(params.stageId);
  await client.query('SELECT id FROM pipelines WHERE id=$1 FOR UPDATE', [params.id]);
  const stages = await stagesOf(client, params.id, true);
  const stage = stages.find(s => s.id === params.stageId);
  if (!stage) throw fail(404, 'Etapa não encontrada.');
  if (stages.filter(s => s.kind === stage.kind).length <= 1) throw fail(409, 'O funil precisa de ao menos uma etapa de cada tipo.');
  const used = (await client.query('SELECT (SELECT count(*) FROM commercial_leads WHERE stage_id=$1)+(SELECT count(*) FROM commercial_opportunities WHERE stage_id=$1) AS n', [stage.id])).rows[0].n;
  if (Number(used) > 0) throw fail(409, 'Há leads ou oportunidades nesta etapa. Mova-os antes de apagar.');
  await client.query('DELETE FROM pipeline_stages WHERE id=$1', [stage.id]);
  await renumber(client, stages.filter(s => s.id !== stage.id).sort(byKindThenPosition).map(s => s.id));
  return { body: { ok: true } };
 }, { transactional: true, audit: false, body: false });

 router.post('/api/commercial/opportunities', async ({ client, body, operator }) => {
  await commercialPermission(client, operator, true);
  input(body, ['pipeline_id', 'tenant_id', 'title', 'value_minor', 'currency', 'expected_close_at', 'owner_id', 'stakeholder_id']);
  const pipeline = (await client.query('SELECT id,is_active FROM pipelines WHERE id=$1', [uuid(body.pipeline_id)])).rows[0];
  if (!pipeline) throw fail(404, 'Funil não encontrado.');
  if (!pipeline.is_active) throw fail(409, 'Este funil está arquivado.');
  const tenant = (await client.query('SELECT id FROM tenants WHERE id=$1', [uuid(body.tenant_id)])).rows[0];
  if (!tenant) throw fail(404, 'Empresa não encontrada.');
  if (body.stakeholder_id != null && !(await client.query('SELECT 1 FROM stakeholders WHERE id=$1', [uuid(body.stakeholder_id)])).rowCount) throw fail(404, 'Contato não encontrado.');
  const title = text(body.title, 2, 200);
  const value = body.value_minor == null ? 0 : integer(body.value_minor, 0, MAX_MINOR, 'Valor');
  const currency = body.currency ?? 'BRL';
  if (!['BRL', 'USD', 'EUR', 'GBP'].includes(currency)) throw fail(400, 'Moeda inválida.');
  const first = (await client.query("SELECT id FROM pipeline_stages WHERE pipeline_id=$1 AND kind='OPEN' ORDER BY position LIMIT 1", [pipeline.id])).rows[0];
  if (!first) throw fail(409, 'O funil não tem etapa aberta.');
  const owner = await activeOwner(client, body.owner_id ?? null);
  const id = (await client.query(
   `INSERT INTO commercial_opportunities(pipeline_id,stage_id,tenant_id,stakeholder_id,title,value_minor,currency,origin,owner_id,expected_close_at)
    VALUES($1,$2,$3,$4,$5,$6,$7,'OUTBOUND',$8,$9) RETURNING id`,
   [pipeline.id, first.id, tenant.id, body.stakeholder_id ?? null, title, value, currency, owner, dateOrNull(body.expected_close_at)])).rows[0].id;
  const space = (await client.query('SELECT space_id FROM pipelines WHERE id=$1', [pipeline.id])).rows[0].space_id;
  await emitEvent(client, 'oportunidade.criada', { spaceId: space, tenantId: tenant.id, opportunityId: id, pipelineId: pipeline.id, stageId: first.id });
  return { tenant: tenant.id, type: 'opportunity_created', body: { id } };
 }, { transactional: true });

 router.put('/api/commercial/opportunities/:id/move', async ({ client, params, body, operator }) => {
  await commercialPermission(client, operator, true);
  uuid(params.id);
  input(body, ['version', 'stage_id', 'lost_reason_id']);
  const old = (await client.query('SELECT * FROM commercial_opportunities WHERE id=$1 FOR UPDATE', [params.id])).rows[0];
  if (!old) throw fail(404, 'Oportunidade não encontrada.');
  if (body.version !== old.version) throw fail(409, 'Oportunidade alterada em outra sessão. Reabra a tela.');
  const to = (await client.query('SELECT id,name,pipeline_id,kind FROM pipeline_stages WHERE id=$1', [uuid(body.stage_id)])).rows[0];
  if (!to || to.pipeline_id !== old.pipeline_id) throw fail(400, 'A etapa não pertence ao funil desta oportunidade.');
  if (to.id === old.stage_id) throw fail(400, 'A oportunidade já está nesta etapa.');
  if (to.kind === 'LEAD') throw fail(400, 'Oportunidade não volta para etapa de lead.');
  let reason = null, reasonName = null;
  if (to.kind === 'LOST') {
   if (body.lost_reason_id == null) throw fail(400, 'Informe o motivo da perda.');
   const found = (await client.query('SELECT id,name FROM lost_reasons WHERE id=$1 AND is_active', [uuid(body.lost_reason_id)])).rows[0];
   if (!found) throw fail(400, 'Motivo de perda inválido.');
   reason = found.id; reasonName = found.name;
  } else if (body.lost_reason_id != null) throw fail(400, 'Motivo de perda só vale ao mover para a etapa de perda.');
  const closes = to.kind === 'WON' || to.kind === 'LOST';
  await client.query(
   `UPDATE commercial_opportunities SET stage_id=$2,lost_reason_id=$3,closed_at=${closes ? 'now()' : 'NULL'},entered_stage_at=now(),version=version+1,updated_at=now() WHERE id=$1`,
   [old.id, to.id, reason]);
  // O lead de origem acompanha e, ao ganhar, nasce a contratação (fase 3).
  const engagementId = await onOpportunityMoved(client, old, to, reasonName, operator);
  return { tenant: old.tenant_id, type: 'opportunity_moved', body: { ok: true, engagement_id: engagementId } };
 }, { transactional: true });
}
