import {onlyParams} from '../platform/http.mjs';
import {databaseInventory,inspectSchema,readTableRows,withDatabase} from '../platform/database-explorer.mjs';
export function managementRoutes(router){
 router.get('/api/management/databases',async({pool,url,reply})=>{
  onlyParams(url.searchParams,[]);
  reply(200,{databases:await databaseInventory(pool),checked_at:new Date().toISOString()});
 },{body:false});
 router.get('/api/management/schema',async({pool,url,reply})=>{
  onlyParams(url.searchParams,['database']);
  reply(200,await withDatabase(pool,url.searchParams.get('database'),inspectSchema));
 },{body:false});
 router.get('/api/management/rows',async({pool,url,reply,operator})=>{
  onlyParams(url.searchParams,['database','schema','table','limit','offset','column','value','sort','direction']);
  const params=Object.fromEntries(url.searchParams);
  const result=await withDatabase(pool,params.database,selected=>readTableRows(selected,params));
  // Trilha própria, não audit_events: grava o nome da coluna filtrada, nunca o
  // valor procurado. A auditoria é importante, mas não pode transformar uma
  // migração pendente em falha de leitura. O deploy aplica a 024; este fallback
  // mantém o explorador funcional enquanto a tabela ainda não existir.
  try {
   await pool.query(`INSERT INTO database_access_audit(actor,database_name,schema_name,table_name,row_limit,row_offset,filter_column)
    VALUES($1,$2,$3,$4,$5,$6,$7)`,
    [operator?.email||operator?.subject||'local-operator',params.database||'',params.schema,params.table,
     Number(params.limit)||null,Number(params.offset)||null,params.column||null]);
  } catch(error) {
   // Auditoria nunca pode transformar uma leitura válida em erro 500. Isso
   // cobre tabela ausente, migração parcial e divergência de schema; o código
   // técnico ajuda o operador a corrigir a instalação sem vazar SQL/segredos.
   console.warn(`[management] auditoria indisponível (${error?.code||'sem código'}); leitura entregue sem auditoria.`);
  }
  reply(200,result);
 },{body:false});
}
