// Tags da agenda (migração 056) sem banco: o nome virando identificador, o que acontece ANTES da migração e a regra de não apagar.
// O SQL de verdade, e as duas portas (tela e MCP) juntas, estão em test/agenda-tags.test.mjs (banco descartável).
import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { agendaTagsRoutes } from '../../apps/api/src/modules/agenda-tags.mjs';
import { _internals as mcp } from '../../apps/api/src/modules/mcp.mjs';
import { slugDaTag, tagInput, criarDetectorTags, autorDaIa, autorDaPessoa, MENSAGEM_056, MAX_TAGS_POR_ATIVIDADE } from '../../apps/api/src/platform/agenda-tags.mjs';

const falha = (fn, status = 400) => assert.throws(fn, e => e.status === status);

test('o nome vira o identificador: acento, maiúscula e símbolo não criam tag nova', () => {
 for (const igual of ['Revisão Técnica', 'revisao tecnica', '  REVISÃO   TÉCNICA!! ', 'revisão-técnica']) assert.equal(slugDaTag(igual), 'revisao-tecnica', igual);
 assert.equal(slugDaTag('Ação & Reação #1'), 'acao-reacao-1');
 assert.equal(slugDaTag('a'.repeat(60)).length, 40, 'cabe no limite do banco');
 assert.doesNotMatch(slugDaTag('x'.repeat(39) + '- y'), /-$/, 'o corte não deixa hífen pendurado no fim');
 falha(() => slugDaTag('!!!'), 400); falha(() => slugDaTag(''), 400);
});

test('nome e cor da tag: tamanho do banco, sem caractere de controle, cor da lista e neutra por padrão', () => {
 assert.deepEqual(tagInput({ label: '  Onboarding  ' }), { label: 'Onboarding', tone: 'neutral', slug: 'onboarding' });
 assert.equal(tagInput({ label: 'Onboarding', tone: 'danger' }).tone, 'danger');
 falha(() => tagInput({ label: 'x' })); falha(() => tagInput({ label: 'x'.repeat(41) })); falha(() => tagInput({ label: 'a\nb' }));
 falha(() => tagInput({ label: 'Onboarding', tone: 'roxo' })); falha(() => tagInput({ label: 42 }));
});

test('quem agiu fica gravado com o prefixo que diferencia pessoa de IA', () => {
 assert.equal(autorDaPessoa({ email: 'ana@tzolkin.test' }), 'person:ana@tzolkin.test');
 assert.equal(autorDaIa('spark-bot'), 'ai:spark-bot');
 assert.equal(autorDaIa(undefined), 'ai:mcp');
});

test('detector da 056: verdadeiro fica; falso só é reverificado depois do prazo', async () => {
 let agora = 0, perguntas = 0, existe = false;
 const db = { query: async () => { perguntas++; return { rows: [{ ok: existe }] }; } };
 const detector = criarDetectorTags({ relogio: () => agora, ttl: 1000 });
 assert.equal(await detector(db), false); assert.equal(await detector(db), false); assert.equal(perguntas, 1);
 agora = 1500; existe = true;
 assert.equal(await detector(db), true);
 existe = false; agora = 99999;
 assert.equal(await detector(db), true); assert.equal(perguntas, 2, 'verdadeiro nunca volta a falso');
});

// ---------- antes da migração ----------
function rotas() {
 const r = {}, roteador = { get(p, h) { r['GET ' + p] = h; }, post(p, h) { r['POST ' + p] = h; }, put(p, h) { r['PUT ' + p] = h; }, delete(p, h) { r['DELETE ' + p] = h; } };
 agendaTagsRoutes(roteador, { detector: async () => false });
 return r;
}
const operador = { email: 'ana@tzolkin.test', subject: 's1' };
const semBanco = { query: async () => assert.fail('antes da 056 nem consulta o banco') };

test('antes da 056: ler diz "indisponível" sem erro, e escrever recusa com 409 e a mensagem da migração', async () => {
 const r = rotas(); let saida;
 await r['GET /api/tags']({ pool: semBanco, url: new URL('http://x/api/tags'), reply: (s, b) => { saida = { s, b }; } });
 assert.equal(saida.s, 200); assert.equal(saida.b.available, false); assert.deepEqual(saida.b.tags, []);
 for (const [rota, extra] of [['POST /api/tags', { body: { label: 'Onboarding' } }], ['PUT /api/tags/:id', { params: { id: '00000000-0000-4000-8000-000000000001' }, body: { revision: 1, reviewed: true } }],
  ['PUT /api/tracking/:id/tags', { params: { id: '00000000-0000-4000-8000-000000000001' }, body: { tags: [], revision: 1 } }]])
  await assert.rejects(r[rota]({ client: semBanco, operator: operador, ...extra }), e => e.status === 409 && e.message === MENSAGEM_056, rota);
});

test('os pedidos mal formados são recusados antes de tocar o banco (com a migração presente)', async () => {
 const ok = { query: async () => ({ rows: [{ role: 'member', status: 'active' }] }) };
 const roteador = {}; agendaTagsRoutes({ get() {}, post() {}, put(p, h) { roteador['PUT ' + p] = h; } }, { detector: async () => true });
 const id = '00000000-0000-4000-8000-000000000001';
 const chama = (rota, extra) => roteador[rota]({ client: ok, operator: operador, ...extra });
 await assert.rejects(chama('PUT /api/tracking/:id/tags', { params: { id: 'nao-e-uuid' }, body: { tags: [], revision: 1 } }), e => e.status === 400);
 await assert.rejects(chama('PUT /api/tracking/:id/tags', { params: { id }, body: { tags: ['x'], revision: 1 } }), e => e.status === 400, 'tag que não é uuid');
 await assert.rejects(chama('PUT /api/tracking/:id/tags', { params: { id }, body: { tags: 'a', revision: 1 } }), e => e.status === 400);
 await assert.rejects(chama('PUT /api/tracking/:id/tags', { params: { id }, body: { tags: [], revision: 0 } }), e => e.status === 400, 'revisão obrigatória');
 await assert.rejects(chama('PUT /api/tags/:id', { params: { id }, body: { revision: 1, reviewed: false } }), e => e.status === 400, 'a revisão só se aprova');
 await assert.rejects(chama('PUT /api/tags/:id', { params: { id }, body: { revision: 1, archived: 'sim' } }), e => e.status === 400);
 await assert.rejects(chama('PUT /api/tags/:id', { params: { id }, body: { revision: 1, extra: 1 } }), e => e.status === 400, 'campo desconhecido');
 assert.ok(MAX_TAGS_POR_ATIVIDADE >= 5);
});

// ---------- MCP ----------
test('o MCP oferece as três ferramentas de tag e o parâmetro tags em criar e editar, e explica à IA como usá-las', () => {
 const nomes = mcp.TOOLS.map(t => t.name);
 for (const n of ['listar_tags', 'criar_tag', 'revisar_tag']) assert.ok(nomes.includes(n), n);
 for (const n of ['criar_atividade', 'editar_atividade']) {
  const tags = mcp.TOOLS.find(t => t.name === n).inputSchema.properties.tags;
  assert.equal(tags.type, 'array'); assert.equal(tags.items.type, 'string');
 }
 assert.equal(mcp.TOOLS.find(t => t.name === 'criar_tag').inputSchema.required[0], 'label');
 assert.match(String(mcp.MCP_INSTRUCTIONS ?? ''), /listar_tags|TAGS/i, 'as instruções para a IA falam de tags');
});

// ---------- a migração e a regra de não apagar ----------
test('a migração 056 só cria duas tabelas, sem apagar nada; e o código das tags nunca emite DELETE', () => {
 const sql = readFileSync('db/migrations/056_tags_da_atividade.sql', 'utf8');
 const codigo = sql.replace(/--.*$/gm, '').replace(/'[^']*'/g, '');
 assert.match(codigo, /CREATE TABLE IF NOT EXISTS agenda_tags/); assert.match(codigo, /CREATE TABLE IF NOT EXISTS service_activity_tags/);
 assert.doesNotMatch(codigo, /\bDROP\b|\bDELETE\b|\bTRUNCATE\b|ALTER TABLE service_activities/i, 'nada é apagado e a tabela da atividade não é tocada');
 for (const arquivo of ['apps/api/src/platform/agenda-tags.mjs', 'apps/api/src/modules/agenda-tags.mjs'])
  assert.doesNotMatch(readFileSync(arquivo, 'utf8').replace(/\/\/.*$/gm, '').replace(/\/\*[\s\S]*?\*\//g, ''), /DELETE\s+FROM/i, arquivo + ' emite DELETE');
});
