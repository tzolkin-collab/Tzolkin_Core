import { fail, input, isProductId, isUuid, onlyParams } from '../platform/http.mjs';
import { commercialPermission } from './commercial-keys.mjs';
import { spaceOf } from './commercial-pipelines.mjs';
import { ENTITIES, FIELD_COLUMNS as COLUNAS, MAX_FIELDS_PER_ENTITY, applyChanges, definitionInput, fieldsOf, updateInput, validateSpaceData } from '../platform/space-fields.mjs';

// Campos próprios por espaço (fase 4). Definição por espaço e entidade; valor na coluna `custom_data` da linha.
// Ver db/migrations/043_campos_por_espaco.sql e platform/space-fields.mjs (as regras de cada tipo).

// O driver manda array JS como array do Postgres, não como JSON: coluna jsonb com array pede o texto JSON.
const jsonb = v => (v == null ? null : JSON.stringify(v));
const uuid = v => { if (!isUuid(v)) throw fail(400, 'Identificador inválido.'); return v; };
// Onde mora cada entidade e como achar o espaço dela. `version` é a coluna do contador otimista.
const ALVOS = {
 lead: { sql: 'SELECT id,version,custom_data,product_id AS space FROM commercial_leads WHERE id=$1 FOR UPDATE', table: 'commercial_leads', counter: 'version' },
 opportunity: {
  sql: 'SELECT o.id,o.version,o.custom_data,p.space_id AS space FROM commercial_opportunities o JOIN pipelines p ON p.id=o.pipeline_id WHERE o.id=$1 FOR UPDATE OF o',
  table: 'commercial_opportunities', counter: 'version',
 },
 engagement: { sql: 'SELECT id,revision AS version,custom_data,product_id AS space FROM client_engagements WHERE id=$1 FOR UPDATE', table: 'client_engagements', counter: 'revision' },
};

export function commercialFieldRoutes(router) {
 router.get('/api/commercial/space-fields', async ({ pool, url, reply, operator }) => {
  await commercialPermission(pool, operator);
  onlyParams(url.searchParams, ['space_id', 'entity']);
  const space = url.searchParams.get('space_id'), entity = url.searchParams.get('entity');
  if (space && !isProductId(space)) throw fail(400, 'Espaço inválido.');
  if (entity && !ENTITIES.includes(entity)) throw fail(400, 'Entidade inválida.');
  const rows = (await pool.query(
   `SELECT ${COLUNAS} FROM space_fields WHERE ($1::text IS NULL OR space_id=$1) AND ($2::text IS NULL OR entity=$2) ORDER BY space_id,entity,position,label`,
   [space, entity])).rows;
  return reply(200, { fields: rows });
 });

 router.post('/api/commercial/space-fields', async ({ client, body, operator }) => {
  await commercialPermission(client, operator, true);
  const v = definitionInput(body);
  const space = await spaceOf(client, body.space_id);
  const atuais = await fieldsOf(client, space.id, v.entity);
  if (atuais.some(f => f.key === v.key)) throw fail(409, 'Já existe um campo com esta chave neste espaço.');
  if (atuais.length >= MAX_FIELDS_PER_ENTITY) throw fail(409, `Cada espaço tem no máximo ${MAX_FIELDS_PER_ENTITY} campos por tipo de registro.`);
  const position = atuais.reduce((m, f) => Math.max(m, f.position + 1), 0);
  const id = (await client.query(
   'INSERT INTO space_fields(space_id,entity,key,label,type,options,required,position) VALUES($1,$2,$3,$4,$5,$6,$7,$8) RETURNING id',
   [space.id, v.entity, v.key, v.label, v.type, jsonb(v.options), v.required, position])).rows[0].id;
  return { body: { id } };
 }, { transactional: true, audit: false });

 // Editar rótulo, opções, obrigatório, ativo e posição. Chave, tipo e entidade não mudam; campo não se apaga (desativa).
 router.put('/api/commercial/space-fields/:id', async ({ client, params, body, operator }) => {
  await commercialPermission(client, operator, true);
  uuid(params.id);
  const old = (await client.query(`SELECT ${COLUNAS} FROM space_fields WHERE id=$1 FOR UPDATE`, [params.id])).rows[0];
  if (!old) throw fail(404, 'Campo não encontrado.');
  const v = updateInput(body, old);
  if (body.version !== old.version) throw fail(409, 'Campo alterado em outra sessão. Reabra a tela.');
  await client.query('UPDATE space_fields SET label=$2,options=$3,required=$4,is_active=$5,position=$6,version=version+1,updated_at=now() WHERE id=$1',
   [old.id, v.label, jsonb(v.options), v.required, v.is_active, v.position]);
  return { body: { ok: true } };
 }, { transactional: true, audit: false });

 // Valores de um registro: lead, oportunidade ou contratação. O que veio entra, vazio apaga, o resto fica.
 router.put('/api/commercial/custom-data/:entity/:id', async ({ client, params, body, operator }) => {
  await commercialPermission(client, operator, true);
  const alvo = ALVOS[params.entity];
  if (!alvo) throw fail(404, 'Tipo de registro desconhecido.');
  uuid(params.id);
  input(body, ['version', 'custom_data']);
  const row = (await client.query(alvo.sql, [params.id])).rows[0];
  if (!row) throw fail(404, 'Registro não encontrado.');
  if (body.version !== row.version) throw fail(409, 'Registro alterado em outra sessão. Reabra a tela.');
  if (!row.space) throw fail(409, 'Este registro não pertence a um espaço com campos próprios.');
  const campos = await fieldsOf(client, row.space, params.entity);
  const validados = validateSpaceData(campos, body.custom_data, { enforceRequired: false });
  const novo = applyChanges(row.custom_data, body.custom_data, validados);
  await client.query(`UPDATE ${alvo.table} SET custom_data=$2,${alvo.counter}=${alvo.counter}+1,updated_at=now() WHERE id=$1`, [row.id, novo]);
  if (params.entity === 'lead')
   await client.query('INSERT INTO commercial_activities(lead_id,kind,note,details,actor_subject,actor_email) VALUES($1,$2,NULL,$3,$4,$5)',
    [row.id, 'custom_data_changed', { keys: Object.keys(body.custom_data) }, operator?.subject ?? 'sistema', operator?.email ?? null]);
  return { body: { ok: true } };
 }, { transactional: true, audit: false });
}
