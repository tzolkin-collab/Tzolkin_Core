import pg from 'pg';
import {readFileSync} from 'node:fs';
const catalog=JSON.parse(readFileSync(new URL('../db/notion-catalog.json',import.meta.url),'utf8'));
const pool=new pg.Pool({connectionString:process.env.DATABASE_URL});
const client=await pool.connect();
try {
 await client.query('BEGIN');
 await client.query('CREATE TABLE IF NOT EXISTS ecosystem_entries (id text PRIMARY KEY, kind text NOT NULL, payload jsonb NOT NULL, imported_at date NOT NULL)');
 for(const product of catalog.products) {
  // O catálogo é a fonte de verdade do nome exibido; o id (e portanto os contratos) nunca muda.
  await client.query('INSERT INTO products(id,name) VALUES($1,$2) ON CONFLICT(id) DO UPDATE SET name=EXCLUDED.name',[product.id,product.name]);
  await client.query('INSERT INTO ecosystem_entries VALUES($1,$2,$3,$4) ON CONFLICT(id) DO UPDATE SET payload=EXCLUDED.payload,imported_at=EXCLUDED.imported_at',[product.id,'product',JSON.stringify(product),catalog.imported_at]);
 }
 for(const [index,resource] of catalog.resources.entries()) await client.query('INSERT INTO ecosystem_entries VALUES($1,$2,$3,$4) ON CONFLICT(id) DO UPDATE SET payload=EXCLUDED.payload,imported_at=EXCLUDED.imported_at',['resource-'+index,'resource',JSON.stringify(resource),catalog.imported_at]);
 await client.query('COMMIT');
 console.log('Catálogo importado: 6 produtos e 7 atalhos. Ids preservados; nome e ficha sincronizados com o catálogo.');
} catch(error) { await client.query('ROLLBACK'); console.error('Importação não concluída.',error.code||'Erro'); process.exitCode=1; }
finally {client.release();await pool.end();}
