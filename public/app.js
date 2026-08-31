// Apresentação e serialização de formulários. Autorização, recorte por produto
// e regras de negócio ficam no servidor: nada aqui decide o que o operador pode ver.
const $ = id => document.getElementById(id);

const state = { context: '', view: 'clients', overview: null, product: null };

// Cada contexto declara a própria navegação. Menu só existe quando há dado real por trás.
const CONTEXTS = {
 general: {
  label: 'ESPAÇO DE TRABALHO',
  views: {
   ecosystem: { title: 'Ecossistema', icon: '◉', section: 'view-ecosystem', metrics: false },
   clients: { title: 'Clientes', icon: '▦', section: 'view-clients', action: ['Novo cliente', 'tenant-dialog'] },
   products: { title: 'Produtos e planos', icon: '◈', section: 'view-products', action: ['Vincular produto', 'entitlement-dialog'] },
   access: { title: 'Pessoas e acessos', icon: '◎', section: 'view-access', action: ['Vincular pessoa', 'member-dialog'] },
   deploys: { title: 'Deploys', icon: '△', section: 'view-deploys', metrics: false },
  },
 },
 product: {
  label: 'GESTÃO DO PRODUTO',
  views: {
   product: { title: 'Visão geral', icon: '◉', section: 'view-product' },
   'product-orgs': { title: 'Organizações', icon: '▦', section: 'view-product-orgs', action: ['Vincular organização', 'entitlement-dialog'] },
  },
 },
};

const SECTIONS = ['view-ecosystem', 'view-clients', 'view-products', 'view-access', 'view-deploys', 'view-product', 'view-product-orgs'];
const DATA_NODES = ['tenants', 'members', 'contracts', 'product-catalog', 'ecosystem-catalog', 'ecosystem-resources', 'product-orgs', 'product-record', 'product-rights', 'metrics', 'deploys-list', 'deploys-status'];

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
 $('context-select').replaceChildren(option('', 'TZOLKIN · Gestão geral'));
 $('workspace').hidden = true; $('login').hidden = false;
 $('password').type = 'password'; $('password').value = '';
 $('show-password').textContent = 'Mostrar'; $('show-password').setAttribute('aria-pressed', 'false');
}

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
 $('nav').replaceChildren(...Object.entries(context.views).map(([key, view]) => {
  const button = node('button', undefined, 'nav-item' + (key === state.view ? ' active' : ''));
  button.type = 'button'; button.dataset.view = key;
  button.append(node('span', view.icon, 'nav-icon'), document.createTextNode(view.title));
  if (key === state.view) button.setAttribute('aria-current', 'page');
  button.onclick = () => switchView(key);
  return button;
 }));
}

function switchView(view) {
 state.view = view;
 const active = views()[view];
 SECTIONS.forEach(id => { $(id).hidden = $(id).id !== active.section; });
 $('breadcrumb').textContent = $('page-title').textContent = active.title;
 $('new-record').hidden = !active.action;
 // Métrica de carteira não diz nada numa tela de ecossistema ou de deploy.
 $('metrics').hidden = active.metrics === false || !$('metrics').children.length;
 if (active.action) $('new-record-label').textContent = active.action[0];
 $('notice').textContent = '';
 renderNav();
}

function renderContextChrome() {
 const product = contextKind() === 'product';
 $('crumb-context').textContent = product ? `TZOLKIN · ${productName()}` : 'TZOLKIN';
 $('eyebrow').textContent = product ? `PRODUTO · ${String(productName()).toUpperCase()}` : 'TZOLKIN CORE';
 document.body.dataset.context = product ? 'product' : 'general';
}

async function switchContext(contextId) {
 state.context = contextId;
 state.overview = contextId ? state.overview : null;
 state.product = null;
 state.view = Object.keys(views())[contextId ? 0 : 1];
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

function renderEcosystem(entries) {
 $('ecosystem-catalog').replaceChildren(); $('ecosystem-resources').replaceChildren();
 for (const entry of entries) {
  const item = entry.payload;
  if (entry.kind === 'resource') { $('ecosystem-resources').append(catalogLink(item.name + ' ↗', item.url, 'resource-link')); continue; }
  const card = node('article', undefined, 'ecosystem-card');
  const header = node('header');
  header.append(node('span', item.category, 'ecosystem-category'), node('span', item.status, 'status'));
  const links = node('div', undefined, 'catalog-links');
  if (item.url) links.append(catalogLink('Abrir endereço ↗', item.url));
  links.append(catalogLink('Ficha no Notion ↗', item.source));
  card.append(header, node('h3', item.name), node('p', item.description), node('small', item.note), links);
  $('ecosystem-catalog').append(card);
 }
}

function renderTenants() {
 const overview = state.overview;
 if (!overview) return;
 const query = $('client-search').value.trim().toLocaleLowerCase('pt-BR');
 const tenants = overview.tenants.filter(t => (t.name + ' ' + t.slug).toLocaleLowerCase('pt-BR').includes(query));
 $('tenants').replaceChildren();
 $('clients-empty').hidden = overview.tenants.length > 0;
 $('search-empty').hidden = !overview.tenants.length || tenants.length > 0;
 for (const tenant of tenants) {
  const row = node('tr');
  const title = node('td');
  title.append(node('div', tenant.name, 'client-name'), node('div', tenant.slug, 'client-slug'));
  const status = node('td');
  status.append(node('span', tenant.status === 'active' ? 'Ativo' : 'Suspenso', 'status' + (tenant.status === 'active' ? ' active' : '')));
  const action = node('td');
  const button = node('button', tenant.status === 'active' ? 'Suspender' : 'Reativar', 'table-action');
  button.type = 'button';
  button.setAttribute('aria-label', button.textContent + ' ' + tenant.name);
  button.onclick = async () => {
   button.disabled = true;
   try {
    await api('/api/tenants', 'PUT', { tenant_id: tenant.id, status: tenant.status === 'active' ? 'suspended' : 'active' });
    await load(); $('notice').textContent = 'Status do cliente atualizado.';
   } catch (error) { $('notice').textContent = error.message; } finally { button.disabled = false; }
  };
  action.append(button);
  row.append(title, status,
   node('td', overview.entitlements.filter(e => e.tenant_id === tenant.id && e.active).length),
   node('td', overview.memberships.filter(m => m.tenant_id === tenant.id && m.active).length), action);
  $('tenants').append(row);
 }
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
  ['Clientes', overview.tenants.length],
  ['Contratos de produto', overview.entitlements.filter(e => e.active).length],
  ['Vínculos de acesso', overview.memberships.filter(m => m.active).length],
 ]);
 fillDirectorySelects();
 renderTenants();
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

function linhaDeploy(deploy, principal) {
 const linha = node('div', undefined, 'deploy-row' + (principal ? ' principal' : ''));
 const esquerda = node('div');
 const chip = node('span', deploy.state_label, 'status' + (ESTADO_CLASSE[deploy.state] || ''));
 const cabecalho = node('div', undefined, 'deploy-head');
 cabecalho.append(chip);
 if (deploy.target) cabecalho.append(node('span', deploy.target, 'deploy-target'));
 esquerda.append(cabecalho);

 const detalhe = [deploy.branch, deploy.commit, deploy.author].filter(Boolean).join(' · ');
 if (detalhe) esquerda.append(node('span', detalhe, 'detail'));
 if (deploy.commit_message) esquerda.append(node('span', deploy.commit_message, 'deploy-message'));
 if (deploy.error_message) esquerda.append(node('span', deploy.error_message, 'deploy-error'));

 const direita = node('div', undefined, 'deploy-links');
 direita.append(node('span', quando(deploy.created_at), 'detail'));
 if (deploy.url) direita.append(catalogLink('Abrir ↗', deploy.url));
 if (deploy.inspector_url) direita.append(catalogLink('Inspecionar ↗', deploy.inspector_url));
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
  card.append(node('h3', project.name));
  for (const service of project.services) card.append(node('p', `${service.name} · ${service.type}`, 'detail'));
  if (!project.services.length) card.append(node('p', 'Nenhum serviço cadastrado.', 'empty-list'));
  target.append(card);
 }
}

function renderDeploys(data) {
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
  $('deploys-list').append(estadoVazio('◇', 'Nenhum provedor de deploy configurado.',
   'Defina VERCEL_TOKEN no ambiente do servidor e reinicie o Core. A credencial nunca chega ao navegador.'));
  return;
 }
 if (!data.projects.length) {
  $('deploys-list').append(estadoVazio('◇', 'Nenhum deploy recente.',
   'O provedor respondeu, mas não há deploys no alcance desta credencial.'));
  return;
 }
 for (const projeto of data.projects) {
  const card = node('article', undefined, 'deploy-card');
  const topo = node('header');
  const identidade = node('div', undefined, 'deploy-head');
  identidade.append(node('h3', projeto.project || 'Projeto sem nome'));
  // Sem repositório não há commit, não há rollback por commit e não dá para criar Deploy Hook.
  if (projeto.git_connected === false) identidade.append(node('span', 'sem repositório', 'status'));
  topo.append(identidade, node('span', projeto.provider, 'ecosystem-category'));
  card.append(topo);

  if (!projeto.deployments.length) {
   card.append(node('p', projeto.partial
    ? 'Não foi possível ler os deploys deste projeto agora.'
    : 'Nenhum deploy recente.', 'empty-list'));
  } else {
   const [atual, ...anteriores] = projeto.deployments;
   card.append(linhaDeploy(atual, true));
   for (const anterior of anteriores.slice(0, 3)) card.append(linhaDeploy(anterior, false));
  }
  $('deploys-list').append(card);
 }
}

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
  renderEcosystem(catalog.entries);
  renderGeneral();
  // Provedor externo pode estar fora do ar: o painel não pode cair junto.
  await api('/api/deploys').then(renderDeploys).catch(error => {
   $('deploys-status').replaceChildren(node('p', error.message, 'security-banner'));
  });
  $('easypanel-inventory').replaceChildren(node('p', 'Consultando EasyPanel…', 'empty-list'));
  await api('/api/infrastructure/easypanel').then(renderEasypanel).catch(() => {
   $('easypanel-inventory').replaceChildren(node('p', 'Não foi possível consultar o EasyPanel.', 'empty-list'));
  });
 } else {
  state.product = await api(`/api/products/${encodeURIComponent(state.context)}/console`);
  $('login').hidden = true; $('workspace').hidden = false;
  renderProduct();
 }
 renderContextChrome();
 await renderSecurityBanner();
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
bindForm('member-form', body => api('/api/memberships', 'PUT', { ...body, active: body.active === 'true' }));
bindForm('entitlement-form', body => api('/api/entitlements', 'PUT', {
 ...body, active: body.active === 'true',
 rights: body.rights.split(',').map(right => right.trim()).filter(Boolean),
}));

document.querySelectorAll('[data-open]').forEach(button => { button.onclick = () => openDialog(button.dataset.open); });
document.querySelectorAll('[data-close]').forEach(button => { button.onclick = () => button.closest('dialog').close(); });
$('new-record').onclick = () => openDialog(views()[state.view].action[1]);
$('context-select').addEventListener('change', event => switchContext(event.target.value).catch(reportError));
$('client-search').addEventListener('input', renderTenants);
$('org-search').addEventListener('input', () => { if (state.product) renderProductOrganizations(); });
$('show-password').onclick = () => {
 const show = $('password').type === 'password';
 $('password').type = show ? 'text' : 'password';
 $('show-password').textContent = show ? 'Ocultar' : 'Mostrar';
 $('show-password').setAttribute('aria-pressed', String(show));
};
$('refresh').onclick = async () => {
 $('refresh').disabled = true;
 try { await load(); $('notice').textContent = 'Atualizado.'; }
 catch (error) { reportError(error); } finally { $('refresh').disabled = false; }
};
$('logout').onclick = async () => {
 try { await api('/api/logout', 'POST', {}); signedOut(); $('login-notice').textContent = ''; }
 catch (error) { $('notice').textContent = error.message; }
};

renderNav();
switchView(state.view);
renderContextChrome();
load().catch(error => { if (error.message !== 'Entre para continuar.') $('login-notice').textContent = error.message; });
