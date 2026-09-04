// Apresentação e serialização de formulários. Autorização, recorte por produto
// e regras de negócio ficam no servidor: nada aqui decide o que o operador pode ver.
import { setupDelivery, deliveryIcon } from './delivery.js';
import { setupResource } from './resource.js';
import {providerLogo,createIcon,productFavicon} from './icons.js';
import {paymentInstitution} from './finance-model.js';
import {setupEmails} from './emails.js';
import {setupTracking} from './tracking.js';
import {setupFinance} from './finance.js';
import {setupBilling} from './billing.js';
import {setupProductPayments} from './product-payments.js';
import {setupProjects} from './projects.js';
import {setupProductEmails} from './product-emails.js';
import {renderDatabaseWorkspace} from './management-workspace.js';
const billing=setupBilling({api});
const productPayments=setupProductPayments({api,billing});
const emails=setupEmails({api,configure:product=>openProductModule(product,'product-emails')});
const productEmails=setupProductEmails({api});
const finance=setupFinance({api});
const tracking=setupTracking({api});
const $ = id => document.getElementById(id);
fetch('/api/auth/mode').then(r=>r.ok?r.json():null).then(auth=>{const oidc=auth?.mode==='google-oidc';$('login-form').hidden=oidc;$('google-login').hidden=!oidc;if(oidc&&new URLSearchParams(location.search).has('auth_error'))$('login-notice').textContent='Conta Google não autorizada ou login expirado.';}).catch(()=>{$('login-notice').textContent='Não foi possível verificar o modo de acesso. Atualize a página.';});
$('plan-help').textContent='Use o slug de uma oferta deste produto. Ele identifica as condições comerciais copiadas para o contrato.';

const state = { context: '', view: 'overview', overview: null, product: null, catalog: [], deploys: [], bindings: [], resourceBindings: [], serviceBindings: [], infrastructure: null, management: null, dns: null, topology: null, selectedTenant: null };

// Cada contexto declara a própria navegação. Menu só existe quando há dado real por trás.
const CONTEXTS = {
 general: {
  label: 'ESPAÇO DE TRABALHO',
  views: {
   overview: { title: 'Visão geral', section: 'view-overview', metrics: false },
   tracking: { title: 'Acompanhamento', section: 'view-tracking', metrics:false },
   finance: { title: 'Financeiro', section: 'view-finance', metrics:false },
   companies: { title: 'Empresas', section: 'view-companies', action: ['Nova empresa', 'tenant-dialog'], metrics:false },
   people: { title: 'Pessoas', section: 'view-people', action: ['Nova pessoa', 'stakeholder-dialog'], metrics:false },
   leads: { title: 'Leads', section: 'view-leads', action: ['Novo lead', 'tenant-dialog'], metrics:false },
   clients: { title: 'Clientes', section: 'view-clients', action: ['Novo cliente', 'tenant-dialog'], metrics:false },
   projects: { title: 'Projetos', section: 'view-projects', action: ['Novo projeto', 'project-new'], metrics:false },
   products: { title: 'Produtos', section: 'view-products', action: ['Vincular cliente', 'entitlement-dialog'] },
   services: { title: 'Serviços', section: 'view-services', metrics:false },
   client: { title: 'Cliente', section: 'view-client', hidden:true, metrics:false },
   emails: { title: 'E-mails', section: 'view-emails', metrics:false },
   education: { title: 'Mentorias', section: 'view-mentorias', metrics:false },
   access: { title: 'Acessos', section: 'view-access', action: ['Vincular acesso', 'member-dialog'] },
   management: { title: 'Gestão técnica', section: 'view-management', metrics:false },
   settings: { title: 'Configurações', section: 'view-settings', metrics:false, hidden:true },
   security: { title: 'Segurança', section: 'view-security', metrics:false, hidden:true },
   deploys: { title: 'Deploys', section: 'view-deploys', metrics: false },
   serverMetrics: { title: 'Métricas de servidor', section: 'view-server-metrics', metrics:false, hidden:true },
   resource: { title: 'Projeto e serviço', section: 'view-resource', metrics: false, hidden:true },
  },
 },
 product: {
  label: 'GESTÃO DO PRODUTO',
  views: {
   product: { title: 'Visão geral', section: 'view-product' },
   'product-orgs': { title: 'Clientes', section: 'view-product-orgs', action: ['Vincular cliente', 'entitlement-dialog'] },
   'product-payments': { title: 'Cobrança', section: 'view-product-payments', metrics:false },
   'product-emails': { title: 'E-mails', section: 'view-product-emails', metrics:false },
  },
 },
};

const SECTIONS = ['view-tracking', 'view-resource', 'view-overview', 'view-clients', 'view-leads', 'view-companies', 'view-client', 'view-people', 'view-products', 'view-services', 'view-mentorias', 'view-access', 'view-management', 'view-settings', 'view-security', 'view-deploys', 'view-server-metrics', 'view-delivery', 'view-projects', 'view-product', 'view-product-orgs', 'view-product-payments', 'view-product-emails'];
const DATA_NODES = ['tenants', 'leads', 'companies', 'client-summary', 'client-detail', 'stakeholder-directory', 'members', 'contracts', 'product-catalog', 'product-deployment-list', 'services-list', 'services-summary', 'management-schema', 'management-dns', 'management-redis', 'management-apis', 'overview-kpis', 'overview-alerts', 'overview-integrations', 'overview-product-list', 'overview-actions', 'product-orgs', 'product-record', 'product-rights', 'metrics', 'deploys-list', 'deploys-status'];
SECTIONS.push('view-finance','view-emails');

const contextKind = () => (state.context ? 'product' : 'general');
const views = () => CONTEXTS[contextKind()].views;
const productName = () => state.product?.product?.name || state.context;
const DEPLOY_ALIASES={educare:['tzolkin-educare'],sites:['tzolkin-sites'],barber:['barber','tzolkin-barber'],commerce:['commerce','tzolkin-commerce'],core:['core','tzolkin-core'],data:['data','tzolkin-data'],skiller:['skiller','tzolkin-skiller']};
const productKey=product=>String(product?.id||product?.name||'').toLowerCase().replace(/^tzolkin[ -]/,'').replace(/\s+/g,'-');
const bindingForDeployment=project=>state.bindings.find(binding=>binding.provider===project?.provider&&(String(binding.external_project_id)===String(project?.project_id)||binding.external_project_name===project?.project));
const deploymentBelongsToProduct=(project,product)=>{const binding=bindingForDeployment(project);return binding?binding.product_id===product?.id:DEPLOY_ALIASES[productKey(product)]?.includes(String(project.project).toLowerCase());};
const readyDeployment=product=>state.deploys.find(item=>deploymentBelongsToProduct(item,product))?.deployments?.find(deployment=>deployment.state==='READY')||null;
const publishedDeployUrl=product=>readyDeployment(product)?.url||null;
// O endereço de catálogo pode ser um alias ainda sem DNS (Educare). Quando
// existe um domínio canônico conhecido, ele é a fonte da identidade visual;
// não usamos o domínio efêmero do deploy para buscar o favicon.
const CANONICAL_PRODUCT_URLS={educare:'https://tzolkin-educare.vercel.app/'};
const CANONICAL_FAVICON_SOURCES={educare:'/product-favicons/educare.svg',sites:'/product-favicons/sites.svg'};
const catalogForProduct=product=>state.catalog.find(entry=>entry.kind==='product'&&(entry.payload?.id===product?.id||entry.payload?.name===product?.name))?.payload||null;
const productFaviconUrl=product=>CANONICAL_FAVICON_SOURCES[productKey(product)]||product?.favicon_url||product?.catalog?.url||catalogForProduct(product)?.url||publishedDeployUrl(product)||null;
const productLiveUrl=product=>product?.lifecycle_status==='draft'?(publishedDeployUrl(product)||null):(CANONICAL_PRODUCT_URLS[productKey(product)]||product?.deploy_url||publishedDeployUrl(product)||product?.catalog?.url||catalogForProduct(product)?.url||null);

function node(tag, text, className) {
 const el = document.createElement(tag);
 if (text !== undefined) el.textContent = text;
 if (className) el.className = className;
 return el;
}
function option(value, label) { const el = node('option', label); el.value = value; return el; }

// O transporte do banco é medido no servidor; aqui só se exibe o veredito.
// Sem hostname, sem credencial — só o estado.
async function renderSecurityBanner() {
 const banner = $('security-banner');
 try {
  const health = await (await fetch('/health')).json();
  const claro = health.database_transport === 'plaintext';
  banner.hidden = !claro;
  if (claro) banner.textContent =
   'O banco está em host remoto e a conexão não é criptografada: senha e dados trafegam em texto claro. '
   + 'Não cadastre cliente real até isto ser corrigido.';
 } catch { banner.hidden = true; }
}

// Limpa tudo que veio do servidor. Chamado ao trocar de contexto e ao sair:
// nenhum número ou linha de um contexto pode sobreviver na tela do seguinte.
function clearRenderedData() {
 deployData=null; $('deploys-summary').replaceChildren(); $('deploy-results').textContent=''; $('deploy-search').value=''; $('deploy-filter').value='all';
 delivery.clear();
 projects.clear();
 tracking.clear();
 finance.clear();
 emails.clear();
 billing.clear();
 productPayments.clear();
 resource.clear();
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
 state.overview = null; state.catalog = []; state.deploys = []; state.bindings = []; state.resourceBindings = []; state.serviceBindings = []; state.infrastructure = null; state.management = null; state.dns = null; state.topology = null; state.product = null; state.context = '';
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
 const data = await response.json();
 if (!response.ok) {
  if (response.status === 401) signedOut();
  throw new Error(data.message || 'Não foi possível concluir. Tente novamente.');
 }
 return data;
}

/* ---------- navegação e contexto ---------- */

function renderNav() {
 const context = CONTEXTS[contextKind()];
 $('nav-label').textContent = context.label;
 const groups=contextKind()==='general'?{overview:'Visualização',tracking:'Visualização',finance:'Visualização',companies:'Relacionamentos',people:'Relacionamentos',leads:'Operação',clients:'Operação',projects:'Operação',products:'Operação',services:'Operação',emails:'Operação',education:'Educacional',settings:'Gestão',access:'Gestão',management:'Gestão',security:'Gestão',deploys:'Tecnologia',serverMetrics:'Tecnologia'}:{product:'Produto','product-orgs':'Produto','product-payments':'Produto','product-emails':'Produto'};
 const items=[];let previous;
 for(const [key,view]of Object.entries(context.views).filter(([,view])=>!view.hidden)){
  if(groups[key]!==previous){const label=node('span',groups[key],'nav-group');label.setAttribute('aria-hidden','true');items.push(label);previous=groups[key];}
  const button = node('button', undefined, 'nav-item' + (key === state.view ? ' active' : ''));
  button.type = 'button'; button.dataset.view = key;
  const icon = createIcon(({overview:'layers',clients:'building',companies:'building',people:'people',tracking:'calendar',finance:'wallet',metrics:'chart',leads:'user-plus',products:'package',services:'briefcase',education:'graduation-cap',projects:'repo',access:'shield',management:'settings',settings:'sliders',security:'lock',deploys:'cloud',serverMetrics:'activity',product:'package','product-orgs':'people','product-payments':'wallet','product-emails':'mail'})[key]);
  icon.classList.add('nav-icon'); button.append(icon, document.createTextNode(view.title));
  if (key === state.view) button.setAttribute('aria-current', 'page');
  button.onclick = () => {switchView(key);closeNavigation();};
  items.push(button);
 }
 $('nav').replaceChildren(...items);
}

function switchView(view) {
 if(view !== 'resource' && state.view === 'resource') { resource.clear(); history.replaceState(null,'',location.pathname+location.search); }
 state.view = view;
 const active = views()[view];
 SECTIONS.forEach(id => { $(id).hidden = $(id).id !== active.section; });
 $('breadcrumb').textContent = $('page-title').textContent = active.title;
 $('mobile-page-title').textContent=active.title;
 $('new-record').hidden = !active.action;
 // Métrica de carteira não diz nada numa tela de ecossistema ou de deploy.
 $('metrics').hidden = active.metrics === false || !$('metrics').children.length;
 if (active.action) $('new-record-label').textContent = active.action[0];
 $('notice').textContent = '';
 renderNav();
 if (view === 'tracking') tracking.load().catch(reportError);
 if (view === 'finance') finance.load().catch(reportError);
 if (view === 'emails') emails.load().catch(reportError);
 if (view === 'people') renderPeople();
 if (view === 'clients') renderTenants();
 if (view === 'leads') renderLeads();
 if (view === 'companies') renderCompanies();
 if (view === 'products') renderGeneral();
 if (view === 'services') renderServices();
 if (view === 'management') renderManagement();
 if (view === 'management' && !state.management) api('/api/management/schema').then(data=>{state.management=data;renderManagement();}).catch(error=>{$('management-schema').replaceChildren(node('p',error.message,'notice-inline'));});
 if (view === 'management' && !state.dns) api('/api/dns/hostinger').then(data=>{state.dns=data;renderManagement();}).catch(error=>{$('management-dns').replaceChildren(node('p',error.message,'notice-inline'));});
 if (view === 'client') renderClientDetail();
 if (view === 'product-payments'&&state.product) productPayments.load(state.product.product).catch(reportError);
 if (view === 'product-emails'&&state.product) productEmails.load({...state.product.product,deploy_url:publishedDeployUrl(state.product.product),favicon_url:productFaviconUrl(state.product.product)}).catch(reportError);
 if (view === 'projects') projects.load().catch(reportError);
}

function renderContextChrome() {
 const product = contextKind() === 'product';
 $('crumb-context').textContent = product ? `TZOLKIN · ${productName()}` : 'TZOLKIN';
 $('eyebrow').textContent = product ? `PRODUTO · ${String(productName()).toUpperCase()}` : 'TZOLKIN CORE';
 document.body.dataset.context = product ? 'product' : 'general';
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
 $('overview-summary').textContent=`${activeClients} ${activeClients===1?'cliente ativo':'clientes ativos'}, ${activeContracts.length} ${activeContracts.length===1?'contrato':'contratos'} e ${saleRows.length} ${saleRows.length===1?'venda importada':'vendas importadas'} neste mês.`;
 const kpis=[['Clientes ativos',activeClients,overview.tenants.filter(t=>t.relationship_kind==='customer').length+' cadastrados','clients'],['Receita recebida',brl(gross),'Vendas confirmadas em BRL','finance'],['Produtos',overview.products.length,activeContracts.length+' contratos ativos','products'],['Projetos prontos',deploys?ready:'—',deploys?projects.length+' consultados':'Consultando provedores','deploys']];
 $('overview-kpis').replaceChildren(...kpis.map(([label,value,detail,view])=>{const card=node('button',undefined,'overview-kpi');card.type='button';card.onclick=()=>switchView(view);card.append(node('span',label),node('strong',String(value)),node('small',detail));return card;}));
 const alerts=[];
 if(!sales?.configured?.asaas)alerts.push(['Asaas não configurado','Adicione a chave de produção para importar as vendas.','finance','alert']);
 if(sales?.configured?.stripe&&!sales?.providers?.stripe?.snapshot)alerts.push(['Stripe sem sincronização','Abra o Financeiro para importar o mês atual.','finance','clock']);
 const failed=projects.filter(p=>deployGroup(p)==='failed').length;if(failed)alerts.push([`${failed} ${failed===1?'projeto com falha':'projetos com falha'}`,'Revise o último deploy antes da próxima publicação.','deploys','alert']);
 const bankErrors=(finance?.connections||[]).filter(c=>c.attempt?.payload?.state==='error').length;if(bankErrors)alerts.push(['Conexão bancária pendente',`${bankErrors} ${bankErrors===1?'conexão precisa':'conexões precisam'} de nova consulta.`,'finance','clock']);
 if(!alerts.length)alerts.push(['Operação sem alerta crítico','Integrações consultadas e nenhum bloqueio encontrado.','overview','check']);
 $('overview-alerts').replaceChildren(...alerts.map(([title,detail,view,icon])=>overviewButton(title,detail,view,icon)));
 const integration=(name,configured,detail,logo)=>{const row=node('div',undefined,'overview-integration'),identity=node('div',undefined,'card-identity'),mark=node('span',undefined,'overview-integration-mark');mark.append(logo||createIcon('database'));identity.append(mark,node('div'));identity.lastChild.append(node('strong',name),node('small',detail));row.append(identity,node('span',configured===null?'Consultando':configured?'Conectado':'Pendente','status '+(configured===null?'building':configured?'active':'failed')));return row;};
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
 const productEntries=new Map(entries.filter(e=>e.kind==='product').map(e=>[e.payload.name,e.payload]));
 $('overview-product-list').replaceChildren(...overview.products.map(product=>{const contracts=activeContracts.filter(e=>e.product_id===product.id).length,item=productEntries.get(product.name),row=node('button',undefined,'overview-product');row.type='button';row.onclick=()=>openProductModule(product,'product').catch(reportError);row.append(productFavicon(productFaviconUrl(product)));const text=node('span');text.append(node('strong',product.name),node('small',(productAppearsDraft(product,item)?'Draft · ':'')+(item?.description||`${contracts} ${contracts===1?'contrato ativo':'contratos ativos'}`)));row.append(text,node('span',String(contracts),'overview-product-count'),createIcon('arrow'));return row;}));
 $('overview-actions').replaceChildren(overviewButton('Clientes','Carteira e visão individual','clients','people'),overviewButton('Pessoas','Stakeholders e empresas','people','people'),overviewButton('Financeiro','Bancos, Stripe e Asaas','finance','wallet'),overviewButton('Acompanhamento','Agenda e apontamentos','tracking','calendar'),overviewButton('Projetos','Código, ambientes e ativação','projects','repo'),overviewButton('Acessos','Identidades e permissões','access','shield'));
 document.querySelectorAll('[data-overview-view]').forEach(button=>button.onclick=()=>switchView(button.dataset.overviewView));
}

const CLIENT_LABELS={
 customer:'Cliente',prospect:'Prospect',partner:'Parceiro',internal:'Interna',company:'Empresa',person:'Pessoa física',nonprofit:'Sem fins lucrativos',
 lead:'Lead',onboarding:'Em implantação',active:'Ativo',planned:'Planejado',paused:'Pausado',completed:'Concluído',discontinued:'Descontinuado',unclassified:'A classificar',
 on_demand:'Sob demanda',education:'Educacional',consulting:'Consultoria',advisory:'Assessoria',product:'Produto TZOLKIN',
 owner:'Proprietário',decision_maker:'Decisor',champion:'Champion',finance:'Financeiro',technical:'Técnico',operational:'Operacional',student:'Aluno',contact:'Contato'
};
const clientLabel=value=>CLIENT_LABELS[value]||value||'A classificar';

function renderTenants() {
 const overview = state.overview;
 if (!overview) return;
 const query = $('client-search').value.trim().toLocaleLowerCase('pt-BR');
 const customers=overview.tenants.filter(t=>t.relationship_kind==='customer');
 const tenants = customers.filter(t => (t.name + ' ' + t.slug).toLocaleLowerCase('pt-BR').includes(query));
 const active=customers.filter(t=>['active','onboarding'].includes(t.lifecycle_status)).length;
 const unclassified=customers.filter(t=>t.lifecycle_status==='unclassified'||!overview.engagements.some(e=>e.tenant_id===t.id)).length;
 const stakeholderOrgs=new Set(overview.stakeholders.map(s=>s.tenant_id)).size;
 $('client-summary').replaceChildren(...[['Clientes',customers.length],['Ativos / implantação',active],['A classificar',unclassified],['Com stakeholders',stakeholderOrgs]].map(([label,value])=>{const card=node('article');card.append(node('span',label),node('strong',String(value)));return card;}));
 $('tenants').replaceChildren();
 $('clients-empty').hidden = customers.length > 0;
 $('search-empty').hidden = !customers.length || tenants.length > 0;
 for (const tenant of tenants) {
  const engagements=overview.engagements.filter(e=>e.tenant_id===tenant.id);
  const stakeholders=overview.stakeholders.filter(s=>s.tenant_id===tenant.id);
  const card=node('article',undefined,'client-card'),head=node('header'),identity=node('div');
  identity.append(node('span',tenant.name.slice(0,1),'client-avatar'),node('span'));
  identity.lastChild.append(node('h3',tenant.name),node('small',clientLabel(tenant.organization_type)));
  head.append(identity,node('span',clientLabel(tenant.lifecycle_status),'status '+(['active','onboarding'].includes(tenant.lifecycle_status)?'active':tenant.lifecycle_status==='unclassified'?'building':'')));
  const facts=node('div',undefined,'client-card-facts');
  const fact=(label,value)=>{const item=node('div');item.append(node('span',label),node('strong',value));return item;};
  facts.append(fact('Contratação',engagements.length?engagements.map(e=>clientLabel(e.service_model)).join(', '):'A classificar'),fact('Oferta / marca',engagements.length?engagements.map(e=>e.label).join(', '):'Sem oferta'),fact('Stakeholders',String(stakeholders.length)));
  const open=node('button','Abrir cliente →','secondary');open.type='button';open.onclick=()=>openClient(tenant.id);
  card.append(head,facts,open);$('tenants').append(card);
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
 for(const tenant of rows){
  const engagements=overview.engagements.filter(e=>e.tenant_id===tenant.id), people=overview.stakeholders.filter(s=>s.tenant_id===tenant.id);
  const card=node('article',undefined,'client-card'),head=node('header'),identity=node('div');
  identity.append(node('span',tenant.name.slice(0,1),'client-avatar'),node('span'));identity.lastChild.append(node('h3',tenant.name),node('small',clientLabel(tenant.organization_type)));
  head.append(identity,node('span',clientLabel(tenant.relationship_kind),'status'));const facts=node('div',undefined,'client-card-facts');
  const fact=(l,v)=>{const i=node('div');i.append(node('span',l),node('strong',v));return i;};facts.append(fact('Contratação',engagements.length?engagements.length+' vínculo(s)':'Sem vínculo'),fact('Stakeholders',String(people.length)),fact('Situação',clientLabel(tenant.lifecycle_status)));
  const open=node('button','Abrir organização →','secondary');open.type='button';open.onclick=()=>openClient(tenant.id);card.append(head,facts,open);target.append(card);
 }
}
function renderLeads(){renderDirectory(t=>t.relationship_kind==='prospect','lead-search','leads','leads-empty');}
function renderCompanies(){renderDirectory(t=>t.organization_type==='company','company-search','companies','companies-empty');}

function openClient(id){state.selectedTenant=id;switchView('client');}
function renderClientDetail(){
 const tenant=state.overview?.tenants.find(t=>t.id===state.selectedTenant);if(!tenant){switchView('clients');return;}
 const engagements=state.overview.engagements.filter(e=>e.tenant_id===tenant.id),people=state.overview.stakeholders.filter(s=>s.tenant_id===tenant.id),contracts=state.overview.entitlements.filter(e=>e.tenant_id===tenant.id),members=state.overview.memberships.filter(m=>m.tenant_id===tenant.id);
 $('page-title').textContent=$('breadcrumb').textContent=$('mobile-page-title').textContent=tenant.name;
 const root=$('client-detail'),hero=node('section',undefined,'client-detail-hero'),identity=node('div');identity.append(node('span',tenant.name.slice(0,1),'client-avatar large'),node('div'));identity.lastChild.append(node('p','CLIENTE','overview-kicker'),node('h2',tenant.name),node('p',clientLabel(tenant.organization_type)+' · '+clientLabel(tenant.lifecycle_status),'detail'));hero.append(identity);
 const grid=node('div',undefined,'client-detail-grid'),panel=(title,caption)=>{const el=node('section',undefined,'client-detail-panel');el.append(node('h3',title),node('p',caption,'detail'));return el;};
 const commercial=panel('Ofertas e contratações','O que este cliente compra da TZOLKIN.');if(engagements.length)for(const e of engagements){const row=node('article',undefined,'detail-row');row.append(node('strong',e.label),node('span',clientLabel(e.service_model)+' · '+clientLabel(e.status),'detail'));commercial.append(row);}else commercial.append(node('p','Nenhuma contratação classificada.','empty-list'));
 const stakeholders=panel('Stakeholders','Pessoas envolvidas no relacionamento.');if(people.length)for(const p of people){const row=node('article',undefined,'detail-row');row.append(node('span',p.name.slice(0,1),'person-avatar'),node('div'));row.lastChild.append(node('strong',p.name),node('span',clientLabel(p.role)+(p.title?' · '+p.title:''),'detail'));stakeholders.append(row);}else stakeholders.append(node('p','Nenhum stakeholder vinculado.','empty-list'));
 const access=panel('Produtos e acessos','Contratos e identidades com permissão.');access.append(node('strong',contracts.length+' contratos · '+members.length+' acessos','client-access-count'));
 grid.append(commercial,stakeholders,access);root.replaceChildren(hero,grid);
}

function renderPeople(){
 if(!state.overview)return;const names=new Map(state.overview.tenants.map(t=>[t.id,t.name])),query=$('people-search').value.trim().toLocaleLowerCase('pt-BR');
 const people=state.overview.stakeholders.filter(p=>(p.name+' '+(p.title||'')+' '+(names.get(p.tenant_id)||'')).toLocaleLowerCase('pt-BR').includes(query));$('stakeholder-directory').replaceChildren();$('people-empty').hidden=people.length>0;
 for(const p of people){const card=node('article',undefined,'person-card');card.append(node('span',p.name.slice(0,1),'person-avatar'),node('div'));card.lastChild.append(node('h3',p.name),node('p',clientLabel(p.role)+(p.title?' · '+p.title:''),'detail'),node('button',names.get(p.tenant_id)||'Cliente','person-company'));card.lastChild.lastChild.type='button';card.lastChild.lastChild.onclick=()=>openClient(p.tenant_id);if(p.is_primary)card.append(node('span','Principal','status active'));$('stakeholder-directory').append(card);}
}

function record(title, detail, edit) {
 const row = node('div', undefined, 'record');
 const content = node('div');
 content.append(node('strong', title), node('span', detail, 'detail'));
 row.append(content);
 if (edit) { const button = node('button', 'Editar', 'table-action'); button.type = 'button'; button.onclick = edit; row.append(button); }
 return row;
}

const productLifecycle=(product,info)=>{
 const deployment=readyDeployment(product);
 const evidenceStatus=info?.status||'';
 const isUnproven=product.lifecycle_status==='draft'||(!deployment&&['Planejamento','Disponibilidade a validar'].includes(evidenceStatus))||(!deployment&&product.id==='skiller');
 if(isUnproven)return {label:'Produto em draft',tone:'building',next:'Concluir checklist do projeto antes de ativar'};
 if(deployment)return {label:'No ar',tone:'active',next:'Deploy READY observado no provedor'};
 if(evidenceStatus==='Local')return {label:'Plataforma interna',tone:'building',next:'Uso interno; ainda sem publicação externa'};
 if(evidenceStatus==='Planejamento')return {label:'Em planejamento',tone:'building',next:'Criar ou vincular um projeto de deploy'};
 return {label:'Sem deploy observado',tone:'building',next:'Vincular projeto e validar produção'};
};
const productAppearsDraft=(product,info)=>productLifecycle(product,info).label==='Produto em draft';

const serviceBindingForDeployment=project=>state.serviceBindings.find(binding=>binding.provider===project?.provider&&(String(binding.external_project_id)===String(project?.project_id)||binding.external_project_name===project?.project));
const serviceEngagements=()=>state.overview?.engagements?.filter(e=>['advisory','consulting','on_demand'].includes(e.service_model))||[];

function renderServices(){
 const root=$('services-list');if(!root||!state.overview)return;
 const engagements=serviceEngagements(),names=new Map(state.overview.tenants.map(t=>[t.id,t.name]));
 $('services-summary').replaceChildren(...[['Serviços',engagements.length],['Assessoria',engagements.filter(e=>e.service_model==='advisory').length],['Com deploy vinculado',state.serviceBindings.length]].map(([label,value])=>{const card=node('article');card.append(node('span',label),node('strong',String(value)));return card;}));
 if(!engagements.length){root.replaceChildren(node('p','Nenhum serviço contratado foi classificado.','empty-list'));return;}
 root.replaceChildren(...engagements.map(engagement=>{
  const card=node('article',undefined,'service-card'),head=node('header'),title=node('div');
  title.append(node('h3',engagement.label),node('p',`${names.get(engagement.tenant_id)||'Cliente'} · ${clientLabel(engagement.service_model)}`,'detail'));
  head.append(title,node('span',clientLabel(engagement.status),'status '+(['active','planned'].includes(engagement.status)?'active':'building')));
  const facts=node('div',undefined,'service-card-facts'),bindings=state.serviceBindings.filter(b=>b.engagement_id===engagement.id);
  facts.append(node('span',bindings.length?`${bindings.length} projeto${bindings.length===1?'':'s'} conectado${bindings.length===1?'':'s'}`:'Nenhum projeto conectado','detail'));
  for(const binding of bindings){const project=state.deploys.find(p=>p.provider===binding.provider&&(String(p.project_id)===String(binding.external_project_id)||p.project===binding.external_project_name));const latest=project?.deployments?.[0];const row=node('div',undefined,'service-deploy-row');row.append(node('strong',binding.external_project_name),node('span',`${binding.provider==='vercel'?'Vercel':'EasyPanel'} · ${latest?.state_label||latest?.state||'sem deploy observado'}`,'detail'));if(latest?.url)row.append(catalogLink('Abrir ↗',latest.url,'product-live-link'));facts.append(row);}
  const action=node('button','Abrir cliente →','secondary');action.type='button';action.onclick=()=>openClient(engagement.tenant_id);card.append(head,facts,action);return card;
 }));
}

function renderProductDeployments(){
 const root=$('product-deployment-list');if(!root)return;
 const products=state.overview?.products||[];
 const externalProjects=[...state.deploys,...(state.infrastructure?.projects||[]).map(project=>({provider:'easypanel',project_id:project.name,project:project.name,deployments:[],services:project.services||[]}))];
 const rows=externalProjects.flatMap(project=>{
  const product=products.find(item=>deploymentBelongsToProduct(project,item));
  const serviceBinding=serviceBindingForDeployment(project);
  const latest=project.deployments?.[0]||null;
  return [{project,product,serviceBinding,latest}];
 });
 if(!rows.length){root.replaceChildren(node('p','Nenhum projeto foi retornado pelos provedores configurados.','empty-list'));return;}
 root.replaceChildren(...rows.map(({project,product,serviceBinding,latest})=>{
  const row=node('article',undefined,'record product-deployment-record'),copy=node('div');
  copy.append(node('strong',project.project||'Projeto sem nome'),node('span',`${project.provider==='vercel'?'Vercel':'EasyPanel'} · ${product?`Produto: ${product.name}`:serviceBinding?`Serviço: ${serviceBinding.label} · ${serviceBinding.tenant_name}`:'Sem classificação'}`,'detail'));
  if(latest)copy.append(node('span',`${latest.state_label||latest.state||'Estado não informado'}${latest.created_at?' · '+new Date(latest.created_at).toLocaleString('pt-BR'):''}`,'detail'));
  else copy.append(node('span','Nenhum deploy recente retornado','detail'));
  row.append(copy);
  const actions=node('div',undefined,'product-deployment-actions');
  if(latest?.url)actions.append(catalogLink('Abrir deploy ↗',latest.url,'product-live-link'));
  if(project.provider==='easypanel'&&project.services?.length)actions.append(node('span',`${project.services.length} serviços`,'detail'));
  if(product||serviceBinding)actions.append(node('span',product?'Produto vinculado':'Serviço vinculado','status active'));
  else {actions.append(node('span','Classificação pendente','status building'));const select=document.createElement('select');select.className='product-deployment-select';select.append(option('', 'Vincular a produto…'),...products.map(item=>option(item.id,`${item.name} · ${productAppearsDraft(item,catalogForProduct(item))?'draft':'ativo'}`)));select.onchange=async()=>{if(!select.value)return;select.disabled=true;try{await api('/api/product-deploy-bindings','PUT',{provider:project.provider,external_project_id:project.project_id||project.project,external_project_name:project.project,product_id:select.value,environment:'production'});state.bindings=[...state.bindings.filter(binding=>!(binding.provider===project.provider&&(String(binding.external_project_id)===String(project.project_id||project.project)||binding.external_project_name===project.project))),{provider:project.provider,external_project_id:project.project_id||project.project,external_project_name:project.project,product_id:select.value,environment:'production'}];renderGeneral();}catch(error){select.disabled=false;select.value='';$('notice').textContent=error.message;}};actions.append(select);const services=serviceEngagements();if(services.length){const serviceSelect=document.createElement('select');serviceSelect.className='product-deployment-select';serviceSelect.append(option('', 'Vincular a serviço…'),...services.map(item=>option(item.id,`${item.label} · ${item.service_model}`)));serviceSelect.onchange=async()=>{if(!serviceSelect.value)return;serviceSelect.disabled=true;try{await api('/api/service-deploy-bindings','PUT',{provider:project.provider,external_project_id:project.project_id||project.project,external_project_name:project.project,engagement_id:serviceSelect.value,environment:'production'});state.serviceBindings=(await api('/api/service-deploy-bindings')).bindings||[];renderGeneral();}catch(error){serviceSelect.disabled=false;serviceSelect.value='';$('notice').textContent=error.message;}};actions.append(serviceSelect);}}
  row.append(actions);return row;
 }));
}

function renderManagement(){
 const schema=$('management-schema'),dns=$('management-dns'),redis=$('management-redis'),apis=$('management-apis'),ops=$('management-ops');if(!schema||!dns||!redis||!apis||!ops)return;
 const tables=state.management?.tables||[];schema.replaceChildren(node('h3','Banco de dados · TZOLKIN Core'),node('p','Este explorador consulta somente o PostgreSQL do Core. Navegação estrutural inspirada no Prisma Studio: tabelas, colunas e relações. Linhas e valores de produção continuam protegidos.','detail'));
 if(!tables.length)schema.append(node('p','Carregando metadados do banco…','empty-list'));else {const explorer=node('div',undefined,'db-explorer'),sidebar=node('aside',undefined,'db-sidebar'),detail=node('section',undefined,'db-inspector');const search=document.createElement('input');search.type='search';search.placeholder='Buscar tabela';search.setAttribute('aria-label','Buscar tabela');const navigator=node('div',undefined,'db-navigator');navigator.append(node('strong','TZOLKIN Core'),node('span','▾ public','db-navigator-schema'),node('span',`▾ Tables · ${tables.length}`,'db-navigator-tables'));sidebar.append(navigator,search);const list=node('nav',undefined,'db-table-list');sidebar.append(list);let selected=tables[0],mode='columns';const drawDetail=()=>{detail.replaceChildren();const head=node('header',undefined,'db-inspector-head');head.append(node('div',`TZOLKIN Core / ${selected.schema} / Tables`,'db-eyebrow'),node('h4',selected.name),node('p',`${selected.columns.length} colunas · ${selected.relations?.length||0} relações`,'detail'));detail.append(head);const tabs=node('nav',undefined,'db-inspector-tabs');[['columns','Estrutura'],['relations','Relações'],['data','Dados']].forEach(([key,label])=>{const tab=node('button',label,key===mode?'active':'');tab.type='button';tab.disabled=key==='data';if(key===mode)tab.setAttribute('aria-current','page');tab.title=key==='data'?'Prévia de linhas não está exposta neste painel':'';tab.onclick=()=>{mode=key;drawDetail();};tabs.append(tab);});detail.append(tabs);if(mode==='columns'){const table=node('table',undefined,'db-columns-table');const head=node('thead');head.append(node('tr',undefined));head.firstChild.append(node('th','Coluna'),node('th','Tipo'),node('th','Nulo'));table.append(head);const body=node('tbody');selected.columns.forEach(column=>{const row=node('tr');row.append(node('td',column.name),node('td',column.type),node('td',column.nullable?'Sim':'Não'));body.append(row);});table.append(body);detail.append(table);}else if(mode==='relations'){const relations=selected.relations||[];if(!relations.length)detail.append(node('p','Nenhuma chave estrangeira registrada nesta tabela.','empty-list'));else relations.forEach(relation=>{const row=node('article',undefined,'db-relation-row');row.append(node('strong',relation.column),node('span','→','db-relation-arrow'),node('span',`${relation.table}.${relation.foreign_column}`,'detail'));detail.append(row);});}else detail.append(node('p','A visualização de registros fica desativada para evitar exposição acidental de dados operacionais. Use uma consulta aprovada e auditada quando essa necessidade existir.','notice-inline'));};const drawList=()=>{list.replaceChildren();const query=search.value.trim().toLocaleLowerCase('pt-BR');tables.filter(table=>`${table.schema}.${table.name}`.toLocaleLowerCase('pt-BR').includes(query)).forEach(table=>{const item=node('button',undefined,'db-table-item'+(table===selected?' active':''));item.type='button';item.append(node('strong',table.name),node('span',`${table.columns.length} colunas`,'detail'));item.onclick=()=>{selected=table;mode='columns';drawList();drawDetail();showTable();};list.append(item);});};search.oninput=drawList;drawList();drawDetail();const overview=node('section',undefined,'db-schema-overview');const totalColumns=tables.reduce((count,table)=>count+table.columns.length,0),totalRelations=tables.reduce((count,table)=>count+(table.relations?.length||0),0);overview.append(node('div',`${tables.length} tabelas · ${totalColumns} colunas · ${totalRelations} relações de chave estrangeira`,'db-schema-summary'));const map=node('div',undefined,'db-schema-map');tables.forEach(table=>{const card=node('button',undefined,'db-schema-card');card.type='button';card.append(node('strong',table.name),node('span',`${table.columns.length} colunas`,'detail'));const relations=table.relations||[];if(relations.length)card.append(node('span',relations.slice(0,2).map(relation=>`${relation.column} → ${relation.table}.${relation.foreign_column}`).join(' · ')+(relations.length>2?` +${relations.length-2}`:''),'db-schema-links'));else card.append(node('span','Nenhuma chave estrangeira','db-schema-links'));card.onclick=()=>{selected=table;mode='columns';drawList();drawDetail();showTable();detail.scrollIntoView({behavior:'smooth',block:'nearest'});};map.append(card);});overview.append(map);const viewTabs=node('nav',undefined,'db-view-tabs');const mapTab=node('button','Schema','active'),tableTab=node('button','Tabela');mapTab.type=tableTab.type='button';const showMap=()=>{overview.hidden=false;explorer.hidden=true;mapTab.className='active';tableTab.className='';};const showTable=()=>{overview.hidden=true;explorer.hidden=false;mapTab.className='';tableTab.className='active';};mapTab.onclick=showMap;tableTab.onclick=showTable;viewTabs.append(mapTab,tableTab);explorer.append(sidebar,detail);schema.append(viewTabs,overview,explorer);showMap();}
 if(tables.length){schema.replaceChildren(node('h3','Banco de dados · TZOLKIN Core'),node('p','Navegue pela estrutura real do Core: schema, tabelas, campos e relações. Valores operacionais não são expostos.','detail'));renderDatabaseWorkspace(schema,tables);}const dnsData=state.dns;dns.replaceChildren(node('h3','DNS e domínios'),node('p','Zona consultada diretamente na Hostinger. Registros ficam em leitura até uma alteração ser validada e confirmada.','detail'));if(!dnsData)dns.append(node('p','Consultando zona DNS…','empty-list'));else if(dnsData.status!=='ok')dns.append(node('p',dnsData.status==='unconfigured'?'API DNS ainda não configurada no servidor.':dnsData.status==='unauthorized'?'A chave da Hostinger não possui acesso à zona.':'A zona DNS não pôde ser consultada agora.','notice-inline'));else {const head=node('div',undefined,'dns-zone-head');head.append(node('strong',dnsData.zone),node('span',`${dnsData.records.length} registros`,'status active'));dns.append(head);const records=node('div',undefined,'dns-record-list');dnsData.records.slice(0,12).forEach(record=>{const row=node('article',undefined,'dns-record-row');row.append(node('code',record.type),node('strong',record.name),node('span',record.records.map(item=>item.content).join(' · '),'detail'),node('span',`TTL ${record.ttl}s`,'detail'));records.append(row);});dns.append(records);if(dnsData.records.length>12)dns.append(node('p',`Mostrando 12 de ${dnsData.records.length} registros da zona.`,'detail'));}
 const services=(state.infrastructure?.projects||[]).flatMap(project=>(project.services||[]).map(service=>({...service,project:project.name})));redis.replaceChildren(node('h3','Redis e caches'),node('p','Painel de instância inspirado no Redis Cloud: estado, contexto e métricas separadas do inventário. Chaves e valores não são exibidos.','detail'));const caches=services.filter(service=>service.type==='redis');if(!caches.length)redis.append(node('p','Nenhum Redis observado.','empty-list'));else caches.forEach(service=>{const card=node('article',undefined,'redis-console-card');const head=node('header',undefined,'redis-console-head');head.append(deliveryIcon('cache'),node('div'));head.lastChild.append(node('strong',service.name),node('span',`${service.project} · EasyPanel`,'detail'));head.append(node('span','Observado','status building'));card.append(head);const metrics=node('div',undefined,'redis-metric-grid');[['Estado','Inventário'],['Chaves','Não exposto'],['Memória','Não exposto'],['Operações/s','Não exposto']].forEach(([label,value])=>{const item=node('div');item.append(node('span',label),node('strong',value));metrics.append(item);});card.append(metrics,node('p','Última leitura: inventário do provedor. Para métricas reais, o adaptador Redis precisa de endpoint autorizado.','detail'));redis.append(card);});
 apis.replaceChildren(node('h3','APIs e aplicações'),node('p','Projetos e serviços de aplicação ligados a produtos ou serviços, quando essa classificação já existe.','detail'));const productNames=new Map((state.overview?.products||[]).map(product=>[product.id,product.name]));const engagementLabels=new Map((state.overview?.engagements||[]).map(engagement=>[engagement.id,engagement.label]));const apps=[...state.deploys.map(project=>{const binding=bindingForDeployment(project),serviceBinding=state.serviceBindings.find(item=>item.provider==='vercel'&&(String(item.external_project_id)===String(project.project_id)||item.external_project_name===project.project));return {name:project.project,provider:'vercel',detail:project.deployments?.[0]?.state_label||'sem deploy',association:binding?.product_id?(productNames.get(binding.product_id)||'Produto vinculado'):serviceBinding?.engagement_id?(engagementLabels.get(serviceBinding.engagement_id)||'Serviço vinculado'):null};}),...services.filter(service=>['app','compose','box','wordpress'].includes(service.type)).map(service=>{const productBinding=state.bindings.find(binding=>binding.provider==='easypanel'&&(binding.external_project_id===service.name||binding.external_project_name===service.name));const serviceBinding=state.serviceBindings.find(binding=>binding.provider==='easypanel'&&(binding.external_project_id===service.name||binding.external_project_name===service.name));return {name:service.name,provider:'easypanel',detail:`${service.project} · inventário observado`,association:productBinding?.product_id?(productNames.get(productBinding.product_id)||'Produto vinculado'):serviceBinding?.engagement_id?(engagementLabels.get(serviceBinding.engagement_id)||'Serviço vinculado'):null};})];if(!apps.length)apis.append(node('p','Nenhuma API ou aplicação observada.','empty-list'));else apps.forEach(app=>{const row=node('article',undefined,'management-row');row.append(providerLogo(app.provider),node('strong',app.name),node('span',app.detail,'detail'),node('span',app.association?app.association:'Sem classificação','status '+(app.association?'active':'building')));apis.append(row);});
 ops.replaceChildren(node('h3','Checklist operacional'),node('p','Sinais para orientar a próxima ação. A leitura dos provedores continua separada de comandos de deploy.','detail'));const checks=[['Schema do Core',Boolean(state.management?.tables?.length),'Metadados disponíveis'],['Vercel',Boolean(state.deploys.length),'Inventário consultado'],['EasyPanel',state.infrastructure?.status==='ok','Inventário consultado'],['Classificação',apps.filter(app=>!app.association).length===0,'Todos os apps estão ligados a produto ou serviço']];checks.forEach(([label,ready,detail])=>{const row=node('article',undefined,'management-row');row.append(node('span',ready?'✓':'!',`status ${ready?'active':'building'}`),node('strong',label),node('span',ready?detail:'Revisar pendência','detail'));ops.append(row);});
}

function renderGeneral() {
 const overview = state.overview;
 const servicesLink=$('products-services-link');if(servicesLink)servicesLink.onclick=()=>switchView('services');
 const catalogById = new Map(state.catalog.filter(entry=>entry.kind==='product').map(entry=>[entry.payload.id,entry.payload]));
 renderMetrics([
  ['Clientes', overview.tenants.filter(t=>t.relationship_kind==='customer').length],
  ['Contratos de produto', overview.entitlements.filter(e => e.active).length],
  ['Vínculos de acesso', overview.memberships.filter(m => m.active).length],
 ]);
 fillDirectorySelects();
 renderTenants();
 renderLeads(); renderCompanies();
 const names = new Map(overview.tenants.map(t => [t.id, t.name]));
 const products = new Map(overview.products.map(p => [p.id, p.name]));
 $('product-catalog').replaceChildren(...overview.products.map(product => {
  const productInfo=catalogById.get(product.id)||{};
  const card = node('article', undefined, 'product-card');
  const count = overview.entitlements.filter(e => e.product_id === product.id && e.active).length;
  const body = node('div', undefined, 'product-card-body');
  body.append(node('h3', product.name), node('p', count + ' contrato' + (count === 1 ? ' ativo' : 's ativos') + ' · ' + product.id));
  const published=publishedDeployUrl(product),lifecycle=productLifecycle(product,productInfo),isDraft=productAppearsDraft(product,productInfo),live=isDraft?(published||null):productLiveUrl(product),stateBadge=node('span',lifecycle.label,'status '+lifecycle.tone),lifecycleBadge=node('span',isDraft?'Produto em draft':'Produto ativo','status '+(isDraft?'building':'active'));body.append(lifecycleBadge,stateBadge,node('small',lifecycle.next,'product-next-action'));card.append(productFavicon(productFaviconUrl(product)), body);
  const open = node('button', 'Abrir gestão do produto →', 'table-action');
  open.type = 'button';
  open.onclick = () => openProductModule(product,'product').catch(reportError);
  card.append(open);
  const configure=node('button','Cobrança e e-mails','table-action');configure.type='button';configure.onclick=()=>openProductModule(product,'product-payments').catch(reportError);card.append(configure);
  if(live)card.append(catalogLink(published?'Abrir deploy ↗':'Abrir produto ↗',live,'product-live-link'));else if(productInfo.url&&!isDraft)card.append(catalogLink('Abrir endereço ↗',productInfo.url,'product-live-link'));
  return card;
 }));
 renderProductDeployments();
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
  for (const service of project.services){const row=node('div',undefined,'infra-service-row'),info=node('div',undefined,'card-identity');info.append(deliveryIcon(['postgres','mysql','mariadb','mongo'].includes(service.type)?'database':service.type==='redis'?'cache':'api'),node('strong',service.name),node('span',service.type,'status'));row.append(info,resourceButton('Detalhes','easypanel',`${project.name}/${service.name}`));card.append(row);}
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
  const mark=node('span',undefined,'deploy-project-mark');mark.append(providerLogo(projeto.provider));identidade.append(mark,node('h3', projeto.project || 'Projeto sem nome'));
  // Sem repositório não há commit, não há rollback por commit e não dá para criar Deploy Hook.
  if (projeto.git_connected === false) identidade.append(node('span', 'sem repositório', 'status'));
  const actions=node('div',undefined,'deploy-project-actions');actions.append(node('span', projeto.provider, 'ecosystem-category'));
  if(projeto.project_id)actions.append(resourceButton('Ver projeto',projeto.provider,projeto.project_id));
  topo.append(identidade,actions);
  card.append(topo);

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
 form.onsubmit=async event=>{event.preventDefault();save.disabled=true;error.textContent='';const data=Object.fromEntries(new FormData(form));try{await api('/api/product-resource-bindings','PUT',{...data,id:initial.id||undefined,product_id:product.id,environment:data.environment||null,url:data.url||null});await reloadProductConnections(product);}catch(reason){error.textContent=reason.message;save.disabled=false;}};
 requestAnimationFrame(()=>display.focus());
 return form;
}

function productResourceRow(product, category, item) {
 const wrapper=node('div',undefined,'product-architecture-entry'),row=node('div',undefined,'product-architecture-row');
 const title=item.name||item.provider||'Configuração',meta=[item.provider,item.repository||item.branch||item.record_type||item.kind,item.environment].filter(Boolean).join(' · ')||(item.offers?`${item.offers} oferta${item.offers===1?'':'s'}`:'');
 row.append(node('strong',title),node('span',meta,'detail'));
 const statusText=item.source==='confirmed'?(item.reconciliation==='missing'?'Não encontrado no provedor':item.reconciliation==='manual'?'Manual':'Confirmado e observado'):item.source==='detected'?'Detectado':'Configurado';
 row.append(node('span',statusText,`status ${item.reconciliation==='missing'?'danger':item.source==='detected'?'building':'active'}`));
 const actions=node('div',undefined,'product-resource-actions');
 if(item.source==='detected'){
  const confirm=node('button','Confirmar','table-action');confirm.type='button';confirm.onclick=async()=>{confirm.disabled=true;try{await api('/api/product-resource-bindings','PUT',{...resourcePayload(product,category,item),id:undefined});await reloadProductConnections(product);}catch(error){confirm.disabled=false;reportError(error);}};actions.append(confirm);
 } else if(item.binding_id){
  const edit=node('button','Editar','table-action'),remove=node('button','Remover','table-action danger-link');edit.type=remove.type='button';
  edit.onclick=()=>{wrapper.querySelector('.product-resource-form')?.remove();wrapper.append(productResourceForm(product,resourcePayload(product,category,item),()=>wrapper.querySelector('.product-resource-form')?.remove()));};
  remove.onclick=()=>{actions.replaceChildren(node('span','Remover este vínculo?','detail'));const cancel=node('button','Cancelar','table-action'),confirm=node('button','Sim, remover','table-action danger-link');cancel.type=confirm.type='button';cancel.onclick=()=>actions.replaceChildren(edit,remove);confirm.onclick=async()=>{confirm.disabled=true;try{await api(`/api/product-resource-bindings/${encodeURIComponent(item.binding_id)}`,'DELETE');await reloadProductConnections(product);}catch(error){confirm.disabled=false;reportError(error);}};actions.append(cancel,confirm);};
  actions.append(edit,remove);
 }
 if(actions.childElementCount)row.append(actions);wrapper.append(row);return wrapper;
}

function renderProductArchitecture(product) {
 const topology=state.topology?.products?.find(item=>item.id===product.id),architecture=node('section',undefined,'product-architecture');
 const heading=node('div',undefined,'product-architecture-heading'),copy=node('div');copy.append(node('div','ARQUITETURA DO PRODUTO','overview-kicker'),node('h3','Conexões e recursos'),node('p','O inventário detecta candidatos. Uma conexão confirmada é persistida, auditada e reconciliada com o provedor.','detail'));
 const add=node('button','Adicionar conexão','secondary');add.type='button';heading.append(copy,add);architecture.append(heading);
 const editor=node('div',undefined,'product-resource-editor');add.onclick=()=>{editor.replaceChildren(productResourceForm(product,{},()=>editor.replaceChildren()));};architecture.append(editor);
 if(!topology){architecture.append(node('p','A topologia ainda não foi consultada.','empty-list'));return architecture;}
 const missing=Object.values(topology.connections).flat().filter(item=>item.reconciliation==='missing').length;
 if(missing)architecture.append(node('p',`${missing} conexão${missing===1?' confirmada não foi encontrada':' confirmadas não foram encontradas'} no inventário atual. Revise antes do próximo deploy.`,'product-resource-warning'));
 const grid=node('div',undefined,'product-architecture-grid');
 for(const [category,[,label]] of Object.entries(PRODUCT_RESOURCE_TYPES)){
  const group=node('article',undefined,'product-architecture-group');group.append(node('span',label,'product-architecture-label'));const items=topology.connections[category]||[];
  if(!items.length)group.append(node('p','Ainda não identificado.','detail'));else items.forEach(item=>group.append(productResourceRow(product,category,item)));grid.append(group);
 }
 architecture.append(grid);return architecture;
}

function renderProductRecord(product) {
 const panel = node('div', undefined, 'context-card product-record-card');
 const lifecycle=productLifecycle(product,product.catalog||null),appearsDraft=productAppearsDraft(product,product.catalog||null),live=appearsDraft?(publishedDeployUrl(product)||null):productLiveUrl(product);const identity=node('div',undefined,'product-record-identity');identity.append(productFavicon(productFaviconUrl(product)),node('div'));identity.lastChild.append(node('span','CATÁLOGO DE PRODUTO','overview-kicker'),node('h2', product.name), node('p', 'Identificador: ' + product.id, 'detail'));panel.append(identity);
 const actions=node('div',undefined,'product-record-actions');for(const [label,view,icon] of [['Cobrança','product-payments','wallet'],['E-mails','product-emails','mail']]){const button=node('button',undefined,'secondary');button.type='button';button.append(createIcon(icon),document.createTextNode(label));button.onclick=()=>switchView(view);actions.append(button);}panel.append(actions);
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
 const facts=node('div',undefined,'product-record-facts');for(const [label,value] of [['Tipo',product.portfolio_kind||'Produto'],['Estado operacional',lifecycle.label],['Família',product.brand_family||'TZOLKIN']]){const fact=node('div');fact.append(node('span',label),node('strong',String(value)));facts.append(fact);}panel.append(facts);
 const connection=node('section',undefined,'product-connection-card'),deployment=readyDeployment(product),project=state.deploys.find(item=>deploymentBelongsToProduct(item,product));connection.append(node('h3','Conexão de deploy'),node('p',deployment?`${project?.project||'Projeto'} · ${project?.provider==='vercel'?'Vercel':'EasyPanel'} · READY observado`:'Nenhum deploy READY vinculado a este produto.','detail'));const connectionActions=node('div',undefined,'product-connection-actions');if(deployment?.url)connectionActions.append(catalogLink('Abrir produção ↗',deployment.url,'product-live-link'));const openDeploys=node('button','Ver projetos e deploys →','secondary');openDeploys.type='button';openDeploys.onclick=()=>{state.context='';state.view='deploys';clearRenderedData();renderContextChrome();renderNav();load().catch(reportError);};connectionActions.append(openDeploys);connection.append(connectionActions);panel.append(connection);
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
  const edit = node('button', 'Editar contrato', 'table-action');
  edit.type = 'button';
  edit.setAttribute('aria-label', `Editar contrato de ${org.name}`);
  edit.onclick = () => openDialog('entitlement-dialog', {
   tenant_id: org.tenant_id, product_id: context.product.id, plan: org.plan,
   rights: org.rights, active: String(org.contract_active),
  });
  action.append(edit);
  row.append(title, contract, node('td', org.plan), people, action);
  $('product-orgs').append(row);
 }
}

function renderProduct() {
 const context = state.product;
 renderMetrics([
  ['Organizações', context.summary.organizations],
  ['Contratos ativos', context.summary.active_contracts],
  ['Contratos revogados', context.summary.revoked_contracts],
  ['Pessoas alcançadas', context.summary.reachable_memberships, 'com vínculo neste produto'],
 ]);
 renderProductRecord({...context.product,deploy_url:publishedDeployUrl(context.product)});
 renderProductRights(context.organizations);
 renderProductOrganizations();
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
 for (const select of document.querySelectorAll('.product-select')) {
  const previous = select.value;
  select.replaceChildren(option('', 'Selecione o produto'), ...overview.products.map(p => option(p.id, p.name)));
  if (overview.products.some(p => p.id === previous)) select.value = previous;
 }
}

function fillContextSelect(products) {
 const select = $('context-select');
 select.replaceChildren(option('', 'TZOLKIN · Gestão geral'));
 const group = document.createElement('optgroup');
 group.label = 'Gestão de produto';
 group.append(...products.map(p => option(p.id, p.name)));
 select.append(group);
 select.value = state.context;
}

// O contexto geral é o único que carrega o cadastro completo.
// O contexto de produto pede apenas o recorte daquele produto ao servidor.
async function load() {
 if (contextKind() === 'general') {
 const [overview, catalog, bindings, resourceBindings, serviceBindings, topology] = await Promise.all([api('/api/overview'), api('/api/ecosystem'), api('/api/product-deploy-bindings'), api('/api/product-resource-bindings'), api('/api/service-deploy-bindings'), api('/api/products/topology').catch(()=>null)]);
 state.overview = overview;
  state.catalog = catalog.entries || [];
  state.bindings = bindings.bindings || [];
  state.resourceBindings = resourceBindings.bindings || [];
  state.serviceBindings = serviceBindings.bindings || [];
  state.topology = topology;
  $('login').hidden = true; $('workspace').hidden = false;
  fillContextSelect(overview.products);
  renderGeneral();
  renderPeople();
  if(state.view==='client')renderClientDetail();
  // Provedor externo pode estar fora do ar: o painel não pode cair junto.
  const month=currentMonth(),[financeData,salesData]=await Promise.all([api('/api/finance/board?month='+month).catch(()=>null),api('/api/finance/sales?month='+month).catch(()=>null)]);
  let deployments=null,infrastructure=null;
  renderOverviewDashboard(catalog.entries,{finance:financeData,sales:salesData});
  await api('/api/deploys').then(data=>{deployments=data;state.deploys=data.projects||[];renderDeploys(data);renderManagement();renderGeneral();renderOverviewDashboard(catalog.entries,{finance:financeData,sales:salesData,deploys:deployments});}).catch(error => {
   $('deploys-status').replaceChildren(node('p', error.message, 'security-banner'));
  });
  $('easypanel-inventory').replaceChildren(node('p', 'Consultando EasyPanel…', 'empty-list'));
 await api('/api/infrastructure/easypanel').then(data=>{infrastructure=data;state.infrastructure=data;renderEasypanel(data);renderProductDeployments();renderManagement();renderOverviewDashboard(catalog.entries,{finance:financeData,sales:salesData,deploys:deployments,infrastructure});}).catch(() => {
   $('easypanel-inventory').replaceChildren(node('p', 'Não foi possível consultar o EasyPanel.', 'empty-list'));
  });
  renderOverviewDashboard(catalog.entries,{finance:financeData,sales:salesData,deploys:deployments,infrastructure});
 } else {
 const [productContext,topology,resourceBindings]=await Promise.all([api(`/api/products/${encodeURIComponent(state.context)}/console`),api('/api/products/topology').catch(()=>null),api(`/api/product-resource-bindings?product_id=${encodeURIComponent(state.context)}`).catch(()=>({bindings:[]}))]);state.product=productContext;state.topology=topology;state.resourceBindings=resourceBindings.bindings||[];
  // Se o operador entrou direto em um produto, ainda não há motivo para ter
  // carregado o inventário geral. Busca a evidência técnica sob demanda para
  // o cartão de conexão continuar correto neste contexto.
  if(!state.deploys.length) await api('/api/deploys').then(data=>{state.deploys=data.projects||[];}).catch(()=>{});
  $('login').hidden = true; $('workspace').hidden = false;
 renderProduct();
  if(state.view==='product-payments')await productPayments.load(state.product.product);
  if(state.view==='product-emails')await productEmails.load({...state.product.product,deploy_url:publishedDeployUrl(state.product.product),favicon_url:productFaviconUrl(state.product.product)});
 }
 renderContextChrome();
 await renderSecurityBanner();
 if(contextKind()==='general') await resource.resume();
 if(state.view==='tracking') await tracking.load();
 if(state.view==='finance') await finance.load();
 if(state.view==='emails') await emails.load();
}

// A lista de organizações só é buscada quando o operador abre um formulário que precisa dela.
async function ensureDirectory() {
 if (!state.overview) state.overview = await api('/api/overview');
 fillDirectorySelects();
}

/* ---------- formulários ---------- */

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
 if (state.view === 'projects') { projects.openNew(); return; }
 const dialog=views()[state.view].action[1];
 if(dialog==='tenant-dialog'){
  const relationship=$('tenant-form').elements.relationship_kind;
  if(state.view==='leads') relationship.value='prospect';
  else if(state.view==='clients') relationship.value='customer';
 }
 openDialog(dialog);
};
$('context-select').addEventListener('change', event => switchContext(event.target.value).catch(reportError));
$('client-search').addEventListener('input', renderTenants);
$('lead-search').addEventListener('input', renderLeads);
$('company-search').addEventListener('input', renderCompanies);
$('people-search').addEventListener('input', renderPeople);
$('client-back').onclick=()=>switchView('clients');
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
 try { await load(); if (state.view === 'projects') await projects.load(); if(state.view==='resource') await resource.refresh(); $('notice').textContent = 'Atualizado.'; }
 catch (error) { reportError(error); } finally { $('refresh').disabled = false; }
};
$('logout').onclick = async () => {
 try { const result=await api('/api/logout', 'POST', {});if(result.logout_url){location.assign(result.logout_url);return;}signedOut(); $('login-notice').textContent = ''; }
 catch (error) { $('notice').textContent = error.message; }
};

const resource = setupResource({api,activate:()=>switchView('resource'),canOpen:()=>!$('workspace').hidden && contextKind()==='general',back:()=>switchView('deploys')});
const projects = setupProjects({api,openDeploys:()=>switchView('deploys')});
const delivery = setupDelivery({ api,openResource:resource.open });
renderNav();
switchView(state.view);
renderContextChrome();
load().catch(error => { if (error.message !== 'Entre para continuar.') $('login-notice').textContent = error.message; });

// Registro do service worker. Só existe para notificação: o worker não faz
// cache, então não há risco de servir código velho depois de um deploy.
// Falha em silêncio de propósito — sem push o painel funciona igual.
if ('serviceWorker' in navigator && (location.protocol === 'https:' || location.hostname === '127.0.0.1')) {
 navigator.serviceWorker.register('/sw.js', { scope: '/' }).catch(() => {});
}
