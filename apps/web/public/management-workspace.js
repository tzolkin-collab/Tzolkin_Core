import {tableKey,tableEdges,diagramLayout,schemaDiagramLayout,resourceId,suggestProducts} from './database-model.js';
const el=(tag,text,cls)=>{const n=document.createElement(tag);if(text!==undefined)n.textContent=text;if(cls)n.className=cls;return n;};
const button=(text,action,cls='dbx-button')=>{const n=el('button',text,cls);n.type='button';n.onclick=action;return n;};
const svg=(tag,attrs)=>{const n=document.createElementNS('http://www.w3.org/2000/svg',tag);for(const [k,v]of Object.entries(attrs))n.setAttribute(k,v);return n;};
const option=(value,label)=>{const n=el('option',label);n.value=value;return n;};
const controllers=new WeakMap();

export function renderDatabaseWorkspace(root,options){
 const existing=controllers.get(root);
 if(existing?.shell.isConnected){existing.update(options);return;}
 let context=options,databases=[],database='',tables=[],active=null,mode='diagram',query='',schema='',offset=0,filterColumn='',filterValue='',sort='',direction='asc',zoom=1,diagramFilter='',onlyConnected=false,relFilter='',request=0,disposed=false,loading=false;
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
 const selectTable=table=>{active=table;schema=table.schema;resetRows();renderNavigatorList();renderEditor();};
 const selectSchema=name=>{schema=name;active=null;mode='diagram';diagramFilter='';relFilter='';resetRows();renderNavigatorList();renderEditor();};
 const selectDatabase=async name=>{
  database=name;active=null;tables=[];schema='';resetRows();loading=true;const version=++request;
  renderNavigator();main.replaceChildren(notice('Consultando schemas e tabelas…'));setStatus('Consultando '+name);
  try{const result=await api('/api/management/schema?'+params({}));if(version!==request||disposed||!shell.isConnected)return;
   tables=result.tables||[];schema=tables.some(t=>t.schema==='public')?'public':tables[0]?.schema||'';active=null;mode='diagram';
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
   const group=el('div',undefined,'dbx-tree-group');
   const isSchemaActive=(schema===name);
   const isSchemaSelected=isSchemaActive&&!active;
   const relations=tableEdges(tables).filter(edge=>edge.source.schema===name||edge.target.schema===name).length;
   const head=el('div',undefined,'dbx-schema-item'+(isSchemaActive?' active':'')+(isSchemaSelected?' selected':''));
   const chevronBtn=button(isSchemaActive?'⌄':'›',()=>{schema=isSchemaActive?'':name;renderNavigatorList();},'dbx-tree-chevron-btn');
   chevronBtn.setAttribute('aria-label',(isSchemaActive?'Recolher ':'Expandir ')+name);
   const nameBtn=button('',()=>selectSchema(name),'dbx-schema-name-btn');
   nameBtn.append(el('span','◇','dbx-schema-icon'),el('strong',name),el('small',`${items.length} tab · ${relations} rel`));
   head.append(chevronBtn,nameBtn);
   const children=el('div',undefined,'dbx-schema-children');children.hidden=!isSchemaActive;
   const allBtn=button(`◈ Ver relações do schema (${relations})`,()=>selectSchema(name),'dbx-schema-all-btn'+(isSchemaSelected?' active':''));
   children.append(allBtn);
   children.append(...items.map(table=>{const b=button('',()=>selectTable(table),'dbx-table-item'+(active&&tableKey(active)===tableKey(table)?' active':''));b.setAttribute('aria-current',active&&tableKey(active)===tableKey(table)?'true':'false');b.title=table.schema+'.'+table.name;b.append(el('span',table.kind==='VIEW'?'◫':'▦','dbx-table-icon'),el('span',table.name),el('small',String(table.columns.length)));return b;}));
   group.append(head,children);return group;
  }));
 }
 function renderEditor(){
  request++;
  const toolbar=el('header',undefined,'dbx-editor-head'),identity=el('div',undefined,'dbx-identity');
  if(active){
   const pathSpan=el('span',undefined,'dbx-path');
   pathSpan.append(el('span',database+' / '),button(active.schema,()=>selectSchema(active.schema),'dbx-path-btn'),el('span',' / '));
   identity.append(pathSpan,el('strong',active.name));
  }else{
   identity.append(el('span',database,'dbx-path'),el('strong',`Schema ${schema||'público'}`));
  }
  const tabs=el('nav',undefined,'dbx-tabs');tabs.setAttribute('aria-label','Visualização');
  const schemaTables=tables.filter(t=>!schema||t.schema===schema);
  const schemaEdges=tableEdges(tables).filter(e=>e.source.schema===schema||e.target.schema===schema);
  if(active&&!['columns','data','diagram','bindings'].includes(mode))mode='columns';
  if(!active&&!['diagram','relations','tables','bindings'].includes(mode))mode='diagram';
  const tabsConfig=active?[
   ['columns','Estrutura'],
   ['data','Dados'],
   ['diagram','Relações'],
   ['bindings','Vínculos']
  ]:[
   ['diagram','Diagrama do Schema'],
   ['relations',`Todas as Relações (${schemaEdges.length})`],
   ['tables',`Tabelas (${schemaTables.length})`],
   ['bindings','Vínculos']
  ];
  for(const [key,label]of tabsConfig){const b=button(label,()=>{mode=key;renderEditor();},mode===key?'active':'');b.setAttribute('aria-current',mode===key?'page':'false');tabs.append(b);}
  toolbar.append(identity,tabs);const body=el('div',undefined,'dbx-body');main.replaceChildren(toolbar,body);
  if(mode==='bindings'){renderBindings(body);return;}
  if(active){
   if(mode==='columns')renderColumns(body);
   else if(mode==='diagram')renderDiagram(body);
   else if(mode==='data')renderData(body);
  }else{
   if(!schemaTables.length){body.append(notice('Este schema não possui tabelas visíveis para a credencial atual.'));return;}
   if(mode==='diagram')renderSchemaDiagram(body,schemaTables,schemaEdges);
   else if(mode==='relations')renderSchemaRelations(body,schemaTables,schemaEdges);
   else if(mode==='tables')renderSchemaTables(body,schemaTables);
  }
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
  controls.append(el('span',`${layout.nodes.length} tabelas · ${layout.edges.length} relações`),button('−',()=>{zoom=Math.max(.5,zoom-.1);updateZoom();}),zoomLabel,button('+',()=>{zoom=Math.min(1.5,zoom+.1);updateZoom();}),button('100%',()=>{zoom=1;updateZoom();}),button('Ajustar',()=>{zoom=Math.max(.5,Math.min(1,(canvas.clientWidth-40)/layout.width,(canvas.clientHeight-40)/layout.height));updateZoom();}),button('Ver todas do schema ↗',()=>selectSchema(active.schema)));
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
 function renderSchemaDiagram(body,schemaTables,schemaEdges){
  const layout=schemaDiagramLayout(tables,schema,{filter:diagramFilter,onlyConnected});
  const controls=el('div',undefined,'dbx-toolbar dbx-diagram-toolbar');
  const countBadge=el('span',`${layout.nodes.length} de ${schemaTables.length} tabelas · ${layout.edges.length} de ${schemaEdges.length} relações`);
  const filterWrap=el('div',undefined,'dbx-diagram-filter');
  const search=el('input');search.type='search';search.placeholder='Filtrar no diagrama…';search.value=diagramFilter;search.setAttribute('aria-label','Filtrar tabela no diagrama');
  search.oninput=()=>{diagramFilter=search.value;renderEditor();};filterWrap.append(search);
  const toggleConnected=button(onlyConnected?'● Somente com relações':'○ Todas as tabelas',()=>{onlyConnected=!onlyConnected;renderEditor();},'dbx-button dbx-toggle-connected'+(onlyConnected?' active':''));
  const zoomLabel=el('span');
  const updateZoom=()=>{stage.style.transform=`scale(${zoom})`;frame.style.width=layout.width*zoom+'px';frame.style.height=layout.height*zoom+'px';zoomLabel.textContent=Math.round(zoom*100)+'%';};
  const zoomMinus=button('−',()=>{zoom=Math.max(.3,zoom-.1);updateZoom();});
  const zoomPlus=button('+',()=>{zoom=Math.min(1.5,zoom+.1);updateZoom();});
  const zoom100=button('100%',()=>{zoom=1;updateZoom();});
  const zoomFit=button('Ajustar',()=>{const cw=canvas.clientWidth||1000,ch=canvas.clientHeight||600;zoom=Math.max(.35,Math.min(1,(cw-60)/layout.width,(ch-60)/layout.height));updateZoom();});
  const viewRelationsBtn=button('Ver lista de relações →',()=>{mode='relations';renderEditor();});
  controls.append(countBadge,filterWrap,toggleConnected,zoomMinus,zoomLabel,zoomPlus,zoom100,zoomFit,viewRelationsBtn);
  const canvas=el('div',undefined,'dbx-canvas'),frame=el('div',undefined,'dbx-frame'),stage=el('div',undefined,'dbx-stage');
  stage.style.width=layout.width+'px';stage.style.height=layout.height+'px';
  const paths=svg('svg',{width:layout.width,height:layout.height,class:'dbx-links'});
  const nodes=new Map(layout.nodes.map(n=>[tableKey(n.table),n]));
  const CARD_WIDTH=270;
  for(const edge of layout.edges){
   const a=nodes.get(tableKey(edge.source)),b=nodes.get(tableKey(edge.target));
   if(!a||!b)continue;
   const forward=a.x<b.x,sameCol=a.x===b.x;
   let ax,bx;
   if(sameCol){ax=a.x+CARD_WIDTH;bx=b.x+CARD_WIDTH;}
   else if(forward){ax=a.x+CARD_WIDTH;bx=b.x;}
   else{ax=a.x;bx=b.x+CARD_WIDTH;}
   const ay=a.y+44+Math.max(0,a.table.columns.findIndex(c=>c.name===edge.column))*23;
   const by=b.y+44+Math.max(0,b.table.columns.findIndex(c=>c.name===edge.foreign_column))*23;
   let d;
   if(sameCol){const curveOffset=30+Math.abs(ay-by)*.15;d=`M${ax},${ay} C${ax+curveOffset},${ay} ${bx+curveOffset},${by} ${bx},${by}`;}
   else{const midX=(ax+bx)/2;d=`M${ax},${ay} C${midX},${ay} ${midX},${by} ${bx},${by}`;}
   const path=svg('path',{d,'data-source':tableKey(edge.source),'data-target':tableKey(edge.target)});
   const title=svg('title',{});title.textContent=`${edge.source.schema}.${edge.source.name}.${edge.column} → ${edge.target.schema}.${edge.target.name}.${edge.foreign_column}`;
   path.append(title);paths.append(path,svg('circle',{cx:bx,cy:by,r:3}));
  }
  stage.append(paths);
  for(const n of layout.nodes){
   const card=el('article',undefined,'dbx-entity');card.style.left=n.x+'px';card.style.top=n.y+'px';card.style.width=CARD_WIDTH+'px';card.style.height=n.height+'px';
   const header=button('',()=>selectTable(n.table),'dbx-entity-head');
   header.append(el('span',n.table.kind==='VIEW'?'◫ ':'▦ '),el('strong',n.table.name),el('small',` (${n.table.columns.length})`));
   card.append(header);
   const shownCols=n.table.columns.slice(0,6);
   for(const c of shownCols){
    const isFk=n.table.relations.some(r=>r.column===c.name);
    const field=el('div',undefined,'dbx-entity-field');
    field.append(el('span',c.primary_key?'PK':isFk?'FK':'','dbx-key'),el('strong',c.name),el('small',c.type));
    card.append(field);
   }
   if(n.table.columns.length>6){
    const more=button(`+ ${n.table.columns.length-6} colunas…`,()=>selectTable(n.table),'dbx-entity-more');
    card.append(more);
   }
   stage.append(card);
  }
  frame.append(stage);canvas.append(frame);body.append(controls,canvas);updateZoom();
  setStatus(`${layout.nodes.length} tabelas · ${layout.edges.length} relações mapeadas no schema ${schema}`);
 }
 function renderSchemaRelations(body,schemaTables,schemaEdges){
  const controls=el('div',undefined,'dbx-toolbar');
  const search=el('input');search.type='search';search.placeholder='Buscar por tabela ou coluna de relação…';search.value=relFilter;search.setAttribute('aria-label','Buscar relações');
  search.oninput=()=>{relFilter=search.value;renderEditor();};
  const term=relFilter.trim().toLowerCase();
  const filtered=schemaEdges.filter(e=>{
   if(!term)return true;
   return e.source.name.toLowerCase().includes(term)||e.target.name.toLowerCase().includes(term)||e.column.toLowerCase().includes(term)||e.foreign_column.toLowerCase().includes(term);
  });
  const countSpan=el('span',`${filtered.length} de ${schemaEdges.length} relações encontradas`);
  const viewDiagramBtn=button('Ver no Diagrama ↗',()=>{mode='diagram';renderEditor();});
  controls.append(search,countSpan,viewDiagramBtn);
  if(!filtered.length){
   const msg=schemaEdges.length?`Nenhuma relação corresponde à busca "${relFilter}".`:`O schema "${schema}" não possui chaves estrangeiras declaradas no PostgreSQL.`;
   body.append(controls,notice(msg));return;
  }
  const table=el('table',undefined,'dbx-grid'),head=el('thead'),tr=el('tr');
  for(const text of ['Tabela Origem (FK)','Coluna Origem','','Tabela Destino (PK)','Coluna Destino','Ações']){const th=el('th',text);th.scope='col';tr.append(th);}head.append(tr);
  const tbody=el('tbody');
  for(const edge of filtered){
   const row=el('tr');
   const tdSrc=el('td');const srcLink=button('▦ '+edge.source.name,()=>selectTable(edge.source),'dbx-relation-table-btn');tdSrc.append(srcLink);
   const tdSrcCol=el('td',edge.column,'dbx-mono');
   const tdArrow=el('td','→','dbx-arrow-cell');
   const tdDst=el('td');const dstLink=button('▦ '+edge.target.name,()=>selectTable(edge.target),'dbx-relation-table-btn');tdDst.append(dstLink);
   const tdDstCol=el('td',edge.foreign_column,'dbx-mono');
   const tdActions=el('td',undefined,'dbx-rel-actions');
   const bSrc=button('Origem',()=>selectTable(edge.source),'dbx-button dbx-button-sm');
   const bDst=button('Destino',()=>selectTable(edge.target),'dbx-button dbx-button-sm');
   tdActions.append(bSrc,bDst);
   row.append(tdSrc,tdSrcCol,tdArrow,tdDst,tdDstCol,tdActions);tbody.append(row);
  }
  table.append(head,tbody);
  const scroll=el('div',undefined,'dbx-grid-scroll');scroll.append(table);body.append(controls,scroll);
  setStatus(`${filtered.length} relações no schema ${schema} · clique em uma tabela para inspecionar`);
 }
 function renderSchemaTables(body,schemaTables){
  const controls=el('div',undefined,'dbx-toolbar');
  const search=el('input');search.type='search';search.placeholder='Buscar tabela do schema…';search.value=relFilter;search.setAttribute('aria-label','Buscar tabela');
  search.oninput=()=>{relFilter=search.value;renderEditor();};
  const term=relFilter.trim().toLowerCase();
  const filtered=schemaTables.filter(t=>!term||t.name.toLowerCase().includes(term));
  const countSpan=el('span',`${filtered.length} de ${schemaTables.length} tabelas no schema ${schema}`);
  controls.append(search,countSpan);
  const table=el('table',undefined,'dbx-grid'),head=el('thead'),tr=el('tr');
  for(const text of ['Tabela','Tipo','Colunas','Chave Primária','FKs de Saída','Referenciada Por','Ações']){const th=el('th',text);th.scope='col';tr.append(th);}head.append(tr);
  const tbody=el('tbody');
  for(const t of filtered){
   const row=el('tr');
   const tdName=el('td');const btn=button((t.kind==='VIEW'?'◫ ':'▦ ')+t.name,()=>selectTable(t),'dbx-relation-table-btn');tdName.append(btn);
   const tdKind=el('td',t.kind==='VIEW'?'View':'Tabela','dbx-muted');
   const tdCols=el('td',String(t.columns.length));
   const pkCols=t.columns.filter(c=>c.primary_key).map(c=>c.name).join(', ')||'—';
   const tdPk=el('td',pkCols,'dbx-mono');
   const outCount=t.relations?t.relations.length:0;
   const tdOut=el('td',outCount?`${outCount} FKs`:'—');
   const inCount=tableEdges(tables).filter(e=>e.target===t).length;
   const tdIn=el('td',inCount?`${inCount} tabelas`:'—');
   const tdAction=el('td');tdAction.append(button('Abrir tabela →',()=>selectTable(t),'dbx-button dbx-button-sm'));
   row.append(tdName,tdKind,tdCols,tdPk,tdOut,tdIn,tdAction);tbody.append(row);
  }
  table.append(head,tbody);
  const scroll=el('div',undefined,'dbx-grid-scroll');scroll.append(table);body.append(controls,scroll);
  setStatus(`${filtered.length} tabelas listadas no schema ${schema}`);
 }
 function renderBindings(body){
  const wrapper=el('div',undefined,'dbx-bindings');body.append(wrapper);
  wrapper.append(el('h2','Classificação do banco'),el('p','Confirme a qual produto este banco, schema ou tabela pertence. O vínculo também aparece nas conexões do produto.','dbx-muted'));
  const scope=el('select');scope.setAttribute('aria-label','Escopo do vínculo');scope.append(option('database','Banco inteiro'));if(schema)scope.append(option('schema','Schema '+schema));if(active)scope.append(option('table','Tabela '+active.name));
  scope.value=(!active&&schema)?'schema':(active?'table':'database');
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
