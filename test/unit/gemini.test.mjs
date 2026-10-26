import test from 'node:test';
import assert from 'node:assert/strict';
import { createGeminiAdapter, limparEsquema, declaracoes, paraContents, deResposta } from '../../apps/api/src/integrations/gemini.mjs';
import { executarTurno } from '../../apps/api/src/platform/agentes-motor.mjs';
import { provedorDoModelo, MODELOS } from '../../apps/api/src/platform/agentes.mjs';
import { PROVEDORES, validarValores, testarProvedor } from '../../apps/api/src/platform/credenciais.mjs';

const CHAVE = 'AIzaSyFAKEKEYFORTESTS1234567890abcdef';
const env = { GEMINI_API_KEY: CHAVE };
const resposta = (status, corpo) => ({ ok: status >= 200 && status < 300, status, json: async () => corpo });
const com = (status, corpo) => { const chamadas = []; const a = createGeminiAdapter({ env, fetchImpl: async (url, init) => { chamadas.push({ url: String(url), init, body: init.body ? JSON.parse(init.body) : undefined }); return resposta(status, corpo); } }); return { a, chamadas }; };

test('limparEsquema: tira o que o Gemini recusa (additionalProperties, maxLength) e mantém o resto, inclusive dentro de items e properties', () => {
 const e = { type: 'object', additionalProperties: false, properties: { texto: { type: 'string', description: 'x', maxLength: 500 }, dias: { type: 'integer', minimum: 0, maximum: 60 }, lista: { type: 'array', items: { type: 'string', maxLength: 10, enum: ['a', 'b'] } } }, required: ['texto'] };
 assert.deepEqual(limparEsquema(e), { type: 'object', properties: { texto: { type: 'string', description: 'x' }, dias: { type: 'integer', minimum: 0, maximum: 60 }, lista: { type: 'array', items: { type: 'string', enum: ['a', 'b'] } } }, required: ['texto'] });
});

test('declaracoes: ferramenta sem campos fica sem "parameters" (o Gemini recusa objeto vazio); com campos leva o esquema limpo', () => {
 const d = declaracoes([
  { name: 'lead_buscar', description: 'Busca o lead', input_schema: { type: 'object', properties: {}, additionalProperties: false } },
  { name: 'nota_registrar', description: 'Anota', input_schema: { type: 'object', properties: { texto: { type: 'string', maxLength: 500 } }, required: ['texto'], additionalProperties: false } },
 ]);
 assert.deepEqual(d[0], { name: 'lead_buscar', description: 'Busca o lead' });
 assert.deepEqual(d[1].parameters, { type: 'object', properties: { texto: { type: 'string' } }, required: ['texto'] });
});

test('paraContents: texto, chamada de ferramenta e resultado viram o formato do Gemini; o resultado responde pelo NOME da ferramenta', () => {
 const msgs = [
  { role: 'user', content: 'Quanto custa?' },
  { role: 'assistant', content: [{ type: 'text', text: 'Vou ver.' }, { type: 'tool_use', id: 'abc', name: 'base_consultar', input: { consulta: 'preço' }, thoughtSignature: 'assinatura-opaca' }] },
  { role: 'user', content: [{ type: 'tool_result', tool_use_id: 'abc', content: '{"trechos":["R$ 1.000"]}' }] },
  { role: 'user', content: [{ type: 'tool_result', tool_use_id: 'zzz', content: 'Falhou', is_error: true }] },
 ];
 const c = paraContents(msgs);
 assert.deepEqual(c[0], { role: 'user', parts: [{ text: 'Quanto custa?' }] });
 assert.deepEqual(c[1], { role: 'model', parts: [{ text: 'Vou ver.' }, { functionCall: { name: 'base_consultar', args: { consulta: 'preço' } }, thoughtSignature: 'assinatura-opaca' }] });
 assert.equal(c[2].role, 'user');
 assert.deepEqual(c[2].parts[0], { functionResponse: { name: 'base_consultar', response: { trechos: ['R$ 1.000'] } } });
 assert.deepEqual(c[2].parts[1], { functionResponse: { name: 'ferramenta', response: { error: 'Falhou' } } }, 'resultado seguido do mesmo papel entra na mesma mensagem; id desconhecido não quebra');
 assert.equal(c.length, 3);
 assert.deepEqual(paraContents([{ role: 'user', content: 'x' }, { role: 'user', content: 'y' }]), [{ role: 'user', parts: [{ text: 'x' }, { text: 'y' }] }], 'mensagens seguidas do mesmo papel viram uma só');
 assert.deepEqual(paraContents([{ role: 'user', content: '   ' }, { role: 'assistant', content: [] }]), []);
 assert.deepEqual(paraContents([{ role: 'user', content: [{ type: 'tool_result', tool_use_id: 'a', content: 'texto puro' }] }])[0].parts[0].functionResponse.response, { result: 'texto puro' });
});

test('deResposta: texto, chamada de ferramenta (com assinatura), pensamento fora, tokens somados e o motivo de parar', () => {
 const r = deResposta({ candidates: [{ finishReason: 'STOP', content: { parts: [{ text: 'pensando…', thought: true }, { text: 'Olá!' }, { functionCall: { name: 'nota_registrar', args: { texto: 'x' } }, thoughtSignature: 'sig' }] } }], usageMetadata: { promptTokenCount: 100, candidatesTokenCount: 20, thoughtsTokenCount: 30 } });
 assert.deepEqual(r.content[0], { type: 'text', text: 'Olá!' });
 assert.deepEqual({ ...r.content[1], id: 'x' }, { type: 'tool_use', id: 'x', name: 'nota_registrar', input: { texto: 'x' }, thoughtSignature: 'sig' });
 assert.match(r.content[1].id, /^gem_[0-9a-f-]{12}$/);
 assert.equal(r.stopReason, 'tool_use');
 assert.deepEqual(r.usage, { input: 100, output: 50 });
 assert.equal(deResposta({ candidates: [{ finishReason: 'MAX_TOKENS', content: { parts: [{ text: 'cortou' }] } }] }).stopReason, 'max_tokens');
 assert.equal(deResposta({ candidates: [{ finishReason: 'STOP', content: { parts: [{ text: 'fim' }] } }] }).stopReason, 'end_turn');
 assert.deepEqual(deResposta({ candidates: [] }).content, []);
});

test('messages: monta o pedido certo (chave no cabeçalho, nunca na URL), com sistema, ferramentas e piso de saída, e devolve no formato do motor', async () => {
 const { a, chamadas } = com(200, { candidates: [{ finishReason: 'STOP', content: { parts: [{ text: 'Posso ajudar!' }] } }], usageMetadata: { promptTokenCount: 5, candidatesTokenCount: 3 } });
 const r = await a.messages({ model: 'gemini-3.5-flash-lite', system: 'Você é a Sofia.', messages: [{ role: 'user', content: 'Oi' }], tools: [{ name: 'lead_buscar', description: 'd', input_schema: { type: 'object', properties: {} } }], maxTokens: 1024 });
 assert.deepEqual(r, { ok: true, content: [{ type: 'text', text: 'Posso ajudar!' }], stopReason: 'end_turn', usage: { input: 5, output: 3 } });
 const c = chamadas[0];
 assert.equal(c.url, 'https://generativelanguage.googleapis.com/v1beta/models/gemini-3.5-flash-lite:generateContent');
 assert.equal(c.init.headers['x-goog-api-key'], CHAVE);
 assert.equal(c.url.includes(CHAVE) || c.url.includes('key='), false, 'a chave não vai na URL');
 assert.equal(c.init.method, 'POST'); assert.equal(c.init.redirect, 'manual');
 assert.deepEqual(c.body.systemInstruction, { parts: [{ text: 'Você é a Sofia.' }] });
 assert.deepEqual(c.body.tools, [{ functionDeclarations: [{ name: 'lead_buscar', description: 'd' }] }]);
 assert.equal(c.body.generationConfig.maxOutputTokens, 2048, 'o modelo gasta parte pensando: 1024 cortava a resposta');
 assert.deepEqual(c.body.contents, [{ role: 'user', parts: [{ text: 'Oi' }] }]);
});

test('messages: recusa modelo que não é do Gemini, conversa vazia e modelo com caracteres estranhos, sem ir à rede', async () => {
 const x = com(200, {});
 for (const ruim of [{ model: 'claude-sonnet-5-5', messages: [{ role: 'user', content: 'x' }] }, { model: 'gemini-3.5-flash-lite', messages: [] }, { model: 'gemini-../../x', messages: [{ role: 'user', content: 'x' }] }, { model: 'gemini-3.5-flash-lite', messages: [{ role: 'user', content: '  ' }] }, {}])
  assert.deepEqual(await x.a.messages(ruim), { ok: false, reason: 'rejected' }, JSON.stringify(ruim).slice(0, 60));
 assert.equal(x.chamadas.length, 0);
});

test('erros: chave errada (o Gemini manda 400, não 401) vira unauthorized; 429 e 5xx repetem; 404 e 400 comuns são recusa; a chave nunca aparece', async () => {
 const f = (status, corpo = {}) => com(status, corpo).a.messages({ model: 'gemini-3.5-flash-lite', messages: [{ role: 'user', content: 'x' }] });
 assert.equal((await f(400, { error: { message: 'API key not valid. Please pass a valid API key.' } })).reason, 'unauthorized');
 assert.equal((await f(401)).reason, 'unauthorized'); assert.equal((await f(403)).reason, 'unauthorized');
 assert.equal((await f(429, { error: { message: 'Quota exceeded' } })).reason, 'rate_limited');
 assert.equal((await f(503)).reason, 'unavailable'); assert.equal((await f(500)).reason, 'unavailable');
 assert.equal((await f(404, { error: { message: 'model not found' } })).reason, 'rejected');
 assert.equal((await f(400, { error: { message: 'Invalid JSON payload' } })).reason, 'rejected');
 const vazou = await f(400, { error: { message: `bad key ${CHAVE}` } });
 assert.equal(JSON.stringify(vazou).includes(CHAVE), false);
 assert.match(vazou.message, /\*\*\*/);
 const caida = createGeminiAdapter({ env, fetchImpl: async () => { throw new Error('ECONNRESET'); } });
 assert.equal((await caida.messages({ model: 'gemini-3.5-flash-lite', messages: [{ role: 'user', content: 'x' }] })).reason, 'unavailable');
 assert.equal((await f(200, { semCandidatos: true })).reason, 'invalid');
 assert.deepEqual(await com(200, { promptFeedback: { blockReason: 'SAFETY' }, candidates: [] }).a.messages({ model: 'gemini-3.5-flash-lite', messages: [{ role: 'user', content: 'x' }] }).then(r => [r.ok, r.reason]), [false, 'rejected']);
});

test('sem chave ou chave em formato ruim: o adaptador diz not_configured / invalid_config e não chama a rede', async () => {
 let chamou = false;
 const fetchImpl = async () => { chamou = true; };
 const sem = createGeminiAdapter({ env: {}, fetchImpl }), ruim = createGeminiAdapter({ env: { GEMINI_API_KEY: 'curta' }, fetchImpl });
 assert.equal(sem.configured, false); assert.equal(ruim.configured, false);
 assert.deepEqual(await sem.messages({}), { ok: false, reason: 'not_configured' });
 assert.deepEqual(await ruim.listModels(), { ok: false, reason: 'invalid_config' });
 assert.equal(chamou, false);
});

test('listModels: só os modelos que geram conteúdo, sem o prefixo "models/"', async () => {
 const { a, chamadas } = com(200, { models: [{ name: 'models/gemini-3.6-flash', supportedGenerationMethods: ['generateContent', 'countTokens'] }, { name: 'models/text-embedding', supportedGenerationMethods: ['embedContent'] }] });
 assert.deepEqual(await a.listModels(), { ok: true, models: ['gemini-3.6-flash'] });
 assert.equal(chamadas[0].init.headers['x-goog-api-key'], CHAVE);
});

test('provedor do modelo: gemini- vai ao Google, o resto à Anthropic; os modelos do Gemini estão na lista do agente', () => {
 assert.equal(provedorDoModelo('gemini-3.6-flash'), 'gemini'); assert.equal(provedorDoModelo('claude-haiku-5-5'), 'anthropic'); assert.equal(provedorDoModelo(undefined), 'anthropic');
 for (const m of ['gemini-3.8-flash', 'gemini-3.6-flash', 'gemini-3.5-flash-lite']) assert.ok(MODELOS.includes(m), m);
});

test('cartão do Gemini nas Integrações: valida a chave, testa listando os modelos e nunca devolve a chave', async () => {
 const prov = PROVEDORES.gemini; assert.ok(prov);
 assert.equal(prov.campos[0].secreto, true);
 assert.notEqual(prov.campos[0].validar('curta'), null); assert.equal(prov.campos[0].validar(CHAVE), null);
 assert.deepEqual(validarValores('gemini', { GEMINI_API_KEY: ` ${CHAVE} ` }, (s, m) => new Error(m)), { GEMINI_API_KEY: CHAVE });
 const boa = await testarProvedor('gemini', { GEMINI_API_KEY: CHAVE }, () => null, async () => resposta(200, { models: [{ name: 'models/gemini-3.6-flash', supportedGenerationMethods: ['generateContent'] }] }));
 assert.equal(boa.ok, true); assert.match(boa.mensagem, /1 modelo \(por exemplo: gemini-3\.6-flash\)/);
 const ruim = await testarProvedor('gemini', { GEMINI_API_KEY: CHAVE }, () => null, async () => resposta(400, { error: { message: 'API key not valid' } }));
 assert.equal(ruim.ok, false); assert.match(ruim.mensagem, /recusou a chave/); assert.equal(ruim.mensagem.includes(CHAVE), false);
});

// ---------- o motor dos agentes usa o provedor certo ----------
function bancoDoTurno(model) {
 const outbox = [];
 const lead = { id: 'l1', name: 'Marina', email: null, whatsapp: '5531997599216', interest: 'Lançamento', message: null, status: 'open', pipeline_id: 'p1', stage_id: 's1', tenant_id: 't1', product_id: 'sites', organization: 'Marina', pipeline_name: 'Funil', stage_name: 'Novos' };
 const agente = { id: 'a1', name: 'Sofia', is_active: true, model, instructions: 'Seja breve.', context: '', assets: [], tools: [], pipelines: ['p1'] };
 return { outbox, async query(sql, p) {
  if (/FROM ai_agents/.test(sql)) return { rows: [agente] };
  if (/FROM ai_handoffs/.test(sql) || /FROM whatsapp_suppressions/.test(sql)) return { rows: [] };
  if (/FROM commercial_leads l JOIN tenants/.test(sql)) return { rows: [lead] };
  if (/count\(\*\) AS n FROM whatsapp_outbox/.test(sql)) return { rows: [{ n: 0 }] };
  if (/FROM whatsapp_inbox/.test(sql)) return { rows: [{ direcao: 'in', texto: 'Quanto custa?', em: new Date() }] };
  if (/INSERT INTO whatsapp_outbox/.test(sql)) { outbox.push({ texto: p[8], por: p[9] }); return { rows: [{ id: 'o1' }] }; }
  throw new Error('consulta não modelada: ' + sql.slice(0, 70));
 } };
}
test('executarTurno: um agente com modelo gemini-* conversa pelo Gemini; um claude-* pelo Claude; sem a chave do provedor o turno pula sem repetir', async () => {
 const usos = [];
 const adaptador = nome => ({ configured: true, async messages(q) { usos.push([nome, q.model]); return { ok: true, content: [{ type: 'text', text: `Resposta do ${nome}` }], stopReason: 'end_turn', usage: { input: 1, output: 1 } }; } });
 const modelos = { anthropic: adaptador('claude'), gemini: adaptador('gemini') };
 const job = { id: 'j1', agent_id: 'a1', instance: 'teste', number: '5531997599216', lead_id: 'l1' };
 const g = bancoDoTurno('gemini-3.5-flash-lite');
 const r1 = await executarTurno({ db: g, env: { EVOLUTION_INSTANCE: 'teste' }, modelos, job });
 assert.equal(r1.resultado, 'respondeu'); assert.deepEqual(usos.at(-1), ['gemini', 'gemini-3.5-flash-lite']); assert.equal(g.outbox[0].texto, 'Resposta do gemini');
 const c = bancoDoTurno('claude-haiku-5-5');
 await executarTurno({ db: c, env: { EVOLUTION_INSTANCE: 'teste' }, modelos, job });
 assert.deepEqual(usos.at(-1), ['claude', 'claude-haiku-5-5']);
 const semChave = bancoDoTurno('gemini-3.6-flash');
 const r3 = await executarTurno({ db: semChave, env: {}, modelos: { anthropic: adaptador('claude'), gemini: { configured: false, messages: async () => ({ ok: false, reason: 'not_configured' }) } }, job });
 assert.equal(r3.resultado, 'pulou'); assert.match(r3.motivo, /Falta a chave de IA do provedor deste modelo \(gemini-3\.6-flash\)/); assert.equal(semChave.outbox.length, 0);
 const so = bancoDoTurno('claude-sonnet-5-5');
 assert.equal((await executarTurno({ db: so, env: {}, modelo: adaptador('unico'), job })).resultado, 'respondeu', 'quem passa um adaptador só continua funcionando');
});
