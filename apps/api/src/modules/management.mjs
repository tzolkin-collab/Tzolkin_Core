import {onlyParams} from '../platform/http.mjs';

// Metadados do banco, nunca linhas ou valores.
export function managementRoutes(router){
 router.get('/api/management/schema',async({pool,url,reply})=>{
  onlyParams(url.searchParams,[]);
  const rows=await pool.query(`SELECT table_schema,table_name,column_name,data_type,is_nullable
   FROM information_schema.columns WHERE table_schema NOT IN ('pg_catalog','information_schema')
   ORDER BY table_schema,table_name,ordinal_position`);
  const relations=await pool.query(`SELECT source_schema.nspname AS table_schema,source_table.relname AS table_name,source_column.attname AS column_name,
   target_schema.nspname AS foreign_table_schema,target_table.relname AS foreign_table_name,target_column.attname AS foreign_column_name
   FROM pg_constraint relation
   JOIN pg_class source_table ON source_table.oid=relation.conrelid
   JOIN pg_namespace source_schema ON source_schema.oid=source_table.relnamespace
   JOIN pg_class target_table ON target_table.oid=relation.confrelid
   JOIN pg_namespace target_schema ON target_schema.oid=target_table.relnamespace
   JOIN unnest(relation.conkey) WITH ORDINALITY AS source_key(attnum,position) ON true
   JOIN unnest(relation.confkey) WITH ORDINALITY AS target_key(attnum,position) ON target_key.position=source_key.position
   JOIN pg_attribute source_column ON source_column.attrelid=source_table.oid AND source_column.attnum=source_key.attnum
   JOIN pg_attribute target_column ON target_column.attrelid=target_table.oid AND target_column.attnum=target_key.attnum
   WHERE relation.contype='f' AND source_schema.nspname NOT IN ('pg_catalog','information_schema')
   ORDER BY source_schema.nspname,source_table.relname,source_column.attname`);
  const tables=[];for(const row of rows.rows){let table=tables.find(item=>item.schema===row.table_schema&&item.name===row.table_name);if(!table){table={schema:row.table_schema,name:row.table_name,columns:[],relations:[]};tables.push(table);}table.columns.push({name:row.column_name,type:row.data_type,nullable:row.is_nullable==='YES'});}
  for(const row of relations.rows){const table=tables.find(item=>item.schema===row.table_schema&&item.name===row.table_name);if(table)table.relations.push({column:row.column_name,table:`${row.foreign_table_schema}.${row.foreign_table_name}`,foreign_column:row.foreign_column_name});}
  return reply(200,{tables});
 },{body:false});
}
