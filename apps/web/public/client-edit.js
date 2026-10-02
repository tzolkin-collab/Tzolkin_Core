// Editar a empresa pela ficha: nome, relacionamento, tipo e ciclo de vida (PUT /api/tenants). O identificador não muda.
// A organização interna não se reclassifica: a ficha dela só deixa mudar o nome.
const el = (tag, text, cls) => { const e = document.createElement(tag); if (text != null) e.textContent = text; if (cls) e.className = cls; return e; };

export const RELACIONAMENTOS = [['customer', 'Cliente'], ['prospect', 'Prospect'], ['partner', 'Parceiro']];
export const TIPOS = [['company', 'Empresa'], ['person', 'Pessoa física'], ['nonprofit', 'Organização sem fins lucrativos']];
export const SITUACOES = [['lead', 'Lead'], ['onboarding', 'Em implantação'], ['active', 'Ativo'], ['paused', 'Pausado'], ['completed', 'Concluído'], ['discontinued', 'Descontinuado'], ['unclassified', 'Não classificado']];

function seletor(rotulo, pares, valor, desabilitado) {
 const l = el('label', rotulo), s = el('select');
 for (const [v, t] of pares) { const o = el('option', t); o.value = v; s.append(o); }
 if (!pares.some(([v]) => v === valor)) { const o = el('option', valor); o.value = valor; s.append(o); }
 s.value = valor; s.disabled = Boolean(desabilitado); l.append(s);
 return { l, s };
}

/** Abre o diálogo de edição da empresa. `onSaved` roda depois de gravar, para a tela recarregar. */
export function editTenantDialog({ api, tenant, onSaved }) {
 const interna = tenant.relationship_kind === 'internal' || tenant.organization_type === 'internal';
 const dialog = el('dialog', null, 'tenant-edit-dialog'), form = el('form');
 const cab = el('div', null, 'dialog-heading'), fechar = el('button', '×', 'close'); fechar.type = 'button'; fechar.setAttribute('aria-label', 'Fechar');
 cab.append(el('h2', 'Editar empresa'), fechar);
 const nomeL = el('label', 'Nome'), nome = el('input'); nome.required = true; nome.maxLength = 160; nome.minLength = 2; nome.value = tenant.name; nomeL.append(nomeL.firstChild, nome);
 const rel = seletor('Relacionamento', interna ? [['internal', 'Organização interna']] : RELACIONAMENTOS, tenant.relationship_kind, interna);
 const tipo = seletor('Tipo de organização', interna ? [['internal', 'Interna']] : TIPOS, tenant.organization_type, interna);
 const sit = seletor('Situação', SITUACOES, tenant.lifecycle_status, interna);
 const ajuda = el('small', interna ? 'A organização interna da Tzolkin não se reclassifica; só o nome muda.' : 'O identificador (' + tenant.slug + ') não muda: ele está em links e integrações. Mudar o relacionamento fica registrado na trilha, com o antes e o depois.');
 const erro = el('p', null, 'dialog-error'); erro.setAttribute('role', 'alert');
 const salvar = el('button', 'Salvar', 'primary'); salvar.type = 'submit';
 form.append(cab, nomeL, rel.l, tipo.l, sit.l, ajuda, erro, salvar);
 dialog.append(form);
 fechar.onclick = () => dialog.close();
 dialog.onclose = () => dialog.remove();
 form.onsubmit = async e => {
  e.preventDefault(); erro.textContent = ''; salvar.disabled = true;
  try {
   // Só vai o que mudou: o servidor registra exatamente isso na trilha.
   const corpo = { tenant_id: tenant.id };
   if (nome.value.trim() !== tenant.name) corpo.name = nome.value.trim();
   if (!interna) {
    if (rel.s.value !== tenant.relationship_kind) corpo.relationship_kind = rel.s.value;
    if (tipo.s.value !== tenant.organization_type) corpo.organization_type = tipo.s.value;
    if (sit.s.value !== tenant.lifecycle_status) corpo.lifecycle_status = sit.s.value;
   }
   if (Object.keys(corpo).length > 1) await api('/api/tenants', 'PUT', corpo);
   dialog.close();
   await onSaved();
  } catch (err) { erro.textContent = err.message; salvar.disabled = false; }
 };
 document.body.append(dialog);
 dialog.showModal();
 nome.focus();
 return dialog;
}
