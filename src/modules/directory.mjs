// Organizações (tenants) e vínculos de identidade externa (memberships).
//
// O vínculo é por organização E produto: a pessoa alcança apenas os produtos
// em que foi vinculada, mesmo que a organização contrate outros.
// Decisão em docs/decisions/0002-vinculo-de-pessoa-por-produto.md.
import { input, text, isUuid, isProductId, fail } from '../platform/http.mjs';

export function directoryRoutes(router) {
 router.post('/api/tenants', async ({ client, body }) => {
  input(body, ['name', 'slug']);
  const name = text(body.name, 2, 160);
  const slug = text(body.slug, 2, 64);
  if (!/^[a-z0-9][a-z0-9-]+$/.test(slug)) throw fail(400, 'Use letras minúsculas, números e hífen no identificador.');
  const created = await client.query('INSERT INTO tenants(name,slug) VALUES($1,$2) RETURNING id', [name, slug]);
  return { tenant: created.rows[0].id, type: 'tenant.created' };
 }, { transactional: true });

 router.put('/api/tenants', async ({ client, body }) => {
  input(body, ['tenant_id', 'status']);
  if (!isUuid(body.tenant_id) || !['active', 'suspended'].includes(body.status)) throw fail(400, 'Tenant/status inválido.');
  const updated = await client.query('UPDATE tenants SET status=$2 WHERE id=$1', [body.tenant_id, body.status]);
  if (!updated.rowCount) throw fail(404, 'Tenant não encontrado.');
  return { tenant: body.tenant_id, type: 'tenant.status_changed' };
 }, { transactional: true });

 router.put('/api/memberships', async ({ client, body }) => {
  input(body, ['tenant_id', 'product_id', 'subject', 'active']);
  if (!isUuid(body.tenant_id) || typeof body.active !== 'boolean') throw fail(400, 'Vínculo inválido.');
  if (!isProductId(body.product_id)) throw fail(400, 'Produto inválido.');
  // A FK de product_id recusa produto inexistente; o erro vira 409 em describeError.
  await client.query(
   `INSERT INTO memberships(tenant_id,subject,product_id,active) VALUES($1,$2,$3,$4)
    ON CONFLICT(tenant_id,subject,product_id) DO UPDATE SET active=EXCLUDED.active`,
   [body.tenant_id, text(body.subject), body.product_id, body.active]);
  return { tenant: body.tenant_id, type: 'membership.changed' };
 }, { transactional: true });
}
