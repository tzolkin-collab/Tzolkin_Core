// Vínculo contratação ↔ projeto de deploy — FACHADA da tabela antiga.
//
// Mesma história de product-deploy-bindings.mjs: desde a 034 quem responde pelo
// dono é product_resource_bindings, e as três linhas que existiam aqui já foram
// copiadas para lá com engagement_id. As duas rotas continuam com o MESMO
// CONTRATO DE RESPOSTA — inclusive o rótulo, o modelo e a empresa da contratação,
// que a tela usa para escrever "Serviço · Assessoria" ao lado do projeto.
//
// A RECUSA DE HOJE FICA COMO ESTÁ, de propósito: contratação inexistente continua
// sendo 400 (e não o 404 da rota nova) e contratação ARQUIVADA continua aceitando
// vínculo. Posse não é estado de operação — a 034 diz isso em texto — e apertar a
// regra aqui mudaria a resposta de uma tela que já está no ar. Quem quiser a regra
// nova usa a rota nova.
import {input,text,isUuid,fail,onlyParams} from '../platform/http.mjs';
import {commercialPermission} from './commercial-keys.mjs';
import {aplicarVinculo,vinculoDeDeploy} from './product-resource-bindings.mjs';

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
  const rows=await pool.query(`SELECT r.provider,r.external_id AS external_project_id,r.display_name AS external_project_name,
    r.engagement_id,r.environment,r.updated_at,e.label,e.service_model,e.status,t.id AS tenant_id,t.name AS tenant_name
    FROM product_resource_bindings r JOIN client_engagements e ON e.id=r.engagement_id
    JOIN tenants t ON t.id=e.tenant_id
   WHERE r.active AND r.resource_type IN ('frontend','backend') AND r.provider IN ('vercel','easypanel')
   ORDER BY r.display_name`);
  return reply(200,{bindings:rows.rows});
 },{body:false});
 router.put('/api/service-deploy-bindings',async({client,body,operator})=>{
  const binding=validate(body);
  await commercialPermission(client,operator,true);
  const engagement=await client.query('SELECT id FROM client_engagements WHERE id=$1',[binding.engagement_id]);
  if(!engagement.rowCount)throw fail(400,'Contratação não encontrada.');
  await aplicarVinculo(client,operator,vinculoDeDeploy(binding));
  return {tenant:null,type:'service.deploy_binding.saved'};
 },{transactional:true,audit:false});
}
