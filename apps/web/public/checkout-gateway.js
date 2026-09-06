// Aba Checkout, dentro de Pagamentos: aparência, textos e modo de exibição da
// página pública.
//
// Não é diálogo e não é view própria. Checkout é parte de pagamentos, não irmão
// dele — e como superfície de configuração (coleção de templates mais prévia),
// não cabe numa caixinha modal, que não tem deep link nem espaço para a prévia.
//
// A prévia é um iframe da página pública DE VERDADE, não uma reprodução. Copiar
// o cartão para cá duplicaria checkout.css e passaria a mentir no dia em que um
// dos dois mudasse.
//
// A prévia agora acompanha a digitação, sem deixar de ser a página real: o
// editor manda rascunho de tema e texto por postMessage e a própria página os
// aplica. Nada de dinheiro trafega nessa ponte — o preço continua vindo de
// /api/checkout/offer, e no modo prévia a página nunca cria sessão de pagamento.
//
// Por que a ponte, e não montar o cartão aqui: a CSP do painel é script-src
// 'self', então Stripe.js não carrega nesta página, nunca. A área de pagamento
// só pode existir dentro de /c/, que tem CSP própria. Isso decide a arquitetura
// sozinho.
//
// O formulário em si vive em checkout-editor.js.
import {buildCheckoutEditor} from './checkout-editor.js';

const el=(tag,text,cls)=>{const n=document.createElement(tag);if(text!==undefined)n.textContent=text;if(cls)n.className=cls;return n;};
const TYPE_LABELS={HOSTED:'Hospedado na Stripe (redireciona)',EMBEDDED:'Incorporado (fica na sua página)',ELEMENTS:'Elements — ainda não cria sessão'};
const VIEWPORTS={mobile:'Celular',desktop:'Computador'};
const TIPO_CURTO={HOSTED:'Hospedado',EMBEDDED:'Incorporado',ELEMENTS:'Elements'};
// Largura de monitor de verdade, para a prévia desktop cruzar o breakpoint de
// 880px do checkout. A altura cobre o cartão inteiro com folga.
const LARGURA_DESKTOP=1280,ALTURA_DESKTOP=860;
const corDoTemplate=payload=>payload.theme?.color||payload.branding?.primary_color||'#111827';

export function setupCheckoutPanel({api}){
 let generation=0,host=null,product=null,templates=[],offers=[],schema=null,selected=null,previewSlug=null,viewport='mobile',feedback='';
 // A moldura é preservada entre renders para não recarregar o iframe a cada
 // troca de viewport — recarregar perderia o rascunho aplicado.
 let frame=null,frameSrc=null,pronta=false,editorAtual=null,alerta=null,relogio=null,observador=null;
 const current=()=>templates.find(row=>row.slug===selected)||null;
 const stripeOffers=()=>offers.filter(row=>row.payload.provider==='stripe');

 function enviarRascunho(){
  if(!pronta||!frame?.contentWindow||!editorAtual)return;
  frame.contentWindow.postMessage({type:'checkout-preview-draft',...editorAtual.draft()},location.origin);
 }

 function destacarCamada(id){
  if(!pronta||!frame?.contentWindow)return;
  frame.contentWindow.postMessage({type:'checkout-preview-highlight',layer:id},location.origin);
 }

 // Só aceita mensagens do nosso próprio iframe, da nossa própria origem.
 function aoReceber(event){
  if(event.origin!==location.origin||event.source!==frame?.contentWindow)return;
  if(event.data?.type==='checkout-preview-ready'){
   clearTimeout(relogio);pronta=true;
   if(alerta)alerta.textContent='';
   enviarRascunho();
   return;
  }
  // Clique numa camada da página: seleciona os campos que a controlam. Não
  // devolve destaque para a prévia — ela já se destacou sozinha, e devolver
  // deixaria os dois lados se avisando em círculo.
  if(event.data?.type==='checkout-preview-pick'&&typeof event.data.layer==='string')editorAtual?.selecionarCamada(event.data.layer);
 }
 addEventListener('message',aoReceber);

 function editor(){
  if(!schema)return el('p','Carregando o editor…','empty-list');
  const row=current();
  editorAtual=buildCheckoutEditor({
   schema,row,templates,typeLabels:TYPE_LABELS,
   onDraft:enviarRascunho,
   onLayer:destacarCamada,
   onSubmit:async payload=>{
    await api('/api/checkout-templates','PUT',{...payload,product_id:product.id});
    feedback='Template salvo e publicado.';
    selected=payload.slug;await reload();
   },
  });
  if(feedback)editorAtual.setFeedback(feedback);
  if(row){
   const novo=el('button','Novo template','secondary');novo.type='button';
   novo.onclick=()=>{selected=null;feedback='';render();};
   editorAtual.acoes.append(novo);
  }
  return editorAtual.form;
 }

 function listaTemplates(){
  const box=el('div',undefined,'checkout-admin-list');
  for(const row of templates){
   const chip=el('button',undefined,'checkout-template-chip');chip.type='button';
   if(row.slug===selected)chip.setAttribute('aria-current','true');
   const marca=el('span',undefined,'checkout-template-swatch');marca.style.setProperty('background',corDoTemplate(row.payload));
   const texto=el('span');texto.append(el('strong',row.payload.name),
    el('small',(TIPO_CURTO[row.payload.type]||row.payload.type)+(row.payload.is_default?' · padrão':'')));
   chip.append(marca,texto);chip.onclick=()=>{selected=row.slug;feedback='';render();};
   box.append(chip);
  }
  if(!templates.length)box.append(el('p','Nenhum template ainda. O formulário abaixo cria o primeiro.','empty-list'));
  return box;
 }

 function previa(){
  const painel=el('section',undefined,'checkout-admin-preview'),topo=el('div',undefined,'section-toolbar'),copy=el('div');
  copy.append(el('h3','Prévia'),el('p','A página pública real, acompanhando o que você edita.','detail'));
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
  const alvo=url+'?preview=1'+(selected?'&template='+encodeURIComponent(selected):'');
  const moldura=el('div',undefined,'checkout-frame '+viewport);
  if(!frame||frameSrc!==alvo){
   pronta=false;
   frame=document.createElement('iframe');
   frame.src=alvo;frame.title='Prévia da página de pagamento';frame.loading='lazy';frameSrc=alvo;
   // Degradação honesta: se a página não responder, o operador precisa saber que
   // está olhando algo desatualizado — prévia velha e silenciosa é pior.
   clearTimeout(relogio);
   relogio=setTimeout(()=>{if(!pronta&&alerta)alerta.textContent='A prévia não respondeu. Ela mostra a última versão salva; recarregue a página para tentar de novo.';},3000);
  }
  moldura.append(frame);painel.append(moldura);
  // Desktop: o iframe renderiza em 1280px e encolhe por escala. Sem isto ele
  // teria a largura da coluna (~500px), ficaria abaixo do breakpoint de 880px
  // do checkout e a prévia desktop mostraria o layout de celular.
  const escalaTexto=el('p',undefined,'checkout-preview-escala');
  if(viewport==='desktop'){
   const ajustar=()=>{
    const disponivel=moldura.clientWidth;
    if(!disponivel)return;
    const escala=Math.min(1,disponivel/LARGURA_DESKTOP);
    moldura.style.setProperty('--previa-escala',String(escala));
    moldura.style.height=Math.round(ALTURA_DESKTOP*escala)+'px';
    escalaTexto.textContent=`Renderizado em ${LARGURA_DESKTOP}px, exibido a ${Math.round(escala*100)}%`;
   };
   requestAnimationFrame(ajustar);
   observador?.disconnect();
   observador=new ResizeObserver(ajustar);observador.observe(moldura);
   painel.append(escalaTexto);
  }else{observador?.disconnect();observador=null;}
  alerta=el('p',undefined,'notice-inline');alerta.setAttribute('role','status');painel.append(alerta);

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
  enviarRascunho();
 }

 async function reload(){
  const ticket=++generation;
  const [resultado,ofertas]=await Promise.all([
   api('/api/checkout-templates?'+new URLSearchParams({product_id:product.id})),
   api('/api/billing/offers?'+new URLSearchParams({product_id:product.id})).catch(()=>({offers:[]})),
  ]);
  if(ticket!==generation)return;
  templates=resultado.templates;schema=resultado.schema;offers=ofertas.offers||[];
  if(selected&&!templates.some(row=>row.slug===selected))selected=null;
  if(!selected)selected=templates.find(row=>row.payload.is_default)?.slug||templates[0]?.slug||null;
  // Uma gravação muda o que está publicado: a prévia precisa recarregar para
  // deixar de mostrar rascunho e passar a mostrar o que está no ar.
  frame=null;frameSrc=null;pronta=false;
  render();
 }

 // Montado pela aba Checkout de product-payments.js, no container que ela passa.
 async function mount(container,next){
  host=container;product=next;generation++;feedback='';
  host.replaceChildren(el('p','Carregando checkout…','empty-list'));
  try{await reload();}
  catch(error){if(host)host.replaceChildren(el('p',error.message,'security-banner'));}
 }

 return {mount,clear(){
  generation++;clearTimeout(relogio);observador?.disconnect();
  host=null;product=null;templates=[];offers=[];schema=null;selected=null;previewSlug=null;feedback='';
  frame=null;frameSrc=null;pronta=false;editorAtual=null;alerta=null;observador=null;
 }};
}

// Link público de uma oferta. Fica fora do painel porque a aba Ofertas também o
// mostra, na lista de ofertas, sem abrir nada.
export const checkoutLink=(productId,offerSlug)=>location.origin+'/c/'+encodeURIComponent(productId)+'/'+encodeURIComponent(offerSlug);
