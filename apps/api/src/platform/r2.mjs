// Cloudflare R2 pela API S3, sem SDK: assinatura AWS SigV4 com node:crypto.
//
// Por que sem SDK: o Core roda Node puro e o `pg` é a única dependência. O SDK da AWS
// traria dezenas de pacotes para três chamadas (PUT, DELETE e GET assinado).
//
// Dois jeitos de assinar, ambos SigV4:
//  - por cabeçalho (PUT/DELETE feitos pelo servidor, com credencial);
//  - por query string (URL de leitura que o NAVEGADOR usa, de curta duração, sem
//    credencial nenhuma dentro dela).
// Conferidos contra os exemplos publicados pela AWS (test/unit/r2.test.mjs).
import { createHash, createHmac } from 'node:crypto';

const sha256 = data => createHash('sha256').update(data).digest('hex');
const hmac = (key, data) => createHmac('sha256', key).update(data).digest();
// RFC 3986, como a AWS exige: encodeURIComponent deixa passar !'()* sem codificar.
const encode = value => encodeURIComponent(value).replace(/[!'()*]/g, c => '%' + c.charCodeAt(0).toString(16).toUpperCase());
const encodePath = path => path.split('/').map(encode).join('/');
const stamp = date => date.toISOString().replace(/[:-]|\.\d{3}/g, '');

const signingKey = (secretKey, day, region, service) =>
 hmac(hmac(hmac(hmac('AWS4' + secretKey, day), region), service), 'aws4_request');

const canonicalQuery = query => Object.entries(query)
 .map(([key, value]) => [encode(key), encode(String(value))])
 .sort(([a], [b]) => (a < b ? -1 : a > b ? 1 : 0))
 .map(([key, value]) => `${key}=${value}`).join('&');

/** Cabeçalhos assinados para uma chamada feita pelo servidor. */
export function signHeaders({ method, host, path, query = {}, headers = {}, payloadHash, accessKey, secretKey, region = 'auto', service = 's3', now = new Date() }) {
 const amzDate = stamp(now), day = amzDate.slice(0, 8);
 const all = { ...headers, host, 'x-amz-content-sha256': payloadHash, 'x-amz-date': amzDate };
 const names = Object.keys(all).map(name => name.toLowerCase()).sort();
 const lower = Object.fromEntries(Object.entries(all).map(([name, value]) => [name.toLowerCase(), String(value).trim()]));
 const canonical = [method, encodePath(path), canonicalQuery(query), names.map(name => `${name}:${lower[name]}\n`).join(''), names.join(';'), payloadHash].join('\n');
 const scope = `${day}/${region}/${service}/aws4_request`;
 const toSign = ['AWS4-HMAC-SHA256', amzDate, scope, sha256(canonical)].join('\n');
 const signature = createHmac('sha256', signingKey(secretKey, day, region, service)).update(toSign).digest('hex');
 return {
  ...lower,
  authorization: `AWS4-HMAC-SHA256 Credential=${accessKey}/${scope}, SignedHeaders=${names.join(';')}, Signature=${signature}`,
 };
}

/** URL com assinatura na query: quem a tiver lê aquele objeto até expirar, e só ele. */
export function presignUrl({ method = 'GET', host, path, accessKey, secretKey, expires = 300, region = 'auto', service = 's3', now = new Date() }) {
 const amzDate = stamp(now), day = amzDate.slice(0, 8), scope = `${day}/${region}/${service}/aws4_request`;
 const query = {
  'X-Amz-Algorithm': 'AWS4-HMAC-SHA256',
  'X-Amz-Credential': `${accessKey}/${scope}`,
  'X-Amz-Date': amzDate,
  'X-Amz-Expires': expires,
  'X-Amz-SignedHeaders': 'host',
 };
 const canonical = [method, encodePath(path), canonicalQuery(query), `host:${host}\n`, 'host', 'UNSIGNED-PAYLOAD'].join('\n');
 const toSign = ['AWS4-HMAC-SHA256', amzDate, scope, sha256(canonical)].join('\n');
 const signature = createHmac('sha256', signingKey(secretKey, day, region, service)).update(toSign).digest('hex');
 return `https://${host}${encodePath(path)}?${canonicalQuery(query)}&X-Amz-Signature=${signature}`;
}

/**
 * Cliente do bucket. `configured` é falso quando falta variável: as rotas respondem 503
 * com uma frase honesta em vez de falhar no meio de um upload.
 */
export function createR2({ env = process.env, fetchImpl = fetch, clock = Date.now } = {}) {
 const { R2_ACCOUNT_ID: account, R2_BUCKET: bucket, R2_ACCESS_KEY_ID: accessKey, R2_SECRET_ACCESS_KEY: secretKey } = env;
 const configured = Boolean(account && bucket && accessKey && secretKey);
 const host = `${account}.r2.cloudflarestorage.com`;
 const pathOf = key => `/${bucket}/${key}`;
 const call = async (method, key, body, extra = {}) => {
  const payload = body ?? Buffer.alloc(0);
  const headers = signHeaders({ method, host, path: pathOf(key), headers: extra, payloadHash: sha256(payload), accessKey, secretKey, now: new Date(clock()) });
  delete headers.host;
  const response = await fetchImpl(`https://${host}${encodePath(pathOf(key))}`, { method, headers, body: method === 'PUT' ? payload : undefined, signal: AbortSignal.timeout(20000) });
  if (!response.ok) throw Object.assign(new Error(`R2 ${method} respondeu ${response.status}`), { status: 502 });
 };
 return {
  configured,
  put: (key, bytes, contentType) => call('PUT', key, bytes, { 'content-type': contentType }),
  remove: key => call('DELETE', key),
  signedGetUrl: (key, expires = 300) => presignUrl({ host, path: pathOf(key), accessKey, secretKey, expires, now: new Date(clock()) }),
 };
}
