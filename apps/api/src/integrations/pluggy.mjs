import {fail} from '../platform/http.mjs';

export function createPluggy({env=process.env,fetcher=fetch,clock=Date.now}={}) {
 let key,expires=0,pending;
 async function request(path,signal) {
  if(!key || clock()>=expires) {
   pending ||= (async()=>{
    if(!env.PLUGGY_CLIENT_ID || !env.PLUGGY_CLIENT_SECRET)throw fail(503,'Configure as credenciais Pluggy no backend.');
    const r=await fetcher('https://api.pluggy.ai/auth',{method:'POST',redirect:'error',signal,
     headers:{'Content-Type':'application/json'},body:JSON.stringify({clientId:env.PLUGGY_CLIENT_ID,clientSecret:env.PLUGGY_CLIENT_SECRET})});
    if(!r.ok)throw fail(502,'Não foi possível autenticar na Pluggy.');
    const d=await r.json();if(!d.apiKey)throw fail(502,'Resposta de autenticação inválida.');
    key=d.apiKey;expires=clock()+110*60*1000;
   })().finally(()=>{pending=null;});
   await pending;
  }
  const r=await fetcher('https://api.pluggy.ai'+path,{redirect:'error',signal,headers:{'X-API-KEY':key}});
  if(r.status===401){key=null;expires=0;}
  if(!r.ok)throw fail(502,r.status===429?'Limite da Pluggy atingido. Tente mais tarde.':'Não foi possível consultar a conexão Pluggy.');
  return r.json();
 }
 return {
  async accounts(itemId,signal) {
   const [item,data]=await Promise.all([request('/items/'+encodeURIComponent(itemId),signal),request('/accounts?itemId='+encodeURIComponent(itemId),signal)]);
   if(!Array.isArray(data.results))throw fail(502,'Lista de contas inválida.');
   return {status:item.status,bank:item.connector?.name||'Instituição',bank_updated_at:item.lastUpdatedAt||null,
    accounts:data.results.map(a=>({id:a.id,name:a.name,type:a.type,subtype:a.subtype,currency:a.currencyCode,
     balance:typeof a.balance==='number'&&Number.isFinite(a.balance)?a.balance:null}))};
  },
  async transactions(accountId,month,signal) {
   // Fetch the UTC envelope, including the following day, then apply the same
   // Brazilian calendar month shown in the UI (also handles historical DST).
   const end=new Date(Date.UTC(Number(month.slice(0,4)),Number(month.slice(5,7)),1)).toISOString().slice(0,10);
   const params=new URLSearchParams({accountId,dateFrom:month+'-01',dateTo:end});
   const rows=new Map(),seen=new Set();
   for(let page=0;page<50;page++) {
    const data=await request('/v2/transactions?'+params,signal);
    if(!Array.isArray(data.results))throw fail(502,'Extrato inválido.');
    for(const t of data.results) {
     if(!t.id || (t.accountId && t.accountId!==accountId))throw fail(502,'Extrato com conta inválida.');
     rows.set(t.id,{id:t.id,date:t.date,description:t.description,amount:t.amount,currency:t.currencyCode,type:t.type,status:t.status});
    }
    if(!data.next){
     const formatter=new Intl.DateTimeFormat('sv-SE',{timeZone:'America/Sao_Paulo',year:'numeric',month:'2-digit'});
     if([...rows.values()].some(t=>!Number.isFinite(Date.parse(t.date))))throw fail(502,'Extrato com data inválida.');
     return [...rows.values()].filter(t=>formatter.format(new Date(t.date))===month).sort((a,b)=>String(b.date).localeCompare(String(a.date)));
    }
    if(typeof data.next!=='string'||!data.next.startsWith('?'))throw fail(502,'Paginação inválida.');
    const after=new URLSearchParams(data.next).get('after');
    if(!after||seen.has(after))throw fail(502,'Paginação incompleta. O extrato anterior foi preservado.');
    seen.add(after);params.set('after',after);
   }
   throw fail(502,'Extrato excede o limite de segurança. O extrato anterior foi preservado.');
  }
 };
}
