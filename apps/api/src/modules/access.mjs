// Consulta server-to-server de acesso. Consumida pelo backend do produto,
// nunca pelo navegador: a credencial identifica o PRODUTO, não uma sessão de usuário.
//
// Direitos são lidos ao vivo, sem cache: revogação vale na próxima consulta.
import { text, isUuid, onlyParams, fail } from '../platform/http.mjs';
import { digest } from '../platform/session.mjs';
import { CAPABILITIES } from './catalog.mjs';
import { SCOPE_CAPABILITY } from './commercial-keys.mjs';

// O tipo do item é conferido de novo aqui, e não só ao emitir a chave: se o item
// for reclassificado depois, a chave antiga para de valer na consulta seguinte.
export async function authenticateApp(pool, bearer, scope = 'context:read') {
 const kinds = CAPABILITIES[SCOPE_CAPABILITY[scope]];
 if (!kinds) return null;
 const result = await pool.query(`UPDATE app_clients a SET last_used_at=now() FROM products p
 WHERE p.id=a.product_id AND p.lifecycle_status='active' AND p.portfolio_kind=ANY($3::text[]) AND a.token_hash=$1 AND a.active
 AND a.revoked_at IS NULL AND (a.expires_at IS NULL OR a.expires_at>now()) AND $2=ANY(a.scopes)
 RETURNING a.product_id`, [digest(bearer),scope,kinds]);
 return result.rows[0]?.product_id || null;
}

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
      JOIN products p ON p.id=e.product_id AND p.lifecycle_status='active' AND p.portfolio_kind=ANY($4::text[])
     WHERE t.id=$1 AND m.subject=$2 AND e.product_id=$3
       AND t.status='active' AND m.active AND e.active`,
   [tenant, subject, productId, CAPABILITIES.access]);
  if (!result.rowCount) throw fail(403, 'Acesso não autorizado.');
  return reply(200, {
   tenant_id: tenant, subject, product_id: productId, membership_scope: 'product',
   ...result.rows[0], checked_at: new Date().toISOString(),
  });
 }, { auth: 'service', scope: 'context:read', body: false });
}
