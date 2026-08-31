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
import { findProduct, findCatalogEntry } from './catalog.mjs';

const ORGANIZATIONS = `
 SELECT t.id AS tenant_id, t.name, t.slug, t.status, t.created_at,
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

export function productConsoleRoutes(router) {
 router.get('/api/products/:productId/console', async ({ pool, reply, params, url }) => {
  onlyParams(url.searchParams, []);
  if (!isProductId(params.productId)) throw fail(400, 'Produto inválido.');

  const product = await findProduct(pool, params.productId);
  if (!product) throw fail(404, 'Produto não encontrado.');

  const [organizations, catalog] = await Promise.all([
   pool.query(ORGANIZATIONS, [product.id]).then(result => result.rows),
   findCatalogEntry(pool, product.id),
  ]);

  const active = organizations.filter(row => row.contract_active && row.status === 'active');
  return reply(200, {
   product: {
    id: product.id,
    name: product.name,
    // Ficha cadastral do Notion quando existir; ausência não é erro.
    catalog: catalog ? { ...catalog.payload, imported_at: catalog.imported_at } : null,
   },
   summary: {
    organizations: organizations.length,
    active_contracts: active.length,
    revoked_contracts: organizations.filter(row => !row.contract_active).length,
    suspended_organizations: organizations.filter(row => row.status === 'suspended').length,
    // Pessoas que hoje alcançam ESTE produto: vínculo ativo deste produto,
    // em organização ativa com contrato ativo — o mesmo critério de /v1/context.
    reachable_memberships: active.reduce((total, row) => total + row.active_memberships, 0),
   },
   membership_scope: 'product',
   organizations,
   generated_at: new Date().toISOString(),
  });
 }, { body: false });
}
