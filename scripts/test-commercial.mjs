// Creates a new disposable database, never falls back to the live database for tests.
import pg from 'pg';import{readFileSync}from'node:fs';import{parseEnv}from'node:util';import{randomBytes}from'node:crypto';import{spawn}from'node:child_process';import{applyMigrations}from'./migrate.mjs';
const env=parseEnv(readFileSync('.env','utf8')),name='tzolkin_test_commercial_'+randomBytes(6).toString('hex');
const admin=new pg.Client({connectionString:env.DATABASE_URL,connectionTimeoutMillis:10000});let created=false,testClient;
try {await admin.connect();await admin.query(`CREATE DATABASE ${name}`);created=true;const url=new URL(env.DATABASE_URL);url.pathname='/'+name;
 testClient=new pg.Client({connectionString:url.href,connectionTimeoutMillis:10000});await testClient.connect();await testClient.query(readFileSync('db/schema.sql','utf8'));if(!await applyMigrations(testClient,()=>{}))throw Error('MIGRATIONS_FAILED');if(!await applyMigrations(testClient,()=>{}))throw Error('MIGRATIONS_REPLAY_FAILED');
 for(const path of ['001_leads.sql','002_lead_delivery.sql','004_core_outbox.sql'])await testClient.query(readFileSync('../tzolkin-site/db/'+path,'utf8'));
 await testClient.end();testClient=null;
 // DATABASE_URL é forçada para o banco descartável nos processos filhos. Nem o importador nem um
 // teste que leia process.env.DATABASE_URL direto consegue alcançar o banco de produção.
 const isolado={...process.env,DATABASE_URL:url.href,DATABASE_URL_TEST:url.href};
 // Catálogo do Notion: vem de db/notion-catalog.json, arquivo local, sem rede. Sem ele as suítes que
 // conferem ecosystem_entries falham num banco novo.
 const importCode=await new Promise(resolve=>{const p=spawn(process.execPath,['scripts/import-notion.mjs'],{env:isolado,stdio:'inherit'});p.on('exit',resolve);});
 if(importCode)throw Error('CATALOG_IMPORT_FAILED');
 // Os arquivos de integração dividem este banco. Em paralelo, um conta as chaves ou os produtos do
 // outro; em série, cada arquivo vê só o que ele mesmo criou.
 // Arquivos passados por nome (test/x.test.mjs) rodam sozinhos; --all roda tudo; sem nada, a suíte comercial.
 const arquivos=process.argv.slice(2).filter(a=>/^test\/[\w/.-]+\.test\.mjs$/.test(a)&&!a.includes('..'));
 const alvo=arquivos.length?arquivos:process.argv.includes('--all')?['test/**/*.test.mjs']:['test/commercial-intake.test.mjs'];
 const code=await new Promise(resolve=>{const p=spawn(process.execPath,['--test','--test-concurrency=1',...alvo],{env:isolado,stdio:'inherit'});p.on('exit',resolve);});process.exitCode=code||0;
} catch(e){console.error({error:e.code||e.message});process.exitCode=1;}finally{await testClient?.end();if(created&&/^tzolkin_test_commercial_[0-9a-f]{12}$/.test(name))await admin.query(`DROP DATABASE ${name} WITH (FORCE)`);await admin.end();}
