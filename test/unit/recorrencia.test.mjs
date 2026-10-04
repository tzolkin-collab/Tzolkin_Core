// Recorrência da agenda: de uma regra (semanal ou mensal) saem as datas. Calendário de 2026: 5/10 é segunda, 4/10 é domingo.
import test from 'node:test';
import assert from 'node:assert/strict';
import { ocorrencias, descrever, instanteDe, hojeEmBrasilia, somarDias, diaDaSemana, HORIZONTE_DIAS, MAX_OCORRENCIAS } from '../../apps/api/src/platform/recorrencia.mjs';

const semanal = (extra = {}) => ({ frequency: 'weekly', interval_n: 1, weekdays: [0], starts_on: '2026-10-05', ...extra });
const mensal = (extra = {}) => ({ frequency: 'monthly', interval_n: 1, month_day: 15, starts_on: '2026-10-01', ...extra });
const dias = (regra, hoje = '2026-10-04') => ocorrencias(regra, hoje).map(o => o.dia);

test('calendário de referência: 5/10/2026 é segunda e 4/10/2026 é domingo', () => {
 assert.equal(diaDaSemana('2026-10-05'), 0);
 assert.equal(diaDaSemana('2026-10-04'), 6);
 assert.equal(somarDias('2026-12-31', 1), '2027-01-01');
});

test('semanal: nos dias escolhidos, na ordem, a partir da data de início', () => {
 const r = ocorrencias(semanal({ weekdays: [0, 2], count_limit: 5 }), '2026-10-04');
 assert.deepEqual(r.map(o => o.dia), ['2026-10-05', '2026-10-07', '2026-10-12', '2026-10-14', '2026-10-19']);
 assert.deepEqual(r.map(o => o.ordinal), [0, 1, 2, 3, 4], 'a posição na série é 0, 1, 2…');
});

test('semanal: a primeira ocorrência nunca é anterior ao início (começar numa quarta com repetição só na segunda)', () => {
 assert.deepEqual(dias(semanal({ starts_on: '2026-10-07', weekdays: [0], count_limit: 3 })), ['2026-10-12', '2026-10-19', '2026-10-26']);
});

test('semanal: começar num domingo — a semana começa na segunda, então o domingo é o fim dela e a segunda seguinte vem logo depois', () => {
 assert.deepEqual(dias(semanal({ starts_on: '2026-10-04', weekdays: [6, 0], count_limit: 4 })), ['2026-10-04', '2026-10-05', '2026-10-11', '2026-10-12']);
 assert.deepEqual(dias(semanal({ starts_on: '2026-10-04', weekdays: [6], count_limit: 2 })), ['2026-10-04', '2026-10-11']);
});

test('semanal: dias fora de ordem e repetidos dão o mesmo resultado', () => {
 const a = dias(semanal({ weekdays: [4, 0, 4, 2], count_limit: 6 }));
 const b = dias(semanal({ weekdays: [0, 2, 4], count_limit: 6 }));
 assert.deepEqual(a, b);
});

test('semanal a cada N semanas: pula as semanas, contando a partir da semana do início', () => {
 assert.deepEqual(dias(semanal({ interval_n: 2, count_limit: 4 })), ['2026-10-05', '2026-10-19', '2026-11-02', '2026-11-16']);
 // começando numa quarta, a "semana de referência" é a da quarta; a segunda da semana seguinte NÃO conta (semana pulada)
 assert.deepEqual(dias(semanal({ starts_on: '2026-10-07', interval_n: 2, weekdays: [2, 0], count_limit: 4 })), ['2026-10-07', '2026-10-19', '2026-10-21', '2026-11-02']);
});

test('semanal: atravessa a virada do ano', () => {
 const r = dias(semanal({ starts_on: '2026-12-28', weekdays: [0, 4], count_limit: 4 }), '2026-12-20');
 assert.deepEqual(r, ['2026-12-28', '2027-01-01', '2027-01-04', '2027-01-08']);
});

test('mensal: no dia escolhido; se o dia do início do mês já passou, começa no mês seguinte', () => {
 assert.deepEqual(dias(mensal({ starts_on: '2026-10-10', count_limit: 3 })), ['2026-10-15', '2026-11-15', '2026-12-15']);
 assert.deepEqual(dias(mensal({ starts_on: '2026-10-20', count_limit: 3 })), ['2026-11-15', '2026-12-15', '2027-01-15']);
 assert.deepEqual(dias(mensal({ starts_on: '2026-10-15', count_limit: 2 })), ['2026-10-15', '2026-11-15'], 'começar no próprio dia vale');
});

test('mensal: mês sem o dia usa o ÚLTIMO dia do mês (31 em abril, 30 e 31 em fevereiro), inclusive ano bissexto', () => {
 const r = dias(mensal({ month_day: 31, starts_on: '2027-01-01', count_limit: 7 }), '2026-12-20');
 assert.deepEqual(r, ['2027-01-31', '2027-02-28', '2027-03-31', '2027-04-30', '2027-05-31', '2027-06-30', '2027-07-31']);
 assert.deepEqual(dias(mensal({ month_day: 30, starts_on: '2028-01-01', count_limit: 3 }), '2027-12-20'), ['2028-01-30', '2028-02-29', '2028-03-30'], '2028 é bissexto');
 assert.deepEqual(dias(mensal({ month_day: 29, starts_on: '2027-01-01', count_limit: 3 }), '2026-12-20'), ['2027-01-29', '2027-02-28', '2027-03-29']);
});

test('mensal a cada N meses, e virada do ano', () => {
 assert.deepEqual(dias(mensal({ month_day: 31, interval_n: 3, starts_on: '2026-01-31', count_limit: 5 }), '2026-01-01'), ['2026-01-31', '2026-04-30', '2026-07-31', '2026-10-31', '2027-01-31']);
 assert.deepEqual(dias(mensal({ month_day: 10, starts_on: '2026-11-01', count_limit: 4 })), ['2026-11-10', '2026-12-10', '2027-01-10', '2027-02-10']);
});

test('fim por data: a última ocorrência é a última que cabe até ela (e o próprio dia do fim vale)', () => {
 assert.deepEqual(dias(semanal({ ends_on: '2026-10-19' })), ['2026-10-05', '2026-10-12', '2026-10-19']);
 assert.deepEqual(dias(semanal({ ends_on: '2026-10-18' })), ['2026-10-05', '2026-10-12']);
 assert.deepEqual(dias(mensal({ ends_on: '2026-12-14' })), ['2026-10-15', '2026-11-15']);
 assert.deepEqual(dias(semanal({ ends_on: '2026-10-05' })), ['2026-10-05'], 'fim no próprio dia do início: uma ocorrência');
});

test('limite de vezes e data de fim juntos: vale o que acontecer primeiro', () => {
 assert.equal(dias(semanal({ count_limit: 2, ends_on: '2027-12-31' })).length, 2);
 assert.equal(dias(semanal({ count_limit: 50, ends_on: '2026-10-26' })).length, 4);
 assert.equal(dias(semanal({ count_limit: 1 })).length, 1);
});

test('limite de vezes conta desde o início da série, não da janela: a posição não depende de "hoje"', () => {
 const cedo = ocorrencias(semanal({ count_limit: 6 }), '2026-10-04');
 const tarde = ocorrencias(semanal({ count_limit: 6 }), '2026-10-30');
 assert.deepEqual(tarde, cedo);
});

test('sem fim: vai até 13 meses à frente e nunca passa do teto de segurança', () => {
 const r = ocorrencias(semanal({ weekdays: [0] }), '2026-10-04');
 const ultimo = r.at(-1).dia;
 assert.ok(ultimo <= somarDias('2026-10-05', HORIZONTE_DIAS), 'não passa do horizonte: ' + ultimo);
 assert.ok(ultimo > somarDias('2026-10-05', HORIZONTE_DIAS - 8), 'chega perto do horizonte: ' + ultimo);
 assert.ok(r.length >= 57 && r.length <= 58, 'uma por semana por ~13 meses: ' + r.length);
 const todosOsDias = ocorrencias(semanal({ weekdays: [0, 1, 2, 3, 4, 5, 6] }), '2026-10-04');
 assert.equal(todosOsDias.length, MAX_OCORRENCIAS, 'teto de ' + MAX_OCORRENCIAS);
});

test('estender o horizonte não muda as posições já geradas (é o que permite o job gerar de novo sem duplicar)', () => {
 const regra = semanal({ weekdays: [0, 3] });
 const hoje1 = ocorrencias(regra, '2026-10-04'), hoje2 = ocorrencias(regra, '2027-03-01');
 assert.deepEqual(hoje2.slice(0, hoje1.length), hoje1.slice(0, hoje1.length).map(o => o), 'o começo é igual');
 assert.ok(hoje2.length > hoje1.length, 'mais datas com o horizonte mais longe');
 assert.deepEqual(hoje2.map(o => o.ordinal), hoje2.map((_, i) => i), 'posições contínuas 0..n-1');
});

test('série sem nenhuma data possível devolve lista vazia (o fim vem antes da primeira data)', () => {
 assert.deepEqual(ocorrencias(semanal({ starts_on: '2026-10-07', weekdays: [0], ends_on: '2026-10-09' }), '2026-10-04'), []);
 assert.deepEqual(ocorrencias(mensal({ starts_on: '2026-10-20', month_day: 15, ends_on: '2026-10-31' }), '2026-10-04'), []);
});

test('horário de Brasília -> instante, e o dia de hoje vem do relógio de Brasília (não do UTC)', () => {
 assert.equal(instanteDe('2026-10-04', '14:30'), '2026-10-04T17:30:00.000Z');
 assert.equal(instanteDe('2026-10-04', '14:30:00'), '2026-10-04T17:30:00.000Z', 'aceita HH:MM:SS (o que o banco devolve)');
 assert.equal(instanteDe('2026-10-04', '23:30'), '2026-10-05T02:30:00.000Z', 'passa da meia-noite em UTC');
 assert.equal(hojeEmBrasilia(Date.parse('2026-10-04T02:30:00Z')), '2026-10-03', '23:30 de sábado em Brasília');
 assert.equal(hojeEmBrasilia(Date.parse('2026-10-04T03:00:00Z')), '2026-10-04');
});

test('texto da repetição, em português', () => {
 assert.equal(descrever(semanal({ weekdays: [0] })), 'Toda segunda');
 assert.equal(descrever(semanal({ weekdays: [2, 0] })), 'Toda segunda e quarta');
 assert.equal(descrever(semanal({ weekdays: [0, 2, 4] })), 'Toda segunda, quarta e sexta');
 assert.equal(descrever(semanal({ weekdays: [5] })), 'Todo sábado');
 assert.equal(descrever(semanal({ weekdays: [5, 6] })), 'Todo sábado e domingo');
 assert.equal(descrever(semanal({ weekdays: [4], interval_n: 2 })), 'A cada 2 semanas: sexta');
 assert.equal(descrever(mensal()), 'Todo mês, no dia 15');
 assert.equal(descrever(mensal({ interval_n: 3 })), 'A cada 3 meses, no dia 15');
 assert.equal(descrever(semanal({ ends_on: '2026-12-31' })), 'Toda segunda, até 31/12/2026');
 assert.equal(descrever(mensal({ count_limit: 6 })), 'Todo mês, no dia 15, 6 vezes');
 assert.equal(descrever(mensal({ count_limit: 1 })), 'Todo mês, no dia 15, 1 vez');
});
