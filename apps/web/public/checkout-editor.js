// Seções do formulário do editor de checkout.
//
// Separado de checkout-gateway.js porque a casca e o formulário cresceram para
// lados diferentes: a casca fala com a API, com o iframe e com a ponte de
// prévia; isto aqui só desenha campos, avisa a cada tecla e responde a cliques
// vindos da prévia.
//
// NENHUMA lista de token, texto ou camada é repetida aqui. Tudo vem do descritor
// que GET /api/checkout-templates devolve, cuja fonte é
// platform/checkout-model.mjs. Acrescentar um token passa a custar uma edição,
// não três que divergem.
//
// CAMADAS: o layout do checkout é fixo — não se adiciona nem remove peça. A
// camada existe para dar nome ao objetivo de cada parte e ligar "cliquei na logo
// na prévia" a "estes campos controlam a logo". A seleção é um estado só, visto
// dos dois lados: clicar na página seleciona aqui, clicar aqui destaca lá.
//
// O que o operador não escreveu não é gravado: valor igual ao padrão é omitido
// do payload, e campo de texto vazio volta ao padrão. É isso que faz o
// placeholder do campo ser a verdade sobre o que a página vai mostrar.
const el=(tag,text,cls)=>{const n=document.createElement(tag);if(text!==undefined)n.textContent=text;if(cls)n.className=cls;return n;};

// Rótulo de apresentação para os enums. É a única lista local, e é local porque
// é vocabulário de tela, não de domínio.
const ENUM_LABELS={
 shadow:{none:'Sem sombra',soft:'Suave',lifted:'Elevada'},
 density:{compact:'Compacto',regular:'Normal',roomy:'Espaçoso'},
 width:{420:'Estreito · 420px',480:'Médio · 480px',560:'Largo · 560px'},
};

const secao=(titulo,aberta,descricao)=>{
 const box=el('details',undefined,'checkout-editor-section');box.open=aberta;
 box.append(el('summary',titulo));
 if(descricao)box.append(el('p',descricao,'detail'));
 return box;
};

export function buildCheckoutEditor({schema,row,templates,typeLabels,onDraft,onSubmit,onLayer}){
 const data=row?.payload||{};
 const padroes=schema.defaults;
 // Estado local: o que o operador mexeu, já mesclado ao padrão. Guardar mesclado
 // torna o rascunho da prévia trivial; o payload é reduzido ao delta só ao salvar.
 const theme={...padroes.theme,...(data.theme||{})};
 const copy={...(data.copy||{})};
 // Onde cada campo mora, para a camada saber o que focar.
 const controles={theme:{},copy:{}};
 const secoes={};
 let camadaAtiva=null,chips={};

 const form=el('form',undefined,'checkout-admin-form');
 const aviso=el('p',undefined,'billing-status');aviso.setAttribute('role','status');

 let pendente=null;
 const avisarRascunho=()=>{
  if(!onDraft)return;
  clearTimeout(pendente);
  // Debounce curto: acompanha a digitação sem inundar o iframe a cada tecla.
  pendente=setTimeout(()=>onDraft({theme,copy:{...padroes.copy,...copy}}),120);
 };

 // ── Camadas ──────────────────────────────────────────────────────────────
 const camadasSecao=secao('Camadas',true,'Clique numa camada — ou no próprio elemento na prévia — para editar só o que a controla.');
 const listaCamadas=el('div',undefined,'checkout-layers');
 const todos=el('button',undefined,'checkout-layer checkout-layer-todos');todos.type='button';
 todos.append(el('strong','Todos os ajustes'),el('small','Mostra o formulário inteiro, sem filtrar por camada.'));
 todos.onclick=()=>selecionarCamada(null,true);
 listaCamadas.append(todos);
 for(const layer of schema.layers){
  const chip=el('button',undefined,'checkout-layer');chip.type='button';
  chip.append(el('strong',layer.label),el('small',layer.purpose));
  chip.onclick=()=>selecionarCamada(layer.id,true);
  chips[layer.id]=chip;listaCamadas.append(chip);
 }
 camadasSecao.append(listaCamadas);

 // Esconde tudo que não pertence à camada. Seção que fica sem nenhum campo
 // visível some junto, senão restariam cabeçalhos vazios.
 function aplicarFiltro(){
  const layer=schema.layers.find(l=>l.id===camadaAtiva);
  for(const wrap of form.querySelectorAll('label[data-campo]')){
   const {campo,grupo}=wrap.dataset;
   wrap.hidden=Boolean(layer)&&!(grupo==='copy'?layer.copy:layer.theme).includes(campo);
  }
  for(const secao of Object.values(secoes)){
   const marcados=secao.querySelectorAll('label[data-campo]');
   secao.hidden=marcados.length>0&&[...marcados].every(w=>w.hidden);
  }
  if(todos)todos.toggleAttribute('aria-current',!camadaAtiva);
 }

 function selecionarCamada(id,avisarPrevia){
  const layer=schema.layers.find(l=>l.id===id);
  camadaAtiva=layer?id:null;
  aplicarFiltro();
  for(const [chave,chip] of Object.entries(chips))chip.toggleAttribute('aria-current',chave===camadaAtiva);
  if(avisarPrevia&&onLayer)onLayer(camadaAtiva);
  if(!layer)return;
  // Abre as seções onde os campos daquela camada vivem e leva o foco ao
  // primeiro deles. Texto antes de tema: é o que o operador quase sempre quer.
  const alvo=layer.copy.map(k=>controles.copy[k]).concat(layer.theme.map(k=>controles.theme[k])).find(Boolean);
  if(layer.copy.length)secoes.textos.open=true;
  if(layer.theme.length)secoes.tema.open=true;
  alvo?.focus({preventScroll:true});
 }

 // ── Identidade ───────────────────────────────────────────────────────────
 const identidade=secao('Identidade',false);
 const gradeId=el('div',undefined,'billing-grid');
 const campo=(grade,rotulo,control)=>{const wrap=el('label');wrap.append(el('span',rotulo),control);grade.append(wrap);return control;};
 const nome=campo(gradeId,'Nome do template',el('input'));nome.required=true;nome.maxLength=100;nome.value=data.name||'';
 const slug=campo(gradeId,'Slug',el('input'));slug.pattern='[a-z][a-z0-9-]{1,63}';slug.maxLength=64;slug.required=true;slug.readOnly=Boolean(row);slug.value=data.slug||'';
 const tipo=campo(gradeId,'Modo',el('select'));
 for(const [v,t] of Object.entries(typeLabels))tipo.append(new Option(t,v));
 tipo.value=data.type||'HOSTED';
 const padraoWrap=el('label',undefined,'checkbox-label'),padrao=el('input');padrao.type='checkbox';
 padrao.checked=data.is_default??!templates.length;padraoWrap.append(padrao,el('span','Usar como padrão deste produto'));
 identidade.append(gradeId,padraoWrap);

 // ── Tema ─────────────────────────────────────────────────────────────────
 const temaSecao=secao('Tema',true,'Muda a prévia enquanto você edita. Só é publicado ao salvar.');
 secoes.tema=temaSecao;
 const gradeTema=el('div',undefined,'billing-grid');
 for(const token of schema.theme_tokens){
  const wrap=el('label');wrap.dataset.campo=token.key;wrap.dataset.grupo='theme';wrap.append(el('span',token.label));
  let principal;
  if(token.kind==='color'){
   // Seletor e hexadecimal lado a lado: cor de marca chega como código, e
   // obrigar o operador a achá-la na roda seria pior do que colar o valor.
   const dupla=el('div',undefined,'checkout-color-field');
   const roda=el('input');roda.type='color';roda.value=theme[token.key];
   const hex=el('input');hex.type='text';hex.maxLength=7;hex.spellcheck=false;hex.value=theme[token.key];
   const aplicar=valor=>{theme[token.key]=valor;roda.value=valor;avisarRascunho();};
   roda.oninput=()=>{hex.value=roda.value;aplicar(roda.value);};
   hex.oninput=()=>{if(/^#[0-9a-fA-F]{6}$/.test(hex.value))aplicar(hex.value.toLowerCase());};
   dupla.append(roda,hex);wrap.append(dupla);principal=roda;
  }else if(token.kind==='int'){
   const control=el('input');control.type='number';control.min=String(token.min);control.max=String(token.max);control.value=String(theme[token.key]);
   control.oninput=()=>{const n=Number(control.value);if(Number.isInteger(n)&&n>=token.min&&n<=token.max){theme[token.key]=n;avisarRascunho();}};
   wrap.append(control);if(token.unit)wrap.append(el('small',`${token.min}–${token.max} ${token.unit}`));principal=control;
  }else if(token.kind==='enum'){
   const control=el('select');
   for(const opcao of token.options)control.append(new Option(ENUM_LABELS[token.key]?.[opcao]??String(opcao),String(opcao)));
   control.value=String(theme[token.key]);
   control.onchange=()=>{const bruto=control.value;theme[token.key]=token.options.includes(Number(bruto))?Number(bruto):bruto;avisarRascunho();};
   wrap.append(control);principal=control;
  }else if(token.kind==='font'){
   const control=el('select');
   for(const fonte of schema.fonts)control.append(new Option(fonte.name,fonte.id));
   control.value=theme[token.key];
   control.onchange=()=>{theme[token.key]=control.value;avisarRascunho();};
   wrap.append(control);
   if(schema.fonts.length===1)wrap.append(el('small','Só a fonte do sistema por enquanto — nenhuma outra é hospedada aqui ainda.'));
   principal=control;
  }else{
   const control=el('input');control.type='url';control.maxLength=token.max;control.value=theme[token.key]||'';
   control.oninput=()=>{theme[token.key]=control.value.trim();avisarRascunho();};
   wrap.append(control);principal=control;
  }
  controles.theme[token.key]=principal;
  gradeTema.append(wrap);
 }
 temaSecao.append(gradeTema);

 // ── Textos ───────────────────────────────────────────────────────────────
 const campoTexto=(grade,field)=>{
  const wrap=el('label');wrap.dataset.campo=field.key;wrap.dataset.grupo='copy';wrap.append(el('span',field.label));
  const control=el(field.max>200?'textarea':'input');
  control.maxLength=field.max;
  // O padrão como placeholder: vazio mostra visivelmente o que a página dirá.
  control.placeholder=field.default||'—';
  control.value=copy[field.key]??'';
  control.oninput=()=>{const v=control.value;if(v.trim())copy[field.key]=v;else delete copy[field.key];avisarRascunho();};
  controles.copy[field.key]=control;
  wrap.append(control);grade.append(wrap);
 };
 const textos=secao('Textos',true,'Deixe em branco para usar o texto padrão, que aparece esmaecido no campo.');
 secoes.textos=textos;
 const gradeTexto=el('div',undefined,'billing-grid');
 for(const field of schema.copy_fields.filter(f=>!f.pending))campoTexto(gradeTexto,field);
 textos.append(gradeTexto);

 // Honestidade sobre o que ainda não tem efeito. Campo que finge funcionar é o
 // defeito que se quis evitar aqui: dá para escrever, some no salvamento e
 // ninguém descobre.
 const secaoPendente=secoes.pendentes=secao('Textos que ainda não aparecem na página',false,
  'Pix, boleto, cupom e parcelamento ainda não estão implementados. Estes textos são gravados e passam a valer quando cada um entrar — hoje não mudam nada.');
 const gradePendente=el('div',undefined,'billing-grid');
 for(const field of schema.copy_fields.filter(f=>f.pending))campoTexto(gradePendente,field);
 secaoPendente.append(gradePendente);

 // ── Ações ────────────────────────────────────────────────────────────────
 const salvar=el('button',row?'Salvar template':'Criar template','primary');salvar.type='submit';
 const acoes=el('div',undefined,'checkout-admin-actions');acoes.append(salvar);

 // Reduz ao delta: o que está igual ao padrão não é gravado, para mudar um
 // padrão no futuro alcançar quem nunca editou aquele campo.
 const delta=()=>Object.fromEntries(Object.entries(theme).filter(([k,v])=>v!==padroes.theme[k]));

 form.append(camadasSecao,identidade,temaSecao,textos,secaoPendente,aviso,acoes);
 aplicarFiltro();
 form.onsubmit=async event=>{
  event.preventDefault();salvar.disabled=true;aviso.textContent='Salvando…';
  try{
   await onSubmit({product_id:null,slug:slug.value,name:nome.value,type:tipo.value,
    theme:delta(),copy:{...copy},is_default:padrao.checked,version:row?.version||0});
  }catch(error){aviso.textContent=error.message;salvar.disabled=false;}
 };
 return {
  form,acoes,
  setFeedback:mensagem=>{aviso.textContent=mensagem;},
  draft:()=>({theme,copy:{...padroes.copy,...copy}}),
  // Chamado pela casca quando o clique veio da prévia: não devolve o aviso para
  // lá, senão os dois lados ficariam se avisando em círculo.
  selecionarCamada:id=>selecionarCamada(id,false),
 };
}
