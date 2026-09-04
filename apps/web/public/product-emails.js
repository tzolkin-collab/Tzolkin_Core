import {createIcon,productFavicon} from './icons.js';

const el=(tag,text,cls)=>{const n=document.createElement(tag);if(text!==undefined)n.textContent=text;if(cls)n.className=cls;return n;};
const events={welcome:'Boas-vindas',charge_created:'Cobrança emitida',payment_confirmed:'Pagamento confirmado',due_reminder:'Lembrete de vencimento',overdue:'Atraso',renewal:'Renovação',canceled:'Cancelamento',refunded:'Estorno'};
const defaults={welcome:['Boas-vindas','Boas-vindas à {{product_name}}','Olá {{name}}, seu acesso está pronto.'],charge_created:['Cobrança emitida','Sua cobrança de {{product_name}}','Olá {{name}}, uma nova cobrança foi emitida.'],payment_confirmed:['Pagamento confirmado','Pagamento confirmado · {{product_name}}','Olá {{name}}, recebemos seu pagamento.'],due_reminder:['Lembrete de vencimento','Lembrete de vencimento · {{product_name}}','Olá {{name}}, sua cobrança vence em breve.'],overdue:['Atraso','Ação necessária · cobrança em atraso','Olá {{name}}, há uma cobrança pendente.'],renewal:['Renovação','Sua renovação está confirmada','Olá {{name}}, sua assinatura foi renovada.'],canceled:['Cancelamento','Cancelamento confirmado','Olá {{name}}, seu cancelamento foi processado.'],refunded:['Estorno','Estorno processado','Olá {{name}}, o estorno foi processado.']};

export function setupProductEmails({api}){
 let generation=0,data=null,product=null,selected=null;
 const host=()=>document.getElementById('view-product-emails');
 const template=(slug,event,name,subject,preheader,body,version=0)=>({slug,payload:{product_id:product.id,slug,event,name,subject,preheader,body},version});
 function inputField(form,name,label,value,type='text',attrs={}){const labelNode=el('label');labelNode.append(el('span',label));const input=el(type==='textarea'?'textarea':'input');input.name=name;input.value=value??'';Object.entries(attrs).forEach(([k,v])=>input.setAttribute(k,String(v)));labelNode.append(input);form.append(labelNode);return input;}
 function render(){
  const root=host();if(!root)return;root.replaceChildren();root.classList.add('product-email-workspace');
  const intro=el('section',undefined,'product-email-hero');const title=el('div',undefined,'product-email-title');title.append(productFavicon(product?.favicon_url||product?.catalog?.url||product?.deploy_url),el('div'));title.lastChild.append(el('span','COMUNICAÇÃO DO PRODUTO','overview-kicker'),el('h2','E-mails de '+(product?.name||'produto')),el('p','Crie os conteúdos usados pelas ofertas e revise a mensagem antes de publicar.'));
  const badge=el('span','Rascunho','status building');intro.append(title,badge);root.append(intro);
  const notice=el('div',undefined,'email-editor-note');notice.append(createIcon('alert'),el('span','Editor em rascunho. O Core ainda não envia mensagens; salvar aqui apenas versiona o conteúdo.'));root.append(notice);
  if(!data){root.append(el('p','Carregando templates…','email-empty'));return;}
  const layout=el('div',undefined,'product-email-layout'),list=el('aside',undefined,'product-email-list');list.append(el('div',undefined,'product-email-list-head'));list.firstChild.append(el('h3','Templates'),el('span',`${data.templates.length} salvos`,'detail'));
  const add=el('button','Novo template','secondary');add.type='button';add.onclick=()=>{selected={...template('novo-template','welcome',...defaults.welcome),isNew:true};render();};list.firstChild.append(add);
  if(!data.templates.length&&!selected)list.append(el('p','Nenhum template criado. Comece por uma mensagem de boas-vindas.','email-empty'));
  for(const row of data.templates){const item=el('button',undefined,'product-email-list-item'+(selected?.slug===row.slug?' active':''));item.type='button';item.append(el('span',events[row.payload.event]||row.payload.event,'email-event'),el('strong',row.payload.name),el('small',row.slug));item.onclick=()=>{selected={...row,isNew:false};render();};list.append(item);}
  const editor=el('section',undefined,'product-email-editor');
  if(!selected){editor.append(el('div',undefined,'email-empty'));editor.firstChild.append(createIcon('mail'),el('h3','Escolha um template'),el('p','Selecione uma mensagem ao lado para editar assunto, preheader e corpo.'));}
  else {
   const payload=selected.payload||{},base=defaults[payload.event]||defaults.welcome,form=el('form');form.className='email-template-form';
   const heading=el('div',undefined,'email-editor-heading');heading.append(el('div'));heading.firstChild.append(el('span','EDITOR DE TEMPLATE','overview-kicker'),el('h3',selected.isNew?'Novo template':payload.name));const state=el('span',selected.isNew?'Novo rascunho':'v'+selected.version,'status');heading.append(state);form.append(heading);
   const event=el('select');event.name='event';for(const [key,label] of Object.entries(events))event.append(new Option(label,key));event.value=payload.event||'welcome';const eventLabel=el('label');eventLabel.append(el('span','Evento'),event);form.append(eventLabel);
   const slug=inputField(form,'slug','Slug interno',selected.isNew?'':selected.slug,'text',{pattern:'[a-z][a-z0-9-]{1,63}',maxlength:64,required:true,placeholder:'pagamento-confirmado'});slug.readOnly=!selected.isNew;
   const name=inputField(form,'name','Nome exibido',payload.name||base[0],'text',{maxlength:100,required:true});
   const subject=inputField(form,'subject','Assunto',payload.subject||base[1],'text',{maxlength:180,required:true});
   inputField(form,'preheader','Preheader (opcional)',payload.preheader||'','text',{maxlength:180});
   const body=inputField(form,'body','Corpo da mensagem',payload.body||base[2],'textarea',{maxlength:30000,rows:10,required:true});
   const variables=el('div',undefined,'email-variables');variables.append(el('span','Variáveis disponíveis'));for(const variable of ['{{name}}','{{product_name}}','{{plan}}','{{due_date}}']){const chip=el('button',variable,'variable-chip');chip.type='button';chip.onclick=()=>{body.value+=(body.value?' ':'')+variable;body.focus();};variables.append(chip);}form.append(variables);
   const preview=el('div',undefined,'email-preview');preview.append(el('span','PRÉVIA','overview-kicker'),el('h4'),el('p'));const updatePreview=()=>{preview.querySelector('h4').textContent=subject.value||'Sem assunto';preview.querySelector('p').textContent=(body.value||'').replaceAll('{{name}}','Maria').replaceAll('{{product_name}}',product.name).replaceAll('{{plan}}','Plano Pro').replaceAll('{{due_date}}','10/04/2026');};[subject,body].forEach(c=>c.oninput=updatePreview);updatePreview();form.append(preview);
   const feedback=el('p',undefined,'email-save-status');feedback.setAttribute('role','status');const save=el('button','Salvar rascunho','primary');save.type='submit';form.append(feedback,save);
   form.onsubmit=async event=>{event.preventDefault();save.disabled=true;feedback.textContent='Salvando…';const payloadOut={product_id:product.id,slug:slug.value.trim(),event:event.currentTarget.elements.event.value,name:name.value,subject:subject.value,preheader:event.currentTarget.elements.preheader.value,body:body.value,version:selected.isNew?0:selected.version};try{await api('/api/email-templates','PUT',payloadOut);feedback.textContent='Rascunho salvo e versionado.';await load(product, true);}catch(error){feedback.textContent=error.message;save.disabled=false;}};
   editor.append(form);
  }
  layout.append(list,editor);root.append(layout);
 }
 async function load(next,keepSelection=false){product=next;const ticket=++generation;if(!keepSelection)selected=null;data=null;render();try{data=await api('/api/email-templates?'+new URLSearchParams({product_id:product.id}));if(ticket!==generation)return;if(selected&&!selected.isNew){selected=data.templates.find(row=>row.slug===selected.slug)||null;}render();}catch(error){if(ticket===generation)host()?.replaceChildren(el('p',error.message,'security-banner'));}}
 return {load,clear(){generation++;data=null;product=null;selected=null;host()?.replaceChildren();}};
}
