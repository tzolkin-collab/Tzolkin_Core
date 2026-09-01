// Servidor local do frontend. Sem banco, tokens de provedor ou imports da API.
import http from 'node:http';
import { pathToFileURL } from 'node:url';
import { serveAsset } from './assets.mjs';

export function createWeb({ apiOrigin = 'http://127.0.0.1:3102' } = {}) {
 const upstream = new URL(apiOrigin);
 if (upstream.protocol !== 'http:' || upstream.hostname !== '127.0.0.1' || upstream.username || upstream.password || upstream.pathname !== '/' || upstream.search || upstream.hash)
  throw Error('O proxy local exige uma API de loopback, sem caminho ou credenciais.');
 const server = http.createServer(async (req,res) => {
  res.setHeader('Cache-Control','no-store');
  res.setHeader('X-Content-Type-Options','nosniff');
  res.setHeader('Content-Security-Policy',"default-src 'self'; style-src 'self'; script-src 'self'; frame-ancestors 'none'; form-action 'self'");
  res.setHeader('Referrer-Policy','no-referrer');
  const error = (status,message) => { if (!res.headersSent) { res.writeHead(status,{'Content-Type':'application/json; charset=utf-8'}); res.end(JSON.stringify({message})); } else res.destroy(); };
  try {
   const host = `127.0.0.1:${server.address().port}`;
   if (req.headers.host !== host || !req.url.startsWith('/') || req.url.startsWith('//')) return error(400,'Endereço inválido.');
   const url = new URL(req.url,`http://${host}`);
   const isApi = url.pathname === '/health' || url.pathname.startsWith('/api/') || url.pathname.startsWith('/v1/');
   if (!isApi) {
    if(req.method !== 'GET') return error(405,'Método não permitido.');
    if(serveAsset(url.pathname,res)) return;
    return error(404,'Arquivo não encontrado.');
   }
   if(!['GET','POST','PUT'].includes(req.method)) return error(405,'Método não permitido.');
   if(req.method !== 'GET' && req.headers.origin !== `http://${host}`) return error(403,'Origem não permitida.');
   if(req.headers['content-length'] && Number(req.headers['content-length']) > 16384) return error(413,'Requisição muito grande.');
   const chunks=[];let size=0;
   for await(const chunk of req) { size+=chunk.length; if(size>16384) return error(413,'Requisição muito grande.'); chunks.push(chunk); }
   // Não encaminha Host, headers de proxy, hop-by-hop ou headers arbitrários.
   const headers={};
   for(const name of ['origin','cookie','authorization','content-type','accept']) if(req.headers[name]) headers[name]=req.headers[name];
   const proxy=http.request(new URL(url.pathname+url.search,upstream),{method:req.method,headers},response => {
    const outgoing={};
    for(const name of ['content-type','set-cookie','cache-control']) if(response.headers[name]) outgoing[name]=response.headers[name];
    res.writeHead(response.statusCode || 502,outgoing); response.pipe(res);
    response.on('error',()=>res.destroy());
   });
   proxy.setTimeout(15000,()=>proxy.destroy());
   proxy.on('error',()=>error(502,'API indisponível. Confira se o backend está iniciado.'));
   res.on('close',()=>proxy.destroy());
   proxy.end(Buffer.concat(chunks));
  } catch { error(502,'Não foi possível acessar a API.'); }
 });
 server.requestTimeout=20000;server.headersTimeout=10000;
 return server;
}

if(process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
 if(process.env.NODE_ENV === 'production') throw Error('Servidor de desenvolvimento apenas. Produção exige infraestrutura e identidade próprias.');
 const server=createWeb({apiOrigin:process.env.API_ORIGIN || 'http://127.0.0.1:3102'});
 server.listen(Number(process.env.WEB_PORT || 3100),'127.0.0.1',()=>console.log(`TZOLKIN Web: http://127.0.0.1:${server.address().port}`));
 const stop=()=>{server.closeAllConnections();server.close(()=>process.exit(0));};
 process.on('SIGTERM',stop);process.on('SIGINT',stop);
}
