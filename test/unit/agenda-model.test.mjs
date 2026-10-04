// Agenda, contas puras (agenda-model.js): datas em Brasília, janelas, recortes por dia, sobreposição e filtros.
import test from 'node:test';
import assert from 'node:assert/strict';
import * as A from '../../apps/web/public/agenda-model.js';
import { TONS } from '../../apps/web/public/data-table.js';

const t = iso => Date.parse(iso);
const cc = v => ({ col: v.col, cols: v.cols });   // só a divisão em colunas; cascata e ordem têm testes próprios
const ev = (id, ini, fim, extra = {}) => A.normalizar({ id, starts_at: ini, ends_at: fim, title: 'Evento ' + id, category: 'mentoria', kind: 'sessao', status: 'planned', tenant_id: 'T1', tenant_name: 'Empresa Alfa', ...extra });

test('Brasília: o dia vem do horário local, não do UTC', () => {
 assert.equal(A.diaDe(t('2026-10-04T02:30:00Z')), '2026-10-03', '23:30 de sábado em Brasília ainda é sábado');
 assert.equal(A.diaDe(t('2026-10-04T03:00:00Z')), '2026-10-04', 'meia-noite de Brasília');
 assert.equal(A.inicioDoDia('2026-10-04'), t('2026-10-04T03:00:00Z'));
 assert.equal(A.hora(t('2026-10-04T15:30:00Z')), '12:30');
 assert.equal(A.minutosDoDia(t('2026-10-04T15:30:00Z')), 12 * 60 + 30);
 assert.equal(A.diaDe(A.inicioDoDia('2027-01-01')), '2027-01-01');
});

test('somar dias: virada de mês, de ano e ano bissexto', () => {
 assert.equal(A.somarDias('2026-10-31', 1), '2026-11-01');
 assert.equal(A.somarDias('2026-12-31', 1), '2027-01-01');
 assert.equal(A.somarDias('2028-02-28', 1), '2028-02-29');
 assert.equal(A.somarDias('2027-02-28', 1), '2027-03-01');
 assert.equal(A.somarDias('2026-03-01', -1), '2026-02-28');
 assert.equal(A.somarDias('2026-10-04', 0), '2026-10-04');
});

test('semana começa na segunda: domingo pertence à semana que termina nele', () => {
 assert.equal(A.diaDaSemana('2026-10-05'), 0, '5/10/2026 é segunda');
 assert.equal(A.diaDaSemana('2026-10-04'), 6, 'domingo');
 assert.equal(A.segundaDe('2026-10-04'), '2026-09-28');
 assert.equal(A.segundaDe('2026-10-05'), '2026-10-05');
 assert.deepEqual(A.semanaDe('2026-10-07'), ['2026-10-05', '2026-10-06', '2026-10-07', '2026-10-08', '2026-10-09', '2026-10-10', '2026-10-11']);
 assert.deepEqual(A.semanaDe('2026-12-30').slice(0, 1).concat(A.semanaDe('2026-12-30').slice(-1)), ['2026-12-28', '2027-01-03'], 'atravessa o ano');
});

test('grade do mês: semanas inteiras, 4 a 6 linhas', () => {
 const out = A.gradeDoMes('2026-10-15');
 assert.equal(out.length, 5);
 assert.equal(out[0][0], '2026-09-28');
 assert.equal(out.at(-1)[6], '2026-11-01');
 assert.ok(out.every(s => s.length === 7));
 assert.equal(A.gradeDoMes('2027-02-10').length, 4, 'fevereiro de 2027 começa numa segunda e cabe em 4 semanas');
 assert.equal(A.gradeDoMes('2026-08-10').length, 6, 'agosto de 2026: 31 dias começando no sábado');
});

test('janela de consulta: dia, semana, mês e agenda, sempre dentro do teto da API (62 dias)', () => {
 assert.deepEqual(A.janela('dia', '2026-10-04'), { from: '2026-10-04', to: '2026-10-05' });
 assert.deepEqual(A.janela('semana', '2026-10-04'), { from: '2026-09-28', to: '2026-10-05' });
 assert.deepEqual(A.janela('mes', '2026-10-15'), { from: '2026-09-28', to: '2026-11-02' });
 assert.deepEqual(A.janela('agenda', '2026-10-04'), { from: '2026-10-04', to: '2026-11-04' });
 for (const v of A.VISOES) for (const d of ['2026-01-31', '2026-02-15', '2026-08-10', '2027-02-10', '2028-02-29']) {
  const j = A.janela(v, d), dias = (Date.parse(j.to) - Date.parse(j.from)) / 86400000;
  assert.ok(dias >= 1 && dias <= 62, `${v} ${d}: ${dias} dias`);
 }
});

test('navegar: dia/semana/agenda andam fixo; mês mantém o dia e ajusta ao tamanho do mês de chegada', () => {
 assert.equal(A.navegar('dia', '2026-10-31', 1), '2026-11-01');
 assert.equal(A.navegar('semana', '2026-12-30', 1), '2027-01-06');
 assert.equal(A.navegar('semana', '2026-10-04', -1), '2026-09-27');
 assert.equal(A.navegar('mes', '2026-01-31', 1), '2026-02-28');
 assert.equal(A.navegar('mes', '2026-03-31', -1), '2026-02-28');
 assert.equal(A.navegar('mes', '2028-01-31', 1), '2028-02-29');
 assert.equal(A.navegar('mes', '2026-12-15', 1), '2027-01-15');
 assert.equal(A.navegar('mes', '2027-01-15', -1), '2026-12-15');
 assert.equal(A.navegar('agenda', '2026-10-04', 1), '2026-11-03');
});

test('título da visão em português, com semana que cruza mês e ano', () => {
 assert.match(A.titulo('mes', '2026-10-15'), /outubro de 2026/);
 assert.match(A.titulo('dia', '2026-10-04'), /domingo, 4 de outubro de 2026/);
 assert.match(A.titulo('semana', '2026-10-07'), /^5 – 11 de outubro de 2026$/);
 assert.match(A.titulo('semana', '2026-10-04'), /^28 de set\.? – 4 de out\.? de 2026$/);
 assert.match(A.titulo('semana', '2026-12-30'), /^28 de dez\.? de 2026 – 3 de jan\.? de 2027$/);
});

test('recorte por dia: evento que atravessa a meia-noite aparece nos dois dias, cada um com a sua parte', () => {
 const noite = ev('n', '2026-10-04T23:30:00-03:00', '2026-10-05T01:30:00-03:00');
 assert.deepEqual(A.recorteDoDia(noite, '2026-10-04'), { ini: 1410, fim: 1440 });
 assert.deepEqual(A.recorteDoDia(noite, '2026-10-05'), { ini: 0, fim: 90 });
 assert.equal(A.recorteDoDia(noite, '2026-10-03'), null);
 assert.equal(A.recorteDoDia(noite, '2026-10-06'), null);
 const ate0 = ev('z', '2026-10-04T22:00:00-03:00', '2026-10-05T00:00:00-03:00');
 assert.equal(A.recorteDoDia(ate0, '2026-10-05'), null, 'terminar à meia-noite não invade o dia seguinte');
 assert.deepEqual(A.recorteDoDia(ate0, '2026-10-04'), { ini: 1320, fim: 1440 });
 const meio = ev('m', '2026-10-04T09:00:00-03:00', '2026-10-04T10:15:00-03:00');
 assert.deepEqual(A.recorteDoDia(meio, '2026-10-04'), { ini: 540, fim: 615 });
});

test('dia inteiro: a partir de 24h vai para a faixa de cima', () => {
 assert.equal(A.diaInteiro(ev('a', '2026-10-04T00:00:00-03:00', '2026-10-05T00:00:00-03:00')), true);
 assert.equal(A.diaInteiro(ev('b', '2026-10-04T00:00:00-03:00', '2026-10-04T23:59:00-03:00')), false);
 assert.equal(A.diaInteiro(ev('c', '2026-10-04T10:00:00-03:00', '2026-10-20T10:00:00-03:00')), true, 'prazo de duas semanas');
});

test('eventos do dia: dia inteiro primeiro, depois por horário; evento de fora não entra', () => {
 const lista = [ev('b', '2026-10-04T14:00:00-03:00', '2026-10-04T15:00:00-03:00'), ev('prazo', '2026-10-01T00:00:00-03:00', '2026-10-10T00:00:00-03:00'), ev('a', '2026-10-04T09:00:00-03:00', '2026-10-04T10:00:00-03:00'), ev('fora', '2026-10-05T09:00:00-03:00', '2026-10-05T10:00:00-03:00')];
 assert.deepEqual(A.eventosDoDia(lista, '2026-10-04').map(e => e.id), ['prazo', 'a', 'b']);
});

test('sobreposição: quem não se toca usa a largura toda; quem se toca divide em colunas', () => {
 const l = A.layoutColunas([{ id: 'a', ini: 540, fim: 600 }, { id: 'b', ini: 600, fim: 660 }, { id: 'c', ini: 720, fim: 780 }]);
 for (const id of ['a', 'b', 'c']) assert.deepEqual(cc(l.get(id)), { col: 0, cols: 1 }, id + ' sozinho');
 const dois = A.layoutColunas([{ id: 'a', ini: 540, fim: 630 }, { id: 'b', ini: 570, fim: 660 }]);
 assert.deepEqual(cc(dois.get('a')), { col: 0, cols: 2 });
 assert.deepEqual(cc(dois.get('b')), { col: 1, cols: 2 });
 const tres = A.layoutColunas([{ id: 'a', ini: 540, fim: 660 }, { id: 'b', ini: 550, fim: 650 }, { id: 'c', ini: 560, fim: 640 }]);
 assert.deepEqual([...tres.values()].map(v => v.cols), [3, 3, 3]);
 assert.deepEqual(new Set([...tres.values()].map(v => v.col)), new Set([0, 1, 2]));
});

test('sobreposição em cadeia: A–B e B–C se tocam, A e C não; as três dividem em 2 colunas e C reaproveita a coluna de A', () => {
 const l = A.layoutColunas([{ id: 'a', ini: 540, fim: 600 }, { id: 'b', ini: 570, fim: 630 }, { id: 'c', ini: 600, fim: 660 }]);
 assert.deepEqual(cc(l.get('a')), { col: 0, cols: 2 });
 assert.deepEqual(cc(l.get('b')), { col: 1, cols: 2 });
 assert.deepEqual(cc(l.get('c')), { col: 0, cols: 2 });
});

test('sobreposição: evento curto ocupa 30 min na grade, então vizinho a 20 min de distância divide a coluna', () => {
 const l = A.layoutColunas([{ id: 'a', ini: 540, fim: 550 }, { id: 'b', ini: 560, fim: 570 }]);
 assert.equal(l.get('a').cols, 2);
 const longe = A.layoutColunas([{ id: 'a', ini: 540, fim: 550 }, { id: 'b', ini: 570, fim: 580 }]);
 assert.equal(longe.get('a').cols, 1, 'a 30 min de distância já não se tocam');
 assert.equal(A.layoutColunas([]).size, 0);
});

test('cascata: dois eventos que começam em horas diferentes ficam um sobre o outro, com recuo; o de baixo fica por cima', () => {
 const l = A.layoutColunas([{ id: 'a', ini: 540, fim: 600 }, { id: 'b', ini: 570, fim: 630 }]);
 assert.equal(l.get('a').cascata, true); assert.equal(l.get('b').cascata, true);
 const ra = A.retangulo({ ini: 540, fim: 600 }, l.get('a'), 48), rb = A.retangulo({ ini: 570, fim: 630 }, l.get('b'), 48);
 assert.deepEqual([ra.esquerda, ra.largura], [0, 100], 'o primeiro usa a largura toda');
 assert.deepEqual([rb.esquerda, rb.largura], [A.RECUO_CASCATA, 100 - A.RECUO_CASCATA], 'o segundo recua e ainda é largo o bastante para ler');
 assert.ok(rb.z > ra.z, 'quem começa depois fica por cima');
 assert.ok(rb.largura >= 60, 'nunca fica uma fatia estreita');
});

test('sem cascata: começam juntos (30 min de diferença é o mínimo) ou são três ou mais, e dividem em colunas iguais', () => {
 const juntos = A.layoutColunas([{ id: 'a', ini: 540, fim: 600 }, { id: 'b', ini: 545, fim: 600 }]);
 assert.equal(juntos.get('a').cascata, false); assert.equal(juntos.get('b').cascata, false);
 assert.equal(A.retangulo({ ini: 540, fim: 600 }, juntos.get('b'), 48).largura, 50, 'metade cada um');
 const tres = A.layoutColunas([{ id: 'a', ini: 540, fim: 660 }, { id: 'b', ini: 570, fim: 650 }, { id: 'c', ini: 600, fim: 640 }]);
 assert.ok([...tres.values()].every(v => v.cascata === false && v.cols === 3));
 const quase = A.layoutColunas([{ id: 'a', ini: 540, fim: 600 }, { id: 'b', ini: 569, fim: 600 }]);
 assert.equal(quase.get('a').cascata, false, '29 min de diferença ainda é "juntos"');
 const sozinho = A.layoutColunas([{ id: 'a', ini: 540, fim: 600 }]);
 assert.equal(sozinho.get('a').cascata, false);
});

test('sobreposição é determinística (mesma entrada, mesma saída, em qualquer ordem)', () => {
 const itens = [{ id: 'x', ini: 540, fim: 600 }, { id: 'y', ini: 540, fim: 600 }, { id: 'z', ini: 540, fim: 600 }];
 const a = A.layoutColunas(itens), b = A.layoutColunas([...itens].reverse());
 for (const id of ['x', 'y', 'z']) assert.deepEqual(a.get(id), b.get(id));
});

test('retângulo: topo e altura em px pela hora; mínimo de 30 min; faixa horizontal pela coluna', () => {
 assert.deepEqual(A.retangulo({ ini: 540, fim: 600 }, { col: 0, cols: 1 }, 48), { topo: 432, altura: 48, esquerda: 0, largura: 100, z: 1 });
 assert.equal(A.retangulo({ ini: 540, fim: 550 }, null, 48).altura, 24, '10 min viram 30 min de altura (24px a 48px/h)');
 const r = A.retangulo({ ini: 0, fim: 1440 }, { col: 1, cols: 3 }, 60);
 assert.deepEqual([r.topo, r.altura, Math.round(r.esquerda), Math.round(r.largura)], [0, 1440, 33, 33]);
});

test('mover mantém a duração; esticar respeita mínimo e teto', () => {
 const e = ev('a', '2026-10-04T09:00:00-03:00', '2026-10-04T10:30:00-03:00');
 assert.deepEqual(A.mover(e, 60), { starts_at: '2026-10-04T13:00:00.000Z', ends_at: '2026-10-04T14:30:00.000Z' });
 assert.deepEqual(A.mover(e, -1440), { starts_at: '2026-10-03T12:00:00.000Z', ends_at: '2026-10-03T13:30:00.000Z' }, 'um dia antes');
 assert.equal(A.redimensionar(e, e.ini + 3 * 3600000).ends_at, '2026-10-04T15:00:00.000Z');
 assert.equal(A.redimensionar(e, e.ini - 3600000).ends_at, new Date(e.ini + 15 * 60000).toISOString(), 'não passa do mínimo de 15 min');
 assert.equal(A.redimensionar(e, e.ini + 1000 * 86400000).ends_at, new Date(e.ini + 365 * 86400000).toISOString(), 'teto de um ano');
 assert.equal(A.redimensionar(e, e.fim).starts_at, new Date(e.ini).toISOString(), 'o início não muda ao esticar o fim');
});

test('campo datetime-local <-> instante: ida e volta, e valor inválido vira null', () => {
 assert.equal(A.paraCampoLocal(t('2026-10-04T15:30:00Z')), '2026-10-04T12:30');
 assert.equal(A.doCampoLocal('2026-10-04T12:30'), '2026-10-04T15:30:00.000Z');
 for (const ms of [t('2026-01-01T03:00:00Z'), t('2026-12-31T02:59:00Z'), t('2026-10-04T15:30:00Z')]) assert.equal(t(A.doCampoLocal(A.paraCampoLocal(ms))), ms);
 for (const ruim of ['', null, undefined, '2026-10-04', '2026-10-04T12', '2026-13-04T12:30', '2026-02-30T12:30', '2026-04-31T09:00', '2026-10-04T24:00', '2026-10-04T12:60', '2026-10-04T99:99', 'abc']) assert.equal(A.doCampoLocal(ruim), null, String(ruim));
});

test('arredondar ao passo da grade e duração em texto', () => {
 assert.equal(A.arredondar(547, 15), 540); assert.equal(A.arredondar(553, 15), 555); assert.equal(A.arredondar(7, 15), 0);
 assert.equal(A.duracaoTexto(90), '1 h 30 min'); assert.equal(A.duracaoTexto(60), '1 h'); assert.equal(A.duracaoTexto(45), '45 min');
 assert.equal(A.intervaloTexto(t('2026-10-04T12:00:00Z'), t('2026-10-04T13:30:00Z')), '09:00 – 10:30');
 assert.match(A.intervaloTexto(t('2026-10-04T12:00:00Z'), t('2026-10-05T13:30:00Z')), /4 .*09:00 – 5 .*10:30/);
});

test('filtros: busca sem acento e sem caixa, categorias, situação e empresa', () => {
 const lista = [
  ev('1', '2026-10-04T09:00:00-03:00', '2026-10-04T10:00:00-03:00', { title: 'Reunião de alinhamento' }),
  ev('2', '2026-10-04T11:00:00-03:00', '2026-10-04T12:00:00-03:00', { title: 'Entrega do site', category: 'software', kind: 'entregavel', status: 'done', tenant_id: 'T2', tenant_name: 'Beta Ltda', location: 'São Paulo' }),
 ];
 assert.deepEqual(A.filtrar(lista, { texto: 'REUNIAO' }).map(e => e.id), ['1']);
 assert.deepEqual(A.filtrar(lista, { texto: 'beta' }).map(e => e.id), ['2'], 'acha pelo nome da empresa');
 assert.deepEqual(A.filtrar(lista, { texto: 'sao paulo' }).map(e => e.id), ['2'], 'acha pelo local');
 assert.deepEqual(A.filtrar(lista, { texto: 'entregavel' }).map(e => e.id), ['2'], 'acha pelo tipo');
 assert.deepEqual(A.filtrar(lista, { categorias: new Set(['software']) }).map(e => e.id), ['2']);
 assert.deepEqual(A.filtrar(lista, { categorias: new Set() }).map(e => e.id), ['1', '2'], 'conjunto vazio = todas');
 assert.deepEqual(A.filtrar(lista, { status: 'done' }).map(e => e.id), ['2']);
 assert.deepEqual(A.filtrar(lista, { tenant: 'T1' }).map(e => e.id), ['1']);
 assert.deepEqual(A.filtrar(lista, { texto: 'reuniao', tenant: 'T2' }), [], 'filtros se combinam');
 assert.deepEqual(A.filtrar(lista).map(e => e.id), ['1', '2']);
});

test('agenda por dia: só os dias com evento, em ordem', () => {
 const lista = [ev('b', '2026-10-07T09:00:00-03:00', '2026-10-07T10:00:00-03:00'), ev('a', '2026-10-05T09:00:00-03:00', '2026-10-05T10:00:00-03:00'), ev('c', '2026-10-07T08:00:00-03:00', '2026-10-07T08:30:00-03:00')];
 const g = A.agruparPorDia(lista, '2026-10-04', '2026-10-11');
 assert.deepEqual(g.map(x => x.dia), ['2026-10-05', '2026-10-07']);
 assert.deepEqual(g[1].eventos.map(e => e.id), ['c', 'b']);
});

test('cores: toda categoria tem um tom de selo válido', () => {
 for (const c of A.CATEGORIAS) assert.ok(TONS.includes(A.TOM_DA_CATEGORIA[c]), c);
 assert.deepEqual(Object.keys(A.TOM_DA_CATEGORIA).sort(), [...A.CATEGORIAS].sort(), 'sem tom sobrando nem faltando');
 assert.equal(new Set(Object.values(A.TOM_DA_CATEGORIA)).size, A.CATEGORIAS.length, 'cada categoria com uma cor própria');
});

// ---------- lembretes e repetição ----------
import { descrever as descreverNoServidor } from '../../apps/api/src/platform/recorrencia.mjs';
import { LEMBRETES_PERMITIDOS } from '../../apps/api/src/platform/tracking-model.mjs';

test('texto dos lembretes', () => {
 assert.equal(A.textoDosLembretes([]), 'Não avisar');
 assert.equal(A.textoDosLembretes(undefined), 'Não avisar');
 assert.equal(A.textoDosLembretes([15]), '15 min antes');
 assert.equal(A.textoDosLembretes([0]), 'Na hora');
 assert.equal(A.textoDosLembretes([60, 15]), '1 h e 15 min antes');
 assert.equal(A.textoDosLembretes([15, 60, 1440]), '1 dia, 1 h e 15 min antes', 'sempre da maior para a menor antecedência');
 assert.equal(A.textoDosLembretes([30, 0]), '30 min antes e na hora');
 assert.equal(A.textoDosLembretes([120]), '2 h antes');
 assert.equal(A.textoDosLembretes([2880]), '2 dias antes');
});

test('lembrete efetivo: o da atividade, ou o padrão da agenda quando ela não escolheu', () => {
 assert.deepEqual(A.lembreteEfetivo({ reminders: null }, [15]), { origem: 'padrao', minutos: [15] });
 assert.deepEqual(A.lembreteEfetivo({}, [15]), { origem: 'padrao', minutos: [15] });
 assert.deepEqual(A.lembreteEfetivo({ reminders: [] }, [15]), { origem: 'proprio', minutos: [] }, '[] é "não avisar", não "padrão"');
 assert.deepEqual(A.lembreteEfetivo({ reminders: [60] }, [15]), { origem: 'proprio', minutos: [60] });
});

test('opções de lembrete da tela: só valores que o servidor aceita, no máximo 3 de cada vez', () => {
 for (const [minutos] of A.OPCOES_DE_LEMBRETE) assert.ok(LEMBRETES_PERMITIDOS.includes(minutos), minutos + ' tem de existir no banco');
 assert.equal(A.MAX_LEMBRETES, 3);
 assert.equal(new Set(A.OPCOES_DE_LEMBRETE.map(o => o[0])).size, A.OPCOES_DE_LEMBRETE.length);
});

test('o texto da repetição no navegador é IGUAL ao do servidor, para qualquer regra', () => {
 const regras = [];
 for (const weekdays of [[0], [2, 0], [0, 2, 4], [5], [5, 6], [6], [0, 1, 2, 3, 4, 5, 6], [4, 4, 0]])
  for (const interval_n of [1, 2, 4]) for (const fim of [{}, { count_limit: 1 }, { count_limit: 8 }, { ends_on: '2027-03-09' }])
   regras.push({ frequency: 'weekly', weekdays, interval_n, starts_on: '2026-10-05', ...fim });
 for (const month_day of [1, 15, 31]) for (const interval_n of [1, 3]) for (const fim of [{}, { count_limit: 2 }, { ends_on: '2028-02-29' }])
  regras.push({ frequency: 'monthly', month_day, interval_n, starts_on: '2026-10-01', ...fim });
 assert.ok(regras.length > 100);
 for (const r of regras) assert.equal(A.descreverRecorrencia(r), descreverNoServidor(r), JSON.stringify(r));
});

test('dia da semana e dia do mês de um instante em Brasília (a repetição nasce com os do evento)', () => {
 assert.equal(A.diaDaSemanaDe(t('2026-10-05T13:00:00Z')), 0, 'segunda');
 assert.equal(A.diaDaSemanaDe(t('2026-10-05T02:00:00Z')), 6, '23h de domingo ainda é domingo em Brasília');
 assert.equal(A.diaDoMesDe(t('2026-10-31T13:00:00Z')), 31);
 assert.equal(A.diaDoMesDe(t('2026-11-01T02:00:00Z')), 31, '23h do dia 31 em Brasília');
});
