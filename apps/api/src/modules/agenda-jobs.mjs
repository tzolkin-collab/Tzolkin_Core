import {notificarTopico} from './push.mjs';
import {gerarOcorrencias} from './agenda.mjs';
import {payloadLembrete,senderPadrao} from '../platform/webpush.mjs';
import {criarDetector} from '../platform/agenda-recursos.mjs';
import {hojeEmBrasilia} from '../platform/recorrencia.mjs';

// Trabalho de fundo da agenda, no mesmo processo do servidor:
//   1) a cada minuto, manda o push dos lembretes que venceram (uma vez só, por atividade e antecedência);
//   2) a cada 6 horas, estende as séries sem fim para sempre terem 13 meses de ocorrências à frente.
// Nada aqui derruba o servidor: erro vira linha de log e o próximo ciclo tenta de novo.

/** Lembrete que venceu há mais que isto (servidor parado, por exemplo) não é mais enviado: avisar "daqui a 15 min" 3 horas depois só atrapalha. */
export const JANELA_MIN=20;

// Cada (atividade, antecedência) cujo horário de aviso (início - antecedência) caiu na janela (agora - JANELA_MIN, agora].
// `agenda_reminders_sent` tem chave (atividade, minutos): o INSERT ... ON CONFLICT DO NOTHING só devolve a linha a quem a gravou primeiro,
// então, mesmo com dois servidores ou dois ciclos sobrepostos, cada aviso sai uma vez.
// Atividade sem lembretes próprios (NULL) usa o padrão da agenda; '{}' é "não avisar". Só atividade planejada e não arquivada.
const SQL_VENCIDOS=`
 WITH padrao AS (SELECT default_reminders AS m FROM agenda_preferences WHERE id),
 candidatas AS (
  SELECT a.id,a.title,a.starts_at,t.name AS empresa,x.min AS minutos
  FROM service_activities a
  JOIN tenants t ON t.id=a.tenant_id
  CROSS JOIN LATERAL unnest(COALESCE(a.reminders,(SELECT m FROM padrao),ARRAY[]::int[])) AS x(min)
  WHERE a.status='planned' AND a.archived_at IS NULL
   AND a.starts_at-(x.min*interval '1 minute')<=$1::timestamptz
   AND a.starts_at-(x.min*interval '1 minute')>$1::timestamptz-($2::int*interval '1 minute')
 ),
 novas AS (
  INSERT INTO agenda_reminders_sent(activity_id,minutes)
  SELECT id,minutos FROM candidatas
  ON CONFLICT DO NOTHING
  RETURNING activity_id,minutes
 )
 SELECT c.id,c.title,c.starts_at,c.empresa,c.minutos FROM candidatas c JOIN novas n ON n.activity_id=c.id AND n.minutes=c.minutos
 ORDER BY c.starts_at,c.minutos DESC`;

/** Envia os lembretes vencidos. Nunca lança. `enviar` nulo = push desligado (sem chaves VAPID): não faz nada. */
export async function enviarLembretes(pool,{enviar=senderPadrao(),detector=criarDetector(),agora=Date.now,notificar=notificarTopico,janelaMin=JANELA_MIN}={}){
 if(!enviar)return {desligado:true};
 const rec=await detector(pool);
 if(!rec.lembretes)return {indisponivel:true};
 const r=await pool.query(SQL_VENCIDOS,[new Date(agora()).toISOString(),janelaMin]);
 const saida={devidos:r.rows.length,enviados:0,falhas:0};
 for(const linha of r.rows){
  try{
   const payload=payloadLembrete({titulo:linha.title,empresa:linha.empresa,inicio:new Date(linha.starts_at).getTime(),minutos:linha.minutos,atividadeId:linha.id});
   const env=await notificar(pool,'agenda.lembrete',payload,enviar);
   saida.enviados+=env?.enviados??0;
   await pool.query('UPDATE agenda_reminders_sent SET devices=$3 WHERE activity_id=$1 AND minutes=$2',[linha.id,linha.minutos,env?.enviados??0]);
  }catch{saida.falhas++;}
 }
 return saida;
}

/** Gera as ocorrências que faltam das séries abertas (só as sem fim, ou com fim além do horizonte, têm o que gerar). Nunca lança. */
export async function estenderSeries(pool,{detector=criarDetector(),agora=Date.now}={}){
 const rec=await detector(pool);
 if(!rec.lembretes)return {indisponivel:true};
 const hoje=hojeEmBrasilia(agora());
 const {rows}=await pool.query(
  `SELECT s.id,s.tenant_id,s.engagement_id,s.category,s.kind,s.title,s.description,s.location,s.meeting_url,s.reminders,
     s.frequency,s.interval_n,s.weekdays,s.month_day,to_char(s.start_time,'HH24:MI') AS start_time,s.duration_minutes,
     s.starts_on::text AS starts_on,s.ends_on::text AS ends_on,s.count_limit,
     COALESCE((SELECT max(a.series_ordinal) FROM service_activities a WHERE a.series_id=s.id),-1) AS ultimo
   FROM service_activity_series s WHERE s.ended_at IS NULL ORDER BY s.created_at LIMIT 200`);
 const saida={series:rows.length,criadas:0,falhas:0};
 for(const serie of rows){
  const c=await pool.connect();
  try{
   await c.query('BEGIN');
   const g=await gerarOcorrencias(c,serie,{hoje,desdeOrdinal:Number(serie.ultimo)+1});
   if(g.criadas)await c.query('UPDATE service_activity_series SET generated_until=$2,updated_at=now() WHERE id=$1',[serie.id,g.ultimoDia]);
   await c.query('COMMIT');
   saida.criadas+=g.criadas;
  }catch{try{await c.query('ROLLBACK');}catch{/* conexão já caiu */}saida.falhas++;}
  finally{c.release();}
 }
 return saida;
}

/**
 * Liga os dois ciclos e devolve a função que os desliga. Os temporizadores não seguram o processo vivo (unref).
 * Um ciclo que ainda está rodando não é sobreposto pelo seguinte.
 */
export function iniciarJobsDaAgenda({pool,enviar=senderPadrao(),detector=criarDetector(),log=console,cadaMs=60000,seriesCadaMs=6*3600000,primeiraSerieEmMs=15000}={}){
 let ocupado=false,ocupadoSeries=false;
 const guardar=(nome,fn)=>async()=>{
  const flag=nome==='series'?'ocupadoSeries':'ocupado';
  if(flag==='ocupado'?ocupado:ocupadoSeries)return;
  if(flag==='ocupado')ocupado=true;else ocupadoSeries=true;
  try{
   const r=await fn();
   if(r?.enviados||r?.criadas)log.log(`[agenda] ${nome}: ${JSON.stringify(r)}`);
  }catch(erro){log.error(`[agenda] ${nome} falhou:`,erro?.message);}
  finally{if(flag==='ocupado')ocupado=false;else ocupadoSeries=false;}
 };
 const lembretes=guardar('lembretes',()=>enviarLembretes(pool,{enviar,detector}));
 const series=guardar('series',()=>estenderSeries(pool,{detector}));
 const t1=setInterval(lembretes,cadaMs);
 const t2=setInterval(series,seriesCadaMs);
 const t3=setTimeout(series,primeiraSerieEmMs);
 for(const t of [t1,t2,t3])t.unref?.();
 return ()=>{clearInterval(t1);clearInterval(t2);clearTimeout(t3);};
}
