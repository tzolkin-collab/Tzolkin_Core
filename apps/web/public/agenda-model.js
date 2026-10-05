// Agenda: tudo o que é conta (datas em Brasília, janelas de consulta, posição e sobreposição dos eventos) fica aqui,
// sem tocar na página, para ser testado isoladamente (test/unit/agenda-model.test.mjs). agenda.js só desenha.
//
// Dias são textos 'AAAA-MM-DD' no horário de Brasília; instantes são milissegundos. Semana começa na segunda (como o resto do Core).
// UTC-3 fixo: o Brasil não tem horário de verão desde 2019, e o servidor também grava/consulta em America/Sao_Paulo.

export const FUSO = 'America/Sao_Paulo';
const OFFSET = -3 * 3600000;
export const DIA_MS = 86400000;
const pad = n => String(n).padStart(2, '0');

export const CATEGORIAS = ['mentoria', 'consultoria', 'software', 'educacional', 'outro'];
// Cor = categoria, usando os tons de selo (que existem nos dois temas). Só o neutro fica para "outro".
export const TOM_DA_CATEGORIA = Object.freeze({ mentoria: 'accent', consultoria: 'info', software: 'success', educacional: 'warning', outro: 'neutral' });
export const ROTULOS = Object.freeze({
 mentoria: 'Mentoria', consultoria: 'Consultoria', software: 'Software', educacional: 'Educacional', outro: 'Outro',
 sessao: 'Sessão', entregavel: 'Entregável', feature: 'Feature', tarefa: 'Tarefa',
 planned: 'Planejado', done: 'Concluído', cancelled: 'Cancelado',
});
export const VISOES = ['dia', 'semana', 'mes', 'agenda'];
export const ROTULO_DA_VISAO = Object.freeze({ dia: 'Dia', semana: 'Semana', mes: 'Mês', agenda: 'Agenda' });

// ---------- datas ----------
export const partes = ms => { const d = new Date(ms + OFFSET); return { ano: d.getUTCFullYear(), mes: d.getUTCMonth() + 1, dia: d.getUTCDate(), hora: d.getUTCHours(), min: d.getUTCMinutes(), sem: (d.getUTCDay() + 6) % 7 }; };
export const diaDe = ms => { const p = partes(ms); return `${p.ano}-${pad(p.mes)}-${pad(p.dia)}`; };
export const inicioDoDia = dia => Date.parse(dia + 'T00:00:00Z') - OFFSET;
export const somarDias = (dia, n) => new Date(Date.parse(dia + 'T00:00:00Z') + n * DIA_MS).toISOString().slice(0, 10);
export const diaDaSemana = dia => (new Date(dia + 'T00:00:00Z').getUTCDay() + 6) % 7;       // 0 = segunda
export const segundaDe = dia => somarDias(dia, -diaDaSemana(dia));
export const semanaDe = dia => Array.from({ length: 7 }, (_, i) => somarDias(segundaDe(dia), i));
export const primeiroDoMes = dia => dia.slice(0, 8) + '01';
export const ultimoDoMes = dia => { const [a, m] = dia.split('-').map(Number); return new Date(Date.UTC(a, m, 0)).toISOString().slice(0, 10); };
export const mesmoMes = (a, b) => a.slice(0, 7) === b.slice(0, 7);
export const diaValido = v => typeof v === 'string' && /^\d{4}-\d{2}-\d{2}$/.test(v) && Number.isFinite(Date.parse(v)) && new Date(v + 'T00:00:00Z').toISOString().slice(0, 10) === v;
/** Semanas completas (segunda a domingo) que cobrem o mês: é a grade da visão Mês e do mini-calendário. */
export function gradeDoMes(dia) {
 const ini = segundaDe(primeiroDoMes(dia)), fim = somarDias(segundaDe(ultimoDoMes(dia)), 7), semanas = [];
 for (let d = ini; d < fim; d = somarDias(d, 7)) semanas.push(Array.from({ length: 7 }, (_, i) => somarDias(d, i)));
 return semanas;
}

// ---------- visões ----------
/** Janela de consulta da visão: `from` inclusivo, `to` exclusivo (o que /api/tracking?from=&to= espera; máximo 62 dias). */
/** Dias de a até b, inclusive (b antes de a troca de lugar). */
export function intervalo(a, b) { if (b < a) [a, b] = [b, a]; const r = []; for (let d = a; d <= b && r.length < 366; d = somarDias(d, 1)) r.push(d); return r; }
/** Período livre escolhido no mini-calendário: de `dia` até `fim` (inclusive). Até 7 dias vira grade; mais que isso, lista. */
export const MAX_PERIODO = 62;
export function janela(visao, dia, ate = dia) {
 if (visao === 'periodo') return { from: dia, to: somarDias(ate, 1) };
 if (visao === 'dia') return { from: dia, to: somarDias(dia, 1) };
 if (visao === 'semana') { const seg = segundaDe(dia); return { from: seg, to: somarDias(seg, 7) }; }
 if (visao === 'agenda') return { from: dia, to: somarDias(dia, 31) };
 const g = gradeDoMes(dia); return { from: g[0][0], to: somarDias(g[g.length - 1][6], 1) };
}
/** Dia que vira o foco ao andar para trás/frente na visão. No mês mantém o dia, ajustado ao tamanho do mês de chegada. */
export function navegar(visao, dia, sentido) {
 if (visao === 'dia') return somarDias(dia, sentido);
 if (visao === 'semana') return somarDias(dia, 7 * sentido);
 if (visao === 'agenda') return somarDias(dia, 30 * sentido);
 const [a, m, d] = dia.split('-').map(Number), alvo = new Date(Date.UTC(a, m - 1 + sentido, 1)), ult = new Date(Date.UTC(alvo.getUTCFullYear(), alvo.getUTCMonth() + 1, 0)).getUTCDate();
 return `${alvo.getUTCFullYear()}-${pad(alvo.getUTCMonth() + 1)}-${pad(Math.min(d, ult))}`;
}
const fmt = (opcoes, dia) => new Intl.DateTimeFormat('pt-BR', { timeZone: 'UTC', ...opcoes }).format(new Date(dia + 'T12:00:00Z'));
export function titulo(visao, dia, ate = dia) {
 if (visao === 'periodo') return `${fmt({ day: 'numeric', month: 'short' }, dia)} – ${fmt({ day: 'numeric', month: 'short', year: 'numeric' }, ate)}`;
 if (visao === 'dia') return fmt({ weekday: 'long', day: 'numeric', month: 'long', year: 'numeric' }, dia);
 if (visao === 'mes') return fmt({ month: 'long', year: 'numeric' }, dia);
 const j = janela(visao, dia), ini = j.from, fim = somarDias(j.to, -1);
 if (visao === 'agenda') return `${fmt({ day: 'numeric', month: 'short' }, ini)} – ${fmt({ day: 'numeric', month: 'short', year: 'numeric' }, fim)}`;
 if (mesmoMes(ini, fim)) return `${fmt({ day: 'numeric' }, ini)} – ${fmt({ day: 'numeric', month: 'long', year: 'numeric' }, fim)}`;
 if (ini.slice(0, 4) === fim.slice(0, 4)) return `${fmt({ day: 'numeric', month: 'short' }, ini)} – ${fmt({ day: 'numeric', month: 'short', year: 'numeric' }, fim)}`;
 return `${fmt({ day: 'numeric', month: 'short', year: 'numeric' }, ini)} – ${fmt({ day: 'numeric', month: 'short', year: 'numeric' }, fim)}`;
}
export const nomeDoDia = (dia, estilo = 'short') => fmt({ weekday: estilo }, dia).replace('.', '');
export const numeroDoDia = dia => Number(dia.slice(8));

// ---------- horas ----------
export const hora = ms => { const p = partes(ms); return `${pad(p.hora)}:${pad(p.min)}`; };
export const minutosDoDia = ms => { const p = partes(ms); return p.hora * 60 + p.min; };
export const rotuloDaHora = h => `${pad(h)}:00`;
export const duracaoTexto = min => { const h = Math.floor(min / 60), m = Math.round(min % 60); return h && m ? `${h} h ${m} min` : h ? `${h} h` : `${m} min`; };
export const intervaloTexto = (ini, fim) => {
 const d1 = diaDe(ini), d2 = diaDe(fim);
 return d1 === d2 ? `${hora(ini)} – ${hora(fim)}` : `${fmt({ day: 'numeric', month: 'short' }, d1)} ${hora(ini)} – ${fmt({ day: 'numeric', month: 'short' }, d2)} ${hora(fim)}`;
};
export const arredondar = (min, passo) => Math.round(min / passo) * passo;
/** Valor de <input type="datetime-local"> (horário de Brasília) para o instante. */
export const paraCampoLocal = ms => { const p = partes(ms); return `${p.ano}-${pad(p.mes)}-${pad(p.dia)}T${pad(p.hora)}:${pad(p.min)}`; };
/** Instante ISO do valor de <input type="datetime-local"> interpretado em Brasília; null se vazio ou inválido. */
export const doCampoLocal = v => {
 if (typeof v !== 'string' || !/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}$/.test(v)) return null;
 // Date.parse aceita "30 de fevereiro" e rola para março: o dia e a hora são conferidos antes, senão o evento cai no dia errado.
 const h = Number(v.slice(11, 13)), m = Number(v.slice(14, 16));
 if (!diaValido(v.slice(0, 10)) || h > 23 || m > 59) return null;
 const t = Date.parse(v + ':00-03:00');
 return Number.isFinite(t) ? new Date(t).toISOString() : null;
};

// ---------- eventos ----------
/** Evento da API -> o que a agenda usa (instantes em ms). */
export const normalizar = a => ({ ...a, ini: Date.parse(a.starts_at), fim: Date.parse(a.ends_at) });
/** Dura um dia ou mais: vai na faixa "dia inteiro" em vez de ocupar a grade de horas. */
export const diaInteiro = e => e.fim - e.ini >= DIA_MS;
/** Parte do evento que cai no dia, em minutos desde 00:00 (0..1440); null se não toca o dia. */
export function recorteDoDia(e, dia) {
 const d0 = inicioDoDia(dia), d1 = d0 + DIA_MS;
 if (e.fim <= d0 || e.ini >= d1) return null;
 return { ini: Math.round((Math.max(e.ini, d0) - d0) / 60000), fim: Math.round((Math.min(e.fim, d1) - d0) / 60000) };
}
/** Eventos que tocam o dia, de dia inteiro primeiro e depois por horário. */
export function eventosDoDia(eventos, dia) {
 return eventos.filter(e => recorteDoDia(e, dia)).sort((a, b) => Number(diaInteiro(b)) - Number(diaInteiro(a)) || a.ini - b.ini || b.fim - a.fim || String(a.id).localeCompare(String(b.id)));
}
/**
 * Sobreposição estilo Google. Quem não se toca usa a largura inteira. Quem se toca:
 *  - dois eventos que começam em horas diferentes (30 min ou mais) ficam em CASCATA: o de baixo recua e fica por cima,
 *    então o título de cada um continua legível (dividir uma coluna estreita ao meio deixava os dois ilegíveis);
 *  - três ou mais, ou dois que começam juntos, dividem a largura em colunas iguais (um não pode esconder o outro).
 * itens: [{id, ini, fim}] em minutos. `minimo` é a duração visual mínima (evento de 10 min ocupa 30 na grade).
 * Devolve Map id -> { col, cols, cascata, ordem } (`ordem` = posição por horário de início, para empilhar: o que começa depois fica por cima).
 */
export function layoutColunas(itens, minimo = 30) {
 const fimVisual = i => Math.max(i.fim, i.ini + minimo);
 const ordem = [...itens].sort((a, b) => a.ini - b.ini || fimVisual(b) - fimVisual(a) || String(a.id).localeCompare(String(b.id)));
 const saida = new Map();
 let grupo = [], colunasFim = [], fimGrupo = -Infinity, ordemGlobal = 0;
 const fechar = () => {
  const cols = colunasFim.length, inis = grupo.map(g => g.ini);
  const cascata = cols === 2 && Math.max(...inis) - Math.min(...inis) >= 30;
  for (const g of grupo) saida.set(g.id, { col: g.col, cols, cascata, ordem: g.ordem });
  grupo = []; colunasFim = []; fimGrupo = -Infinity;
 };
 for (const item of ordem) {
  if (grupo.length && item.ini >= fimGrupo) fechar();
  let col = colunasFim.findIndex(f => f <= item.ini);
  if (col < 0) { col = colunasFim.length; colunasFim.push(0); }
  colunasFim[col] = fimVisual(item);
  fimGrupo = Math.max(fimGrupo, fimVisual(item));
  grupo.push({ id: item.id, col, ini: item.ini, ordem: ordemGlobal++ });
 }
 fechar();
 return saida;
}
/** Passo do recuo da cascata, em % da coluna do dia. */
export const RECUO_CASCATA = 20;
/** Retângulo do evento na grade do dia: topo e altura em px, faixa horizontal em % da coluna do dia e camada (z) para empilhar. */
export function retangulo(recorte, lay, alturaHora, minimo = 30) {
 const { col = 0, cols = 1, cascata = false, ordem = 0 } = lay || {};
 const esquerda = cascata ? col * RECUO_CASCATA : col / cols * 100;
 return {
  topo: recorte.ini / 60 * alturaHora,
  altura: Math.max(recorte.fim - recorte.ini, minimo) / 60 * alturaHora,
  esquerda,
  largura: cascata ? 100 - esquerda : 100 / cols,
  z: ordem + 1,
 };
}
/** Novo horário ao mover: mantém a duração, desloca `deltaMin` (já arredondado ao passo pela tela). */
export const mover = (e, deltaMin) => ({ starts_at: new Date(e.ini + deltaMin * 60000).toISOString(), ends_at: new Date(e.fim + deltaMin * 60000).toISOString() });
/** Novo horário ao esticar o fim até o instante `novoFim` (ms): nunca menos que `minimo` minutos de duração, nunca mais de um ano. */
export function redimensionar(e, novoFim, minimo = 15) {
 const fim = Math.min(Math.max(novoFim, e.ini + minimo * 60000), e.ini + 365 * DIA_MS);
 return { starts_at: new Date(e.ini).toISOString(), ends_at: new Date(fim).toISOString() };
}
const semAcento = s => String(s || '').normalize('NFD').replace(/[\u0300-\u036f]/g, '').toLocaleLowerCase('pt-BR');
/** Filtros da barra lateral e da busca. `categorias` é um Set com as visíveis (vazio ou ausente = todas). */
export function filtrar(eventos, { texto = '', categorias = null, status = '', tenant = '' } = {}) {
 const q = semAcento(texto).trim();
 return eventos.filter(e =>
  (!categorias || !categorias.size || categorias.has(e.category)) &&
  (!status || e.status === status) &&
  (!tenant || e.tenant_id === tenant) &&
  (!q || semAcento([e.title, e.tenant_name, e.engagement_label, e.location, ROTULOS[e.category], ROTULOS[e.kind]].join(' ')).includes(q)));
}
/** Dias da janela que têm evento, com os eventos de cada um (visão Agenda). */
export function agruparPorDia(eventos, de, ate) {
 const grupos = [];
 for (let d = de; d < ate; d = somarDias(d, 1)) { const doDia = eventosDoDia(eventos, d); if (doDia.length) grupos.push({ dia: d, eventos: doDia }); }
 return grupos;
}

// ---------- lembretes ----------
/** O que a tela oferece (minutos antes do início). O banco aceita mais (10 min, 2 dias, 1 semana), mas estas bastam para a tela. */
export const OPCOES_DE_LEMBRETE = Object.freeze([[0, 'Na hora'], [5, '5 minutos antes'], [15, '15 minutos antes'], [30, '30 minutos antes'], [60, '1 hora antes'], [120, '2 horas antes'], [1440, '1 dia antes']]);
export const MAX_LEMBRETES = 3;
const curto = m => (m === 0 ? 'na hora' : m < 60 ? `${m} min` : m < 1440 ? `${m / 60} h` : `${m / 1440} dia${m > 1440 ? 's' : ''}`);
/** [60, 15] -> "1 h e 15 min antes"; [0] -> "Na hora"; [30, 0] -> "30 min antes e na hora"; [] -> "Não avisar". */
export function textoDosLembretes(minutos) {
 if (!minutos?.length) return 'Não avisar';
 const ordem = [...new Set(minutos)].sort((a, b) => b - a);
 const antes = ordem.filter(m => m > 0).map(curto), naHora = ordem.includes(0);
 if (!antes.length) return 'Na hora';
 const lista = antes.length > 1 ? antes.slice(0, -1).join(', ') + ' e ' + antes.at(-1) : antes[0];
 return `${lista} antes${naHora ? ' e na hora' : ''}`;
}
/** Quais lembretes valem para a atividade: os dela, ou o padrão da agenda quando ela não escolheu (reminders nulo). */
export const lembreteEfetivo = (evento, padrao) => (evento.reminders == null ? { origem: 'padrao', minutos: padrao ?? [] } : { origem: 'proprio', minutos: evento.reminders });

// ---------- repetição ----------
const NOMES_DOS_DIAS = ['segunda', 'terça', 'quarta', 'quinta', 'sexta', 'sábado', 'domingo'];
export const DIAS_CURTOS = Object.freeze(['Seg', 'Ter', 'Qua', 'Qui', 'Sex', 'Sáb', 'Dom']);
/** Mesmo texto que o servidor devolve em `series[].descricao` (platform/recorrencia.mjs `descrever`); um teste garante que são iguais. */
export function descreverRecorrencia(regra) {
 const n = regra.interval_n || 1;
 let base;
 if (regra.frequency === 'weekly') {
  const dias = [...new Set(regra.weekdays)].sort((a, b) => a - b), nomes = dias.map(d => NOMES_DOS_DIAS[d]);
  const lista = nomes.length > 1 ? nomes.slice(0, -1).join(', ') + ' e ' + nomes.at(-1) : nomes[0];
  const artigo = dias.every(d => d >= 5) ? 'Todo' : 'Toda';
  base = n === 1 ? `${artigo} ${lista}` : `A cada ${n} semanas: ${lista}`;
 } else {
  base = n === 1 ? `Todo mês, no dia ${regra.month_day}` : `A cada ${n} meses, no dia ${regra.month_day}`;
 }
 if (regra.count_limit) base += `, ${regra.count_limit} vez${regra.count_limit === 1 ? '' : 'es'}`;
 else if (regra.ends_on) base += `, até ${regra.ends_on.split('-').reverse().join('/')}`;
 return base;
}
/** Dia da semana (0 = segunda) e dia do mês de um instante em Brasília: a repetição começa com os do evento. */
export const diaDaSemanaDe = ms => diaDaSemana(diaDe(ms));
export const diaDoMesDe = ms => numeroDoDia(diaDe(ms));
