import test from 'node:test';
import assert from 'node:assert/strict';
import pg from 'pg';
import { openDatabase, describeTarget, transportWarning, assertVerifiedTransport } from '../../apps/api/src/platform/database.mjs';

const connectionString = 'postgres://test:synthetic@db.example.invalid/test';
function driver({ valid = true, encrypted = true, available = true } = {}) {
 const calls = [];
 class Client {
  constructor(config) { this.config = config; calls.push(config); }
  async connect() {
   if (!available || (!valid && this.config.ssl.rejectUnauthorized)) throw new Error('synthetic failure');
   this.connection = { stream: { encrypted, authorized: valid } };
  }
  async end() {}
 }
 class Pool { constructor(config) { this.options = config; } }
 return { Client, Pool, calls };
}

test('require accepts only authenticated TLS and keeps pool validation enabled', async () => {
 const stub = driver();
 const { pool, security } = await openDatabase({ connectionString, mode: 'require' }, stub);
 assert.equal(security.verified, true);
 assert.equal(security.tls, true);
 assert.equal(pool.options.ssl.rejectUnauthorized, true);
 assert.equal(new pg.Client(pool.options).connectionParameters.ssl.rejectUnauthorized, true);
 assert.equal(stub.calls.length, 1);
});

for (const options of [{ valid: false }, { encrypted: false }, { available: false }]) {
 test(`require fails closed without retrying weaker TLS: ${JSON.stringify(options)}`, async () => {
  const stub = driver(options);
  await assert.rejects(openDatabase({ connectionString, mode: 'require' }, stub), /Conexão recusada/);
  assert.equal(stub.calls.length, 1);
  assert.equal(stub.calls[0].ssl.rejectUnauthorized, true);
 });
}

for (const query of ['sslmode=disable', 'sslmode=no-verify', 'ssl=0', 'ssl=false', 'ssl=no-verify']) {
 test(`require rejects URL downgrade before connecting: ${query}`, async () => {
  const stub = driver();
  await assert.rejects(openDatabase({ connectionString: `${connectionString}?${query}`, mode: 'require' }, stub), /conflitantes/);
  assert.equal(stub.calls.length, 0);
 });
}

test('verify-full URL cannot override probe/pool policy or fall back to plaintext', async () => {
 const conn = `${connectionString}?sslmode=verify-full&application_name=core`;
 const { pool } = await openDatabase({ connectionString: conn, mode: 'require' }, driver());
 assert.equal(new URL(pool.options.connectionString).searchParams.has('sslmode'), false);
 assert.equal(new pg.Client(pool.options).connectionParameters.ssl.rejectUnauthorized, true);
 assert.equal(new URL(pool.options.connectionString).searchParams.get('application_name'), 'core');
 await assert.rejects(openDatabase({ connectionString: conn, mode: 'allow' }, driver({ valid: false })), /Conexão recusada/);
});

test('allow preserves explicitly disabled TLS without attempting another policy', async () => {
 const stub = driver();
 const { pool, security } = await openDatabase({ connectionString: `${connectionString}?sslmode=disable`, mode: 'allow' }, stub);
 assert.equal(pool.options.ssl, false);
 assert.equal(security.insecure, true);
 assert.equal(stub.calls.length, 0);
});

test('allow diagnoses unverified TLS and emits a warning without secrets', async () => {
 const { security } = await openDatabase({ connectionString, mode: 'allow' }, driver({ valid: false }));
 assert.equal(security.tls, true);
 assert.equal(security.verified, false);
 const warning = transportWarning(security);
 assert.match(warning, /certificado verificado/);
 assert.ok(!warning.includes('synthetic'));
 assert.ok(!warning.includes('db.example.invalid'));
});

test('allow reports plaintext fallback honestly', async () => {
 const { security } = await openDatabase({ connectionString, mode: 'allow' }, driver({ available: false }));
 assert.equal(security.tls, false);
 assert.equal(security.insecure, true);
 assert.match(transportWarning(security), /NÃO é criptografada/);
});

test('a query host override is not mistaken for local loopback', () => {
 assert.equal(describeTarget('postgres://test:synthetic@localhost/test?host=remote.example.invalid').loopback, false);
});

test('default policy refuses plaintext and unauthenticated TLS', async () => {
 await assert.rejects(openDatabase({ connectionString }, driver({ valid: false })), /Conexão recusada/);
 await assert.rejects(openDatabase({ connectionString }, driver({ available: false })), /Conexão recusada/);
 await assert.rejects(openDatabase({ connectionString: `${connectionString}?sslmode=disable` }, driver()), /conflitantes/);
});

test('pool overrides cannot replace TLS or the destination', async () => {
 for (const extra of [{ ssl: false }, { host: 'localhost' }, { stream: {} }, { Client: class {} }])
  await assert.rejects(openDatabase({ connectionString, mode: 'require', ...extra }, driver()), /Opção de pool/);
});

test('disable conflicts with URL requiring TLS', async () => {
 await assert.rejects(openDatabase({ connectionString: `${connectionString}?sslmode=verify-full`, mode: 'disable' }, driver()), /conflitantes/);
});

test('rotation refuses unverified, plaintext, unknown and loopback transports', () => {
 for (const security of [null, {}, { tls: true, verified: false }, { tls: false, verified: false, remote: false }])
  assert.throws(() => assertVerifiedTransport(security), /Rotação cancelada/);
 assert.doesNotThrow(() => assertVerifiedTransport({ tls: true, verified: true }));
});

test('tlsServername: valida o certificado contra o nome informado, sem afrouxar a validação', async () => {
 const stub = driver();
 const { pool, security } = await openDatabase({ connectionString: 'postgres://u:synthetic@interno-db:5432/test', mode: 'require', tlsServername: ' db.example.invalid ' }, stub);
 assert.equal(stub.calls[0].ssl.servername, 'db.example.invalid');
 assert.equal(stub.calls[0].ssl.rejectUnauthorized, true);
 assert.equal(pool.options.ssl.servername, 'db.example.invalid');
 assert.equal(pool.options.ssl.rejectUnauthorized, true);
 assert.equal(security.verified, true);
});

test('tlsServername vazio ou ausente: o certificado é validado contra o host da URL, como antes', async () => {
 for (const vazio of [undefined, '', '   ']) {
  const stub = driver();
  const { pool } = await openDatabase({ connectionString, mode: 'require', tlsServername: vazio }, stub);
  assert.equal('servername' in pool.options.ssl, false);
  assert.equal('servername' in stub.calls[0].ssl, false);
 }
});

test('tlsServername não é um atalho: certificado inválido continua recusado e o valor precisa ser um nome de host', async () => {
 await assert.rejects(openDatabase({ connectionString, mode: 'require', tlsServername: 'db.example.invalid' }, driver({ valid: false })), /Conexão recusada/);
 for (const ruim of ['https://db.example.invalid', 'db.example.invalid:5432', 'db/example', 'db example', '-db.example']) {
  const stub = driver();
  await assert.rejects(openDatabase({ connectionString, mode: 'require', tlsServername: ruim }, stub), /DATABASE_TLS_SERVERNAME inválido/);
  assert.equal(stub.calls.length, 0);
 }
});

test('certificado fixado que cobre um nome só: valida contra esse nome mesmo sem DATABASE_TLS_SERVERNAME', async () => {
 const { nomeDoCertificadoFixado } = await import('../../apps/api/src/platform/database.mjs');
 const { readFileSync } = await import('node:fs');
 const pem = readFileSync(new URL('../../certs/postgres-server.crt', import.meta.url));
 // Host interno do EasyPanel (com o ponto final do log de produção): o certificado não o cobre, mas declara um nome só.
 assert.equal(nomeDoCertificadoFixado(pem, 'systembots_evolution-api-db.'), 'easypanel.landcriativa.com');
 // Host que o certificado já cobre: nada a sobrescrever.
 assert.equal(nomeDoCertificadoFixado(pem, 'easypanel.landcriativa.com'), null);
 // Sem certificado fixado, ou lixo no lugar dele: nenhum nome inventado.
 assert.equal(nomeDoCertificadoFixado(undefined, 'qualquer'), null);
 assert.equal(nomeDoCertificadoFixado('nao-e-pem', 'qualquer'), null);
});
