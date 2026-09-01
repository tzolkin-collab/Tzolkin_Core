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
  for(const asset of ['/app.js','/delivery.js','/delivery.css','/style.css','/logo.svg'])assert.equal((await request(asset)).status,200);
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
