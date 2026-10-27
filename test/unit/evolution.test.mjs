import test from 'node:test';
import assert from 'node:assert/strict';
import { createEvolutionAdapter, normalizarNumero } from '../../apps/api/src/integrations/evolution.mjs';
import { PROVEDORES, numerosDaEquipeNormalizados } from '../../apps/api/src/platform/credenciais.mjs';

const env = { EVOLUTION_URL: 'https://evo.exemplo.com', EVOLUTION_INSTANCE: 'tzolkin', EVOLUTION_API_KEY: 'chave-secreta-123' };
const resposta = (status, corpo) => ({ ok: status >= 200 && status < 300, status, json: async () => corpo });

test('normalizarNumero aceita os formatos comuns e assume o Brasil sem DDI', () => {
 assert.equal(normalizarNumero('(31) 99759-9216'), '5531997599216');
 assert.equal(normalizarNumero('31997599216'), '5531997599216');
 assert.equal(normalizarNumero('+55 31 99759-9216'), '5531997599216');
 assert.equal(normalizarNumero('5531997599216'), '5531997599216');
 assert.equal(normalizarNumero('3133334444'), '553133334444');      // fixo: 10 dígitos
 assert.equal(normalizarNumero('+44 20 7946 0958'), '442079460958');  // outro país, com DDI (12 dígitos; 10 ou 11 seriam lidos como DDD brasileiro)
});

test('normalizarNumero aceita o celular antigo de 8 dígitos (é o endereço real da conversa) e recusa o que não é telefone', () => {
 assert.equal(normalizarNumero('553197599216'), '553197599216', 'celular antigo: os dígitos não mudam');
 assert.equal(normalizarNumero('553182354127'), '553182354127');
 for (const ruim of ['', 'abc', '123', '55319975992160', '5531197599216', null, undefined, 31997599216, '3199-ABCD']) assert.equal(normalizarNumero(ruim), null, String(ruim));
});

test('sem variáveis, o adaptador diz que não está configurado e não chama a rede', async () => {
 let chamou = false;
 const a = createEvolutionAdapter({ env: {}, fetchImpl: async () => { chamou = true; } });
 assert.equal(a.configured, false);
 assert.deepEqual(await a.sendText({ number: '31997599216', text: 'oi' }), { ok: false, reason: 'not_configured' });
 assert.deepEqual(await a.connectionState(), { ok: false, reason: 'not_configured' });
 assert.equal(chamou, false);
});

test('configuração ruim (http, usuário na URL, instância com espaço) vira invalid_config, sem rede', async () => {
 let chamou = false;
 const fetchImpl = async () => { chamou = true; };
 for (const ruim of [{ ...env, EVOLUTION_URL: 'http://evo.exemplo.com' }, { ...env, EVOLUTION_URL: 'https://u:p@evo.exemplo.com' }, { ...env, EVOLUTION_INSTANCE: 'minha instancia' }, { ...env, EVOLUTION_API_KEY: '' }]) {
  const a = createEvolutionAdapter({ env: ruim, fetchImpl });
  assert.equal(a.configured, false);
  assert.equal((await a.connectionState()).reason, 'invalid_config');
 }
 assert.equal(chamou, false);
});

test('connectionState lê o estado da instância e marca conectado só em "open"', async () => {
 const chamadas = [];
 const a = createEvolutionAdapter({ env, fetchImpl: async (url, init) => { chamadas.push({ url, init }); return resposta(200, { instance: { instanceName: 'tzolkin', state: 'open' } }); } });
 assert.deepEqual(await a.connectionState(), { ok: true, state: 'open', connected: true });
 assert.equal(chamadas[0].url.origin, 'https://evo.exemplo.com');
 assert.equal(chamadas[0].url.pathname, '/instance/connectionState/tzolkin');
 assert.equal(chamadas[0].init.headers.apikey, 'chave-secreta-123');
 const fechada = createEvolutionAdapter({ env, fetchImpl: async () => resposta(200, { instance: { state: 'close' } }) });
 assert.deepEqual(await fechada.connectionState(), { ok: true, state: 'close', connected: false });
});

test('sendText normaliza o número, manda o corpo certo e devolve o id da mensagem', async () => {
 const chamadas = [];
 const a = createEvolutionAdapter({ env, fetchImpl: async (url, init) => { chamadas.push({ url, init }); return resposta(201, { key: { id: 'ABC123', remoteJid: '5531997599216@s.whatsapp.net' }, status: 'PENDING' }); } });
 const r = await a.sendText({ number: '(31) 99759-9216', text: 'Olá!' });
 assert.deepEqual(r, { ok: true, messageId: 'ABC123', status: 'PENDING' });
 assert.equal(chamadas[0].init.method, 'POST');
 assert.equal(chamadas[0].url.pathname, '/message/sendText/tzolkin');
 assert.deepEqual(JSON.parse(chamadas[0].init.body), { number: '5531997599216', text: 'Olá!' });
 assert.equal(chamadas[0].init.redirect, 'error');
});

test('sendText recusa número e texto inválidos antes de chamar a rede', async () => {
 let chamou = false;
 const a = createEvolutionAdapter({ env, fetchImpl: async () => { chamou = true; } });
 assert.deepEqual(await a.sendText({ number: '123', text: 'oi' }), { ok: false, reason: 'rejected', detail: 'invalid_number' });
 assert.deepEqual(await a.sendText({ number: '31997599216', text: '   ' }), { ok: false, reason: 'rejected', detail: 'invalid_text' });
 assert.deepEqual(await a.sendText({ number: '31997599216', text: 'x'.repeat(4097) }), { ok: false, reason: 'rejected', detail: 'invalid_text' });
 assert.equal(chamou, false);
});

test('os status HTTP viram motivos estáveis, e rede caída nunca lança', async () => {
 const com = status => createEvolutionAdapter({ env, fetchImpl: async () => resposta(status, { message: 'x' }) }).sendText({ number: '31997599216', text: 'oi' });
 assert.equal((await com(401)).reason, 'unauthorized');
 assert.equal((await com(403)).reason, 'unauthorized');
 assert.equal((await com(404)).reason, 'not_found');
 assert.equal((await com(400)).reason, 'rejected');
 assert.equal((await com(429)).reason, 'rate_limited');
 assert.equal((await com(502)).reason, 'unavailable');
 const caida = createEvolutionAdapter({ env, fetchImpl: async () => { throw new Error('ECONNRESET'); } });
 assert.equal((await caida.sendText({ number: '31997599216', text: 'oi' })).reason, 'unavailable');
 const semId = createEvolutionAdapter({ env, fetchImpl: async () => resposta(200, { status: 'x' }) });
 assert.equal((await semId.sendText({ number: '31997599216', text: 'oi' })).reason, 'invalid');
});

test('a chave da Evolution não aparece em nenhum resultado', async () => {
 const a = createEvolutionAdapter({ env, fetchImpl: async () => resposta(401, { apikey: 'chave-secreta-123' }) });
 assert.equal(JSON.stringify(await a.sendText({ number: '31997599216', text: 'oi' })).includes('chave-secreta-123'), false);
});

test('credenciais: a Evolution está no catálogo, valida os campos e testa a conexão', async () => {
 const prov = PROVEDORES.evolution;
 assert.ok(prov);
 const campo = nome => prov.campos.find(c => c.nome === nome);
 assert.equal(campo('EVOLUTION_API_KEY').secreto, true);
 assert.equal(campo('EVOLUTION_URL').validar('http://x.com') !== null, true);
 assert.equal(campo('EVOLUTION_URL').validar('https://evo.exemplo.com'), null);
 assert.equal(campo('WHATSAPP_TEAM_NUMBERS').validar('(31) 99759-9216, 11988887777'), null);
 assert.equal(campo('WHATSAPP_TEAM_NUMBERS').validar('553197599216'), null, 'celular antigo de 8 dígitos é válido');
 assert.deepEqual(numerosDaEquipeNormalizados('(31) 99759-9216, 31997599216, lixo'), ['5531997599216']);
 const msg = await prov.testar({ ...env }, async () => resposta(200, { instance: { state: 'open' } }));
 assert.match(msg, /conectada/);
 await assert.rejects(prov.testar({ ...env }, async () => resposta(200, { instance: { state: 'close' } })), /não está conectado/);
 await assert.rejects(prov.testar({ ...env }, async () => resposta(401, {})), /recusou a chave/);
});

test('listInstances: lê o formato da v2 e o antigo, ignora nome inválido e a chave só de instância cai em recusa', async () => {
 const v2 = createEvolutionAdapter({ env, fetchImpl: async url => { assert.equal(new URL(url).pathname, '/instance/fetchInstances'); return resposta(200, [
  { name: 'comercial', connectionStatus: 'open', ownerJid: '5531997599216@s.whatsapp.net', profileName: 'Tzolkin' },
  { name: 'suporte', connectionStatus: 'close' },
  { name: 'nome inválido!', connectionStatus: 'open' }]); } });
 const r = await v2.listInstances();
 assert.deepEqual(r.instances, [{ name: 'comercial', state: 'open', number: '5531997599216', profile: 'Tzolkin' }, { name: 'suporte', state: 'close', number: null, profile: null }]);
 const antigo = createEvolutionAdapter({ env, fetchImpl: async () => resposta(200, [{ instance: { instanceName: 'velha', owner: '5511988887777@s.whatsapp.net', status: 'open' } }]) });
 assert.deepEqual((await antigo.listInstances()).instances, [{ name: 'velha', state: 'open', number: '5511988887777', profile: null }]);
 assert.equal((await createEvolutionAdapter({ env, fetchImpl: async () => resposta(403, {}) }).listInstances()).reason, 'unauthorized');
 assert.equal((await createEvolutionAdapter({ env: {} }).listInstances()).reason, 'not_configured');
});

test('o adaptador envia pela instância escolhida, não pela padrão', async () => {
 const chamadas = [];
 const a = createEvolutionAdapter({ env, instance: 'suporte', fetchImpl: async url => { chamadas.push(new URL(url).pathname); return resposta(201, { key: { id: 'X1' } }); } });
 await a.sendText({ number: '31997599216', text: 'oi' });
 assert.deepEqual(chamadas, ['/message/sendText/suporte']);
 assert.equal(a.instance, 'suporte');
});
