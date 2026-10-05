import {createIcon,providerLogo} from './icons.js';
import {selo} from './data-table.js';
const el=(tag,text,cls)=>{const n=document.createElement(tag);if(text!==undefined)n.textContent=text;if(cls)n.className=cls;return n;};
const labels={welcome:'Boas-vindas',charge_created:'Cobrança emitida',payment_confirmed:'Pagamento confirmado',due_reminder:'Vencimento',overdue:'Atraso',renewal:'Renovação',canceled:'Cancelamento',refunded:'Estorno'};
export function setupEmails({api,configure}){
 let generation=0,data=null,section='rules',query='',fila=null,filaMsg='',avisoFila='';   // avisoFila: a frase do que a pessoa acabou de fazer, que sobrevive ao redesenho da lista
 const SITUACAO={sent:['Enviado','success'],queued:['Na fila','info'],sending:['Enviando','info'],failed:['Falhou','danger'],cancelled:['Cancelado','neutral'],suppressed:['Não enviado','neutral']};
 const quando=v=>v?new Date(v).toLocaleString('pt-BR'):'';
 async function carregarFila(){const ticket=generation;try{const r=await api('/api/emails/outbox');if(ticket!==generation)return;fila=r;}catch(e){if(ticket!==generation)return;filaMsg=e.message;fila={disponivel:false,itens:[],contagem:{},suprimidos:0};}render();}
 function atividade(root){
  const caixa=el('section',undefined,'email-activity');root.append(caixa);
  if(!fila){carregarFila();caixa.append(el('p','Carregando atividade…','email-empty'));return;}
  if(!fila.disponivel){const v=el('div',undefined,'email-empty');v.append(createIcon('mail'),el('h2','Histórico de comunicação'),el('p',filaMsg||'Disponível assim que a atualização do banco (migração 051) for aplicada.'));caixa.append(v);return;}
  const c=fila.contagem||{};
  caixa.append(el('p',`Últimos 30 dias: ${c.sent||0} enviado${(c.sent||0)===1?'':'s'}, ${c.queued||0} na fila, ${c.failed||0} com falha${fila.suprimidos?` · ${fila.suprimidos} endereço${fila.suprimidos===1?'':'s'} bloqueado${fila.suprimidos===1?'':'s'}`:''}.`,'email-note'));
  if(!fila.envio_configurado){const n=el('p','O envio de e-mail ainda não está configurado: o que estiver na fila só sai depois de configurar o provedor em Configurações → Integrações → E-mail transacional (e-mail parado por mais de 48 horas é cancelado).','email-note');n.setAttribute('role','alert');caixa.append(n);}
  const aviso=el('p',avisoFila,'email-note');aviso.setAttribute('role','status');avisoFila='';
  const lista=el('div',undefined,'email-outbox');
  if(!fila.itens.length)lista.append(el('p','Nenhum e-mail na fila ainda. As automações de lead com a ação "Enviar e-mail ao lead" aparecem aqui.','email-empty'));
  for(const m of fila.itens){
   const linha=el('article',undefined,'email-outbox-item');linha.dataset.id=m.id;linha.dataset.status=m.status;
   const topo=el('div',undefined,'email-outbox-top');const [rotulo,tom]=SITUACAO[m.status]||[m.status,'neutral'];topo.append(selo(rotulo,tom),el('strong',m.subject));
   const meta=[m.to_email,quando(m.sent_at||m.created_at),m.kind==='teste'?'teste':null,m.attempts>1?`${m.attempts} tentativas`:null].filter(Boolean).join(' · ');
   linha.append(topo,el('p',meta,'email-help'));
   if(m.last_error)linha.append(el('p',m.last_error,'email-help email-outbox-erro'));
   const acoes=el('div',undefined,'email-outbox-acoes');
   if(m.status==='failed'){const b=el('button','Reenviar','secondary');b.type='button';b.onclick=async()=>{b.disabled=true;try{await api(`/api/emails/outbox/${m.id}/reenviar`,'POST',{});avisoFila='Na fila de novo: sai no próximo ciclo (até 30 segundos).';fila=null;await carregarFila();}catch(e){aviso.textContent=e.message;b.disabled=false;}};acoes.append(b);}
   if(['queued','failed','sent'].includes(m.status)){const b=el('button','Não enviar mais a este endereço','quiet');b.type='button';b.onclick=async()=>{b.disabled=true;try{const r=await api('/api/emails/suppress','POST',{email:m.to_email,reason:'manual'});avisoFila=`${m.to_email} não receberá mais e-mails do Core${r.tirados_da_fila?` (${r.tirados_da_fila} saíram da fila)`:''}.`;fila=null;await carregarFila();}catch(e){aviso.textContent=e.message;b.disabled=false;}};acoes.append(b);}
   if(acoes.childElementCount)linha.append(acoes);
   lista.append(linha);
  }
  caixa.append(aviso,lista);
 }
 const host=()=>document.getElementById('view-emails');
 function render(){
  const root=host();root.replaceChildren();root.classList.add('email-hub');
  const intro=el('div',undefined,'email-intro');intro.append(createIcon('mail'),el('p','Comunicação com clientes, organizada por produto e oferta.'));root.append(intro);
  const nav=el('nav',undefined,'email-nav');nav.setAttribute('aria-label','Seções de e-mail');
  for(const [key,label,icon]of [['rules','Automações','zap'],['templates','Templates','book-open'],['activity','Atividade','clock']]){const b=el('button');b.type='button';b.append(createIcon(icon),document.createTextNode(label));b.setAttribute('aria-pressed',String(section===key));b.onclick=()=>{section=key;if(key==='activity')fila=null;render();};nav.append(b);}root.append(nav);
  if(!data){root.append(el('p','Carregando configurações salvas…','email-empty'));return;}
  if(section!=='activity'){const note=el('p','Os e-mails para leads saem pelas automações do funil (Inbound → Automações → "Enviar e-mail ao lead"), usando os templates do espaço. As mensagens de cobrança (pagamento, atraso…) ainda são rascunho: o Core não as envia.','email-note');root.append(note);}
  if(section==='activity'){atividade(root);return;}
  const search=el('input');search.type='search';search.placeholder='Buscar produto, oferta ou template';search.setAttribute('aria-label','Buscar configurações de e-mail');search.value=query;
  const list=el('div',undefined,'email-list');
  function draw(){list.replaceChildren();const rules=data.rules.filter(r=>[r.product_name,r.offer_name,r.offer_slug,...r.templates.map(t=>t.slug)].join(' ').toLocaleLowerCase('pt-BR').includes(query.toLocaleLowerCase('pt-BR')));
   for(const rule of rules){const card=el('article',undefined,'email-card'),head=el('div',undefined,'email-card-head'),identity=el('div');identity.append(el('h2',rule.offer_name),el('p',rule.product_name+' · '+rule.offer_slug));const edit=el('button','Configurar','secondary');edit.type='button';edit.setAttribute('aria-label','Configurar '+rule.product_name+' · '+rule.offer_name);edit.onclick=()=>configure({id:rule.product_id,name:rule.product_name});head.append(identity,edit);card.append(head);
    const owner=el('div',undefined,'email-owner');owner.append(rule.provider==='stripe'?providerLogo('stripe'):createIcon('wallet'),el('span',(rule.provider==='stripe'?'Stripe':'Asaas')+' · avisos financeiros pelo '+(rule.owner==='core'?'Core':'processador')+' · rascunho'));card.append(owner);
    if(rule.templates.length){const items=el('ul');for(const t of rule.templates){const li=el('li');li.append(el('span',labels[t.event]),el('code',t.slug));items.append(li);}card.append(items);}else card.append(el('p','Nenhuma referência de template configurada.','email-help'));
    if(section==='templates')card.append(el('p','O conteúdo é editado no contexto do produto. Abra Configurar para continuar no editor próprio.','email-help'));list.append(card);
   }
   if(!rules.length)list.append(el('p',query?'Nenhuma configuração encontrada.':'Crie uma oferta em Produtos e planos → Cobrança e e-mails. As regras salvas aparecerão aqui.','email-empty'));
  }
  search.oninput=()=>{query=search.value;draw();};root.append(search,list);draw();
 }
 async function load(){const ticket=++generation;render();try{const result=await api('/api/emails');if(ticket!==generation)return;data=result;render();}catch(error){if(ticket!==generation)return;const warning=el('p',error.message,'email-note');warning.setAttribute('role','alert');const retry=el('button','Tentar novamente','secondary');retry.type='button';retry.onclick=load;host().replaceChildren(warning,retry);}}
 return{load,clear(){generation++;data=null;fila=null;filaMsg='';avisoFila='';query='';host()?.replaceChildren();}};
}
