import {deliveryIcon} from './delivery.js';
export const easyTabs={metrics:['Métricas','layers'],containers:['Containers','api'],logs:['Logs','worker'],storage:['Volumes e portas','database'],backups:['Backups','database'],operations:['Operações','settings']};
const el=(tag,text,cls)=>{const n=document.createElement(tag);if(text!=null)n.textContent=text;if(cls)n.className=cls;return n;};
const labels={deploy:'Publicar',rebuild:'Reconstruir sem cache',restart:'Reiniciar',start:'Iniciar',stop:'Parar',replicas:'Salvar réplicas',environment:'Substituir variáveis',github:'Salvar origem GitHub',resources:'Salvar recursos',build:'Salvar build',image:'Salvar imagem'};
const btn=(text,run)=>{const b=el('button',text,'secondary');b.type='button';b.onclick=run;return b;};
export function setupEasypanel({api}){
 let generation=0,dialog=null;
 function clear(){generation++;if(dialog){dialog.close();dialog.remove();dialog=null;}}
 const facts=map=>{const dl=el('dl',null,'resource-facts');for(const [label,value] of Object.entries(map)){const cell=el('div',null,'resource-fact');cell.append(el('dt',label),el('dd',value==null?'Não informado':String(value)));dl.append(cell);}return dl;};
 function content(panel,result){
  if(result.checked_at)panel.append(el('small',`Consultado em ${new Date(result.checked_at).toLocaleString('pt-BR')}`));
  if(result.status!=='ok'){panel.append(el('p',result.message||'Consulta indisponível.','empty-list'));return;}
  if(result.scope)panel.append(el('p',result.scope,'detail'));
  if(result.source)panel.append(el('small',result.source));
  if(result.facts)panel.append(facts(result.facts));
  if(typeof result.text==='string')panel.append(el('pre',result.text||'Nenhuma linha retornada no período.','easy-logs'));
  if(result.items){if(!result.items.length)panel.append(el('p','Nenhum registro retornado para este serviço.','empty-list'));for(const item of result.items){const card=el('article',null,'delivery-component');card.append(facts(item));panel.append(card);}}
  if(result.partial)panel.append(el('p','Lista parcial. O limite desta consulta foi atingido.','notice-inline'));
 }
 async function confirm(target,action,values,revision,notice,onDone){
  const token=generation;notice.textContent='Preparando confirmação…';
  let prepared;
  try{prepared=await api('/api/platforms/easypanel/prepare','POST',{target_id:target.id,action,values,revision});}
  catch(error){if(token===generation)notice.textContent=error.message;return;}
  if(token!==generation)return;notice.textContent='';
  dialog=el('dialog',null,'easy-confirm');const currentDialog=dialog;const form=el('form');const label=el('label',`Digite ${target.id} para confirmar`);const typed=el('input');typed.autocomplete='off';typed.required=true;label.append(typed);
  const msg=el('p',null,'form-error');msg.setAttribute('role','alert');const submit=el('button','Confirmar operação','primary');submit.type='submit';
  const actions=el('div',null,'dialog-actions');actions.append(btn('Cancelar',()=>currentDialog.close()),submit);
  form.append(el('h2',labels[action]),el('p',prepared.summary,'detail'),el('small','Confirmação válida por 2 minutos. Uma alteração salva não é publicada automaticamente.'),label,msg,actions);currentDialog.append(form);document.body.append(currentDialog);
  currentDialog.addEventListener('close',()=>{currentDialog.remove();if(dialog===currentDialog)dialog=null;},{once:true});
  form.onsubmit=async event=>{event.preventDefault();if(typed.value!==target.id){msg.textContent='O identificador não corresponde ao serviço.';return;}submit.disabled=true;
   try{const result=await api('/api/platforms/easypanel/execute','POST',{confirmation_id:prepared.confirmation_id,confirm_target:typed.value});if(token!==generation)return;currentDialog.close();notice.textContent=result.message;onDone();}
   catch(error){if(token===generation){msg.textContent=error.message;submit.textContent='Feche e consulte o estado';/* sem reenvio automático */}}
  };
  currentDialog.showModal();typed.focus();
 }
 function operationsUI(panel,result,target,token){
  content(panel,result);if(result.status!=='ok')return;
  const notice=el('p',null,'notice');notice.setAttribute('role','status');panel.append(notice);
  if(!result.actions?.length){panel.append(el('p','Consultas disponíveis. Escritas para este tipo de serviço ainda não implementadas.','detail'));return;}
  const controls=el('div',null,'easy-actions');panel.append(el('h3','Ciclo de vida'),el('p','Estas ações podem afetar o serviço real. A confirmação mostra o destino antes de enviar.','detail'),controls);
  const run=async(action,values,button,onDone=()=>{})=>{button.disabled=true;try{await confirm(target,action,values,result.revision,notice,onDone);}finally{if(token===generation)button.disabled=false;}};
  for(const action of ['deploy','rebuild','restart','start','stop']){const b=btn(labels[action],()=>run(action,{},b));if(action==='stop')b.classList.add('easy-danger');controls.append(b);}
  function fieldset(title,action,build,serialize,onDone){const details=el('details',null,'easy-settings');details.append(el('summary',title));const form=el('form');build(form);const submit=el('button','Revisar alteração','secondary');submit.type='submit';form.append(submit);form.onsubmit=event=>{event.preventDefault();run(action,serialize(form),submit,()=>{onDone?.(form);notice.textContent+=' Atualize a página antes de preparar outra alteração.';});};details.append(form);panel.append(details);}
  const field=(form,label,name,value,type='text')=>{const l=el('label',label),i=el(type==='textarea'?'textarea':'input');i.name=name;if(type!=='textarea')i.type=type;i.value=value??'';l.append(i);form.append(l);return i;};
  fieldset('Réplicas do serviço','replicas',f=>{const i=field(f,'Réplicas (1–20)','replicas',result.editable?.replicas,'number');i.min=1;i.max=20;i.required=true;},f=>({replicas:Number(f.elements.replicas.value)}));
  fieldset('CPU e memória','resources',f=>{
   f.append(el('p','Reserva é a capacidade esperada; limite é o teto. Zero significa sem limite. Valores muito baixos podem interromper a aplicação.','detail'));
   for(const [key,label] of Object.entries({cpuReservation:'Reserva de CPU (cores)',cpuLimit:'Limite de CPU (cores)',memoryReservation:'Reserva de memória (MB)',memoryLimit:'Limite de memória (MB)'})){const i=field(f,label,key,result.editable?.resources?.[key]??0,'number');i.min=0;i.max=key.startsWith('cpu')?128:1048576;i.step=key.startsWith('cpu')?'0.1':'1';i.required=true;}
  },f=>Object.fromEntries(['cpuReservation','cpuLimit','memoryReservation','memoryLimit'].map(k=>[k,Number(f.elements[k].value)])));
  if(result.editable?.image)fieldset('Imagem do container','image',f=>{field(f,'Imagem e tag ou digest','image',result.editable.image).required=true;f.append(el('small','As credenciais atuais do registry serão preservadas no servidor.'));},f=>({image:f.elements.image.value}));
  if(result.editable?.build)fieldset('Método de build','build',f=>{
   const label=el('label','Builder'),select=el('select');select.name='type';for(const value of ['dockerfile','nixpacks','railpack']){const o=el('option',value);o.value=value;select.append(o);}select.value=result.editable.build.type||'dockerfile';label.append(select);f.append(label);
   const file=field(f,'Arquivo Dockerfile (relativo)','file','Dockerfile');
   const commands=['installCommand','buildCommand','startCommand'].map((key,i)=>field(f,['Comando de instalação','Comando de build','Comando de inicialização'][i],key,''));
   f.append(el('small','Comando em branco preserva o override atual quando o builder não muda. Não coloque senhas nos comandos. Trocar o builder substitui a configuração anterior.'));
   const change=()=>{file.closest('label').hidden=select.value!=='dockerfile';file.disabled=select.value!=='dockerfile';for(const i of commands){i.closest('label').hidden=select.value==='dockerfile';i.disabled=select.value==='dockerfile';}};select.onchange=change;change();
  },f=>f.elements.type.value==='dockerfile'?{type:'dockerfile',file:f.elements.file.value}:{type:f.elements.type.value,...Object.fromEntries(['installCommand','buildCommand','startCommand'].filter(k=>f.elements[k].value.trim()).map(k=>[k,f.elements[k].value]))});
  if(result.editable?.github)fieldset('Pasta e branch do GitHub','github',f=>{field(f,'Pasta de build (começa com /)','path','/').required=true;field(f,'Branch','ref','').required=true;},f=>({path:f.elements.path.value,ref:f.elements.ref.value}));
  fieldset('Variáveis de ambiente · substituição completa','environment',f=>{f.append(el('p','Atenção: substitui TODAS as variáveis atuais. Informe o conteúdo completo. Valores existentes nunca são carregados no navegador.','easy-warning'));const i=field(f,'Conteúdo .env completo','env','','textarea');i.maxLength=10000;i.rows=8;i.autocomplete='off';i.spellcheck=false;},f=>({env:f.elements.env.value}),f=>{f.elements.env.value='';});
 }
 async function render({panel,target,tab}){
  clear();const token=generation;panel.replaceChildren(el('p','Consultando EasyPanel…','empty-list'));panel.setAttribute('aria-busy','true');
  const section=(name)=>api('/api/platforms/easypanel/section?'+new URLSearchParams({target_id:target.id,section:name}));
  try{
   if(tab==='storage'){
    const results=await Promise.all(['mounts','ports'].map(section));if(token!==generation)return;panel.replaceChildren();results.forEach((r,i)=>{panel.append(el('h3',i?'Portas publicadas':'Volumes e montagens'));content(panel,r);});
   }else if(tab==='operations'){
    const result=await section('settings');if(token!==generation)return;panel.replaceChildren();operationsUI(panel,result,target,token);
    const audit=el('details',null,'easy-settings');audit.append(el('summary','Auditoria de operações pelo Core'));const rows=el('div');audit.append(rows);panel.append(audit);
    audit.addEventListener('toggle',async()=>{if(!audit.open)return;rows.textContent='Carregando…';try{const r=await api('/api/platforms/easypanel/audit?'+new URLSearchParams({target_id:target.id}));if(token!==generation)return;rows.replaceChildren();content(rows,{status:'ok',items:r.items.map(x=>({'Operação':labels[x.action]||x.action,'Estado':x.status,'Quando':new Date(x.created_at).toLocaleString('pt-BR')}))});}catch(error){if(token===generation)rows.textContent=error.message;}});
   }else{const result=await section(tab);if(token!==generation)return;panel.replaceChildren();content(panel,result);}
  }catch(error){if(token===generation)panel.replaceChildren(el('p',error.message,'notice-inline'));}
  finally{if(token===generation)panel.removeAttribute('aria-busy');}
 }
 return {render,clear};
}
