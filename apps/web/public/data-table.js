// Tabela mínima das telas de lista (estilo Stripe): linhas finas, sem moldura, sem cartões.
//
// As telas montam as colunas e os dados; aqui só sai o HTML. Não decide nada de negócio:
// quem sabe o que a linha abre é a tela, por `aoAbrir`.
//
// Acessibilidade: a linha inteira é clicável como atalho do mouse, mas o alvo de teclado e de
// leitor de tela é o botão com o nome (`celulaNome`). Por isso a linha não vira role="link":
// isso quebraria a semântica de tabela.

import { createIcon } from './icons.js';

const el = (tag, texto, classe) => {
 const n = document.createElement(tag);
 if (texto !== undefined && texto !== null) n.textContent = texto;
 if (classe) n.className = classe;
 return n;
};

/**
 * Célula com avatar, nome e uma linha de apoio. O nome é um botão quando a linha abre algo.
 * @param {{inicial?:string, nome:string, apoio?:string, aoAbrir?:()=>void, rotulo?:string}} o
 */
export function celulaNome({ inicial, nome, apoio, aoAbrir, rotulo }) {
 const quem = el('div', undefined, 'tbl-who');
 const texto = el('span');
 if (aoAbrir) {
  const botao = el('button', nome, 'tbl-name');
  botao.type = 'button';
  botao.setAttribute('aria-label', rotulo || `Abrir ${nome}`);
  botao.onclick = evento => { evento.stopPropagation(); aoAbrir(); };
  texto.append(botao);
 } else texto.append(el('span', nome, 'tbl-name tbl-name-plain'));
 if (apoio) texto.append(el('small', apoio));
 quem.append(el('span', String(inicial ?? nome).slice(0, 1).toLocaleUpperCase('pt-BR'), 'client-avatar'), texto);
 return quem;
}

/**
 * Tom de cada ESTADO do sistema: o selo diz em que pé a coisa está, e a cor diz se pede atenção.
 * Uma tabela só, para a mesma palavra ter a mesma cor em toda tela (antes cada tela escolhia o seu verde).
 *   success  deu certo / em andamento normal      info     começando ou aguardando alguém
 *   warning  pede atenção                          danger   falhou
 *   accent   marcador de papel (principal...)      neutral  encerrado, arquivado, ou só classificação
 * Estado que não está aqui sai neutro: melhor sem cor do que com a cor errada.
 */
export const TOM_DO_ESTADO = Object.freeze({
 // ciclo de vida da empresa e situação da contratação
 active: 'success', onboarding: 'info', planned: 'info', lead: 'accent', paused: 'warning',
 completed: 'neutral', discontinued: 'neutral', unclassified: 'warning',
 // etapa do lead
 open: 'info', qualified: 'accent', won: 'success', lost: 'neutral', archived: 'neutral',
});
export const TONS = Object.freeze(['neutral', 'success', 'warning', 'danger', 'info', 'accent', 'primary']);
export const tomDoEstado = estado => TOM_DO_ESTADO[estado] || 'neutral';

/** Selo no padrão do painel: `status` + o tom (neutral | success | warning | danger | info | accent). Os nomes antigos
 * (active, building, failed) ainda valem como apelido no CSS. */
export const selo = (texto, tom = '') => el('span', texto, `status${tom ? ' ' + tom : ''}`);

/**
 * @param {object} o
 * @param {{titulo:string, num?:boolean, classe?:string, celula:(linha:any)=>Node|string|null|undefined}[]} o.colunas
 * @param {any[]} o.linhas
 * @param {(linha:any)=>void} [o.aoAbrir]  abre a linha ao clicar fora de botões e links
 * @param {string} [o.legenda]             nome da tabela para leitor de tela
 * @returns {HTMLElement}
 */
export function tabela({ colunas, linhas, aoAbrir, legenda }) {
 const raiz = el('div', undefined, 'table-container tbl-wrap');
 const t = el('table', undefined, 'tbl');
 if (legenda) t.setAttribute('aria-label', legenda);
 const cabeca = el('tr');
 for (const c of colunas) {
  const th = el('th', c.titulo, c.num ? 'num' : c.classe || '');
  th.scope = 'col';
  cabeca.append(th);
 }
 const cabecalho = el('thead');
 cabecalho.append(cabeca);
 t.append(cabecalho);
 const corpo = el('tbody');
 for (const linha of linhas) {
  const tr = el('tr', undefined, aoAbrir ? 'is-clickable' : '');
  for (const c of colunas) {
   const td = el('td', undefined, [c.num ? 'num' : '', c.classe || ''].filter(Boolean).join(' '));
   const valor = c.celula(linha);
   if (valor instanceof Node) td.append(valor);
   else if (valor === null || valor === undefined || valor === '') { if (c.titulo) { td.textContent = '—'; td.classList.add('tbl-empty-cell'); } }
   else td.textContent = String(valor);
   tr.append(td);
  }
  if (aoAbrir) tr.onclick = evento => { if (!evento.target.closest('button,a,select,input,label')) aoAbrir(linha); };
  corpo.append(tr);
 }
 t.append(corpo);
 raiz.append(t);
 return raiz;
}

/** Linha de resumo discreta (no lugar de cartões de métrica): "2 contratações · 0 com projeto". */
export function resumo(partes) {
 const p = el('p', undefined, 'tbl-summary');
 partes.filter(([, valor]) => valor !== null && valor !== undefined).forEach(([rotulo, valor], i) => {
  if (i) p.append(document.createTextNode('  ·  '));
  p.append(el('strong', String(valor)), document.createTextNode(' ' + rotulo));
 });
 return p;
}

/**
 * O botão de editar do painel. Antes havia cinco: engrenagem, lápis, só texto, secundário e link cinza.
 * Agora é um só: lápis + palavra, contorno fino. `grande` (40px) é o do cabeçalho de uma ficha, ao lado do
 * botão principal; o padrão (32px) é o da linha de uma lista.
 * `aria` diz O QUE se edita ("Editar Empresa Alfa"): vários "Editar" iguais numa lista não dizem nada
 * para quem usa leitor de tela.
 * @param {{texto?:string, aria?:string, aoClicar?:()=>void, grande?:boolean}} [o]
 */
export function botaoEditar({ texto = 'Editar', aria, aoClicar, grande = false } = {}) {
 const botao = el('button', undefined, grande ? 'edit-action grande' : 'edit-action');
 botao.type = 'button';
 botao.append(createIcon('pencil'), document.createTextNode(texto));
 if (aria) botao.setAttribute('aria-label', aria);
 if (aoClicar) botao.onclick = aoClicar;
 return botao;
}
