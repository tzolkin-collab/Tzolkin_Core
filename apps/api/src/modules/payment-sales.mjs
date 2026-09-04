import {createSalesProviders} from '../integrations/payment-sales.mjs';
import {fail,json,input} from '../platform/http.mjs';

const validMonth=value=>typeof value==='string'&&/^20\d{2}-(0[1-9]|1[0-2])$/.test(value);

export function paymentSalesRoutes(router,{providers=createSalesProviders(),env=process.env}={}){
 const configured=()=>({stripe:Boolean(env.STRIPE_SECRET_KEY),asaas:Boolean(env.ASAAS_API_KEY),asaas_environment:env.ASAAS_ENVIRONMENT==='production'?'production':'sandbox'});
 const read=async(pool,key)=>(await pool.query('SELECT payload,updated_at FROM finance_snapshots WHERE key=$1',[key])).rows[0]||null;
 const save=(pool,key,data)=>pool.query('INSERT INTO finance_snapshots(key,payload) VALUES($1,$2) ON CONFLICT(key) DO UPDATE SET payload=EXCLUDED.payload,updated_at=now()',[key,JSON.stringify(data)]);
 async function board(pool,months){
  const list=Array.isArray(months)?months:[months];
  const state=configured(),result={month:list[0],target_months:list,configured:state,providers:{}};
  for(const name of ['stripe','asaas']){
   if(list.length===1){
    const snapshot=await read(pool,`sales:${name}:${list[0]}`),attempt=await read(pool,`attempt:sales:${name}:${list[0]}`);
    result.providers[name]={snapshot,attempt};
   }else{
    const allSales=[];let latestUpdate=null,lastAttempt=null;
    for(const m of list){
     const s=await read(pool,`sales:${name}:${m}`);
     if(s?.payload?.sales){
      allSales.push(...s.payload.sales);
      if(!latestUpdate||Date.parse(s.updated_at)>Date.parse(latestUpdate))latestUpdate=s.updated_at;
     }
     const a=await read(pool,`attempt:sales:${name}:${m}`);
     if(a&&(!lastAttempt||Date.parse(a.updated_at)>Date.parse(lastAttempt.updated_at)))lastAttempt=a;
    }
    const snapshot=allSales.length||latestUpdate?{payload:{sales:allSales,time_zone:'America/Sao_Paulo'},updated_at:latestUpdate}:null;
    result.providers[name]={snapshot,attempt:lastAttempt};
   }
  }
  return result;
 }
 router.get('/api/finance/sales',async({pool,url,reply})=>{
  const month=url.searchParams.get('month'),year=url.searchParams.get('year'),from=url.searchParams.get('from'),to=url.searchParams.get('to');
  let targetMonths=[];
  if(month){
   if(!validMonth(month))throw fail(400,'Mês inválido.');
   targetMonths=[month];
  }else if(year){
   if(!/^20\d{2}$/.test(year))throw fail(400,'Ano inválido.');
   targetMonths=Array.from({length:12},(_,i)=>`${year}-${String(i+1).padStart(2,'0')}`);
  }else if(from&&to){
   const f=from.slice(0,7),t=to.slice(0,7);
   if(!validMonth(f)||!validMonth(t))throw fail(400,'Período inválido.');
   const [fy,fm]=f.split('-').map(Number),[ty,tm]=t.split('-').map(Number);
   const start=fy*12+(fm-1),end=ty*12+(tm-1);
   if(start>end||end-start>60)throw fail(400,'Período inválido.');
   for(let m=start;m<=end;m++){const y=Math.floor(m/12),mo=String((m%12)+1).padStart(2,'0');targetMonths.push(`${y}-${mo}`);}
  }else{
   throw fail(400,'Mês inválido.');
  }
  reply(200,await board(pool,targetMonths));
 });
 router.post('/api/finance/sales/sync',async({pool,req,reply})=>{
  const data=await json(req);input(data,['month']);if(!validMonth(data.month))throw fail(400,'Mês inválido.');
  const state=configured(),results=[];
  for(const name of ['stripe','asaas']){
   if(!state[name]){results.push({provider:name,ok:false,configured:false});continue;}
   try{const sales=await providers[name](data.month,AbortSignal.timeout(20000));await save(pool,`sales:${name}:${data.month}`,{sales,time_zone:'America/Sao_Paulo'});await save(pool,`attempt:sales:${name}:${data.month}`,{state:'ok'});results.push({provider:name,ok:true,configured:true,count:sales.length});}
   catch{await save(pool,`attempt:sales:${name}:${data.month}`,{state:'error'}).catch(()=>{});results.push({provider:name,ok:false,configured:true,message:'Falha ao atualizar. Dados anteriores preservados.'});}
  }
  reply(200,{results,...await board(pool,data.month)});
 });
}
