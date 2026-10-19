import test from 'node:test';
import assert from 'node:assert/strict';
import {
 SOM_PADRAO,
 CHAVE_STORAGE_SOM,
 SONS_NOTIFICACAO,
 obterSomEscolhido,
 definirSomEscolhido,
 tocarSomNotificacao,
} from '../../apps/web/public/notification-sound.js';

test('som padrão de notificação é chime e está disponível na lista', () => {
 assert.equal(SOM_PADRAO, 'chime');
 assert.ok(SOM_PADRAO in SONS_NOTIFICACAO);
 assert.equal(SONS_NOTIFICACAO[SOM_PADRAO].nome, 'Chime (Padrão)');
 assert.equal(typeof SONS_NOTIFICACAO[SOM_PADRAO].tocar, 'function');
});

test('todos os sons declarados possuem identificador, nome e função tocar', () => {
 const chaves = Object.keys(SONS_NOTIFICACAO);
 assert.ok(chaves.length >= 4, 'deve oferecer múltiplas opções de som e opção silenciosa');
 for (const id of chaves) {
  const som = SONS_NOTIFICACAO[id];
  assert.equal(som.id, id);
  assert.ok(typeof som.nome === 'string' && som.nome.length > 0);
  assert.equal(typeof som.tocar, 'function');
 }
 assert.ok('none' in SONS_NOTIFICACAO, 'deve permitir opção silenciosa');
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

test('tocarSomNotificacao não lança erro mesmo sem AudioContext no ambiente de teste', () => {
 assert.doesNotThrow(() => tocarSomNotificacao('chime'));
 assert.doesNotThrow(() => tocarSomNotificacao('none'));
 assert.doesNotThrow(() => tocarSomNotificacao('som_inexistente'));
});
