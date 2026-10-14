// A descrição da atividade desenhada na ficha, a partir do JSON de blocos que o Editor.js grava.
//
// PRINCÍPIO, e é um só: nada que o editor grava pode sumir nem aparecer cru aqui. Cada tipo de bloco
// tem uma entrada em `DESENHOS`; tipo sem entrada cai em `desenhoDesconhecido`, que mostra o texto
// de dentro do bloco e diz qual tipo ficou sem desenho — nunca JSON cru, nunca espaço vazio.
//
// POR QUE ESTE ARQUIVO EXISTE: isto era uma cadeia de `else if` dentro de agenda-evento.js, sem saída
// para o tipo desconhecido (o bloco simplesmente desaparecia) e sem ninguém capaz de comparar a lista
// com as ferramentas registradas no editor. `DESENHOS` é uma das três listas do contrato; as outras
// são `FERRAMENTAS_DE_BLOCO` (agenda-evento.js) e `BLOCOS` (apps/api/src/platform/markdown-editorjs.mjs).
// test/unit/descricao-blocos.test.mjs lê as três do fonte e quebra quando divergem.
import { el } from './agenda-dom.js';
import { markdownParaEditorJs } from './markdown-editorjs.js';

/** HTML inline do bloco -> nós de verdade. O texto do editor é HTML; a ficha transforma em DOM. */
const comoNos = html => new DOMParser().parseFromString(html || '', 'text/html').body.childNodes;

/**
 * Texto legível de dentro de um bloco de tipo desconhecido.
 *
 * Cópia pequena e de propósito do `textoDoBloco` de apps/api/src/platform/markdown-editorjs.mjs: o
 * navegador não carrega módulos da API (apps/web/assets.mjs só serve esta pasta), e o caminho honesto
 * do tipo desconhecido precisa existir nos dois lados. Número e booleano não são texto — são nível de
 * título, alinhamento de coluna e caixa marcada.
 */
const textoDoBloco = dados => {
 const pedacos = [];
 const anda = valor => {
  if (valor == null || typeof valor === 'number' || typeof valor === 'boolean') return;
  if (typeof valor === 'string') {
   const t = valor.replace(/<[^>]+>/g, ' ').replace(/\s+/g, ' ').trim();
   if (t) pedacos.push(t);
   return;
  }
  for (const v of Array.isArray(valor) ? valor : Object.values(valor)) anda(v);
 };
 anda(dados);
 return pedacos.join(' ');
};

const desenhoDesconhecido = (tipo, dados) => {
 const caixa = el('div', null, 'ag-desc-desconhecido');
 const texto = textoDoBloco(dados);
 if (texto) caixa.append(el('p', texto));
 const nota = el('small', `Bloco “${tipo}” ainda sem desenho nesta tela`);
 nota.style.color = 'var(--muted)';
 nota.style.fontSize = '12px';
 caixa.append(nota);
 return caixa;
};

const desenharLista = (itens, estilo) => {
 const lista = el(estilo === 'ordered' ? 'ol' : 'ul');
 lista.style.margin = '6px 0'; lista.style.paddingLeft = '20px';
 (itens || []).forEach(i => {
  const li = el('li');
  // Item é texto puro quando não tem filho (é o que o @editorjs/list grava) e { content, items }
  // quando tem — o aninhamento que chega do Markdown do bot.
  li.append(...comoNos(typeof i === 'string' ? i : i?.content ?? i?.text ?? ''));
  const filhos = typeof i === 'string' ? null : i?.items;
  if (filhos && filhos.length) li.append(desenharLista(filhos, estilo));
  lista.append(li);
 });
 return lista;
};

/**
 * Um desenho por tipo de bloco. `ctx` traz o `onToggle` (só a checklist grava de volta) e o `data`
 * inteiro, porque marcar uma caixa regrava a descrição toda.
 */
export const DESENHOS = {
 paragraph(dados) {
  const p = el('p');
  p.append(...comoNos(dados?.text));
  return p;
 },
 header(dados) {
  const h = el('h' + Math.min(Math.max(Number(dados?.level) || 3, 1), 6));
  h.append(...comoNos(dados?.text));
  h.style.margin = '12px 0 6px';
  return h;
 },
 list(dados) {
  return desenharLista(dados?.items, dados?.style);
 },
 checklist(dados, ctx) {
  const { onToggle = null, data = null } = ctx || {};
  const lista = el('ul', null, 'ag-desc-checklist');
  lista.style.listStyle = 'none'; lista.style.padding = '0'; lista.style.margin = '6px 0';
  (dados?.items || []).forEach(i => {
   const li = el('li');
   const lbl = el('label');
   lbl.style.display = 'flex'; lbl.style.alignItems = 'flex-start'; lbl.style.gap = '8px'; lbl.style.margin = '4px 0';
   if (onToggle) lbl.style.cursor = 'pointer';
   const chk = el('input'); chk.type = 'checkbox'; chk.checked = !!i.checked;
   chk.disabled = !onToggle;
   chk.style.marginTop = '3px';
   if (onToggle) chk.style.cursor = 'pointer';
   const sp = el('span');
   if (onToggle) {
    chk.addEventListener('change', async () => {
     i.checked = chk.checked;
     if (i.checked) { sp.style.textDecoration = 'line-through'; sp.style.color = 'var(--muted)'; }
     else { sp.style.textDecoration = 'none'; sp.style.color = ''; }
     await onToggle(JSON.stringify(data));
    });
   }
   if (i.checked) { sp.style.textDecoration = 'line-through'; sp.style.color = 'var(--muted)'; }
   sp.append(...comoNos(i.text));
   lbl.append(chk, sp);
   li.append(lbl);
   lista.append(li);
  });
  return lista;
 },
 quote(dados) {
  const q = el('blockquote');
  q.style.borderLeft = '3px solid var(--line-strong)'; q.style.padding = '4px 0 4px 14px'; q.style.margin = '10px 0'; q.style.color = 'var(--text)';
  q.append(...comoNos(dados?.text));
  if (dados?.caption) {
   const cap = el('cite', ' — ' + dados.caption);
   cap.style.display = 'block'; cap.style.fontSize = '13px'; cap.style.marginTop = '6px'; cap.style.color = 'var(--muted)'; cap.style.fontStyle = 'italic';
   q.append(cap);
  }
  return q;
 },
 code(dados) {
  const pre = el('pre');
  pre.style.background = 'var(--surface-hover)'; pre.style.border = '1px solid var(--line)'; pre.style.padding = '12px 16px'; pre.style.borderRadius = '6px'; pre.style.overflowX = 'auto';
  // textContent, nunca HTML: o conteúdo do bloco de código é texto literal, inclusive quando parece tag.
  const code = el('code', dados?.code || '');
  code.style.fontFamily = 'var(--font-mono, ui-monospace, SFMono-Regular, Menlo, Monaco, Consolas, monospace)'; code.style.fontSize = '13px'; code.style.color = 'var(--text-strong)';
  pre.append(code);
  return pre;
 },
 delimiter() {
  const hr = el('hr');
  hr.style.border = 'none'; hr.style.borderTop = '1px solid var(--line)'; hr.style.margin = '18px 0';
  return hr;
 },
 table(dados) {
  const tabela = el('table');
  tabela.style.borderCollapse = 'collapse'; tabela.style.width = '100%'; tabela.style.margin = '10px 0'; tabela.style.borderRadius = '6px'; tabela.style.overflow = 'hidden';
  (dados?.content || []).forEach((linha, iLinha) => {
   const tr = el('tr');
   (linha || []).forEach(celula => {
    const cabecalho = !!dados?.withHeadings && iLinha === 0;
    const td = el(cabecalho ? 'th' : 'td');
    td.style.border = '1px solid var(--line)'; td.style.padding = '8px 12px'; td.style.fontSize = '14px'; td.style.lineHeight = '1.5';
    if (cabecalho) { td.style.background = 'var(--surface-hover)'; td.style.fontWeight = '600'; td.style.color = 'var(--text-strong)'; }
    else td.style.color = 'var(--text)';
    td.append(...comoNos(celula));
    tr.append(td);
   });
   tabela.append(tr);
  });
  return tabela;
 },
 warning(dados) {
  const w = el('div', null, 'ag-desc-callout');
  w.style.background = 'var(--surface-hover)'; w.style.border = '1px solid var(--line)'; w.style.color = 'var(--text)'; w.style.borderRadius = '6px'; w.style.padding = '12px 16px'; w.style.margin = '10px 0'; w.style.display = 'grid'; w.style.gridTemplateColumns = 'auto 1fr'; w.style.gap = '4px 12px';
  const icone = el('span', '💡'); icone.style.gridRow = '1 / span 2'; icone.style.fontSize = '18px'; icone.style.lineHeight = '1.4';
  w.append(icone);
  if (dados?.title) {
   const t = el('strong', dados.title); t.style.gridColumn = '2'; t.style.fontWeight = '600'; t.style.color = 'var(--text-strong)'; t.style.fontSize = '14.5px';
   w.append(t);
  }
  const msg = el('div'); msg.style.gridColumn = '2'; msg.style.fontSize = '14px'; msg.style.lineHeight = '1.5';
  msg.append(...comoNos(dados?.message));
  w.append(msg);
  return w;
 },
};

/**
 * Achata lista dentro de lista antes de entregar os blocos ao editor.
 *
 * O @editorjs/list@1.9.0 é plano: grava `items` como texto puro e desenha cada item por innerHTML.
 * Um item { content, items } apareceria na tela do editor como o carimbo de objeto virado texto, e a
 * gravação seguinte apagaria o item. A ficha e o Markdown guardam o aninhamento (é o que o bot manda); o
 * editor recebe a versão plana, na mesma ordem. Trocar a ferramenta por @editorjs/nested-list — que
 * grava { content, items } — é o que tira este achatamento daqui.
 */
export function paraOEditor(dados) {
 if (!dados || !Array.isArray(dados.blocks)) return dados;
 const achatar = (itens, saida = []) => {
  for (const i of itens || []) {
   saida.push(typeof i === 'string' ? i : String(i?.content ?? i?.text ?? ''));
   if (typeof i !== 'string') achatar(i?.items, saida);
  }
  return saida;
 };
 return {
  ...dados,
  blocks: dados.blocks.map(b => (b?.type === 'list' ? { ...b, data: { ...b.data, items: achatar(b.data?.items) } } : b)),
 };
}

/** Markdown em texto puro -> `{ blocks }`, ou null quando não há o que converter (vazio, ou a conversão falhou). */
const comoMarkdown = texto => {
 try { const dados = JSON.parse(markdownParaEditorJs(texto) || 'null'); return Array.isArray(dados?.blocks) && dados.blocks.length ? dados : null; }
 catch { return null; }
};

/**
 * A descrição inteira. `raw` é a string gravada em service_activities.description: JSON de blocos, ou
 * texto puro do tempo anterior ao editor (que volta como texto, sem fingir que é bloco).
 */
export function renderDescricao(raw, onToggle = null) {
 if (!raw) return null;
 const container = el('div', null, 'ag-descricao');
 let data;
 try { data = JSON.parse(raw); } catch { data = null; }
 if (!data || !Array.isArray(data.blocks)) {
  // Texto puro (descrição de antes do editor, ou gravada como Markdown por quem não passou pela conversão): desenha como o
  // Markdown que ele é, em vez de mostrar "**", "- " e "> " crus. Só a ficha converte; o texto guardado e o editor ficam como estão.
  data = comoMarkdown(raw);
  if (!data) { container.textContent = raw; return container; }
 }
 for (const b of data.blocks) {
  const desenho = DESENHOS[b?.type];
  const tipo = String(b?.type ?? 'sem tipo');
  // Bloco com dado estranho cai no mesmo caminho honesto do tipo desconhecido. Antes a falha de um
  // bloco derrubava o `try` que envolvia o laço inteiro e a ficha mostrava o JSON cru da descrição.
  try { container.append(desenho ? desenho(b.data || {}, { onToggle, data }) : desenhoDesconhecido(tipo, b?.data || {})); }
  catch { container.append(desenhoDesconhecido(tipo, b?.data || {})); }
 }
 return container;
}
