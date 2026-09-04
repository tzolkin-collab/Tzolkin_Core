import {input,text,isProductId,fail,onlyParams} from '../platform/http.mjs';
import {findEditableProduct} from './catalog.mjs';
import {EMAIL_EVENTS} from './billing.mjs';

export function validateEmailTemplate(body){
 input(body,['product_id','slug','event','name','subject','preheader','body','version']);
 if(!isProductId(body.product_id)||!isProductId(body.slug))throw fail(400,'Produto ou slug inválido.');
 if(!EMAIL_EVENTS.includes(body.event))throw fail(400,'Evento de e-mail inválido.');
 return {
  product_id:body.product_id,slug:body.slug,event:body.event,
  name:text(body.name,2,100),subject:text(body.subject,2,180),
  preheader:body.preheader===''?'':text(body.preheader,0,180),
  body:text(body.body,2,30000),
 };
}

export function emailTemplateRoutes(router){
 router.get('/api/email-templates',async({pool,url,reply})=>{
  const product=url.searchParams.get('product_id');
  if(!isProductId(product)||[...url.searchParams.keys()].some(k=>k!=='product_id')||url.searchParams.getAll('product_id').length!==1)throw fail(400,'Produto inválido.');
  if(!await findEditableProduct(pool,product))throw fail(404,'Produto não encontrado.');
  const rows=await pool.query('SELECT slug,payload,version,updated_at FROM email_templates WHERE product_id=$1 ORDER BY slug',[product]);
  return reply(200,{templates:rows.rows,events:EMAIL_EVENTS,execution:'draft_only'});
 },{body:false});
 router.put('/api/email-templates',async({client,body})=>{
  const template=validateEmailTemplate(body);
  if(!await findEditableProduct(client,template.product_id))throw fail(400,'Produto não está disponível para e-mails.');
  const result=await client.query(`INSERT INTO email_templates(product_id,slug,payload)
   SELECT $1,$2,$3::jsonb WHERE $4=0 ON CONFLICT(product_id,slug) DO NOTHING RETURNING version`,
   [template.product_id,template.slug,JSON.stringify(template),body.version]);
  if(!result.rows.length){
   if(body.version===0)throw fail(409,'Template já existe. Reabra antes de editar.');
   const updated=await client.query(`UPDATE email_templates SET payload=$3::jsonb,version=version+1,updated_at=now()
    WHERE product_id=$1 AND slug=$2 AND version=$4 RETURNING version`,[template.product_id,template.slug,JSON.stringify(template),body.version]);
   if(!updated.rows.length)throw fail(409,'Template alterado em outra sessão. Reabra antes de salvar.');
  }
  return {tenant:null,type:'email.template.saved'};
 },{transactional:true,audit:false});
}
