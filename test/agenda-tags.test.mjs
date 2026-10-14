// Tags da agenda contra o PostgreSQL de verdade, pelas duas portas: a API da tela e o MCP (a IA).
//
// O que isto prova que o teste com banco falso não prova: o SQL das duas migrações-irmãs de leitura e escrita existe e
// funciona, a MESMA tag nasce do mesmo nome venha de onde vier (acento e maiúscula não criam duplicata), a tag da IA vale na
// hora mas fica marcada para revisar, e NADA se apaga: tirar uma tag de uma atividade e arquivar uma tag são UPDATE.
//
// SÓ roda em banco descartável (npm test / scripts/test-commercial.mjs): cria e apaga linhas.
import test from 'node:test';
import assert from 'node:assert/strict';
import { randomUUID, randomBytes } from 'node:crypto';
import pg from 'pg';
import { createCore } from '../apps/api/src/server.mjs';
import { testConnectionString } from '../apps/api/src/platform/database.mjs';

const DESCARTAVEL = /\/tzolkin_test_/.test(String(process.env.DATABASE_URL_TEST ?? ''));
const TOKEN = 'tok-' + randomBytes(24).toString('base64url');

test('Tags: a mesma tag nasce do mesmo nome pela tela e pelo MCP; a da IA vale na hora e fica a revisar; nada se apaga', { skip: DESCARTAVEL ? false : 'só roda em banco descartável (DATABASE_URL_TEST tzolkin_test_*)' }, async () => {
 const pool = new pg.Pool({ connectionString: testConnectionString().connectionString, max: 4 });
 const marca = randomUUID().slice(0, 8);
 const adminPassword = randomBytes(32).toString('base64url');
 const tenant = randomUUID(), atividade = randomUUID(), mcpAtividade = randomUUID();
 const server = createCore({ pool, adminPassword, webhookEnv: { SPARK_MCP_TOKEN: TOKEN } });
 await new Promise(r => server.listen(0, '127.0.0.1', r));
 const origin = `http://127.0.0.1:${server.address().port}`;
 try {
  await pool.query('INSERT INTO tenants(id,name,slug) VALUES($1,$2,$3)', [tenant, `Empresa ${marca}`, `empresa-${marca}`]);
  const login = await fetch(origin + '/api/login', { method: 'POST', headers: { origin, 'Content-Type': 'application/json' }, body: JSON.stringify({ password: adminPassword }) });
  const cookie = login.headers.get('set-cookie').split(';')[0];
  const api = async (metodo, rota, corpo) => {
   const r = await fetch(origin + rota, { method: metodo, headers: { cookie, origin, 'Content-Type': 'application/json' }, body: corpo === undefined ? undefined : JSON.stringify(corpo) });
   return { status: r.status, corpo: await r.json().catch(() => ({})) };
  };
  const mcp = async (nome, args) => {
   const r = await fetch(origin + '/api/mcp', { method: 'POST', headers: { origin, 'Content-Type': 'application/json', authorization: 'Bearer ' + TOKEN },
    body: JSON.stringify({ jsonrpc: '2.0', id: 1, method: 'tools/call', params: { name: nome, arguments: args } }) });
   const j = await r.json();
   const texto = j.result.content[0].text;
   // Sucesso volta como JSON; erro volta como frase. O teste quer os dois.
   let dados; try { dados = JSON.parse(texto); } catch { dados = { mensagem: texto }; }
   return { erro: j.result?.isError === true, dados };
  };
  const nome = `Revisão Técnica ${marca}`;
  const inicio = new Date(Date.now() + 3600000);

  // ---- pela tela: pessoa cria, nasce revisada; o mesmo nome sem acento e em minúscula é a MESMA tag ----
  const a = await api('POST', '/api/tags', { label: nome, tone: 'info' });
  assert.equal(a.status, 200); assert.equal(a.corpo.created, true);
  assert.equal(a.corpo.tag.origin, 'person'); assert.equal(a.corpo.tag.reviewed, true, 'tag de pessoa nasce revisada');
  const b = await api('POST', '/api/tags', { label: `revisao tecnica ${marca.toUpperCase()}` });
  assert.equal(b.corpo.created, false, 'acento e maiúscula não criam uma segunda tag');
  assert.equal(b.corpo.tag.id, a.corpo.tag.id);
  assert.equal((await api('POST', '/api/tags', { label: 'x' })).status, 400, 'nome curto demais');
  assert.equal((await api('POST', '/api/tags', { label: 'Valida', tone: 'roxo' })).status, 400, 'cor desconhecida');

  // ---- pelo MCP: a IA cria, vale na hora, marcada como sugerida; pedir de novo devolve a mesma ----
  const ia = await mcp('criar_tag', { label: `Onboarding ${marca}` });
  assert.equal(ia.erro, false); assert.equal(ia.dados.criada, true); assert.equal(ia.dados.tag.sugerida_pela_ia, true);
  const ia2 = await mcp('criar_tag', { label: `ONBOARDING ${marca}` });
  assert.equal(ia2.dados.criada, false); assert.equal(ia2.dados.tag.id, ia.dados.tag.id);
  const lista = (await api('GET', '/api/tags')).corpo.tags.filter(t => t.slug.endsWith(marca));
  assert.deepEqual(lista.map(t => [t.origin, t.reviewed]).sort(), [['ai', false], ['person', true]], 'a da IA espera revisão; a da pessoa já nasceu revisada');

  // ---- tags de uma atividade, pela tela: a revisão da atividade é obrigatória e sobe ----
  const criada = await api('POST', '/api/tracking', { id: atividade, tenant_id: tenant, category: 'outro', kind: 'tarefa', title: `Atividade ${marca}`, starts_at: inicio.toISOString(), ends_at: new Date(inicio.getTime() + 3600000).toISOString() });
  assert.equal(criada.status, 200);
  const p1 = await api('PUT', `/api/tracking/${atividade}/tags`, { tags: [a.corpo.tag.id, ia.dados.tag.id], revision: 1 });
  assert.equal(p1.status, 200); assert.equal(p1.corpo.changed, true); assert.equal(p1.corpo.activity.revision, 2);
  assert.equal((await api('PUT', `/api/tracking/${atividade}/tags`, { tags: [a.corpo.tag.id, ia.dados.tag.id], revision: 1 })).status, 409, 'revisão velha: não sobrescreve');
  assert.equal((await api('PUT', `/api/tracking/${atividade}/tags`, { tags: [a.corpo.tag.id, ia.dados.tag.id], revision: 2 })).corpo.changed, false, 'mesma lista: nada muda e a revisão não sobe');
  assert.equal((await api('PUT', `/api/tracking/${atividade}/tags`, { tags: [randomUUID()], revision: 2 })).status, 400, 'tag que não existe');

  // A agenda devolve o catálogo e as tags de cada atividade da janela.
  const mes = `${inicio.getFullYear()}-${String(inicio.getMonth() + 1).padStart(2, '0')}`;
  const agenda = (await api('GET', `/api/tracking?month=${mes}`)).corpo;
  assert.equal(agenda.agenda_tags, true);
  assert.ok(agenda.tags.some(t => t.id === a.corpo.tag.id));
  assert.deepEqual((agenda.activity_tags[atividade] || []).map(t => t.label).sort(), [`Onboarding ${marca}`, nome].sort());

  // ---- tirar uma tag é UPDATE: a linha continua, com removed_at; religar reaproveita a mesma ----
  const p2 = await api('PUT', `/api/tracking/${atividade}/tags`, { tags: [a.corpo.tag.id], revision: 2 });
  assert.equal(p2.corpo.changed, true);
  const linhas = (await pool.query('SELECT tag_id, removed_at FROM service_activity_tags WHERE activity_id=$1', [atividade])).rows;
  assert.equal(linhas.length, 2, 'nada foi apagado');
  assert.equal(linhas.filter(l => l.removed_at).length, 1, 'a tirada ficou marcada com removed_at');
  await api('PUT', `/api/tracking/${atividade}/tags`, { tags: [a.corpo.tag.id, ia.dados.tag.id], revision: 3 });
  assert.equal((await pool.query('SELECT count(*)::int n FROM service_activity_tags WHERE activity_id=$1', [atividade])).rows[0].n, 2, 'religar reaproveita a linha, não cria outra');

  // ---- revisão: aprovar, renomear, arquivar, com a revisão da tag ----
  const aprovada = await api('PUT', `/api/tags/${ia.dados.tag.id}`, { revision: 1, reviewed: true });
  assert.equal(aprovada.status, 200); assert.equal(aprovada.corpo.tag.reviewed, true); assert.match(aprovada.corpo.tag.reviewed_by, /^person:/);
  assert.equal((await api('PUT', `/api/tags/${ia.dados.tag.id}`, { revision: 1, label: 'Outro nome' })).status, 409, 'revisão da tag velha');
  assert.equal((await api('PUT', `/api/tags/${ia.dados.tag.id}`, { revision: 2, label: nome })).status, 409, 'já existe outra tag com esse nome');
  assert.equal((await api('PUT', `/api/tags/${ia.dados.tag.id}`, { revision: 2, reviewed: false })).status, 400, 'a revisão só se aprova');

  // ---- arquivar: continua nas atividades que já tinham, mas não se escolhe de novo ----
  const arq = await api('PUT', `/api/tags/${a.corpo.tag.id}`, { revision: 1, archived: true });
  assert.equal(arq.corpo.tag.archived, true);
  assert.equal((await api('PUT', `/api/tracking/${atividade}/tags`, { tags: [a.corpo.tag.id, ia.dados.tag.id], revision: 4 })).corpo.changed, false, 'a arquivada que já estava na atividade pode ficar');
  const outra = randomUUID();
  await pool.query(`INSERT INTO service_activities(id,tenant_id,category,kind,title,starts_at,ends_at,status) VALUES($1,$2,'outro','tarefa',$3,$4,$5,'planned')`,
   [outra, tenant, `Outra ${marca}`, inicio.toISOString(), new Date(inicio.getTime() + 3600000).toISOString()]);
  assert.equal((await api('PUT', `/api/tracking/${outra}/tags`, { tags: [a.corpo.tag.id], revision: 1 })).status, 409, 'arquivada não é escolhida de novo');
  assert.equal((await api('GET', '/api/tags')).corpo.tags.some(t => t.id === a.corpo.tag.id), false, 'arquivada sai do catálogo padrão');
  assert.equal((await api('GET', '/api/tags?arquivadas=1')).corpo.tags.some(t => t.id === a.corpo.tag.id), true);

  // ---- MCP: criar atividade com tags (cria as que faltam, reaproveita as que existem) e editar só as tags ----
  const viaIa = await mcp('criar_atividade', { title: `Revisar ${marca}`, kind: 'tarefa', tenant_id: tenant, starts_at: inicio.toISOString(), ends_at: new Date(inicio.getTime() + 7200000).toISOString(), tags: [`onboarding ${marca}`, `Nova Frente ${marca}`] });
  assert.equal(viaIa.erro, false, JSON.stringify(viaIa.dados));
  const porNome = Object.fromEntries(viaIa.dados.activity.tags.map(t => [t.label, t.sugerida_pela_ia]));
  assert.equal(porNome[`Onboarding ${marca}`], false, 'reaproveitou a que já existia (e que acabou de ser aprovada)');
  assert.equal(porNome[`Nova Frente ${marca}`], true, 'a que faltava nasceu sugerida pela IA');
  const soTags = await mcp('editar_atividade', { id: viaIa.dados.activity.id, tags: [] });
  assert.equal(soTags.erro, false, 'editar só as tags não gera SQL sem campos');
  assert.deepEqual(soTags.dados.activity.tags, []);
  assert.equal(soTags.dados.activity.revision, viaIa.dados.activity.revision + 1);
  const revIa = await mcp('revisar_tag', { slug: `nova-frente-${marca}`, aprovar: true });
  assert.equal(revIa.erro, false); assert.equal(revIa.dados.tag.sugerida_pela_ia, false);
  const reviewedBy = (await pool.query('SELECT reviewed_by FROM agenda_tags WHERE slug=$1', [`nova-frente-${marca}`])).rows[0].reviewed_by;
  assert.match(reviewedBy, /^ai:/, 'fica gravado que quem revisou foi a IA');
  assert.equal((await mcp('editar_atividade', { id: viaIa.dados.activity.id, tags: ['x'] })).erro, true, 'nome curto: a IA recebe o erro, e a atividade não muda');
 } finally {
  await pool.query('DELETE FROM service_activity_tags WHERE activity_id IN (SELECT id FROM service_activities WHERE tenant_id=$1)', [tenant]).catch(() => {});
  await pool.query('DELETE FROM service_activity_audit WHERE activity_id IN (SELECT id FROM service_activities WHERE tenant_id=$1)', [tenant]).catch(() => {});
  await pool.query('DELETE FROM service_activities WHERE tenant_id=$1', [tenant]).catch(() => {});
  await pool.query('DELETE FROM agenda_tags WHERE slug LIKE $1', [`%${marca}`]).catch(() => {});
  await pool.query('DELETE FROM tenants WHERE id=$1', [tenant]).catch(() => {});
  server.closeAllConnections(); await new Promise(r => server.close(r)); await pool.end();
 }
});
