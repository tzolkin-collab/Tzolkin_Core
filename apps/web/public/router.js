import { $, node } from './dom.js';
import { stateProxy as state, store } from './store.js';
import { createIcon } from './icons.js';
import { registrarTela } from './espacos-nav.js';

export const CONTEXTS = {
  general: {
   label: 'ESPAÇO DE TRABALHO',
   views: {
    // HOJE
    overview: { title: 'Visão geral', section: 'view-overview', metrics: false },
    finance: { title: 'Financeiro', section: 'view-finance', metrics: false },
    tracking: { title: 'Acompanhamento', section: 'view-tracking', metrics: false },
    // CRM
    companies: { title: 'Empresas', desc: "Organizações cadastradas, sejam ou não clientes.", section: 'view-companies', action: ['Nova empresa', 'tenant-dialog'], metrics: false },
    people: { title: 'Pessoas', desc: "Pessoas do relacionamento comercial, separadas dos acessos aos produtos.", section: 'view-people', action: ['Nova pessoa', 'stakeholder-dialog'], metrics: false },
    clients: { title: 'Clientes', desc: "Quem a TZOLKIN atende e o que cada um contratou.", section: 'view-clients', action: ['Novo cliente', 'tenant-dialog'], metrics: false },
    client: { title: 'Cliente', section: 'view-client', hidden: true, metrics: false },
    leads: { title: 'Inbound', desc: "Oportunidades em prospecção, por etapa.", section: 'view-commercial', metrics: false },
    outbound: { title: 'Outbound', desc: "Prospecção ativa e abordagem direta.", section: 'view-outbound', metrics: false },
    emails: { title: 'E-mails', section: 'view-emails', metrics: false },
    whatsapp: { title: 'WhatsApp', section: 'view-whatsapp', metrics: false },
    payments: { title: 'Pagamentos', desc: "Vendas, cobranças e gateways.", section: 'view-payments', metrics: false },
    // PORTFÓLIO
    products: { title: 'Produtos', desc: "O que a TZOLKIN desenvolve e opera.", section: 'view-products', action: ['Novo produto', 'space-dialog'], metrics: false },
    portfolioServices: { title: 'Serviços', desc: "Catálogo de ofertas de serviço, consultoria e mentoria.", section: 'view-portfolio-services', action: ['Novo serviço', 'space-dialog'], metrics: false },
    services: { title: 'Contratações', desc: "Contratações de mentoria, consultoria, assessoria e sob demanda.", section: 'view-services', metrics: false },
    serviceCampaigns: { title: 'Campanhas do serviço', section: 'view-service-campaigns', metrics: false, hidden: true },
    // TECNOLOGIA
    connections: { title: 'Conexões', desc: "O que está ligado a cada cliente, contratação ou item do portfólio. O inventário de cada provedor fica nas abas Vercel, GitHub e EasyPanel.", section: 'view-connections', action: ['Novo projeto', 'delivery-new'], metrics: false },
    automacoes: { title: 'Automações', desc: "As regras que o Core executa sozinho quando algo acontece num funil.", section: 'view-automacoes', metrics: false },
    vercel: { title: 'Vercel', section: 'view-vercel', metrics: false },
    easypanel: { title: 'EasyPanel', section: 'view-easypanel', metrics: false },
    dns: { title: 'DNS', section: 'view-dns', metrics: false },
    github: { title: 'GitHub', section: 'view-github', metrics: false },
    database: { title: 'Banco de dados', section: 'view-database', metrics: false },
    resource: { title: 'Projeto e serviço', section: 'view-resource', metrics: false, hidden: true },
    serverMetrics: { title: 'Métricas de servidor', section: 'view-server-metrics', metrics: false, hidden: true },
    redis: { title: 'Redis e caches', section: 'view-redis', metrics: false, hidden: true },
    access: { title: 'Acessos', section: 'view-access', action: ['Vincular acesso', 'member-dialog'], hidden: true },
    settings: { title: 'Configurações', section: 'view-settings', metrics: false, hidden: true },
    security: { title: 'Segurança', section: 'view-security', metrics: false, hidden: true },
   },
  },
  product: {
   label: 'GESTÃO DO PRODUTO',
   views: {
    product: { title: 'Visão geral', section: 'view-product' },
    // Inbound, Contratações e Recebimentos eram só atalhos da visão geral: quem trabalha no espaço precisava voltar a ela
    // para chegar ao funil. Agora estão no menu; cada um só aparece se o tipo do espaço tem a capacidade (VIEW_CAPABILITIES).
    'product-inbound': { title: 'Inbound', section: 'view-commercial', metrics:false },
    'product-clients': { title: 'Clientes', section: 'view-product-orgs', action: ['Vincular cliente', 'entitlement-dialog'], metrics:false },
    'product-engagements': { title: 'Contratações', section: 'view-product-engagements', metrics:false },
    'product-receivables': { title: 'Recebimentos', section: 'view-product-receivables', metrics:false },
    'product-payments': { title: 'Pagamentos', section: 'view-product-payments', metrics:false },
    'product-emails': { title: 'E-mails', section: 'view-product-emails', metrics:false },
    'product-tracking': { title: 'Acompanhamento', section: 'view-tracking', metrics:false },
    'product-connections': { title: 'Conexões', section: 'view-product-keys', metrics:false },
    'product-keys': { title: 'Chaves de integração', section: 'view-product-keys', metrics:false, hidden:true },
    // "Clientes" aqui nunca foi a carteira: é quem tem acesso a ESTE item, que é o
    // que a tela mostra e o que o botão vincula. No contexto geral, Clientes é a
    // carteira — duas telas com o mesmo nome e conteúdos diferentes ensinavam errado.
    'product-orgs': { title: 'Acessos', section: 'view-product-orgs', action: ['Vincular cliente', 'entitlement-dialog'], hidden:true },
    client: { title: 'Cliente', section: 'view-client', hidden:true, metrics:false },
    // Campanhas do item mora dentro de Inbound, como uma aba (montarInbound).
    // Oculta do menu; o botão Configurações do rodapé abre em qualquer contexto.
    settings: { title: 'Configurações', section: 'view-settings', metrics:false, hidden:true },
   },
  },
};

export const SECTIONS = [
  'view-commercial','view-product-keys','view-tracking', 'view-resource', 'view-overview', 
  'view-clients', 'view-leads', 'view-companies', 'view-client', 'view-people', 'view-products', 'view-services', 
  'view-connections', 'view-access', 'view-database', 'view-redis', 'view-settings', 'view-security', 'view-vercel', 
  'view-github', 'view-easypanel', 'view-dns', 'view-server-metrics', 'view-product', 'view-product-orgs', 
  'view-product-engagements', 'view-product-payments', 'view-product-receivables', 'view-product-emails', 
  'view-service-campaigns', 'view-finance','view-emails','view-whatsapp','view-automacoes', 'view-outbound', 'view-payments', 'view-portfolio-services'
];

export const contextKind = () => (state.context ? 'product' : 'general');
export const views = () => CONTEXTS[contextKind()].views;

export const VIEW_CAPABILITIES = {'product-inbound':['commercial','operate'],'product-keys':['access','commercial'],'product-orgs':['access'],'product-engagements':['commercial'],'product-receivables':['contract_billing']};
export const contextProduct = () => state.product?.product || state.overview?.products?.find(product => product.id === state.context) || null;
export const hasCapability = (product, capability) => Boolean(product?.capabilities?.includes(capability));

const kindRegistry=()=>state.overview?.portfolio_kinds||[];
const canonKind=kind=>state.overview?.kind_aliases?.[kind]||kind;
const kindInfo=kind=>kindRegistry().find(item=>item.kind===canonKind(kind))||null;
export const kindLabelOf=kind=>kindInfo(kind)?.label||'Item';

export const contextKindLabel = () => kindLabelOf(contextProduct()?.portfolio_kind);

export const viewAllowed = key => {
 if (contextKind() !== 'product' || !VIEW_CAPABILITIES[key]) return true;
 const product = contextProduct();
 return VIEW_CAPABILITIES[key].some(capability => hasCapability(product, capability));
};

export const productName = () => state.product?.product?.name || state.context;

export function closeNavigation(){document.body.classList.remove('nav-open');$('nav-toggle').setAttribute('aria-expanded','false');$('nav-backdrop').hidden=true;}
export function openNavigation(){document.body.classList.add('nav-open');$('nav-toggle').setAttribute('aria-expanded','true');$('nav-backdrop').hidden=false;requestAnimationFrame(()=>$('sidebar').focus?.());}

export function renderNav() {
 const context = CONTEXTS[contextKind()];
 $('nav-label').textContent = contextKind() === 'product' ? `GESTÃO · ${contextKindLabel().toUpperCase()}` : context.label;
 // O grupo de cada tela. Segue, chave por chave, a ordem de CONTEXTS.general.views:
 // é o mesmo desenho escrito duas vezes, e a discordância entre os dois é o que o
 // teste de navegação pega antes de virar dois cabeçalhos "Tecnologia" na tela.
 const groups=contextKind()==='general'?{
  overview:'Hoje',finance:'Hoje',tracking:'Hoje',
  companies:'CRM',people:'CRM',clients:'CRM',client:'CRM',leads:'CRM',outbound:'CRM',emails:'CRM',whatsapp:'CRM',payments:'CRM',
  products:'Portfólio',portfolioServices:'Portfólio',services:'Portfólio',serviceCampaigns:'Portfólio',
  connections:'Tecnologia',automacoes:'Tecnologia',vercel:'Tecnologia',easypanel:'Tecnologia',dns:'Tecnologia',github:'Tecnologia',database:'Tecnologia',resource:'Tecnologia',serverMetrics:'Tecnologia',redis:'Tecnologia',access:'Tecnologia',settings:'Tecnologia',security:'Tecnologia',
 }:Object.fromEntries(Object.keys(context.views).map(key=>[key,contextKindLabel()]));
 const items=[];let previous,section;
 for(const [key,view]of Object.entries(context.views).filter(([key,view])=>!view.hidden&&viewAllowed(key))){
  if(groups[key]!==previous){section=node('section',undefined,'nav-section');const label=node('h2',groups[key],'nav-group');section.append(label);items.push(section);previous=groups[key];}
  const atual = state.view === 'client' ? state.clientBack : state.view;
  const button = node('button', undefined, 'nav-item' + (key === atual ? ' active' : ''));
  button.type = 'button'; button.dataset.view = key;
  const icon = createIcon(({overview:'layers',finance:'wallet',tracking:'calendar',companies:'building',people:'people',clients:'building',leads:'user-plus',outbound:'chart',emails:'mail',whatsapp:'message-circle',automacoes:'zap',payments:'wallet',products:'package',portfolioServices:'briefcase',services:'briefcase',connections:'branch',vercel:'cloud',easypanel:'server',dns:'globe',github:'repo',database:'database',access:'shield',redis:'cache',settings:'sliders',security:'lock',serverMetrics:'activity',product:'package','product-tracking':'calendar','product-clients':'people','product-connections':'branch','product-inbound':'user-plus','product-keys':'lock','product-orgs':'people','product-engagements':'briefcase','product-payments':'wallet','product-receivables':'calendar','product-emails':'mail',campaigns:'chart','product-campaigns':'chart',serviceCampaigns:'chart'})[key]);
  icon.classList.add('nav-icon'); button.append(icon, document.createTextNode(view.title));
  if (key === atual) button.setAttribute('aria-current', 'page');
  button.onclick = () => {switchView(key);closeNavigation();};
  section.append(button);
 }
 $('nav').replaceChildren(...items);
}

export function switchView(view) {
 if (!views()[view] || !viewAllowed(view)) view = Object.keys(views())[0];
 const oldView = state.view;
 if (oldView !== view) store.notify('viewChanging', { oldView, newView: view });
 state.view = view;

 document.body.dataset.view = view;
 const active = views()[view];
 const fundo = view === 'client' ? views()[state.clientBack]?.section : null;
 SECTIONS.forEach(id => { const el = $(id); if (el) el.hidden = id !== active.section && id !== fundo; });
 if (view !== 'client') {
  if ($('breadcrumb')) $('breadcrumb').textContent = $('page-title').textContent = active.title;
  if ($('mobile-page-title')) $('mobile-page-title').textContent = active.title;
  if ($('page-desc')) {
   $('page-desc').textContent = active.desc || '';
   $('page-desc').hidden = !active.desc;
  }
  if ($('new-record')) $('new-record').hidden = !active.action;
  if ($('page-title')) $('page-title').closest('.page-heading').hidden = view === 'database';
  if ($('metrics')) $('metrics').hidden = active.metrics === false || !$('metrics').children.length;
  if (active.action && $('new-record-label')) $('new-record-label').textContent = active.action[0];
 }
 if ($('notice')) $('notice').textContent = '';
 if (!active.hidden) registrarTela(state.context, view);
 renderNav();
}

export function setupShell() {
 const toggle = $('nav-toggle');
 if (toggle) toggle.onclick = () => document.body.classList.contains('nav-open') ? closeNavigation() : openNavigation();
 const backdrop = $('nav-backdrop');
 if (backdrop) backdrop.onclick = closeNavigation;
}
