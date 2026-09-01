import {fail} from '../platform/http.mjs';

const safe=(value,fallback,max=180)=>typeof value==='string'&&value.trim()?value.trim().slice(0,max):fallback;
const amount=value=>Number.isInteger(value)?value/100:null;
const period=month=>{
 if(!/^20\d{2}-(0[1-9]|1[0-2])$/.test(month))throw fail(400,'Mês inválido.');
 const [year,value]=month.split('-').map(Number),next=value===12?`${year+1}-01`:`${year}-${String(value+1).padStart(2,'0')}`;
 return{from:month+'-01',to:next+'-01',fromUnix:Math.floor(Date.parse(month+'-01T00:00:00-03:00')/1000),toUnix:Math.floor(Date.parse(next+'-01T00:00:00-03:00')/1000)};
};

async function body(response){
 if(!response.ok)throw fail(502,'Não foi possível consultar o processador de pagamentos.');
 return response.json();
}

export function createStripeSales({env=process.env,fetcher=fetch}={}){
 return async(month,signal)=>{
  if(!env.STRIPE_SECRET_KEY)throw fail(503,'Stripe não configurada.');
  const dates=period(month),rows=[],seen=new Set();let cursor;
  for(let page=0;page<50;page++){
   const query=new URLSearchParams({limit:'100','created[gte]':String(dates.fromUnix),'created[lt]':String(dates.toUnix),'expand[]':'data.balance_transaction'});
   if(cursor)query.set('starting_after',cursor);
   const data=await body(await fetcher('https://api.stripe.com/v1/charges?'+query,{headers:{Authorization:`Bearer ${env.STRIPE_SECRET_KEY}`},redirect:'error',signal}));
   if(!Array.isArray(data.data))throw fail(502,'Resposta inválida do processador.');
   for(const charge of data.data){
    if(typeof charge?.id!=='string'||seen.has(charge.id))continue;seen.add(charge.id);
    const gross=amount(charge.amount),refunded=amount(charge.amount_refunded)||0,transaction=charge.balance_transaction;
    const fee=amount(transaction?.fee),net=amount(transaction?.net);
    rows.push({id:'stripe:'+charge.id,provider:'stripe',date:new Date(charge.created*1000).toISOString(),description:safe(charge.description,'Venda Stripe'),gross,refunded,fee,net,currency:safe(charge.currency,'brl',8).toUpperCase(),status:charge.refunded&&refunded===gross?'refunded':refunded>0?'partial_refund':charge.paid&&charge.status==='succeeded'?'received':charge.status==='pending'?'pending':'failed',method:safe(charge.payment_method_details?.type,'Não informado',40)});
   }
   if(!data.has_more)return rows.sort((a,b)=>b.date.localeCompare(a.date));
   const next=data.data.at(-1)?.id;if(!next||next===cursor)throw fail(502,'Paginação inválida do processador.');cursor=next;
  }
  throw fail(502,'Consulta Stripe excedeu o limite de segurança.');
 };
}

export function createAsaasSales({env=process.env,fetcher=fetch}={}){
 return async(month,signal)=>{
  if(!env.ASAAS_API_KEY)throw fail(503,'Asaas não configurado.');
  const dates=period(month),base=env.ASAAS_ENVIRONMENT==='production'?'https://api.asaas.com/v3':'https://api-sandbox.asaas.com/v3',rows=[],seen=new Set();
  for(let offset=0;offset<5000;offset+=100){
   const query=new URLSearchParams({limit:'100',offset:String(offset),'dateCreated[ge]':dates.from,'dateCreated[le]':new Date(Date.parse(dates.to+'T00:00:00Z')-86400000).toISOString().slice(0,10)});
   const data=await body(await fetcher(base+'/payments?'+query,{headers:{access_token:env.ASAAS_API_KEY,'User-Agent':'TZOLKIN-Core/1.0','Content-Type':'application/json'},redirect:'error',signal}));
   if(!Array.isArray(data.data))throw fail(502,'Resposta inválida do processador.');
   for(const payment of data.data){
    if(typeof payment?.id!=='string'||seen.has(payment.id))continue;seen.add(payment.id);
    const gross=Number.isFinite(payment.value)?payment.value:null,net=Number.isFinite(payment.netValue)?payment.netValue:null,refunded=Number.isFinite(payment.refundedValue)?payment.refundedValue:0;
    const received=['RECEIVED','CONFIRMED','RECEIVED_IN_CASH'].includes(payment.status),refund=payment.status==='REFUNDED'?'refunded':refunded>0?'partial_refund':null;
    const rawDate=payment.paymentDate||payment.clientPaymentDate||payment.confirmedDate||payment.dateCreated;
    if(!/^\d{4}-\d{2}-\d{2}$/.test(rawDate||''))continue;
    rows.push({id:'asaas:'+payment.id,provider:'asaas',date:rawDate+'T12:00:00-03:00',description:safe(payment.description,'Cobrança Asaas'),gross,refunded,fee:gross!==null&&net!==null?Math.max(0,gross-net):null,net,currency:'BRL',status:refund|| (received?'received':['PENDING','OVERDUE'].includes(payment.status)?'pending':'failed'),method:safe(payment.billingType,'Não informado',40)});
   }
   if(!data.hasMore)return rows.sort((a,b)=>b.date.localeCompare(a.date));
  }
  throw fail(502,'Consulta Asaas excedeu o limite de segurança.');
 };
}

export function createSalesProviders(options={}){
 return{stripe:createStripeSales(options),asaas:createAsaasSales(options)};
}
