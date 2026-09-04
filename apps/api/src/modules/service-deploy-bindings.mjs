import {input,text,isUuid,fail,onlyParams} from '../platform/http.mjs';

const providers=['vercel','easypanel'],environments=['development','staging','production'];
const validate=body=>{
 input(body,['provider','external_project_id','external_project_name','engagement_id','environment']);
 if(!providers.includes(body.provider)||!environments.includes(body.environment))throw fail(400,'Provedor ou ambiente inválido.');
 if(!isUuid(body.engagement_id))throw fail(400,'Contratação inválida.');
 return {provider:body.provider,external_project_id:text(body.external_project_id,1,240),external_project_name:text(body.external_project_name,1,240),engagement_id:body.engagement_id,environment:body.environment};
};

export function serviceDeployBindingRoutes(router){
 router.get('/api/service-deploy-bindings',async({pool,url,reply})=>{
  onlyParams(url.searchParams,[]);
  const rows=await pool.query(`SELECT s.provider,s.external_project_id,s.external_project_name,s.engagement_id,s.environment,s.updated_at,
    e.label,e.service_model,e.status,t.id AS tenant_id,t.name AS tenant_name
    FROM service_deploy_bindings s JOIN client_engagements e ON e.id=s.engagement_id
    JOIN tenants t ON t.id=e.tenant_id ORDER BY s.external_project_name`);
  return reply(200,{bindings:rows.rows});
 },{body:false});
 router.put('/api/service-deploy-bindings',async({client,body})=>{
  const binding=validate(body);
  const engagement=await client.query('SELECT id FROM client_engagements WHERE id=$1',[binding.engagement_id]);
  if(!engagement.rowCount)throw fail(400,'Contratação não encontrada.');
  await client.query(`INSERT INTO service_deploy_bindings(provider,external_project_id,external_project_name,engagement_id,environment)
   VALUES($1,$2,$3,$4,$5)
   ON CONFLICT(provider,external_project_id) DO UPDATE SET external_project_name=EXCLUDED.external_project_name,engagement_id=EXCLUDED.engagement_id,environment=EXCLUDED.environment,updated_at=now()`,
   [binding.provider,binding.external_project_id,binding.external_project_name,binding.engagement_id,binding.environment]);
  return {tenant:null,type:'service.deploy_binding.saved'};
 },{transactional:true,audit:false});
}
