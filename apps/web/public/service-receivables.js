// Recebimentos de linha de serviço (ADR 0008, fase 1). Só apresentação: valores das
// parcelas, permissões e transições são decididos no servidor. A tela envia o que o
// operador escolheu e mostra o que voltou — inclusive o erro, com a frase do servidor.
const el=(tag,text,cls)=>{const e=document.createElement(tag);if(text!=null)e.textContent=text;if(cls)e.className=cls;return e;};
const money=(minor,currency)=>new Intl.NumberFormat('pt-BR',{style:'currency',currency}).format(minor/100);
const day=iso=>iso?iso.split('-').reverse().join('/'):'—';
const STATUS={planned:'Em rascunho',scheduled:'A cobrar',issued:'Cobrada',paid:'Paga',available:'Disponível',canceled:'Cancelada'};
const TONE={scheduled:'building',issued:'building',paid:'active',available:'active'};
const PLAN_STATUS={draft:'Rascunho',approved:'Aprovado',canceled:'Cancelado'};
const METHOD={pix:'Pix',boleto:'Boleto',card:'Cartão',external:'Link externo'};

function field(label,type='text',value=''){const wrap=el('label',label),input=el('input');input.type=type;input.value=value??'';wrap.append(input);return{wrap,input};}
function select(label,options,value){const wrap=el('label',label),input=el('select');for(const [v,t] of options){const o=el('option',t);o.value=v;input.append(o);}if(value!==undefined)input.value=value;wrap.append(input);return{wrap,input};}
const alerta=(host,message)=>{host.querySelector(':scope > [role=alert]')?.remove();const p=el('p',message,'notice-inline');p.setAttribute('role','alert');host.append(p);};
function button(label,fn,cls='secondary'){const b=el('button',label,cls);b.type='button';b.onclick=async()=>{b.disabled=true;try{await fn();}catch(e){alerta(b.parentElement||b,e.message);}finally{b.disabled=false;}};return b;}
// Formulário curto: campos + enviar + fechar. O erro do servidor aparece no próprio formulário.
function miniForm(fields,label,fn,onClose){
 const form=el('form',null,'commercial-form');form.append(...fields.map(f=>f.wrap));
 const enviar=el('button',label,'primary');enviar.type='submit';
 const fechar=el('button','Fechar','secondary');fechar.type='button';fechar.onclick=onClose;
 form.append(enviar,fechar);
 form.onsubmit=async e=>{e.preventDefault();enviar.disabled=true;try{await fn();}catch(err){alerta(form,err.message);}finally{enviar.disabled=false;}};
 return form;
}

export function setupServiceReceivables({api}){
 let epoch=0,product=null;
 const root=()=>document.getElementById('view-product-receivables');
 function clear(){epoch++;root()?.replaceChildren();}
 async function load(p){
  product=p;const ticket=++epoch,r=root();if(!r)return;
  r.replaceChildren(el('p','Carregando recebimentos…','empty-list'));
  const data=await api('/api/service-receivables?'+new URLSearchParams({product_id:p.id}));
  if(ticket!==epoch)return;
  render(data);
 }
 const reload=()=>load(product);

 function render(data){
  const r=root();r.replaceChildren();
  const head=el('div',null,'section-toolbar'),copy=el('div');
  copy.append(el('h2','Recebimentos'),el('p','A cobrança nasce do contrato comercial aceito. Pago é o que foi confirmado; disponível só com o crédito no extrato bancário. Nesta fase a cobrança é registrada à mão (Cobre PJ ou outra) e a NFS-e é a emitida pela Contabilizei.','catalog-caption'));
  head.append(copy);r.append(head);

  r.append(el('h3','Contratos aceitos sem plano','section-title'));
  if(!data.contracts.length)r.append(el('p','Nenhum contrato aceito aguardando plano. Contratos são criados e aceitos no Inbound, a partir de um lead; cliente que não veio de lead ainda não tem esse caminho.','empty-list'));
  for(const contract of data.contracts)r.append(contractCard(contract,data));

  r.append(el('h3','Planos de recebimento','section-title'));
  if(!data.plans.length)r.append(el('p','Nenhum plano de recebimento ainda.','empty-list'));
  for(const plan of data.plans)r.append(planCard(plan,data));
 }

 // --- montar plano a partir de um contrato aceito ---------------------------------
 function contractCard(contract,data){
  const card=el('article',null,'context-card'),area=el('div');
  card.append(el('h4',contract.title),el('p',`${contract.organization_name} · ${money(contract.amount_minor,contract.currency)} · vigência ${day(contract.starts_on)} a ${day(contract.ends_on)}`,'detail'));
  const abrir=el('button','Montar plano','secondary');abrir.type='button';
  abrir.onclick=()=>{abrir.hidden=true;area.replaceChildren(...planner(contract,data,()=>{area.replaceChildren();abrir.hidden=false;}));};
  card.append(abrir,area);
  return card;
 }

 // O corpo é o mesmo na prévia e no salvar; o servidor recalcula as parcelas nos dois.
 function planner(contract,data,onClose){
  const method=select('Meio de pagamento',data.methods.map(m=>[m,METHOD[m]||m]),'pix');
  const count=field('Parcelas mensais','number','1');count.input.min='1';count.input.max='60';
  const first=field('Primeiro vencimento','date',data.today);
  const preview=el('div');
  const corpo=()=>({contract_id:contract.id,contract_version:contract.version,provider:'manual',method:method.input.value,
   schedule:{count:Number(count.input.value),first_due_on:first.input.value}});
  const form=miniForm([method,count,first],'Pré-visualizar',async()=>{
   const {preview:plano}=await api('/api/service-receivables/preview','POST',corpo());
   preview.replaceChildren(
    el('p',`${plano.installments.length} parcela(s) somando ${money(plano.total_minor,plano.currency)}. Cobrança externa registrada à mão.`,'detail'),
    installmentsTable(plano.installments.map(i=>({...i,status:'planned'})),plano.currency),
    button('Salvar rascunho',async()=>{await api('/api/service-receivables/plans','POST',corpo());await reload();},'primary'));
  },onClose);
  return [el('p','Parcelas iguais; o resto dos centavos vai na primeira. Nada é cobrado ao salvar: o plano nasce em rascunho e precisa da aprovação do dono.','detail'),form,preview];
 }

 // --- plano: resumo, aprovação e parcelas -----------------------------------------
 function planCard(plan,data){
  const card=el('article',null,'context-card'),s=plan.summary,c=plan.currency,snap=plan.contract_snapshot||{};
  const titulo=el('div',null,'section-toolbar'),copy=el('div');
  copy.append(el('h4',snap.title||'Contrato'),el('p',`${plan.organization_name} · ${money(plan.total_minor,c)} · ${METHOD[plan.method]||plan.method} · cobrança externa`,'detail'));
  titulo.append(copy,el('span',PLAN_STATUS[plan.status]||plan.status,'status '+(plan.status==='approved'?'active':plan.status==='draft'?'building':'')));
  card.append(titulo);
  // Rascunho não tem parcela cobrável: dizer isso, em vez de mostrar totais zerados.
  if(plan.status==='draft')card.append(el('p',`Rascunho de ${plan.installments.length} parcela(s) somando ${money(plan.total_minor,c)}. Nada é cobrável antes da aprovação do dono.`));
  else if(plan.status!=='canceled')card.append(el('p',[
   `A cobrar ${money(s.scheduled_minor,c)}`,`Cobrada ${money(s.issued_minor,c)}`,`Paga ${money(s.paid_minor,c)}`,`Disponível ${money(s.available_minor,c)}`,
   s.overdue_count?`Vencidas: ${s.overdue_count} (${money(s.overdue_minor,c)})`:null,s.invoices_pending?`NFS-e pendentes: ${s.invoices_pending}`:null,
  ].filter(Boolean).join(' · ')));
  card.append(el('small',`Criado por ${plan.created_by}${plan.approved_by?` · aprovado por ${plan.approved_by}`:''}${plan.cancel_reason?` · cancelado: ${plan.cancel_reason}`:''}`));

  const acoes=el('div',null,'commercial-actions');
  if(plan.status==='draft')acoes.append(button('Aprovar plano',async()=>{
   if(!confirm('Aprovar este plano? As parcelas passam a ser cobráveis.'))return;
   await api(`/api/service-receivables/plans/${plan.id}/approve`,'POST',{revision:plan.revision});await reload();
  },'primary'));
  if(plan.status!=='canceled')acoes.append(button(plan.status==='draft'?'Descartar rascunho':'Cancelar plano',async()=>{
   const motivo=field('Motivo');acoes.replaceChildren(miniForm([motivo],'Confirmar cancelamento',async()=>{
    await api(`/api/service-receivables/plans/${plan.id}/cancel`,'POST',{revision:plan.revision,reason:motivo.input.value});await reload();
   },()=>reload()));
  }));
  card.append(acoes,installmentsTable(plan.installments,c,plan.status==='approved'?plan:null,data));
  return card;
 }

 function installmentsTable(installments,currency,plan=null,data=null){
  const wrap=el('div',null,'table-container'),table=el('table'),thead=el('thead'),tr=el('tr');
  for(const h of ['Nº','Vencimento','Valor','Situação','Cobrança','Pagamento','NFS-e',plan?'Ações':null].filter(Boolean)){const th=el('th',h);th.scope='col';tr.append(th);}
  thead.append(tr);const tbody=el('tbody');table.append(thead,tbody);wrap.append(table);
  for(const i of installments){
   const row=el('tr');
   const cobranca=el('td');if(i.external_ref){cobranca.append(el('div',i.external_ref));if(i.external_url){const a=el('a','Abrir cobrança ↗');a.href=i.external_url;a.target='_blank';a.rel='noopener noreferrer';cobranca.append(a);}}else cobranca.textContent='—';
   const pagamento=el('td',i.paid_on?`${day(i.paid_on)}${i.payment_reference?` · ${i.payment_reference}`:''}`:'—');
   row.append(el('td',String(i.sequence)),el('td',day(i.due_on)),el('td',money(i.amount_minor,currency)),
    (()=>{const td=el('td');td.append(el('span',STATUS[i.status]||i.status,'status '+(TONE[i.status]||'')));if(i.cancel_reason)td.append(el('div',i.cancel_reason,'client-slug'));return td;})(),
    cobranca,pagamento,el('td',i.invoice_number?`${i.invoice_number} · ${day(i.invoice_issued_on)}`:'—'));
   if(plan){const td=el('td');td.append(...installmentActions(i,row,tbody,data));row.append(td);}
   tbody.append(row);
  }
  return wrap;
 }

 // Ações da parcela conforme a situação. Cada uma abre um formulário curto na linha
 // de baixo; o servidor confere de novo a situação, a revisão e o papel do operador.
 function installmentActions(i,row,tbody,data){
  const url=acao=>`/api/service-receivables/installments/${i.id}/${acao}`;
  const abrir=(fields,label,montar)=>()=>{
   row.nextElementSibling?.classList.contains('installment-form')&&row.nextElementSibling.remove();
   const tr=el('tr',null,'installment-form'),td=el('td');td.colSpan=8;
   td.append(miniForm(fields,label,async()=>{await api(url(montar.acao),'POST',{revision:i.revision,...montar.corpo()});await reload();},()=>tr.remove()));
   tr.append(td);row.after(tr);fields[0]?.input.focus();
  };
  const botao=(label,handler)=>{const b=el('button',label,'table-action');b.type='button';b.onclick=handler;return b;};
  const lista=[];
  if(i.status==='scheduled'){
   const ref=field('Referência da cobrança'),link=field('Link (opcional)','url');
   lista.push(botao('Registrar cobrança',abrir([ref,link],'Registrar cobrança',{acao:'issue',corpo:()=>({external_ref:ref.input.value,external_url:link.input.value||null})})));
   const venc=field('Novo vencimento','date',i.due_on);
   lista.push(botao('Alterar vencimento',abrir([venc],'Alterar vencimento',{acao:'reschedule',corpo:()=>({due_on:venc.input.value})})));
  }
  if(['scheduled','issued'].includes(i.status)){
   const pago=field('Data do pagamento','date',data?.today),ref=field('Referência (opcional)');
   lista.push(botao('Registrar pagamento',abrir([pago,ref],'Registrar pagamento',{acao:'payment',corpo:()=>({paid_on:pago.input.value,payment_reference:ref.input.value||null})})));
   const motivo=field('Motivo do cancelamento');
   lista.push(botao('Cancelar',abrir([motivo],'Cancelar parcela',{acao:'cancel',corpo:()=>({reason:motivo.input.value})})));
  }
  if(['issued','paid','available'].includes(i.status)&&!i.invoice_number){
   const numero=field('Número da NFS-e'),emitida=field('Emitida em','date',data?.today);
   lista.push(botao('Registrar NFS-e',abrir([numero,emitida],'Registrar NFS-e',{acao:'invoice',corpo:()=>({number:numero.input.value,issued_on:emitida.input.value})})));
  }
  return lista;
 }

 return {load,clear};
}
