import { fail, input, onlyParams, text } from '../platform/http.mjs';

const validMonth = value => /^20\d{2}-(0[1-9]|1[0-2])$/.test(value);
const project = row => ({...row, amount_minor:Number(row.amount_minor), tags:Array.isArray(row.tags)?row.tags:[]});

export function financeForecastRoutes(router) {
 router.get('/api/finance/forecasts', async ({url,pool,reply}) => {
  onlyParams(url.searchParams,['month']);
  const month=url.searchParams.get('month'); if(!validMonth(month)) throw fail(400,'Mês inválido.');
  const rows=(await pool.query(`SELECT id,name,direction,amount_minor,currency,recurrence,due_date,end_date,project_id,tenant_id,product_id,tags,source,confidence,notes,active
    FROM finance_forecasts WHERE active=true AND due_date < (date_trunc('month',$1::date) + interval '1 month')::date
    AND (end_date IS NULL OR end_date >= date_trunc('month',$1::date)::date) ORDER BY due_date,name`,[month+'-01'])).rows;
  const totals=rows.reduce((a,r)=>{const n=Number(r.amount_minor);a[r.direction]+=n;return a;},{income:0,expense:0});
  return reply(200,{month,items:rows.map(project),totals,net:totals.income-totals.expense,execution:'projection_only'});
 },{body:false});

 router.post('/api/finance/forecasts', async ({body,client}) => {
  input(body,['name','direction','amount_minor','currency','recurrence','due_date','end_date','project_id','tenant_id','product_id','tags','source','confidence','notes']);
  if(!['income','expense'].includes(body.direction)||!Number.isInteger(body.amount_minor)||body.amount_minor<=0)throw fail(400,'Previsão inválida.');
  if(!['BRL','USD','EUR','GBP'].includes(body.currency)||!['once','monthly','quarterly','yearly'].includes(body.recurrence))throw fail(400,'Moeda ou recorrência inválida.');
  if(typeof body.due_date!=='string'||!/^20\d{2}-\d{2}-\d{2}$/.test(body.due_date))throw fail(400,'Data inválida.');
  if(body.tags!=null&&(!Array.isArray(body.tags)||body.tags.some(tag=>typeof tag!=='string'||tag.length>48)))throw fail(400,'Tags inválidas.');
  await client.query(`INSERT INTO finance_forecasts(name,direction,amount_minor,currency,recurrence,due_date,end_date,project_id,tenant_id,product_id,tags,source,confidence,notes)
   VALUES($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14) RETURNING *`,[
    text(body.name,2,160),body.direction,body.amount_minor,body.currency,body.recurrence,body.due_date,body.end_date||null,body.project_id||null,body.tenant_id||null,body.product_id||null,JSON.stringify(body.tags||[]),body.source||'manual',body.confidence||'probable',body.notes==null?null:text(body.notes,0,1000)] );
  return {tenant:null,type:'finance_forecast.saved'};
 },{transactional:true,audit:false});
}
