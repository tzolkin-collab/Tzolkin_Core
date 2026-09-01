import {createHash} from 'node:crypto';
import {parseEnv} from 'node:util';
import {readJson} from './delivery-settings.mjs';
import {fail,input} from '../platform/http.mjs';
const TYPES={app:'App',postgres:'Postgres',redis:'Redis',mysql:'Mysql',mariadb:'Mariadb',mongo:'Mongo',compose:'Compose',box:'Box',wordpress:'Wordpress'};
const str=v=>typeof v==='string'?v.slice(0,240):null;
const num=v=>typeof v==='number'&&Number.isFinite(v)&&v>=0?v:null;
const object=v=>v&&typeof v==='object'&&!Array.isArray(v);
const unavailable=message=>({status:'unavailable',message});
export const fingerprint=raw=>createHash('sha256').update(JSON.stringify(raw)).digest('hex');
export function scrubLogs(text,secrets=[]) {
 let result=String(text).replace(/\x1b\[[0-9;]*[a-zA-Z]/g,'').replace(/-----BEGIN [^-]*PRIVATE KEY-----[\s\S]*?(?:-----END [^-]*PRIVATE KEY-----|$)/g,'[chave privada ocultada]');
 for(const secret of [...secrets].filter(v=>typeof v==='string'&&v.length>=4).sort((a,b)=>b.length-a.length))result=result.split(secret).join('[oculto]');
 return result.split('\n').map(line=>/password|passwd|secret|token|authorization|api[_-]?key|cookie|-----BEGIN .*PRIVATE KEY/i.test(line)?'[linha sensível ocultada]':line.replace(/([a-z][a-z0-9+.-]*:\/\/)[^\s/]+:[^\s/]+@/gi,'$1[oculto]@')).join('\n').slice(0,48000);
}
export function normalizeOperationRead(section,body,target) {
 const service=target.id.replace('/','_');
 if(section==='metrics'){
  if(body===null)return unavailable('O coletor não retornou métricas para este serviço.');
  if(!object(body)||!object(body.cpu)||!object(body.memory))throw Error('Invalid metrics');
  return {status:'ok',source:'Monitor legado EasyPanel',facts:{'CPU (%)':num(body.cpu.percent),'Memória (%)':num(body.memory.percent),'Memória (bytes)':num(body.memory.usage),'Rede recebida (bytes)':num(body.network?.in),'Rede enviada (bytes)':num(body.network?.out)}};
 }
 if(!Array.isArray(body))throw Error('Invalid collection');
 let rows=body;
 if(section==='containers')rows=rows.filter(d=>d?.Labels?.['com.docker.swarm.service.name']===service);
 if(section==='backups')rows=rows.filter(d=>`${d?.projectName}/${d?.serviceName}`===target.id);
 const items=rows.slice(0,100).map(d=>{
  if(!object(d))throw Error('Invalid item');
  if(section==='containers')return {'ID':str(d.Id),'Estado':['created','running','paused','restarting','removing','exited','dead'].includes(d.State)?d.State:'desconhecido','Imagem':str(d.Image)};
  if(section==='ports')return {'Porta publicada':num(d.published),'Porta de destino':num(d.target),'Protocolo':['tcp','udp'].includes(d.protocol)?d.protocol:null};
  if(section==='mounts')return {'Tipo':['volume','bind','file'].includes(d.type)?d.type:null,'Nome':str(d.name),'Caminho no container':str(d.mountPath)};
  if(section==='backups')return {'ID':str(d.id),'Agendado':typeof d.enabled==='boolean'?(d.enabled?'Sim':'Não'):null,'Agenda':str(d.schedule),'Banco':str(d.databaseName)};
  throw Error('Unknown section');
 });
 return {status:'ok',items,partial:rows.length>100,scope:section==='backups'?'Agendamentos configurados; não comprovam execução nem restauração de um backup.':null};
}

export function createEasypanelOperations({env=process.env,fetchImpl=fetch,clock=Date.now}={}) {
 async function request(endpoint,params,method='GET') {
  const base=new URL(env.EASYPANEL_URL);
  if(base.protocol!=='https:'||base.username||base.password||base.search||base.hash||!['/','/api','/api/'].includes(base.pathname)||!env.EASYPANEL_TOKEN)throw Error('Invalid connection');
  const url=new URL('/api/'+endpoint,base.origin);
  if(method==='GET')for(const [k,v] of Object.entries(params))url.searchParams.set(k,v);
  const response=await fetchImpl(url,{method,redirect:'error',headers:{Authorization:`Bearer ${env.EASYPANEL_TOKEN}`,Accept:'application/json',...(method==='POST'?{'Content-Type':'application/json'}:{})},...(method==='POST'?{body:JSON.stringify(params)}:{}),signal:AbortSignal.timeout(8000)});
  if(!response.ok)throw Error('Provider unavailable');
  // Some mutation endpoints legitimately return no body.
  if(response.status===204)return null;
  return readJson(response);
 }
 function targetParams(target){if(!/^[a-z0-9_-]+\/[a-z0-9_-]+$/.test(target.id))throw fail(400,'Destino inválido.');const [projectName,serviceName]=target.id.split('/');return {projectName,serviceName};}
 async function inspect(target){const suffix=TYPES[target.type];if(!suffix)throw fail(400,'Tipo de serviço não suportado.');const raw=await request('inspect'+suffix+'Service',targetParams(target));if(!object(raw)||raw.name!==target.id.split('/')[1]||raw.projectName!==target.id.split('/')[0]||raw.type!==target.type)throw Error('Invalid service');return raw;}
 async function read({target,section,actionId}) {
  const params=targetParams(target);
  try{
   if(section==='action'){
    if(typeof actionId!=='string'||!/^[\w-]{1,180}$/.test(actionId))throw Error('Invalid action');
    const body=await request('getAction',{id:actionId});
    if(body?.projectName!==params.projectName||body?.serviceName!==params.serviceName||!['deployment','build'].includes(body?.type))throw Error('Unrelated action');
    const raw=await inspect(target);
    if(typeof body.log!=='string')return unavailable('A ação não retornou saída de execução.');
    const text=scrubLogs(body.log,[env.EASYPANEL_TOKEN,raw.password,raw.token,...Object.values(parseEnv(raw.env||''))]);
    return {status:'ok',text,partial:body.log.length>48000,scope:'Saída desta ação, não logs contínuos da aplicação. Conteúdo sensível conhecido é ocultado.'};
   }
   if(section==='settings'){
    const raw=await inspect(target);
    return {status:'ok',revision:fingerprint(raw),facts:{'Habilitado':typeof raw.enabled==='boolean'?(raw.enabled?'Sim':'Não'):null,'Tipo':target.type,'Réplicas configuradas':num(raw.deploy?.replicas),'Origem':['github','git','image','upload','dockerfile'].includes(raw.source?.type)?raw.source.type:null,'Porta exposta':num(raw.exposedPort)},editable:target.type==='app'?{replicas:num(raw.deploy?.replicas),github:raw.source?.type==='github',image:raw.source?.type==='image'?str(raw.source.image):null,build:['github','git','upload'].includes(raw.source?.type)?{type:['dockerfile','nixpacks','railpack'].includes(raw.build?.type)?raw.build.type:null}:null,resources:Object.fromEntries(['cpuLimit','cpuReservation','memoryLimit','memoryReservation'].map(k=>[k,num(raw.resources?.[k])??0]))}:null,actions:target.type==='app'?['deploy','rebuild','restart','start','stop','replicas','environment','github','resources','build','image']:[],scope:'Configuração salva; habilitado não significa saudável. Alterações de configuração não disparam deploy automaticamente.'};
   }
   if(section==='logs'){
    const raw=await inspect(target); // Values retained only while redacting this response.
    const body=await request('queryServiceLogs',{...params,limit:'100',start:new Date(clock()-3600000).toISOString(),end:new Date(clock()).toISOString()});
    // Only the documented Loki stream shape is accepted; never pass raw objects.
    if(body?.status!=='success'||!Array.isArray(body.data?.result))return unavailable('Formato de logs não reconhecido nesta versão do EasyPanel.');
    const lines=body.data.result.flatMap(s=>Array.isArray(s.values)?s.values.filter(v=>Array.isArray(v)&&typeof v[1]==='string').map(v=>v[1]):[]).slice(-100);
    const secrets=[env.EASYPANEL_TOKEN,raw.password,raw.token,...Object.values(parseEnv(raw.env||''))];
    return {status:'ok',text:scrubLogs(lines.join('\n'),secrets),partial:lines.length>=100,scope:'Até 100 linhas da última hora. Redação automática reduz exposição, mas logs ainda podem conter dados da aplicação.'};
   }
   const endpoint={containers:'getDockerContainers',metrics:'getLegacyMonitorServiceStats',ports:'listPorts',mounts:'listMounts',backups:['postgres','mysql','mariadb','mongo'].includes(target.type)?'listDatabaseBackups':'listVolumeBackups'}[section];
   if(!endpoint)throw fail(400,'Seção inválida.');
   if(['ports','mounts'].includes(section)&&!['app','box'].includes(target.type))return unavailable('Esta consulta se aplica a serviços App e Box.');
   return normalizeOperationRead(section,await request(endpoint,section==='containers'?{service:target.id.replace('/','_')}:params),target);
  }catch{return {status:'error',message:section==='logs'?'Não foi possível consultar os logs. Verifique disponibilidade do coletor, permissões e compatibilidade da API.':'Não foi possível consultar esta seção no EasyPanel. Verifique permissões e compatibilidade da API.'};}
 }
 function validate(action,values){
  const allowed={deploy:[],rebuild:[],restart:[],start:[],stop:[],replicas:['replicas'],environment:['env'],github:['path','ref'],resources:['cpuLimit','cpuReservation','memoryLimit','memoryReservation'],build:['type','file','buildCommand','installCommand','startCommand'],image:['image']};
  if(!Object.hasOwn(allowed,action))throw fail(400,'Operação inválida.');input(values,allowed[action]);
  if(action==='replicas'&&(!Number.isInteger(values.replicas)||values.replicas<1||values.replicas>20))throw fail(400,'Informe de 1 a 20 réplicas.');
  if(action==='environment'&&(typeof values.env!=='string'||values.env.length>10000||values.env.includes('\0')))throw fail(400,'Env inválido (máximo 10 mil caracteres).');
  if(action==='github'&&(typeof values.path!=='string'||!/^\/(?:[\w.-]+\/)*[\w.-]*$/.test(values.path)||values.path.split('/').includes('..')||typeof values.ref!=='string'||!/^[\w./-]{1,120}$/.test(values.ref)||values.ref.includes('..')))throw fail(400,'Pasta ou branch inválida.');
  if(action==='resources'){
   for(const key of allowed.resources)if(num(values[key])===null||values[key]>(key.startsWith('cpu')?128:1048576))throw fail(400,'Limites de recursos inválidos.');
   for(const prefix of ['cpu','memory'])if(values[prefix+'Limit']!==0&&values[prefix+'Reservation']>values[prefix+'Limit'])throw fail(400,'Reserva não pode superar o limite.');
  }
  if(action==='image'&&(typeof values.image!=='string'||values.image.length>240||! /^[a-zA-Z0-9][a-zA-Z0-9._/:@-]+$/.test(values.image)||values.image.includes('://')))throw fail(400,'Referência de imagem inválida.');
  if(action==='build'){
   if(!['dockerfile','nixpacks','railpack'].includes(values.type))throw fail(400,'Builder inválido.');
   if(values.type==='dockerfile'){
    if(Object.keys(values).some(k=>!['type','file'].includes(k))||typeof values.file!=='string'||! /^[\w.-]+(?:\/[\w.-]+)*$/.test(values.file)||values.file.split('/').includes('..'))throw fail(400,'Informe um Dockerfile relativo à pasta de build.');
   }else{
    if(values.file!==undefined)throw fail(400,'Arquivo não se aplica a este builder.');
    for(const key of ['buildCommand','installCommand','startCommand'])if(values[key]!==undefined&&(typeof values[key]!=='string'||values[key].length>500||/[\x00-\x1f]/.test(values[key])))throw fail(400,'Comando inválido.');
   }
  }
  return values;
 }
 async function prepare({target,action,values,revision}){
  if(target.type!=='app')throw fail(400,'Operações disponíveis apenas para App nesta versão.');
  validate(action,values);const raw=await inspect(target);
  if(typeof revision!=='string'||fingerprint(raw)!==revision)throw fail(409,'A configuração mudou. Atualize a página antes de continuar.');
  if(action==='github'&&raw.source?.type!=='github')throw fail(400,'Este serviço não usa uma origem GitHub.');
  if(action==='image'&&raw.source?.type!=='image')throw fail(400,'Este serviço não usa uma origem por imagem.');
  if(action==='build'&&!['github','git','upload'].includes(raw.source?.type))throw fail(400,'Esta origem não permite configurar um builder.');
  return {revision,summary:action==='environment'?'Substituir TODAS as variáveis do serviço. Valores atuais não são exibidos.':action==='replicas'?`Salvar ${values.replicas} réplicas; exige deploy para aplicar.`:action==='github'?`Alterar pasta para ${values.path} e branch para ${values.ref}; exige deploy para aplicar.`:action==='resources'?`Salvar CPU: reserva ${values.cpuReservation}, limite ${values.cpuLimit} cores. Memória: reserva ${values.memoryReservation}, limite ${values.memoryLimit} MB. Zero remove o limite; exige deploy.`:action==='build'?`Salvar builder ${values.type}. Ao trocar o tipo, os overrides do builder anterior serão substituídos. Comandos fornecidos serão executados no próximo build; exige deploy.`:action==='image'?`Alterar imagem para ${values.image}, preservando as credenciais do registry. Exige deploy.`:`Executar ${action} no serviço ${target.id}. Pode interromper a aplicação.`};
 }
 async function execute({target,action,values,revision}){
  validate(action,values);if(target.type!=='app')throw fail(400,'Tipo não suportado.');
  const raw=await inspect(target);if(fingerprint(raw)!==revision)throw fail(409,'A configuração mudou. Nenhuma ação foi enviada.');
  const params=targetParams(target);let endpoint,body=params;
  if(action==='replicas'){endpoint='updateAppDeploy';body={...params,deploy:{...raw.deploy,replicas:values.replicas}};}
  else if(action==='resources'){endpoint='updateAppResources';body={...params,resources:{...raw.resources,...values}};}
  else if(action==='build'){if(!['github','git','upload'].includes(raw.source?.type))throw fail(409,'Origem incompatível.');endpoint='updateAppBuild';body={...params,build:{...(raw.build?.type===values.type?raw.build:{}),...values}};}
  else if(action==='image'){if(raw.source?.type!=='image')throw fail(409,'Origem mudou.');endpoint='updateAppSourceImage';body={...params,image:values.image,...(typeof raw.source.username==='string'?{username:raw.source.username}:{}),...(typeof raw.source.password==='string'?{password:raw.source.password}:{})};}
  else if(action==='environment'){endpoint='updateAppEnv';body={...params,env:values.env,...(typeof raw.dotEnvPath==='string'?{dotEnvPath:raw.dotEnvPath}:{})};}
  else if(action==='github'){if(raw.source?.type!=='github')throw fail(409,'Origem mudou.');endpoint='updateAppSourceGithub';body={...params,owner:raw.source.owner,repo:raw.source.repo,path:values.path,ref:values.ref};}
  else {endpoint={deploy:'deployAppService',rebuild:'deployAppService',restart:'restartAppService',start:'startAppService',stop:'stopAppService'}[action];if(action==='rebuild')body={...params,forceRebuild:true};}
  try{await request(endpoint,body,'POST');return {status:'accepted',message:'Solicitação aceita pelo EasyPanel. Atualize o histórico e o estado do serviço para acompanhar.'};}
  catch{throw fail(502,'Resultado não confirmado. A operação pode ter sido recebida pelo EasyPanel; consulte o histórico antes de tentar novamente.');}
 }
 return {read,prepare,execute};
}
