import {createIcon,paymentInstitutionIcon,providerLogo} from './icons.js';
import {brazilMonth,brazilDay,brazilYear,matchesPeriod,periodRows,cashSummary,needsRefresh,bankBalance,movementSeries,paymentInstitution} from './finance-model.js';

const node=(tag,text,cls)=>{const n=document.createElement(tag);if(text!==undefined)n.textContent=text;if(cls)n.className=cls;return n;};
const money=(value,currency='BRL')=>{if(!Number.isFinite(value))return '—';try{return new Intl.NumberFormat('pt-BR',{style:'currency',currency}).format(value);}catch{return `${value} ${currency}`;}};
const shortDate=value=>new Intl.DateTimeFormat('pt-BR',{timeZone:'America/Sao_Paulo',day:'2-digit',month:'short'}).format(new Date(value));
const timestamp=value=>value?new Date(value).toLocaleString('pt-BR',{timeZone:'America/Sao_Paulo',day:'2-digit',month:'2-digit',hour:'2-digit',minute:'2-digit'}):'Ainda não importado';
const storageKey='core.finance.filters.v2';
const svgNode=(tag,attrs)=>{const n=document.createElementNS('http://www.w3.org/2000/svg',tag);for(const [key,value]of Object.entries(attrs))n.setAttribute(key,String(value));return n;};
const institutionBadge=bank=>{const identity=paymentInstitution(bank),badge=node('span',undefined,'fin-institution'),icon=node('span',undefined,'fin-institution-icon');badge.style.setProperty('--institution-color',identity.color);icon.append(identity.logo?providerLogo(identity.logo):paymentInstitutionIcon());badge.append(icon,node('span',identity.name));return badge;};
const processorBadge=name=>{const stripe=name==='stripe',badge=node('span',undefined,'fin-processor'),mark=node('span',undefined,'fin-processor-mark '+(stripe?'is-stripe':'is-asaas'));mark.append(providerLogo(stripe?'stripe':'asaas'));badge.append(mark,node('span',stripe?'Stripe':'Asaas'));return badge;};

export function setupFinance({api}){
 let generation=0,board=null,sales=null,forecast=null,busy=false,loading=false,message='',error=false,page=0,search='',daySearch='',showForecastForm=false;
 let periodMode='month'; // 'month' | 'year' | 'day' | 'custom'
 let month=brazilMonth(Date.now()),year=brazilYear(Date.now()),day=brazilDay(Date.now());
 let customStart=brazilMonth(Date.now())+'-01',customEnd=day;
 let selected='all',currency='BRL',direction='all',accountType='all';

 try{
  const saved=JSON.parse(localStorage.getItem(storageKey)||'null');
  if(['month','year','day','custom'].includes(saved?.periodMode))periodMode=saved.periodMode;
  if(/^20\d{2}-(0[1-9]|1[0-2])$/.test(saved?.month))month=saved.month;
  if(/^20\d{2}$/.test(saved?.year))year=saved.year;
  if(/^20\d{2}-\d{2}-\d{2}$/.test(saved?.day))day=saved.day;
  if(/^20\d{2}-\d{2}-\d{2}$/.test(saved?.customStart))customStart=saved.customStart;
  if(/^20\d{2}-\d{2}-\d{2}$/.test(saved?.customEnd))customEnd=saved.customEnd;
  if(typeof saved?.account==='string')selected=saved.account;
 }catch{}

 const host=()=>document.getElementById('view-finance');
 const persist=()=>{
  try{
   localStorage.setItem(storageKey,JSON.stringify({periodMode,month,year,day,customStart,customEnd,account:selected}));
  }catch{}
 };

 function apiPeriodParams(){
  if(periodMode==='year')return {year};
  if(periodMode==='day')return {month:day.slice(0,7)};
  if(periodMode==='custom')return {from:customStart,to:customEnd};
  return {month};
 }

 function currentPeriodFilter(){
  if(periodMode==='year')return {mode:'year',year};
  if(periodMode==='day')return {mode:'day',day};
  if(periodMode==='custom')return {mode:'custom',start:customStart,end:customEnd};
  return {mode:'month',month};
 }

 function currentPeriodLabel(){
  if(periodMode==='year')return 'Ano '+year;
  if(periodMode==='day'){
   const [y,m,d]=day.split('-');
   return `${d}/${m}/${y}`;
  }
  if(periodMode==='custom'){
   const [sy,sm,sd]=customStart.split('-'),[ey,em,ed]=customEnd.split('-');
   return `${sd}/${sm}/${sy} a ${ed}/${em}/${ey}`;
  }
  const [y,m]=month.split('-');
  const dateObj=new Date(Date.UTC(Number(y),Number(m)-1,15));
  return dateObj.toLocaleDateString('pt-BR',{month:'long',year:'numeric',timeZone:'UTC'});
 }

 const accounts=()=>board?.accounts||[];
 const picked=()=>accounts().filter(a=>(selected==='all'||a.id===selected)&&(accountType==='all'||a.type===accountType));
 const button=(text,action,icon,cls='fin-button')=>{const b=node('button',undefined,cls);b.type='button';if(icon)b.append(createIcon(icon));b.append(document.createTextNode(text));b.onclick=action;return b;};
 const readBoard=()=>api('/api/finance/board?'+new URLSearchParams(apiPeriodParams()));
 const readSales=()=>api('/api/finance/sales?'+new URLSearchParams(apiPeriodParams()));
 const readForecast=()=>api('/api/finance/forecasts?'+new URLSearchParams(apiPeriodParams()));

 function normalize(){
  if(!accounts().some(a=>a.id===selected))selected='all';
  const currencies=[...new Set(accounts().map(a=>a.currency).filter(Boolean))];
  if(!currencies.includes(currency))currency=currencies[0]||'BRL';
 }

 async function refresh(force=false){
  if(busy||loading||!board)return;
  const ticket=generation;
  const syncMonth=periodMode==='month'?month:periodMode==='day'?day.slice(0,7):brazilMonth(Date.now());
  busy=true;error=false;message='Verificando atualizações…';render();let failed=0;
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
   const queue=accounts().filter(a=>force||needsRefresh(a.snapshot,a.attempt,syncMonth));
   for(const [index,account]of queue.entries()){
    if(ticket!==generation)return;
    message=`Atualizando extratos · ${index+1} de ${queue.length}`;render();
    try{const result=await api('/api/finance/transactions/sync','POST',{account_id:account.id,month:syncMonth});if(ticket!==generation)return;account.snapshot=result.snapshot;account.attempt={payload:{state:'ok'},updated_at:new Date().toISOString()};}
    catch{if(ticket!==generation)return;failed++;account.attempt={payload:{state:'error'},updated_at:new Date().toISOString()};}
   }
   const salesSaved=Object.values(sales?.providers||{}).map(p=>p.snapshot?.updated_at).filter(Boolean).sort().at(-1);
   if(force||!salesSaved||syncMonth===brazilMonth(Date.now())&&Date.now()-Date.parse(salesSaved)>=43200000){
    message='Atualizando vendas Stripe e Asaas…';render();
    const result=await api('/api/finance/sales/sync','POST',{month:syncMonth});if(ticket!==generation)return;
    sales={month:result.month,configured:result.configured,providers:result.providers};
    failed+=result.results.filter(r=>r.configured&& !r.ok).length;
   }
   failed=Math.max(failed,accounts().filter(a=>a.attempt?.payload.state==='error').length,board.connections.filter(c=>c.attempt?.payload.state==='error').length);
   if(accounts().some(a=>a.snapshot))board.saved_months=[...new Set([...(board.saved_months||[]),syncMonth])].sort().reverse();
   message=failed?'Parte dos dados não pôde ser atualizada. O que já estava salvo continua disponível.':'Dados salvos no Core.';error=failed>0;
  }catch(e){if(ticket===generation){message=e.message;error=true;}}
  finally{if(ticket===generation){busy=false;render();}}
 }

 async function load(){
  const ticket=++generation;loading=true;busy=false;error=false;message='';render();
  try{const [data,paymentData,forecastData]=await Promise.all([readBoard(),readSales(),readForecast().catch(()=>null)]);if(ticket!==generation)return;board=data;sales=paymentData;forecast=forecastData;normalize();persist();}
  catch(e){if(ticket===generation){error=true;message='Não foi possível ler os dados salvos. '+e.message;}}
  finally{if(ticket===generation){loading=false;render();}}
  if(ticket===generation&&!error)await refresh(false);
 }

 function salesPanel(){
  const section=node('section',undefined,'fin-sales'),title=node('div',undefined,'fin-sales-head'),heading=node('div');heading.append(node('span','RECEBÍVEIS','fin-eyebrow'),node('h2','Vendas por processador'),node('p','Cobranças trazidas diretamente das APIs, sem duplicar os repasses que aparecem nos bancos.'));title.append(heading,node('span','Somente leitura','fin-readonly'));section.append(title);
  const providers=sales?.providers||{},allSales=Object.values(providers).flatMap(p=>p.snapshot?.payload?.sales||[]).sort((a,b)=>Date.parse(b.date)-Date.parse(a.date));
  const rows=allSales.filter(sale=>matchesPeriod(sale.date,currentPeriodFilter()));
  const received=rows.filter(r=>r.status==='received'),gross=received.reduce((n,r)=>n+(r.currency==='BRL'&&Number.isFinite(r.gross)?r.gross:0),0),fees=received.reduce((n,r)=>n+(r.currency==='BRL'&&Number.isFinite(r.fee)?r.fee:0),0),net=received.reduce((n,r)=>n+(r.currency==='BRL'&&Number.isFinite(r.net)?r.net:0),0);
  const metrics=node('div',undefined,'fin-sales-metrics');for(const [label,value,help,kind]of [['Vendas recebidas',gross,'Total bruto confirmado em BRL','gross'],['Taxas',fees,'Custos informados pelos processadores','fees'],['Líquido',net,'Sem incluir repasses bancários','net']]){const card=node('article',undefined,'fin-sales-metric '+kind);card.append(node('span',label),node('strong',money(value)),node('small',help));metrics.append(card);}section.append(metrics);
  const status=node('div',undefined,'fin-processors');for(const name of ['stripe','asaas']){const configured=sales?.configured?.[name],snapshot=providers[name]?.snapshot,attempt=providers[name]?.attempt,state=!configured?'Não configurado':attempt?.payload?.state==='error'?'Falha na atualização':snapshot?`${snapshot.payload.sales.length} ${snapshot.payload.sales.length===1?'venda':'vendas'}`:'Aguardando sincronização',card=node('div',undefined,'fin-processor-card '+(!configured?'is-muted':attempt?.payload?.state==='error'?'is-error':'is-ready'));card.append(processorBadge(name),node('span',state,'fin-processor-state'));status.append(card);}section.append(status);
  const wrap=node('div',undefined,'fin-table-wrap fin-sales-table-wrap'),table=node('table');table.className='fin-sales-table';const head=node('thead'),header=node('tr');for(const text of ['Data','Processador','Descrição','Situação','Bruto','Taxa','Líquido']){const th=node('th',text);th.scope='col';header.append(th);}head.append(header);table.append(head);const body=node('tbody');
  const labels={received:'Recebida',pending:'Pendente',refunded:'Estornada',partial_refund:'Estorno parcial',failed:'Falhou'};
  for(const sale of rows){const tr=node('tr'),provider=node('td');provider.className='fin-sale-provider';provider.append(processorBadge(sale.provider));const state=node('td');state.className='fin-sale-state';state.append(node('span',labels[sale.status]||'Indisponível','fin-status fin-status-'+sale.status));tr.append(node('td',shortDate(sale.date),'fin-date'),provider,node('td',sale.description||'Venda','fin-description'),state,node('td',money(sale.gross,sale.currency),'fin-value fin-sale-gross'),node('td',money(sale.fee,sale.currency),'fin-value fin-sale-fee'),node('td',money(sale.net,sale.currency),'fin-value fin-positive fin-sale-net'));body.append(tr);}table.append(body);wrap.append(table);section.append(wrap);
  if(!rows.length)section.append(node('div',sales?.configured?.stripe||sales?.configured?.asaas?'Nenhuma venda importada neste período ('+currentPeriodLabel()+').':'Configure uma chave Stripe ou Asaas no backend.','fin-empty'));
  const latest=Object.values(providers).map(p=>p.snapshot?.updated_at).filter(Boolean).sort().at(-1),footer=node('div',undefined,'fin-footer fin-sales-footer');footer.append(node('span',`${rows.length} ${rows.length===1?'venda':'vendas'} · ${currentPeriodLabel()}`),node('span','Última gravação '+timestamp(latest)));section.append(footer);return section;
 }

 const chartObservers=[];
 function chart(summary,kind='flow'){
  const box=node('section',undefined,'fin-chart '+(kind==='net'?'fin-chart-main':'')),heading=node('div',undefined,'fin-section-title');
  heading.append(node('h3',kind==='net'?'Movimento acumulado':'Entradas e saídas'));
  if(kind==='flow'){const legend=node('div',undefined,'fin-legend');legend.append(node('span','Entradas','fin-in'),node('span','Saídas','fin-out'));heading.append(legend);}
  else heading.append(node('span','Variação no período ('+currentPeriodLabel()+') · não é saldo histórico','fin-muted'));
  const plot=node('div',undefined,'fin-plot'),detail=node('p','Selecione um ponto no gráfico para ver os valores.','fin-chart-detail');detail.setAttribute('aria-live','polite');box.append(heading,plot,detail);
  const data=movementSeries(summary,currentPeriodFilter());
  function draw(){
   const width=Math.max(260,plot.clientWidth),height=kind==='net'?225:180,left=64,right=20,top=20,bottom=height-32;
   const values=kind==='net'?data.map(d=>d.net):data.flatMap(d=>[d.incoming,d.outgoing]);
   const low=Math.min(0,...values),high=Math.max(1,...values),padding=(high-low)*.08;
   const min=low<0?low-padding:0,max=high+padding;
   const x=day=>data.length>1?left+5+(day-1)/(data.length-1)*(width-left-right-10):left+(width-left-right)/2;
   const y=v=>bottom-(v-min)/(max-min)*(bottom-top);
   const svg=svgNode('svg',{viewBox:'0 0 '+width+' '+height,height,role:'img','aria-label':kind==='net'?'Variação acumulada no período em '+currency:'Entradas e saídas em '+currency});
   const add=(tag,attrs,text)=>{const n=svgNode(tag,attrs);if(text!==undefined)n.textContent=text;svg.append(n);return n;};
   for(let i=0;i<3;i++){const v=min+(max-min)*i/2;add('line',{x1:left,x2:width-right,y1:y(v),y2:y(v),class:'fin-gridline'});add('text',{x:left-8,y:y(v)+4,'text-anchor':'end',class:'fin-axis'},new Intl.NumberFormat('pt-BR',{notation:'compact',maximumFractionDigits:1}).format(v));}
   add('text',{x:5,y:12,class:'fin-axis'},currency);

   if(data.length>1){
    const ticks=[1,Math.ceil(data.length/2),data.length];
    for(const idx of ticks){
     const d=data[idx-1],label=d?.label||String(idx).padStart(2,'0');
     add('text',{x:x(idx),y:height-8,'text-anchor':idx===1?'start':idx===data.length?'end':'middle',class:'fin-axis'},label);
    }
   }else if(data.length===1){
    add('text',{x:x(1),y:height-8,'text-anchor':'middle',class:'fin-axis'},data[0].label||'01');
   }

   if(kind==='net'){
    const path=data.map((d,i)=>(i?'L':'M')+x(d.day)+','+y(d.net)).join(' ');
    if(data.length>1){
     add('path',{d:path+' L'+x(data.length)+','+y(0)+' L'+x(1)+','+y(0)+' Z',class:'fin-area'});
    }
    add('path',{d:path,fill:'none',class:'fin-line'});
   }else{
    const bar=Math.max(2,(width-left-right-10)/(Math.max(1,data.length)*2.8));
    for(const d of data)for(const [value,offset,cls]of [[d.incoming,-bar,'fin-bar-in'],[d.outgoing,1,'fin-bar-out']])add('rect',{x:x(d.day)+offset,y:y(value),height:Math.max(0,y(0)-y(value)),width:bar,rx:2,class:cls});
   }
   const hit=add('rect',{x:left,y:top,width:width-left-right,height:bottom-top,fill:'transparent'});
   const show=event=>{
    if(!data.length)return;
    const rect=svg.getBoundingClientRect(),local=(event.clientX-rect.left)*width/rect.width;
    const day=data.length>1?Math.max(1,Math.min(data.length,Math.round(1+(local-left-5)/(width-left-right-10)*(data.length-1)))):1;
    const d=data[day-1];
    if(!d)return;
    const prefix=periodMode==='year'?'Mês '+(d.label||d.day):periodMode==='custom'?'Data '+(d.label||d.day):periodMode==='day'?'Dia '+(d.label||d.day):'Dia '+d.day;
    detail.textContent=prefix+' · '+(kind==='net'?'Acumulado '+money(d.net,currency):'Entradas '+money(d.incoming,currency)+' · Saídas '+money(d.outgoing,currency));
   };
   hit.onpointermove=show;hit.onclick=show;plot.replaceChildren(svg);
  }
  const dayLabel=node('label',undefined,'fin-chart-day');dayLabel.append(node('span','Ponto do gráfico','sr-only'));const daySelect=node('select');daySelect.setAttribute('aria-label',kind==='net'?'Ponto do movimento acumulado':'Ponto das entradas e saídas');daySelect.append(new Option('Detalhar ponto',''));
  for(const d of data)daySelect.append(new Option(d.label||String(d.day).padStart(2,'0'),String(d.day)));
  daySelect.onchange=()=>{
   const d=data[Number(daySelect.value)-1];
   if(d){
    const prefix=periodMode==='year'?'Mês '+(d.label||d.day):periodMode==='custom'?'Data '+(d.label||d.day):periodMode==='day'?'Dia '+(d.label||d.day):'Dia '+d.day;
    detail.textContent=prefix+' · '+(kind==='net'?'Acumulado '+money(d.net,currency):'Entradas '+money(d.incoming,currency)+' · Saídas '+money(d.outgoing,currency));
   }
  };
  dayLabel.append(daySelect);box.append(dayLabel);
  const observer=new ResizeObserver(draw);observer.observe(plot);chartObservers.push(observer);return box;
 }

 function render(){
  chartObservers.splice(0).forEach(observer=>observer.disconnect());
  const root=host();if(!root)return;
  const focus=root.contains(document.activeElement)?document.activeElement?.dataset.focus:null,caret=focus==='search'?document.activeElement.selectionStart:null;
  root.replaceChildren();root.classList.add('fin');root.setAttribute('aria-busy',String(loading));

  const top=node('div',undefined,'fin-top'),hint=node('div',undefined,'fin-save-state');hint.setAttribute('role','status');
  hint.append(createIcon(busy?'clock':'database'),node('span',busy?message:loading?'Carregando dados salvos…':accounts().some(a=>a.snapshot)?'Salvo no Core':'Sem extratos salvos neste período'));

  const actions=node('div',undefined,'fin-actions');

  const accountLabel=node('label',undefined,'fin-account-filter');accountLabel.append(node('span','Conta','sr-only'));
  const accountSelect=node('select');accountSelect.append(new Option('Todas as contas','all'));
  for(const a of accounts())accountSelect.append(new Option((a.bank||a.name||'Conta')+' · '+(a.type==='CREDIT'?'Cartão':'Conta'),a.id));
  accountSelect.value=selected;accountSelect.onchange=()=>{selected=accountSelect.value;page=0;persist();render();};
  accountLabel.append(accountSelect);

  const typeLabel=node('label',undefined,'fin-account-filter');typeLabel.append(node('span','Origem','sr-only'));
  const typeSelect=node('select');
  for(const [value,label] of [['all','Contas e cartões'],['BANK','Somente contas'],['CREDIT','Somente cartões']])typeSelect.append(new Option(label,value));
  typeSelect.value=accountType;typeSelect.onchange=()=>{accountType=typeSelect.value;selected='all';page=0;render();};
  typeLabel.append(typeSelect);

  // Period Controls
  const periodWrap=node('div',undefined,'fin-period-wrap');
  const modeLabel=node('label',undefined,'fin-mode-filter');modeLabel.append(node('span','Tipo de período','sr-only'));
  const modeSelect=node('select',undefined,'fin-period-type');
  for(const [val,label] of [['month','Por mês'],['year','Por ano'],['day','Por dia'],['custom','Personalizado']]){
   modeSelect.append(new Option(label,val));
  }
  modeSelect.value=periodMode;
  modeSelect.onchange=()=>{
   periodMode=modeSelect.value;
   board=null;page=0;persist();load();
  };
  modeLabel.append(modeSelect);
  periodWrap.append(modeLabel);

  if(periodMode==='month'){
   const periodLabel=node('label',undefined,'fin-period');periodLabel.append(node('span','Mês','sr-only'));
   const period=node('input');period.type='month';period.min='2000-01';period.max='2099-12';period.value=month;period.disabled=busy||loading;
   period.onchange=()=>{if(!/^20\d{2}-(0[1-9]|1[0-2])$/.test(period.value))return;month=period.value;board=null;page=0;persist();load();};
   periodLabel.append(period);
   periodWrap.append(periodLabel);
  }else if(periodMode==='year'){
   const yearLabel=node('label',undefined,'fin-period');yearLabel.append(node('span','Ano','sr-only'));
   const yearSelect=node('select');yearSelect.disabled=busy||loading;
   const currentYr=Number(new Date().getFullYear());
   const yearOptions=new Set([currentYr-3,currentYr-2,currentYr-1,currentYr,currentYr+1]);
   if(board?.saved_months){for(const m of board.saved_months)yearOptions.add(Number(m.slice(0,4)));}
   for(const y of [...yearOptions].sort().reverse())yearSelect.append(new Option(String(y),String(y)));
   yearSelect.value=year;
   yearSelect.onchange=()=>{if(!/^20\d{2}$/.test(yearSelect.value))return;year=yearSelect.value;board=null;page=0;persist();load();};
   yearLabel.append(yearSelect);
   periodWrap.append(yearLabel);
  }else if(periodMode==='day'){
   const dayLabel=node('label',undefined,'fin-period');dayLabel.append(node('span','Dia','sr-only'));
   const dayInput=node('input');dayInput.type='date';dayInput.value=day;dayInput.disabled=busy||loading;
   dayInput.onchange=()=>{if(!/^\d{4}-\d{2}-\d{2}$/.test(dayInput.value))return;day=dayInput.value;board=null;page=0;persist();load();};
   dayLabel.append(dayInput);
   periodWrap.append(dayLabel);
  }else if(periodMode==='custom'){
   const rangeWrap=node('div',undefined,'fin-custom-range');
   const startLabel=node('label',undefined,'fin-custom-date');startLabel.append(node('span','De:','fin-label-text'));
   const startInput=node('input');startInput.type='date';startInput.value=customStart;startInput.disabled=busy||loading;
   startLabel.append(startInput);
   const endLabel=node('label',undefined,'fin-custom-date');endLabel.append(node('span','Até:','fin-label-text'));
   const endInput=node('input');endInput.type='date';endInput.value=customEnd;endInput.disabled=busy||loading;
   endLabel.append(endInput);
   const applyBtn=button('Filtrar',()=>{
    if(!startInput.value||!endInput.value)return;
    customStart=startInput.value;customEnd=endInput.value;
    board=null;page=0;persist();load();
   },undefined,'fin-button fin-apply');
   rangeWrap.append(startLabel,endLabel,applyBtn);
   periodWrap.append(rangeWrap);
  }

  const update=button(busy?'Atualizando…':'Atualizar dados',()=>refresh(true),'cloud','fin-button fin-primary');
  update.disabled=busy||loading||!board;

  actions.append(accountLabel,typeLabel,periodWrap,update);
  top.append(actions,hint);root.append(top);

  if(accounts().length){const institutions=node('div',undefined,'fin-institutions');institutions.setAttribute('aria-label','Instituições das contas selecionadas');for(const name of new Set(picked().map(a=>paymentInstitution(a.bank).name)))institutions.append(institutionBadge(name));root.append(institutions);}
  if(error){const warning=node('div',undefined,'fin-warning');warning.setAttribute('role','alert');warning.append(createIcon('alert'),node('span',message),button('Tentar novamente',()=>board?refresh(true):load()));root.append(warning);}
  if(!board){root.append(node('div',loading?'Buscando seu financeiro salvo…':'Seus dados não foram apagados. Tente carregar novamente.','fin-empty'));return;}
  if(!board.connections.length){root.append(node('div','Conecte suas contas bancárias na configuração do backend para começar.','fin-empty'));return;}

  const strip=node('div',undefined,'fin-accounts');strip.setAttribute('aria-label','Filtrar por conta');
  const all=button('Todas as contas',()=>{selected='all';page=0;persist();render();},'layers','fin-account-card');all.setAttribute('aria-pressed',String(selected==='all'));all.append(node('small',`${accounts().length} contas conectadas`));strip.append(all);
  for(const account of accounts()){
   const card=button('',()=>{selected=account.id;page=0;persist();render();},undefined,'fin-account-card');card.setAttribute('aria-pressed',String(selected===account.id));
   const label=node('span',undefined,'fin-account-title');label.append(createIcon(account.type==='CREDIT'?'library':'database'),node('span',account.name||'Conta vinculada'));
   card.append(institutionBadge(account.bank),label,node('strong',money(account.balance,account.currency)),node('small',`${account.type==='CREDIT'?'Cartão':'Conta bancária'} · conexão ${account.connection}`));
   card.append(node('span',account.attempt?.payload.state==='error'?'Atualização pendente':account.snapshot?'Extrato salvo':'Aguardando importação','fin-account-state'));strip.append(card);
  }

  const rows=periodRows(picked(),currentPeriodFilter());
  const summary=cashSummary(picked(),rows,currency),metrics=node('div',undefined,'fin-metrics');
  const usable=picked().some(a=>a.type==='BANK'&&a.currency===currency&&a.snapshot);
  const balance=bankBalance(picked(),currency);
  for(const [title,amount,help]of [['Saldo em contas',balance,'Último saldo consultado · cartões excluídos'],['Entradas',usable?summary.incoming:null,'Efetivadas no período ('+currentPeriodLabel()+')'],['Saídas',usable?summary.outgoing:null,'Inclui transferências não conciliadas']]){const card=node('article',undefined,'fin-metric');card.append(node('span',title),node('strong',money(amount,currency)),node('small',help));metrics.append(card);}root.append(metrics);

  root.append(salesPanel());

  const projection=node('section',undefined,'fin-projection'),projectionTitle=node('div',undefined,'fin-section-title');projectionTitle.append(node('div',undefined,'fin-projection-heading'),node('span','Estimativa · não altera o extrato','fin-muted'));projectionTitle.firstChild.append(node('h2','Previsão financeira'));const addForecast=button(showForecastForm?'Fechar':'Nova previsão',()=>{showForecastForm=!showForecastForm;render();},'plus','fin-button fin-primary');projectionTitle.append(addForecast);projection.append(projectionTitle);
  if(showForecastForm){const form=node('form',undefined,'fin-forecast-form');form.innerHTML='<label>Nome<input name="name" required minlength="2" maxlength="160" placeholder="Ex.: Mensalidade Skiller"></label><label>Tipo<select name="direction"><option value="income">Receita prevista</option><option value="expense">Despesa recorrente</option></select></label><label>Valor (R$)<input name="amount" type="number" min="0.01" step="0.01" required></label><label>Recorrência<select name="recurrence"><option value="once">Uma vez</option><option value="monthly">Mensal</option><option value="quarterly">Trimestral</option><option value="yearly">Anual</option></select></label><label>Data inicial<input name="due_date" type="date" required></label><label>Tags<input name="tags" placeholder="skiller, cliente"></label><button class="primary" type="submit">Salvar previsão</button><p class="fin-muted" data-forecast-feedback></p>';form.onsubmit=async event=>{event.preventDefault();const values=Object.fromEntries(new FormData(form));const amount=Math.round(Number(values.amount)*100);const feedback=form.querySelector('[data-forecast-feedback]');if(!Number.isInteger(amount)||amount<=0){feedback.textContent='Informe um valor válido.';return;}feedback.textContent='Salvando…';try{await api('/api/finance/forecasts','POST',{name:values.name,direction:values.direction,amount_minor:amount,currency:'BRL',recurrence:values.recurrence,due_date:values.due_date,end_date:null,project_id:null,tenant_id:null,product_id:null,tags:values.tags.split(',').map(tag=>tag.trim()).filter(Boolean),source:'manual',confidence:'probable',notes:null});showForecastForm=false;forecast=await readForecast();render();}catch(error){feedback.textContent=error.message;}};projection.append(form);}
  const projectionBody=node('div',undefined,'fin-projection-grid');const income=forecast?.totals?.income||0,expense=forecast?.totals?.expense||0;for(const [label,value,help,cls] of [['Receitas previstas',income,'Contratos, assinaturas e repasses esperados','fin-positive'],['Despesas previstas',expense,'Contas recorrentes e custos cadastrados',''],['Resultado projetado',income-expense,'Antes dos repasses e conciliações finais',income-expense>=0?'fin-positive':'fin-negative']]){const card=node('article',undefined,'fin-projection-card');card.append(node('span',label),node('strong',money(value/100,currency),cls),node('small',help));projectionBody.append(card);}projection.append(projectionBody);if(forecast?.items?.length){const list=node('div',undefined,'fin-projection-list');for(const item of forecast.items.slice(0,6)){const row=node('div',undefined,'fin-projection-row');row.append(node('span',item.name),node('span',item.direction==='income'?'Receita':'Despesa','fin-muted'),node('strong',(item.direction==='income'?'+':'−')+money(item.amount_minor/100,item.currency)));list.append(row);}projection.append(list);}else projection.append(node('p','Nenhuma previsão cadastrada para este período.','fin-empty'));root.append(projection);

  const caption=node('div',undefined,'fin-scope'),complete=picked().filter(a=>a.snapshot).length;
  caption.append(node('span',`Movimentações efetivadas · ${currentPeriodLabel()} · ${complete}/${picked().length} extratos salvos · não representa receita ou lucro.`));
  const currencyLabel=node('label');currencyLabel.append(node('span','Moeda dos indicadores','sr-only'));const currencySelect=node('select');for(const value of [...new Set(accounts().map(a=>a.currency).filter(Boolean))])currencySelect.append(new Option(value,value));currencySelect.value=currency;currencySelect.onchange=()=>{currency=currencySelect.value;render();};currencyLabel.append(currencySelect);caption.append(currencyLabel);root.append(caption);

  if(usable){root.append(chart(summary,'net'));const secondary=node('div',undefined,'fin-secondary');const categories=node('section',undefined,'fin-categories');categories.append(node('h3','Saídas por categoria'),node('p','Não categorizado','fin-category-label'),node('strong',money(summary.outgoing,currency)),node('div',undefined,'fin-category-track'),node('p','Classificação ainda não integrada. Nenhuma categoria foi inferida.','fin-muted'));secondary.append(chart(summary),categories);root.append(secondary);}else root.append(node('p','Selecione uma conta bancária com extrato salvo para ver os gráficos.','fin-empty'));

  // Ledger / Transactions
  const panel=node('section',undefined,'fin-ledger'),title=node('div',undefined,'fin-section-title');title.append(node('h2','Transações'));
  const latest=picked().map(a=>a.snapshot?.updated_at).filter(Boolean).sort().at(-1);title.append(node('span','Última gravação '+timestamp(latest),'fin-muted'));panel.append(title);

  const controls=node('div',undefined,'fin-filters');

  // Search input
  const searchLabel=node('label',undefined,'fin-search');searchLabel.append(createIcon('search'),node('span','Buscar transação','sr-only'));
  const input=node('input');input.type='search';input.placeholder='Buscar descrição ou conta…';input.value=search;input.dataset.focus='search';input.oninput=()=>{search=input.value;page=0;render();};searchLabel.append(input);

  // Direction filter
  const filterLabel=node('label');filterLabel.append(node('span','Tipo de movimentação','sr-only'));
  const filter=node('select');for(const [value,text]of [['all','Todos os tipos'],['CREDIT','Entradas'],['DEBIT','Saídas']])filter.append(new Option(text,value));
  filter.value=direction;filter.onchange=()=>{direction=filter.value;page=0;render();};filterLabel.append(filter);

  // Quick Day filter inside ledger
  const dayFilterLabel=node('label',undefined,'fin-date-filter');
  dayFilterLabel.append(node('span','Dia:','fin-label-text'));
  const dayFilterInput=node('input');dayFilterInput.type='date';dayFilterInput.value=daySearch;dayFilterInput.title='Filtrar transações de um dia específico';
  dayFilterInput.onchange=()=>{daySearch=dayFilterInput.value;page=0;render();};
  dayFilterLabel.append(dayFilterInput);
  if(daySearch){
   const clearDayBtn=button('Limpar dia',()=>{daySearch='';page=0;render();},undefined,'fin-button fin-button-sm');
   dayFilterLabel.append(clearDayBtn);
  }

  controls.append(searchLabel,filterLabel,dayFilterLabel);panel.append(controls);

  const filtered=rows.filter(row=>{
   if(direction!=='all'&&row.type!==direction)return false;
   if(daySearch&&brazilDay(row.date)!==daySearch)return false;
   if(search&&!`${row.description} ${row.account_name} ${row.bank||''}`.toLocaleLowerCase('pt-BR').includes(search.toLocaleLowerCase('pt-BR')))return false;
   return true;
  });

  const totalPages=Math.max(1,Math.ceil(filtered.length/30));page=Math.min(page,totalPages-1);
  const wrap=node('div',undefined,'fin-table-wrap'),table=node('table');table.append(node('caption',`Extrato consolidado · ${currentPeriodLabel()}`,'sr-only'));
  const head=node('thead'),tr=node('tr');for(const text of ['Data','Descrição','Conta','Situação','Valor']){const th=node('th',text);th.scope='col';tr.append(th);}head.append(tr);table.append(head);const body=node('tbody');

  for(const row of filtered.slice(page*30,(page+1)*30)){
   const tr=node('tr'),description=node('td',undefined,'fin-description');const toggle=button(row.description||'Sem descrição',()=>{extra.hidden=!extra.hidden;toggle.setAttribute('aria-expanded',String(!extra.hidden));},undefined,'fin-transaction-button');toggle.setAttribute('aria-expanded','false');const extra=node('div',undefined,'fin-transaction-detail');extra.hidden=true;extra.append(node('p',row.account_name+' · '+timestamp(row.date)),node('p','Moeda: '+row.currency+' · '+(row.status==='POSTED'?'Efetivada':row.status==='PENDING'?'Pendente':row.status||'Situação indisponível')));description.append(toggle,node('small',row.type==='CREDIT'?'Entrada':row.type==='DEBIT'?'Saída':'Movimentação'),extra);
   const value=node('td',money(row.amount,row.currency),'fin-value'+(row.type==='CREDIT'?' fin-positive':'')),state=node('td');state.append(node('span',row.status==='POSTED'?'Efetivada':row.status==='PENDING'?'Pendente':row.status||'Indisponível','fin-badge'));
   extra.prepend(institutionBadge(row.bank));
   const accountCell=node('td',undefined,'fin-account-column');accountCell.append(institutionBadge(row.bank),node('span',row.account_name,'fin-account-name'));
   tr.append(node('td',shortDate(row.date),'fin-date'),description,accountCell,state,value);body.append(tr);
  }table.append(body);wrap.append(table);panel.append(wrap);

  if(!filtered.length)panel.append(node('div',loading||busy?'Preparando seus extratos…':rows.length?'Nenhuma transação corresponde aos filtros informados.':complete<picked().length?'Alguns extratos ainda não foram importados. Seus dados salvos continuam disponíveis.':`Nenhuma movimentação no período (${currentPeriodLabel()}).`,'fin-empty'));
  const footer=node('div',undefined,'fin-footer');footer.append(node('span',`${filtered.length} ${filtered.length===1?'transação':'transações'} · ${currentPeriodLabel()} · horários de Brasília`));
  const pager=node('div',undefined,'fin-pager'),previous=button('Anterior',()=>{page--;render();}),next=button('Próxima',()=>{page++;render();});previous.disabled=page===0;next.disabled=page>=totalPages-1;pager.append(previous,node('span',`${page+1} / ${totalPages}`),next);footer.append(pager);panel.append(footer);root.append(panel);

  const details=node('details',undefined,'fin-details');details.append(node('summary','Contas e conexões · '+accounts().length+' contas'),strip);
  for(const c of board.connections){const connection=node('div',undefined,'fin-connection');connection.append(institutionBadge(c.payload?.bank),node('span',`Conexão ${c.connection} · consulta ${timestamp(c.updated_at)} · atualização informada pelo banco ${timestamp(c.payload?.bank_updated_at)}`));details.append(connection);}
  details.append(node('p','Os dados ficam no banco do Core. Ao abrir, períodos já importados são reutilizados; o mês atual é atualizado após 12 horas. Cartões e moedas diferentes não são somados nos indicadores.'));
  if(board.saved_months?.length)details.append(node('p','Meses salvos no Core: '+board.saved_months.join(', ')));root.append(details);

  if(focus){const input=root.querySelector(`[data-focus="${focus}"]`);input?.focus({preventScroll:true});if(caret!==null)input?.setSelectionRange(caret,caret);}
 }

 return{
  load,
  clear(){
   chartObservers.splice(0).forEach(observer=>observer.disconnect());
   generation++;board=null;sales=null;forecast=null;busy=false;loading=false;message='';search='';daySearch='';page=0;host()?.replaceChildren();
  }
 };
}
