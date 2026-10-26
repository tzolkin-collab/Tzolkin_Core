import test from 'node:test';
import assert from 'node:assert/strict';
import { descreverMensagem, telefoneDaConversa, ehConversaDePessoa, montarConversa, montarMensagem, whatsappChatRoutes } from '../../apps/api/src/modules/whatsapp-chat.mjs';

const PESSOA = '5531997599216@s.whatsapp.net';
const LID = '123456789012345@lid';

test('descreverMensagem: texto, legenda e rótulo de cada tipo; o que não é conversa vira null', () => {
 assert.deepEqual(descreverMensagem({ conversation: ' oi ' }), { texto: 'oi', midia: false });
 assert.deepEqual(descreverMensagem({ extendedTextMessage: { text: 'com link' } }), { texto: 'com link', midia: false });
 assert.deepEqual(descreverMensagem({ imageMessage: { caption: 'comprovante' } }), { texto: 'comprovante', midia: true });
 assert.deepEqual(descreverMensagem({ imageMessage: {} }), { texto: '[imagem]', midia: true });
 assert.deepEqual(descreverMensagem({ videoMessage: {} }), { texto: '[vídeo]', midia: true });
 assert.deepEqual(descreverMensagem({ audioMessage: { ptt: true } }), { texto: '[mensagem de voz]', midia: true });
 assert.deepEqual(descreverMensagem({ audioMessage: {} }), { texto: '[áudio]', midia: true });
 assert.deepEqual(descreverMensagem({ documentMessage: { fileName: 'proposta.pdf' } }), { texto: 'proposta.pdf', midia: true });
 assert.deepEqual(descreverMensagem({ stickerMessage: {} }), { texto: '[figurinha]', midia: true });
 assert.equal(descreverMensagem({ locationMessage: {} }).texto, '[localização]');
 assert.equal(descreverMensagem({ contactMessage: {} }).texto, '[contato]');
 assert.equal(descreverMensagem({ reactionMessage: { text: '👍' } }).texto, 'reagiu com 👍');
 assert.equal(descreverMensagem({ reactionMessage: { text: '' } }), null, 'reação removida não é mensagem');
 assert.equal(descreverMensagem({ pollCreationMessage: { name: 'Qual horário?' } }).texto, '[enquete] Qual horário?');
 assert.equal(descreverMensagem({ listResponseMessage: { title: 'Plano Pro' } }).texto, 'Plano Pro');
 assert.equal(descreverMensagem({ ephemeralMessage: { message: { conversation: 'some em 24h' } } }).texto, 'some em 24h', 'mensagem temporária é desembrulhada');
 assert.equal(descreverMensagem({ documentWithCaptionMessage: { message: { documentMessage: { caption: 'contrato' } } } }).texto, 'contrato');
 assert.equal(descreverMensagem({ protocolMessage: { type: 0 } }), null, 'apagar mensagem não é conteúdo');
 assert.equal(descreverMensagem({ conversation: 'oi', messageContextInfo: { threadId: [] } }).texto, 'oi', 'os metadados que acompanham o texto não atrapalham');
 assert.equal(descreverMensagem({ algoNovoMessage: {} }, 'algoNovoMessage').texto, '[algoNovo]', 'tipo desconhecido não some nem quebra');
 assert.equal(descreverMensagem({ placeholderMessage: { type: 0 } }, 'placeholderMessage').texto, '[mensagem indisponível]');
 assert.equal(descreverMensagem(null, null), null);
 assert.equal(descreverMensagem({}, 'conversation').texto, '[conversation]');
});

test('telefone da conversa: do endereço, do remoteJidAlt quando é @lid, e conversa de grupo/status/canal fica de fora', () => {
 assert.equal(telefoneDaConversa(PESSOA), '5531997599216');
 assert.equal(telefoneDaConversa(LID, PESSOA), '5531997599216', 'o @lid usa o telefone do remoteJidAlt');
 assert.equal(telefoneDaConversa(LID), null);
 assert.equal(telefoneDaConversa(LID, 'lixo@g.us'), null);
 for (const fora of ['120363000000@g.us', 'status@broadcast', '1203@newsletter', '', null, undefined]) assert.equal(ehConversaDePessoa(fora), false, String(fora));
 assert.equal(ehConversaDePessoa(PESSOA), true);
 assert.equal(ehConversaDePessoa(LID), true);
});

test('montarConversa: nome da pessoa (nunca o nosso perfil), horário da última mensagem, vínculo com o lead e @lid sem telefone', () => {
 const ts = 1793000000;
 const delaEscreveu = { remoteJid: PESSOA, pushName: null, profilePicUrl: 'https://pps.exemplo.com/a.jpg', unreadCount: null, updatedAt: '2026-10-20T10:00:00.000Z',
  lastMessage: { pushName: 'Marina', key: { fromMe: false, remoteJid: PESSOA }, message: { conversation: 'Quero saber mais' }, messageType: 'conversation', messageTimestamp: ts } };
 const c = montarConversa(delaEscreveu, { id: 'lead-1', name: 'Marina Duarte' });
 assert.deepEqual({ ...c }, { jid: PESSOA, number: '5531997599216', name: 'Marina', lead_id: 'lead-1', lead_name: 'Marina Duarte', foto: 'https://pps.exemplo.com/a.jpg',
  last_at: new Date(ts * 1000).toISOString(), last_text: 'Quero saber mais', last_from_me: false, unread: 0, sem_telefone: false });
 const nossa = montarConversa({ ...delaEscreveu, lastMessage: { ...delaEscreveu.lastMessage, pushName: 'TZOLKIN', key: { fromMe: true, remoteJid: PESSOA } } });
 assert.equal(nossa.name, null, 'o pushName da mensagem nossa é o nosso perfil');
 assert.equal(nossa.last_from_me, true);
 const lid = montarConversa({ remoteJid: LID, lastMessage: { key: { fromMe: false, remoteJid: LID, remoteJidAlt: PESSOA }, message: { conversation: 'oi' }, messageTimestamp: ts } });
 assert.equal(lid.number, '5531997599216');
 assert.equal(montarConversa({ remoteJid: LID, lastMessage: { key: {}, message: { conversation: 'oi' }, messageTimestamp: ts } }).sem_telefone, true);
 assert.equal(montarConversa({ remoteJid: PESSOA, profilePicUrl: 'http://inseguro.exemplo.com/a.jpg', lastMessage: {} }).foto, null, 'só foto https');
 assert.equal(montarConversa({ remoteJid: PESSOA, updatedAt: '2026-10-20T10:00:00.000Z', lastMessage: {} }).last_at, '2026-10-20T10:00:00.000Z', 'sem horário na mensagem, usa o do chat');
});

test('montarMensagem: direção, horário e status só nas nossas; mensagem sem conteúdo some', () => {
 const entrada = montarMensagem({ id: 'm1', fromMe: false, messageType: 'conversation', message: { conversation: 'oi' }, timestamp: 1793000000, status: 'DELIVERY_ACK' });
 assert.deepEqual(entrada, { id: 'm1', direcao: 'in', texto: 'oi', midia: false, tipo: 'conversation', em: new Date(1793000000 * 1000).toISOString(), status: null });
 assert.equal(montarMensagem({ id: 'm2', fromMe: true, messageType: 'conversation', message: { conversation: 'olá' }, timestamp: 1793000100, status: 'READ' }).status, 'READ');
 assert.equal(montarMensagem({ id: 'm3', fromMe: false, messageType: 'protocolMessage', message: { protocolMessage: {} } }), null);
 assert.equal(montarMensagem({ id: 'm4', fromMe: false, message: { conversation: 'x' }, timestamp: null }).em, null);
});

// --- rotas, com Evolution e banco de mentira ---
const chat = (jid, texto, ts, extra = {}) => ({ remoteJid: jid, pushName: null, updatedAt: new Date(ts * 1000).toISOString(), lastMessage: { pushName: 'Pessoa', key: { fromMe: false, remoteJid: jid, ...(extra.alt ? { remoteJidAlt: extra.alt } : {}) }, message: { conversation: texto }, messageType: 'conversation', messageTimestamp: ts } });
function montar({ env = { EVOLUTION_INSTANCE: 'teste' }, chats = [], mensagens = null, configurada = true, falha = null, linhas = {} } = {}) {
 const chamadas = [], sql = [];
 const criarAdaptador = ({ instance }) => ({
  configured: configurada,
  async findChats(q) { chamadas.push({ f: 'findChats', instance, q }); return falha ? { ok: false, reason: falha } : { ok: true, chats }; },
  async findMessages(q) { chamadas.push({ f: 'findMessages', instance, q }); return falha ? { ok: false, reason: falha } : mensagens ?? { ok: true, total: 0, pages: 1, page: q.page, messages: [] }; },
 });
 const pool = { async query(texto, p) { sql.push({ texto, p }); if (/FROM commercial_leads/.test(texto)) return { rows: linhas.leads ?? [] }; if (/FROM whatsapp_outbox/.test(texto)) return { rows: linhas.pendentes ?? [] };
  if (/FROM whatsapp_suppressions/.test(texto)) return { rows: linhas.bloqueado ? [{}] : [] }; if (/FROM ai_handoffs/.test(texto)) return { rows: linhas.comPessoa ? [{}] : [] }; return { rows: [] }; } };
 const rotas = new Map();
 whatsappChatRoutes({ get: (r, f) => rotas.set('GET ' + r, f) }, { env, criarAdaptador });
 const chamar = async (rota, consulta = '') => { let resposta = null; await rotas.get('GET ' + rota)({ pool, url: new URL('https://x.test' + rota + consulta), reply: (status, dados) => { resposta = { status, dados }; } }); return resposta; };
 return { chamar, chamadas, sql };
}

test('rota de conversas: só pessoas, da mais recente para a mais antiga, com lead e telefone; grupo e status ficam de fora', async () => {
 const x = montar({ chats: [chat('120363000000@g.us', 'grupo', 1793000500), chat(PESSOA, 'oi', 1793000100), chat('status@broadcast', 's', 1793000600), chat(LID, 'e eu', 1793000300, { alt: '5511988887777@s.whatsapp.net' })],
  linhas: { leads: [{ k: '97599216', id: 'lead-1', name: 'Marina Duarte' }] } });
 const { status, dados } = await x.chamar('/api/whatsapp/chat/conversas');
 assert.equal(status, 200);
 assert.deepEqual(dados.conversas.map(c => [c.jid, c.number, c.lead_name]), [[LID, '5511988887777', null], [PESSOA, '5531997599216', 'Marina Duarte']]);
 assert.equal(dados.instancia, 'teste');
 assert.deepEqual(x.chamadas[0], { f: 'findChats', instance: 'teste', q: { take: 120 } }, 'pede a mais para compensar os grupos');
 assert.deepEqual(x.sql[0].p[0].sort(), ['88887777', '97599216'], 'o vínculo com o lead usa os últimos 8 dígitos');
});

test('rota de conversas: instância e limite validados; Evolution fora ou sem configurar não vira erro 500', async () => {
 const x = montar({ chats: [chat(PESSOA, 'oi', 1793000100)] });
 await x.chamar('/api/whatsapp/chat/conversas', '?instance=gabi_prod&limite=10');
 assert.equal(x.chamadas[0].instance, 'gabi_prod');
 assert.equal(x.chamadas[0].q.take, 20);
 for (const ruim of ['?instance=nome ruim!', '?limite=0', '?limite=101', '?limite=abc', '?outra=1']) await assert.rejects(montar().chamar('/api/whatsapp/chat/conversas', ruim), e => e.status === 400, ruim);
 const caida = await montar({ falha: 'unavailable' }).chamar('/api/whatsapp/chat/conversas');
 assert.deepEqual(caida.dados, { disponivel: false, conversas: [], nao_lidas: 0, falha: 'A Evolution não respondeu.' });
 assert.equal((await montar({ falha: 'unauthorized' }).chamar('/api/whatsapp/chat/conversas')).dados.falha, 'A Evolution recusou a chave de acesso.');
 assert.equal((await montar({ configurada: false }).chamar('/api/whatsapp/chat/conversas')).dados.disponivel, false);
});

const registro = (id, fromMe, texto, ts, extra = {}) => ({ id, key: { id, fromMe, remoteJid: PESSOA, ...(extra.alt ? { remoteJidAlt: extra.alt } : {}) }, fromMe, messageType: 'conversation', message: { conversation: texto }, timestamp: ts, status: fromMe ? 'READ' : null });

test('rota de mensagens: cada página sai da mais antiga para a mais nova; a Evolution é consultada por página de 40', async () => {
 const x = montar({ mensagens: { ok: true, total: 90, pages: 3, page: 2, messages: [registro('c', false, 'terceira', 300), registro('b', true, 'segunda', 200), registro('a', false, 'primeira', 100)] } });
 const { dados } = await x.chamar('/api/whatsapp/chat/mensagens', `?jid=${encodeURIComponent(PESSOA)}&pagina=2`);
 assert.deepEqual(dados.mensagens.map(m => m.texto), ['primeira', 'segunda', 'terceira']);
 assert.deepEqual(dados.mensagens.map(m => m.direcao), ['in', 'out', 'in']);
 assert.deepEqual({ p: dados.pagina, ps: dados.paginas, t: dados.total, mais: dados.tem_mais_antigas }, { p: 2, ps: 3, t: 90, mais: true });
 assert.deepEqual(x.chamadas[0], { f: 'findMessages', instance: 'teste', q: { where: { key: { remoteJid: PESSOA } }, page: 2, offset: 40 } });
 assert.equal(dados.number, '5531997599216');
});

test('rota de mensagens: o que o Core mandou e ainda não saiu aparece no fim da primeira página, e só nela', async () => {
 const pendente = { id: 'p1', body_text: 'Segue a proposta', status: 'queued', last_error: null, created_at: '2026-10-26T20:00:00Z' };
 const falha = { id: 'p2', body_text: 'Outra', status: 'failed', last_error: 'A Evolution não respondeu.', created_at: '2026-10-26T20:05:00Z' };
 const base = { ok: true, total: 1, pages: 1, page: 1, messages: [registro('a', false, 'oi', 100)] };
 const primeira = (await montar({ mensagens: base, linhas: { pendentes: [pendente, falha] } }).chamar('/api/whatsapp/chat/mensagens', `?jid=${encodeURIComponent(PESSOA)}`)).dados;
 assert.deepEqual(primeira.mensagens.map(m => [m.texto, m.status, m.pendente ?? false]), [['oi', null, false], ['Segue a proposta', 'QUEUED', true], ['Outra', 'FAILED', true]]);
 assert.equal(primeira.mensagens[2].erro, 'A Evolution não respondeu.');
 const x2 = montar({ mensagens: { ...base, page: 2 }, linhas: { pendentes: [pendente] } });
 const segunda = (await x2.chamar('/api/whatsapp/chat/mensagens', `?jid=${encodeURIComponent(PESSOA)}&pagina=2`)).dados;
 assert.equal(segunda.mensagens.some(m => m.pendente), false);
 assert.equal(x2.sql.some(q => /FROM whatsapp_outbox/.test(q.texto)), false, 'nem consulta a fila fora da primeira página');
});

test('rota de mensagens: bloqueio, conversa com pessoa e lead; conversa @lid sem telefone não toca no banco', async () => {
 const x = montar({ mensagens: { ok: true, total: 1, pages: 1, page: 1, messages: [registro('a', false, 'oi', 100)] }, linhas: { bloqueado: true, comPessoa: true, leads: [{ k: '97599216', id: 'lead-1', name: 'Marina' }] } });
 const { dados } = await x.chamar('/api/whatsapp/chat/mensagens', `?jid=${encodeURIComponent(PESSOA)}`);
 assert.deepEqual({ b: dados.bloqueado, p: dados.com_pessoa, l: dados.lead_name }, { b: true, p: true, l: 'Marina' });
 const lid = montar({ mensagens: { ok: true, total: 1, pages: 1, page: 1, messages: [{ ...registro('a', false, 'oi', 100), key: { id: 'a', fromMe: false, remoteJid: LID } }] } });
 const r = (await lid.chamar('/api/whatsapp/chat/mensagens', `?jid=${encodeURIComponent(LID)}`)).dados;
 assert.equal(r.number, null);
 assert.equal(lid.sql.length, 0, 'sem telefone não há o que consultar no banco');
 const comAlt = montar({ mensagens: { ok: true, total: 1, pages: 1, page: 1, messages: [registro('a', false, 'oi', 100, { alt: PESSOA })] } });
 assert.equal((await comAlt.chamar('/api/whatsapp/chat/mensagens', `?jid=${encodeURIComponent(LID)}`)).dados.number, '5531997599216');
});

test('rota de mensagens: conversa de grupo, página e parâmetros inválidos são 400; Evolution fora é 502; sem configurar é 409', async () => {
 const q = j => `?jid=${encodeURIComponent(j)}`;
 for (const ruim of [q('120363000000@g.us'), q('status@broadcast'), '', '?jid=lixo', `${q(PESSOA)}&pagina=0`, `${q(PESSOA)}&pagina=10001`, `${q(PESSOA)}&pagina=x`, `${q(PESSOA)}&instance=ruim!`, `${q(PESSOA)}&outra=1`])
  await assert.rejects(montar().chamar('/api/whatsapp/chat/mensagens', ruim), e => e.status === 400, ruim);
 await assert.rejects(montar({ falha: 'unavailable' }).chamar('/api/whatsapp/chat/mensagens', q(PESSOA)), e => e.status === 502);
 await assert.rejects(montar({ configurada: false }).chamar('/api/whatsapp/chat/mensagens', q(PESSOA)), e => e.status === 409);
});

test('o chat só lê: nenhuma consulta de escrita no banco', async () => {
 const x = montar({ chats: [chat(PESSOA, 'oi', 1793000100)], mensagens: { ok: true, total: 1, pages: 1, page: 1, messages: [registro('a', false, 'oi', 100)] } });
 await x.chamar('/api/whatsapp/chat/conversas');
 await x.chamar('/api/whatsapp/chat/mensagens', `?jid=${encodeURIComponent(PESSOA)}`);
 for (const q of x.sql) assert.equal(/\b(INSERT|UPDATE|DELETE|DROP|ALTER|CREATE)\b/i.test(q.texto), false);
});
