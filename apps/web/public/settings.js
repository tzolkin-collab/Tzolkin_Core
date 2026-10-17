// Configurações: a casca. Coluna de seções, selo de escopo e a seção aberta. O que cada seção faz está no módulo dela
// (config-*.js, notificacoes.js); o que existe e de quem é, em config-indice.js. Plano: docs/CONFIGURACOES.md.
import { SECOES, GRUPOS, SECAO_PADRAO, secaoPorId, seloDeEscopo } from './config-indice.js';

const no = (tag, texto, classe) => {
 const e = document.createElement(tag);
 if (texto !== undefined) e.textContent = texto;
 if (classe) e.className = classe;
 return e;
};

/**
 * `secao`: a que abre primeiro (cai na padrão se não existir). `aoMudar(id)`: avisa quando a pessoa troca de seção.
 * Cada seção é um módulo carregado só quando aberta e exporta `montar(raiz, { api })`.
 */
export function montarConfiguracoes(raiz, { api, secao, aoMudar, abrirTela, retorno } = {}) {
 const casca = no('div', undefined, 'cfg');
 const nav = no('nav', undefined, 'cfg-nav'); nav.setAttribute('aria-label', 'Seções de Configurações');
 const corpo = no('section', undefined, 'cfg-corpo');
 casca.append(nav, corpo);
 raiz.replaceChildren(casca);
 let ticket = 0;

 const seletorMobile = no('label', undefined, 'cfg-nav-mobile');
 seletorMobile.append(no('span', 'Seção', 'cfg-nav-mobile-rotulo'));
 const select = document.createElement('select');
 select.className = 'cfg-select-mobile';
 select.setAttribute('aria-label', 'Seção de Configurações');
 for (const grupo of GRUPOS) {
  const optgroup = document.createElement('optgroup');
  optgroup.label = grupo;
  const bloco = no('div', undefined, 'cfg-grupo');
  bloco.append(no('h2', grupo, 'cfg-grupo-titulo'));
  for (const s of SECOES.filter(x => x.grupo === grupo)) {
   const b = no('button', s.titulo, 'cfg-item'); b.type = 'button'; b.dataset.secao = s.id;
   b.onclick = () => abrir(s.id, true);
   bloco.append(b);
   const opt = no('option', s.titulo); opt.value = s.id;
   optgroup.append(opt);
  }
  select.append(optgroup);
  nav.append(bloco);
 }
 select.onchange = () => abrir(select.value, true);
 seletorMobile.append(select);
 nav.prepend(seletorMobile);

 async function abrir(id, avisar = false) {
  const s = secaoPorId(id) || secaoPorId(SECAO_PADRAO);
  const meu = ++ticket;
  select.value = s.id;
  for (const b of nav.querySelectorAll('.cfg-item')) { if (b.dataset.secao === s.id) b.setAttribute('aria-current', 'page'); else b.removeAttribute('aria-current'); }
  const cab = no('header', undefined, 'cfg-cab');
  const titulo = no('h2', s.titulo, 'cfg-titulo-secao'); titulo.tabIndex = -1;
  cab.append(titulo);
  if (s.escopo) cab.append(seloDeEscopo(s.escopo));   // seção de escopo misto (null): cada bloco traz o seu selo
  const conteudo = no('div', undefined, 'cfg-conteudo');
  corpo.replaceChildren(cab, no('p', s.descricao, 'config-ajuda'), conteudo);
  if (avisar) aoMudar?.(s.id);   // o foco fica no item clicado: quem navega pelas setas/Tab continua na lista
  try {
   const modulo = await s.carregar();
   if (meu !== ticket) return;
   modulo.montar(conteudo, { api, abrirTela, retorno: s.id === secao ? retorno : undefined, irPara: id => abrir(id, true) });
  } catch {
   if (meu === ticket) conteudo.replaceChildren(no('p', 'Não foi possível abrir esta seção. Recarregue a página.', 'config-ajuda'));
  }
 }

 abrir(secao);
}
