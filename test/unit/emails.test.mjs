import test from 'node:test';
import assert from 'node:assert/strict';
import {projectEmailRules,emailRoutes} from '../../apps/api/src/modules/emails.mjs';
import {validateEmailTemplate,emailTemplateRoutes} from '../../apps/api/src/modules/email-templates.mjs';
import {createCore} from '../../apps/api/src/app.mjs';
test('email projection excludes financial amounts, secrets and unknown event fields',()=>{
 const projected=projectEmailRules([{product_id:'sites',product_name:'Sites',slug:'pro',version:1,payload:{name:'Pro',provider:'stripe',email_owner:'core',amount_minor:99900,secret:'must-not-leak',email_templates:{welcome:'boas-vindas',secret:'must-not-leak'}}}]);
 assert.deepEqual(projected[0].templates,[{event:'welcome',slug:'boas-vindas'}]);assert.ok(!JSON.stringify(projected).includes('must-not-leak'));assert.ok(!JSON.stringify(projected).includes('amount_minor'));
});
test('email inventory reads saved offers and never pretends delivery is integrated',async()=>{
 let handler;emailRoutes({get:(path,fn)=>handler=fn});let response;await handler({pool:{query:async()=>({rows:[]})},reply:(status,body)=>{response={status,body};}});
 assert.equal(response.status,200);assert.equal(response.body.delivery,'not_integrated');assert.equal(response.body.inbound,'not_integrated');assert.deepEqual(response.body.rules,[]);
});
test('email configuration requires admin before any database reads',async()=>{
 let reads=0;const server=createCore({pool:{query:async()=>{reads++;return{rows:[]};}},adminPassword:'test-emails-password-123456789'});await new Promise(r=>server.listen(0,'127.0.0.1',r));
 try{const r=await fetch('http://127.0.0.1:'+server.address().port+'/api/emails');assert.equal(r.status,401);assert.equal(reads,0);}finally{server.closeAllConnections();await new Promise(r=>server.close(r));}
});
test('email template editor validates safe product scoped drafts',async()=>{
 const body={product_id:'sites',slug:'welcome',event:'welcome',name:'Boas-vindas',subject:'Olá {{name}}',preheader:'',body:'Olá {{name}}',version:0};
 assert.equal(validateEmailTemplate(body).body,'Olá {{name}}');
 assert.throws(()=>validateEmailTemplate({...body,event:'unknown'}),/Evento/);
 let handler;emailTemplateRoutes({get:(path,fn)=>handler=fn,put(){}});let response;
 await handler({pool:{query:async(sql,args)=>{if(sql.includes('SELECT id,name FROM products'))return{rows:[{id:'sites',name:'Sites'}]};assert.match(sql,/email_templates/);assert.deepEqual(args,['sites']);return{rows:[]};}},url:new URL('http://core.local/api/email-templates?product_id=sites'),reply:(status,payload)=>{response={status,payload};}});
 assert.equal(response.status,200);assert.deepEqual(response.payload.templates,[]);assert.equal(response.payload.execution,'draft_only');
});
