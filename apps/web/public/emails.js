import {createIcon,providerLogo} from './icons.js';
const el=(tag,text,cls)=>{const n=document.createElement(tag);if(text!==undefined)n.textContent=text;if(cls)n.className=cls;return n;};
const labels={welcome:'Boas-vindas',charge_created:'Cobrança emitida',payment_confirmed:'Pagamento confirmado',due_reminder:'Vencimento',overdue:'Atraso',renewal:'Renovação',canceled:'Cancelamento',refunded:'Estorno'};
export function setupEmails({api,configure}){
 let generation=0,data=null,section='rules',query='';
 const host=()=>document.getElementById('view-emails');
 function render(){
  const root=host();root.replaceChildren();root.classList.add('email-hub');
  const intro=el('div',undefined,'email-intro');intro.append(createIcon('mail'),el('p','Comunicação com clientes, organizada por produto e oferta.'));root.append(intro);
  const nav=el('nav',undefined,'email-nav');nav.setAttribute('aria-label','Seções de e-mail');
  for(const [key,label,icon]of [['rules','Automações','zap'],['templates','Templates','book-open'],['activity','Atividade','clock']]){const b=el('button');b.type='button';b.append(createIcon(icon),document.createTextNode(label));b.setAttribute('aria-pressed',String(section===key));b.onclick=()=>{section=key;render();};nav.append(b);}root.append(nav);
  if(!data){root.append(el('p','Carregando configurações salvas…','email-empty'));return;}
  const note=el('p','Envio e recebimento ainda não integrados. As configurações abaixo são rascunhos, não automações ativas.','email-note');root.append(note);
  if(section==='activity'){const box=el('section',undefined,'email-empty');box.append(createIcon('mail'),el('h2','Histórico de comunicação'),el('p','Entregas, falhas e respostas aparecerão aqui após integrar o serviço de e-mail. Ainda não há leitura de caixa de entrada nem registro de envios neste módulo.'));root.append(box);return;}
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
 return{load,clear(){generation++;data=null;query='';host()?.replaceChildren();}};
}
