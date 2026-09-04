import {createIcon,providerLogo} from './icons.js';
import {summarizeProject} from './card-summary.js';
export const deliveryIcon=createIcon;
export function automaticSettings({snapshot,repository,isNew,bindingCount,dirty = []}) {
 if (!isNew || bindingCount !== 1 || snapshot.status !== 'ok' || !repository || repository.toLowerCase() !== snapshot.repository?.toLowerCase()) return [];
 return Object.entries(snapshot.fields).filter(([key,field]) => ['path','stack','runtime','build','output','branch'].includes(key) && field.state === 'value' && !dirty.includes(key));
}
export function compareSettings(fields, current) {
 return Object.entries(fields).map(([key, remote]) => ({key,...remote,
  current:current[key] ?? '',different:remote.state === 'value' && String(current[key] ?? '') !== String(remote.value)}));
}
export function setupDelivery({ api,openResource }) {
 const $ = id => document.getElementById(id);
 const el = (tag, value, cls) => { const n = document.createElement(tag); if (value != null) n.textContent = value; if (cls) n.className = cls; return n; };
 const button = (label, action, cls = 'secondary', icon) => { const b = el('button', null, cls); if(icon) b.append(deliveryIcon(icon)); b.append(document.createTextNode(label)); b.type = 'button'; b.onclick = action; return b; };
 const form = $('delivery-form'), dialog = $('delivery-dialog');
 const kinds = { frontend:'Website', api:'API', worker:'Worker', library:'Biblioteca', database:'Banco', cache:'Cache' };
 const environments = { development:'Desenvolvimento', staging:'Homologação', production:'Produção' };
 let options, editing, rows = [], projects = [], generation = 0, step = 0;
 const stepIds = ['project','components','review'];
 function showStep(index, focus = true) {
  if(index === 2 && rows.some(row => row.bindings.some(b => b.pending))) { $('delivery-error').textContent='Aguarde a detecção terminar antes de revisar.'; return; }
  $('delivery-error').textContent='';
  step = index;
  stepIds.forEach((id,i) => { $('delivery-step-' + id).hidden = i !== step; });
  $('delivery-steps').replaceChildren(...['Projeto','Serviços','Revisão'].map((label,i) => {
   const b = button(label,() => showStep(i),'delivery-step-button' + (i === step ? ' selected' : ''),['repo','layers','check'][i]);
   if(i === step) b.setAttribute('aria-current','step'); return b;
  }));
  $('delivery-back').hidden = step === 0; $('delivery-next').hidden = step === 2; $('delivery-save').hidden = step !== 2;
  if(step === 2) renderReview();
  if(focus) { const panel=$('delivery-step-' + stepIds[step]); panel.tabIndex=-1; panel.focus(); dialog.scrollTop=0; }
 }
 function repoBanner() {
  const repo = options.github.items.find(r => r.id === $('delivery-repo').value);
  const previous=$('delivery-repo').value && $('delivery-repo').value === editing?.repository_id ? editing.repository_name : null;
  $('delivery-selected-repo').replaceChildren(deliveryIcon('repo'),el('strong',repo?.name || previous || 'Rascunho sem repositório'));
  if(repo?.default_branch) $('delivery-selected-repo').append(el('span',`Branch padrão: ${repo.default_branch}`,'status'));
 }
 function renderReview() {
  const area=$('delivery-review'); area.replaceChildren();
  area.append(el('h3',form.elements.namedItem('name').value || 'Projeto sem nome'),el('p',$('delivery-selected-repo').querySelector('strong')?.textContent || 'Sem repositório','detail'));
  if(!form.elements.namedItem('owner').value) area.append(el('p','Responsável pendente. Pode salvar como rascunho.','delivery-issues'));
  if(!rows.length) area.append(el('p','Sem serviços. Pode adicionar depois.','delivery-issues'));
  for(const row of rows) {
   const c=readComponent(row), card=el('article',null,'delivery-review-card');
   const title=el('div',null,'delivery-heading'); title.append(deliveryIcon(c.kind),el('strong',c.name || kinds[c.kind]),el('span',c.stack === 'custom' ? 'Stack pendente' : c.stack,'status')); card.append(title,el('p',c.path,'detail'));
   for(const b of c.bindings) card.append(el('p',`${environments[b.environment]} · ${b.provider === 'vercel' ? 'Vercel' : 'EasyPanel'} · ${b.target_id || 'Destino pendente'} · ${b.branch || 'Branch pendente'}`,'detail'));
   if(!c.bindings.length) card.append(el('p',c.kind === 'library' ? 'Biblioteca compartilhada · sem deploy próprio' : 'Destino ainda não vinculado','detail'));
   area.append(card);
  }
  area.append(el('p','Publicação não verificada. Salvar registra esta configuração, não faz deploy.','delivery-callout'));
 }
 const field = (parent, label, value = '', values, required = false) => {
  const wrap = el('label', label), control = document.createElement(values ? 'select' : 'input');
  if (values) for (const [key, name] of values) { const option = el('option', name); option.value = key; control.append(option); }
  else control.maxLength = 300;
  control.value = value; control.required = required; wrap.append(control); parent.append(wrap); return control;
 };
 const readComponent = row => ({ ...Object.fromEntries(Object.entries(row.fields).map(([k,v]) => [k,v.value])),
  depends_on: row.dependencies.value.split(',').map(s => s.trim()).filter(Boolean),
  bindings: row.bindings.map(b => ({ environment:b.environment.value, provider:b.provider.value, target_id:b.target.value, branch:b.branch.value })) });
 function repositories(selected = $('delivery-repo').value) {
  const search = $('delivery-repo-search').value.toLowerCase();
  const repos = options.github.items.filter(r => !r.archived && (r.id === selected || r.name.toLowerCase().includes(search)));
  if (selected && !repos.some(r => r.id === selected)) repos.unshift({ id:selected, name:(editing?.repository_name || selected) + ' · vínculo anterior, não confirmado' });
  $('delivery-repo').replaceChildren();
  for (const r of [{ id:'', name:'Ainda não vinculado · rascunho' }, ...repos]) {
   const option = el('option', r.name); option.value = r.id; $('delivery-repo').append(option);
  }
  $('delivery-repo').value = selected;
 }
 function addBinding(row, initial = {}) {
  if (row.bindings.length >= 3) { $('delivery-error').textContent = 'Este serviço já possui os três ambientes disponíveis.'; return; }
  const block = el('div', null, 'delivery-binding');
  const environment = field(block, 'Ambiente', initial.environment || ['production','staging','development'].find(e => !row.bindings.some(b => b.environment.value === e)), Object.entries(environments));
  const provider = field(block, 'Plataforma', initial.provider || (['api','worker','database','cache'].includes(row.fields.kind.value) ? 'easypanel' : 'vercel'), [['vercel','Vercel'],['easypanel','EasyPanel']]);
  const target = field(block, 'Destino existente', '', [], true);
  const defaultBranch = options.github.items.find(r => r.id === $('delivery-repo').value)?.default_branch || '';
  const branch = field(block, 'Branch desejada', initial.branch ?? defaultBranch);
  branch.placeholder = 'Ex.: main (não altera a plataforma)';
  const sourceNote = el('p',!initial.branch && defaultBranch ? 'Branch sugerida pelo GitHub. Escolha um destino para detectar a configuração.' : 'Escolha um destino para consultar as configurações.','delivery-wide detail');
  let branchTouched = false;
  const inspection = el('details',null,'delivery-wide delivery-advanced'); inspection.append(el('summary','Valores detectados e diferenças'));
  const comparison = el('div',null,'delivery-wide delivery-comparison');
  inspection.append(comparison);
  comparison.setAttribute('aria-live','polite');
  let snapshot, requestVersion = 0;
  const invalidate = () => { requestVersion++; snapshot = null; binding.pending=false; comparison.replaceChildren(); consult.disabled = false; sourceNote.textContent='Destino alterado. Confira os valores do formulário; nenhuma plataforma foi alterada.'; };
  const render = () => {
   comparison.replaceChildren();
   if (!snapshot) return;
   if (snapshot.status !== 'ok') { comparison.append(el('p',snapshot.message)); return; }
   comparison.append(el('p',snapshot.scope,'detail'),el('p',`Consultado em ${new Date(snapshot.checked_at).toLocaleString('pt-BR')}. Não confirma publicação.`,'detail'));
   const selectedRepo = $('delivery-repo').value;
   const repository = options.github.items.find(r => r.id === selectedRepo)?.name || (selectedRepo && selectedRepo === editing?.repository_id ? editing.repository_name : null);
   comparison.append(el('p',`Repositório informado pela plataforma: ${snapshot.repository || 'não identificado'}.`,'detail'));
   if (snapshot.repository && (!repository || repository.toLowerCase() !== snapshot.repository.toLowerCase())) comparison.append(el('p','Confira o repositório: o vínculo do cadastro não foi confirmado como igual ao da plataforma. Importar não troca o repositório.','delivery-issues'));
   const table = el('table'); const header = el('tr');
   for (const label of ['Campo','No formulário','Na plataforma','Importar']) header.append(el('th',label));
   const thead = el('thead'); thead.append(header); table.append(thead);
   const tbody = el('tbody'), selections = [];
   const labels = {path:'Pasta',stack:'Stack',runtime:'Runtime',build:'Build',start:'Execução',output:'Saída',branch:'Branch'};
   const states = {automatic:'Automático · valor efetivo não consultado',unavailable:'Não disponível nesta consulta',restricted:'Omitido · comando fora dos formatos seguros'};
   for (const item of compareSettings(snapshot.fields,{...Object.fromEntries(Object.entries(row.fields).map(([k,v]) => [k,v.value])),branch:branch.value})) {
    if (!labels[item.key]) continue;
    const tr = el('tr'); tr.append(el('th',labels[item.key]),el('td',item.current || 'Não preenchido'),el('td',item.state === 'value' ? `${item.value}${item.different ? ' · diferente' : ' · igual'}` : states[item.state] || 'Não disponível'));
    const cell = el('td');
    if (item.different) { const check = document.createElement('input'); check.type = 'checkbox'; check.setAttribute('aria-label',`Importar ${labels[item.key]}`); cell.append(check); selections.push({check,item}); }
    else cell.textContent = '—';
    tr.append(cell); tbody.append(tr);
   }
   table.append(tbody); const scroll = el('div',null,'delivery-table-scroll'); scroll.append(table); comparison.append(scroll);
   const apply = button('Preencher selecionados no formulário', () => {
    const selected = selections.filter(s => s.check.checked);
    if (!selected.length) { feedback.textContent = 'Selecione pelo menos um campo diferente.'; return; }
    for (const {item} of selected) { (item.key === 'branch' ? branch : row.fields[item.key]).value = item.value; if(item.key === 'branch') branchTouched = true; else row.dirty.add(item.key); }
    row.refreshComparisons();
    comparison.append(el('p','Campos preenchidos. Revise e clique em Salvar para registrar no Core. Nenhuma plataforma foi alterada.','detail'));
   });
   const feedback = el('p',null,'detail');
   comparison.append(el('p','Pasta, stack e comandos pertencem ao componente e são compartilhados entre seus ambientes. A branch pertence somente a este vínculo.','detail'),apply,feedback);
  };
  const consult = button('Atualizar detecção', async () => {
   if (!target.value) { comparison.replaceChildren(el('p','Selecione um destino existente.')); return; }
   const version = ++requestVersion, context = generation;
   binding.pending=true; consult.disabled = true; sourceNote.textContent='Detectando configurações do destino…'; comparison.replaceChildren();
   try {
    const result = await api('/api/delivery/settings?' + new URLSearchParams({provider:provider.value,target_id:target.value,environment:environment.value}));
    if (version !== requestVersion || context !== generation || !block.isConnected) return;
    snapshot = result;
    const repository = options.github.items.find(r => r.id === $('delivery-repo').value)?.name;
    const changes = automaticSettings({snapshot,repository,isNew:!row.existing,bindingCount:row.bindings.length,dirty:[...row.dirty,...(branchTouched ? ['branch'] : [])]});
    for(const [key,detected] of changes) { (key === 'branch' ? branch : row.fields[key]).value=detected.value; if(key === 'branch') branchTouched=true; else row.dirty.add(key); }
    sourceNote.textContent=changes.length ? `${changes.length} campos preenchidos pela ${provider.value === 'vercel' ? 'Vercel' : 'EasyPanel'} · repositório confirmado. Revise antes de salvar.` : result.status === 'ok' ? 'Configuração consultada. Seus valores foram preservados; veja os detalhes para importar diferenças.' : result.message;
    row.refreshComparisons();
   } catch(error) { if (version === requestVersion && context === generation) { sourceNote.textContent=error.message; comparison.replaceChildren(el('p',error.message)); } }
   finally { if (version === requestVersion) { consult.disabled = false; binding.pending=false; } }
  },'quiet','settings');
  const refresh = () => {
   target.replaceChildren();
   const available = options[provider.value];
   const kind = row.fields.kind.value;
   const targets = available.items.filter(t => provider.value === 'vercel' ? !['worker','database','cache','library'].includes(kind) : kind === 'database' ? ['postgres','mysql','mariadb','mongo','mongodb'].includes(t.type) : kind === 'cache' ? t.type === 'redis' : ['app','compose','box','wordpress'].includes(t.type));
   if (initial.provider === provider.value && initial.target_id && !targets.some(t => t.id === initial.target_id)) targets.unshift({ id:initial.target_id, name:(initial.target_name || initial.target_id) + ' · não confirmado' });
   const blank = el('option', available.status === 'ok' ? 'Selecione o destino' : 'Plataforma indisponível ou não conectada'); blank.value = ''; target.append(blank);
   for (const item of targets) { const o = el('option', item.name + (item.type ? ` · ${item.type}` : '')); o.value = item.id; target.append(o); }
   if (initial.provider === provider.value) target.value = initial.target_id || '';
  };
  provider.onchange = () => { invalidate(); refresh(); }; refresh();
  target.onchange = () => { invalidate(); if(target.value) consult.click(); }; environment.onchange = () => { invalidate(); if(target.value) consult.click(); }; branch.oninput = () => { branchTouched=true; render(); };
  const binding = { environment, provider, target, branch, render, refresh, pending:false };
  block.append(button('Remover vínculo', () => { row.bindings = row.bindings.filter(b => b !== binding); block.remove(); }));
  block.append(consult,sourceNote,inspection);
  row.bindings.push(binding); row.bindingArea.append(block);
 }
 function addComponent(initial = {}) {
  if (rows.length >= 20) { $('delivery-error').textContent='Limite de 20 serviços por projeto.'; return; }
  const card = el('article', null, 'delivery-component');
  const head = el('div', null, 'delivery-heading');
  const kind = initial.kind || 'frontend';
  const mark = el('span',null,'delivery-mark'); mark.append(deliveryIcon(kind));
  const heading=el('h3',initial.name || kinds[kind]);
  const title=el('div',null,'delivery-heading'); title.append(mark,heading); head.append(title);
  const grid = el('div', null, 'delivery-fields');
  const advanced = el('details',null,'delivery-advanced'); const summary=el('summary','Configurações avançadas'); summary.prepend(deliveryIcon('settings')); advanced.append(summary);
  const advancedGrid = el('div',null,'delivery-fields');
  let nextId = rows.length + 1;
  while (rows.some(r => r.fields.id.value === `component-${nextId}`)) nextId++;
  const id = initial.id || `component-${nextId}`;
  const fields = {};
  fields.id = field(advancedGrid,'Identificador',id, null, true);
  fields.name = field(grid,'Nome do serviço',initial.name || kinds[kind], null, true);
  fields.kind = field(advancedGrid,'Função',kind,Object.entries(kinds));
  fields.path = field(grid,'Pasta no repositório',initial.path || '.',null,true);
  fields.path.placeholder='Ex.: apps/web';
  fields.stack = field(advancedGrid,'Stack',initial.stack || 'custom',options.stacks.map(s => [s.id,s.id === 'custom' ? 'Não definida / outra stack' : s.name]));
  fields.runtime = field(advancedGrid,'Runtime / versão',initial.runtime ?? '',null);
  fields.runtime.placeholder='Ex.: node 22.x';
  fields.manager = field(advancedGrid,'Gerenciador',initial.manager || 'none',['npm','pnpm','yarn','bun','uv','pip','none'].map(s => [s,s === 'none' ? 'Não definido / não se aplica' : s]));
  const dependencies = field(advancedGrid,'Depende dos componentes', (initial.depends_on || []).join(', '));
  dependencies.placeholder = 'Identificadores separados por vírgula';
  fields.stack.onchange = () => { const stack = options.stacks.find(s => s.id === fields.stack.value); fields.runtime.value = stack.runtime; fields.manager.value = stack.manager; };
  fields.name.oninput = () => { heading.textContent = fields.name.value || kinds[fields.kind.value]; };
  for (const [key,label] of [['build','Comando de build'],['start','Comando de execução'],['output','Pasta de saída'],['port','Porta']]) fields[key] = field(advancedGrid,label,initial[key] ?? '');
  fields.port.type = 'number'; fields.port.min = '1'; fields.port.max = '65535';
  advanced.append(advancedGrid);
  const bindingArea = el('div');
  const stackSummary=el('p',null,'delivery-config-summary');
  const row = { fields,dependencies,bindings:[],bindingArea,dirty:new Set(),existing:Boolean(editing?.components?.some(c => c.id === initial.id)) };
  row.refreshComparisons = () => { row.bindings.forEach(b => b.render()); stackSummary.textContent=fields.stack.value === 'custom' ? 'Stack ainda não definida · detecção ao selecionar um destino compatível' : `${options.stacks.find(s => s.id === fields.stack.value)?.name} · ${fields.runtime.value || 'runtime pendente'}`; };
  for (const [key,control] of Object.entries(fields)) control.addEventListener('input',() => { row.dirty.add(key); if(key === 'stack') { row.dirty.add('runtime'); row.dirty.add('manager'); } row.refreshComparisons(); });
  fields.stack.addEventListener('change',row.refreshComparisons);
  head.append(button('Remover componente', () => {
   if (!confirm('Remover este componente do formulário? Os serviços nas plataformas não serão alterados.')) return;
   rows = rows.filter(r => r !== row); card.remove();
  },'quiet','close'));
  const add = button('Vincular destino', () => addBinding(row),'secondary','cloud');
  fields.kind.onchange = () => { add.disabled = fields.kind.value === 'library'; mark.replaceChildren(deliveryIcon(fields.kind.value)); };
  fields.kind.onchange();
  card.append(head,grid,stackSummary,bindingArea,add,advanced);
  rows.push(row); $('delivery-components').append(card);
  for (const binding of initial.bindings || []) addBinding(row,binding);
  if(rows.filter(r => !['database','cache'].includes(r.fields.kind.value)).length > 1) form.elements.namedItem('layout').value='monorepo';
  row.refreshComparisons();
 }
 async function open(project, repo = null) {
  const token = ++generation;
  $('delivery-new').disabled = true; $('delivery-message').textContent = 'Consultando repositórios e destinos…';
  try {
   const result = await api('/api/delivery/options');
   if (token !== generation) return;
   options = result; editing = project; rows = []; form.reset();
   dialog.querySelectorAll('details').forEach(d => { d.open=false; });
   $('delivery-components').replaceChildren(); $('delivery-error').textContent = '';
   $('delivery-title').textContent = project ? 'Editar projeto' : 'Configurar projeto';
   for (const key of ['name','owner','layout']) if (project) form.elements.namedItem(key).value = project[key];
   if(repo) form.elements.namedItem('name').value=repo.name.split('/').at(-1);
   $('delivery-repo').replaceChildren(); repositories(project?.repository_id || repo?.id || ''); repoBanner();
   const labels = { ok:'conectado', not_configured:'não conectado no servidor', error:'consulta indisponível' };
   $('delivery-connections').textContent = ['github','vercel','easypanel'].map(p => `${p}: ${labels[options[p].status]}${options[p].truncated ? ' · lista parcial' : ''}`).join(' / ');
   for (const c of project?.components || []) addComponent(c);
   $('delivery-message').textContent = ''; showStep(0,false); dialog.showModal();
  } catch(error) { $('delivery-message').textContent = error.message; }
  finally { $('delivery-new').disabled = false; }
 }
 function renderRepositories() {
  const area=$('delivery-repositories'); area.replaceChildren();
  if(!options) return;
  const github=options.github;
  $('delivery-repo-count').textContent=github.status === 'ok' ? String(github.items.length) : 'Indisponível';
  if(github.status !== 'ok') { area.append(el('p',github.status === 'error' ? 'Não foi possível consultar o GitHub. Tente atualizar. Seus cadastros continuam abaixo.' : 'GitHub não conectado no servidor. Você pode criar um rascunho sem repositório.','empty-list')); return; }
  const search=$('delivery-repository-search').value.toLowerCase().trim();
  const repos=github.items.filter(r => r.name.toLowerCase().includes(search));
  if(!repos.length) area.append(el('p',search ? 'Nenhum repositório corresponde à busca.' : 'Nenhum repositório acessível nesta conta.','empty-list'));
  for(const repo of repos) {
   const project=projects.find(p => p.repository_id === repo.id), row=el('article',null,'delivery-repo-row');
   const mark=el('span',null,'delivery-mark'); mark.append(deliveryIcon('repo'));
   const body=el('div',null,'delivery-repo-body'); body.append(el('h4',repo.name),el('p',repo.archived ? 'Arquivado · somente leitura' : repo.default_branch ? `Branch padrão · ${repo.default_branch}` : 'Branch não informada','detail'));
   const action=button(project ? 'Abrir projeto' : 'Configurar',() => project ? open(project) : open(null,repo),project ? 'secondary' : 'primary','arrow');
   action.disabled=repo.archived && !project;
   row.append(mark,body,el('span',project ? 'Vinculado' : 'Não configurado','status'),action); area.append(row);
  }
  if(github.truncated) area.append(el('p','Lista parcial: o limite de consulta foi atingido.','detail'));
 }
 async function load() {
  const token = ++generation;
  $('delivery-message').textContent = 'Carregando cadastro…';
  const [data,available] = await Promise.all([api('/api/delivery/projects'),api('/api/delivery/options')]);
  if (token !== generation) return;
  options=available; projects=data.projects; renderRepositories();
  $('delivery-provider-status').replaceChildren(...['github','vercel','easypanel'].map(provider => {
   const status=available[provider].status, chip=el('span',null,'delivery-provider ' + (status === 'ok' ? 'connected' : ''));
   chip.append(providerLogo(provider),document.createTextNode(`${{github:'GitHub',vercel:'Vercel',easypanel:'EasyPanel'}[provider]} · ${status === 'ok' ? 'conectado' : status === 'error' ? 'indisponível' : 'não conectado'}`)); return chip;
  }));
  $('delivery-list').replaceChildren(); $('delivery-message').textContent = data.truncated ? 'Mostrando os 200 projetos mais recentes.' : '';
  if (!data.projects.length) { const empty=el('div',null,'delivery-empty'); empty.append(deliveryIcon('layers'),el('h3','Seu próximo projeto começa acima'),el('p','Escolha um repositório para configurar seus serviços.','detail')); $('delivery-list').append(empty); }
  for (const project of data.projects) {
   const card = el('article',null,'delivery-component project-card');
   const summary=summarizeProject(project);
   const head = el('div',null,'delivery-heading');
   const identity=el('div',null,'card-identity'),mark=el('span',null,'card-mark');mark.append(deliveryIcon('layers'));identity.append(mark,el('h3',project.name));
   head.append(identity,el('span',project.issues.length ? `${project.issues.length} pendências` : 'Cadastro completo','status'),button('Configurações',() => open(project),'secondary','settings'));
   const repo=el('p',null,'card-repository');repo.append(providerLogo('github'),document.createTextNode(project.repository_name || 'Repositório não vinculado'));
   const facts=el('dl',null,'card-facts');
   for(const [label,value,icon] of [['Serviços',summary.services,'server'],['Destinos',summary.targets,'cloud'],['Estrutura',project.layout==='monorepo'?'Monorepo':'Aplicação única','layers'],['Responsável pelo projeto',project.owner||'Não definido','people']]){const cell=el('div'),dt=el('dt');dt.append(deliveryIcon(icon),document.createTextNode(label));cell.append(dt,el('dd',String(value)));facts.append(cell);}
   card.append(head,repo,facts);
   const tags=el('div',null,'card-tags');for(const stack of summary.stacks)tags.append(el('span',stack,'status'));for(const env of summary.environments)tags.append(el('span',environments[env]||env,'status'));if(tags.childNodes.length)card.append(tags);
   const details=el('details',null,'card-services');details.append(el('summary',`Serviços e branches · ${summary.services}`));
   for (const c of project.components) {
    const service=el('div',null,'delivery-service-line'); service.append(deliveryIcon(c.kind),el('strong',c.name),el('span',c.stack === 'custom' ? 'Stack pendente' : c.stack,'status'),el('span',c.path,'detail'));
    for (const b of c.bindings){const target=button(`${environments[b.environment]} · ${b.target_name || b.target_id}`,()=>openResource(b.provider,b.target_id,b.environment),'delivery-target-chip');target.prepend(providerLogo(b.provider));service.append(target);const branch=el('span',null,'card-branch');branch.append(deliveryIcon('branch'),document.createTextNode(b.branch||'Branch não informada'));service.append(branch);}
    if(!c.bindings.length) service.append(el('span',c.kind === 'library' ? 'Sem deploy próprio' : 'Destino pendente','detail'));
    details.append(service);
   }
   card.append(details);
   if (project.issues.length) { const ul = el('ul',null,'delivery-issues'); for (const issue of project.issues) ul.append(el('li',issue)); card.append(ul); }
   const footer=el('div',null,'card-footer');footer.append(el('span',project.product_lifecycle_status === 'active' ? 'Produto ativo · publicação não verificada' : 'Cadastro técnico · produto em rascunho'));if(project.product_lifecycle_status === 'draft'){const activate=button('Ativar produto',async()=>{activate.disabled=true;try{await api('/api/delivery/projects/'+project.id+'/activate','POST',{revision:project.revision});await load();$('delivery-message').textContent='Produto ativado. A publicação continua sendo uma etapa separada.';}catch(error){$('delivery-message').textContent=error.message;activate.disabled=false;}},'secondary','check');footer.append(activate);}if(project.updated_at){const date=new Date(project.updated_at);if(!Number.isNaN(date.getTime()))footer.append(el('time','Atualizado '+date.toLocaleDateString('pt-BR')));}card.append(footer);
   $('delivery-list').append(card);
  }
 }
 form.onsubmit = async event => {
  event.preventDefault();
  if(step !== 2) { showStep(step+1); return; }
  const invalid=[...form.elements].find(control => control.willValidate && !control.validity.valid);
  if(invalid) {
   const panel=invalid.closest('.delivery-step'); showStep(panel?.id === 'delivery-step-project' ? 0 : 1);
   for(let parent=invalid.parentElement;parent && parent!==form;parent=parent.parentElement) if(parent.tagName === 'DETAILS') parent.open=true;
   invalid.reportValidity(); return;
  }
  $('delivery-save').disabled = true; $('delivery-error').textContent = '';
  try {
   const payload = { name:form.elements.namedItem('name').value,owner:form.elements.namedItem('owner').value,layout:form.elements.namedItem('layout').value,
    repository_id:$('delivery-repo').value || null,components:rows.map(readComponent),...(editing ? { revision:editing.revision } : {}) };
   await api('/api/delivery/projects' + (editing ? '/' + editing.id : ''),editing ? 'PUT' : 'POST',payload);
   dialog.close(); await load(); $('delivery-message').textContent = 'Cadastro salvo. Nenhum deploy foi disparado.';
  } catch(error) { $('delivery-error').textContent = error.message; }
  finally { $('delivery-save').disabled = false; }
 };
 $('delivery-new').onclick = () => open(null);
 $('delivery-close').onclick = () => dialog.close();
 $('delivery-next').onclick=() => showStep(Math.min(2,step+1));
 $('delivery-back').onclick=() => showStep(Math.max(0,step-1));
 const hints={frontend:'Interface e site',api:'Backend e endpoints',worker:'Tarefas em segundo plano',database:'Dados persistentes',cache:'Cache e filas',library:'Código compartilhado'};
 for(const [kind,label] of Object.entries(kinds)) {
  const add=button(label,() => addComponent({kind,...(['database','cache'].includes(kind) ? {stack:kind === 'database' ? 'postgres' : 'redis',runtime:'managed',manager:'none'} : {})}),'delivery-kind-button',kind);
  add.append(el('small',hints[kind])); $('delivery-kind-picker').append(add);
 }
 $('delivery-repository-search').oninput=renderRepositories;
 $('delivery-repo-search').oninput = () => { if (options) repositories(); };
 $('delivery-repo').onchange = () => { repoBanner(); rows.forEach(row => { for(const key of ['path','stack','runtime','build','output']) row.dirty.add(key); row.refreshComparisons(); }); };
 return { load, clear() { generation++; options = null; editing = null; rows = []; projects=[]; for(const id of ['delivery-list','delivery-components','delivery-repositories','delivery-provider-status','delivery-review','delivery-selected-repo']) $(id).replaceChildren(); $('delivery-repo-count').textContent=''; $('delivery-message').textContent = ''; } };
}
