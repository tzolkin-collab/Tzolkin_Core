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
 * ou lateral de altura cheia. O clique vale na hora, na janela aberta (trocar no meio do preenchimento só muda o
 * tamanho; nada do formulário se perde), e fica neste navegador para as próximas aberturas, como as demais
 * preferências da agenda.
 */
export const JANELAS = Object.freeze([['centro', 'Centralizado'], ['cheia', 'Tela inteira'], ['lateral', 'Lateral']]);
export const JANELA_PADRAO = 'centro';
export function janelaDoEvento() {
 const v = ler(CHAVE_JANELA);
 return JANELAS.some(([k]) => k === v) ? v : JANELA_PADRAO;
}
export const definirJanelaDoEvento = chave => gravar(CHAVE_JANELA, JANELAS.some(([k]) => k === chave) && chave !== JANELA_PADRAO ? chave : null);

// ---------- modo de coloração e personalização de categorias e situações ----------
const CHAVE_MODO_COR = 'tzolkin-agenda-modo-cor';
const CHAVE_CONFIG_CATEGORIAS = 'tzolkin-agenda-config-categorias';
const CHAVE_CONFIG_STATUS = 'tzolkin-agenda-config-status';

export const TONS_DISPONIVEIS = Object.freeze([
 ['neutral', 'Neutra'],
 ['accent', 'Destaque'],
 ['info', 'Informação'],
 ['success', 'Sucesso'],
 ['warning', 'Atenção'],
 ['danger', 'Urgente'],
 ['primary', 'Primária'],
]);

export const CATEGORIAS_PADRAO = Object.freeze({
 mentoria:    { rotulo: 'Mentoria',    tom: 'accent',  padrao: true },
 consultoria: { rotulo: 'Consultoria', tom: 'info',    padrao: true },
 software:    { rotulo: 'Software',    tom: 'success', padrao: true },
 educacional: { rotulo: 'Educacional', tom: 'warning', padrao: true },
 assessoria:  { rotulo: 'Assessoria',  tom: 'primary', padrao: true },
 outro:       { rotulo: 'Outro',       tom: 'neutral', padrao: true },
});

export const STATUS_PADRAO = Object.freeze({
 planned:   { rotulo: 'Planejado', tom: 'neutral', padrao: true },
 done:      { rotulo: 'Concluído', tom: 'success', padrao: true },
 cancelled: { rotulo: 'Cancelado', tom: 'danger',  padrao: true },
});

/** 'categoria' ou 'status'. 'categoria' é o padrão. */
export function modoDeCor() {
 const v = ler(CHAVE_MODO_COR);
 return v === 'status' ? 'status' : 'categoria';
}
export function definirModoDeCor(modo) {
 const m = modo === 'status' ? 'status' : 'categoria';
 gravar(CHAVE_MODO_COR, m === 'categoria' ? null : m);
 try { window.dispatchEvent(new CustomEvent('agenda-cores-mudaram', { detail: { tipo: 'modo', modo: m } })); } catch {}
}

const lerJson = chave => {
 try {
  const t = ler(chave);
  return t ? JSON.parse(t) : null;
 } catch {
  return null;
 }
};

/** Retorna o dicionário de categorias configuradas com mesclagem segura sobre os padrões. */
export function obterConfigCategorias() {
 const guardado = lerJson(CHAVE_CONFIG_CATEGORIAS) || {};
 const res = {};
 for (const [id, padrao] of Object.entries(CATEGORIAS_PADRAO)) {
  const g = guardado[id];
  res[id] = {
   rotulo: (g?.rotulo && typeof g.rotulo === 'string' ? g.rotulo.trim() : null) || padrao.rotulo,
   tom: TONS_DISPONIVEIS.some(([t]) => t === g?.tom) ? g.tom : padrao.tom,
   padrao: true,
  };
 }
 for (const [id, g] of Object.entries(guardado)) {
  if (res[id] || !g || typeof g !== 'object') continue;
  const rotulo = typeof g.rotulo === 'string' ? g.rotulo.trim() : '';
  if (!rotulo) continue;
  res[id] = {
   rotulo,
   tom: TONS_DISPONIVEIS.some(([t]) => t === g.tom) ? g.tom : 'neutral',
   padrao: false,
  };
 }
 return res;
}

export function salvarConfigCategorias(config) {
 try {
  gravar(CHAVE_CONFIG_CATEGORIAS, JSON.stringify(config));
  window.dispatchEvent(new CustomEvent('agenda-cores-mudaram', { detail: { tipo: 'categorias' } }));
 } catch {}
}

export function restaurarCategoriasPadrao() {
 try {
  gravar(CHAVE_CONFIG_CATEGORIAS, null);
  window.dispatchEvent(new CustomEvent('agenda-cores-mudaram', { detail: { tipo: 'categorias' } }));
 } catch {}
}

/** Retorna o dicionário de status configurados com mesclagem segura sobre os padrões. */
export function obterConfigStatus() {
 const guardado = lerJson(CHAVE_CONFIG_STATUS) || {};
 const res = {};
 for (const [id, padrao] of Object.entries(STATUS_PADRAO)) {
  const g = guardado[id];
  res[id] = {
   rotulo: (g?.rotulo && typeof g.rotulo === 'string' ? g.rotulo.trim() : null) || padrao.rotulo,
   tom: TONS_DISPONIVEIS.some(([t]) => t === g?.tom) ? g.tom : padrao.tom,
   padrao: true,
  };
 }
 for (const [id, g] of Object.entries(guardado)) {
  if (res[id] || !g || typeof g !== 'object') continue;
  const rotulo = typeof g.rotulo === 'string' ? g.rotulo.trim() : '';
  if (!rotulo) continue;
  res[id] = {
   rotulo,
   tom: TONS_DISPONIVEIS.some(([t]) => t === g.tom) ? g.tom : 'neutral',
   padrao: false,
  };
 }
 return res;
}

export function salvarConfigStatus(config) {
 try {
  gravar(CHAVE_CONFIG_STATUS, JSON.stringify(config));
  window.dispatchEvent(new CustomEvent('agenda-cores-mudaram', { detail: { tipo: 'status' } }));
 } catch {}
}

export function restaurarStatusPadrao() {
 try {
  gravar(CHAVE_CONFIG_STATUS, null);
  window.dispatchEvent(new CustomEvent('agenda-cores-mudaram', { detail: { tipo: 'status' } }));
 } catch {}
}

export function tomDaCategoria(cat) {
 const c = obterConfigCategorias();
 return c[cat]?.tom || CATEGORIAS_PADRAO[cat]?.tom || 'neutral';
}

export function rotuloDaCategoria(cat) {
 const c = obterConfigCategorias();
 return c[cat]?.rotulo || CATEGORIAS_PADRAO[cat]?.rotulo || cat || 'Outro';
}

export function tomDoStatus(st) {
 const s = obterConfigStatus();
 return s[st]?.tom || STATUS_PADRAO[st]?.tom || 'neutral';
}

export function rotuloDoStatus(st) {
 const s = obterConfigStatus();
 return s[st]?.rotulo || STATUS_PADRAO[st]?.rotulo || st || 'Planejado';
}

/** Devolve o tom a ser pintado no evento segundo o modo ativo (categoria ou status). */
export function tomDoEvento(evento) {
 if (!evento) return 'neutral';
 if (modoDeCor() === 'status') return tomDoStatus(evento.status);
 return tomDaCategoria(evento.category);
}

