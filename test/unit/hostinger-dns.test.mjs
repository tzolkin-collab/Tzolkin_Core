import test from 'node:test';
import assert from 'node:assert/strict';
import { createHostingerDnsAdapter, normalizeHostingerZone } from '../../apps/api/src/integrations/hostinger-dns.mjs';

test('Hostinger DNS projects only the zone fields needed by the Core', () => {
 const zone = normalizeHostingerZone([{ name: 'app', type: 'CNAME', ttl: 300, records: [{ content: 'cname.vercel-dns.com.', is_disabled: false }] }]);
 assert.deepEqual(zone, [{ name: 'app', type: 'CNAME', ttl: 300, records: [{ content: 'cname.vercel-dns.com.', disabled: false }] }]);
 assert.throws(() => normalizeHostingerZone([{ name: 'bad\n', type: 'A', ttl: 10, records: [] }]));
});

test('Hostinger DNS is server-side, bounded and honest when unavailable', async () => {
 const calls = [];
 const adapter = createHostingerDnsAdapter({ env: { HOSTINGER_API_KEY: 'token', HOSTINGER_DNS_ZONE: 'tzolkin.cloud' }, fetchImpl: async (url, init) => { calls.push({ url, init }); return Response.json([{ name: '@', type: 'A', ttl: 300, records: [{ content: '203.0.113.10', is_disabled: false }] }]); } });
 const result = await adapter.readZone();
 assert.equal(result.status, 'ok'); assert.equal(result.records[0].type, 'A');
 assert.equal(calls[0].url.origin, 'https://developers.hostinger.com'); assert.equal(calls[0].url.pathname, '/api/dns/v1/zones/tzolkin.cloud');
 assert.equal(calls[0].init.headers.Authorization, 'Bearer token');
 const unavailable = createHostingerDnsAdapter({ env: { HOSTINGER_API_KEY: 'token' }, fetchImpl: async () => { throw Error('network'); } });
 assert.equal((await unavailable.readZone()).status, 'unavailable');
});
