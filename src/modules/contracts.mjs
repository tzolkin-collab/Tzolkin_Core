// Contratos de produto (entitlements): plano cadastral + direitos granulares.
// Não é motor de cobrança: nenhum preço, ciclo ou pagamento é modelado aqui.
import { input, text, isUuid, fail } from '../platform/http.mjs';

export function contractsRoutes(router) {
 router.put('/api/entitlements', async ({ client, body }) => {
  input(body, ['tenant_id', 'product_id', 'plan', 'rights', 'active']);
  if (!isUuid(body.tenant_id) || typeof body.active !== 'boolean' || !Array.isArray(body.rights) || body.rights.length > 30)
   throw fail(400, 'Contrato inválido.');
  const rights = [...new Set(body.rights.map(right => text(right, 1, 80)))];
  if (rights.some(right => !/^[a-z][a-z0-9_.:-]*$/.test(right))) throw fail(400, 'Direito inválido.');
  await client.query(
   `INSERT INTO entitlements(tenant_id,product_id,plan,rights,active) VALUES($1,$2,$3,$4,$5)
    ON CONFLICT(tenant_id,product_id) DO UPDATE SET
     plan=EXCLUDED.plan, rights=EXCLUDED.rights, active=EXCLUDED.active,
     version=entitlements.version+1, updated_at=now()`,
   [body.tenant_id, text(body.product_id), text(body.plan, 1, 80), rights, body.active]);
  return { tenant: body.tenant_id, type: 'entitlement.changed' };
 }, { transactional: true });
}
