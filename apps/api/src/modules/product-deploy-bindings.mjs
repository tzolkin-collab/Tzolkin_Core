import {input,text,isProductId,fail,onlyParams} from '../platform/http.mjs';
import {findEditableProduct} from './catalog.mjs';

const providers=['vercel','easypanel'],environments=['development','staging','production'];
const validate=body=>{
 input(body,['provider','external_project_id','external_project_name','product_id','environment']);
 if(!providers.includes(body.provider)||!environments.includes(body.environment))throw fail(400,'Provedor ou ambiente inválido.');
 if(!isProductId(body.product_id))throw fail(400,'Produto inválido.');
 return {provider:body.provider,external_project_id:text(body.external_project_id,1,240),external_project_name:text(body.external_project_name,1,240),product_id:body.product_id,environment:body.environment};
};

export function productDeployBindingRoutes(router){
 router.get('/api/product-deploy-bindings',async({pool,url,reply})=>{
  onlyParams(url.searchParams,[]);
  const rows=await pool.query('SELECT provider,external_project_id,external_project_name,product_id,environment,updated_at FROM product_deploy_bindings ORDER BY external_project_name');
  return reply(200,{bindings:rows.rows});
 },{body:false});
 router.put('/api/product-deploy-bindings',async({client,body})=>{
  const binding=validate(body);if(!await findEditableProduct(client,binding.product_id))throw fail(400,'Produto não encontrado ou arquivado.');
  const result=await client.query(`INSERT INTO product_deploy_bindings(provider,external_project_id,external_project_name,product_id,environment)
   VALUES($1,$2,$3,$4,$5)
   ON CONFLICT(provider,external_project_id) DO UPDATE SET external_project_name=EXCLUDED.external_project_name,product_id=EXCLUDED.product_id,environment=EXCLUDED.environment,updated_at=now()
   RETURNING provider,external_project_id,external_project_name,product_id,environment,updated_at`,[binding.provider,binding.external_project_id,binding.external_project_name,binding.product_id,binding.environment]);
  return {tenant:null,type:'product.deploy_binding.saved'};
 },{transactional:true,audit:false});
}
