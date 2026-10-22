// Endereço e filtro da navegação por espaço (apps/web/public/espacos-nav.js). O que mexe em navegador (histórico, memória
// da última tela) é coberto pela prova de tela em test/ui; aqui, só as regras puras.
import test from 'node:test';
import assert from 'node:assert/strict';
import { lerEndereco, montarEndereco, filtrarEspacos } from '../../apps/web/public/espacos-nav.js';

test('o endereço do espaço vai e volta, com e sem tela', () => {
 assert.equal(montarEndereco('', 'leads'), '#/geral/leads');
 assert.equal(montarEndereco('sites', 'product-inbound'), '#/espaco/sites/product-inbound');
 assert.equal(montarEndereco('sites', null), '#/espaco/sites');
 for (const [espaco, tela] of [['', 'leads'], ['sites', 'product-clients'], ['educare', null], ['', null]]) {
  assert.deepEqual(lerEndereco(montarEndereco(espaco, tela)), { espaco, tela });
 }
});

test('endereço estranho é ignorado, nunca interpretado', () => {
 for (const ruim of ['', '#', '#/', '#/outro/x', '#/espaco', '#/espaco//leads', '#/espaco/a b/leads', '#/geral/a/b', '#/espaco/sites/1abc', '#/espaco/sites/x/y', '#/espaco/<script>/leads', null, undefined]) {
  assert.equal(lerEndereco(ruim), null, String(ruim));
 }
});

test('filtrar espaços ignora acento e caixa, e vazio mostra tudo', () => {
 const itens = [{ texto: 'TZOLKIN Gestão geral' }, { texto: 'Educare plataforma' }, { texto: 'TZOLKIN Mentorias serviço' }];
 assert.deepEqual(filtrarEspacos(itens, ''), [0, 1, 2]);
 assert.deepEqual(filtrarEspacos(itens, '  '), [0, 1, 2]);
 assert.deepEqual(filtrarEspacos(itens, 'GESTAO'), [0]);
 assert.deepEqual(filtrarEspacos(itens, 'servico'), [2]);
 assert.deepEqual(filtrarEspacos(itens, 'zzz'), []);
});
