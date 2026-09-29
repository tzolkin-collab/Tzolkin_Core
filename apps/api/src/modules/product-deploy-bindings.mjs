// Vínculo item do portfólio ↔ projeto de deploy — FACHADA da tabela antiga.
//
// A tabela product_deploy_bindings (019) deixou de ser fonte de verdade na
// migração 034: quem responde "de quem é este projeto?" é product_resource_bindings.
// Este módulo continua existindo com as MESMAS DUAS ROTAS e o MESMO CONTRATO DE
// RESPOSTA porque a tela que está no ar as chama — uma aba aberta com o app.js
// antigo continua listando e vinculando como sempre fez.
//
// O que mudou por dentro, e só isso:
//  · a listagem lê o registro único (só conexões ATIVAS, só de item, só deploy);
//  · vincular grava no registro único, com trilha, pelo mesmo núcleo da rota nova;
//  · NADA MAIS ESCREVE NA TABELA ANTIGA. Ela fica como espelho velho, intacta,
//    até o dono decidir se sai — e é por isso que a 035 recolhe o que a tela
//    antiga gravou nela durante a janela, imediatamente antes deste deploy.
//
// UMA MUDANÇA DE RESPOSTA, nomeada aqui: vincular um projeto que já está
// confirmado em outro dono passa de 200 (troca silenciosa, pelo ON CONFLICT DO
// UPDATE que existia aqui) para 409 apontando para Reatribuir. Roubar o projeto
// de uma contratação com um clique é exatamente o que a 034 existe para acabar; o
// select desta tela, de todo jeito, só aparece para projeto sem dono nenhum.
import {input,text,isProductId,fail,onlyParams} from '../platform/http.mjs';
import {findEditableProduct} from './catalog.mjs';
import {commercialPermission} from './commercial-keys.mjs';
import {aplicarVinculo,vinculoDeDeploy} from './product-resource-bindings.mjs';

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
  // As mesmas chaves de sempre, vindas da tabela nova. environment pode ser nulo
  // no registro único (a 034 adotou o da tabela antiga onde havia divergência);
  // a tela trata nulo como "ambiente não declarado", como já fazia.
  const rows=await pool.query(`SELECT provider,external_id AS external_project_id,display_name AS external_project_name,
    product_id,environment,updated_at FROM product_resource_bindings
   WHERE active AND product_id IS NOT NULL AND resource_type IN ('frontend','backend')
     AND provider IN ('vercel','easypanel') ORDER BY display_name`);
  return reply(200,{bindings:rows.rows});
 },{body:false});
 router.put('/api/product-deploy-bindings',async({client,body,operator})=>{
  const binding=validate(body);
  await commercialPermission(client,operator,true);
  if(!await findEditableProduct(client,binding.product_id))throw fail(400,'Produto não encontrado ou arquivado.');
  await aplicarVinculo(client,operator,vinculoDeDeploy(binding));
  return {tenant:null,type:'product.deploy_binding.saved'};
 },{transactional:true,audit:false});
}
