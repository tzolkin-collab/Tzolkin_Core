import test from 'node:test';
import assert from 'node:assert/strict';
import { duracao, haQuanto, pontosDeAtencao } from '../../apps/web/public/whatsapp-visao.js';

test('duracao: fala como a equipe fala', () => {
 assert.equal(duracao(0.3), 'menos de 1 min');
 assert.equal(duracao(12.4), '12 min');
 assert.equal(duracao(60), '1 h');
 assert.equal(duracao(200), '3 h 20 min');
 assert.equal(duracao(1440), '1 dia');
 assert.equal(duracao(4000), '3 dias');
 for (const nada of [null, undefined, NaN, Infinity]) assert.equal(duracao(nada), null);
});

test('haQuanto: relativo até dois dias, depois a data; entrada ruim vira nada', () => {
 const agora = Date.parse('2026-10-26T20:00:00Z');
 assert.equal(haQuanto('2026-10-26T19:59:40Z', agora), 'agora');
 assert.equal(haQuanto('2026-10-26T19:48:00Z', agora), 'há 12 min');
 assert.equal(haQuanto('2026-10-26T16:30:00Z', agora), 'há 3 h');
 assert.equal(haQuanto('2026-10-25T20:00:00Z', agora), 'ontem');
 assert.match(haQuanto('2026-10-01T12:00:00Z', agora), /\d{2}\/\d{2}\/\d{4}/);
 assert.equal(haQuanto('2026-10-26T20:30:00Z', agora), 'agora', 'relógio adiantado não vira "há -30 min"');
 for (const nada of [null, undefined, '', 'lixo']) assert.equal(haQuanto(nada, agora), null);
});

const instancia = (extra = {}) => ({
 nome: 'teste', conectada: true, webhook: { estado: 'core', segredo: true },
 fila: { na_fila: 0, mais_antiga_min: null, falhas: 0, enviadas: 0 },
 resultado: { periodo_dias: 7, esperas: 0, respondidas: 0, sem_resposta: 0 }, ...extra,
});
const dados = (inst, extra = {}) => ({ envio_ligado: true, instancias: [inst], ...extra });

test('pontosDeAtencao: instância saudável não gera nada', () => {
 assert.deepEqual(pontosDeAtencao(dados(instancia()), 'teste'), []);
});

test('pontosDeAtencao: só olha a instância do Core; as outras são de outros sistemas e não geram alerta', () => {
 const d = { envio_ligado: true, instancias: [instancia({ nome: 'gabi_prod', conectada: false, webhook: { estado: 'outro', host: 'bot.exemplo.com' } }), instancia()] };
 assert.deepEqual(pontosDeAtencao(d, 'teste'), []);
 assert.deepEqual(pontosDeAtencao(d, 'inexistente'), []);
 assert.deepEqual(pontosDeAtencao(null, 'teste'), []);
});

test('pontosDeAtencao: cada problema vira uma frase com a gravidade certa, o mais grave primeiro', () => {
 const tons = d => pontosDeAtencao(d, 'teste').map(([tom]) => tom);
 const textos = d => pontosDeAtencao(d, 'teste').map(([, t]) => t).join(' | ');
 assert.deepEqual(tons(dados(instancia({ conectada: false }))), ['danger']);
 assert.match(textos(dados(instancia({ conectada: false }))), /desconectada/);
 assert.match(textos(dados(instancia({ webhook: { estado: 'sem' } }))), /não tem webhook/);
 const outro = dados(instancia({ webhook: { estado: 'outro', host: 'other-hf.exemplo.com' } }));
 assert.deepEqual(tons(outro), ['danger']);
 assert.match(textos(outro), /aponta para other-hf\.exemplo\.com e não para o Core/);
 assert.match(textos(dados(instancia({ webhook: { estado: 'desligado' } }))), /desligado/);
 assert.deepEqual(tons(dados(instancia({ webhook: { estado: 'core_sem_evento' } }))), ['warning']);
 assert.match(textos(dados(instancia({ webhook: { estado: 'core', segredo: false } }))), /x-webhook-secret/);
 assert.match(textos(dados(instancia({ resultado: { periodo_dias: 7, esperas: 5, respondidas: 3, sem_resposta: 2 } }))), /2 pessoas esperam uma resposta nossa em teste \(7 dias\)/);
 assert.match(textos(dados(instancia({ resultado: { periodo_dias: 7, esperas: 1, respondidas: 0, sem_resposta: 1 } }))), /1 pessoa espera uma resposta/);
 assert.match(textos(dados(instancia({ fila: { na_fila: 0, mais_antiga_min: null, falhas: 3, enviadas: 0 } }))), /3 mensagens falharam/);
 const varios = pontosDeAtencao(dados(instancia({ conectada: false, webhook: { estado: 'sem' }, resultado: { periodo_dias: 7, esperas: 2, respondidas: 0, sem_resposta: 2 } })), 'teste');
 assert.deepEqual(varios.map(([t]) => t), ['danger', 'danger', 'warning']);
});

test('pontosDeAtencao: fila com envio desligado é aviso; com envio ligado, só alerta se a mais antiga passou de 30 min', () => {
 const fila = (na_fila, mais_antiga_min) => ({ na_fila, mais_antiga_min, falhas: 0, enviadas: 0 });
 const desligado = pontosDeAtencao(dados(instancia({ fila: fila(4, 5) }), { envio_ligado: false }), 'teste');
 assert.deepEqual(desligado.map(([t]) => t), ['info']);
 assert.match(desligado[0][1], /4 mensagens esperam na fila e o envio automático está desligado/);
 assert.deepEqual(pontosDeAtencao(dados(instancia({ fila: fila(4, 10) })), 'teste'), [], 'fila andando normal');
 const parada = pontosDeAtencao(dados(instancia({ fila: fila(2, 95) })), 'teste');
 assert.deepEqual(parada.map(([t]) => t), ['warning']);
 assert.match(parada[0][1], /parada: a mensagem mais antiga espera há 1 h 35 min/);
});
