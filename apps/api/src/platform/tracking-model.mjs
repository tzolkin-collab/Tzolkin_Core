import {input,text,isUuid,fail} from './http.mjs';
export const CATEGORIES=['mentoria','consultoria','software','educacional','outro'];
export const KINDS=['sessao','entregavel','feature','tarefa'];
const choice=(v,list)=>{if(!list.includes(v))throw fail(400,'Opção inválida.');return v;};
const uuid=v=>{if(!isUuid(v))throw fail(400,'Identificador inválido.');return v;};
const instant=v=>{if(typeof v!=='string'||!/^\d{4}-\d{2}-\d{2}T.*(Z|[+-]\d{2}:\d{2})$/.test(v)||!Number.isFinite(Date.parse(v)))throw fail(400,'Data com fuso obrigatório.');return new Date(v).toISOString();};
export function activityInput(b){
 input(b,['id','tenant_id','category','kind','title','starts_at','ends_at']);
 const starts_at=instant(b.starts_at),ends_at=instant(b.ends_at);
 if(Date.parse(ends_at)<=Date.parse(starts_at)||Date.parse(ends_at)-Date.parse(starts_at)>366*86400000)throw fail(400,'Intervalo inválido: use até um ano.');
 return {id:uuid(b.id),tenant_id:uuid(b.tenant_id),category:choice(b.category,CATEGORIES),kind:choice(b.kind,KINDS),title:text(b.title,2,160),starts_at,ends_at};
}
export function timeInput(b,now=Date.now()){
 input(b,['id','minutes','worked_on','note']);
 if(!Number.isInteger(b.minutes)||b.minutes<1||b.minutes>1440)throw fail(400,'Informe entre 1 e 1440 minutos.');
 if(typeof b.worked_on!=='string'||!/^\d{4}-\d{2}-\d{2}$/.test(b.worked_on)||!Number.isFinite(Date.parse(b.worked_on))||new Date(b.worked_on).toISOString().slice(0,10)!==b.worked_on||Date.parse(b.worked_on)>now+86400000)throw fail(400,'Data do trabalho inválida.');
 return {id:uuid(b.id),minutes:b.minutes,worked_on:b.worked_on,note:text(b.note,2,500)};
}
export function trackingRange(p){
 if(p.getAll('month').length!==1||p.getAll('tenant_id').length>1||![...p.keys()].every(k=>['month','tenant_id'].includes(k)))throw fail(400,'Filtros inválidos.');
 const month=p.get('month');
 if(!/^20\d{2}-(0[1-9]|1[0-2])$/.test(month))throw fail(400,'Selecione o mês.');
 const start=month+'-01',end=new Date(Date.UTC(Number(month.slice(0,4)),Number(month.slice(5)),1)).toISOString().slice(0,10);
 return {start,end,tenant:p.get('tenant_id')?uuid(p.get('tenant_id')):null};
}
