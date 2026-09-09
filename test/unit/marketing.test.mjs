// Campanhas de marketing: credencial cifrada, adaptador da Graph e atribuição.
//
// O teste que mais importa aqui é o de vazamento: o token não pode aparecer em
// URL, em resposta de API nem em mensagem de erro. Os demais protegem o
// dinheiro — conversão de valor monetário e a regra de "um dono só".
import test from 'node:test';
import assert from 'node:assert/strict';
import { randomBytes } from 'node:crypto';
import { readKey, seal, open, fingerprint, scrub } from '../../apps/api/src/platform/secrets.mjs';
import {
 createMetaGraphAdapter, exchangeLongLivedToken,
 decimalParaCentavos, unidadeMenorParaCentavos, _internals,
} from '../../apps/api/src/integrations/meta-graph.mjs';
import { credencialPublica, sugerirVinculo } from '../../apps/api/src/modules/marketing.mjs';

const CHAVE = randomBytes(32).toString('base64');
const env = { CORE_MARKETING_KEY: CHAVE };
const TOKEN = 'EAABsbCS1iHgBA' + 'x'.repeat(180);

test('Credencial cifrada em repouso', async t => {
 await t.test('vai e volta sem alterar o texto', () => {
  const chave = readKey(env);
  const selado = seal(TOKEN, chave);
  assert.equal(open(selado, chave), TOKEN);
  // O texto cifrado não pode conter o token em claro.
  assert.ok(!selado.ciphertext.toString('utf8').includes('EAABsbCS1iHgBA'));
  assert.ok(!selado.ciphertext.toString('base64').includes(TOKEN));
 });

 await t.test('cada cifragem usa um vetor novo', () => {
  const chave = readKey(env);
  const a = seal(TOKEN, chave), b = seal(TOKEN, chave);
  assert.notEqual(a.iv.toString('hex'), b.iv.toString('hex'), 'IV repetido quebra o GCM');
  assert.notEqual(a.ciphertext.toString('hex'), b.ciphertext.toString('hex'));
  // Mas a impressão digital é estável: é o que identifica "mesmo token".
  assert.equal(a.fingerprint, b.fingerprint);
 });

 await t.test('chave errada não decifra', () => {
  const selado = seal(TOKEN, readKey(env));
  const outra = readKey({ CORE_MARKETING_KEY: randomBytes(32).toString('base64') });
  assert.throws(() => open(selado, outra), /ilegível/);
 });

 await t.test('registro adulterado é recusado, não devolve token trocado', () => {
  const chave = readKey(env);
  const selado = seal(TOKEN, chave);
  const mexido = Buffer.from(selado.ciphertext);
  mexido[0] ^= 0xff;
  assert.throws(() => open({ ...selado, ciphertext: mexido }, chave), /ilegível/);
 });

 await t.test('chave de tamanho errado é recusada na largada', () => {
  assert.throws(() => readKey({}), /CORE_MARKETING_KEY/);
  assert.throws(() => readKey({ CORE_MARKETING_KEY: 'curta' }), /32 bytes/);
  assert.throws(() => readKey({ CORE_MARKETING_KEY: randomBytes(16).toString('base64') }), /32 bytes/);
 });

 await t.test('impressão digital não é reversível nem colide com o token', () => {
  const f = fingerprint(TOKEN);
  assert.equal(f.length, 16);
  assert.ok(!TOKEN.includes(f));
  assert.notEqual(f, fingerprint(TOKEN + 'a'));
 });

 await t.test('scrub remove o segredo de texto que iria para log', () => {
  assert.equal(scrub(`falhou com ${TOKEN} no fim`, TOKEN), 'falhou com [oculto] no fim');
  // Segredo curto demais não é apagado: apagaria texto legítimo por acidente.
  assert.equal(scrub('erro no id ab', 'ab'), 'erro no id ab');
 });
});

test('Valor monetário nunca em ponto flutuante', async t => {
 await t.test('decimal vira centavos inteiros', () => {
  assert.equal(decimalParaCentavos('12.34'), 1234);
  assert.equal(decimalParaCentavos('0.01'), 1);
  assert.equal(decimalParaCentavos('1000'), 100000);
  assert.equal(decimalParaCentavos('0'), 0);
  // O caso que o ponto flutuante erra: 12.34*100 = 1233.9999999999998
  assert.equal(decimalParaCentavos('8.29'), 829);
  assert.equal(decimalParaCentavos('1.005'), 101, 'terceira casa arredonda para cima');
  assert.equal(decimalParaCentavos('1.004'), 100);
 });

 await t.test('valores grandes não perdem precisão', () => {
  assert.equal(decimalParaCentavos('99999999.99'), 9999999999);
 });

 await t.test('entrada inválida vira null, nunca NaN', () => {
  for (const ruim of ['', null, undefined, 'abc', '1.2.3', '12,34', {}, []]) {
   assert.equal(decimalParaCentavos(ruim), null, `falhou para ${JSON.stringify(ruim)}`);
  }
 });

 await t.test('orçamento já vem em unidade menor e não é multiplicado de novo', () => {
  // A Meta manda daily_budget "5000" querendo dizer R$ 50,00.
  assert.equal(unidadeMenorParaCentavos('5000'), 5000);
  assert.equal(unidadeMenorParaCentavos('0'), 0);
  assert.equal(unidadeMenorParaCentavos('50.00'), null, 'decimal aqui é formato inesperado');
  assert.equal(unidadeMenorParaCentavos(null), null);
 });
});

// Fetch falso: registra o que foi pedido para provarmos onde o token viajou.
function fetchFalso(respostas) {
 const chamadas = [];
 const impl = async (url, options = {}) => {
  chamadas.push({ url: String(url), headers: options.headers || {}, options });
  const chave = [...respostas.keys()].find(k => String(url).includes(k));
  const corpo = chave ? respostas.get(chave) : { data: [] };
  return { ok: true, status: 200, json: async () => corpo };
 };
 impl.chamadas = chamadas;
 return impl;
}

test('Adaptador da Meta', async t => {
 await t.test('o token viaja no cabeçalho, nunca na URL', async () => {
  const fetchImpl = fetchFalso(new Map([['/me/adaccounts', { data: [] }]]));
  const api = createMetaGraphAdapter({ token: TOKEN, fetchImpl });
  await api.listAdAccounts();
  const chamada = fetchImpl.chamadas[0];
  assert.ok(!chamada.url.includes(TOKEN), 'token na URL entraria em log de proxy e Referer');
  assert.equal(chamada.headers.Authorization, `Bearer ${TOKEN}`);
  assert.equal(chamada.options.redirect, 'error', 'redirecionamento levaria a credencial a outro host');
  assert.ok(chamada.options.signal, 'sem timeout uma chamada travada segura o pool');
 });

 await t.test('conta de anúncios normalizada', async () => {
  const fetchImpl = fetchFalso(new Map([['/me/adaccounts', {
   data: [{ id: 'act_123', name: 'TZOLKIN', account_status: 1, currency: 'BRL', business: { name: 'Tzolkin' } }],
  }]]));
  const [conta] = await createMetaGraphAdapter({ token: TOKEN, fetchImpl }).listAdAccounts();
  assert.equal(conta.external_id, 'act_123');
  assert.equal(conta.account_ref, '123');
  assert.equal(conta.currency, 'BRL');
  assert.equal(conta.active, true);
 });

 await t.test('campanha traz orçamento em centavos e mantém pausadas', async () => {
  const fetchImpl = fetchFalso(new Map([['/campaigns', {
   data: [
    { id: '1', name: 'Skiller — tráfego', objective: 'OUTCOME_TRAFFIC', status: 'ACTIVE', effective_status: 'ACTIVE', daily_budget: '5000' },
    { id: '2', name: 'Antiga', status: 'PAUSED', effective_status: 'PAUSED', lifetime_budget: '120000' },
   ],
  }]]));
  const { campaigns } = await createMetaGraphAdapter({ token: TOKEN, fetchImpl }).listCampaigns('act_123');
  assert.equal(campaigns.length, 2, 'campanha pausada tem gasto histórico e não pode sumir');
  assert.equal(campaigns[0].daily_budget_cents, 5000);
  assert.equal(campaigns[0].objective_label, 'tráfego');
  assert.equal(campaigns[1].lifetime_budget_cents, 120000);
 });

 await t.test('conta inválida é recusada antes de chamar a rede', async () => {
  const fetchImpl = fetchFalso(new Map());
  const api = createMetaGraphAdapter({ token: TOKEN, fetchImpl });
  await assert.rejects(() => api.listCampaigns('123'), /Conta de anúncios inválida/);
  await assert.rejects(() => api.listCampaigns('act_1/../me'), /Conta de anúncios inválida/);
  assert.equal(fetchImpl.chamadas.length, 0);
 });

 await t.test('período inválido é recusado antes de chamar a rede', async () => {
  const fetchImpl = fetchFalso(new Map());
  const api = createMetaGraphAdapter({ token: TOKEN, fetchImpl });
  await assert.rejects(() => api.listCampaignInsights('act_1', { since: 'ontem', until: '2026-01-01' }), /Período inválido/);
  assert.equal(fetchImpl.chamadas.length, 0);
 });

 await t.test('insight converte gasto decimal e soma ações por tipo', async () => {
  const fetchImpl = fetchFalso(new Map([['/insights', {
   data: [{
    campaign_id: '1', campaign_name: 'Skiller', date_start: '2026-09-01', date_stop: '2026-09-01',
    spend: '128.37', impressions: '4210', clicks: '96',
    actions: [{ action_type: 'lead', value: '7' }, { action_type: 'post_engagement', value: '52' }],
   }],
  }]]));
  const { insights } = await createMetaGraphAdapter({ token: TOKEN, fetchImpl })
   .listCampaignInsights('act_123', { since: '2026-09-01', until: '2026-09-30', currency: 'BRL' });
  assert.equal(insights[0].spend_cents, 12837);
  assert.equal(insights[0].currency, 'BRL');
  assert.equal(insights[0].leads, 7);
  assert.equal(insights[0].purchases, null, 'sem compra registrada é null, não zero inventado');
 });

 await t.test('erro de provedor não devolve o token nem o corpo bruto', () => {
  for (const [status, codigo] of [[401, 190], [403, 200], [429, 17], [500, null]]) {
   const mensagem = _internals.mensagemDeFalha(status, codigo);
   assert.ok(!mensagem.includes(TOKEN));
   assert.ok(mensagem.length < 200);
  }
  assert.match(_internals.mensagemDeFalha(401, 190), /inválido ou expirado/);
  assert.match(_internals.mensagemDeFalha(403, 200), /ads_read/);
 });

 await t.test('troca de token curto por longo lê expiração e tipo', async () => {
  const fetchImpl = fetchFalso(new Map([['/oauth/access_token', { access_token: 'LONGO', expires_in: 5184000 }]]));
  const r = await exchangeLongLivedToken({ appId: '1', appSecret: 's', shortLivedToken: 'CURTO', fetchImpl });
  assert.equal(r.access_token, 'LONGO');
  assert.equal(r.token_type, 'long_lived_user');
  assert.ok(Date.parse(r.expires_at) > Date.now());
 });

 await t.test('sem expires_in a Meta está dizendo "não expira"', async () => {
  const fetchImpl = fetchFalso(new Map([['/oauth/access_token', { access_token: 'SISTEMA' }]]));
  const r = await exchangeLongLivedToken({ appId: '1', appSecret: 's', shortLivedToken: 'CURTO', fetchImpl });
  assert.equal(r.expires_at, null);
  assert.equal(r.token_type, 'system_user');
 });
});

test('A credencial exposta ao painel nunca contém o token', async t => {
 const linha = {
  label: 'Meta Ads', token_type: 'long_lived_user', token_fingerprint: fingerprint(TOKEN),
  scopes: ['ads_read', 'business_management'],
  expires_at: new Date(Date.now() + 40 * 86400000).toISOString(),
  last_verified_at: null, last_error: null, created_at: new Date().toISOString(),
  // Campos que existem na linha do banco e NÃO podem sair daqui:
  token_ciphertext: Buffer.from('cifrado'), token_iv: Buffer.from('iv'), token_tag: Buffer.from('tag'),
 };

 await t.test('nenhum campo do segredo atravessa a serialização', () => {
  const publico = credencialPublica(linha);
  const texto = JSON.stringify(publico);
  assert.ok(!texto.includes(TOKEN));
  for (const proibido of ['token_ciphertext', 'token_iv', 'token_tag', 'cifrado']) {
   assert.ok(!texto.includes(proibido), `${proibido} vazou para o painel`);
  }
  assert.equal(publico.fingerprint, fingerprint(TOKEN), 'a impressão digital é o que identifica o token');
 });

 await t.test('expiração vira contagem de dias acionável', () => {
  const p = credencialPublica(linha);
  assert.equal(p.never_expires, false);
  assert.equal(p.expiring_soon, false);
  assert.ok(p.days_remaining >= 39 && p.days_remaining <= 40);
  assert.equal(p.can_read_ads, true);
 });

 await t.test('token perto de expirar é sinalizado antes de a coleta parar', () => {
  const p = credencialPublica({ ...linha, expires_at: new Date(Date.now() + 5 * 86400000).toISOString() });
  assert.equal(p.expiring_soon, true);
  assert.equal(p.expired, false);
 });

 await t.test('token de sistema: sem expiração é estado válido, não desconhecido', () => {
  const p = credencialPublica({ ...linha, expires_at: null, token_type: 'system_user' });
  assert.equal(p.never_expires, true);
  assert.equal(p.days_remaining, null);
  assert.equal(p.expiring_soon, false);
 });

 await t.test('sem credencial o estado é vazio honesto, não erro', () => {
  assert.deepEqual(credencialPublica(null), { configured: false });
 });

 await t.test('token sem ads_read é denunciado', () => {
  assert.equal(credencialPublica({ ...linha, scopes: ['public_profile'] }).can_read_ads, false);
 });
});

test('Sugestão de vínculo é conservadora', async t => {
 const produtos = [{ id: 'skiller', name: 'Skiller' }, { id: 'barber', name: 'Barber' }];
 const contratacoes = [
  { id: 'e1', label: 'Assessoria', service_model: 'advisory', tenant_name: 'Assinatura Marca Própria' },
  { id: 'e2', label: 'Mentoria', service_model: 'education', tenant_name: 'João' },
 ];

 await t.test('nome inequívoco vira sugestão', () => {
  const s = sugerirVinculo('Skiller — tráfego setembro', produtos, contratacoes);
  assert.equal(s.kind, 'product');
  assert.equal(s.product_id, 'skiller');
 });

 await t.test('contratação também é alvo, com o modelo de serviço junto', () => {
  const s = sugerirVinculo('Campanha João — Mentoria', produtos, contratacoes);
  assert.equal(s.kind, 'engagement');
  assert.equal(s.service_model, 'education');
 });

 await t.test('ambiguidade não vira palpite', () => {
  assert.equal(sugerirVinculo('Skiller e Barber juntos', produtos, contratacoes), null);
 });

 await t.test('sem correspondência não sugere nada', () => {
  assert.equal(sugerirVinculo('Campanha institucional', produtos, contratacoes), null);
  assert.equal(sugerirVinculo('', produtos, contratacoes), null);
  assert.equal(sugerirVinculo(null, produtos, contratacoes), null);
 });

 await t.test('casa palavra inteira, não pedaço de outra palavra', () => {
  // "barbearia" contém "barber", mas não é o produto Barber.
  assert.equal(sugerirVinculo('anuncio para barbearias', produtos, contratacoes), null);
 });
});
