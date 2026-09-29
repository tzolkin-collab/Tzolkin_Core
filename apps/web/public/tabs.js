// Abas horizontais sublinhadas, no estilo das configurações da Stripe.
//
// Serve para uma tela que tem vários tópicos do mesmo assunto (Inbound: Leads e
// Campanhas; Clientes: Todos, Empresas, Pessoas). O componente só desenha as abas e
// avisa qual foi escolhida; quem mostra o conteúdo é a tela, que dá aos painéis os
// ids `${prefixo}-panel-${chave}` para o `aria-controls` de cada aba apontar de verdade.
//
// Acessível como o padrão WAI-ARIA de abas com ativação automática: role=tablist,
// role=tab, aria-selected, tabindex móvel (só a aba ativa entra na ordem de Tab) e
// setas, Home e End para mover.

/**
 * @param {object} opcoes
 * @param {HTMLElement} opcoes.host    onde desenhar (é esvaziado)
 * @param {{key:string,label:string,count?:number}[]} opcoes.tabs
 * @param {string} opcoes.active       chave da aba ativa
 * @param {(key:string)=>void} opcoes.onChange
 * @param {string} opcoes.label        nome da lista de abas para leitor de tela
 * @param {string} [opcoes.prefix]     prefixo dos ids (padrão: o id do host)
 * @param {string} [opcoes.panelId]    id de UM painel compartilhado por todas as abas (quando a tela
 *                                     repinta o mesmo painel em vez de ter um por aba)
 */
export function mountTabs({ host, tabs, active, onChange, label, prefix = host.id || 'tabs', panelId }) {
 let atual = tabs.some(tab => tab.key === active) ? active : tabs[0]?.key;
 const lista = document.createElement('div');
 lista.className = 'tabs'; lista.setAttribute('role', 'tablist'); lista.setAttribute('aria-label', label);
 const botoes = new Map();

 const pintar = () => {
  for (const [key, botao] of botoes) {
   const ativa = key === atual;
   botao.setAttribute('aria-selected', String(ativa));
   botao.tabIndex = ativa ? 0 : -1;
   botao.classList.toggle('active', ativa);
  }
 };
 const escolher = (key, { foco = false } = {}) => {
  if (key === atual) { if (foco) botoes.get(key)?.focus(); return; }
  atual = key; pintar();
  if (foco) botoes.get(key)?.focus();
  onChange(key);
 };

 for (const tab of tabs) {
  const botao = document.createElement('button');
  botao.type = 'button'; botao.className = 'tab'; botao.setAttribute('role', 'tab');
  botao.id = `${prefix}-tab-${tab.key}`; botao.setAttribute('aria-controls', panelId || `${prefix}-panel-${tab.key}`);
  botao.append(document.createTextNode(tab.label));
  if (Number.isFinite(tab.count)) { const contagem = document.createElement('span'); contagem.className = 'tab-count'; contagem.textContent = String(tab.count); botao.append(contagem); }
  botao.onclick = () => escolher(tab.key);
  botao.onkeydown = evento => {
   const i = tabs.findIndex(item => item.key === tab.key);
   const destino = evento.key === 'ArrowRight' ? tabs[(i + 1) % tabs.length]
    : evento.key === 'ArrowLeft' ? tabs[(i - 1 + tabs.length) % tabs.length]
    : evento.key === 'Home' ? tabs[0] : evento.key === 'End' ? tabs[tabs.length - 1] : null;
   if (!destino) return;
   evento.preventDefault(); escolher(destino.key, { foco: true });
  };
  botoes.set(tab.key, botao); lista.append(botao);
 }
 pintar();
 host.replaceChildren(lista);
 return {
  /** Muda a aba por código, sem disparar onChange (quem chama já sabe). */
  select(key) { if (botoes.has(key)) { atual = key; pintar(); } },
  get active() { return atual; },
 };
}
