import test from 'node:test';
import assert from 'node:assert/strict';
import { paraUnidade, resumoDosPassos, resultadoDoFluxo } from '../../apps/web/public/whatsapp-fluxos.js';

test('paraUnidade: a unidade mais natural para o tempo de espera', () => {
 assert.deepEqual(paraUnidade(1), [1, 1]);
 assert.deepEqual(paraUnidade(90), [90, 1]);
 assert.deepEqual(paraUnidade(120), [2, 60]);
 assert.deepEqual(paraUnidade(1440), [1, 1440]);
 assert.deepEqual(paraUnidade(2880), [2, 1440]);
 assert.deepEqual(paraUnidade(43200), [30, 1440]);
});

test('resumoDosPassos: conta mensagens e esperas e fala o tempo total como a equipe fala', () => {
 const m = texto => ({ tipo: 'mensagem', texto }), e = minutos => ({ tipo: 'espera', minutos });
 assert.equal(resumoDosPassos([m('a')]), '1 mensagem');
 assert.equal(resumoDosPassos([m('a'), e(10), m('b')]), '2 mensagens, 1 espera (10 min no total)');
 assert.equal(resumoDosPassos([m('a'), e(60), m('b'), e(120), m('c')]), '3 mensagens, 2 esperas (3 h no total)');
 assert.equal(resumoDosPassos([m('a'), e(1440), m('b')]), '2 mensagens, 1 espera (1 dia no total)');
 assert.equal(resumoDosPassos([m('a'), e(1440), m('b'), e(2880), m('c')]), '3 mensagens, 2 esperas (3 dias no total)');
});

test('resultadoDoFluxo: o que importa é quantos responderam entre os que já terminaram; sem iniciados, nada', () => {
 assert.equal(resultadoDoFluxo({ iniciados: 0, responderam: 0, sem_resposta: 0 }), null);
 assert.equal(resultadoDoFluxo({ iniciados: 10, responderam: 0, sem_resposta: 0 }), '10 iniciados · sem resultado ainda');
 assert.equal(resultadoDoFluxo({ iniciados: 10, responderam: 3, sem_resposta: 5 }), '10 iniciados · 38% responderam');
 assert.equal(resultadoDoFluxo({ iniciados: 4, responderam: 4, sem_resposta: 0 }), '4 iniciados · 100% responderam');
});
