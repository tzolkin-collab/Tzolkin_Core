// Diagnóstico somente leitura: imprime chaves/tipos, nunca conteúdo de logs/env.
import {readJson} from '../apps/api/src/integrations/delivery-settings.mjs';
const base=new URL(process.env.EASYPANEL_URL);
if(base.protocol!=='https:')throw Error('HTTPS required');
const shape=(v,depth=0)=>Array.isArray(v)?{array:v.length,sample:v.length?shape(v[0],depth+1):null}:v&&typeof v==='object'&&depth<5?Object.fromEntries(Object.entries(v).slice(0,45).map(([k,x])=>[k,shape(x,depth+1)])):typeof v;
for(const endpoint of ['queryServiceLogs','getMetricsServiceStats','getLogsSettings','getLegacyMonitorServiceStats','listDatabaseBackups','inspectPostgresService']){
 const url=new URL('/api/'+endpoint,base.origin);
 const params=endpoint==='getLogsSettings'?{}:{projectName:'systembots',serviceName:['listDatabaseBackups','inspectPostgresService'].includes(endpoint)?'evolution-api-db':'evolution-api',...(endpoint==='queryServiceLogs'?{limit:'10',start:new Date(Date.now()-3600000).toISOString(),end:new Date().toISOString()}:endpoint==='getMetricsServiceStats'?{range:'3600',step:'300s'}:{})};
 for(const [k,v] of Object.entries(params))url.searchParams.set(k,v);
 try{const r=await fetch(url,{redirect:'error',headers:{Authorization:`Bearer ${process.env.EASYPANEL_TOKEN}`},signal:AbortSignal.timeout(8000)});console.log(JSON.stringify({endpoint,http:r.status,...(r.ok?{shape:shape(await readJson(r))}:{})}));}catch{console.log(JSON.stringify({endpoint,error:true}));}
}
