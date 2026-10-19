// Contexto B — gestão de UM produto.
//
// Recorte: uma organização só aparece aqui se existir contrato (entitlement)
// dela para ESTE produto. Nada é inferido; o Core não cria vínculo entre
// organização e produto por proximidade, catálogo ou nome.
//
// As contagens de pessoas são deste produto: o vínculo é por organização E
// produto (docs/decisions/0002-vinculo-de-pessoa-por-produto.md), e a resposta
// declara isso em membership_scope.
import { isProductId, onlyParams, fail } from '../platform/http.mjs';
import { findEditableProduct, findCatalogEntry, capabilitiesOf } from './catalog.mjs';

// Contratações do item: é o que uma linha de serviço tem no lugar de contrato de
// acesso. Arquivadas ficam fora, como nas demais listas de trabalho.
const ENGAGEMENTS = `
 SELECT e.id, e.tenant_id, t.name AS tenant_name, t.slug AS tenant_slug,
        t.relationship_kind, t.organization_type, t.lifecycle_status AS tenant_lifecycle_status, t.status AS tenant_status,
        e.label, e.service_model, e.status, e.revision, e.updated_at
   FROM client_engagements e
   JOIN tenants t ON t.id = e.tenant_id
  WHERE e.product_id = $1 AND e.archived_at IS NULL
  ORDER BY t.name, e.label`;

const ORGANIZATIONS = `
 SELECT t.id AS tenant_id, t.name, t.slug, t.status, t.relationship_kind, t.organization_type, t.lifecycle_status, t.created_at,
        e.plan, e.active AS contract_active, e.rights,
        e.version::int AS contract_version, e.updated_at AS contract_updated_at,
        COUNT(m.subject) FILTER (WHERE m.active)::int AS active_memberships,
        COUNT(m.subject)::int AS total_memberships
   FROM entitlements e
   JOIN tenants t ON t.id = e.tenant_id
   LEFT JOIN memberships m ON m.tenant_id = t.id AND m.product_id = e.product_id
  WHERE e.product_id = $1
  GROUP BY t.id, e.plan, e.active, e.rights, e.version, e.updated_at
  ORDER BY t.name`;

const COMMERCIAL_CONTRACT_TENANTS = `
 SELECT DISTINCT t.id AS tenant_id, t.name, t.slug, t.status, t.relationship_kind, t.organization_type, t.lifecycle_status
   FROM commercial_contracts c
   JOIN tenants t ON t.id = c.tenant_id
  WHERE c.product_id = $1`;

export function productConsoleRoutes(router) {
 router.get('/api/products/:productId/console', async ({ pool, reply, params, url }) => {
  onlyParams(url.searchParams, []);
  if (!isProductId(params.productId)) throw fail(400, 'Produto inválido.');

  const product = await findEditableProduct(pool, params.productId);
  if (!product) throw fail(404, 'Produto não encontrado.');

  const [organizations, catalog, profile, engagements, contractTenants] = await Promise.all([
   pool.query(ORGANIZATIONS, [product.id]).then(result => result.rows),
   findCatalogEntry(pool, product.id),
   pool.query('SELECT portfolio_kind,brand_family,lifecycle_status FROM products WHERE id=$1',[product.id]).then(result=>result.rows[0]||{}),
   pool.query(ENGAGEMENTS, [product.id]).then(result => result.rows),
   pool.query(COMMERCIAL_CONTRACT_TENANTS, [product.id]).then(result => result.rows).catch(() => []),
  ]);

  const clientMap = new Map();
  const ensureClient = (tenantId, info) => {
   if (!clientMap.has(tenantId)) {
    clientMap.set(tenantId, {
     tenant_id: tenantId,
     name: info.name || info.tenant_name || 'Cliente',
     slug: info.slug || info.tenant_slug || '',
     status: info.status || info.tenant_status || 'active',
     relationship_kind: info.relationship_kind || 'customer',
     organization_type: info.organization_type || 'company',
     lifecycle_status: info.lifecycle_status || info.tenant_lifecycle_status || 'active',
     engagements: [],
     entitlement: null,
     stakeholders_count: 0,
     activities_count: 0,
     hours_minutes: 0,
    });
   }
   return clientMap.get(tenantId);
  };

  for (const org of organizations) {
   const c = ensureClient(org.tenant_id, org);
   c.entitlement = {
    plan: org.plan,
    contract_active: org.contract_active,
    rights: org.rights || [],
    contract_version: org.contract_version,
    contract_updated_at: org.contract_updated_at,
    active_memberships: org.active_memberships,
    total_memberships: org.total_memberships,
   };
  }
  for (const eng of engagements) {
   const c = ensureClient(eng.tenant_id, eng);
   c.engagements.push({
    id: eng.id,
    label: eng.label,
    service_model: eng.service_model,
    status: eng.status,
    revision: eng.revision ?? 1,
    updated_at: eng.updated_at,
   });
  }
  for (const ct of contractTenants) {
   ensureClient(ct.tenant_id, ct);
  }

  const tenantIds = [...clientMap.keys()];
  if (tenantIds.length) {
   const [peopleCounts, trackingCounts] = await Promise.all([
    pool.query('SELECT tenant_id, COUNT(*)::int AS count FROM organization_stakeholders WHERE tenant_id = ANY($1::uuid[]) GROUP BY tenant_id', [tenantIds]).then(r => r.rows).catch(() => []),
    pool.query(`
     SELECT a.tenant_id, COUNT(DISTINCT a.id)::int AS activities, COALESCE(SUM(l.minutes), 0)::int AS minutes
       FROM service_activities a
       LEFT JOIN client_engagements e ON e.id = a.engagement_id
       LEFT JOIN service_time_logs l ON l.activity_id = a.id
      WHERE a.tenant_id = ANY($1::uuid[]) AND e.product_id = $2
      GROUP BY a.tenant_id`, [tenantIds, product.id]).then(r => r.rows).catch(() => []),
   ]);
   for (const row of peopleCounts) {
    const c = clientMap.get(row.tenant_id);
    if (c) c.stakeholders_count = row.count;
   }
   for (const row of trackingCounts) {
    const c = clientMap.get(row.tenant_id);
    if (c) {
     c.activities_count = row.activities;
     c.hours_minutes = row.minutes;
    }
   }
  }

  const clients = [...clientMap.values()].sort((a, b) => a.name.localeCompare(b.name, 'pt-BR'));
  const active = organizations.filter(row => row.contract_active && row.status === 'active');
  const activeEngagements = engagements.filter(e => ['planned', 'active', 'paused'].includes(e.status));
  return reply(200, {
   product: {
    id: product.id,
    name: product.name,
    ...profile,
    capabilities: capabilitiesOf(profile.portfolio_kind),
    // Ficha cadastral do Notion quando existir; ausência não é erro.
    catalog: catalog ? { ...catalog.payload, imported_at: catalog.imported_at } : null,
   },
   summary: {
    clients: clients.length,
    organizations: organizations.length,
    active_contracts: active.length,
    revoked_contracts: organizations.filter(row => !row.contract_active).length,
    suspended_organizations: organizations.filter(row => row.status === 'suspended').length,
    engagements: engagements.length,
    active_engagements: activeEngagements.length,
    // Pessoas que hoje alcançam ESTE produto: vínculo ativo deste produto,
    // em organização ativa com contrato ativo — o mesmo critério de /v1/context.
    reachable_memberships: active.reduce((total, row) => total + row.active_memberships, 0),
   },
   membership_scope: 'product',
   clients,
   organizations,
   engagements,
   generated_at: new Date().toISOString(),
  });
 }, { body: false });
}
