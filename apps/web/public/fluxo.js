import { $, node } from './dom.js';
import { createIcon } from './icons.js';
import { selo } from './data-table.js';
import { lerEndereco } from './espacos-nav.js';

// CRM → Fluxo: cada funil desenhado de ponta a ponta, no mesmo desenho do Kalidash (Tarefas → workflow do funil).
//   Galeria   um card por funil, com os números e a busca.
//   Workflow  a entrada de leads, as etapas e, dentro de cada etapa, as tarefas que ela exige; Ganha e Perdida no fim.
//             Canvas que se arrasta e dá zoom, painel lateral com a estrutura do funil e os editores, e "Seguir registro".
// Tudo vem das rotas que já existiam (funis, etapas, requisitos de etapa, leads, oportunidades e tarefas); aqui só se monta a tela.

const STAGE_W = 300, SRC_W = 220, GAP = 90;
const TIPO_ETAPA = { LEAD: 'Lead', OPEN: 'Aberta', WON: 'Ganha', LOST: 'Perdida' };
const GATE = { ENTER: 'Impede entrar', EXIT: 'Impede sair' };
const TIPO_REQ = { ACTION: 'Tarefa a concluir', FIELD: 'Campo a preencher' };
const CORES = ['#94a3b8', '#64748b', '#f59e0b', '#8b5cf6', '#3b82f6', '#0ea5e9', '#10b981', '#ef4444', '#ec4899'];
const COR_DO_TIPO = { LEAD: '#94a3b8', OPEN: '#f59e0b', WON: '#10b981', LOST: '#ef4444' };
const NS = 'http://www.w3.org/2000/svg';
const plural = (n, um, varios) => `${n} ${n === 1 ? um : varios}`;
const icone = (nome, classe = '') => { const s = node('span', undefined, 'wf-ic ' + classe); s.append(createIcon(nome)); return s; };
const botao = (texto, classe, aoClicar, nomeDoIcone) => { const b = node('button', undefined, classe); b.type = 'button'; if (nomeDoIcone) b.append(icone(nomeDoIcone)); if (texto) b.append(document.createTextNode(texto)); if (aoClicar) b.onclick = aoClicar; return b; };
const guardado = (chave, padrao) => { try { const v = localStorage.getItem(chave); return v == null ? padrao : v; } catch { return padrao; } };
const guardar = (chave, valor) => { try { localStorage.setItem(chave, valor); } catch { /* sem armazenamento: vale só nesta visita */ } };

/** Caminho em degrau com cantos arredondados, como o "smoothstep" do React Flow. */
function degrau(x1, y1, x2, y2, r = 10) {
 if (Math.abs(y2 - y1) < 1) return `M${x1},${y1} H${x2}`;
 const mx = (x1 + x2) / 2, d = y2 > y1 ? 1 : -1, rr = Math.min(r, Math.abs(y2 - y1) / 2, Math.abs(mx - x1));
 return `M${x1},${y1} H${mx - rr} Q${mx},${y1} ${mx},${y1 + d * rr} V${y2 - d * rr} Q${mx},${y2} ${mx + rr},${y2} H${x2}`;
}

/**
 * Canvas que se arrasta (mouse), rola (roda do mouse) e dá zoom (Ctrl/⌘ + roda, ou os botões), com mini-mapa.
 * Os nós são elementos HTML posicionados em coordenadas do gráfico; as ligações são um SVG por baixo deles.
 */
function criarCanvas({ rotulo }) {
 const area = node('div', undefined, 'wf-canvas'); area.setAttribute('role', 'region'); area.setAttribute('aria-label', rotulo);
 const grade = node('div', undefined, 'wf-grade');
 const vp = node('div', undefined, 'wf-viewport');
 const svg = document.createElementNS(NS, 'svg'); svg.setAttribute('class', 'wf-arestas'); svg.setAttribute('width', '1'); svg.setAttribute('height', '1');
 svg.innerHTML = '<defs><marker id="wf-seta" viewBox="0 0 10 10" refX="9" refY="5" markerWidth="8" markerHeight="8" orient="auto-start-reverse"><path d="M0 0 L10 5 L0 10 z" fill="currentColor"/></marker></defs>';
 vp.append(svg);
 const controles = node('div', undefined, 'wf-controles');
 const mapa = node('div', undefined, 'wf-minimapa'); mapa.setAttribute('aria-hidden', 'true');
 const janela = node('div', undefined, 'wf-minimapa-janela'); mapa.append(janela);
 area.append(grade, vp, controles, mapa);
 let v = { x: 24, y: 24, z: 0.85 }, nos = [], arestas = [], limites = { x: 0, y: 0, w: 1, h: 1 }, arrasto = null, moveu = false;
 const Z_MIN = 0.25, Z_MAX = 1.4, limitar = z => Math.min(Z_MAX, Math.max(Z_MIN, z));

 const medir = () => { const r = area.getBoundingClientRect(); return { w: r.width || 800, h: r.height || 500 }; };
 const aplicar = () => {
  vp.style.transform = `translate(${v.x}px, ${v.y}px) scale(${v.z})`;
  grade.style.backgroundSize = `${20 * v.z}px ${20 * v.z}px`; grade.style.backgroundPosition = `${v.x}px ${v.y}px`;
  const { w, h } = medir(), s = Math.min(150 / limites.w, 90 / limites.h);
  janela.style.cssText = `left:${(-v.x / v.z - limites.x) * s + 5}px;top:${(-v.y / v.z - limites.y) * s + 5}px;width:${(w / v.z) * s}px;height:${(h / v.z) * s}px`;
 };
 const animar = () => { vp.classList.add('is-anim'); setTimeout(() => vp.classList.remove('is-anim'), 400); };
 const zoomEm = (fator, cx, cy) => {
  const z = limitar(v.z * fator), k = z / v.z;
  v = { z, x: cx - (cx - v.x) * k, y: cy - (cy - v.y) * k }; aplicar();
 };

 function desenharArestas() {
  svg.querySelectorAll('path.wf-aresta').forEach(p => p.remove());
  const por = new Map(nos.map(n => [n.id, n]));
  for (const a of arestas) {
   const de = por.get(a.de), para = por.get(a.para); if (!de || !para) continue;
   const p = document.createElementNS(NS, 'path');
   p.setAttribute('class', 'wf-aresta' + (a.ativa ? ' is-ativa' : '') + (a.tracejada ? ' is-tracejada' : ''));
   p.setAttribute('d', degrau(de.x + de.el.offsetWidth, de.y + de.el.offsetHeight / 2, para.x, para.y + para.el.offsetHeight / 2));
   p.setAttribute('marker-end', 'url(#wf-seta)');
   svg.append(p);
  }
 }
 function desenharMapa() {
  mapa.querySelectorAll('.wf-minimapa-no').forEach(e => e.remove());
  if (!nos.length) return;
  const xs = nos.map(n => n.x), ys = nos.map(n => n.y), x2 = nos.map(n => n.x + n.el.offsetWidth), y2 = nos.map(n => n.y + n.el.offsetHeight);
  limites = { x: Math.min(...xs), y: Math.min(...ys), w: Math.max(...x2) - Math.min(...xs) || 1, h: Math.max(...y2) - Math.min(...ys) || 1 };
  const s = Math.min(150 / limites.w, 90 / limites.h);
  for (const n of nos) { const e = node('i', undefined, 'wf-minimapa-no'); e.style.cssText = `left:${(n.x - limites.x) * s + 5}px;top:${(n.y - limites.y) * s + 5}px;width:${n.el.offsetWidth * s}px;height:${n.el.offsetHeight * s}px`; mapa.insertBefore(e, janela); }
  aplicar();
 }
 const observador = typeof ResizeObserver === 'function' ? new ResizeObserver(() => { desenharArestas(); desenharMapa(); }) : null;

 const ajustar = () => {
  const { w, h } = medir(); if (!nos.length) return;
  const z = limitar(Math.min((w - 80) / limites.w, (h - 80) / limites.h, 1));
  v = { z, x: (w - limites.w * z) / 2 - limites.x * z, y: Math.max(24, (h - limites.h * z) / 2 - limites.y * z) }; animar(); aplicar();
 };
 controles.append(
  botao('', 'wf-controle', () => { const { w, h } = medir(); animar(); zoomEm(1.25, w / 2, h / 2); }, 'plus'),
  botao('', 'wf-controle', () => { const { w, h } = medir(); animar(); zoomEm(0.8, w / 2, h / 2); }, 'minus'),
  botao('', 'wf-controle', ajustar, 'maximize'));
 [['Aproximar'], ['Afastar'], ['Ajustar à tela']].forEach(([t], i) => { controles.children[i].setAttribute('aria-label', t); controles.children[i].title = t; });

 area.addEventListener('pointerdown', e => {
  if (e.button !== 0 || e.target.closest('button,input,select,textarea,a,.wf-controles,.wf-minimapa')) return;
  arrasto = { x: e.clientX, y: e.clientY, vx: v.x, vy: v.y }; moveu = false;
 });
 addEventListener('pointermove', e => {
  if (!arrasto) return;
  const dx = e.clientX - arrasto.x, dy = e.clientY - arrasto.y;
  if (!moveu && Math.hypot(dx, dy) < 4) return;
  moveu = true; area.classList.add('is-pan'); v.x = arrasto.vx + dx; v.y = arrasto.vy + dy; aplicar();
 });
 addEventListener('pointerup', () => { arrasto = null; area.classList.remove('is-pan'); setTimeout(() => { moveu = false; }, 0); });
 // Depois de arrastar, o clique que fecha o gesto não pode abrir o nó que estava embaixo do mouse.
 area.addEventListener('click', e => { if (moveu) { e.stopPropagation(); e.preventDefault(); } }, true);
 area.addEventListener('wheel', e => {
  e.preventDefault();
  if (e.ctrlKey || e.metaKey) { const r = area.getBoundingClientRect(); zoomEm(Math.exp(-e.deltaY * 0.0025), e.clientX - r.left, e.clientY - r.top); }
  else { v.x -= e.deltaX; v.y -= e.deltaY; aplicar(); }
 }, { passive: false });
 mapa.addEventListener('click', e => {
  const s = Math.min(150 / limites.w, 90 / limites.h), r = mapa.getBoundingClientRect(), { w, h } = medir();
  const gx = (e.clientX - r.left - 5) / s + limites.x, gy = (e.clientY - r.top - 5) / s + limites.y;
  animar(); v.x = w / 2 - gx * v.z; v.y = h / 2 - gy * v.z; aplicar();
 });

 return {
  el: area,
  /** Troca os nós e as ligações mantendo o ponto de vista. `lista`: [{ id, x, y, el }]; `liga`: [{ de, para, ativa, tracejada }]. */
  definir(lista, liga, { primeiraVez = false } = {}) {
   observador?.disconnect();
   nos.forEach(n => n.el.remove());
   nos = lista; arestas = liga;
   for (const n of nos) { n.el.style.left = `${n.x}px`; n.el.style.top = `${n.y}px`; vp.append(n.el); observador?.observe(n.el); }
   requestAnimationFrame(() => { desenharArestas(); desenharMapa(); if (primeiraVez) aplicar(); });
  },
  focar(id) {
   const n = nos.find(x => x.id === id); if (!n) return;
   const { w, h } = medir(), z = Math.max(v.z, 0.85);
   animar(); v = { z, x: w / 2 - (n.x + n.el.offsetWidth / 2) * z, y: h / 2 - (n.y + Math.min(n.el.offsetHeight, 360) / 2) * z }; aplicar();
  },
  ajustar,
  destruir() { observador?.disconnect(); },
 };
}

export function setupFluxo({ api, reportError, abrirConexoes }) {
 let geracao = 0, funis = [], requisitos = new Map(), donos = [], campos = [], selId = '', painel = null, seguido = null, seguirAberto = false;
 let busca = '', filtroEspaco = '', dockAberto = guardado('core.wf-dock', '1') !== '0', canvas = null, concluidos = new Set(), formNovoFunil = false;
 const host = () => $('view-fluxo');
 const funilAtual = () => funis.find(f => f.id === selId) || null;
 const reqsDe = f => requisitos.get(f.id) || [];
 const idxEtapa = (f, id) => f.stages.findIndex(s => s.id === id);
 const erro = e => { const alvo = $('wf-dock-erro') || host(); alvo.querySelector('[data-erro]')?.remove(); const p = node('p', e.message, 'notice-inline'); p.setAttribute('role', 'alert'); p.dataset.erro = '1'; alvo.prepend(p); };

 // ---------- dados ----------
 async function buscarFunis() {
  funis = ((await api('/api/commercial/pipelines')).pipelines || []).filter(f => f.is_active);
  await Promise.all(funis.map(async f => { requisitos.set(f.id, (await api('/api/commercial/stage-requirements?pipeline_id=' + f.id).catch(() => ({ requirements: [] }))).requirements); }));
 }
 async function carregar() {
  const ticket = ++geracao;
  host().replaceChildren(node('p', 'Carregando funis…', 'detail'));
  try {
   await buscarFunis();
   if (ticket !== geracao) return;
   donos = (await api('/api/commercial/owners').catch(() => ({ owners: [] }))).owners;
   const sub = lerEndereco(location.hash)?.sub || '';
   selId = funis.some(f => f.id === sub) ? sub : '';
   painel = null; seguido = null; concluidos = new Set();
   if (selId) await carregarCampos();
  } catch (e) { if (ticket === geracao) host().replaceChildren(node('p', e.message, 'notice-inline')); return; }
  desenhar();
 }
 async function carregarCampos() { const f = funilAtual(); campos = f ? (await api('/api/commercial/space-fields?space_id=' + encodeURIComponent(f.space_id)).catch(() => ({ fields: [] }))).fields : []; }
 async function recarregar() {
  await buscarFunis();
  if (!funilAtual()) { selId = ''; history.replaceState(null, '', location.pathname + location.search + '#/geral/fluxo'); }
  desenhar({ manterCanvas: true });
 }
 function abrirFunil(id) { selId = id; painel = null; seguido = null; concluidos = new Set(); history.pushState(null, '', `${location.pathname}${location.search}#/geral/fluxo/${id}`); carregarCampos().finally(() => desenhar()); }
 function voltar() { selId = ''; painel = null; canvas = null; history.pushState(null, '', `${location.pathname}${location.search}#/geral/fluxo`); desenhar(); }

 // ---------- galeria ----------
 function galeria() {
  const raiz = node('div', undefined, 'fx-galeria'); raiz.dataset.modo = 'galeria';
  const barra = node('div', undefined, 'fx-barra');
  const q = node('input'); q.type = 'search'; q.placeholder = 'Buscar funil ou oferta…'; q.value = busca; q.setAttribute('aria-label', 'Buscar funil');
  const esp = node('select'); esp.setAttribute('aria-label', 'Espaço');
  const espacos = [...new Map(funis.map(f => [f.space_id, f.space_name])).entries()];
  for (const [id, nome] of [['', 'Todos os espaços'], ...espacos]) { const o = node('option', nome); o.value = id; esp.append(o); }
  esp.value = filtroEspaco;
  const grade = node('div', undefined, 'fx-grade');
  const pintar = () => {
   const t = busca.trim().toLowerCase();
   const lista = funis.filter(f => (!filtroEspaco || f.space_id === filtroEspaco) && (!t || `${f.name} ${f.offer_name || ''} ${f.space_name}`.toLowerCase().includes(t)));
   grade.replaceChildren();
   if (!lista.length) { grade.append(node('p', funis.length ? 'Nenhum funil com esses filtros.' : 'Nenhum funil ainda. Crie o primeiro em "Novo funil".', 'empty-list')); return; }
   for (const f of lista) {
    const registros = f.stages.reduce((n, s) => n + s.leads + s.opportunities, 0);
    const tarefas = reqsDe(f).filter(r => r.is_active).length;
    const card = node('button', undefined, 'fx-card'); card.type = 'button'; card.onclick = () => abrirFunil(f.id);
    const cab = node('div', undefined, 'fx-card-cab'); const nomes = node('div'); nomes.append(node('span', f.name, 'fx-card-titulo'), node('span', [f.space_name, f.offer_name].filter(Boolean).join(' · '), 'detail'));
    cab.append(nomes, ...(f.is_default ? [selo('Padrão', 'accent')] : []));
    const nums = node('div', undefined, 'fx-card-nums');
    for (const [n, rot] of [[registros, 'registros'], [f.stages.length, 'etapas'], [tarefas, 'tarefas']]) { const d = node('div'); d.append(node('strong', String(n)), node('span', rot)); nums.append(d); }
    const cta = node('div', undefined, 'fx-card-cta'); cta.append(document.createTextNode('Ver workflow'), icone('chevron-right'));
    card.append(cab, nums, cta); grade.append(card);
   }
  };
  q.oninput = () => { busca = q.value; pintar(); };
  esp.onchange = () => { filtroEspaco = esp.value; pintar(); };
  const novo = botao('Novo funil', formNovoFunil ? 'secondary' : 'primary', () => { formNovoFunil = !formNovoFunil; desenhar(); }, formNovoFunil ? undefined : 'plus'); novo.classList.add('fx-novo');
  barra.append(q, esp, novo);
  pintar();
  raiz.append(barra);
  if (formNovoFunil) raiz.append(formularioDeFunil());
  raiz.append(grade);
  return raiz;
 }

 function formularioDeFunil() {
  const form = node('form', undefined, 'commercial-form au-form');
  form.append(node('h3', 'Novo funil'));
  const espacos = [...new Map(funis.map(f => [f.space_id, f.space_name])).entries()];
  const rEsp = node('label', 'Espaço'), sel = node('select'); for (const [id, nome] of espacos) { const o = node('option', nome); o.value = id; sel.append(o); } rEsp.append(sel); form.append(rEsp);
  const rNome = node('label', 'Nome do funil'), nome = node('input'); nome.required = true; nome.maxLength = 120; rNome.append(nome); form.append(rNome);
  const rOf = node('label', 'Oferta (o que este funil vende, opcional)'), oferta = node('input'); oferta.maxLength = 160; rOf.append(oferta); form.append(rOf);
  form.append(node('small', 'Nasce com as etapas básicas (Novos, Qualificação, Ganho e Perdido). Depois você desenha o resto no workflow.', 'detail'));
  const enviar = node('button', 'Criar funil', 'primary'); enviar.type = 'submit'; form.append(enviar);
  form.onsubmit = async e => {
   e.preventDefault(); enviar.disabled = true;
   const slug = nome.value.toLowerCase().normalize('NFD').replace(/\p{M}/gu, '').replace(/[^a-z0-9]+/g, '-').replace(/^-+|-+$/g, '').slice(0, 60) || 'funil';
   try { const r = await api('/api/commercial/pipelines', 'POST', { space_id: sel.value, slug, name: nome.value, offer_name: oferta.value.trim() || null }); formNovoFunil = false; await buscarFunis(); abrirFunil(r.id); }
   catch (err) { form.querySelector('[role=alert]')?.remove(); const p = node('p', err.message, 'notice-inline'); p.setAttribute('role', 'alert'); form.append(p); enviar.disabled = false; }
  };
  return form;
 }

 // ---------- workflow ----------
 function estadoDoRequisito(f, r) {
  if (!seguido) return null;
  const atual = idxEtapa(f, seguido.stageId), idx = idxEtapa(f, r.stage_id), feito = concluidos.has(r.title);
  if (idx < atual) return 'done';
  if (idx === atual) return feito ? 'done' : (r.gate === 'EXIT' ? 'blocking' : 'pending');
  if (idx === atual + 1 && r.gate === 'ENTER' && !feito) return 'blocking';
  return 'todo';
 }

 function noDaEtapa(f, s) {
  const reqs = reqsDe(f).filter(r => r.stage_id === s.id);
  const atual = seguido ? idxEtapa(f, seguido.stageId) : -1, idx = idxEtapa(f, s.id);
  const estado = seguido ? (idx < atual ? 'done' : idx === atual ? 'current' : 'todo') : '';
  const registros = s.leads + s.opportunities;
  const el = node('div', undefined, `wf-no wf-etapa ${estado ? 'is-' + estado : ''} ${painel?.etapaId === s.id && !painel?.reqId ? 'is-selected' : ''}`); el.style.width = `${STAGE_W}px`; el.dataset.no = s.id;
  const cab = node('div', undefined, 'wf-cab'); cab.style.borderTopColor = s.color || COR_DO_TIPO[s.kind]; cab.setAttribute('role', 'button'); cab.tabIndex = 0; cab.setAttribute('aria-label', `Configurar a etapa ${s.name}`);
  cab.onclick = () => abrirPainel({ modo: 'etapa', etapaId: s.id }); cab.onkeydown = e => { if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); cab.click(); } };
  const t = node('div', undefined, 'wf-titulo'), esq = node('div', undefined, 'wf-titulo-esq'), ponto = node('i', undefined, 'wf-ponto'); ponto.style.background = s.color || COR_DO_TIPO[s.kind];
  esq.append(ponto, node('strong', s.name)); if (estado === 'done') esq.append(icone('check', 'wf-ok'));
  t.append(esq, icone('settings', 'wf-engrenagem'));
  cab.append(t, node('span', [TIPO_ETAPA[s.kind], s.probability != null ? `${s.probability}%` : null, s.stale_days ? `alerta em ${s.stale_days}d` : null].filter(Boolean).join(' · '), 'wf-sub'));
  const cont = node('div', undefined, 'wf-contagens'); cont.append(selo(plural(registros, 'registro', 'registros'), 'neutral')); cab.append(cont);
  const corpo = node('div', undefined, 'wf-corpo');
  if (!reqs.length) corpo.append(node('div', 'Nenhuma tarefa nesta etapa.', 'wf-vazio'));
  for (const r of reqs) {
   const rs = estadoDoRequisito(f, r);
   const b = node('button', undefined, `wf-req ${rs ? 'is-' + rs : ''} ${r.is_active ? '' : 'is-off'} ${painel?.reqId === r.id ? 'is-selected' : ''}`); b.type = 'button';
   b.onclick = () => abrirPainel({ modo: 'req', etapaId: s.id, reqId: r.id });
   b.append(icone(rs === 'done' ? 'check' : rs === 'blocking' ? 'alert' : r.kind === 'FIELD' ? 'file-input' : 'circle-dot', 'wf-req-icone'));
   const principal = node('span', undefined, 'wf-req-principal'), meta = node('span', undefined, 'wf-req-meta');
   meta.append(selo(r.tag, 'accent'));
   const dono = donos.find(d => d.id === r.owner_id); if (dono) { const a = node('span', undefined, 'wf-dono'); a.append(icone('user'), document.createTextNode(dono.name || dono.email)); meta.append(a); }
   if (r.due_days != null) meta.append(node('span', `${r.due_days} d`));
   if (!r.is_active) meta.append(node('span', 'desligada'));
   principal.append(node('span', r.title, 'wf-req-titulo'), meta); b.append(principal);
   if (r.gate) { const lock = node('span', undefined, 'wf-cadeado'); lock.title = GATE[r.gate]; lock.append(icone('lock'), node('span', r.gate === 'ENTER' ? 'Entrar' : 'Sair')); b.append(lock); }
   corpo.append(b);
  }
  if (s.kind === 'LEAD' || s.kind === 'OPEN') corpo.append(botao('Adicionar tarefa', 'wf-adicionar', () => abrirPainel({ modo: 'novaReq', etapaId: s.id }), 'plus'));
  el.append(cab, corpo);
  return el;
 }

 function noDaEntrada() {
  const el = node('div', undefined, `wf-no wf-entrada ${painel?.modo === 'entrada' ? 'is-selected' : ''}`); el.style.width = `${SRC_W}px`; el.dataset.no = 'entrada';
  el.setAttribute('role', 'button'); el.tabIndex = 0; el.onclick = () => abrirPainel({ modo: 'entrada' }); el.onkeydown = e => { if (e.key === 'Enter') el.click(); };
  el.append(icone('plug', 'wf-entrada-icone'));
  const t = node('div', undefined, 'wf-pilha'); t.append(node('strong', 'Entrada de leads'), node('span', 'Site, SDK, API e cadastro manual', 'wf-sub')); el.append(t);
  return el;
 }

 function grafo(f) {
  const principais = f.stages.filter(s => s.kind === 'LEAD' || s.kind === 'OPEN'), ganha = f.stages.find(s => s.kind === 'WON'), perdida = f.stages.find(s => s.kind === 'LOST');
  const x0 = SRC_W + GAP, nos = [{ id: 'entrada', x: 0, y: 0, el: noDaEntrada() }];
  principais.forEach((s, i) => nos.push({ id: s.id, x: x0 + i * (STAGE_W + GAP), y: 0, el: noDaEtapa(f, s) }));
  const fimX = x0 + principais.length * (STAGE_W + GAP);
  if (ganha) nos.push({ id: ganha.id, x: fimX, y: 0, el: noDaEtapa(f, ganha) });
  if (perdida) nos.push({ id: perdida.id, x: fimX, y: 190, el: noDaEtapa(f, perdida) });
  const atual = seguido ? idxEtapa(f, seguido.stageId) : -1, passou = id => seguido && idxEtapa(f, id) <= atual;
  const liga = [];
  if (principais[0]) liga.push({ de: 'entrada', para: principais[0].id, ativa: Boolean(seguido) });
  principais.forEach((s, i) => { const prox = principais[i + 1] || ganha; if (prox) liga.push({ de: s.id, para: prox.id, ativa: passou(prox.id) }); });
  const ultima = principais[principais.length - 1]; if (ultima && perdida) liga.push({ de: ultima.id, para: perdida.id, tracejada: true, ativa: Boolean(seguido) && seguido.stageId === perdida.id });
  return { nos, liga };
 }

 function workflow() {
  const f = funilAtual();
  const raiz = node('div', undefined, 'wf-fullscreen'); raiz.dataset.modo = 'workflow';
  const barra = node('div', undefined, 'wf-barra');
  const titulos = node('div', undefined, 'wf-barra-titulos');
  titulos.append(botao('Fluxo', 'wf-voltar', voltar, 'arrow-up'), node('h1', f.name), node('p', [f.space_name, f.offer_name].filter(Boolean).join(' · '), 'detail'));
  titulos.firstChild.firstChild.firstChild.style.transform = 'rotate(-90deg)';
  const acoes = node('div', undefined, 'wf-barra-acoes');
  const seguir = node('div', undefined, 'wf-seguir'); seguir.append(node('span', 'Seguir registro:', 'detail'));
  const sb = botao(seguido ? seguido.name : 'Escolher', seguido ? 'secondary is-solido' : 'secondary', () => { seguirAberto = true; painel = null; dockAberto = true; desenhar({ manterCanvas: true }); }, 'search');
  seguir.append(sb);
  if (seguido) seguir.append(Object.assign(botao('', 'quiet', () => { seguido = null; concluidos = new Set(); desenhar({ manterCanvas: true }); }, 'x'), { title: 'Parar de seguir' }));
  acoes.append(seguir, botao('Nova etapa', 'secondary', () => abrirPainel({ modo: 'novaEtapa' }), 'plus'), botao('Configurar', 'secondary', () => abrirPainel({ modo: 'funil' }), 'settings'),
   Object.assign(botao('Painel', 'secondary', () => { dockAberto = !dockAberto; guardar('core.wf-dock', dockAberto ? '1' : '0'); desenhar({ manterCanvas: true }); }, dockAberto ? 'panel-right-close' : 'panel-right-open'), { title: dockAberto ? 'Recolher o painel lateral' : 'Abrir o painel lateral' }));
  acoes.lastChild.setAttribute('aria-pressed', String(dockAberto));
  barra.append(titulos, acoes);
  raiz.append(barra);
  if (seguido) {
   const faixa = node('div', undefined, 'wf-faixa'); const atual = f.stages.find(s => s.id === seguido.stageId);
   const txt = node('span'); txt.append(document.createTextNode('Seguindo '), node('strong', seguido.name), document.createTextNode(` (${seguido.kind === 'opportunity' ? 'Oportunidade' : 'Lead'}) · Etapa atual: `), node('strong', atual?.name || '—'));
   faixa.append(txt, botao('Limpar destaque', 'wf-limpar', () => { seguido = null; concluidos = new Set(); desenhar({ manterCanvas: true }); })); raiz.append(faixa);
  }
  const principal = node('div', undefined, 'wf-principal');
  const primeiraVez = !canvas;
  canvas ??= criarCanvas({ rotulo: `Workflow de ${f.name}` });
  const { nos, liga } = grafo(f);
  canvas.definir(nos, liga, { primeiraVez });
  const dock = node('aside', undefined, 'wf-dock' + (dockAberto ? ' open' : '')); dock.setAttribute('aria-label', 'Painel do funil'); dock.setAttribute('aria-hidden', String(!dockAberto));
  const erroBox = node('div'); erroBox.id = 'wf-dock-erro'; dock.append(erroBox);
  if (seguirAberto) dock.append(painelSeguir(f));
  else if (painel) dock.append(painelAberto(f));
  else dock.append(inspetor(f));
  principal.append(canvas.el, dock);
  raiz.append(principal);
  return raiz;
 }

 function abrirPainel(p) { painel = p; seguirAberto = false; dockAberto = true; desenhar({ manterCanvas: true }); }
 function fecharPainel() { painel = null; seguirAberto = false; desenhar({ manterCanvas: true }); }

 // ---------- painel lateral: estrutura ----------
 function secao(titulo, n, aoAdicionar, rotuloAdicionar, corpoFn) {
  const s = node('section', undefined, 'wf-insp-secao'), cab = node('header', undefined, 'wf-insp-cab');
  let aberta = true; const corpo = node('div', undefined, 'wf-insp-corpo');
  const alterna = node('button', undefined, 'wf-insp-alterna'); alterna.type = 'button'; alterna.setAttribute('aria-expanded', 'true');
  const seta = icone('chevron-down'); alterna.append(seta, node('span', titulo), node('span', String(n), 'tab-count'));
  alterna.onclick = () => { aberta = !aberta; alterna.setAttribute('aria-expanded', String(aberta)); corpo.hidden = !aberta; seta.replaceChildren(createIcon(aberta ? 'chevron-down' : 'chevron-right')); };
  cab.append(alterna); if (aoAdicionar) cab.append(botao(rotuloAdicionar, 'secondary wf-mini', aoAdicionar, 'plus'));
  corpoFn(corpo); s.append(cab, corpo); return s;
 }
 function lixeira(rotulo, aviso, desabilitada, dica, confirmar) {
  const b = node('button', undefined, 'wf-lixeira'); b.type = 'button'; b.append(icone('trash-2')); b.setAttribute('aria-label', `Remover ${rotulo}`); b.title = desabilitada ? dica : `Remover ${rotulo}`; b.disabled = Boolean(desabilitada);
  b.onclick = () => {
   const caixa = node('span', undefined, 'wf-confirma'); caixa.setAttribute('role', 'group'); caixa.setAttribute('aria-label', `Confirmar a remoção de ${rotulo}`);
   const ok = botao('Remover', 'secondary wf-mini is-perigo', () => confirmar().catch(erro)); ok.title = aviso || '';
   caixa.append(ok, Object.assign(botao('', 'quiet', () => caixa.replaceWith(b), 'x'), { title: 'Cancelar' })); b.replaceWith(caixa);
  };
  return b;
 }
 function inspetor(f) {
  const frag = node('div', undefined, 'wf-painel');
  const cab = node('header', undefined, 'wf-painel-cab'); const t = node('div'); t.append(node('h2', 'Estrutura do funil'), node('p', 'Etapas e tarefas. Clique para ver e editar, e crie ou remova daqui. O painel fica aberto enquanto você arrasta e dá zoom.', 'detail')); cab.append(t);
  const corpo = node('div', undefined, 'wf-painel-corpo');
  corpo.append(secao('Entrada', 1, null, '', c => {
   const l = node('div', undefined, 'wf-linha'); const p = botao('', 'wf-principal-linha', () => { canvas?.focar('entrada'); abrirPainel({ modo: 'entrada' }); }); p.append(icone('plug', 'wf-linha-icone'));
   const tx = node('span', undefined, 'wf-linha-texto'); tx.append(node('span', 'Entrada de leads', 'wf-linha-titulo'), node('span', 'Site, SDK, API e cadastro manual', 'wf-linha-meta')); p.append(tx); l.append(p); c.append(l);
  }));
  corpo.append(secao('Etapas', f.stages.length, () => abrirPainel({ modo: 'novaEtapa' }), 'Nova etapa', c => {
   f.stages.forEach(s => {
    const registros = s.leads + s.opportunities, mesmo = f.stages.filter(x => x.kind === s.kind), i = mesmo.indexOf(s);
    const impede = registros > 0 ? 'Mova os registros antes de excluir a etapa' : mesmo.length <= 1 ? 'O funil precisa de ao menos uma etapa de cada tipo' : '';
    const l = node('div', undefined, 'wf-linha' + (painel?.etapaId === s.id && !painel?.reqId ? ' is-selected' : ''));
    const p = botao('', 'wf-principal-linha', () => { canvas?.focar(s.id); abrirPainel({ modo: 'etapa', etapaId: s.id }); });
    const ponto = node('i', undefined, 'wf-ponto'); ponto.style.background = s.color || COR_DO_TIPO[s.kind]; p.append(ponto);
    const nReq = reqsDe(f).filter(r => r.stage_id === s.id).length, tx = node('span', undefined, 'wf-linha-texto');
    tx.append(node('span', s.name, 'wf-linha-titulo'), node('span', `${TIPO_ETAPA[s.kind]} · ${plural(registros, 'registro', 'registros')} · ${plural(nReq, 'tarefa', 'tarefas')}`, 'wf-linha-meta')); p.append(tx);
    const ordem = node('span', undefined, 'wf-ordem');
    const mover = (nomeIcone, aria, delta) => { const b = botao('', 'quiet', async () => { try { await api(`/api/commercial/pipelines/${f.id}/stages/${s.id}`, 'PUT', { position: i + delta }); await recarregar(); } catch (e) { erro(e); } }, nomeIcone); b.setAttribute('aria-label', `${aria} ${s.name}`); b.disabled = i + delta < 0 || i + delta >= mesmo.length; return b; };
    ordem.append(mover('arrow-up', 'Subir', -1), mover('arrow-down', 'Descer', 1));
    l.append(p, ordem, lixeira(s.name, 'As tarefas desta etapa deixam de valer.', impede, impede, async () => { await api(`/api/commercial/pipelines/${f.id}/stages/${s.id}`, 'DELETE'); painel = null; await recarregar(); }));
    c.append(l);
   });
  }));
  corpo.append(secao('Tarefas', reqsDe(f).length, null, '', c => {
   f.stages.forEach(s => {
    const lista = reqsDe(f).filter(r => r.stage_id === s.id), pode = s.kind === 'LEAD' || s.kind === 'OPEN';
    if (!lista.length && !pode) return;
    const g = node('div', undefined, 'wf-grupo'), gc = node('div', undefined, 'wf-grupo-cab'); const ponto = node('i', undefined, 'wf-ponto'); ponto.style.background = s.color || COR_DO_TIPO[s.kind];
    gc.append(ponto, node('span', s.name, 'wf-grupo-nome')); if (pode) gc.append(botao('Tarefa', 'quiet wf-mini', () => abrirPainel({ modo: 'novaReq', etapaId: s.id }), 'plus')); g.append(gc);
    if (!lista.length) g.append(node('p', 'Nenhuma tarefa nesta etapa.', 'wf-vazio'));
    for (const r of lista) {
     const l = node('div', undefined, 'wf-linha' + (painel?.reqId === r.id ? ' is-selected' : '') + (r.is_active ? '' : ' is-off'));
     const p = botao('', 'wf-principal-linha', () => { canvas?.focar(s.id); abrirPainel({ modo: 'req', etapaId: s.id, reqId: r.id }); }); p.append(icone(r.kind === 'FIELD' ? 'file-input' : 'circle-dot', 'wf-linha-icone'));
     const dono = donos.find(d => d.id === r.owner_id), tx = node('span', undefined, 'wf-linha-texto');
     tx.append(node('span', r.title, 'wf-linha-titulo'), node('span', [r.tag, dono ? dono.name || dono.email : null, r.due_days != null ? `${r.due_days} d` : null, r.is_active ? null : 'desligada'].filter(Boolean).join(' · '), 'wf-linha-meta')); p.append(tx);
     l.append(p); if (r.gate) l.append(selo(r.gate === 'ENTER' ? 'Entrar' : 'Sair', 'warning'));
     const liga = botao(r.is_active ? 'Desligar' : 'Ligar', 'quiet wf-mini', async () => { try { await api('/api/commercial/stage-requirements/' + r.id, 'PUT', { version: r.version, is_active: !r.is_active }); await recarregar(); } catch (e) { erro(e); } });
     l.append(liga); g.append(l);
    }
    c.append(g);
   });
  }));
  frag.append(cab, corpo);
  return frag;
 }

 // ---------- painel lateral: editores ----------
 function moldura(titulo, subtitulo, corpo, rodape) {
  const m = node('div', undefined, 'wf-painel'), cab = node('header', undefined, 'wf-painel-cab'), t = node('div');
  t.append(node('h2', titulo), ...(subtitulo ? [node('p', subtitulo, 'detail')] : [])); const fechar = botao('', 'quiet', fecharPainel, 'x'); fechar.title = 'Fechar'; fechar.setAttribute('aria-label', 'Fechar o painel'); cab.append(t, fechar);
  const c = node('div', undefined, 'wf-painel-corpo'); c.append(corpo); m.append(cab, c);
  if (rodape) { const r = node('footer', undefined, 'wf-painel-rodape'); r.append(...rodape); m.append(r); }
  return m;
 }
 const campo = (rotulo, el, ajuda) => { const l = node('label', rotulo); l.append(el); if (ajuda) l.append(node('small', ajuda, 'detail')); return l; };
 const entrada = (tipo = 'text', valor = '', extra = {}) => { const i = node('input'); i.type = tipo; i.value = valor ?? ''; Object.assign(i, extra); return i; };
 const lista = (pares, valor) => { const s = node('select'); for (const [v, t] of pares) { const o = node('option', t); o.value = v; s.append(o); } if (valor != null) s.value = valor; return s; };
 function cores(inicial) {
  const caixa = node('div', undefined, 'wf-cores'); let atual = inicial;
  const pintar = () => caixa.querySelectorAll('button').forEach(b => b.setAttribute('aria-pressed', String(b.dataset.cor === atual)));
  for (const c of CORES) { const b = node('button'); b.type = 'button'; b.dataset.cor = c; b.style.background = c; b.setAttribute('aria-label', `Cor ${c}`); b.onclick = () => { atual = c; pintar(); }; caixa.append(b); }
  pintar(); return { caixa, valor: () => atual };
 }

 function painelAberto(f) {
  const etapa = f.stages.find(s => s.id === painel.etapaId);
  if (painel.modo === 'entrada') return painelEntrada(f);
  if (painel.modo === 'funil') return painelFunil(f);
  if (painel.modo === 'novaEtapa') return painelNovaEtapa(f);
  if (painel.modo === 'etapa' && etapa) return painelEtapa(f, etapa);
  if (painel.modo === 'novaReq' && etapa) return painelRequisito(f, etapa, null);
  if (painel.modo === 'req' && etapa) { const r = reqsDe(f).find(x => x.id === painel.reqId); if (r) return painelRequisito(f, etapa, r); }
  painel = null; return inspetor(f);
 }

 function painelEntrada(f) {
  const c = node('div', undefined, 'wf-entrada-info');
  c.append(node('p', 'Todo lead entra neste funil por um destes caminhos. A etapa de entrada é a primeira do tipo Lead.', 'detail'));
  for (const [t, d] of [['Site e SDK', 'O script do Core captura os formulários do site e manda cada envio para o Inbound, com os UTMs do anúncio.'], ['API de intake', 'Sistemas próprios mandam o lead com uma chave de API do espaço.'], ['Cadastro manual', 'A equipe cadastra o lead direto no Inbound.']]) { const b = node('div', undefined, 'wf-entrada-item'); b.append(node('strong', t), node('span', d, 'detail')); c.append(b); }
  const rod = [botao('Abrir as conexões do espaço', 'primary', () => abrirConexoes?.(f.space_id), 'plug')];
  return moldura('Entrada de leads', `${f.space_name} · ${f.name}`, c, rod);
 }

 function painelFunil(f) {
  const form = node('form', undefined, 'commercial-form wf-form');
  const nome = entrada('text', f.name, { required: true, maxLength: 120 }), oferta = entrada('text', f.offer_name || '', { maxLength: 160 });
  form.append(campo('Nome do funil', nome), campo('Oferta', oferta, 'O que este funil vende.'));
  const acoesDoFunil = node('div', undefined, 'wf-acoes');
  if (!f.is_default) acoesDoFunil.append(botao('Tornar padrão do espaço', 'secondary', async () => { try { await api('/api/commercial/pipelines/' + f.id, 'PUT', { version: f.version, is_default: true }); await recarregar(); } catch (e) { erro(e); } }));
  acoesDoFunil.append(botao('Arquivar funil', 'secondary is-perigo', async () => { if (!window.confirm(`Arquivar "${f.name}"? Ele some da lista, e nada é apagado.`)) return; try { await api('/api/commercial/pipelines/' + f.id, 'PUT', { version: f.version, is_active: false }); painel = null; selId = ''; history.pushState(null, '', `${location.pathname}${location.search}#/geral/fluxo`); await buscarFunis(); canvas = null; desenhar(); } catch (e) { erro(e); } }));
  form.append(acoesDoFunil);
  const salvar = botao('Salvar', 'primary', () => form.requestSubmit());
  form.onsubmit = async e => { e.preventDefault(); salvar.disabled = true; try { await api('/api/commercial/pipelines/' + f.id, 'PUT', { version: f.version, name: nome.value, offer_name: oferta.value.trim() || null }); painel = null; await recarregar(); } catch (err) { erro(err); salvar.disabled = false; } };
  return moldura('Configurar funil', `${f.space_name}${f.is_default ? ' · funil padrão' : ''}`, form, [salvar, botao('Cancelar', 'quiet', fecharPainel)]);
 }

 function painelNovaEtapa(f) {
  const form = node('form', undefined, 'commercial-form wf-form');
  const nome = entrada('text', '', { required: true, maxLength: 80 });
  const tem = k => f.stages.some(s => s.kind === k);
  const tipo = lista([['LEAD', 'Lead'], ['OPEN', 'Aberta'], ...(tem('WON') ? [] : [['WON', 'Ganha']]), ...(tem('LOST') ? [] : [['LOST', 'Perdida']])], 'OPEN');
  const cor = cores(COR_DO_TIPO.OPEN); tipo.onchange = () => { cor.caixa.querySelector(`[data-cor="${COR_DO_TIPO[tipo.value]}"]`)?.click(); };
  const chance = entrada('number', '50', { min: '0', max: '100' }), parado = entrada('number', '14', { min: '1', max: '3650' });
  const posicao = lista([['end', 'No fim do tipo'], ['start', 'No começo do tipo']], 'end');
  form.append(campo('Nome da etapa', nome), campo('Tipo', tipo, 'Ganha e Perdida só existem uma vez por funil.'), campo('Cor', cor.caixa), campo('Chance de ganhar (%)', chance), campo('Avisar após (dias parado)', parado), campo('Posição', posicao));
  const criar = botao('Criar etapa', 'primary', () => form.requestSubmit());
  form.onsubmit = async e => {
   e.preventDefault(); criar.disabled = true;
   try {
    const r = await api(`/api/commercial/pipelines/${f.id}/stages`, 'POST', { name: nome.value, kind: tipo.value, color: cor.valor(), probability: Number(chance.value), stale_days: Number(parado.value) });
    if (posicao.value === 'start') await api(`/api/commercial/pipelines/${f.id}/stages/${r.id}`, 'PUT', { position: 0 });
    painel = null; await recarregar();
   } catch (err) { erro(err); criar.disabled = false; }
  };
  return moldura('Nova etapa', f.name, form, [criar, botao('Cancelar', 'quiet', fecharPainel)]);
 }

 function painelEtapa(f, s) {
  const form = node('form', undefined, 'commercial-form wf-form');
  const nome = entrada('text', s.name, { required: true, maxLength: 80 }), cor = cores(s.color || COR_DO_TIPO[s.kind]);
  const chance = entrada('number', String(s.probability ?? 50), { min: '0', max: '100' }), parado = entrada('number', String(s.stale_days ?? 14), { min: '1', max: '3650' });
  form.append(campo('Nome', nome), campo('Tipo', Object.assign(entrada('text', TIPO_ETAPA[s.kind]), { disabled: true }), 'O tipo não muda depois de criada.'), campo('Cor', cor.caixa), campo('Chance de ganhar (%)', chance), campo('Avisar após (dias parado)', parado));
  const salvar = botao('Salvar etapa', 'primary', () => form.requestSubmit());
  form.onsubmit = async e => { e.preventDefault(); salvar.disabled = true; try { await api(`/api/commercial/pipelines/${f.id}/stages/${s.id}`, 'PUT', { name: nome.value, color: cor.valor(), probability: Number(chance.value), stale_days: Number(parado.value) }); painel = null; await recarregar(); } catch (err) { erro(err); salvar.disabled = false; } };
  return moldura('Configurar etapa', `${s.name} · ${f.name}`, form, [salvar, botao('Cancelar', 'quiet', fecharPainel)]);
 }

 function painelRequisito(f, s, r) {
  const form = node('form', undefined, 'commercial-form wf-form'), edicao = Boolean(r);
  const titulo = entrada('text', r?.title || '', { required: true, maxLength: 200 }), tag = entrada('text', r?.tag || 'Geral', { maxLength: 40 });
  const gate = lista(Object.entries(GATE), r?.gate || 'ENTER'), tipo = lista(Object.entries(TIPO_REQ), r?.kind || 'ACTION');
  const fase = s.kind === 'LEAD' ? 'lead' : 'opportunity', doTipo = campos.filter(x => x.entity === fase && x.is_active);
  const campoSel = lista(doTipo.map(x => [x.key, x.label]), r?.field_key), dono = lista([['', 'Sem responsável'], ...donos.map(d => [d.id, d.name || d.email])], r?.owner_id || ''), prazo = entrada('number', r?.due_days ?? '', { min: '0', max: '365' });
  form.append(campo('Tarefa', titulo), campo('Tag', tag, 'Agrupa as tarefas e aparece no cartão.'));
  if (edicao) { form.append(campo('Quando', Object.assign(entrada('text', GATE[r.gate]), { disabled: true })), campo('Exige', Object.assign(entrada('text', TIPO_REQ[r.kind]), { disabled: true }), 'Quando e o que se exige não mudam depois de criada: crie outra e desligue esta.')); }
  else form.append(campo('Quando', gate), campo('Exige', tipo));
  const rCampo = campo('Campo', campoSel, doTipo.length ? 'O campo do cadastro que precisa estar preenchido.' : 'Este espaço ainda não tem campo ativo para este tipo de registro. Crie em Inbound → Campos.');
  const rDono = campo('Responsável', dono), rPrazo = campo('Prazo (dias)', prazo);
  form.append(rCampo, rDono, rPrazo);
  const sincroniza = () => { const eCampo = (r?.kind || tipo.value) === 'FIELD'; rCampo.hidden = !eCampo; rDono.hidden = rPrazo.hidden = eCampo; salvar.disabled = !edicao && eCampo && !doTipo.length; };
  tipo.onchange = sincroniza;
  const salvar = botao(edicao ? 'Salvar tarefa' : 'Adicionar tarefa', 'primary', () => form.requestSubmit());
  sincroniza();
  form.onsubmit = async e => {
   e.preventDefault(); salvar.disabled = true;
   try {
    if (edicao) await api('/api/commercial/stage-requirements/' + r.id, 'PUT', { version: r.version, title: titulo.value, tag: tag.value || 'Geral', ...(r.kind === 'ACTION' ? { owner_id: dono.value || null, due_days: prazo.value === '' ? null : Number(prazo.value) } : {}) });
    else {
     const eCampo = tipo.value === 'FIELD';
     await api('/api/commercial/stage-requirements', 'POST', { pipeline_id: f.id, stage_id: s.id, gate: gate.value, kind: tipo.value, title: titulo.value, tag: tag.value || 'Geral', ...(eCampo ? { field_key: campoSel.value } : { ...(prazo.value !== '' ? { due_days: Number(prazo.value) } : {}), ...(dono.value ? { owner_id: dono.value } : {}) }) });
    }
    painel = null; await recarregar();
   } catch (err) { erro(err); salvar.disabled = false; }
  };
  const rodape = [salvar, botao('Cancelar', 'quiet', fecharPainel)];
  if (edicao) rodape.push(botao(r.is_active ? 'Desligar' : 'Ligar', 'secondary', async () => { try { await api('/api/commercial/stage-requirements/' + r.id, 'PUT', { version: r.version, is_active: !r.is_active }); painel = null; await recarregar(); } catch (err) { erro(err); } }));
  return moldura(edicao ? 'Configurar tarefa' : 'Nova tarefa', `${s.name} · ${f.name}`, form, rodape);
 }

 // ---------- seguir um registro ----------
 function painelSeguir(f) {
  const corpo = node('div', undefined, 'wf-seguir-corpo'), q = entrada('search', '', { placeholder: 'Pesquisar por nome ou empresa…' }); q.setAttribute('aria-label', 'Pesquisar registro'); q.autofocus = true;
  const resultados = node('div', undefined, 'wf-resultados');
  corpo.append(q, botao('Nenhum (visão geral do funil)', seguido ? 'secondary' : 'primary', () => { seguido = null; concluidos = new Set(); seguirAberto = false; desenhar({ manterCanvas: true }); }), resultados);
  let temporizador;
  const buscarRegistros = async () => {
   resultados.replaceChildren(node('p', 'Buscando…', 'detail'));
   try {
    const termo = q.value.trim();
    const [{ leads }, { opportunities }] = await Promise.all([
     api(`/api/commercial/leads?pipeline_id=${f.id}&limit=30${termo ? '&q=' + encodeURIComponent(termo) : ''}`),
     api(`/api/commercial/opportunities?pipeline_id=${f.id}&limit=30`),
    ]);
    const itens = [
     ...leads.map(l => ({ kind: 'lead', id: l.id, name: l.name, stageId: l.stage_id, sub: `${l.stage_name || 'Lead'}${l.organization_name ? ' · ' + l.organization_name : ''}` })),
     ...opportunities.filter(o => !termo || `${o.title} ${o.organization_name}`.toLowerCase().includes(termo.toLowerCase())).map(o => ({ kind: 'opportunity', id: o.id, name: o.title, stageId: o.stage_id, sub: `${o.stage_name} · ${o.organization_name}` })),
    ];
    resultados.replaceChildren();
    if (!itens.length) resultados.append(node('p', 'Nenhum registro neste funil.', 'empty-list'));
    for (const it of itens) {
     const b = botao('', 'wf-resultado', async () => {
      seguido = it; seguirAberto = false;
      try { const { tasks } = await api(`/api/commercial/tasks?${it.kind === 'lead' ? 'lead_id' : 'opportunity_id'}=${it.id}`); concluidos = new Set(tasks.filter(t => t.done_at).map(t => t.title)); } catch { concluidos = new Set(); }
      desenhar({ manterCanvas: true }); canvas?.focar(it.stageId);
     });
     b.append(node('strong', it.name), node('span', `${it.kind === 'opportunity' ? 'Oportunidade' : 'Lead'} · ${it.sub}`, 'detail')); resultados.append(b);
    }
   } catch (e) { resultados.replaceChildren(node('p', e.message, 'notice-inline')); }
  };
  q.oninput = () => { clearTimeout(temporizador); temporizador = setTimeout(buscarRegistros, 250); };
  buscarRegistros();
  return moldura('Seguir um registro no funil', 'Escolha um lead ou oportunidade para ver o caminho percorrido e o estado das tarefas dele.', corpo);
 }

 // ---------- entrada ----------
 function desenhar({ manterCanvas = false } = {}) {
  const raiz = host(); if (!raiz) return;
  if (!manterCanvas || !selId) { canvas?.destruir(); canvas = null; }
  if (!funis.length) { raiz.replaceChildren(node('p', 'Nenhum espaço tem funil ainda. Crie um espaço com a capacidade comercial para desenhar funis.', 'empty-list')); return; }
  const emWorkflow = Boolean(selId && funilAtual());
  raiz.replaceChildren(emWorkflow ? workflow() : galeria());
  document.body.classList.toggle('wf-aberto', emWorkflow);   // tira o título da página e a margem só enquanto o workflow está aberto
 }

 return {
  load: () => carregar().catch(reportError),
  clear() { geracao++; funis = []; requisitos = new Map(); selId = ''; painel = null; seguido = null; seguirAberto = false; canvas?.destruir(); canvas = null; document.body.classList.remove('wf-aberto'); host()?.replaceChildren(); },
 };
}
