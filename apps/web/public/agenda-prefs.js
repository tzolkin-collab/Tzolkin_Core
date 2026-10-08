// Preferências da agenda que são DESTE NAVEGADOR (não vão ao servidor). Escolhidas em Configurações → Agenda.
// Cada leitura valida o que está guardado: valor velho ou estranho cai no padrão, nunca quebra a tela.
import { VISOES } from './agenda-model.js';

const CHAVE_INICIO = 'tzolkin-agenda-inicio';
const CHAVE_DURACAO = 'tzolkin-agenda-duracao';
const CHAVE_MEET = 'tzolkin-agenda-meet-auto';
const CHAVE_LOCAL_MEET = 'tzolkin-agenda-meet-local';
const CHAVE_CONVIDAR = 'tzolkin-agenda-meet-convidar-principal';
const CHAVE_JANELA = 'tzolkin-agenda-janela';

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


/** Texto do campo Local quando a sala do Meet é escolhida e o Local está vazio. '' = não preencher. */
export const LOCAL_MEET_PADRAO = 'Google Meet';
export function localDoMeet() {
 const v = ler(CHAVE_LOCAL_MEET);
 return v === null ? LOCAL_MEET_PADRAO : v === '-' ? '' : v.slice(0, 200);
}
export const definirLocalDoMeet = texto => { const t = String(texto ?? '').trim().slice(0, 200); gravar(CHAVE_LOCAL_MEET, t === LOCAL_MEET_PADRAO ? null : t === '' ? '-' : t); };

/** Com a sala do Meet escolhida, o convidado já vem preenchido com o contato principal (com e-mail) da empresa. */
export const convidarContatoPrincipal = () => ler(CHAVE_CONVIDAR) === '1';
export const definirConvidarContatoPrincipal = ligado => gravar(CHAVE_CONVIDAR, ligado ? '1' : null);

/**
 * Como a janela da atividade aparece, escolhido nos ícones ao lado do X: centralizada (a de sempre), popup no canto
 * ou lateral de altura cheia. Fica neste navegador como as demais preferências da agenda, e vale da próxima abertura
 * em diante (trocar no meio do preenchimento só muda o tamanho; nada do formulário se perde).
 */
export const JANELAS = Object.freeze([['centro', 'Centralizado'], ['cheia', 'Tela inteira'], ['lateral', 'Lateral']]);
export const JANELA_PADRAO = 'centro';
export function janelaDoEvento() {
 const v = ler(CHAVE_JANELA);
 return JANELAS.some(([k]) => k === v) ? v : JANELA_PADRAO;
}
export const definirJanelaDoEvento = chave => gravar(CHAVE_JANELA, JANELAS.some(([k]) => k === chave) && chave !== JANELA_PADRAO ? chave : null);
