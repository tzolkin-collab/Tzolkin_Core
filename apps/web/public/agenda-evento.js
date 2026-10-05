// Agenda: o formulário (criar/editar) e o painel lateral do evento. Não sabe desenhar o calendário; recebe os dados e avisa quando algo mudou.
import { el, botao, campo, preencher } from './agenda-dom.js';
import { criarPeek } from './peek.js';
import { pares } from './inline-edit.js';
import { selo } from './data-table.js';
import * as M from './agenda-model.js';
import { duracaoPadraoMin, meetAutomatico } from './agenda-prefs.js';
import { blocoDeLembrete, blocoDeRepeticao } from './agenda-repeticao.js';

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
export function abrirEditor({ host, api, dados, tenants, pessoas = [], evento = null, inicio = null, fim = null, tenantPadrao = '', aoSalvar }) {
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
  if (ini && (!fimAtual || Date.parse(fimAtual) <= Date.parse(ini))) termino.value = M.paraCampoLocal(Date.parse(ini) + duracaoPadraoMin() * 60000);
  termino.min = comeco.value;
 });

 // Descrição, local e link dependem da migração 047. Sem ela (dados.agenda_campos falso) os campos nem aparecem.
 const comCampos = dados.agenda_campos === true;
 const extra = el('div', null, 'tracking-extra');   // display: contents: os campos entram na grade do formulário como se não houvesse o bloco
 const descricao = campo(extra, 'Descrição (opcional)', 'area'); descricao.maxLength = 2000; descricao.rows = 3;
 const local = campo(extra, 'Local (opcional)'); local.maxLength = 200;
 const link = campo(extra, 'Link da reunião (opcional)', 'url'); link.maxLength = 500; link.placeholder = 'https://…';
 if (comCampos) form.append(extra);

 // Lembrete e repetição dependem da migração 048 (dados.agenda_lembretes). Sem ela, nem aparecem.
 const comLembretes = dados.agenda_lembretes === true;
 const serie = evento?.series_id ? (dados.series || []).find(s => s.id === evento.series_id) : null;
 const padrao = dados.agenda_prefs?.default_reminders ?? [15];
 const lembrete = comLembretes ? blocoDeLembrete({ padrao, atual: evento ? evento.reminders ?? null : null }) : null;
 const repeticao = comLembretes && !evento ? blocoDeRepeticao({ inicio: () => M.doCampoLocal(comeco.value) ? Date.parse(M.doCampoLocal(comeco.value)) : null }) : null;
 let escopo = null;   // "só este" ou "este e os próximos", para ocorrência de série
 if (lembrete) form.append(lembrete.no);
 // Videoconferência: só para quem conectou a conta Google (Configurações → Integrações). A sala é criada no Google Agenda da pessoa.
 const comMeet = dados.google_meet === true && !(evento && evento.status === 'cancelled');
 let meet = null, convidados = null, blocoMeet = null;
 if (comMeet) {
  blocoMeet = el('fieldset', null, 'ag-bloco ag-meet');
  blocoMeet.append(el('legend', 'Videoconferência'));
  if (evento?.google_event_id) {
   blocoMeet.append(el('p', 'A sala do Meet já foi criada no seu Google Agenda. Mudanças de horário, título e cancelamento acompanham aqui.', 'detail'));
  } else {
   meet = campo(blocoMeet, 'Sala', 'text', [['', 'Sem videoconferência'], ['meet', 'Adicionar videoconferência do Google Meet']]);
   convidados = campo(blocoMeet, 'Convidados (e-mails, separados por vírgula)', 'text'); convidados.placeholder = 'ana@empresa.com, bia@empresa.com'; convidados.maxLength = 1000;
   const rotuloConvidados = convidados.parentElement; rotuloConvidados.hidden = true;
   // Contatos (stakeholders) da empresa escolhida primeiro, depois os demais: escolher um põe o e-mail na lista de convidados.
   const lista = el('datalist'); lista.id = 'ag-contatos-' + Math.random().toString(36).slice(2, 8);
   const busca = campo(blocoMeet, 'Adicionar contato como convidado', 'text'); busca.setAttribute('list', lista.id); busca.placeholder = 'Digite um nome ou e-mail…'; busca.autocomplete = 'off';
   const rotuloBusca = busca.parentElement; rotuloBusca.hidden = true; rotuloBusca.append(lista);
   const comEmail = pessoas.filter(p => p.email);
   const desenharContatos = () => {
    const doCliente = p => p.tenant_id === cliente.value;
    const ordem = [...comEmail].sort((a, b) => Number(doCliente(b)) - Number(doCliente(a)));
    const vistos = new Set(), opcoesLista = [];
    for (const p of ordem) { const k = p.email.toLowerCase(); if (vistos.has(k)) continue; vistos.add(k); const o = el('option'); o.value = p.email; o.label = [p.name, (tenants.find(t => t.id === p.tenant_id) || {}).name].filter(Boolean).join(' · '); opcoesLista.push(o); }
    lista.replaceChildren(...opcoesLista);
   };
   const adicionar = () => {
    const v = busca.value.trim().toLowerCase(); if (!v) return;
    const p = comEmail.find(x => x.email.toLowerCase() === v) || comEmail.find(x => x.name.toLowerCase() === v);
    if (!p) return;
    const atuais = convidados.value.split(/[,;\s]+/).filter(Boolean);
    if (!atuais.some(x => x.toLowerCase() === p.email.toLowerCase())) convidados.value = [...atuais, p.email].join(', ');
    busca.value = '';
   };
   busca.addEventListener('input', adicionar); busca.addEventListener('change', adicionar);
   cliente.addEventListener('change', desenharContatos); desenharContatos();
   // Sala escolhida: o local vira "Google Meet" (se estava vazio) e o link é gerado pelo Google, então o campo fica travado.
   let localAutomatico = false;
   const sincronizarSala = () => {
    const comSala = meet.value === 'meet';
    rotuloConvidados.hidden = !comSala; rotuloBusca.hidden = !comSala;
    if (comSala) { if (!local.value.trim()) { local.value = 'Google Meet'; localAutomatico = true; } link.disabled = true; link.placeholder = 'O Google gera o link ao criar a sala'; link.value = ''; }
    else { if (localAutomatico && local.value === 'Google Meet') local.value = ''; localAutomatico = false; link.disabled = false; link.placeholder = 'https://…'; }
   };
   local.addEventListener('input', () => { localAutomatico = false; });
   meet.addEventListener('change', sincronizarSala);
   // Como no Calendly: quem quer sala em toda atividade nova liga isso em Configurações → Agenda e já abre com ela marcada.
   if (!evento && meetAutomatico()) { meet.value = 'meet'; sincronizarSala(); }
  }
  form.append(blocoMeet);
  if (comCampos) form.append(local.parentElement, link.parentElement);   // Local e link logo abaixo da sala
 }
 if (repeticao) {
  form.append(repeticao.no);
  const curto = () => { const i = M.doCampoLocal(comeco.value), f = M.doCampoLocal(termino.value); return !i || !f || Date.parse(f) - Date.parse(i) <= 86400000; };
  const sincronizar = () => { repeticao.inicioMudou(); repeticao.limitar(curto()); if (blocoMeet) blocoMeet.hidden = repeticao.escolhida(); };
  comeco.addEventListener('change', sincronizar); termino.addEventListener('change', sincronizar); repeticao.no.addEventListener('change', sincronizar);
  sincronizar();
 }
 if (serie && !serie.ended_at) {
  const bloco = el('fieldset', null, 'ag-bloco');
  bloco.append(el('legend', 'Esta atividade se repete'));
  bloco.append(el('p', `${serie.descricao}.`, 'detail'));
  escopo = campo(bloco, 'Aplicar a', 'text', [['um', 'Só este evento'], ['proximos', 'Este e os próximos']]);
  escopo.addEventListener('change', () => { contratacao.disabled = escopo.value === 'proximos'; });
  form.insertBefore(bloco, form.children[1]);
 }

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
  comeco.value = M.paraCampoLocal(ini); termino.value = M.paraCampoLocal(fim ?? ini + duracaoPadraoMin() * 60000);
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
   const extras = comCampos ? { description: descricao.value.trim(), location: local.value.trim(), ...(link.disabled ? {} : { meeting_url: link.value.trim() }) } : {};
   let atividade;
   const regra = repeticao ? repeticao.valor(Date.parse(ini), Date.parse(term)) : null;   // lança com a mensagem certa se a repetição está incompleta
   if (!evento && regra) {
    // Atividade que se repete é uma série: o servidor cria a regra e já gera as ocorrências.
    const corpo = { id: crypto.randomUUID(), tenant_id: cliente.value, engagement_id: contratacao.value || null, category: categoria.value, kind: tipo.value, title: nome.value, ...regra };
    for (const [k, v] of Object.entries(extras)) if (v) corpo[k] = v;
    const rem = lembrete.valor(); if (rem !== null) corpo.reminders = rem;
    await api('/api/tracking/series', 'POST', corpo);
    aoSalvar(null);
    dialog.close();
    return;
   }
   if (evento && escopo?.value === 'proximos') {
    // "Este e os próximos": a série herda título, tipo, textos, horário (hora do dia e duração) e lembrete. O DIA não muda aqui.
    if (M.diaDe(Date.parse(ini)) !== M.diaDe(evento.ini)) throw new Error('Para mudar o dia, escolha "Só este evento".');
    const campos = {};
    if (nome.value.trim() !== evento.title) campos.title = nome.value;
    if (categoria.value !== evento.category) campos.category = categoria.value;
    if (tipo.value !== evento.kind) campos.kind = tipo.value;
    if (M.hora(Date.parse(ini)) !== M.hora(evento.ini)) campos.start_time = M.hora(Date.parse(ini));
    if (Date.parse(term) - Date.parse(ini) !== evento.fim - evento.ini) campos.duration_minutes = Math.round((Date.parse(term) - Date.parse(ini)) / 60000);
    for (const [k, v] of Object.entries(extras)) if (v !== (evento[k] || '')) campos[k] = v || null;
    if (lembrete && JSON.stringify(lembrete.valor()) !== JSON.stringify(evento.reminders ?? null)) campos.reminders = lembrete.valor();
    if (!Object.keys(campos).length) { dialog.close(); return; }
    await api('/api/tracking/series/' + serie.id, 'PUT', { revision: serie.revision, ...campos });
    aoSalvar(null);
    dialog.close();
    return;
   }
   if (!evento) {
    const corpo = { id: crypto.randomUUID(), tenant_id: cliente.value, engagement_id: contratacao.value || null, category: categoria.value, kind: tipo.value, title: nome.value, starts_at: ini, ends_at: term };
    for (const [k, v] of Object.entries(extras)) if (v) corpo[k] = v;
    if (lembrete) { const rem = lembrete.valor(); if (rem !== null) corpo.reminders = rem; }   // padrão = não manda: a atividade segue o padrão da agenda
    atividade = (await api('/api/tracking', 'POST', corpo)).activity;
   } else {
    const campos = {};
    if (nome.value.trim() !== evento.title) campos.title = nome.value;
    if (categoria.value !== evento.category) campos.category = categoria.value;
    if (tipo.value !== evento.kind) campos.kind = tipo.value;
    if (Date.parse(ini) !== evento.ini || Date.parse(term) !== evento.fim) { campos.starts_at = ini; campos.ends_at = term; }
    for (const [k, v] of Object.entries(extras)) if (v !== (evento[k] || '')) campos[k] = v || null;   // vazio limpa o campo
    if (lembrete && JSON.stringify(lembrete.valor()) !== JSON.stringify(evento.reminders ?? null)) campos.reminders = lembrete.valor();
    atividade = evento;
    if (Object.keys(campos).length) atividade = (await api('/api/tracking/' + evento.id, 'PUT', { revision: evento.revision, ...campos })).activity;
    // A contratação tem rota própria e exige a revisão que acabou de subir.
    if ((contratacao.value || null) !== (evento.engagement_id || null))
     atividade = (await api(`/api/tracking/${evento.id}/engagement`, 'PUT', { engagement_id: contratacao.value || null, revision: atividade.revision })).activity;
   }
   // Sala do Meet: depois de a atividade estar gravada. Se o Google falhar, a atividade fica e a pessoa é avisada (sem criar duas vezes).
   let extra = null;
   if (meet?.value === 'meet') {
    try { atividade = (await api(`/api/tracking/${atividade.id}/meet`, 'POST', { convidados: convidados.value.trim() })).activity; }
    catch (falha) { extra = { aviso: `A atividade foi salva, mas a sala do Meet não foi criada: ${falha.message}` }; }
   }
   const emp = (dados.engagements || []).find(x => x.id === atividade.engagement_id);
   const empresa = tenants.find(t => t.id === atividade.tenant_id);
   aoSalvar({ ...(evento || {}), ...atividade, tenant_name: evento?.tenant_name || empresa?.name || '', engagement_label: emp?.label || null, engagement_service_model: emp?.service_model || null }, extra);
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

 function detalhes(e, erroNo, dados) {
  const painel = el('div');
  const serie = serieDe(e, dados);
  const efetivo = M.lembreteEfetivo(e, dados.agenda_prefs?.default_reminders);
  const linhas = [
   { rotulo: 'Quando', valor: quandoTexto(e) },
   { rotulo: 'Cliente', valor: clienteLink(e) },
   { rotulo: 'Contratação', valor: e.engagement_label || 'Geral da empresa' },
   { rotulo: 'Categoria', valor: selo(M.ROTULOS[e.category], M.TOM_DA_CATEGORIA[e.category]) },
   { rotulo: 'Tipo', valor: M.ROTULOS[e.kind] },
   { rotulo: 'Situação', valor: selo(M.ROTULOS[e.status], TOM_DA_SITUACAO[e.status] || 'neutral') },
   { rotulo: 'Local', valor: e.location || null },
   { rotulo: 'Link da reunião', valor: e.meeting_url ? linkExterno(e.meeting_url) : null },
   { rotulo: 'Google Agenda', valor: e.google_event_id ? 'Evento criado e sincronizado' : null },
   { rotulo: 'Descrição', valor: e.description ? el('p', e.description, 'ag-descricao') : null },
   ...(dados.agenda_lembretes ? [
    { rotulo: 'Repete', valor: serie ? (serie.ended_at ? `${serie.descricao} (encerrada)` : serie.descricao) : null },
    { rotulo: 'Lembrete', valor: `${M.textoDosLembretes(efetivo.minutos)}${efetivo.origem === 'padrao' && efetivo.minutos.length ? ' (padrão da agenda)' : ''}` },
   ] : []),
  ];
  painel.append(pares(linhas), el('p', 'Horário de Brasília.', 'ag-nota'), erroNo);
  return painel;
 }
 const serieDe = (e, dados) => (e.series_id ? (dados.series || []).find(s => s.id === e.series_id) || null : null);
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
  const serie = serieDe(e, dadosAtuais || {});
  if (dadosAtuais?.google_meet && !e.google_event_id && e.status !== 'cancelled') { const m = botao('Adicionar videoconferência do Meet', 'plus', () => acao(m, erroNo, () => api(`/api/tracking/${e.id}/meet`, 'POST', {})), 'secondary'); nos.push(m); }
  if (serie && !serie.ended_at) nos.push(botao('Encerrar repetição', 'close', () => confirmarEncerrar(e, serie, erroNo), 'quiet'));
  if (e.status === 'planned') nos.push(mudar('Cancelar atividade', 'cancelled', 'close', 'quiet'), mudar('Concluir', 'done', 'check', 'primary'));
  else nos.push(mudar(e.status === 'done' ? 'Reabrir' : 'Reativar', 'planned', 'clock', 'secondary'));
  return nos;
 }

 // Encerrar uma série não se desfaz: pede confirmação e diz exatamente o que some.
 function confirmarEncerrar(e, serie, erroNo) {
  const parar = (rotulo, from) => { const b = botao(rotulo, 'close', () => acao(b, erroNo, () => api(`/api/tracking/series/${serie.id}/end`, 'POST', { revision: serie.revision, ...(from ? { from } : {}) })), 'primary'); return b; };
  pk.pe([
   el('p', `${serie.descricao}. Os eventos já realizados ficam; os próximos planejados saem da agenda.`, 'ag-nota'),
   botao('Voltar', 'close', () => desenhar(e, dadosAtuais), 'secondary'),
   parar('Só os próximos a partir deste', new Date(e.ini).toISOString()),
   parar('Todos os próximos', null),
  ]);
 }

 function desenhar(e, dados) {
  pk.titulo(e.title, [e.tenant_name, e.engagement_label].filter(Boolean).join(' · '));
  pk.abas([
   { key: 'detalhes', label: 'Detalhes', painel: detalhes(e, el('p', null, 'form-error'), dados) },
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
