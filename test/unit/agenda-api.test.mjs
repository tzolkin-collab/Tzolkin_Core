// Agenda, backend (fase 0): campos novos de evento, edição parcial com revisão e janela de consulta por intervalo.
import test from 'node:test';
import assert from 'node:assert/strict';
import {activityInput,activityUpdateInput,trackingRange,opcional} from '../../apps/api/src/platform/tracking-model.mjs';
import {trackingRoutes} from '../../apps/api/src/modules/tracking.mjs';

const id='00000000-0000-4000-8000-000000000001';
const base={id,tenant_id:id,category:'mentoria',kind:'sessao',title:'Sessão inicial',starts_at:'2026-08-31T10:00:00-03:00',ends_at:'2026-08-31T11:00:00-03:00'};
const falha=(fn,status=400)=>assert.throws(fn,e=>e.status===status);

test('criação: descrição, local e link são opcionais e só entram quando preenchidos',()=>{
 assert.deepEqual(Object.keys(activityInput(base)),['id','tenant_id','category','kind','title','starts_at','ends_at','engagement_id'],'sem campos novos o evento é o mesmo de antes');
 const v=activityInput({...base,description:'  Pauta:\n1. Metas\t2. Prazos ',location:'Sala 2',meeting_url:'https://meet.google.com/abc-defg-hij'});
 assert.equal(v.description,'Pauta:\n1. Metas\t2. Prazos','quebra de linha e tabulação ficam, bordas são aparadas');
 assert.equal(v.location,'Sala 2');
 assert.equal(v.meeting_url,'https://meet.google.com/abc-defg-hij');
 assert.deepEqual(Object.keys(activityInput({...base,description:'',location:null,meeting_url:'  '})),Object.keys(activityInput(base)),'vazio, null e espaços não viram campo');
});

test('texto livre: sem caractere de controle, local e link em uma linha só',()=>{
 for(const lixo of ['a\u0000b','a\u0007b','a\u001bb','a\u007fb'])for(const campo of ['description','location'])falha(()=>opcional(campo,lixo));
 falha(()=>opcional('location','Sala\n2'));
 falha(()=>opcional('description','x'.repeat(2001)));
 assert.equal(opcional('description','x'.repeat(2000)).length,2000);
 falha(()=>opcional('location','x'.repeat(201)));
 falha(()=>opcional('description',42));
});

test('link da reunião: só https, sem credencial, sem javascript:',()=>{
 for(const ruim of ['http://meet.google.com/x','javascript:alert(1)','data:text/html,x','ftp://x.com/a','https://u:p@meet.google.com/x','meet.google.com/x','https://','x'.repeat(10)])falha(()=>opcional('meeting_url',ruim),400);
 falha(()=>opcional('meeting_url','https://exemplo.com/'+'a'.repeat(500)));
 assert.equal(opcional('meeting_url','https://zoom.us/j/123?pwd=abc'),'https://zoom.us/j/123?pwd=abc');
});

test('criação segue rejeitando campo desconhecido e intervalo inválido',()=>{
 falha(()=>activityInput({...base,extra:true}));
 falha(()=>activityInput({...base,ends_at:base.starts_at}));
 falha(()=>activityInput({...base,color:'red'}));
});

test('edição: parcial, com revisão obrigatória e pelo menos um campo',()=>{
 assert.deepEqual(activityUpdateInput({revision:3,title:'Novo título'}),{revision:3,campos:{title:'Novo título'}});
 const mover=activityUpdateInput({revision:1,starts_at:'2026-09-01T09:00:00-03:00',ends_at:'2026-09-01T10:30:00-03:00'});
 assert.deepEqual(mover.campos,{starts_at:'2026-09-01T12:00:00.000Z',ends_at:'2026-09-01T13:30:00.000Z'});
 falha(()=>activityUpdateInput({title:'sem revisão'}));
 for(const r of [0,-1,1.5,'2',null])falha(()=>activityUpdateInput({revision:r,title:'ok ok'}));
 falha(()=>activityUpdateInput({revision:1}),400);
 falha(()=>activityUpdateInput({revision:1,tenant_id:id}),400);
 falha(()=>activityUpdateInput({revision:1,status:'done'}),400);
 falha(()=>activityUpdateInput({revision:1,id}),400);
});

test('edição: início e fim andam juntos e o intervalo é validado inteiro',()=>{
 // A mensagem importa: sem a checagem o erro ainda seria 400, mas dizendo 'data com fuso', que não explica nada.
 for(const metade of [{starts_at:'2026-09-01T09:00:00-03:00'},{ends_at:'2026-09-01T09:00:00-03:00'}])assert.throws(()=>activityUpdateInput({revision:1,...metade}),e=>e.status===400&&/início e fim juntos/.test(e.message));
 falha(()=>activityUpdateInput({revision:1,starts_at:'2026-09-01T10:00:00-03:00',ends_at:'2026-09-01T09:00:00-03:00'}));
 falha(()=>activityUpdateInput({revision:1,starts_at:'2026-09-01T10:00:00',ends_at:'2026-09-01T11:00:00'}),400);
 falha(()=>activityUpdateInput({revision:1,title:'x'}),400);
});

test('edição: null ou vazio LIMPA descrição, local e link (diferente da criação, que omite)',()=>{
 assert.deepEqual(activityUpdateInput({revision:2,description:null,location:'',meeting_url:'  '}).campos,{description:null,location:null,meeting_url:null});
});

test('janela da consulta: mês (como antes) ou intervalo livre de até 62 dias, nunca os dois',()=>{
 assert.deepEqual(trackingRange(new URLSearchParams('month=2026-12')),{start:'2026-12-01',end:'2027-01-01',tenant:null,engagement:null});
 const semana=trackingRange(new URLSearchParams('from=2026-08-24&to=2026-08-31'));
 assert.deepEqual([semana.start,semana.end],['2026-08-24','2026-08-31']);
 assert.deepEqual([trackingRange(new URLSearchParams('from=2026-12-28&to=2027-01-04')).start,trackingRange(new URLSearchParams('from=2026-12-28&to=2027-01-04')).end],['2026-12-28','2027-01-04'],'a semana atravessa a virada do ano');
 assert.equal(trackingRange(new URLSearchParams('from=2026-08-24&to=2026-10-25')).end,'2026-10-25','62 dias é o teto');
 for(const q of ['from=2026-08-24&to=2026-10-26','from=2026-08-31&to=2026-08-24','from=2026-08-24&to=2026-08-24','from=2026-02-30&to=2026-03-05','from=2026-08-24','to=2026-08-31','from=abc&to=def','month=2026-08&from=2026-08-01&to=2026-08-08','from=2026-08-24&from=2026-08-25&to=2026-08-31','from=2026-08-24&to=2026-08-31&x=1','','month=2026-13'])falha(()=>trackingRange(new URLSearchParams(q)));
 assert.equal(trackingRange(new URLSearchParams('from=2026-08-24&to=2026-08-31&tenant_id='+id)).tenant,id);
});

// ---- rotas, com banco falso --------------------------------------------------------------------------------
function rotas(){const r={};trackingRoutes({get(p,h){r['GET '+p]=h;},post(p,h){r['POST '+p]=h;},put(p,h){r['PUT '+p]=h;}});return r;}
const corpo=b=>({headers:{'content-type':'application/json'},async *[Symbol.asyncIterator](){yield Buffer.from(JSON.stringify(b));}});

test('PUT /api/tracking/:id grava só os campos enviados, sobe a revisão e audita',async()=>{
 const sqls=[];let resposta,auditoria;
 const pool={async connect(){return{async query(sql,params=[]){sqls.push({sql,params});
  if(sql.includes('information_schema'))return{rows:[{n:3}]};
  if(sql.startsWith('UPDATE service_activities'))return{rows:[{...base,id,revision:4,title:'Novo título'}]};
  if(sql.startsWith('INSERT INTO service_activity_audit')){auditoria=params;}return{rows:[]};},release(){}};}};
 await rotas()['PUT /api/tracking/:id']({pool,params:{id},req:corpo({revision:3,title:'Novo título',location:'Sala 9'}),operator:{email:'op@x.com'},reply(s,b){resposta=[s,b];}});
 const up=sqls.find(x=>x.sql.startsWith('UPDATE service_activities'));
 assert.match(up.sql,/SET title=\$3,location=\$4,revision=revision\+1,updated_at=now\(\) WHERE id=\$1 AND revision=\$2/);
 assert.deepEqual(up.params,[id,3,'Novo título','Sala 9']);
 assert.ok(!/starts_at|description|meeting_url|category/.test(up.sql),'não mexe no que não veio');
 assert.equal(resposta[0],200);assert.equal(resposta[1].activity.revision,4);
 assert.equal(auditoria[1],'updated');assert.equal(auditoria[2],'op@x.com');
 assert.deepEqual(auditoria[3].campos,{title:'Novo título',location:'Sala 9'});
});

test('PUT com revisão velha ou atividade inexistente: 409, rollback, nada confirmado',async()=>{
 const sqls=[];
 const pool={async connect(){return{async query(sql){sqls.push(sql);return{rows:[]};},release(){}};}};
 await assert.rejects(rotas()['PUT /api/tracking/:id']({pool,params:{id},req:corpo({revision:1,title:'Qualquer'}),reply(){assert.fail();}}),e=>e.status===409);
 assert.ok(sqls.includes('ROLLBACK'));assert.ok(!sqls.includes('COMMIT'));
 assert.ok(!sqls.some(s=>String(s).startsWith('INSERT INTO service_activity_audit')),'sem gravação, sem auditoria');
});

test('PUT: id inválido e corpo inválido nem chegam ao banco',async()=>{
 const pool={async connect(){assert.fail('não deveria abrir conexão');}};
 await assert.rejects(rotas()['PUT /api/tracking/:id']({pool,params:{id:'x'},req:corpo({revision:1,title:'ok ok'}),reply(){}}),e=>e.status===400);
 await assert.rejects(rotas()['PUT /api/tracking/:id']({pool,params:{id},req:corpo({revision:1,tenant_id:id}),reply(){}}),e=>e.status===400);
 await assert.rejects(rotas()['PUT /api/tracking/:id']({pool,params:{id},req:corpo({title:'sem revisão'}),reply(){}}),e=>e.status===400);
});

test('POST: o INSERT leva só as colunas do evento; as novas aparecem quando preenchidas',async()=>{
 const inserts=[];
 const pool={async connect(){return{async query(sql,params=[]){if(sql.includes('information_schema'))return{rows:[{n:3}]};if(sql.startsWith('INSERT INTO service_activities')){inserts.push(sql);return{rows:[{...base}]};}return{rows:[]};},release(){}};}};
 const post=rotas()['POST /api/tracking'];
 await post({pool,req:corpo(base),reply(){}});
 await post({pool,req:corpo({...base,id:'00000000-0000-4000-8000-000000000002',meeting_url:'https://meet.google.com/x',description:'Pauta'}),reply(){}});
 assert.match(inserts[0],/service_activities\(id,tenant_id,category,kind,title,starts_at,ends_at,engagement_id\) VALUES\(\$1,\$2,\$3,\$4,\$5,\$6,\$7,\$8\)/,'sem campos novos o SQL é o mesmo de antes da migração');
 assert.match(inserts[1],/engagement_id,description,meeting_url\) VALUES\(\$1,\$2,\$3,\$4,\$5,\$6,\$7,\$8,\$9,\$10\)/);
});

test('GET aceita o intervalo e repassa as datas à consulta',async()=>{
 const consultas=[];
 const pool={async query(sql,params){consultas.push(params);return{rows:[]};}};
 let corpoResp;
 await rotas()['GET /api/tracking']({pool,url:new URL('http://x/api/tracking?from=2026-08-24&to=2026-08-31'),reply(s,b){corpoResp=b;}});
 assert.deepEqual(consultas[0].slice(0,2),['2026-08-24','2026-08-31']);
 assert.deepEqual(corpoResp.activities,[]);
 await assert.rejects(rotas()['GET /api/tracking']({pool,url:new URL('http://x/api/tracking?from=2026-08-24'),reply(){}}),e=>e.status===400);
});

test('sem a migração 047: GET avisa, e criar/editar COM descrição/local/link é recusado com mensagem clara (sem erro de coluna)',async()=>{
 const consultas=[];const sqlsCliente=[];
 const banco={
  async query(sql){consultas.push(sql);return{rows:[]};},
  async connect(){return{async query(sql,params=[]){sqlsCliente.push(sql);if(sql.includes('information_schema'))return{rows:[{n:2}]};return{rows:[]};},release(){}};},
 };
 const r=rotas();let resp;
 await r['GET /api/tracking']({pool:banco,url:new URL('http://x/api/tracking?month=2026-08'),reply(s,b){resp=b;}});
 assert.equal(resp.agenda_campos,false,'duas das três colunas não bastam');
 await assert.rejects(r['POST /api/tracking']({pool:banco,req:corpo({...base,description:'Pauta'}),reply(){assert.fail();}}),e=>e.status===409&&/migração 047/.test(e.message));
 await assert.rejects(r['PUT /api/tracking/:id']({pool:banco,params:{id},req:corpo({revision:1,location:'Sala 1'}),reply(){assert.fail();}}),e=>e.status===409&&/migração 047/.test(e.message));
 assert.ok(!sqlsCliente.some(q=>q.startsWith('INSERT INTO service_activities')||q.startsWith('UPDATE service_activities')),'nada foi gravado');
});

test('sem a migração, criar e editar SEM os campos novos continua funcionando e nem pergunta ao banco',async()=>{
 const sqls=[];
 const pool={async connect(){return{async query(sql){sqls.push(sql);if(sql.startsWith('INSERT INTO service_activities'))return{rows:[{...base}]};if(sql.startsWith('UPDATE service_activities'))return{rows:[{...base,revision:2}]};return{rows:[]};},release(){}};}};
 const r=rotas();
 await r['POST /api/tracking']({pool,req:corpo(base),reply(){}});
 await r['PUT /api/tracking/:id']({pool,params:{id},req:corpo({revision:1,title:'Só o título'}),reply(){}});
 assert.ok(!sqls.some(q=>q.includes('information_schema')),'sem campo novo, não há consulta extra');
 assert.ok(sqls.some(q=>q.startsWith('INSERT INTO service_activities'))&&sqls.some(q=>q.startsWith('UPDATE service_activities')));
});

test('a verificação das colunas é lembrada: verdadeiro fica; falso só é reverificado depois de um minuto',async()=>{
 let perguntas=0,n=3;
 const banco={async query(sql){if(sql.includes('information_schema')){perguntas++;return{rows:[{n}]};}return{rows:[]};}};
 const verdadeiro=rotas();
 for(let i=0;i<3;i++)await verdadeiro['GET /api/tracking']({pool:banco,url:new URL('http://x/api/tracking?month=2026-08'),reply(){}});
 assert.equal(perguntas,1,'com as colunas, pergunta uma vez só');
 perguntas=0;n=0;
 const falso=rotas();let ultimo;
 for(let i=0;i<3;i++)await falso['GET /api/tracking']({pool:banco,url:new URL('http://x/api/tracking?month=2026-08'),reply(s,b){ultimo=b;}});
 assert.equal(perguntas,1,'sem as colunas, não pergunta a cada consulta');
 assert.equal(ultimo.agenda_campos,false);
});
