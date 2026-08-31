// Consulta server-to-server de acesso. Consumida pelo backend do produto,
// nunca pelo navegador: a credencial identifica o PRODUTO, não uma sessão de usuário.
//
// Direitos são lidos ao vivo, sem cache: revogação vale na próxima consulta.
import { text, isUuid, onlyParams, fail } from '../platform/http.mjs';
import { digest } from '../platform/session.mjs';

export const authenticateApp = (pool, bearer) =>
 pool.query('SELECT product_id FROM app_clients WHERE token_hash=$1 AND active=true', [digest(bearer)])
  .then(result => result.rows[0]?.product_id || null);

export function accessRoutes(router) {
 router.get('/v1/context', async ({ pool, url, reply, productId }) => {
  onlyParams(url.searchParams, ['tenant_id', 'subject']);
  const tenant = url.searchParams.get('tenant_id');
  const subject = text(url.searchParams.get('subject'));
  if (!isUuid(tenant)) throw fail(400, 'Tenant inválido.');
  // O vínculo tem de ser DESTE produto: contratar outro produto não abre este.
  const result = await pool.query(
   `SELECT e.plan,e.rights,e.version FROM entitlements e
      JOIN tenants t ON t.id=e.tenant_id
      JOIN memberships m ON m.tenant_id=t.id AND m.product_id=e.product_id
     WHERE t.id=$1 AND m.subject=$2 AND e.product_id=$3
       AND t.status='active' AND m.active AND e.active`,
   [tenant, subject, productId]);
  if (!result.rowCount) throw fail(403, 'Acesso não autorizado.');
  return reply(200, {
   tenant_id: tenant, subject, product_id: productId,
   ...result.rows[0], checked_at: new Date().toISOString(),
  });
 }, { auth: 'service', body: false });
}
