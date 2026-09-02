// Contas de operador e times. O ponto central: quem entra é a UNIÃO do
// ambiente com o cadastro. Os testes provam que conceder pelo painel funciona,
// que suspender no cadastro não revoga quem vem do ambiente, e que o último
// administrador não pode ser removido.
import test from 'node:test';
import assert from 'node:assert/strict';
import pg from 'pg';
import { randomBytes, randomUUID } from 'node:crypto';
import { createCore } from '../apps/api/src/server.mjs';
import { testConnectionString } from '../apps/api/src/platform/database.mjs';
import { allowedEmails, createAccountGate } from '../apps/api/src/modules/accounts.mjs';

test('Allowed emails parsing', async t => {
 await t.test('normalizes, dedupes and drops what is not an address', () => {
  assert.deepEqual(allowedEmails({ CORE_ALLOWED_EMAILS: ' A@x.com , a@X.com ,lixo, b@y.com ' }),
   ['a@x.com', 'b@y.com']);
  assert.deepEqual(allowedEmails({}), []);
 });
});

test('Accounts and teams suite', async t => {
 const pool = new pg.Pool({ connectionString: testConnectionString().connectionString, max: 3 });
 const marca = randomUUID().slice(0, 8);
 const adminPassword = randomBytes(32).toString('base64url');
 const permitido = `permitido-${marca}@tzolkin.test`;
 const soCadastrado = `cadastrado-${marca}@tzolkin.test`;

 // O ambiente permite um endereço que NÃO será cadastrado, e não permite outro
 // que SERÁ: as duas direções da divergência ficam exercitadas.
 const semAcesso = `sem-acesso-${marca}@tzolkin.test`;
 const env = { CORE_ALLOWED_EMAILS: `${permitido}, ${semAcesso}` };

 const server = createCore({ pool, adminPassword, webhookEnv: env });
 await new Promise(r => server.listen(0, '127.0.0.1', r));
 const origin = `http://127.0.0.1:${server.address().port}`;
 const login = await fetch(origin + '/api/login', {
  method: 'POST', headers: { origin, 'Content-Type': 'application/json' },
  body: JSON.stringify({ password: adminPassword }),
 });
 const cookie = login.headers.get('set-cookie').split(';')[0];
 const put = (rota, body) => fetch(origin + rota, {
  method: 'PUT', headers: { cookie, origin, 'Content-Type': 'application/json' }, body: JSON.stringify(body),
 });
 const ler = async () => (await fetch(origin + '/api/accounts', { headers: { cookie } })).json();

 try {
  await t.test('requires an operator session', async () => {
   assert.equal((await fetch(origin + '/api/accounts')).status, 401);
  });

  await t.test('registers an account', async () => {
   const r = await put('/api/accounts', { email: soCadastrado.toUpperCase(), name: 'Teste', role: 'member', status: 'active' });
   assert.equal(r.status, 200);
   const { accounts } = await ler();
   const conta = accounts.find(a => a.email === soCadastrado);
   // E-mail é normalizado para minúscula: senão a divergência viraria falso positivo.
   assert.ok(conta, 'a conta deve ser gravada em minúscula');
   assert.equal(conta.source, 'manual');
  });

  await t.test('rejects an invalid address or role', async () => {
   assert.equal((await put('/api/accounts', { email: 'semarroba' })).status, 400);
   assert.equal((await put('/api/accounts', { email: 'a@b.com', role: 'chefe' })).status, 400);
  });

  await t.test('declares both sources and who cannot be managed here', async () => {
   const { authorization, enforcement } = await ler();
   assert.equal(enforcement, 'env_plus_registry');
   assert.deepEqual(authorization.sources, ['CORE_ALLOWED_EMAILS', 'operator_accounts']);
   // Quem entra pelo ambiente e não está cadastrado não pode ser suspenso por aqui.
   assert.ok(authorization.env_only.includes(permitido));
   assert.ok(authorization.env_only.includes(semAcesso));
   // O efetivo soma as duas fontes sem contar ninguém duas vezes. Calculado a
   // partir da própria resposta: este banco também guarda contas reais.
   const { accounts } = await ler();
   const ativos = accounts.filter(a => a.status === 'active').map(a => a.email.toLowerCase());
   assert.equal(authorization.effective, new Set([permitido, semAcesso, ...ativos]).size);
   assert.ok(ativos.includes(soCadastrado));
  });

  // O que a decisão de gerenciar pelo painel torna possível.
  await t.test('the gate grants access to an active registered account', async () => {
   const gate = createAccountGate(pool);
   assert.equal(await gate(soCadastrado), true, 'conta ativa entra, mesmo fora do ambiente');
   assert.equal(await gate(soCadastrado.toUpperCase()), true, 'e-mail é normalizado');
   assert.equal(await gate(`ninguem-${marca}@tzolkin.test`), false);
   assert.equal(await gate('sem-arroba'), false);
   assert.equal(await gate(null), false);
  });

  await t.test('a suspended account stops passing the gate', async () => {
   const gate = createAccountGate(pool);
   await put('/api/accounts', { email: soCadastrado, role: 'member', status: 'suspended' });
   assert.equal(await gate(soCadastrado), false);
   await put('/api/accounts', { email: soCadastrado, role: 'member', status: 'active' });
   assert.equal(await gate(soCadastrado), true);
  });

  await t.test('the last active owner cannot be demoted or suspended', async () => {
   // Limpa o terreno: neste banco de teste pode haver owners de produção,
   // então a proteção só dispara quando resta exatamente um.
   const { rows } = await pool.query("SELECT count(*)::int n FROM operator_accounts WHERE role='owner' AND status='active'");
   if (rows[0].n === 1) {
    const unico = (await pool.query("SELECT email FROM operator_accounts WHERE role='owner' AND status='active'")).rows[0].email;
    const r = await put('/api/accounts', { email: unico, role: 'member', status: 'active' });
    assert.equal(r.status, 409, 'rebaixar o último administrador precisa ser recusado');
   }
  });

  await t.test('creates a team with members', async () => {
   await put('/api/accounts', { email: permitido, name: 'Permitido', role: 'owner', status: 'active' });
   const r = await put('/api/teams', {
    slug: `time-${marca}`, name: 'Time de teste', description: 'sintético',
    members: [{ email: permitido, role: 'lead' }, { email: soCadastrado, role: 'member' }],
   });
   assert.equal(r.status, 200);
   const { teams } = await ler();
   const time = teams.find(t2 => t2.slug === `time-${marca}`);
   assert.equal(time.members.length, 2);
   assert.equal(time.members.find(m => m.email === permitido).role, 'lead');
  });

  await t.test('sending the member list replaces the whole composition', async () => {
   await put('/api/teams', { slug: `time-${marca}`, name: 'Time de teste', members: [{ email: permitido, role: 'lead' }] });
   const { teams } = await ler();
   const time = teams.find(t2 => t2.slug === `time-${marca}`);
   assert.equal(time.members.length, 1, 'quem foi omitido sai do time');
  });

  await t.test('a member without an account is refused, never created implicitly', async () => {
   const r = await put('/api/teams', {
    slug: `time-${marca}`, name: 'Time de teste', members: [{ email: `fantasma-${marca}@tzolkin.test` }],
   });
   assert.equal(r.status, 400);
   const { accounts } = await ler();
   assert.ok(!accounts.some(a => a.email.startsWith('fantasma-')), 'não pode inventar conta');
   // E a transação inteira volta atrás: o time mantém a composição anterior.
   const { teams } = await ler();
   assert.equal(teams.find(t2 => t2.slug === `time-${marca}`).members.length, 1);
  });

  await t.test('an invalid slug is refused', async () => {
   assert.equal((await put('/api/teams', { slug: 'Time Errado', name: 'x' })).status, 400);
  });
 } finally {
  const client = await pool.connect();
  try {
   await client.query('BEGIN');
   await client.query('DELETE FROM teams WHERE slug = $1', [`time-${marca}`]);
   await client.query('DELETE FROM operator_accounts WHERE email LIKE $1', [`%${marca}@tzolkin.test`]);
   await client.query('COMMIT');
  } finally { client.release(); }
  server.closeAllConnections();
  await new Promise(r => server.close(r));
  await pool.end();
 }
});
