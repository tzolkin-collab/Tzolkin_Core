import { $, node } from './dom.js';
import { tabela, celulaNome, selo } from './data-table.js';
import { fieldsManager } from './space-fields.js';

// Configuração do funil, em quatro painéis que o mesmo módulo sabe desenhar (o desenho do Kalidash):
//   automacoes  as regras "quando acontecer X, fazer Y" do espaço, com histórico de execuções  → página Tecnologia → Automações;
//   pipelines   os funis do espaço e as etapas de cada um (criar, editar, ordenar, apagar)     → aba do Inbound;
//   tarefas     o que cada etapa exige para entrar nela ou sair dela (requisitos de etapa)     → aba do Inbound;
//   campos      os campos que o espaço guarda de cada lead e oportunidade                       → aba do Inbound.
// Quem monta diz onde desenhar (`hostId`) e quais painéis mostra. Tudo é do ESPAÇO escolhido no alto (fixo, quando já se está dentro de um
// espaço). As rotas já existiam; aqui só se monta a tela.

const GATES = { ENTER: 'Para entrar na etapa', EXIT: 'Para sair da etapa' };
const TIPOS = { ACTION: 'Tarefa a concluir', FIELD: 'Campo a preencher' };
const TIPO_DA_ETAPA = { LEAD: ['Lead', 'info'], OPEN: ['Aberta', 'neutral'], WON: ['Ganha', 'success'], LOST: ['Perdida', 'danger'] };
const CORES = { LEAD: '#94a3b8', OPEN: '#f59e0b', WON: '#10b981', LOST: '#ef4444' };
const hora = v => new Date(v).toLocaleString('pt-BR', { day: '2-digit', month: '2-digit', hour: '2-digit', minute: '2-digit' });
const slugDe = nome => nome.toLowerCase().normalize('NFD').replace(/\p{M}/gu, '').replace(/[^a-z0-9]+/g, '-').replace(/^-+|-+$/g, '').slice(0, 60) || 'funil';
const plural = (n, um, varios) => `${n} ${n === 1 ? um : varios}`;

function campoDe(form, rotulo, tipo = 'text', extra = {}) { const l = node('label', rotulo), i = node('input'); i.type = tipo; Object.assign(i, extra); l.append(i); form.append(l); return i; }
function listaDe(form, rotulo, pares, valor) { const l = node('label', rotulo), s = node('select'); for (const [v, t] of pares) { const o = node('option', t); o.value = v; s.append(o); } if (valor != null) s.value = valor; if (s.selectedIndex < 0 && s.options.length) s.selectedIndex = 0; l.append(s); form.append(l); return { s, l }; }
function mostrarErro(alvo, e) { alvo.querySelector('[data-erro]')?.remove(); const p = node('p', e.message, 'notice-inline'); p.setAttribute('role', 'alert'); p.dataset.erro = '1'; alvo.prepend(p); }

export function setupAutomacoes({ api, reportError, hostId = 'view-automacoes', prefixo = 'automacoes', painelInicial = 'automacoes' }) {
 let geracao = 0, aba = painelInicial, espacoFixo = '', espaco = '', funis = [], funilId = '', donos = null, catalogo = null;
 let formAberto = false, selecionada = null;

 const funisDoEspaco = () => funis.filter(f => f.space_id === espaco);
 const espacos = () => [...new Map(funis.map(f => [f.space_id, { id: f.space_id, name: f.space_name }])).values()];
 const funilAtual = () => { const lista = funisDoEspaco().filter(f => f.is_active); return lista.find(f => f.id === funilId) || lista[0] || null; };
 
 async function carregar() {
  const ticket = ++geracao;
  const raiz = $(hostId); if (!raiz) return;
  try {
   const r = await api('/api/commercial/pipelines');
   if (ticket !== geracao) return;
   funis = r.pipelines || [];
   if (espacoFixo) espaco = espacoFixo;
   else if (!espacos().some(e => e.id === espaco)) espaco = espacos()[0]?.id || '';
   donos ??= (await api('/api/commercial/owners').catch(() => ({ owners: [] }))).owners;
  } catch (e) { if (ticket === geracao) raiz.replaceChildren(node('p', e.message, 'notice-inline')); return; }
  desenhar();
 }

 // ---------- estrutura: espaço + abas ----------
 async function desenhar(contagens) {
  const raiz = $(hostId);
  const lista = espacos();
  if (!lista.length || (espacoFixo && !funisDoEspaco().length)) { raiz.replaceChildren(node('p', 'Este espaço ainda não tem funil. Crie um espaço com a capacidade comercial para configurar funis e automações.', 'empty-list')); return; }
  const barra = node('div', undefined, 'au-barra');
  const corpo = node('div', undefined, 'au-painel'); corpo.id = `${prefixo}-painel`;
  const sel = node('select'); sel.setAttribute('aria-label', 'Espaço');
  for (const e of lista) { const o = node('option', e.name); o.value = e.id; sel.append(o); }
  sel.value = espaco;
  sel.onchange = () => { espaco = sel.value; funilId = ''; selecionada = null; formAberto = false; desenhar(); };
  const rotulo = node('label', undefined, 'au-espaco'); rotulo.append(node('span', 'Espaço'), sel);
  if (!espacoFixo) barra.append(rotulo);
  raiz.replaceChildren(...(espacoFixo ? [] : [barra]), corpo);
  corpo.append(node('p', 'Carregando…', 'detail'));
  try {
   if (aba === 'automacoes') await abaAutomacoes(corpo);
   else if (aba === 'pipelines') abaPipelines(corpo);
   else if (aba === 'tarefas') await abaTarefas(corpo);
   else abaCampos(corpo);
  } catch (e) { corpo.replaceChildren(node('p', e.message, 'notice-inline')); }
 }

 const recarregarFunis = async () => { funis = (await api('/api/commercial/pipelines')).pipelines || []; desenhar(); };

 // ---------- Automações ----------
 function resumoDaAcao(x) {
  if (x.action === 'tarefa.criar') return `criar a tarefa "${x.title}"${x.delay_days ? ` (prazo de ${x.delay_days} dias)` : ''}`;
  if (x.action === 'email.enviar') return `enviar o e-mail "${x.template}" ao lead`;
  if (x.action === 'whatsapp.enviar') return `enviar WhatsApp ao lead: "${x.message.length > 50 ? `${x.message.slice(0, 47)}…` : x.message}"`;
  if (x.action === 'whatsapp.avisar_equipe') return 'avisar a equipe no WhatsApp';
  return `atribuir a ${donos?.find(d => d.id === x.owner_id)?.name || 'um responsável'}`;
 }

 async function abaAutomacoes(corpo) {
  const { automations, catalog } = await api('/api/commercial/automations?space_id=' + encodeURIComponent(espaco));
  catalogo = catalog;
  const ativos = funisDoEspaco().filter(f => f.is_active);
  const nomeFunil = id => ativos.find(f => f.id === id)?.name || 'funil arquivado';
  const nomeEtapa = id => ativos.flatMap(f => f.stages).find(s => s.id === id)?.name || 'etapa';
  const topo = node('div', undefined, 'au-topo');
  topo.append(node('p', `${plural(automations.length, 'automação', 'automações')} neste espaço. Quando algo acontece no funil, o Core faz sozinho o que estiver aqui. Se uma falhar, o lead ou a venda seguem normalmente e a falha fica no histórico.`, 'detail'));
  const nova = node('button', formAberto ? 'Fechar' : 'Nova automação', formAberto ? 'secondary' : 'primary'); nova.type = 'button';
  nova.onclick = () => { formAberto = !formAberto; desenhar(); };
  topo.append(nova);
  corpo.replaceChildren(topo);
  if (formAberto) corpo.append(formularioDeAutomacao(catalog, ativos));
  if (!automations.length) { corpo.append(node('p', 'Nenhuma automação neste espaço. Crie a primeira em "Nova automação".', 'empty-list')); return; }
  const historico = node('div', undefined, 'au-historico');
  const abrirHistorico = async a => {
   selecionada = selecionada === a.id ? null : a.id;
   historico.replaceChildren();
   if (!selecionada) return;
   try {
    const { runs } = await api(`/api/commercial/automations/${a.id}/runs`);
    const bloco = node('section', undefined, 'au-historico-bloco');
    bloco.append(node('h3', `Execuções de "${a.name}"`));
    if (!runs.length) bloco.append(node('p', 'Ainda não rodou.', 'empty-list'));
    for (const r of runs) { const l = node('p', undefined, 'au-run'); l.append(selo(r.result === 'OK' ? 'OK' : 'Falhou', r.result === 'OK' ? 'success' : 'danger'), document.createTextNode(` ${hora(r.created_at)} · ${r.note}`)); bloco.append(l); }
    historico.replaceChildren(bloco);
   } catch (e) { mostrarErro(historico, e); }
  };
  corpo.append(tabela({
   legenda: 'Automações do espaço',
   linhas: automations,
   aoAbrir: abrirHistorico,
   colunas: [
    { titulo: 'Automação', celula: a => celulaNome({ nome: a.name, apoio: [a.pipeline_id ? nomeFunil(a.pipeline_id) : 'Qualquer funil', a.stage_id ? nomeEtapa(a.stage_id) : null].filter(Boolean).join(' · '), aoAbrir: () => abrirHistorico(a) }) },
    { titulo: 'Quando', celula: a => catalog.events[a.trigger_event] || a.trigger_event },
    { titulo: 'Então', celula: a => a.actions.map(resumoDaAcao).join('; ') },
    { titulo: 'Última execução', celula: a => (a.last_run_at ? `${hora(a.last_run_at)} ` : 'Nunca rodou'), },
    { titulo: 'Situação', celula: a => selo(a.is_enabled ? 'Ligada' : 'Desligada', a.is_enabled ? 'success' : 'neutral') },
    { titulo: '', celula: a => { const b = node('button', a.is_enabled ? 'Desligar' : 'Ligar', 'quiet'); b.type = 'button'; b.onclick = async ev => { ev.stopPropagation(); b.disabled = true; try { await api('/api/commercial/automations/' + a.id, 'PUT', { version: a.version, is_enabled: !a.is_enabled }); desenhar(); } catch (e) { mostrarErro(corpo, e); b.disabled = false; } }; return b; } },
   ],
  }), historico);
 }

 function formularioDeAutomacao(catalog, ativos) {
  const form = node('form', undefined, 'commercial-form au-form');
  form.append(node('h3', 'Nova automação'));
  const nome = campoDe(form, 'Nome', 'text', { required: true, maxLength: 120 });
  const evento = listaDe(form, 'Quando', Object.entries(catalog.events)).s;
  const funil = listaDe(form, 'Só neste funil', [['', 'Qualquer funil'], ...ativos.map(f => [f.id, f.name])]).s;
  const etapa = listaDe(form, 'Só nesta etapa', [['', 'Qualquer etapa']]);
  const sincroniza = () => { const f = ativos.find(x => x.id === funil.value); etapa.s.replaceChildren(...[['', 'Qualquer etapa'], ...(f ? f.stages.map(s => [s.id, s.name]) : [])].map(([v, t]) => { const o = node('option', t); o.value = v; return o; })); etapa.l.hidden = !f; };
  funil.onchange = sincroniza; sincroniza();
  const acao = listaDe(form, 'Então', Object.entries(catalog.actions)).s;
  const titulo = campoDe(form, 'Título da tarefa', 'text', { maxLength: 200 });
  const prazo = campoDe(form, 'Prazo da tarefa, em dias (0 = sem prazo)', 'number', { min: '0', max: '365', value: '0' });
  const dono = listaDe(form, 'Responsável', (donos || []).map(o => [o.id, o.name || o.email]));
  const mensagem = node('label', 'Mensagem do WhatsApp'), texto = node('textarea'); texto.rows = 4; texto.maxLength = 1000; texto.placeholder = 'Oi {{first_name}}, recebemos seu contato na {{product_name}}. Já já falamos com você!';
  mensagem.append(texto, node('small', 'Dados do lead: {{name}}, {{first_name}}, {{email}}, {{whatsapp}}, {{company_name}}, {{product_name}}. "Enviar ao lead" precisa de um WhatsApp válido no lead; "Avisar a equipe" usa os números de Integrações → WhatsApp.', 'detail')); form.append(mensagem);
  const modelo = listaDe(form, 'Template do e-mail', []);
  const ajudaModelo = node('small', undefined, 'detail'); modelo.l.append(ajudaModelo);
  const carregarModelos = async () => {
   try {
    const { templates } = await api('/api/email-templates?product_id=' + encodeURIComponent(espaco));
    modelo.s.replaceChildren(...templates.map(t => { const o = node('option', `${t.payload.name} (${t.slug})`); o.value = t.slug; return o; }));
    ajudaModelo.textContent = templates.length ? 'Dados do lead no e-mail: {{name}}, {{email}}, {{product_name}}, {{company_name}}.' : 'Este espaço ainda não tem template. Crie um em E-mails → Templates, no contexto do espaço.';
   } catch (e) { ajudaModelo.textContent = e.message; }
  };
  const mostra = () => {
   const tarefa = acao.value === 'tarefa.criar', email = acao.value === 'email.enviar', zap = acao.value.startsWith('whatsapp.');
   titulo.parentElement.hidden = prazo.parentElement.hidden = !tarefa; dono.l.hidden = tarefa || email || zap; modelo.l.hidden = !email; mensagem.hidden = !zap;
   if (email && !modelo.s.options.length) carregarModelos();
  };
  acao.onchange = mostra; mostra();
  const enviar = node('button', 'Criar automação', 'primary'); enviar.type = 'submit'; form.append(enviar);
  form.onsubmit = async e => {
   e.preventDefault(); enviar.disabled = true;
   try {
    const corpoDaAcao = acao.value === 'tarefa.criar' ? { action: 'tarefa.criar', title: titulo.value, delay_days: Number(prazo.value || 0) }
     : acao.value === 'email.enviar' ? { action: 'email.enviar', template: modelo.s.value }
     : acao.value.startsWith('whatsapp.') ? { action: acao.value, message: texto.value }
     : { action: 'responsavel.atribuir', owner_id: dono.s.value };
    await api('/api/commercial/automations', 'POST', { space_id: espaco, name: nome.value, trigger_event: evento.value, ...(funil.value ? { pipeline_id: funil.value } : {}), ...(etapa.s.value ? { stage_id: etapa.s.value } : {}), actions: [corpoDaAcao] });
    formAberto = false; desenhar();
   } catch (err) { mostrarErro(form, err); enviar.disabled = false; }
  };
  return form;
 }

 // ---------- Pipelines (etapas) ----------
 function abaPipelines(corpo) {
  const todos = funisDoEspaco();
  const cab = node('div', undefined, 'au-topo');
  cab.append(node('p', 'Cada pipeline é um funil do espaço. A ordem das etapas é sempre Lead, Abertas, Ganha e Perdida; dentro de cada tipo você escolhe a ordem. Só dá para apagar uma etapa sem registros.', 'detail'));
  const novo = node('button', 'Novo funil', 'secondary'); novo.type = 'button'; novo.onclick = () => { formAberto = !formAberto; desenhar(); };
  cab.append(novo);
  corpo.replaceChildren(cab);
  if (formAberto) corpo.append(formularioDeFunil());
  const f = funilAtual();
  if (!f) { corpo.append(node('p', 'Nenhum funil ativo neste espaço.', 'empty-list')); return; }

  // seletor de funil (ativos primeiro; arquivados no fim, para reativar)
  const seletor = node('div', undefined, 'au-funis'); seletor.setAttribute('role', 'tablist'); seletor.setAttribute('aria-label', 'Funis do espaço');
  for (const x of todos) {
   const b = node('button', undefined, 'au-funil' + (x.id === f.id ? ' active' : '')); b.type = 'button'; b.setAttribute('aria-pressed', String(x.id === f.id));
   b.append(node('strong', x.name), ...(x.is_default ? [selo('Padrão', 'accent')] : []), ...(x.is_active ? [] : [selo('Arquivado', 'neutral')]));
   b.onclick = () => { funilId = x.id; desenhar(); };
   seletor.append(b);
  }
  corpo.append(seletor);

  const acoes = node('div', undefined, 'au-acoes');
  const alterar = (rotulo, corpoPut, quiet) => { const b = node('button', rotulo, quiet ? 'quiet' : 'secondary'); b.type = 'button'; b.onclick = async () => { b.disabled = true; try { await api('/api/commercial/pipelines/' + f.id, 'PUT', { version: f.version, ...corpoPut }); await recarregarFunis(); } catch (e) { mostrarErro(corpo, e); b.disabled = false; } }; return b; };
  if (!f.is_default) acoes.append(alterar('Tornar padrão', { is_default: true }));
  acoes.append(alterar(f.is_active ? 'Arquivar funil' : 'Reativar funil', { is_active: !f.is_active }, true));
  corpo.append(acoes);

  const novaEtapa = node('button', 'Nova etapa', 'secondary'); novaEtapa.type = 'button';
  const area = node('div');
  corpo.append(area);
  const desenharEtapas = () => {
   area.replaceChildren(tabela({
    legenda: `Etapas de ${f.name}`,
    linhas: f.stages,
    colunas: [
     { titulo: 'Etapa', celula: s => { const c = node('span', undefined, 'au-etapa'); const ponto = node('i', undefined, 'au-ponto'); ponto.style.background = s.color || CORES[s.kind]; c.append(ponto, node('strong', s.name)); return c; } },
     { titulo: 'Tipo', celula: s => selo(...TIPO_DA_ETAPA[s.kind]) },
     { titulo: 'Chance', num: true, celula: s => (s.probability == null ? '—' : `${s.probability}%`) },
     { titulo: 'Alerta (dias)', num: true, celula: s => (s.stale_days == null ? '—' : String(s.stale_days)) },
     { titulo: 'Registros', num: true, celula: s => String(s.leads + s.opportunities) },
     { titulo: '', celula: s => linhaDeAcoes(s) },
    ],
   }));
  };
  const linhaDeAcoes = s => {
   const grupo = node('span', undefined, 'au-linha-acoes');
   const mesmoTipo = f.stages.filter(x => x.kind === s.kind);
   const i = mesmoTipo.indexOf(s);
   const mover = (rot, aria, delta) => { const b = node('button', rot, 'quiet'); b.type = 'button'; b.setAttribute('aria-label', `${aria} ${s.name}`); b.disabled = i + delta < 0 || i + delta >= mesmoTipo.length; b.onclick = async () => { b.disabled = true; try { await api(`/api/commercial/pipelines/${f.id}/stages/${s.id}`, 'PUT', { position: i + delta }); await recarregarFunis(); } catch (e) { mostrarErro(corpo, e); } }; return b; };
   const editar = node('button', 'Editar', 'quiet'); editar.type = 'button'; editar.onclick = () => abrirEdicao(s);
   const apagar = node('button', 'Apagar', 'quiet'); apagar.type = 'button';
   const bloqueada = s.leads + s.opportunities > 0 || mesmoTipo.length <= 1;
   apagar.disabled = bloqueada; apagar.title = mesmoTipo.length <= 1 ? 'O funil precisa de ao menos uma etapa de cada tipo' : bloqueada ? 'Mova os registros antes de apagar a etapa' : `Apagar ${s.name}`;
   apagar.onclick = async () => { if (!window.confirm(`Apagar a etapa "${s.name}"?`)) return; apagar.disabled = true; try { await api(`/api/commercial/pipelines/${f.id}/stages/${s.id}`, 'DELETE'); await recarregarFunis(); } catch (e) { mostrarErro(corpo, e); apagar.disabled = false; } };
   grupo.append(mover('↑', 'Subir', -1), mover('↓', 'Descer', 1), editar, apagar);
   return grupo;
  };
  const formularioDeEtapa = (s) => {
   const form = node('form', undefined, 'commercial-form au-form');
   form.append(node('h3', s ? `Editar etapa · ${s.name}` : 'Nova etapa'));
   const nome = campoDe(form, 'Nome', 'text', { required: true, maxLength: 80, value: s?.name || '' });
   const tipo = s ? null : listaDe(form, 'Tipo', Object.entries(TIPO_DA_ETAPA).map(([k, [rot]]) => [k, rot]), 'OPEN').s;
   const cor = campoDe(form, 'Cor', 'color', { value: s?.color || CORES.OPEN });
   const chance = campoDe(form, 'Chance de ganhar (%)', 'number', { min: '0', max: '100', value: String(s?.probability ?? 50) });
   const parado = campoDe(form, 'Avisar após (dias parado)', 'number', { min: '1', max: '3650', value: String(s?.stale_days ?? 14) });
   if (tipo) tipo.onchange = () => { cor.value = CORES[tipo.value]; };
   const enviar = node('button', s ? 'Salvar etapa' : 'Criar etapa', 'primary'); enviar.type = 'submit';
   const cancelar = node('button', 'Cancelar', 'quiet'); cancelar.type = 'button'; cancelar.onclick = () => { area.querySelector('.au-form')?.remove(); };
   form.append(enviar, cancelar);
   form.onsubmit = async e => {
    e.preventDefault(); enviar.disabled = true;
    const dados = { name: nome.value, color: cor.value, probability: Number(chance.value), stale_days: Number(parado.value) };
    try {
     if (s) await api(`/api/commercial/pipelines/${f.id}/stages/${s.id}`, 'PUT', dados);
     else await api(`/api/commercial/pipelines/${f.id}/stages`, 'POST', { ...dados, kind: tipo.value });
     await recarregarFunis();
    } catch (err) { mostrarErro(form, err); enviar.disabled = false; }
   };
   return form;
  };
  const abrirEdicao = s => { area.querySelector('.au-form')?.remove(); area.prepend(formularioDeEtapa(s)); area.querySelector('input')?.focus(); };
  novaEtapa.onclick = () => abrirEdicao(null);
  acoes.append(novaEtapa);
  desenharEtapas();
 }

 function formularioDeFunil() {
  const form = node('form', undefined, 'commercial-form au-form');
  form.append(node('h3', 'Novo funil'));
  const nome = campoDe(form, 'Nome do funil', 'text', { required: true, maxLength: 120 });
  const oferta = campoDe(form, 'Oferta (o que este funil vende, opcional)', 'text', { maxLength: 160 });
  form.append(node('small', 'Nasce com as etapas básicas (Novos, Qualificação, Ganho e Perdido): você ajusta depois. O nome entra no utm_tzolkin do anúncio como <espaço>.<identificador>.', 'detail'));
  const enviar = node('button', 'Criar funil', 'primary'); enviar.type = 'submit'; form.append(enviar);
  form.onsubmit = async e => {
   e.preventDefault(); enviar.disabled = true;
   try {
    const r = await api('/api/commercial/pipelines', 'POST', { space_id: espaco, slug: slugDe(nome.value), name: nome.value, offer_name: oferta.value.trim() || null });
    funilId = r.id; formAberto = false; await recarregarFunis();
   } catch (err) { mostrarErro(form, err); enviar.disabled = false; }
  };
  return form;
 }

 // ---------- Tarefas (requisitos de etapa) ----------
 async function abaTarefas(corpo) {
  const f = funilAtual();
  if (!f) { corpo.replaceChildren(node('p', 'Nenhum funil ativo neste espaço. Crie um em Pipelines.', 'empty-list')); return; }
  const [{ requirements }, { fields }] = await Promise.all([api('/api/commercial/stage-requirements?pipeline_id=' + f.id), api('/api/commercial/space-fields?space_id=' + encodeURIComponent(espaco))]);
  const cab = node('div', undefined, 'au-topo');
  cab.append(node('p', 'O que cada etapa exige para o lead ou a oportunidade entrar nela ou sair dela. Tarefa: nasce para o registro na primeira tentativa e precisa ser concluída. Campo: precisa estar preenchido em Dados do espaço. Qualificar, descartar e perder nunca ficam presos.', 'detail'));
  const nova = node('button', formAberto ? 'Fechar' : 'Nova tarefa', formAberto ? 'secondary' : 'primary'); nova.type = 'button'; nova.onclick = () => { formAberto = !formAberto; desenhar(); };
  cab.append(nova);
  corpo.replaceChildren(cab);
  const ativos = funisDoEspaco().filter(x => x.is_active);
  if (ativos.length > 1) {
   const seletor = node('div', undefined, 'au-funis'); seletor.setAttribute('role', 'group'); seletor.setAttribute('aria-label', 'Funil');
   for (const x of ativos) { const b = node('button', undefined, 'au-funil' + (x.id === f.id ? ' active' : '')); b.type = 'button'; b.setAttribute('aria-pressed', String(x.id === f.id)); b.append(node('strong', x.name)); b.onclick = () => { funilId = x.id; desenhar(); }; seletor.append(b); }
   corpo.append(seletor);
  }
  if (formAberto) corpo.append(formularioDeTarefa(f, fields));
  const nomeDaEtapa = id => f.stages.find(s => s.id === id)?.name || '—';
  const ordem = new Map(f.stages.map((s, i) => [s.id, i]));
  const linhas = [...requirements].sort((a, b) => (ordem.get(a.stage_id) - ordem.get(b.stage_id)) || a.gate.localeCompare(b.gate));
  if (!linhas.length) { corpo.append(node('p', `Nenhuma tarefa exigida em ${f.name}. Crie a primeira em "Nova tarefa".`, 'empty-list')); return; }
  corpo.append(tabela({
   legenda: `Tarefas exigidas em ${f.name}`,
   linhas,
   colunas: [
    { titulo: 'Etapa', celula: r => nomeDaEtapa(r.stage_id) },
    { titulo: 'Quando', celula: r => GATES[r.gate] },
    { titulo: 'Exige', celula: r => celulaNome({ nome: r.title, apoio: TIPOS[r.kind] }) },
    { titulo: 'Detalhe', celula: r => (r.kind === 'FIELD' ? `Campo "${r.field_key}"` : [r.owner_id ? 'Responsável ' + (donos?.find(d => d.id === r.owner_id)?.name || '') : null, r.due_days != null ? `prazo de ${r.due_days} dias` : null].filter(Boolean).join(' · ') || '—') },
    { titulo: 'Situação', celula: r => selo(r.is_active ? 'Ligada' : 'Desligada', r.is_active ? 'success' : 'neutral') },
    { titulo: '', celula: r => { const b = node('button', r.is_active ? 'Desligar' : 'Ligar', 'quiet'); b.type = 'button'; b.onclick = async () => { b.disabled = true; try { await api('/api/commercial/stage-requirements/' + r.id, 'PUT', { version: r.version, is_active: !r.is_active }); desenhar(); } catch (e) { mostrarErro(corpo, e); b.disabled = false; } }; return b; } },
   ],
  }));
 }

 function formularioDeTarefa(f, fields) {
  const form = node('form', undefined, 'commercial-form au-form');
  form.append(node('h3', 'Nova tarefa de etapa'));
  const etapa = listaDe(form, 'Etapa', f.stages.map(s => [s.id, s.name])).s;
  const gate = listaDe(form, 'Quando', Object.entries(GATES)).s;
  const tipo = listaDe(form, 'Exige', Object.entries(TIPOS)).s;
  const titulo = campoDe(form, 'Título', 'text', { required: true, maxLength: 200 });
  const campo = listaDe(form, 'Campo', []);
  const prazo = campoDe(form, 'Prazo da tarefa, em dias (opcional)', 'number', { min: '0', max: '365' });
  const dono = listaDe(form, 'Responsável pela tarefa (opcional)', [['', 'Sem responsável'], ...(donos || []).map(o => [o.id, o.name || o.email])]);
  const semCampo = node('p', 'Este espaço ainda não tem campo ativo para este tipo de registro. Crie na aba Campos.', 'detail');
  const enviar = node('button', 'Adicionar tarefa', 'primary'); enviar.type = 'submit';
  form.append(semCampo, enviar);
  const sincroniza = () => {
   const fase = f.stages.find(s => s.id === etapa.value)?.kind === 'LEAD' ? 'lead' : 'opportunity';
   const doTipo = fields.filter(x => x.entity === fase && x.is_active);
   campo.s.replaceChildren(...doTipo.map(x => { const o = node('option', x.label); o.value = x.key; return o; }));
   const eCampo = tipo.value === 'FIELD';
   campo.l.hidden = !eCampo; prazo.parentElement.hidden = dono.l.hidden = eCampo;
   enviar.disabled = eCampo && !doTipo.length; semCampo.hidden = !(eCampo && !doTipo.length);
  };
  etapa.onchange = sincroniza; tipo.onchange = sincroniza; sincroniza();
  form.onsubmit = async e => {
   e.preventDefault(); enviar.disabled = true;
   try {
    const eCampo = tipo.value === 'FIELD';
    await api('/api/commercial/stage-requirements', 'POST', { pipeline_id: f.id, stage_id: etapa.value, gate: gate.value, kind: tipo.value, title: titulo.value,
     ...(eCampo ? { field_key: campo.s.value } : { ...(prazo.value !== '' ? { due_days: Number(prazo.value) } : {}), ...(dono.s.value ? { owner_id: dono.s.value } : {}) }) });
    formAberto = false; desenhar();
   } catch (err) { mostrarErro(form, err); enviar.disabled = false; }
  };
  return form;
 }

 // ---------- Campos ----------
 function abaCampos(corpo) {
  const gerente = fieldsManager({ api, spaces: espacos().filter(e => e.id === espaco), initialSpace: espaco });
  gerente.classList.add('au-embutido');
  corpo.replaceChildren(gerente);
  gerente.open = true;
 }

 return { load: (opcoes = {}) => { if (opcoes.painel && opcoes.painel !== aba) { aba = opcoes.painel; formAberto = false; selecionada = null; } espacoFixo = opcoes.espaco || ''; if (espacoFixo) espaco = espacoFixo; return carregar().catch(reportError); }, clear() { geracao++; espacoFixo = ''; funis = []; donos = null; espaco = ''; funilId = ''; aba = painelInicial; formAberto = false; selecionada = null; $(hostId)?.replaceChildren(); } };
}
