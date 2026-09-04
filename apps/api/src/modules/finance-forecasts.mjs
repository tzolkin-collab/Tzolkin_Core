import { fail, input, onlyParams, text } from '../platform/http.mjs';

const validMonth = value => /^20\d{2}-(0[1-9]|1[0-2])$/.test(value);
const validDate = value => typeof value === 'string' && /^20\d{2}-\d{2}-\d{2}$/.test(value) && dateValue(utcDate(value)) === value;
const project = row => ({...row, amount_minor:Number(row.amount_minor), tags:Array.isArray(row.tags)?row.tags:[]});

const utcDate = value => { const [year,month,day] = value.split('-').map(Number); return new Date(Date.UTC(year,month-1,day)); };
const dateValue = date => date.toISOString().slice(0,10);
const lastDay = (year, month) => new Date(Date.UTC(year, month + 1, 0)).getUTCDate();
const addMonths = (date, months, requestedDay = date.getUTCDate()) => {
 const target = new Date(date);
 target.setUTCDate(1);
 target.setUTCMonth(target.getUTCMonth() + months);
 target.setUTCDate(Math.min(requestedDay, lastDay(target.getUTCFullYear(), target.getUTCMonth())));
 return target;
};

export function expandForecastRows(rows, rangeStart, rangeEnd) {
 const start = utcDate(rangeStart), end = utcDate(rangeEnd), expanded = [];
 for (const row of rows) {
  if (!validDate(row.due_date)) continue;
  const first = utcDate(row.due_date), last = row.end_date && validDate(row.end_date) ? utcDate(row.end_date) : end;
  if (last < start || first > end) continue;
  const step = row.recurrence === 'monthly' ? 1 : row.recurrence === 'quarterly' ? 3 : row.recurrence === 'yearly' ? 12 : 0;
  if (!step) {
   if (first >= start && first <= end) expanded.push(project(row));
   continue;
  }
  const anchorDay = first.getUTCDate();
  for (let occurrence = new Date(first), index = 0; occurrence <= last && occurrence <= end; occurrence = addMonths(occurrence, step, anchorDay), index += 1) {
   if (occurrence < start) continue;
   expanded.push(project({...row, due_date: dateValue(occurrence), occurrence: index}));
  }
 }
 return expanded.sort((a,b) => String(a.due_date).localeCompare(String(b.due_date)) || String(a.name).localeCompare(String(b.name)));
}

export function financeForecastRoutes(router) {
 router.get('/api/finance/forecasts', async ({url,pool,reply}) => {
  onlyParams(url.searchParams,['month','year','from','to']);
  const month=url.searchParams.get('month'),year=url.searchParams.get('year'),from=url.searchParams.get('from'),to=url.searchParams.get('to');
  let query='',params=[],rangeStart,rangeEnd;
  if(month){
   if(!validMonth(month)) throw fail(400,'Mês inválido.');
   rangeStart=month+'-01'; rangeEnd=dateValue(new Date(utcDate(dateValue(addMonths(utcDate(rangeStart),1))).getTime()-86400000));
  }else if(year){
   if(!/^20\d{2}$/.test(year)) throw fail(400,'Ano inválido.');
   rangeStart=year+'-01-01'; rangeEnd=`${Number(year)}-12-31`;
  }else if(from&&to){
   if(!validDate(from)||!validDate(to)||from>to) throw fail(400,'Intervalo inválido.');
   rangeStart=from; rangeEnd=to;
  }else{
   throw fail(400,'Mês inválido.');
  }
  query=`SELECT id,name,direction,amount_minor,currency,recurrence,due_date,end_date,project_id,tenant_id,product_id,tags,source,confidence,notes,active
   FROM finance_forecasts WHERE active=true AND due_date <= $2::date
   AND (end_date IS NULL OR end_date >= $1::date) ORDER BY due_date,name`;
  params=[rangeStart,rangeEnd];
  const rows=(await pool.query(query,params)).rows;
  const items=expandForecastRows(rows,rangeStart,rangeEnd);
  const totals=items.reduce((a,r)=>{const n=Number(r.amount_minor);a[r.direction]+=n;return a;},{income:0,expense:0});
  return reply(200,{month:month||year||from,items,totals,net:totals.income-totals.expense,execution:'projection_only'});
 },{body:false});

 router.post('/api/finance/forecasts', async ({body,client}) => {
  input(body,['name','direction','amount_minor','currency','recurrence','due_date','end_date','project_id','tenant_id','product_id','tags','source','confidence','notes']);
  if(!['income','expense'].includes(body.direction)||!Number.isInteger(body.amount_minor)||body.amount_minor<=0)throw fail(400,'Previsão inválida.');
  if(!['BRL','USD','EUR','GBP'].includes(body.currency)||!['once','monthly','quarterly','yearly'].includes(body.recurrence))throw fail(400,'Moeda ou recorrência inválida.');
  if(!validDate(body.due_date)||body.end_date!=null&&(!validDate(body.end_date)||body.end_date<body.due_date))throw fail(400,'Data inválida.');
  if(body.tags!=null&&(!Array.isArray(body.tags)||body.tags.some(tag=>typeof tag!=='string'||tag.length>48)))throw fail(400,'Tags inválidas.');
  await client.query(`INSERT INTO finance_forecasts(name,direction,amount_minor,currency,recurrence,due_date,end_date,project_id,tenant_id,product_id,tags,source,confidence,notes)
   VALUES($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14) RETURNING *`,[
    text(body.name,2,160),body.direction,body.amount_minor,body.currency,body.recurrence,body.due_date,body.end_date||null,body.project_id||null,body.tenant_id||null,body.product_id||null,JSON.stringify(body.tags||[]),body.source||'manual',body.confidence||'probable',body.notes==null?null:text(body.notes,0,1000)] );
  return {tenant:null,type:'finance_forecast.saved'};
 },{transactional:true,audit:false});
}
