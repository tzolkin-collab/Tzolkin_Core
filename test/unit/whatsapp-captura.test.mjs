import test from 'node:test';
import assert from 'node:assert/strict';
import { capturarConversas, corpoDoLeadDaConversa, salvarConexao, listarConexoes, MENSAGEM_071 } from '../../apps/api/src/modules/whatsapp-captura.mjs';
import { salvarFluxo } from '../../apps/api/src/modules/whatsapp-fluxos.mjs';
import { validarGatilho } from '../../apps/api/src/platform/fluxos.mjs';

const PESSOA = '5531997590001@s.whatsapp.net', LID = '999888777666@lid';
const FUNIL = '44444444-4444-4444-8444-444444444444', ETAPA = '55555555-5555-4555-8555-555555555555', FLUXO = '11111111-1111-4111-8111-111111111111', AUTO = '33333333-3333-4333-8333-333333333333';
const T = Date.parse('2026-10-26T20:00:00Z');
const ts = min => Math.floor((T + min * 60000) / 1000);
const LIGACAO = { instance: 'teste', space_id: 'sites', pipeline_id: FUNIL, last_scan_at: new Date(T - 10 * 60000).toISOString(), slug: 'padrao' };

// ---------- corpo do lead ----------
test('corpoDoLeadDaConversa: nome ou telefone, funil pelo utm_tzolkin, origem única por instância e telefone, mensagem cortada', () => {
 const c = corpoDoLeadDaConversa({ numero: '5531997590001', nome: 'Marina Duarte', texto: 'x'.repeat(400), ligacao: LIGACAO, instancia: 'teste' });
 assert.deepEqual({ nome: c.lead.name, tel: c.lead.whatsapp, msg: c.lead.message.length, org: c.organization, utm: c.attribution.utm_tzolkin, ref: c.attribution.source_ref, canal: c.attribution.channel, prod: c.commercial.product_id, modelo: c.commercial.service_model, privacidade: c.privacy },
  { nome: 'Marina Duarte', tel: '5531997590001', msg: 300, org: { name: 'Marina Duarte', organization_type: 'person' }, utm: 'sites.padrao', ref: 'teste:5531997590001', canal: 'whatsapp', prod: 'sites', modelo: 'on_demand', privacidade: { source: 'whatsapp', contact_allowed: false } });
 assert.equal(corpoDoLeadDaConversa({ numero: '5531997590001', nome: null, ligacao: LIGACAO, instancia: 'teste' }).lead.name, '+5531997590001', 'sem nome vira o telefone');
 assert.equal(corpoDoLeadDaConversa({ numero: '5531997590001', nome: 'A', ligacao: LIGACAO, instancia: 'teste' }).lead.name, '+5531997590001', 'nome de 1 letra não passa pela validação do intake');
 assert.equal('message' in corpoDoLeadDaConversa({ numero: '5531997590001', ligacao: LIGACAO, instancia: 'teste' }).lead, false);
});

// ---------- ciclo da captura ----------
const chat = (jid, ts_, { minha = false, alt, nome = 'Marina' } = {}) => ({ remoteJid: jid, pushName: nome, lastMessage: { pushName: nome, key: { fromMe: minha, remoteJid: jid, ...(alt ? { remoteJidAlt: alt } : {}) }, message: { conversation: 'oi' }, messageType: 'conversation', messageTimestamp: ts_ } });
const msg = (id, ts_, texto, extra = {}) => ({ id, fromMe: false, timestamp: ts_, messageType: 'conversation', message: { conversation: texto }, ...extra });

function montar({ ligacoes = [LIGACAO], chats = [], mensagens = [], findChatsOk = true, registrarPor = () => ({ novo: true, lead: null, saiu: false, inboxId: 'in1' }), erroNaPrimeira = false, semTabela = false } = {}) {
 const s = { sql: [], leads: [], turnos: [], registros: [], pagou: [] };
 const query = async (sql, p = []) => {
  s.sql.push({ sql, p });
  if (semTabela) throw Object.assign(new Error('x'), { code: '42P01' });
  if (/FROM whatsapp_instance_funnels f JOIN pipelines/.test(sql)) return { rows: ligacoes };
  return { rows: [] };
 };
 const client = { query, release() {} };
 s.pool = { query, async connect() { return client; } };
 let primeira = true;
 s.opcoes = {
  env: { EVOLUTION_INSTANCE: 'teste' }, agora: () => T,
  criarAdaptador: ({ instance }) => ({ configured: true,
   async findChats() { if (erroNaPrimeira && primeira) { primeira = false; throw new Error('boom'); } return findChatsOk ? { ok: true, chats } : { ok: false, reason: 'unavailable' }; },
   async findMessages(q) { s.consultas = [...(s.consultas ?? []), { instance, q }]; return { ok: true, messages: mensagens }; } }),
  criarLead: async (c, a) => { s.leads.push(a); return { body: { lead_id: 'lead-novo', created: true }, afterCommit: () => s.pagou.push(a.productId) }; },
  agendar: async (db, a) => { s.turnos.push(a); return { agendado: true }; },
  registrar: async (db, m) => { s.registros.push(m); return registrarPor(m); },
 };
 return s;
}

test('conversa nova de um número desconhecido: guarda a mensagem, cria o lead no funil conectado, liga a mensagem ao lead e agenda o agente', async () => {
 const s = montar({ chats: [chat(PESSOA, ts(-2))], mensagens: [msg('M2', ts(-1), 'Quanto custa?'), msg('M1', ts(-2), 'Oi, vi o anúncio')] });
 const r = await capturarConversas(s.pool, s.opcoes);
 assert.deepEqual(r, { instancias: 1, mensagens: 2, leads: 2, turnos: 2, erros: 0 }, 'as 2 mensagens são registradas; o fake de registro devolve "sem lead" nas duas, então cria nas duas (o intake real deduplica pela origem)');
 assert.deepEqual(s.registros.map(m => [m.id, m.texto, m.numero, m.instancia, m.nome]), [['M1', 'Oi, vi o anúncio', '5531997590001', 'teste', 'Marina'], ['M2', 'Quanto custa?', '5531997590001', 'teste', 'Marina']], 'da mais antiga para a mais nova');
 assert.equal(s.leads[0].productId, 'sites');
 assert.equal(s.leads[0].body.attribution.utm_tzolkin, 'sites.padrao');
 assert.equal(s.leads[0].body.lead.message, 'Oi, vi o anúncio', 'a mensagem que abriu a conversa vai para o lead');
 assert.match(s.leads[0].key, /^[0-9a-f-]{36}$/);
 assert.ok(s.sql.some(q => /UPDATE whatsapp_inbox SET lead_id=\$1, product_id=\$2 WHERE id=\$3/.test(q.sql) && q.p[0] === 'lead-novo' && q.p[1] === 'sites' && q.p[2] === 'in1'));
 assert.deepEqual(s.turnos[0], { instancia: 'teste', numero: '5531997590001', inboxId: 'in1', env: { EVOLUTION_INSTANCE: 'teste' } });
 assert.deepEqual(s.pagou, ['sites', 'sites'], 'o aviso de lead novo roda depois do commit');
 const marca = s.sql.find(q => /UPDATE whatsapp_instance_funnels SET last_scan_at/.test(q.sql));
 assert.deepEqual(marca.p, ['teste', new Date(T - 60000).toISOString()], 'a marca de leitura avança com 1 min de folga');
 assert.deepEqual(s.consultas[0].q, { where: { key: { remoteJid: PESSOA } }, page: 1, offset: 10 });
});

test('telefone que já é lead: não cria outro; a mensagem repetida (o webhook já guardou) não faz nada; mídia e "sair" não acordam o agente', async () => {
 const conhecido = montar({ chats: [chat(PESSOA, ts(-1))], mensagens: [msg('M1', ts(-1), 'oi')], registrarPor: () => ({ novo: true, lead: 'lead-antigo', saiu: false, inboxId: 'in1' }) });
 const r1 = await capturarConversas(conhecido.pool, conhecido.opcoes);
 assert.deepEqual([r1.mensagens, r1.leads, r1.turnos], [1, 0, 1]);
 assert.equal(conhecido.leads.length, 0);
 const repetida = montar({ chats: [chat(PESSOA, ts(-1))], mensagens: [msg('M1', ts(-1), 'oi')], registrarPor: () => ({ novo: false, lead: null, saiu: false, inboxId: null }) });
 const r2 = await capturarConversas(repetida.pool, repetida.opcoes);
 assert.deepEqual([r2.mensagens, r2.leads, r2.turnos], [0, 0, 0]);
 const midia = montar({ chats: [chat(PESSOA, ts(-1))], mensagens: [{ id: 'M9', fromMe: false, timestamp: ts(-1), messageType: 'imageMessage', message: { imageMessage: {} } }] });
 const r3 = await capturarConversas(midia.pool, midia.opcoes);
 assert.deepEqual([r3.mensagens, r3.leads, r3.turnos], [1, 1, 0], 'imagem vira lead mas não aciona o agente');
 assert.equal(midia.registros[0].texto, '[imagem]'); assert.equal(midia.registros[0].midia, true);
 const sair = montar({ chats: [chat(PESSOA, ts(-1))], mensagens: [msg('M1', ts(-1), 'sair')], registrarPor: () => ({ novo: true, lead: 'l', saiu: true, inboxId: 'in1' }) });
 assert.equal((await capturarConversas(sair.pool, sair.opcoes)).turnos, 0, 'quem pediu para sair não é respondido pelo agente');
});

test('ignora o que não é novo e de uma pessoa: nossa última mensagem, anterior à marca, grupo, status, contato sem telefone; só pede o histórico das conversas candidatas', async () => {
 const s = montar({ chats: [chat(PESSOA, ts(-1), { minha: true }), chat('5511988880002@s.whatsapp.net', ts(-20)), chat('120363000000@g.us', ts(-1)), chat('status@broadcast', ts(-1)), chat(LID, ts(-1))], mensagens: [msg('M1', ts(-1), 'oi')] });
 const r = await capturarConversas(s.pool, s.opcoes);
 assert.deepEqual([r.mensagens, r.leads, r.turnos], [0, 0, 0]);
 assert.equal(s.consultas, undefined, 'nenhum histórico foi pedido');
 assert.ok(s.sql.some(q => /UPDATE whatsapp_instance_funnels SET last_scan_at/.test(q.sql)), 'mesmo sem novidade a marca avança');
 const lid = montar({ chats: [chat(LID, ts(-1), { alt: PESSOA })], mensagens: [msg('M1', ts(-1), 'oi')] });
 assert.equal((await capturarConversas(lid.pool, lid.opcoes)).leads, 1, 'o @lid resolve o telefone pelo remoteJidAlt');
 assert.equal(lid.registros[0].numero, '5531997590001');
});

test('só entra mensagem DELA e posterior à marca; o histórico de antes de conectar não é importado', async () => {
 const s = montar({ chats: [chat(PESSOA, ts(-1))], mensagens: [msg('NOVA', ts(-1), 'oi'), msg('ANTIGA', ts(-30), 'mensagem de antes'), { ...msg('NOSSA', ts(-1), 'resposta nossa'), fromMe: true }, { id: 'SEMHORA', fromMe: false, timestamp: null, messageType: 'conversation', message: { conversation: 'x' } }] });
 await capturarConversas(s.pool, s.opcoes);
 assert.deepEqual(s.registros.map(m => m.id), ['NOVA']);
});

test('no máximo 10 conversas por ciclo; Evolution fora do ar e erro em uma instância não derrubam o ciclo nem as outras', async () => {
 const muitas = Array.from({ length: 15 }, (_, i) => chat(`55319975900${String(10 + i).padStart(2, '0')}@s.whatsapp.net`, ts(-1)));
 const a = montar({ chats: muitas, mensagens: [msg('M1', ts(-1), 'oi')] });
 await capturarConversas(a.pool, a.opcoes);
 assert.equal(a.consultas.length, 10);
 const fora = montar({ chats: [chat(PESSOA, ts(-1))], findChatsOk: false });
 assert.deepEqual(await capturarConversas(fora.pool, fora.opcoes), { instancias: 1, mensagens: 0, leads: 0, turnos: 0, erros: 0 });
 assert.equal(fora.sql.some(q => /UPDATE whatsapp_instance_funnels/.test(q.sql)), false, 'sem conseguir ler, a marca NÃO avança (nada se perde)');
 const duas = montar({ ligacoes: [LIGACAO, { ...LIGACAO, instance: 'outra' }], chats: [chat(PESSOA, ts(-1))], mensagens: [msg('M1', ts(-1), 'oi')], erroNaPrimeira: true });
 const silencio = console.error; console.error = () => {};
 try { const r = await capturarConversas(duas.pool, duas.opcoes); assert.deepEqual([r.erros, r.instancias, r.mensagens], [1, 1, 1]); } finally { console.error = silencio; }
 const semTabela = montar({ semTabela: true });
 assert.equal((await capturarConversas(semTabela.pool, semTabela.opcoes)).indisponivel, true, 'sem a migração 071 diz indisponível');
});

// ---------- conexões ----------
function clienteDeConexao({ funil = { id: FUNIL, space_id: 'sites' }, semTabela = false } = {}) {
 const sql = [];
 return { sql, async query(texto, p) { sql.push({ texto, p }); if (/FROM pipelines WHERE id/.test(texto)) return { rows: funil ? [funil] : [] };
  if (/INSERT INTO whatsapp_instance_funnels/.test(texto)) { if (semTabela) throw Object.assign(new Error('x'), { code: '42P01' }); return { rows: [] }; } return { rows: [] }; } };
}
test('salvarConexao: conecta a instância ao funil, religar não importa o que chegou enquanto estava desligada, e valida tudo', async () => {
 const c = clienteDeConexao();
 assert.deepEqual(await salvarConexao(c, { instance: 'teste', pipeline_id: FUNIL, create_leads: true, por: 'eu@x.co' }), { ok: true, instance: 'teste', space_id: 'sites', pipeline_id: FUNIL, create_leads: true });
 const ins = c.sql.find(q => /INSERT INTO whatsapp_instance_funnels/.test(q.texto));
 assert.deepEqual(ins.p, ['teste', 'sites', FUNIL, true, 'eu@x.co']);
 assert.match(ins.texto, /CASE WHEN whatsapp_instance_funnels\.create_leads = false AND EXCLUDED\.create_leads THEN now\(\)/);
 assert.equal((await salvarConexao(clienteDeConexao(), { instance: 'teste', pipeline_id: FUNIL, create_leads: false })).create_leads, false, 'desligar é create_leads=false (a role não apaga)');
 for (const [ruim, re] of [[{ instance: 'nome ruim!', pipeline_id: FUNIL }, /Instância inválida/], [{ instance: '', pipeline_id: FUNIL }, /Instância inválida/], [{ instance: 'teste', pipeline_id: 'x' }, /Escolha o funil/], [{ instance: 'teste', pipeline_id: FUNIL, create_leads: 'sim' }, /Valor inválido/]])
  await assert.rejects(salvarConexao(clienteDeConexao(), ruim), e => e.status === 400 && re.test(e.message));
 await assert.rejects(salvarConexao(clienteDeConexao({ funil: null }), { instance: 'teste', pipeline_id: FUNIL }), e => e.status === 400 && /não existe ou está arquivado/.test(e.message));
 await assert.rejects(salvarConexao(clienteDeConexao({ semTabela: true }), { instance: 'teste', pipeline_id: FUNIL }), e => e.status === 409 && e.message === MENSAGEM_071);
});

test('listarConexoes: devolve conexões e funis; sem a migração 071 avisa e ainda lista os funis', async () => {
 const pool = { async query(t) { if (/FROM pipelines p JOIN products/.test(t)) return { rows: [{ id: FUNIL, name: 'Funil padrão', slug: 'padrao', space_id: 'sites', space_name: 'Sites' }] };
  if (/FROM whatsapp_instance_funnels/.test(t)) return { rows: [{ instance: 'teste', space_id: 'sites', space_name: 'Sites', pipeline_id: FUNIL, pipeline_name: 'Funil padrão', create_leads: true }] }; return { rows: [] }; } };
 const r = await listarConexoes(pool);
 assert.deepEqual([r.disponivel, r.conexoes.length, r.funis.length], [true, 1, 1]);
 const sem = await listarConexoes({ async query(t) { if (/whatsapp_instance_funnels/.test(t)) throw Object.assign(new Error('x'), { code: '42P01' }); return { rows: [{ id: FUNIL, name: 'F', slug: 'padrao', space_id: 'sites', space_name: 'Sites' }] }; } });
 assert.deepEqual([sem.disponivel, sem.conexoes, sem.funis.length, sem.aviso], [false, [], 1, MENSAGEM_071]);
});

// ---------- gatilho dentro do fluxo ----------
test('validarGatilho: só eventos de lead; etapa exige funil; ausente é nulo', () => {
 assert.equal(validarGatilho(undefined), null); assert.equal(validarGatilho(''), null); assert.equal(validarGatilho(null), null);
 assert.deepEqual(validarGatilho({ event: 'lead.criado' }), { event: 'lead.criado', pipeline_id: null, stage_id: null });
 assert.deepEqual(validarGatilho({ event: 'lead.mudou_de_etapa', pipeline_id: FUNIL, stage_id: ETAPA }), { event: 'lead.mudou_de_etapa', pipeline_id: FUNIL, stage_id: ETAPA });
 for (const ruim of [{ event: 'oportunidade.ganha' }, { event: 'fluxo.respondeu' }, {}, { event: 'lead.criado', stage_id: ETAPA }, { event: 'lead.criado', pipeline_id: 'x' }, { event: 'lead.criado', extra: 1 }, 'lead.criado', []])
  assert.throws(() => validarGatilho(ruim), e => e.status === 400, JSON.stringify(ruim));
});

function clienteDeFluxo({ antigo = null, funilDoEspaco = 'sites' } = {}) {
 const s = { sql: [], automacoes: [] };
 s.client = { async query(texto, p = []) {
  s.sql.push({ texto, p });
  if (/FROM products WHERE lifecycle_status/.test(texto)) return { rows: [{ id: 'sites', name: 'Sites' }] };
  if (/^\s*INSERT INTO whatsapp_flows/.test(texto)) return { rows: [{ id: FLUXO }] };
  if (/FROM whatsapp_flows WHERE id=\$1 FOR UPDATE/.test(texto)) return { rows: antigo ? [antigo] : [] };
  if (/FROM pipelines WHERE id=\$1 AND is_active/.test(texto)) return { rows: funilDoEspaco ? [{ space_id: funilDoEspaco }] : [] };
  if (/FROM pipeline_stages WHERE id=\$1 AND pipeline_id=\$2/.test(texto)) return { rowCount: 1, rows: [{}] };
  if (/^\s*INSERT INTO automations/.test(texto)) { s.automacoes.push({ op: 'insert', p }); return { rows: [{ id: AUTO }] }; }
  if (/^\s*UPDATE automations/.test(texto)) { s.automacoes.push({ op: 'update', texto, p }); return { rows: [] }; }
  return { rows: [] };
 } };
 return s;
}
const corpoFluxo = (extra = {}) => ({ space_id: 'sites', name: 'Boas-vindas', status: 'ativo', steps: [{ tipo: 'mensagem', texto: 'Oi, {{first_name}}!' }], ...extra });

test('fluxo com gatilho: cria o fluxo e a automação por trás (ligada se ativo), e guarda o vínculo', async () => {
 const s = clienteDeFluxo();
 const r = await salvarFluxo(s.client, { body: corpoFluxo({ gatilho: { event: 'lead.criado', pipeline_id: FUNIL } }), por: 'eu@x.co' });
 assert.deepEqual(r, { id: FLUXO });
 const a = s.automacoes[0];
 assert.equal(a.op, 'insert');
 assert.deepEqual(a.p.slice(0, 5), ['sites', FUNIL, null, 'Fluxo: Boas-vindas', 'lead.criado']);
 assert.deepEqual(JSON.parse(a.p[5]), [{ action: 'fluxo.iniciar', flow_id: FLUXO, dados: {} }]);
 assert.equal(a.p[6], true);
 assert.ok(s.sql.some(q => /UPDATE whatsapp_flows SET automation_id=\$2 WHERE id=\$1/.test(q.texto) && q.p[1] === AUTO));
 const rascunho = clienteDeFluxo();
 await salvarFluxo(rascunho.client, { body: corpoFluxo({ status: 'rascunho', gatilho: { event: 'lead.criado' } }) });
 assert.equal(rascunho.automacoes[0].p[6], false, 'fluxo em rascunho não liga a automação');
 const teste = clienteDeFluxo();
 await salvarFluxo(teste.client, { body: corpoFluxo({ status: 'teste', gatilho: { event: 'lead.criado' } }) });
 assert.equal(teste.automacoes[0].p[6], true, 'em teste a automação liga (o fluxo roda sem enviar)');
});

test('fluxo sem gatilho não cria automação; editar atualiza a mesma automação; tirar o gatilho a desliga', async () => {
 const sem = clienteDeFluxo();
 await salvarFluxo(sem.client, { body: corpoFluxo() });
 assert.equal(sem.automacoes.length, 0);
 const antigo = { id: FLUXO, space_id: 'sites', version: 2, automation_id: AUTO };
 const edita = clienteDeFluxo({ antigo });
 await salvarFluxo(edita.client, { id: FLUXO, body: corpoFluxo({ version: 2, name: 'Novo nome', gatilho: { event: 'lead.qualificado', pipeline_id: FUNIL } }) });
 assert.equal(edita.automacoes[0].op, 'update');
 assert.equal(edita.automacoes[0].p[0], AUTO);
 assert.equal(edita.automacoes[0].p[1], 'Fluxo: Novo nome');
 assert.equal(edita.automacoes[0].p[2], 'lead.qualificado');
 const tira = clienteDeFluxo({ antigo });
 await salvarFluxo(tira.client, { id: FLUXO, body: corpoFluxo({ version: 2 }) });
 assert.match(tira.automacoes[0].texto, /SET is_enabled=false/);
 assert.equal(tira.automacoes[0].p[0], AUTO);
});

test('gatilho: funil de outro espaço ou arquivado é recusado; versão antiga é conflito; espaço não muda', async () => {
 await assert.rejects(salvarFluxo(clienteDeFluxo({ funilDoEspaco: 'outro' }).client, { body: corpoFluxo({ gatilho: { event: 'lead.criado', pipeline_id: FUNIL } }) }), e => e.status === 400 && /não é deste espaço/.test(e.message));
 await assert.rejects(salvarFluxo(clienteDeFluxo({ funilDoEspaco: null }).client, { body: corpoFluxo({ gatilho: { event: 'lead.criado', pipeline_id: FUNIL } }) }), e => e.status === 400);
 const antigo = { id: FLUXO, space_id: 'sites', version: 2, automation_id: null };
 await assert.rejects(salvarFluxo(clienteDeFluxo({ antigo }).client, { id: FLUXO, body: corpoFluxo({ version: 1 }) }), e => e.status === 409);
 await assert.rejects(salvarFluxo(clienteDeFluxo({ antigo }).client, { id: FLUXO, body: corpoFluxo({ version: 2, space_id: 'educare' }) }), e => e.status === 400 && /não muda/.test(e.message));
 await assert.rejects(salvarFluxo(clienteDeFluxo().client, { id: FLUXO, body: corpoFluxo({ version: 1 }) }), e => e.status === 404);
});
