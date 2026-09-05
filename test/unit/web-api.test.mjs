import test from 'node:test';
import assert from 'node:assert/strict';
import http from 'node:http';
import { createCore } from '../../apps/api/src/app.mjs';
import { createWeb } from '../../apps/web/server.mjs';
const listen=server=>new Promise(r=>server.listen(0,'127.0.0.1',r));
const stop=server=>new Promise(r=>{server.closeAllConnections();server.close(r);});

test('separate web and API preserve cookies, CSRF, logout and static isolation',async()=>{
 // Reservar a porta do web antes de compor a API com origem exata.
 const reserve=http.createServer();await listen(reserve);const port=reserve.address().port;await stop(reserve);
 const origin=`http://127.0.0.1:${port}`;
 let optionsCalls=0;
 const api=createCore({pool:{},adminPassword:'synthetic-password-for-split-test',webOrigin:origin,deployRegistry:[],deliveryOptions:{options:async()=>{optionsCalls++;return {ok:true}}}});
 await listen(api);const apiOrigin=`http://127.0.0.1:${api.address().port}`;
 const web=createWeb({apiOrigin});await new Promise(r=>web.listen(port,'127.0.0.1',r));
 const request=(path,method='GET',body,headers={})=>fetch(origin+path,{method,headers:{origin,'Content-Type':'application/json',...headers},body:body===undefined?undefined:JSON.stringify(body)});
 try {
  const page=await request('/');assert.equal(page.status,200);assert.match(await page.text(),/delivery-repositories/);
  for(const asset of ['/app.js','/product-payments.js','/checkout-gateway.js','/delivery.js','/delivery.css','/style.css','/logo.svg','/logos/nubank.svg','/logos/itau.svg','/logos/stripe.svg'])assert.equal((await request(asset)).status,200);
  for(const path of ['/.env','/src/server.mjs','/package.json','/certs/postgres-server.crt','/unknown'])assert.equal((await request(path)).status,404);
  assert.equal((await fetch(apiOrigin+'/')).status,401);
  assert.equal((await request('/api/delivery/options')).status,401);assert.equal(optionsCalls,0);
  assert.equal((await request('/api/login','POST',{password:'synthetic-password-for-split-test'},{origin:'https://evil.invalid'})).status,403);
  const login=await request('/api/login','POST',{password:'synthetic-password-for-split-test'});assert.equal(login.status,200);
  const rawCookie=login.headers.get('set-cookie');assert.match(rawCookie,/HttpOnly/);assert.match(rawCookie,/SameSite=Strict/);
  const cookie=rawCookie.split(';')[0];
  const response=await request('/api/delivery/options','GET',undefined,{cookie});assert.equal(response.status,200);assert.equal(optionsCalls,1);assert.equal(response.headers.get('access-control-allow-origin'),null);
  assert.equal((await fetch(apiOrigin+'/app.js',{headers:{cookie}})).status,404);
  assert.equal((await fetch(apiOrigin+'/api/login',{method:'POST',headers:{origin:apiOrigin,'Content-Type':'application/json'},body:'{}'})).status,403);
  assert.equal((await request('/api/login','POST',{password:'x'.repeat(17000)})).status,413);
  assert.equal((await request('/api/delivery/options','OPTIONS')).status,405);
  assert.equal((await request('/api/logout','POST',{}, {cookie})).status,200);
  assert.equal((await request('/api/delivery/options','GET',undefined,{cookie})).status,401);
 } finally {await stop(web);await stop(api);}
});

test('local proxy rejects non-loopback targets and gives a safe offline error',async()=>{
 for(const apiOrigin of ['https://remote.example','http://127.0.0.1:1/secret','http://secret@127.0.0.1:1','http://127.0.0.1:1/?token=x'])assert.throws(()=>createWeb({apiOrigin}));
 const api=http.createServer();await listen(api);const apiOrigin=`http://127.0.0.1:${api.address().port}`;await stop(api);
 const web=createWeb({apiOrigin});await listen(web);
 try {const response=await fetch(`http://127.0.0.1:${web.address().port}/api/session`);assert.equal(response.status,502);assert.match((await response.json()).message,/API indisponível/);}
 finally {await stop(web);}
});

// Regressão: DELETE existe na API e o painel o chama (app.js e projects.js), mas
// estava quebrado nos dois runtimes por motivos diferentes — o proxy de dev não
// encaminhava o verbo (405) e, em produção, app.mjs exigia Content-Type e devolvia
// 415. Este teste prova os dois consertos e que a guarda de JSON continua de pé.
test('DELETE sem corpo atravessa proxy e roteador, e a guarda de JSON continua valendo',async()=>{
 const reserve=http.createServer();await listen(reserve);const port=reserve.address().port;await stop(reserve);
 const origin=`http://127.0.0.1:${port}`;
 // Pool sintético: só precisa responder BEGIN/SELECT/ROLLBACK. O SELECT vazio leva
 // o handler ao 404 — e chegar ao 404 é a prova de que a requisição passou.
 const client={query:async()=>({rows:[]}),release(){}};
 const api=createCore({pool:{connect:async()=>client},adminPassword:'synthetic-password-for-delete-test',webOrigin:origin,deployRegistry:[]});
 await listen(api);
 const web=createWeb({apiOrigin:`http://127.0.0.1:${api.address().port}`});await new Promise(r=>web.listen(port,'127.0.0.1',r));
 // Sem Content-Type de propósito: é assim que o navegador manda um DELETE sem corpo.
 const send=(path,method,headers={})=>fetch(origin+path,{method,headers:{origin,...headers}});
 try {
  const login=await fetch(origin+'/api/login',{method:'POST',headers:{origin,'Content-Type':'application/json'},body:JSON.stringify({password:'synthetic-password-for-delete-test'})});
  assert.equal(login.status,200);
  const cookie=login.headers.get('set-cookie').split(';')[0];

  const remove=await send('/api/product-resource-bindings/00000000-0000-4000-8000-000000000000','DELETE',{cookie});
  assert.notEqual(remove.status,405,'o proxy de dev precisa encaminhar DELETE');
  assert.notEqual(remove.status,415,'DELETE sem corpo não pode exigir Content-Type');
  assert.equal(remove.status,404);
  assert.equal((await remove.json()).message,'Conexão não encontrada.');

  // Onde o corpo é obrigatório, 415 continua sendo a resposta certa.
  assert.equal((await send('/api/checkout-templates','PUT',{cookie})).status,415);

  // Permissions-Policy repassada: dev deixa de ser mais permissivo que produção.
  assert.match(remove.headers.get('permissions-policy'),/payment=\(\)/);
 } finally {await stop(web);await stop(api);}
});
