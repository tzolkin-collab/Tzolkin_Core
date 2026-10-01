import test from 'node:test';
import assert from 'node:assert/strict';
import { presignUrl, signHeaders, createR2 } from '../../apps/api/src/platform/r2.mjs';

// Exemplos publicados pela AWS (documentação do Signature Version 4 para S3). Não são
// credenciais: são as chaves de exemplo da própria documentação.
const ACCESS = 'AKIAIOSFODNN7EXAMPLE';
const SECRET = 'wJalrXUtnFEMI/K7MDENG/bPxRfiCYEXAMPLEKEY';
const AGORA = new Date('2013-05-24T00:00:00Z');

test('URL assinada por query bate com o exemplo da AWS', () => {
 const url = presignUrl({ host: 'examplebucket.s3.amazonaws.com', path: '/test.txt', accessKey: ACCESS, secretKey: SECRET, expires: 86400, region: 'us-east-1', now: AGORA });
 assert.match(url, /X-Amz-Signature=aeeed9bbccd4d02ee5c0109b86d86835f995330da4c265957d157751f604d404$/);
});

test('assinatura por cabeçalho bate com o exemplo da AWS', () => {
 const h = signHeaders({
  method: 'GET', host: 'examplebucket.s3.amazonaws.com', path: '/test.txt', headers: { Range: 'bytes=0-9' },
  payloadHash: 'e3b0c44298fc1c149afbf4c8996fb92427ae41e4649b934ca495991b7852b855',
  accessKey: ACCESS, secretKey: SECRET, region: 'us-east-1', now: AGORA,
 });
 assert.match(h.authorization, /Signature=f0e8bdb87c964420e857bd35b5d6ed310bd44f0170aba48dd91039c6036bdb41$/);
 assert.match(h.authorization, /SignedHeaders=host;range;x-amz-content-sha256;x-amz-date/);
});

test('sem as variáveis, o cliente se declara não configurado', () => {
 assert.equal(createR2({ env: {} }).configured, false);
 assert.equal(createR2({ env: { R2_ACCOUNT_ID: 'a', R2_BUCKET: 'b', R2_ACCESS_KEY_ID: 'c', R2_SECRET_ACCESS_KEY: 'd' } }).configured, true);
});

test('PUT assina o corpo real e manda o tipo declarado', async () => {
 let visto;
 const r2 = createR2({
  env: { R2_ACCOUNT_ID: 'acc', R2_BUCKET: 'core', R2_ACCESS_KEY_ID: ACCESS, R2_SECRET_ACCESS_KEY: SECRET },
  fetchImpl: async (url, init) => { visto = { url, init }; return { ok: true, status: 200 }; },
  clock: () => AGORA.getTime(),
 });
 await r2.put('media/tenant/x/y.png', Buffer.from('abc'), 'image/png');
 assert.equal(visto.url, 'https://acc.r2.cloudflarestorage.com/core/media/tenant/x/y.png');
 assert.equal(visto.init.method, 'PUT');
 assert.equal(visto.init.headers['content-type'], 'image/png');
 // sha256("abc")
 assert.equal(visto.init.headers['x-amz-content-sha256'], 'ba7816bf8f01cfea414140de5dae2223b00361a396177a9cb410ff61f20015ad');
 assert.match(visto.init.headers.authorization, /^AWS4-HMAC-SHA256 Credential=AKIAIOSFODNN7EXAMPLE\/20130524\/auto\/s3\/aws4_request/);
 assert.equal(visto.init.headers.host, undefined);
});

test('URL de leitura não carrega a chave secreta e expira', () => {
 const r2 = createR2({ env: { R2_ACCOUNT_ID: 'acc', R2_BUCKET: 'core', R2_ACCESS_KEY_ID: ACCESS, R2_SECRET_ACCESS_KEY: SECRET }, clock: () => AGORA.getTime() });
 const url = r2.signedGetUrl('media/a.png', 120);
 assert.ok(!url.includes(SECRET));
 assert.match(url, /X-Amz-Expires=120/);
 assert.match(url, /^https:\/\/acc\.r2\.cloudflarestorage\.com\/core\/media\/a\.png\?/);
});
