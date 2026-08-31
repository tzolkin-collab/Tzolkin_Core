// Visibilidade de deploys. Roda contra um stub HTTP local que imita a Vercel:
// nenhuma chamada sai desta máquina, nenhum deploy é disparado, nenhuma conta é tocada.
import test from 'node:test';
import assert from 'node:assert/strict';
import http from 'node:http';
import pg from 'pg';
import { randomBytes } from 'node:crypto';
import { createCore } from '../src/server.mjs';
import { testConnectionString } from '../src/platform/database.mjs';
import { createVercelAdapter } from '../src/integrations/vercel.mjs';
import { buildRegistry } from '../src/modules/deploys.mjs';

const TOKEN = 'vcp_' + randomBytes(24).toString('hex');

// Resposta reduzida da /v7/deployments, com os campos que o adaptador consome.
const DEPLOY = {
 uid: 'dpl_teste1', name: 'site-tzolkin', state: 'READY', readyState: 'READY',
 target: 'production', url: 'site-tzolkin.vercel.app',
 inspectorUrl: 'https://vercel.com/tzolkin/site-tzolkin/abc',
 createdAt: 1_760_000_000_000, ready: 1_760_000_060_000,
 readySubstate: 'PROMOTED', isRollbackCandidate: true, source: 'git',
 creator: { uid: 'u1', username: 'gustavo', email: 'privado@example.invalid' },
 meta: {
  githubCommitSha: '7328bee0000000000000000000000000000000ab',
  githubCommitRef: 'main',
  githubCommitMessage: 'feat: reposicionamento da marca',
  githubCommitAuthorEmail: 'privado@example.invalid',
 },
};
const OUTRO = { ...DEPLOY, uid: 'dpl_teste2', name: 'tzolkin-educare', createdAt: 1_770_000_000_000, state: 'ERROR', readyState: 'ERROR', errorMessage: 'Build falhou', target: null, meta: { githubCommitRef: 'main' } };

const PROJETOS = [
  { id: 'prj_site', name: 'site-tzolkin', framework: 'nextjs', link: { type: 'github' }, updatedAt: 1_760_000_000_000 },
  { id: 'prj_edu', name: 'tzolkin-educare', framework: 'nextjs', link: { type: 'github' }, updatedAt: 1_770_000_000_000 },
  { id: 'prj_sites', name: 'tzolkin-sites', framework: null, updatedAt: 1_750_000_000_000 }, // sem link = sem repositório
];

const padrao = ({ url }) => {
  if (url.pathname === '/v9/projects') return { status: 200, body: { projects: PROJETOS } };
  const id = url.searchParams.get('projectId');
  if (id === 'prj_site') return { status: 200, body: { deployments: [DEPLOY] } };
  if (id === 'prj_edu') return { status: 200, body: { deployments: [OUTRO] } };
  return { status: 200, body: { deployments: [] } }; // tzolkin-sites: nenhum deploy
};

// Stub controlável: cada teste decide o que a "Vercel" responde.
function startStub() {
 let responder = padrao;
 const chamadas = [];
 const server = http.createServer((req, res) => {
  const url = new URL(req.url, 'http://stub');
  chamadas.push({ path: url.pathname, search: url.searchParams, auth: req.headers.authorization });
  const { status, body } = responder({ url });
  res.writeHead(status, { 'Content-Type': 'application/json' });
  res.end(JSON.stringify(body));
 });
 return {
  server, chamadas,
  set: fn => { responder = fn; },
  listen: () => new Promise(r => server.listen(0, '127.0.0.1', r)),
  base: () => `http://127.0.0.1:${server.address().port}`,
  close: async () => { server.closeAllConnections(); await new Promise(r => server.close(r)); },
 };
}

test('Vercel adapter suite', async t => {
 const stub = startStub();
 await stub.listen();
 const adapter = createVercelAdapter({ token: TOKEN, baseUrl: stub.base() });

 try {
  await t.test('lists projects and flags the ones without a git repository', async () => {
   const projetos = await adapter.listProjects();
   assert.equal(projetos.length, 3);
   assert.equal(projetos.find(p => p.name === 'site-tzolkin').git_connected, true);
   // tzolkin-sites nao tem `link`: sem repositorio, e portanto sem Deploy Hook possivel.
   assert.equal(projetos.find(p => p.name === 'tzolkin-sites').git_connected, false);
  });

  await t.test('sends the token as Bearer and asks the deployments endpoint', async () => {
   await adapter.listDeployments({ limit: 5, projectId: 'prj_site' });
   const chamada = stub.chamadas.at(-1);
   assert.equal(chamada.path, '/v7/deployments');
   assert.equal(chamada.search.get('limit'), '5');
   assert.equal(chamada.search.get('projectId'), 'prj_site');
   assert.equal(chamada.auth, `Bearer ${TOKEN}`);
   // Token de time/projeto dispensa teamId; sem VERCEL_TEAM_ID não deve ir nada.
   assert.equal(chamada.search.get('teamId'), null);
  });

  await t.test('normalizes what the panel needs and drops the rest', async () => {
   const [primeiro] = await adapter.listDeployments({ projectId: 'prj_site' });
   assert.equal(primeiro.project, 'site-tzolkin');
   assert.equal(primeiro.state, 'READY');
   assert.equal(primeiro.state_label, 'no ar');
   assert.equal(primeiro.commit, '7328bee');
   assert.equal(primeiro.branch, 'main');
   assert.equal(primeiro.author, 'gustavo');
   assert.equal(primeiro.url, 'https://site-tzolkin.vercel.app');
   assert.equal(primeiro.rollback_candidate, true);
   assert.equal(primeiro.created_at, new Date(1_760_000_000_000).toISOString());
   // E-mail de quem commitou não é necessário para o painel: não sai do adaptador.
   assert.ok(!JSON.stringify(primeiro).includes('example.invalid'));
  });

  await t.test('long commit bodies are reduced to a subject line', async () => {
   stub.set(() => ({ status: 200, body: { deployments: [{ ...DEPLOY, meta: {
    ...DEPLOY.meta, githubCommitMessage: 'assunto curto' + '\n\ncorpo enorme '.padEnd(4000, 'x'),
   } }] } }));
   const [d] = await adapter.listDeployments({ projectId: 'prj_site' });
   assert.equal(d.commit_message, 'assunto curto');
   stub.set(padrao);
  });

  await t.test('carries the error message of a failed deployment', async () => {
   const deploys = await adapter.listDeployments({ projectId: 'prj_edu' });
   const falho = deploys.find(d => d.id === 'dpl_teste2');
   assert.equal(falho.state_label, 'falhou');
   assert.equal(falho.error_message, 'Build falhou');
   assert.equal(falho.commit, null);
  });

  await t.test('provider failures never leak the credential', async () => {
   for (const [status, trecho] of [[401, /inválida ou sem escopo/], [429, /Limite de requisições/], [500, /indisponível/]]) {
    stub.set(() => ({ status, body: { error: { code: 'x', message: 'detalhe interno', token: TOKEN } } }));
    await assert.rejects(() => adapter.listDeployments({ projectId: 'prj_site' }), error => {
     assert.match(error.message, trecho);
     assert.ok(!error.message.includes(TOKEN), 'a credencial não pode aparecer no erro');
     assert.ok(!error.message.includes('detalhe interno'), 'o corpo bruto do provedor não pode vazar');
     return true;
    });
   }
   stub.set(padrao);
  });

  await t.test('teamId is sent only when explicitly configured', async () => {
   const comTime = createVercelAdapter({ token: TOKEN, teamId: 'team_abc', baseUrl: stub.base() });
   await comTime.listDeployments({ projectId: 'prj_site' });
   assert.equal(stub.chamadas.at(-1).search.get('teamId'), 'team_abc');
  });

  await t.test('registry only exists when a token is configured', () => {
   assert.equal(buildRegistry({}).length, 0);
   assert.equal(buildRegistry({ VERCEL_TOKEN: '' }).length, 0);
   assert.equal(buildRegistry({ VERCEL_TOKEN: TOKEN }).length, 1);
  });
 } finally { await stub.close(); }
});

test('Deploys endpoint suite', async t => {
 const pool = new pg.Pool({ connectionString: testConnectionString().connectionString, max: 2 });
 const adminPassword = randomBytes(32).toString('base64url');
 const stub = startStub();
 await stub.listen();

 let time = Date.now();
 const boot = async registry => {
  const server = createCore({ pool, adminPassword, clock: () => time, deployRegistry: registry });
  await new Promise(r => server.listen(0, '127.0.0.1', r));
  const origin = `http://127.0.0.1:${server.address().port}`;
  const login = await fetch(origin + '/api/login', {
   method: 'POST', headers: { origin, 'Content-Type': 'application/json' },
   body: JSON.stringify({ password: adminPassword }),
  });
  return { server, origin, cookie: login.headers.get('set-cookie').split(';')[0] };
 };
 const stop = async server => { server.closeAllConnections(); await new Promise(r => server.close(r)); };
 const registry = () => buildRegistry({ VERCEL_TOKEN: TOKEN, VERCEL_API_BASE: stub.base() });

 try {
  await t.test('requires an operator session', async () => {
   const { server, origin } = await boot(registry());
   try { assert.equal((await fetch(origin + '/api/deploys')).status, 401); } finally { await stop(server); }
  });

  await t.test('unexpected query parameters are rejected', async () => {
   const { server, origin, cookie } = await boot(registry());
   try {
    assert.equal((await fetch(origin + '/api/deploys?project=x', { headers: { cookie } })).status, 400);
   } finally { await stop(server); }
  });

  await t.test('no provider configured is an honest empty state, not an error', async () => {
   const { server, origin, cookie } = await boot([]);
   try {
    const r = await fetch(origin + '/api/deploys', { headers: { cookie } });
    assert.equal(r.status, 200);
    const data = await r.json();
    assert.equal(data.configured, false);
    assert.deepEqual(data.projects, []);
    assert.deepEqual(data.providers, []);
   } finally { await stop(server); }
  });

  await t.test('every project appears, including one with no deployments', async () => {
   const { server, origin, cookie } = await boot(registry());
   try {
    const data = await (await fetch(origin + '/api/deploys', { headers: { cookie } })).json();
    assert.equal(data.configured, true);
    assert.equal(data.providers[0].status, 'ok');
    assert.equal(data.projects.length, 3, 'os tres projetos, mesmo o parado');

    const porNome = Object.fromEntries(data.projects.map(p => [p.project, p]));
    assert.equal(porNome['site-tzolkin'].deployments[0].commit, '7328bee');
    // O projeto sem deploy NAO some: e o defeito que a versao anterior tinha.
    assert.deepEqual(porNome['tzolkin-sites'].deployments, []);
    assert.equal(porNome['tzolkin-sites'].git_connected, false);
    assert.equal(data.projects[0].project, 'tzolkin-educare');
    assert.equal(data.projects.at(-1).project, 'tzolkin-sites');
    // A credencial jamais chega ao navegador.
    assert.ok(!JSON.stringify(data).includes(TOKEN));
   } finally { await stop(server); }
  });

  await t.test('one failing project does not take down the others', async () => {
   stub.set(({ url }) => {
    if (url.pathname === '/v9/projects') return { status: 200, body: { projects: PROJETOS } };
    if (url.searchParams.get('projectId') === 'prj_edu') return { status: 500, body: {} };
    return padrao({ url });
   });
   const { server, origin, cookie } = await boot(registry());
   try {
    const data = await (await fetch(origin + '/api/deploys', { headers: { cookie } })).json();
    assert.equal(data.providers[0].status, 'ok');
    assert.equal(data.providers[0].incomplete, true, 'a resposta declara que veio incompleta');
    assert.equal(data.projects.length, 3);
    const educare = data.projects.find(p => p.project === 'tzolkin-educare');
    assert.deepEqual(educare.deployments, []);
    assert.equal(educare.partial, true);
    assert.equal(data.projects.find(p => p.project === 'site-tzolkin').deployments.length, 1);
   } finally { await stop(server); stub.set(padrao); }
  });

  await t.test('a provider outage degrades the panel instead of breaking it', async () => {
   stub.set(() => ({ status: 500, body: { error: 'boom' } }));
   const { server, origin, cookie } = await boot(registry());
   try {
    const r = await fetch(origin + '/api/deploys', { headers: { cookie } });
    assert.equal(r.status, 200, 'falha do provedor não pode virar erro do Core');
    const data = await r.json();
    assert.equal(data.configured, true);
    assert.equal(data.providers[0].status, 'error');
    assert.match(data.providers[0].message, /indisponível/);
    assert.deepEqual(data.projects, []);
   } finally { await stop(server); stub.set(padrao); }
  });

  await t.test('short cache spares the provider, and expires', async () => {
   const { server, origin, cookie } = await boot(registry());
   try {
    const antes = stub.chamadas.length;
    await fetch(origin + '/api/deploys', { headers: { cookie } });
    // Uma consulta = 1 listagem de projetos + 1 por projeto. O número exato não importa;
    // o que importa é que a segunda consulta não gere NENHUMA chamada nova.
    const porConsulta = stub.chamadas.length - antes;
    assert.ok(porConsulta > 0);
    await fetch(origin + '/api/deploys', { headers: { cookie } });
    assert.equal(stub.chamadas.length - antes, porConsulta, 'a segunda consulta deve vir do cache');
    time += 31000;
    await fetch(origin + '/api/deploys', { headers: { cookie } });
    assert.equal(stub.chamadas.length - antes, porConsulta * 2, 'passados 30s, consulta de novo');
   } finally { await stop(server); }
  });

  await t.test('the endpoint never writes: only GET is routed', async () => {
   const { server, origin, cookie } = await boot(registry());
   try {
    for (const method of ['POST', 'PUT']) {
     const r = await fetch(origin + '/api/deploys', {
      method, headers: { cookie, origin, 'Content-Type': 'application/json' }, body: '{}',
     });
     assert.equal(r.status, 405, `${method} não pode ser roteado`);
    }
   } finally { await stop(server); }
  });
 } finally { await stub.close(); await pool.end(); }
});
