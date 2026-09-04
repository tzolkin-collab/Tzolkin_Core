import {fail} from '../platform/http.mjs';

// Resolve apenas os hosts que o próprio catálogo/deploy pode publicar. O Core
// não vira um proxy arbitrário para endereços internos.
const allowedHost=host=>host.endsWith('.tzolkin.cloud')||host.endsWith('.vercel.app');
const inlineDataIcon=href=>{
 const match=href.match(/^data:(image\/[a-z0-9.+-]+)(;base64)?,([\s\S]*)$/i);if(!match)return null;
 if(match[2])return href;
 try{return `data:${match[1]};base64,${Buffer.from(decodeURIComponent(match[3])).toString('base64')}`;}catch{return null;}
};
export function productFaviconRoutes(router){
 router.get('/api/product-favicon',async({url,reply})=>{
  const target=url.searchParams.get('url');let parsed;
  try{parsed=new URL(target);if(parsed.protocol!=='https:'||parsed.username||parsed.password||!allowedHost(parsed.hostname))throw Error();}catch{throw fail(400,'Endereço de favicon inválido.');}
  const controller=new AbortController(),timer=setTimeout(()=>controller.abort(),3500);
  try{
   const response=await fetch(parsed.href,{redirect:'error',signal:controller.signal,headers:{accept:'text/html,application/xhtml+xml'}});if(!response.ok)return reply(200,{href:null});
   const html=await response.text();if(html.length>300000)return reply(200,{href:null});
   const match=html.match(/<link\b[^>]*rel=["'][^"']*icon[^"']*["'][^>]*href=["']([^"']+)["'][^>]*>/i)||html.match(/<link\b[^>]*href=["']([^"']+)["'][^>]*rel=["'][^"']*icon[^"']*["'][^>]*>/i);
   if(!match)return reply(200,{href:null});const href=match[1].trim();const dataIcon=inlineDataIcon(href);if(dataIcon)return reply(200,{href:dataIcon});
   const icon=new URL(href,parsed.href);if(icon.protocol!=='https:')return reply(200,{href:null});
   const iconResponse=await fetch(icon.href,{redirect:'error',signal:controller.signal,headers:{accept:'image/*'}});if(!iconResponse.ok)return reply(200,{href:null});
   const mime=(iconResponse.headers.get('content-type')||'').split(';',1)[0].toLowerCase();if(!mime.startsWith('image/'))return reply(200,{href:null});
   const bytes=Buffer.from(await iconResponse.arrayBuffer());if(bytes.length>120000)return reply(200,{href:null});
   return reply(200,{href:`data:${mime};base64,${bytes.toString('base64')}`});
  }catch{return reply(200,{href:null});}finally{clearTimeout(timer);}
 },{body:false});
}
