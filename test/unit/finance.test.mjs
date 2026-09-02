import test from 'node:test';
import assert from 'node:assert/strict';
import {createPluggy} from '../../apps/api/src/integrations/pluggy.mjs';
import {financeRoutes} from '../../apps/api/src/modules/finance.mjs';
import {createCore} from '../../apps/api/src/app.mjs';
const response=data=>({ok:true,status:200,json:async()=>data});
test('Pluggy follows cursor on fixed host, deduplicates and caches server key',async()=>{
 const urls=[];let auth=0;
 const provider=createPluggy({env:{PLUGGY_CLIENT_ID:'test',PLUGGY_CLIENT_SECRET:'test'},fetcher:async(url)=>{
  urls.push(url);if(url.endsWith('/auth')){auth++;return response({apiKey:'secret'});}
  if(url.includes('after='))return response({results:[{id:'a',accountId:'account',amount:2,date:'2026-08-02'}],next:null});
  return response({results:[{id:'a',accountId:'account',amount:1,date:'2026-08-02'}],next:'?accountId=other&after=cursor'});
 }});
 const rows=await provider.transactions('account','2026-08',AbortSignal.timeout(1000));assert.equal(rows.length,1);assert.equal(rows[0].amount,2);assert.equal(auth,1);
 assert.match(urls[2],/accountId=account/);assert.match(urls[2],/dateTo=2026-09-01/);assert.match(urls[2],/after=cursor/);
 assert.ok(!JSON.stringify(rows).includes('secret'));
});
test('Pluggy rejects repeated cursor rather than saving partial results',async()=>{
 const provider=createPluggy({env:{PLUGGY_CLIENT_ID:'test',PLUGGY_CLIENT_SECRET:'test'},fetcher:async url=>response(url.endsWith('/auth')?{apiKey:'secret'}:{results:[],next:'?after=repeated'})});
 await assert.rejects(provider.transactions('account','2026-08',AbortSignal.timeout(1000)),/incompleta/);
});
test('bank identity comes from each account instead of the Open Finance aggregator',async()=>{
 const provider=createPluggy({env:{PLUGGY_CLIENT_ID:'test',PLUGGY_CLIENT_SECRET:'test'},fetcher:async url=>{
  if(url.endsWith('/auth'))return response({apiKey:'secret'});
  if(url.includes('/items/'))return response({status:'UPDATED',connector:{name:'MeuPluggy'}});
  return response({results:[
   {id:'inter',name:'BANCO INTER',type:'BANK',currencyCode:'BRL',balance:10},
   {id:'nu',name:'Nu Pagamentos S.A.',type:'BANK',currencyCode:'BRL',balance:20},
   {id:'card',name:'GOLD',type:'CREDIT',currencyCode:'BRL',creditData:{brand:'MASTERCARD'}},
  ]});
 }});
 const result=await provider.accounts('item',AbortSignal.timeout(1000));
 assert.deepEqual(result.accounts.map(a=>a.bank),['Banco Inter','Nubank','MASTERCARD']);
 assert.ok(!JSON.stringify(result).includes('MeuPluggy'));
});
function fixture(provider){const routes=new Map(),store=new Map([['item:first',{payload:{accounts:[{id:'account'}]}}]]);const router={get:(p,f)=>routes.set('GET '+p,f),post:(p,f)=>routes.set('POST '+p,f)};
 financeRoutes(router,{provider,env:{PLUGGY_ITEM_IDS:'first,second'}});
 const pool={async query(sql,args){
  if(sql.includes('WHERE key=ANY'))return{rows:args[0].filter(key=>store.has(key)).map(key=>({key,...store.get(key)}))};
  if(sql.includes('split_part'))return{rows:[...store].filter(([key])=>key.startsWith('transactions:')&&args[0].includes(key.split(':')[1])).map(([key,row])=>({key,updated_at:row.updated_at}))};
  if(sql.startsWith('SELECT'))return{rows:store.has(args[0])?[store.get(args[0])]:[]};store.set(args[0],{payload:JSON.parse(args[1]),updated_at:new Date().toISOString()});return{rows:[]};}};
 const req=body=>({headers:{'content-type':'application/json'},async *[Symbol.asyncIterator](){yield Buffer.from(JSON.stringify(body));}});
 return{routes,store,pool,req};
}
test('one failed bank preserves its snapshot while the other updates',async()=>{
 const f=fixture({accounts:async id=>{if(id==='first')throw Error('secret provider detail');return{accounts:[]};}});let data;
 await f.routes.get('POST /api/finance/sync')({pool:f.pool,req:f.req({}),reply:(s,d)=>data=d});
 assert.equal(data.results[0].ok,false);assert.equal(data.results[1].ok,true);assert.equal(f.store.get('item:first').payload.accounts[0].id,'account');assert.ok(!JSON.stringify(data).includes('secret'));
});
test('failed monthly sync preserves prior snapshot and arbitrary accounts cannot sync',async()=>{
 const f=fixture({transactions:async()=>{throw Error('network');}});f.store.set('transactions:account:2026-08',{payload:{transactions:[{id:'old'}]}});
 const route=f.routes.get('POST /api/finance/transactions/sync');
 await assert.rejects(route({pool:f.pool,req:f.req({account_id:'account',month:'2026-08'})}),/preservados/);
 assert.equal(f.store.get('transactions:account:2026-08').payload.transactions[0].id,'old');
 await assert.rejects(route({pool:f.pool,req:f.req({account_id:'other',month:'2026-08'})}),/não vinculada/);
 await assert.rejects(route({pool:f.pool,req:f.req({account_id:'account',month:'2026-13'})}),/inválido/);
});
test('successful sync replaces deleted transactions atomically',async()=>{
 const f=fixture({transactions:async()=>[{id:'new'}]});f.store.set('transactions:account:2026-08',{payload:{transactions:[{id:'old'}]}});
 await f.routes.get('POST /api/finance/transactions/sync')({pool:f.pool,req:f.req({account_id:'account',month:'2026-08'}),reply(){}});
 assert.deepEqual(f.store.get('transactions:account:2026-08').payload.transactions,[{id:'new'}]);
});

test('saved board survives module recreation and never calls provider',async()=>{
 const provider={transactions:async()=>[{id:'saved',date:'2026-08-03T12:00:00Z'}]};
 const f=fixture(provider);
 await f.routes.get('POST /api/finance/transactions/sync')({pool:f.pool,req:f.req({account_id:'account',month:'2026-08'}),reply(){}});
 f.store.set('transactions:unrelated:2026-08',{payload:{transactions:[{id:'private'}]}});
 const routes=new Map();financeRoutes({get:(path,fn)=>routes.set(path,fn),post(){}},{provider:{transactions(){throw Error('must not call');},accounts(){throw Error('must not call');}},env:{PLUGGY_ITEM_IDS:'first'}});
 let body;await routes.get('/api/finance/board')({pool:f.pool,url:new URL('http://local/api/finance/board?month=2026-08'),reply:(s,data)=>body=data});
 assert.equal(body.accounts[0].snapshot.payload.transactions[0].id,'saved');assert.deepEqual(body.saved_months,['2026-08']);assert.ok(!JSON.stringify(body).includes('private'));
});

test('concurrent refresh for same account coalesces into one provider call',async()=>{
 let calls=0;const f=fixture({transactions:async()=>{calls++;await new Promise(r=>setTimeout(r,10));return[];}});
 const handler=f.routes.get('POST /api/finance/transactions/sync');
 await Promise.all([1,2].map(()=>handler({pool:f.pool,req:f.req({account_id:'account',month:'2026-08'}),reply(){}})));
 assert.equal(calls,1);
});

test('monthly import includes last local evening and excludes previous local month',async()=>{
 const values=['2026-08-01T01:29:43Z','2026-08-01T03:00:00Z','2026-09-01T02:59:59Z','2026-09-01T03:00:00Z'];
 const p=createPluggy({env:{PLUGGY_CLIENT_ID:'test',PLUGGY_CLIENT_SECRET:'test'},fetcher:async url=>response(url.endsWith('/auth')?{apiKey:'test'}:{results:values.map((date,i)=>({id:String(i),date,accountId:'account'}))})});
 assert.deepEqual((await p.transactions('account','2026-08',AbortSignal.timeout(1000))).map(t=>t.id),['2','1']);
});
test('finance requires admin session and rejects foreign-origin writes before provider access',async()=>{
 const server=createCore({pool:{},adminPassword:'synthetic-finance-test-password-only',deployRegistry:[]});await new Promise(r=>server.listen(0,'127.0.0.1',r));const origin='http://127.0.0.1:'+server.address().port;
 try{assert.equal((await fetch(origin+'/api/finance')).status,401);assert.equal((await fetch(origin+'/api/finance/sync',{method:'POST',headers:{origin:'https://evil.invalid'}})).status,403);}
 finally{await new Promise(r=>{server.closeAllConnections();server.close(r);});}
});
