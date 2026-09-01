// Isolated visual QA: no .env, database or provider requests.
import {createCore} from '../apps/api/src/app.mjs';
import {createWeb} from '../apps/web/server.mjs';
const snapshots=new Map(),offers=new Map();
const pool={async query(sql,values=[]){
 if(sql.startsWith('SELECT id,name FROM products')||sql.startsWith('SELECT * FROM products'))return{rows:[{id:'qa-service',name:'Serviço demonstrativo · QA'}]};
 if(sql.startsWith('SELECT slug,payload,version'))return{rows:[...offers.values()]};
 if(sql.startsWith('INSERT INTO billing_offers')){const key=values[0]+':'+values[1];if(values[3]!==0||offers.has(key))return{rows:[]};offers.set(key,{slug:values[1],payload:JSON.parse(values[2]),version:1});return{rows:[{version:1}]};}
 if(sql.startsWith('UPDATE billing_offers')){const row=offers.get(values[0]+':'+values[1]);if(!row||row.version!==values[3])return{rows:[]};row.payload=JSON.parse(values[2]);row.version++;return{rows:[{version:row.version}]};}
 if(sql.includes('WHERE key=ANY'))return{rows:values[0].filter(key=>snapshots.has(key)).map(key=>({key,...snapshots.get(key)}))};
 if(sql.includes('split_part'))return{rows:[...snapshots].filter(([key])=>key.startsWith('transactions:')&&values[0].includes(key.split(':')[1])).map(([key,row])=>({key,updated_at:row.updated_at}))};
 if(sql.startsWith('SELECT payload'))return {rows:snapshots.has(values[0])?[snapshots.get(values[0])]:[]};
 if(sql.startsWith('INSERT INTO finance_snapshots'))snapshots.set(values[0],{payload:JSON.parse(values[1]),updated_at:new Date().toISOString()});
 return {rows:[]};
},async connect(){return{query:pool.query.bind(pool),release(){}};}};
let providerCalls=0;
const provider={
 async accounts(id){console.log('synthetic_provider_calls='+ ++providerCalls);return {bank:'Meu Pluggy · QA',status:'UPDATED',bank_updated_at:new Date().toISOString(),accounts:[{id:id+'-bank',name:id==='one'?'Conta operacional · QA':'Conta de reservas · QA',type:'BANK',currency:'BRL',balance:id==='one'?12840.50:5120.25},{id:id+'-card',name:id==='one'?'Cartão da operação · QA':'Cartão de despesas · QA',type:'CREDIT',currency:'BRL',balance:450.20}]};},
 async transactions(account,month){console.log('synthetic_provider_calls='+ ++providerCalls);return Array.from({length:37},(_,i)=>({id:account+'-'+i,date:month+'-'+String(i%28+1).padStart(2,'0')+'T12:00:00Z',description:['Consultoria mensal · exemplo','Serviço de infraestrutura · exemplo','Transferência entre contas · exemplo','Assinatura de software · exemplo'][i%4],amount:i%3===0?850+i*10:-(42+i*3),currency:'BRL',type:i%3===0?'CREDIT':'DEBIT',status:i%11===0?'PENDING':'POSTED'}));}
};
const api=createCore({pool,adminPassword:'synthetic-preview-password-only',webOrigin:'http://127.0.0.1:3101',deployRegistry:[],infrastructureOptions:{env:{}},deliveryOptions:{options:async()=>({})},financeOptions:{provider,env:{PLUGGY_ITEM_IDS:'one,two'}}});
api.listen(0,'127.0.0.1',()=>createWeb({apiOrigin:`http://127.0.0.1:${api.address().port}`}).listen(3101,'127.0.0.1',()=>console.log('QA financeiro sintético em 3101. Sem dados reais.')));
