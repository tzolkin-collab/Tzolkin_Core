// Campos próprios por espaço (fase 4): o painel "Dados do espaço" no detalhe do lead e o gerenciador de campos
// do espaço no Inbound. As regras de valor moram na API (platform/space-fields.mjs); aqui só se monta o formulário.
const el = (tag, text, cls) => { const e = document.createElement(tag); if (text != null) e.textContent = text; if (cls) e.className = cls; return e; };
const TIPOS = { TEXT: 'Texto', NUMBER: 'Número', DATE: 'Data', SELECT: 'Lista (uma opção)', MULTISELECT: 'Lista (várias opções)', BOOLEAN: 'Sim ou não', LINK: 'Link' };
const ENTIDADES = { lead: 'Lead', opportunity: 'Oportunidade', engagement: 'Contratação' };
const vazio = v => v == null || v === '' || (Array.isArray(v) && !v.length);

function aviso(form, erro) {
 form.querySelector('[role=alert]')?.remove();
 const p = el('p', erro.message, 'notice-inline'); p.setAttribute('role', 'alert'); form.append(p);
}

/** Um controle por tipo de campo. `ler()` devolve o valor pronto para a API (`null` = sem valor, apaga). */
function controle(campo, valor) {
 const wrap = el('label', campo.label + (campo.is_active ? '' : ' (desativado)'));
 const opcoes = campo.options || [];
 if (campo.type === 'MULTISELECT') {
  const box = el('fieldset', null, 'field-options'); box.append(el('legend', campo.label + (campo.is_active ? '' : ' (desativado)')));
  const marcados = new Set(Array.isArray(valor) ? valor : []);
  const checks = opcoes.map(o => { const l = el('label', o); const c = el('input'); c.type = 'checkbox'; c.value = o; c.checked = marcados.has(o); c.disabled = !campo.is_active; l.prepend(c); box.append(l); return c; });
  return { wrap: box, ler: () => { const v = checks.filter(c => c.checked).map(c => c.value); return v.length ? v : null; } };
 }
 let input;
 if (campo.type === 'SELECT' || campo.type === 'BOOLEAN') {
  input = el('select');
  const pares = campo.type === 'BOOLEAN' ? [['sim', 'Sim'], ['nao', 'Não']] : opcoes.map(o => [o, o]);
  for (const [v, t] of [['', 'Sem valor'], ...pares]) { const o = el('option', t); o.value = v; input.append(o); }
  input.value = campo.type === 'BOOLEAN' ? (valor === true ? 'sim' : valor === false ? 'nao' : '') : (valor ?? '');
  input.disabled = !campo.is_active; wrap.append(input);
  return { wrap, ler: () => (campo.type === 'BOOLEAN' ? (input.value === 'sim' ? true : input.value === 'nao' ? false : null) : input.value || null) };
 }
 input = el('input');
 input.type = { NUMBER: 'number', DATE: 'date', LINK: 'url' }[campo.type] || 'text';
 if (campo.type === 'NUMBER') input.step = 'any';
 input.value = valor ?? ''; input.disabled = !campo.is_active; wrap.append(input);
 return { wrap, ler: () => (input.value.trim() === '' ? null : campo.type === 'NUMBER' ? Number(input.value) : input.value.trim()) };
}

/**
 * Valores do lead e, quando existem, da oportunidade e da contratação, cada grupo com o seu botão de salvar.
 * Campo desativado com valor continua aparecendo (desabilitado) para o valor antigo não sumir da vista.
 * Devolve `null` quando nenhum grupo tem campo para mostrar.
 */
export function dataPanel({ api, lead, detail, onSaved }) {
 const opp = detail.opportunity;
 const grupos = [['lead', lead.id, lead.version, lead.custom_data]];
 if (opp) grupos.push(['opportunity', opp.id, opp.version, opp.custom_data]);
 if (opp?.engagement_id) grupos.push(['engagement', opp.engagement_id, opp.engagement_revision, opp.engagement_custom_data]);
 const box = el('section', null, 'context-card data-panel');
 let algum = false;
 for (const [entidade, id, versao, valores] of grupos) {
  const atuais = valores || {};
  const campos = (detail.fields || []).filter(f => f.entity === entidade && (f.is_active || !vazio(atuais[f.key])));
  if (!campos.length) continue;
  if (!algum) { box.append(el('h3', 'Dados do espaço')); algum = true; }
  const form = el('form', null, 'commercial-form');
  form.append(el('h4', ENTIDADES[entidade]));
  const lidos = campos.map(c => [c, controle(c, atuais[c.key])]);
  for (const [, c] of lidos) form.append(c.wrap);
  const salvar = el('button', `Salvar dados — ${ENTIDADES[entidade].toLowerCase()}`, 'primary'); salvar.type = 'submit'; form.append(salvar);
  form.onsubmit = async e => {
   e.preventDefault(); salvar.disabled = true;
   try {
    const custom_data = {};
    for (const [campo, c] of lidos) if (campo.is_active) custom_data[campo.key] = c.ler();
    await api(`/api/commercial/custom-data/${entidade}/${id}`, 'PUT', { version: versao, custom_data });
    await onSaved();
   } catch (erro) { aviso(form, erro); } finally { salvar.disabled = false; }
  };
  box.append(form);
 }
 return algum ? box : null;
}

/** Definir os campos de um espaço: listar por tipo de registro, ativar/desativar, tornar obrigatório e adicionar. */
export function fieldsManager({ api, spaces, initialSpace }) {
 const box = el('details', null, 'fields-manager');
 box.append(el('summary', 'Campos do espaço'));
 const corpo = el('div'); box.append(corpo);
 let space = spaces.some(s => s.id === initialSpace) ? initialSpace : spaces[0]?.id;
 async function desenhar() {
  corpo.replaceChildren(el('p', 'Carregando campos…'));
  const { fields } = await api('/api/commercial/space-fields?space_id=' + encodeURIComponent(space));
  corpo.replaceChildren();
  corpo.append(el('p', 'Os campos que este espaço guarda de cada lead, oportunidade e contratação. O site manda os valores em space_data; o campo desativado deixa de aceitar valor novo, mas o que já foi guardado continua.', 'detail'));
  if (spaces.length > 1) {
   const l = el('label', 'Espaço'), s = el('select');
   for (const x of spaces) { const o = el('option', x.name); o.value = x.id; s.append(o); }
   s.value = space; s.onchange = () => { space = s.value; desenhar().catch(erro); }; l.append(s); corpo.append(l);
  }
  for (const [entidade, nome] of Object.entries(ENTIDADES)) {
   const doTipo = fields.filter(f => f.entity === entidade);
   const grupo = el('div', null, 'fields-group'); grupo.append(el('h4', nome));
   if (!doTipo.length) grupo.append(el('p', 'Nenhum campo definido.', 'empty-list'));
   for (const f of doTipo) {
    const linha = el('div', null, 'field-row');
    linha.append(el('span', `${f.label} · ${TIPOS[f.type]}${f.options ? ' (' + f.options.join(', ') + ')' : ''}${f.required ? ' · obrigatório' : ''}${f.is_active ? '' : ' · desativado'}`));
    const acao = (rotulo, mudanca) => { const b = el('button', rotulo, 'secondary'); b.type = 'button'; b.onclick = async () => { b.disabled = true; try { await api('/api/commercial/space-fields/' + f.id, 'PUT', { version: f.version, ...mudanca }); await desenhar(); } catch (e) { erro(e); } finally { b.disabled = false; } }; linha.append(b); };
    acao(f.is_active ? 'Desativar' : 'Ativar', { is_active: !f.is_active });
    if (f.is_active) acao(f.required ? 'Tornar opcional' : 'Tornar obrigatório', { required: !f.required });
    grupo.append(linha);
   }
   corpo.append(grupo);
  }
  const form = el('form', null, 'commercial-form');
  form.append(el('h4', 'Adicionar campo'));
  const campo = (rotulo, tipo = 'text') => { const l = el('label', rotulo), i = el('input'); i.type = tipo; l.append(i); form.append(l); return i; };
  const lista = (rotulo, pares) => { const l = el('label', rotulo), s = el('select'); for (const [v, t] of pares) { const o = el('option', t); o.value = v; s.append(o); } l.append(s); form.append(l); return { s, l }; };
  const entidade = lista('Vale para', Object.entries(ENTIDADES)).s;
  const rotulo = campo('Rótulo'), chave = campo('Chave (minúsculas, números e _)');
  chave.pattern = '[a-z][a-z0-9_]{0,39}'; rotulo.required = chave.required = true;
  const tipo = lista('Tipo', Object.entries(TIPOS)).s;
  const op = campo('Opções, separadas por vírgula'); op.parentElement.hidden = true;
  const sync = () => { op.parentElement.hidden = !['SELECT', 'MULTISELECT'].includes(tipo.value); };
  tipo.onchange = sync;
  const obrig = el('label', 'Obrigatório no envio do formulário'), chk = el('input'); chk.type = 'checkbox'; obrig.prepend(chk); form.append(obrig);
  const enviar = el('button', 'Adicionar campo', 'primary'); enviar.type = 'submit'; form.append(enviar);
  form.onsubmit = async e => {
   e.preventDefault(); enviar.disabled = true;
   try {
    const options = ['SELECT', 'MULTISELECT'].includes(tipo.value) ? op.value.split(',').map(x => x.trim()).filter(Boolean) : undefined;
    await api('/api/commercial/space-fields', 'POST', { space_id: space, entity: entidade.value, key: chave.value, label: rotulo.value, type: tipo.value, ...(options ? { options } : {}), required: chk.checked });
    await desenhar();
   } catch (err) { aviso(form, err); } finally { enviar.disabled = false; }
  };
  corpo.append(form);
 }
 const erro = e => { corpo.querySelector('[data-erro]')?.remove(); const p = el('p', e.message, 'notice-inline'); p.setAttribute('role', 'alert'); p.dataset.erro = '1'; corpo.prepend(p); };
 box.addEventListener('toggle', () => { if (box.open && !corpo.childElementCount) desenhar().catch(erro); });
 return box;
}
