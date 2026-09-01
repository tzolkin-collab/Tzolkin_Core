// Organizações (tenants) e vínculos de identidade externa (memberships).
//
// O vínculo é por organização E produto: a pessoa alcança apenas os produtos
// em que foi vinculada, mesmo que a organização contrate outros.
// Decisão em docs/decisions/0002-vinculo-de-pessoa-por-produto.md.
import { input, text, isUuid, isProductId, fail } from '../platform/http.mjs';

export function directoryRoutes(router) {
 router.post('/api/tenants', async ({ client, body }) => {
  input(body, ['name', 'slug', 'relationship_kind', 'lifecycle_status', 'organization_type']);
  const name = text(body.name, 2, 160);
  const slug = text(body.slug, 2, 64);
  const relationship = body.relationship_kind || 'customer';
  const lifecycle = body.lifecycle_status || 'active';
  const organization = body.organization_type || 'company';
  if (!/^[a-z0-9][a-z0-9-]+$/.test(slug)) throw fail(400, 'Use letras minúsculas, números e hífen no identificador.');
  if (!['internal','customer','prospect','partner'].includes(relationship) ||
      !['lead','onboarding','active','paused','completed','discontinued','unclassified'].includes(lifecycle) ||
      !['company','person','nonprofit','internal'].includes(organization)) throw fail(400, 'Classificação inválida.');
  const created = await client.query(
   'INSERT INTO tenants(name,slug,relationship_kind,lifecycle_status,organization_type) VALUES($1,$2,$3,$4,$5) RETURNING id',
   [name, slug, relationship, lifecycle, organization]);
  return { tenant: created.rows[0].id, type: 'tenant.created' };
 }, { transactional: true });

 router.post('/api/engagements', async ({ client, body }) => {
  input(body, ['tenant_id', 'product_id', 'service_model', 'status', 'label']);
  if (!isUuid(body.tenant_id) || (body.product_id !== null && !isProductId(body.product_id))) throw fail(400, 'Empresa ou oferta inválida.');
  if (!['consulting','advisory','on_demand','mentorship','subscription','education','unclassified'].includes(body.service_model) ||
      !['planned','active','paused','completed','discontinued','unclassified'].includes(body.status)) throw fail(400, 'Contratação inválida.');
  await client.query(`INSERT INTO client_engagements(tenant_id,product_id,service_model,status,label) VALUES($1,$2,$3,$4,$5)
   ON CONFLICT(tenant_id,label) DO UPDATE SET product_id=EXCLUDED.product_id,service_model=EXCLUDED.service_model,status=EXCLUDED.status`,
  [body.tenant_id, body.product_id, body.service_model, body.status, text(body.label,2,120)]);
  return { tenant: body.tenant_id, type: 'engagement.saved' };
 }, { transactional: true });

 router.post('/api/stakeholders', async ({ client, body }) => {
  input(body, ['tenant_id', 'name', 'role', 'title', 'is_primary', 'contact_allowed']);
  if (!isUuid(body.tenant_id) || !['owner','decision_maker','champion','finance','technical','operational','student','contact'].includes(body.role) ||
      typeof body.is_primary !== 'boolean' || typeof body.contact_allowed !== 'boolean') throw fail(400, 'Stakeholder inválido.');
  const person=await client.query('INSERT INTO stakeholders(name) VALUES($1) RETURNING id',[text(body.name,2,160)]);
  await client.query(`INSERT INTO organization_stakeholders(tenant_id,stakeholder_id,role,title,is_primary,contact_allowed)
   VALUES($1,$2,$3,$4,$5,$6)`,[body.tenant_id,person.rows[0].id,body.role,body.title?text(body.title,2,120):null,body.is_primary,body.contact_allowed]);
  return { tenant: body.tenant_id, type: 'stakeholder.created' };
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
