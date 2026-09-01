import { deliveryIcon } from './delivery.js';
import {providerLogo} from './icons.js';
import {easyTabs,setupEasypanel} from './easypanel.js';
const tabs={overview:['Visão geral','layers'],deployments:['Deploys','cloud'],configuration:['Configuração','settings'],domains:['Domínios','frontend'],...easyTabs};
const fields={path:'Pasta raiz',stack:'Stack',runtime:'Runtime',build:'Build',start:'Inicialização',output:'Pasta de saída',branch:'Branch'};
const states={READY:'Pronto',SUCCEEDED:'Concluído',ERROR:'Falhou',BUILDING:'Em build',QUEUED:'Na fila',INITIALIZING:'Iniciando',CANCELED:'Cancelado',UNKNOWN:'Desconhecido'};
const el=(tag,text,cls)=>{const n=document.createElement(tag);if(text!=null)n.textContent=text;if(cls)n.className=cls;return n;};
const button=(label,icon,fn)=>{const b=el('button',null,'secondary');b.type='button';b.append(deliveryIcon(icon),document.createTextNode(label));b.onclick=fn;return b;};
export function resourceRoute(hash) {
 if (!hash.startsWith('#resource?')) return null;
 const p=new URLSearchParams(hash.slice(10));
 const provider=p.get('provider'),id=p.get('target_id'),environment=p.get('environment') || 'production';
 if(!['vercel','easypanel'].includes(provider)||!id||id.length>240||!['production','staging','development'].includes(environment))return null;
 return {provider,id,environment,tab:Object.hasOwn(tabs,p.get('tab'))?p.get('tab'):'overview',deployment:p.get('deployment')};
}
export function setupResource({api,activate,canOpen,back}) {
 const easy=setupEasypanel({api});
 const root=document.getElementById('view-resource');let generation=0,current=null,data=null;
 function open(provider,id,environment='production',tab='overview',deployment) {
  const p=new URLSearchParams({provider,target_id:id,environment,tab});if(deployment)p.set('deployment',deployment);
  const hash='#resource?'+p;
  if(location.hash===hash)resume();else location.hash=hash;
 }
 function clear(){easy.clear();generation++;current=null;data=null;root.replaceChildren();root.removeAttribute('aria-busy');}
 function pair(label,value){const n=el('div',null,'resource-fact');n.append(el('dt',label),el('dd',value ?? 'Não informado'));return n;}
 function status(section){if(section.status==='ok')return false;root.querySelector('#resource-panel').append(el('p',section.message || 'Consulta indisponível.','empty-list'));return true;}
 function render(){
  easy.clear();
  root.replaceChildren();
  const head=el('div',null,'resource-heading'),provider=el('span',null,'delivery-provider');provider.append(providerLogo(data.provider),document.createTextNode(data.provider==='vercel'?'Vercel':'EasyPanel'));head.append(button('Voltar','arrow',back),provider,el('span',data.provider==='easypanel'?'Ações com confirmação':'Somente leitura','detail'));
  root.append(head,el('h2',data.target.name),el('p',`${data.target.type} · Consultado em ${new Date(data.checked_at).toLocaleString('pt-BR')}`,'detail'));
  const nav=el('nav',null,'resource-tabs');nav.setAttribute('aria-label','Seções do recurso');
  for(const [key,[label,icon]] of Object.entries(tabs)){if(data.provider!=='easypanel'&&Object.hasOwn(easyTabs,key))continue;const b=button(label,icon,()=>open(current.provider,current.id,current.environment,key));if(key===current.tab)b.setAttribute('aria-current','page');nav.append(b);}root.append(nav);
  const panel=el('div',null,'resource-panel');panel.id='resource-panel';root.append(panel);
  if(Object.hasOwn(easyTabs,current.tab)){if(data.provider==='easypanel')easy.render({panel,target:data.target,tab:current.tab});else panel.append(el('p','Seção disponível apenas para EasyPanel.','empty-list'));return;}
  if(current.tab==='overview'){
   const facts=el('dl',null,'resource-facts');facts.append(pair('Repositório',data.configuration.repository),pair('Configuração',data.configuration.status==='ok'?'Consultada':data.configuration.status==='unsupported'?'Não integrada':'Indisponível'),pair('Domínios',data.domains.status==='ok'?`${data.domains.items.length}${data.domains.partial?' (lista parcial)':''}`:'Indisponíveis'),pair('Deploys',data.deployments.status==='ok'?`${data.deployments.items.length} recentes`:'Não disponíveis'));
   panel.append(facts,el('p','Dados consultados nas APIs. Configuração e deploy pronto não comprovam saúde da aplicação nem qual versão recebe tráfego.','detail'));
  }else if(current.tab==='configuration'){
   if(status(data.configuration))return;
   panel.append(el('h3','Origem e build'),el('p',data.configuration.scope,'detail'));
   const facts=el('dl',null,'resource-facts');facts.append(pair('Repositório',data.configuration.repository));
   for(const [key,label] of Object.entries(fields)){const f=data.configuration.fields[key];facts.append(pair(label,f?.state==='value'?f.value:f?.state==='automatic'?'Automático na plataforma':f?.state==='restricted'?'Oculto por segurança':'Não informado pela integração'));}panel.append(facts);
  }else if(current.tab==='domains'){
   if(status(data.domains))return;
   panel.append(el('p','HTTPS configurado não é uma validação do certificado. Domínio verificado na Vercel não comprova disponibilidade.','detail'));
   if(!data.domains.items.length)panel.append(el('p','Nenhum domínio retornado para este recurso.','empty-list'));
   for(const d of data.domains.items){const card=el('article',null,'delivery-component');card.append(el('h3',d.host),el('p',data.provider==='vercel'?(d.verified===true?'Domínio verificado':d.verified===false?'Verificação pendente':'Verificação não informada'):(d.https===true?'HTTPS configurado':d.https===false?'HTTP configurado':'Protocolo não informado'),'detail'));if(d.port)card.append(el('small',`Porta de destino: ${d.port}`));panel.append(card);}
   if(data.domains.partial)panel.append(el('p','Lista parcial; nem todos os domínios foram incluídos.','notice-inline'));
  }else{
   if(status(data.deployments))return;
   panel.append(el('p',data.deployments.scope || 'Até 20 deploys recentes deste projeto, de todos os ambientes. “Pronto” é o estado do build, não uma verificação de tráfego em produção.','detail'));
   if(current.deployment&&!data.deployments.items.some(d=>d.id===current.deployment))panel.append(el('p','O deploy selecionado não está nesta consulta recente.','notice-inline'));
   if(!data.deployments.items.length)panel.append(el('p','Nenhum deploy retornado.','empty-list'));
   for(const d of data.deployments.items){const card=el('article',null,'delivery-component');if(d.id===current.deployment)card.classList.add('resource-selected');card.append(el('span',states[d.state]||'Desconhecido','status'),el('h3',d.id),el('p',[d.target||'Ambiente não informado',d.branch,d.commit].filter(Boolean).join(' · '),'detail'),el('small',d.created_label || (d.created_at?new Date(d.created_at).toLocaleString('pt-BR'):'Data não informada')));
    if(data.provider==='easypanel'){
     const output=el('div');const targetId=data.target.id;const read=button('Ver saída da ação','worker',async()=>{read.disabled=true;output.textContent='Consultando saída…';try{const result=await api('/api/platforms/easypanel/section?'+new URLSearchParams({target_id:targetId,section:'action',action_id:d.id}));if(!output.isConnected)return;output.replaceChildren(el('p',result.scope||result.message,'detail'));if(result.status==='ok')output.append(el('pre',result.text||'Sem saída registrada.','easy-logs'));if(result.partial)output.append(el('p','Saída parcial: limite de tamanho atingido.','detail'));}catch(error){if(output.isConnected)output.textContent=error.message;}finally{read.disabled=false;}});
     card.append(read,output);
    }
    panel.append(card);}
   if(data.deployments.partial)panel.append(el('p','Há mais deploys além desta consulta.','notice-inline'));
  }
  panel.append(el('p',data.provider==='easypanel'?'Consulte métricas, containers e armazenamento nas abas acima. Operações remotas exigem confirmação.':'Consultas de Vercel em modo de leitura.','resource-footnote'));
 }
 async function resume(){
  const route=resourceRoute(location.hash);if(!route||!canOpen())return;
  activate();const old=current;current=route;
  if(data&&old?.provider===route.provider&&old?.id===route.id&&old?.environment===route.environment){render();return;}
  easy.clear();data=null;const token=++generation;root.replaceChildren(el('p','Consultando recurso…','empty-list'));root.setAttribute('aria-busy','true');
  try{const result=await api('/api/platforms/resource?'+new URLSearchParams({provider:route.provider,target_id:route.id,environment:route.environment}));if(token!==generation)return;data=result;render();}
  catch(error){if(token===generation)root.replaceChildren(button('Voltar','arrow',back),el('p',error.message,'notice-inline'),button('Tentar novamente','cloud',refresh));}
  finally{if(token===generation)root.removeAttribute('aria-busy');}
 }
 function refresh(){data=null;return resume();}
 window.addEventListener('hashchange',()=>{if(resourceRoute(location.hash))resume();else if(current){clear();back();}});
 return {open,resume,clear,refresh};
}
