// Requisitos de etapa (fase 6 do funil): o aviso do que falta quando um movimento é bloqueado e o gerenciador dos requisitos
// de cada funil. As regras moram na API (modules/commercial-gates.mjs); aqui só se monta a tela. Sem estilo inline (a CSP não deixa).
const el = (tag, text, cls) => { const e = document.createElement(tag); if (text != null) e.textContent = text; if (cls) e.className = cls; return e; };
const GATES = { ENTER: 'Para entrar na etapa', EXIT: 'Para sair da etapa' };
const TIPOS = { ACTION: 'Tarefa a concluir', FIELD: 'Campo a preencher' };

/** O que falta para o movimento acontecer. Tarefa já foi criada para o registro; campo se preenche em "Dados do espaço". */
export function blockersNotice(blockers) {
 const box = el('div', null, 'notice-inline blockers'); box.setAttribute('role', 'alert');
 box.append(el('p', blockers.length > 1 ? 'Ainda não dá para mover. Faltam estes requisitos da etapa:' : 'Ainda não dá para mover. Falta este requisito da etapa:'));
 const lista = el('ul');
 for (const b of blockers) lista.append(el('li', b.kind === 'FIELD'
  ? `${b.title} — preencha o campo "${b.field_key}" em Dados do espaço.`
  : `${b.title} — a tarefa foi criada; conclua em Tarefas.`));
 box.append(lista);
 return box;
}

/** Requisitos de cada funil: lista por etapa e por fronteira, liga/desliga e adicionar. */
export function requirementsManager({ api, pipelines, initialSpace }) {
 const box = el('details', null, 'requirements-manager');
 box.append(el('summary', 'Requisitos de etapa'));
 const corpo = el('div'); box.append(corpo);
 const ativos = pipelines.filter(p => p.is_active);
 let funilId = (ativos.find(p => p.space_id === initialSpace) || ativos[0])?.id;
 let donos = null;
 const erro = e => { corpo.querySelector('[data-erro]')?.remove(); const p = el('p', e.message, 'notice-inline'); p.setAttribute('role', 'alert'); p.dataset.erro = '1'; corpo.prepend(p); };
 const aviso = (form, e) => { form.querySelector('[role=alert]')?.remove(); const p = el('p', e.message, 'notice-inline'); p.setAttribute('role', 'alert'); form.append(p); };
 const lista = (form, rotulo, pares) => { const l = el('label', rotulo), s = el('select'); for (const [v, t] of pares) { const o = el('option', t); o.value = v; s.append(o); } if (s.options.length) s.selectedIndex = 0; l.append(s); form.append(l); return { s, l }; };
 async function desenhar() {
  corpo.replaceChildren(el('p', 'Carregando requisitos…'));
  if (!donos) donos = (await api('/api/commercial/owners')).owners;
  const funil = ativos.find(p => p.id === funilId);
  const [{ requirements }, { fields }] = await Promise.all([api('/api/commercial/stage-requirements?pipeline_id=' + funilId), api('/api/commercial/space-fields?space_id=' + encodeURIComponent(funil.space_id))]);
  corpo.replaceChildren();
  corpo.append(el('p', 'O que cada etapa exige para o lead ou a oportunidade entrar nela ou sair dela. Tarefa: nasce para o registro na primeira tentativa e precisa ser concluída. Campo: precisa estar preenchido em Dados do espaço. Qualificar, descartar e perder nunca ficam presos.', 'detail'));
  if (ativos.length > 1) {
   const l = el('label', 'Funil'), s = el('select');
   for (const p of ativos) { const o = el('option', ativos.filter(x => x.space_id === p.space_id).length > 1 || ativos.length > 1 ? `${p.space_name} · ${p.name}` : p.name); o.value = p.id; s.append(o); }
   s.value = funilId; s.onchange = () => { funilId = s.value; desenhar().catch(erro); }; l.append(s); corpo.append(l);
  }
  for (const etapa of funil.stages) {
   const doEtapa = requirements.filter(r => r.stage_id === etapa.id);
   const grupo = el('div', null, 'requirements-stage'); grupo.append(el('h4', etapa.name));
   if (!doEtapa.length) grupo.append(el('p', 'Sem requisitos.', 'empty-list'));
   for (const r of doEtapa) {
    const linha = el('div', null, 'field-row');
    const detalhe = r.kind === 'FIELD' ? `campo "${r.field_key}"` : [r.owner_id ? 'responsável ' + (donos.find(d => d.id === r.owner_id)?.name || '') : null, r.due_days != null ? `prazo ${r.due_days} dias` : null].filter(Boolean).join(', ');
    linha.append(el('span', `${GATES[r.gate]}: ${r.title} · ${TIPOS[r.kind]}${detalhe ? ' (' + detalhe + ')' : ''}${r.is_active ? '' : ' · desligado'}`));
    const b = el('button', r.is_active ? 'Desligar' : 'Ligar', 'secondary'); b.type = 'button';
    b.onclick = async () => { b.disabled = true; try { await api('/api/commercial/stage-requirements/' + r.id, 'PUT', { version: r.version, is_active: !r.is_active }); await desenhar(); } catch (e) { erro(e); b.disabled = false; } };
    linha.append(b); grupo.append(linha);
   }
   corpo.append(grupo);
  }
  const form = el('form', null, 'commercial-form');
  form.append(el('h4', 'Novo requisito'));
  const etapa = lista(form, 'Etapa', funil.stages.map(s => [s.id, s.name])).s;
  const gate = lista(form, 'Quando', Object.entries(GATES)).s;
  const tipo = lista(form, 'Exige', Object.entries(TIPOS)).s;
  const tl = el('label', 'Título'), titulo = el('input'); titulo.required = true; titulo.maxLength = 200; tl.append(titulo); form.append(tl);
  const campo = lista(form, 'Campo', []);
  const prazoL = el('label', 'Prazo da tarefa, em dias (opcional)'), prazo = el('input'); prazo.type = 'number'; prazo.min = '0'; prazo.max = '365'; prazoL.append(prazo); form.append(prazoL);
  const dono = lista(form, 'Responsável pela tarefa (opcional)', [['', 'Sem responsável'], ...donos.map(o => [o.id, o.name || o.email])]);
  // O campo vem do espaço: do lead nas etapas de lead, da oportunidade nas demais.
  const sincroniza = () => {
   const fase = funil.stages.find(s => s.id === etapa.value)?.kind === 'LEAD' ? 'lead' : 'opportunity';
   const doTipo = fields.filter(f => f.entity === fase && f.is_active);
   campo.s.replaceChildren(...doTipo.map(f => { const o = el('option', f.label); o.value = f.key; return o; }));
   const eCampo = tipo.value === 'FIELD';
   campo.l.hidden = !eCampo; prazoL.hidden = dono.l.hidden = eCampo;
   enviar.disabled = eCampo && !doTipo.length;
   semCampo.hidden = !(eCampo && !doTipo.length);
  };
  const semCampo = el('p', 'Este espaço ainda não tem campo ativo para este tipo de registro. Crie em "Campos do espaço".', 'detail');
  const enviar = el('button', 'Adicionar requisito', 'primary'); enviar.type = 'submit';
  form.append(semCampo, enviar);
  etapa.onchange = sincroniza; tipo.onchange = sincroniza; sincroniza();
  form.onsubmit = async e => {
   e.preventDefault(); enviar.disabled = true;
   try {
    const eCampo = tipo.value === 'FIELD';
    await api('/api/commercial/stage-requirements', 'POST', {
     pipeline_id: funilId, stage_id: etapa.value, gate: gate.value, kind: tipo.value, title: titulo.value,
     ...(eCampo ? { field_key: campo.s.value } : { ...(prazo.value !== '' ? { due_days: Number(prazo.value) } : {}), ...(dono.s.value ? { owner_id: dono.s.value } : {}) }),
    });
    await desenhar();
   } catch (err) { aviso(form, err); enviar.disabled = false; }
  };
  corpo.append(form);
 }
 box.addEventListener('toggle', () => { if (box.open && !corpo.childElementCount && funilId) desenhar().catch(erro); });
 return box;
}
