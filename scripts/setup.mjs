import { readFileSync, writeFileSync, existsSync } from 'node:fs';
import { parseEnv } from 'node:util';
import { randomBytes } from 'node:crypto';
import pg from 'pg';
import { applyMigrations } from './migrate.mjs';
let client;
try {
 if (!existsSync('.env')) {
  const source = parseEnv(readFileSync(process.argv[2], 'utf8'));
  const url = new URL(source.TZ_DATABASE_URL);
  client = new pg.Client({connectionString:url.href,connectionTimeoutMillis:10000}); await client.connect();
  const exists = await client.query("SELECT 1 FROM pg_database WHERE datname='tzolkin_core' UNION ALL SELECT 1 FROM pg_roles WHERE rolname='tzolkin_core_app'");
  if(exists.rowCount) throw new Error('Existing target requires manual verification');
  const password=randomBytes(36).toString('hex');
  await client.query(`CREATE ROLE tzolkin_core_app LOGIN PASSWORD '${password}' NOSUPERUSER NOCREATEDB NOCREATEROLE`);
  await client.query('CREATE DATABASE tzolkin_core OWNER tzolkin_core_app');
  await client.query('REVOKE ALL ON DATABASE tzolkin_core FROM PUBLIC');
  url.username='tzolkin_core_app'; url.password=password; url.pathname='/tzolkin_core';
  writeFileSync('.env',`DATABASE_URL=${url.href}\nCORE_ADMIN_PASSWORD=${randomBytes(24).toString('base64url')}\nPORT=3100\n`,{flag:'wx'});
  await client.end();
 }
 const env=parseEnv(readFileSync('.env','utf8'));
 client=new pg.Client({connectionString:env.DATABASE_URL,connectionTimeoutMillis:10000}); await client.connect();
 await client.query(readFileSync('db/schema.sql','utf8'));
 if(!await applyMigrations(client)) throw new Error('migration failed');
 console.log('Core database ready. Local admin credential saved in ignored .env; no secrets printed.');
} catch { console.error('Core setup failed; connection details suppressed.'); process.exitCode=1; }
finally { await client?.end(); }
