import { json, isUuid, fail, onlyParams } from '../platform/http.mjs';
import { validateProject, projectIssues, STACKS, KINDS, ENVIRONMENTS } from '../platform/delivery-model.mjs';
import { createDeliveryOptions } from '../integrations/delivery-options.mjs';
import { createDeliverySettings } from '../integrations/delivery-settings.mjs';
import { createResourceReader } from '../integrations/resource.mjs';

const present = row => ({ id: row.id, revision: row.revision, updated_at: row.updated_at, ...row.specification,
 issues: projectIssues(row.specification), deployment_status: 'not_observed' });

export function deliveryRoutes(router, { options = createDeliveryOptions(), settings = createDeliverySettings(), resource = createResourceReader() } = {}) {
 router.get('/api/platforms/resource', async ({url,reply}) => {
  onlyParams(url.searchParams,['provider','target_id','environment']);
  if (['provider','target_id','environment'].some(key => url.searchParams.getAll(key).length !== 1)) throw fail(400,'Informe um único destino e ambiente.');
  const provider=url.searchParams.get('provider'), id=url.searchParams.get('target_id'), environment=url.searchParams.get('environment');
  if (!['vercel','easypanel'].includes(provider) || !id || id.length > 240 || !ENVIRONMENTS.includes(environment)) throw fail(400,'Destino ou ambiente inválido.');
  const inventory=(await options())[provider];
  if (inventory?.status !== 'ok') throw fail(503,'Inventário indisponível. Tente novamente.');
  const target=inventory.items.find(t => t.id === id);
  if (!target) throw fail(404,'Destino não encontrado no inventário acessível.');
  reply(200,await resource({provider,target,environment}));
 });
 router.get('/api/delivery/settings', async ({ url, reply }) => {
  onlyParams(url.searchParams, ['provider','target_id','environment']);
  if (['provider','target_id','environment'].some(key => url.searchParams.getAll(key).length !== 1)) throw fail(400,'Informe um único destino e ambiente.');
  const provider = url.searchParams.get('provider'), id = url.searchParams.get('target_id'), environment = url.searchParams.get('environment');
  if (!['vercel','easypanel'].includes(provider) || !ENVIRONMENTS.includes(environment) || !id || id.length > 240) throw fail(400,'Destino ou ambiente inválido.');
  const inventory = (await options())[provider];
  if (inventory.status !== 'ok') throw fail(503,'Inventário indisponível. Tente novamente mais tarde.');
  const target = inventory.items.find(t => t.id === id);
  if (!target) throw fail(404,'Destino não encontrado no inventário acessível.');
  reply(200, await settings({provider,target,environment}));
 });
 router.get('/api/delivery/options', async ({ url, reply }) => {
  onlyParams(url.searchParams, []);
  reply(200, { ...await options(), stacks: STACKS, kinds: KINDS, environments: ENVIRONMENTS });
 });
 router.get('/api/delivery/projects', async ({ pool, url, reply }) => {
  onlyParams(url.searchParams, []);
  const rows = (await pool.query('SELECT id,specification,revision,updated_at FROM delivery_projects ORDER BY updated_at DESC LIMIT 201')).rows;
  reply(200, { projects: rows.slice(0, 200).map(present), truncated: rows.length > 200 });
 });
 const save = async ({ req, params, pool, url, reply }) => {
  onlyParams(url.searchParams, []);
  if (params.id && !isUuid(params.id)) throw fail(400, 'Projeto inválido.');
  const body = await json(req);
  const spec = validateProject(body);
  if (params.id ? !Number.isInteger(body.revision) || body.revision < 1 : body.revision !== undefined)
   throw fail(400, 'Revisão inválida.');
  const available = await options();
  const client = await pool.connect();
  try {
   await client.query('BEGIN');
   const before = params.id ? (await client.query('SELECT id,specification,revision FROM delivery_projects WHERE id=$1 FOR UPDATE', [params.id])).rows[0] : null;
   if (params.id && !before) throw fail(404, 'Projeto não encontrado.');
   if (before && before.revision !== body.revision) throw fail(409, 'Este projeto mudou. Reabra o cadastro antes de editar.');
   // Durante uma indisponibilidade, preservar vínculos existentes é permitido;
   // acrescentar ou trocar um vínculo exige inventário acessível ao servidor.
   if (spec.repository_id) {
    const repo = available.github.items.find(r => r.id === spec.repository_id && !r.archived);
    if (!repo && before?.specification.repository_id !== spec.repository_id) throw fail(400, 'Escolha um repositório acessível e não arquivado na lista do GitHub.');
    spec.repository_name = repo?.name || before.specification.repository_name;
   } else spec.repository_name = null;
   for (const c of spec.components) for (const b of c.bindings) {
    const target = available[b.provider].items.find(t => t.id === b.target_id);
    const previous = before?.specification.components.find(p => p.id === c.id)?.bindings.find(p => p.provider === b.provider && p.target_id === b.target_id && p.environment === b.environment);
    if (!target && !previous) throw fail(400, 'Destino não encontrado. Atualize a lista da plataforma.');
    if (target && ((b.provider === 'vercel' && ['worker','database','cache'].includes(c.kind)) ||
     (b.provider === 'easypanel' && (c.kind === 'database' ? !['postgres','mysql','mariadb','mongo','mongodb'].includes(target.type) : c.kind === 'cache' ? target.type !== 'redis' : !['app','compose','box','wordpress'].includes(target.type)))))
     throw fail(400, 'O tipo do destino não corresponde à função do componente.');
    b.target_name = target?.name || previous.target_name;
   }
   const row = before
    ? (await client.query('UPDATE delivery_projects SET specification=$1,revision=revision+1,updated_at=now() WHERE id=$2 RETURNING id,specification,revision,updated_at', [spec, params.id])).rows[0]
    : (await client.query('INSERT INTO delivery_projects(specification) VALUES($1) RETURNING id,specification,revision,updated_at', [spec])).rows[0];
   await client.query('INSERT INTO delivery_audit(project_id,revision,before_specification,after_specification) VALUES($1,$2,$3,$4)', [row.id,row.revision,before?.specification || null,spec]);
   await client.query('COMMIT');
   reply(before ? 200 : 201, { project: present(row) });
  } catch (error) { await client.query('ROLLBACK'); throw error; }
  finally { client.release(); }
 };
 router.post('/api/delivery/projects', save);
 router.put('/api/delivery/projects/:id', save);
}
