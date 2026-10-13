// Ponte entre Markdown (bot MCP) e Editor.js JSON (formato gravado pela UI em service_activities.description).
//
// PRINCÍPIO, e é um só: nada que o editor grava pode sumir nem aparecer cru. Todo tipo de bloco que
// o editor oferece tem desenho na ficha e ida e volta aqui.
//
// POR QUE ISSO VIROU CONTRATO EXPLÍCITO: cada camada carregava a sua lista privada de tipos. O editor
// registrava nove ferramentas de bloco, a ficha desenhava nove, e esta ponte só sabia construir quatro
// — e o comentário que ocupava estas linhas ainda jurava que a ficha desenhava quatro. Na tela do dono
// isso aparecia como tabela virando parágrafo com `|` literal, citação virando "> " literal, bloco de
// código virando um parágrafo monoespaçado, divisória desaparecendo no caminho e bloco de tipo novo
// sumindo sem rastro. `BLOCOS` abaixo é uma das três listas; as outras duas são `FERRAMENTAS_DE_BLOCO`
// (apps/web/public/agenda-evento.js) e `DESENHOS` (apps/web/public/agenda-descricao.js).
// test/unit/descricao-blocos.test.mjs lê as três do fonte e quebra quando divergem.

const esc = s => s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
const unesc = s => s.replace(/&nbsp;/g, ' ').replace(/&lt;/g, '<').replace(/&gt;/g, '>').replace(/&quot;/g, '"').replace(/&#39;/g, "'").replace(/&amp;/g, '&');

/**
 * Marcas inline que a ponte leva e traz, com o par Markdown ↔ HTML de cada uma.
 *
 * Está aqui, e não no teste, porque é o contrato: toda ferramenta inline registrada no editor
 * (FERRAMENTAS_INLINE, em agenda-evento.js) precisa aparecer nesta tabela, e o guarda exige que
 * cada par volte igual nos dois sentidos. `marker` entrou por isto: o realce que o editor grava
 * como <mark> era apagado em silêncio na volta ao Markdown, e `==x==` do bot chegava literal.
 */
export const INLINE = Object.freeze({
 bold: { markdown: '**forte**', html: '<b>forte</b>' },
 italic: { markdown: '*ênfase*', html: '<i>ênfase</i>' },
 link: { markdown: '[texto](https://exemplo.com)', html: '<a href="https://exemplo.com">texto</a>' },
 code: { markdown: '`x = 1`', html: '<code class="inline-code">x = 1</code>' },
 marker: { markdown: '==destaque==', html: '<mark class="cdx-marker">destaque</mark>' },
});

/** Inline Markdown -> HTML mínimo (todo o resto é escapado: o texto vira DOM na tela). */
export function inlineParaHtml(texto) {
 let s = esc(String(texto));
 s = s.replace(/`([^`]+)`/g, '<code class="inline-code">$1</code>');
 s = s.replace(/\[([^\]]+)\]\((https?:\/\/[^\s)"'<>]+)\)/g, '<a href="$2">$1</a>');
 s = s.replace(/==([^=]+)==/g, '<mark class="cdx-marker">$1</mark>');
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
 s = s.replace(/<code[^>]*>(.*?)<\/code>/gi, '`$1`').replace(/<mark[^>]*>(.*?)<\/mark>/gi, '==$1==');
 return unesc(s.replace(/<[^>]+>/g, ''));
}

/**
 * Texto legível de dentro de um bloco de tipo que esta ponte não conhece.
 *
 * É o caminho honesto do tipo desconhecido: nem vazio (o bloco desapareceria do que o bot lê), nem
 * JSON cru. Só caça texto — número e booleano são nível de título, alinhamento de coluna e caixa
 * marcada, não conteúdo. A ficha tem o equivalente em agenda-descricao.js, porque o navegador não
 * carrega módulos da API.
 */
export function textoDoBloco(dados) {
 const pedacos = [];
 const anda = valor => {
  if (valor == null || typeof valor === 'number' || typeof valor === 'boolean') return;
  if (typeof valor === 'string') { const t = inlineParaMarkdown(valor).trim(); if (t) pedacos.push(t); return; }
  for (const v of Array.isArray(valor) ? valor : Object.values(valor)) anda(v);
 };
 anda(dados);
 return pedacos.join(' ');
}

const nivelDoTitulo = v => Math.min(Math.max(Number(v) || 2, 1), 6);
/** Prefixa cada linha com "> ". Linha vazia fica ">" sozinho, senão o bloco de citação se parte. */
const citar = linhas => linhas.map(l => (l ? '> ' + l : '>')).join('\n');

/** Cerca maior que qualquer sequência de acentos graves do próprio código, senão o bloco se parte no meio. */
const cercar = codigo => {
 const borda = '`'.repeat(Math.max(2, ...[...String(codigo).matchAll(/`+/g)].map(m => m[0].length)) + 1);
 return `${borda}\n${codigo}\n${borda}`;
};

// Item de lista sem filho é texto puro (é o que o @editorjs/list grava); item com filho é
// { content, items }, o formato que a ficha já desenhava e que a lista aninhada do bot exige.
const textoDoItem = i => inlineParaMarkdown(typeof i === 'string' ? i : i?.content ?? i?.text ?? '');
const filhosDoItem = i => (typeof i === 'string' ? [] : i?.items ?? []);
const linhasDaLista = (itens, estilo, nivel = 0) => (itens || []).flatMap((i, n) => [
 '  '.repeat(nivel) + (estilo === 'ordered' ? `${n + 1}.` : '-') + ' ' + textoDoItem(i),
 ...linhasDaLista(filhosDoItem(i), estilo, nivel + 1),
]);

const linhasDaTabela = dados => {
 const corpo = (dados.content || []).map(linha => (linha || []).map(c => inlineParaMarkdown(c).replace(/\|/g, '\\|')));
 if (!corpo.length) return '';
 const colunas = Math.max(...corpo.map(l => l.length));
 const linha = celulas => '| ' + Array.from({ length: colunas }, (_, i) => celulas[i] ?? '').join(' | ') + ' |';
 // GFM exige a linha de separação logo abaixo do cabeçalho. Tabela sem cabeçalho ganha um cabeçalho
 // de células vazias — que é exatamente como ela volta a ser uma tabela sem cabeçalho na leitura.
 const cabecalho = dados.withHeadings ? corpo.shift() : [];
 return [linha(cabecalho), linha(Array.from({ length: colunas }, () => '---')), ...corpo.map(linha)].join('\n');
};

/**
 * O contrato: um tipo de bloco por entrada, com a conversão para Markdown e um exemplo.
 *
 * O exemplo mora no código de propósito — é a documentação do formato e é o que o guarda usa para
 * exigir ida e volta sem perder o tipo. Exemplo no teste seria uma quarta lista para esquecer.
 */
export const BLOCOS = Object.freeze({
 paragraph: {
  exemplo: { text: 'Linha de texto com <b>forte</b>' },
  paraMarkdown: d => inlineParaMarkdown(d.text),
 },
 header: {
  exemplo: { text: 'Pauta', level: 2 },
  paraMarkdown: d => '#'.repeat(nivelDoTitulo(d.level)) + ' ' + inlineParaMarkdown(d.text),
 },
 list: {
  exemplo: { style: 'unordered', items: [{ content: 'pai', items: ['filho'] }, 'irmão'] },
  paraMarkdown: d => linhasDaLista(d.items, d.style).join('\n'),
 },
 checklist: {
  // O @editorjs/checklist é plano: uma caixa por linha, sem nível. Checklist aninhada no Markdown
  // do bot, portanto, achata aqui — de propósito, porque o editor não saberia gravá-la de volta.
  exemplo: { items: [{ text: 'Enviar proposta', checked: false }, { text: 'Assinar', checked: true }] },
  paraMarkdown: d => (d.items || []).map(i => `- [${i.checked ? 'x' : ' '}] ${inlineParaMarkdown(i.text)}`).join('\n'),
 },
 quote: {
  // A legenda volta como última linha da citação, atrás de "— ", que é como a ficha também a mostra.
  // Antes a legenda sumia na volta ao bot: o bloco virava uma citação sem autor.
  exemplo: { text: 'O prazo é inegociável', caption: 'Ata de 3/10' },
  paraMarkdown: d => citar([
   ...inlineParaMarkdown(d.text).split('\n'),
   ...(d.caption ? ['— ' + inlineParaMarkdown(d.caption)] : []),
  ]),
 },
 code: {
  exemplo: { code: 'const x = 1;\nif (x) y();' },
  paraMarkdown: d => cercar(String(d.code ?? '')),
 },
 delimiter: {
  exemplo: {},
  paraMarkdown: () => '---',
 },
 table: {
  exemplo: { withHeadings: true, content: [['Mês', 'Valor'], ['Maio', 'R$ 4.000']] },
  paraMarkdown: linhasDaTabela,
 },
 warning: {
  // Sintaxe de alerta do GitHub (`> [!AVISO]`): é a única forma de uma citação voltar do Markdown
  // como Destaque. O "> **Título** mensagem" de antes voltava como citação comum — tipo perdido.
  exemplo: { title: 'Cuidado', message: 'A migração 034 ainda depende do dono' },
  paraMarkdown: d => citar([
   `[!AVISO]${d.title ? ' ' + inlineParaMarkdown(d.title) : ''}`,
   ...(d.message ? inlineParaMarkdown(d.message).split('\n') : []),
  ]),
 },
});

/** Markdown -> string JSON do Editor.js. Texto vazio -> null. */
export function markdownParaEditorJs(md) {
 const linhas = String(md ?? '').replace(/\r\n?/g, '\n').split('\n');
 const blocos = [];
 let paragrafo = [];          // linhas de texto corrido, juntadas com <br>
 let lista = null;            // bloco de lista aberto
 let raiz = [], caminho = []; // árvore da lista: caminho[k] é o item aberto no nível k
 let codigo = null;           // { borda, linhas } dentro de uma cerca ```
 let tabela = null;           // linhas cruas de uma tabela |…|
 let citacao = null;          // linhas de dentro de um bloco > (citação ou aviso)

 const fecharParagrafo = () => {
  if (paragrafo.length) blocos.push({ type: 'paragraph', data: { text: paragrafo.map(inlineParaHtml).join('<br>') } });
  paragrafo = [];
 };
 // Item sem filho volta a ser texto puro: é o que o editor grava, e o que já está no banco.
 const simplificar = itens => itens.map(i => (i.items.length ? { content: i.content, items: simplificar(i.items) } : i.content));
 const fecharLista = () => {
  if (lista) { if (lista.type === 'list') lista.data.items = simplificar(raiz); blocos.push(lista); }
  lista = null; raiz = []; caminho = [];
 };
 const fecharCodigo = () => {
  if (codigo) blocos.push({ type: 'code', data: { code: codigo.linhas.join('\n') } });
  codigo = null;
 };
 const fecharTabela = () => {
  if (!tabela) return;
  const cruas = tabela; tabela = null;
  const celulas = l => l.replace(/^\s*\|/, '').replace(/\|\s*$/, '').split(/(?<!\\)\|/).map(c => c.replace(/\\\|/g, '|').trim());
  const grade = cruas.map(celulas);
  // Linha de separação (| --- | :-: |) marca a de cima como cabeçalho; cabeçalho todo vazio é a
  // tabela sem cabeçalho que `linhasDaTabela` escreveu, e volta sem cabeçalho.
  const separador = grade[1]?.every(c => /^:?-+:?$/.test(c)) ?? false;
  const comCabecalho = separador && grade[0].some(c => c !== '');
  const conteudo = separador ? [...(comCabecalho ? [grade[0]] : []), ...grade.slice(2)] : grade;
  if (conteudo.length) blocos.push({ type: 'table', data: { withHeadings: comCabecalho, content: conteudo.map(l => l.map(inlineParaHtml)) } });
 };
 const fecharCitacao = () => {
  if (!citacao) return;
  const ls = citacao; citacao = null;
  while (ls.length && !ls[ls.length - 1].trim()) ls.pop();
  const alerta = ls[0]?.match(/^\s*\[!([^\]]*)\]\s*(.*)$/);
  if (alerta) {
   blocos.push({ type: 'warning', data: { title: inlineParaHtml(alerta[2].trim()), message: ls.slice(1).map(inlineParaHtml).join('<br>') } });
   return;
  }
  const legenda = ls.length > 1 && /^\s*—\s+/.test(ls.at(-1)) ? ls.pop().replace(/^\s*—\s+/, '') : '';
  blocos.push({ type: 'quote', data: { text: ls.map(inlineParaHtml).join('<br>'), caption: legenda ? inlineParaHtml(legenda) : '' } });
 };
 const fecharTudo = () => { fecharParagrafo(); fecharLista(); fecharTabela(); fecharCitacao(); };

 const abrirLista = (tipo, estilo) => {
  if (lista && lista.type === tipo && (tipo === 'checklist' || lista.data.style === estilo)) return;
  fecharTudo();
  lista = tipo === 'checklist' ? { type: 'checklist', data: { items: [] } } : { type: 'list', data: { style: estilo, items: [] } };
  raiz = []; caminho = [];
 };
 // Dois espaços (ou um tab) por nível, e não se pula nível: item fundo sem pai sobe para o nível seguinte.
 const nivelDaIndentacao = espacos => Math.floor(espacos.replace(/\t/g, '  ').length / 2);
 const inserirItem = (nivel, html) => {
  const k = Math.min(nivel, caminho.length);
  const item = { content: html, items: [] };
  (k === 0 ? raiz : caminho[k - 1].items).push(item);
  caminho.length = k; caminho[k] = item;
 };

 for (const bruta of linhas) {
  const l = bruta.replace(/\s+$/, '');
  let m;
  // Dentro da cerca, só a cerca de fechamento (igual ou mais longa) tem significado; o resto é código.
  if (codigo) {
   if (new RegExp(`^\\s*${codigo.borda[0]}{${codigo.borda.length},}\\s*$`).test(l)) fecharCodigo();
   else codigo.linhas.push(bruta);
   continue;
  }
  if ((m = l.match(/^\s*(`{3,}|~{3,})\s*\S*\s*$/))) { fecharTudo(); codigo = { borda: m[1], linhas: [] }; continue; }
  if (/^\s*\|/.test(l)) { fecharParagrafo(); fecharLista(); fecharCitacao(); (tabela ??= []).push(l.trim()); continue; }
  if (tabela) fecharTabela();
  if ((m = l.match(/^\s*>\s?(.*)$/))) { fecharParagrafo(); fecharLista(); (citacao ??= []).push(m[1]); continue; }
  if (citacao) fecharCitacao();
  if (!l.trim()) { fecharTudo(); continue; }
  if ((m = l.match(/^(#{1,6})\s+(.*)$/))) { fecharTudo(); blocos.push({ type: 'header', data: { text: inlineParaHtml(m[2].trim()), level: m[1].length } }); continue; }
  // Antes das listas: "- - -" é divisória, não item de lista com texto "- -".
  if (/^\s*([-*_])(\s*\1){2,}\s*$/.test(l)) { fecharTudo(); blocos.push({ type: 'delimiter', data: {} }); continue; }
  if ((m = l.match(/^(\s*)[-*+]\s+\[([ xX])\]\s+(.*)$/))) { abrirLista('checklist'); lista.data.items.push({ text: inlineParaHtml(m[3]), checked: m[2] !== ' ' }); continue; }
  if ((m = l.match(/^(\s*)([-*+]|\d+[.)])\s+(.*)$/))) { abrirLista('list', /^\d/.test(m[2]) ? 'ordered' : 'unordered'); inserirItem(nivelDaIndentacao(m[1]), inlineParaHtml(m[3])); continue; }
  fecharLista(); paragrafo.push(l.trim());
 }
 fecharCodigo(); fecharTudo();
 if (!blocos.length) return null;
 return JSON.stringify({ time: Date.now(), blocks: blocos, version: '2.30.6' });
}

/** JSON do Editor.js -> Markdown. Texto que não é Editor.js (legado em .md/texto puro) volta como veio. */
export function editorJsParaMarkdown(raw) {
 if (typeof raw !== 'string' || !raw.trim().startsWith('{')) return raw;
 let data;
 try { data = JSON.parse(raw); } catch { return raw; }
 if (!data || !Array.isArray(data.blocks)) return raw;
 const out = [];
 for (const b of data.blocks) {
  const bloco = BLOCOS[b.type];
  const str = String((bloco ? bloco.paraMarkdown(b.data || {}) : textoDoBloco(b.data || {})) ?? '');
  if (str.trim()) out.push(str);
 }
 return out.join('\n\n');
}
