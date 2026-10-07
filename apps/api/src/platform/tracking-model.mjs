import {input,text,isUuid,fail} from './http.mjs';
export const CATEGORIES=['mentoria','consultoria','software','educacional','outro'];
// O tipo da atividade virou aba na tela (Call · Task · Registro). Os valores são os mesmos de antes mais 'registro':
// 'sessao' é Call; 'tarefa', 'entregavel' e 'feature' são Task (os dois últimos vêm de antes das abas e seguem válidos).
// 'registro' depende da migração 054 no banco — a rota pergunta ao detector antes de gravar e recusa com MENSAGEM_054.
export const KINDS=['sessao','entregavel','feature','tarefa','registro'];
// Série é atividade que se repete; registro é o que já aconteceu e se guarda. Repetir um registro não quer dizer nada,
// então a série não aceita esse tipo — e, com isso, a 054 não precisa mexer no CHECK de service_activity_series.
export const KINDS_DE_SERIE=['sessao','entregavel','feature','tarefa'];
// Campos de agenda (migração 047). Opcionais: sem eles o evento é o mesmo de antes, e o SQL só os toca quando vêm preenchidos.
export const OPCIONAIS=['description','location','meeting_url'];
const LIMITES={description:2000,location:200,meeting_url:500};
const MAX_INTERVALO_MS=366*86400000, MAX_JANELA_DIAS=62;
// Antecedências aceitas (minutos antes do início). A mesma lista é CHECK no banco (migração 048); a tela oferece um subconjunto.
export const LEMBRETES_PERMITIDOS=Object.freeze([0,5,10,15,30,60,120,1440,2880,10080]);
/** Lista de antecedências -> ordenada da maior para a menor, sem repetição. [] = não avisar. undefined/null = quem chama decide (padrão). */
export function lembretes(valor){
 if(!Array.isArray(valor)||valor.length>3||!valor.every(n=>Number.isInteger(n)&&LEMBRETES_PERMITIDOS.includes(n)))throw fail(400,'Lembrete inválido: use até 3 antecedências da lista.');
 return [...new Set(valor)].sort((a,b)=>b-a);
}
const choice=(v,list)=>{if(!list.includes(v))throw fail(400,'Opção inválida.');return v;};
const uuid=v=>{if(!isUuid(v))throw fail(400,'Identificador inválido.');return v;};
const instant=v=>{if(typeof v!=='string'||!/^\d{4}-\d{2}-\d{2}T.*(Z|[+-]\d{2}:\d{2})$/.test(v)||!Number.isFinite(Date.parse(v)))throw fail(400,'Data com fuso obrigatório.');return new Date(v).toISOString();};
const intervalo=(starts_at,ends_at)=>{if(Date.parse(ends_at)<=Date.parse(starts_at)||Date.parse(ends_at)-Date.parse(starts_at)>MAX_INTERVALO_MS)throw fail(400,'Intervalo inválido: use até um ano.');};
// Quebra de linha e tabulação valem só na descrição; o resto é caractere de controle e vira erro.
const CONTROLE=/[\u0000-\u0008\u000b\u000c\u000e-\u001f\u007f]/;
// Vazio e null viram null ("sem valor"): na criação o campo é omitido, na edição ele é limpo.
export function opcional(campo,valor){
 if(valor==null)return null;
 if(typeof valor!=='string')throw fail(400,'Texto inválido.');
 const t=valor.trim();if(!t)return null;
 if(t.length>LIMITES[campo]||CONTROLE.test(t)||(campo!=='description'&&/[\r\n]/.test(t)))throw fail(400,campo==='description'?'Descrição inválida (até 2000 caracteres).':campo==='location'?'Local inválido (até 200 caracteres, em uma linha).':'Link inválido.');
 if(campo==='meeting_url'){
  let url;try{url=new URL(t);}catch{throw fail(400,'Link da reunião inválido.');}
  // O link vira <a href> na tela: só https, sem credencial embutida.
  if(url.protocol!=='https:'||url.username||url.password)throw fail(400,'O link da reunião precisa começar com https://.');
  return url.href;
 }
 return t;
}
export function activityInput(b){
 input(b,['id','tenant_id','category','kind','title','starts_at','ends_at','engagement_id','reminders',...OPCIONAIS]);
 const starts_at=instant(b.starts_at),ends_at=instant(b.ends_at);
 intervalo(starts_at,ends_at);
 const out={id:uuid(b.id),tenant_id:uuid(b.tenant_id),category:choice(b.category,CATEGORIES),kind:choice(b.kind,KINDS),title:text(b.title,2,160),starts_at,ends_at,engagement_id:b.engagement_id==null||b.engagement_id===''?null:uuid(b.engagement_id)};
 for(const campo of OPCIONAIS){const v=opcional(campo,b[campo]);if(v!==null)out[campo]=v;}
 // Sem `reminders` a atividade usa o padrão da agenda (NULL no banco); com a lista, ela manda ([] = não avisar).
 if(b.reminders!==undefined&&b.reminders!==null)out.reminders=lembretes(b.reminders);
 return out;
}
export const EDITAVEIS=['title','starts_at','ends_at','category','kind','reminders',...OPCIONAIS];
// Edição parcial com revisão (concorrência otimista, como o resto do Core). Início e fim andam juntos: o intervalo só se valida inteiro.
export function activityUpdateInput(b){
 input(b,['revision',...EDITAVEIS]);
 if(!Number.isInteger(b.revision)||b.revision<1)throw fail(400,'Revisão inválida.');
 const campos={};
 if('title' in b)campos.title=text(b.title,2,160);
 if('category' in b)campos.category=choice(b.category,CATEGORIES);
 if('kind' in b)campos.kind=choice(b.kind,KINDS);
 if('starts_at' in b||'ends_at' in b){
  if(!('starts_at' in b&&'ends_at' in b))throw fail(400,'Informe início e fim juntos.');
  campos.starts_at=instant(b.starts_at);campos.ends_at=instant(b.ends_at);intervalo(campos.starts_at,campos.ends_at);
 }
 for(const campo of OPCIONAIS)if(campo in b)campos[campo]=opcional(campo,b[campo]);
 if('reminders' in b)campos.reminders=b.reminders===null?null:lembretes(b.reminders);   // null = volta a valer o padrão da agenda
 if(!Object.keys(campos).length)throw fail(400,'Nada para alterar.');
 return {revision:b.revision,campos};
}
export function timeInput(b,now=Date.now()){
 input(b,['id','minutes','worked_on','note']);
 if(!Number.isInteger(b.minutes)||b.minutes<1||b.minutes>1440)throw fail(400,'Informe entre 1 e 1440 minutos.');
 if(typeof b.worked_on!=='string'||!/^\d{4}-\d{2}-\d{2}$/.test(b.worked_on)||!Number.isFinite(Date.parse(b.worked_on))||new Date(b.worked_on).toISOString().slice(0,10)!==b.worked_on||Date.parse(b.worked_on)>now+86400000)throw fail(400,'Data do trabalho inválida.');
 return {id:uuid(b.id),minutes:b.minutes,worked_on:b.worked_on,note:text(b.note,2,500)};
}
const dia=v=>typeof v==='string'&&/^20\d{2}-\d{2}-\d{2}$/.test(v)&&Number.isFinite(Date.parse(v))&&new Date(v+'T00:00:00Z').toISOString().slice(0,10)===v;
// Janela da consulta: um mês (`month=2026-08`) ou um intervalo livre (`from=2026-08-24&to=2026-08-31`, `to` exclusivo, até 62 dias).
// O intervalo existe porque a agenda mostra semana e dia, que atravessam a virada do mês.
export function trackingRange(p){
 const chaves=['month','from','to','tenant_id','engagement_id'];
 if(![...p.keys()].every(k=>chaves.includes(k))||chaves.some(k=>p.getAll(k).length>1))throw fail(400,'Filtros inválidos.');
 const month=p.get('month'),from=p.get('from'),to=p.get('to');
 let start,end;
 if(month!==null){
  if(from!==null||to!==null)throw fail(400,'Use o mês ou o intervalo, não os dois.');
  if(!/^20\d{2}-(0[1-9]|1[0-2])$/.test(month))throw fail(400,'Selecione o mês.');
  start=month+'-01';end=new Date(Date.UTC(Number(month.slice(0,4)),Number(month.slice(5)),1)).toISOString().slice(0,10);
 }else{
  if(!dia(from)||!dia(to))throw fail(400,'Selecione o mês ou o intervalo (from e to, AAAA-MM-DD).');
  const dias=(Date.parse(to)-Date.parse(from))/86400000;
  if(dias<1||dias>MAX_JANELA_DIAS)throw fail(400,'Intervalo inválido: de 1 a '+MAX_JANELA_DIAS+' dias.');
  start=from;end=to;
 }
 return {start,end,tenant:p.get('tenant_id')?uuid(p.get('tenant_id')):null,engagement:p.get('engagement_id')?uuid(p.get('engagement_id')):null};
}

// ---------- séries (atividades recorrentes) ----------
const HHMM=/^([01]\d|2[0-3]):[0-5]\d$/;
const inteiro=(v,min,max,msg)=>{if(!Number.isInteger(v)||v<min||v>max)throw fail(400,msg);return v;};
const horario=v=>{if(typeof v!=='string'||!HHMM.test(v))throw fail(400,'Horário inválido (use HH:MM).');return v;};
const dataDia=(v,msg)=>{if(!dia(v))throw fail(400,msg);return v;};
const duracao=v=>inteiro(v,5,1440,'Duração inválida: de 5 minutos a 24 horas.');
/** Corpo de POST /api/tracking/series. Uma regra semanal (weekdays) ou mensal (month_day) e os dados que cada ocorrência herda. */
export function serieInput(b){
 input(b,['id','tenant_id','engagement_id','category','kind','title','description','location','meeting_url','frequency','interval_n','weekdays','month_day','start_time','duration_minutes','starts_on','ends_on','count_limit','reminders']);
 const frequency=choice(b.frequency,['weekly','monthly']);
 const out={id:uuid(b.id),tenant_id:uuid(b.tenant_id),engagement_id:b.engagement_id==null||b.engagement_id===''?null:uuid(b.engagement_id),
  category:choice(b.category,CATEGORIES),kind:choice(b.kind,KINDS_DE_SERIE),title:text(b.title,2,160),frequency,
  interval_n:b.interval_n===undefined?1:inteiro(b.interval_n,1,12,'Intervalo de repetição inválido (de 1 a 12).'),
  start_time:horario(b.start_time),duration_minutes:duracao(b.duration_minutes),starts_on:dataDia(b.starts_on,'Data de início inválida.')};
 if(frequency==='weekly'){
  if(b.month_day!==undefined&&b.month_day!==null)throw fail(400,'A repetição semanal não usa dia do mês.');
  if(!Array.isArray(b.weekdays)||!b.weekdays.length||b.weekdays.length>7||!b.weekdays.every(d=>Number.isInteger(d)&&d>=0&&d<=6))throw fail(400,'Escolha os dias da semana (0 = segunda a 6 = domingo).');
  out.weekdays=[...new Set(b.weekdays)].sort((x,y)=>x-y);out.month_day=null;
 }else{
  if(b.weekdays!==undefined&&b.weekdays!==null)throw fail(400,'A repetição mensal não usa dias da semana.');
  out.month_day=inteiro(b.month_day,1,31,'Dia do mês inválido (de 1 a 31).');out.weekdays=null;
 }
 if(b.ends_on!==undefined&&b.ends_on!==null&&b.ends_on!==''){
  out.ends_on=dataDia(b.ends_on,'Data de fim inválida.');
  if(out.ends_on<out.starts_on)throw fail(400,'O fim da repetição não pode ser antes do início.');
 }
 if(b.count_limit!==undefined&&b.count_limit!==null)out.count_limit=inteiro(b.count_limit,1,366,'Quantidade de repetições inválida (de 1 a 366).');
 for(const campo of OPCIONAIS){const v=opcional(campo,b[campo]);if(v!==null)out[campo]=v;}
 if(b.reminders!==undefined&&b.reminders!==null)out.reminders=lembretes(b.reminders);
 return out;
}
export const SERIE_EDITAVEL=['title','category','kind','description','location','meeting_url','start_time','duration_minutes','reminders'];
/** Corpo de PUT /api/tracking/series/:id: o que vale para as próximas ocorrências. A regra (dias, frequência) não muda: encerra-se a série e cria-se outra. */
export function serieUpdateInput(b){
 input(b,['revision',...SERIE_EDITAVEL]);
 if(!Number.isInteger(b.revision)||b.revision<1)throw fail(400,'Revisão inválida.');
 const campos={};
 if('title' in b)campos.title=text(b.title,2,160);
 if('category' in b)campos.category=choice(b.category,CATEGORIES);
 if('kind' in b)campos.kind=choice(b.kind,KINDS_DE_SERIE);
 for(const campo of OPCIONAIS)if(campo in b)campos[campo]=opcional(campo,b[campo]);
 if('start_time' in b)campos.start_time=horario(b.start_time);
 if('duration_minutes' in b)campos.duration_minutes=duracao(b.duration_minutes);
 if('reminders' in b)campos.reminders=b.reminders===null?null:lembretes(b.reminders);
 if(!Object.keys(campos).length)throw fail(400,'Nada para alterar.');
 return {revision:b.revision,campos};
}
export function serieEncerrarInput(b){
 input(b,['revision','from']);
 if(!Number.isInteger(b.revision)||b.revision<1)throw fail(400,'Revisão inválida.');
 // `from` (opcional): encerra "a partir deste evento"; sem ele, a partir de agora.
 return {revision:b.revision,from:b.from===undefined||b.from===null?null:instant(b.from)};
}
/** Corpo de PUT /api/agenda/preferencias: os lembretes que valem para toda atividade que não escolheu os seus. */
export function preferenciasInput(b){
 input(b,['revision','default_reminders']);
 if(!Number.isInteger(b.revision)||b.revision<1)throw fail(400,'Revisão inválida.');
 return {revision:b.revision,default_reminders:lembretes(b.default_reminders)};
}
