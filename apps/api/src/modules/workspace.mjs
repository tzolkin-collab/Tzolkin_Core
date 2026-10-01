// Contexto A — gestão geral da TZOLKIN: visão transversal do Core.
// Retorna o cadastro completo; ainda sem paginação (volume atual é cadastral).
import { KIND_ALIASES, KIND_REGISTRY, canonicalKind, capabilitiesOf } from './catalog.mjs';

// Estado do transporte do banco, em forma consumível. 'unknown' quando não medido:
// nunca reportar 'tls' sem prova. Não expõe host nem credencial.
const transport = security => {
 if (!security) return { transport: 'unknown', insecure: null };
 return {
  transport: security.tls ? (security.verified ? 'tls-verified' : 'tls-unverified') : 'plaintext',
  insecure: security.insecure,
 };
};

// O primeiro quadro do painel precisa do cadastro, do catálogo e dos vínculos,
// mas não precisa pagar uma ida remota ao Postgres para cada coleção. As
// subconsultas continuam independentes e devolvem o mesmo contrato público em
// uma única viagem de rede. Inventários externos não entram neste bootstrap.
const BOOTSTRAP_SQL = `SELECT
 COALESCE((SELECT jsonb_agg(to_jsonb(t) ORDER BY t.created_at DESC) FROM tenants t), '[]'::jsonb) AS tenants,
 COALESCE((SELECT jsonb_agg(to_jsonb(p) ORDER BY p.lifecycle_status DESC,p.name)
   FROM products p WHERE p.lifecycle_status IN ('active','draft')), '[]'::jsonb) AS products,
 COALESCE((SELECT jsonb_agg(to_jsonb(m)) FROM memberships m), '[]'::jsonb) AS memberships,
 COALESCE((SELECT jsonb_agg(to_jsonb(e)) FROM entitlements e), '[]'::jsonb) AS entitlements,
 COALESCE((SELECT jsonb_agg(to_jsonb(ce) ORDER BY ce.created_at) FROM client_engagements ce), '[]'::jsonb) AS engagements,
 COALESCE((SELECT jsonb_agg(to_jsonb(stakeholder) ORDER BY stakeholder.name) FROM (
   SELECT os.tenant_id,os.role,os.title,os.is_primary,os.contact_allowed,s.id,s.name
   FROM organization_stakeholders os JOIN stakeholders s ON s.id=os.stakeholder_id
 ) stakeholder), '[]'::jsonb) AS stakeholders,
 COALESCE((SELECT jsonb_agg(jsonb_build_object('kind',e.kind,'payload',e.payload,'imported_at',e.imported_at) ORDER BY e.id)
   FROM ecosystem_entries e), '[]'::jsonb) AS entries,
 COALESCE((SELECT jsonb_agg(to_jsonb(binding) ORDER BY binding.active DESC,binding.product_id,binding.resource_type,binding.display_name)
   FROM (SELECT id,product_id,engagement_id,resource_type,provider,external_id,external_id_kind,
    display_name,environment,url,active,deactivated_at,unbind_reason,revision,created_at,updated_at
    FROM product_resource_bindings WHERE active) binding), '[]'::jsonb) AS resource_bindings`;

// to_jsonb serializa timestamptz como "…123456+00:00"; o driver pg entregava Date,
// que vira "…123Z" no JSON. Só as colunas *_at de topo são normalizadas: o payload
// jsonb do catálogo é dado do cliente e passa intacto.
const isoTimestamps = row => {
 const out = { ...row };
 for (const key of Object.keys(out)) {
  if (key.endsWith('_at') && typeof out[key] === 'string') out[key] = new Date(out[key]).toISOString();
 }
 return out;
};
const withIsoTimestamps = rows => (rows || []).map(isoTimestamps);

const overviewPayload = (rows, security) => ({
 portfolio_kinds: KIND_REGISTRY,
 kind_aliases: KIND_ALIASES,
 tenants: withIsoTimestamps(rows.tenants),
 products: (rows.products || []).map(product => ({
  ...isoTimestamps(product),
  portfolio_kind: canonicalKind(product.portfolio_kind),
  capabilities: capabilitiesOf(product.portfolio_kind),
 })),
 memberships: withIsoTimestamps(rows.memberships),
 entitlements: withIsoTimestamps(rows.entitlements),
 engagements: withIsoTimestamps(rows.engagements),
 stakeholders: rows.stakeholders || [],
 security: transport(security),
});

export function workspaceRoutes(router) {
 router.get('/health', async ({ pool, reply, security, sessions }) => {
  await pool.query('SELECT 1');
  return reply(200, {
   service: 'tzolkin-core', database: 'connected', mode: sessions.mode === 'google-oidc' ? 'production' : 'local-bootstrap',
   database_transport: transport(security).transport,
  });
 }, { auth: 'public' });

 router.get('/api/bootstrap', async ({ pool, reply, security }) => {
  const { rows: [row] } = await pool.query(BOOTSTRAP_SQL);
  const data = row || {};
  const entries = (data.entries || []).map(isoTimestamps);
  return reply(200, {
   overview: overviewPayload(data, security),
   catalog: { entries },
   resource_bindings: { bindings: withIsoTimestamps(data.resource_bindings) },
  });
 });

 router.get('/api/overview', async ({ pool, reply, security }) => {
  // Reuse an idle connection instead of opening four remote TLS connections
  // during login. A cold pool can otherwise exhaust the connection deadline.
  const results = [];
  for (const sql of [
   'SELECT * FROM tenants ORDER BY created_at DESC',
   // O portfólio precisa mostrar produtos ativos e drafts; arquivados ficam
   // fora da operação corrente, mas continuam no banco para histórico.
   "SELECT * FROM products WHERE lifecycle_status IN ('active','draft') ORDER BY lifecycle_status DESC,name",
   'SELECT * FROM memberships',
   'SELECT * FROM entitlements',
   'SELECT * FROM client_engagements ORDER BY created_at',
   `SELECT os.tenant_id,os.role,os.title,os.is_primary,os.contact_allowed,s.id,s.name
    FROM organization_stakeholders os JOIN stakeholders s ON s.id=os.stakeholder_id ORDER BY s.name`,
  ]) results.push(await pool.query(sql));
  const [tenants, products, memberships, entitlements, engagements, stakeholders] = results;
  return reply(200, {
   // A tela monta o seletor e a navegação de cada contexto pelas capacidades;
   // ela não conhece a regra, só a lê daqui (ADR 0007).
   // O painel recebe os tipos (rótulo, plural, ícone, texto, ordem) daqui, e o tipo
   // de cada item já no nome atual: nome antigo ('product') sai como 'platform'.
   portfolio_kinds: KIND_REGISTRY, kind_aliases: KIND_ALIASES,
   tenants: tenants.rows, products: products.rows.map(product => ({ ...product, portfolio_kind: canonicalKind(product.portfolio_kind), capabilities: capabilitiesOf(product.portfolio_kind) })),
   memberships: memberships.rows, entitlements: entitlements.rows,
   engagements: engagements.rows, stakeholders: stakeholders.rows,
   // O operador precisa ver, sem procurar, que o banco está em texto claro.
   security: transport(security),
  });
 });
}
