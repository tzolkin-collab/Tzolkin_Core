// Campanhas de marketing — Apresentação estilo Utmify.
//
// Métricas consolidadas da Meta Ads cruzadas com a atribuição real do Core
// (leads comerciais, vendas ganhas e receita de contratos ativos/concluídos).
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
 if (text !== undefined && text !== null) n.textContent = text;
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
 ACTIVE: ['Ativa', 'ready'], PAUSED: ['Pausada', 'building'], ARCHIVED: ['Arquivada', ''],
 DELETED: ['Excluída', 'error'], IN_PROCESS: ['Processando', 'building'],
 WITH_ISSUES: ['Com problemas', 'error'], CAMPAIGN_PAUSED: ['Pausada', 'building'],
 ADSET_PAUSED: ['Conjunto pausado', 'building'], PENDING_REVIEW: ['Em revisão', 'building'],
 DISAPPROVED: ['Reprovada', 'error'],
};

// Validade como ação: quem lê precisa saber se tem de voltar aqui, e quando.
// Só variantes de .status que existem em design.css (active verde, building âmbar,
// failed vermelho): classe sem regra cai no cinza neutro e inverte a urgência.
export function rotuloValidade(credencial) {
 if (!credencial?.configured) return null;
 if (credencial.never_expires) return ['Não expira', 'status active'];
 if (credencial.expired) return ['Expirado — reconecte', 'status failed'];
 const n = credencial.days_remaining;
 const quando = n == null ? 'Expira' : n === 0 ? 'Expira hoje' : `Expira em ${n} dia${n === 1 ? '' : 's'}`;
 return [`${quando} — reconecte antes`, credencial.expiring_soon ? 'status failed' : 'status building'];
}

// O modo clássico dá token de ~60 dias. A frase diz o que resolve isso de vez.
const DICA_SEM_EXPIRACAO = 'Configurar META_LOGIN_CONFIG_ID no servidor (Login do Facebook para Empresas, com token de usuário do sistema) elimina a expiração: o token conectado passa a não expirar.';

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

function calcularDatas(preset, clock = Date.now) {
 const now = new Date(clock());
 const fmt = d => d.toISOString().slice(0, 10);
 const hojeStr = fmt(now);
 if (preset === 'hoje') return { since: hojeStr, until: hojeStr };
 if (preset === 'ontem') {
  const d = new Date(now.getTime() - 86400000);
  const s = fmt(d);
  return { since: s, until: s };
 }
 if (preset === '7d') {
  const d = new Date(now.getTime() - 7 * 86400000);
  return { since: fmt(d), until: hojeStr };
 }
 if (preset === '30d') {
  const d = new Date(now.getTime() - 30 * 86400000);
  return { since: fmt(d), until: hojeStr };
 }
 if (preset === 'este_mes') {
  const y = now.getUTCFullYear();
  const m = String(now.getUTCMonth() + 1).padStart(2, '0');
  return { since: `${y}-${m}-01`, until: hojeStr };
 }
 if (preset === 'mes_passado') {
  const y = now.getUTCMonth() === 0 ? now.getUTCFullYear() - 1 : now.getUTCFullYear();
  const m = now.getUTCMonth() === 0 ? 12 : now.getUTCMonth();
  const mStr = String(m).padStart(2, '0');
  const ultimoDia = new Date(Date.UTC(y, m, 0)).getUTCDate();
  return { since: `${y}-${mStr}-01`, until: `${y}-${mStr}-${String(ultimoDia).padStart(2, '0')}` };
 }
 return { since: fmt(new Date(now.getTime() - 30 * 86400000)), until: hojeStr };
}

export function setupCampaigns({ api, onError = () => {} }) {
 let dados = null;
 let dadosUtms = null;
 let alvos = null;
 let carregando = false;
 let carregandoUtms = false;
 let periodoPreset = '30d';
 let periodo = calcularDatas('30d');
 let contaSelecionada = '';
 let buscaFiltro = '';
 let statusFiltro = 'todos'; // todos | ACTIVE | PAUSED
 let abaAtiva = 'campaigns'; // campaigns | utms | connection
 let dimensaoUtm = 'source'; // source | medium | campaign | content | term | tzolkin
 let aviso = null;

 const host = id => document.getElementById(id);

 // ---------------------------------------------------------------------------
 // Cartão e Gestão da Credencial Meta
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
   if (dados && dados.key_configured === false) {
    const avisoChave = el('div', undefined, 'campaign-key-missing');
    avisoChave.append(el('strong', 'Falta a chave de cifragem no servidor.'),
     el('p', 'Defina META_MARKETING_KEY no ambiente do serviço e reinicie o Core. Gere o valor com:'),
     el('code', `node -e "console.log(require('node:crypto').randomBytes(32).toString('base64'))"`, 'campaign-cmd'));
    corpo.append(avisoChave);
   }
   const acoes = el('div', undefined, 'campaign-actions');
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
   const tecnico = [];
   if (dados && !dados.oauth_available) {
    tecnico.push('Para conectar com o Facebook em um clique, defina META_APP_ID e META_APP_SECRET no servidor.');
   }
   if (dados?.login_mode === 'business') {
    corpo.append(el('small', 'O botão usa o Login do Facebook para Empresas: entre com o portfólio empresarial dono das contas de anúncio. Com a configuração de token de usuário do sistema, o token não expira.'));
   } else if (dados?.login_mode === 'classic') {
    corpo.append(el('small', 'O botão usa o Login do Facebook clássico: o token dura cerca de 60 dias. ' + DICA_SEM_EXPIRACAO));
   }
   tecnico.push('Também dá para conectar pelo servidor, com npm run marketing:connect.');
   const detalhes = el('details');
   detalhes.append(el('summary', 'Para quem administra o servidor'), ...tecnico.map(texto => el('small', texto)));
   corpo.append(detalhes);
   card.append(corpo);
   return card;
  }

  const cabecalho = el('div', undefined, 'campaign-credential-head');
  cabecalho.append(el('strong', dados.label || 'Meta Ads'));
  const tipo = dados.token_type === 'system_user' ? 'Usuário do Sistema' : 'Token de longa duração';
  cabecalho.append(el('span', tipo, 'detail'));

  const [rotulo, classe] = rotuloValidade(dados);
  cabecalho.append(el('span', rotulo, classe));
  card.append(cabecalho);

  const fatos = el('dl', undefined, 'campaign-facts');
  const fato = (chave, valor) => { fatos.append(el('dt', chave), el('dd', valor)); };
  fato('Impressão digital', dados.fingerprint);
  fato('Validade', dados.never_expires || !dados.expires_at
   ? 'Não expira' : new Date(dados.expires_at).toLocaleDateString('pt-BR'));
  fato('Escopos', (dados.scopes || []).join(', ') || '—');
  fato('Última conferência', dados.last_verified_at ? new Date(dados.last_verified_at).toLocaleString('pt-BR') : 'Nunca');
  const via = { oauth: ' (Facebook Login)', panel: ' (Token colado no painel)', script: ' (Servidor)' }[dados.connected_via] || '';
  if (dados.connected_by) fato('Conectado por', dados.connected_by + via);
  card.append(fatos);

  if (!dados.can_read_ads) {
   const avisoPermissao = el('p', undefined, 'notice-inline');
   avisoPermissao.append(createIcon('alert'), el('span', 'Este token não tem `ads_read`. A coleta de campanhas não vai funcionar até ele ser reconectado com essa permissão.'));
   card.append(avisoPermissao);
  }
  if (dados.last_error) card.append(el('p', dados.last_error, 'notice-inline'));
  if (dados.login_mode === 'classic' && !dados.never_expires) card.append(el('p', DICA_SEM_EXPIRACAO, 'campaign-login-hint'));

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
  const coletar = el('button', 'Sincronizar campanhas', 'primary');
  coletar.type = 'button';
  coletar.onclick = () => sincronizarCampanhas(coletar);

  const substituir = el('button', dados.oauth_available ? 'Colar outro token' : 'Substituir token', 'secondary');
  substituir.type = 'button';
  substituir.onclick = () => abrirCredencial();

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

 async function sincronizarCampanhas(botao) {
  const rotuloAntigo = botao ? botao.textContent : 'Sincronizar Meta';
  if (botao) { botao.disabled = true; botao.textContent = 'Sincronizando…'; }
  try {
   const r = await api('/api/marketing/sync', 'POST');
   await recarregar();
   if (r.status === 'partial') onError(new Error('Coleta parcial: ' + (r.error || 'a Meta interrompeu a leitura.')));
  } catch (e) { onError(e); }
  finally { if (botao) { botao.disabled = false; botao.textContent = rotuloAntigo; } }
 }

 async function conectarComFacebook(botao) {
  const rotulo = botao.textContent;
  botao.disabled = true; botao.textContent = 'Abrindo a Meta…';
  try {
   const { url } = await api('/api/marketing/meta/authorize', 'POST');
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
  const avisoChave = form.querySelector('.marketing-key-warning');
  avisoChave.hidden = dados?.key_configured !== false;
  if (!avisoChave.hidden) avisoChave.textContent = 'META_MARKETING_KEY não está definida no servidor. A gravação vai falhar até ela existir.';

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
    form.reset();
    dialog.close();
    await recarregar();
   } catch (e) { erro.textContent = e.message; }
   finally { enviar.disabled = false; enviar.textContent = 'Conectar'; }
  };
  dialog.showModal();
 }

 // ---------------------------------------------------------------------------
 // Header de Controles no padrão Utmify
 // ---------------------------------------------------------------------------
 function barraDeControles() {
  const header = el('header', undefined, 'utmify-header');

  // Topo: Título executivo + Selo de saúde
  const topo = el('div', undefined, 'utmify-header-top');
  const titulos = el('div', undefined, 'utmify-titles');
  titulos.append(
   el('span', 'ATRIBUIÇÃO & MARKETING ANALYTICS', 'overview-kicker'),
   el('h2', 'Campanhas & Rastreamento')
  );
  if (dados?.configured) {
   const [rotulo, classe] = rotuloValidade(dados);
   titulos.append(el('span', rotulo, classe));
  }
  topo.append(titulos);

  // Ações de topo: Botão de sincronização rápida
  const acoesTopo = el('div', undefined, 'utmify-top-actions');
  const btnSync = el('button', 'Sincronizar Meta', 'primary');
  btnSync.type = 'button';
  btnSync.onclick = () => sincronizarCampanhas(btnSync);
  acoesTopo.append(btnSync);
  topo.append(acoesTopo);
  header.append(topo);

  // Barra de ferramentas: Seletor de período, seletor de conta e busca
  const toolbar = el('div', undefined, 'utmify-toolbar');

  // Grupo de pílulas de período
  const periodosWrap = el('div', undefined, 'utmify-period-group');
  const presets = [
   { id: 'hoje', rotulo: 'Hoje' },
   { id: 'ontem', rotulo: 'Ontem' },
   { id: '7d', rotulo: '7D' },
   { id: '30d', rotulo: '30D' },
   { id: 'este_mes', rotulo: 'Este Mês' },
   { id: 'mes_passado', rotulo: 'Mês Passado' },
   { id: 'custom', rotulo: 'Personalizado' },
  ];

  for (const p of presets) {
   const btn = el('button', p.rotulo, 'utmify-period-btn' + (periodoPreset === p.id ? ' active' : ''));
   btn.type = 'button';
   btn.onclick = async () => {
    periodoPreset = p.id;
    if (p.id !== 'custom') {
     periodo = calcularDatas(p.id);
     await recarregar();
    } else {
     render();
    }
   };
   periodosWrap.append(btn);
  }
  toolbar.append(periodosWrap);

  // Se for personalizado: exibe seletores de data inline
  if (periodoPreset === 'custom') {
   const customWrap = el('div', undefined, 'utmify-custom-dates');
   const inputSince = el('input', undefined, 'utmify-date-input');
   inputSince.type = 'date';
   inputSince.value = periodo.since || '';
   const inputUntil = el('input', undefined, 'utmify-date-input');
   inputUntil.type = 'date';
   inputUntil.value = periodo.until || '';

   const btnAplicar = el('button', 'Aplicar', 'secondary');
   btnAplicar.type = 'button';
   btnAplicar.onclick = async () => {
    if (inputSince.value && inputUntil.value && inputSince.value <= inputUntil.value) {
     periodo = { since: inputSince.value, until: inputUntil.value };
     await recarregar();
    }
   };
   customWrap.append(inputSince, el('span', 'até', 'detail'), inputUntil, btnAplicar);
   toolbar.append(customWrap);
  }

  // Seletor de Contas de Anúncio
  const accountWrap = el('div', undefined, 'utmify-account-wrap');
  const selectAccount = el('select', undefined, 'utmify-select');
  const optTodas = el('option', `Todas as contas (${dados?.accounts?.length || 0})`);
  optTodas.value = '';
  selectAccount.append(optTodas);
  for (const a of dados?.accounts || []) {
   const opt = el('option', `${a.name || a.external_id} (${a.currency})`);
   opt.value = a.external_id;
   if (contaSelecionada === a.external_id) opt.selected = true;
   selectAccount.append(opt);
  }
  selectAccount.onchange = async () => {
   contaSelecionada = selectAccount.value;
   await recarregar();
  };
  accountWrap.append(selectAccount);
  toolbar.append(accountWrap);

  header.append(toolbar);

  // Sub-abas de navegação (Estilo Utmify: Campanhas / Análise de UTMs / Conexão)
  const navTabs = el('nav', undefined, 'utmify-subnav');
  const tabCampanhas = el('button', undefined, 'utmify-subnav-btn' + (abaAtiva === 'campaigns' ? ' active' : ''));
  tabCampanhas.append(createIcon('chart'), el('span', `Campanhas (${dados?.campaigns?.length || 0})`));
  tabCampanhas.onclick = () => { abaAtiva = 'campaigns'; render(); };

  const tabUtms = el('button', undefined, 'utmify-subnav-btn' + (abaAtiva === 'utms' ? ' active' : ''));
  tabUtms.append(createIcon('layers'), el('span', 'Análise de UTMs'));
  tabUtms.onclick = async () => {
   abaAtiva = 'utms';
   render();
   if (!dadosUtms) await carregarUtms();
  };

  const tabConexao = el('button', undefined, 'utmify-subnav-btn' + (abaAtiva === 'connection' ? ' active' : ''));
  tabConexao.append(createIcon('settings'), el('span', 'Conexão Meta'));
  if (dados?.expiring_soon || dados?.expired) {
   tabConexao.append(el('span', '!', 'utmify-tab-warn'));
  }
  tabConexao.onclick = () => { abaAtiva = 'connection'; render(); };

  navTabs.append(tabCampanhas, tabUtms, tabConexao);
  header.append(navTabs);

  return header;
 }

 // ---------------------------------------------------------------------------
 // Cartões KPI Executivos (Visão Utmify)
 // ---------------------------------------------------------------------------
 function cartoesKpi(sumario, moeda) {
  const grid = el('section', undefined, 'utmify-kpi-grid');

  // 1. Investimento Total
  const kpiSpend = el('div', undefined, 'utmify-kpi-card');
  kpiSpend.append(
   el('span', 'INVESTIMENTO TOTAL (META)', 'overview-kicker'),
   el('strong', dinheiro(sumario.spend_cents, moeda), 'utmify-kpi-num'),
   el('div', `${numero(sumario.impressions)} imp. · ${numero(sumario.clicks)} cliques`, 'utmify-kpi-sub')
  );

  // 2. Faturamento Real Core
  const kpiRev = el('div', undefined, 'utmify-kpi-card highlight-success');
  kpiRev.append(
   el('span', 'FATURAMENTO REAL (CORE)', 'overview-kicker'),
   el('strong', dinheiro(sumario.core_revenue_cents, moeda), 'utmify-kpi-num text-success'),
   el('div', `${numero(sumario.core_won || 0)} contratos/vendas fechados`, 'utmify-kpi-sub')
  );

  // 3. ROAS Real
  const kpiRoas = el('div', undefined, 'utmify-kpi-card');
  const roasValor = Number(sumario.roas_real || 0);
  let roasTagCls = 'roas-badge none';
  let roasDesc = 'Sem investimento no período';
  if (sumario.spend_cents > 0) {
   if (roasValor >= 3) { roasTagCls = 'roas-badge high'; roasDesc = 'Excelente retorno'; }
   else if (roasValor >= 1) { roasTagCls = 'roas-badge mid'; roasDesc = 'Retorno positivo'; }
   else { roasTagCls = 'roas-badge low'; roasDesc = 'Abaixo do ponto de equilíbrio'; }
  }
  const roasHead = el('div', undefined, 'utmify-kpi-head-row');
  roasHead.append(el('span', 'ROAS REAL', 'overview-kicker'), el('span', roasDesc, roasTagCls));
  kpiRoas.append(
   roasHead,
   el('strong', `${roasValor.toFixed(2)}x`, 'utmify-kpi-num'),
   el('div', `Faturamento Core ÷ Investimento Meta`, 'utmify-kpi-sub')
  );

  // 4. Leads & CPL Real vs Meta
  const kpiLeads = el('div', undefined, 'utmify-kpi-card');
  const cplCoreStr = sumario.cpl_core_cents != null ? dinheiro(sumario.cpl_core_cents, moeda) : '—';
  const cplMetaStr = sumario.cpl_meta_cents != null ? dinheiro(sumario.cpl_meta_cents, moeda) : '—';
  kpiLeads.append(
   el('span', 'LEADS & CUSTO POR LEAD', 'overview-kicker'),
   el('strong', `${numero(sumario.core_leads || 0)} leads reais`, 'utmify-kpi-num'),
   el('div', `CPL Real: ${cplCoreStr} · Meta declarou: ${numero(sumario.leads || 0)} (${cplMetaStr})`, 'utmify-kpi-sub')
  );

  // 5. Tráfego & CPC
  const kpiTraffic = el('div', undefined, 'utmify-kpi-card');
  const cpcStr = sumario.cpc_cents != null ? dinheiro(sumario.cpc_cents, moeda) : '—';
  kpiTraffic.append(
   el('span', 'EFICIÊNCIA DE TRÁFEGO', 'overview-kicker'),
   el('strong', `CTR ${Number(sumario.ctr || 0).toFixed(2)}%`, 'utmify-kpi-num'),
   el('div', `CPC Médio: ${cpcStr} · ${numero(sumario.clicks)} cliques`, 'utmify-kpi-sub')
  );

  // 6. Gasto sem Atribuição (se houver)
  if (sumario.unassigned_spend_cents > 0) {
   const kpiUnassigned = el('div', undefined, 'utmify-kpi-card warn');
   kpiUnassigned.append(
    el('span', 'SEM ATRIBUIÇÃO NO CORE', 'overview-kicker text-warning'),
    el('strong', dinheiro(sumario.unassigned_spend_cents, moeda), 'utmify-kpi-num text-warning'),
    el('div', `${dados.unassigned} campanhas sem produto ou contratação vinculados`, 'utmify-kpi-sub')
   );
   grid.append(kpiUnassigned);
  }

  grid.append(kpiSpend, kpiRev, kpiRoas, kpiLeads, kpiTraffic);
  return grid;
 }

 // ---------------------------------------------------------------------------
 // Tabela de Campanhas (Alta Densidade, Sticky Header, Totais)
 // ---------------------------------------------------------------------------
 function tabelaCampanhas(campanhas, moeda) {
  const container = el('div', undefined, 'utmify-table-container');

  // Barra de busca e filtros de status
  const filterBar = el('div', undefined, 'utmify-table-filter-bar');
  const searchInput = el('input', undefined, 'utmify-search-input');
  searchInput.type = 'search';
  searchInput.placeholder = 'Buscar por nome da campanha ou ID Meta…';
  searchInput.value = buscaFiltro;
  searchInput.oninput = () => {
   buscaFiltro = searchInput.value.toLowerCase().trim();
   renderizarLinhasTabela();
  };
  filterBar.append(searchInput);

  const statusSelect = el('select', undefined, 'utmify-select-mini');
  statusSelect.append(
   Object.assign(el('option', 'Todos os status'), { value: 'todos' }),
   Object.assign(el('option', 'Somente ativas'), { value: 'ACTIVE' }),
   Object.assign(el('option', 'Somente pausadas'), { value: 'PAUSED' }),
   Object.assign(el('option', 'Sem vínculo Core'), { value: 'sem_vinculo' })
  );
  statusSelect.value = statusFiltro;
  statusSelect.onchange = () => {
   statusFiltro = statusSelect.value;
   renderizarLinhasTabela();
  };
  filterBar.append(statusSelect);
  container.append(filterBar);

  const tableWrap = el('div', undefined, 'tbl-wrap utmify-table-scroll');
  const tbl = el('table', undefined, 'tbl utmify-table');

  const thead = el('thead');
  const hRow = el('tr');
  const cols = [
   { label: 'Status', cls: 'col-status' },
   { label: 'Campanha & Vínculo Core', cls: 'col-name' },
   { label: 'Gasto Meta', cls: 'num col-spend' },
   { label: 'Cliques / CTR', cls: 'num col-clicks' },
   { label: 'CPC', cls: 'num col-cpc' },
   { label: 'Leads Meta', cls: 'num col-leads-meta' },
   { label: 'Leads Core', cls: 'num col-leads-core' },
   { label: 'CPL Real', cls: 'num col-cpl-real' },
   { label: 'Vendas Core', cls: 'num col-won' },
   { label: 'Faturamento Core', cls: 'num col-rev' },
   { label: 'ROAS Real', cls: 'num col-roas' },
   { label: 'Ações', cls: 'col-actions' },
  ];
  for (const c of cols) {
   const th = el('th', c.label, c.cls);
   hRow.append(th);
  }
  thead.append(hRow);
  tbl.append(thead);

  const tbody = el('tbody');
  tbl.append(tbody);

  const tfoot = el('tfoot');
  tbl.append(tfoot);
  tableWrap.append(tbl);
  container.append(tableWrap);

  function renderizarLinhasTabela() {
   tbody.replaceChildren();
   tfoot.replaceChildren();

   const filtradas = campanhas.filter(c => {
    if (statusFiltro === 'ACTIVE' && c.effective_status !== 'ACTIVE') return false;
    if (statusFiltro === 'PAUSED' && c.effective_status !== 'PAUSED') return false;
    if (statusFiltro === 'sem_vinculo' && (c.product_id || c.engagement_id)) return false;
    if (buscaFiltro) {
     const matchNome = String(c.name || '').toLowerCase().includes(buscaFiltro);
     const matchId = String(c.external_id || '').toLowerCase().includes(buscaFiltro);
     const matchProd = String(c.product_name || '').toLowerCase().includes(buscaFiltro);
     const matchClient = String(c.tenant_name || '').toLowerCase().includes(buscaFiltro);
     if (!matchNome && !matchId && !matchProd && !matchClient) return false;
    }
    return true;
   });

   if (!filtradas.length) {
    const tr = el('tr');
    const td = el('td', 'Nenhuma campanha corresponde aos filtros selecionados.', 'table-empty');
    td.colSpan = cols.length;
    tr.append(td);
    tbody.append(tr);
    return;
   }

   let tSpend = 0, tClicks = 0, tImp = 0, tMetaLeads = 0, tCoreLeads = 0, tWon = 0, tRev = 0;

   for (const c of filtradas) {
    tSpend += Number(c.spend_cents || 0);
    tClicks += Number(c.clicks || 0);
    tImp += Number(c.impressions || 0);
    tMetaLeads += Number(c.leads || 0);
    tCoreLeads += Number(c.core_leads || 0);
    tWon += Number(c.core_won || 0);
    tRev += Number(c.core_revenue_cents || 0);

    const tr = el('tr');

    // 1. Status
    const tdStatus = el('td', undefined, 'col-status');
    const [rotuloEstado, classeEstado] = ESTADOS[c.effective_status] || [c.effective_status || '—', ''];
    tdStatus.append(el('span', rotuloEstado, 'status ' + classeEstado));
    tr.append(tdStatus);

    // 2. Campanha & Vínculo Core
    const tdName = el('td', undefined, 'col-name');
    const nomeDiv = el('div', c.name || c.external_id, 'utmify-campaign-title');
    const metaSub = el('small', undefined, 'detail utmify-campaign-sub');
    metaSub.textContent = `ID: ${c.external_id}${c.daily_budget_cents ? ` · Orç/dia: ${dinheiro(c.daily_budget_cents, c.currency)}` : ''}`;
    tdName.append(nomeDiv, metaSub);

    // Pill de vínculo
    const bindDiv = el('div', undefined, 'utmify-bind-container');
    if (c.product_id || c.engagement_id) {
     const pill = el('span', undefined, 'utmify-bind-tag assigned');
     pill.append(createIcon('check'));
     if (c.product_id) pill.append(el('span', `Produto: ${c.product_name || c.product_id}`));
     else pill.append(el('span', `${SERVICE_MODELS[c.service_model] || 'Cliente'}: ${c.tenant_name} — ${c.engagement_label}`));
     bindDiv.append(pill);
    } else {
     const pill = el('span', 'Sem vínculo Core', 'utmify-bind-tag unassigned');
     bindDiv.append(pill);
    }
    tdName.append(bindDiv);
    tr.append(tdName);

    // 3. Gasto Meta
    const tdSpend = el('td', dinheiro(c.spend_cents, c.currency), 'num col-spend');
    tr.append(tdSpend);

    // 4. Cliques / CTR
    const tdClicks = el('td', undefined, 'num col-clicks');
    tdClicks.append(
     el('div', numero(c.clicks)),
     el('small', `CTR ${Number(c.ctr || 0).toFixed(1)}%`, 'detail')
    );
    tr.append(tdClicks);

    // 5. CPC
    const tdCpc = el('td', c.cpc_cents != null ? dinheiro(c.cpc_cents, c.currency) : '—', 'num col-cpc');
    tr.append(tdCpc);

    // 6. Leads Meta
    const tdLeadsMeta = el('td', numero(c.leads), 'num col-leads-meta');
    tr.append(tdLeadsMeta);

    // 7. Leads Core (Real)
    const tdLeadsCore = el('td', undefined, 'num col-leads-core');
    const nCore = Number(c.core_leads || 0);
    tdLeadsCore.append(el('strong', numero(nCore), nCore > 0 ? 'text-success' : ''));
    tr.append(tdLeadsCore);

    // 8. CPL Real
    const tdCplReal = el('td', c.cpl_core_cents != null ? dinheiro(c.cpl_core_cents, c.currency) : '—', 'num col-cpl-real');
    tr.append(tdCplReal);

    // 9. Vendas Core
    const tdWon = el('td', numero(c.core_won || 0), 'num col-won');
    tr.append(tdWon);

    // 10. Faturamento Core
    const tdRev = el('td', dinheiro(c.core_revenue_cents, c.currency), 'num col-rev text-success font-medium');
    tr.append(tdRev);

    // 11. ROAS Real
    const tdRoas = el('td', undefined, 'num col-roas');
    const roasVal = Number(c.roas_real || 0);
    let tagCls = 'roas-badge-pill';
    if (c.spend_cents > 0) {
     if (roasVal >= 3) tagCls += ' high';
     else if (roasVal >= 1) tagCls += ' mid';
     else tagCls += ' low';
    } else tagCls += ' none';
    tdRoas.append(el('span', `${roasVal.toFixed(2)}x`, tagCls));
    tr.append(tdRoas);

    // 12. Ações
    const tdActions = el('td', undefined, 'col-actions');
    const btnVincular = el('button', c.product_id || c.engagement_id ? 'Alterar' : 'Vincular', 'link-button');
    btnVincular.type = 'button';
    btnVincular.onclick = () => abrirVinculo(c);
    tdActions.append(btnVincular);
    tr.append(tdActions);

    tbody.append(tr);
   }

   // Linha de Rodapé com Totais Consolidados
   const footTr = el('tr');
   footTr.append(
    el('td', 'TOTAL', 'col-status font-bold'),
    el('td', `${filtradas.length} campanha(s)`, 'col-name font-bold'),
    el('td', dinheiro(tSpend, moeda), 'num col-spend font-bold'),
    el('td', `${numero(tClicks)} (${tImp > 0 ? ((tClicks / tImp) * 100).toFixed(1) : 0}%)`, 'num col-clicks font-bold'),
    el('td', tClicks > 0 ? dinheiro(Math.round(tSpend / tClicks), moeda) : '—', 'num col-cpc font-bold'),
    el('td', numero(tMetaLeads), 'num col-leads-meta font-bold'),
    el('td', numero(tCoreLeads), 'num col-leads-core font-bold text-success'),
    el('td', tCoreLeads > 0 ? dinheiro(Math.round(tSpend / tCoreLeads), moeda) : '—', 'num col-cpl-real font-bold'),
    el('td', numero(tWon), 'num col-won font-bold'),
    el('td', dinheiro(tRev, moeda), 'num col-rev font-bold text-success'),
    el('td', `${tSpend > 0 ? (tRev / tSpend).toFixed(2) : (tRev > 0 ? '999' : '0.00')}x`, 'num col-roas font-bold'),
    el('td', '', 'col-actions')
   );
   tfoot.append(footTr);
  }

  renderizarLinhasTabela();
  return container;
 }

 // ---------------------------------------------------------------------------
 // Aba de Análise de UTMs (Utmify UTM Dimension Breakdown)
 // ---------------------------------------------------------------------------
 async function carregarUtms() {
  carregandoUtms = true;
  render();
  const q = new URLSearchParams();
  if (periodo.since) q.set('since', periodo.since);
  if (periodo.until) q.set('until', periodo.until);
  q.set('dimension', dimensaoUtm);
  if (contaSelecionada) q.set('account', contaSelecionada);
  try {
   dadosUtms = await api('/api/marketing/utms?' + q.toString());
  } catch (e) { onError(e); }
  finally { carregandoUtms = false; render(); }
 }

 function viewAnaliseUtms() {
  const container = el('section', undefined, 'utmify-utms-section');

  // Cabeçalho da Análise com Seletores de Dimensão
  const head = el('div', undefined, 'utmify-utms-head');
  const dimSelector = el('div', undefined, 'utmify-dim-group');
  const dimensoes = [
   { id: 'source', label: 'Origem (utm_source)' },
   { id: 'medium', label: 'Mídia (utm_medium)' },
   { id: 'campaign', label: 'Campanha (utm_campaign)' },
   { id: 'content', label: 'Conteúdo (utm_content)' },
   { id: 'term', label: 'Termo (utm_term)' },
   { id: 'tzolkin', label: 'Tzolkin (utm_tzolkin)' },
  ];

  for (const d of dimensoes) {
   const btn = el('button', d.label, 'utmify-dim-btn' + (dimensaoUtm === d.id ? ' active' : ''));
   btn.type = 'button';
   btn.onclick = async () => {
    dimensaoUtm = d.id;
    await carregarUtms();
   };
   dimSelector.append(btn);
  }
  head.append(dimSelector);
  container.append(head);

  if (carregandoUtms) {
   container.append(el('p', 'Carregando análise de UTMs…', 'email-empty'));
   return container;
  }

  const moeda = dados?.accounts?.[0]?.currency || 'BRL';
  const sumario = dadosUtms?.summary;

  // Banner se houver leads/faturamento não rastreados
  if (sumario?.untracked_leads > 0 || sumario?.untracked_revenue_cents > 0) {
   const alertUntracked = el('div', undefined, 'utmify-untracked-banner');
   alertUntracked.append(createIcon('alert'));
   const texto = el('div');
   texto.append(
    el('strong', `${numero(sumario.untracked_leads)} leads e ${dinheiro(sumario.untracked_revenue_cents, moeda)} de faturamento sem rastreamento`),
    el('p', 'Esses contatos chegaram sem parâmetros UTM ou identificadores de anúncio. Parametrize seus links nos anúncios para que toda a receita seja atribuída à campanha exata.')
   );
   alertUntracked.append(texto);
   container.append(alertUntracked);
  }

  // Tabela de Performance por Dimensão
  const tableWrap = el('div', undefined, 'tbl-wrap utmify-table-scroll');
  const tbl = el('table', undefined, 'tbl utmify-table');

  const thead = el('thead');
  const hRow = el('tr');
  for (const label of ['Parâmetro / Valor', 'Leads Core', 'Vendas (Won)', 'Taxa de Conversão', 'Faturamento Real', 'Ticket Médio']) {
   const th = el('th', label, label === 'Parâmetro / Valor' ? 'col-name' : 'num');
   hRow.append(th);
  }
  thead.append(hRow);
  tbl.append(thead);

  const tbody = el('tbody');
  const items = dadosUtms?.items || [];

  if (!items.length) {
   const tr = el('tr');
   const td = el('td', 'Nenhum lead com atividade registrada no período selecionado.', 'table-empty');
   td.colSpan = 6;
   tr.append(td);
   tbody.append(tr);
  } else {
   for (const it of items) {
    const tr = el('tr');

    const tdVal = el('td', undefined, 'col-name');
    if (it.is_untracked) {
     const tag = el('span', '(sem rastreamento)', 'utmify-untracked-tag');
     tdVal.append(tag);
    } else {
     tdVal.append(el('strong', it.value || '—'));
    }
    tr.append(tdVal);

    tr.append(
     el('td', numero(it.leads), 'num font-medium'),
     el('td', numero(it.won), 'num font-medium'),
     el('td', `${Number(it.conversion_rate || 0).toFixed(1)}%`, 'num detail'),
     el('td', dinheiro(it.revenue_cents, moeda), 'num text-success font-medium'),
     el('td', dinheiro(it.ticket_medio_cents, moeda), 'num detail')
    );
    tbody.append(tr);
   }
  }
  tbl.append(tbody);

  if (sumario && items.length) {
   const tfoot = el('tfoot');
   const fRow = el('tr');
   fRow.append(
    el('td', `TOTAL (${sumario.total_items} valores)`, 'col-name font-bold'),
    el('td', numero(sumario.leads), 'num font-bold'),
    el('td', numero(sumario.won), 'num font-bold'),
    el('td', `${Number(sumario.conversion_rate || 0).toFixed(1)}%`, 'num font-bold detail'),
    el('td', dinheiro(sumario.revenue_cents, moeda), 'num font-bold text-success'),
    el('td', dinheiro(sumario.ticket_medio_cents, moeda), 'num font-bold detail')
   );
   tfoot.append(fRow);
   tbl.append(tfoot);
  }

  tableWrap.append(tbl);
  container.append(tableWrap);
  return container;
 }

 // ---------------------------------------------------------------------------
 // Modal de Atribuição (Vincular Campanha a Produto ou Contratação)
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

  const porModelo = {};
  for (const e of alvos.engagements) (porModelo[e.service_model] ||= []).push(e);
  for (const [modelo, lista] of Object.entries(porModelo)) {
   const g = el('optgroup'); g.label = SERVICE_MODELS[modelo] || modelo;
   for (const e of lista) {
    const o = el('option', `${e.tenant_name} — ${e.label}`); o.value = `engagement:${e.id}`; g.append(o);
   }
   seletor.append(g);
  }

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
    await recarregar();
   } catch (e) { erro.textContent = e.message; }
  };
  dialog.showModal();
 }

 // ---------------------------------------------------------------------------
 // Render Principal
 // ---------------------------------------------------------------------------
 function render() {
  const root = host('inbound-panel-campaigns');
  if (!root) return;
  root.replaceChildren();

  // Banner temporário de retorno da Meta
  if (aviso) {
   const nota = el('p', aviso.texto, 'campaign-flash ' + aviso.tipo);
   nota.setAttribute('role', 'status');
   root.append(nota);
  }

  // Header no padrão Utmify com controles globais
  root.append(barraDeControles());

  if (!dados?.configured) {
   root.append(cartaoCredencial());
   return;
  }

  if (carregando) {
   root.append(el('p', 'Carregando dados de marketing…', 'email-empty'));
   return;
  }

  // Se a aba for "Conexão", exibe o cartão da credencial
  if (abaAtiva === 'connection') {
   root.append(cartaoCredencial());
   return;
  }

  // Se a aba for "Análise de UTMs", exibe a visão de dimensões
  if (abaAtiva === 'utms') {
   root.append(viewAnaliseUtms());
   return;
  }

  // Aba padrão: "Campanhas" (Dashboard Executivo Utmify + Data Table)
  const moeda = dados.accounts?.[0]?.currency || 'BRL';
  if (dados.summary) {
   root.append(cartoesKpi(dados.summary, moeda));
  }

  if (dados.last_sync) {
   const s = dados.last_sync;
   const syncLine = el('p', undefined, 'detail utmify-sync-info');
   syncLine.textContent = `Última sincronização: ${new Date(s.started_at).toLocaleString('pt-BR')} · ${s.status === 'ok' ? 'Completa' : s.status === 'partial' ? 'Parcial' : 'Falhou'} · ${s.campaigns_seen} campanhas vistas na Meta`;
   root.append(syncLine);
  }

  if (!dados.campaigns?.length) {
   root.append(el('p', 'Nenhuma campanha encontrada no período selecionado.', 'email-empty'));
   return;
  }

  root.append(tabelaCampanhas(dados.campaigns, moeda));
 }

 // ---------------------------------------------------------------------------
 // Contexto de Produto e Contratação
 // ---------------------------------------------------------------------------
 function renderContexto(seletorHost, resposta, titulo, subtitulo) {
  const root = host(seletorHost);
  if (!root) return;
  root.replaceChildren();

  const capa = el('section', undefined, 'campaign-hero');
  const t = el('div');
  t.append(el('span', 'AQUISIÇÃO & TRÁFEGO', 'overview-kicker'), el('h2', titulo), el('p', subtitulo));
  capa.append(t);
  root.append(capa);

  if (!resposta?.campaigns?.length) {
   const vazio = el('div', undefined, 'email-empty');
   vazio.append(createIcon('layers'),
    el('h3', 'Nenhuma campanha atribuída'),
    el('p', 'Abra Campanhas no espaço de trabalho Inbound e atribua os anúncios que pertencem a este contexto.'));
   root.append(vazio);
   return;
  }
  const moeda = resposta.campaigns[0]?.currency || 'BRL';
  root.append(cartoesKpi(resposta.summary, moeda));
  root.append(tabelaCampanhas(resposta.campaigns, moeda));
 }

 async function recarregar() {
  return load(periodo);
 }

 async function load(janela = {}) {
  carregando = true;
  periodo = {
   since: janela.since || periodo.since,
   until: janela.until || periodo.until,
  };
  const q = new URLSearchParams();
  if (periodo.since) q.set('since', periodo.since);
  if (periodo.until) q.set('until', periodo.until);
  if (contaSelecionada) q.set('account', contaSelecionada);

  try {
   dados = await api('/api/marketing/overview' + (q.toString() ? `?${q}` : ''));
  } finally { carregando = false; }
  render();
  aviso = null;
  return dados;
 }

 async function loadProduct(produto) {
  const r = await api(`/api/products/${encodeURIComponent(produto.id)}/campaigns`);
  renderContexto('inbound-panel-campaigns', r, `Campanhas de ${produto.name || produto.id}`,
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
