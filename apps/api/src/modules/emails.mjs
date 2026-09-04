import {EMAIL_EVENTS} from './billing.mjs';
// Configuration inventory only. No provider credentials, recipients or fake deliveries.
export function projectEmailRules(rows){
 return rows.map(row=>({product_id:row.product_id,product_name:row.product_name,offer_slug:row.slug,offer_name:row.payload.name,provider:row.payload.provider,owner:row.payload.email_owner,version:row.version,
  templates:EMAIL_EVENTS.filter(event=>row.payload.email_templates?.[event]).map(event=>({event,slug:row.payload.email_templates[event]}))}));
}
export function emailRoutes(router){
 router.get('/api/emails',async({pool,reply})=>{
  const result=await pool.query(`SELECT b.product_id,p.name AS product_name,b.slug,b.payload,b.version
   FROM billing_offers b JOIN products p ON p.id=b.product_id AND p.lifecycle_status='active' ORDER BY p.name,b.slug`);
  return reply(200,{rules:projectEmailRules(result.rows),delivery:'not_integrated',inbound:'not_integrated',templates:'draft_editor'});
 });
}
