const fs = require('fs');
const PUBLIC = new URL('file:///d:/Códigos/Tzolkin/Projetos/Outros/Site - Tzolkin/tzolkin-core/apps/web/public/');
const fonte = nome => fs.readFileSync(new URL(nome, PUBLIC), 'utf8') + (nome === 'app.js' ? '\n' + fs.readFileSync(new URL('router.js', PUBLIC), 'utf8') : '');

function mascarar(texto) {
 const saida = texto.split(''), n = texto.length, abertos = [];
 const apaga = (de, ate) => { for (let k = de; k < ate; k++) if (saida[k] !== '\n') saida[k] = ' '; };
 const PALAVRAS = new Set(['return', 'typeof', 'case', 'do', 'else', 'in', 'of', 'new', 'delete', 'void', 'throw', 'yield', 'await']);
 let i = 0, ultimo = '';
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
  if (c === '/' && d === '/') { let fim = texto.indexOf('\n', i + 2); if (fim === -1) fim = n; apaga(i, fim); i = fim; continue; }
  if (c === '/' && d === '*') { const fim = texto.indexOf('*/', i + 2); if (fim === -1) throw new Error('comentario sem fim'); apaga(i, fim + 2); i = fim + 2; continue; }
  if (c === '\'' || c === '"') {
   let k = i + 1;
   while (k < n && texto[k] !== c) { if (texto[k] === '\\') k++; k++; }
   if (k >= n) throw new Error('string sem fim');
   apaga(i, k + 1); i = k + 1; ultimo = 'x'; continue;
  }
  if (c === '`') { template(i + 1); continue; }
  if (c === '/' && ultimo !== 'x' && ultimo !== '}') {
   let k = i + 1;
   while (k < n && texto[k] !== '/') { if (texto[k] === '\\') k++; k++; }
   if (k >= n) throw new Error('regex sem fim');
   apaga(i, k + 1); i = k + 1; ultimo = 'x'; continue;
  }
  if (c === '{') { abertos.push(1); }
  else if (c === '}') {
   const tipo = abertos.pop();
   if (tipo === 0) { template(i + 1); continue; }
  }
  let avanco = 1;
  if (/[a-z_]/i.test(c)) {
   let k = i + 1; while (k < n && /[a-z0-9_]/i.test(texto[k])) k++;
   const palavra = texto.slice(i, k);
   ultimo = PALAVRAS.has(palavra) ? palavra : 'x';
   avanco = k - i;
  } else { ultimo = c; }
  i += avanco;
 }
 return saida.join('');
}

const codigo = mascarar(fonte('app.js'));
console.log(/\bconst\s+CONTEXTS\s*=\s*\{/.test(codigo));
