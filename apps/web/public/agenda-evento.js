// Agenda: o formulário (criar/editar) e o painel lateral do evento. Não sabe desenhar o calendário; recebe os dados e avisa quando algo mudou.
import { el, botao, campo, preencher } from './agenda-dom.js';
import { criarPeek } from './peek.js';
import { pares } from './inline-edit.js';
import { selo } from './data-table.js';
import { mountTabs } from './tabs.js';
import * as M from './agenda-model.js';
import { duracaoPadraoMin, meetAutomatico, localDoMeet, convidarContatoPrincipal, JANELAS, janelaDoEvento, definirJanelaDoEvento } from './agenda-prefs.js';
import { blocoDeLembrete, blocoDeRepeticao } from './agenda-repeticao.js';

const TOM_DA_SITUACAO = { planned: 'info', done: 'success', cancelled: 'neutral' };
const maiuscula = t => t.charAt(0).toUpperCase() + t.slice(1);
/** Troca o texto de um campo feito por `campo` (o rótulo é o primeiro nó do <label>, e é o que o leitor de tela lê). */
const rotular = (controle, texto) => { controle.parentElement.firstChild.textContent = texto; };
/** Tipo na visualização, pelo nome da aba. Entregável e Feature, que são de antes das abas, dizem as duas coisas. */
const textoDoTipo = kind => {
 const aba = M.abaDoKind(kind);
 return M.KINDS_DA_ABA[aba][0] === kind ? M.ROTULO_DA_ABA[aba] : `${M.ROTULO_DA_ABA[aba]} · ${M.ROTULOS[kind] || kind}`;
};
const contratacoesDe = (dados, tenantId, vazio) => [['', vazio], ...(dados.engagements || []).filter(e => e.tenant_id === tenantId).map(e => [e.id, e.label])];
const GERAL = 'Geral da empresa (sem contratação)';
// O que cada aba é, em uma linha, para a pessoa não ter de descobrir pela diferença dos campos.
const EXPLICACAO_DA_ABA = Object.freeze({
 call: 'Conversa com hora marcada: sala do Meet e convidados.',
 task: 'Trabalho com início e prazo de entrega.',
 registro: 'Algo para guardar na base; a data é opcional.',
});
// Ícones ao lado do X: o mesmo formulário, em três tamanhos de janela (preferência deste navegador, agenda-prefs.js).
const ICONE_DA_JANELA = Object.freeze({ centro: 'window-center', popup: 'window-popup', lateral: 'window-side' });
const AJUDA_DA_JANELA = Object.freeze({ centro: 'Mostrar centralizado', popup: 'Mostrar como popup no canto', lateral: 'Mostrar na lateral' });
// Valor do <select> de Local que abre o campo livre: último caso, para não perder local antigo nem travar um novo.
const LOCAL_LIVRE = '__outro';

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
 // Prefixo único por diálogo: os ids das abas e do painel não podem colidir com nada que já esteja na página.
 const prefixo = 'ag-tipo-' + Math.random().toString(36).slice(2, 8);
 const form = el('form', null, 'tracking-form');
 form.id = prefixo + '-painel';
 form.setAttribute('role', 'tabpanel');   // a aba escolhida é o tipo, e o formulário inteiro é o painel dela

 const titulo = el('h2', evento ? 'Editar atividade' : 'Nova atividade');
 titulo.id = prefixo + '-titulo';
 dialog.setAttribute('aria-labelledby', titulo.id);
 const topo = el('header', null, 'tracking-editor-heading');
 const intro = el('div');
 const dica = el('p', null, 'detail');
 intro.append(titulo, dica);
 // Canto: como mostrar a janela (centralizada, popup, lateral) e fechar.
 const modos = el('div', null, 'ag-janelas'); modos.setAttribute('role', 'group'); modos.setAttribute('aria-label', 'Como mostrar esta janela');
 let janela = janelaDoEvento();
 const botoesDaJanela = new Map();
 const aplicarJanela = () => {
  for (const [chave] of JANELAS) dialog.classList.toggle('ag-janela-' + chave, chave === janela);
  for (const [chave, b] of botoesDaJanela) b.setAttribute('aria-pressed', String(chave === janela));
 };
 for (const [chave] of JANELAS) {
  const b = botao('', ICONE_DA_JANELA[chave], () => { janela = chave; definirJanelaDoEvento(chave); aplicarJanela(); }, 'quiet ag-icone');
  b.setAttribute('aria-label', AJUDA_DA_JANELA[chave]); b.title = AJUDA_DA_JANELA[chave];
  botoesDaJanela.set(chave, b); modos.append(b);
 }
 aplicarJanela();
 const canto = el('div', null, 'tracking-editor-tools');
 canto.append(modos, botao('Fechar', 'close', () => dialog.close()));
 topo.append(intro, canto);
 // Abas do tipo (Call · Task · Registro) entre o cabeçalho e o formulário: o cabeçalho não entra no painel que elas comandam.
 const abasHost = el('div', null, 'ag-abas');
 dialog.append(topo, abasHost, form);

 const nome = campo(form, 'Título'); nome.required = true; nome.minLength = 2; nome.maxLength = 160; nome.placeholder = 'Ex.: Revisão dos objetivos da mentoria';
 const cliente = campo(form, 'Cliente', 'text', [['', 'Selecione'], ...tenants.map(t => [t.id, t.name])]); cliente.required = true;
 // No lugar do campo Categoria, que saiu: a categoria vem da contratação do cliente, e aqui ela é dita, não escolhida.
 const linhaDaCategoria = el('p', null, 'detail ag-categoria-vem');
 form.append(linhaDaCategoria);
 const contratacao = campo(form, 'Contratação (opcional)', 'text', contratacoesDe(dados, '', GERAL));
 const contratacaoEscolhida = () => (dados.engagements || []).find(e => e.id === contratacao.value) || null;
 const mostrarCategoria = () => { linhaDaCategoria.textContent = M.textoDaCategoria(contratacaoEscolhida(), evento ? evento.category : null); };
 cliente.addEventListener('change', () => { preencher(contratacao, contratacoesDe(dados, cliente.value, GERAL), ''); mostrarCategoria(); });
 contratacao.addEventListener('change', mostrarCategoria);

 const quando = el('fieldset', null, 'tracking-field-grid');
 const comeco = campo(quando, 'Início · Brasília', 'datetime-local');
 const termino = campo(quando, 'Fim / prazo · Brasília', 'datetime-local');
 quando.prepend(el('legend', 'Quando acontece'));
 form.append(quando);
 // Mudou o início e o fim ficou antes dele: o fim vai para uma hora depois, como nos calendários.
 comeco.addEventListener('change', () => {
  const ini = M.doCampoLocal(comeco.value), fimAtual = M.doCampoLocal(termino.value);
  if (ini && (!fimAtual || Date.parse(fimAtual) <= Date.parse(ini))) termino.value = M.paraCampoLocal(Date.parse(ini) + duracaoPadraoMin() * 60000);
  termino.min = comeco.value;
 });

 // Descrição e local dependem da migração 047. Sem ela (dados.agenda_campos falso) os campos nem aparecem.
 // O "Link da reunião" saiu do formulário: a sala vem do Meet pela API do Google. O que já estava gravado continua
 // aparecendo na visualização (o painel ao lado) e não é tocado ao salvar — o campo é que não é mais oferecido.
 const comCampos = dados.agenda_campos === true;
 const extra = el('div', null, 'tracking-extra');   // display: contents: os campos entram na grade do formulário como se não houvesse o bloco
 const descricao = campo(extra, 'Descrição (opcional)', 'area'); descricao.maxLength = 2000; descricao.rows = 3;
 // Local é escolhido, não digitado: o padrão de Configurações → Agenda, os locais já usados e o da atividade aberta.
 const locais = M.locaisConhecidos(dados.activities || [], [localDoMeet(), evento?.location]);
 const local = campo(extra, 'Local (opcional)', 'text', [['', 'Sem local'], ...locais.map(l => [l, l]), [LOCAL_LIVRE, 'Outro local…']]);
 const localLivre = campo(extra, 'Qual local', 'text'); localLivre.maxLength = 200; localLivre.placeholder = 'Ex.: Escritório do cliente';
 const caixaDoLivre = localLivre.parentElement; caixaDoLivre.hidden = true;
 let localAutomatico = false;   // o Local foi preenchido pela sala do Meet, não pela pessoa: desmarcar a sala pode limpá-lo
 const sincronizarLocal = () => { caixaDoLivre.hidden = local.value !== LOCAL_LIVRE; };
 local.addEventListener('change', () => { localAutomatico = false; sincronizarLocal(); });
 const valorDoLocal = () => (local.value === LOCAL_LIVRE ? localLivre.value.trim() : local.value);
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
   // Sala escolhida: o Local passa a ser "Google Meet" (se estava sem local). O link não é mais perguntado — quem o gera é o Google.
   const principalDe = tenantId => comEmail.find(p => p.tenant_id === tenantId && p.is_primary) || comEmail.find(p => p.tenant_id === tenantId);
   const sincronizarSala = () => {
    const comSala = meet.value === 'meet';
    rotuloConvidados.hidden = !comSala; rotuloBusca.hidden = !comSala;
    if (comSala && convidarContatoPrincipal() && !convidados.value.trim()) { const p = principalDe(cliente.value); if (p) convidados.value = p.email; }
    if (comSala) { if (!local.value && localDoMeet() && locais.includes(localDoMeet())) { local.value = localDoMeet(); localAutomatico = true; sincronizarLocal(); } }
    else if (localAutomatico) { if (local.value === localDoMeet()) local.value = ''; localAutomatico = false; sincronizarLocal(); }
   };
   meet.addEventListener('change', sincronizarSala);
   cliente.addEventListener('change', () => { if (meet.value === 'meet') sincronizarSala(); });
   // Como no Calendly: quem quer sala em toda atividade nova liga isso em Configurações → Agenda e já abre com ela marcada.
   if (!evento && meetAutomatico()) { meet.value = 'meet'; sincronizarSala(); }
  }
  form.append(blocoMeet);
  if (comCampos) form.append(local.parentElement, caixaDoLivre);   // Local logo abaixo da sala
 }
 let sincronizarRepeticao = null;
 if (repeticao) {
  form.append(repeticao.no);
  const curto = () => { const i = M.doCampoLocal(comeco.value), f = M.doCampoLocal(termino.value); return !i || !f || Date.parse(f) - Date.parse(i) <= 86400000; };
  sincronizarRepeticao = () => { repeticao.inicioMudou(); repeticao.limitar(curto()); sincronizarAba(); };
  comeco.addEventListener('change', sincronizarRepeticao); termino.addEventListener('change', sincronizarRepeticao); repeticao.no.addEventListener('change', sincronizarRepeticao);
 }
 if (serie && !serie.ended_at) {
  const bloco = el('fieldset', null, 'ag-bloco');
  bloco.append(el('legend', 'Esta atividade se repete'));
  bloco.append(el('p', `${serie.descricao}.`, 'detail'));
  escopo = campo(bloco, 'Aplicar a', 'text', [['um', 'Só este evento'], ['proximos', 'Este e os próximos']]);
  escopo.addEventListener('change', () => { contratacao.disabled = escopo.value === 'proximos'; });
  form.insertBefore(bloco, form.firstChild);
 }

 // ---------- a aba é o tipo: ela decide quais campos aparecem ----------
 // 'registro' precisa da migração 054 no banco; sem ela a aba não é oferecida (como lembrete e repetição fazem com a 048).
 // Uma atividade que já esteja gravada como registro abre na aba dela de qualquer forma: nunca esconder o que existe.
 let aba = evento ? M.abaDoKind(evento.kind) : 'call';
 const comRegistro = dados.agenda_registro === true || aba === 'registro';
 function sincronizarAba() {
  const comHorario = M.abaExigeHorario(aba);
  comeco.required = termino.required = comHorario;
  rotular(comeco, comHorario ? 'Início · Brasília' : 'Início (opcional) · Brasília');
  rotular(termino, aba === 'task' ? 'Prazo de entrega · Brasília' : comHorario ? 'Fim · Brasília' : 'Fim (opcional) · Brasília');
  dica.textContent = EXPLICACAO_DA_ABA[aba];
  // Meet é coisa de Call (e uma série não cria sala: a repetição já esconde o bloco).
  if (blocoMeet) blocoMeet.hidden = !M.abaComMeet(aba) || Boolean(repeticao?.escolhida());
  // Registro é o que já aconteceu: não tem o que avisar antes nem o que repetir.
  if (lembrete) lembrete.no.hidden = aba === 'registro';
  if (repeticao) repeticao.no.hidden = aba === 'registro';
  form.setAttribute('aria-labelledby', `${prefixo}-tab-${aba}`);
 }
 const abasDoTipo = M.ABAS.filter(a => a !== 'registro' || comRegistro);
 mountTabs({
  host: abasHost, tabs: abasDoTipo.map(a => ({ key: a, label: M.ROTULO_DA_ABA[a] })), active: aba,
  label: 'Tipo da atividade', prefix: prefixo, panelId: form.id,
  onChange: chave => { aba = chave; sincronizarAba(); },
 });
 if (!comRegistro) abasHost.append(el('p', 'Registro fica disponível quando a atualização do banco (migração 054) for aplicada.', 'detail'));

 // Valores iniciais
 if (evento) {
  nome.value = evento.title; cliente.value = evento.tenant_id; cliente.disabled = true;
  preencher(contratacao, contratacoesDe(dados, evento.tenant_id, GERAL), evento.engagement_id || '');
  comeco.value = M.paraCampoLocal(evento.ini); termino.value = M.paraCampoLocal(evento.fim);
  descricao.value = evento.description || '';
  // O local gravado está na lista (locaisConhecidos o incluiu). Se ainda assim não casar, vai no campo livre: editar não perde dado.
  local.value = evento.location || '';
  if (local.value !== (evento.location || '')) { local.value = LOCAL_LIVRE; localLivre.value = evento.location; }
 } else {
  cliente.value = tenantPadrao;
  preencher(contratacao, contratacoesDe(dados, cliente.value, GERAL), '');
  const ini = inicio ?? proximaHora();
  comeco.value = M.paraCampoLocal(ini); termino.value = M.paraCampoLocal(fim ?? ini + duracaoPadraoMin() * 60000);
 }
 mostrarCategoria(); sincronizarLocal(); sincronizarAba(); sincronizarRepeticao?.();
 termino.min = comeco.value;
 if (meet?.value === 'meet') meet.dispatchEvent(new Event('change'));   // sala já marcada (Meet automático): completa com a empresa escolhida

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
  let ini = M.doCampoLocal(comeco.value), term = M.doCampoLocal(termino.value);
  // Registro sem data: o banco exige início e fim (ver M.horarioDoRegistro). Call e Task continuam exigindo os dois.
  if (!M.abaExigeHorario(aba) && !comeco.value && !termino.value) {
   const h = M.horarioDoRegistro(Date.now());
   ini = new Date(h.ini).toISOString(); term = new Date(h.fim).toISOString();
  }
  if (!ini || !term) { erro.textContent = M.abaExigeHorario(aba) ? 'Informe um início e um fim válidos.' : 'Informe início e fim, ou deixe os dois em branco.'; erro.focus(); return; }
  if (Date.parse(term) <= Date.parse(ini)) { erro.textContent = 'O fim precisa ser depois do início.'; erro.focus(); return; }
  const rotuloOriginal = salvar.textContent;
  salvar.disabled = true; salvar.textContent = 'Salvando…'; form.setAttribute('aria-busy', 'true');
  try {
   const extras = comCampos ? { description: descricao.value.trim(), location: valorDoLocal() } : {};
   const kind = M.kindDaAba(aba, evento?.kind);   // a aba É o tipo; editando, mantém 'entregavel'/'feature' como estavam
   let atividade;
   // Registro não se repete: o bloco está escondido na aba dele, e o que estiver escolhido ali não vale.
   const regra = repeticao && aba !== 'registro' ? repeticao.valor(Date.parse(ini), Date.parse(term)) : null;   // lança com a mensagem certa se a repetição está incompleta
   if (!evento && regra) {
    // Atividade que se repete é uma série: o servidor cria a regra e já gera as ocorrências.
    const corpo = { id: crypto.randomUUID(), tenant_id: cliente.value, engagement_id: contratacao.value || null, category: M.categoriaDaContratacao(contratacaoEscolhida()), kind, title: nome.value, ...regra };
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
    if (kind !== evento.kind) campos.kind = kind;   // a categoria não está mais no formulário: ela vem da contratação e não se troca aqui
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
    const corpo = { id: crypto.randomUUID(), tenant_id: cliente.value, engagement_id: contratacao.value || null, category: M.categoriaDaContratacao(contratacaoEscolhida()), kind, title: nome.value, starts_at: ini, ends_at: term };
    for (const [k, v] of Object.entries(extras)) if (v) corpo[k] = v;
    if (lembrete && aba !== 'registro') { const rem = lembrete.valor(); if (rem !== null) corpo.reminders = rem; }   // padrão = não manda: a atividade segue o padrão da agenda
    atividade = (await api('/api/tracking', 'POST', corpo)).activity;
   } else {
    const campos = {};
    if (nome.value.trim() !== evento.title) campos.title = nome.value;
    if (kind !== evento.kind) campos.kind = kind;   // a categoria saiu do formulário: fica a que foi gravada na criação
    if (Date.parse(ini) !== evento.ini || Date.parse(term) !== evento.fim) { campos.starts_at = ini; campos.ends_at = term; }
    for (const [k, v] of Object.entries(extras)) if (v !== (evento[k] || '')) campos[k] = v || null;   // vazio limpa o campo
    if (lembrete && aba !== 'registro' && JSON.stringify(lembrete.valor()) !== JSON.stringify(evento.reminders ?? null)) campos.reminders = lembrete.valor();
    atividade = evento;
    if (Object.keys(campos).length) atividade = (await api('/api/tracking/' + evento.id, 'PUT', { revision: evento.revision, ...campos })).activity;
    // A contratação tem rota própria e exige a revisão que acabou de subir.
    if ((contratacao.value || null) !== (evento.engagement_id || null))
     atividade = (await api(`/api/tracking/${evento.id}/engagement`, 'PUT', { engagement_id: contratacao.value || null, revision: atividade.revision })).activity;
   }
   // Sala do Meet: depois de a atividade estar gravada. Se o Google falhar, a atividade fica e a pessoa é avisada (sem criar duas vezes).
   let extra = null;
   if (M.abaComMeet(aba) && meet?.value === 'meet') {
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
   { rotulo: 'Tipo', valor: textoDoTipo(e.kind) },
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
  if (dados.agenda_vinculos && M.abaDoKind(e.kind) === 'task') {
   const links = (dados.links || []).filter(l => l.activity_id === e.id);
   const divLinks = el('div');
   for (const l of links) {
    const a = el('a', `${l.system} / ${l.external_id}`); a.href = l.url; a.target = '_blank'; a.rel = 'noopener';
    const p = el('p', null, 'detail'); p.append(a); divLinks.append(p);
   }
   if (!links.length) divLinks.append(el('span', 'Nenhum vínculo', 'detail'));
   // TODO: Botão "Adicionar vínculo..." que chama API.
   linhas.push({ rotulo: 'Vínculos', valor: divLinks });
  }
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
  // Sala do Meet só em Call: numa Task ou num Registro a videoconferência não tem o que fazer.
  if (dadosAtuais?.google_meet && M.abaComMeet(M.abaDoKind(e.kind)) && !e.google_event_id && e.status !== 'cancelled') { const m = botao('Adicionar videoconferência do Meet', 'plus', () => acao(m, erroNo, () => api(`/api/tracking/${e.id}/meet`, 'POST', {})), 'secondary'); nos.push(m); }
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
