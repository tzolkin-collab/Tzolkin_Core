import {createIcon,paymentInstitutionIcon} from './icons.js';
import {brazilMonth,periodRows,cashSummary,needsRefresh,bankBalance,movementSeries,paymentInstitution} from './finance-model.js';

const node=(tag,text,cls)=>{const n=document.createElement(tag);if(text!==undefined)n.textContent=text;if(cls)n.className=cls;return n;};
const money=(value,currency='BRL')=>{if(!Number.isFinite(value))return '—';try{return new Intl.NumberFormat('pt-BR',{style:'currency',currency}).format(value);}catch{return `${value} ${currency}`;}};
const shortDate=value=>new Intl.DateTimeFormat('pt-BR',{timeZone:'America/Sao_Paulo',day:'2-digit',month:'short'}).format(new Date(value));
const timestamp=value=>value?new Date(value).toLocaleString('pt-BR',{timeZone:'America/Sao_Paulo',day:'2-digit',month:'2-digit',hour:'2-digit',minute:'2-digit'}):'Ainda não importado';
const storageKey='core.finance.filters.v2';
const svgNode=(tag,attrs)=>{const n=document.createElementNS('http://www.w3.org/2000/svg',tag);for(const [key,value]of Object.entries(attrs))n.setAttribute(key,String(value));return n;};
const institutionBadge=bank=>{const identity=paymentInstitution(bank),badge=node('span',undefined,'fin-institution'),icon=node('span',undefined,'fin-institution-icon');badge.style.setProperty('--institution-color',identity.color);icon.append(paymentInstitutionIcon());badge.append(icon,node('span',identity.name));return badge;};

export function setupFinance({api}){
 let generation=0,board=null,sales=null,busy=false,loading=false,message='',error=false,page=0,search='';
 let month=brazilMonth(Date.now()),selected='all',currency='BRL',direction='all';
 try{const saved=JSON.parse(localStorage.getItem(storageKey)||'null');if(/^20\d{2}-(0[1-9]|1[0-2])$/.test(saved?.month))month=saved.month;if(typeof saved?.account==='string')selected=saved.account;}catch{}
 const host=()=>document.getElementById('view-finance');
 const persist=()=>{try{localStorage.setItem(storageKey,JSON.stringify({month,account:selected}));}catch{}};
 const accounts=()=>board?.accounts||[];
 const picked=()=>accounts().filter(a=>selected==='all'||a.id===selected);
 const button=(text,action,icon,cls='fin-button')=>{const b=node('button',undefined,cls);b.type='button';if(icon)b.append(createIcon(icon));b.append(document.createTextNode(text));b.onclick=action;return b;};
 const readBoard=()=>api('/api/finance/board?'+new URLSearchParams({month}));
 const readSales=()=>api('/api/finance/sales?'+new URLSearchParams({month}));
 function normalize(){if(!accounts().some(a=>a.id===selected))selected='all';const currencies=[...new Set(accounts().map(a=>a.currency).filter(Boolean))];if(!currencies.includes(currency))currency=currencies[0]||'BRL';}

 async function refresh(force=false){
  if(busy||loading||!board)return;
  const ticket=generation,period=month;busy=true;error=false;message='Verificando atualizações…';render();let failed=0;
  try{
   const staleConnections=board.connections.some(c=>{
    if(c.attempt?.payload?.state!=='ok'&&Date.now()-Date.parse(c.attempt?.updated_at)<600000)return false;
    return !c.payload||Date.now()-Date.parse(c.updated_at)>=43200000;
   });
   if(force||staleConnections){
    const result=await api('/api/finance/sync','POST',{});if(ticket!==generation)return;
    failed+=result.results.filter(r=>!r.ok).length;
    const updated=await readBoard();if(ticket!==generation)return;board=updated;normalize();render();
   }
   const queue=accounts().filter(a=>force||needsRefresh(a.snapshot,a.attempt,period));
   for(const [index,account]of queue.entries()){
    if(ticket!==generation)return;
    message=`Atualizando extratos · ${index+1} de ${queue.length}`;render();
    try{const result=await api('/api/finance/transactions/sync','POST',{account_id:account.id,month:period});if(ticket!==generation)return;account.snapshot=result.snapshot;account.attempt={payload:{state:'ok'},updated_at:new Date().toISOString()};}
    catch{if(ticket!==generation)return;failed++;account.attempt={payload:{state:'error'},updated_at:new Date().toISOString()};}
   }
   const salesSaved=Object.values(sales?.providers||{}).map(p=>p.snapshot?.updated_at).filter(Boolean).sort().at(-1);
   if(force||!salesSaved||period===brazilMonth(Date.now())&&Date.now()-Date.parse(salesSaved)>=43200000){
    message='Atualizando vendas Stripe e Asaas…';render();
    const result=await api('/api/finance/sales/sync','POST',{month:period});if(ticket!==generation)return;
    sales={month:result.month,configured:result.configured,providers:result.providers};
    failed+=result.results.filter(r=>r.configured&& !r.ok).length;
   }
   failed=Math.max(failed,accounts().filter(a=>a.attempt?.payload.state==='error').length,board.connections.filter(c=>c.attempt?.payload.state==='error').length);
   if(accounts().some(a=>a.snapshot))board.saved_months=[...new Set([...(board.saved_months||[]),period])].sort().reverse();
   message=failed?'Parte dos dados não pôde ser atualizada. O que já estava salvo continua disponível.':'Dados salvos no Core.';error=failed>0;
  }catch(e){if(ticket===generation){message=e.message;error=true;}}
  finally{if(ticket===generation){busy=false;render();}}
 }
 async function load(){
  const ticket=++generation;loading=true;busy=false;error=false;message='';render();
  try{const [data,paymentData]=await Promise.all([readBoard(),readSales()]);if(ticket!==generation)return;board=data;sales=paymentData;normalize();persist();}
  catch(e){if(ticket===generation){error=true;message='Não foi possível ler os dados salvos. '+e.message;}}
  finally{if(ticket===generation){loading=false;render();}}
  if(ticket===generation&&!error)await refresh(false);
 }

 function salesPanel(){
  const section=node('section',undefined,'fin-ledger'),title=node('div',undefined,'fin-section-title');title.append(node('h2','Vendas por processador'),node('span','Stripe e Asaas · leitura direta das APIs','fin-muted'));section.append(title);
  const providers=sales?.providers||{},rows=Object.values(providers).flatMap(p=>p.snapshot?.payload?.sales||[]).sort((a,b)=>Date.parse(b.date)-Date.parse(a.date));
  const received=rows.filter(r=>r.status==='received'),gross=received.reduce((n,r)=>n+(r.currency==='BRL'&&Number.isFinite(r.gross)?r.gross:0),0),fees=received.reduce((n,r)=>n+(r.currency==='BRL'&&Number.isFinite(r.fee)?r.fee:0),0),net=received.reduce((n,r)=>n+(r.currency==='BRL'&&Number.isFinite(r.net)?r.net:0),0);
  const metrics=node('div',undefined,'fin-metrics');for(const [label,value,help]of [['Vendas recebidas',gross,'Total bruto em BRL'],['Taxas',fees,'Taxas informadas pelos processadores'],['Líquido',net,'Sem somar repasses bancários']]){const card=node('article',undefined,'fin-metric');card.append(node('span',label),node('strong',money(value)),node('small',help));metrics.append(card);}section.append(metrics);
  const status=node('div',undefined,'fin-scope');for(const name of ['stripe','asaas']){const configured=sales?.configured?.[name],snapshot=providers[name]?.snapshot,attempt=providers[name]?.attempt;status.append(node('span',`${name==='stripe'?'Stripe':'Asaas'} · ${!configured?'não configurado':attempt?.payload?.state==='error'?'falha na atualização':snapshot?`${snapshot.payload.sales.length} registros`:'aguardando sincronização'}`));}section.append(status);
  const wrap=node('div',undefined,'fin-table-wrap'),table=node('table'),head=node('thead'),header=node('tr');for(const text of ['Data','Processador','Descrição','Situação','Bruto','Taxa','Líquido']){const th=node('th',text);th.scope='col';header.append(th);}head.append(header);table.append(head);const body=node('tbody');
  const labels={received:'Recebida',pending:'Pendente',refunded:'Estornada',partial_refund:'Estorno parcial',failed:'Falhou'};
  for(const sale of rows){const tr=node('tr'),provider=node('td');provider.append(institutionBadge(sale.provider==='stripe'?'Stripe':'Asaas'));const state=node('td');state.append(node('span',labels[sale.status]||'Indisponível','fin-badge'));tr.append(node('td',shortDate(sale.date),'fin-date'),provider,node('td',sale.description||'Venda','fin-description'),state,node('td',money(sale.gross,sale.currency),'fin-value fin-positive'),node('td',money(sale.fee,sale.currency),'fin-value'),node('td',money(sale.net,sale.currency),'fin-value fin-positive'));body.append(tr);}table.append(body);wrap.append(table);section.append(wrap);
  if(!rows.length)section.append(node('div',sales?.configured?.stripe||sales?.configured?.asaas?'Nenhuma venda importada neste período.':'Configure uma chave Stripe ou Asaas no backend.','fin-empty'));
  const latest=Object.values(providers).map(p=>p.snapshot?.updated_at).filter(Boolean).sort().at(-1);section.append(node('div',`${rows.length} vendas · última gravação ${timestamp(latest)}`,'fin-footer'));return section;
 }

 const chartObservers=[];
 function chart(summary,kind='flow'){
  const box=node('section',undefined,'fin-chart '+(kind==='net'?'fin-chart-main':'')),heading=node('div',undefined,'fin-section-title');
  heading.append(node('h3',kind==='net'?'Movimento acumulado':'Entradas e saídas'));
  if(kind==='flow'){const legend=node('div',undefined,'fin-legend');legend.append(node('span','Entradas','fin-in'),node('span','Saídas','fin-out'));heading.append(legend);}
  else heading.append(node('span','Variação no período · não é saldo histórico','fin-muted'));
  const plot=node('div',undefined,'fin-plot'),detail=node('p','Selecione um dia no gráfico para ver os valores.','fin-chart-detail');detail.setAttribute('aria-live','polite');box.append(heading,plot,detail);
  const data=movementSeries(summary,month);
  function draw(){
   const width=Math.max(260,plot.clientWidth),height=kind==='net'?225:180,left=64,right=20,top=20,bottom=height-32;
   const values=kind==='net'?data.map(d=>d.net):data.flatMap(d=>[d.incoming,d.outgoing]);
   const low=Math.min(0,...values),high=Math.max(1,...values),padding=(high-low)*.08;
   const min=low<0?low-padding:0,max=high+padding;
   const x=day=>left+5+(day-1)/(data.length-1)*(width-left-right-10),y=v=>bottom-(v-min)/(max-min)*(bottom-top);
   const svg=svgNode('svg',{viewBox:'0 0 '+width+' '+height,height,role:'img','aria-label':kind==='net'?'Variação acumulada no mês, partindo de zero, em '+currency:'Entradas e saídas diárias em '+currency});
   const add=(tag,attrs,text)=>{const n=svgNode(tag,attrs);if(text!==undefined)n.textContent=text;svg.append(n);return n;};
   for(let i=0;i<3;i++){const v=min+(max-min)*i/2;add('line',{x1:left,x2:width-right,y1:y(v),y2:y(v),class:'fin-gridline'});add('text',{x:left-8,y:y(v)+4,'text-anchor':'end',class:'fin-axis'},new Intl.NumberFormat('pt-BR',{notation:'compact',maximumFractionDigits:1}).format(v));}
   add('text',{x:5,y:12,class:'fin-axis'},currency);
   for(const day of [1,Math.ceil(data.length/2),data.length])add('text',{x:x(day),y:height-8,'text-anchor':day===1?'start':day===data.length?'end':'middle',class:'fin-axis'},String(day).padStart(2,'0'));
   if(kind==='net'){
    const path=data.map((d,i)=>(i?'L':'M')+x(d.day)+','+y(d.net)).join(' ');
    add('path',{d:path+' L'+x(data.length)+','+y(0)+' L'+x(1)+','+y(0)+' Z',class:'fin-area'});
    add('path',{d:path,fill:'none',class:'fin-line'});
   }else{
    const bar=Math.max(2,(width-left-right-10)/(data.length*2.8));
    for(const d of data)for(const [value,offset,cls]of [[d.incoming,-bar,'fin-bar-in'],[d.outgoing,1,'fin-bar-out']])add('rect',{x:x(d.day)+offset,y:y(value),height:Math.max(0,y(0)-y(value)),width:bar,rx:2,class:cls});
   }
   const hit=add('rect',{x:left,y:top,width:width-left-right,height:bottom-top,fill:'transparent'});
   const show=event=>{const rect=svg.getBoundingClientRect(),local=(event.clientX-rect.left)*width/rect.width;const day=Math.max(1,Math.min(data.length,Math.round(1+(local-left-5)/(width-left-right-10)*(data.length-1))));const d=data[day-1];detail.textContent='Dia '+day+' · '+(kind==='net'?'Acumulado '+money(d.net,currency):'Entradas '+money(d.incoming,currency)+' · Saídas '+money(d.outgoing,currency));};
   hit.onpointermove=show;hit.onclick=show;plot.replaceChildren(svg);
  }
  const dayLabel=node('label',undefined,'fin-chart-day');dayLabel.append(node('span','Dia do gráfico','sr-only'));const daySelect=node('select');daySelect.setAttribute('aria-label',kind==='net'?'Dia do movimento acumulado':'Dia das entradas e saídas');daySelect.append(new Option('Detalhar dia',''));for(const d of data)daySelect.append(new Option(String(d.day).padStart(2,'0'),String(d.day)));daySelect.onchange=()=>{const d=data[Number(daySelect.value)-1];if(d)detail.textContent='Dia '+d.day+' · '+(kind==='net'?'Acumulado '+money(d.net,currency):'Entradas '+money(d.incoming,currency)+' · Saídas '+money(d.outgoing,currency));};dayLabel.append(daySelect);box.append(dayLabel);
  const observer=new ResizeObserver(draw);observer.observe(plot);chartObservers.push(observer);return box;
 }

 function render(){
  chartObservers.splice(0).forEach(observer=>observer.disconnect());
  const root=host();if(!root)return;
  const focus=root.contains(document.activeElement)?document.activeElement?.dataset.focus:null,caret=focus==='search'?document.activeElement.selectionStart:null;
  root.replaceChildren();root.classList.add('fin');root.setAttribute('aria-busy',String(loading));
  const top=node('div',undefined,'fin-top'),hint=node('div',undefined,'fin-save-state');hint.setAttribute('role','status');hint.append(createIcon(busy?'clock':'database'),node('span',busy?message:loading?'Carregando dados salvos…':accounts().some(a=>a.snapshot)?'Salvo no Core':'Sem extratos salvos neste período'));
  const actions=node('div',undefined,'fin-actions'),periodLabel=node('label',undefined,'fin-period');periodLabel.append(node('span','Período','sr-only'));
  const period=node('input');period.type='month';period.min='2000-01';period.max='2099-12';period.value=month;period.disabled=busy||loading;
  period.onchange=()=>{if(!/^20\d{2}-(0[1-9]|1[0-2])$/.test(period.value))return;month=period.value;board=null;page=0;persist();load();};periodLabel.append(period);
  const update=button(busy?'Atualizando…':'Atualizar dados',()=>refresh(true),'cloud','fin-button fin-primary');update.disabled=busy||loading||!board;
  const accountLabel=node('label',undefined,'fin-account-filter');accountLabel.append(node('span','Conta','sr-only'));const accountSelect=node('select');accountSelect.append(new Option('Todas as contas','all'));for(const a of accounts())accountSelect.append(new Option((a.name||'Conta')+' · '+a.connection,a.id));accountSelect.value=selected;accountSelect.onchange=()=>{selected=accountSelect.value;page=0;persist();render();};accountLabel.append(accountSelect);
  actions.append(accountLabel,periodLabel,update);top.append(actions,hint);root.append(top);
  if(accounts().length){const institutions=node('div',undefined,'fin-institutions');institutions.setAttribute('aria-label','Instituições das contas selecionadas');for(const name of new Set(picked().map(a=>paymentInstitution(a.bank).name)))institutions.append(institutionBadge(name));root.append(institutions);}
  if(error){const warning=node('div',undefined,'fin-warning');warning.setAttribute('role','alert');warning.append(createIcon('alert'),node('span',message),button('Tentar novamente',()=>board?refresh(true):load()));root.append(warning);}
  if(!board){root.append(node('div',loading?'Buscando seu financeiro salvo…':'Seus dados não foram apagados. Tente carregar novamente.','fin-empty'));return;}
  if(!board.connections.length){root.append(node('div','Conecte seus itens Meu Pluggy na configuração do backend para começar.','fin-empty'));return;}
  const strip=node('div',undefined,'fin-accounts');strip.setAttribute('aria-label','Filtrar por conta');
  const all=button('Todas as contas',()=>{selected='all';page=0;persist();render();},'layers','fin-account-card');all.setAttribute('aria-pressed',String(selected==='all'));all.append(node('small',`${accounts().length} contas conectadas`));strip.append(all);
  for(const account of accounts()){
   const card=button('',()=>{selected=account.id;page=0;persist();render();},undefined,'fin-account-card');card.setAttribute('aria-pressed',String(selected===account.id));
   const label=node('span',undefined,'fin-account-title');label.append(createIcon(account.type==='CREDIT'?'library':'database'),node('span',account.name||'Conta vinculada'));
   card.append(institutionBadge(account.bank),label,node('strong',money(account.balance,account.currency)),node('small',`${account.type==='CREDIT'?'Cartão':'Conta bancária'} · conexão ${account.connection}`));
   card.append(node('span',account.attempt?.payload.state==='error'?'Atualização pendente':account.snapshot?'Extrato salvo':'Aguardando importação','fin-account-state'));strip.append(card);
  }
  const rows=periodRows(picked(),month),summary=cashSummary(picked(),rows,currency),metrics=node('div',undefined,'fin-metrics');
  const usable=picked().some(a=>a.type==='BANK'&&a.currency===currency&&a.snapshot);
  const balance=bankBalance(picked(),currency);
  for(const [title,amount,help]of [['Saldo em contas',balance,'Último saldo consultado · cartões excluídos'],['Entradas',usable?summary.incoming:null,'Efetivadas no período'],['Saídas',usable?summary.outgoing:null,'Inclui transferências não conciliadas']]){const card=node('article',undefined,'fin-metric');card.append(node('span',title),node('strong',money(amount,currency)),node('small',help));metrics.append(card);}root.append(metrics);
  root.append(salesPanel());
  const caption=node('div',undefined,'fin-scope'),complete=picked().filter(a=>a.snapshot).length;
  caption.append(node('span',`Movimentações efetivadas de contas bancárias · ${complete}/${picked().length} extratos salvos · não representa receita ou lucro.`));
  const currencyLabel=node('label');currencyLabel.append(node('span','Moeda dos indicadores','sr-only'));const currencySelect=node('select');for(const value of [...new Set(accounts().map(a=>a.currency).filter(Boolean))])currencySelect.append(new Option(value,value));currencySelect.value=currency;currencySelect.onchange=()=>{currency=currencySelect.value;render();};currencyLabel.append(currencySelect);caption.append(currencyLabel);root.append(caption);
  if(usable){root.append(chart(summary,'net'));const secondary=node('div',undefined,'fin-secondary');const categories=node('section',undefined,'fin-categories');categories.append(node('h3','Saídas por categoria'),node('p','Não categorizado','fin-category-label'),node('strong',money(summary.outgoing,currency)),node('div',undefined,'fin-category-track'),node('p','Classificação ainda não integrada. Nenhuma categoria foi inferida.','fin-muted'));secondary.append(chart(summary),categories);root.append(secondary);}else root.append(node('p','Selecione uma conta bancária com extrato salvo para ver os gráficos.','fin-empty'));
  const panel=node('section',undefined,'fin-ledger'),title=node('div',undefined,'fin-section-title');title.append(node('h2','Transações'));
  const latest=picked().map(a=>a.snapshot?.updated_at).filter(Boolean).sort().at(-1);title.append(node('span','Última gravação '+timestamp(latest),'fin-muted'));panel.append(title);
  const controls=node('div',undefined,'fin-filters'),searchLabel=node('label',undefined,'fin-search');searchLabel.append(createIcon('search'),node('span','Buscar transação','sr-only'));
  const input=node('input');input.type='search';input.placeholder='Buscar descrição ou conta…';input.value=search;input.dataset.focus='search';input.oninput=()=>{search=input.value;page=0;render();};searchLabel.append(input);
  const filterLabel=node('label');filterLabel.append(node('span','Tipo de movimentação','sr-only'));const filter=node('select');for(const [value,text]of [['all','Todos os tipos'],['CREDIT','Entradas'],['DEBIT','Saídas']])filter.append(new Option(text,value));filter.value=direction;filter.onchange=()=>{direction=filter.value;page=0;render();};filterLabel.append(filter);controls.append(searchLabel,filterLabel);panel.append(controls);
  const filtered=rows.filter(row=>(direction==='all'||row.type===direction)&&`${row.description} ${row.account_name} ${row.bank||''}`.toLocaleLowerCase('pt-BR').includes(search.toLocaleLowerCase('pt-BR')));
  const totalPages=Math.max(1,Math.ceil(filtered.length/30));page=Math.min(page,totalPages-1);
  const wrap=node('div',undefined,'fin-table-wrap'),table=node('table');table.append(node('caption','Extrato consolidado · '+month,'sr-only'));
  const head=node('thead'),tr=node('tr');for(const text of ['Data','Descrição','Conta','Situação','Valor']){const th=node('th',text);th.scope='col';tr.append(th);}head.append(tr);table.append(head);const body=node('tbody');
  for(const row of filtered.slice(page*30,(page+1)*30)){
   const tr=node('tr'),description=node('td',undefined,'fin-description');const toggle=button(row.description||'Sem descrição',()=>{extra.hidden=!extra.hidden;toggle.setAttribute('aria-expanded',String(!extra.hidden));},undefined,'fin-transaction-button');toggle.setAttribute('aria-expanded','false');const extra=node('div',undefined,'fin-transaction-detail');extra.hidden=true;extra.append(node('p',row.account_name+' · '+timestamp(row.date)),node('p','Moeda: '+row.currency+' · '+(row.status==='POSTED'?'Efetivada':row.status==='PENDING'?'Pendente':row.status||'Situação indisponível')));description.append(toggle,node('small',row.type==='CREDIT'?'Entrada':row.type==='DEBIT'?'Saída':'Movimentação'),extra);
   const value=node('td',money(row.amount,row.currency),'fin-value'+(row.type==='CREDIT'?' fin-positive':'')),state=node('td');state.append(node('span',row.status==='POSTED'?'Efetivada':row.status==='PENDING'?'Pendente':row.status||'Indisponível','fin-badge'));
   extra.prepend(institutionBadge(row.bank));
   const accountCell=node('td',undefined,'fin-account-column');accountCell.append(institutionBadge(row.bank),node('span',row.account_name,'fin-account-name'));
   tr.append(node('td',shortDate(row.date),'fin-date'),description,accountCell,state,value);body.append(tr);
  }table.append(body);wrap.append(table);panel.append(wrap);
  if(!filtered.length)panel.append(node('div',loading||busy?'Preparando seus extratos…':rows.length?'Nenhuma transação corresponde aos filtros.':complete<picked().length?'Alguns extratos ainda não foram importados. Seus dados salvos continuam disponíveis.':'Nenhuma movimentação neste período.','fin-empty'));
  const footer=node('div',undefined,'fin-footer');footer.append(node('span',`${filtered.length} ${filtered.length===1?'transação':'transações'} · horários de Brasília`));
  const pager=node('div',undefined,'fin-pager'),previous=button('Anterior',()=>{page--;render();}),next=button('Próxima',()=>{page++;render();});previous.disabled=page===0;next.disabled=page>=totalPages-1;pager.append(previous,node('span',`${page+1} / ${totalPages}`),next);footer.append(pager);panel.append(footer);root.append(panel);
  const details=node('details',undefined,'fin-details');details.append(node('summary','Contas e conexões · '+accounts().length+' contas'),strip);
  for(const c of board.connections){const connection=node('div',undefined,'fin-connection');connection.append(institutionBadge(c.payload?.bank),node('span',`Conexão ${c.connection} · consulta ${timestamp(c.updated_at)} · atualização informada pelo banco ${timestamp(c.payload?.bank_updated_at)}`));details.append(connection);}
  details.append(node('p','Os dados ficam no banco do Core. Ao abrir, meses já importados são reutilizados; o mês atual é atualizado após 12 horas. Cartões e moedas diferentes não são somados nos indicadores.'));
  if(board.saved_months?.length)details.append(node('p','Períodos salvos: '+board.saved_months.join(', ')));root.append(details);
  if(focus){const input=root.querySelector(`[data-focus="${focus}"]`);input?.focus({preventScroll:true});if(caret!==null)input?.setSelectionRange(caret,caret);}
 }
 return{load,clear(){chartObservers.splice(0).forEach(observer=>observer.disconnect());generation++;board=null;sales=null;busy=false;loading=false;message='';search='';page=0;host()?.replaceChildren();}};
}
