import { fail, input, isProductId, isUuid, onlyParams, text } from '../platform/http.mjs';
import { commercialPermission } from './commercial-keys.mjs';
import { spaceOf } from './commercial-pipelines.mjs';
import { ACTIONS, EVENTS, EVENTOS_COM_LEAD, validateActions } from '../platform/automations.mjs';
import { renderizar, ErroDeModelo, VARIAVEIS_DO_LEAD } from '../platform/email-modelo.mjs';

// Automações e tarefas (fase 5). As regras do motor moram em platform/automations.mjs; aqui ficam as rotas de
// cadastro (automação por espaço, com funil e etapa opcionais), o histórico de execuções e as tarefas mínimas.
// Ver db/migrations/044_eventos_e_automacoes.sql. Automação não se apaga: desativa (o histórico aponta para ela).

const uuid = v => { if (!isUuid(v)) throw fail(400, 'Identificador inválido.'); return v; };
const MAX_PER_SPACE = 50;
const dateOrNull = v => {
 if (v == null || v === '') return null;
 const t = typeof v === 'string' ? Date.parse(v) : NaN;
 if (!Number.isFinite(t)) throw fail(400, 'Data inválida.');
 return new Date(t).toISOString();
};
async function activeOwner(client, id) {
 if (id == null) return null;
 if (!(await client.query("SELECT id FROM operator_accounts WHERE id=$1 AND status='active' AND role IN ('owner','member')", [uuid(id)])).rowCount) throw fail(400, 'Responsável inválido.');
 return id;
}

/** Funil e etapa opcionais de uma automação: o funil é do espaço e a etapa é do funil. */
async function scope(client, spaceId, body) {
 const pipelineId = body.pipeline_id ?? null, stageId = body.stage_id ?? null;
 if (stageId && !pipelineId) throw fail(400, 'Escolha o funil para filtrar por etapa.');
 if (pipelineId) {
  const p = (await client.query('SELECT space_id FROM pipelines WHERE id=$1', [uuid(pipelineId)])).rows[0];
  if (!p || p.space_id !== spaceId) throw fail(400, 'O funil não é deste espaço.');
 }
 if (stageId && !(await client.query('SELECT 1 FROM pipeline_stages WHERE id=$1 AND pipeline_id=$2', [uuid(stageId), pipelineId])).rowCount) throw fail(400, 'A etapa não é deste funil.');
 return { pipelineId, stageId };
}
async function checkOwners(client, actions) {
 for (const a of actions) if (a.action === 'responsavel.atribuir') await activeOwner(client, a.owner_id);
}

export function commercialAutomationRoutes(router) {
 router.get('/api/commercial/automations', async ({ pool, url, reply, operator }) => {
  await commercialPermission(pool, operator);
  onlyParams(url.searchParams, ['space_id']);
  const space = url.searchParams.get('space_id');
  if (space && !isProductId(space)) throw fail(400, 'Espaço inválido.');
  const rows = (await pool.query(
   `SELECT a.id,a.space_id,a.pipeline_id,a.stage_id,a.name,a.trigger_event,a.actions,a.is_enabled,a.version,
           (SELECT created_at FROM automation_runs r WHERE r.automation_id=a.id ORDER BY created_at DESC LIMIT 1) AS last_run_at,
           (SELECT result FROM automation_runs r WHERE r.automation_id=a.id ORDER BY created_at DESC LIMIT 1) AS last_result
      FROM automations a WHERE ($1::text IS NULL OR a.space_id=$1) ORDER BY a.space_id,a.created_at,a.id`, [space])).rows;
  return reply(200, { automations: rows, catalog: { events: EVENTS, actions: ACTIONS } });
 });


 // "Enviar e-mail" só faz sentido onde há um lead com e-mail, e o template precisa existir NESTE espaço (ou o erro só apareceria na hora de rodar).
 async function checkEmails(client, spaceId, evento, actions) {
  for (const a of actions.filter(x => x.action === 'email.enviar')) {
   if (!EVENTOS_COM_LEAD.includes(evento)) throw fail(400, 'Enviar e-mail só funciona em eventos de lead (criado, mudou de etapa, qualificado, descartado, restaurado).');
   const tpl = (await client.query('SELECT payload FROM email_templates WHERE product_id=$1 AND slug=$2', [spaceId, a.template])).rows[0]?.payload;
   if (!tpl) throw fail(400, `O template "${a.template}" não existe neste espaço.`);
   // Já aqui, e não só na hora de rodar: um template com variável que não existe em e-mail de lead não pode virar automação.
   try { renderizar(tpl, { name: 'x', email: 'x@x.co', product_name: 'x', company_name: 'x' }, { permitidas: VARIAVEIS_DO_LEAD }); }
   catch (e) { if (e instanceof ErroDeModelo) throw fail(400, `O template "${a.template}" não serve para e-mail de lead: ${e.message}`); throw e; }
  }
 }

 router.post('/api/commercial/automations', async ({ client, body, operator }) => {
  await commercialPermission(client, operator, true);
  input(body, ['space_id', 'name', 'trigger_event', 'pipeline_id', 'stage_id', 'actions']);
  const space = await spaceOf(client, body.space_id);
  if (!EVENTS[body.trigger_event]) throw fail(400, 'Evento desconhecido.');
  const name = text(body.name, 2, 120), actions = validateActions(body.actions);
  const { pipelineId, stageId } = await scope(client, space.id, body);
  await checkOwners(client, actions);
  await checkEmails(client, space.id, body.trigger_event, actions);
  if (Number((await client.query('SELECT count(*) FROM automations WHERE space_id=$1', [space.id])).rows[0].count) >= MAX_PER_SPACE) throw fail(409, `Cada espaço tem no máximo ${MAX_PER_SPACE} automações.`);
  const id = (await client.query(
   'INSERT INTO automations(space_id,pipeline_id,stage_id,name,trigger_event,actions) VALUES($1,$2,$3,$4,$5,$6) RETURNING id',
   [space.id, pipelineId, stageId, name, body.trigger_event, JSON.stringify(actions)])).rows[0].id;
  return { body: { id } };
 }, { transactional: true, audit: false });

 // Editar nome, ligar/desligar, filtros e ações. O evento e o espaço não mudam: é outra automação.
 router.put('/api/commercial/automations/:id', async ({ client, params, body, operator }) => {
  await commercialPermission(client, operator, true);
  uuid(params.id);
  input(body, ['version', 'name', 'is_enabled', 'pipeline_id', 'stage_id', 'actions']);
  const old = (await client.query('SELECT * FROM automations WHERE id=$1 FOR UPDATE', [params.id])).rows[0];
  if (!old) throw fail(404, 'Automação não encontrada.');
  if (body.version !== old.version) throw fail(409, 'Automação alterada em outra sessão. Reabra a tela.');
  if (body.is_enabled != null && typeof body.is_enabled !== 'boolean') throw fail(400, 'Valor inválido.');
  const name = body.name == null ? old.name : text(body.name, 2, 120);
  const actions = body.actions == null ? old.actions : validateActions(body.actions);
  const filtro = Object.hasOwn(body, 'pipeline_id') || Object.hasOwn(body, 'stage_id')
   ? await scope(client, old.space_id, { pipeline_id: body.pipeline_id ?? null, stage_id: body.stage_id ?? null })
   : { pipelineId: old.pipeline_id, stageId: old.stage_id };
  if (body.actions != null) { await checkOwners(client, actions); await checkEmails(client, old.space_id, old.trigger_event, actions); }
  await client.query('UPDATE automations SET name=$2,is_enabled=$3,pipeline_id=$4,stage_id=$5,actions=$6,version=version+1,updated_at=now() WHERE id=$1',
   [old.id, name, body.is_enabled ?? old.is_enabled, filtro.pipelineId, filtro.stageId, JSON.stringify(actions)]);
  return { body: { ok: true } };
 }, { transactional: true, audit: false });

 router.get('/api/commercial/automations/:id/runs', async ({ pool, params, reply, operator }) => {
  await commercialPermission(pool, operator);
  uuid(params.id);
  const runs = (await pool.query(
   'SELECT id,event,lead_id,opportunity_id,result,note,created_at FROM automation_runs WHERE automation_id=$1 ORDER BY created_at DESC,id DESC LIMIT 50', [params.id])).rows;
  return reply(200, { runs });
 });

 // --- tarefas ----------------------------------------------------------------
 router.get('/api/commercial/tasks', async ({ pool, url, reply, operator }) => {
  await commercialPermission(pool, operator);
  onlyParams(url.searchParams, ['lead_id', 'opportunity_id', 'status']);
  const lead = url.searchParams.get('lead_id'), opp = url.searchParams.get('opportunity_id'), status = url.searchParams.get('status');
  if (!lead && !opp) throw fail(400, 'Informe o lead ou a oportunidade.');
  if ((lead && !isUuid(lead)) || (opp && !isUuid(opp)) || (status && !['open', 'done'].includes(status))) throw fail(400, 'Filtro inválido.');
  const tasks = (await pool.query(
   `SELECT t.id,t.tenant_id,t.lead_id,t.opportunity_id,t.title,t.tag,t.due_at,t.owner_id,a.name AS owner_name,t.source,t.automation_id,t.done_at,t.version,t.created_at
      FROM commercial_tasks t LEFT JOIN operator_accounts a ON a.id=t.owner_id
     WHERE ($1::uuid IS NULL OR t.lead_id=$1) AND ($2::uuid IS NULL OR t.opportunity_id=$2)
       AND ($3::text IS NULL OR ($3='open' AND t.done_at IS NULL) OR ($3='done' AND t.done_at IS NOT NULL))
     ORDER BY (t.done_at IS NOT NULL),t.due_at NULLS LAST,t.created_at DESC LIMIT 100`, [lead, opp, status])).rows;
  return reply(200, { tasks });
 });

 router.post('/api/commercial/tasks', async ({ client, body, operator }) => {
  await commercialPermission(client, operator, true);
  input(body, ['lead_id', 'opportunity_id', 'title', 'tag', 'due_at', 'owner_id']);
  if (body.lead_id == null && body.opportunity_id == null) throw fail(400, 'Informe o lead ou a oportunidade.');
  let leadId = body.lead_id ?? null, tenantId = null;
  if (leadId) {
   const l = (await client.query('SELECT id,tenant_id FROM commercial_leads WHERE id=$1', [uuid(leadId)])).rows[0];
   if (!l) throw fail(404, 'Lead não encontrado.');
   tenantId = l.tenant_id;
  }
  const oppId = body.opportunity_id ?? null;
  if (oppId) {
   const o = (await client.query('SELECT id,tenant_id,lead_id FROM commercial_opportunities WHERE id=$1', [uuid(oppId)])).rows[0];
   if (!o) throw fail(404, 'Oportunidade não encontrada.');
   if (tenantId && o.tenant_id !== tenantId) throw fail(400, 'O lead e a oportunidade são de empresas diferentes.');
   tenantId = o.tenant_id; leadId ??= o.lead_id;
  }
  const tag = body.tag == null || body.tag === '' ? 'Geral' : text(body.tag, 1, 40);
  const id = (await client.query(
   `INSERT INTO commercial_tasks(tenant_id,lead_id,opportunity_id,title,tag,due_at,owner_id,source) VALUES($1,$2,$3,$4,$5,$6,$7,'manual') RETURNING id`,
   [tenantId, leadId, oppId, text(body.title, 2, 200), tag, dateOrNull(body.due_at), await activeOwner(client, body.owner_id ?? null)])).rows[0].id;
  return { body: { id } };
 }, { transactional: true, audit: false });

 router.put('/api/commercial/tasks/:id', async ({ client, params, body, operator }) => {
  await commercialPermission(client, operator, true);
  uuid(params.id);
  input(body, ['version', 'done', 'title', 'due_at', 'owner_id']);
  const old = (await client.query('SELECT * FROM commercial_tasks WHERE id=$1 FOR UPDATE', [params.id])).rows[0];
  if (!old) throw fail(404, 'Tarefa não encontrada.');
  if (body.version !== old.version) throw fail(409, 'Tarefa alterada em outra sessão. Reabra a tela.');
  if (body.done != null && typeof body.done !== 'boolean') throw fail(400, 'Valor inválido.');
  const title = body.title == null ? old.title : text(body.title, 2, 200);
  const due = Object.hasOwn(body, 'due_at') ? dateOrNull(body.due_at) : old.due_at;
  const owner = Object.hasOwn(body, 'owner_id') ? await activeOwner(client, body.owner_id) : old.owner_id;
  const done = body.done == null ? old.done_at : body.done ? (old.done_at ?? new Date().toISOString()) : null;
  await client.query('UPDATE commercial_tasks SET title=$2,due_at=$3,owner_id=$4,done_at=$5,version=version+1,updated_at=now() WHERE id=$1', [old.id, title, due, owner, done]);
  return { body: { ok: true } };
 }, { transactional: true, audit: false });
}
