// Metadata-only production check. Never prints role, host, grants, data or credentials.
import {openDatabase} from '../apps/api/src/platform/database.mjs';
let pool;
try{
 ({pool}=await openDatabase({connectionString:process.env.DATABASE_URL,mode:'require',max:1}));
 const result=await pool.query(`SELECT
  EXISTS(SELECT 1 FROM pg_tables WHERE schemaname='public' AND tableowner=current_user) AS owns_tables,
  has_table_privilege(current_user,'audit_events','DELETE') AS can_delete_audit,
  has_database_privilege(current_user,current_database(),'CREATE') AS can_create_database_objects`);
 const policy=result.rows[0];console.log(JSON.stringify({dedicated_runtime_role:!policy.owns_tables&&!policy.can_delete_audit&&!policy.can_create_database_objects}));
 if(policy.owns_tables||policy.can_delete_audit||policy.can_create_database_objects)process.exitCode=2;
}catch{console.log(JSON.stringify({dedicated_runtime_role:false,check:'failed'}));process.exitCode=1;}finally{await pool?.end();}
