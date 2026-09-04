import { fail, input, isProductId, isUuid, onlyParams, text } from '../platform/http.mjs';
import { findEditableProduct } from './catalog.mjs';

const resourceTypes = ['repository','frontend','backend','domain','api','worker','database','cache','checkout','email'];
const providers = ['github','vercel','easypanel','hostinger','stripe','asaas','manual'];
const environments = ['development','staging','production','internal'];
const select = `SELECT id,product_id,resource_type,provider,external_id,display_name,environment,url,created_at,updated_at
 FROM product_resource_bindings`;

const optionalUrl = value => {
 if (value === null || value === undefined || value === '') return null;
 const candidate = text(value, 8, 1000);
 try { const parsed = new URL(candidate); if (parsed.protocol !== 'https:') throw new Error(); }
 catch { throw fail(400, 'A URL da conexão deve usar HTTPS.'); }
 return candidate;
};

const validate = body => {
 input(body, ['id','product_id','resource_type','provider','external_id','display_name','environment','url']);
 if (body.id !== undefined && !isUuid(body.id)) throw fail(400, 'Conexão inválida.');
 if (!isProductId(body.product_id)) throw fail(400, 'Produto inválido.');
 if (!resourceTypes.includes(body.resource_type) || !providers.includes(body.provider)) throw fail(400, 'Tipo ou provedor inválido.');
 if (body.environment !== null && body.environment !== undefined && !environments.includes(body.environment)) throw fail(400, 'Ambiente inválido.');
 return {
  id: body.id || null,
  product_id: body.product_id,
  resource_type: body.resource_type,
  provider: body.provider,
  external_id: text(body.external_id, 1, 300),
  display_name: text(body.display_name, 1, 240),
  environment: body.environment || null,
  url: optionalUrl(body.url),
 };
};

const actor = operator => operator?.email || operator?.subject || 'local-operator';
const isLegacyDeploy = row => ['frontend','backend'].includes(row?.resource_type) && ['vercel','easypanel'].includes(row?.provider);
const audit = (client, row, action, operator, beforeValue, afterValue) => client.query(
 'INSERT INTO product_resource_audit(binding_id,product_id,action,actor,before_value,after_value) VALUES($1,$2,$3,$4,$5,$6)',
 [row.id,row.product_id,action,actor(operator),beforeValue,afterValue],
);

export function productResourceBindingRoutes(router) {
 router.get('/api/product-resource-bindings', async ({ pool, url, reply }) => {
  onlyParams(url.searchParams, ['product_id']);
  const productId = url.searchParams.get('product_id');
  if (productId && !isProductId(productId)) throw fail(400, 'Produto inválido.');
  const result = productId
   ? await pool.query(`${select} WHERE product_id=$1 ORDER BY resource_type,display_name`, [productId])
   : await pool.query(`${select} ORDER BY product_id,resource_type,display_name`);
  return reply(200, { bindings: result.rows });
 }, { body: false });

 router.put('/api/product-resource-bindings', async ({ client, body, operator }) => {
  const binding = validate(body);
  if (!await findEditableProduct(client, binding.product_id)) throw fail(400, 'Produto não encontrado ou arquivado.');
  let previous = null;
  if (binding.id) {
   previous = (await client.query(`${select} WHERE id=$1 FOR UPDATE`, [binding.id])).rows[0];
   if (!previous) throw fail(404, 'Conexão não encontrada.');
  } else {
   previous = (await client.query(`${select} WHERE resource_type=$1 AND provider=$2 AND external_id=$3 FOR UPDATE`, [binding.resource_type,binding.provider,binding.external_id])).rows[0] || null;
   if (previous && previous.product_id !== binding.product_id) throw fail(409, 'Este recurso já está confirmado em outro produto. Remova ou edite o vínculo existente primeiro.');
  }
  const values = [binding.product_id,binding.resource_type,binding.provider,binding.external_id,binding.display_name,binding.environment,binding.url];
  const row = binding.id
   ? (await client.query(`UPDATE product_resource_bindings SET product_id=$1,resource_type=$2,provider=$3,external_id=$4,display_name=$5,environment=$6,url=$7,updated_at=now() WHERE id=$8 RETURNING *`, [...values,binding.id])).rows[0]
   : (await client.query(`INSERT INTO product_resource_bindings(product_id,resource_type,provider,external_id,display_name,environment,url)
      VALUES($1,$2,$3,$4,$5,$6,$7)
      ON CONFLICT(resource_type,provider,external_id) DO UPDATE SET product_id=EXCLUDED.product_id,display_name=EXCLUDED.display_name,environment=EXCLUDED.environment,url=EXCLUDED.url,updated_at=now()
      RETURNING *`, values)).rows[0];
  if (isLegacyDeploy(previous) && (!isLegacyDeploy(row) || previous.provider !== row.provider || previous.external_id !== row.external_id))
   await client.query('DELETE FROM product_deploy_bindings WHERE provider=$1 AND external_project_id=$2 AND product_id=$3', [previous.provider,previous.external_id,previous.product_id]);
  if (isLegacyDeploy(row)) await client.query(`INSERT INTO product_deploy_bindings(provider,external_project_id,external_project_name,product_id,environment)
   VALUES($1,$2,$3,$4,$5) ON CONFLICT(provider,external_project_id) DO UPDATE SET external_project_name=EXCLUDED.external_project_name,product_id=EXCLUDED.product_id,environment=EXCLUDED.environment,updated_at=now()`,
   [row.provider,row.external_id,row.display_name,row.product_id,row.environment || 'production']);
  await audit(client, row, previous ? 'updated' : 'created', operator, previous, row);
  return { tenant: null, type: `product.resource.${previous ? 'updated' : 'created'}` };
 }, { transactional: true, audit: false });

 router.delete('/api/product-resource-bindings/:id', async ({ client, params, operator }) => {
  if (!isUuid(params.id)) throw fail(400, 'Conexão inválida.');
  const row = (await client.query(`${select} WHERE id=$1 FOR UPDATE`, [params.id])).rows[0];
  if (!row) throw fail(404, 'Conexão não encontrada.');
  await client.query('DELETE FROM product_resource_bindings WHERE id=$1', [params.id]);
  if (isLegacyDeploy(row)) await client.query('DELETE FROM product_deploy_bindings WHERE provider=$1 AND external_project_id=$2 AND product_id=$3', [row.provider,row.external_id,row.product_id]);
  await audit(client, row, 'deleted', operator, row, null);
  return { tenant: null, type: 'product.resource.deleted' };
 }, { transactional: true, audit: false });
}
