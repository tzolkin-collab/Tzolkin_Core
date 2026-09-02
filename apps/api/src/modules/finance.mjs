import {createPluggy} from '../integrations/pluggy.mjs';
import {pluggyItemIds} from '../integrations/pluggy-config.mjs';
import {fail,json,input} from '../platform/http.mjs';

export function financeRoutes(router,{provider=createPluggy(),env=process.env}={}) {
 const pending=new Map();
 const read=async(pool,key)=>(await pool.query('SELECT payload,updated_at FROM finance_snapshots WHERE key=$1',[key])).rows[0]||null;
 const save=(pool,key,data)=>pool.query('INSERT INTO finance_snapshots(key,payload) VALUES($1,$2) ON CONFLICT(key) DO UPDATE SET payload=EXCLUDED.payload,updated_at=now()',[key,JSON.stringify(data)]);
 async function connections(pool) {
  const result=[];
  for(const [index,id] of pluggyItemIds(env).entries())result.push({connection:index+1,...await read(pool,'item:'+id)});
  return result;
 }
 async function synchronize(pool,key,fetchData){
  if(pending.has(key))return pending.get(key);
  const work=(async()=>{
   try{
    await save(pool,'attempt:'+key,{state:'running'});
    const data=await fetchData();await save(pool,key,data);
    await save(pool,'attempt:'+key,{state:'ok'});
   }catch(error){await save(pool,'attempt:'+key,{state:'error'}).catch(()=>{});throw error;}
  })().finally(()=>pending.delete(key));
  pending.set(key,work);return work;
 }
 function period(body) {
  input(body,['account_id','month']);
  if(typeof body.account_id!=='string'||!/^[a-zA-Z0-9_-]{1,128}$/.test(body.account_id)||!/^20\d{2}-(0[1-9]|1[0-2])$/.test(body.month))throw fail(400,'Conta ou mês inválido.');
  return 'transactions:'+body.account_id+':'+body.month;
 }
 async function authorize(pool,id) {
  const list=await connections(pool);
  if(!list.some(c=>c.payload?.accounts.some(a=>a.id===id)))throw fail(404,'Conta não vinculada às conexões configuradas.');
 }
 router.get('/api/finance',async({pool,reply})=>reply(200,{connections:await connections(pool)}));
 // All saved accounts for the period in one response. This route NEVER calls
 // Pluggy: reopening the screen works without resynchronizing the provider.
 router.get('/api/finance/board',async({pool,url,reply})=>{
  const month=url.searchParams.get('month');
  if([...url.searchParams.keys()].length!==1||!/^20\d{2}-(0[1-9]|1[0-2])$/.test(month))throw fail(400,'Mês inválido.');
  const list=await connections(pool),ids=pluggyItemIds(env);
  const accounts=list.flatMap(c=>(c.payload?.accounts||[]).map(a=>({...a,connection:c.connection,bank:a.bank||'Instituição bancária',balance_updated_at:c.updated_at,bank_updated_at:c.payload.bank_updated_at})));
  const keys=[...ids.map(id=>'attempt:item:'+id),...accounts.flatMap(a=>['transactions:'+a.id+':'+month,'attempt:transactions:'+a.id+':'+month])];
  const rows=keys.length?(await pool.query('SELECT key,payload,updated_at FROM finance_snapshots WHERE key=ANY($1::text[])',[keys])).rows:[];
  const saved=new Map(rows.map(row=>[row.key,row]));
  const history=accounts.length?(await pool.query("SELECT key,updated_at FROM finance_snapshots WHERE split_part(key,':',1)='transactions' AND split_part(key,':',2)=ANY($1::text[])",[accounts.map(a=>a.id)])).rows:[];
  reply(200,{month,connections:list.map((c,i)=>{const attempt=saved.get('attempt:item:'+ids[i]);return {...c,attempt:attempt?{payload:attempt.payload,updated_at:attempt.updated_at}:null};}),accounts:accounts.map(a=>{
   const snapshot=saved.get('transactions:'+a.id+':'+month),attempt=saved.get('attempt:transactions:'+a.id+':'+month);
   // Keys include provider identifiers; expose only the explicitly scoped fields.
   return {...a,snapshot:snapshot?{payload:snapshot.payload,updated_at:snapshot.updated_at}:null,attempt:attempt?{payload:attempt.payload,updated_at:attempt.updated_at}:null};
  }),saved_months:[...new Set(history.map(row=>row.key.split(':')[2]))].sort().reverse()});
 });
 router.post('/api/finance/sync',async({pool,reply,req})=>{
  input(await json(req),[]);
  const ids=pluggyItemIds(env);if(!ids.length)throw fail(400,'Configure PLUGGY_ITEM_IDS no backend.');
  const signal=AbortSignal.timeout(12000);
  const results=await Promise.all(ids.map(async(id,index)=>{
   try {await synchronize(pool,'item:'+id,()=>provider.accounts(id,signal));return {connection:index+1,ok:true};}
   catch{return {connection:index+1,ok:false,message:'Falha ao atualizar. Dados anteriores preservados.'};}
  }));
  reply(200,{results,connections:await connections(pool)});
 });
 router.get('/api/finance/transactions',async({pool,url,reply})=>{
  if([...url.searchParams.keys()].length!==2)throw fail(400,'Parâmetros inválidos.');
  const b=Object.fromEntries(url.searchParams),key=period(b);await authorize(pool,b.account_id);
  reply(200,{snapshot:await read(pool,key)});
 });
 router.post('/api/finance/transactions/sync',async({pool,req,reply})=>{
  const b=await json(req),key=period(b);await authorize(pool,b.account_id);
  try{await synchronize(pool,key,async()=>({transactions:await provider.transactions(b.account_id,b.month,AbortSignal.timeout(12000)),time_zone:'America/Sao_Paulo'}));}
  catch{throw fail(502,'Falha ao sincronizar extrato. Dados anteriores preservados; tente novamente.');}
  // A single atomic replacement removes provider-deleted rows without partial writes.
  reply(200,{snapshot:await read(pool,key)});
 });
}
