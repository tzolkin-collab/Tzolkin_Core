// Creates/rotates the restricted production role. Password comes only from env.
import {openDatabase} from '../apps/api/src/platform/database.mjs';
const password=process.env.CORE_RUNTIME_DB_PASSWORD;
if(typeof password!=='string'||password.length<32||!/^[A-Za-z0-9_-]+$/.test(password))throw Error('CORE_RUNTIME_DB_PASSWORD must be a 32+ character base64url value.');
const role='tzolkin_core_runtime',database=new URL(process.env.DATABASE_URL).pathname.slice(1);if(!/^[a-z][a-z0-9_]{1,62}$/.test(database))throw Error('Database identifier is unsafe.');let pool;
try{
 ({pool}=await openDatabase({connectionString:process.env.DATABASE_URL,mode:'require',max:1}));const c=await pool.connect();
 try{await c.query('BEGIN');await c.query(`DO $do$ BEGIN IF NOT EXISTS(SELECT 1 FROM pg_roles WHERE rolname='${role}') THEN CREATE ROLE ${role} LOGIN; END IF; END $do$`);
  await c.query(`ALTER ROLE ${role} WITH LOGIN PASSWORD '${password}' NOSUPERUSER NOCREATEDB NOCREATEROLE NOINHERIT NOREPLICATION NOBYPASSRLS`);
  await c.query(`GRANT CONNECT ON DATABASE "${database}" TO ${role}`);
  await c.query(`GRANT USAGE ON SCHEMA public TO ${role}; GRANT SELECT,INSERT,UPDATE ON ALL TABLES IN SCHEMA public TO ${role}; GRANT USAGE,SELECT ON ALL SEQUENCES IN SCHEMA public TO ${role}; REVOKE DELETE,TRUNCATE,REFERENCES,TRIGGER ON ALL TABLES IN SCHEMA public FROM ${role}; REVOKE CREATE ON SCHEMA public FROM ${role}; ALTER DEFAULT PRIVILEGES IN SCHEMA public GRANT SELECT,INSERT,UPDATE ON TABLES TO ${role}; ALTER DEFAULT PRIVILEGES IN SCHEMA public GRANT USAGE,SELECT ON SEQUENCES TO ${role}`);
  await c.query('COMMIT');console.log(JSON.stringify({runtime_role:'configured',delete_audit:false}));
 }catch(error){await c.query('ROLLBACK');throw error;}finally{c.release();}
}catch{console.log(JSON.stringify({runtime_role:'failed'}));process.exitCode=1;}finally{await pool?.end();}
