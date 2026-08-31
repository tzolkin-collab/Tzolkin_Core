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
 router.get('/health', async ({ pool, reply, security }) => {
  await pool.query('SELECT 1');
  return reply(200, {
   service: 'tzolkin-core', database: 'connected', mode: 'local-bootstrap',
   database_transport: transport(security).transport,
  });
 }, { auth: 'public' });

 router.get('/api/overview', async ({ pool, reply, security }) => {
  const [tenants, products, memberships, entitlements] = await Promise.all([
   'SELECT * FROM tenants ORDER BY created_at DESC',
   'SELECT * FROM products ORDER BY name',
   'SELECT * FROM memberships',
   'SELECT * FROM entitlements',
  ].map(sql => pool.query(sql)));
  return reply(200, {
   tenants: tenants.rows, products: products.rows,
   memberships: memberships.rows, entitlements: entitlements.rows,
   // O operador precisa ver, sem procurar, que o banco está em texto claro.
   security: transport(security),
  });
 });
}
