import {tableKey,tableEdges,diagramLayout,resourceId,suggestProducts} from './database-model.js';
const el=(tag,text,cls)=>{const n=document.createElement(tag);if(text!==undefined)n.textContent=text;if(cls)n.className=cls;return n;};
const button=(text,action,cls='dbx-button')=>{const n=el('button',text,cls);n.type='button';n.onclick=action;return n;};
const svg=(tag,attrs)=>{const n=document.createElementNS('http://www.w3.org/2000/svg',tag);for(const [k,v]of Object.entries(attrs))n.setAttribute(k,v);return n;};
const option=(value,label)=>{const n=el('option',label);n.value=value;return n;};
const controllers=new WeakMap();

export function renderDatabaseWorkspace(root,options){
 const existing=controllers.get(root);
 if(existing?.shell.isConnected){existing.update(options);return;}
 let context=options,databases=[],database='',tables=[],active=null,mode='columns',query='',schema='',offset=0,filterColumn='',filterValue='',sort='',direction='asc',zoom=1,request=0,disposed=false,loading=false;
 const shell=el('section',undefined,'dbx-workspace');shell.setAttribute('aria-label','Explorador de bancos de dados');
 const navigator=el('aside',undefined,'dbx-navigator'),main=el('section',undefined,'dbx-main');
 const status=el('div','Conectando…','dbx-status');status.setAttribute('role','status');
 shell.append(navigator,main,status);root.replaceChildren(shell);
 controllers.set(root,{shell,update(next){context=next;if(mode==='bindings')renderEditor();},dispose(){disposed=true;request++;}});
 const api=(path,method,body)=>context.api(path,method,body);
 const notice=(message,kind='')=>el('p',message,'dbx-notice '+kind);
 const setStatus=message=>status.textContent=message;
 const currentDatabase=()=>databases.find(d=>d.name===database);
 const params=extra=>new URLSearchParams({database,...extra});
 const resetRows=()=>{offset=0;filterColumn='';filterValue='';sort='';direction='asc';};
 const selectTable=table=>{active=table;resetRows();renderNavigatorList();renderEditor();};
 const selectDatabase=async name=>{
  database=name;active=null;tables=[];schema='';resetRows();loading=true;const version=++request;
  renderNavigator();main.replaceChildren(notice('Consultando schemas e tabelas…'));setStatus('Consultando '+name);
  try{const result=await api('/api/management/schema?'+params({}));if(version!==request||disposed||!shell.isConnected)return;
   tables=result.tables||[];schema=tables.some(t=>t.schema==='public')?'public':tables[0]?.schema||'';active=tables.find(t=>t.schema===schema)||null;
   loading=false;renderNavigator();renderEditor();setStatus(`${tables.length} tabelas · ${new Set(tables.map(t=>t.schema)).size} schemas · PostgreSQL`);
  }catch(error){if(version!==request)return;loading=false;main.replaceChildren(notice(error.message,'error'),button('Tentar novamente',()=>selectDatabase(name)));setStatus('Conexão indisponível');}
 };
 const reload=async()=>{
  const previous=database;
  try{const result=await api('/api/management/databases');databases=result.databases;await selectDatabase(databases.some(d=>d.name===previous)?previous:databases.find(d=>d.current)?.name||databases[0]?.name||'');}
  catch(error){main.replaceChildren(notice(error.message,'error'),button('Tentar novamente',reload));setStatus('Não foi possível consultar os bancos.');}
 };
 function renderNavigator(){
  const head=el('header',undefined,'dbx-nav-head');head.append(el('strong','Database Navigator'),button('↻',reload,'dbx-icon-button'));head.lastChild.setAttribute('aria-label','Atualizar bancos e schemas');
  const dbSelect=el('select');dbSelect.setAttribute('aria-label','Banco de dados');
  databases.forEach(d=>{const o=option(d.name,d.name+(d.current?' · Core':'')+(!d.accessible?' · sem acesso':''));o.disabled=!d.accessible;dbSelect.append(o);});dbSelect.value=database;dbSelect.onchange=()=>selectDatabase(dbSelect.value);
  const connection=el('div',undefined,'dbx-connection');connection.append(el('span','PostgreSQL','dbx-engine'),dbSelect);
  const search=el('input');search.type='search';search.placeholder='Buscar tabela…';search.value=query;search.setAttribute('aria-label','Buscar tabela');search.oninput=()=>{query=search.value;renderNavigatorList();};
  const selectors=el('div',undefined,'dbx-selectors');selectors.append(connection,search);
  const list=el('div',undefined,'dbx-table-list');list.setAttribute('aria-label','Tabelas do schema');
  const footer=el('div',undefined,'dbx-nav-footer');footer.append(button('Vínculos e classificação',()=>{mode='bindings';renderEditor();}));
  navigator.replaceChildren(head,selectors,list,footer);renderNavigatorList();
 }
 function renderNavigatorList(){
  const list=navigator.querySelector('.dbx-table-list');if(!list)return;
  const term=query.trim().toLowerCase(),groups=new Map();
  tables.filter(t=>t.name.toLowerCase().includes(term)).forEach(table=>{if(!groups.has(table.schema))groups.set(table.schema,[]);groups.get(table.schema).push(table);});
  if(!groups.size){list.replaceChildren(notice(loading?'Carregando…':'Nenhuma tabela encontrada.'));return;}
  list.replaceChildren(...[...groups.entries()].map(([name,items])=>{
   const group=el('div',undefined,'dbx-tree-group'),head=button('',()=>{schema=name;renderNavigatorList();},'dbx-schema-item'+(schema===name?' active':''));head.setAttribute('aria-expanded',schema===name?'true':'false');head.append(el('span',schema===name?'⌄':'›','dbx-tree-chevron'),el('span','◇','dbx-schema-icon'),el('strong',name),el('small',`${items.length} tabelas`));
   const children=el('div',undefined,'dbx-schema-children');children.hidden=schema!==name;
   children.append(...items.map(table=>{const b=button('',()=>selectTable(table),'dbx-table-item'+(active&&tableKey(active)===tableKey(table)?' active':''));b.setAttribute('aria-current',active&&tableKey(active)===tableKey(table)?'true':'false');b.title=table.schema+'.'+table.name;b.append(el('span',table.kind==='VIEW'?'◫':'▦','dbx-table-icon'),el('span',table.name),el('small',String(table.columns.length)));return b;}));group.append(head,children);return group;
  }));
 }
 function renderEditor(){
  request++;
  const toolbar=el('header',undefined,'dbx-editor-head'),identity=el('div',undefined,'dbx-identity');
  identity.append(el('span',database+(active?' / '+active.schema:''),'dbx-path'),el('strong',active?.name||'Banco de dados'));
  const tabs=el('nav',undefined,'dbx-tabs');tabs.setAttribute('aria-label','Visualização da tabela');
  for(const [key,label]of [['columns','Estrutura'],['data','Dados'],['diagram','Relações'],['bindings','Vínculos']]){const b=button(label,()=>{mode=key;renderEditor();},mode===key?'active':'');b.setAttribute('aria-current',mode===key?'page':'false');tabs.append(b);}
  toolbar.append(identity,tabs);const body=el('div',undefined,'dbx-body');main.replaceChildren(toolbar,body);
  if(mode==='bindings'){renderBindings(body);return;}
  if(!active){body.append(notice('Este banco não possui tabelas visíveis para a credencial atual.'));return;}
  if(mode==='columns')renderColumns(body);
  if(mode==='diagram')renderDiagram(body);
  if(mode==='data')renderData(body);
 }
 function renderColumns(body){
  const summary=el('div',undefined,'dbx-toolbar');summary.append(el('span',`${active.columns.length} colunas`),el('span',`${tableEdges(tables).filter(e=>e.source===active||e.target===active).length} relações`),el('span',active.kind==='VIEW'?'View':'Tabela','dbx-muted'));
  const table=el('table',undefined,'dbx-grid'),head=el('thead'),tr=el('tr');
  for(const text of ['Coluna','Tipo','Chave','Nulo']){const th=el('th',text);th.scope='col';tr.append(th);}head.append(tr);
  const tbody=el('tbody');for(const c of active.columns){const row=el('tr'),name=el('td',c.name,'dbx-mono'),keys=el('td');
   if(c.primary_key)keys.append(el('span','PK','dbx-key'));
   for(const edge of tableEdges(tables).filter(e=>e.source===active&&e.column===c.name)){const b=button('↗ '+edge.target.name,()=>{schema=edge.target.schema;selectTable(edge.target);renderNavigator();},'dbx-relation-link');b.title=`${edge.target.schema}.${edge.target.name}.${edge.foreign_column}`;keys.append(b);}
   if(!keys.children.length)keys.textContent='—';row.append(name,el('td',c.type,'dbx-mono dbx-muted'),keys,el('td',c.nullable?'Permitido':'Não'));tbody.append(row);
  }
  table.append(head,tbody);const scroll=el('div',undefined,'dbx-grid-scroll');scroll.append(table);body.append(summary,scroll);
 }
 async function renderData(body){
  if(!active.readable){body.append(notice('Esta tabela está disponível para consulta de estrutura e relações. O conteúdo não é exposto no explorador.'));return;}
  const token=request,selected=active;
  const filter=el('form',undefined,'dbx-toolbar dbx-filter'),column=el('select');column.setAttribute('aria-label','Coluna de filtro');column.append(option('','Sem filtro'));
  active.columns.filter(c=>!c.masked).forEach(c=>column.append(option(c.name,c.name)));column.value=filterColumn;
  const value=el('input');value.placeholder='Valor exato';value.value=filterValue;value.maxLength=200;value.setAttribute('aria-label','Valor do filtro');
  const apply=button('Filtrar',()=>{});apply.type='submit';const clear=button('Limpar',()=>{resetRows();renderEditor();});
  filter.append(column,value,apply,clear);filter.onsubmit=event=>{event.preventDefault();filterColumn=column.value;filterValue=value.value;offset=0;renderEditor();};
  const resultRoot=el('div',undefined,'dbx-data-result');resultRoot.append(notice('Carregando registros…'));body.append(filter,resultRoot);
  try{const data=await api('/api/management/rows?'+params({schema:selected.schema,table:selected.name,limit:'50',offset:String(offset),...(filterColumn?{column:filterColumn,value:filterValue}:{}),...(sort?{sort,direction}:{})}));
   if(token!==request||disposed||!shell.isConnected)return;
   const table=el('table',undefined,'dbx-grid dbx-data-grid'),head=el('thead'),tr=el('tr');
   data.columns.forEach(c=>{const th=el('th');th.scope='col';const label=c.name+(c.masked?' · protegido':sort===c.name?(direction==='asc'?' ↑':' ↓'):'');
    if(c.masked)th.textContent=label;else th.append(button(label,()=>{direction=sort===c.name&&direction==='asc'?'desc':'asc';sort=c.name;offset=0;renderEditor();},'dbx-sort'));tr.append(th);});head.append(tr);
   const tbody=el('tbody');for(const row of data.rows){const r=el('tr');for(const c of data.columns){const v=row[c.name],cell=el('td',c.masked?'••••':v===null?'NULL':String(v),'dbx-data-cell'+(c.masked||v===null?' dbx-muted':''));if(!c.masked&&v!==null)cell.title=String(v);r.append(cell);}tbody.append(r);}table.append(head,tbody);
   const scroll=el('div',undefined,'dbx-grid-scroll');scroll.append(table);const pager=el('footer',undefined,'dbx-pager');
   const prev=button('← Anterior',()=>{offset=Math.max(0,offset-50);renderEditor();});prev.disabled=offset===0;
   const next=button('Próxima →',()=>{offset+=50;renderEditor();});next.disabled=!data.has_more||offset>=100000;
   pager.append(el('span',data.rows.length?`${offset+1}–${offset+data.rows.length} registros`:'Nenhum registro encontrado'),prev,next);
   resultRoot.replaceChildren(scroll,pager);if(!data.ordered)resultRoot.append(notice('Tabela sem chave primária: a ordem pode variar entre consultas.'));
   setStatus('Leitura · até 50 registros por página · valores longos limitados a 1.000 caracteres');
  }catch(error){if(token===request)resultRoot.replaceChildren(notice(error.message,'error'),button('Tentar novamente',()=>renderEditor()));}
 }
 function renderDiagram(body){
  const layout=diagramLayout(tables,active),controls=el('div',undefined,'dbx-toolbar');
  const canvas=el('div',undefined,'dbx-canvas'),frame=el('div',undefined,'dbx-frame'),stage=el('div',undefined,'dbx-stage');
  stage.style.width=layout.width+'px';stage.style.height=layout.height+'px';
  const zoomLabel=el('span');const updateZoom=()=>{stage.style.transform=`scale(${zoom})`;frame.style.width=layout.width*zoom+'px';frame.style.height=layout.height*zoom+'px';zoomLabel.textContent=Math.round(zoom*100)+'%';};
  controls.append(el('span',`${layout.nodes.length} tabelas · ${layout.edges.length} relações`),button('−',()=>{zoom=Math.max(.5,zoom-.1);updateZoom();}),zoomLabel,button('+',()=>{zoom=Math.min(1.5,zoom+.1);updateZoom();}),button('100%',()=>{zoom=1;updateZoom();}),button('Ajustar',()=>{zoom=Math.max(.5,Math.min(1,(canvas.clientWidth-40)/layout.width,(canvas.clientHeight-40)/layout.height));updateZoom();}));
  const paths=svg('svg',{width:layout.width,height:layout.height,class:'dbx-links'}),nodes=new Map(layout.nodes.map(n=>[tableKey(n.table),n]));
  for(const edge of layout.edges){const a=nodes.get(tableKey(edge.source)),b=nodes.get(tableKey(edge.target));const forward=a.x<b.x;
   const ax=a.x+(forward?280:0),bx=b.x+(forward?0:280),ay=a.y+49+Math.max(0,a.table.columns.findIndex(c=>c.name===edge.column))*25,by=b.y+49+Math.max(0,b.table.columns.findIndex(c=>c.name===edge.foreign_column))*25;
   const path=svg('path',{d:a===b?`M${a.x+280},${ay} C${a.x+330},${ay} ${a.x+330},${by+20} ${a.x+280},${by}`:`M${ax},${ay} C${(ax+bx)/2},${ay} ${(ax+bx)/2},${by} ${bx},${by}`});
   const title=svg('title',{});title.textContent=`${edge.source.schema}.${edge.source.name}.${edge.column} → ${edge.target.schema}.${edge.target.name}.${edge.foreign_column}`;path.append(title);paths.append(path,svg('circle',{cx:bx,cy:by,r:3}));
  }
  stage.append(paths);
  for(const n of layout.nodes){const card=el('article',undefined,'dbx-entity'+(n.table===active?' selected':''));card.style.left=n.x+'px';card.style.top=n.y+'px';card.style.height=n.height+'px';
   card.append(button(n.table.schema+'.'+n.table.name,()=>{schema=n.table.schema;selectTable(n.table);renderNavigator();},'dbx-entity-head'));
   for(const c of n.table.columns){const field=el('div',undefined,'dbx-entity-field');field.append(el('span',c.primary_key?'PK':n.table.relations.some(r=>r.column===c.name)?'FK':'','dbx-key'),el('strong',c.name),el('small',c.type));card.append(field);}stage.append(card);
  }
  frame.append(stage);canvas.append(frame);body.append(controls,canvas);updateZoom();
  if(!layout.edges.length)setStatus('Nenhuma chave estrangeira declarada para esta tabela.');else setStatus('Relações declaradas no PostgreSQL · selecione uma tabela para mudar o foco');
 }
 function renderBindings(body){
  const wrapper=el('div',undefined,'dbx-bindings');body.append(wrapper);
  wrapper.append(el('h2','Classificação do banco'),el('p','Confirme a qual produto este banco, schema ou tabela pertence. O vínculo também aparece nas conexões do produto.','dbx-muted'));
  const scope=el('select');scope.setAttribute('aria-label','Escopo do vínculo');scope.append(option('database','Banco inteiro'));if(schema)scope.append(option('schema','Schema '+schema));if(active)scope.append(option('table','Tabela '+active.name));
  const content=el('div');wrapper.append(scope,content);
  const show=()=>{
   const id=resourceId(database,scope.value!=='database'?schema:undefined,scope.value==='table'?active?.name:undefined),binding=(context.bindings||[]).find(b=>b.resource_type==='database'&&b.provider==='manual'&&b.external_id===id);
   const products=context.products||[],suggestions=suggestProducts(products,[database,...(scope.value!=='database'?[schema]:[]),...(scope.value==='table'?[active.name]:[])]);
   content.replaceChildren();
   const productSelect=el('select');productSelect.setAttribute('aria-label','Produto responsável');productSelect.append(option('','Selecione o produto'));products.forEach(p=>productSelect.append(option(p.id,p.name)));productSelect.value=binding?.product_id||'';
   const environment=el('select');environment.setAttribute('aria-label','Ambiente');for(const [value,label]of [['','Ambiente não definido'],['production','Produção'],['staging','Homologação'],['development','Desenvolvimento'],['internal','Interno']])environment.append(option(value,label));environment.value=binding?.environment||'';
   const evidence=el('div',undefined,'dbx-suggestions');
   if(binding){evidence.append(el('span','Confirmado','dbx-confirmed'),button('Abrir produto ↗',()=>context.openProduct(binding.product_id),'dbx-relation-link'));}
   else if(suggestions.length){evidence.append(el('p','Sugestões pelo nome — aguardam sua confirmação.'));for(const s of suggestions){const b=button(s.product.name+' · '+s.evidence.join(', '),()=>{productSelect.value=s.product.id;},'dbx-suggestion');evidence.append(b);}}
   else evidence.append(notice('Sem correspondência pelo nome. Escolha o produto para catalogar.'));
   const form=el('form',undefined,'dbx-binding-form'),message=el('p',undefined,'dbx-muted');message.setAttribute('role','status');
   const save=button(binding?'Salvar vínculo':'Confirmar vínculo',()=>{});save.type='submit';
   const label=scope.value==='database'?database:scope.value==='schema'?database+' / '+schema:database+' / '+schema+' / '+active.name;
   form.append(el('code',label),evidence,productSelect,environment,save,message);productSelect.required=true;
   form.onsubmit=async event=>{event.preventDefault();save.disabled=true;message.textContent='Salvando…';try{
    await api('/api/product-resource-bindings','PUT',{...(binding?{id:binding.id}:{}),product_id:productSelect.value,resource_type:'database',provider:'manual',external_id:id,display_name:label,environment:environment.value||null,url:null});
    const result=await api('/api/product-resource-bindings');context.bindings=result.bindings;await context.onBindingsChange(result.bindings);show();setStatus('Vínculo salvo no catálogo e no produto.');
   }catch(error){message.textContent=error.message;save.disabled=false;}};
   content.append(form);
   const inherited=(context.bindings||[]).filter(b=>b.resource_type==='database'&&b.provider==='manual'&&b.external_id.startsWith(resourceId(database))&&b.external_id!==id);
   if(inherited.length){content.append(el('h3','Outros vínculos deste banco'));for(const b of inherited){const row=el('div',undefined,'dbx-binding-row');row.append(el('span',b.display_name),button(products.find(p=>p.id===b.product_id)?.name||b.product_id,()=>context.openProduct(b.product_id),'dbx-relation-link'));content.append(row);}}
  };scope.onchange=show;show();
 }
 reload();
}
