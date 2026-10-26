import test from 'node:test';
import assert from 'node:assert/strict';
import { createEvolutionAdapter } from '../../apps/api/src/integrations/evolution.mjs';

const env = { EVOLUTION_URL: 'https://evo.exemplo.com', EVOLUTION_INSTANCE: 'tzolkin', EVOLUTION_API_KEY: 'chave-secreta-123' };
const resposta = (status, corpo) => ({ ok: status >= 200 && status < 300, status, json: async () => corpo });
const NUMERO = '5531997599216';

/** Adaptador com fetch simulado: guarda as chamadas e responde sempre o mesmo. */
const com = (status, corpo, extra = {}) => {
 const chamadas = [];
 const a = createEvolutionAdapter({ env, ...extra, fetchImpl: async (url, init) => { chamadas.push({ url: new URL(url), init, body: init.body ? JSON.parse(init.body) : undefined }); return resposta(status, corpo); } });
 return { a, chamadas };
};
const semRede = () => { const x = com(200, {}); return x; };

const METODOS = ['listInstances', 'connectionState', 'sendText', 'createInstance', 'connect', 'restart', 'logout', 'deleteInstance', 'setPresence',
 'setWebhook', 'getWebhook', 'sendMedia', 'sendLocation', 'sendPoll', 'checkNumbers', 'findChats', 'findContacts', 'findMessages', 'archiveChat'];

test('adaptador parado: todo método responde not_configured / invalid_config e nenhum chama a rede', async () => {
 let chamou = false;
 const fetchImpl = async () => { chamou = true; };
 const vazio = createEvolutionAdapter({ env: {}, fetchImpl });
 const ruim = createEvolutionAdapter({ env: { ...env, EVOLUTION_URL: 'http://evo.exemplo.com' }, fetchImpl });
 for (const m of METODOS) {
  assert.equal(typeof vazio[m], 'function', m);
  assert.deepEqual(await vazio[m]({}), { ok: false, reason: 'not_configured' }, m);
  assert.deepEqual(await ruim[m]({}), { ok: false, reason: 'invalid_config' }, m);
 }
 assert.equal(chamou, false);
});

test('createInstance: corpo da doc, token da instância e QR; token nunca fica de fora do resultado nem em outro lugar', async () => {
 const { a, chamadas } = com(201, { instance: { instanceName: 'vendas', instanceId: 'id-1', status: 'created' }, hash: 'token-da-instancia', qrcode: { pairingCode: null, code: '2@x', base64: 'data:image/png;base64,AAA', count: 1 } });
 const r = await a.createInstance({ name: 'vendas', number: '(31) 99759-9216' });
 assert.deepEqual(r, { ok: true, instance: { name: 'vendas', id: 'id-1', status: 'created' }, token: 'token-da-instancia', qr: { base64: 'data:image/png;base64,AAA', code: '2@x', pairingCode: null, count: 1 } });
 assert.equal(chamadas[0].init.method, 'POST');
 assert.equal(chamadas[0].url.pathname, '/instance/create');
 assert.deepEqual(chamadas[0].body, { instanceName: 'vendas', qrcode: true, integration: 'WHATSAPP-BAILEYS', number: NUMERO });
 const antigo = await com(201, { instance: { instanceName: 'v' }, hash: { apikey: 'tk' } }).a.createInstance({ name: 'v' });
 assert.equal(antigo.token, 'tk');
 assert.equal(antigo.qr, null);
});

test('createInstance: com webhook leva o webhook no corpo; nome, número e webhook ruins nem chegam à rede', async () => {
 const { a, chamadas } = com(201, { instance: {} });
 await a.createInstance({ name: 'vendas', webhook: { url: 'https://core.exemplo.com/api/webhooks/evolution', events: ['MESSAGES_UPSERT'] } });
 assert.deepEqual(chamadas[0].body.webhook, { enabled: true, url: 'https://core.exemplo.com/api/webhooks/evolution', events: ['MESSAGES_UPSERT'] });
 for (const [entrada, detalhe] of [[{ name: 'nome ruim!' }, 'invalid_name'], [{ name: '' }, 'invalid_name'], [{ name: 'ok', number: '123' }, 'invalid_number'], [{ name: 'ok', webhook: { url: 'http://x.com' } }, 'invalid_webhook']]) {
  const x = semRede();
  assert.deepEqual(await x.a.createInstance(entrada), { ok: false, reason: 'rejected', detail: detalhe });
  assert.equal(x.chamadas.length, 0);
 }
});

test('createInstance: nome já usado (403 com a mensagem da Evolution) vira conflict, e 403 sem isso continua unauthorized', async () => {
 const usado = await com(403, { error: { message: 'This name "vendas" is already in use.' } }).a.createInstance({ name: 'vendas' });
 assert.equal(usado.reason, 'conflict');
 const usadoV2 = await com(403, { response: { message: ['This name "vendas" is already in use.'] } }).a.createInstance({ name: 'vendas' });
 assert.equal(usadoV2.reason, 'conflict');
 assert.equal((await com(403, { error: { message: 'Forbidden' } }).a.createInstance({ name: 'vendas' })).reason, 'unauthorized');
});

test('connect devolve o QR; instância já conectada (só count) devolve qr nulo', async () => {
 const { a, chamadas } = com(200, { pairingCode: '1234ABCD', code: '2@x', base64: 'data:image/png;base64,BBB', count: 2 });
 assert.deepEqual(await a.connect(), { ok: true, qr: { base64: 'data:image/png;base64,BBB', code: '2@x', pairingCode: '1234ABCD', count: 2 } });
 assert.equal(chamadas[0].init.method, 'GET');
 assert.equal(chamadas[0].url.pathname, '/instance/connect/tzolkin');
 assert.deepEqual(await com(200, { count: 0 }).a.connect({ instance: 'outra' }), { ok: true, qr: null });
});

test('restart, logout e delete: método e caminho da doc, instância escolhida na chamada, e falha do servidor vira motivo', async () => {
 const casos = [['restart', 'POST', '/instance/restart/', { error: false, message: 'ok' }], ['logout', 'DELETE', '/instance/logout/', { success: true }], ['deleteInstance', 'DELETE', '/instance/delete/', { success: true }]];
 for (const [metodo, http, caminho, corpo] of casos) {
  const { a, chamadas } = com(200, corpo);
  assert.deepEqual(await a[metodo](), { ok: true }, metodo);
  assert.equal(chamadas[0].init.method, http, metodo);
  assert.equal(chamadas[0].url.pathname, `${caminho}tzolkin`, metodo);
  await a[metodo]({ instance: 'suporte' });
  assert.equal(chamadas[1].url.pathname, `${caminho}suporte`, metodo);
  assert.equal((await com(404, {}).a[metodo]()).reason, 'not_found', metodo);
  const x = semRede();
  assert.deepEqual(await x.a[metodo]({ instance: 'nome ruim!' }), { ok: false, reason: 'invalid_config' }, metodo);
  assert.equal(x.chamadas.length, 0, metodo);
 }
 assert.deepEqual(await com(200, { error: true, message: 'x' }).a.restart(), { ok: false, reason: 'rejected' });
 assert.deepEqual(await com(200, { success: false }).a.deleteInstance(), { ok: false, reason: 'rejected' });
});

test('setPresence só aceita os quatro valores da doc', async () => {
 const { a, chamadas } = com(200, { success: true, message: 'ok' });
 assert.deepEqual(await a.setPresence({ presence: 'composing' }), { ok: true });
 assert.equal(chamadas[0].url.pathname, '/instance/setPresence/tzolkin');
 assert.deepEqual(chamadas[0].body, { presence: 'composing' });
 for (const ruim of ['typing', '', undefined, 1]) assert.deepEqual(await semRede().a.setPresence({ presence: ruim }), { ok: false, reason: 'rejected', detail: 'invalid_presence' });
});

test('setWebhook: corpo aninhado em "webhook" (exigido pela 2.3.7), segredo no cabeçalho; url http, evento minúsculo e cabeçalho com quebra de linha são recusados sem rede', async () => {
 const { a, chamadas } = com(200, { success: true, message: 'Webhook configured successfully' });
 const r = await a.setWebhook({ url: 'https://core.exemplo.com/api/webhooks/evolution', headers: { 'x-webhook-secret': 'segredo-longo-e-aleatorio' } });
 assert.deepEqual(r, { ok: true });
 assert.equal(chamadas[0].init.method, 'POST');
 assert.equal(chamadas[0].url.pathname, '/webhook/set/tzolkin');
 assert.deepEqual(chamadas[0].body, { webhook: { enabled: true, url: 'https://core.exemplo.com/api/webhooks/evolution', events: ['MESSAGES_UPSERT'], byEvents: false, base64: false, headers: { 'x-webhook-secret': 'segredo-longo-e-aleatorio' } } });
 assert.deepEqual(Object.keys(chamadas[0].body), ['webhook'], 'o servidor 2.3.7 exige o corpo aninhado em "webhook" (confirmado com a Evolution real; a doc mostra o plano)');
 for (const ruim of [{ url: 'http://core.exemplo.com/x' }, { url: 'https://u:p@core.exemplo.com/x' }, { url: 'não é url' }, { url: 'https://core.exemplo.com/x', events: ['messages_upsert'] },
  { url: 'https://core.exemplo.com/x', events: [] }, { url: 'https://core.exemplo.com/x', headers: { 'x-a': 'a\nb' } }, { url: 'https://core.exemplo.com/x', headers: { 'x a': 'v' } }]) {
  const x = semRede();
  assert.deepEqual(await x.a.setWebhook(ruim), { ok: false, reason: 'rejected', detail: 'invalid_webhook' });
  assert.equal(x.chamadas.length, 0);
 }
});

test('getWebhook: sem webhook devolve null; com webhook devolve só os NOMES dos cabeçalhos, nunca o segredo', async () => {
 const sem = com(200, null);
 assert.deepEqual(await sem.a.getWebhook(), { ok: true, webhook: null });
 assert.equal(sem.chamadas[0].init.method, 'GET');
 assert.equal(sem.chamadas[0].url.pathname, '/webhook/find/tzolkin');
 const com1 = await com(200, { enabled: true, url: 'https://core.exemplo.com/x', events: ['MESSAGES_UPSERT'], headers: { 'x-webhook-secret': 'segredo-que-nao-pode-sair' } }).a.getWebhook();
 assert.deepEqual(com1.webhook, { enabled: true, url: 'https://core.exemplo.com/x', events: ['MESSAGES_UPSERT'], headerNames: ['x-webhook-secret'] });
 assert.equal(JSON.stringify(com1).includes('segredo-que-nao-pode-sair'), false);
 assert.equal((await com(404, {}).a.getWebhook()).reason, 'not_found');
});

test('sendMedia: corpo certo para URL e para base64, devolve o id, e valida tudo antes da rede', async () => {
 const { a, chamadas } = com(201, { key: { id: 'M1' }, status: 'PENDING' });
 const r = await a.sendMedia({ number: '(31) 99759-9216', mediatype: 'image', media: 'https://cdn.exemplo.com/a.png', caption: 'Olá', fileName: 'a.png', mimetype: 'image/png' });
 assert.deepEqual(r, { ok: true, messageId: 'M1', status: 'PENDING' });
 assert.equal(chamadas[0].url.pathname, '/message/sendMedia/tzolkin');
 assert.deepEqual(chamadas[0].body, { number: NUMERO, mediatype: 'image', media: 'https://cdn.exemplo.com/a.png', mimetype: 'image/png', caption: 'Olá', fileName: 'a.png' });
 assert.equal((await a.sendMedia({ number: NUMERO, mediatype: 'document', media: 'data:application/pdf;base64,JVBERi0xLjQ=' })).ok, true);
 assert.equal((await a.sendMedia({ number: NUMERO, mediatype: 'audio', media: 'JVBERi0xLjQ=' })).ok, true);
 const base = { number: NUMERO, mediatype: 'image', media: 'https://cdn.exemplo.com/a.png' };
 const ruins = [[{ number: '123' }, 'invalid_number'], [{ mediatype: 'gif' }, 'invalid_media_type'], [{ media: 'http://cdn.exemplo.com/a.png' }, 'invalid_media'], [{ media: 'não é base64!' }, 'invalid_media'],
  [{ media: 'https://u:p@cdn.exemplo.com/a.png' }, 'invalid_media'], [{ media: '' }, 'invalid_media'], [{ caption: 'x'.repeat(1025) }, 'invalid_text'], [{ fileName: '../a.png' }, 'invalid_file_name'], [{ mimetype: 'image' }, 'invalid_mimetype']];
 for (const [troca, detalhe] of ruins) {
  const x = semRede();
  assert.deepEqual(await x.a.sendMedia({ ...base, ...troca }), { ok: false, reason: 'rejected', detail: detalhe }, detalhe);
  assert.equal(x.chamadas.length, 0, detalhe);
 }
 assert.equal((await com(200, { status: 'x' }).a.sendMedia(base)).reason, 'invalid');
});

test('sendLocation e sendPoll: corpo da doc e validação', async () => {
 const loc = com(201, { key: { id: 'L1' } });
 assert.equal((await loc.a.sendLocation({ number: NUMERO, latitude: -19.92, longitude: -43.94, name: 'Escritório', address: 'Belo Horizonte' })).messageId, 'L1');
 assert.equal(loc.chamadas[0].url.pathname, '/message/sendLocation/tzolkin');
 assert.deepEqual(loc.chamadas[0].body, { number: NUMERO, latitude: -19.92, longitude: -43.94, name: 'Escritório', address: 'Belo Horizonte' });
 for (const ruim of [{ latitude: 91, longitude: 0 }, { latitude: '1', longitude: 0 }, { latitude: 0, longitude: NaN }, { latitude: 0, longitude: 181 }])
  assert.equal((await semRede().a.sendLocation({ number: NUMERO, ...ruim })).detail, 'invalid_location');
 const poll = com(201, { key: { id: 'P1' } });
 assert.equal((await poll.a.sendPoll({ number: NUMERO, name: 'Qual horário?', values: ['9h', '14h'] })).messageId, 'P1');
 assert.equal(poll.chamadas[0].url.pathname, '/message/sendPoll/tzolkin');
 assert.deepEqual(poll.chamadas[0].body, { number: NUMERO, name: 'Qual horário?', selectableCount: 1, values: ['9h', '14h'] });
 for (const ruim of [{ values: ['só uma'] }, { values: ['a', ''] }, { values: ['a', 'b'], selectableCount: 3 }, { values: ['a', 'b'], selectableCount: 0 }, { name: '' }, { values: Array(13).fill('x') }])
  assert.equal((await semRede().a.sendPoll({ number: NUMERO, name: 'Pergunta', values: ['a', 'b'], ...ruim })).ok, false);
});

test('checkNumbers: normaliza, deduplica, só manda os válidos e devolve exists por número; nenhum válido não vai à rede', async () => {
 const { a, chamadas } = com(200, { numbers: [{ number: NUMERO, exists: true }, { number: '5511988887777', exists: false }] });
 const r = await a.checkNumbers({ numbers: ['(31) 99759-9216', '31997599216', '11988887777', 'lixo'] });
 assert.deepEqual(chamadas[0].body, { numbers: [NUMERO, '5511988887777'] });
 assert.equal(chamadas[0].url.pathname, '/chat/whatsappNumbers/tzolkin');
 assert.deepEqual(r.numbers.map(n => [n.number, n.exists]), [[NUMERO, true], [NUMERO, true], ['5511988887777', false], [null, false]]);
 const x = semRede();
 assert.deepEqual((await x.a.checkNumbers({ numbers: ['lixo', '123'] })).numbers.map(n => n.exists), [false, false]);
 assert.equal(x.chamadas.length, 0);
 for (const ruim of [[], 'x', Array(51).fill(NUMERO), undefined]) assert.equal((await semRede().a.checkNumbers({ numbers: ruim })).detail, 'invalid_numbers');
 assert.equal((await com(200, { numbers: 'x' }).a.checkNumbers({ numbers: [NUMERO] })).reason, 'invalid');
});

test('findChats, findContacts e findMessages: consulta com limites, caminho da doc e resposta normalizada', async () => {
 const chats = com(200, [{ id: 'c1', remoteJid: '5531997599216@s.whatsapp.net', unreadMessages: 2 }, 'lixo', null]);
 const rc = await chats.a.findChats({ where: { x: 1 }, take: 20 });
 assert.deepEqual(rc, { ok: true, chats: [{ id: 'c1', remoteJid: '5531997599216@s.whatsapp.net', unreadMessages: 2 }] });
 assert.equal(chats.chamadas[0].url.pathname, '/chat/findChats/tzolkin');
 assert.deepEqual(chats.chamadas[0].body, { where: { x: 1 }, take: 20, skip: 0 });

 const contatos = com(200, [{ id: 'k1', pushName: 'Marina', number: NUMERO, profilePictureUrl: null, extra: 'x' }]);
 assert.deepEqual((await contatos.a.findContacts()).contacts, [{ id: 'k1', pushName: 'Marina', number: NUMERO, profilePictureUrl: null }]);
 assert.equal(contatos.chamadas[0].url.pathname, '/chat/findContacts/tzolkin');

 const msgs = com(200, { messages: { total: 3, pages: 1, currentPage: 1, records: [{ id: 'm1', key: { id: 'A', fromMe: false }, message: { conversation: 'oi' }, messageType: 'conversation', fromMe: false, messageTimestamp: 1793000000 }, 5] } });
 const rm = await msgs.a.findMessages({ where: { key: { remoteJid: '5531997599216@s.whatsapp.net' } }, orderBy: { messageTimestamp: 'desc' }, page: 2, offset: 20, instance: 'suporte' });
 assert.deepEqual(rm, { ok: true, total: 3, pages: 1, page: 1, messages: [{ id: 'm1', key: { id: 'A', fromMe: false }, fromMe: false, messageType: 'conversation', status: null, timestamp: 1793000000, message: { conversation: 'oi' } }] });
 assert.equal(msgs.chamadas[0].url.pathname, '/chat/findMessages/suporte');
 // na 2.3.7 `offset` é o tamanho da página e `page` o número; take e skip são ignorados pelo servidor, então nem vão no corpo
 assert.deepEqual(msgs.chamadas[0].body, { where: { key: { remoteJid: '5531997599216@s.whatsapp.net' } }, orderBy: { messageTimestamp: 'desc' }, page: 2, offset: 20 });
 assert.equal(rm.messages[0].timestamp, 1793000000, 'o horário vem de messageTimestamp');
 await msgs.a.findMessages();
 assert.deepEqual(msgs.chamadas[1].body, { page: 1, offset: 50 });
 assert.equal((await com(200, { messages: {} }).a.findMessages()).reason, 'invalid');
 assert.equal((await com(200, { chats: [] }).a.findChats()).reason, 'invalid');
});

test('consulta de listagem: take fora de 1 a 200, skip negativo, where ou orderBy que não é objeto e consulta enorme são recusados sem rede', async () => {
 for (const ruim of [{ take: 0 }, { take: 201 }, { take: 1.5 }, { skip: -1 }, { where: [] }, { where: 'x' }, { orderBy: [1] }, { where: { texto: 'x'.repeat(2100) } }]) {
  for (const metodo of ['findChats', 'findContacts']) {
   const x = semRede();
   assert.deepEqual(await x.a[metodo](ruim), { ok: false, reason: 'rejected', detail: 'invalid_query' }, metodo + JSON.stringify(ruim).slice(0, 30));
   assert.equal(x.chamadas.length, 0);
  }
 }
});

test('findMessages: página de 1 a 10000, tamanho de 1 a 100, where e orderBy com limite; tudo recusado sem rede', async () => {
 for (const ruim of [{ page: 0 }, { page: 10001 }, { page: 1.5 }, { offset: 0 }, { offset: 101 }, { where: [] }, { where: 'x' }, { orderBy: [1] }, { where: { texto: 'x'.repeat(2100) } }]) {
  const x = semRede();
  assert.deepEqual(await x.a.findMessages(ruim), { ok: false, reason: 'rejected', detail: 'invalid_query' }, JSON.stringify(ruim).slice(0, 40));
  assert.equal(x.chamadas.length, 0);
 }
});

test('archiveChat: corpo da doc e boolean obrigatório', async () => {
 const { a, chamadas } = com(200, { success: true, message: 'ok' });
 assert.deepEqual(await a.archiveChat({ number: '(31) 99759-9216', archive: true }), { ok: true });
 assert.equal(chamadas[0].url.pathname, '/chat/archiveChat/tzolkin');
 assert.deepEqual(chamadas[0].body, { number: NUMERO, archive: true });
 assert.equal((await semRede().a.archiveChat({ number: NUMERO, archive: 'sim' })).detail, 'invalid_archive');
 assert.equal((await semRede().a.archiveChat({ number: '1', archive: true })).detail, 'invalid_number');
});

test('os métodos novos usam os mesmos motivos estáveis dos antigos e nunca lançam por rede caída', async () => {
 const chamadasPorMetodo = a => [() => a.connect(), () => a.restart(), () => a.sendMedia({ number: NUMERO, mediatype: 'image', media: 'https://cdn.exemplo.com/a.png' }), () => a.findMessages(), () => a.checkNumbers({ numbers: [NUMERO] }), () => a.getWebhook()];
 for (const [status, motivo] of [[401, 'unauthorized'], [404, 'not_found'], [400, 'rejected'], [429, 'rate_limited'], [502, 'unavailable']]) {
  const { a } = com(status, { message: 'x' });
  for (const f of chamadasPorMetodo(a)) assert.equal((await f()).reason, motivo, String(status));
 }
 const caida = createEvolutionAdapter({ env, fetchImpl: async () => { throw new Error('ECONNRESET'); } });
 for (const f of chamadasPorMetodo(caida)) assert.equal((await f()).reason, 'unavailable');
});

test('a chave da Evolution e o segredo do webhook não aparecem em nenhum resultado, nem na mensagem de erro repassada', async () => {
 const a = createEvolutionAdapter({ env, fetchImpl: async () => resposta(400, { error: { message: 'chave chave-secreta-123 inválida' }, apikey: 'chave-secreta-123' }) });
 for (const f of [() => a.createInstance({ name: 'vendas' }), () => a.connect(), () => a.setWebhook({ url: 'https://core.exemplo.com/x', headers: { 'x-webhook-secret': 'abc' } }), () => a.findMessages()]) {
  const r = await f();
  assert.equal(JSON.stringify(r).includes('chave-secreta-123'), false);
 }
 const r = await a.connect();
 assert.equal(r.message, 'chave *** inválida', 'a mensagem do servidor ajuda o operador, já sem a chave');
});
