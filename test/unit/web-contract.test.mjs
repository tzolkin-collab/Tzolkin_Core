import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync, readdirSync } from 'node:fs';

// Contratos entre os módulos do painel que só quebram no navegador: um método
// removido de um setupX continua sendo chamado em app.js, uma ação da barra aponta
// para um elemento que não é <dialog>. Nada disso aparece no servidor nem em teste
// de API — a tela abre e lança TypeError. Os fontes são lidos como texto: sem DOM.
const PUBLIC = new URL('../../apps/web/public/', import.meta.url);
const fonte = nome => readFileSync(new URL(nome, PUBLIC), 'utf8');

// Troca por espaço o conteúdo de comentários, strings, regex e o texto dos template
// literals, preservando posições e quebras de linha. Sobram só os parênteses e as
// chaves do código; as expressões ${...} continuam sendo código (a chave fica).
function mascarar(texto) {
 const saida = texto.split(''), n = texto.length, abertos = [];
 const apaga = (de, ate) => { for (let k = de; k < ate; k++) if (saida[k] !== '\n') saida[k] = ' '; };
 const PALAVRAS = new Set(['return', 'typeof', 'case', 'do', 'else', 'in', 'of', 'new', 'delete', 'void', 'throw', 'yield', 'await']);
 let i = 0, ultimo = '';
 // Texto de template a partir de `inicio`: termina no ` ou abre uma expressão ${.
 const template = inicio => {
  let k = inicio;
  while (k < n && texto[k] !== '`' && !(texto[k] === '$' && texto[k + 1] === '{')) k += texto[k] === '\\' ? 2 : 1;
  if (k >= n) throw new Error('template literal sem fim');
  if (texto[k] === '`') { apaga(inicio, k); i = k + 1; ultimo = 'x'; return; }
  apaga(inicio, k + 1); abertos.push(0); i = k + 2; ultimo = '{';
 };
 while (i < n) {
  const c = texto[i], d = texto[i + 1];
  if (/\s/.test(c)) { i++; continue; }
  if (c === '/' && d === '/') { const fim = texto.indexOf('\n', i); apaga(i, fim < 0 ? n : fim); i = fim < 0 ? n : fim; continue; }
  if (c === '/' && d === '*') { const fim = texto.indexOf('*/', i + 2) + 2; apaga(i, fim); i = fim; continue; }
  if (c === "'" || c === '"') {
   let k = i + 1; while (k < n && texto[k] !== c) k += texto[k] === '\\' ? 2 : 1;
   apaga(i + 1, k); i = k + 1; ultimo = 'x'; continue;
  }
  if (c === '`') { template(i + 1); continue; }
  if (c === '}' && abertos.length && abertos.at(-1) === 0) { abertos.pop(); template(i + 1); continue; }
  if (c === '/' && (ultimo === '' || PALAVRAS.has(ultimo) || '(,=:[!&|?{};+-*%<>~^'.includes(ultimo))) {
   let k = i + 1, classe = false;
   while (k < n && (texto[k] !== '/' || classe)) { if (texto[k] === '\\') k++; else if (texto[k] === '[') classe = true; else if (texto[k] === ']') classe = false; k++; }
   apaga(i + 1, k); i = k + 1; while (i < n && /[a-z]/.test(texto[i])) i++; ultimo = 'x'; continue;
  }
  if (/[\w$]/.test(c)) { let k = i; while (k < n && /[\w$]/.test(texto[k])) k++; const palavra = texto.slice(i, k); ultimo = PALAVRAS.has(palavra) ? palavra : 'x'; i = k; continue; }
  if (abertos.length && c === '{') abertos[abertos.length - 1]++;
  if (abertos.length && c === '}') abertos[abertos.length - 1]--;
  ultimo = ')]'.includes(c) ? 'x' : c; i++;
 }
 return saida.join('');
}

// Índice do fechamento que casa com o (, [ ou { em `abre`, sobre código mascarado.
function fechamento(codigo, abre) {
 let profundidade = 0;
 for (let k = abre; k < codigo.length; k++) {
  if ('([{'.includes(codigo[k])) profundidade++;
  else if (')]}'.includes(codigo[k]) && --profundidade === 0) return k;
 }
 throw new Error(`sem fechamento para a posição ${abre}`);
}

// Divide o miolo de um literal (objeto ou lista) nas vírgulas do nível de cima.
function entradas(texto, codigo, de, ate) {
 const partes = []; let profundidade = 0, inicio = de;
 for (let k = de; k < ate; k++) {
  if ('([{'.includes(codigo[k])) profundidade++;
  else if (')]}'.includes(codigo[k])) profundidade--;
  else if (codigo[k] === ',' && profundidade === 0) { partes.push(texto.slice(inicio, k)); inicio = k + 1; }
 }
 partes.push(texto.slice(inicio, ate));
 return partes.map(p => p.trim()).filter(Boolean);
}

// Chaves do objeto devolvido por `function nome(...)`. Todo `return` do corpo (fora
// de funções internas) precisa ser um literal de objeto verificável: o método só
// conta como existente se estiver em todos eles.
function chavesDevolvidas(texto, nome) {
 const codigo = mascarar(texto);
 const declaracao = new RegExp(`\\bfunction\\s+${nome}\\s*\\(`).exec(codigo);
 if (!declaracao) return null;
 const corpo = codigo.indexOf('{', fechamento(codigo, declaracao.index + declaracao[0].length - 1));
 const fim = fechamento(codigo, corpo);
 const conjuntos = [];
 for (let k = corpo + 1, profundidade = 0; k < fim; k++) {
  if ('([{'.includes(codigo[k])) { profundidade++; continue; }
  if (')]}'.includes(codigo[k])) { profundidade--; continue; }
  if (profundidade !== 0 || !codigo.startsWith('return', k) || /[\w$]/.test(codigo[k - 1]) || /[\w$]/.test(codigo[k + 6] ?? '')) continue;
  let abre = k + 6; while (/\s/.test(codigo[abre])) abre++;
  assert.equal(codigo[abre], '{', `${nome}: o retorno precisa ser um literal de objeto para o contrato ser verificável`);
  const chaves = new Set();
  for (const entrada of entradas(texto, codigo, abre + 1, fechamento(codigo, abre))) {
   const m = /^(?:(?:get|set|async)\s+(?=[\w$'"]))?\*?\s*(?:([\w$]+)|'([^']+)'|"([^"]+)")\s*(?:[:(]|$)/.exec(entrada);
   assert.ok(m, `${nome}: entrada não verificável no retorno: ${entrada.slice(0, 60)}`);
   chaves.add(m[1] || m[2] || m[3]);
  }
  conjuntos.push(chaves);
 }
 assert.ok(conjuntos.length, `${nome}: nenhum return de objeto no corpo`);
 return new Set([...conjuntos[0]].filter(chave => conjuntos.every(c => c.has(chave))));
}

// `const x = setupY(...)` → { x: setupY }, com o módulo de onde setupY foi importado.
function instancias(texto) {
 const importados = new Map();
 for (const [, nomes, caminho] of texto.matchAll(/import\s*\{([^}]*)\}\s*from\s*'(\.\/[^']+)'/g))
  for (const nome of nomes.split(',')) { const [original, local = original] = nome.trim().split(/\s+as\s+/); if (original) importados.set(local.trim(), { original: original.trim(), caminho }); }
 const codigo = mascarar(texto), achadas = new Map();
 for (const m of codigo.matchAll(/\bconst\s+([\w$]+)\s*=\s*(setup\w+)\s*\(/g))
  if (importados.has(m[2])) achadas.set(m[1], { ...importados.get(m[2]), posicao: m.index });
 return { codigo, achadas };
}

// Usos de `variavel.metodo` que de fato se referem à instância: descarta os que estão
// dentro de um bloco onde o nome foi redeclarado (const/let/var ou parâmetro), como
// `const commercial = panel(...)` numa função de app.js.
function usos(codigo, variavel, posicao) {
 const nome = variavel.replace(/\$/g, '\\$'), identificador = new RegExp(`(?<![\\w$.])${nome}(?![\\w$])`);
 const blocos = [], pilha = [];
 for (let k = 0; k < codigo.length; k++) { if (codigo[k] === '{') pilha.push(k); else if (codigo[k] === '}') blocos.push([pilha.pop(), k]); }
 const interno = p => blocos.filter(([a, b]) => a < p && p < b).reduce((melhor, bloco) => (!melhor || bloco[0] > melhor[0] ? bloco : melhor), null);
 // Parâmetros da função cujo corpo começa em `a` (function, método, catch ou arrow).
 const parametros = a => {
  let k = a - 1; while (k >= 0 && /\s/.test(codigo[k])) k--;
  const flecha = codigo[k] === '>' && codigo[k - 1] === '=';
  if (flecha) { k -= 2; while (k >= 0 && /\s/.test(codigo[k])) k--; }
  if (codigo[k] === ')') {
   let abre = k; for (let profundidade = 0; abre >= 0; abre--) { if (')]}'.includes(codigo[abre])) profundidade++; else if ('([{'.includes(codigo[abre]) && --profundidade === 0) break; }
   if (flecha) return codigo.slice(abre + 1, k);
   let j = abre - 1; while (j >= 0 && /\s/.test(codigo[j])) j--;
   const fim = j + 1; while (j >= 0 && /[\w$]/.test(codigo[j])) j--;
   const antes = codigo.slice(j + 1, fim);
   return antes && !['if', 'for', 'while', 'switch', 'with'].includes(antes) ? codigo.slice(abre + 1, k) : '';
  }
  if (flecha) { const fim = k + 1; while (k >= 0 && /[\w$]/.test(codigo[k])) k--; return codigo.slice(k + 1, fim); }
  return '';
 };
 const redeclaracoes = [...codigo.matchAll(new RegExp(`\\b(?:const|let|var)\\s*(?:[{\\[][^=;]*?)?(?<![\\w$.:])${nome}(?![\\w$])`, 'g'))]
  .filter(m => m.index !== posicao).map(m => interno(m.index)).filter(Boolean);
 const sombreado = p => blocos.some(([a, b]) => a < p && p < b && (redeclaracoes.some(([c]) => c === a) || identificador.test(parametros(a))));
 return [...codigo.matchAll(new RegExp(`(?<![\\w$.])${nome}\\s*\\??\\.\\s*([\\w$]+)`, 'g'))].filter(m => !sombreado(m.index)).map(m => m[1]);
}

test('todo x.metodo usado sobre a instância de um setupY existe no objeto que setupY devolve', () => {
 const arquivos = readdirSync(PUBLIC).filter(nome => nome.endsWith('.js'));
 const falhas = [];
 let verificados = 0;
 for (const arquivo of arquivos) {
  const { codigo, achadas } = instancias(fonte(arquivo));
  for (const [variavel, { original, caminho, posicao }] of achadas) {
   const chaves = chavesDevolvidas(fonte(caminho.slice(2)), original);
   assert.ok(chaves, `${arquivo}: ${original} não é declarada em ${caminho}`);
   for (const metodo of new Set(usos(codigo, variavel, posicao))) { verificados++; if (!chaves.has(metodo)) falhas.push(`${arquivo}: ${variavel}.${metodo}, mas ${original} (${caminho}) devolve { ${[...chaves].join(', ')} }`); }
  }
 }
 // Guarda do próprio teste: se o padrão parar de casar, ele passaria sem verificar nada.
 const app = instancias(fonte('app.js')).achadas;
 for (const variavel of ['delivery', 'resource', 'commercial', 'finance']) assert.ok(app.has(variavel), `app.js: instância ${variavel} não encontrada`);
 assert.ok(verificados >= 20, `poucos usos verificados (${verificados})`);
 assert.deepEqual(falhas, []);
});

test('toda ação da barra abre um <dialog> com <form> ou é tratada explicitamente pelo #new-record', () => {
 const texto = fonte('app.js'), codigo = mascarar(texto), html = fonte('index.html');
 const inicio = /\bconst\s+CONTEXTS\s*=\s*\{/.exec(codigo);
 assert.ok(inicio, 'CONTEXTS não encontrado em app.js');
 const bloco = texto.slice(inicio.index, fechamento(codigo, inicio.index + inicio[0].length - 1) + 1);
 const acoes = [...bloco.matchAll(/(?:'([\w-]+)'|([\w$]+))\s*:\s*\{[^{}]*?\baction\s*:\s*\[\s*'([^']*)'\s*,\s*'([^']*)'\s*\]/g)].map(m => ({ view: m[1] || m[2], rotulo: m[3], alvo: m[4] }));
 assert.equal(acoes.length, [...bloco.matchAll(/\baction\s*:/g)].length, 'alguma action de CONTEXTS fora do formato [rótulo, id]');
 assert.ok(acoes.length >= 5, `poucas actions encontradas (${acoes.length})`);

 // Corpo do handler e os `if (... === 'x') { ...; return; }` que desviam antes do openDialog.
 const handler = /\$\('new-record'\)\.onclick\s*=\s*(?:async\s*)?\([^)]*\)\s*=>\s*\{/.exec(texto);
 assert.ok(handler, 'handler de #new-record não encontrado');
 const de = handler.index + handler[0].length - 1, ate = fechamento(codigo, de);
 const tratados = new Set();
 for (const m of codigo.slice(de, ate).matchAll(/\bif\s*\(/g)) {
  const abre = de + m.index + m[0].length - 1, fecha = fechamento(codigo, abre);
  let corpo = fecha + 1; while (/\s/.test(codigo[corpo])) corpo++;
  if (codigo[corpo] !== '{') continue;
  const bloco = codigo.slice(corpo, fechamento(codigo, corpo) + 1);
  if (!/\breturn\b/.test(bloco)) continue;
  for (const [, a, b] of texto.slice(abre, fecha).matchAll(/===\s*'([\w-]+)'|'([\w-]+)'\s*===/g)) tratados.add(a || b);
 }

 const dialogoComForm = id => {
  const abre = new RegExp(`<dialog\\b[^>]*\\bid="${id}"[^>]*>`).exec(html);
  if (!abre) return false;
  const fim = html.indexOf('</dialog>', abre.index);
  return fim > 0 && /<form\b/.test(html.slice(abre.index, fim));
 };
 const falhas = acoes.filter(({ view, alvo }) => !dialogoComForm(alvo) && !tratados.has(alvo) && !tratados.has(view))
  .map(({ view, rotulo, alvo }) => `${view}: "${rotulo}" aponta para #${alvo}, que não é <dialog> com <form> nem tem desvio no #new-record`);
 // Os outros caminhos que chegam ao openDialog seguem o mesmo contrato.
 for (const [, id] of html.matchAll(/\bdata-open="([^"]+)"/g)) if (!dialogoComForm(id)) falhas.push(`index.html: data-open="${id}" não é <dialog> com <form>`);
 for (const [, id] of texto.matchAll(/\bopenDialog\(\s*'([^']+)'/g)) if (!dialogoComForm(id)) falhas.push(`app.js: openDialog('${id}') não é <dialog> com <form>`);
 assert.deepEqual(falhas, []);
});

test('o mascaramento mantém só a estrutura do código', () => {
 const exemplo = "const a = '{'; // {\nconst b = /[}]{2}/g, c = `x${ {k: '}'}.k }y{`; return { a, get b() { return 1; }, 'c': c, d(x) {} }";
 const codigo = mascarar(exemplo);
 assert.equal(codigo.length, exemplo.length);
 assert.equal([...codigo].filter(c => c === '{').length, [...codigo].filter(c => c === '}').length);
 assert.deepEqual([...chavesDevolvidas(`function setupX(){ ${exemplo} }`, 'setupX')].sort(), ['a', 'b', 'c', 'd']);
});
