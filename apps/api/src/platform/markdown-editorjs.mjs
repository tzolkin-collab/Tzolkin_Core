// Ponte entre Markdown (bot MCP) e Editor.js JSON (formato gravado pela UI em service_activities.description).
// A tela só renderiza paragraph, header, list e checklist (ver renderDescricao em agenda-evento.js),
// então o Markdown é convertido apenas para esses blocos; o resto cai em parágrafo para não sumir da visualização.

const esc = s => s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
const unesc = s => s.replace(/&nbsp;/g, ' ').replace(/&lt;/g, '<').replace(/&gt;/g, '>').replace(/&quot;/g, '"').replace(/&#39;/g, "'").replace(/&amp;/g, '&');

/** Inline Markdown -> HTML mínimo (todo o resto é escapado: o texto vira DOM na tela). */
export function inlineParaHtml(texto) {
 let s = esc(String(texto));
 s = s.replace(/`([^`]+)`/g, '<code class="inline-code">$1</code>');
 s = s.replace(/\[([^\]]+)\]\((https?:\/\/[^\s)"'<>]+)\)/g, '<a href="$2">$1</a>');
 s = s.replace(/\*\*([^*]+)\*\*|__([^_]+)__/g, (_, a, b) => `<b>${a ?? b}</b>`);
 s = s.replace(/(^|[^*\w])\*([^*\s][^*]*)\*(?!\*)/g, '$1<i>$2</i>').replace(/(^|[^_\w])_([^_\s][^_]*)_(?![_\w])/g, '$1<i>$2</i>');
 return s;
}

/** Inline HTML do Editor.js -> Markdown. */
export function inlineParaMarkdown(html) {
 let s = String(html ?? '');
 s = s.replace(/<br\s*\/?>/gi, '\n');
 s = s.replace(/<a\s[^>]*href="([^"]*)"[^>]*>(.*?)<\/a>/gi, (_, h, t) => `[${t}](${unesc(h)})`);
 s = s.replace(/<(b|strong)>(.*?)<\/\1>/gi, '**$2**').replace(/<(i|em)>(.*?)<\/\1>/gi, '*$2*');
 s = s.replace(/<code[^>]*>(.*?)<\/code>/gi, '`$1`').replace(/<mark[^>]*>(.*?)<\/mark>/gi, '$1');
 return unesc(s.replace(/<[^>]+>/g, ''));
}

/** Markdown -> string JSON do Editor.js. Texto vazio -> null. */
export function markdownParaEditorJs(md) {
 const linhas = String(md ?? '').replace(/\r\n?/g, '\n').split('\n');
 const blocks = [];
 let paragrafo = [], lista = null;
 const fechaParagrafo = () => { if (paragrafo.length) blocks.push({ type: 'paragraph', data: { text: paragrafo.map(inlineParaHtml).join('<br>') } }); paragrafo = []; };
 const fechaLista = () => { if (lista) blocks.push(lista); lista = null; };
 const abre = (tipo, estilo) => {
  if (lista && lista.type === tipo && (tipo === 'checklist' || lista.data.style === estilo)) return;
  fechaParagrafo(); fechaLista();
  lista = tipo === 'checklist' ? { type: 'checklist', data: { items: [] } } : { type: 'list', data: { style: estilo, items: [] } };
 };
 let emCodigo = null;
 for (const bruta of linhas) {
  const l = bruta.replace(/\s+$/, '');
  if (/^```/.test(l.trim())) {
   if (emCodigo) { blocks.push({ type: 'paragraph', data: { text: `<code class="inline-code">${esc(emCodigo.join('\n')).replace(/\n/g, '<br>')}</code>` } }); emCodigo = null; }
   else { fechaParagrafo(); fechaLista(); emCodigo = []; }
   continue;
  }
  if (emCodigo) { emCodigo.push(bruta); continue; }
  let m;
  if (!l.trim()) { fechaParagrafo(); fechaLista(); continue; }
  if ((m = l.match(/^(#{1,6})\s+(.*)$/))) { fechaParagrafo(); fechaLista(); blocks.push({ type: 'header', data: { text: inlineParaHtml(m[2].trim()), level: Math.min(m[1].length, 4) } }); continue; }
  if ((m = l.match(/^\s*[-*+]\s+\[([ xX])\]\s+(.*)$/))) { abre('checklist'); lista.data.items.push({ text: inlineParaHtml(m[2]), checked: m[1] !== ' ' }); continue; }
  if ((m = l.match(/^\s*[-*+]\s+(.*)$/))) { abre('list', 'unordered'); lista.data.items.push(inlineParaHtml(m[1])); continue; }
  if ((m = l.match(/^\s*\d+[.)]\s+(.*)$/))) { abre('list', 'ordered'); lista.data.items.push(inlineParaHtml(m[1])); continue; }
  if (/^\s*([-*_])(\s*\1){2,}\s*$/.test(l)) { fechaParagrafo(); fechaLista(); continue; }
  if ((m = l.match(/^>\s?(.*)$/))) {
   fechaParagrafo(); fechaLista();
   blocks.push({ type: 'paragraph', data: { text: '&gt; ' + inlineParaHtml(m[1].trim()) } });
   continue;
  }
  fechaLista(); paragrafo.push(l.trim());
 }
 if (emCodigo) blocks.push({ type: 'paragraph', data: { text: `<code class="inline-code">${esc(emCodigo.join('\n')).replace(/\n/g, '<br>')}</code>` } });
 fechaParagrafo(); fechaLista();
 if (!blocks.length) return null;
 return JSON.stringify({ time: Date.now(), blocks, version: '2.30.6' });
}

/** JSON do Editor.js -> Markdown. Texto que não é Editor.js (legado em .md/texto puro) volta como veio. */
export function editorJsParaMarkdown(raw) {
 if (typeof raw !== 'string' || !raw.trim().startsWith('{')) return raw;
 let data;
 try { data = JSON.parse(raw); } catch { return raw; }
 if (!data || !Array.isArray(data.blocks)) return raw;
 const item = i => inlineParaMarkdown(typeof i === 'string' ? i : i?.content ?? i?.text ?? '');
 const out = [];
 for (const b of data.blocks) {
  const d = b.data || {};
  let str = '';
  switch (b.type) {
   case 'paragraph': str = inlineParaMarkdown(d.text); break;
   case 'header': str = '#'.repeat(Math.min(Math.max(Number(d.level) || 2, 1), 6)) + ' ' + inlineParaMarkdown(d.text); break;
   case 'list': str = (d.items || []).map((i, n) => `${d.style === 'ordered' ? n + 1 + '.' : '-'} ${item(i)}`).join('\n'); break;
   case 'checklist': str = (d.items || []).map(i => `- [${i.checked ? 'x' : ' '}] ${inlineParaMarkdown(i.text)}`).join('\n'); break;
   case 'quote': str = inlineParaMarkdown(d.text).split('\n').map(x => '> ' + x).join('\n'); break;
   case 'code': str = '```\n' + (d.code || '') + '\n```'; break;
   case 'delimiter': str = '---'; break;
   case 'warning': str = '> **' + inlineParaMarkdown(d.title) + '** ' + inlineParaMarkdown(d.message); break;
   case 'table': {
    const rows = (d.content || []).map(r => '| ' + r.map(inlineParaMarkdown).join(' | ') + ' |');
    if (rows.length) rows.splice(1, 0, '| ' + (d.content[0] || []).map(() => '---').join(' | ') + ' |');
    str = rows.join('\n'); break;
   }
   default: if (d.text) str = inlineParaMarkdown(d.text);
  }
  if (str) out.push(str);
 }
 return out.filter(Boolean).join('\n\n');
}
