// Painel lateral das fichas (empresa, lead, pessoa): abre por cima da lista, que continua visível.
//
// Por que painel e não página: abrir uma ficha não pode custar o lugar onde a pessoa estava. Com a lista
// ao fundo, fechar é só voltar; trocar de ficha é clicar em outra linha. Um componente só para todas, então
// cliente, lead e pessoa se comportam igual: abas, Esc fecha, foco fica dentro, foco volta para quem abriu.
//
// O componente não sabe nada de negócio. Quem o usa monta os painéis das abas e diz o que fazer ao fechar
// (`aoFechar`): trocar de tela, recarregar a lista, o que for. `fechar()` só desfaz a parte visual.
import { mountTabs } from './tabs.js';

const el = (tag, texto, classe) => {
 const n = document.createElement(tag);
 if (texto !== undefined && texto !== null) n.textContent = texto;
 if (classe) n.className = classe;
 return n;
};

// Ícones pequenos desenhados aqui (fechar e ampliar): o conjunto do painel não tem os dois.
const NS = 'http://www.w3.org/2000/svg';
function icone(caminhos) {
 const svg = document.createElementNS(NS, 'svg');
 for (const [k, v] of Object.entries({ viewBox: '0 0 24 24', width: 18, height: 18, fill: 'none', stroke: 'currentColor', 'stroke-width': 1.75, 'stroke-linecap': 'round', 'stroke-linejoin': 'round', 'aria-hidden': 'true' })) svg.setAttribute(k, v);
 for (const d of caminhos) { const p = document.createElementNS(NS, 'path'); p.setAttribute('d', d); svg.append(p); }
 return svg;
}
const ICONE_FECHAR = ['M18 6 6 18', 'm6 6 12 12'];
const ICONE_AMPLIAR = ['M15 3h6v6', 'm21 3-7 7', 'M9 21H3v-6', 'm3 21 7-7'];

// Painéis abertos, do mais antigo ao mais novo. Só o de cima responde a Esc e Tab: abrir a ficha de uma pessoa a
// partir da ficha da empresa deixa os dois abertos, e Esc fecha um por vez, de cima para baixo.
const abertos = [];

const FOCAVEIS = 'a[href],button:not([disabled]),input:not([disabled]):not([type=hidden]),select:not([disabled]),textarea:not([disabled]),[tabindex]:not([tabindex="-1"])';

/**
 * @param {object} o
 * @param {HTMLElement} [o.raiz]       elemento existente que vira o painel (a seção da ficha); sem ele, cria um aside
 * @param {string} [o.id]           id do elemento, quando o painel é criado aqui
 * @param {string} o.prefixo           prefixo dos ids das abas (um por painel, para não repetir id na página)
 * @param {string} [o.rotulo]          nome do painel para leitor de tela
 * @param {string} [o.corpoId]         id do corpo, quando o resto do código já o procura por id
 * @param {()=>void} [o.aoFechar]      o que fazer quando a pessoa pede para fechar (X, Esc, clique fora)
 */
export function criarPeek({ raiz, id, prefixo, rotulo = 'Ficha', corpoId, aoFechar } = {}) {
 const aside = raiz || el('aside');
 if (id) aside.id = id;
 aside.classList.add('peek-side');
 aside.setAttribute('role', 'dialog');
 aside.setAttribute('aria-modal', 'true');
 aside.setAttribute('aria-label', rotulo);
 aside.tabIndex = -1;

 const cabeca = el('header', undefined, 'peek-head');
 const titulos = el('div', undefined, 'peek-titles');
 const h2 = el('h2');
 const sub = el('p', undefined, 'peek-sub');
 sub.hidden = true;
 titulos.append(h2, sub);
 const acoes = el('div', undefined, 'peek-head-actions');
 const ampliar = el('button', undefined, 'peek-icon');
 ampliar.type = 'button';
 ampliar.setAttribute('aria-label', 'Ampliar painel');
 ampliar.setAttribute('aria-pressed', 'false');
 ampliar.title = 'Ampliar painel';
 ampliar.append(icone(ICONE_AMPLIAR));
 ampliar.onclick = () => {
  const largo = aside.classList.toggle('peek-wide');
  ampliar.setAttribute('aria-pressed', String(largo));
  ampliar.setAttribute('aria-label', largo ? 'Reduzir painel' : 'Ampliar painel');
  ampliar.title = largo ? 'Reduzir painel' : 'Ampliar painel';
 };
 const fecharBotao = el('button', undefined, 'peek-icon');
 fecharBotao.type = 'button';
 fecharBotao.setAttribute('aria-label', 'Fechar (Esc)');
 fecharBotao.title = 'Fechar (Esc)';
 fecharBotao.append(icone(ICONE_FECHAR));
 acoes.append(ampliar, fecharBotao);
 cabeca.append(titulos, acoes);

 const abasHost = el('div', undefined, 'peek-tabs');
 const corpo = el('div', undefined, 'peek-body');
 if (corpoId) corpo.id = corpoId;
 const rodape = el('footer', undefined, 'peek-foot');
 rodape.hidden = true;
 aside.replaceChildren(cabeca, abasHost, corpo, rodape);

 const controle = {};
 let scrim = null, focoAnterior = null, aberto = false;
 const pedirFechar = () => { if (aoFechar) aoFechar(); else fechar(); };
 fecharBotao.onclick = pedirFechar;

 const aoTeclar = evento => {
  if (abertos.at(-1) !== controle) return;
  // Diálogo de formulário aberto por cima: o Esc é dele.
  if (document.querySelector('dialog[open]')) return;
  if (evento.key === 'Escape') { evento.preventDefault(); pedirFechar(); return; }
  if (evento.key !== 'Tab') return;
  const dentro = [...aside.querySelectorAll(FOCAVEIS)].filter(n => n.offsetParent !== null);
  if (!dentro.length) { evento.preventDefault(); aside.focus(); return; }
  const primeiro = dentro[0], ultimo = dentro[dentro.length - 1];
  if (evento.shiftKey && (document.activeElement === primeiro || document.activeElement === aside)) { evento.preventDefault(); ultimo.focus(); }
  else if (!evento.shiftKey && document.activeElement === ultimo) { evento.preventDefault(); primeiro.focus(); }
  else if (!aside.contains(document.activeElement)) { evento.preventDefault(); primeiro.focus(); }
 };

 function abrir() {
  if (aberto) return;
  aberto = true;
  abertos.push(controle);
  focoAnterior = document.activeElement;
  if (!raiz) document.body.append(aside);
  scrim = el('div', undefined, 'peek-scrim');
  scrim.onclick = pedirFechar;
  document.body.append(scrim);
  document.addEventListener('keydown', aoTeclar);
  aside.focus({ preventScroll: true });
 }

 function fechar() {
  if (!aberto) return;
  aberto = false;
  const posicao = abertos.indexOf(controle);
  if (posicao >= 0) abertos.splice(posicao, 1);
  document.removeEventListener('keydown', aoTeclar);
  scrim?.remove(); scrim = null;
  if (!raiz) aside.remove();
  if (focoAnterior?.isConnected) focoAnterior.focus({ preventScroll: true });
  focoAnterior = null;
 }

 function titulo(texto, subtitulo) {
  h2.textContent = texto;
  sub.textContent = subtitulo || '';
  sub.hidden = !subtitulo;
  aside.setAttribute('aria-label', texto);
 }

 /** Mostra uma mensagem no lugar das abas (carregando, erro). */
 function mensagem(texto, classe = 'empty-list') {
  abasHost.replaceChildren();
  rodape.replaceChildren(); rodape.hidden = true;
  corpo.replaceChildren(el('p', texto, classe));
 }

 /**
  * @param {{key:string,label:string,count?:number,painel:HTMLElement}[]} lista
  * @param {{ativa?:string, aoTrocar?:(key:string)=>void}} [opcoes]
  */
 function abas(lista, { ativa, aoTrocar } = {}) {
  const atual = lista.some(a => a.key === ativa) ? ativa : lista[0]?.key;
  corpo.replaceChildren();
  // Uma aba só (a ficha da pessoa) não precisa de barra de abas.
  abasHost.hidden = lista.length < 2;
  for (const aba of lista) {
   aba.painel.classList.add('peek-panel');
   aba.painel.id = `${prefixo}-panel-${aba.key}`;
   aba.painel.setAttribute('role', 'tabpanel');
   aba.painel.setAttribute('aria-labelledby', `${prefixo}-tab-${aba.key}`);
   aba.painel.hidden = aba.key !== atual;
   corpo.append(aba.painel);
  }
  mountTabs({
   host: abasHost, tabs: lista.map(({ key, label, count }) => ({ key, label, count })), active: atual,
   label: 'Seções da ficha', prefix: prefixo,
   onChange: key => { for (const aba of lista) aba.painel.hidden = aba.key !== key; corpo.scrollTop = 0; aoTrocar?.(key); },
  });
 }

 /** Ações fixas no pé do painel (arquivar, nova contratação...). Lista vazia esconde o pé. */
 function pe(nos) {
  rodape.replaceChildren(...nos);
  rodape.hidden = !nos.length;
 }

 return Object.assign(controle, { el: aside, corpo, titulo, mensagem, abas, pe, abrir, fechar, aberto: () => aberto });
}
