import test from 'node:test';
import assert from 'node:assert/strict';
import {activityInput,timeInput,trackingRange} from '../../apps/api/src/platform/tracking-model.mjs';
import {trackingRoutes} from '../../apps/api/src/modules/tracking.mjs';
import {createCore} from '../../apps/api/src/app.mjs';
const id='00000000-0000-4000-8000-000000000001';
const activity={id,tenant_id:id,category:'mentoria',kind:'sessao',title:'Sessão inicial',starts_at:'2026-08-31T10:00:00-03:00',ends_at:'2026-08-31T11:00:00-03:00'};
test('agenda normaliza horário e rejeita intervalos inválidos',()=>{
 assert.equal(activityInput(activity).starts_at,'2026-08-31T13:00:00.000Z');
 for(const override of [{ends_at:activity.starts_at},{starts_at:'2026-08-31T10:00:00'},{category:'fake'},{tenant_id:'bad'},{extra:true}])assert.throws(()=>activityInput({...activity,...override}));
});
test('apontamento exige duração inteira, data válida e descrição',()=>{
 const b={id,minutes:60,worked_on:'2026-08-31',note:'Planejamento'};assert.equal(timeInput(b).minutes,60);
 for(const override of [{minutes:0},{minutes:1.5},{minutes:1441},{worked_on:'2026-02-30'},{worked_on:'2099-01-01'},{note:''}])assert.throws(()=>timeInput({...b,...override}));
});
test('filtro valida tenant e virada do ano',()=>{
 assert.deepEqual(trackingRange(new URLSearchParams('month=2026-12')),{start:'2026-12-01',end:'2027-01-01',tenant:null});
 for(const q of ['month=2026-13','month=2026-08&month=2026-09','month=2026-08&tenant_id=bad','month=2026-08&sql=x'])assert.throws(()=>trackingRange(new URLSearchParams(q)));
});
test('falha de auditoria reverte a transação e libera conexão',async()=>{
 const routes=new Map();trackingRoutes({get(){},put(){},post(path,handler){routes.set(path,handler);}});
 const statements=[];let replied=false;
 const pool={async connect(){return{async query(sql){statements.push(sql);if(sql.startsWith('INSERT INTO service_activities'))return{rows:[activity]};if(sql.startsWith('INSERT INTO service_activity_audit'))throw Error('audit offline');return{rows:[]};},release(){statements.push('release');}};}};
 const req={headers:{'content-type':'application/json'},async *[Symbol.asyncIterator](){yield Buffer.from(JSON.stringify(activity));}};
 await assert.rejects(routes.get('/api/tracking')({pool,req,reply(){replied=true;}}));
 assert.equal(replied,false);assert.deepEqual(statements.slice(-2),['ROLLBACK','release']);assert.ok(!statements.includes('COMMIT'));
});
test('status concorrente falha sem confirmar gravação',async()=>{
 let handler;trackingRoutes({get(){},post(){},put(p,h){handler=h;}});const statements=[];
 const pool={async connect(){return{async query(sql){statements.push(sql);return{rows:[]};},release(){}};}};
 const req={headers:{'content-type':'application/json'},async *[Symbol.asyncIterator](){yield Buffer.from(JSON.stringify({revision:1,status:'done'}));}};
 await assert.rejects(handler({pool,params:{id},req,reply(){assert.fail();}}),e=>e.status===409);assert.ok(statements.includes('ROLLBACK'));
});
test('repetir criação idêntica não duplica auditoria; payload diferente conflita',async()=>{
 let handler;trackingRoutes({get(){},put(){},post(p,h){if(p==='/api/tracking')handler=h;}});
 let stored=null,audits=0;
 const pool={async connect(){return {async query(sql){if(sql.startsWith('INSERT INTO service_activities')){if(stored)return{rows:[]};stored=activityInput(activity);return{rows:[stored]};}if(sql.startsWith('SELECT * FROM service_activities'))return{rows:[stored]};if(sql.startsWith('INSERT INTO service_activity_audit'))audits++;return{rows:[]};},release(){}};}};
 const invoke=b=>handler({pool,reply(){},req:{headers:{'content-type':'application/json'},async *[Symbol.asyncIterator](){yield Buffer.from(JSON.stringify(b));}}});
 await invoke(activity);await invoke(activity);assert.equal(audits,1);await assert.rejects(invoke({...activity,title:'Outro título'}),e=>e.status===409);
});
test('tracking não permite acesso anônimo nem mutação cross-origin',async()=>{
 const pool={query(){assert.fail('Não deve consultar banco sem autenticação');}};
 const server=createCore({pool,adminPassword:'test-tracking-password-only',deployRegistry:[]});await new Promise(r=>server.listen(0,'127.0.0.1',r));const base='http://127.0.0.1:'+server.address().port;
 try{assert.equal((await fetch(base+'/api/tracking?month=2026-08')).status,401);assert.equal((await fetch(base+'/api/tracking',{method:'POST',headers:{Origin:'https://example.invalid'}})).status,403);}finally{server.closeAllConnections();await new Promise(r=>server.close(r));}
});
