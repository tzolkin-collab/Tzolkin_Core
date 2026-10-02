// Acompanhamento ligado à contratação (migração 041), ponta a ponta no PostgreSQL descartável:
// node scripts/test-commercial.mjs test/tracking-engagement.test.mjs
import test from 'node:test';
import assert from 'node:assert/strict';
import pg from 'pg';
import { randomBytes, randomUUID } from 'node:crypto';
import { createCore } from '../apps/api/src/server.mjs';
import { testConnectionString } from '../apps/api/src/platform/database.mjs';

const hoje = () => new Intl.DateTimeFormat('en-CA', { timeZone: 'America/Sao_Paulo', year: 'numeric', month: '2-digit', day: '2-digit' }).format(new Date());

test('Acompanhamento por contratação', async t => {
 const pool = new pg.Pool({ connectionString: testConnectionString().connectionString, max: 3 });
 const adminPassword = randomBytes(32).toString('base64url');
 const server = createCore({ pool, adminPassword });
 await new Promise(r => server.listen(0, '127.0.0.1', r));
 const origin = `http://127.0.0.1:${server.address().port}`;
 const marca = randomUUID().slice(0, 8);
 const login = await fetch(origin + '/api/login', { method: 'POST', headers: { origin, 'Content-Type': 'application/json' }, body: JSON.stringify({ password: adminPassword }) });
 assert.equal(login.status, 200);
 const cookie = login.headers.get('set-cookie').split(';')[0];
 const chamar = (metodo, rota, body) => fetch(origin + rota, { method: metodo, headers: { cookie, origin, 'Content-Type': 'application/json' }, ...(body ? { body: JSON.stringify(body) } : {}) }).then(async r => ({ status: r.status, body: await r.json() }));
 const mes = hoje().slice(0, 7);
 const nova = (tenant, engagement, extra = {}) => ({ id: randomUUID(), tenant_id: tenant, engagement_id: engagement, category: 'mentoria', kind: 'sessao', title: `Sessão ${marca}`, starts_at: `${hoje()}T10:00:00-03:00`, ends_at: `${hoje()}T11:00:00-03:00`, ...extra });
 const listar = async filtro => (await chamar('GET', `/api/tracking?month=${mes}${filtro || ''}`)).body;
 const E = {}, T = {};
 try {
  await t.test('prepara duas empresas, cada uma com contratações, uma delas arquivada', async () => {
   T.a = (await chamar('POST', '/api/tenants', { name: `Acomp A ${marca}`, slug: `acomp-a-${marca}`, relationship_kind: 'customer' })).body.tenant_id;
   T.b = (await chamar('POST', '/api/tenants', { name: `Acomp B ${marca}`, slug: `acomp-b-${marca}`, relationship_kind: 'customer' })).body.tenant_id;
   const contratar = async (tenant, label) => { const r = await chamar('POST', '/api/engagements', { tenant_id: tenant, product_id: null, service_model: 'advisory', status: 'active', label: `${label} ${marca}` }); assert.equal(r.status, 200, JSON.stringify(r.body)); return r.body; };
   E.a1 = await contratar(T.a, 'Assessoria A1'); E.a2 = await contratar(T.a, 'Assessoria A2'); E.b1 = await contratar(T.b, 'Assessoria B1');
   E.velha = await contratar(T.a, 'Antiga');
   assert.equal((await chamar('POST', `/api/engagements/${E.velha.id}/archive`, { revision: E.velha.revision })).status, 200);
  });

  await t.test('atividade da contratação da própria empresa: grava, lista com o nome e a lista de contratações vem junto', async () => {
   const corpo = nova(T.a, E.a1.id);
   const r = await chamar('POST', '/api/tracking', corpo);
   assert.equal(r.status, 200, JSON.stringify(r.body)); assert.equal(r.body.activity.engagement_id, E.a1.id);
   const dados = await listar(`&tenant_id=${T.a}`);
   const a = dados.activities.find(x => x.id === corpo.id);
   assert.equal(a.engagement_label, `Assessoria A1 ${marca}`);
   assert.ok(dados.engagements.some(e => e.id === E.a1.id && e.tenant_id === T.a));
   assert.ok(!dados.engagements.some(e => e.id === E.velha.id), 'contratação arquivada não é oferecida');
  });

  await t.test('sem contratação continua valendo (atividade geral da empresa)', async () => {
   const corpo = nova(T.a, null);
   const r = await chamar('POST', '/api/tracking', corpo);
   assert.equal(r.status, 200); assert.equal(r.body.activity.engagement_id, null);
   const semCampo = { ...nova(T.a, null) }; delete semCampo.engagement_id;
   assert.equal((await chamar('POST', '/api/tracking', semCampo)).status, 200, 'cliente antigo, que não manda o campo, segue funcionando');
  });

  await t.test('contratação de outra empresa ou arquivada é recusada, e o banco também recusa', async () => {
   assert.equal((await chamar('POST', '/api/tracking', nova(T.a, E.b1.id))).status, 400);
   assert.equal((await chamar('POST', '/api/tracking', nova(T.a, E.velha.id))).status, 400);
   assert.equal((await chamar('POST', '/api/tracking', nova(T.a, 'não é uuid'))).status, 400);
   // Mesmo que a rota fosse contornada, a chave composta impede ligar à contratação de outra empresa.
   await assert.rejects(pool.query("INSERT INTO service_activities(id,tenant_id,category,kind,title,starts_at,ends_at,engagement_id) VALUES($1,$2,'outro','tarefa','Forçada',now(),now()+interval '1 hour',$3)", [randomUUID(), T.a, E.b1.id]), e => e.code === '23503');
  });

  await t.test('repetir o mesmo cadastro não duplica; mudar a contratação com o mesmo id conflita', async () => {
   const corpo = nova(T.a, E.a1.id);
   assert.equal((await chamar('POST', '/api/tracking', corpo)).status, 200);
   assert.equal((await chamar('POST', '/api/tracking', corpo)).status, 200);
   assert.equal((await pool.query('SELECT count(*)::int n FROM service_activities WHERE id=$1', [corpo.id])).rows[0].n, 1);
   assert.equal((await chamar('POST', '/api/tracking', { ...corpo, engagement_id: E.a2.id })).status, 409);
  });

  await t.test('trocar e tirar a contratação de uma atividade: mesma regra, revisão otimista, auditado', async () => {
   const corpo = nova(T.a, E.a1.id);
   const criada = (await chamar('POST', '/api/tracking', corpo)).body.activity;
   const troca = await chamar('PUT', `/api/tracking/${corpo.id}/engagement`, { engagement_id: E.a2.id, revision: criada.revision });
   assert.equal(troca.status, 200, JSON.stringify(troca.body)); assert.equal(troca.body.activity.engagement_id, E.a2.id); assert.equal(troca.body.activity.revision, criada.revision + 1);
   assert.equal((await chamar('PUT', `/api/tracking/${corpo.id}/engagement`, { engagement_id: E.a1.id, revision: criada.revision })).status, 409, 'revisão velha');
   assert.equal((await chamar('PUT', `/api/tracking/${corpo.id}/engagement`, { engagement_id: E.b1.id, revision: troca.body.activity.revision })).status, 400, 'de outra empresa');
   assert.equal((await chamar('PUT', `/api/tracking/${corpo.id}/engagement`, { engagement_id: 'x', revision: 1 })).status, 400);
   const tira = await chamar('PUT', `/api/tracking/${corpo.id}/engagement`, { engagement_id: null, revision: troca.body.activity.revision });
   assert.equal(tira.status, 200); assert.equal(tira.body.activity.engagement_id, null);
   const trilha = (await pool.query("SELECT action FROM service_activity_audit WHERE activity_id=$1 ORDER BY id", [corpo.id])).rows.map(x => x.action);
   assert.deepEqual(trilha, ['created', 'engagement_changed', 'engagement_changed']);
  });

  await t.test('filtrar por contratação traz só as atividades e as horas dela', async () => {
   const a = nova(T.a, E.a2.id), b = nova(T.a, E.a1.id);
   await chamar('POST', '/api/tracking', a); await chamar('POST', '/api/tracking', b);
   await chamar('POST', `/api/tracking/${a.id}/time`, { id: randomUUID(), minutes: 30, worked_on: hoje(), note: 'Reunião' });
   await chamar('POST', `/api/tracking/${b.id}/time`, { id: randomUUID(), minutes: 20, worked_on: hoje(), note: 'Preparação' });
   const so = await listar(`&engagement_id=${E.a2.id}`);
   assert.ok(so.activities.length >= 1 && so.activities.every(x => x.engagement_id === E.a2.id));
   assert.ok(so.logs.every(l => l.engagement_id === E.a2.id) && so.logs.some(l => l.activity_id === a.id) && !so.logs.some(l => l.activity_id === b.id));
   assert.equal((await chamar('GET', `/api/tracking?month=${mes}&engagement_id=x`)).status, 400);
  });

  await t.test('a ficha da empresa separa as horas por contratação e mostra a hora sem contratação', async () => {
   const geral = nova(T.a, null);
   await chamar('POST', '/api/tracking', geral);
   await chamar('POST', `/api/tracking/${geral.id}/time`, { id: randomUUID(), minutes: 15, worked_on: hoje(), note: 'Geral' });
   const ficha = (await chamar('GET', `/api/tenants/${T.a}/summary`)).body.hours;
   assert.equal(ficha.by_engagement, true);
   const por = Object.fromEntries(ficha.items.map(i => [i.id, i.minutes]));
   assert.equal(por[E.a2.id], 30); assert.equal(por[E.a1.id], 20); assert.equal(por.null, 15);
   assert.equal(ficha.items.reduce((s, i) => s + i.minutes, 0), ficha.minutes, 'a soma das contratações fecha com o total da empresa');
   assert.equal(ficha.items.at(-1).id, null, 'sem contratação aparece por último');
  });
 } finally { server.closeAllConnections(); await new Promise(r => server.close(r)); await pool.end(); }
});
