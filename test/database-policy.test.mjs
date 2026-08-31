// Política de transporte do banco: medir, expor e bloquear o que é sensível.
// Não corrige a exposição — isso é infraestrutura — mas garante que ela não passe despercebida.
import test from 'node:test';
import assert from 'node:assert/strict';
import { randomBytes } from 'node:crypto';
import { createCore } from '../src/server.mjs';
import {
 openDatabase, describeTarget, transportWarning, testConnectionString,
} from '../src/platform/database.mjs';

const CONN = testConnectionString().connectionString;

test('Database transport policy suite', async t => {
 await t.test('loopback is distinguished from remote host', () => {
  assert.equal(describeTarget('postgres://u:p@127.0.0.1:5432/db').loopback, true);
  assert.equal(describeTarget('postgres://u:p@localhost:5432/db').loopback, true);
  assert.equal(describeTarget('postgres://u:p@db.example.com:9000/db').loopback, false);
 });

 await t.test('sslmode declared in the URL is reported, not silently ignored', () => {
  assert.equal(describeTarget('postgres://u:p@h:5432/db?sslmode=disable').urlSslMode, 'disable');
  assert.equal(describeTarget('postgres://u:p@h:5432/db').urlSslMode, null);
 });

 await t.test('invalid DATABASE_SSL is rejected', async () => {
  await assert.rejects(() => openDatabase({ connectionString: CONN, mode: 'talvez' }), /DATABASE_SSL inválido/);
 });

 await t.test('missing connection string is rejected', async () => {
  await assert.rejects(() => openDatabase({ connectionString: '' }), /DATABASE_URL é obrigatória/);
 });

 // Independe de o servidor real já ter sido corrigido. Negações determinísticas
 // e ausência de downgrade são exercitadas em test/unit/database.test.mjs.
 await t.test('mode=require either rejects transport or returns verified TLS', async () => {
  let opened;
  try { opened = await openDatabase({ connectionString: CONN, mode: 'require', max: 1 }); }
  catch (error) {
   assert.match(error.message, /Políticas TLS conflitantes|Conexão recusada/);
   return;
  }
  try {
   assert.equal(opened.security.tls, true);
   assert.equal(opened.security.verified, true);
  } finally { await opened.pool.end(); }
 });

 await t.test('mode=allow connects and reports the transport honestly', async () => {
  const { pool, security } = await openDatabase({ connectionString: CONN, mode: 'allow', max: 1 });
  try {
   assert.equal((await pool.query('SELECT 1 AS ok')).rows[0].ok, 1);
   assert.equal(security.mode, 'allow');
   assert.equal(typeof security.tls, 'boolean');
   // insecure só é verdadeiro quando junta texto claro E host remoto.
   assert.equal(security.insecure, !security.tls && security.remote);
   if (security.tls) assert.equal(security.insecure, false);
  } finally { await pool.end(); }
 });

 await t.test('warning appears only when insecure, and leaks nothing', () => {
  assert.equal(transportWarning({ tls: true, verified: true, remote: true, insecure: false }), null);
  assert.equal(transportWarning({ tls: false, verified: false, remote: false, insecure: false }), null);
  const aviso = transportWarning({ tls: false, verified: false, remote: true, insecure: true });
  assert.match(aviso, /NÃO é criptografada/);
  const host = new URL(CONN).hostname;
  assert.ok(!aviso.includes(host), 'o aviso não pode conter o hostname');
  assert.ok(!aviso.includes(new URL(CONN).password), 'o aviso não pode conter a credencial');
 });

 await t.test('a dedicated test database is preferred when configured', () => {
  assert.deepEqual(
   testConnectionString({ DATABASE_URL: 'postgres://a/b', DATABASE_URL_TEST: 'postgres://c/d' }),
   { connectionString: 'postgres://c/d', dedicated: true });
  assert.deepEqual(
   testConnectionString({ DATABASE_URL: 'postgres://a/b' }),
   { connectionString: 'postgres://a/b', dedicated: false });
 });
});

test('Transport state reaches the operator', async t => {
 const { pool } = await openDatabase({ connectionString: CONN, mode: 'allow', max: 2 });
 const adminPassword = randomBytes(32).toString('base64url');
 const inseguro = { tls: false, verified: false, remote: true, insecure: true, mode: 'allow' };

 const boot = async security => {
  const server = createCore({ pool, adminPassword, security });
  await new Promise(resolve => server.listen(0, '127.0.0.1', resolve));
  return { server, origin: `http://127.0.0.1:${server.address().port}` };
 };
 const stop = async server => {
  server.closeAllConnections();
  await new Promise(resolve => server.close(resolve));
 };

 try {
  await t.test('/health reports plaintext when the transport is plaintext', async () => {
   const { server, origin } = await boot(inseguro);
   try {
    const data = await (await fetch(origin + '/health')).json();
    assert.equal(data.database_transport, 'plaintext');
   } finally { await stop(server); }
  });

  await t.test('/health reports unknown when the transport was not measured', async () => {
   const { server, origin } = await boot(null);
   try {
    const data = await (await fetch(origin + '/health')).json();
    // Nunca afirmar segurança sem prova.
    assert.equal(data.database_transport, 'unknown');
   } finally { await stop(server); }
  });

  await t.test('/health reports tls-verified only when actually verified', async () => {
   const { server, origin } = await boot({ tls: true, verified: true, remote: true, insecure: false, mode: 'require' });
   try {
    assert.equal((await (await fetch(origin + '/health')).json()).database_transport, 'tls-verified');
   } finally { await stop(server); }
   const parcial = await boot({ tls: true, verified: false, remote: true, insecure: false, mode: 'allow' });
   try {
    assert.equal((await (await fetch(parcial.origin + '/health')).json()).database_transport, 'tls-unverified');
   } finally { await stop(parcial.server); }
  });

  await t.test('the panel overview carries the transport state', async () => {
   const { server, origin } = await boot(inseguro);
   try {
    const login = await fetch(origin + '/api/login', {
     method: 'POST', headers: { origin, 'Content-Type': 'application/json' },
     body: JSON.stringify({ password: adminPassword }),
    });
    const cookie = login.headers.get('set-cookie').split(';')[0];
    const data = await (await fetch(origin + '/api/overview', { headers: { cookie } })).json();
    assert.deepEqual(data.security, { transport: 'plaintext', insecure: true });
    // O estado é reportado; host e credencial nunca.
    const bruto = JSON.stringify(data);
    assert.ok(!bruto.includes(new URL(CONN).hostname));
    assert.ok(!bruto.includes(new URL(CONN).password));
   } finally { await stop(server); }
  });
 } finally { await pool.end(); }
});
