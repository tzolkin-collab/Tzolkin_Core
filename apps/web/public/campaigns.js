// Campanhas de marketing — apresentação.
//
// Nada aqui decide atribuição: o vínculo é gravado no servidor, com autor e
// trilha. A tela mostra a sugestão por nome como SUGESTÃO, num tom diferente
// do vínculo confirmado — porque custo atribuído por palpite vira margem falsa.
//
// O token nunca chega até aqui. Esta tela recebe validade, escopos e impressão
// digital; com isso dá para operar sem a credencial sair do servidor.
import { createIcon } from './icons.js';

const el = (tag, text, cls) => {
 const n = document.createElement(tag);
 if (text !== undefined) n.textContent = text;
 if (cls) n.className = cls;
 return n;
};

// Centavos inteiros → moeda. A conversão para decimal acontece só na exibição.
export function dinheiro(centavos, moeda = 'BRL') {
 if (centavos == null) return '—';
 const valor = Number(centavos) / 100;
 try {
  return valor.toLocaleString('pt-BR', { style: 'currency', currency: (moeda || 'BRL').toUpperCase() });
 } catch { return `${(moeda || '').toUpperCase()} ${valor.toFixed(2)}`; }
}

const numero = v => (v == null ? '—' : Number(v).toLocaleString('pt-BR'));

// Custo por resultado só existe quando houve resultado. Dividir por zero e
// mostrar "∞" seria pior que não mostrar.
export function custoPor(centavos, quantidade, moeda) {
 if (!quantidade || centavos == null) return null;
 return dinheiro(Math.round(Number(centavos) / Number(quantidade)), moeda);
}

const ESTADOS = {
 ACTIVE: ['ativa', 'ready'], PAUSED: ['pausada', 'building'], ARCHIVED: ['arquivada', ''],
 DELETED: ['excluída', 'error'], IN_PROCESS: ['processando', 'building'],
 WITH_ISSUES: ['com problemas', 'error'], CAMPAIGN_PAUSED: ['pausada', 'building'],
 ADSET_PAUSED: ['conjunto pausado', 'building'], PENDING_REVIEW: ['em revisão', 'building'],
 DISAPPROVED: ['reprovada', 'error'],
};

const SERVICE_MODELS = {
 on_demand: 'Sob demanda', education: 'Mentoria', consulting: 'Consultoria',
 advisory: 'Assessoria', product: 'Produto', unclassified: 'A classificar',
};

export function setupCampaigns({ api, onError = () => {} }) {
 let dados = null, alvos = null, carregando = false, periodo = { since: null, until: null };

 const host = id => document.getElementById(id);

 // ---------------------------------------------------------------------------
 // Saúde da credencial: a parte que evita a coleta parar em silêncio
 // ---------------------------------------------------------------------------
 function cartaoCredencial() {
  const card = el('section', undefined, 'campaign-credential');
  if (!dados?.configured) {
   card.classList.add('empty');
   card.append(createIcon('alert'));
   const corpo = el('div');
   corpo.append(
    el('h3', 'Nenhuma credencial da Meta conectada'),
    el('p', 'A conexão é feita no servidor, não por esta tela — o token não deve passar pelo navegador.'));
   const passo = el('code', 'npm run marketing:connect', 'campaign-cmd');
   corpo.append(passo);
   corpo.append(el('small', 'Use marketing:exchange se o seu token ainda for de curta duração.'));
   card.append(corpo);
   return card;
  }

  const cabecalho = el('div', undefined, 'campaign-credential-head');
  cabecalho.append(el('strong', dados.label));
  const tipo = dados.token_type === 'system_user' ? 'Usuário do Sistema' : 'Token de longa duração';
  cabecalho.append(el('span', tipo, 'detail'));

  // O estado que importa: quantos dias faltam.
  let rotulo, classe;
  if (dados.never_expires) { rotulo = 'Não expira'; classe = 'status ready'; }
  else if (dados.expired) { rotulo = 'Expirado'; classe = 'status error'; }
  else if (dados.expiring_soon) { rotulo = `Expira em ${dados.days_remaining} dias`; classe = 'status error'; }
  else { rotulo = `${dados.days_remaining} dias restantes`; classe = 'status ready'; }
  cabecalho.append(el('span', rotulo, classe));
  card.append(cabecalho);

  const fatos = el('dl', undefined, 'campaign-facts');
  const fato = (chave, valor) => { fatos.append(el('dt', chave), el('dd', valor)); };
  fato('Impressão digital', dados.fingerprint);
  fato('Escopos', (dados.scopes || []).join(', ') || '—');
  fato('Última conferência', dados.last_verified_at ? new Date(dados.last_verified_at).toLocaleString('pt-BR') : 'nunca');
  card.append(fatos);

  if (!dados.can_read_ads) {
   const aviso = el('p', undefined, 'notice-inline');
   aviso.append(createIcon('alert'), el('span', 'Este token não tem `ads_read`. A coleta de campanhas não vai funcionar até ele ser reconectado com essa permissão.'));
   card.append(aviso);
  }
  if (dados.last_error) card.append(el('p', dados.last_error, 'notice-inline'));

  const acoes = el('div', undefined, 'campaign-actions');
  const conferir = el('button', 'Conferir na Meta', 'secondary');
  conferir.type = 'button';
  conferir.onclick = async () => {
   conferir.disabled = true; conferir.textContent = 'Conferindo…';
   try {
    const estado = await api('/api/marketing/credential?verify=1');
    dados = { ...dados, ...estado };
    render();
   } catch (e) { onError(e); conferir.disabled = false; conferir.textContent = 'Conferir na Meta'; }
  };
  const coletar = el('button', 'Coletar campanhas', 'primary');
  coletar.type = 'button';
  coletar.onclick = async () => {
   coletar.disabled = true; coletar.textContent = 'Coletando…';
   try {
    const r = await api('/api/marketing/sync', 'POST');
    await load(periodo);
    if (r.status === 'partial') onError(new Error('Coleta parcial: ' + (r.error || 'a Meta interrompeu a leitura.')));
   } catch (e) { onError(e); }
   finally { coletar.disabled = false; coletar.textContent = 'Coletar campanhas'; }
  };
  acoes.append(conferir, coletar);
  card.append(acoes);
  return card;
 }

 // ---------------------------------------------------------------------------
 // Resumo do período
 // ---------------------------------------------------------------------------
 function resumo(sumario, moeda) {
  const grid = el('section', undefined, 'campaign-summary');
  const kpi = (rotulo, valor, extra) => {
   const c = el('div', undefined, 'campaign-kpi');
   c.append(el('span', rotulo, 'overview-kicker'), el('strong', valor));
   if (extra) c.append(el('small', extra));
   grid.append(c);
  };
  kpi('Investido', dinheiro(sumario.spend_cents, moeda), `${sumario.campaigns} campanhas`);
  kpi('Impressões', numero(sumario.impressions));
  kpi('Cliques', numero(sumario.clicks), custoPor(sumario.spend_cents, sumario.clicks, moeda) && `${custoPor(sumario.spend_cents, sumario.clicks, moeda)} por clique`);
  kpi('Leads', numero(sumario.leads), custoPor(sumario.spend_cents, sumario.leads, moeda) && `${custoPor(sumario.spend_cents, sumario.leads, moeda)} por lead`);
  if (sumario.unassigned_spend_cents) {
   const c = el('div', undefined, 'campaign-kpi warn');
   c.append(el('span', 'SEM DONO', 'overview-kicker'),
    el('strong', dinheiro(sumario.unassigned_spend_cents, moeda)),
    el('small', 'gasto que ainda não foi atribuído a produto ou contratação'));
   grid.append(c);
  }
  return grid;
 }

 // ---------------------------------------------------------------------------
 // Uma campanha
 // ---------------------------------------------------------------------------
 function linhaCampanha(c, { comVinculo = true } = {}) {
  const item = el('article', undefined, 'campaign-row');
  const topo = el('div', undefined, 'campaign-row-head');
  const [rotuloEstado, classeEstado] = ESTADOS[c.effective_status] || [c.effective_status || 'desconhecido', ''];
  topo.append(el('strong', c.name || c.external_id), el('span', rotuloEstado, 'status ' + classeEstado));
  item.append(topo);

  const metricas = el('div', undefined, 'campaign-metrics');
  const m = (rotulo, valor) => { const n = el('div'); n.append(el('span', rotulo, 'detail'), el('strong', valor)); metricas.append(n); };
  m('Investido', dinheiro(c.spend_cents, c.currency));
  m('Impressões', numero(c.impressions));
  m('Cliques', numero(c.clicks));
  m('Leads', numero(c.leads));
  if (c.daily_budget_cents) m('Orçamento/dia', dinheiro(c.daily_budget_cents, c.currency));
  item.append(metricas);

  const rodape = el('div', undefined, 'campaign-row-foot');
  rodape.append(el('small', `${c.account_name || c.account_external_id}${c.dias ? ` · ${c.dias} dias com dado` : ' · sem dado no período'}`, 'detail'));

  if (comVinculo) {
   if (c.product_id || c.engagement_id) {
    const dono = el('span', undefined, 'campaign-binding');
    dono.append(createIcon('check'));
    if (c.product_id) dono.append(el('span', `Produto · ${c.product_name || c.product_id}`));
    else dono.append(el('span', `${SERVICE_MODELS[c.service_model] || 'Contratação'} · ${c.tenant_name} — ${c.engagement_label}`));
    rodape.append(dono);
    const trocar = el('button', 'Alterar', 'link-button');
    trocar.type = 'button'; trocar.onclick = () => abrirVinculo(c);
    rodape.append(trocar);
   } else {
    const vincular = el('button', 'Atribuir a produto ou contratação', 'secondary');
    vincular.type = 'button'; vincular.onclick = () => abrirVinculo(c);
    rodape.append(vincular);
   }
  }
  item.append(rodape);
  return item;
 }

 // ---------------------------------------------------------------------------
 // Atribuição
 // ---------------------------------------------------------------------------
 async function abrirVinculo(campanha) {
  const dialog = document.getElementById('campaign-binding-dialog');
  if (!dialog) return;
  const form = dialog.querySelector('form');
  form.reset();
  dialog.querySelector('.campaign-binding-name').textContent = campanha.name || campanha.external_id;
  const erro = form.querySelector('.form-error');
  erro.textContent = '';

  try { alvos = await api(`/api/marketing/targets?campaign_id=${encodeURIComponent(campanha.external_id)}`); }
  catch (e) { onError(e); return; }

  const seletor = form.querySelector('select[name="target"]');
  seletor.replaceChildren();
  const vazio = el('option', 'Sem atribuição (desvincular)'); vazio.value = '';
  seletor.append(vazio);

  const grupoP = el('optgroup'); grupoP.label = 'Produtos';
  for (const p of alvos.products) {
   const o = el('option', p.name); o.value = `product:${p.id}`; grupoP.append(o);
  }
  if (alvos.products.length) seletor.append(grupoP);

  // Contratações agrupadas pelo que o usuário chama de contexto: sob demanda,
  // mentoria, assessoria e consultoria são coisas diferentes e aparecem separadas.
  const porModelo = {};
  for (const e of alvos.engagements) (porModelo[e.service_model] ||= []).push(e);
  for (const [modelo, lista] of Object.entries(porModelo)) {
   const g = el('optgroup'); g.label = SERVICE_MODELS[modelo] || modelo;
   for (const e of lista) {
    const o = el('option', `${e.tenant_name} — ${e.label}`); o.value = `engagement:${e.id}`; g.append(o);
   }
   seletor.append(g);
  }

  // Sugestão é conselho, não preenchimento silencioso: a tela diz que é palpite.
  const dica = form.querySelector('.campaign-suggestion');
  if (alvos.suggestion && !campanha.product_id && !campanha.engagement_id) {
   dica.hidden = false;
   dica.replaceChildren(el('span', `Sugestão pelo nome: ${alvos.suggestion.label}. Confirme — o Core não atribui sozinho.`));
   const aplicar = el('button', 'Usar sugestão', 'link-button');
   aplicar.type = 'button';
   aplicar.onclick = () => {
    seletor.value = alvos.suggestion.kind === 'product'
     ? `product:${alvos.suggestion.product_id}` : `engagement:${alvos.suggestion.engagement_id}`;
   };
   dica.append(aplicar);
  } else dica.hidden = true;

  if (campanha.product_id) seletor.value = `product:${campanha.product_id}`;
  else if (campanha.engagement_id) seletor.value = `engagement:${campanha.engagement_id}`;

  form.onsubmit = async evento => {
   evento.preventDefault();
   const escolha = seletor.value;
   const corpo = { product_id: null, engagement_id: null, note: form.querySelector('[name="note"]').value || null };
   if (escolha.startsWith('product:')) corpo.product_id = escolha.slice(8);
   else if (escolha.startsWith('engagement:')) corpo.engagement_id = escolha.slice(11);
   try {
    await api(`/api/marketing/campaigns/${encodeURIComponent(campanha.external_id)}/binding`, 'PUT', corpo);
    dialog.close();
    await load(periodo);
   } catch (e) { erro.textContent = e.message; }
  };
  dialog.showModal();
 }

 // ---------------------------------------------------------------------------
 // Render da tela geral
 // ---------------------------------------------------------------------------
 function render() {
  const root = host('view-campaigns');
  if (!root) return;
  root.replaceChildren();

  const capa = el('section', undefined, 'campaign-hero');
  const titulo = el('div');
  titulo.append(el('span', 'AQUISIÇÃO', 'overview-kicker'), el('h2', 'Campanhas'),
   el('p', 'O que foi investido em anúncios, e a que produto ou contratação esse investimento pertence.'));
  capa.append(titulo);
  root.append(capa);

  root.append(cartaoCredencial());
  if (!dados?.configured) return;

  if (carregando) { root.append(el('p', 'Carregando…', 'email-empty')); return; }

  const moeda = dados.accounts?.[0]?.currency || 'BRL';
  if (dados.summary) root.append(resumo(dados.summary, moeda));

  if (dados.last_sync) {
   const s = dados.last_sync;
   const linha = el('p', undefined, 'detail');
   linha.textContent = `Última coleta: ${new Date(s.started_at).toLocaleString('pt-BR')} · ${s.status === 'ok' ? 'completa' : s.status === 'partial' ? 'parcial' : 'falhou'} · ${s.campaigns_seen} campanhas`;
   root.append(linha);
  } else {
   root.append(el('p', 'Nenhuma coleta executada ainda. Use "Coletar campanhas" acima.', 'email-empty'));
  }

  if (!dados.campaigns?.length) {
   if (dados.last_sync) root.append(el('p', 'Nenhuma campanha encontrada no período.', 'email-empty'));
   return;
  }

  // Sem dono vem primeiro: é a pendência que a tela existe para cobrar.
  const semDono = dados.campaigns.filter(c => !c.product_id && !c.engagement_id);
  const comDono = dados.campaigns.filter(c => c.product_id || c.engagement_id);

  if (semDono.length) {
   const bloco = el('section', undefined, 'campaign-group');
   bloco.append(el('h3', `Sem atribuição (${semDono.length})`));
   bloco.append(el('p', 'Enquanto estiverem aqui, esse gasto não entra no custo de nenhum produto nem de nenhuma contratação.', 'detail'));
   for (const c of semDono) bloco.append(linhaCampanha(c));
   root.append(bloco);
  }
  if (comDono.length) {
   const bloco = el('section', undefined, 'campaign-group');
   bloco.append(el('h3', `Atribuídas (${comDono.length})`));
   for (const c of comDono) bloco.append(linhaCampanha(c));
   root.append(bloco);
  }
 }

 // ---------------------------------------------------------------------------
 // Contexto de produto e de contratação
 // ---------------------------------------------------------------------------
 function renderContexto(seletorHost, resposta, titulo, subtitulo) {
  const root = host(seletorHost);
  if (!root) return;
  root.replaceChildren();
  const capa = el('section', undefined, 'campaign-hero');
  const t = el('div');
  t.append(el('span', 'AQUISIÇÃO', 'overview-kicker'), el('h2', titulo), el('p', subtitulo));
  capa.append(t);
  root.append(capa);

  if (!resposta?.campaigns?.length) {
   const vazio = el('div', undefined, 'email-empty');
   vazio.append(createIcon('layers'),
    el('h3', 'Nenhuma campanha atribuída'),
    el('p', 'Abra Campanhas no espaço de trabalho e atribua os anúncios que pertencem a este contexto.'));
   root.append(vazio);
   return;
  }
  const moeda = resposta.campaigns[0]?.currency || 'BRL';
  root.append(resumo(resposta.summary, moeda));
  const bloco = el('section', undefined, 'campaign-group');
  for (const c of resposta.campaigns) bloco.append(linhaCampanha(c, { comVinculo: false }));
  root.append(bloco);
 }

 async function load(janela = {}) {
  carregando = true;
  periodo = janela;
  const q = new URLSearchParams();
  if (janela.since) q.set('since', janela.since);
  if (janela.until) q.set('until', janela.until);
  try {
   dados = await api('/api/marketing/overview' + (q.toString() ? `?${q}` : ''));
  } finally { carregando = false; }
  render();
  return dados;
 }

 async function loadProduct(produto) {
  const r = await api(`/api/products/${encodeURIComponent(produto.id)}/campaigns`);
  renderContexto('view-product-campaigns', r, `Campanhas de ${produto.name || produto.id}`,
   'Investimento em anúncios atribuído a este produto.');
  return r;
 }

 async function loadService(engagementId, rotulo = 'esta contratação') {
  const r = await api(`/api/services/${encodeURIComponent(engagementId)}/campaigns`);
  renderContexto('view-service-campaigns', r, `Campanhas de ${rotulo}`,
   'Investimento em anúncios atribuído a esta contratação.');
  return r;
 }

 return { load, loadProduct, loadService, render, get data() { return dados; } };
}
