import {json,isUuid,fail} from '../platform/http.mjs';
import {serieInput,serieUpdateInput,serieEncerrarInput,preferenciasInput} from '../platform/tracking-model.mjs';
import {criarDetector,MENSAGEM_048} from '../platform/agenda-recursos.mjs';
import {ocorrencias,hojeEmBrasilia,instanteDe} from '../platform/recorrencia.mjs';

// Agenda: preferências (lembrete padrão) e atividades recorrentes (séries). Tudo depende da migração 048; sem ela, 409 com mensagem clara.
// Admin interno apenas, como /api/tracking.
const PADRAO_DE_FABRICA=Object.freeze([15]);
const FUSO="'America/Sao_Paulo'";

/**
 * Cria as ocorrências que faltam de uma série, da posição `desdeOrdinal` em diante. Idempotente: a posição (series_id, series_ordinal)
 * é única, então rodar duas vezes (o job, ou o mesmo pedido repetido) não duplica. Devolve quantas linhas entraram e o último dia gerado.
 * `serie` precisa de: id, tenant_id, engagement_id, category, kind, title, description, location, meeting_url, reminders,
 * start_time ('HH:MM'), duration_minutes e a regra (frequency, interval_n, weekdays, month_day, starts_on, ends_on, count_limit).
 */
export async function gerarOcorrencias(c,serie,{hoje,desdeOrdinal=0}){
 const lista=ocorrencias(serie,hoje).filter(o=>o.ordinal>=desdeOrdinal);
 if(!lista.length)return {criadas:0,ultimoDia:null};
 const inicios=lista.map(o=>instanteDe(o.dia,serie.start_time));
 const fins=inicios.map(i=>new Date(Date.parse(i)+serie.duration_minutes*60000).toISOString());
 const r=await c.query(
  `INSERT INTO service_activities(id,tenant_id,engagement_id,category,kind,title,description,location,meeting_url,reminders,starts_at,ends_at,series_id,series_ordinal)
   SELECT gen_random_uuid(),$1,$2,$3,$4,$5,$6,$7,$8,$9::int[],o.inicio,o.fim,$10,o.ordinal
   FROM unnest($11::timestamptz[],$12::timestamptz[],$13::int[]) AS o(inicio,fim,ordinal)
   ON CONFLICT DO NOTHING RETURNING id`,
  [serie.tenant_id,serie.engagement_id??null,serie.category,serie.kind,serie.title,serie.description??null,serie.location??null,serie.meeting_url??null,serie.reminders??null,serie.id,inicios,fins,lista.map(o=>o.ordinal)]);
 return {criadas:r.rowCount??r.rows.length,ultimoDia:lista.at(-1).dia};
}

export function agendaRoutes(router,{detector=criarDetector(),relogio=Date.now}={}){
 async function transaction(pool,fn){const c=await pool.connect();try{await c.query('BEGIN');const result=await fn(c);await c.query('COMMIT');return result;}catch(e){await c.query('ROLLBACK');throw e;}finally{c.release();}}
 const ator=operator=>operator?.email||operator?.subject||'unknown';
 const auditoria=(c,id,acao,detalhes,operator)=>c.query('INSERT INTO service_activity_series_audit(series_id,action,actor,details) VALUES($1,$2,$3,$4)',[id,acao,ator(operator),detalhes]);
 const exigir048=async db=>{if(!(await detector(db)).lembretes)throw fail(409,MENSAGEM_048);};

 // ---------- preferências: o lembrete que vale para toda atividade que não escolheu o seu ----------
 router.get('/api/agenda/preferencias',async({pool,reply})=>{
  const rec=await detector(pool);
  if(!rec.lembretes)return reply(200,{disponivel:false,default_reminders:[...PADRAO_DE_FABRICA],revision:1});
  const r=(await pool.query('SELECT default_reminders,revision FROM agenda_preferences WHERE id')).rows[0];
  reply(200,{disponivel:true,default_reminders:r?.default_reminders??[...PADRAO_DE_FABRICA],revision:r?.revision??1});
 });
 router.put('/api/agenda/preferencias',async({pool,req,reply,operator})=>{
  const b=preferenciasInput(await json(req));
  const r=await transaction(pool,async c=>{
   await exigir048(c);
   const linha=(await c.query('UPDATE agenda_preferences SET default_reminders=$1,revision=revision+1,updated_at=now(),updated_by=$2 WHERE id AND revision=$3 RETURNING default_reminders,revision',[b.default_reminders,ator(operator),b.revision])).rows[0];
   if(!linha)throw fail(409,'As preferências foram alteradas por outra pessoa. Atualize a página.');
   return linha;
  });
  reply(200,{disponivel:true,default_reminders:r.default_reminders,revision:r.revision});
 });

 // ---------- séries ----------
 // Cria a série e já gera as ocorrências (até 13 meses à frente, ou até o fim/limite que a regra tiver).
 router.post('/api/tracking/series',async({pool,req,reply,operator})=>{
  const b=serieInput(await json(req));
  const hoje=hojeEmBrasilia(relogio());
  const out=await transaction(pool,async c=>{
   await exigir048(c);
   if(b.engagement_id){
    const e=(await c.query('SELECT tenant_id,archived_at FROM client_engagements WHERE id=$1',[b.engagement_id])).rows[0];
    if(!e||e.tenant_id!==b.tenant_id||e.archived_at)throw fail(400,'A contratação não é desta empresa ou está arquivada.');
   }
   const colunas=Object.keys(b);
   const criada=(await c.query(`INSERT INTO service_activity_series(${colunas.join(',')}) VALUES(${colunas.map((_,i)=>'$'+(i+1)).join(',')}) ON CONFLICT(id) DO NOTHING RETURNING *`,Object.values(b))).rows[0];
   if(!criada){
    // Mesmo pedido repetido (a tela reenviou) devolve a série que já existe; o mesmo id com outro conteúdo é conflito.
    const existente=(await c.query('SELECT * FROM service_activity_series WHERE id=$1',[b.id])).rows[0];
    if(!existente||existente.tenant_id!==b.tenant_id||existente.title!==b.title||existente.frequency!==b.frequency)throw fail(409,'Identificador já usado em outra série.');
    return {series:existente,criadas:0,repetido:true};
   }
   const g=await gerarOcorrencias(c,b,{hoje});
   if(!g.criadas)throw fail(400,'Essa repetição não gera nenhuma data no período. Confira o início, o fim e os dias escolhidos.');
   const final=(await c.query('UPDATE service_activity_series SET generated_until=$2 WHERE id=$1 RETURNING *',[b.id,g.ultimoDia])).rows[0];
   await auditoria(c,b.id,'created',{...b,criadas:g.criadas},operator);
   return {series:final,criadas:g.criadas,repetido:false};
  });
  reply(200,out);
 });

 // Altera o que as PRÓXIMAS ocorrências herdam: título, categoria, tipo, descrição, local, link, horário, duração e lembretes.
 // Só mexe nas futuras, ainda planejadas e que ninguém alterou à mão (series_detached). A regra (dias, frequência) não muda aqui:
 // para mudar o padrão, encerra-se a série e cria-se outra.
 router.put('/api/tracking/series/:id',async({pool,params,req,reply,operator})=>{
  if(!isUuid(params.id))throw fail(400,'Série inválida.');
  const {revision,campos}=serieUpdateInput(await json(req));
  const agora=new Date(relogio()).toISOString();
  const out=await transaction(pool,async c=>{
   await exigir048(c);
   const nomes=Object.keys(campos);
   const serie=(await c.query(`UPDATE service_activity_series SET ${nomes.map((n,i)=>n+'=$'+(i+3)).join(',')},revision=revision+1,updated_at=now() WHERE id=$1 AND revision=$2 AND ended_at IS NULL RETURNING *,to_char(start_time,'HH24:MI') AS hhmm`,[params.id,revision,...nomes.map(n=>campos[n])])).rows[0];
   if(!serie)throw fail(409,'A série foi alterada, encerrada ou não existe. Atualize a agenda.');
   // $1 = série, $2 = agora; o resto entra na ordem em que for sendo preciso.
   const p=[params.id,agora],sets=[];
   const param=v=>{p.push(v);return '$'+p.length;};
   for(const n of nomes)if(!['start_time','duration_minutes'].includes(n))sets.push(`${n}=${param(campos[n])}`);
   // Horário e duração: cada ocorrência mantém o SEU dia e troca só a hora; o fim acompanha a duração.
   if('start_time' in campos||'duration_minutes' in campos){
    const inicio=`((a.starts_at AT TIME ZONE ${FUSO})::date + ${param(serie.hhmm)}::time) AT TIME ZONE ${FUSO}`;
    sets.push(`starts_at=${inicio}`,`ends_at=(${inicio}) + (${param(serie.duration_minutes)}::int * interval '1 minute')`);
   }
   const r=await c.query(
    `UPDATE service_activities a SET ${sets.join(',')}${sets.length?',':''}revision=a.revision+1,updated_at=now()
      WHERE a.series_id=$1 AND a.status='planned' AND a.series_detached=false AND a.archived_at IS NULL AND a.starts_at>=$2::timestamptz
      RETURNING a.id`,p);
   const atualizadas=r.rowCount??r.rows.length;
   await auditoria(c,params.id,'updated',{revision,campos,atualizadas},operator);
   return {series:serie,atualizadas};
  });
  reply(200,out);
 });

 // Encerra a série: não gera mais ocorrências e arquiva as futuras que ainda estão planejadas (a role do Core não apaga linha).
 // O passado fica como está. `from` (opcional) encerra "a partir deste evento" em vez de "a partir de agora".
 router.post('/api/tracking/series/:id/end',async({pool,params,req,reply,operator})=>{
  if(!isUuid(params.id))throw fail(400,'Série inválida.');
  const {revision,from}=serieEncerrarInput(await json(req));
  const corte=from??new Date(relogio()).toISOString();
  const out=await transaction(pool,async c=>{
   await exigir048(c);
   const serie=(await c.query('UPDATE service_activity_series SET ended_at=now(),revision=revision+1,updated_at=now() WHERE id=$1 AND revision=$2 AND ended_at IS NULL RETURNING *',[params.id,revision])).rows[0];
   if(!serie)throw fail(409,'A série foi alterada, já foi encerrada ou não existe. Atualize a agenda.');
   const r=await c.query(
    `UPDATE service_activities SET archived_at=now(),revision=revision+1,updated_at=now()
      WHERE series_id=$1 AND status='planned' AND archived_at IS NULL AND starts_at>=$2::timestamptz RETURNING id`,[params.id,corte]);
   const arquivadas=r.rowCount??r.rows.length;
   await auditoria(c,params.id,'ended',{revision,from:corte,arquivadas},operator);
   return {series:serie,arquivadas};
  });
  reply(200,out);
 });
}
