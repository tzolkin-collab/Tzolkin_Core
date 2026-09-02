// Aba Checkout, dentro de Pagamentos: aparência e modo de exibição da página
// pública.
//
// Não é diálogo e não é view própria. Checkout é parte de pagamentos, não irmão
// dele — e como superfície de configuração (coleção de templates mais prévia),
// não cabe numa caixinha modal, que não tem deep link nem espaço para a prévia.
//
// A prévia é um iframe da página pública DE VERDADE, não uma reprodução. Copiar
// o cartão para cá duplicaria checkout.css e passaria a mentir no dia em que um
// dos dois mudasse. O preço dessa honestidade: ela mostra o que está SALVO, por
// isso recarrega a cada gravação — e diz isso ao operador.
const el=(tag,text,cls)=>{const n=document.createElement(tag);if(text!==undefined)n.textContent=text;if(cls)n.className=cls;return n;};
const TYPE_LABELS={HOSTED:'Hospedado na Stripe (redireciona)',EMBEDDED:'Incorporado (fica na sua página)',ELEMENTS:'Elements — ainda não cria sessão'};
const VIEWPORTS={mobile:'Celular',desktop:'Computador'};

export function setupCheckoutPanel({api}){
 let generation=0,host=null,product=null,templates=[],offers=[],selected=null,previewSlug=null,viewport='mobile',feedback='';
 const current=()=>templates.find(row=>row.slug===selected)||null;
 const stripeOffers=()=>offers.filter(row=>row.payload.provider==='stripe');

 function editor(){
  const row=current(),data=row?.payload||{},branding=data.branding||{},form=el('form',undefined,'checkout-admin-form'),grid=el('div',undefined,'billing-grid');
  function field(name,label,choices,value,type='text'){
   const wrapper=el('label');wrapper.append(el('span',label));const control=el(choices?'select':'input');control.name=name;
   if(choices)for(const [v,t] of choices)control.append(new Option(t,v));else control.type=type;
   control.value=value??'';wrapper.append(control);grid.append(wrapper);return control;
  }
  const nome=field('name','Nome do template',null,data.name);nome.required=true;nome.maxLength=100;
  const slug=field('slug','Slug',null,data.slug);slug.pattern='[a-z][a-z0-9-]{1,63}';slug.maxLength=64;slug.required=true;slug.readOnly=Boolean(row);
  const tipo=field('type','Modo',Object.entries(TYPE_LABELS),data.type||'HOSTED');
  const cor=field('primary_color','Cor primária',null,branding.primary_color||'#111827','color');
  const logo=field('logo_url','URL do logo (https)',null,branding.logo_url||'','url');
  const raio=field('border_radius','Arredondamento (px)',null,branding.border_radius??12,'number');raio.min='0';raio.max='24';
  const fonte=field('font_family','Fonte',null,branding.font_family||'system-ui');fonte.maxLength=60;

  const padraoWrap=el('label',undefined,'checkbox-label'),padrao=el('input');padrao.type='checkbox';
  padrao.checked=data.is_default??!templates.length;padraoWrap.append(padrao,el('span','Usar como padrão deste produto'));

  const aviso=el('p',undefined,'billing-status');aviso.setAttribute('role','status');aviso.textContent=feedback;
  const salvar=el('button',row?'Salvar template':'Criar template','primary');salvar.type='submit';
  const acoes=el('div',undefined,'checkout-admin-actions');acoes.append(salvar);
  if(row){const novo=el('button','Novo template','secondary');novo.type='button';novo.onclick=()=>{selected=null;feedback='';render();};acoes.append(novo);}

  form.append(grid,padraoWrap,aviso,acoes);
  form.onsubmit=async event=>{
   event.preventDefault();salvar.disabled=true;aviso.textContent='Salvando…';
   const payload={product_id:product.id,slug:slug.value,name:nome.value,type:tipo.value,
    branding:{primary_color:cor.value,logo_url:logo.value.trim(),border_radius:Number(raio.value),font_family:fonte.value.trim()},
    is_default:padrao.checked,version:row?.version||0};
   try{
    await api('/api/checkout-templates','PUT',payload);
    feedback='Template salvo. A prévia ao lado já mostra a versão publicada.';
    selected=payload.slug;await reload();
   }catch(error){aviso.textContent=error.message;salvar.disabled=false;}
  };
  return form;
 }

 function listaTemplates(){
  const box=el('div',undefined,'checkout-admin-list');
  for(const row of templates){
   const chip=el('button',undefined,'checkout-template-chip');chip.type='button';
   if(row.slug===selected)chip.setAttribute('aria-current','true');
   const marca=el('span',undefined,'checkout-template-swatch');marca.style.setProperty('background',row.payload.branding?.primary_color||'#111827');
   const texto=el('span');texto.append(el('strong',row.payload.name),
    el('small',(row.payload.type==='HOSTED'?'Hospedado':row.payload.type==='EMBEDDED'?'Incorporado':'Elements')+(row.payload.is_default?' · padrão':'')));
   chip.append(marca,texto);chip.onclick=()=>{selected=row.slug;feedback='';render();};
   box.append(chip);
  }
  if(!templates.length)box.append(el('p','Nenhum template ainda. O formulário abaixo cria o primeiro.','empty-list'));
  return box;
 }

 function previa(){
  const painel=el('section',undefined,'checkout-admin-preview'),topo=el('div',undefined,'section-toolbar'),copy=el('div');
  copy.append(el('h3','Prévia'),el('p','A página pública real, como está publicada agora.','detail'));
  const alternar=el('div',undefined,'checkout-viewport-switch');
  for(const [chave,rotulo] of Object.entries(VIEWPORTS)){
   const botao=el('button',rotulo,'secondary');botao.type='button';
   if(chave===viewport)botao.setAttribute('aria-current','page');
   botao.onclick=()=>{viewport=chave;render();};alternar.append(botao);
  }
  topo.append(copy,alternar);painel.append(topo);

  const vendaveis=stripeOffers();
  if(!vendaveis.length){
   painel.append(el('p','Cadastre uma oferta na Stripe em Ofertas para pré-visualizar. A prévia carrega uma oferta real — não inventa uma fictícia.','empty-list'));
   return painel;
  }
  if(!previewSlug||!vendaveis.some(row=>row.slug===previewSlug))previewSlug=vendaveis[0].slug;

  if(vendaveis.length>1){
   const escolha=el('label',undefined,'checkout-preview-offer');escolha.append(el('span','Oferta na prévia'));
   const select=el('select');for(const row of vendaveis)select.append(new Option(row.payload.name+' · '+row.slug,row.slug));
   select.value=previewSlug;select.onchange=()=>{previewSlug=select.value;render();};
   escolha.append(select);painel.append(escolha);
  }

  const url=checkoutLink(product.id,previewSlug);
  const moldura=el('div',undefined,'checkout-frame '+viewport);
  const frame=document.createElement('iframe');
  frame.src=url;frame.title='Prévia da página de pagamento';frame.loading='lazy';
  moldura.append(frame);painel.append(moldura);

  const rodape=el('p',undefined,'detail');
  const link=document.createElement('a');link.href=url;link.target='_blank';link.rel='noopener';link.textContent=url;
  rodape.append(document.createTextNode('Endereço público: '),link);
  painel.append(rodape);
  return painel;
 }

 function render(){
  if(!host)return;
  host.replaceChildren();
  const colunas=el('div',undefined,'checkout-admin');
  const config=el('section',undefined,'checkout-admin-config');
  config.append(el('h3','Templates'),listaTemplates(),editor());
  colunas.append(config,previa());
  host.append(colunas);
 }

 async function reload(){
  const ticket=++generation;
  const [resultado,ofertas]=await Promise.all([
   api('/api/checkout-templates?'+new URLSearchParams({product_id:product.id})),
   api('/api/billing/offers?'+new URLSearchParams({product_id:product.id})).catch(()=>({offers:[]})),
  ]);
  if(ticket!==generation)return;
  templates=resultado.templates;offers=ofertas.offers||[];
  if(selected&&!templates.some(row=>row.slug===selected))selected=null;
  if(!selected)selected=templates.find(row=>row.payload.is_default)?.slug||templates[0]?.slug||null;
  render();
 }

 // Montado pela aba Checkout de product-payments.js, no container que ela passa.
 async function mount(container,next){
  host=container;product=next;generation++;feedback='';
  host.replaceChildren(el('p','Carregando checkout…','empty-list'));
  try{await reload();}
  catch(error){if(host)host.replaceChildren(el('p',error.message,'security-banner'));}
 }

 return {mount,clear(){generation++;host=null;product=null;templates=[];offers=[];selected=null;previewSlug=null;feedback='';}};
}

// Link público de uma oferta. Fica fora do painel porque a aba Ofertas também o
// mostra, na lista de ofertas, sem abrir nada.
export const checkoutLink=(productId,offerSlug)=>location.origin+'/c/'+encodeURIComponent(productId)+'/'+encodeURIComponent(offerSlug);
