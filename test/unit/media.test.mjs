import test from 'node:test';
import assert from 'node:assert/strict';
import { mediaRoutes, sniffImage, MAX_BYTES } from '../../apps/api/src/modules/media.mjs';

const TENANT = '11111111-1111-4111-8111-111111111111';
const PNG = Buffer.concat([Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]), Buffer.from('resto')]);

const register = options => {
 const routes = new Map();
 mediaRoutes({
  get: (p, h) => routes.set('GET ' + p, h), post: (p, h) => routes.set('POST ' + p, h),
  delete: (p, h) => routes.set('DELETE ' + p, h), put: () => {},
 }, options);
 return routes;
};
const fakeR2 = (overrides = {}) => {
 const calls = [];
 return { calls, configured: true,
  put: async (key, bytes, type) => { calls.push(['put', key, type, bytes.length]); },
  remove: async key => { calls.push(['remove', key]); },
  signedGetUrl: key => `https://r2.exemplo/${key}?X-Amz-Signature=abc`, ...overrides };
};
const request = (bytes, headers = {}) => ({ headers, async *[Symbol.asyncIterator]() { yield bytes; } });
const upload = async (routes, { bytes = PNG, headers = {}, query = `owner_type=tenant&owner_id=${TENANT}`, pool }) => {
 let out;
 await routes.get('POST /api/media')({
  req: request(bytes, headers), url: new URL('http://x/api/media?' + query), pool,
  reply: (status, body) => { out = { status, body }; }, operator: { subject: 's', email: 'e@x.com' },
 });
 return out;
};
const basePool = (extra = {}) => {
 const queries = [];
 return { queries, query: async (sql, params) => {
  queries.push({ sql, params });
  if (/FROM tenants/.test(sql)) return { rows: [{ tenant_id: TENANT }] };
  if (/count\(\*\)/.test(sql)) return { rows: [{ count: '0' }] };
  if (/INSERT INTO media_objects/.test(sql)) return { rows: [{ id: 'm1', object_key: params[3], content_type: params[4], byte_size: params[5], is_primary: params[8], original_name: params[7], created_at: 'agora' }] };
  return { rows: [] };
 }, ...extra };
};

test('o tipo vem dos primeiros bytes; SVG e texto não passam', () => {
 assert.equal(sniffImage(Buffer.from([0xff, 0xd8, 0xff, 0xe0, 0])).type, 'image/jpeg');
 assert.equal(sniffImage(PNG).type, 'image/png');
 assert.equal(sniffImage(Buffer.from('GIF89a....')).type, 'image/gif');
 assert.equal(sniffImage(Buffer.concat([Buffer.from('RIFF'), Buffer.alloc(4), Buffer.from('WEBPVP8 ')])).type, 'image/webp');
 assert.equal(sniffImage(Buffer.from('<svg xmlns="http://www.w3.org/2000/svg"><script>alert(1)</script></svg>')), null);
 assert.equal(sniffImage(Buffer.from('%PDF-1.7')), null);
 assert.equal(sniffImage(Buffer.alloc(0)), null);
});

test('upload grava com nome gerado, tipo verificado e a primeira foto vira principal', async () => {
 const r2 = fakeR2(), pool = basePool();
 const out = await upload(register({ r2 }), { pool, query: `owner_type=tenant&owner_id=${TENANT}&name=../../etc/passwd.png`, headers: { 'content-type': 'text/plain' } });
 assert.equal(out.status, 201);
 const [, key, type] = r2.calls[0];
 assert.match(key, new RegExp(`^media/tenant/${TENANT}/[0-9a-f-]{36}\\.png$`));
 assert.equal(type, 'image/png');
 const insert = pool.queries.find(q => /INSERT INTO media_objects/.test(q.sql));
 assert.equal(insert.params[7], 'passwd.png');
 assert.equal(insert.params[8], true);
 assert.ok(pool.queries.some(q => /INSERT INTO audit_events/.test(q.sql)));
 assert.ok(out.body.url.includes('X-Amz-Signature'));
});

test('arquivo que não é imagem é recusado mesmo declarando image/png', async () => {
 const r2 = fakeR2();
 await assert.rejects(upload(register({ r2 }), { bytes: Buffer.from('<svg></svg>'), headers: { 'content-type': 'image/png' }, pool: basePool() }), { status: 415 });
 assert.equal(r2.calls.length, 0);
});

test('mais de 8 MB é recusado antes de ler o corpo', async () => {
 const r2 = fakeR2();
 await assert.rejects(upload(register({ r2 }), { headers: { 'content-length': String(MAX_BYTES + 1) }, pool: basePool() }), { status: 413 });
 assert.equal(r2.calls.length, 0);
});

test('dono inválido ou parâmetro desconhecido é recusado', async () => {
 const routes = register({ r2: fakeR2() });
 await assert.rejects(upload(routes, { query: 'owner_type=produto&owner_id=' + TENANT, pool: basePool() }), { status: 400 });
 await assert.rejects(upload(routes, { query: 'owner_type=tenant&owner_id=nao-e-uuid', pool: basePool() }), { status: 400 });
 await assert.rejects(upload(routes, { query: `owner_type=tenant&owner_id=${TENANT}&key=outro`, pool: basePool() }), { status: 400 });
});

test('sem armazenamento configurado responde 503, sem tocar no banco', async () => {
 const pool = basePool();
 await assert.rejects(upload(register({ r2: fakeR2({ configured: false }) }), { pool }), { status: 503 });
 assert.equal(pool.queries.length, 0);
});

test('se o registro falha depois do envio, o objeto órfão é apagado', async () => {
 const r2 = fakeR2();
 const pool = basePool({ query: async sql => {
  if (/FROM tenants/.test(sql)) return { rows: [{ tenant_id: TENANT }] };
  if (/count\(\*\)/.test(sql)) return { rows: [{ count: '0' }] };
  throw Object.assign(new Error('falhou'), { code: 'XX000' });
 } });
 await assert.rejects(upload(register({ r2 }), { pool }));
 assert.deepEqual(r2.calls.map(c => c[0]), ['put', 'remove']);
 assert.equal(r2.calls[0][1], r2.calls[1][1]);
});

test('limite de fotos por registro', async () => {
 const pool = basePool({ query: async sql => {
  if (/FROM tenants/.test(sql)) return { rows: [{ tenant_id: TENANT }] };
  if (/count\(\*\)/.test(sql)) return { rows: [{ count: '20' }] };
  return { rows: [] };
 } });
 await assert.rejects(upload(register({ r2: fakeR2() }), { pool }), { status: 409 });
});

test('a listagem devolve URL assinada e nunca expõe a chave do objeto', async () => {
 const rows = [{ id: 'm1', object_key: 'media/tenant/x/a.png', content_type: 'image/png', byte_size: 5, is_primary: true, original_name: null, created_at: 'agora' }];
 let out;
 await register({ r2: fakeR2() }).get('GET /api/media')({
  url: new URL(`http://x/api/media?owner_type=lead&owner_id=${TENANT}`), pool: { query: async () => ({ rows }) },
  reply: (status, body) => { out = { status, body }; },
 });
 assert.equal(out.status, 200);
 assert.match(out.body.photos[0].url, /X-Amz-Signature/);
 assert.equal(out.body.photos[0].object_key, undefined);
});
