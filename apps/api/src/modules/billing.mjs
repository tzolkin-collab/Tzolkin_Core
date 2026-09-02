import {input,text,isProductId,fail} from '../platform/http.mjs';
import {findProduct} from './catalog.mjs';

export const EMAIL_EVENTS=['welcome','charge_created','payment_confirmed','due_reminder','overdue','renewal','canceled','refunded'];
export function validateOffer(body){
 input(body,['product_id','slug','name','provider','kind','amount_minor','currency','interval','installments','email_owner','email_templates','version']);
 if(!isProductId(body.product_id)||!isProductId(body.slug))throw fail(400,'Produto ou slug inválido.');
 if(!['asaas','stripe'].includes(body.provider)||!['one_time','installments','subscription'].includes(body.kind))throw fail(400,'Processador ou modalidade inválida.');
 if(!Number.isSafeInteger(body.amount_minor)||body.amount_minor<1||body.amount_minor>100000000)throw fail(400,'Informe um valor válido em centavos.');
 if(!['BRL','USD','EUR','GBP'].includes(body.currency)||(body.provider==='asaas'&&body.currency!=='BRL'))throw fail(400,'Moeda incompatível com o processador.');
 if(body.kind==='subscription'?!['month','year'].includes(body.interval):body.interval!==null)throw fail(400,'Periodicidade inválida.');
 if(!Number.isInteger(body.installments)||body.installments<1||body.installments>12||(body.kind!=='installments'&&body.installments!==1)||(body.kind==='installments'&&(body.provider!=='asaas'||body.installments<2)))throw fail(400,'Parcelamento disponível nesta configuração apenas no Asaas, de 2 a 12 parcelas.');
 if(!['provider','core'].includes(body.email_owner))throw fail(400,'Escolha um responsável pelos e-mails financeiros.');
 input(body.email_templates,EMAIL_EVENTS);
 const templates={};for(const [event,slug]of Object.entries(body.email_templates)){if(!isProductId(slug))throw fail(400,'Identificador de template inválido.');templates[event]=slug;}
 if(!Number.isInteger(body.version)||body.version<0)throw fail(400,'Versão inválida.');
 return{product_id:body.product_id,slug:body.slug,name:text(body.name,2,100),provider:body.provider,kind:body.kind,amount_minor:body.amount_minor,currency:body.currency,interval:body.interval,installments:body.installments,email_owner:body.email_owner,email_templates:templates};
}

// A draft contract keeps its agreed conditions even if the catalog changes later.
export async function inheritBillingOffer(client,tenant,product,plan){
 const existing=(await client.query('SELECT offer_slug FROM contract_billing WHERE tenant_id=$1 AND product_id=$2 FOR UPDATE',[tenant,product])).rows[0];
 if(existing){if(existing.offer_slug!==plan)throw fail(409,'Este contrato possui condições de cobrança salvas. A troca de oferta exige revisão contratual.');return;}
 const offer=(await client.query('SELECT slug,payload,version FROM billing_offers WHERE product_id=$1 AND slug=$2 FOR SHARE',[product,plan])).rows[0];
 if(!offer)return;
 await client.query(`INSERT INTO contract_billing(tenant_id,product_id,offer_slug,offer_version,snapshot)
 VALUES($1,$2,$3,$4,$5::jsonb) ON CONFLICT(tenant_id,product_id) DO NOTHING`,[tenant,product,offer.slug,offer.version,JSON.stringify(offer.payload)]);
}

export function billingRoutes(router){
 router.get('/api/billing/offers',async({pool,url,reply})=>{
  const product=url.searchParams.get('product_id');
  if(!isProductId(product)||[...url.searchParams.keys()].some(k=>k!=='product_id')||url.searchParams.getAll('product_id').length!==1)throw fail(400,'Produto inválido.');
  const result=await pool.query("SELECT b.slug,b.payload,b.version,b.updated_at FROM billing_offers b JOIN products p ON p.id=b.product_id AND p.lifecycle_status='active' WHERE b.product_id=$1 ORDER BY b.slug",[product]);
  return reply(200,{offers:result.rows,execution:'draft_only'});
 });
 router.put('/api/billing/offers',async({client,body})=>{
 const offer=validateOffer(body);
  if (!await findProduct(client, offer.product_id)) throw fail(400, 'Produto não está disponível para cobrança.');
  const result=await client.query(`INSERT INTO billing_offers(product_id,slug,payload)
   SELECT $1,$2,$3::jsonb WHERE $4=0
   ON CONFLICT(product_id,slug) DO NOTHING RETURNING version`,[offer.product_id,offer.slug,JSON.stringify(offer),body.version]);
  if(!result.rows.length){
   if(body.version===0)throw fail(409,'Oferta já existe. Reabra antes de editar.');
   const updated=await client.query(`UPDATE billing_offers SET payload=$3::jsonb,version=version+1,updated_at=now()
    WHERE product_id=$1 AND slug=$2 AND version=$4 RETURNING version`,[offer.product_id,offer.slug,JSON.stringify(offer),body.version]);
   if(!updated.rows.length)throw fail(409,'Oferta alterada em outra sessão. Reabra antes de salvar.');
  }
  await client.query(`INSERT INTO billing_offer_history(product_id,offer_slug,version,payload)
   SELECT product_id,slug,version,payload FROM billing_offers WHERE product_id=$1 AND slug=$2`,[offer.product_id,offer.slug]);
  return {tenant:null,type:'billing.offer.saved'};
 },{transactional:true,audit:false});
}
