import test from 'node:test';
import assert from 'node:assert/strict';
import {
 SOM_PADRAO,
 CHAVE_STORAGE_SOM,
 CHAVE_STORAGE_SOM_LEAD,
 CHAVE_STORAGE_SOM_AGENDA,
 CHAVE_STORAGE_CUSTOM_AUDIO,
 CHAVE_STORAGE_CUSTOM_NOME,
 SONS_NOTIFICACAO,
 obterSomEscolhido,
 definirSomEscolhido,
 obterSomPorTopico,
 definirSomPorTopico,
 obterSomCustomizado,
 salvarSomCustomizado,
 removerSomCustomizado,
 tocarSomNotificacao,
 tocarSomNotificacaoPorTag,
} from '../../apps/web/public/notification-sound.js';

test('som padrão de notificação é chime e está disponível na lista', () => {
 assert.equal(SOM_PADRAO, 'chime');
 assert.ok(SOM_PADRAO in SONS_NOTIFICACAO);
 assert.equal(SONS_NOTIFICACAO[SOM_PADRAO].nome, 'Chime (Padrão)');
 assert.equal(typeof SONS_NOTIFICACAO[SOM_PADRAO].tocar, 'function');
});

test('todos os sons declarados possuem identificador, nome e função tocar', () => {
 const chaves = Object.keys(SONS_NOTIFICACAO);
 assert.ok(chaves.length >= 8, 'deve oferecer múltiplas opções ricas de som');
 for (const id of chaves) {
  const som = SONS_NOTIFICACAO[id];
  assert.equal(som.id, id);
  assert.ok(typeof som.nome === 'string' && som.nome.length > 0);
  assert.equal(typeof som.tocar, 'function');
 }
 assert.ok('none' in SONS_NOTIFICACAO, 'deve permitir opção silenciosa');
 assert.ok('fanfare' in SONS_NOTIFICACAO, 'deve conter fanfarra');
 assert.ok('digital' in SONS_NOTIFICACAO, 'deve conter bip digital');
 assert.ok('custom' in SONS_NOTIFICACAO, 'deve conter opção de som personalizado');
});

test('obterSomEscolhido devolve chime por padrão quando não há nada no localStorage', () => {
 const original = globalThis.localStorage;
 try {
  globalThis.localStorage = {
   getItem: () => null,
   setItem: () => {},
   removeItem: () => {},
  };
  assert.equal(obterSomEscolhido(), 'chime');
 } finally {
  globalThis.localStorage = original;
 }
});

test('definirSomEscolhido salva no storage e remove chave quando volta ao padrão', () => {
 const original = globalThis.localStorage;
 const memoria = new Map();
 try {
  globalThis.localStorage = {
   getItem: k => memoria.get(k) || null,
   setItem: (k, v) => memoria.set(k, String(v)),
   removeItem: k => memoria.delete(k),
  };

  definirSomEscolhido('bell');
  assert.equal(memoria.get(CHAVE_STORAGE_SOM), 'bell');
  assert.equal(obterSomEscolhido(), 'bell');

  definirSomEscolhido('pop');
  assert.equal(memoria.get(CHAVE_STORAGE_SOM), 'pop');

  definirSomEscolhido(SOM_PADRAO);
  assert.equal(memoria.has(CHAVE_STORAGE_SOM), false, 'padrão não polui o storage com chave redundante');
  assert.equal(obterSomEscolhido(), 'chime');
 } finally {
  globalThis.localStorage = original;
 }
});

test('obterSomPorTopico e definirSomPorTopico gerenciam som por assunto', () => {
 const original = globalThis.localStorage;
 const memoria = new Map();
 try {
  globalThis.localStorage = {
   getItem: k => memoria.get(k) || null,
   setItem: (k, v) => memoria.set(k, String(v)),
   removeItem: k => memoria.delete(k),
  };

  // Sem nada definido, cai no som padrão geral
  assert.equal(obterSomPorTopico('commercial.lead'), 'chime');
  assert.equal(obterSomPorTopico('agenda.lembrete'), 'chime');

  definirSomPorTopico('commercial.lead', 'fanfare');
  assert.equal(memoria.get(CHAVE_STORAGE_SOM_LEAD), 'fanfare');
  assert.equal(obterSomPorTopico('commercial.lead'), 'fanfare');
  assert.equal(obterSomPorTopico('agenda.lembrete'), 'chime');

  definirSomPorTopico('agenda.lembrete', 'digital');
  assert.equal(memoria.get(CHAVE_STORAGE_SOM_AGENDA), 'digital');
  assert.equal(obterSomPorTopico('agenda.lembrete'), 'digital');

  // Limpar som específico volta para padrão
  definirSomPorTopico('commercial.lead', 'padrao');
  assert.equal(memoria.has(CHAVE_STORAGE_SOM_LEAD), false);
  assert.equal(obterSomPorTopico('commercial.lead'), 'chime');
 } finally {
  globalThis.localStorage = original;
 }
});

test('armazenamento de som customizado', () => {
 const original = globalThis.localStorage;
 const memoria = new Map();
 try {
  globalThis.localStorage = {
   getItem: k => memoria.get(k) || null,
   setItem: (k, v) => memoria.set(k, String(v)),
   removeItem: k => memoria.delete(k),
  };

  assert.equal(obterSomCustomizado(), null);
  salvarSomCustomizado('data:audio/mp3;base64,AAAA', 'meu-som.mp3');
  assert.equal(memoria.get(CHAVE_STORAGE_CUSTOM_AUDIO), 'data:audio/mp3;base64,AAAA');
  assert.equal(memoria.get(CHAVE_STORAGE_CUSTOM_NOME), 'meu-som.mp3');

  const obtido = obterSomCustomizado();
  assert.equal(obtido.audio, 'data:audio/mp3;base64,AAAA');
  assert.equal(obtido.nome, 'meu-som.mp3');

  removerSomCustomizado();
  assert.equal(obterSomCustomizado(), null);
  assert.equal(memoria.has(CHAVE_STORAGE_CUSTOM_AUDIO), false);
 } finally {
  globalThis.localStorage = original;
 }
});

test('tocarSomNotificacao e tocarSomNotificacaoPorTag não lançam erro sem áudio no ambiente de teste', () => {
 assert.doesNotThrow(() => tocarSomNotificacao('chime'));
 assert.doesNotThrow(() => tocarSomNotificacao('none'));
 assert.doesNotThrow(() => tocarSomNotificacao('fanfare'));
 assert.doesNotThrow(() => tocarSomNotificacao('digital'));
 assert.doesNotThrow(() => tocarSomNotificacao('custom'));
 assert.doesNotThrow(() => tocarSomNotificacaoPorTag('lead:123'));
 assert.doesNotThrow(() => tocarSomNotificacaoPorTag('agenda:456'));
 assert.doesNotThrow(() => tocarSomNotificacaoPorTag('teste'));
 assert.doesNotThrow(() => tocarSomNotificacaoPorTag(null));
});
