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
  // Trilha própria, não audit_events: aquela tabela exige tenant_id NOT NULL e a
  // leitura de uma tabela do banco não tem tenant, então o INSERT violava a
  // constraint e a rota devolvia 500 em toda chamada. Ver migração 024.
  // Grava o nome da coluna filtrada, nunca o valor procurado.
  await pool.query(`INSERT INTO database_access_audit(actor,database_name,schema_name,table_name,row_limit,row_offset,filter_column)
   VALUES($1,$2,$3,$4,$5,$6,$7)`,
   [operator?.email||operator?.subject||'local-operator',params.database||'',params.schema,params.table,
    Number(params.limit)||null,Number(params.offset)||null,params.column||null]);
  reply(200,result);
 },{body:false});
}
