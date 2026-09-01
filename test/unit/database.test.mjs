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
