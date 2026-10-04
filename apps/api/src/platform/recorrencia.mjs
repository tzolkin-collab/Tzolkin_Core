// Recorrência da agenda: de uma regra (semanal ou mensal) saem as datas das ocorrências. Conta pura, sem banco e sem relógio:
// quem chama diz qual é "hoje". Dias são 'AAAA-MM-DD' no horário de Brasília (UTC-3 fixo: o Brasil não tem horário de verão desde 2019).
//
// Regra:
//   { frequency: 'weekly',  interval_n, weekdays: [0..6] (0 = segunda), starts_on, ends_on?, count_limit? }
//   { frequency: 'monthly', interval_n, month_day: 1..31,               starts_on, ends_on?, count_limit? }
//
// Semanal: a cada `interval_n` semanas (contadas a partir da semana de `starts_on`, que começa na segunda), nos dias escolhidos.
// Mensal: a cada `interval_n` meses, no dia `month_day`; mês que não tem esse dia (31 em abril, 30 em fevereiro) usa o ÚLTIMO dia do mês.
// A primeira ocorrência nunca é anterior a `starts_on`. `count_limit` conta ocorrências desde o início da série, não da janela.

const DIA_MS = 86400000;

/** Gera até hoje + 400 dias (13 meses): série sem fim vive sempre 13 meses à frente, e o job diário a estende. */
export const HORIZONTE_DIAS = 400;
/** Teto de segurança por série (uma série semanal de 7 dias por 13 meses tem ~400 ocorrências). */
export const MAX_OCORRENCIAS = 400;

export const somarDias = (dia, n) => new Date(Date.parse(dia + 'T00:00:00Z') + n * DIA_MS).toISOString().slice(0, 10);
export const diaDaSemana = dia => (new Date(dia + 'T00:00:00Z').getUTCDay() + 6) % 7;   // 0 = segunda
const segundaDe = dia => somarDias(dia, -diaDaSemana(dia));
const ultimoDoMes = (ano, mes) => new Date(Date.UTC(ano, mes, 0)).getUTCDate();          // mes: 1..12
const pad = n => String(n).padStart(2, '0');

/** Dia de hoje em Brasília a partir de um instante (ms). */
export const hojeEmBrasilia = ms => new Date(ms - 3 * 3600000).toISOString().slice(0, 10);

/** Instante (ISO, UTC) do dia + horário 'HH:MM' de Brasília. */
export const instanteDe = (dia, hhmm) => new Date(`${dia}T${hhmm.slice(0, 5)}:00-03:00`).toISOString();

/** Todas as datas candidatas da regra, em ordem, sem aplicar fim nem limite. Gerador infinito: quem consome para. */
function* datas(regra) {
 const n = regra.interval_n || 1;
 if (regra.frequency === 'weekly') {
  const dias = [...new Set(regra.weekdays)].sort((a, b) => a - b);
  const base = segundaDe(regra.starts_on);
  for (let semana = 0; ; semana += n) {
   const segunda = somarDias(base, 7 * semana);
   for (const d of dias) { const dia = somarDias(segunda, d); if (dia >= regra.starts_on) yield dia; }
  }
 } else {
  const [ano0, mes0] = regra.starts_on.split('-').map(Number);
  for (let k = 0; ; k += n) {
   const total = (mes0 - 1) + k, ano = ano0 + Math.floor(total / 12), mes = (total % 12) + 1;
   const dia = `${ano}-${pad(mes)}-${pad(Math.min(regra.month_day, ultimoDoMes(ano, mes)))}`;
   if (dia >= regra.starts_on) yield dia;
  }
 }
}

/**
 * Ocorrências da regra até o horizonte (`hoje` + HORIZONTE_DIAS), no fim da série ou no limite de contagem, o que vier primeiro.
 * Devolve [{ ordinal, dia }] com `ordinal` 0, 1, 2…: é a posição da ocorrência na série e não muda ao estender o horizonte,
 * por isso gerar de novo (job, repetição do pedido) acha as mesmas linhas.
 */
export function ocorrencias(regra, hoje) {
 const horizonte = somarDias(hoje > regra.starts_on ? hoje : regra.starts_on, HORIZONTE_DIAS);
 const fim = regra.ends_on && regra.ends_on < horizonte ? regra.ends_on : horizonte;
 const teto = Math.min(regra.count_limit ?? Infinity, MAX_OCORRENCIAS);
 const saida = [];
 for (const dia of datas(regra)) {
  if (dia > fim || saida.length >= teto) break;
  saida.push({ ordinal: saida.length, dia });
 }
 return saida;
}

const NOMES = ['segunda', 'terça', 'quarta', 'quinta', 'sexta', 'sábado', 'domingo'];
/** Texto para a tela: "Toda segunda e quarta", "Todo sábado", "A cada 2 semanas: sexta", "Todo mês, no dia 15, até 31/12/2026". */
export function descrever(regra) {
 const n = regra.interval_n || 1;
 let base;
 if (regra.frequency === 'weekly') {
  const dias = [...new Set(regra.weekdays)].sort((a, b) => a - b);
  const nomes = dias.map(d => NOMES[d]);
  const lista = nomes.length > 1 ? nomes.slice(0, -1).join(', ') + ' e ' + nomes.at(-1) : nomes[0];
  // "Todo sábado/domingo" (masculino); os demais dias são femininos ("Toda segunda").
  const artigo = dias.every(d => d >= 5) ? 'Todo' : 'Toda';
  base = n === 1 ? `${artigo} ${lista}` : `A cada ${n} semanas: ${lista}`;
 } else {
  base = n === 1 ? `Todo mês, no dia ${regra.month_day}` : `A cada ${n} meses, no dia ${regra.month_day}`;
 }
 if (regra.count_limit) base += `, ${regra.count_limit} vez${regra.count_limit === 1 ? '' : 'es'}`;
 else if (regra.ends_on) base += `, até ${regra.ends_on.split('-').reverse().join('/')}`;
 return base;
}
