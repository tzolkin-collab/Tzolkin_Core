import {isProductId,onlyParams,fail} from '../platform/http.mjs';
import {findEditableProduct} from './catalog.mjs';
import {projectEmailRules} from './emails.mjs';

export function productPaymentRoutes(router,{env=process.env}={}){
 router.get('/api/products/:productId/payments',async({pool,reply,params,url})=>{
  onlyParams(url.searchParams,[]);if(!isProductId(params.productId))throw fail(400,'Produto inválido.');
 const product=await findEditableProduct(pool,params.productId);if(!product)throw fail(404,'Produto não encontrado.');
  const offers=(await pool.query('SELECT slug,payload,version,updated_at FROM billing_offers WHERE product_id=$1 ORDER BY slug',[product.id])).rows;
  const rules=projectEmailRules(offers.map(row=>({...row,product_id:product.id,product_name:product.name})));
  return reply(200,{product,connections:{stripe:{configured:Boolean(env.STRIPE_SECRET_KEY)},asaas:{configured:Boolean(env.ASAAS_API_KEY),environment:env.ASAAS_ENVIRONMENT==='production'?'production':'sandbox'},email:{configured:Boolean(env.EMAIL_API_KEY),provider:env.EMAIL_PROVIDER||null}},offers,rules,transaction_scope:'global_unallocated',execution:'configuration_only'});
 },{body:false});
}
