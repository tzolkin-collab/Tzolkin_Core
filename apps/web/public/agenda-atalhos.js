// A lista de atalhos da agenda, num lugar só: a janela do "?" na agenda e Configurações → Teclado desenham a mesma coisa.
import { el } from './agenda-dom.js';

export const ATALHOS = Object.freeze([
 ['Navegar', [['t', 'Hoje'], ['← →  ou  p n', 'Período anterior / próximo'], ['d  w  m  a', 'Dia, semana, mês, agenda'], ['/', 'Buscar']]],
 ['Atividades', [['c', 'Nova atividade'], ['Enter', 'Abrir o evento focado'], ['↑ ↓', 'Mover o evento focado 15 min'], ['← →', 'Mover o evento focado 1 dia'], ['Shift + ↑ ↓', 'Esticar ou encurtar o fim'], ['Ctrl/⌘ + Z', 'Desfazer a última mudança de horário'], ['Esc', 'Cancelar um arraste ou fechar']]],
]);

/** Um <dl> por grupo, com as teclas em <kbd>. Devolve os nós; quem chama decide onde pôr. */
export function listaDeAtalhos() {
 return ATALHOS.map(([grupo, itens]) => {
  const dl = el('dl', null, 'ag-atalhos-lista'); dl.append(el('h3', grupo));
  for (const [teclas, texto] of itens) {
   const linha = el('div'), dt = el('dt');
   for (const t of teclas.split(/(\s{2}ou\s{2}|\s\+\s)/)) dt.append(/^\s/.test(t) ? document.createTextNode(t.trim() === '+' ? ' + ' : ' ou ') : el('kbd', t.trim()));
   linha.append(dt, el('dd', texto)); dl.append(linha);
  }
  return dl;
 });
}
