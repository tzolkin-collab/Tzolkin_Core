// Tarefas do lead e automações do espaço (fase 5). As regras moram na API (platform/automations.mjs e
// modules/commercial-automations.mjs); aqui só se monta a tela. Sem estilo inline (a CSP não deixa).
const el = (tag, text, cls) => { const e = document.createElement(tag); if (text != null) e.textContent = text; if (cls) e.className = cls; return e; };
const dia = v => (v ? new Date(v).toLocaleDateString('pt-BR', { timeZone: 'America/Sao_Paulo' }) : null);
const hora = v => new Date(v).toLocaleString('pt-BR');

function aviso(form, erro) {
 form.querySelector('[role=alert]')?.remove();
 const p = el('p', erro.message, 'notice-inline'); p.setAttribute('role', 'alert'); form.append(p);
}
function campo(form, rotulo, tipo = 'text') { const l = el('label', rotulo), i = el('input'); i.type = tipo; l.append(i); form.append(l); return i; }
function lista(form, rotulo, pares, valor = '') { const l = el('label', rotulo), s = el('select'); for (const [v, t] of pares) { const o = el('option', t); o.value = v; s.append(o); } s.value = valor; if (s.selectedIndex < 0 && s.options.length) s.selectedIndex = 0; l.append(s); form.append(l); return { s, l }; }

/** Tarefas do lead (e da oportunidade dele): concluir, reabrir e adicionar à mão. */
export function tasksPanel({ api, lead, detail, owners, onChange }) {
 const box = el('section', null, 'context-card tasks-panel');
 box.append(el('h3', 'Tarefas'));
 const tarefas = detail.tasks || [];
 if (!tarefas.length) box.append(el('p', 'Nenhuma tarefa ainda.', 'empty-list'));
 for (const t of tarefas) {
  const linha = el('div', null, 'task-row' + (t.done_at ? ' task-done' : ''));
  const partes = [t.tag, t.due_at ? 'prazo ' + dia(t.due_at) : null, t.owner_name ? 'responsável ' + t.owner_name : null, t.source === 'automacao' ? 'criada por automação' : null].filter(Boolean);
  const texto = el('span'); texto.append(el('strong', t.title), el('small', ' · ' + partes.join(' · ')));
  const b = el('button', t.done_at ? 'Reabrir' : 'Concluir', 'secondary'); b.type = 'button';
  b.onclick = async () => { b.disabled = true; try { await api('/api/commercial/tasks/' + t.id, 'PUT', { version: t.version, done: !t.done_at }); await onChange(); } catch (e) { aviso(linha, e); b.disabled = false; } };
  linha.append(texto, b); box.append(linha);
 }
 const form = el('form', null, 'commercial-form');
 const titulo = campo(form, 'Nova tarefa'); titulo.required = true; titulo.maxLength = 200;
 const prazo = campo(form, 'Prazo (opcional)', 'date');
 const dono = lista(form, 'Responsável', [['', 'Sem responsável'], ...(owners || []).map(o => [o.id, o.name || o.email])]).s;
 const enviar = el('button', 'Adicionar tarefa', 'primary'); enviar.type = 'submit'; form.append(enviar);
 form.onsubmit = async e => {
  e.preventDefault(); enviar.disabled = true;
  try {
   await api('/api/commercial/tasks', 'POST', { lead_id: lead.id, title: titulo.value, ...(prazo.value ? { due_at: prazo.value + 'T12:00:00Z' } : {}), ...(dono.value ? { owner_id: dono.value } : {}) });
   await onChange();
  } catch (erro) { aviso(form, erro); enviar.disabled = false; }
 };
 box.append(form);
 return box;
}

/** Automações do espaço: lista, liga/desliga, histórico de execuções e criação (uma ação por vez na tela). */
export function automationsManager({ api, spaces, pipelines, initialSpace }) {
 const box = el('details', null, 'automations-manager');
 box.append(el('summary', 'Automações'));
 const corpo = el('div'); box.append(corpo);
 let espaco = spaces.some(s => s.id === initialSpace) ? initialSpace : spaces[0]?.id;
 let donos = null;
 const erro = e => { corpo.querySelector('[data-erro]')?.remove(); const p = el('p', e.message, 'notice-inline'); p.setAttribute('role', 'alert'); p.dataset.erro = '1'; corpo.prepend(p); };
 async function desenhar() {
  corpo.replaceChildren(el('p', 'Carregando automações…'));
  if (!donos) donos = (await api('/api/commercial/owners')).owners;
  const { automations, catalog } = await api('/api/commercial/automations?space_id=' + encodeURIComponent(espaco));
  const funis = pipelines.filter(p => p.space_id === espaco && p.is_active);
  const nomeFunil = id => funis.find(f => f.id === id)?.name || 'funil arquivado';
  const nomeEtapa = id => funis.flatMap(f => f.stages).find(s => s.id === id)?.name || 'etapa';
  corpo.replaceChildren();
  corpo.append(el('p', 'Quando acontece algo no funil, o Core faz sozinho o que estiver aqui. A automação não substitui o manual e, se falhar, o lead ou a venda seguem normalmente: a falha fica no histórico. Por ora: criar tarefa e atribuir responsável.', 'detail'));
  if (spaces.length > 1) {
   const l = el('label', 'Espaço'), s = el('select');
   for (const x of spaces) { const o = el('option', x.name); o.value = x.id; s.append(o); }
   s.value = espaco; s.onchange = () => { espaco = s.value; desenhar().catch(erro); }; l.append(s); corpo.append(l);
  }
  if (!automations.length) corpo.append(el('p', 'Nenhuma automação neste espaço.', 'empty-list'));
  for (const a of automations) {
   const linha = el('div', null, 'automation-row');
   const filtro = [a.pipeline_id ? 'funil ' + nomeFunil(a.pipeline_id) : 'qualquer funil', a.stage_id ? 'etapa ' + nomeEtapa(a.stage_id) : null].filter(Boolean).join(', ');
   const faz = a.actions.map(x => x.action === 'tarefa.criar' ? `criar tarefa "${x.title}"${x.delay_days ? ` (prazo ${x.delay_days} dias)` : ''}` : `atribuir a ${donos.find(d => d.id === x.owner_id)?.name || 'responsável'}`).join('; ');
   const texto = el('div'); texto.append(el('strong', a.name + (a.is_enabled ? '' : ' (desativada)')), el('p', `Quando: ${catalog.events[a.trigger_event]} · ${filtro}`, 'detail'), el('p', `Faz: ${faz}`, 'detail'));
   if (a.last_run_at) texto.append(el('p', `Última execução: ${hora(a.last_run_at)} · ${a.last_result === 'OK' ? 'deu certo' : 'FALHOU'}`, 'detail'));
   const acoes = el('div', null, 'field-row');
   const alterna = el('button', a.is_enabled ? 'Desativar' : 'Ativar', 'secondary'); alterna.type = 'button';
   alterna.onclick = async () => { alterna.disabled = true; try { await api('/api/commercial/automations/' + a.id, 'PUT', { version: a.version, is_enabled: !a.is_enabled }); await desenhar(); } catch (e) { erro(e); alterna.disabled = false; } };
   const historico = el('div', null, 'automation-runs'); historico.hidden = true;
   const ver = el('button', 'Ver execuções', 'secondary'); ver.type = 'button';
   ver.onclick = async () => {
    if (!historico.hidden) { historico.hidden = true; return; }
    try {
     const { runs } = await api(`/api/commercial/automations/${a.id}/runs`);
     historico.replaceChildren(...(runs.length ? runs.map(r => el('p', `${hora(r.created_at)} · ${r.result === 'OK' ? 'OK' : 'FALHOU'} · ${r.note}`)) : [el('p', 'Ainda não rodou.', 'empty-list')]));
     historico.hidden = false;
    } catch (e) { erro(e); }
   };
   acoes.append(alterna, ver); linha.append(texto, acoes, historico); corpo.append(linha);
  }
  const form = el('form', null, 'commercial-form');
  form.append(el('h4', 'Nova automação'));
  const nome = campo(form, 'Nome'); nome.required = true; nome.maxLength = 120;
  const evento = lista(form, 'Quando', Object.entries(catalog.events)).s;
  const funil = lista(form, 'Só neste funil', [['', 'Qualquer funil'], ...funis.map(f => [f.id, f.name])]).s;
  const etapa = lista(form, 'Só nesta etapa', [['', 'Qualquer etapa']]);
  const sincroniza = () => {
   const f = funis.find(x => x.id === funil.value);
   etapa.s.replaceChildren(...[['', 'Qualquer etapa'], ...(f ? f.stages.map(s => [s.id, s.name]) : [])].map(([v, t]) => { const o = el('option', t); o.value = v; return o; }));
   etapa.l.hidden = !f;
  };
  funil.onchange = sincroniza; sincroniza();
  const acao = lista(form, 'Então', Object.entries(catalog.actions)).s;
  const titulo = campo(form, 'Título da tarefa'); titulo.maxLength = 200;
  const prazo = campo(form, 'Prazo da tarefa, em dias (0 = sem prazo)', 'number'); prazo.min = '0'; prazo.max = '365'; prazo.value = '0';
  const dono = lista(form, 'Responsável', donos.map(o => [o.id, o.name || o.email]));
  const mostra = () => { const tarefa = acao.value === 'tarefa.criar'; titulo.parentElement.hidden = prazo.parentElement.hidden = !tarefa; dono.l.hidden = tarefa; };
  acao.onchange = mostra; mostra();
  const enviar = el('button', 'Criar automação', 'primary'); enviar.type = 'submit'; form.append(enviar);
  form.onsubmit = async e => {
   e.preventDefault(); enviar.disabled = true;
   try {
    const acaoCorpo = acao.value === 'tarefa.criar' ? { action: 'tarefa.criar', title: titulo.value, delay_days: Number(prazo.value || 0) } : { action: 'responsavel.atribuir', owner_id: dono.s.value };
    await api('/api/commercial/automations', 'POST', { space_id: espaco, name: nome.value, trigger_event: evento.value, ...(funil.value ? { pipeline_id: funil.value } : {}), ...(etapa.s.value ? { stage_id: etapa.s.value } : {}), actions: [acaoCorpo] });
    await desenhar();
   } catch (err) { aviso(form, err); enviar.disabled = false; }
  };
  corpo.append(form);
 }
 box.addEventListener('toggle', () => { if (box.open && !corpo.childElementCount) desenhar().catch(erro); });
 return box;
}
