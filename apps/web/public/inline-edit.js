// Edição no lugar: o valor é um botão ("Clique para editar"); clicar o troca por um campo, na própria linha.
//
// Por que não "botão Editar + diálogo": corrigir um e-mail digitado errado não pode custar abrir um
// formulário. O campo vazio mostra "Vazio" em cinza, então se vê o que falta e se clica para preencher.
//
// Comportamento (o mesmo em todo o painel):
//   Enter ou sair do campo  grava (em texto de uma linha); Ctrl+Enter grava em texto longo
//   Esc                     descarta, sem fechar a ficha (o Esc é do campo enquanto ele está aberto)
//   seletor                 grava ao escolher
//   erro do servidor        fica visível sob o campo, o campo segue aberto com o que foi digitado
//
// O componente não sabe de rota nem de negócio: `salvar(novo)` faz o pedido e diz se deu certo.

const el = (tag, texto, classe) => {
 const n = document.createElement(tag);
 if (texto !== undefined && texto !== null) n.textContent = texto;
 if (classe) n.className = classe;
 return n;
};

let contador = 0;

/**
 * @param {object} o
 * @param {string|null} o.valor            valor atual (texto), ou null/'' se vazio
 * @param {string} o.rotulo                nome do campo, para leitor de tela ("Editar E-mail")
 * @param {'texto'|'email'|'tel'|'longo'|'select'} [o.tipo]
 * @param {[string,string][]} [o.opcoes]   [valor, rótulo] quando tipo = 'select'
 * @param {string} [o.vazio]               texto quando não há valor (padrão: "Vazio")
 * @param {boolean} [o.obrigatorio]        recusa valor vazio
 * @param {(texto:string)=>string|null} [o.validar]   devolve a mensagem de erro, ou null
 * @param {(novo:string|null)=>Promise<string|null|void>} o.salvar   grava; pode devolver o valor normalizado
 * @param {(valor:string)=>Node|string} [o.exibir]    como mostrar o valor (link, formatado...)
 * @returns {HTMLElement}
 */
export function campoInline({ valor, rotulo, tipo = 'texto', opcoes = [], vazio = 'Vazio', obrigatorio = false, validar, salvar, exibir }) {
 const raiz = el('div', undefined, 'inline-field');
 const id = `inline-${++contador}`;
 let atual = valor == null || valor === '' ? null : String(valor);
 let editando = false;

 const rotuloDe = v => (tipo === 'select' ? (opcoes.find(([x]) => x === v)?.[1] ?? v) : v);

 function mostrar(avisoOk = false) {
  editando = false;
  const botao = el('button', undefined, 'inline-value');
  botao.type = 'button';
  botao.title = 'Clique para editar';
  botao.setAttribute('aria-label', `Editar ${rotulo}: ${atual == null ? 'vazio' : rotuloDe(atual)}`);
  if (atual == null) botao.append(el('span', vazio, 'inline-vazio'));
  else if (exibir) { const n = exibir(atual); botao.append(n instanceof Node ? n : document.createTextNode(String(n))); }
  else botao.append(document.createTextNode(rotuloDe(atual)));
  botao.onclick = evento => { if (evento.target.closest('a')) return; abrir(); };
  const filhos = [botao];
  if (avisoOk) { const ok = el('span', 'Salvo', 'inline-ok'); ok.setAttribute('role', 'status'); filhos.push(ok); setTimeout(() => ok.remove(), 1600); }
  raiz.replaceChildren(...filhos);
 }

 function abrir() {
  if (editando) return;
  editando = true;
  const erro = el('p', undefined, 'inline-erro');
  erro.id = `${id}-erro`;
  erro.hidden = true;
  erro.setAttribute('role', 'alert');

  let campo;
  if (tipo === 'select') {
   campo = el('select', undefined, 'inline-input');
   for (const [v, t] of opcoes) { const o = el('option', t); o.value = v; campo.append(o); }
   campo.value = atual ?? '';
  } else if (tipo === 'longo') {
   campo = el('textarea', undefined, 'inline-input');
   campo.rows = 4;
   campo.value = atual ?? '';
  } else {
   campo = el('input', undefined, 'inline-input');
   campo.type = tipo === 'email' ? 'email' : tipo === 'tel' ? 'tel' : 'text';
   campo.value = atual ?? '';
  }
  campo.setAttribute('aria-label', rotulo);
  campo.setAttribute('aria-describedby', erro.id);

  let ocupado = false;
  const dizer = mensagem => { erro.textContent = mensagem || ''; erro.hidden = !mensagem; campo.setAttribute('aria-invalid', String(Boolean(mensagem))); };

  async function gravar() {
   if (ocupado) return;
   const bruto = campo.value.trim();
   const novo = bruto === '' ? null : bruto;
   if (novo === atual) { mostrar(); return; }
   if (novo === null && obrigatorio) { dizer('Este campo não pode ficar vazio.'); campo.focus(); return; }
   const problema = novo !== null && validar ? validar(novo) : null;
   if (problema) { dizer(problema); campo.focus(); return; }
   ocupado = true; dizer('');
   campo.disabled = true;
   raiz.setAttribute('aria-busy', 'true');
   try {
    const devolvido = await salvar(novo);
    atual = devolvido === undefined ? novo : (devolvido === '' ? null : devolvido);
    raiz.removeAttribute('aria-busy');
    mostrar(true);
   } catch (falha) {
    ocupado = false;
    raiz.removeAttribute('aria-busy');
    campo.disabled = false;
    dizer(falha?.message || 'Não foi possível salvar.');
    campo.focus();
   }
  }

  campo.addEventListener('keydown', evento => {
   if (evento.key === 'Escape') { evento.preventDefault(); evento.stopPropagation(); if (!ocupado) mostrar(); return; }
   if (evento.key === 'Enter' && (tipo !== 'longo' || evento.ctrlKey || evento.metaKey)) { evento.preventDefault(); gravar(); }
  });
  // Sair do campo grava (como numa planilha). Seletor grava ao escolher.
  if (tipo === 'select') campo.addEventListener('change', gravar);
  campo.addEventListener('blur', () => { if (tipo !== 'select' && !ocupado) gravar(); });

  raiz.replaceChildren(campo, erro);
  campo.focus();
  if (campo.select && tipo !== 'select') campo.select();
 }

 mostrar();
 return raiz;
}

/**
 * Lista de pares rótulo e valor ("Cadastro"): <dl class="ficha-dl">. Cada linha: { rotulo, valor: Node|string }.
 * Linha sem valor nenhum (null) não aparece; para mostrar "Vazio", passe um campoInline sem valor.
 */
export function pares(linhas) {
 const dl = el('dl', undefined, 'ficha-dl');
 for (const { rotulo, valor } of linhas) {
  if (valor == null) continue;
  const dd = el('dd');
  if (valor instanceof Node) dd.append(valor); else dd.textContent = valor;
  dl.append(el('dt', rotulo), dd);
 }
 return dl;
}
