import {setupCommercial} from './commercial.js';
import {RELACIONAMENTOS, TIPOS, SITUACOES} from './client-edit.js';
import {campoInline, pares} from './inline-edit.js';
import {describe as describeHistory} from './client-history.js';
import {photoPanel} from './media.js';
// Apresentação e serialização de formulários. Autorização, recorte por produto
// e regras de negócio ficam no servidor: nada aqui decide o que o operador pode ver.
import { setupDelivery, deliveryIcon } from './delivery.js';
import { setupResource } from './resource.js';
import {providerLogo,createIcon,productFavicon,faviconDoSite} from './icons.js';
import {paymentInstitution} from './finance-model.js';
import {setupEmails} from './emails.js';
import {setupTracking} from './tracking.js';
import {setupFinance} from './finance.js';
import {setupBilling} from './billing.js';
import {setupProductPayments} from './product-payments.js';
import {setupServiceReceivables} from './service-receivables.js';
import {setupProductEmails} from './product-emails.js';
import {renderDatabaseWorkspace} from './management-workspace.js';
import {setupCampaigns} from './campaigns.js';
import {setupConnections, casaConexao} from './connections.js';
import {achatar} from './owner-suggestions.js';
import {vinculoNaLista} from './owner-link.js';
import {mountTabs} from './tabs.js';
import {tabela, celulaNome, selo, resumo, botaoEditar, tomDoEstado} from './data-table.js';
import {criarPeek} from './peek.js';
import {montarConfiguracoes} from './settings.js';
import {vigiarLogos} from './logo-tema.js';
import {slugDoNome, mountTagInput} from './space-form.js';
// Ficha da empresa por callback: os módulos não importam app.js (evita ciclo).
const commercial=setupCommercial({api,openTenant:id=>openClient(id)});
const billing=setupBilling({api});
const productPayments=setupProductPayments({api,billing});
const serviceReceivables=setupServiceReceivables({api});
const emails=setupEmails({api,configure:product=>openProductModule(product,'product-emails')});
const productEmails=setupProductEmails({api});
const campaigns=setupCampaigns({api,onError:reportError});
const finance=setupFinance({api});
const tracking=setupTracking({api,openTenant:id=>openClient(id)});
// Conexões devolve a lista ativa ao painel: quem confirma um deploy aqui muda o
// endereço público do item no portfólio, e a tela ao lado não pode ficar velha.
const connections=setupConnections({api,openTenant:id=>openClient(id),openProduct:id=>switchContext(id).catch(reportError),
 projectFor:dono=>delivery.projectFor(dono),openProject:project=>delivery.open(project),activateProject:project=>delivery.activate(project),goTo:view=>switchView(view),
 onChanged:async ativas=>{
 state.resourceBindings=ativas;
 state.topology=await api('/api/products/topology').catch(()=>state.topology);
 if(state.overview)renderGeneral();
}});
const $ = id => document.getElementById(id);
fetch('/api/auth/mode').then(r=>r.ok?r.json():null).then(auth=>{const oidc=auth?.mode==='google-oidc';$('login-form').hidden=oidc;$('google-login').hidden=!oidc;if(oidc&&new URLSearchParams(location.search).has('auth_error'))$('login-notice').textContent='Conta Google não autorizada ou login expirado.';}).catch(()=>{$('login-notice').textContent='Não foi possível verificar o modo de acesso. Atualize a página.';});
$('plan-help').textContent='Use o slug de uma oferta deste produto. Ele identifica as condições comerciais copiadas para o contrato.';

const state = { context: '', view: 'overview', overview: null, product: null, catalog: [], deploys: [], resourceBindings: [], infrastructure: null, management: null, dns: null, topology: null, security: null, selectedTenant: null, clientSummary: null, clientBack: 'clients', inboundTab: 'leads', configSecao: '', configRetorno: '', portfolioTab: 'all', clientTab: 'all', clientPage: 0, empresaAba: 'geral' };
// Painel lateral da ficha da empresa (criado na primeira abertura; ver peekDaEmpresa).
let peekEmpresa = null;
// Painel lateral da ficha da pessoa (criado na primeira abertura; ver abrirPessoa).
let peekPessoa = null;
let loadGeneration = 0;

// Cada contexto declara a própria navegação. Menu só existe quando há dado real por trás.
//
// A ORDEM DAS CHAVES É A ORDEM DA NAVEGAÇÃO. renderNav abre um grupo novo toda vez
// que o grupo da tela muda, então uma tela fora de lugar não fica só fora de lugar:
// ela parte o grupo dela em dois cabeçalhos iguais. As telas ocultas ficam junto do
// grupo a que pertencem pelo mesmo motivo — o dia em que uma delas for revelada, a
// sequência continua certa. test/unit/web-nav.test.mjs afirma a sequência inteira.
const CONTEXTS = {
 general: {
  label: 'ESPAÇO DE TRABALHO',
  views: {
   // HOJE — o que se olha antes de decidir qualquer coisa.
   overview: { title: 'Visão geral', section: 'view-overview', metrics: false },
   finance: { title: 'Financeiro', section: 'view-finance', metrics:false },
   // RELACIONAMENTOS — com quem a TZOLKIN fala.
   companies: { title: 'Empresas', desc: "Organizações cadastradas, sejam ou não clientes.", section: 'view-companies', action: ['Nova empresa', 'tenant-dialog'], metrics:false },
   people: { title: 'Pessoas', desc: "Pessoas do relacionamento comercial, separadas dos acessos aos produtos.", section: 'view-people', action: ['Nova pessoa', 'stakeholder-dialog'], metrics:false },
   clients: { title: 'Clientes', desc: "Quem a TZOLKIN atende e o que cada um contratou.", section: 'view-clients', action: ['Novo cliente', 'tenant-dialog'], metrics:false },
   leads: { title: 'Inbound', desc: "Oportunidades em prospecção, por etapa.", section: 'view-commercial', metrics:false },
   // Campanhas mora dentro de Inbound, como uma aba (montarInbound).
   // Antes oculta (eram só rascunhos). Agora tem fila de envio de verdade: Atividade mostra o que saiu, o que está na fila e o que falhou.
   emails: { title: 'E-mails', section: 'view-emails', metrics:false },
   client: { title: 'Cliente', section: 'view-client', hidden:true, metrics:false },
   // PORTFÓLIO — o que a TZOLKIN tem para vender.
   products: { title: 'Portfólio', desc: "O que a TZOLKIN vende e opera.", section: 'view-products', action: ['Novo espaço', 'space-dialog'], metrics:false },
   // ENTREGA — o trabalho contratado e o andamento dele.
   services: { title: 'Serviços', desc: "Contratações de mentoria, consultoria, assessoria e sob demanda.", section: 'view-services', metrics:false },
   // A atividade e as horas pertencem a uma contratação (migração 041).
   tracking: { title: 'Acompanhamento', section: 'view-tracking', metrics:false },
   serviceCampaigns: { title: 'Campanhas do serviço', section: 'view-service-campaigns', metrics: false, hidden:true },
   // TECNOLOGIA — Conexões diz de quem é cada recurso; uma tela por provedor diz onde ele está.
   connections: { title: 'Conexões', desc: "O que está ligado a cada cliente, contratação ou item do portfólio. O inventário de cada provedor fica nas abas Vercel, GitHub e EasyPanel.", section: 'view-connections', action: ['Novo projeto', 'delivery-new'], metrics:false },
   vercel: { title: 'Vercel', section: 'view-vercel', metrics: false },
   github: { title: 'GitHub', section: 'view-github', metrics: false },
   easypanel: { title: 'EasyPanel', section: 'view-easypanel', metrics: false },
   dns: { title: 'DNS', section: 'view-dns', metrics: false },
   resource: { title: 'Projeto e serviço', section: 'view-resource', metrics: false, hidden:true },
   serverMetrics: { title: 'Métricas de servidor', section: 'view-server-metrics', metrics:false, hidden:true },
   // BASES DE DADOS
   database: { title: 'Banco de dados', section: 'view-database', metrics:false },
   // Oculta: todo número da tela é "Não exposto"; volta com métricas de verdade.
   redis: { title: 'Redis e caches', section: 'view-redis', metrics:false, hidden:true },
   // ADMINISTRAÇÃO
   // Acesso a produto é assunto do contexto de produto; no geral a tela só mostrava vazio.
   access: { title: 'Acessos', section: 'view-access', action: ['Vincular acesso', 'member-dialog'], hidden:true },
   settings: { title: 'Configurações', section: 'view-settings', metrics:false },
   security: { title: 'Segurança', section: 'view-security', metrics:false, hidden:true },
  },
 },
 product: {
  label: 'GESTÃO DO PRODUTO',
  views: {
   product: { title: 'Visão geral', section: 'view-product' },
   'product-inbound': {title:'Inbound',section:'view-commercial',metrics:false},
   'product-keys': {title:'Chaves de integração',section:'view-product-keys',metrics:false},
   // "Clientes" aqui nunca foi a carteira: é quem tem acesso a ESTE item, que é o
   // que a tela mostra e o que o botão vincula. No contexto geral, Clientes é a
   // carteira — duas telas com o mesmo nome e conteúdos diferentes ensinavam errado.
   'product-orgs': { title: 'Acessos', section: 'view-product-orgs', action: ['Vincular cliente', 'entitlement-dialog'] },
   'product-engagements': { title: 'Contratações', section: 'view-product-engagements', metrics:false },
   'product-payments': { title: 'Cobrança', section: 'view-product-payments', metrics:false },
   'product-receivables': { title: 'Recebimentos', section: 'view-product-receivables', metrics:false },
   'product-emails': { title: 'E-mails', section: 'view-product-emails', metrics:false },
   // Campanhas do item mora dentro de Inbound, como uma aba (montarInbound).
   // Oculta do menu; o botão Configurações do rodapé abre em qualquer contexto.
   settings: { title: 'Configurações', section: 'view-settings', metrics:false, hidden:true },
  },
 },
};

const SECTIONS = ['view-commercial','view-product-keys','view-tracking', 'view-resource', 'view-overview', 'view-clients', 'view-leads', 'view-companies', 'view-client', 'view-people', 'view-products', 'view-services', 'view-connections', 'view-access', 'view-database', 'view-redis', 'view-settings', 'view-security', 'view-vercel', 'view-github', 'view-easypanel', 'view-dns', 'view-server-metrics', 'view-product', 'view-product-orgs', 'view-product-engagements', 'view-product-payments', 'view-product-receivables', 'view-product-emails', 'view-service-campaigns'];
const DATA_NODES = ['tenants', 'leads', 'companies', 'client-detail', 'stakeholder-directory', 'members', 'contracts', 'product-catalog', 'services-list', 'services-summary', 'management-schema', 'management-dns', 'management-redis', 'overview-kpis', 'overview-alerts', 'overview-integrations', 'overview-product-list', 'overview-actions', 'product-orgs', 'product-engagements', 'product-record', 'product-rights', 'metrics', 'deploys-list', 'deploys-status'];
SECTIONS.push('view-finance','view-emails');

const contextKind = () => (state.context ? 'product' : 'general');
const views = () => CONTEXTS[contextKind()].views;

// Telas de contexto que dependem de uma capacidade do tipo do item. A regra é do
// servidor (catalog.mjs, ADR 0007); a tela só lê as capacidades que ele devolve.
const VIEW_CAPABILITIES = {'product-inbound':['commercial','operate'],'product-keys':['access','commercial'],'product-orgs':['access'],'product-engagements':['commercial'],'product-payments':['checkout'],'product-receivables':['contract_billing']};
const contextProduct = () => state.product?.product || state.overview?.products?.find(product => product.id === state.context) || null;
const hasCapability = (product, capability) => Boolean(product?.capabilities?.includes(capability));
const contextKindLabel = () => kindLabelOf(contextProduct()?.portfolio_kind);
// Enquanto as capacidades não chegam, só aparecem as telas que não dependem de nenhuma.
const viewAllowed = key => {
 if (contextKind() !== 'product' || !VIEW_CAPABILITIES[key]) return true;
 const product = contextProduct();
 return VIEW_CAPABILITIES[key].some(capability => hasCapability(product, capability));
};
const productName = () => state.product?.product?.name || state.context;
const productKey=product=>String(product?.id||product?.name||'').toLowerCase().replace(/^tzolkin[ -]/,'').replace(/\s+/g,'-');
// Um projeto do inventário, na forma que casaConexao entende. O id do provedor é o
// que manda; o nome vai junto porque o vínculo legado (id nominal) precisa dele.
const recursoDoDeploy=project=>project?{provider:project.provider,id:project.project_id,name:project.project}:null;
// DEPLOY_ALIASES saiu daqui. Ele existia para adivinhar o dono pelo nome do projeto
// enquanto não havia vínculo confirmado, e era o último casamento por nome vivo na
// tela. Conferido contra o inventário dos provedores em 24/09/2026, alias a alias:
// 'tzolkin-educare' e 'tzolkin-sites' têm conexão confirmada pelo id da Vercel (itens
// educare e sites), então o apelido já não decidia nada; 'core', 'tzolkin-core',
// 'skiller' e 'tzolkin-skiller' não existem em provedor nenhum — o Core e o Skiller
// publicam em 'other/core', 'other/skiller' e 'skiller-frontend', todos confirmados.
// Mantê-lo era guardar a armadilha de o dia em que alguém criasse um projeto chamado
// "core" ele herdar, calado, o dono do item Core.
const bindingForDeployment=project=>state.resourceBindings.find(binding=>binding.active!==false&&casaConexao(binding,recursoDoDeploy(project)));
const deploymentBelongsToProduct=(project,product)=>bindingForDeployment(project)?.product_id===product?.id&&Boolean(product?.id);
const readyDeployment=product=>state.deploys.find(item=>deploymentBelongsToProduct(item,product))?.deployments?.find(deployment=>deployment.state==='READY')||null;
const publishedDeployUrl=product=>readyDeployment(product)?.url||null;
// O endereço de catálogo pode ser um alias ainda sem DNS (Educare). Quando
// existe um domínio canônico conhecido, ele é a fonte da identidade visual;
// não usamos o domínio efêmero do deploy para buscar o favicon.
const CANONICAL_PRODUCT_URLS={educare:'https://tzolkin-educare.vercel.app/',skiller:'https://skiller.tzolkin.cloud/'};
// Fallbacks locais preservam a identidade visual enquanto um domínio aprovado
// ainda não estiver carregado no contexto atual.
const LOCAL_PRODUCT_FAVICONS={educare:'/product-favicons/educare.svg',sites:'/product-favicons/sites.svg'};
const catalogForProduct=product=>state.catalog.find(entry=>entry.kind==='product'&&(entry.payload?.id===product?.id||entry.payload?.name===product?.name))?.payload||null;
const approvedPublicUrl=product=>{const bindings=state.resourceBindings.filter(item=>item.product_id===product?.id&&(!item.environment||item.environment==='production')&&['domain','frontend'].includes(item.resource_type));for(const binding of bindings){const raw=binding.url||`https://${binding.external_id}`;try{const url=new URL(raw);if(url.protocol==='https:'&&!/^api\./i.test(url.hostname))return url.href;}catch{}}return null;};
// Vínculo aprovado é a fonte de verdade. O deploy observado é evidência
// técnica/fallback, não identidade pública do produto.
// Identidade de produto vem exclusivamente do domínio público aprovado. Os
// arquivos locais só pertencem à identidade do próprio Core.
const productFaviconUrl=product=>CANONICAL_PRODUCT_URLS[productKey(product)]||approvedPublicUrl(product)||product?.favicon_url||product?.catalog?.url||catalogForProduct(product)?.url||publishedDeployUrl(product)||null;
const productLiveUrl=product=>product?.lifecycle_status==='draft'?(publishedDeployUrl(product)||null):(approvedPublicUrl(product)||CANONICAL_PRODUCT_URLS[productKey(product)]||product?.deploy_url||publishedDeployUrl(product)||product?.catalog?.url||catalogForProduct(product)?.url||null);
const coreSpaceIcon=()=>{const image=document.createElement('img');image.src='/logo.svg';image.width=20;image.height=20;image.alt='';return image;};

function node(tag, text, className) {
 const el = document.createElement(tag);
 if (text !== undefined) el.textContent = text;
 if (className) el.className = className;
 return el;
}
function option(value, label) { const el = node('option', label); el.value = value; return el; }

// O transporte do banco é medido no servidor; aqui só se exibe o veredito.
// Sem hostname, sem credencial — só o estado.
function renderSecurityBanner() {
 const banner = $('security-banner');
 const claro = state.security?.transport === 'plaintext';
 banner.hidden = !claro;
 if (claro) banner.textContent =
  'O banco está em host remoto e a conexão não é criptografada: senha e dados trafegam em texto claro. '
  + 'Não cadastre cliente real até isto ser corrigido.';
}

// Limpa tudo que veio do servidor. Chamado ao trocar de contexto e ao sair:
// nenhum número ou linha de um contexto pode sobreviver na tela do seguinte.
function clearRenderedData() {
 commercial.clear();
 deployData=null; $('deploys-summary').replaceChildren(); $('deploy-results').textContent=''; $('deploy-search').value=''; $('deploy-filter').value='all';
 delivery.clear();
 connections.clear();
 tracking.clear();
 finance.clear();
 emails.clear();
 billing.clear();
 productPayments.clear();
 resource.clear();
 // Resumo da ficha em voo não pinta dado de antes da troca de contexto ou da saída.
 clientTicket++; clientPending = null; state.clientSummary = null;
 // Um formulário aberto carrega o contexto anterior pré-selecionado: fecha junto.
 document.querySelectorAll('dialog[open]').forEach(dialog => dialog.close());
 DATA_NODES.forEach(id => $(id).replaceChildren());
 $('security-banner').hidden = true;
 $('clients-empty').hidden = true;
 $('search-empty').hidden = true;
 $('product-orgs-empty').hidden = true;
 $('product-orgs-search-empty').hidden = true;
 $('notice').textContent = '';
}

function signedOut() {
 loadGeneration++;
 state.overview = null; state.catalog = []; state.deploys = []; state.resourceBindings = []; state.infrastructure = null; state.management = null; state.dns = null; state.topology = null; state.security = null; state.product = null; state.context = '';
 clearRenderedData();
 $('context-select').replaceChildren(option('', 'TZOLKIN · Geral'));
 $('workspace').hidden = true; $('login').hidden = false;
 $('password').type = 'password'; $('password').value = '';
 $('show-password').textContent = 'Mostrar'; $('show-password').setAttribute('aria-pressed', 'false');
}

function closeNavigation(){document.body.classList.remove('nav-open');$('nav-toggle').setAttribute('aria-expanded','false');$('nav-backdrop').hidden=true;}
function openNavigation(){document.body.classList.add('nav-open');$('nav-toggle').setAttribute('aria-expanded','true');$('nav-backdrop').hidden=false;requestAnimationFrame(()=>$('sidebar').focus?.());}
$('nav-toggle').onclick=()=>document.body.classList.contains('nav-open')?closeNavigation():openNavigation();
$('nav-backdrop').onclick=closeNavigation;
$('mobile-refresh').onclick=()=>$('refresh').click();
addEventListener('keydown',event=>{if(event.key==='Escape')closeNavigation();});
addEventListener('resize',()=>{if(innerWidth>900)closeNavigation();});

async function api(path, method = 'GET', body) {
 const response = await fetch(path, {
  method,
  headers: body ? { 'Content-Type': 'application/json' } : {},
  body: body ? JSON.stringify(body) : undefined,
 });
 // Página HTML no lugar de JSON = o pedido nem chegou ao Core (servidor reiniciando, proxy fora do ar): diz isso em vez do erro do parser.
 const data = await response.json().catch(() => null);
 if (data === null) throw new Error(response.status >= 500 || response.status === 0 ? `O servidor não respondeu direito (código ${response.status}). Pode estar reiniciando: tente de novo em instantes.` : `Resposta inesperada do servidor (código ${response.status}). Atualize a página e tente de novo.`);
 if (!response.ok) {
  if (response.status === 401) signedOut();
  throw new Error(data.message || 'Não foi possível concluir. Tente novamente.');
 }
 return data;
}

/* ---------- navegação e contexto ---------- */

function renderNav() {
 const context = CONTEXTS[contextKind()];
 $('nav-label').textContent = contextKind() === 'product' ? `GESTÃO · ${contextKindLabel().toUpperCase()}` : context.label;
 // O grupo de cada tela. Segue, chave por chave, a ordem de CONTEXTS.general.views:
 // é o mesmo desenho escrito duas vezes, e a discordância entre os dois é o que o
 // teste de navegação pega antes de virar dois cabeçalhos "Tecnologia" na tela.
 const groups=contextKind()==='general'?{
  overview:'Hoje',finance:'Hoje',
  companies:'Relacionamentos',people:'Relacionamentos',clients:'Relacionamentos',leads:'Relacionamentos',emails:'Relacionamentos',client:'Relacionamentos',
  products:'Portfólio',
  services:'Entrega',tracking:'Entrega',serviceCampaigns:'Entrega',
  connections:'Tecnologia',vercel:'Tecnologia',github:'Tecnologia',easypanel:'Tecnologia',dns:'Tecnologia',resource:'Tecnologia',serverMetrics:'Tecnologia',
  database:'Bases de dados',redis:'Bases de dados',
  access:'Administração',settings:'Administração',security:'Administração',
 }:Object.fromEntries(Object.keys(context.views).map(key=>[key,contextKindLabel()]));
 const items=[];let previous,section;
 for(const [key,view]of Object.entries(context.views).filter(([key,view])=>!view.hidden&&viewAllowed(key))){
  if(groups[key]!==previous){section=node('section',undefined,'nav-section');const label=node('h2',groups[key],'nav-group');section.append(label);items.push(section);previous=groups[key];}
  const atual = state.view === 'client' ? state.clientBack : state.view;
  const button = node('button', undefined, 'nav-item' + (key === atual ? ' active' : ''));
  button.type = 'button'; button.dataset.view = key;
  const icon = createIcon(({overview:'layers',clients:'building',companies:'building',people:'people',tracking:'calendar',finance:'wallet',metrics:'chart',leads:'user-plus',emails:'mail',products:'package',services:'briefcase',connections:'branch',vercel:'cloud',github:'repo',easypanel:'server',dns:'globe',access:'shield',database:'database',redis:'cache',settings:'sliders',security:'lock',serverMetrics:'activity',product:'package','product-inbound':'user-plus','product-keys':'lock','product-orgs':'people','product-engagements':'briefcase','product-payments':'wallet','product-receivables':'calendar','product-emails':'mail',campaigns:'chart','product-campaigns':'chart'})[key]);
  icon.classList.add('nav-icon'); button.append(icon, document.createTextNode(view.title));
  if (key === atual) button.setAttribute('aria-current', 'page');
  button.onclick = () => {switchView(key);closeNavigation();};
  section.append(button);
 }
 $('nav').replaceChildren(...items);
}

function switchView(view) {
 if (!views()[view] || !viewAllowed(view)) view = Object.keys(views())[0];
 if(view !== 'resource' && state.view === 'resource') { resource.clear(); history.replaceState(null,'',location.pathname+location.search); }
 if(state.view!==view) commercial.clear();
 state.view = view;
 peekPessoa?.fechar();
 document.body.dataset.view = view;
 const active = views()[view];
 // Uma tela, uma seção. Cada provedor (Vercel, GitHub, EasyPanel, DNS) tem a sua;
 // o cadastro técnico dos projetos mora em Conexões, junto de quem é o dono.
// A ficha da empresa é um painel lateral: a tela de onde ela foi aberta continua visível por baixo,
 // com o título, o botão e a lista que estavam lá. Qualquer outra tela fecha o painel.
 const fundo = view === 'client' ? views()[state.clientBack]?.section : null;
 SECTIONS.forEach(id => { $(id).hidden = id !== active.section && id !== fundo; });
 if (view !== 'client') {
  peekEmpresa?.fechar();
  $('breadcrumb').textContent = $('page-title').textContent = active.title;
  $('mobile-page-title').textContent=active.title;
  $('page-desc').textContent = active.desc || '';
  $('page-desc').hidden = !active.desc;
  $('new-record').hidden = !active.action;
  $('page-title').closest('.page-heading').hidden = view === 'database';
  // Métrica de carteira não diz nada numa tela de ecossistema ou de deploy.
  $('metrics').hidden = active.metrics === false || !$('metrics').children.length;
  if (active.action) $('new-record-label').textContent = active.action[0];
 }
 $('notice').textContent = '';
 renderNav();
 if (view === 'settings') {const retorno=state.configRetorno;state.configRetorno='';montarConfiguracoes($('settings-body'),{api,secao:state.configSecao,retorno,aoMudar:id=>{state.configSecao=id;},abrirTela:v=>{switchView(v);closeNavigation();}});};
 if (view === 'tracking') tracking.load().catch(reportError);
 if (view === 'finance') finance.load().catch(reportError);
 if (view === 'emails') emails.load().catch(reportError);
 if (view === 'people') renderPeople();
 if (view === 'clients') renderTenants();
 if (view === 'leads' || view === 'product-inbound') montarInbound();
 if(view==='product-keys') commercial.keys(state.context).catch(reportError);
 if (view === 'companies') renderCompanies();
 if (view === 'products') renderGeneral();
 if (view === 'services') renderServices();
 if (['dns','database','redis'].includes(view)) renderManagement();
 if (['database','redis'].includes(view) && !state.management) api('/api/management/schema').then(data=>{state.management=data;renderManagement();}).catch(error=>{$('management-schema').replaceChildren(node('p',error.message,'notice-inline'));});
 if (view === 'dns' && !state.dns) api('/api/dns/hostinger').then(data=>{state.dns=data;renderManagement();}).catch(error=>{$('management-dns').replaceChildren(node('p',error.message,'notice-inline'));});
 if (view === 'client') renderClientDetail();
 if (view === 'product-payments'&&state.product) productPayments.load(state.product.product).catch(reportError);
 if (view === 'product-receivables'&&state.product) serviceReceivables.load(state.product.product).catch(reportError);
 if (view === 'product-emails'&&state.product) productEmails.load({...state.product.product,deploy_url:publishedDeployUrl(state.product.product),favicon_url:productFaviconUrl(state.product.product)}).catch(reportError);
 // Conexões (projetos técnicos) e GitHub (repositórios) leem o mesmo cadastro.
 if (['connections','github','vercel','easypanel'].includes(view)) delivery.load().catch(reportError);
 if (view === 'connections') loadConnections();
}

// Inbound: uma tela, dois tópicos (Leads e Campanhas), como abas. No contexto de um
// item, Leads só existe onde o item tem a capacidade comercial; Campanhas existe em
// todo item (um item interno, como o Core, também anuncia).
function montarInbound() {
 const doItem = contextKind() === 'product';
 const comLeads = !doItem || hasCapability(contextProduct(), 'commercial');
 const abas = [...(comLeads ? [{ key: 'leads', label: 'Leads' }] : []), { key: 'campaigns', label: 'Campanhas' }];
 if (!abas.some(aba => aba.key === state.inboundTab)) state.inboundTab = abas[0].key;
 const mostrar = key => {
  state.inboundTab = key;
  $('inbound-panel-leads').hidden = key !== 'leads';
  $('inbound-panel-campaigns').hidden = key !== 'campaigns';
  if (key === 'leads') commercial.load(doItem ? state.context : '').catch(reportError);
  else if (!doItem) campaigns.load().catch(reportError);
  else if (state.product) campaigns.loadProduct(state.product.product).catch(reportError);
 };
 mountTabs({ host: $('inbound-tabs'), tabs: abas, active: state.inboundTab, label: 'Seções de Inbound', prefix: 'inbound', onChange: mostrar });
 mostrar(state.inboundTab);
}

function renderContextChrome() {
 const product = contextKind() === 'product';
 $('crumb-context').textContent = product ? `TZOLKIN · ${productName()}` : 'TZOLKIN';
 $('eyebrow').textContent = product ? `${contextKindLabel().toUpperCase()} · ${String(productName()).toUpperCase()}` : 'TZOLKIN CORE';
 document.body.dataset.context = product ? 'product' : 'general';
 renderContextPicker(state.overview?.products || []);
}

async function switchContext(contextId) {
 if(state.view==='resource')history.replaceState(null,'',location.pathname+location.search);
 state.context = contextId;
 state.overview = contextId ? state.overview : null;
 state.product = null;
 state.view = Object.keys(views())[0];
 clearRenderedData();          // dado antigo sai da tela antes de qualquer requisição
 renderContextChrome();
 renderNav();
 switchView(state.view);
 await load();                 // o servidor revalida sessão e permissões a cada troca
}

/* ---------- métricas ---------- */

function renderMetrics(items) {
 $('metrics').replaceChildren(...items.map(([label, value, hint]) => {
  const card = node('article');
  card.append(node('span', label), node('strong', String(value)));
  if (hint) card.append(node('small', hint));
  return card;
 }));
 $('metrics').hidden = items.length === 0 || views()[state.view]?.metrics === false;
}

/* ---------- contexto geral ---------- */

function catalogLink(label, url, className) {
 const link = node('a', label, className);
 try {
  const parsed = new URL(url);
  if (parsed.protocol !== 'https:' || parsed.username || parsed.password) return node('span', label);
  link.href = parsed.href;
 } catch { return node('span', label); }
 link.target = '_blank'; link.rel = 'noopener noreferrer';
 return link;
}

const currentMonth=()=>new Intl.DateTimeFormat('sv-SE',{timeZone:'America/Sao_Paulo',year:'numeric',month:'2-digit'}).format(new Date());
const brl=value=>new Intl.NumberFormat('pt-BR',{style:'currency',currency:'BRL'}).format(Number.isFinite(value)?value:0);
function overviewButton(label,detail,view,icon='arrow'){
 const button=node('button',undefined,'overview-action');button.type='button';button.append(createIcon(icon));const copy=node('span');copy.append(node('strong',label),node('small',detail));button.append(copy,createIcon('arrow'));button.onclick=()=>switchView(view);return button;
}
function renderOverviewDashboard(entries,{finance,sales,deploys,infrastructure}={}){
 const overview=state.overview,month=currentMonth(),monthLabel=new Intl.DateTimeFormat('pt-BR',{month:'long',year:'numeric',timeZone:'America/Sao_Paulo'}).format(new Date(month+'-15T12:00:00-03:00'));
 $('overview-period').textContent=monthLabel[0].toUpperCase()+monthLabel.slice(1);
 const activeContracts=overview.entitlements.filter(e=>e.active),activeClients=overview.tenants.filter(t=>t.relationship_kind==='customer'&&['active','onboarding'].includes(t.lifecycle_status)).length,saleRows=Object.values(sales?.providers||{}).flatMap(p=>p.snapshot?.payload?.sales||[]),received=saleRows.filter(s=>s.status==='received'&&s.currency==='BRL'),gross=received.reduce((n,s)=>n+(Number.isFinite(s.gross)?s.gross:0),0),projects=deploys?.projects||[],ready=projects.filter(p=>deployGroup(p)==='ready').length;
 $('overview-summary').textContent=`${activeClients} ${activeClients===1?'cliente ativo':'clientes ativos'}, ${activeContracts.length} ${activeContracts.length===1?'contrato de acesso':'contratos de acesso'} e ${saleRows.length} ${saleRows.length===1?'venda importada':'vendas importadas'} neste mês.`;
 const kpis=[['Clientes ativos',activeClients,overview.tenants.filter(t=>t.relationship_kind==='customer').length+' cadastrados','clients'],['Receita recebida',brl(gross),'Vendas confirmadas em BRL','finance'],['Contratos de acesso',activeContracts.length,overview.products.length+' itens no portfólio','products']];
 $('overview-kpis').replaceChildren(...kpis.map(([label,value,detail,view])=>{const card=node('button',undefined,'overview-kpi');card.type='button';card.onclick=()=>switchView(view);card.append(node('span',label),node('strong',String(value)),node('small',detail));return card;}));
 const alerts=[];
 if(!sales?.configured?.asaas)alerts.push(['Asaas não configurado','Adicione a chave de produção para importar as vendas.','finance','alert']);
 if(sales?.configured?.stripe&&!sales?.providers?.stripe?.snapshot)alerts.push(['Stripe sem sincronização','Abra o Financeiro para importar o mês atual.','finance','clock']);
 const failed=projects.filter(p=>deployGroup(p)==='failed').length;if(failed)alerts.push([`${failed} ${failed===1?'projeto com falha':'projetos com falha'}`,'Revise o último deploy antes da próxima publicação.','deploys','alert']);
 const bankErrors=(finance?.connections||[]).filter(c=>c.attempt?.payload?.state==='error').length;if(bankErrors)alerts.push(['Conexão bancária pendente',`${bankErrors} ${bankErrors===1?'conexão precisa':'conexões precisam'} de nova consulta.`,'finance','clock']);
 if(!alerts.length)alerts.push(['Operação sem alerta crítico','Integrações consultadas e nenhum bloqueio encontrado.','overview','check']);
 $('overview-alerts').replaceChildren(...alerts.map(([title,detail,view,icon])=>overviewButton(title,detail,view,icon)));
 const integration=(name,configured,detail,logo)=>{const row=node('div',undefined,'overview-integration'),identity=node('div',undefined,'card-identity'),mark=node('span',undefined,'overview-integration-mark');mark.append(logo||createIcon('database'));identity.append(mark,node('div'));identity.lastChild.append(node('strong',name),node('small',detail));row.append(identity,node('span',configured===null?'Consultando':configured?'Conectado':'Pendente','status '+(configured===null?'info':configured?'success':'neutral')));return row;};
 const bankCount=finance?.connections?.length||0,easyCount=infrastructure?.projects?.reduce((n,p)=>n+p.services.length,0)||0;
 // Nome da instituição em vez da contagem: "Nubank · Banco Inter" diz mais que "2 conexões".
 // 'Instituição bancária' é o rótulo genérico do adaptador quando não reconhece o banco — não vale como nome.
 // Só contas do tipo BANK: cartão devolve a bandeira ('MASTERCARD'), que não é instituição.
 // Um banco por linha, com a própria marca. "Contas bancárias · 2" não diz de
 // qual banco se trata, que é justamente o que se quer saber de relance.
 // Só contas BANK: cartão devolve a bandeira ('MASTERCARD'), que não é instituição.
 const porBanco=new Map();
 for(const conta of (finance?.accounts||[]).filter(a=>a.type==='BANK')){
  const identidade=paymentInstitution(conta.bank);
  // Rótulo genérico do adaptador não vale como nome de banco.
  if(['Instituição bancária','Instituição não informada'].includes(identidade.name))continue;
  const linha=porBanco.get(identidade.name)||{identidade,contas:0};
  linha.contas+=1;porBanco.set(identidade.name,linha);
 }
 const linhasBanco=porBanco.size
  ? [...porBanco.values()].map(({identidade,contas})=>integration(identidade.name,true,`${contas} ${contas===1?'conta lida':'contas lidas'}`,identidade.logo?providerLogo(identidade.logo):null))
  : [integration('Contas bancárias',bankCount>0,bankCount?`${bankCount} ${bankCount===1?'conexão sem contas lidas':'conexões sem contas lidas'}`:'Nenhuma conexão')];
 $('overview-integrations').replaceChildren(integration('Stripe',sales?.configured?.stripe,`${saleRows.filter(s=>s.provider==='stripe').length} vendas no mês`,providerLogo('stripe')),integration('Asaas',sales?.configured?.asaas,sales?.configured?.asaas?'Leitura por API ativa':'Chave de produção ausente',providerLogo('asaas')),...linhasBanco,integration('EasyPanel',infrastructure==null?null:infrastructure.status==='ok',infrastructure==null?'Consultando inventário':`${easyCount} serviços no inventário`,providerLogo('easypanel')));
 $('overview-product-list').replaceChildren(...byKind(overview.products).flatMap(group=>group.items).map(product=>{const count=portfolioCount(product),row=node('button',undefined,'overview-product');row.type='button';row.onclick=()=>openProductModule(product,'product').catch(reportError);row.append(productFavicon(productFaviconUrl(product)));const text=node('span');text.append(node('strong',product.name),node('small',[kindLabel(product),productLifecycle(product).label,count?.text].filter(Boolean).join(' · ')));row.append(text,node('span',count?String(count.n):'—','overview-product-count'),createIcon('arrow'));return row;}));
 $('overview-actions').replaceChildren(overviewButton('Adicionar cliente','Abrir a carteira e iniciar um relacionamento','clients','people'),overviewButton('Revisar caixa','Bancos, Stripe e Asaas em um só lugar','finance','wallet'),overviewButton('Acompanhar deploys','Projetos e ambientes de publicação na Vercel','vercel','cloud'));
 document.querySelectorAll('[data-overview-view]').forEach(button=>button.onclick=()=>switchView(button.dataset.overviewView));
}

const CLIENT_LABELS={
 customer:'Cliente',prospect:'Prospect',partner:'Parceiro',internal:'Interna',company:'Empresa',person:'Pessoa física',nonprofit:'Sem fins lucrativos',
 lead:'Lead',onboarding:'Em implantação',active:'Ativo',planned:'Planejado',paused:'Pausado',completed:'Concluído',discontinued:'Descontinuado',unclassified:'A classificar',
 on_demand:'Sob demanda',education:'Mentoria',consulting:'Consultoria',advisory:'Assessoria',product:'Produto TZOLKIN',
 owner:'Proprietário',decision_maker:'Decisor',champion:'Champion',finance:'Financeiro',technical:'Técnico',operational:'Operacional',student:'Aluno',contact:'Contato'
};
const clientLabel=value=>CLIENT_LABELS[value]||value||'A classificar';
// Separado de CLIENT_LABELS: lá `product` é modalidade de contratação e `internal` é tipo de relacionamento.
// Os TIPOS do portfólio (rótulo, plural, ícone, texto e ordem) vêm da API, junto do
// resto do painel (portfolio_kinds em /api/overview): o painel não guarda dicionário
// próprio. 'kind_aliases' diz que nome antigo virou qual ('product' → 'platform').
const kindRegistry=()=>state.overview?.portfolio_kinds||[];
const canonKind=kind=>state.overview?.kind_aliases?.[kind]||kind;
const kindInfo=kind=>kindRegistry().find(item=>item.kind===canonKind(kind))||null;
const kindLabelOf=kind=>kindInfo(kind)?.label||'Item';

// O cartão é o alvo do clique: sem um "Abrir X →" repetido em cada linha. Botões e
// links dentro do cartão continuam com a ação própria.
function cardLink(card, open, label) {
 card.classList.add('is-clickable');card.tabIndex=0;card.setAttribute('role','link');card.setAttribute('aria-label',label);
 card.onclick=event=>{if(event.target.closest('button,a'))return;open();};
 card.onkeydown=event=>{if(event.key==='Enter'&&event.target===card)open();};
 return card;
}
// Papel e cargo que dizem a mesma coisa ("Aluno · Aluno") viram um rótulo só.
const roleLine=person=>[clientLabel(person.role),person.title].filter((v,i,a)=>v&&a.findIndex(x=>x&&String(x).toLocaleLowerCase('pt-BR')===String(v).toLocaleLowerCase('pt-BR'))===i).join(' · ');
const plural2=(n,um,varios)=>`${n} ${n===1?um:varios}`;

// Clientes: uma tabela, não uma grade de cartões. As abas filtram por situação e carregam a
// contagem (os números que antes eram quatro cartões de resumo).
const CLIENT_TABS = [
 { key: 'all', label: 'Todos', test: () => true },
 { key: 'active', label: 'Ativos', test: t => ['active', 'onboarding'].includes(t.lifecycle_status) },
 { key: 'classify', label: 'A classificar', test: t => t.lifecycle_status === 'unclassified' },
 { key: 'closed', label: 'Encerrados', test: t => !['active', 'onboarding', 'unclassified'].includes(t.lifecycle_status) }
];
let clientTabsSignature = '';
const clientNorm = t => String(t || '').toLocaleLowerCase('pt-BR').normalize('NFD').replace(/\p{M}/gu, '').trim();
function renderTenants() {
 const overview = state.overview;
 if (!overview) return;
 const query = $('client-search').value.trim().toLocaleLowerCase('pt-BR');
 const customers = overview.tenants.filter(t => t.relationship_kind === 'customer');
 const found = customers.filter(t => (t.name + ' ' + t.slug).toLocaleLowerCase('pt-BR').includes(query));
 const counts = Object.fromEntries(CLIENT_TABS.map(tab => [tab.key, found.filter(tab.test).length]));
 if (!CLIENT_TABS.some(tab => tab.key === state.clientTab)) state.clientTab = 'all';
 // As abas só são redesenhadas quando a contagem muda: redesenhar a cada tecla na busca
 // tiraria o foco da aba que a pessoa acabou de escolher pelo teclado.
 const signature = JSON.stringify([counts, state.clientTab]);
 if (signature !== clientTabsSignature) {
  clientTabsSignature = signature;
  mountTabs({ host: $('client-tabs'), tabs: CLIENT_TABS.map(tab => ({ key: tab.key, label: tab.label, count: counts[tab.key] })), active: state.clientTab, label: 'Situação do cliente', prefix: 'client', panelId: 'client-panel', onChange: key => { state.clientTab = key; state.clientPage = 0; renderTenants(); } });
 }
 const semCarteira = !customers.length;
 $('clients-empty').hidden = !semCarteira;
 $('client-tabs').hidden = semCarteira;
 $('client-search').closest('.tbl-bar').hidden = semCarteira;
 const tab = CLIENT_TABS.find(item => item.key === state.clientTab);
 const rows = found.filter(tab.test);
 // Busca sem resultado: a tela diz isso; a aba vazia (sem busca) só mostra a tabela vazia.
 $('search-empty').hidden = semCarteira || found.length > 0;
 $('client-panel').hidden = semCarteira || !found.length;
 const size = Number($('client-pagesize').value) || 25;
 const pages = Math.max(1, Math.ceil(rows.length / size));
 state.clientPage = Math.min(Math.max(0, state.clientPage), pages - 1);
 const from = state.clientPage * size;
 const shown = rows.slice(from, from + size);
 $('client-count').textContent = rows.length ? `${from + 1}–${from + shown.length} de ${rows.length}` : 'Nenhum cliente nesta situação.';
 $('client-pageinfo').textContent = `${state.clientPage + 1} / ${pages}`;
 $('client-prev').disabled = state.clientPage === 0;
 $('client-next').disabled = state.clientPage >= pages - 1;
 $('tenants').replaceChildren();
 for (const tenant of shown) {
  const engagements = overview.engagements.filter(e => e.tenant_id === tenant.id);
  const stakeholders = overview.stakeholders.filter(s => s.tenant_id === tenant.id);
  // A oferta só aparece quando acrescenta algo ao tipo ("Assessoria / Assessoria" não acrescenta).
  const ofertas = [...new Set(engagements.filter(e => e.label && clientNorm(e.label) !== clientNorm(clientLabel(e.service_model))).map(e => e.label))];
  const contratacao = engagements.length ? [...new Set(engagements.map(e => clientLabel(e.service_model)))].join(', ') : 'A classificar';
  const row = node('tr', undefined, 'is-clickable');
  const name = node('td', undefined, 'tbl-main');
  const who = node('div', undefined, 'tbl-who');
  const copy = node('span');
  const open = node('button', tenant.name, 'tbl-name'); open.type = 'button'; open.setAttribute('aria-label', 'Abrir ' + tenant.name);
  open.onclick = event => { event.stopPropagation(); openClient(tenant.id); };
  copy.append(open, node('small', clientLabel(tenant.organization_type)));
  who.append(node('span', tenant.name.slice(0, 1).toLocaleUpperCase('pt-BR'), 'client-avatar'), copy);
  name.append(who);
  const status = node('td'); status.append(node('span', clientLabel(tenant.lifecycle_status), 'status ' + tomDoEstado(tenant.lifecycle_status)));
  const offer = node('td', ofertas.length ? ofertas.join(', ') : '—', ofertas.length ? 'tbl-wrap-text' : 'tbl-empty-cell');
  row.append(name, status, node('td', contratacao, 'tbl-wrap-text'), offer, node('td', String(stakeholders.length), 'num'));
  row.onclick = event => { if (!event.target.closest('button,a')) openClient(tenant.id); };
  $('tenants').append(row);
 }
}

// Ações de produto sempre preservam o contexto. Cobrança e e-mails não são
// configurações soltas: o produto aparece no breadcrumb e na navegação lateral.
async function openProductModule(product, view) {
 $('context-select').value=product.id;
 await switchContext(product.id);
 if (views()[view]) switchView(view);
}

function renderDirectory(kind, searchId, targetId, emptyId) {
 const overview=state.overview;if(!overview)return;
 const query=$(searchId).value.trim().toLocaleLowerCase('pt-BR');
 const rows=overview.tenants.filter(t=>kind(t)).filter(t=>(t.name+' '+t.slug).toLocaleLowerCase('pt-BR').includes(query));
 const target=$(targetId);target.replaceChildren();$(emptyId).hidden=rows.length>0;
 if(!rows.length)return;
 const contagem=(lista,id)=>lista.filter(item=>item.tenant_id===id).length;
 target.append(tabela({legenda:'Organizações',linhas:rows,aoAbrir:t=>openClient(t.id),colunas:[
  {titulo:'Organização',celula:t=>celulaNome({nome:t.name,apoio:t.organization_type==='company'?'':clientLabel(t.organization_type),aoAbrir:()=>openClient(t.id)})},
  {titulo:'Relacionamento',celula:t=>selo(clientLabel(t.relationship_kind))},
  {titulo:'Situação',celula:t=>selo(clientLabel(t.lifecycle_status),tomDoEstado(t.lifecycle_status))},
  {titulo:'Contratações',num:true,celula:t=>String(contagem(overview.engagements,t.id))},
  {titulo:'Pessoas',num:true,celula:t=>String(contagem(overview.stakeholders,t.id))}
 ]}));
 const rodape=node('div',undefined,'tbl-foot');rodape.append(node('span',plural2(rows.length,'organização','organizações')));target.append(rodape);
}
function renderLeads(){renderDirectory(t=>t.relationship_kind==='prospect','lead-search','leads','leads-empty');}
function renderCompanies(){renderDirectory(t=>t.organization_type==='company','company-search','companies','companies-empty');}

/* ---------- ficha da empresa ---------- */

// A ficha lê um resumo só (GET /api/tenants/:id/summary): empresa no centro,
// contratações abaixo, item do portfólio como contexto. Cada seção pode vir
// { available:false, reason } sem derrubar as outras; seção vazia some ou
// explica em uma frase — nunca "0 contratos · 0 acessos".
// Espelho de SERVICE_MODELS (commercial-intake.mjs) e ENGAGEMENT_STATUS
// (portfolio.mjs) só para montar o formulário. Quem valida é o servidor.
const SERVICE_MODELS=['on_demand','education','consulting','advisory','product','unclassified'];
const ENGAGEMENT_STATUS=['active','planned','paused','completed','discontinued','unclassified'];
const CONTRACT_LABELS={draft:'Rascunho',active:'Ativo',completed:'Concluído',canceled:'Cancelado'};
const LEAD_LABELS={open:'Novo',qualified:'Qualificado',won:'Ganho',lost:'Perdido',archived:'Arquivado'};
const ENVIRONMENT_LABELS={production:'Produção',staging:'Homologação',development:'Desenvolvimento'};
// Nome do provedor por extenso. Havia `provider==='vercel'?'Vercel':'EasyPanel'`
// espalhado pela tela, que chamava de EasyPanel todo domínio da Hostinger.
const PROVIDER_LABELS={github:'GitHub',vercel:'Vercel',easypanel:'EasyPanel',hostinger:'Hostinger',stripe:'Stripe',asaas:'Asaas',manual:'Manual'};
// Kicker do cabeçalho: o relacionamento com a TZOLKIN, não o tipo jurídico.
const tenantKicker=t=>t.relationship_kind==='prospect'?(t.lifecycle_status==='lead'?'LEAD':'PROSPECT'):({customer:'CLIENTE',partner:'PARCEIRO',internal:'ORGANIZAÇÃO INTERNA'})[t.relationship_kind]||'EMPRESA';
const minorAmount=(cents,currency)=>{try{return new Intl.NumberFormat('pt-BR',{style:'currency',currency:currency||'BRL'}).format(Number(cents||0)/100);}catch{return (Number(cents||0)/100).toLocaleString('pt-BR',{minimumFractionDigits:2});}};
const workedTime=minutes=>minutes<60?`${minutes} min`:`${Math.floor(minutes/60)} h${minutes%60?` ${minutes%60} min`:''}`;
const monthTitle=month=>{const label=new Intl.DateTimeFormat('pt-BR',{month:'long',year:'numeric',timeZone:'UTC'}).format(new Date(month+'-15T12:00:00Z'));return label[0].toUpperCase()+label.slice(1);};
const dayLabel=value=>value?String(value).slice(0,10).split('-').reverse().join('/'):'';
const plural=(n,one,many)=>`${n} ${n===1?one:many}`;
let clientTicket=0,clientPending=null,engagementTenant=null,engagementItems=null;

function openClient(id){
 if(!id)return;
 peekPessoa?.fechar();
 // Voltar leva à tela de onde a ficha foi aberta, quando ela é do contexto geral.
 if(state.view!=='client')state.clientBack=contextKind()==='general'&&!views()[state.view]?.hidden?state.view:'clients';
 if(state.selectedTenant!==id)state.clientSummary=null;
 state.selectedTenant=id;
 // A ficha é do contexto geral. Vinda de um produto, troca de contexto sem esperar
 // o painel inteiro: a ficha busca só o próprio resumo.
 if(contextKind()!=='general'){$('context-select').value='';switchContext('').catch(reportError);}
 switchView('client');
}
function openLead(id){switchView('leads');commercial.detail(id).catch(reportError);}

// A ficha da empresa é o painel lateral sobre a tela de origem (peek.js). Criado uma vez e reaproveitado.
const peekDaEmpresa=()=>peekEmpresa||=criarPeek({raiz:$('view-client'),prefixo:'empresa',rotulo:'Ficha da empresa',corpoId:'client-detail',aoFechar:()=>switchView(state.clientBack||'clients')});
function renderClientDetail(){
 const id=state.selectedTenant;if(!id){switchView('clients');return;}
 const peek=peekDaEmpresa();peek.abrir();
 if(state.clientSummary?.tenant?.id===id)paintClientDetail(state.clientSummary);
 else{peek.titulo('Empresa');peek.mensagem('Carregando ficha da empresa…');}
 loadClientSummary(id);
}

// Uma busca por empresa por vez; resposta de outra empresa ou de antes de uma troca é descartada.
async function loadClientSummary(id){
 if(clientPending===id)return;
 const ticket=++clientTicket;clientPending=id;
 try{
  const summary=await api(`/api/tenants/${encodeURIComponent(id)}/summary`);
  if(ticket!==clientTicket||state.selectedTenant!==id)return;
  state.clientSummary=summary;
  if(state.view==='client')paintClientDetail(summary);
 }catch(error){
  if(ticket===clientTicket&&state.selectedTenant===id&&state.view==='client')peekDaEmpresa().mensagem(error.message,'notice-inline');
 }finally{if(ticket===clientTicket)clientPending=null;}
}

function clientEngagement(engagement,summary){
 const block=node('article',undefined,'client-engagement'),head=node('header'),copy=node('div');
// PUT /api/engagements/:id pede a contratação inteira e a revisão (outra pessoa pode ter mudado antes): vai o que
 // a tela já tem, com o campo novo por cima, e a revisão devolvida substitui a antiga.
 const salvarContratacao=async campos=>{
  const res=await api('/api/engagements/'+engagement.id,'PUT',{product_id:engagement.product?.id??null,service_model:engagement.service_model,status:engagement.status,label:engagement.label,revision:engagement.revision,...campos});
  Object.assign(engagement,campos);
  if(res?.revision!==undefined)engagement.revision=res.revision;
  state.clientSummary=null;
 };
 const nomeContratacao=campoInline({valor:engagement.label,rotulo:'Nome da contratação',obrigatorio:true,validar:v=>v.length<2?'Use ao menos 2 caracteres.':v.length>120?'Use no máximo 120 caracteres.':null,salvar:async v=>{await salvarContratacao({label:v});return v;}});
 nomeContratacao.classList.add('inline-forte');
 copy.append(nomeContratacao);
 if(!clientNorm(engagement.label).includes(clientNorm(clientLabel(engagement.service_model))))copy.append(node('span',clientLabel(engagement.service_model),'detail'));
 const situacaoContratacao=campoInline({valor:engagement.status,rotulo:'Situação da contratação',tipo:'select',opcoes:['planned','active','paused','completed','discontinued','unclassified'].map(v=>[v,clientLabel(v)]),
  exibir:v=>selo(clientLabel(v),tomDoEstado(v)),salvar:async v=>{await salvarContratacao({status:v});return v;}});
 head.append(copy,situacaoContratacao);
 const links=node('div',undefined,'client-engagement-links'),item=engagement.product;
 if(item){
  const kind=kindLabelOf(item.portfolio_kind);
  // Item arquivado não abre contexto: o seletor só conhece ativos e rascunhos.
  if(['active','draft'].includes(item.lifecycle_status)){const open=node('button',undefined,'table-action');open.type='button';open.append(createIcon('package'),document.createTextNode(`${kind}: ${item.name}`));open.onclick=()=>openProductModule(item,'product').catch(reportError);links.append(open);}
  else links.append(node('span',`${kind}: ${item.name} · arquivado`,'detail'));
 } else links.append(node('span','Sem item do portfólio','detail'));
 const mine=summary.campaigns.available?summary.campaigns.items.filter(c=>c.engagement_id===engagement.id):[];
 const ads=node('button',undefined,'table-action');ads.type='button';ads.append(createIcon('chart'),document.createTextNode(mine.length?`Campanhas · ${mine.length}`:'Campanhas'));
 ads.onclick=()=>{switchView('serviceCampaigns');campaigns.loadService(engagement.id,engagement.label).catch(reportError);};links.append(ads);
 if(mine.length){const spend=new Map();for(const c of mine)spend.set(c.currency||'BRL',(spend.get(c.currency||'BRL')||0)+Number(c.spend_cents||0));links.append(node('span','Investido no mês: '+[...spend].map(([currency,cents])=>minorAmount(cents,currency)).join(' + '),'detail'));}
 block.append(head,links);
 for(const binding of summary.deploys.available?summary.deploys.items.filter(d=>d.engagement_id===engagement.id):[]){
  const project=projectForServiceBinding(binding),latest=project?.deployments?.[0];
  const row=node('div',undefined,'client-engagement-deploy');row.append(providerLogo(binding.provider),node('strong',binding.external_project_name),node('span',[PROVIDER_LABELS[binding.provider]||binding.provider,ENVIRONMENT_LABELS[binding.environment]||binding.environment,latest?.state_label||latest?.state||'sem deploy observado'].join(' · '),'detail'));
  if(project?.project_id)row.append(resourceButton('Ver projeto',binding.provider,project.project_id,binding.environment));
  if(latest?.url)row.append(catalogLink('Abrir ↗',latest.url,'product-live-link'));
  block.append(row);
 }
 return block;
}

const semRepetir=(v,i,x)=>x.indexOf(v)===i;
const subtituloDaEmpresa=t=>[clientLabel(t.relationship_kind),clientLabel(t.organization_type),clientLabel(t.lifecycle_status),t.status==='suspended'?'Suspensa':null].filter(Boolean).filter(semRepetir).join(' · ');

// ---- Ficha da pessoa: painel lateral com cada campo editável no lugar (PUT /api/stakeholders) ----
const PAPEIS=[['owner','Proprietário'],['decision_maker','Decisor'],['champion','Champion'],['finance','Financeiro'],['technical','Técnico'],['operational','Operacional'],['student','Aluno'],['contact','Contato']];
const SIM_NAO=[['true','Sim'],['false','Não']];
const emailValido=v=>/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(v);
const telefoneValido=v=>/^\d{10,15}$/.test(v.replace(/[\s()+.-]/g,''));
function abrirPessoa(p){
 peekPessoa||=criarPeek({id:'peek-pessoa',prefixo:'pessoa',rotulo:'Ficha da pessoa',aoFechar:()=>peekPessoa.fechar()});
 const peek=peekPessoa;peek.abrir();
 const empresa=state.overview?.tenants.find(t=>t.id===p.tenant_id);
 const subtitulo=()=>[clientLabel(p.role),p.title,empresa?.name].filter(Boolean).filter(semRepetir).join(' · ');
 peek.titulo(p.name,subtitulo());
 const salvar=async campos=>{
  await api('/api/stakeholders','PUT',{tenant_id:p.tenant_id,stakeholder_id:p.id,...campos});
  // o servidor normaliza e-mail (minúsculas) e telefone (só dígitos): a tela guarda do mesmo jeito
  if(typeof campos.email==='string')campos.email=campos.email.toLowerCase();
  if(typeof campos.phone==='string')campos.phone=campos.phone.replace(/[\s()+.-]/g,'');
  Object.assign(p,campos);
  state.clientSummary=null;
  peek.titulo(p.name,subtitulo());
  renderPeople();renderTenants();renderCompanies();
 };
 const texto=(rotulo,campo,extra={})=>campoInline({valor:p[campo],rotulo,salvar:async v=>{await salvar({[campo]:v});return p[campo];},...extra});
 const simNao=(rotulo,campo)=>campoInline({valor:String(p[campo]),rotulo,tipo:'select',opcoes:SIM_NAO,salvar:async v=>{await salvar({[campo]:v==='true'});return v;}});
 const abrirEmpresa=node('button',empresa?.name||'Abrir empresa','link-nome');abrirEmpresa.type='button';abrirEmpresa.onclick=()=>{peek.fechar();openClient(p.tenant_id);};
 const painel=node('div');
 painel.append(pares([
  {rotulo:'Nome',valor:texto('Nome','name',{obrigatorio:true,validar:v=>v.length<2?'Use ao menos 2 caracteres.':v.length>160?'Use no máximo 160 caracteres.':null})},
  {rotulo:'E-mail',valor:texto('E-mail','email',{tipo:'email',validar:v=>emailValido(v)?null:'E-mail inválido.'})},
  {rotulo:'Telefone',valor:texto('Telefone','phone',{tipo:'tel',validar:v=>telefoneValido(v)?null:'Telefone inválido: use DDD e número, com 10 a 15 dígitos.',exibir:fonteTelefone})},
  {rotulo:'Cargo',valor:texto('Cargo','title',{validar:v=>v.length<2?'Use ao menos 2 caracteres.':v.length>120?'Use no máximo 120 caracteres.':null})},
  {rotulo:'Papel',valor:campoInline({valor:p.role,rotulo:'Papel',tipo:'select',opcoes:PAPEIS,salvar:async v=>{await salvar({role:v});return v;}})},
  {rotulo:'Contato principal',valor:simNao('Contato principal','is_primary')},
  {rotulo:'Pode ser contatada',valor:simNao('Pode ser contatada','contact_allowed')},
  {rotulo:'Empresa',valor:abrirEmpresa},
 ]));
 peek.abas([{key:'geral',label:'Visão geral',painel}]);
 peek.pe([]);
}

function paintClientDetail(summary){
 const {tenant}=summary,peek=peekDaEmpresa();
 // O nome e o tipo vão no cabeçalho do painel; a tela de fundo mantém o próprio título.
 peek.titulo(tenant.name,subtituloDaEmpresa(tenant));
 const create=node('button',undefined,'primary');create.type='button';create.append(createIcon('plus'),document.createTextNode('Nova contratação'));create.onclick=()=>openEngagementDialog(tenant).catch(reportError);
 const grid=node('div',undefined,'client-detail-grid client-summary-grid');
 const panel=(title,caption,wide)=>{const el=node('section',undefined,'client-detail-panel'+(wide?' client-detail-wide':''));el.append(node('h3',title));if(caption)el.append(node('p',caption,'detail'));grid.append(el);return el;};
 const unavailable=(title,section)=>panel(title).append(node('p',section.reason,'notice-inline'));
 const row=(title,detail,...extra)=>{const el=node('article',undefined,'detail-row'),copy=node('div');copy.append(node('strong',title));if(detail)copy.append(node('span',detail,'detail'));el.append(copy,...extra);return el;};

 const {engagements,deploys,contracts,origin,people,hours,access}=summary;
// Cadastro: cada campo se edita no lugar (PUT /api/tenants, só o que mudou, com antes e depois na trilha).
 // A organização interna da Tzolkin não se reclassifica: nela só o nome muda.
 const cadastro=panel('Cadastro');
 const interna=tenant.relationship_kind==='internal'||tenant.organization_type==='internal';
 const salvarEmpresa=async campos=>{
  await api('/api/tenants','PUT',{tenant_id:tenant.id,...campos});
  Object.assign(tenant,campos);
  const noOverview=state.overview?.tenants.find(t=>t.id===tenant.id);if(noOverview)Object.assign(noOverview,campos);
  state.clientSummary=null; // o Histórico ganhou uma linha: a próxima abertura da ficha recarrega
  peek.titulo(tenant.name,subtituloDaEmpresa(tenant));
  renderTenants();renderCompanies();renderLeads();renderPeople();
 };
 const escolha=(valor,opcoes,campo,rotulo)=>campoInline({valor,rotulo,tipo:'select',opcoes,salvar:async v=>{await salvarEmpresa({[campo]:v});return v;}});
 cadastro.append(pares([
  {rotulo:'Nome',valor:campoInline({valor:tenant.name,rotulo:'Nome',obrigatorio:true,validar:v=>v.length<2?'Use ao menos 2 caracteres.':v.length>160?'Use no máximo 160 caracteres.':null,salvar:async v=>{await salvarEmpresa({name:v});return v;}})},
  {rotulo:'Identificador',valor:tenant.slug},
  {rotulo:'Relacionamento',valor:interna?'Organização interna':escolha(tenant.relationship_kind,RELACIONAMENTOS,'relationship_kind','Relacionamento')},
  {rotulo:'Tipo',valor:interna?'Interna':escolha(tenant.organization_type,TIPOS,'organization_type','Tipo de organização')},
  {rotulo:'Situação',valor:interna?clientLabel(tenant.lifecycle_status):escolha(tenant.lifecycle_status,SITUACOES,'lifecycle_status','Situação')},
 ]));

 const hired=panel('Contratações','O que a empresa contratou, com o item do portfólio, os deploys e as campanhas de cada uma.',true);
 if(!engagements.available)hired.append(node('p',engagements.reason,'notice-inline'));
 else if(!engagements.items.length)hired.append(node('p','Nenhuma contratação em curso: registre o que a empresa comprou em Nova contratação.','empty-list'));
 else for(const engagement of engagements.items)hired.append(clientEngagement(engagement,summary));
 for(const [label,section] of [['Deploys',deploys],['Campanhas',summary.campaigns]])if(engagements.available&&engagements.items.length&&!section.available)hired.append(node('p',`${label}: ${section.reason}`,'notice-inline'));

 // Comercial: sem permissão, as duas seções dizem o mesmo motivo — uma frase basta.
 if(!contracts.available&&!origin.available&&contracts.reason===origin.reason)unavailable('Contratos e origem',contracts);
 else{
  if(!contracts.available)unavailable('Contratos comerciais',contracts);
  else if(contracts.items.length){
   const signed=panel('Contratos comerciais','Escopo e aceite registrados. Contrato ativo não concede acesso sozinho.');
   for(const c of contracts.items){const lead=c.lead_id?node('button','Abrir lead','table-action'):null;if(lead){lead.type='button';lead.onclick=()=>openLead(c.lead_id);}signed.append(row(c.title,[CONTRACT_LABELS[c.status]||c.status,minorAmount(c.amount_minor,c.currency),c.product_name||c.product_id,c.starts_on?`desde ${dayLabel(c.starts_on)}${c.ends_on?` até ${dayLabel(c.ends_on)}`:''}`:null].filter(Boolean).join(' · '),...(lead?[lead]:[])));}
   if(contracts.truncated)signed.append(node('p','Mostrando os 100 contratos mais recentes.','detail'));
  }
  if(!origin.available)unavailable('Origem',origin);
  else if(origin.items.length){
   const source=panel('Origem','Leads da empresa, do primeiro ao mais recente: o primeiro diz de onde ela veio.');
   for(const l of origin.items){const open=node('button','Abrir lead','table-action');open.type='button';open.onclick=()=>openLead(l.id);source.append(row(l.name||'Lead',[LEAD_LABELS[l.status]||l.status,l.product_name||l.product_id,l.source_system,l.channel,l.utm_source&&`origem ${l.utm_source}`,l.utm_campaign&&`campanha ${l.utm_campaign}`,dayLabel(l.source_created_at||l.created_at)].filter(Boolean).join(' · '),open));}
   if(origin.truncated)source.append(node('p','Mostrando os 50 primeiros leads.','detail'));
  }
 }

 if(!people.available)unavailable('Pessoas',people);
 else{
  const team=panel('Pessoas','Quem participa do relacionamento.');
  if(!people.items.length)team.append(node('p','Nenhuma pessoa vinculada a esta empresa.','empty-list'));
  for(const person of people.items){const r=row(person.name,roleLine(person));
   const completa=state.overview?.stakeholders.find(x=>x.id===person.id&&x.tenant_id===tenant.id);
   if(completa){const nome=node('button',person.name,'link-nome');nome.type='button';nome.onclick=()=>abrirPessoa(completa);r.querySelector('strong').replaceWith(nome);}
   r.prepend(node('span',person.name.slice(0,1),'person-avatar'));if(person.is_primary)r.append(node('span','Principal','status accent'));team.append(r);}
 }

 if(!hours.available)unavailable('Horas do mês',hours);
 else if(hours.minutes){
  // Total da empresa e, abaixo, o que é de cada contratação (id nulo = atividade geral, sem contratação).
  const time=panel('Horas do mês',`${monthTitle(hours.month)} · separadas por contratação.`);
  time.append(node('strong',hours.minutes?`${workedTime(hours.minutes)} em ${plural(hours.logs,'apontamento','apontamentos')} de ${plural(hours.activities,'atividade','atividades')}`:'Nenhuma hora lançada neste mês.','client-access-count'));
  for(const item of hours.items||[])time.append(node('p',`${item.label||'Sem contratação'} · ${workedTime(item.minutes)}`,'detail'));
  const open=node('button',undefined,'secondary');open.type='button';open.append(createIcon('calendar'),document.createTextNode('Abrir no Acompanhamento'));
  open.onclick=()=>{tracking.focus(tenant.id);switchView('tracking');};time.append(open);
 }

 // Fotos da empresa, no R2 privado: o painel monta a própria listagem e o próprio colar/arrastar.
 // Anexos ficam no fim, em largura total: não disputam a linha com Pessoas (ver .client-photos).
 const fotos=panel('Fotos',null,true);fotos.classList.add('client-photos');fotos.append(photoPanel({type:'tenant',id:tenant.id}));

 // Acesso só aparece quando existe: empresa só de serviço não ganha um painel de zeros.
 if(!access.available)unavailable('Acessos',access);
 else if(access.entitlements.length||access.memberships.length){
  const granted=panel('Acessos','Contratos de produto e identidades com acesso ativo.'),byProduct=new Map();
  for(const e of access.entitlements)byProduct.set(e.product_id,{name:e.product_name||e.product_id,plan:e.plan,rights:e.rights||[],members:0});
  for(const m of access.memberships){const item=byProduct.get(m.product_id)||{name:m.product_name||m.product_id,plan:null,rights:[],members:0};item.members=m.active;byProduct.set(m.product_id,item);}
  for(const item of byProduct.values())granted.append(row(item.name,[item.plan?`Plano ${item.plan}`:'Sem contrato ativo',item.members?plural(item.members,'identidade com acesso','identidades com acesso'):null,item.rights.length?item.rights.join(', '):null].filter(Boolean).join(' · ')));
 }
 // Histórico: o que mudou na empresa, do mais recente para o mais antigo (a trilha de auditoria).
 const history=summary.history;
 if(history&&!history.available)unavailable('Histórico',history);
 else if(history?.items.length){
  const log=panel('Histórico','O que mudou nesta empresa, do mais recente para o mais antigo.',true);
  for(const h of history.items){const d=describeHistory(h),r=row(d.title,[d.detail,new Date(h.at).toLocaleString('pt-BR'),h.actor].filter(Boolean).join(' · '));r.classList.add('history-row');log.append(r);}
  if(history.truncated)log.append(node('p','Mostrando os 30 mais recentes.','detail'));
 }
// As seções construídas acima vão para a aba a que pertencem. Cada aba é uma coluna só.
 const ABA_DO_PAINEL={'Contratações':'contratacoes','Contratos comerciais':'contratacoes','Contratos e origem':'contratacoes','Origem':'contratacoes','Acessos':'contratacoes','Horas do mês':'contratacoes','Histórico':'historico'};
 const paineis={geral:node('div'),contratacoes:node('div'),historico:node('div')};
 for(const aba of Object.values(paineis))aba.className='client-detail-grid client-summary-grid';
 for(const secao of [...grid.children])paineis[ABA_DO_PAINEL[secao.querySelector(':scope > h3')?.textContent||'']||'geral'].append(secao);
 for(const aba of Object.values(paineis))if(!aba.children.length)aba.append(node('p','Nada por aqui ainda.','empty-list'));
 peek.abas([
  {key:'geral',label:'Visão geral',painel:paineis.geral},
  {key:'contratacoes',label:'Contratações',count:engagements.available?engagements.items.length:undefined,painel:paineis.contratacoes},
  {key:'historico',label:'Histórico',painel:paineis.historico}
 ],{ativa:state.empresaAba,aoTrocar:key=>{state.empresaAba=key;}});
 peek.pe([create]);
}

// Nova contratação a partir da ficha: a empresa vem da ficha e não é campo do formulário.
async function openEngagementDialog(tenant){
 const dialog=$('engagement-dialog'),form=$('engagement-form');
 form.reset();dialog.querySelector('.dialog-error').textContent='';engagementTenant=tenant;
 form.elements.tenant_name.value=tenant.name;
 form.elements.service_model.replaceChildren(...SERVICE_MODELS.map(value=>option(value,clientLabel(value))));
 form.elements.status.replaceChildren(...ENGAGEMENT_STATUS.map(value=>option(value,clientLabel(value))));
 fillEngagementProducts();dialog.showModal();
 // Itens do portfólio: os do painel quando já carregados; senão, a lista do CRUD.
 if(!state.overview?.products&&!engagementItems){try{engagementItems=(await api('/api/portfolio')).items||[];fillEngagementProducts();}catch(error){dialog.querySelector('.dialog-error').textContent=error.message;}}
}
function fillEngagementProducts(){
 const form=$('engagement-form'),select=form.elements.product_id,previous=select.value,model=form.elements.service_model.value;
 // Mesma regra de validarContratacao: item ativo com a capacidade do tipo. O servidor confere de novo.
 const capability=model==='product'?'product_engagement':'commercial';
 const items=(state.overview?.products||engagementItems||[]).filter(item=>item.lifecycle_status==='active'&&hasCapability(item,capability));
 select.replaceChildren(option('',model==='product'?'Selecione o produto':'Sem item do portfólio'),...items.map(item=>option(item.id,`${item.name} · ${kindLabelOf(item.portfolio_kind)}`)));
 select.required=model==='product';
 if(items.some(item=>item.id===previous))select.value=previous;
}

// 11999990000 -> (11) 99999-0000. O que não for número de telefone brasileiro segue como veio.
const fonteTelefone = tel => {
 const d = String(tel || '').replace(/\D/g, '');
 const m = d.match(/^(?:55)?(\d{2})(9?\d{4})(\d{4})$/);
 return m ? `(${m[1]}) ${m[2]}-${m[3]}` : String(tel || '');
};
function renderPeople(){
 if(!state.overview)return;
 const names=new Map(state.overview.tenants.map(t=>[t.id,t.name])),query=$('people-search').value.trim().toLocaleLowerCase('pt-BR');
 const people=state.overview.stakeholders.filter(p=>(p.name+' '+(p.title||'')+' '+(names.get(p.tenant_id)||'')+' '+(p.email||'')+' '+(p.phone||'')).toLocaleLowerCase('pt-BR').includes(query)).sort((x,y)=>x.name.localeCompare(y.name,'pt-BR'));
 const host=$('stakeholder-directory');host.replaceChildren();$('people-empty').hidden=people.length>0;
 if(!people.length)return;
 const link=(texto,href,classe)=>{const a=node('a',texto,classe);a.href=href;return a;};
 host.append(tabela({legenda:'Pessoas',linhas:people,aoAbrir:abrirPessoa,colunas:[
  {titulo:'Pessoa',celula:p=>{
   const quem=celulaNome({nome:p.name,apoio:roleLine(p),aoAbrir:()=>abrirPessoa(p)});
   // No celular a coluna Empresa some e a empresa desce para baixo do nome.
   quem.lastChild.append(node('small',names.get(p.tenant_id)||'Cliente','tbl-only-narrow'));
   return quem;}},
  {titulo:'Contato',celula:p=>{
   if(!p.email&&!p.phone)return node('span','Sem e-mail nem telefone','tbl-empty-cell');
   const caixa=node('div',undefined,'tbl-stack');
   if(p.email)caixa.append(link(p.email,'mailto:'+p.email,'tbl-contact'));
   if(p.phone){const tel=link(fonteTelefone(p.phone),'tel:+'+String(p.phone).replace(/\D/g,'').replace(/^(?!55)/,'55'),p.email?'tbl-contact tbl-contact-sub':'tbl-contact');caixa.append(tel);}
   return caixa;}},
  {titulo:'Empresa',classe:'tbl-col-wide',celula:p=>{
   const caixa=node('div',undefined,'tbl-stack');
   const botao=node('button',names.get(p.tenant_id)||'Cliente','tbl-link');botao.type='button';botao.onclick=()=>openClient(p.tenant_id);caixa.append(botao);
   if(p.is_primary)caixa.append(node('small','Contato principal'));
   return caixa;}}
 ]}));
 const rodape=node('div',undefined,'tbl-foot');rodape.append(node('span',plural2(people.length,'pessoa','pessoas')));host.append(rodape);
}

function record(title, detail, edit) {
 const row = node('div', undefined, 'record');
 const content = node('div');
 content.append(node('strong', title), node('span', detail, 'detail'));
 row.append(content);
 if (edit) row.append(botaoEditar({ aria: `Editar ${title}`, aoClicar: edit }));
 return row;
}

// Ficha do Notion de um item, ou null. Um lugar só: antes cada tela buscava de um
// jeito (por id, por nome, objeto vazio) e o mesmo item mudava de estado entre telas.
const catalogOf=product=>product?.catalog||catalogForProduct(product)||null;
// Estado operacional de um item do portfólio. Uma função, usada por todas as telas.
// "Rascunho" é o ciclo cadastral; "Sem deploy observado" é falta de evidência de
// publicação. Palavras diferentes para coisas diferentes.
const productLifecycle=product=>{
 const deployment=readyDeployment(product);
 const evidenceStatus=catalogOf(product)?.status||'';
 if(product.lifecycle_status==='draft')return {label:'Rascunho',tone:'building',next:'Concluir o checklist do projeto antes de ativar',unproven:true};
 if(deployment)return {label:'No ar',tone:'active',next:'Publicado e conferido no provedor'};
 if(product.portfolio_kind==='internal')return {label:'Uso interno',tone:'',next:'Não é vendido; guarda a infraestrutura da própria TZOLKIN'};
 if(!hasCapability(product,'checkout')&&hasCapability(product,'commercial'))return {label:'Opera por contrato',tone:'',next:'Contratada por proposta; deploy não é requisito'};
 if(evidenceStatus==='Planejamento')return {label:'Em planejamento',tone:'building',next:'Criar ou vincular um projeto de deploy',unproven:true};
 return {label:'Sem deploy observado',tone:'building',next:'Vincular um deploy de produção para confirmar que está no ar',unproven:true};
};
// Sem evidência de estar no ar: a tela não oferece o endereço cadastrado como se fosse produção.
const productUnproven=product=>Boolean(productLifecycle(product).unproven);
// O que "cliente ligado" quer dizer depende do tipo do item: contrato de acesso para
// quem dá acesso; contratação em curso para linha de serviço; nada para item interno.
const portfolioCount=product=>{
 const ov=state.overview;if(!ov)return null;
 if(hasCapability(product,'access')){const n=ov.entitlements.filter(e=>e.product_id===product.id&&e.active).length;return {n,text:`${n} ${n===1?'contrato de acesso ativo':'contratos de acesso ativos'}`};}
 if(hasCapability(product,'commercial')){const n=ov.engagements.filter(e=>e.product_id===product.id&&!e.archived_at&&['planned','active','paused'].includes(e.status)).length;return {n,text:`${n} ${n===1?'contratação em curso':'contratações em curso'}`};}
 return null;
};
const kindLabel=product=>kindLabelOf(product?.portfolio_kind);
// A ordem, o plural, o ícone e o texto de cada tipo vêm do registro da API (kindInfo).
// O que cada tipo PODE fazer vem das capacidades que o servidor devolve em cada item.
const CAPABILITY_LABELS={access:'Dá acesso pelo Core',checkout:'Vende por oferta e checkout',contract_billing:'Cobra por contrato (Recebimentos)',commercial:'Captação e contratações'};
const byKind=products=>kindRegistry().map(info=>({kind:info.kind,items:products.filter(p=>canonKind(p.portfolio_kind)===info.kind)})).filter(group=>group.items.length);

// A ficha da empresa recebe o deploy da contratação com as chaves antigas
// (external_project_*). Traduz para a forma do registro único e usa o MESMO
// casamento do resto do painel — o id manda, o nome só com id nominal declarado.
const conexaoDaFicha=binding=>({provider:binding.provider,external_id:binding.external_project_id,external_id_kind:binding.external_id_kind,display_name:binding.external_project_name});
const projectForServiceBinding=binding=>state.deploys.find(p=>casaConexao(conexaoDaFicha(binding),recursoDoDeploy(p)));
const serviceBindingForDeployment=project=>state.resourceBindings.find(b=>b.engagement_id&&b.active!==false&&casaConexao(b,recursoDoDeploy(project)));
// Toda contratação de serviço: mentoria, consultoria, assessoria, sob demanda e o
// que ainda não foi classificado. Só fica de fora 'product', que é acesso a
// software vendido por oferta, e a contratação arquivada, que não é mais serviço
// prestado. Mentoria já entrava pelo modelo 'education'; o que faltava era não
// sumir com a contratação sem tipo — ela é justamente a que precisa ser olhada.
// Derivado da lista do formulário para não existirem duas verdades sobre o que é
// um modelo de contratação: serviço é tudo menos 'product', que é acesso a
// software vendido por oferta.
const MODELOS_DE_SERVICO=SERVICE_MODELS.filter(model=>model!=='product');
const serviceEngagements=()=>state.overview?.engagements?.filter(e=>MODELOS_DE_SERVICO.includes(e.service_model)&&!e.archived_at)||[];

// Conexões pergunta o dono de cada recurso, e os donos são os itens do portfólio e
// as contratações, que já vieram em /api/overview. Passá-los é o que evita a tela
// buscar de novo o mesmo cadastro — e mostrar um nome diferente do da tela ao lado.
const loadConnections=()=>connections.load({
 products:state.overview?.products||[],
 engagements:serviceEngagements(),
 tenants:state.overview?.tenants||[],
}).catch(reportError);

// Filtro por tipo da tela de Serviços. Vive fora de renderServices porque a tela
// se repinta a cada carga: guardado dentro, o filtro escolhido sumiria sozinho.
let serviceFilter='';

function renderServices(){
 const root=$('services-list');if(!root||!state.overview)return;
 const todos=serviceEngagements(),names=new Map(state.overview.tenants.map(t=>[t.id,t.name]));
 const engagements=serviceFilter?todos.filter(e=>e.service_model===serviceFilter):todos;
 // Uma conexão de contratação é de um serviço; contar as linhas do registro único
 // é contar a mesma coisa que a tela mostra, e não o tamanho de uma tabela.
 const conectadas=state.resourceBindings.filter(b=>b.engagement_id&&todos.some(e=>e.id===b.engagement_id));
 $('services-summary').replaceChildren(resumo([['contratações',todos.length],...(serviceFilter?[[clientLabel(serviceFilter).toLocaleLowerCase('pt-BR'),engagements.length]]:[]),['com projeto conectado',new Set(conectadas.map(b=>b.engagement_id)).size]]));
 // O filtro é montado a partir dos tipos que EXISTEM: uma opção que não traz nada
 // só ensina o operador a desconfiar da tela.
 const filtro=$('services-filter');
 if(filtro){
  const tipos=MODELOS_DE_SERVICO.filter(model=>todos.some(e=>e.service_model===model));
  filtro.replaceChildren(option('','Todos os tipos'),...tipos.map(model=>option(model,`${clientLabel(model)} · ${todos.filter(e=>e.service_model===model).length}`)));
  filtro.value=tipos.includes(serviceFilter)?serviceFilter:(serviceFilter='');
  filtro.onchange=()=>{serviceFilter=filtro.value;renderServices();};
 }
 if(!engagements.length){root.replaceChildren(node('p',todos.length?'Nenhuma contratação deste tipo.':'Nenhum serviço contratado foi cadastrado.','empty-list'));return;}
 const projetosDe=engagement=>{
  const bindings=state.resourceBindings.filter(b=>b.engagement_id===engagement.id);
  if(!bindings.length)return '';
  const caixa=node('div',undefined,'tbl-stack');
  for(const binding of bindings){
   const project=state.deploys.find(p=>casaConexao(binding,recursoDoDeploy(p)));const latest=project?.deployments?.[0];
   const linha=node('div');linha.append(node('strong',binding.display_name,'tbl-name-plain'),node('small',`${PROVIDER_LABELS[binding.provider]||binding.provider} · ${latest?.state_label||latest?.state||'sem deploy observado'}`));
   if(latest?.url)linha.append(catalogLink('Abrir ↗',latest.url,'product-live-link'));
   caixa.append(linha);
  }
  return caixa;
 };
 root.replaceChildren(tabela({legenda:'Serviços contratados',linhas:engagements,aoAbrir:e=>openClient(e.tenant_id),colunas:[
  {titulo:'Serviço',celula:e=>celulaNome({inicial:e.label,nome:e.label,apoio:`${names.get(e.tenant_id)||'Cliente'} · ${clientLabel(e.service_model)}`,aoAbrir:()=>openClient(e.tenant_id),rotulo:`Abrir ${names.get(e.tenant_id)||'cliente'}`})},
  {titulo:'Situação',celula:e=>selo(clientLabel(e.status),tomDoEstado(e.status))},
  {titulo:'Projetos conectados',celula:projetosDe},
  {titulo:'',num:true,celula:e=>{const botao=node('button','Campanhas','table-action');botao.type='button';botao.onclick=()=>{switchView('serviceCampaigns');campaigns.loadService(e.id,e.label).catch(reportError);};return botao;}}
 ]}));
}

function renderManagement(){
 const schema=$('management-schema'),dns=$('management-dns'),redis=$('management-redis');
 const tables=state.management?.tables||[];
 if(schema&&state.view==='database')renderDatabaseWorkspace(schema,{
  api,products:state.overview?.products||[],bindings:state.resourceBindings,
  openProduct:id=>switchContext(id).catch(reportError),
  onBindingsChange:async bindings=>{state.resourceBindings=bindings;state.topology=await api('/api/products/topology');}
 });
 if(dns){const dnsData=state.dns;dns.replaceChildren(node('h3','Hostinger'),node('p','Zona consultada diretamente na Hostinger. Registros ficam em leitura até uma alteração ser validada e confirmada.','detail'));if(!dnsData)dns.append(node('p','Consultando zona DNS…','empty-list'));else if(dnsData.status!=='ok')dns.append(node('p',dnsData.status==='unconfigured'?'API DNS ainda não configurada no servidor.':dnsData.status==='unauthorized'?'A chave da Hostinger não possui acesso à zona.':'A zona DNS não pôde ser consultada agora.','notice-inline'));else {const head=node('div',undefined,'dns-zone-head');head.append(node('strong',dnsData.zone),node('span',`${dnsData.records.length} registros`,'status active'));dns.append(head);const records=node('div',undefined,'dns-record-list');dnsData.records.slice(0,12).forEach(record=>{const row=node('article',undefined,'dns-record-row');row.append(node('code',record.type),node('strong',record.name),node('span',record.records.map(item=>item.content).join(' · '),'detail'),node('span',`TTL ${record.ttl}s`,'detail'));records.append(row);});dns.append(records);if(dnsData.records.length>12)dns.append(node('p',`Mostrando 12 de ${dnsData.records.length} registros da zona.`,'detail'));}}
 if(redis){const services=(state.infrastructure?.projects||[]).flatMap(project=>(project.services||[]).map(service=>({...service,project:project.name})));redis.replaceChildren();const caches=services.filter(service=>['redis','cache'].includes(String(service.type).toLowerCase()));if(!caches.length)redis.append(node('p','Nenhum Redis/cache foi retornado pelo inventário do EasyPanel.','empty-list'));else {const groups=new Map();for(const service of caches){const key=service.project;const list=groups.get(key)||[];list.push(service);groups.set(key,list);}for(const [project,items] of groups){const group=node('section',undefined,'redis-project-group');group.append(node('h4',project),node('span',`${items.length} instância${items.length===1?'':'s'}`,'status'));for(const service of items){const card=node('article',undefined,'redis-console-card');const head=node('header',undefined,'redis-console-head');head.append(deliveryIcon('cache'),node('div'));head.lastChild.append(node('strong',service.name),node('span',`${service.type} · EasyPanel`,'detail'));head.append(node('span','Observado','status building'));card.append(head);const metrics=node('div',undefined,'redis-metric-grid');[['Estado','Inventário'],['Chaves','Não exposto'],['Memória','Não exposto'],['Operações/s','Não exposto']].forEach(([label,value])=>{const item=node('div');item.append(node('span',label),node('strong',value));metrics.append(item);});card.append(metrics,node('p','Leitura de inventário; chaves e valores permanecem protegidos.','detail'));group.append(card);}redis.append(group);}}}
}

function renderGeneral() {
 const overview = state.overview;
 // Trocar de contexto apaga os dados e recarrega; um clique no menu nesse intervalo chega aqui sem overview.
 // As telas irmãs (clientes, pessoas, empresas, serviços) já saem cedo; load() desenha de novo ao terminar.
 if (!overview) return;
 const servicesLink=$('products-services-link');if(servicesLink)servicesLink.onclick=()=>switchView('services');
 renderMetrics([
  ['Clientes', overview.tenants.filter(t=>t.relationship_kind==='customer').length],
  ['Contratos de acesso', overview.entitlements.filter(e => e.active).length],
  ['Vínculos de acesso', overview.memberships.filter(m => m.active).length],
 ]);
 fillDirectorySelects();
 renderTenants();
 renderLeads(); renderCompanies();
 const names = new Map(overview.tenants.map(t => [t.id, t.name]));
 const products = new Map(overview.products.map(p => [p.id, p.name]));
 const portfolioRow = product => {
  const productInfo=catalogOf(product)||{};
  const count = portfolioCount(product);
  const published=publishedDeployUrl(product),lifecycle=productLifecycle(product),isDraft=Boolean(lifecycle.unproven),live=isDraft?(published||null):productLiveUrl(product);
  return {product,count,published,lifecycle,isDraft,live,productInfo};
 };
 const portfolioTable = itens => tabela({legenda:'Espaços do portfólio',linhas:itens.map(portfolioRow),aoAbrir:r=>openProductModule(r.product,'product').catch(reportError),colunas:[
  {titulo:'Espaço',celula:r=>{
   const quem=node('div',undefined,'tbl-who'),mark=node('span',undefined,'product-mark');mark.append(productFavicon(productFaviconUrl(r.product)));
   const texto=node('span'),nome=node('button',r.product.name,'tbl-name');nome.type='button';nome.setAttribute('aria-label','Abrir gestão de '+r.product.name);nome.onclick=event=>{event.stopPropagation();openProductModule(r.product,'product').catch(reportError);};
   texto.append(nome,node('small',[kindLabel(r.product),r.product.id].join(' · ')));quem.append(mark,texto);return quem;}},
  {titulo:'Estado',celula:r=>selo(r.lifecycle.label,r.lifecycle.tone)},
  {titulo:'Andamento',classe:'tbl-wrap-text',celula:r=>{
   const caixa=node('div',undefined,'tbl-stack');
   if(r.count?.text&&r.count.n>0)caixa.append(node('span',r.count.text));
   if(r.lifecycle.next)caixa.append(node('small',r.lifecycle.next));
   return caixa.children.length?caixa:'';}},
  {titulo:'',classe:'tbl-actions',celula:r=>{
   const acoes=node('div',undefined,'tbl-actions-row');
   const botao=(rotulo,acao,classe)=>{const b=node('button',rotulo,classe);b.type='button';b.onclick=event=>{event.stopPropagation();acao();};return b;};
   acoes.append(botaoEditar({aria:`Editar ${r.product.name}`,aoClicar:()=>abrirEspaco(r.product)}));
   // O atalho só existe para o que o tipo tem (cobrança por checkout, ou recebimentos por contrato).
   const atalho=hasCapability(r.product,'checkout')?['Cobrança e e-mails','product-payments']:hasCapability(r.product,'contract_billing')?['Recebimentos','product-receivables']:null;
   if(atalho)acoes.append(botao(atalho[0],()=>openProductModule(r.product,atalho[1]).catch(reportError),'table-action quiet-action'));
   if(r.live)acoes.append(catalogLink(r.published?'Abrir deploy ↗':'Abrir produto ↗',r.live,'product-live-link'));else if(r.productInfo.url&&!r.isDraft)acoes.append(catalogLink('Abrir endereço ↗',r.productInfo.url,'product-live-link'));
   return acoes;}}
 ]});
 // Abas por tipo, com a contagem: "Todos" e uma aba por tipo do registro. Todos os
 // tipos aparecem, mesmo vazios: quem cadastra precisa ver onde o espaço novo cabe.
 const tipos=kindRegistry(),doTipo=kind=>overview.products.filter(p=>canonKind(p.portfolio_kind)===kind);
 const abas=[{key:'all',label:'Todos',count:overview.products.length},...tipos.map(info=>({key:info.kind,label:info.plural,count:doTipo(info.kind).length}))];
 if(!abas.some(aba=>aba.key===state.portfolioTab))state.portfolioTab='all';
 const pintarPortfolio=()=>{
  const key=state.portfolioTab,info=key==='all'?null:kindInfo(key),grade=$('product-catalog'),nota=$('portfolio-note');
  const itens=key==='all'?tipos.flatMap(item=>doTipo(item.kind)):doTipo(key);
  grade.setAttribute('aria-labelledby',`portfolio-tab-${key}`);
  // Só numa aba de tipo há o que dizer sobre ele: o que é e o que pode fazer.
  nota.replaceChildren();
  if(info){
   nota.append(node('p',info.what));
   const podem=(itens[0]?.capabilities||[]).filter(c=>CAPABILITY_LABELS[c]);
   if(itens.length){const caps=node('div',undefined,'portfolio-kind-caps');caps.append(...(podem.length?podem.map(c=>node('span',CAPABILITY_LABELS[c],'status')):[node('span','Só é operado','status')]));nota.append(caps);}
  }
  if(itens.length){grade.replaceChildren(portfolioTable(itens));return;}
  const vazio=node('div',undefined,'empty-state');
  const criar=node('button','Novo espaço','primary');criar.type='button';criar.onclick=()=>abrirEspaco(null,info?.kind);
  vazio.append(node('h3',info?`Nenhum espaço de ${info.label.toLowerCase()} ainda.`:'Nenhum espaço cadastrado ainda.'),node('p','Um espaço é onde a TZOLKIN organiza o que vende ou opera.'),criar);
  grade.replaceChildren(vazio);
 };
 mountTabs({host:$('portfolio-tabs'),tabs:abas,active:state.portfolioTab,label:'Tipos de espaço',prefix:'portfolio',panelId:'product-catalog',onChange:key=>{state.portfolioTab=key;pintarPortfolio();}});
 pintarPortfolio();

 $('contracts').replaceChildren(...overview.entitlements.map(entitlement => record(
  names.get(entitlement.tenant_id) || 'Cliente',
  (products.get(entitlement.product_id) || entitlement.product_id) + ' · ' + entitlement.plan + ' · ' + (entitlement.active ? 'Ativo' : 'Revogado'),
  () => openDialog('entitlement-dialog', entitlement))));
 $('members').replaceChildren(...overview.memberships.map(membership => record(
  membership.subject,
  (names.get(membership.tenant_id) || 'Cliente') + ' · ' +
   (products.get(membership.product_id) || membership.product_id) + ' · ' +
   (membership.active ? 'Ativo' : 'Revogado'),
  () => openDialog('member-dialog', membership))));
 if (!overview.entitlements.length) $('contracts').append(node('p', 'Nenhum produto vinculado a um cliente.', 'empty-list'));
 if (!overview.memberships.length) $('members').append(node('p', 'Nenhuma pessoa vinculada a um cliente.', 'empty-list'));
}

/* ---------- vínculo de recurso a dono, nas abas dos provedores ---------- */

const rotuloDoDonoDe = binding => binding.product_id ? state.overview?.products?.find(p => p.id === binding.product_id)?.name
 : state.overview?.engagements?.find(e => e.id === binding.engagement_id)?.label;
const contextoDeVinculo = inventario => ({
 itens: achatar(inventario || delivery.inventory()),
 conexoes: state.resourceBindings.filter(b => b.active !== false),
 donos: { products: state.overview?.products || [], engagements: serviceEngagements(), tenants: state.overview?.tenants || [] },
 casa: casaConexao,
});
// Vincular numa aba recarrega as conexões e redesenha tudo o que as mostra.
async function atualizarVinculos() {
 state.resourceBindings = (await api('/api/product-resource-bindings')).bindings || [];
 await delivery.load();
}
const vinculoNoProvedor = (recurso, inventario) => vinculoNaLista({ recurso, contexto: contextoDeVinculo(inventario), api, aoVincular: atualizarVinculos, rotuloDoDono: rotuloDoDonoDe });

/* ---------- deploys (leitura de provedores externos) ---------- */

const ESTADO_CLASSE = { READY: ' active', ERROR: ' failed', CANCELED: ' failed', BLOCKED: ' failed' };
let deployData=null;
const deployGroup = p => {const s=p.deployments[0]?.state;return s==='READY'?'ready':['BUILDING','QUEUED','INITIALIZING'].includes(s)?'progress':['ERROR','CANCELED','BLOCKED'].includes(s)?'failed':'unknown';};

function quando(iso) {
 if (!iso) return '—';
 const minutos = Math.round((Date.now() - Date.parse(iso)) / 60000);
 if (!Number.isFinite(minutos)) return '—';
 if (minutos < 1) return 'agora';
 if (minutos < 60) return `há ${minutos} min`;
 const horas = Math.round(minutos / 60);
 if (horas < 24) return `há ${horas} h`;
 const dias = Math.round(horas / 24);
 return dias === 1 ? 'há 1 dia' : `há ${dias} dias`;
}

function resourceButton(label,provider,id,environment='production',tab='overview',deployment) {
 const b=node('button',undefined,'secondary');b.type='button';b.append(deliveryIcon('layers'),document.createTextNode(label));
 b.onclick=()=>resource.open(provider,id,environment,tab,deployment);return b;
}
function linhaDeploy(deploy, principal, projeto) {
 const linha = node('div', undefined, 'deploy-row' + (principal ? ' principal' : ''));
 const esquerda = node('div');
 const chip = node('span', deploy.state==='READY'?'Pronto':deploy.state_label || 'Estado desconhecido', 'status' + (ESTADO_CLASSE[deploy.state] || (['BUILDING','QUEUED','INITIALIZING'].includes(deploy.state)?' building':'')));
 const cabecalho = node('div', undefined, 'deploy-head');
 cabecalho.append(chip);
 if (deploy.target) cabecalho.append(node('span', ({production:'Produção',preview:'Preview'})[deploy.target] || deploy.target, 'deploy-target'));
 if(principal) cabecalho.append(node('span','Mais recente','deploy-latest'));
 esquerda.append(cabecalho);

 const detalhe=node('div',undefined,'deploy-source');
 if(deploy.branch){const branch=node('span');branch.append(deliveryIcon('branch'),document.createTextNode(deploy.branch));detalhe.append(branch);}
 if(deploy.commit)detalhe.append(node('code',deploy.commit));
 if(deploy.author){const author=node('span');author.append(deliveryIcon('people'),document.createTextNode('Criador do deploy: '+deploy.author));detalhe.append(author);}
 esquerda.append(detalhe);
 if (deploy.commit_message) esquerda.append(node('span', deploy.commit_message, 'deploy-message'));
 if (deploy.error_message) esquerda.append(node('span', deploy.error_message, 'deploy-error'));

 const direita = node('div', undefined, 'deploy-links');
 direita.append(node('span', quando(deploy.created_at), 'detail'));
 if (projeto.project_id) direita.append(resourceButton('Ver deploy',projeto.provider,projeto.project_id,'production','deployments',deploy.id));
 linha.append(esquerda, direita);
 return linha;
}

function renderEasypanel(data) {
 const target = $('easypanel-inventory');
 target.replaceChildren();
 if (!data.configured || data.status !== 'ok') {
  target.append(node('p', data.configured ? data.message : 'EasyPanel ainda não conectado. Configure a URL HTTPS e a credencial no servidor.', 'empty-list'));
  return;
 }
 if (data.omitted_projects || data.omitted_services)
  target.append(node('p', `Lista parcial: ${data.omitted_projects} projetos e ${data.omitted_services} serviços omitidos.`, 'notice-inline'));
 if (!data.projects.length) target.append(node('p', 'Nenhum projeto acessível a esta credencial.', 'empty-list'));
 for (const project of data.projects) {
  const card = node('article', undefined, 'deploy-card');
  const header=node('header'),identity=node('div',undefined,'card-identity');identity.append(providerLogo('easypanel'),node('h3',project.name));header.append(identity,node('span',`${project.services.length} serviços`,'status'));card.append(header);
  const types=node('div',undefined,'card-tags');for(const type of [...new Set(project.services.map(s=>s.type))])types.append(node('span',type,'status'));card.append(types);
  for (const service of project.services){const row=node('div',undefined,'infra-service-row'),info=node('div',undefined,'card-identity');info.append(deliveryIcon(['postgres','mysql','mariadb','mongo'].includes(service.type)?'database':service.type==='redis'?'cache':'api'),node('strong',service.name),node('span',service.type,'status'));row.append(info,resourceButton('Detalhes','easypanel',`${project.name}/${service.name}`));card.append(row,vinculoNoProvedor({provider:'easypanel',id:`${project.name}/${service.name}`,name:`${project.name} / ${service.name}`}));}
  card.append(node('p','Inventário do EasyPanel · não comprova saúde dos serviços','card-footer'));
  if (!project.services.length) card.append(node('p', 'Nenhum serviço cadastrado.', 'empty-list'));
  target.append(card);
 }
}

function renderDeploys(data) {
 deployData=data;
 const summary=$('deploys-summary');summary.replaceChildren();
 for(const [label,count,icon] of [['Projetos consultados',data.projects.length,'layers'],['Último deploy pronto',data.projects.filter(p=>deployGroup(p)==='ready').length,'check'],['Em andamento',data.projects.filter(p=>deployGroup(p)==='progress').length,'cloud'],['Falhas / interrupções',data.projects.filter(p=>deployGroup(p)==='failed').length,'alert']]){
  const card=node('article');const title=node('span');title.append(deliveryIcon(icon),document.createTextNode(label));card.append(title,node('strong',String(count)));summary.append(card);
 }
 const query=$('deploy-search').value.trim().toLocaleLowerCase('pt-BR'),filter=$('deploy-filter').value;
 const projects=data.projects.filter(p=>(filter==='all'||deployGroup(p)===filter)&&[p.project,...p.deployments.flatMap(d=>[d.branch,d.commit,d.commit_message])].filter(Boolean).join(' ').toLocaleLowerCase('pt-BR').includes(query));
 $('deploy-results').textContent=`${projects.length} de ${data.projects.length} projetos`;
 $('deploys-status').replaceChildren();
 $('deploys-list').replaceChildren();
 $('deploys-caption').textContent = data.configured && data.checked_at
  ? 'Consultado ' + quando(data.checked_at) : '';

 // Provedor com problema é dito, não escondido — e não impede o resto de aparecer.
 for (const provedor of data.providers.filter(p => p.status !== 'ok'))
  $('deploys-status').append(node('p', `${provedor.provider}: ${provedor.message}`, 'security-banner'));
 // Corte nunca é silencioso: lista incompleta que parece completa engana.
 for (const provedor of data.providers.filter(p => p.truncated > 0))
  $('deploys-status').append(node('p',
   `${provedor.provider}: mostrando os primeiros projetos; ${provedor.truncated} não couberam nesta consulta.`,
   'notice-inline'));

 if (!data.configured) {
  $('deploys-list').append(deployEmpty('Conecte uma plataforma de deploy',
   'Defina VERCEL_TOKEN no ambiente do servidor e reinicie o Core. A credencial nunca chega ao navegador.'));
  return;
 }
 if (!data.projects.length) {
  $('deploys-list').append(deployEmpty('Nenhum deploy recente.',
   'O provedor respondeu, mas não há deploys no alcance desta credencial.'));
  return;
 }
 if(!projects.length)$('deploys-list').append(deployEmpty('Nenhum projeto com esses filtros','Tente outro nome ou selecione todos os estados.'));
 for (const projeto of projects) {
  const card = node('article', undefined, 'deploy-card');
  const topo = node('header');
  const identidade = node('div', undefined, 'deploy-head');
  const mark=node('span',undefined,'deploy-project-mark');mark.append(faviconDoProjeto(projeto.project,mark));identidade.append(mark,node('h3', projeto.project || 'Projeto sem nome'));
  // Sem repositório não há commit, não há rollback por commit e não dá para criar Deploy Hook.
  if (projeto.git_connected === false) identidade.append(node('span', 'sem repositório', 'status'));
  const actions=node('div',undefined,'deploy-project-actions');actions.append(node('span', projeto.provider, 'ecosystem-category'));
  if(projeto.project_id)actions.append(resourceButton('Ver projeto',projeto.provider,projeto.project_id));
  topo.append(identidade,actions);
  card.append(topo);
  if(projeto.project_id){const item=achatar(delivery.inventory()).find(i=>i.provider==='vercel'&&i.id===projeto.project_id);card.append(vinculoNoProvedor({provider:'vercel',id:projeto.project_id,name:projeto.project,repository:item?.repository||null}));}

  if (!projeto.deployments.length) {
   card.append(node('p', projeto.partial
    ? 'Não foi possível ler os deploys deste projeto agora.'
    : 'Nenhum deploy recente.', 'empty-list'));
  } else {
   const [atual, ...anteriores] = projeto.deployments;
   card.append(linhaDeploy(atual, true, projeto));
   if(anteriores.length){const history=node('details',undefined,'deploy-history');history.append(node('summary',`Histórico recente · ${Math.min(anteriores.length,3)} anteriores`));for(const anterior of anteriores.slice(0,3))history.append(linhaDeploy(anterior,false,projeto));card.append(history);}
  }
  $('deploys-list').append(card);
 }
}

// O ícone do cartão é o favicon do próprio site (alias de produção <projeto>.vercel.app: a URL de cada deploy fica atrás do
// login da Vercel e não responde). Enquanto busca, mostra a logo da Vercel; sem favicon, ela fica.
function faviconDoProjeto(nome,mark){
 const vercelMark=()=>{const logo=providerLogo('vercel');logo.alt='Vercel';logo.setAttribute('aria-label','Vercel');return logo;};
 if(!nome)return vercelMark();
 faviconDoSite('https://'+nome+'.vercel.app').then(href=>{
  if(!href||!mark.isConnected)return;
  const img=document.createElement('img');img.className='product-favicon';img.alt='';img.setAttribute('aria-hidden','true');
  img.onload=()=>mark.replaceChildren(img);
  img.onerror=()=>{};
  img.src=href;
 });
 return vercelMark();
}

function deployEmpty(title,message){const box=node('div',undefined,'empty-state');const icon=node('span',undefined,'empty-symbol');icon.append(deliveryIcon('cloud'));box.append(icon,node('h3',title),node('p',message));return box;}

function estadoVazio(simbolo, titulo, texto) {
 const bloco = node('div', undefined, 'empty-state');
 bloco.append(node('span', simbolo, 'empty-symbol'), node('h3', titulo), node('p', texto));
 return bloco;
}

/* ---------- contexto de produto ---------- */

const PRODUCT_RESOURCE_TYPES = {
 repositories: ['repository','Código'], frontend: ['frontend','Frontend'], backend: ['backend','Backend'],
 domains: ['domain','Domínios'], api: ['api','APIs'], worker: ['worker','Workers'], database: ['database','Bancos'],
 cache: ['cache','Caches'], checkout: ['checkout','Checkout'], emails: ['email','E-mails'],
};
const PRODUCT_RESOURCE_PROVIDERS = [['manual','Manual'],['github','GitHub'],['vercel','Vercel'],['easypanel','EasyPanel'],['hostinger','Hostinger'],['stripe','Stripe'],['asaas','Asaas']];
const PRODUCT_RESOURCE_ENVIRONMENTS = [['','Sem ambiente'],['production','Produção'],['staging','Homologação'],['development','Desenvolvimento'],['internal','Interno']];

const resourcePayload = (product, category, item = {}) => ({
 id: item.binding_id || undefined,
 // A revisão que a tela leu: editar uma conexão que existe exige dizer qual versão
 // está na tela, senão duas pessoas salvam por cima uma da outra sem saber.
 revision: item.revision,
 product_id: product.id,
 resource_type: PRODUCT_RESOURCE_TYPES[category]?.[0] || item.resource_type || 'api',
 provider: item.provider || 'manual',
 external_id: String(item.id || item.name || ''),
 display_name: item.name || item.provider || '',
 environment: item.environment || null,
 url: item.url || '',
});

async function reloadProductConnections(product) {
 const [topology,bindings] = await Promise.all([
  api('/api/products/topology'),
  api(`/api/product-resource-bindings?product_id=${encodeURIComponent(product.id)}`),
 ]);
 state.topology = topology;
 state.resourceBindings = bindings.bindings || [];
 renderProduct();
}

function productResourceForm(product, initial = {}, onCancel = () => {}) {
 const form=node('form',undefined,'product-resource-form');
 const fields=node('div',undefined,'product-resource-fields');
 const field=(label,name,control)=>{const wrapper=node('label');wrapper.append(node('span',label),control);control.name=name;return wrapper;};
 const type=document.createElement('select');for(const [, [value,label]] of Object.entries(PRODUCT_RESOURCE_TYPES))type.append(option(value,label));type.value=initial.resource_type||'repository';
 const provider=document.createElement('select');provider.append(...PRODUCT_RESOURCE_PROVIDERS.map(([value,label])=>option(value,label)));provider.value=initial.provider||'manual';
 const environment=document.createElement('select');environment.append(...PRODUCT_RESOURCE_ENVIRONMENTS.map(([value,label])=>option(value,label)));environment.value=initial.environment||'';
 const display=node('input');display.value=initial.display_name||'';display.required=true;display.maxLength=240;
 const external=node('input');external.value=initial.external_id||'';external.required=true;external.maxLength=300;
 const url=node('input');url.type='url';url.value=initial.url||'';url.maxLength=1000;url.placeholder='https://…';
 fields.append(field('Tipo','resource_type',type),field('Provedor','provider',provider),field('Nome','display_name',display),field('ID externo','external_id',external),field('Ambiente','environment',environment),field('URL HTTPS','url',url));
 const error=node('p',undefined,'form-error');error.setAttribute('role','alert');
 const actions=node('div',undefined,'product-resource-form-actions'),cancel=node('button','Cancelar','secondary'),save=node('button',initial.id?'Salvar alterações':'Confirmar conexão','primary');cancel.type='button';save.type='submit';cancel.onclick=onCancel;actions.append(cancel,save);
 form.append(fields,error,actions);
 form.onsubmit=async event=>{event.preventDefault();save.disabled=true;error.textContent='';const data=Object.fromEntries(new FormData(form));try{await api('/api/product-resource-bindings','PUT',{...data,id:initial.id||undefined,revision:initial.id?initial.revision:undefined,product_id:product.id,environment:data.environment||null,url:data.url||null});await reloadProductConnections(product);}catch(reason){error.textContent=reason.message;save.disabled=false;}};
 requestAnimationFrame(()=>display.focus());
 return form;
}

function productResourceRow(product, category, item) {
 const wrapper=node('div',undefined,'product-architecture-entry'),row=node('div',undefined,'product-architecture-row');
 const title=item.name||item.provider||'Configuração',meta=[item.provider,item.repository||item.branch||item.record_type||item.kind,item.environment].filter(Boolean).join(' · ')||(item.offers?`${item.offers} oferta${item.offers===1?'':'s'}`:'');
 row.append(node('strong',title),node('span',meta,'detail'));
 const statusText=item.source==='confirmed'?(item.reconciliation==='missing'?'Não encontrado no provedor':item.reconciliation==='manual'?'Manual':item.reconciliation==='unverified'?'Provedor sem resposta agora':'Confirmado e observado'):item.source==='detected'?'Detectado':'Configurado';
 row.append(node('span',statusText,`status ${item.reconciliation==='missing'?'danger':item.source==='detected'||item.reconciliation==='unverified'?'building':'active'}`));
 const actions=node('div',undefined,'product-resource-actions');
 if(item.source==='detected'){
  const confirm=node('button','Confirmar','table-action');confirm.type='button';confirm.onclick=async()=>{confirm.disabled=true;try{await api('/api/product-resource-bindings','PUT',{...resourcePayload(product,category,item),id:undefined,revision:undefined});await reloadProductConnections(product);}catch(error){confirm.disabled=false;reportError(error);}};actions.append(confirm);
 } else if(item.binding_id){
  const edit=botaoEditar({aria:`Editar vínculo de ${item.name||item.label||'recurso'}`}),remove=node('button','Remover','table-action danger-link');edit.type=remove.type='button';
  edit.onclick=()=>{wrapper.querySelector('.product-resource-form')?.remove();wrapper.append(productResourceForm(product,resourcePayload(product,category,item),()=>wrapper.querySelector('.product-resource-form')?.remove()));};
  remove.onclick=()=>{actions.replaceChildren(node('span','Remover este vínculo?','detail'));const cancel=node('button','Cancelar','table-action'),confirm=node('button','Sim, remover','table-action danger-link');cancel.type=confirm.type='button';cancel.onclick=()=>actions.replaceChildren(edit,remove);confirm.onclick=async()=>{confirm.disabled=true;try{await api(`/api/product-resource-bindings/${encodeURIComponent(item.binding_id)}`,'DELETE');await reloadProductConnections(product);}catch(error){confirm.disabled=false;reportError(error);}};actions.append(cancel,confirm);};
  actions.append(edit,remove);
 }
 if(actions.childElementCount)row.append(actions);wrapper.append(row);return wrapper;
}

function renderProductArchitecture(product) {
 const topology=state.topology?.products?.find(item=>item.id===product.id),architecture=node('section',undefined,'product-architecture');
 const heading=node('div',undefined,'product-architecture-heading'),copy=node('div');copy.append(node('div','ARQUITETURA TÉCNICA','overview-kicker'),node('h3','Conexões e recursos'),node('p','O inventário detecta candidatos. Uma conexão confirmada é persistida, auditada e reconciliada com o provedor.','detail'));
 const add=node('button','Adicionar conexão','secondary');add.type='button';heading.append(copy,add);architecture.append(heading);
 const editor=node('div',undefined,'product-resource-editor');add.onclick=()=>{editor.replaceChildren(productResourceForm(product,{},()=>editor.replaceChildren()));};architecture.append(editor);
 if(!topology){architecture.append(node('p','Consultando as conexões nos provedores…','empty-list'));return architecture;}
 const missing=Object.values(topology.connections).flat().filter(item=>item.reconciliation==='missing').length;
 if(missing)architecture.append(node('p',`${missing} ${missing===1?'conexão confirmada não foi encontrada':'conexões confirmadas não foram encontradas'} no inventário atual. Revise antes do próximo deploy.`,'product-resource-warning'));
 const grid=node('div',undefined,'product-architecture-grid'),vazias=[];
 for(const [category,[,label]] of Object.entries(PRODUCT_RESOURCE_TYPES)){
  const items=topology.connections[category]||[];
  if(!items.length){vazias.push(label);continue;}
  const group=node('article',undefined,'product-architecture-group');group.append(node('span',label,'product-architecture-label'));
  items.forEach(item=>group.append(productResourceRow(product,category,item)));grid.append(group);
 }
 if(grid.children.length)architecture.append(grid);
 // Nove "Ainda não identificado." em fila ensinam a ignorar a tela: uma linha só.
 if(vazias.length)architecture.append(node('p',`Ainda sem: ${vazias.join(', ')}.`,'detail'));
 return architecture;
}

function renderProductRecord(product) {
 const panel = node('div', undefined, 'context-card product-record-card');
 // Linha de serviço: vende por proposta, sem checkout nem acesso de usuários.
 const serviceLine=!hasCapability(product,'checkout')&&hasCapability(product,'commercial');
 const kicker=kindLabelOf(product.portfolio_kind).toUpperCase();
 const recordActions=serviceLine?[['Captação inbound','product-inbound','user-plus'],['Contratações','product-engagements','briefcase'],['Chaves de integração','product-keys','lock'],['E-mails','product-emails','mail']]:hasCapability(product,'checkout')?[['Cobrança','product-payments','wallet'],['E-mails','product-emails','mail']]:[];
 const lifecycle=productLifecycle(product),appearsDraft=productUnproven(product),live=appearsDraft?(publishedDeployUrl(product)||null):productLiveUrl(product);const identity=node('div',undefined,'product-record-identity');identity.append(productFavicon(productFaviconUrl(product)),node('div'));identity.lastChild.append(node('span',kicker,'overview-kicker'),node('h2', product.name), node('p', 'Identificador: ' + product.id, 'detail'));panel.append(identity);
 const actions=node('div',undefined,'product-record-actions');for(const [label,view,icon] of recordActions){const button=node('button',undefined,'secondary');button.type='button';button.append(createIcon(icon),document.createTextNode(label));button.onclick=()=>switchView(view);actions.append(button);}
 // A tela do próprio espaço também edita o espaço: nome, tipo e tags (o cadastro do overview tem a revisão).
 const editarEspaco=botaoEditar({texto:'Editar espaço',grande:true});editarEspaco.onclick=()=>abrirEspaco(state.overview?.products?.find(p=>p.id===product.id)||product);actions.append(editarEspaco);
 const detach=node('button','Desatrelar conexões','quiet');detach.type='button';detach.onclick=async()=>{if(!window.confirm(`Desatrelar domínios, bancos e deploys de ${product.name}? Nenhum dado externo será apagado.`))return;detach.disabled=true;try{await api(`/api/products/${encodeURIComponent(product.id)}/attachments`,'DELETE');state.resourceBindings=state.resourceBindings.filter(item=>item.product_id!==product.id);state.topology=await api('/api/products/topology').catch(()=>null);renderProductRecord(product);}catch(error){detach.disabled=false;reportError(error);}};actions.append(detach);panel.append(actions);
 const catalog = product.catalog;
 if (catalog) {
  panel.append(node('p', catalog.description, 'context-description'));
  const meta = node('div', undefined, 'catalog-links');
  if (live) meta.append(catalogLink('Abrir deploy ↗', live));
  else if (catalog.url&&!appearsDraft) meta.append(catalogLink('Abrir endereço ↗', catalog.url));
  if (catalog.source) meta.append(catalogLink('Ficha no Notion ↗', catalog.source));
  panel.append(node('span', catalog.status, 'status'), node('small', catalog.note), meta);
 } else {
  panel.append(node('p', 'Sem ficha no catálogo importado do Notion. Nada foi inferido para preencher este espaço.', 'context-description'));
 }
 const facts=node('div',undefined,'product-record-facts');for(const [label,value] of (serviceLine?[['Tipo',kindLabelOf(product.portfolio_kind)],['Entrada','Formulário inbound ou proposta'],['Cobrança','Fora do checkout']]:[['Tipo',kindLabelOf(product.portfolio_kind)],['Estado operacional',lifecycle.label],['Família',product.brand_family||'TZOLKIN']])){const fact=node('div');fact.append(node('span',label),node('strong',String(value)));facts.append(fact);}panel.append(facts);
 const connection=node('section',undefined,'product-connection-card'),deployment=readyDeployment(product),project=state.deploys.find(item=>deploymentBelongsToProduct(item,product));connection.append(node('h3','Conexão de deploy'),node('p',deployment?`${project?.project||'Projeto'} · ${project?.provider==='vercel'?'Vercel':'EasyPanel'} · publicado e observado`:'Nenhum deploy READY vinculado a este item.','detail'));const connectionActions=node('div',undefined,'product-connection-actions');if(deployment?.url)connectionActions.append(catalogLink('Abrir produção ↗',deployment.url,'product-live-link'));const openDeploys=node('button','Ver projetos e deploys →','secondary');openDeploys.type='button';openDeploys.onclick=()=>{state.context='';state.view='deploys';clearRenderedData();renderContextChrome();renderNav();load().catch(reportError);};connectionActions.append(openDeploys);connection.append(connectionActions);panel.append(connection);
 panel.append(renderProductArchitecture(product));
 $('product-record').replaceChildren(panel);
}

// Só conta o que hoje concede acesso de fato: mesmo critério do /v1/context
// (contrato ativo E organização ativa). Um contrato ativo de organização
// suspensa não libera nada e não pode inflar este painel.
const grantsAccess = org => org.contract_active && org.status === 'active';

function renderProductRights(organizations) {
 const rights = new Map();
 for (const org of organizations.filter(grantsAccess))
  for (const right of org.rights) rights.set(right, (rights.get(right) || 0) + 1);
 $('product-rights').replaceChildren(...[...rights.entries()]
  .sort((a, b) => b[1] - a[1] || a[0].localeCompare(b[0]))
  .map(([right, count]) => record(right, count + (count === 1 ? ' contrato ativo concede este direito' : ' contratos ativos concedem este direito'))));
 if (!rights.size) $('product-rights').append(node('p',
  'Nenhum direito granular em vigor neste produto.', 'empty-list'));
}

function renderProductOrganizations() {
 const context = state.product;
 const query = $('org-search').value.trim().toLocaleLowerCase('pt-BR');
 const rows = context.organizations.filter(org => (org.name + ' ' + org.slug).toLocaleLowerCase('pt-BR').includes(query));
 $('product-orgs').replaceChildren();
 $('product-orgs-empty').hidden = context.organizations.length > 0;
 $('product-orgs-empty-title').textContent = `Nenhuma organização contratou ${context.product.name}.`;
 $('product-orgs-search-empty').hidden = !context.organizations.length || rows.length > 0;
 for (const org of rows) {
  const row = node('tr');
  const title = node('td');
  title.append(node('div', org.name, 'client-name'), node('div', org.slug, 'client-slug'));
  const contract = node('td');
  contract.append(node('span', org.contract_active ? (org.status === 'active' ? 'Ativo' : 'Organização suspensa') : 'Revogado',
   'status' + (grantsAccess(org) ? ' active' : '')));
  if (org.rights.length) contract.append(node('div', org.rights.join(', '), 'client-slug'));
  const people = node('td');
  people.append(node('div', String(org.active_memberships), 'client-name'));
  if (org.total_memberships !== org.active_memberships) people.append(node('div', `${org.total_memberships} no total`, 'client-slug'));
  const action = node('td');
  const edit = botaoEditar({ texto: 'Editar contrato', aria: `Editar contrato de ${org.name}` });
  edit.onclick = () => openDialog('entitlement-dialog', {
   tenant_id: org.tenant_id, product_id: context.product.id, plan: org.plan,
   rights: org.rights, active: String(org.contract_active),
  });
  action.append(edit);
  row.append(title, contract, node('td', org.plan), people, action);
  $('product-orgs').append(row);
 }
}

function renderProductEngagements(engagements) {
 const root=$('product-engagements');if(!root||!state.product)return;
 if(!engagements.length){root.replaceChildren(node('p',`Nenhuma contratação ligada a ${state.product.product.name}.`,'empty-list'));return;}
 root.replaceChildren(...engagements.map(engagement=>{
  const card=node('article',undefined,'service-card'),head=node('header'),title=node('div');
  title.append(node('h3',engagement.label),node('p',`${engagement.tenant_name} · ${clientLabel(engagement.service_model)}`,'detail'));
  head.append(title,node('span',clientLabel(engagement.status),'status '+(['active','planned'].includes(engagement.status)?'active':'building')));
  // A contratação é de uma empresa: a ficha mostra o resto do que ela tem.
  const open=node('button','Abrir ficha da empresa →','secondary');open.type='button';open.onclick=()=>openClient(engagement.tenant_id);
  const actions=node('div',undefined,'service-card-actions');actions.append(open);
  card.append(head,actions);return card;
 }));
}

function renderProduct() {
 const context = state.product, product = context.product, engagements = context.engagements || [];
 const access = hasCapability(product, 'access');
 // Contrato de acesso só existe onde o tipo dá acesso; linha de serviço mede contratações.
 renderMetrics(access ? [
  ['Organizações', context.summary.organizations],
  ['Contratos de acesso', context.summary.active_contracts],
  ['Contratos revogados', context.summary.revoked_contracts],
  ['Pessoas alcançadas', context.summary.reachable_memberships, 'com vínculo neste produto'],
 ] : hasCapability(product, 'commercial') ? [
  ['Contratações', engagements.length],
  ['Em curso', engagements.filter(e => ['planned', 'active', 'paused'].includes(e.status)).length],
  ['Concluídas', engagements.filter(e => e.status === 'completed').length],
 ] : []);
 renderProductRecord({...product,deploy_url:publishedDeployUrl(product)});
 $('product-rights-title').hidden = $('product-rights').hidden = !access;
 renderProductRights(context.organizations);
 renderProductOrganizations();
 renderProductEngagements(engagements);
}

/* ---------- carregamento ---------- */

function fillDirectorySelects() {
 const overview = state.overview;
 if (!overview) return;
 for (const select of document.querySelectorAll('.tenant-select')) {
  const previous = select.value;
  select.replaceChildren(option('', 'Selecione o cliente'), ...overview.tenants.map(t => option(t.id, t.name)));
  if (overview.tenants.some(t => t.id === previous)) select.value = previous;
 }
 for (const select of document.querySelectorAll('.customer-select')) {
  const previous=select.value,customers=overview.tenants.filter(t=>t.relationship_kind==='customer');
  select.replaceChildren(option('', 'Selecione o cliente'),...customers.map(t=>option(t.id,t.name)));
  if(customers.some(t=>t.id===previous))select.value=previous;
 }
 // Os dois formulários com este seletor são de acesso (vínculo e contrato):
 // linha de serviço e item interno nem aparecem como opção.
 const accessProducts = overview.products.filter(p => hasCapability(p, 'access'));
 for (const select of document.querySelectorAll('.product-select')) {
  const previous = select.value;
  // Vínculo de pessoa exige item ativo; contrato de acesso pode ser preparado em rascunho.
  const opcoes = select.closest('#member-dialog') ? accessProducts.filter(p => p.lifecycle_status === 'active') : accessProducts;
  select.replaceChildren(option('', 'Selecione o produto'), ...opcoes.map(p => option(p.id, p.name)));
  if (opcoes.some(p => p.id === previous)) select.value = previous;
 }
}

function fillContextSelect(products) {
 const select = $('context-select');
 select.replaceChildren(option('', 'TZOLKIN · Gestão geral'));
 const group = document.createElement('optgroup');
 group.label = 'Portfólio';
 group.append(...products.map(p => option(p.id, p.name)));
 select.append(group);
 select.value = state.context;
 renderContextPicker(products);
}

function renderContextPicker(products) {
 const picker=$('context-picker'),currentIcon=$('context-current-icon'),currentCopy=$('context-current-copy'),options=$('context-options');
 if(!picker||!currentIcon||!currentCopy||!options)return;
 const current=products.find(product=>product.id===state.context)||null;
 currentIcon.replaceChildren(current?productFavicon(productFaviconUrl(current)):coreSpaceIcon());
 const detalhe=product=>kindLabel(product)+(product.lifecycle_status==='draft'?' · rascunho':'');
 currentCopy.replaceChildren(node('strong',current?.name||'TZOLKIN'));
 const choice=(id,label,detail,icon)=>{const button=node('button',undefined,'context-option'+(id===state.context?' active':''));button.type='button';button.setAttribute('aria-current',id===state.context?'true':'false');const mark=node('span',undefined,'context-option-icon');mark.append(icon);const copy=node('span',undefined,'context-option-copy');copy.append(node('strong',label),node('small',detail));button.append(mark,copy);button.onclick=()=>{picker.open=false;if(id!==state.context)switchContext(id).catch(reportError);};return button;};
 const general=choice('','TZOLKIN','Gestão geral',coreSpaceIcon());
 const productChoices=byKind(products).flatMap(({kind,items})=>[node('span',kindInfo(kind).plural,'context-group-label'),...items.map(product=>choice(product.id,product.name,productLifecycle(product).label,productFavicon(productFaviconUrl(product))))]);
 options.replaceChildren(general,...productChoices);
}

// O contexto geral é o único que carrega o cadastro completo.
// O contexto de produto pede apenas o recorte daquele produto ao servidor.
const loadIsCurrent = (ticket, context) => ticket === loadGeneration && context === state.context;

// Integrações remotas enriquecem o painel depois que o cadastro já está usável.
// Cada resposta confere a geração/contexto para nunca repintar uma tela posterior.
async function hydrateGeneral(ticket, context, entries) {
 let financeData=null,salesData=null,deployments=null,infrastructure=null;
 const current=()=>loadIsCurrent(ticket,context);
 const redraw=()=>{if(current())renderOverviewDashboard(entries,{finance:financeData,sales:salesData,deploys:deployments,infrastructure});};
 const month=currentMonth();
 const financial=Promise.all([
  api('/api/finance/board?month='+month).catch(()=>null),
  api('/api/finance/sales?month='+month).catch(()=>null),
 ]).then(([finance,sales])=>{if(!current())return;financeData=finance;salesData=sales;redraw();});
 const deployInventory=api('/api/deploys').then(data=>{
  if(!current())return;
  deployments=data;state.deploys=data.projects||[];renderDeploys(data);renderManagement();renderGeneral();redraw();
  // A ficha pinta antes do inventário chegar: sem repintar, deploy vinculado ficaria "sem deploy observado".
  if(state.view==='client'&&state.clientSummary?.tenant?.id===state.selectedTenant)paintClientDetail(state.clientSummary);
 }).catch(error=>{if(current())$('deploys-status').replaceChildren(node('p',error.message,'security-banner'));});
 $('easypanel-inventory').replaceChildren(node('p','Consultando EasyPanel…','empty-list'));
 const easyPanelInventory=api('/api/infrastructure/easypanel').then(data=>{
  if(!current())return;
  infrastructure=data;state.infrastructure=data;renderEasypanel(data);renderManagement();redraw();
 }).catch(()=>{if(current())$('easypanel-inventory').replaceChildren(node('p','Não foi possível consultar o EasyPanel.','empty-list'));});
 await Promise.allSettled([financial,deployInventory,easyPanelInventory]);
 redraw();
}

async function hydrateProduct(ticket, context) {
 const current=()=>loadIsCurrent(ticket,context);
 const tasks=[api('/api/products/topology').then(topology=>{if(!current())return;state.topology=topology;renderProduct();}).catch(()=>{})];
 if(!state.deploys.length)tasks.push(api('/api/deploys').then(data=>{if(!current())return;state.deploys=data.projects||[];renderProduct();}).catch(()=>{}));
 await Promise.allSettled(tasks);
}

async function load() {
 const ticket=++loadGeneration,context=state.context;
 if (contextKind() === 'general') {
  // Uma viagem ao Postgres traz o cadastro, catálogo e vínculos necessários para
  // o primeiro quadro. Topologia e provedores externos ficam fora do caminho crítico.
  const bootstrap=await api('/api/bootstrap');
  if(!loadIsCurrent(ticket,context))return;
  const {overview,catalog,resource_bindings:resourceBindings}=bootstrap;
  state.overview=overview;
  state.catalog=catalog.entries||[];
  state.resourceBindings=resourceBindings.bindings||[];
  state.security=overview.security||null;
  state.topology=null;
   $('login').hidden = true; $('workspace').hidden = false;
   fillContextSelect(overview.products);
   renderGeneral();
   renderPeople();
   if(state.view==='client')renderClientDetail();
   hydrateGeneral(ticket,context,state.catalog).catch(reportError);
  } else {
  const [productContext,resourceBindings]=await Promise.all([api(`/api/products/${encodeURIComponent(state.context)}/console`),api(`/api/product-resource-bindings?product_id=${encodeURIComponent(state.context)}`).catch(()=>({bindings:[]}))]);
  if(!loadIsCurrent(ticket,context))return;
  state.product=productContext;state.topology=null;state.resourceBindings=resourceBindings.bindings||[];
   $('login').hidden = true; $('workspace').hidden = false;
  renderProduct();
  hydrateProduct(ticket,context).catch(reportError);
  // As capacidades do item acabaram de chegar: a navegação passa a ser a do tipo,
  // e uma tela que o tipo não tem volta para a visão geral.
  renderNav();
  if(!viewAllowed(state.view))switchView(Object.keys(views())[0]);
  if(state.view==='product-payments')await productPayments.load(state.product.product);
  if(state.view==='product-receivables')await serviceReceivables.load(state.product.product);
  if(state.view==='product-emails')await productEmails.load({...state.product.product,deploy_url:publishedDeployUrl(state.product.product),favicon_url:productFaviconUrl(state.product.product)});
 }
 renderContextChrome();
 renderSecurityBanner();
 if(contextKind()==='general') await resource.resume();
 if(state.view==='tracking') await tracking.load();
 if(state.view==='finance') await finance.load();
 if(state.view==='emails') await emails.load();
 // Entrar, Atualizar e salvar um projeto passam por aqui: sem isto Deploys ficaria com os painéis do GitHub vazios.
 // As DUAS telas leem o mesmo cadastro desde que Projetos técnicos ganhou entrada
 // própria. Listar só 'deploys' aqui fazia o salvar não repintar a lista de quem
 // estava justamente na tela de projetos: o projeto nascia e a tela continuava
 // dizendo "seu primeiro projeto começa acima".
 if(contextKind()==='general'&&['connections','github','vercel','easypanel'].includes(state.view)) await delivery.load();
}

// A lista de organizações só é buscada quando o operador abre um formulário que precisa dela.
async function ensureDirectory() {
 if (!state.overview) state.overview = await api('/api/overview');
 fillDirectorySelects();
}

/* ---------- formulários ---------- */

// Abre o cadastro de um espaço do portfólio: novo (sem item) ou edição (com o item).
// Os tipos e o texto de cada um vêm do registro da API.
function abrirEspaco(item, tipoInicial) {
 const form = $('space-form'), nome = form.elements.namedItem('name'), id = form.elements.namedItem('id');
 const tipo = () => form.elements.namedItem('portfolio_kind');
 const sincronizar = () => { $('space-tags-field').hidden = !kindInfo(tipo().value)?.tags; };
 // Um cartão selecionável por tipo, do registro da API: ícone, nome e o que o tipo é.
 $('space-kind-grid').replaceChildren(...kindRegistry().map(info => {
  const cartao = document.createElement('label'), radio = document.createElement('input'), texto = node('span', undefined, 'kind-card-text');
  cartao.className = 'kind-card';
  radio.type = 'radio'; radio.name = 'portfolio_kind'; radio.value = info.kind; radio.required = true; radio.onchange = sincronizar;
  texto.append(node('strong', info.label), node('small', info.what.split('. ')[0] + '.'));
  cartao.append(radio, createIcon(info.icon), texto);
  return cartao;
 }));
 const tags = mountTagInput({ box: $('space-tag-box'), input: $('space-tag-input'), hidden: form.elements.namedItem('tags') });
 // O identificador nasce do nome enquanto ninguém o digitar; ao editar, é o que já existe.
 let idManual = Boolean(item);
 id.oninput = () => { idManual = true; };
 nome.oninput = () => { if (!idManual) id.value = slugDoNome(nome.value); };
 $('space-title').textContent = item ? 'Editar espaço' : 'Novo espaço';
 $('space-subtitle').textContent = item ? `${item.name} · ${item.id}` : 'Um espaço é onde a TZOLKIN organiza o que vende ou opera.';
 $('space-submit').textContent = item ? 'Salvar alterações' : 'Criar espaço';
 $('space-id-help').textContent = item ? 'O identificador aparece nos endereços e nas chaves e não muda.' : 'Sugerido a partir do nome. Aparece nos endereços e nas chaves e não muda depois.';
 openDialog('space-dialog', item ? { id: item.id, name: item.name, portfolio_kind: canonKind(item.portfolio_kind), tags: item.tags || [], revision: item.revision } : undefined);
 id.readOnly = Boolean(item);
 // Depois que o diálogo aplicou os valores: o tipo (o da aba, se veio de uma), as tags em chips.
 const preencher = () => {
  if (!item) tipo().value = kindInfo(tipoInicial) ? canonKind(tipoInicial) : (kindRegistry()[0]?.kind || '');
  tags.set((form.elements.namedItem('tags').value || '').split(',').map(t => t.trim()).filter(Boolean));
  sincronizar();
 };
 ensureDirectory().then(preencher).catch(() => {});
 preencher();
}

function openDialog(id, values) {
 const dialog = $(id);
 const form = dialog.querySelector('form');
 form.reset();
 dialog.querySelector('.dialog-error').textContent = '';
 const apply = () => {
  if (!values) return;
  for (const [key, value] of Object.entries(values)) {
   const field = form.elements.namedItem(key);
   if (field) field.value = Array.isArray(value) ? value.join(', ') : String(value);
  }
 };
 ensureDirectory().then(() => {
  apply();
  if (!values && contextKind() === 'product' && form.elements.namedItem('product_id'))
   form.elements.namedItem('product_id').value = state.context;
 }).catch(error => { dialog.querySelector('.dialog-error').textContent = error.message; });
 apply();
 dialog.showModal();
}

function reportError(error) {
 ($('login').hidden ? $('notice') : $('login-notice')).textContent = error.message;
}

function bindForm(id, handler) {
 $(id).addEventListener('submit', async event => {
  event.preventDefault();
  const form = event.currentTarget;
  const button = form.querySelector('button.primary');
  const errorBox = id === 'login-form' ? $('login-notice') : form.querySelector('.dialog-error');
  errorBox.textContent = ''; button.disabled = true;
  try {
   await handler(Object.fromEntries(new FormData(form)));
   const dialog = form.closest('dialog');
   if (dialog) dialog.close();
   form.reset();
   await load();
   if (id === 'login-form') {
    $('password').type = 'password';
    $('show-password').textContent = 'Mostrar';
    $('show-password').setAttribute('aria-pressed', 'false');
    $('notice').textContent = '';
   } else $('notice').textContent = 'Alteração salva.';
  } catch (error) { ($('login').hidden ? errorBox : $('login-notice')).textContent = error.message; }
  finally { button.disabled = false; }
 });
}

bindForm('login-form', body => api('/api/login', 'POST', { password: body.password }));
// Espaço do portfólio: criar (POST) ou editar (PUT, com a revisão que a tela leu). O
// identificador não muda depois de criado; o servidor confere tipo, tags e revisão.
bindForm('space-form', body => {
 const campos = { name: body.name, portfolio_kind: body.portfolio_kind, tags: body.tags || '' };
 if (body.revision) return api('/api/portfolio/' + encodeURIComponent(body.id), 'PUT', { ...campos, revision: Number(body.revision) });
 return api('/api/portfolio', 'POST', { id: body.id, ...campos });
});
bindForm('tenant-form', body => api('/api/tenants', 'POST', body));
bindForm('stakeholder-form', body => api('/api/stakeholders', 'POST', {...body,is_primary:body.is_primary==='on',contact_allowed:body.contact_allowed==='on'}));
bindForm('member-form', body => api('/api/memberships', 'PUT', { ...body, active: body.active === 'true' }));
bindForm('entitlement-form', body => api('/api/entitlements', 'PUT', {
 ...body, active: body.active === 'true',
 rights: body.rights.split(',').map(right => right.trim()).filter(Boolean),
}));

document.querySelectorAll('[data-open]').forEach(button => { button.onclick = () => openDialog(button.dataset.open); });
document.querySelectorAll('[data-close]').forEach(button => { button.onclick = () => button.closest('dialog').close(); });
$('new-record').onclick = () => {
 const dialog=views()[state.view].action[1];
 // Deploys não usa <dialog> simples: o assistente do cadastro técnico tem fluxo próprio.
 if(dialog==='delivery-new'){delivery.open(null);return;}
 if(dialog==='space-dialog'){abrirEspaco(null,state.portfolioTab==='all'?undefined:state.portfolioTab);return;}
 if(dialog==='tenant-dialog'){
  const relationship=$('tenant-form').elements.relationship_kind;
  if(state.view==='leads') relationship.value='prospect';
  else if(state.view==='clients') relationship.value='customer';
 }
 openDialog(dialog);
};
$('context-select').addEventListener('change', event => switchContext(event.target.value).catch(reportError));
$('client-search').addEventListener('input', () => { state.clientPage = 0; renderTenants(); });
$('client-pagesize').addEventListener('change', () => { state.clientPage = 0; renderTenants(); });
$('client-prev').addEventListener('click', () => { state.clientPage -= 1; renderTenants(); });
$('client-next').addEventListener('click', () => { state.clientPage += 1; renderTenants(); });
$('lead-search').addEventListener('input', renderLeads);
$('company-search').addEventListener('input', renderCompanies);
$('people-search').addEventListener('input', renderPeople);
$('engagement-form').elements.service_model.addEventListener('change',fillEngagementProducts);
// Criar contratação pela ficha: grava, fecha e busca de novo só o resumo da empresa.
// Erro de validação, permissão ou nome repetido (400/403/409) fica no próprio diálogo.
$('engagement-form').addEventListener('submit',async event=>{
 event.preventDefault();
 const form=event.currentTarget,dialog=form.closest('dialog'),button=form.querySelector('button.primary'),error=dialog.querySelector('.dialog-error'),tenant=engagementTenant;
 if(!tenant)return;
 error.textContent='';button.disabled=true;
 try{
  const created=await api('/api/engagements','POST',{tenant_id:tenant.id,product_id:form.elements.product_id.value||null,service_model:form.elements.service_model.value,status:form.elements.status.value,label:form.elements.label.value});
  // Clientes e Serviços leem state.overview: a nova contratação entra lá sem recarregar o painel.
  if(state.overview&&created?.id&&!state.overview.engagements.some(e=>e.id===created.id))state.overview.engagements.push(created);
  dialog.close();form.reset();
  if(state.selectedTenant===tenant.id){clientPending=null;await loadClientSummary(tenant.id);}
  $('notice').textContent='Contratação criada.';
 }catch(reason){error.textContent=reason.message;}
 finally{button.disabled=false;}
});
$('deploy-search').addEventListener('input',()=>{if(deployData)renderDeploys(deployData);});
$('deploy-filter').addEventListener('change',()=>{if(deployData)renderDeploys(deployData);});
$('org-search').addEventListener('input', () => { if (state.product) renderProductOrganizations(); });
$('show-password').onclick = () => {
 const show = $('password').type === 'password';
 $('password').type = show ? 'text' : 'password';
 $('show-password').textContent = show ? 'Ocultar' : 'Mostrar';
 $('show-password').setAttribute('aria-pressed', String(show));
};
$('refresh').onclick = async () => {
 $('refresh').disabled = true;
 try { await load(); if(state.view==='resource') await resource.refresh(); $('notice').textContent = 'Atualizado.'; }
 catch (error) { reportError(error); } finally { $('refresh').disabled = false; }
};
vigiarLogos();
$('open-settings').onclick = () => {switchView('settings');closeNavigation();};
$('logout').onclick = async () => {
 try { const result=await api('/api/logout', 'POST', {});if(result.logout_url){location.assign(result.logout_url);return;}signedOut(); $('login-notice').textContent = ''; }
 catch (error) { $('notice').textContent = error.message; }
};

const resource = setupResource({api,activate:()=>switchView('resource'),canOpen:()=>!$('workspace').hidden && contextKind()==='general',back:provider=>switchView(provider==='easypanel'?'easypanel':provider==='vercel'?'vercel':'connections')});
// Ativar um projeto muda o ciclo de vida do item do portfólio: recarrega o painel
// inteiro (deploys, catálogo e, em Deploys, o cadastro técnico), como os demais
// formulários. Criar um projeto já NÃO cria item nenhum — item nasce no Portfólio.
//
// owners() é o mesmo cadastro que a tela de Conexões usa para perguntar o dono, e
// vem do mesmo /api/overview: duas telas perguntando "de quem é isto?" têm de
// oferecer a mesma lista, senão o nome de um item muda conforme a porta de entrada.
const delivery = setupDelivery({ api,openResource:resource.open,onSaved:()=>load().catch(reportError),
 // Cada repositório da aba GitHub mostra o dono, ou o controle para dar um: as mesmas
 // conexões e a mesma regra de sugestão das outras telas (owner-link.js).
 repoLink:(repo,inventario)=>vinculoNoProvedor({provider:'github',id:repo.id,name:repo.name},inventario),
 // O cadastro técnico e o inventário chegaram: as telas que dependem deles se redesenham.
 onLoaded:()=>{connections.redraw();if(deployData)renderDeploys(deployData);if(state.infrastructure)renderEasypanel(state.infrastructure);},
 owners:()=>({
  // O tipo do item vai junto, já traduzido: o dicionário de tipos é daqui, e
  // delivery.js copiá-lo seria a segunda verdade sobre como se chama cada tipo.
  products:(state.overview?.products||[]).map(item=>({...item,kind_label:kindInfo(item.portfolio_kind)?.label||null})),
  engagements:serviceEngagements(),tenants:state.overview?.tenants||[]}) });
// Volta de fluxo externo — OAuth da Meta, clique em notificação: `?view=`
// escolhe a tela inicial e `?meta=` traz o resultado da conexão. Os dois saem
// da barra de endereço em seguida, para um recarregar não repetir o aviso.
{
 const params = new URLSearchParams(location.search);
 const pedida = params.get('view');
 if (pedida && Object.hasOwn(CONTEXTS.general.views, pedida) && !CONTEXTS.general.views[pedida].hidden) state.view = pedida;
 // Campanhas deixou de ser tela: o endereço antigo abre a aba dentro de Inbound.
 if (pedida === 'campaigns') { state.view = 'leads'; state.inboundTab = 'campaigns'; }
 const secao = params.get('secao');
 if (secao && /^[a-z]{2,20}$/.test(secao)) { state.configSecao = secao; if (!pedida) state.view = 'settings'; }
 const google = params.get('google');   // volta do OAuth do Google: código curto, mostrado em Configurações → Integrações
 if (google && /^[a-z]{2,12}$/.test(google)) { state.configRetorno = google; if (!pedida) state.view = 'settings'; }
 const meta = params.get('meta');
 if (meta && /^[a-z]{2,12}$/.test(meta)) { campaigns.flash(meta); state.view = 'leads'; state.inboundTab = 'campaigns'; }
 if (params.has('view') || params.has('meta') || params.has('secao') || params.has('google')) {
  params.delete('view'); params.delete('meta'); params.delete('secao'); params.delete('google');
  const resto = params.toString();
  history.replaceState(null, '', location.pathname + (resto ? '?' + resto : '') + location.hash);
 }
}
renderNav();
switchView(state.view);
renderContextChrome();
load().catch(error => { if (error.message !== 'Entre para continuar.') $('login-notice').textContent = error.message; });

// Instalar como aplicativo: o Chrome dispara `beforeinstallprompt` logo ao carregar, bem antes de alguém abrir Configurações → Aplicativo.
// Guarda o evento aqui para a seção poder oferecer o botão. Sem o evento (já instalado, ou navegador sem suporte) a seção só explica.
{
 let adiado = null;
 addEventListener('beforeinstallprompt', evento => { evento.preventDefault(); adiado = evento; });
 addEventListener('appinstalled', () => { adiado = null; });
 window.TzolkinInstalar = { pronto: () => adiado !== null, pedir: async () => { const e = adiado; adiado = null; if (!e) return null; await e.prompt(); return (await e.userChoice).outcome; } };
}

// Registro do service worker. Só existe para notificação: o worker não faz
// cache, então não há risco de servir código velho depois de um deploy.
// Falha em silêncio de propósito — sem push o painel funciona igual.
if ('serviceWorker' in navigator && (location.protocol === 'https:' || location.hostname === '127.0.0.1')) {
 navigator.serviceWorker.register('/sw.js', { scope: '/' }).catch(() => {});
}
