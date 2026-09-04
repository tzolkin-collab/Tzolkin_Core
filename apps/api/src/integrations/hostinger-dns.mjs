const invalid = () => new Error('Resposta DNS da Hostinger incompatível.');
const domain = value => typeof value === 'string' && /^(?=.{1,253}$)(?:[a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?\.)+[a-z]{2,63}$/i.test(value);
const value = (item, max = 1024) => typeof item === 'string' && item.length <= max && !/[\u0000-\u001f]/.test(item);

export function normalizeHostingerZone(body) {
 if (!Array.isArray(body) || body.length > 300) throw invalid();
 return body.map(record => {
  if (!record || !value(record.name, 255) || !value(record.type, 16) || !Number.isInteger(record.ttl) || record.ttl < 0 || record.ttl > 604800 || !Array.isArray(record.records) || record.records.length > 30) throw invalid();
  return {
   name: record.name,
   type: record.type.toUpperCase(),
   ttl: record.ttl,
   records: record.records.map(item => {
    if (!item || !value(item.content) || (item.is_disabled !== undefined && typeof item.is_disabled !== 'boolean')) throw invalid();
    return { content: item.content, disabled: item.is_disabled === true };
   }),
  };
 });
}

export function createHostingerDnsAdapter({ env = process.env, fetchImpl = fetch } = {}) {
 const token = env.HOSTINGER_API_KEY || env.hostinger_api_key;
 const zone = env.HOSTINGER_DNS_ZONE || 'tzolkin.cloud';
 if (!token) return { configured: false, zone, async readZone() { return { status: 'unconfigured', zone, records: [] }; } };
 if (!domain(zone) || typeof token !== 'string' || !token.trim() || /[\r\n]/.test(token)) throw new Error('Configuração DNS da Hostinger inválida.');
 const endpoint = new URL(`/api/dns/v1/zones/${encodeURIComponent(zone)}`, 'https://developers.hostinger.com');
 return {
  configured: true,
  zone,
  async readZone() {
   let response;
   try {
    response = await fetchImpl(endpoint, { method: 'GET', redirect: 'error', headers: { Authorization: `Bearer ${token}`, Accept: 'application/json' }, signal: AbortSignal.timeout(8000) });
   } catch { return { status: 'unavailable', zone, records: [] }; }
   if (!response.ok) return { status: response.status === 401 || response.status === 403 ? 'unauthorized' : response.status === 404 ? 'not_found' : 'unavailable', zone, records: [] };
   try { return { status: 'ok', zone, records: normalizeHostingerZone(await response.json()) }; } catch { return { status: 'invalid', zone, records: [] }; }
  },
 };
}
