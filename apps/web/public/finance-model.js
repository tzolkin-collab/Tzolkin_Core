export const brazilMonth=value=>new Intl.DateTimeFormat('sv-SE',{timeZone:'America/Sao_Paulo',year:'numeric',month:'2-digit'}).format(new Date(value));
export const brazilDay=value=>new Intl.DateTimeFormat('sv-SE',{timeZone:'America/Sao_Paulo',year:'numeric',month:'2-digit',day:'2-digit'}).format(new Date(value));
export const brazilYear=value=>new Intl.DateTimeFormat('sv-SE',{timeZone:'America/Sao_Paulo',year:'numeric'}).format(new Date(value));

// Marcas empacotadas localmente, numa lista só. Três consumidores dependem
// dela: o mapa `logos` abaixo, a allowlist de icons.js e os estáticos de
// assets.mjs. Mantidas separadas, divergiriam no primeiro banco novo — e o
// sintoma seria um 404 silencioso, com o selo caindo no pictograma genérico
// como se o banco não fosse reconhecido.
// Entrar aqui exige arquivo OFICIAL. Já houve marca inventada nesta pasta —
// retângulo com o nome escrito por cima — e marca inventada é pior que marca
// ausente: a ausência cai no pictograma neutro com a cor da instituição, que
// é honesto; a invenção afirma ser o logo do banco.
//
// WIDE_LOGOS são as marcas cuja versão oficial é horizontal: Inter e Asaas não
// publicam símbolo quadrado, a marca deles é a própria palavra. Ficam separadas
// porque 20x20 as esmagaria — renderizam por altura, preservando a proporção.
export const WIDE_LOGOS=['inter','asaas','mastercard'];
export const BANK_LOGOS=['nubank','inter','asaas','mastercard','itau','bradesco','santander','bancodobrasil','caixa','c6bank','btgpactual','sicredi','sicoob','mercadopago','pagbank','picpay','stripe'];
export function paymentInstitution(bank){
 const name=typeof bank==='string'&&bank.trim()?bank.trim():'Instituição não informada';
 const key=name.normalize('NFD').replace(/[\u0300-\u036f]/g,'').toLowerCase().replace(/[^a-z0-9]/g,'');
 const colors={nubank:'#820ad1',itau:'#ad4800',bancoitau:'#ad4800',inter:'#b64d00',bancointer:'#b64d00',santander:'#c52228',bradesco:'#bc183a',bancodobrasil:'#244ba0',caixa:'#1265a0',caixaeconomicafederal:'#1265a0',mercadopago:'#007dab',pagbank:'#247449',pagseguro:'#247449',picpay:'#217a43',c6bank:'#44464d',btgpactual:'#244b73',sicredi:'#32763b',sicoob:'#006957',stripe:'#635bba',asaas:'#0030b9',paypal:'#175b91'};
 const logos={nubank:'nubank',nupagamentos:'nubank',inter:'inter',bancointer:'inter',asaas:'asaas',itau:'itau',bancoitau:'itau',
  bradesco:'bradesco',santander:'santander',bancosantander:'santander',bancodobrasil:'bancodobrasil',
  caixa:'caixa',caixaeconomicafederal:'caixa',c6bank:'c6bank',c6:'c6bank',btgpactual:'btgpactual',btg:'btgpactual',
  sicredi:'sicredi',sicoob:'sicoob',mercadopago:'mercadopago',pagbank:'pagbank',pagseguro:'pagbank',picpay:'picpay',
  stripe:'stripe',mastercard:'mastercard'};
 const palette=['#526579','#79558c','#387574','#936131','#4a6595','#796342'];
 let hash=0;for(const char of key)hash=(Math.imul(hash,31)+char.charCodeAt(0))>>>0;
 return{name,color:colors[key]||palette[hash%palette.length],logo:logos[key]||null};
}

export function matchesPeriod(date,filter){
 if(!Number.isFinite(Date.parse(date)))return false;
 if(typeof filter==='string'){
  if(/^\d{4}-\d{2}$/.test(filter))return brazilMonth(date)===filter;
  if(/^\d{4}$/.test(filter))return brazilYear(date)===filter;
  if(/^\d{4}-\d{2}-\d{2}$/.test(filter))return brazilDay(date)===filter;
  return true;
 }
 if(!filter||typeof filter!=='object')return true;
 const mode=filter.mode||(filter.start||filter.end?'custom':filter.day?'day':filter.year?'year':filter.month?'month':'all');
 if(mode==='month'&&filter.month)return brazilMonth(date)===filter.month;
 if(mode==='year'&&filter.year)return brazilYear(date)===String(filter.year);
 if(mode==='day'&&filter.day)return brazilDay(date)===filter.day;
 if(mode==='custom'){
  const d=brazilDay(date);
  return (!filter.start||d>=filter.start)&&(!filter.end||d<=filter.end);
 }
 return true;
}

export function periodRows(accounts,filter){
 const unique=new Map();
 for(const account of accounts)for(const row of account.snapshot?.payload.transactions||[]){
  if(!matchesPeriod(row.date,filter))continue;
  unique.set(account.id+':'+row.id,{...row,account_id:account.id,account_name:account.name,bank:account.bank,account_type:account.type,currency:row.currency||account.currency});
 }
 return [...unique.values()].sort((a,b)=>Date.parse(b.date)-Date.parse(a.date));
}

export function cashSummary(accounts,rows,currency){
 const ids=new Set(accounts.filter(a=>a.type==='BANK'&&a.currency===currency).map(a=>a.id));
 const daily=new Map();let incoming=0,outgoing=0;
 for(const row of rows){
  if(!ids.has(row.account_id)||row.currency!==currency||row.status!=='POSTED'||!Number.isFinite(row.amount))continue;
  if(!['CREDIT','DEBIT'].includes(row.type))continue;
  const amount=Math.abs(row.amount),day=new Intl.DateTimeFormat('sv-SE',{timeZone:'America/Sao_Paulo'}).format(new Date(row.date));
  const point=daily.get(day)||{day,incoming:0,outgoing:0};
  if(row.type==='CREDIT'){incoming+=amount;point.incoming+=amount;}else{outgoing+=amount;point.outgoing+=amount;}
  daily.set(day,point);
 }
 return{incoming,outgoing,net:incoming-outgoing,daily:[...daily.values()].sort((a,b)=>a.day.localeCompare(b.day))};
}

export function needsRefresh(snapshot,attempt,month,now=Date.now()){
 const attempted=Date.parse(attempt?.updated_at);
 if(attempt?.payload?.state!=='ok'&&Number.isFinite(attempted)&&now-attempted<600000)return false;
 if(!snapshot||snapshot.payload?.time_zone!=='America/Sao_Paulo')return true;
 const saved=Date.parse(snapshot.updated_at);
 return month===brazilMonth(now)&&(!Number.isFinite(saved)||now-saved>=43200000);
}

export function bankBalance(accounts,currency){
 const bank=accounts.filter(a=>a.type==='BANK'&&a.currency===currency);
 if(!bank.length||bank.some(a=>!Number.isFinite(a.balance)))return null;
 return bank.reduce((total,a)=>total+a.balance,0);
}

// This is net movement from zero, NOT a reconstruction of historical balance.
export function movementSeries(summary,filter){
 let net=0;
 if(typeof filter==='string'&&/^\d{4}$/.test(filter)||(filter&&typeof filter==='object'&&filter.mode==='year')){
  const yr=typeof filter==='string'?filter:String(filter.year);
  return Array.from({length:12},(_,i)=>{
   const m=String(i+1).padStart(2,'0'),prefix=yr+'-'+m;
   const points=summary.daily.filter(d=>d.day.startsWith(prefix));
   const incoming=points.reduce((s,p)=>s+p.incoming,0),outgoing=points.reduce((s,p)=>s+p.outgoing,0);
   net+=incoming-outgoing;
   return{day:i+1,label:m,net,incoming,outgoing};
  });
 }
 if(typeof filter==='string'&&/^\d{4}-\d{2}-\d{2}$/.test(filter)||(filter&&typeof filter==='object'&&filter.mode==='day')){
  const targetDay=typeof filter==='string'?filter:filter.day;
  const point=summary.daily.find(d=>d.day===targetDay);
  const incoming=point?.incoming||0,outgoing=point?.outgoing||0;
  return[{day:1,label:targetDay,net:incoming-outgoing,incoming,outgoing}];
 }
 if(filter&&typeof filter==='object'&&filter.mode==='custom'&&filter.start&&filter.end){
  const start=new Date(filter.start+'T12:00:00Z'),end=new Date(filter.end+'T12:00:00Z');
  const count=Math.max(1,Math.min(366,Math.round((end.getTime()-start.getTime())/86400000)+1));
  return Array.from({length:count},(_,i)=>{
   const cur=new Date(start.getTime()+i*86400000).toISOString().slice(0,10);
   const point=summary.daily.find(d=>d.day===cur);
   const incoming=point?.incoming||0,outgoing=point?.outgoing||0;
   net+=incoming-outgoing;
   return{day:i+1,label:cur,net,incoming,outgoing};
  });
 }
 const month=typeof filter==='string'?filter:(filter?.month||'2026-01');
 const days=new Date(Number(month.slice(0,4)),Number(month.slice(5)),0).getDate();
 return Array.from({length:days},(_,i)=>{
  const day=i+1,point=summary.daily.find(d=>Number(d.day.slice(-2))===day&&d.day.slice(0,7)===month);
  net+=(point?.incoming||0)-(point?.outgoing||0);
  return{day,net,incoming:point?.incoming||0,outgoing:point?.outgoing||0};
 });
}
