// Agenda: o formulário (criar/editar) e o painel lateral do evento. Não sabe desenhar o calendário; recebe os dados e avisa quando algo mudou.
import { el, botao, campo, preencher } from './agenda-dom.js';
import { criarPeek } from './peek.js';
import { pares } from './inline-edit.js';
import { selo } from './data-table.js';
import * as M from './agenda-model.js';

const TOM_DA_SITUACAO = { planned: 'info', done: 'success', cancelled: 'neutral' };
const opcoes = chaves => chaves.map(k => [k, M.ROTULOS[k]]);
const TIPOS = ['sessao', 'entregavel', 'feature', 'tarefa'];
const maiuscula = t => t.charAt(0).toUpperCase() + t.slice(1);
const contratacoesDe = (dados, tenantId, vazio) => [['', vazio], ...(dados.engagements || []).filter(e => e.tenant_id === tenantId).map(e => [e.id, e.label])];
const GERAL = 'Geral da empresa (sem contratação)';

/** Hora cheia seguinte: o início padrão de "Nova atividade" quando a pessoa não clicou num horário. */
const proximaHora = () => { const ms = Date.now(); return ms - (ms % 3600000) + 3600000; };

/**
 * Formulário de criar (evento = null) ou editar. Cliente não muda depois de criado (a API não troca a empresa de uma atividade).
 * `inicio`/`fim` (ms) pré-preenchem o horário, vindos de um clique ou arraste na grade.
 * `aoSalvar(atividade)` recebe a atividade já mesclada com o nome da empresa e da contratação.
 */
export function abrirEditor({ host, api, dados, tenants, evento = null, inicio = null, fim = null, tenantPadrao = '', aoSalvar }) {
 const anterior = document.activeElement;
 const dialog = el('dialog', null, 'tracking-editor');
 const form = el('form', null, 'tracking-form');
 dialog.append(form);

 const titulo = el('h2', evento ? 'Editar atividade' : 'Nova atividade');
 titulo.id = 'tracking-editor-title';
 dialog.setAttribute('aria-labelledby', titulo.id);
 const topo = el('header', null, 'tracking-editor-heading');
 const intro = el('div');
 intro.append(titulo, el('p', evento ? 'Altere o que mudou; o resto fica como está.' : 'Organize uma sessão, tarefa ou entrega.', 'detail'));
 topo.append(intro, botao('Fechar', 'close', () => dialog.close()));
 form.append(topo);

 const nome = campo(form, 'Título'); nome.required = true; nome.minLength = 2; nome.maxLength = 160; nome.placeholder = 'Ex.: Revisão dos objetivos da mentoria';
 const cliente = campo(form, 'Cliente', 'text', [['', 'Selecione'], ...tenants.map(t => [t.id, t.name])]); cliente.required = true;
 const contratacao = campo(form, 'Contratação (opcional)', 'text', contratacoesDe(dados, '', GERAL));
 cliente.addEventListener('change', () => preencher(contratacao, contratacoesDe(dados, cliente.value, GERAL), ''));

 const organizacao = el('fieldset', null, 'tracking-field-grid');
 const categoria = campo(organizacao, 'Categoria', 'text', opcoes(M.CATEGORIAS));
 const tipo = campo(organizacao, 'Tipo', 'text', opcoes(TIPOS));
 organizacao.prepend(el('legend', 'Organização'));
 form.append(organizacao);

 const quando = el('fieldset', null, 'tracking-field-grid');
 const comeco = campo(quando, 'Início · Brasília', 'datetime-local'); comeco.required = true;
 const termino = campo(quando, 'Fim / prazo · Brasília', 'datetime-local'); termino.required = true;
 quando.prepend(el('legend', 'Quando acontece'));
 form.append(quando);
 // Mudou o início e o fim ficou antes dele: o fim vai para uma hora depois, como nos calendários.
 comeco.addEventListener('change', () => {
  const ini = M.doCampoLocal(comeco.value), fimAtual = M.doCampoLocal(termino.value);
  if (ini && (!fimAtual || Date.parse(fimAtual) <= Date.parse(ini))) termino.value = M.paraCampoLocal(Date.parse(ini) + 3600000);
  termino.min = comeco.value;
 });

 // Descrição, local e link dependem da migração 047. Sem ela (dados.agenda_campos falso) os campos nem aparecem.
 const comCampos = dados.agenda_campos === true;
 const extra = el('div', null, 'tracking-extra');   // display: contents: os campos entram na grade do formulário como se não houvesse o bloco
 const descricao = campo(extra, 'Descrição (opcional)', 'area'); descricao.maxLength = 2000; descricao.rows = 3;
 const local = campo(extra, 'Local (opcional)'); local.maxLength = 200;
 const link = campo(extra, 'Link da reunião (opcional)', 'url'); link.maxLength = 500; link.placeholder = 'https://…';
 if (comCampos) form.append(extra);

 // Valores iniciais
 if (evento) {
  nome.value = evento.title; cliente.value = evento.tenant_id; cliente.disabled = true;
  preencher(contratacao, contratacoesDe(dados, evento.tenant_id, GERAL), evento.engagement_id || '');
  categoria.value = evento.category; tipo.value = evento.kind;
  comeco.value = M.paraCampoLocal(evento.ini); termino.value = M.paraCampoLocal(evento.fim);
  descricao.value = evento.description || ''; local.value = evento.location || ''; link.value = evento.meeting_url || '';
 } else {
  cliente.value = tenantPadrao;
  preencher(contratacao, contratacoesDe(dados, cliente.value, GERAL), '');
  const ini = inicio ?? proximaHora();
  comeco.value = M.paraCampoLocal(ini); termino.value = M.paraCampoLocal(fim ?? ini + 3600000);
 }
 termino.min = comeco.value;

 const erro = el('p', null, 'form-error'); erro.setAttribute('role', 'alert'); erro.tabIndex = -1;
 form.append(erro);
 const rodape = el('div', null, 'tracking-editor-footer');
 const salvar = el('button', evento ? 'Salvar alterações' : 'Criar atividade', 'primary'); salvar.type = 'submit';
 rodape.append(botao('Cancelar', 'close', () => dialog.close()), salvar);
 form.append(rodape);

 form.onsubmit = async e => {
  e.preventDefault();
  if (salvar.disabled) return;
  erro.textContent = '';
  const ini = M.doCampoLocal(comeco.value), term = M.doCampoLocal(termino.value);
  if (!ini || !term) { erro.textContent = 'Informe um início e um fim válidos.'; erro.focus(); return; }
  if (Date.parse(term) <= Date.parse(ini)) { erro.textContent = 'O fim precisa ser depois do início.'; erro.focus(); return; }
  const rotuloOriginal = salvar.textContent;
  salvar.disabled = true; salvar.textContent = 'Salvando…'; form.setAttribute('aria-busy', 'true');
  try {
   const extras = comCampos ? { description: descricao.value.trim(), location: local.value.trim(), meeting_url: link.value.trim() } : {};
   let atividade;
   if (!evento) {
    const corpo = { id: crypto.randomUUID(), tenant_id: cliente.value, engagement_id: contratacao.value || null, category: categoria.value, kind: tipo.value, title: nome.value, starts_at: ini, ends_at: term };
    for (const [k, v] of Object.entries(extras)) if (v) corpo[k] = v;
    atividade = (await api('/api/tracking', 'POST', corpo)).activity;
   } else {
    const campos = {};
    if (nome.value.trim() !== evento.title) campos.title = nome.value;
    if (categoria.value !== evento.category) campos.category = categoria.value;
    if (tipo.value !== evento.kind) campos.kind = tipo.value;
    if (Date.parse(ini) !== evento.ini || Date.parse(term) !== evento.fim) { campos.starts_at = ini; campos.ends_at = term; }
    for (const [k, v] of Object.entries(extras)) if (v !== (evento[k] || '')) campos[k] = v || null;   // vazio limpa o campo
    atividade = evento;
    if (Object.keys(campos).length) atividade = (await api('/api/tracking/' + evento.id, 'PUT', { revision: evento.revision, ...campos })).activity;
    // A contratação tem rota própria e exige a revisão que acabou de subir.
    if ((contratacao.value || null) !== (evento.engagement_id || null))
     atividade = (await api(`/api/tracking/${evento.id}/engagement`, 'PUT', { engagement_id: contratacao.value || null, revision: atividade.revision })).activity;
   }
   const emp = (dados.engagements || []).find(x => x.id === atividade.engagement_id);
   const empresa = tenants.find(t => t.id === atividade.tenant_id);
   aoSalvar({ ...(evento || {}), ...atividade, tenant_name: evento?.tenant_name || empresa?.name || '', engagement_label: emp?.label || null, engagement_service_model: emp?.service_model || null });
   dialog.close();
  } catch (falha) {
   erro.textContent = falha.message; erro.focus();
  } finally {
   salvar.disabled = false; salvar.textContent = rotuloOriginal; form.removeAttribute('aria-busy');
  }
 };

 dialog.onclose = () => { dialog.remove(); if (anterior?.isConnected) anterior.focus(); };
 host.append(dialog);
 dialog.showModal();
 nome.focus();
 return dialog;
}

/** Painel lateral do evento: Detalhes (com as ações de situação) e Tempo (apontamentos). */
export function criarPainel({ api, openTenant, aoEditar, recarregar }) {
 let atual = null, ultimaAba = 'detalhes', dadosAtuais = null;
 const pk = criarPeek({ id: 'peek-agenda', prefixo: 'agenda', rotulo: 'Evento da agenda', aoFechar: () => fechar() });

 function fechar() { atual = null; pk.fechar(); }

 async function acao(botaoClicado, erroNo, fazer) {
  botaoClicado.disabled = true; erroNo.textContent = '';
  try { await fazer(); await recarregar(); }
  catch (falha) { erroNo.textContent = falha.message; botaoClicado.disabled = false; }
 }

 function detalhes(e, erroNo) {
  const painel = el('div');
  const linhas = [
   { rotulo: 'Quando', valor: quandoTexto(e) },
   { rotulo: 'Cliente', valor: clienteLink(e) },
   { rotulo: 'Contratação', valor: e.engagement_label || 'Geral da empresa' },
   { rotulo: 'Categoria', valor: selo(M.ROTULOS[e.category], M.TOM_DA_CATEGORIA[e.category]) },
   { rotulo: 'Tipo', valor: M.ROTULOS[e.kind] },
   { rotulo: 'Situação', valor: selo(M.ROTULOS[e.status], TOM_DA_SITUACAO[e.status] || 'neutral') },
   { rotulo: 'Local', valor: e.location || null },
   { rotulo: 'Link da reunião', valor: e.meeting_url ? linkExterno(e.meeting_url) : null },
   { rotulo: 'Descrição', valor: e.description ? el('p', e.description, 'ag-descricao') : null },
  ];
  painel.append(pares(linhas), el('p', 'Horário de Brasília.', 'ag-nota'), erroNo);
  return painel;
 }
 function quandoTexto(e) {
  const dia = maiuscula(M.titulo('dia', M.diaDe(e.ini)));
  return M.diaDe(e.ini) === M.diaDe(e.fim - 1) ? `${dia} · ${M.intervaloTexto(e.ini, e.fim)} (${M.duracaoTexto((e.fim - e.ini) / 60000)})` : M.intervaloTexto(e.ini, e.fim);
 }
 function clienteLink(e) {
  if (!openTenant || !e.tenant_id) return e.tenant_name || '—';
  const b = el('button', e.tenant_name || 'Abrir empresa', 'link-nome'); b.type = 'button';
  b.onclick = () => { fechar(); openTenant(e.tenant_id); };
  return b;
 }
 function linkExterno(url) {
  let host = url;
  try { const u = new URL(url); if (u.protocol !== 'https:') return el('span', url); host = u.hostname; } catch { return el('span', url); }
  const a = el('a', host); a.href = url; a.target = '_blank'; a.rel = 'noopener noreferrer';
  return a;
 }

 function tempo(e, dados, erroNo) {
  const painel = el('div');
  const registros = (dados.logs || []).filter(l => l.activity_id === e.id);
  const total = registros.reduce((s, l) => s + l.minutes, 0);
  painel.append(el('p', registros.length ? `${M.duracaoTexto(total)} registradas em ${registros.length} apontamento${registros.length === 1 ? '' : 's'} (período carregado).` : 'Nenhum apontamento carregado para esta atividade neste período.', 'detail'));
  const lista = el('div', null, 'ag-apontamentos');
  for (const l of registros) lista.append(el('p', `${String(l.worked_on).slice(0, 10).split('-').reverse().join('/')} · ${l.minutes} min — ${l.note}`));
  painel.append(lista);

  const form = el('form', null, 'ag-tempo');
  form.append(el('h3', 'Registrar tempo'), el('p', 'Registre o trabalho realizado, não o tempo previsto.', 'detail'));
  const dia = campo(form, 'Dia trabalhado', 'date'); dia.required = true; dia.value = M.diaDe(Date.now());
  const minutos = campo(form, 'Minutos trabalhados', 'number'); minutos.required = true; minutos.min = 1; minutos.max = 1440; minutos.step = 1;
  const nota = campo(form, 'Descrição do trabalho'); nota.required = true; nota.minLength = 2; nota.maxLength = 500;
  const enviar = el('button', 'Registrar tempo', 'primary'); enviar.type = 'submit';
  form.append(enviar);
  form.onsubmit = ev => {
   ev.preventDefault();
   acao(enviar, erroNo, () => api(`/api/tracking/${e.id}/time`, 'POST', { id: crypto.randomUUID(), worked_on: dia.value, minutes: Number(minutos.value), note: nota.value }));
  };
  painel.append(form, erroNo);
  return painel;
 }

 function rodape(e, erroNo) {
  const mudar = (rotulo, status, icone, classe) => { const b = botao(rotulo, icone, () => acao(b, erroNo, () => api(`/api/tracking/${e.id}/status`, 'PUT', { status, revision: e.revision })), classe); return b; };
  const nos = [botao('Editar', 'pencil', () => aoEditar(e))];
  if (e.status === 'planned') nos.push(mudar('Cancelar atividade', 'cancelled', 'close', 'quiet'), mudar('Concluir', 'done', 'check', 'primary'));
  else nos.push(mudar(e.status === 'done' ? 'Reabrir' : 'Reativar', 'planned', 'clock', 'secondary'));
  return nos;
 }

 function desenhar(e, dados) {
  pk.titulo(e.title, [e.tenant_name, e.engagement_label].filter(Boolean).join(' · '));
  pk.abas([
   { key: 'detalhes', label: 'Detalhes', painel: detalhes(e, el('p', null, 'form-error')) },
   { key: 'tempo', label: 'Tempo', painel: tempo(e, dados, el('p', null, 'form-error')) },
  ], { ativa: ultimaAba, aoTrocar: k => { ultimaAba = k; } });
  pk.pe(rodape(e, pk.corpo.querySelector('.form-error') || el('p')));
 }

 return {
  abrir(evento, dados) { atual = evento.id; dadosAtuais = dados; ultimaAba = 'detalhes'; pk.abrir(); desenhar(evento, dados); },
  /** Depois de recarregar a agenda: redesenha com a versão nova do evento (a revisão sobe a cada gravação). */
  atualizar(dados, normalizados) { dadosAtuais = dados; if (!atual) return; const novo = normalizados.find(a => a.id === atual); if (novo) desenhar(novo, dados); },
  fechar,
  aberto: () => atual !== null,
  id: () => atual,
 };
}
