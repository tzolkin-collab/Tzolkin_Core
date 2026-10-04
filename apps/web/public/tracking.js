// Acompanhamento: agenda no estilo do Google Calendar (Dia, Semana, Mês e Agenda), com eventos que se arrastam e esticam.
//
// Este arquivo cuida do estado, da busca de dados e do desenho. As contas (datas em Brasília, janelas, sobreposição)
// estão em agenda-model.js, que tem testes próprios; o formulário e o painel do evento estão em agenda-evento.js.
import { createIcon } from './icons.js';
import { el, botao, campo, estilo } from './agenda-dom.js';
import * as M from './agenda-model.js';
import { abrirEditor, criarPainel } from './agenda-evento.js';

const ALTURA_HORA = 48;   // px por hora na grade; o CSS usa o mesmo valor em --ag-hora
const PASSO = 15;         // minutos: arrastar e esticar grudam de 15 em 15
const MINIMO = 30;        // minutos: duração visual mínima e padrão de um clique na grade
const LIMIAR = 4;         // px que o mouse anda antes de um clique virar arraste
const MAX_CHIPS_MES = 3;
const CHAVE_VISAO = 'tzolkin-agenda-visao';

const lerVisao = () => { try { const v = localStorage.getItem(CHAVE_VISAO); return M.VISOES.includes(v) ? v : null; } catch { return null; } };
const guardarVisao = v => { try { localStorage.setItem(CHAVE_VISAO, v); } catch { /* navegação privada: vale até recarregar */ } };
const maiuscula = t => t.charAt(0).toUpperCase() + t.slice(1);
const hoje = () => M.diaDe(Date.now());
const limitar = (n, a, b) => Math.min(Math.max(n, a), b);

// openTenant abre a ficha da empresa; vem de app.js por callback para este módulo não importá-lo.
export function setupTracking({ api, openTenant }) {
 const host = document.getElementById('view-tracking');
 const celular = window.matchMedia('(max-width:700px)');
 const estado = { visao: lerVisao() || (celular.matches ? 'dia' : 'semana'), dia: hoje(), miniMes: hoje(), tenant: '', texto: '', categorias: new Set(), status: '' };
 let dados = null, eventos = [], tenants = [], geracao = 0, aviso = '', rolagem = null, relogio = 0, suprimirClique = false, filtrosAbertos = false;
 const compacta = window.matchMedia('(max-width:1100px)');   // abaixo disso a lateral some e os filtros viram um bloco recolhível
 const salvando = new Set();
 const partes = { topo: null, lateral: null, principal: null, horas: null, entrada: null };

 compacta.addEventListener('change', () => { if (dados && partes.lateral?.isConnected) desenharLateral(); });
 const painel = criarPainel({
  api, openTenant,
  aoEditar: e => editar(e),
  recarregar: () => carregar({ silencioso: true }),
 });

 // ---------- dados ----------
 const visiveis = () => M.filtrar(eventos, { texto: estado.texto, categorias: estado.categorias, status: estado.status });

 async function carregar({ silencioso = false } = {}) {
  const ticket = ++geracao;
  if (!dados) host.replaceChildren(el('p', 'Carregando acompanhamento…', 'empty-list'));
  else if (!silencioso) host.setAttribute('aria-busy', 'true');
  const j = M.janela(estado.visao, estado.dia);
  const filtro = new URLSearchParams({ from: j.from, to: j.to, ...(estado.tenant ? { tenant_id: estado.tenant } : {}) });
  try {
   const [resposta, diretorio] = await Promise.all([api('/api/tracking?' + filtro), tenants.length ? null : api('/api/overview')]);
   if (ticket !== geracao) return;
   dados = resposta; eventos = resposta.activities.map(M.normalizar);
   if (diretorio) tenants = diretorio.tenants;
   host.removeAttribute('aria-busy');
   desenhar();
   painel.atualizar(dados, eventos);
  } catch (falha) {
   if (ticket !== geracao) return;
   host.removeAttribute('aria-busy');
   if (dados) { aviso = falha.message; desenharPrincipal(); } else host.replaceChildren(el('p', falha.message, 'notice-inline'));
  }
 }

 function irPara({ dia = estado.dia, visao = estado.visao } = {}) {
  const mudouVisao = visao !== estado.visao;
  estado.dia = dia; estado.visao = visao; estado.miniMes = M.primeiroDoMes(dia); aviso = '';
  if (mudouVisao) guardarVisao(visao);
  rolagem = null;
  desenharTopo(); desenharLateral();
  carregar();
 }

 // ---------- edição ----------
 function novo(inicio = null, fim = null) {
  abrirEditor({ host, api, dados, tenants, inicio, fim, tenantPadrao: estado.tenant, aoSalvar: () => carregar({ silencioso: true }) });
 }
 function editar(evento) {
  abrirEditor({ host, api, dados, tenants, evento, aoSalvar: () => carregar({ silencioso: true }) });
 }
 /** Grava só o horário (arrastar/esticar): mostra o resultado já, confirma com o servidor e desfaz se ele recusar. */
 async function gravarHorario(evento, campos) {
  if (salvando.has(evento.id)) return;
  salvando.add(evento.id);
  const anterior = eventos;
  eventos = eventos.map(x => x.id === evento.id ? M.normalizar({ ...x, ...campos }) : x);
  aviso = ''; desenharPrincipal();
  try {
   const r = await api('/api/tracking/' + evento.id, 'PUT', { revision: evento.revision, ...campos });
   eventos = eventos.map(x => x.id === evento.id ? M.normalizar({ ...x, ...r.activity }) : x);
  } catch (falha) {
   eventos = anterior; aviso = `Não foi possível alterar o horário: ${falha.message}`;
  } finally { salvando.delete(evento.id); }
  desenharPrincipal(); painel.atualizar(dados, eventos);
 }
 const abrirEvento = evento => painel.abrir(evento, dados);

 // ---------- topo ----------
 function desenharTopo() {
  const topo = partes.topo; topo.replaceChildren();
  const nav = el('div', null, 'ag-nav');
  const anterior = botao('', 'arrow', () => irPara({ dia: M.navegar(estado.visao, estado.dia, -1) }), 'quiet ag-icone ag-anterior');
  const proximo = botao('', 'arrow', () => irPara({ dia: M.navegar(estado.visao, estado.dia, 1) }), 'quiet ag-icone');
  const rotulos = { dia: ['Dia anterior', 'Próximo dia'], semana: ['Semana anterior', 'Próxima semana'], mes: ['Mês anterior', 'Próximo mês'], agenda: ['Período anterior', 'Próximo período'] }[estado.visao];
  for (const [b, r] of [[anterior, rotulos[0]], [proximo, rotulos[1]]]) { b.setAttribute('aria-label', r); b.title = r; }
  const titulo = el('h2', maiuscula(M.titulo(estado.visao, estado.dia)), 'ag-titulo'); titulo.setAttribute('aria-live', 'polite');
  nav.append(botao('Hoje', null, () => irPara({ dia: hoje() }), 'secondary ag-hoje'), anterior, proximo, titulo);

  const acoes = el('div', null, 'ag-acoes');
  const busca = el('label', null, 'ag-busca');
  busca.append(el('span', 'Buscar atividade ou cliente', 'sr-only'), createIcon('search'));
  const entrada = el('input'); entrada.type = 'search'; entrada.placeholder = 'Buscar atividades…'; entrada.value = estado.texto;
  entrada.oninput = () => { estado.texto = entrada.value; desenharPrincipal(); desenharLateral(); };
  busca.append(entrada); partes.entrada = entrada;
  const visoes = el('div', null, 'ag-visoes'); visoes.setAttribute('role', 'group'); visoes.setAttribute('aria-label', 'Visualização');
  for (const v of M.VISOES) {
   const b = el('button', M.ROTULO_DA_VISAO[v]); b.type = 'button'; b.dataset.visao = v; b.setAttribute('aria-pressed', String(v === estado.visao));
   b.onclick = () => { if (v !== estado.visao) irPara({ visao: v }); };
   visoes.append(b);
  }
  acoes.append(busca, visoes, botao('Nova atividade', 'plus', () => novo(), 'primary'));
  topo.append(nav, acoes);
 }

 // ---------- lateral: mini-calendário e filtros ----------
 function desenharLateral() {
  const lateral = partes.lateral; lateral.replaceChildren();
  const mini = el('section', null, 'ag-mini'); mini.setAttribute('aria-label', 'Mini calendário');
  const cab = el('div', null, 'ag-mini-cab');
  const mesAnt = botao('', 'arrow', () => { estado.miniMes = M.navegar('mes', estado.miniMes, -1); desenharLateral(); }, 'quiet ag-icone ag-anterior');
  const mesPro = botao('', 'arrow', () => { estado.miniMes = M.navegar('mes', estado.miniMes, 1); desenharLateral(); }, 'quiet ag-icone');
  mesAnt.setAttribute('aria-label', 'Mês anterior'); mesPro.setAttribute('aria-label', 'Próximo mês');
  cab.append(el('strong', maiuscula(M.titulo('mes', estado.miniMes))), mesAnt, mesPro);
  const grade = el('div', null, 'ag-mini-grade');
  for (const letra of ['S', 'T', 'Q', 'Q', 'S', 'S', 'D']) grade.append(el('span', letra, 'ag-mini-sem'));
  const janelaAtual = new Set(M.semanaDe(estado.dia));
  const hojeDia = hoje();
  for (const semana of M.gradeDoMes(estado.miniMes)) for (const d of semana) {
   const b = el('button', String(M.numeroDoDia(d)), 'ag-mini-dia'); b.type = 'button'; b.dataset.dia = d;
   b.setAttribute('aria-label', maiuscula(M.titulo('dia', d)));
   if (!M.mesmoMes(d, estado.miniMes)) b.dataset.fora = '';
   if (d === hojeDia) b.dataset.hoje = '';
   if (d === estado.dia) b.setAttribute('aria-current', 'date');
   else if (estado.visao === 'semana' && janelaAtual.has(d)) b.dataset.semana = '';
   b.onclick = () => irPara({ dia: d });
   grade.append(b);
  }
  mini.append(cab, grade);

  const filtros = el('section', null, 'ag-filtros'); filtros.setAttribute('aria-label', 'Filtros');
  const cliente = campo(filtros, 'Cliente', 'text', [['', 'Todos os clientes'], ...tenants.map(t => [t.id, t.name])]); cliente.value = estado.tenant;
  cliente.onchange = () => { estado.tenant = cliente.value; carregar(); };
  const situacao = campo(filtros, 'Situação', 'text', [['', 'Todas'], ['planned', M.ROTULOS.planned], ['done', M.ROTULOS.done], ['cancelled', M.ROTULOS.cancelled]]); situacao.value = estado.status;
  situacao.onchange = () => { estado.status = situacao.value; desenharPrincipal(); desenharLateral(); };

  const cats = el('fieldset', null, 'ag-categorias'); cats.append(el('legend', 'Categorias'));
  const contagem = {};
  for (const e of M.filtrar(eventos, { texto: estado.texto, status: estado.status })) contagem[e.category] = (contagem[e.category] || 0) + 1;
  for (const c of M.CATEGORIAS) {
   const linha = el('label', null, 'ag-categoria');
   const caixa = el('input'); caixa.type = 'checkbox'; caixa.checked = !estado.categorias.size || estado.categorias.has(c); caixa.dataset.categoria = c;
   caixa.onchange = () => {
    // Todas marcadas = sem filtro (conjunto vazio); desmarcar uma passa a listar só as marcadas.
    const marcadas = new Set([...cats.querySelectorAll('input:checked')].map(i => i.dataset.categoria));
    estado.categorias = marcadas.size === M.CATEGORIAS.length ? new Set() : marcadas;
    desenharPrincipal(); desenharLateral();
   };
   const cor = el('span', null, 'ag-cor'); cor.dataset.tom = M.TOM_DA_CATEGORIA[c];
   linha.append(caixa, cor, el('span', M.ROTULOS[c]), el('small', String(contagem[c] || 0)));
   cats.append(linha);
  }
  filtros.append(cats);
  // Telas pequenas: os filtros ficam recolhidos para o calendário aparecer logo. No desktop o bloco fica aberto e sem título.
  const ativos = (estado.tenant ? 1 : 0) + (estado.status ? 1 : 0) + (estado.categorias.size ? 1 : 0);
  const bloco = el('details', null, 'ag-filtros-det');
  bloco.append(el('summary', 'Filtros' + (ativos ? ` · ${ativos} ativo${ativos > 1 ? 's' : ''}` : '')), filtros);
  bloco.open = !compacta.matches || filtrosAbertos;
  bloco.addEventListener('toggle', () => { if (compacta.matches) filtrosAbertos = bloco.open; });
  lateral.append(mini, bloco);
 }

 // ---------- principal ----------
 function desenharPrincipal() {
  const principal = partes.principal;
  const antes = principal.querySelector('.ag-rolagem'); if (antes) rolagem = antes.scrollTop;
  clearInterval(relogio);
  principal.replaceChildren();
  if (aviso) { const a = el('p', aviso, 'ag-aviso'); a.setAttribute('role', 'alert'); principal.append(a); }
  if (dados.truncated) principal.append(el('p', 'Limite de registros atingido: a lista pode estar incompleta. Filtre por cliente.', 'security-banner'));
  const lista = visiveis();
  if (estado.visao === 'agenda') principal.append(desenharAgenda(lista));
  else if (estado.visao === 'mes') principal.append(desenharMes(lista));
  else principal.append(desenharGrade(estado.visao === 'dia' ? [estado.dia] : M.semanaDe(estado.dia), lista));
  const n = lista.length;
  const contador = el('p', `${n} atividade${n === 1 ? '' : 's'} no período`, 'ag-contagem detail'); contador.setAttribute('role', 'status');
  principal.append(contador);
  desenharHoras();
 }

 // Texto acessível do evento: o que o olho lê na grade, em uma frase.
 const descricao = e => [e.title, M.diaInteiro(e) ? 'dia inteiro' : M.intervaloTexto(e.ini, e.fim), e.tenant_name, M.ROTULOS[e.status], e.series_id ? 'repete' : null].filter(Boolean).join(', ');
 const marca = e => (e.series_id ? el('span', '↻', 'ag-repete') : null);   // série: a mesma atividade em outras datas

 function eventoNaGrade(e, dia, recorte, lay) {
  const b = el('button', null, 'ag-evento'); b.type = 'button';
  b.dataset.id = e.id; b.dataset.tom = M.TOM_DA_CATEGORIA[e.category]; b.dataset.status = e.status;
  b.setAttribute('aria-label', descricao(e));
  if (recorte.fim - recorte.ini <= MINIMO) b.classList.add('ag-curto');
  const titulo = el('strong', e.title, 'ag-ev-titulo'); if (e.series_id) titulo.prepend(marca(e));
  b.append(titulo, el('span', `${M.hora(e.ini)} – ${M.hora(e.fim)}`, 'ag-ev-hora'), el('span', e.tenant_name, 'ag-ev-empresa'));
  const r = M.retangulo(recorte, lay, ALTURA_HORA, MINIMO);
  estilo(b, { top: r.topo + 'px', height: Math.max(r.altura - 2, 14) + 'px', left: `calc(${r.esquerda}% + 1px)`, width: `calc(${r.largura}% - 3px)`, 'z-index': String(r.z) });
  // Só o pedaço que termina neste dia tem a alça de esticar (evento que atravessa a meia-noite estica no último dia).
  if (M.diaDe(e.fim - 1) === dia) { const alca = el('span', null, 'ag-alca'); alca.setAttribute('aria-hidden', 'true'); b.append(alca); }
  b.onclick = () => { if (suprimirClique) { suprimirClique = false; return; } abrirEvento(e); };
  return b;
 }

 function desenharGrade(dias, lista) {
  const raiz = el('div', null, 'ag-grade'); raiz.setAttribute('role', 'region'); raiz.setAttribute('aria-label', dias.length === 1 ? 'Calendário do dia' : 'Calendário da semana');
  estilo(raiz, { '--ag-colunas': String(dias.length), '--ag-hora': ALTURA_HORA + 'px' });
  const hojeDia = hoje();
  const rolar = el('div', null, 'ag-rolagem'); rolar.tabIndex = -1;
  const fixo = el('div', null, 'ag-fixo');
  const cab = el('div', null, 'ag-cabecalho'); cab.append(el('span', null, 'ag-canto'));
  for (const d of dias) {
   const b = el('button', null, 'ag-dia-cab'); b.type = 'button'; b.dataset.dia = d; if (d === hojeDia) b.dataset.hoje = '';
   b.setAttribute('aria-label', 'Abrir ' + M.titulo('dia', d));
   b.append(el('span', M.nomeDoDia(d), 'ag-dia-nome'), el('span', String(M.numeroDoDia(d)), 'ag-dia-num'));
   b.onclick = () => { if (estado.visao !== 'dia') irPara({ dia: d, visao: 'dia' }); };
   cab.append(b);
  }
  fixo.append(cab);
  // Faixa "dia todo": prazos e eventos de um dia ou mais não ocupam a grade de horas.
  const inteiros = dias.map(d => M.eventosDoDia(lista, d).filter(M.diaInteiro));
  if (inteiros.some(l => l.length)) {
   const faixa = el('div', null, 'ag-diainteiro'); faixa.append(el('span', 'dia todo', 'ag-canto'));
   inteiros.forEach((doDia, i) => {
    const celula = el('div', null, 'ag-di-celula'); celula.dataset.dia = dias[i];
    for (const e of doDia) celula.append(chip(e, true));
    faixa.append(celula);
   });
   fixo.append(faixa);
  }
  rolar.append(fixo);

  const corpo = el('div', null, 'ag-corpo-grade');
  const horas = el('div', null, 'ag-horas');
  for (let h = 0; h < 24; h++) horas.append(el('span', h ? M.rotuloDaHora(h) : '', 'ag-hora'));
  corpo.append(horas);
  const colunas = [];
  for (const d of dias) {
   const col = el('div', null, 'ag-coluna'); col.dataset.dia = d; if (d === hojeDia) col.dataset.hoje = '';
   const doDia = M.eventosDoDia(lista, d).filter(e => !M.diaInteiro(e));
   const itens = doDia.map(e => ({ id: e.id, ...M.recorteDoDia(e, d) }));
   const lay = M.layoutColunas(itens, MINIMO);
   const porId = new Map(itens.map(i => [i.id, i]));
   for (const e of doDia) col.append(eventoNaGrade(e, d, porId.get(e.id), lay.get(e.id)));
   colunas.push(col); corpo.append(col);
  }
  ligarInteracao(corpo, colunas, dias, lista);
  const agora = dias.indexOf(hojeDia);
  if (agora >= 0) {
   const linha = el('div', null, 'ag-agora'); linha.setAttribute('aria-hidden', 'true');
   const posicionar = () => linha.style.setProperty('top', M.minutosDoDia(Date.now()) / 60 * ALTURA_HORA + 'px');
   posicionar(); colunas[agora].append(linha);
   relogio = setInterval(posicionar, 60000);
  }
  rolar.append(corpo); raiz.append(rolar);
  // Posição inicial: onde a pessoa estava; senão perto de agora (hoje) ou do primeiro evento; senão 7h.
  queueMicrotask(() => {
   if (rolagem !== null) { rolar.scrollTop = rolagem; return; }
   const primeiro = lista.filter(e => !M.diaInteiro(e)).map(e => M.recorteDoDia(e, dias.find(d => M.recorteDoDia(e, d)) || dias[0])).filter(Boolean).map(r => r.ini);
   const alvo = agora >= 0 ? M.minutosDoDia(Date.now()) - 90 : primeiro.length ? Math.min(...primeiro) - 60 : 7 * 60;
   rolar.scrollTop = Math.max(0, alvo / 60 * ALTURA_HORA);
  });
  return raiz;
 }

 // ---------- interação na grade: criar arrastando, mover e esticar ----------
 function ligarInteracao(corpo, colunas, dias, lista) {
  const diaDoX = x => { const i = colunas.findIndex(c => { const r = c.getBoundingClientRect(); return x >= r.left && x < r.right; }); return i < 0 ? (x < colunas[0].getBoundingClientRect().left ? 0 : colunas.length - 1) : i; };
  const minutoDoY = (col, y) => limitar((y - col.getBoundingClientRect().top) / ALTURA_HORA * 60, 0, 1440);
  const mouse = ev => ev.button === 0 && ev.pointerType !== 'touch';

  // Clique simples numa hora vazia: 1h a partir da meia hora anterior (toque e mouse). Arrastar define o intervalo.
  colunas.forEach((col, i) => {
   col.addEventListener('click', ev => {
    if (ev.target !== col) return;
    if (suprimirClique) { suprimirClique = false; return; }
    const ini = Math.floor(minutoDoY(col, ev.clientY) / 30) * 30;
    novo(M.inicioDoDia(dias[i]) + ini * 60000, M.inicioDoDia(dias[i]) + (ini + 60) * 60000);
   });
   col.addEventListener('pointerdown', ev => {
    if (ev.target !== col || !mouse(ev)) return;
    const y0 = ev.clientY, base = M.arredondar(minutoDoY(col, y0) - PASSO / 2, PASSO);
    let fantasma = null, fim = base + MINIMO;
    const mover = m => {
     if (!fantasma && Math.abs(m.clientY - y0) < LIMIAR) return;
     if (!fantasma) { fantasma = el('div', null, 'ag-fantasma'); col.append(fantasma); try { col.setPointerCapture(ev.pointerId); } catch { /* sem captura: segue pelo document */ } }
     const atual = M.arredondar(minutoDoY(col, m.clientY), PASSO);
     const a = Math.min(base, atual), b = Math.max(base + PASSO, atual);
     fim = b;
     estilo(fantasma, { top: a / 60 * ALTURA_HORA + 'px', height: Math.max(b - a, PASSO) / 60 * ALTURA_HORA + 'px' });
     fantasma.dataset.ini = String(a);
    };
    const soltar = () => {
     document.removeEventListener('pointermove', mover); document.removeEventListener('pointerup', soltar); document.removeEventListener('pointercancel', cancelar);
     if (!fantasma) return;
     const a = Number(fantasma.dataset.ini); fantasma.remove(); suprimirClique = true;
     setTimeout(() => { suprimirClique = false; }, 0);
     novo(M.inicioDoDia(dias[i]) + a * 60000, M.inicioDoDia(dias[i]) + Math.max(fim, a + PASSO) * 60000);
    };
    const cancelar = () => { document.removeEventListener('pointermove', mover); document.removeEventListener('pointerup', soltar); document.removeEventListener('pointercancel', cancelar); fantasma?.remove(); };
    document.addEventListener('pointermove', mover); document.addEventListener('pointerup', soltar); document.addEventListener('pointercancel', cancelar);
   });
  });

  corpo.addEventListener('pointerdown', ev => {
   const botaoEvento = ev.target.closest('.ag-evento');
   if (!botaoEvento || !mouse(ev)) return;
   const evento = eventos.find(x => x.id === botaoEvento.dataset.id);
   if (!evento || salvando.has(evento.id)) return;
   const esticar = ev.target.classList.contains('ag-alca');
   const colunaInicial = colunas.indexOf(botaoEvento.parentElement);
   const larg = colunas[0].getBoundingClientRect().width;
   const x0 = ev.clientX, y0 = ev.clientY, altura0 = botaoEvento.getBoundingClientRect().height;
   let arrastando = false, deltaMin = 0, deltaDias = 0;
   const mover = m => {
    if (!arrastando && Math.hypot(m.clientX - x0, m.clientY - y0) < LIMIAR) return;
    if (!arrastando) { arrastando = true; botaoEvento.classList.add(esticar ? 'ag-esticando' : 'ag-arrastando'); }
    deltaMin = M.arredondar((m.clientY - y0) / ALTURA_HORA * 60, PASSO);
    if (esticar) {
     estilo(botaoEvento, { height: Math.max(altura0 + deltaMin / 60 * ALTURA_HORA, PASSO / 60 * ALTURA_HORA) + 'px' });
    } else {
     deltaDias = limitar(diaDoX(m.clientX) - colunaInicial, -colunaInicial, colunas.length - 1 - colunaInicial);
     estilo(botaoEvento, { transform: `translate(${deltaDias * larg}px, ${deltaMin / 60 * ALTURA_HORA}px)` });
    }
   };
   const limpar = () => { document.removeEventListener('pointermove', mover); document.removeEventListener('pointerup', soltar); document.removeEventListener('pointercancel', cancelar); document.removeEventListener('keydown', tecla, true); };   // true: tem de ser a mesma fase do addEventListener, senão o ouvinte fica e engole o Esc da página inteira
   const desfazer = () => { botaoEvento.classList.remove('ag-arrastando', 'ag-esticando'); botaoEvento.style.removeProperty('transform'); };
   const soltar = () => {
    limpar();
    if (!arrastando) return;
    suprimirClique = true; setTimeout(() => { suprimirClique = false; }, 0);
    desfazer();
    if (esticar) { if (deltaMin) gravarHorario(evento, M.redimensionar(evento, evento.fim + deltaMin * 60000)); return; }
    const total = deltaMin + deltaDias * 1440;
    if (total) gravarHorario(evento, M.mover(evento, total));
   };
   const cancelar = () => { limpar(); desfazer(); };
   const tecla = k => { if (k.key === 'Escape') { k.stopPropagation(); cancelar(); } };
   document.addEventListener('pointermove', mover); document.addEventListener('pointerup', soltar); document.addEventListener('pointercancel', cancelar); document.addEventListener('keydown', tecla, true);
   if (esticar) ev.preventDefault();
  });
 }

 // ---------- visão Mês ----------
 function chip(e, inteiro = false) {
  const b = el('button', null, 'ag-chip'); b.type = 'button'; b.dataset.id = e.id; b.dataset.tom = M.TOM_DA_CATEGORIA[e.category]; b.dataset.status = e.status;
  if (inteiro) b.classList.add('ag-chip-dia');
  b.setAttribute('aria-label', descricao(e));
  if (!inteiro && !M.diaInteiro(e)) b.append(el('span', M.hora(e.ini), 'ag-chip-hora'));
  if (e.series_id) b.append(marca(e));
  b.append(el('span', e.title, 'ag-chip-titulo'));
  b.onclick = ev => { ev.stopPropagation(); abrirEvento(e); };
  return b;
 }
 function desenharMes(lista) {
  const raiz = el('div', null, 'ag-mes'); raiz.setAttribute('role', 'region'); raiz.setAttribute('aria-label', 'Calendário do mês');
  const sem = el('div', null, 'ag-mes-sem');
  for (const d of M.semanaDe('2026-10-05')) sem.append(el('span', maiuscula(M.nomeDoDia(d)), 'ag-mes-nome'));
  raiz.append(sem);
  const hojeDia = hoje();
  for (const semana of M.gradeDoMes(estado.dia)) {
   const linha = el('div', null, 'ag-mes-linha');
   for (const d of semana) {
    const celula = el('div', null, 'ag-celula'); celula.dataset.dia = d;
    if (!M.mesmoMes(d, estado.dia)) celula.dataset.fora = '';
    if (d === hojeDia) celula.dataset.hoje = '';
    const num = el('button', String(M.numeroDoDia(d)), 'ag-celula-num'); num.type = 'button';
    num.setAttribute('aria-label', 'Abrir ' + M.titulo('dia', d));
    num.onclick = ev => { ev.stopPropagation(); irPara({ dia: d, visao: 'dia' }); };
    celula.append(num);
    const doDia = M.eventosDoDia(lista, d);
    for (const e of doDia.slice(0, MAX_CHIPS_MES)) celula.append(chip(e, M.diaInteiro(e)));
    if (doDia.length > MAX_CHIPS_MES) {
     const mais = el('button', `+${doDia.length - MAX_CHIPS_MES} mais`, 'ag-mais'); mais.type = 'button';
     mais.onclick = ev => { ev.stopPropagation(); irPara({ dia: d, visao: 'dia' }); };
     celula.append(mais);
    }
    celula.onclick = ev => { if (ev.target === celula) novo(M.inicioDoDia(d) + 9 * 3600000, M.inicioDoDia(d) + 10 * 3600000); };
    linha.append(celula);
   }
   raiz.append(linha);
  }
  return raiz;
 }

 // ---------- visão Agenda (lista) ----------
 function desenharAgenda(lista) {
  const j = M.janela('agenda', estado.dia);
  const grupos = M.agruparPorDia(lista, j.from, j.to);
  const raiz = el('div', null, 'ag-lista'); raiz.setAttribute('role', 'region'); raiz.setAttribute('aria-label', 'Agenda em lista');
  if (!grupos.length) {
   const vazio = el('div', null, 'ag-vazio');
   vazio.append(el('p', dados.activities.length ? 'Nenhuma atividade corresponde aos filtros neste período.' : 'Nada agendado neste período.', 'empty-list'));
   vazio.append(botao('Nova atividade', 'plus', () => novo(), 'secondary'));
   raiz.append(vazio); return raiz;
  }
  const hojeDia = hoje();
  for (const g of grupos) {
   const sec = el('section', null, 'ag-grupo'); sec.dataset.dia = g.dia;
   const cab = el('h3', maiuscula(M.titulo('dia', g.dia)), 'ag-grupo-titulo');
   if (g.dia === hojeDia) cab.append(el('span', 'Hoje', 'ag-hoje-selo'));
   sec.append(cab);
   for (const e of g.eventos) {
    const b = el('button', null, 'ag-linha'); b.type = 'button'; b.dataset.id = e.id; b.dataset.status = e.status; b.setAttribute('aria-label', descricao(e));
    const cor = el('span', null, 'ag-cor'); cor.dataset.tom = M.TOM_DA_CATEGORIA[e.category];
    const quando = M.diaInteiro(e) ? 'Dia todo' : `${M.hora(e.ini)} – ${M.hora(e.fim)}`;
    b.append(el('span', quando, 'ag-linha-hora'), cor, el('strong', e.title, 'ag-linha-titulo'), el('span', [e.tenant_name, e.engagement_label].filter(Boolean).join(' · '), 'ag-linha-empresa'), el('span', M.ROTULOS[e.status], 'ag-linha-situacao'));
    b.onclick = () => abrirEvento(e);
    sec.append(b);
   }
   raiz.append(sec);
  }
  return raiz;
 }

 // ---------- horas e apontamentos (recolhido, abaixo do calendário) ----------
 function desenharHoras() {
  const caixa = partes.horas; caixa.replaceChildren();
  const logs = dados.logs || [];
  const resumo = el('summary', 'Horas e apontamentos do período');
  const corpo = el('div');
  const metricas = el('div', null, 'metrics');
  for (const [nome, valor] of [['Atividades no período', eventos.length], ['Concluídas', eventos.filter(a => a.status === 'done').length], ['Horas registradas', (logs.reduce((s, l) => s + l.minutes, 0) / 60).toLocaleString('pt-BR', { maximumFractionDigits: 1 })]]) {
   const cartao = el('article'); cartao.append(el('span', nome), el('strong', String(valor))); metricas.append(cartao);
  }
  corpo.append(metricas, el('h3', 'Histórico de apontamentos'));
  if (!logs.length) corpo.append(el('p', 'Nenhum apontamento neste período.', 'detail'));
  for (const l of logs) {
   const linha = el('article', null, 'tracking-row');
   linha.append(el('strong', l.title), el('span', `${String(l.worked_on).slice(0, 10).split('-').reverse().join('/')} · ${l.minutes} min`), el('p', l.note));
   corpo.append(linha);
  }
  caixa.append(resumo, corpo);
 }

 // ---------- montagem ----------
 function desenhar() {
  if (!partes.principal?.isConnected) montar();
  desenharTopo(); desenharLateral(); desenharPrincipal();
 }
 function montar() {
  host.replaceChildren();
  const app = el('div', null, 'ag-app');
  partes.topo = el('div', null, 'ag-topo');
  const miolo = el('div', null, 'ag-miolo');
  partes.lateral = el('aside', null, 'ag-lateral');
  partes.principal = el('div', null, 'ag-principal');
  miolo.append(partes.lateral, partes.principal);
  partes.horas = el('details', null, 'ag-horas-resumo');
  app.append(partes.topo, miolo, partes.horas, el('p', 'Agenda interna · Horário de Brasília', 'detail ag-rodape'));
  host.append(app);
 }

 // Atalhos como no Google Calendar: t hoje, d/w/m/a visão, ←/→ período, c nova atividade. Não valem digitando, com diálogo ou painel abertos.
 document.addEventListener('keydown', ev => {
  if (host.hidden || !dados || ev.ctrlKey || ev.metaKey || ev.altKey) return;
  if (/^(INPUT|TEXTAREA|SELECT)$/.test(ev.target.tagName) || ev.target.isContentEditable || document.querySelector('dialog[open]') || painel.aberto()) return;
  const k = ev.key.toLowerCase();
  const visoes = { d: 'dia', w: 'semana', m: 'mes', a: 'agenda' };
  if (k === 't') irPara({ dia: hoje() });
  else if (visoes[k]) irPara({ visao: visoes[k] });
  else if (k === 'arrowleft') irPara({ dia: M.navegar(estado.visao, estado.dia, -1) });
  else if (k === 'arrowright') irPara({ dia: M.navegar(estado.visao, estado.dia, 1) });
  else if (k === 'c') novo();
  else return;
  ev.preventDefault();
 });

 const limpar = () => {
  geracao++; clearInterval(relogio); painel.fechar();
  host.replaceChildren();
  dados = null; eventos = []; tenants = []; aviso = ''; rolagem = null;
  Object.assign(estado, { tenant: '', texto: '', categorias: new Set(), status: '', dia: hoje(), miniMes: hoje() });
  for (const k of Object.keys(partes)) partes[k] = null;
 };
 // Chegada pela ficha da empresa: semana corrente, filtrada por ela, sem busca nem situação herdadas.
 const focar = tenantId => { Object.assign(estado, { tenant: tenantId || '', dia: hoje(), miniMes: hoje(), texto: '', status: '', categorias: new Set() }); };
 return { load: carregar, clear: limpar, focus: focar };
}
