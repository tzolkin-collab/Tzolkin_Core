import pg from 'pg';
import {fail} from './http.mjs';
export const quoteIdentifier=value=>'"'+String(value).replaceAll('"','""')+'"';
export const privateTable=name=>/auth|session|credential|secret|token|audit|webhook|outbox/i.test(name);
export const privateColumn=c=>/password|passwd|secret|token|credential|authorization|cookie|email|phone|telefone|cpf|cnpj|document|address|endereco/i.test(c.name)||/json|bytea|array|user-defined/i.test(c.type);

export async function databaseInventory(pool){
 return (await pool.query(`SELECT datname AS name,datname=current_database() AS current,has_database_privilege(datname,'CONNECT') AS accessible
 FROM pg_database WHERE NOT datistemplate AND datallowconn AND datname NOT LIKE 'prisma_migrate_shadow_db_%' ORDER BY datname`)).rows;
}
// Inherit this server's credentials and TLS. No user-provided hosts or URLs.
export async function withDatabase(pool,name,task){
 if(!name)return task(pool);
 const database=(await databaseInventory(pool)).find(item=>item.name===name);
 if(!database)throw fail(404,'Banco não encontrado nesta conexão.');
 if(!database.accessible)throw fail(403,'A credencial atual não tem acesso a este banco.');
 if(database.current)return task(pool);
 const options={...pool.options,database:name,max:1,connectionTimeoutMillis:4000,statement_timeout:6000};
 if(options.connectionString){const url=new URL(options.connectionString);url.pathname='/'+encodeURIComponent(name);options.connectionString=url.href;}
 const selected=new pg.Pool(options);
 try{return await task(selected);}finally{await selected.end();}
}
export async function inspectSchema(pool){
 const rows=await pool.query(`SELECT c.table_schema,c.table_name,c.column_name,c.data_type,c.is_nullable,t.table_type,
 EXISTS(SELECT 1 FROM pg_index i JOIN pg_class r ON r.oid=i.indrelid JOIN pg_namespace n ON n.oid=r.relnamespace
 JOIN pg_attribute a ON a.attrelid=r.oid AND a.attname=c.column_name
 WHERE i.indisprimary AND n.nspname=c.table_schema AND r.relname=c.table_name AND a.attnum=ANY(i.indkey)) AS primary_key
 FROM information_schema.columns c JOIN information_schema.tables t USING(table_schema,table_name)
 WHERE c.table_schema NOT IN ('pg_catalog','information_schema') AND c.table_schema NOT LIKE 'pg_%'
 ORDER BY c.table_schema,c.table_name,c.ordinal_position`);
 const relations=await pool.query(`SELECT sn.nspname AS table_schema,s.relname AS table_name,sa.attname AS column_name,
 tn.nspname AS foreign_table_schema,t.relname AS foreign_table_name,ta.attname AS foreign_column_name,c.conname AS constraint_name
 FROM pg_constraint c JOIN pg_class s ON s.oid=c.conrelid JOIN pg_namespace sn ON sn.oid=s.relnamespace
 JOIN pg_class t ON t.oid=c.confrelid JOIN pg_namespace tn ON tn.oid=t.relnamespace
 JOIN unnest(c.conkey) WITH ORDINALITY sk(num,pos) ON true JOIN unnest(c.confkey) WITH ORDINALITY tk(num,pos) ON tk.pos=sk.pos
 JOIN pg_attribute sa ON sa.attrelid=s.oid AND sa.attnum=sk.num JOIN pg_attribute ta ON ta.attrelid=t.oid AND ta.attnum=tk.num
 WHERE c.contype='f' AND sn.nspname NOT IN ('pg_catalog','information_schema') ORDER BY sn.nspname,s.relname,c.conname,sk.pos`);
 const tables=[],index=new Map();
 for(const r of rows.rows){const key=JSON.stringify([r.table_schema,r.table_name]);let table=index.get(key);
 if(!table){table={schema:r.table_schema,name:r.table_name,kind:r.table_type,columns:[],relations:[],readable:!privateTable(r.table_name)&&r.table_type==='BASE TABLE'};index.set(key,table);tables.push(table);}
 const column={name:r.column_name,type:r.data_type,nullable:r.is_nullable==='YES',primary_key:r.primary_key};column.masked=privateColumn(column);table.columns.push(column);}
 for(const r of relations.rows)index.get(JSON.stringify([r.table_schema,r.table_name]))?.relations.push({column:r.column_name,table:`${r.foreign_table_schema}.${r.foreign_table_name}`,schema:r.foreign_table_schema,name:r.foreign_table_name,foreign_column:r.foreign_column_name,constraint:r.constraint_name});
 return {tables};
}
export async function readTableRows(pool,params){
 const {tables}=await inspectSchema(pool),table=tables.find(t=>t.schema===params.schema&&t.name===params.table);
 if(!table)throw fail(404,'Tabela não encontrada.');
 if(!table.readable)throw fail(403,'Esta tabela permite apenas consulta da estrutura.');
 const limit=Number(params.limit||50),offset=Number(params.offset||0);
 if(!Number.isInteger(limit)||limit<1||limit>100||!Number.isInteger(offset)||offset<0||offset>100000)throw fail(400,'Paginação inválida.');
 const allowed=table.columns.filter(c=>!c.masked),sort=allowed.find(c=>c.name===params.sort)||(!params.sort&&allowed.find(c=>c.primary_key));
 if(params.sort&&!sort)throw fail(400,'Coluna de ordenação inválida.');
 if(params.direction&&!['asc','desc'].includes(params.direction))throw fail(400,'Ordenação inválida.');
 const filter=allowed.find(c=>c.name===params.column);
 if(params.column&&!filter)throw fail(400,'Coluna de filtro inválida.');
 if((params.value||'').length>200)throw fail(400,'Filtro muito longo.');
 const values=[limit+1,offset];let where='';
 if(filter){values.push(params.value||'');where=` WHERE ${quoteIdentifier(filter.name)}::text = $3`;}
 const projection=table.columns.map(c=>c.masked?`NULL AS ${quoteIdentifier(c.name)}`:`left(${quoteIdentifier(c.name)}::text,1000) AS ${quoteIdentifier(c.name)}`).join(',');
 const order=[...(sort?[sort]:[]),...allowed.filter(c=>c.primary_key&&c!==sort)];
 const orderSql=order.length?' ORDER BY '+order.map(c=>`${quoteIdentifier(c.name)} ${c===sort&&params.direction==='desc'?'DESC':'ASC'} NULLS LAST`).join(','):'';
 const client=await pool.connect();
 try{await client.query('BEGIN READ ONLY');await client.query("SET LOCAL statement_timeout='5s'");
 const result=await client.query(`SELECT ${projection} FROM ${quoteIdentifier(table.schema)}.${quoteIdentifier(table.name)}${where}${orderSql} LIMIT $1 OFFSET $2`,values);
 await client.query('COMMIT');return {columns:table.columns,rows:result.rows.slice(0,limit),has_more:result.rows.length>limit,offset,limit,ordered:order.length>0};
 }catch(error){await client.query('ROLLBACK');throw error;}finally{client.release();}
}
