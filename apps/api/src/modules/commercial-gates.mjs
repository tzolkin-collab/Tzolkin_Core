import { fail, input, isUuid, onlyParams, text } from '../platform/http.mjs';
import { commercialPermission } from './commercial-keys.mjs';

// Requisitos de etapa (gate.ts da Kalidash, adaptado). Ver db/migrations/046_requisitos_de_etapa.sql.
//
// Uma etapa exige algo para o registro ENTRAR nela (gate ENTER) ou SAIR dela (gate EXIT):
//  - ACTION: uma tarefa. Ao tentar mover, a tarefa nasce para aquele registro se ainda não existe, e o movimento fica
//    bloqueado até ela ser concluída. Todas as tarefas da fronteira precisam fechar, não só a primeira.
//  - FIELD: um campo próprio do espaço preenchido. Bloqueia até o valor existir; não cria tarefa.
// A rota que move devolve 200 com `{ ok: false, blocked: true, blockers }` em vez de um erro: as tarefas criadas na
// tentativa precisam sobreviver (um erro desfaria a transação) e a tela mostra o que falta.

const MAX_PER_STAGE = 10;
const uuid = v => { if (!isUuid(v)) throw fail(400, 'Identificador inválido.'); return v; };
const vazio = v => v == null || v === '' || (Array.isArray(v) && !v.length);

async function activeOwner(client, id) {
 if (id == null) return null;
 if (!(await client.query("SELECT id FROM operator_accounts WHERE id=$1 AND status='active' AND role IN ('owner','member')", [uuid(id)])).rowCount) throw fail(400, 'Responsável inválido.');
 return id;
}

/** Garante a tarefa do requisito para o registro (cria se faltar). Dois pedidos juntos não criam duas: índice único. */
async function ensureTask(client, req, kind, record) {
 const consulta = kind === 'lead'
  ? 'SELECT id,done_at FROM commercial_tasks WHERE requirement_id=$1 AND lead_id=$2 AND opportunity_id IS NULL'
  : 'SELECT id,done_at FROM commercial_tasks WHERE requirement_id=$1 AND opportunity_id=$2';
 const achada = (await client.query(consulta, [req.id, record.id])).rows[0];
 if (achada) return achada;
 const due = req.due_days == null ? null : new Date(Date.now() + req.due_days * 86_400_000).toISOString();
 const nova = (await client.query(
  `INSERT INTO commercial_tasks(tenant_id,lead_id,opportunity_id,title,tag,due_at,owner_id,source,requirement_id)
   VALUES($1,$2,$3,$4,$5,$6,$7,'requisito',$8) ON CONFLICT DO NOTHING RETURNING id,done_at`,
  [record.tenant_id, kind === 'lead' ? record.id : (record.lead_id ?? null), kind === 'opportunity' ? record.id : null, req.title, req.tag, due, req.owner_id, req.id])).rows[0];
 return nova || (await client.query(consulta, [req.id, record.id])).rows[0];
}

/**
 * O que impede o registro de entrar em `toStageId` ou sair de `fromStageId`. Lista vazia = pode mover.
 * `kind` é 'lead' ou 'opportunity'; `record` traz id, tenant_id, custom_data (e lead_id, no caso da oportunidade).
 * As tarefas que faltam nascem aqui, para aparecerem no registro assim que alguém tentar mover.
 */
export async function stageBlockers(client, { kind, record, pipelineId, fromStageId, toStageId }) {
 const reqs = (await client.query(
  `SELECT id,stage_id,gate,kind,title,field_entity,field_key,tag,owner_id,due_days FROM stage_requirements
    WHERE pipeline_id=$1 AND is_active AND ((gate='ENTER' AND stage_id=$2) OR (gate='EXIT' AND stage_id=$3))
    ORDER BY position,created_at,id`, [pipelineId, toStageId, fromStageId ?? null])).rows;
 const blockers = [];
 for (const r of reqs) {
  if (r.kind === 'FIELD') {
   if (r.field_entity !== kind) continue;
   if (vazio(record.custom_data?.[r.field_key])) blockers.push({ requirement_id: r.id, kind: 'FIELD', gate: r.gate, title: r.title, field_key: r.field_key, task_id: null });
  } else {
   const task = await ensureTask(client, r, kind, record);
   if (!task.done_at) blockers.push({ requirement_id: r.id, kind: 'ACTION', gate: r.gate, title: r.title, field_key: null, task_id: task.id });
  }
 }
 return blockers;
}

export function commercialGateRoutes(router) {
 router.get('/api/commercial/stage-requirements', async ({ pool, url, reply, operator }) => {
  await commercialPermission(pool, operator);
  onlyParams(url.searchParams, ['pipeline_id']);
  const pipeline = url.searchParams.get('pipeline_id');
  if (!pipeline) throw fail(400, 'Informe o funil.');
  uuid(pipeline);
  const rows = (await pool.query(
   `SELECT r.id,r.pipeline_id,r.stage_id,s.name AS stage_name,s.kind AS stage_kind,r.gate,r.kind,r.title,r.field_entity,r.field_key,r.tag,r.owner_id,r.due_days,r.position,r.is_active,r.version
      FROM stage_requirements r JOIN pipeline_stages s ON s.id=r.stage_id WHERE r.pipeline_id=$1 ORDER BY s.position,r.gate,r.position,r.created_at`, [pipeline])).rows;
  return reply(200, { requirements: rows });
 });

 router.post('/api/commercial/stage-requirements', async ({ client, body, operator }) => {
  await commercialPermission(client, operator, true);
  input(body, ['pipeline_id', 'stage_id', 'gate', 'kind', 'title', 'field_key', 'tag', 'owner_id', 'due_days']);
  const pipeline = (await client.query('SELECT id,space_id FROM pipelines WHERE id=$1', [uuid(body.pipeline_id)])).rows[0];
  if (!pipeline) throw fail(404, 'Funil não encontrado.');
  const stage = (await client.query('SELECT id,kind FROM pipeline_stages WHERE id=$1 AND pipeline_id=$2', [uuid(body.stage_id), pipeline.id])).rows[0];
  if (!stage) throw fail(400, 'A etapa não é deste funil.');
  if (!['ENTER', 'EXIT'].includes(body.gate)) throw fail(400, 'Escolha se vale para entrar ou para sair.');
  if (!['ACTION', 'FIELD'].includes(body.kind)) throw fail(400, 'Tipo de requisito inválido.');
  const title = text(body.title, 2, 200);
  const tag = body.tag == null || body.tag === '' ? 'Geral' : text(body.tag, 1, 40);
  let fieldEntity = null, fieldKey = null, dueDays = null;
  if (body.kind === 'FIELD') {
   if (body.due_days != null) throw fail(400, 'Requisito de campo não tem prazo.');
   // O requisito olha o registro que está sendo movido: o lead nas etapas de lead, a oportunidade nas demais.
   fieldEntity = stage.kind === 'LEAD' ? 'lead' : 'opportunity';
   const campo = (await client.query("SELECT 1 FROM space_fields WHERE space_id=$1 AND entity=$2 AND key=$3 AND is_active", [pipeline.space_id, fieldEntity, body.field_key])).rowCount;
   if (typeof body.field_key !== 'string' || !campo) throw fail(400, `Este espaço não tem o campo "${String(body.field_key).slice(0, 40)}" ativo para ${fieldEntity === 'lead' ? 'leads' : 'oportunidades'}.`);
   fieldKey = body.field_key;
  } else {
   if (body.field_key != null) throw fail(400, 'Só requisito de campo tem campo.');
   if (body.due_days != null && (!Number.isInteger(body.due_days) || body.due_days < 0 || body.due_days > 365)) throw fail(400, 'O prazo vai de 0 a 365 dias.');
   dueDays = body.due_days ?? null;
  }
  const atuais = Number((await client.query('SELECT count(*) FROM stage_requirements WHERE stage_id=$1', [stage.id])).rows[0].count);
  if (atuais >= MAX_PER_STAGE) throw fail(409, `Cada etapa tem no máximo ${MAX_PER_STAGE} requisitos.`);
  const position = Number((await client.query('SELECT COALESCE(max(position)+1,0) AS n FROM stage_requirements WHERE stage_id=$1 AND gate=$2', [stage.id, body.gate])).rows[0].n);
  const id = (await client.query(
   `INSERT INTO stage_requirements(pipeline_id,stage_id,gate,kind,title,field_entity,field_key,tag,owner_id,due_days,position) VALUES($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11) RETURNING id`,
   [pipeline.id, stage.id, body.gate, body.kind, title, fieldEntity, fieldKey, tag, await activeOwner(client, body.owner_id ?? null), dueDays, position])).rows[0].id;
  return { body: { id } };
 }, { transactional: true, audit: false });

 // Editar o que não muda a regra: título, tag, responsável, prazo, ligado e posição. Etapa, gate e tipo não mudam.
 router.put('/api/commercial/stage-requirements/:id', async ({ client, params, body, operator }) => {
  await commercialPermission(client, operator, true);
  uuid(params.id);
  input(body, ['version', 'title', 'tag', 'owner_id', 'due_days', 'is_active', 'position']);
  const old = (await client.query('SELECT * FROM stage_requirements WHERE id=$1 FOR UPDATE', [params.id])).rows[0];
  if (!old) throw fail(404, 'Requisito não encontrado.');
  if (body.version !== old.version) throw fail(409, 'Requisito alterado em outra sessão. Reabra a tela.');
  if (body.is_active != null && typeof body.is_active !== 'boolean') throw fail(400, 'Valor inválido.');
  if (body.position != null && (!Number.isInteger(body.position) || body.position < 0 || body.position > 100)) throw fail(400, 'Posição inválida.');
  const dueDays = Object.hasOwn(body, 'due_days') ? body.due_days : old.due_days;
  if (dueDays != null && (old.kind === 'FIELD' || !Number.isInteger(dueDays) || dueDays < 0 || dueDays > 365)) throw fail(400, 'Prazo inválido.');
  const owner = Object.hasOwn(body, 'owner_id') ? await activeOwner(client, body.owner_id) : old.owner_id;
  await client.query('UPDATE stage_requirements SET title=$2,tag=$3,owner_id=$4,due_days=$5,is_active=$6,position=$7,version=version+1,updated_at=now() WHERE id=$1',
   [old.id, body.title == null ? old.title : text(body.title, 2, 200), body.tag == null ? old.tag : text(body.tag, 1, 40), owner, dueDays, body.is_active ?? old.is_active, body.position ?? old.position]);
  return { body: { ok: true } };
 }, { transactional: true, audit: false });
}
