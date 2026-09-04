// Contexto A — gestão geral da TZOLKIN: visão transversal do Core.
// Retorna o cadastro completo; ainda sem paginação (volume atual é cadastral).

// Estado do transporte do banco, em forma consumível. 'unknown' quando não medido:
// nunca reportar 'tls' sem prova. Não expõe host nem credencial.
const transport = security => {
 if (!security) return { transport: 'unknown', insecure: null };
 return {
  transport: security.tls ? (security.verified ? 'tls-verified' : 'tls-unverified') : 'plaintext',
  insecure: security.insecure,
 };
};

export function workspaceRoutes(router) {
 router.get('/health', async ({ pool, reply, security, sessions }) => {
  await pool.query('SELECT 1');
  return reply(200, {
   service: 'tzolkin-core', database: 'connected', mode: sessions.mode === 'google-oidc' ? 'production' : 'local-bootstrap',
   database_transport: transport(security).transport,
  });
 }, { auth: 'public' });

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
   tenants: tenants.rows, products: products.rows,
   memberships: memberships.rows, entitlements: entitlements.rows,
   engagements: engagements.rows, stakeholders: stakeholders.rows,
   // O operador precisa ver, sem procurar, que o banco está em texto claro.
   security: transport(security),
  });
 });
}
