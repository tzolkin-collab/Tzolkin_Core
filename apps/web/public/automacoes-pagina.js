import { $, node } from './dom.js';
import { tabela, celulaNome, selo } from './data-table.js';
import { fieldsManager } from './space-fields.js';

// Configuração do funil que não é o desenho do funil, em dois painéis que o mesmo módulo sabe desenhar:
//   automacoes  as regras "quando acontecer X, fazer Y" do espaço, com histórico de execuções  → página Tecnologia → Automações;
//   campos      os campos que o espaço guarda de cada lead e oportunidade                       → aba Campos do Inbound.
// Etapas e tarefas de etapa moram em CRM → Fluxo (fluxo.js). Quem monta diz onde desenhar (`hostId`); tudo é do ESPAÇO escolhido no alto
// (fixo, quando já se está dentro de um espaço). As rotas já existiam; aqui só se monta a tela.

const hora = v => new Date(v).toLocaleString('pt-BR', { day: '2-digit', month: '2-digit', hour: '2-digit', minute: '2-digit' });
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

 // ---------- Campos ----------
 function abaCampos(corpo) {
  const gerente = fieldsManager({ api, spaces: espacos().filter(e => e.id === espaco), initialSpace: espaco });
  gerente.classList.add('au-embutido');
  corpo.replaceChildren(gerente);
  gerente.open = true;
 }

 return { load: (opcoes = {}) => { if (opcoes.painel && opcoes.painel !== aba) { aba = opcoes.painel; formAberto = false; selecionada = null; } espacoFixo = opcoes.espaco || ''; if (espacoFixo) espaco = espacoFixo; return carregar().catch(reportError); }, clear() { geracao++; espacoFixo = ''; funis = []; donos = null; espaco = ''; funilId = ''; aba = painelInicial; formAberto = false; selecionada = null; $(hostId)?.replaceChildren(); } };
}
