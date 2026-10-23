import test from 'node:test';
import assert from 'node:assert/strict';
import { validarAgente, FERRAMENTAS, CAPACIDADES, MODELOS, riscoDoAgente } from '../../apps/api/src/platform/agentes.mjs';
import { whatsappAgentesRoutes } from '../../apps/api/src/modules/whatsapp-agentes.mjs';

const FUNIL = '44444444-4444-4444-8444-444444444444';
const FUNIS = new Set([FUNIL]);
const bom = (extra = {}) => ({
 name: 'Sofia', description: 'Atende os leads novos do site', instance: 'comercial', model: 'claude-sonnet-5-5',
 instructions: 'Você é a Sofia, da Tzolkin. Responda curto, em português, e nunca prometa preço.', context: 'A Tzolkin faz sites, CRM e automação.',
 pipelines: [FUNIL], tools: ['lead.buscar', 'tarefa.criar'], abilities: { texto: true, audio_enviar: false }, assets: [{ name: 'Proposta modelo', kind: 'documento', url: 'https://exemplo.com/proposta.pdf', when: 'Quando pedirem valores' }], is_active: false, ...extra,
});

test('agente: o corpo bom vira a forma do banco, sem repetir funil nem ferramenta', () => {
 const a = validarAgente(bom({ pipelines: [FUNIL, FUNIL], tools: ['lead.buscar', 'lead.buscar'] }), FUNIS);
 assert.deepEqual(a.pipelines, [FUNIL]); assert.deepEqual(a.tools, ['lead.buscar']);
 assert.equal(a.instance, 'comercial'); assert.equal(a.is_active, false);
 assert.deepEqual(a.assets, [{ name: 'Proposta modelo', kind: 'documento', url: 'https://exemplo.com/proposta.pdf', when: 'Quando pedirem valores' }]);
 assert.equal(validarAgente(bom({ instance: '' }), FUNIS).instance, null, 'sem instância = a padrão');
});

test('agente: recusa o que não existe no catálogo, funil desconhecido, link que não é https e campo extra', () => {
 const ruim = extra => assert.throws(() => validarAgente(bom(extra), FUNIS), e => e.status === 400, JSON.stringify(extra).slice(0, 70));
 ruim({ name: 'x' }); ruim({ model: 'gpt-qualquer' }); ruim({ instructions: 'curto' }); ruim({ instance: 'nome ruim!' });
 ruim({ tools: ['deletar.tudo'] }); ruim({ abilities: { telepatia: true } }); ruim({ abilities: { texto: 'sim' } }); ruim({ abilities: [] });
 ruim({ pipelines: ['11111111-1111-4111-8111-111111111111'] }); ruim({ pipelines: ['nao-e-uuid'] });
 ruim({ assets: [{ name: 'Link', kind: 'link', url: 'http://inseguro.com/x' }] }); ruim({ assets: [{ name: 'Link', kind: 'link', url: 'javascript:alert(1)' }] });
 ruim({ assets: [{ name: 'Sem tipo', kind: 'planilha', url: 'https://x.co/a' }] }); ruim({ assets: Array.from({ length: 21 }, (_, i) => ({ name: `Doc ${i}`, kind: 'texto' })) });
 ruim({ is_active: 'sim' }); ruim({ extra: 1 });
 assert.doesNotThrow(() => validarAgente(bom({ assets: [{ name: 'Tom de voz', kind: 'texto', url: null, when: null }] }), FUNIS), 'material de texto não precisa de link');
});

test('catálogo: toda ferramenta tem nome, descrição e risco válido; o modelo padrão está na lista', () => {
 for (const [id, f] of Object.entries(FERRAMENTAS)) { assert.match(id, /^[a-z]+\.[a-z_]+$/); assert.ok(f.nome && f.descricao && ['baixo', 'medio', 'alto'].includes(f.risco), id); }
 for (const c of Object.values(CAPACIDADES)) assert.ok(c.nome && c.descricao);
 assert.ok(MODELOS.includes('claude-sonnet-5-5'));
 assert.equal(riscoDoAgente(['lead.buscar']), 'baixo'); assert.equal(riscoDoAgente(['lead.buscar', 'tarefa.criar']), 'medio'); assert.equal(riscoDoAgente(['cobranca.gerar_link', 'lead.buscar']), 'alto');
});

function montar(banco) {
 const rotas = new Map();
 whatsappAgentesRoutes({ get: (r, f) => rotas.set('GET ' + r, f), post: (r, f) => rotas.set('POST ' + r, f), put: (r, f) => rotas.set('PUT ' + r, f) });
 return async (chave, { body = {}, params = {} } = {}) => {
  let resposta = null;
  const r = await rotas.get(chave)({ pool: banco, client: banco, body, params, operator: { email: 'eu@x.co' }, reply: (status, dados) => { resposta = { status, dados }; } });
  return resposta ?? r;
 };
}
function banco({ agentes = [], semTabela = false, duplicado = false } = {}) {
 const sql = [];
 return { sql, async query(texto, p = []) {
  sql.push({ texto, p });
  if (texto.includes('FROM pipelines p')) return { rows: [{ id: FUNIL, name: 'Funil padrão', space_id: 'sites', space_name: 'Sites' }] };
  if (texto.includes('FROM commercial') || texto.includes('operator_accounts')) return { rows: [{ ok: 1 }], rowCount: 1 };
  if (semTabela && texto.includes('ai_agents')) throw Object.assign(new Error('relation'), { code: '42P01' });
  if (texto.startsWith('SELECT id,name')) return { rows: agentes };
  if (texto.startsWith('INSERT INTO ai_agents')) { if (duplicado) throw Object.assign(new Error('dup'), { code: '23505' }); return { rows: [{ id: 'novo-id' }] }; }
  if (texto.includes('FROM ai_agents WHERE id')) return { rows: [{ id: p[0], version: 3 }] };
  return { rows: [], rowCount: 1 };
 } };
}

test('rotas: listar devolve o catálogo e o risco; sem a migração 065 explica em vez de quebrar', async () => {
 const lista = await montar(banco({ agentes: [{ id: 'a1', name: 'Sofia', tools: ['cobranca.gerar_link'] }] }))('GET /api/whatsapp/agents');
 assert.equal(lista.dados.disponivel, true); assert.equal(lista.dados.agents[0].risco, 'alto');
 assert.ok(lista.dados.catalogo.ferramentas['lead.buscar']); assert.deepEqual(lista.dados.funis.map(f => f.id), [FUNIL]);
 const sem = await montar(banco({ semTabela: true }))('GET /api/whatsapp/agents');
 assert.equal(sem.dados.disponivel, false); assert.match(sem.dados.aviso, /migração 065/);
});

test('rotas: criar grava na transação, nome repetido vira 409, editar confere a versão', async () => {
 const b = banco();
 assert.deepEqual((await montar(b)('POST /api/whatsapp/agents', { body: bom() })).body, { id: 'novo-id' });
 const ins = b.sql.find(q => q.texto.startsWith('INSERT INTO ai_agents')).p;
 assert.equal(ins[0], 'Sofia'); assert.deepEqual(ins[6], [FUNIL]); assert.equal(ins[10], false); assert.equal(ins[11], 'eu@x.co');
 await assert.rejects(montar(banco({ duplicado: true }))('POST /api/whatsapp/agents', { body: bom() }), e => e.status === 409);
 await assert.rejects(montar(banco({ semTabela: true }))('POST /api/whatsapp/agents', { body: bom() }), e => e.status === 409);
 const id = '55555555-5555-4555-8555-555555555555';
 assert.deepEqual((await montar(banco())('PUT /api/whatsapp/agents/:id', { params: { id }, body: bom({ version: 3 }) })).body, { ok: true });
 await assert.rejects(montar(banco())('PUT /api/whatsapp/agents/:id', { params: { id }, body: bom({ version: 2 }) }), e => e.status === 409);
 await assert.rejects(montar(banco())('PUT /api/whatsapp/agents/:id', { params: { id: 'x' }, body: bom({ version: 1 }) }), e => e.status === 400);
 await assert.rejects(montar(banco())('POST /api/whatsapp/agents', { body: bom({ pipelines: ['11111111-1111-4111-8111-111111111111'] }) }), e => e.status === 400);
});

test('migração 065: só adiciona, nome único sem caixa, texto limitado e lista de materiais com teto', async () => {
 const { readFileSync } = await import('node:fs');
 const sql = readFileSync(new URL('../../db/migrations/065_agentes_de_ia.sql', import.meta.url), 'utf8').replace(/--.*$/gm, '');
 assert.doesNotMatch(sql, /\b(DROP|DELETE|TRUNCATE|ALTER|UPDATE)\b/i);
 assert.match(sql, /CREATE UNIQUE INDEX IF NOT EXISTS ai_agents_nome ON ai_agents \(lower\(name\)\)/);
 assert.match(sql, /jsonb_array_length\(assets\) <= 20/);
 assert.match(sql, /is_active boolean NOT NULL DEFAULT false/);
});
