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

// Retorno do OAuth da Meta. O servidor põe só um código curto na URL — nunca a
// mensagem do provedor — e o texto mora aqui.
const AVISOS = {
 ok: ['ok', 'Conta da Meta conectada. Agora rode a coleta para trazer as campanhas.'],
 scope: ['warn', 'Conectado, mas a autorização veio sem permissão de leitura de anúncios (ads_read). Reconecte e mantenha essa permissão marcada.'],
 denied: ['warn', 'A autorização foi cancelada na Meta. Nada foi gravado.'],
 expired: ['warn', 'A autorização expirou ou já tinha sido usada. Tente conectar de novo.'],
 invalid: ['error', 'A Meta devolveu um token inválido. Tente conectar de novo.'],
 config: ['error', 'O servidor não tem META_APP_ID e META_APP_SECRET configurados.'],
 error: ['error', 'Não foi possível concluir a conexão com a Meta. Tente de novo.'],
};

export function setupCampaigns({ api, onError = () => {} }) {
 let dados = null, alvos = null, carregando = false, periodo = { since: null, until: null };
 let aviso = null;

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
    el('p', 'Conecte um token de Usuário do Sistema (não expira) ou de longa duração. Ele é cifrado no servidor e nunca volta para esta tela.'));
   // Sem a chave de cifragem não há onde guardar com segurança. Dizer isso
   // antes é melhor do que aceitar o token e falhar ao gravar.
   if (dados && dados.key_configured === false) {
    const aviso = el('div', undefined, 'campaign-key-missing');
    aviso.append(el('strong', 'Falta a chave de cifragem no servidor.'),
     el('p', 'Defina META_MARKETING_KEY no ambiente do serviço e reinicie o Core. Gere o valor com:'),
     el('code', `node -e "console.log(require('node:crypto').randomBytes(32).toString('base64'))"`, 'campaign-cmd'));
    corpo.append(aviso);
   }
   const acoes = el('div', undefined, 'campaign-actions');
   // OAuth primeiro: é o caminho em que ninguém copia nem vê o token.
   if (dados?.oauth_available) {
    const facebook = el('button', 'Conectar com Facebook', 'primary');
    facebook.type = 'button';
    facebook.disabled = dados?.key_configured === false;
    facebook.onclick = () => conectarComFacebook(facebook);
    acoes.append(facebook);
   }
   const conectar = el('button', dados?.oauth_available ? 'Colar token manualmente' : 'Conectar token',
    dados?.oauth_available ? 'secondary' : 'primary');
   conectar.type = 'button';
   conectar.disabled = dados?.key_configured === false;
   conectar.onclick = () => abrirCredencial();
   acoes.append(conectar);
   corpo.append(acoes);
   if (dados && !dados.oauth_available) {
    corpo.append(el('small', 'Para conectar com o Facebook em um clique, defina META_APP_ID e META_APP_SECRET no servidor.'));
   }
   corpo.append(el('small', 'Também dá para conectar pelo servidor, com npm run marketing:connect.'));
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
  const via = { oauth: ' (Facebook Login)', panel: ' (token colado no painel)', script: ' (servidor)' }[dados.connected_via] || '';
  if (dados.connected_by) fato('Conectado por', dados.connected_by + via);
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
  const substituir = el('button', dados.oauth_available ? 'Colar outro token' : 'Substituir token', 'secondary');
  substituir.type = 'button';
  substituir.onclick = () => abrirCredencial();
  // Token de usuário expira em ~60 dias e a Meta não renova sozinha: reconectar
  // é um clique, e vira ação principal quando a contagem aperta.
  if (dados.oauth_available) {
   const reconectar = el('button', 'Reconectar com Facebook', dados.expiring_soon || dados.expired ? 'primary' : 'secondary');
   reconectar.type = 'button';
   reconectar.onclick = () => conectarComFacebook(reconectar);
   acoes.append(reconectar);
  }
  acoes.append(substituir, conferir, coletar);
  card.append(acoes);
  return card;
 }

 // ---------------------------------------------------------------------------
 // Conectar credencial pelo painel
 // ---------------------------------------------------------------------------
 // OAuth: o servidor cria o state e devolve o endereço da Meta; o navegador só
 // navega. O token volta direto para o servidor, sem passar por esta tela.
 async function conectarComFacebook(botao) {
  const rotulo = botao.textContent;
  botao.disabled = true; botao.textContent = 'Abrindo a Meta…';
  try {
   const { url } = await api('/api/marketing/meta/authorize', 'POST');
   // Só segue para a Meta: um endereço inesperado na resposta não vira navegação.
   const destino = new URL(url);
   if (destino.protocol !== 'https:' || !/(^|\.)facebook\.com$/.test(destino.hostname))
    throw new Error('Endereço de autorização inesperado.');
   location.assign(destino.href);
  } catch (e) { onError(e); botao.disabled = false; botao.textContent = rotulo; }
 }

 function abrirCredencial() {
  const dialog = document.getElementById('marketing-credential-dialog');
  if (!dialog) return;
  const form = dialog.querySelector('form');
  form.reset();
  const erro = form.querySelector('.form-error');
  erro.textContent = '';
  const aviso = form.querySelector('.marketing-key-warning');
  aviso.hidden = dados?.key_configured !== false;
  if (!aviso.hidden) aviso.textContent = 'META_MARKETING_KEY não está definida no servidor. A gravação vai falhar até ela existir.';

  const enviar = form.querySelector('button.primary');
  form.onsubmit = async evento => {
   evento.preventDefault();
   erro.textContent = '';
   const dados0 = new FormData(form);
   const corpo = {
    token: String(dados0.get('token') || ''),
    label: String(dados0.get('label') || 'Meta Ads'),
    exchange: dados0.get('exchange') === 'on',
    app_id: String(dados0.get('app_id') || '') || null,
    app_secret: String(dados0.get('app_secret') || '') || null,
   };
   enviar.disabled = true; enviar.textContent = 'Conectando…';
   try {
    await api('/api/marketing/credential', 'POST', corpo);
    // Limpa os campos sensíveis antes de fechar, para o token não ficar no DOM.
    form.reset();
    dialog.close();
    await load(periodo);
   } catch (e) { erro.textContent = e.message; }
   finally { enviar.disabled = false; enviar.textContent = 'Conectar'; }
  };
  dialog.showModal();
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

  // Resultado de um fluxo que voltou da Meta. Aparece uma vez.
  if (aviso) {
   const nota = el('p', aviso.texto, 'campaign-flash ' + aviso.tipo);
   nota.setAttribute('role', 'status');
   root.append(nota);
  }

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

  // Segmentação por dono: é a pergunta que esta tela existe para responder —
  // quanto cada produto e cada contratação consumiu em anúncios. Agrupar por
  // "atribuída / não atribuída" respondia outra coisa.
  //
  // Sem atribuição vem primeiro mesmo assim: enquanto estiver ali, o gasto não
  // entra no custo de ninguém, e o total por produto está incompleto.
  const grupos = new Map();
  const chaveDe = c => {
   if (c.product_id) return `p:${c.product_id}`;
   if (c.engagement_id) return `e:${c.engagement_id}`;
   return 'sem';
  };
  for (const c of dados.campaigns) {
   const chave = chaveDe(c);
   if (!grupos.has(chave)) {
    grupos.set(chave, {
     chave,
     tipo: c.product_id ? 'produto' : c.engagement_id ? 'servico' : 'sem',
     titulo: c.product_id
      ? (c.product_name || c.product_id)
      : c.engagement_id ? `${c.tenant_name} — ${c.engagement_label}` : 'Sem atribuição',
     etiqueta: c.product_id
      ? 'PRODUTO'
      : c.engagement_id ? (SERVICE_MODELS[c.service_model] || 'CONTRATAÇÃO').toUpperCase() : null,
     campanhas: [], gasto: 0, cliques: 0, leads: 0,
    });
   }
   const g = grupos.get(chave);
   g.campanhas.push(c);
   g.gasto += Number(c.spend_cents || 0);
   g.cliques += Number(c.clicks || 0);
   g.leads += Number(c.leads || 0);
  }

  // Sem dono primeiro; o resto por gasto, que é a ordem em que se toma decisão.
  const ordenados = [...grupos.values()].sort((a, b) =>
   (a.tipo === 'sem' ? -1 : b.tipo === 'sem' ? 1 : 0) || b.gasto - a.gasto);

  for (const g of ordenados) {
   const bloco = el('section', undefined, 'campaign-group' + (g.tipo === 'sem' ? ' pendente' : ''));
   const cabecalho = el('div', undefined, 'campaign-group-head');
   const titulo = el('div');
   if (g.etiqueta) titulo.append(el('span', g.etiqueta, 'overview-kicker'));
   titulo.append(el('h3', `${g.titulo} · ${g.campanhas.length} campanha${g.campanhas.length === 1 ? '' : 's'}`));
   const total = el('div', undefined, 'campaign-group-total');
   total.append(el('strong', dinheiro(g.gasto, moeda)));
   const porLead = custoPor(g.gasto, g.leads, moeda);
   total.append(el('small', porLead ? `${porLead} por lead · ${numero(g.leads)} leads` : `${numero(g.cliques)} cliques`));
   cabecalho.append(titulo, total);
   bloco.append(cabecalho);

   if (g.tipo === 'sem') {
    bloco.append(el('p', 'Enquanto estiverem aqui, esse gasto não entra no custo de nenhum produto nem de nenhuma contratação — e o total dos outros grupos está incompleto.', 'detail'));
   }
   for (const c of g.campanhas) bloco.append(linhaCampanha(c));
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
  // O aviso de retorno da Meta vale para esta renderização, não para as próximas.
  aviso = null;
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

 function flash(codigo) {
  const a = Object.hasOwn(AVISOS, codigo) ? AVISOS[codigo] : null;
  aviso = a ? { tipo: a[0], texto: a[1] } : null;
 }

 return { load, loadProduct, loadService, render, flash, get data() { return dados; } };
}
