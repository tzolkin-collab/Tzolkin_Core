import test from 'node:test';
import assert from 'node:assert/strict';
import { Readable } from 'node:stream';
import { extrairMensagens, registrarMensagem, verificarSegredo, ehPedidoDeSaida } from '../../apps/api/src/platform/whatsapp-entrada.mjs';
import { whatsappEntradaRoutes } from '../../apps/api/src/modules/whatsapp-entrada.mjs';

const evento = (data, extra = {}) => ({ event: 'messages.upsert', instance: 'teste', data, ...extra });
const msg = (texto, extra = {}) => ({ key: { remoteJid: '5531997599216@s.whatsapp.net', fromMe: false, id: 'ABC1' }, pushName: 'Maria', message: { conversation: texto }, messageTimestamp: 1760000000, ...extra });

test('extrair: guarda só mensagem recebida de uma pessoa, com texto', () => {
 const { mensagens } = extrairMensagens(evento(msg('Oi, quero saber mais')), { instancia: 'teste' });
 assert.equal(mensagens.length, 1);
 assert.deepEqual({ ...mensagens[0], em: mensagens[0].em.toISOString() }, { id: 'ABC1', numero: '5531997599216', nome: 'Maria', texto: 'Oi, quero saber mais', midia: false, em: '2025-10-09T08:53:20.000Z' });
 const longa = extrairMensagens(evento(msg('x'.repeat(5000))), {}).mensagens[0];
 assert.equal(longa.texto.length, 4096);
});

test('extrair: ignora o que não é conversa com uma pessoa', () => {
 const vazio = corpo => extrairMensagens(corpo, { instancia: 'teste' }).mensagens.length;
 assert.equal(vazio(evento(msg('oi', { key: { remoteJid: '5531997599216@s.whatsapp.net', fromMe: true, id: 'X' } }))), 0, 'mensagem nossa');
 assert.equal(vazio(evento(msg('oi', { key: { remoteJid: '120363000000@g.us', fromMe: false, id: 'X' } }))), 0, 'grupo');
 assert.equal(vazio(evento(msg('oi', { key: { remoteJid: 'status@broadcast', fromMe: false, id: 'X' } }))), 0, 'status');
 assert.equal(vazio(evento(msg('oi', { key: { remoteJid: '123456789@lid', fromMe: false, id: 'X' } }))), 0, 'lid: sem telefone');
 assert.equal(vazio(evento(msg('oi', { key: { remoteJid: '5531997599216@s.whatsapp.net', fromMe: false } }))), 0, 'sem id');
 assert.equal(vazio(evento(msg('   '))), 0, 'sem texto');
 assert.equal(vazio(evento(msg('oi'), { instance: 'outra' })), 0, 'outra instância');
 assert.equal(vazio({ event: 'connection.update', data: { state: 'open' } }), 0, 'outro evento');
 assert.equal(vazio(null), 0);
});

test('extrair: aceita o nome do evento nos dois formatos, lista de mensagens, legenda e mídia', () => {
 assert.equal(extrairMensagens({ ...evento(msg('oi')), event: 'MESSAGES_UPSERT' }).mensagens.length, 1);
 assert.equal(extrairMensagens(evento([msg('um'), msg('dois', { key: { remoteJid: '5511988887777@s.whatsapp.net', fromMe: false, id: 'B' } })])).mensagens.length, 2);
 assert.equal(extrairMensagens(evento(msg(null, { message: { extendedTextMessage: { text: 'com link' } } }))).mensagens[0].texto, 'com link');
 const foto = extrairMensagens(evento(msg(null, { message: { imageMessage: { caption: 'meu comprovante' } } }))).mensagens[0];
 assert.equal(foto.texto, 'meu comprovante'); assert.equal(foto.midia, true);
 const audio = extrairMensagens(evento(msg(null, { message: { audioMessage: {} } }))).mensagens[0];
 assert.equal(audio.texto, '[mídia]'); assert.equal(audio.midia, true);
});

test('segredo: exige configurar, aceita cabeçalho ou Bearer e recusa o resto', () => {
 assert.deepEqual(verificarSegredo({ cabecalho: 'x', segredo: '' }), { ok: false, reason: 'sem_segredo' });
 assert.deepEqual(verificarSegredo({ segredo: 's3gredo' }), { ok: false, reason: 'sem_token' });
 assert.deepEqual(verificarSegredo({ cabecalho: 'errado!', segredo: 's3gredo' }), { ok: false, reason: 'token_invalido' });
 assert.deepEqual(verificarSegredo({ cabecalho: 's3gredo', segredo: 's3gredo' }), { ok: true });
 assert.deepEqual(verificarSegredo({ autorizacao: 'Bearer s3gredo', segredo: 's3gredo' }), { ok: true });
});

test('pedido de saída: só a palavra sozinha, com ou sem acento e pontuação', () => {
 for (const sim of ['sair', 'SAIR', 'Parar.', 'pare!', 'stop', 'cancelar', 'Descadastrar']) assert.equal(ehPedidoDeSaida(sim), true, sim);
 for (const nao of ['quero sair do plano', 'oi', 'não pare, continue', '']) assert.equal(ehPedidoDeSaida(nao), false, nao);
});

function bancoDeEntrada({ lead = null, jaExiste = false, semTabela = false } = {}) {
 const sql = [];
 return { sql, async query(texto, p = []) {
  sql.push({ texto, p });
  if (texto.includes('FROM commercial_leads l')) return { rows: lead ? [lead] : [] };
  if (texto.startsWith('INSERT INTO whatsapp_inbox')) { if (semTabela) throw Object.assign(new Error('relation'), { code: '42P01' }); return { rows: jaExiste ? [] : [{ id: 'in-1' }] }; }
  return { rows: [], rowCount: 0 };
 } };
}
const MENSAGEM = { id: 'ABC1', numero: '5531997599216', nome: 'Maria', texto: 'Oi', midia: false, em: new Date('2025-10-09T08:53:20Z') };

test('registrar: liga ao lead pelos 8 últimos dígitos e não duplica a reentrega', async () => {
 const c = bancoDeEntrada({ lead: { id: 'lead-1', product_id: 'sites' } });
 const r = await registrarMensagem(c, MENSAGEM);
 assert.deepEqual(r, { novo: true, lead: 'lead-1', saiu: false });
 assert.equal(c.sql.find(q => q.texto.includes('FROM commercial_leads l')).p[0], '97599216');
 assert.deepEqual((await registrarMensagem(bancoDeEntrada({ jaExiste: true }), MENSAGEM)).novo, false);
});

test('registrar: "sair" bloqueia o número e tira da fila o que não saiu; repetição não bloqueia de novo', async () => {
 const c = bancoDeEntrada();
 const r = await registrarMensagem(c, { ...MENSAGEM, texto: 'Sair' });
 assert.equal(r.saiu, true);
 assert.ok(c.sql.some(q => q.texto.startsWith('INSERT INTO whatsapp_suppressions') && q.p[0] === '5531997599216'));
 assert.ok(c.sql.some(q => q.texto.startsWith('UPDATE whatsapp_outbox') && q.texto.includes("status='queued'")));
 const repetida = bancoDeEntrada({ jaExiste: true });
 assert.equal((await registrarMensagem(repetida, { ...MENSAGEM, texto: 'Sair' })).saiu, false);
 assert.ok(!repetida.sql.some(q => q.texto.startsWith('INSERT INTO whatsapp_suppressions')));
});

// Rotas: um router de mentira guarda os tratadores; cada chamada leva um pedido e uma resposta de mentira.
function montar(env, pool) {
 const rotas = new Map();
 whatsappEntradaRoutes({ get: (r, f) => rotas.set('GET ' + r, f), post: (r, f) => rotas.set('POST ' + r, f) }, { env, clock: () => 1_000_000 });
 const chamar = async (chave, { cabecalhos = {}, corpo = '', params = {}, body = {}, client = pool, operator = { email: 'eu@x.co' } } = {}) => {
  const req = Object.assign(Readable.from([Buffer.from(corpo)]), { headers: cabecalhos });
  let resposta = null;
  const resultado = await rotas.get(chave)({ req, pool, client, params, body, operator, reply: (status, dados) => { resposta = { status, dados }; } });
  return resposta ?? resultado;
 };
 return chamar;
}
const ENV = { EVOLUTION_WEBHOOK_SECRET: 's3gredo', EVOLUTION_INSTANCE: 'teste' };

test('webhook: sem segredo configurado 503, segredo errado 401, certo 200 e guarda a mensagem', async () => {
 const c = bancoDeEntrada();
 const corpo = JSON.stringify(evento(msg('Oi')));
 await assert.rejects(montar({}, c)('POST /api/webhooks/evolution', { corpo, cabecalhos: { 'x-webhook-secret': 'x' } }), e => e.status === 503);
 await assert.rejects(montar(ENV, c)('POST /api/webhooks/evolution', { corpo, cabecalhos: { 'x-webhook-secret': 'errado!' } }), e => e.status === 401);
 assert.equal(c.sql.length, 0, 'sem prova de origem nada é gravado');
 const r = await montar(ENV, c)('POST /api/webhooks/evolution', { corpo, cabecalhos: { 'x-webhook-secret': 's3gredo' } });
 assert.deepEqual(r, { status: 200, dados: { received: true, registradas: 1 } });
});

test('webhook: JSON ruim 400; evento que não guardamos 200; sem a migração 063 responde 503 para a Evolution tentar de novo', async () => {
 const h = { 'x-webhook-secret': 's3gredo' };
 await assert.rejects(montar(ENV, bancoDeEntrada())('POST /api/webhooks/evolution', { corpo: '{ruim', cabecalhos: h }), e => e.status === 400);
 assert.deepEqual((await montar(ENV, bancoDeEntrada())('POST /api/webhooks/evolution', { corpo: JSON.stringify({ event: 'connection.update', data: {} }), cabecalhos: h })).dados, { received: true, registradas: 0 });
 await assert.rejects(montar(ENV, bancoDeEntrada({ semTabela: true }))('POST /api/webhooks/evolution', { corpo: JSON.stringify(evento(msg('Oi'))), cabecalhos: h }), e => e.status === 503);
});

test('responder: enfileira na fila de saída (não envia na hora), recusa número bloqueado e texto vazio', async () => {
 const sql = [];
 const client = { async query(texto, p = []) {
  sql.push({ texto, p });
  if (texto.includes('FROM whatsapp_suppressions')) return { rows: [] };
  if (texto.includes('FROM whatsapp_inbox')) return { rows: [{ lead_id: 'lead-1', product_id: 'sites', push_name: 'Maria' }] };
  if (texto.startsWith('INSERT INTO whatsapp_outbox')) return { rows: [{ id: 'wa-9' }] };
  return { rows: [] };
 } };
 const chamar = montar(ENV, client);
 const r = await chamar('POST /api/whatsapp/conversations/:number/responder', { params: { number: '5531997599216' }, body: { text: ' Olá, Maria! ' }, client });
 assert.deepEqual(r.response, { ok: true, id: 'wa-9' });
 const ins = sql.find(q => q.texto.startsWith('INSERT INTO whatsapp_outbox')).p;
 assert.match(ins[0], /^wa:resposta:/); assert.equal(ins[6], '5531997599216'); assert.equal(ins[8], 'Olá, Maria!'); assert.equal(ins[5], 'lead-1');
 for (const ruim of [{ text: '   ' }, { text: 'x'.repeat(4097) }, { text: 'oi', extra: 1 }]) await assert.rejects(chamar('POST /api/whatsapp/conversations/:number/responder', { params: { number: '5531997599216' }, body: ruim, client }), e => e.status === 400);
 await assert.rejects(chamar('POST /api/whatsapp/conversations/:number/responder', { params: { number: 'abc' }, body: { text: 'oi' }, client }), e => e.status === 400);
 const bloqueado = { async query(texto) { return { rows: texto.includes('FROM whatsapp_suppressions') ? [{}] : [] }; } };
 await assert.rejects(chamar('POST /api/whatsapp/conversations/:number/responder', { params: { number: '5531997599216' }, body: { text: 'oi' }, client: bloqueado }), e => e.status === 409);
});

test('migração 063: só adiciona, id da mensagem único e número só com dígitos', async () => {
 const { readFileSync } = await import('node:fs');
 const sql = readFileSync(new URL('../../db/migrations/063_caixa_de_entrada_whatsapp.sql', import.meta.url), 'utf8');
 assert.doesNotMatch(sql.replace(/--.*$/gm, ''), /\b(DROP|DELETE|TRUNCATE|ALTER)\b/i);
 assert.match(sql, /provider_message_id text NOT NULL UNIQUE/);
 assert.match(sql, /from_number ~ '\^\[0-9\]\{10,15\}\$'/);
});
