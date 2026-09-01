import {providerLogo,paymentInstitutionIcon} from './icons.js';
const el=(tag,text,cls)=>{const n=document.createElement(tag);if(text!==undefined)n.textContent=text;if(cls)n.className=cls;return n;};
const eventLabels={welcome:'Boas-vindas',charge_created:'Cobrança emitida',payment_confirmed:'Pagamento confirmado',due_reminder:'Lembrete de vencimento',overdue:'Atraso',renewal:'Renovação',canceled:'Cancelamento',refunded:'Estorno'};
export function setupBilling({api}){
 let active=null,generation=0;
 function clear(){generation++;active?.close();active?.remove();active=null;}
 async function open(product){
  clear();const ticket=generation,dialog=el('dialog',undefined,'billing-dialog');active=dialog;dialog.setAttribute('aria-labelledby','billing-title');
  const heading=el('div',undefined,'billing-heading'),close=el('button','Fechar','secondary');close.type='button';close.onclick=clear;heading.append(el('h2','Cobrança e e-mails',''),close);heading.firstChild.id='billing-title';
  const status=el('p','Carregando ofertas…','billing-status');status.setAttribute('role','status');
  dialog.append(heading,el('p',product.name,'billing-subtitle'),el('p','Configuração em rascunho. Não emite cobranças nem envia e-mails.','billing-notice'),status);document.body.append(dialog);dialog.showModal();dialog.addEventListener('cancel',e=>{e.preventDefault();clear();});
  try{
   const result=await api('/api/billing/offers?'+new URLSearchParams({product_id:product.id}));if(ticket!==generation)return;
   status.textContent='';const offers=result.offers,chooser=el('select');chooser.setAttribute('aria-label','Oferta');chooser.append(new Option('Nova oferta',''));for(const row of offers)chooser.append(new Option(row.payload.name+' · '+row.slug,row.slug));dialog.append(chooser);
   const container=el('div');dialog.append(container);
   function edit(row){
    container.replaceChildren();const data=row?.payload||{},form=el('form'),grid=el('div',undefined,'billing-grid');const controls={};
    function field(name,label,choices,value,type='text'){
     const wrapper=el('label');wrapper.append(el('span',label));const control=el(choices?'select':'input');control.name=name;
     if(choices)for(const [v,t]of choices)control.append(new Option(t,v));else control.type=type;
     control.value=value??'';control.required=true;wrapper.append(control);grid.append(wrapper);controls[name]=control;return control;
    }
    field('name','Nome da oferta',null,data.name).maxLength=100;
    const slug=field('slug','Slug do plano',null,data.slug);slug.pattern='[a-z][a-z0-9-]{1,63}';slug.maxLength=64;slug.readOnly=!!row;
    const provider=field('provider','Processador',[['asaas','Asaas · Brasil'],['stripe','Stripe · exterior e assinaturas']],data.provider||'asaas');
    const kind=field('kind','Modalidade',[['one_time','Pagamento único'],['installments','Parcelamento'],['subscription','Assinatura']],data.kind||'one_time');
    const amount=field('amount','Valor total / por ciclo',null,data.amount_minor?String(data.amount_minor/100):'','number');amount.min='0.01';amount.max='1000000';amount.step='0.01';
    const currency=field('currency','Moeda',[['BRL','BRL · Real'],['USD','USD · Dólar'],['EUR','EUR · Euro'],['GBP','GBP · Libra']],data.currency||'BRL');
    const interval=field('interval','Periodicidade',[['month','Mensal'],['year','Anual']],data.interval||'month');
    const installments=field('installments','Número de parcelas',null,data.installments||2,'number');installments.min='2';installments.max='12';installments.step='1';
    const identity=el('div',undefined,'billing-provider');
    const sync=()=>{interval.parentElement.hidden=kind.value!=='subscription';interval.disabled=kind.value!=='subscription';installments.parentElement.hidden=kind.value!=='installments';installments.disabled=kind.value!=='installments';if(provider.value==='asaas')currency.value='BRL';currency.disabled=provider.value==='asaas';identity.replaceChildren(provider.value==='stripe'?providerLogo('stripe'):paymentInstitutionIcon(),el('span',provider.value==='stripe'?'Stripe · integração direta planejada':'Asaas · integração direta planejada'));};
    provider.onchange=sync;kind.onchange=()=>{if(kind.value==='subscription'&&!row)provider.value='stripe';if(kind.value==='installments')provider.value='asaas';sync();};sync();
    form.append(identity,grid,el('p','No contrato, use este slug como Plano para herdar as condições. Contratos já vinculados mantêm sua versão.','billing-help'));
    const details=el('details'),summary=el('summary','E-mails e templates');details.append(summary,el('p','Escolha um único remetente para os avisos financeiros. Os slugs abaixo são referências; templates e envio ainda não estão conectados.','billing-help'));
    const emailLabel=el('label','Quem envia os avisos financeiros?'),owner=el('select');owner.append(new Option('Processador (Asaas / Stripe)','provider'),new Option('Core','core'));owner.value=data.email_owner||'provider';emailLabel.append(owner);details.append(emailLabel);
    const templates=el('div',undefined,'billing-grid'),templateInputs={};for(const [event,label]of Object.entries(eventLabels)){const wrapper=el('label',label),input=el('input');input.placeholder='ex.: pagamento-confirmado';input.value=data.email_templates?.[event]||'';input.pattern='[a-z][a-z0-9-]{1,63}';input.maxLength=64;wrapper.append(input);templates.append(wrapper);templateInputs[event]=input;}details.append(templates);form.append(details);
    const feedback=el('p',undefined,'billing-status');feedback.setAttribute('role','status');const save=el('button','Salvar rascunho','primary');save.type='submit';form.append(feedback,save);
    form.onsubmit=async event=>{event.preventDefault();save.disabled=true;feedback.textContent='Salvando…';
     const numeric=Number(amount.value),minor=Math.round(numeric*100);
     const payload={product_id:product.id,slug:slug.value,name:controls.name.value,provider:provider.value,kind:kind.value,amount_minor:minor,currency:currency.value,interval:kind.value==='subscription'?interval.value:null,installments:kind.value==='installments'?Number(installments.value):1,email_owner:owner.value,email_templates:Object.fromEntries(Object.entries(templateInputs).filter(([,i])=>i.value.trim()).map(([k,i])=>[k,i.value.trim()])),version:row?.version||0};
     try{await api('/api/billing/offers','PUT',payload);if(ticket!==generation)return;await open(product);if(active)active.querySelector('[role=status]').textContent='Rascunho salvo. Nenhuma cobrança ou mensagem foi enviada.';}catch(error){if(ticket===generation){feedback.textContent=error.message;save.disabled=false;}}
    };container.append(form);
   }
   chooser.onchange=()=>edit(offers.find(row=>row.slug===chooser.value));edit();
  }catch(error){if(ticket===generation)status.textContent=error.message;}
 }
 return{open,clear};
}
