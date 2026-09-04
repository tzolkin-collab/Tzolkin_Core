import {createIcon,providerLogo} from './icons.js';
import {setupCheckoutPanel,checkoutLink} from './checkout-gateway.js';
const el=(tag,text,cls)=>{const n=document.createElement(tag);if(text!==undefined)n.textContent=text;if(cls)n.className=cls;return n;};
const labels={stripe:'Stripe',asaas:'Asaas',email:'E-mail transacional'};
const TABS={ofertas:'Ofertas',checkout:'Checkout'};

export function setupProductPayments({api,billing}){
 let generation=0,data=null,product=null,tab='ofertas';
 const host=()=>document.getElementById('view-product-payments');
 // Checkout é aba desta tela, não view própria: é parte de pagamentos, não irmão dele.
 const checkout=setupCheckoutPanel({api});

 function painelOfertas(panel){
  const heading=el('div',undefined,'section-toolbar'),copy=el('div');
  copy.append(el('h3','Ofertas do produto'),el('p','Preço, processador e automações de e-mail ficam versionados por oferta.','detail'));
  const button=el('button','Editar ofertas','primary');button.type='button';button.onclick=()=>billing.mount(product,host());
  heading.append(copy,button);panel.append(heading);

  const offers=el('div',undefined,'pay-offers');
  for(const row of data.offers){
   const offer=el('article',undefined,'pay-offer'),p=row.payload;
   offer.append(el('span',p.provider==='stripe'?'Stripe':'Asaas','client-chip'),el('h3',p.name),
    el('p',p.kind==='subscription'?'Assinatura':p.kind==='installments'?'Parcelamento':'Pagamento único','detail'),
    el('strong',new Intl.NumberFormat('pt-BR',{style:'currency',currency:p.currency}).format(p.amount_minor/100)));
   const rule=data.rules.find(r=>r.offer_slug===row.slug);
   offer.append(el('p',(rule?.templates.length||0)+' automações de e-mail','detail'));
   if(p.provider==='stripe'){
    const linkRow=el('div',undefined,'pay-link'),copyBtn=el('button','Copiar link de pagamento','secondary');copyBtn.type='button';
    copyBtn.onclick=async()=>{try{await navigator.clipboard.writeText(checkoutLink(product.id,row.slug));copyBtn.textContent='Link copiado';setTimeout(()=>copyBtn.textContent='Copiar link de pagamento',2000);}catch{copyBtn.textContent='Não foi possível copiar';}};
    linkRow.append(copyBtn);offer.append(linkRow);
   }
   offers.append(offer);
  }
  if(!data.offers.length)offers.append(el('p','Nenhuma oferta configurada para este produto.','empty-list'));
  panel.append(offers);
  panel.append(el('p','As credenciais são globais e permanecem no servidor. As vendas importadas ainda são consolidadas: o Core não atribui uma transação a este produto sem metadata explícita no Stripe ou Asaas.','pay-scope'));
 }

 function render(){
  const root=host();if(!root)return;root.replaceChildren();
  if(!data){root.append(el('p','Carregando pagamentos…','empty-list'));return;}

  const intro=el('section',undefined,'pay-product-hero');
  intro.append(el('span','OPERAÇÃO COMERCIAL','overview-kicker'),el('h2','Pagamentos e comunicação'),
   el('p','Processadores, ofertas e avisos financeiros de '+product.name+'.'));
  root.append(intro);

  // Estado dos processadores vale para as duas abas: fica acima delas.
  const connections=el('div',undefined,'pay-connections');
  for(const key of ['stripe','asaas','email']){
   const value=data.connections[key],card=el('article',undefined,'pay-connection'),mark=el('span',undefined,'pay-provider-mark');
   mark.append(key==='email'?createIcon('mail'):providerLogo(key));
   const body=el('div');
   body.append(el('h3',labels[key]),el('p',key==='email'?(value.provider||'Provedor não definido'):key==='asaas'?'Ambiente '+value.environment:'Cobranças internacionais e assinaturas','detail'));
   card.append(mark,body,el('span',value.configured?'Configurado':'Pendente','status '+(value.configured?'active':'building')));
   connections.append(card);
  }
  root.append(connections);

  const nav=el('nav',undefined,'resource-tabs');nav.setAttribute('aria-label','Seções de pagamentos');
  for(const [key,label] of Object.entries(TABS)){
   const botao=el('button',label,'secondary');botao.type='button';
   if(key===tab)botao.setAttribute('aria-current','page');
   botao.onclick=()=>{if(tab===key)return;tab=key;checkout.clear();render();};
   nav.append(botao);
  }
  root.append(nav);

  const panel=el('div',undefined,'pay-panel');root.append(panel);
  if(tab==='checkout')checkout.mount(panel,product).catch(error=>panel.replaceChildren(el('p',error.message,'security-banner')));
  else painelOfertas(panel);
 }

 async function load(next){
  product=next;data=null;const ticket=++generation;checkout.clear();render();
  try{data=await api('/api/products/'+encodeURIComponent(product.id)+'/payments');if(ticket===generation)render();}
  catch(error){if(ticket===generation)host()?.replaceChildren(el('p',error.message,'security-banner'));}
 }

 return{load,clear(){generation++;data=null;product=null;tab='ofertas';checkout.clear();host()?.replaceChildren();}};
}
