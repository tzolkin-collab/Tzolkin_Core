import {createIcon} from './icons.js';
const el=(tag,text,cls)=>{const n=document.createElement(tag);if(text!=null)n.textContent=text;if(cls)n.className=cls;return n;};
const labels={mentoria:'Mentoria',consultoria:'Consultoria',software:'Software',educacional:'Educacional',outro:'Outro',sessao:'Sessão',entregavel:'Entregável',feature:'Feature',tarefa:'Tarefa',planned:'Planejado',done:'Concluído',cancelled:'Cancelado'};
const day=v=>new Intl.DateTimeFormat('en-CA',{timeZone:'America/Sao_Paulo',year:'numeric',month:'2-digit',day:'2-digit'}).format(new Date(v));
export function setupTracking({api}){
 const host=document.getElementById('view-tracking');let generation=0,month=day(Date.now()).slice(0,7),tenant='',data,tenants=[],query='',statusFilter='',mode='month';
 const mobileQuery=window.matchMedia('(max-width:700px)');
 mobileQuery.addEventListener('change',()=>{if(data&&!host.querySelector('dialog[open]'))render();});
 host.addEventListener('pointerdown',event=>{for(const menu of host.querySelectorAll('.tracking-header-top details[open]'))if(!menu.contains(event.target))menu.open=false;});
 const clear=()=>{generation++;host.replaceChildren();data=null;tenants=[];tenant='';query='';statusFilter='';};
 function field(form,label,type='text',options){const wrap=el('label',label),n=el(options?'select':'input');if(options)for(const [v,name]of options){const o=el('option',name);o.value=v;n.append(o);}else n.type=type;n.required=true;wrap.append(n);form.append(wrap);return n;}
 const choices=keys=>keys.map(k=>[k,labels[k]]);
 function button(label,icon,fn){const b=el('button',null,'secondary');b.type='button';b.append(createIcon(icon),document.createTextNode(label));b.onclick=fn;return b;}
 function details(activity){
  const origin=document.activeElement,dialog=el('dialog',null,'tracking-drawer'),head=el('header',null,'tracking-drawer-head');
  const title=el('h2',activity.title);title.id='tracking-detail-title';dialog.setAttribute('aria-labelledby',title.id);
  head.append(el('span','Detalhes da atividade','detail'),button('Fechar','close',()=>dialog.close()));
  const body=el('div',null,'tracking-form');body.append(title);
  const facts=el('dl',null,'tracking-facts');
  for(const [label,value] of [['Cliente',activity.tenant_name],['Categoria',labels[activity.category]],['Tipo',labels[activity.kind]],['Situação',labels[activity.status]],['Início',new Date(activity.starts_at).toLocaleString('pt-BR',{timeZone:'America/Sao_Paulo',dateStyle:'short',timeStyle:'short'})],['Fim',new Date(activity.ends_at).toLocaleString('pt-BR',{timeZone:'America/Sao_Paulo',dateStyle:'short',timeStyle:'short'})]])facts.append(el('dt',label),el('dd',value));
  body.append(facts,el('p','Horários de Brasília.','detail'));
  const status=field(body,'Alterar situação','text',choices(['planned','done','cancelled']));status.value=activity.status;
  const error=el('p',null,'form-error');error.setAttribute('role','alert');
  const save=button('Salvar situação','check',async()=>{save.disabled=true;try{await api('/api/tracking/'+activity.id+'/status','PUT',{status:status.value,revision:activity.revision});dialog.close();await load();}catch(e){error.textContent=e.message;}finally{save.disabled=false;}});
  body.append(error,save,button('Registrar tempo','clock',()=>{dialog.close();editor(activity);}));
  body.append(el('h3','Apontamentos do mês'));
  const logs=data.logs.filter(l=>l.activity_id===activity.id);
  if(!logs.length)body.append(el('p','Nenhum apontamento carregado para esta atividade neste mês.','detail'));
  for(const log of logs)body.append(el('p',String(log.worked_on).slice(0,10)+' · '+log.minutes+' min — '+log.note));
  dialog.append(head,body);dialog.onclose=()=>{dialog.remove();if(origin?.isConnected)origin.focus();};
  host.append(dialog);dialog.showModal();
 }
 function disclosure(label,content){
  const box=el('details',null,'tracking-disclosure'),summary=el('summary',label);box.append(summary,content);
  box.addEventListener('keydown',e=>{if(e.key==='Escape'){box.open=false;summary.focus();e.stopPropagation();}});
  return box;
 }
 function editor(activity,selectedDay){
  const previousFocus=document.activeElement;
  const dialog=el('dialog',null,'tracking-editor'),form=el('form',null,'tracking-form');dialog.append(form);const heading=el('h2',activity?'Registrar tempo':'Nova atividade');heading.id='tracking-editor-title';dialog.setAttribute('aria-labelledby',heading.id);
  const header=el('header',null,'tracking-editor-heading'),intro=el('div');intro.append(heading,el('p',activity?'Registre o trabalho realizado, não o tempo previsto.':'Organize uma sessão, tarefa ou entrega.','detail'));header.append(intro,button('Fechar','close',()=>dialog.close()));form.append(header);let values;const id=crypto.randomUUID();
  if(activity){
   form.append(el('p',activity.title));const date=field(form,'Dia trabalhado','date');date.value=day(Date.now());const minutes=field(form,'Minutos trabalhados','number');minutes.min=1;minutes.max=1440;minutes.step=1;const note=field(form,'Descrição do trabalho');note.minLength=2;note.maxLength=500;
   values=()=>({id,worked_on:date.value,minutes:Number(minutes.value),note:note.value});
  }else{
   const customer=field(form,'Cliente','text',[['','Selecione'],...tenants.map(t=>[t.id,t.name])]);customer.value=tenant;
   const category=field(form,'Categoria','text',choices(['mentoria','consultoria','software','educacional','outro'])),kind=field(form,'Tipo','text',choices(['sessao','entregavel','feature','tarefa']));
   const name=field(form,'Título');name.minLength=2;name.maxLength=160;
   name.placeholder='Ex.: Revisão dos objetivos da mentoria';
   form.insertBefore(name.parentElement,customer.parentElement);
   const classification=el('fieldset',null,'tracking-field-grid');classification.append(el('legend','Organização'),category.parentElement,kind.parentElement);form.append(classification);
   const start=field(form,'Início · Brasília','datetime-local'),end=field(form,'Fim / prazo · Brasília','datetime-local');
   const schedule=el('fieldset',null,'tracking-field-grid');schedule.append(el('legend','Quando acontece'),start.parentElement,end.parentElement);form.append(schedule);
   if(selectedDay){start.value=selectedDay+'T09:00';end.value=selectedDay+'T10:00';}
   start.addEventListener('change',()=>{end.min=start.value;if(!end.value||end.value<=start.value){const next=new Date(start.value+':00Z');next.setUTCHours(next.getUTCHours()+1);if(Number.isFinite(next.getTime()))end.value=next.toISOString().slice(0,16);}});
   form.append(el('p','Agenda interna. Sem recorrência ou convite externo nesta versão.','detail'));
   values=()=>({id,tenant_id:customer.value,category:category.value,kind:kind.value,title:name.value,starts_at:start.value+':00-03:00',ends_at:end.value+':00-03:00'});
  }
  const error=el('p',null,'form-error');error.setAttribute('role','alert');error.tabIndex=-1;form.append(error);const footer=el('div',null,'tracking-editor-footer'),save=el('button',activity?'Salvar apontamento':'Criar atividade','primary');save.type='submit';footer.append(button('Cancelar','close',()=>dialog.close()),save);form.append(footer);
  form.onsubmit=async e=>{e.preventDefault();if(save.disabled)return;const saveLabel=save.textContent;save.disabled=true;save.textContent='Salvando…';form.setAttribute('aria-busy','true');error.textContent='';try{await api(activity?`/api/tracking/${activity.id}/time`:'/api/tracking','POST',values());dialog.close();await load();}catch(e){error.textContent=e.message;error.focus();}finally{save.disabled=false;save.textContent=saveLabel;form.removeAttribute('aria-busy');}};
  dialog.onclose=()=>{dialog.remove();if(previousFocus?.isConnected)previousFocus.focus();};host.append(dialog);dialog.showModal();
 }
 function render(){
  const openMenus=[...host.querySelectorAll('.tracking-disclosure[open]>summary')].map(n=>n.textContent.split(' ·')[0]);
  const focusKey=document.activeElement?.dataset.trackingFocus;
  const selection=document.activeElement?.selectionStart;
  const shown=data.activities.filter(a=>(!statusFilter||a.status===statusFilter)&&(!query||[a.title,a.tenant_name,labels[a.category],labels[a.kind]].join(' ').toLocaleLowerCase('pt-BR').includes(query.toLocaleLowerCase('pt-BR'))));
  host.replaceChildren();const toolbar=el('div',null,'section-toolbar'),filters=el('div',null,'tracking-actions');const period=field(filters,'Mês','month');period.value=month;period.onchange=()=>{if(period.value){month=period.value;load();}};
  const customer=field(filters,'Cliente','text',[['','Todos os clientes'],...tenants.map(t=>[t.id,t.name])]);customer.value=tenant;customer.onchange=()=>{tenant=customer.value;load();};toolbar.append(filters,button('Nova atividade','plus',()=>editor()));host.append(toolbar,el('p','Agenda interna · Brasília · Gestão administrativa. Categoria desta atividade; vínculo com contratação ainda pendente.','detail'));
  period.dataset.trackingFocus='period';customer.dataset.trackingFocus='customer';
  const navigation=el('div',null,'tracking-actions');navigation.setAttribute('aria-label','Navegação da agenda');
  const shift=delta=>{const [year,m]=month.split('-').map(Number);const next=new Date(Date.UTC(year,m-1+delta,1));if(next.getUTCFullYear()<2000||next.getUTCFullYear()>2099)return;month=next.toISOString().slice(0,7);load();};
  navigation.append(button('Mês anterior','arrow',()=>shift(-1)),button('Hoje','clock',()=>{month=day(Date.now()).slice(0,7);load();}),button('Próximo mês','arrow',()=>shift(1)));
  const search=field(navigation,'Buscar atividade ou cliente','search');search.required=false;search.value=query;search.dataset.trackingFocus='search';search.oninput=()=>{query=search.value;render();};
  const state=field(navigation,'Filtrar situação','text',[['','Todas'],...choices(['planned','done','cancelled'])]);state.value=statusFilter;state.dataset.trackingFocus='status';state.onchange=()=>{statusFilter=state.value;render();};
  const view=field(navigation,'Visualização','text',[['month','Mês e agenda'],['list','Lista']]);view.value=mode;view.dataset.trackingFocus='view';view.onchange=()=>{mode=view.value;render();};host.append(navigation,el('p','Em telas pequenas, as atividades aparecem em lista para facilitar a leitura.','tracking-mobile-note detail'));
  const count=el('p',shown.length+' atividades encontradas. Indicadores e horas abaixo referem-se ao mês e cliente selecionados.','detail');count.setAttribute('role','status');host.append(count);
  if(data.truncated)host.append(el('p','Limite de registros atingido: resumos parciais. Filtre por cliente.','security-banner'));
  const stats=el('div',null,'metrics');for(const [name,value]of [['Atividades no período',data.activities.length],['Concluídas',data.activities.filter(a=>a.status==='done').length],['Horas registradas',(data.logs.reduce((s,l)=>s+l.minutes,0)/60).toLocaleString('pt-BR',{maximumFractionDigits:1})]]){const card=el('article');card.append(el('span',name),el('strong',value));stats.append(card);}host.append(stats);
  const grid=el('div',null,'tracking-calendar');grid.setAttribute('aria-label','Calendário mensal');for(const d of ['Seg','Ter','Qua','Qui','Sex','Sáb','Dom'])grid.append(el('div',d,'tracking-weekday'));
  const [y,m]=month.split('-').map(Number),offset=(new Date(Date.UTC(y,m-1,1)).getUTCDay()+6)%7,days=new Date(Date.UTC(y,m,0)).getUTCDate();for(let n=0;n<offset;n++)grid.append(el('div',null,'tracking-day tracking-blank'));
  for(let n=1;n<=days;n++){const key=month+'-'+String(n).padStart(2,'0'),cell=el('div',null,'tracking-day');const add=el('button',n,'tracking-day-add');add.type='button';add.setAttribute('aria-label','Criar atividade em '+key);if(key===day(Date.now()))add.setAttribute('aria-current','date');add.onclick=()=>editor(null,key);cell.append(add);cell.addEventListener('click',event=>{if(event.target===cell)editor(null,key);});for(const a of shown.filter(a=>day(a.starts_at)<=key&&day(new Date(a.ends_at).getTime()-1)>=key)){const link=el('button',new Date(a.starts_at).toLocaleTimeString('pt-BR',{timeZone:'America/Sao_Paulo',hour:'2-digit',minute:'2-digit'})+' · '+a.title+' · '+a.tenant_name+' · '+labels[a.status],'tracking-calendar-event');link.type='button';link.title=a.title+' · '+a.tenant_name+' · '+labels[a.status];
link.replaceChildren(el('span',new Date(a.starts_at).toLocaleTimeString('pt-BR',{timeZone:'America/Sao_Paulo',hour:'2-digit',minute:'2-digit'}),'tracking-event-time'),el('strong',a.title,'tracking-event-title'),el('span',a.tenant_name,'tracking-event-client'),el('span',labels[a.status],'tracking-event-status'));link.dataset.status=a.status;link.onclick=()=>details(a);cell.append(link);}grid.append(cell);}grid.hidden=mode==='list';host.append(grid,el('h2','Atividades e entregas','section-title'));
  const list=el('div',null,'list-panel');if(!shown.length){list.append(el('p',data.activities.length?'Nenhuma atividade corresponde aos filtros.':'Nenhuma atividade cadastrada neste período.','empty-list'));if(query||statusFilter)list.append(button('Limpar filtros','close',()=>{query='';statusFilter='';render();}));}
  for(const a of shown){const row=el('article',null,'tracking-row');row.tabIndex=-1;row.id='activity-'+a.id;const body=el('div');body.append(el('h3',a.title),el('p',a.tenant_name+' · '+labels[a.category]+' · '+labels[a.kind],'detail'),el('p',new Date(a.starts_at).toLocaleString('pt-BR',{timeZone:'America/Sao_Paulo',dateStyle:'short',timeStyle:'short'})+' — '+new Date(a.ends_at).toLocaleString('pt-BR',{timeZone:'America/Sao_Paulo',dateStyle:'short',timeStyle:'short'}),'detail'));
   const actions=el('div',null,'tracking-actions');actions.append(el('span',labels[a.status],'status'),button('Abrir detalhes','arrow',()=>details(a)));row.append(body,actions);list.append(row);
  }host.append(list,el('h2','Horas por dia trabalhado','section-title'));
  const chart=el('div',null,'tracking-chart'),totals=new Map();for(const l of data.logs){const d=String(l.worked_on).slice(0,10);totals.set(d,(totals.get(d)||0)+l.minutes);}const max=Math.max(1,...totals.values());for(const [d,v]of [...totals].sort()){const row=el('div',null,'tracking-bar'),meter=el('meter');meter.min=0;meter.max=max;meter.value=v;meter.setAttribute('aria-label',d+' · '+v+' minutos');row.append(el('span',d.slice(8)+'/'+d.slice(5,7)),meter,el('span',(v/60).toLocaleString('pt-BR',{maximumFractionDigits:1})+' h'));chart.append(row);}if(!totals.size)chart.append(el('p','Nenhum tempo registrado. Horas planejadas não contam como realizadas.','empty-list'));host.append(chart,el('h2','Histórico de apontamentos','section-title'));
  const logs=el('div',null,'list-panel');for(const l of data.logs){const row=el('article',null,'tracking-row');row.append(el('strong',l.title),el('span',String(l.worked_on).slice(0,10)+' · '+l.minutes+' min'),el('p',l.note));logs.append(row);}host.append(logs);
  // Container único; ações e informações secundárias sob demanda.
  const filterPanel=el('div',null,'tracking-filter-panel');filterPanel.append(customer.parentElement,state.parentElement);
  const filterMenu=disclosure('Filtros'+(tenant||statusFilter?' · ativos':''),filterPanel);
  const viewMenu=disclosure('Visualização',view.parentElement);
  filterMenu.open=openMenus.includes('Filtros');viewMenu.open=openMenus.includes('Visualização');
  const header=el('div',null,'tracking-workspace-header');
  const navButtons=[...navigation.querySelectorAll(':scope > button')];
  const monthLabel=el('strong',new Intl.DateTimeFormat('pt-BR',{month:'long',year:'numeric',timeZone:'UTC'}).format(new Date(month+'-15T12:00:00Z')),'tracking-month-title');
  const periodMenu=disclosure(monthLabel.textContent,period.parentElement);periodMenu.classList.add('tracking-period-menu');
  const left=el('div',null,'tracking-header-left'),right=el('div',null,'tracking-header-right');
  navButtons.forEach((b,i)=>{if(i!==1){b.setAttribute('aria-label',i===0?'Mês anterior':'Próximo mês');b.title=i===0?'Mês anterior':'Próximo mês';b.replaceChildren(createIcon('arrow'));b.classList.add('tracking-icon-button');if(i===0)b.classList.add('tracking-previous');}});
  search.placeholder='Buscar atividades…';search.setAttribute('aria-label','Buscar atividade ou cliente');search.parentElement.classList.add('tracking-search');
  left.append(periodMenu,...navButtons);right.append(filterMenu,viewMenu,toolbar.querySelector('button'));
  const primary=right.lastElementChild;primary.className='primary tracking-create';
  const headerTop=el('div',null,'tracking-header-top');headerTop.append(left,right);
  const headerBottom=el('div',null,'tracking-header-bottom');count.textContent=shown.length+' atividade'+(shown.length===1?'':'s');headerBottom.append(search.parentElement,count);
  header.append(headerTop,headerBottom);
  const calendar=el('div',null,'tracking-workspace');calendar.append(header,grid);
  const activityList=disclosure('Atividades · '+shown.length,list);activityList.classList.add('tracking-activity-list');activityList.open=!shown.length||mode==='list'||openMenus.includes('Atividades')||window.matchMedia('(max-width:700px)').matches;
  calendar.append(activityList);
  const insights=el('div');insights.append(el('p','Indicadores do mês e cliente selecionados; busca e situação filtram apenas atividades.','detail'),stats,el('h3','Horas por dia trabalhado'),chart,el('h3','Histórico de apontamentos'),logs);
  const truncated=el('p',data.truncated?'Resultados parciais: limite atingido. Filtre por cliente.':'Agenda interna · Horário de Brasília','detail');
  host.replaceChildren(calendar,truncated,disclosure('Métricas e apontamentos',insights));
  if(focusKey){const target=host.querySelector('[data-tracking-focus="'+focusKey+'"]');target?.focus();if(focusKey==='search'&&selection!=null)target?.setSelectionRange(selection,selection);}
 }
 async function load(){const ticket=++generation;host.replaceChildren(el('p','Carregando acompanhamento…','empty-list'));try{const [result,directory]=await Promise.all([api('/api/tracking?'+new URLSearchParams({month,...(tenant?{tenant_id:tenant}:{})})),api('/api/overview')]);if(ticket!==generation)return;data=result;tenants=directory.tenants;render();}catch(e){if(ticket===generation)host.replaceChildren(el('p',e.message,'security-banner'),button('Tentar novamente','clock',load));}}
 return {load,clear};
}
