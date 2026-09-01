import {createSalesProviders} from '../integrations/payment-sales.mjs';
import {fail,json,input} from '../platform/http.mjs';

const validMonth=value=>typeof value==='string'&&/^20\d{2}-(0[1-9]|1[0-2])$/.test(value);

export function paymentSalesRoutes(router,{providers=createSalesProviders(),env=process.env}={}){
 const configured=()=>({stripe:Boolean(env.STRIPE_SECRET_KEY),asaas:Boolean(env.ASAAS_API_KEY),asaas_environment:env.ASAAS_ENVIRONMENT==='production'?'production':'sandbox'});
 const read=async(pool,key)=>(await pool.query('SELECT payload,updated_at FROM finance_snapshots WHERE key=$1',[key])).rows[0]||null;
 const save=(pool,key,data)=>pool.query('INSERT INTO finance_snapshots(key,payload) VALUES($1,$2) ON CONFLICT(key) DO UPDATE SET payload=EXCLUDED.payload,updated_at=now()',[key,JSON.stringify(data)]);
 async function board(pool,month){
  const state=configured(),result={month,configured:state,providers:{}};
  for(const name of ['stripe','asaas']){const snapshot=await read(pool,`sales:${name}:${month}`),attempt=await read(pool,`attempt:sales:${name}:${month}`);result.providers[name]={snapshot,attempt};}
  return result;
 }
 router.get('/api/finance/sales',async({pool,url,reply})=>{const month=url.searchParams.get('month');if([...url.searchParams.keys()].length!==1||!validMonth(month))throw fail(400,'Mês inválido.');reply(200,await board(pool,month));});
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
