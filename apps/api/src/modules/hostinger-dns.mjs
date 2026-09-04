import { onlyParams } from '../platform/http.mjs';
import { createHostingerDnsAdapter } from '../integrations/hostinger-dns.mjs';

export function hostingerDnsRoutes(router, { adapter = createHostingerDnsAdapter() } = {}) {
 let cached = null;
 router.get('/api/dns/hostinger', async ({ url, reply }) => {
  onlyParams(url.searchParams, []);
  const now = Date.now();
  if (!cached || now - cached.checked > 30_000) cached = { checked: now, value: await adapter.readZone() };
  reply(200, { ...cached.value, provider: 'hostinger', checked_at: new Date(cached.checked).toISOString() });
 }, { body: false });
}
