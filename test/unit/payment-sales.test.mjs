import test from 'node:test';
import assert from 'node:assert/strict';
import {createStripeSales,createAsaasSales} from '../../apps/api/src/integrations/payment-sales.mjs';
import {paymentSalesRoutes} from '../../apps/api/src/modules/payment-sales.mjs';

const response=data=>({ok:true,status:200,json:async()=>data});

test('Stripe sales use a bounded monthly query and project charges without customer data',async()=>{
 let request;
 const read=createStripeSales({env:{STRIPE_SECRET_KEY:'synthetic-secret'},fetcher:async(url,options)=>{request={url,options};return response({data:[{id:'ch_1',created:1788235200,amount:10000,amount_refunded:1000,currency:'brl',paid:true,status:'succeeded',description:'Plano',payment_method_details:{type:'card'},balance_transaction:{fee:500,net:9500},receipt_email:'private@example.test'}],has_more:false});}});
 const rows=await read('2026-09');
 assert.match(request.url,/charges\?/);assert.match(request.url,/created%5Bgte%5D=/);assert.match(request.url,/expand%5B%5D=data.balance_transaction/);
 assert.equal(request.options.headers.Authorization,'Bearer synthetic-secret');assert.equal(rows[0].gross,100);assert.equal(rows[0].fee,5);assert.equal(rows[0].status,'partial_refund');assert.ok(!JSON.stringify(rows).includes('private@example.test'));
});

test('Asaas sales select the matching environment, paginate and project received payments',async()=>{
 const urls=[];
 const read=createAsaasSales({env:{ASAAS_API_KEY:'synthetic-secret',ASAAS_ENVIRONMENT:'production'},fetcher:async(url,options)=>{urls.push({url,options});return response({data:[{id:'pay_1',dateCreated:'2026-09-01',paymentDate:'2026-09-02',value:120,netValue:116,status:'RECEIVED',description:'Projeto',billingType:'PIX',customer:'private'}],hasMore:false});}});
 const rows=await read('2026-09');
 assert.match(urls[0].url,/^https:\/\/api\.asaas\.com\/v3\/payments/);assert.equal(urls[0].options.headers.access_token,'synthetic-secret');assert.equal(rows[0].fee,4);assert.equal(rows[0].status,'received');assert.ok(!JSON.stringify(rows).includes('private'));
});

function fixture(){
 const routes=new Map(),store=new Map(),router={get:(p,f)=>routes.set('GET '+p,f),post:(p,f)=>routes.set('POST '+p,f)};
 const pool={async query(sql,args){if(sql.startsWith('SELECT'))return{rows:store.has(args[0])?[store.get(args[0])]:[]};store.set(args[0],{payload:JSON.parse(args[1]),updated_at:'2026-09-01T12:00:00Z'});return{rows:[]};}};
 const req=body=>({headers:{'content-type':'application/json'},async *[Symbol.asyncIterator](){yield Buffer.from(JSON.stringify(body));}});
 paymentSalesRoutes(router,{env:{STRIPE_SECRET_KEY:'configured',ASAAS_ENVIRONMENT:'sandbox'},providers:{stripe:async()=>[{id:'stripe:1'}],asaas:async()=>{throw Error('must not call');}}});return{routes,store,pool,req};
}

test('sales sync preserves provider isolation and reports unconfigured Asaas honestly',async()=>{
 const f=fixture();let body;
 await f.routes.get('POST /api/finance/sales/sync')({pool:f.pool,req:f.req({month:'2026-09'}),reply:(status,data)=>body=data});
 assert.equal(body.results[0].ok,true);assert.equal(body.results[1].configured,false);assert.equal(f.store.get('sales:stripe:2026-09').payload.sales.length,1);assert.equal(f.store.has('sales:asaas:2026-09'),false);
});

test('sales board is storage-only and rejects invalid periods',async()=>{
 const f=fixture();f.store.set('sales:stripe:2026-09',{payload:{sales:[{id:'saved'}]},updated_at:'2026-09-01T12:00:00Z'});let body;
 await f.routes.get('GET /api/finance/sales')({pool:f.pool,url:new URL('http://local/api/finance/sales?month=2026-09'),reply:(status,data)=>body=data});
 assert.equal(body.providers.stripe.snapshot.payload.sales[0].id,'saved');
 await assert.rejects(f.routes.get('GET /api/finance/sales')({pool:f.pool,url:new URL('http://local/api/finance/sales?month=bad'),reply(){}}),/inválido/);
});
