// Agenda: os dois blocos do formulário que dependem da migração 048 — "Lembrete" e "Repetir".
// Cada um devolve um objeto com `valor()` e o nó pronto para entrar no formulário; quem monta o formulário decide o que mandar à API.
import { el, campo } from './agenda-dom.js';
import * as M from './agenda-model.js';

/** Caixas de marcar com os tempos de lembrete (no máximo MAX_LEMBRETES). `aoMudar(minutos)` recebe a lista da maior para a menor antecedência. */
export function caixaDeLembretes(selecionados, aoMudar) {
 const grade = el('div', null, 'config-lembretes');
 const marcados = new Set(selecionados);
 const checks = [];
 const atualizar = () => {
  for (const c of checks) c.disabled = !c.checked && marcados.size >= M.MAX_LEMBRETES;
 };
 for (const [min, rotulo] of M.OPCOES_DE_LEMBRETE) {
  const l = el('label', null, 'config-chip');
  const c = document.createElement('input');
  c.type = 'checkbox'; c.value = String(min); c.checked = marcados.has(min);
  c.onchange = () => { c.checked ? marcados.add(min) : marcados.delete(min); atualizar(); aoMudar([...marcados].sort((a, b) => b - a)); };
  checks.push(c);
  l.append(c, el('span', rotulo));
  grade.append(l);
 }
 atualizar();
 return grade;
}

/**
 * Lembrete da atividade. Três escolhas: o padrão da agenda, não avisar, ou tempos próprios (até 3).
 * `valor()` -> null (padrão) | [] (não avisar) | [minutos…] (próprios, da maior para a menor antecedência).
 * `atual`: o que a atividade tem hoje (null/undefined = padrão).
 */
export function blocoDeLembrete({ padrao, atual = null }) {
 const bloco = el('fieldset', null, 'ag-bloco ag-lembrete');
 bloco.append(el('legend', 'Lembrete'));
 const modo = campo(bloco, 'Avisar', 'text', [
  ['padrao', `Padrão da agenda (${M.textoDosLembretes(padrao).toLowerCase()})`],
  ['nenhum', 'Não avisar'],
  ['proprio', 'Personalizado'],
 ]);
 let proprios = atual && atual.length ? [...atual] : [15];
 const caixa = el('div', null, 'ag-lembrete-caixa');
 const redesenhar = () => {
  caixa.replaceChildren();
  caixa.hidden = modo.value !== 'proprio';
  if (modo.value === 'proprio') caixa.append(caixaDeLembretes(proprios, m => { proprios = m; }));
 };
 modo.value = atual == null ? 'padrao' : atual.length ? 'proprio' : 'nenhum';
 modo.addEventListener('change', () => { if (modo.value === 'proprio' && !proprios.length) proprios = [15]; redesenhar(); });
 bloco.append(caixa);
 redesenhar();
 return {
  no: bloco,
  valor: () => (modo.value === 'padrao' ? null : modo.value === 'nenhum' ? [] : [...proprios].sort((a, b) => b - a)),
 };
}

/**
 * Repetição (só ao criar). `inicio()` devolve o início atual do formulário (ms), de onde saem o dia da semana, o dia do mês e o horário.
 * `valor(ini, fim)` -> null (não repete) ou o pedaço da série a juntar ao corpo do POST; lança Error com mensagem para a pessoa.
 */
export function blocoDeRepeticao({ inicio }) {
 const bloco = el('fieldset', null, 'ag-bloco ag-repetir');
 bloco.append(el('legend', 'Repetir'));
 const freq = campo(bloco, 'Repete', 'text', [['', 'Não repete'], ['weekly', 'Toda semana'], ['monthly', 'Todo mês']]);
 const detalhe = el('div', null, 'ag-repetir-detalhe');
 detalhe.hidden = true;
 bloco.append(detalhe);

 const cada = el('label', null, 'ag-cada');
 const cadaN = document.createElement('input'); cadaN.type = 'number'; cadaN.min = 1; cadaN.max = 12; cadaN.value = 1; cadaN.setAttribute('aria-label', 'Intervalo');
 const unidade = el('span', 'semana(s)');
 cada.append(el('span', 'A cada'), cadaN, unidade);

 const dias = el('div', null, 'ag-dias'); dias.setAttribute('role', 'group'); dias.setAttribute('aria-label', 'Dias da semana');
 const caixas = M.DIAS_CURTOS.map((nome, i) => {
  const l = el('label', null, 'config-chip');
  const c = document.createElement('input'); c.type = 'checkbox'; c.value = String(i);
  l.append(c, el('span', nome)); dias.append(l);
  return c;
 });
 const nota = el('p', null, 'ag-nota');

 const termina = campo(detalhe, 'Termina', 'text', [['nunca', 'Nunca'], ['data', 'Em uma data'], ['vezes', 'Depois de N vezes']]);
 const fimData = campo(detalhe, 'Data do último evento', 'date');
 const fimVezes = campo(detalhe, 'Quantidade de eventos', 'number'); fimVezes.min = 1; fimVezes.max = 366; fimVezes.value = 10;
 detalhe.prepend(nota); detalhe.prepend(dias); detalhe.prepend(cada);
 const rotuloData = fimData.parentElement, rotuloVezes = fimVezes.parentElement;

 const atualizar = () => {
  const f = freq.value, ini = inicio();
  detalhe.hidden = !f;
  dias.hidden = f !== 'weekly';
  unidade.textContent = f === 'monthly' ? 'mês(es)' : 'semana(s)';
  rotuloData.hidden = termina.value !== 'data';
  rotuloVezes.hidden = termina.value !== 'vezes';
  if (f === 'weekly' && !caixas.some(c => c.checked) && ini) caixas[M.diaDaSemanaDe(ini)].checked = true;
  if (f === 'monthly' && ini) {
   const d = M.diaDoMesDe(ini);
   nota.textContent = `No dia ${d} de cada mês.${d > 28 ? ' Em meses mais curtos, cai no último dia.' : ''}`;
  } else nota.textContent = '';
 };
 freq.addEventListener('change', atualizar);
 termina.addEventListener('change', atualizar);
 atualizar();

 return {
  no: bloco,
  /** O formulário avisa quando o início muda, para o texto do dia do mês acompanhar. */
  inicioMudou: atualizar,
  /** Repetição só para eventos de até 24 h (um evento de vários dias não "repete toda semana" de forma que faça sentido). */
  limitar(curto) { bloco.hidden = !curto; if (!curto) freq.value = ''; atualizar(); },
  valor(ini, fim) {
   if (!freq.value) return null;
   const dia = M.diaDe(ini);
   const n = Number(cadaN.value);
   if (!Number.isInteger(n) || n < 1 || n > 12) throw new Error('Informe um intervalo de repetição de 1 a 12.');
   const corpo = { frequency: freq.value, interval_n: n, starts_on: dia, start_time: M.hora(ini), duration_minutes: Math.round((fim - ini) / 60000) };
   if (freq.value === 'weekly') {
    corpo.weekdays = caixas.filter(c => c.checked).map(c => Number(c.value));
    if (!corpo.weekdays.length) throw new Error('Escolha pelo menos um dia da semana.');
   } else corpo.month_day = M.diaDoMesDe(ini);
   if (termina.value === 'data') {
    if (!fimData.value) throw new Error('Informe até que dia a repetição vai.');
    if (fimData.value < dia) throw new Error('A data final da repetição não pode ser antes do primeiro evento.');
    corpo.ends_on = fimData.value;
   } else if (termina.value === 'vezes') {
    const v = Number(fimVezes.value);
    if (!Number.isInteger(v) || v < 1 || v > 366) throw new Error('A quantidade de eventos vai de 1 a 366.');
    corpo.count_limit = v;
   }
   return corpo;
  },
 };
}
