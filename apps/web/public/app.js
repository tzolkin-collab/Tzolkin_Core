// Apresentação e serialização de formulários. Autorização, recorte por produto
// e regras de negócio ficam no servidor: nada aqui decide o que o operador pode ver.
import { setupDelivery, deliveryIcon } from './delivery.js';
import { setupResource } from './resource.js';
import {providerLogo,createIcon} from './icons.js';
import {paymentInstitution} from './finance-model.js';
import {setupEmails} from './emails.js';
import {setupTracking} from './tracking.js';
import {setupFinance} from './finance.js';
import {setupBilling} from './billing.js';
import {setupProductPayments} from './product-payments.js';
const billing=setupBilling({api});
const productPayments=setupProductPayments({api,configure:product=>billing.open(product)});
const emails=setupEmails({api,configure:product=>billing.open(product)});
const finance=setupFinance({api});
const tracking=setupTracking({api});
const $ = id => document.getElementById(id);
fetch('/api/auth/mode').then(r=>r.ok?r.json():null).then(auth=>{const oidc=auth?.mode==='google-oidc';$('login-form').hidden=oidc;$('google-login').hidden=!oidc;if(oidc&&new URLSearchParams(location.search).has('auth_error'))$('login-notice').textContent='Conta Google não autorizada ou login expirado.';}).catch(()=>{$('login-notice').textContent='Não foi possível verificar o modo de acesso. Atualize a página.';});
$('plan-help').textContent='Use o slug de uma oferta deste produto para salvar suas condições de cobrança em rascunho. Sem oferta correspondente, o plano continua apenas cadastral.';

const state = { context: '', view: 'overview', overview: null, product: null, selectedTenant: null };

// Cada contexto declara a própria navegação. Menu só existe quando há dado real por trás.
const CONTEXTS = {
 general: {
  label: 'ESPAÇO DE TRABALHO',
  views: {
   overview: { title: 'Visão geral', section: 'view-overview', metrics: false },
   tracking: { title: 'Acompanhamento', section: 'view-tracking', metrics:false },
   finance: { title: 'Financeiro', section: 'view-finance', metrics:false },
   clients: { title: 'Clientes', section: 'view-clients', action: ['Novo cliente', 'tenant-dialog'], metrics:false },
   leads: { title: 'Leads', section: 'view-leads', action: ['Novo lead', 'tenant-dialog'], metrics:false },
   metrics: { title: 'Métricas', section: 'view-overview', metrics:false },
   companies: { title: 'Empresas', section: 'view-companies', action: ['Nova empresa', 'tenant-dialog'], metrics:false },
   client: { title: 'Cliente', section: 'view-client', hidden:true, metrics:false },
   people: { title: 'Pessoas', section: 'view-people', action: ['Nova pessoa', 'stakeholder-dialog'], metrics:false },
   emails: { title: 'E-mails', section: 'view-emails', metrics:false, hidden:true },
   products: { title: 'Produtos', section: 'view-products', action: ['Vincular cliente', 'entitlement-dialog'] },
   education: { title: 'Mentorias', section: 'view-mentorias', metrics:false },
   services: { title: 'Serviços', section: 'view-delivery', metrics:false },
   access: { title: 'Acessos', section: 'view-access', action: ['Vincular acesso', 'member-dialog'] },
   settings: { title: 'Configurações', section: 'view-settings', metrics:false },
   security: { title: 'Segurança', section: 'view-security', metrics:false },
   deploys: { title: 'Deploys', section: 'view-deploys', metrics: false },
   serverMetrics: { title: 'Métricas de servidor', section: 'view-server-metrics', metrics:false },
   delivery: { title: 'Projetos e serviços', section: 'view-delivery', metrics: false, hidden:true },
   resource: { title: 'Projeto e serviço', section: 'view-resource', metrics: false, hidden:true },
  },
 },
 product: {
  label: 'GESTÃO DO PRODUTO',
  views: {
   product: { title: 'Visão geral', section: 'view-product' },
   'product-orgs': { title: 'Clientes', section: 'view-product-orgs', action: ['Vincular cliente', 'entitlement-dialog'] },
   'product-payments': { title: 'Pagamentos', section: 'view-product-payments', metrics:false },
  },
 },
};

const SECTIONS = ['view-tracking', 'view-resource', 'view-overview', 'view-clients', 'view-leads', 'view-companies', 'view-client', 'view-people', 'view-products', 'view-mentorias', 'view-access', 'view-settings', 'view-security', 'view-deploys', 'view-server-metrics', 'view-delivery', 'view-product', 'view-product-orgs', 'view-product-payments'];
const DATA_NODES = ['tenants', 'leads', 'companies', 'client-summary', 'client-detail', 'stakeholder-directory', 'members', 'contracts', 'product-catalog', 'overview-kpis', 'overview-alerts', 'overview-integrations', 'overview-product-list', 'overview-actions', 'product-orgs', 'product-record', 'product-rights', 'metrics', 'deploys-list', 'deploys-status'];
SECTIONS.push('view-finance','view-emails');

const contextKind = () => (state.context ? 'product' : 'general');
const views = () => CONTEXTS[contextKind()].views;
const productName = () => state.product?.product?.name || state.context;

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
 state.overview = null; state.product = null; state.context = '';
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
 const groups=contextKind()==='general'?{overview:'Visualização',tracking:'Visualização',finance:'Visualização',companies:'Relacionamentos',people:'Relacionamentos',leads:'Operação',metrics:'Operação',clients:'Operação',services:'Operação',products:'Operação',education:'Educacional',settings:'Gestão',access:'Gestão',security:'Gestão',deploys:'Tecnologia',serverMetrics:'Tecnologia'}:{product:'Produto','product-orgs':'Produto','product-payments':'Produto'};
 const items=[];let previous;
 for(const [key,view]of Object.entries(context.views).filter(([,view])=>!view.hidden)){
  if(groups[key]!==previous){const label=node('span',groups[key],'nav-group');label.setAttribute('aria-hidden','true');items.push(label);previous=groups[key];}
  const button = node('button', undefined, 'nav-item' + (key === state.view ? ' active' : ''));
  button.type = 'button'; button.dataset.view = key;
  const icon = createIcon(({overview:'layers',clients:'building',companies:'building',people:'people',tracking:'calendar',finance:'wallet',metrics:'chart',leads:'user-plus',products:'package',education:'graduation-cap',services:'repo',access:'shield',settings:'sliders',security:'lock',deploys:'cloud',serverMetrics:'activity',product:'package','product-orgs':'people','product-payments':'wallet'})[key]);
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
 if (view === 'delivery') delivery.load().catch(reportError);
 if (view === 'tracking') tracking.load().catch(reportError);
 if (view === 'finance') finance.load().catch(reportError);
 if (view === 'emails') emails.load().catch(reportError);
 if (view === 'people') renderPeople();
 if (view === 'clients') renderTenants();
 if (view === 'leads') renderLeads();
 if (view === 'companies') renderCompanies();
 if (view === 'products') renderGeneral();
 if (view === 'client') renderClientDetail();
 if (view === 'product-payments'&&state.product) productPayments.load(state.product.product).catch(reportError);
 if (view === 'metrics' && state.overview) renderGeneral();
 if (view === 'services') delivery.load().catch(reportError);
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
 $('overview-product-list').replaceChildren(...overview.products.map(product=>{const contracts=activeContracts.filter(e=>e.product_id===product.id).length,item=productEntries.get(product.name),row=node('button',undefined,'overview-product');row.type='button';row.onclick=()=>{$('context-select').value=product.id;switchContext(product.id).catch(reportError);};row.append(node('span',product.name.slice(0,1),'product-mark'));const text=node('span');text.append(node('strong',product.name),node('small',item?.description||`${contracts} ${contracts===1?'contrato ativo':'contratos ativos'}`));row.append(text,node('span',String(contracts),'overview-product-count'),createIcon('arrow'));return row;}));
 $('overview-actions').replaceChildren(overviewButton('Clientes','Carteira e visão individual','clients','people'),overviewButton('Pessoas','Stakeholders e empresas','people','people'),overviewButton('Financeiro','Bancos, Stripe e Asaas','finance','wallet'),overviewButton('Acompanhamento','Agenda e apontamentos','tracking','calendar'),overviewButton('Projetos e serviços','Repositórios e destinos','delivery','repo'),overviewButton('Acessos','Identidades e permissões','access','shield'));
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

function renderGeneral() {
 const overview = state.overview;
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
  const card = node('article', undefined, 'product-card');
  const count = overview.entitlements.filter(e => e.product_id === product.id && e.active).length;
  const body = node('div', undefined, 'product-card-body');
  body.append(node('h3', product.name), node('p', count + ' contrato' + (count === 1 ? ' ativo' : 's ativos')));
  card.append(node('span', product.name.slice(0, 1), 'product-mark'), body);
  const open = node('button', 'Abrir gestão do produto →', 'table-action');
  open.type = 'button';
  open.onclick = () => { $('context-select').value = product.id; switchContext(product.id).catch(reportError); };
  card.append(open);
  const configure=node('button','Cobrança e e-mails','table-action');configure.type='button';configure.onclick=()=>billing.open(product);card.append(configure);
  return card;
 }));
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

function renderProductRecord(product) {
 const panel = node('div', undefined, 'context-card');
 panel.append(node('h2', product.name), node('p', 'Identificador: ' + product.id, 'detail'));
 const catalog = product.catalog;
 if (catalog) {
  panel.append(node('p', catalog.description, 'context-description'));
  const meta = node('div', undefined, 'catalog-links');
  if (catalog.url) meta.append(catalogLink('Abrir endereço ↗', catalog.url));
  if (catalog.source) meta.append(catalogLink('Ficha no Notion ↗', catalog.source));
  panel.append(node('span', catalog.status, 'status'), node('small', catalog.note), meta);
 } else {
  panel.append(node('p', 'Sem ficha no catálogo importado do Notion. Nada foi inferido para preencher este espaço.', 'context-description'));
 }
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
 renderProductRecord(context.product);
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
  const [overview, catalog] = await Promise.all([api('/api/overview'), api('/api/ecosystem')]);
  state.overview = overview;
  $('login').hidden = true; $('workspace').hidden = false;
  fillContextSelect(overview.products);
  renderGeneral();
  renderPeople();
  if(state.view==='client')renderClientDetail();
  // Provedor externo pode estar fora do ar: o painel não pode cair junto.
  const month=currentMonth(),[financeData,salesData]=await Promise.all([api('/api/finance/board?month='+month).catch(()=>null),api('/api/finance/sales?month='+month).catch(()=>null)]);
  let deployments=null,infrastructure=null;
  renderOverviewDashboard(catalog.entries,{finance:financeData,sales:salesData});
  await api('/api/deploys').then(data=>{deployments=data;renderDeploys(data);renderOverviewDashboard(catalog.entries,{finance:financeData,sales:salesData,deploys:deployments});}).catch(error => {
   $('deploys-status').replaceChildren(node('p', error.message, 'security-banner'));
  });
  $('easypanel-inventory').replaceChildren(node('p', 'Consultando EasyPanel…', 'empty-list'));
  await api('/api/infrastructure/easypanel').then(data=>{infrastructure=data;renderEasypanel(data);renderOverviewDashboard(catalog.entries,{finance:financeData,sales:salesData,deploys:deployments,infrastructure});}).catch(() => {
   $('easypanel-inventory').replaceChildren(node('p', 'Não foi possível consultar o EasyPanel.', 'empty-list'));
  });
  renderOverviewDashboard(catalog.entries,{finance:financeData,sales:salesData,deploys:deployments,infrastructure});
 } else {
  state.product = await api(`/api/products/${encodeURIComponent(state.context)}/console`);
  $('login').hidden = true; $('workspace').hidden = false;
 renderProduct();
  if(state.view==='product-payments')await productPayments.load(state.product.product);
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
 try { await load(); if (state.view === 'delivery') await delivery.load(); if(state.view==='resource') await resource.refresh(); $('notice').textContent = 'Atualizado.'; }
 catch (error) { reportError(error); } finally { $('refresh').disabled = false; }
};
$('logout').onclick = async () => {
 try { const result=await api('/api/logout', 'POST', {});if(result.logout_url){location.assign(result.logout_url);return;}signedOut(); $('login-notice').textContent = ''; }
 catch (error) { $('notice').textContent = error.message; }
};

const resource = setupResource({api,activate:()=>switchView('resource'),canOpen:()=>!$('workspace').hidden && contextKind()==='general',back:()=>switchView('deploys')});
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
