import test from 'node:test';
import assert from 'node:assert/strict';
import { FERRAMENTAS_WHATSAPP, executarFerramentaWhatsapp } from '../../apps/api/src/modules/mcp-whatsapp.mjs';

const FUNIL = '44444444-4444-4444-8444-444444444444', FLUXO = '11111111-1111-4111-8111-111111111111', AGENTE = '66666666-6666-4666-8666-666666666666';
const auth = { tipo: 'token', ator: 'bot-de-teste' };

/** Banco de mentira: responde só o que as ferramentas perguntam e guarda tudo o que foi executado. */
function banco({ conexoes = [], funis = [{ id: FUNIL, name: 'Funil padrão', slug: 'padrao', space_id: 'sites', space_name: 'Sites' }] } = {}) {
 const s = { sql: [], transacoes: [] };
 const query = async (t, p = []) => {
  s.sql.push({ t, p });
  if (/^\s*(BEGIN|COMMIT|ROLLBACK)/.test(t)) { s.transacoes.push(t.trim()); return { rows: [] }; }
  if (/FROM whatsapp_instance_funnels f JOIN/.test(t)) return { rows: conexoes };
  if (/WHERE p\.is_active/.test(t)) return { rows: funis.map(f => ({ ...f })) };
  if (/^\s*INSERT INTO automations/.test(t)) return { rows: [{ id: '99999999-9999-4999-8999-999999999999' }] };
  if (/FROM pipelines WHERE id=\$1 AND is_active/.test(t)) return { rows: [{ id: FUNIL, space_id: 'sites' }] };
  if (/^\s*INSERT INTO whatsapp_instance_funnels/.test(t)) return { rows: [] };
  if (/FROM products WHERE lifecycle_status/.test(t)) return { rows: [{ id: 'sites', name: 'Sites' }] };
  if (/FROM pipeline_stages WHERE pipeline_id = ANY/.test(t)) return { rows: [] };
  if (/FROM whatsapp_flows f JOIN products/.test(t)) return { rows: [] };
  if (/^\s*INSERT INTO whatsapp_flows/.test(t)) return { rows: [{ id: FLUXO }] };
  if (/FROM ai_agents ORDER BY/.test(t)) return { rows: [] };
  if (/^\s*INSERT INTO ai_agents/.test(t)) return { rows: [{ id: AGENTE }] };
  return { rows: [] };
 };
 const client = { query, release() {} };
 s.pool = { query, async connect() { return client; } };
 return s;
}
const adaptador = ({ configurada = true, todas = true } = {}) => () => ({ configured: configurada, instance: 'teste',
 async listInstances() { return todas ? { ok: true, instances: [{ name: 'teste', state: 'open', number: '5531997599216', profile: 'Tzolkin' }, { name: 'gabi_prod', state: 'close', number: null, profile: null }] } : { ok: false, reason: 'unauthorized' }; },
 async connectionState() { return { ok: true, state: 'open', connected: true }; } });

test('as 7 ferramentas existem com descrição, esquema e os campos obrigatórios certos; nenhuma tem tipo "nulo" (alguns clientes de MCP recusam)', () => {
 assert.deepEqual(FERRAMENTAS_WHATSAPP.map(f => f.name), ['whatsapp_instancias', 'whatsapp_conectar_instancia_funil', 'whatsapp_listar_fluxos', 'whatsapp_salvar_fluxo', 'whatsapp_iniciar_fluxo', 'whatsapp_listar_agentes', 'whatsapp_salvar_agente']);
 for (const f of FERRAMENTAS_WHATSAPP) { assert.ok(f.description.length > 40, f.name); assert.equal(f.inputSchema.type, 'object'); }
 assert.equal(JSON.stringify(FERRAMENTAS_WHATSAPP).includes('"null"'), false);
 const obrig = n => FERRAMENTAS_WHATSAPP.find(f => f.name === n).inputSchema.required;
 assert.deepEqual(obrig('whatsapp_conectar_instancia_funil'), ['instancia', 'funil_id']);
 assert.deepEqual(obrig('whatsapp_salvar_fluxo'), ['space_id', 'name', 'steps']);
 assert.deepEqual(obrig('whatsapp_iniciar_fluxo'), ['flow_id', 'numero']);
 assert.deepEqual(obrig('whatsapp_salvar_agente'), ['name', 'model', 'instructions']);
 const salvar = FERRAMENTAS_WHATSAPP.find(f => f.name === 'whatsapp_salvar_fluxo');
 assert.match(salvar.description, /COMECE EM "teste"/);
 assert.deepEqual(salvar.inputSchema.properties.status.enum, ['rascunho', 'teste', 'ativo', 'arquivado']);
});

test('nome que não é de WhatsApp devolve undefined, para o despachante geral seguir procurando', async () => {
 assert.equal(await executarFerramentaWhatsapp('listar_empresas', {}, { pool: banco().pool, auth }), undefined);
});

test('whatsapp_instancias: instâncias da Evolution com o funil conectado de cada uma e os funis disponíveis', async () => {
 const b = banco({ conexoes: [{ instance: 'teste', space_id: 'sites', space_name: 'Sites', pipeline_id: FUNIL, pipeline_name: 'Funil padrão', create_leads: true }] });
 const r = await executarFerramentaWhatsapp('whatsapp_instancias', {}, { pool: b.pool, auth, env: {}, criarAdaptador: adaptador() });
 assert.deepEqual(r.instancias.map(i => [i.nome, i.estado, i.conectada, i.funil?.pipeline_name ?? null]), [['teste', 'open', true, 'Funil padrão'], ['gabi_prod', 'close', false, null]]);
 assert.deepEqual(r.funis, [{ id: FUNIL, nome: 'Funil padrão', espaco: 'sites', espaco_nome: 'Sites' }]);
 assert.equal(r.aviso, undefined);
 const so = await executarFerramentaWhatsapp('whatsapp_instancias', {}, { pool: b.pool, auth, env: {}, criarAdaptador: adaptador({ todas: false }) });
 assert.deepEqual(so.instancias.map(i => i.nome), ['teste']);
 assert.match(so.aviso, /chave da Evolution é de uma instância só/);
 const sem = await executarFerramentaWhatsapp('whatsapp_instancias', {}, { pool: b.pool, auth, env: {}, criarAdaptador: adaptador({ configurada: false }) });
 assert.deepEqual(sem.instancias, []); assert.match(sem.aviso, /não está configurada/);
});

test('whatsapp_conectar_instancia_funil: grava em transação, em nome de quem chamou, e liga por padrão; erros viram a mesma mensagem da tela', async () => {
 const b = banco();
 const r = await executarFerramentaWhatsapp('whatsapp_conectar_instancia_funil', { instancia: 'teste', funil_id: FUNIL }, { pool: b.pool, auth });
 assert.deepEqual(r, { ok: true, instance: 'teste', space_id: 'sites', pipeline_id: FUNIL, create_leads: true });
 const ins = b.sql.find(q => /INSERT INTO whatsapp_instance_funnels/.test(q.t));
 assert.deepEqual(ins.p, ['teste', 'sites', FUNIL, true, 'bot-de-teste']);
 assert.deepEqual(b.transacoes, ['BEGIN', 'COMMIT']);
 const off = banco();
 assert.equal((await executarFerramentaWhatsapp('whatsapp_conectar_instancia_funil', { instancia: 'teste', funil_id: FUNIL, criar_leads: false }, { pool: off.pool, auth })).create_leads, false);
 const ruim = banco();
 await assert.rejects(executarFerramentaWhatsapp('whatsapp_conectar_instancia_funil', { instancia: 'nome ruim!', funil_id: FUNIL }, { pool: ruim.pool, auth }), /Instância inválida/);
 assert.deepEqual(ruim.transacoes, ['BEGIN', 'ROLLBACK'], 'erro desfaz a transação');
});

test('whatsapp_salvar_fluxo: cria o fluxo com gatilho pela mesma validação da tela; fluxo ruim é recusado antes de gravar', async () => {
 const b = banco();
 const r = await executarFerramentaWhatsapp('whatsapp_salvar_fluxo', { space_id: 'sites', name: 'Boas-vindas', status: 'teste', steps: [{ tipo: 'mensagem', texto: 'Oi, {{first_name}}!' }, { tipo: 'espera', minutos: 60 }, { tipo: 'mensagem', texto: 'Posso ajudar?' }], gatilho: { event: 'lead.criado', pipeline_id: FUNIL } }, { pool: b.pool, auth });
 assert.deepEqual(r, { id: FLUXO });
 const flow = b.sql.find(q => /INSERT INTO whatsapp_flows/.test(q.t));
 assert.deepEqual([flow.p[0], flow.p[1], flow.p[2], flow.p[6]], ['sites', 'Boas-vindas', 'teste', 'bot-de-teste']);
 assert.ok(b.sql.some(q => /INSERT INTO automations/.test(q.t) && q.p[4] === 'lead.criado'), 'o gatilho virou a automação por trás');
 const ruim = banco();
 await assert.rejects(executarFerramentaWhatsapp('whatsapp_salvar_fluxo', { space_id: 'sites', name: 'Fluxo ruim', steps: [{ tipo: 'mensagem', texto: 'Oi {{inexistente}}' }] }, { pool: ruim.pool, auth }), /Variável desconhecida/);
 assert.equal(ruim.sql.some(q => /INSERT INTO whatsapp_flows/.test(q.t)), false);
 const semFinal = banco();
 await assert.rejects(executarFerramentaWhatsapp('whatsapp_salvar_fluxo', { space_id: 'sites', name: 'Fluxo', steps: [{ tipo: 'mensagem', texto: 'Oi, tudo bem?' }, { tipo: 'espera', minutos: 5 }] }, { pool: semFinal.pool, auth }), /não pode terminar numa espera/);
});

test('whatsapp_listar_fluxos e whatsapp_listar_agentes devolvem o que a tela precisa para montar um novo', async () => {
 const b = banco();
 const f = await executarFerramentaWhatsapp('whatsapp_listar_fluxos', {}, { pool: b.pool, auth });
 assert.deepEqual([f.disponivel, f.fluxos, f.espacos.map(e => e.id), f.funis.map(x => x.id)], [true, [], ['sites'], [FUNIL]]);
 assert.ok(f.eventos['lead.criado']);
 const a = await executarFerramentaWhatsapp('whatsapp_listar_agentes', {}, { pool: b.pool, auth });
 assert.equal(a.disponivel, true);
 assert.ok(a.catalogo.modelos.includes('gemini-3.5-flash-lite') && a.catalogo.modelos.includes('claude-sonnet-5-5'));
});

test('whatsapp_salvar_agente: cria agente com modelo do Gemini; modelo fora da lista é recusado', async () => {
 const b = banco();
 const r = await executarFerramentaWhatsapp('whatsapp_salvar_agente', { name: 'Sofia', model: 'gemini-3.5-flash-lite', instructions: 'Responda curto, em português, e nunca prometa preço.', pipelines: [FUNIL], tools: [], is_active: false }, { pool: b.pool, auth });
 assert.deepEqual(r, { id: AGENTE });
 const ins = b.sql.find(q => /INSERT INTO ai_agents/.test(q.t));
 assert.deepEqual([ins.p[0], ins.p[3], ins.p[11]], ['Sofia', 'gemini-3.5-flash-lite', 'bot-de-teste']);
 await assert.rejects(executarFerramentaWhatsapp('whatsapp_salvar_agente', { name: 'Sofia', model: 'gpt-9', instructions: 'Responda curto, em português, e nunca prometa preço.' }, { pool: banco().pool, auth }), /modelos da lista/);
});
