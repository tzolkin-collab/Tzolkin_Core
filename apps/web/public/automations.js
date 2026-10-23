// Tarefas do lead (fase 5). As regras moram na API (platform/automations.mjs e modules/commercial-automations.mjs); as
// automações do espaço têm página própria (automacoes-pagina.js). Sem estilo inline (a CSP não deixa).
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
  const partes = [t.tag, t.due_at ? 'prazo ' + dia(t.due_at) : null, t.owner_name ? 'responsável ' + t.owner_name : null, t.source === 'automacao' ? 'criada por automação' : t.source === 'requisito' ? 'exigida pela etapa' : null].filter(Boolean);
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
