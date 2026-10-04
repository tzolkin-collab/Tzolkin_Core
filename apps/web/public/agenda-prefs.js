// Preferências da agenda que são DESTE NAVEGADOR (não vão ao servidor). Escolhidas em Configurações → Agenda.
// Cada leitura valida o que está guardado: valor velho ou estranho cai no padrão, nunca quebra a tela.
import { VISOES } from './agenda-model.js';

const CHAVE_INICIO = 'tzolkin-agenda-inicio';
const CHAVE_DURACAO = 'tzolkin-agenda-duracao';
const CHAVE_MEET = 'tzolkin-agenda-meet-auto';

export const DURACOES = Object.freeze([[15, '15 minutos'], [30, '30 minutos'], [45, '45 minutos'], [60, '1 hora'], [90, '1 hora e 30 minutos'], [120, '2 horas']]);
export const DURACAO_PADRAO = 60;

const ler = chave => { try { return localStorage.getItem(chave); } catch { return null; } };
const gravar = (chave, valor) => { try { if (valor === null || valor === '') localStorage.removeItem(chave); else localStorage.setItem(chave, String(valor)); } catch { /* navegação privada: vale até recarregar */ } };

/** Minutos de uma atividade nova quando a pessoa só clica ou aperta "Nova atividade". */
export function duracaoPadraoMin() {
 const n = Number(ler(CHAVE_DURACAO));
 return DURACOES.some(([m]) => m === n) ? n : DURACAO_PADRAO;
}
export const definirDuracaoPadrao = min => gravar(CHAVE_DURACAO, min === DURACAO_PADRAO ? null : min);

/** Visão em que a agenda abre. '' = a última que a pessoa usou. */
export function visaoInicial() {
 const v = ler(CHAVE_INICIO);
 return VISOES.includes(v) ? v : '';
}
export const definirVisaoInicial = v => gravar(CHAVE_INICIO, VISOES.includes(v) ? v : null);

/** Atividade nova já abre com "Adicionar videoconferência do Google Meet" marcado (só aparece para quem conectou a conta Google). */
export const meetAutomatico = () => ler(CHAVE_MEET) === '1';
export const definirMeetAutomatico = ligado => gravar(CHAVE_MEET, ligado ? '1' : null);

