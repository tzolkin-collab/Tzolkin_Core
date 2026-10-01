// Guardas de UX e de acessibilidade, sem navegador e sem dependência.
//
// Camada 2 da estratégia de testes (docs/TESTING.md): lê o fonte da tela e recusa o que a
// revisão de UX de 2026-10-01 corrigiu à mão. Cada regra aqui nasceu de um defeito real,
// e o motivo está ao lado dela. Uma regra nova entra quando um defeito de tela se repete.
import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync, readdirSync } from 'node:fs';

const PUBLIC = new URL('../../apps/web/public/', import.meta.url);
const read = nome => readFileSync(new URL(nome, PUBLIC), 'utf8');
const html = read('index.html');
const scripts = readdirSync(PUBLIC).filter(nome => nome.endsWith('.js'));

// ---------------------------------------------------------------------------------------
// Texto que o operador lê
// ---------------------------------------------------------------------------------------

/** Literais de texto do JS, sem linhas inteiras de comentário. */
function literais(fonte) {
 const codigo = fonte.replace(/\/\*[\s\S]*?\*\//g, '').split('\n').filter(linha => !/^\s*\/\//.test(linha)).join('\n');
 return [...codigo.matchAll(/'((?:[^'\\\n]|\\.)*)'|"((?:[^"\\\n]|\\.)*)"|`((?:[^`\\]|\\.)*)`/g)].map(m => m[1] ?? m[2] ?? m[3]);
}
const textoDoHtml = html.replace(/<script[\s\S]*?<\/script>/g, '').replace(/<style[\s\S]*?<\/style>/g, '').replace(/<[^>]+>/g, ' ');

// Glossário do Core. Um conceito, uma palavra (docs/design/2026-10-01-avaliacao-ux-e-nova-navegacao.md §7).
const BANIDOS = [
 [/\bStakeholders?\b/, 'use "Pessoas": stakeholder é jargão em inglês'],
 [/Ainda não identificado/, 'use uma linha única "Ainda sem: …" (nove vazios seguidos ensinam a ignorar a tela)'],
 [/vínculo\(s\)/, 'use o plural certo ("1 contratação", "2 contratações")'],
 [/Abrir (cliente|organização)[^'"`]*→/, 'o cartão inteiro é o alvo do clique (cardLink), sem botão repetido'],
 [/READY observado/, 'diga "Publicado e conferido no provedor": READY é estado de engenharia'],
 [/Consumidor ainda não configurado/, 'diga qual entrega e o que fazer'],
 [/Nenhum lead encontrado para estes filtros/, 'vazio sem filtro é "Ainda não chegou nenhum."; com filtro, "Nada com estes filtros."'],
];

test('o texto da tela segue o glossário', () => {
 const achados = [];
 const fontes = [['index.html', textoDoHtml], ...scripts.map(nome => [nome, literais(read(nome))])];
 for (const [arquivo, textos] of fontes)
  for (const texto of textos)
   for (const [regra, motivo] of BANIDOS)
    if (regra.test(texto)) achados.push(`${arquivo}: "${texto.slice(0, 70)}" — ${motivo}`);
 assert.deepEqual(achados, []);
});

test('nenhum texto da tela vaza valor interno (undefined, NaN, [object Object])', () => {
 const achados = [];
 for (const nome of scripts)
  for (const texto of literais(read(nome)))
   if (/\b(undefined|NaN|null)\b(?!\s*[=!?:,)])/.test(texto) && /\s/.test(texto) && /[a-zà-ú]{3}/i.test(texto) && !/^[\w$.\s()=!<>&|?:'"\\,;+-]*$/.test(texto))
    achados.push(`${nome}: "${texto.slice(0, 70)}"`);
 assert.deepEqual(achados, []);
 assert.ok(!/\[object Object\]/.test(scripts.map(read).join('\n')));
});

test('mês formatado não é capitalizado palavra por palavra ("Outubro De 2026")', () => {
 for (const nome of readdirSync(PUBLIC).filter(n => n.endsWith('.css'))) {
  const css = read(nome);
  assert.ok(!/period-menu[^{}]*\{[^}]*text-transform:\s*capitalize/.test(css), `${nome}: capitalize quebra a preposição do mês`);
 }
});

// ---------------------------------------------------------------------------------------
// Acessibilidade estática do index.html
// ---------------------------------------------------------------------------------------

const atributos = tag => Object.fromEntries([...tag.matchAll(/([\w:-]+)(?:=("[^"]*"|'[^']*'|[^\s>]+))?/g)].map(m => [m[1].toLowerCase(), (m[2] ?? '').replace(/^["']|["']$/g, '')]));

function percorrer() {
 const eventos = [];
 let envoltoEmLabel = 0;
 for (const m of html.matchAll(/<(\/?)(label|button|input|select|textarea|img|section|dialog)\b([^>]*)>/gi)) {
  const [, fecha, nome, resto] = m, tag = nome.toLowerCase();
  if (tag === 'label') { envoltoEmLabel += fecha ? -1 : 1; if (!fecha) eventos.push({ tag, attrs: atributos(resto), pos: m.index }); continue; }
  if (fecha) continue;
  eventos.push({ tag, attrs: atributos(resto), pos: m.index, emLabel: envoltoEmLabel > 0 });
 }
 return eventos;
}

test('o documento declara o idioma e o título', () => {
 assert.match(html, /<html[^>]*\blang="pt-BR"/);
 assert.match(html, /<title>[^<]+<\/title>/);
});

test('todo id do index.html é único', () => {
 const ids = [...html.matchAll(/\sid="([^"]+)"/g)].map(m => m[1]);
 const repetidos = ids.filter((id, i) => ids.indexOf(id) !== i);
 assert.deepEqual([...new Set(repetidos)], []);
});

test('toda imagem declara alt (vazio, se for decorativa)', () => {
 const semAlt = percorrer().filter(e => e.tag === 'img' && !('alt' in e.attrs));
 assert.equal(semAlt.length, 0, `${semAlt.length} <img> sem alt`);
});

test('todo botão do index.html tem nome acessível', () => {
 const semNome = [];
 for (const m of html.matchAll(/<button\b([^>]*)>([\s\S]*?)<\/button>/gi)) {
  const attrs = atributos(m[1]);
  const conteudo = m[2].replace(/<[^>]+>/g, '').trim();
  if (!conteudo && !attrs['aria-label'] && !attrs.title && !attrs['aria-labelledby']) semNome.push(attrs.id || m[1].trim().slice(0, 40) || '(sem id)');
 }
 assert.deepEqual(semNome, []);
});

test('todo campo do index.html tem rótulo (label, aria-label ou aria-labelledby)', () => {
 const rotulados = new Set([...html.matchAll(/<label\b[^>]*\bfor="([^"]+)"/gi)].map(m => m[1]));
 const semRotulo = percorrer()
  .filter(e => ['input', 'select', 'textarea'].includes(e.tag) && !['hidden', 'submit', 'button'].includes(e.attrs.type))
  .filter(e => !('hidden' in e.attrs) && e.attrs['aria-hidden'] !== 'true')
  .filter(e => !e.emLabel && !e.attrs['aria-label'] && !e.attrs['aria-labelledby'] && !(e.attrs.id && rotulados.has(e.attrs.id)))
  .map(e => e.attrs.id || e.attrs.name || e.attrs.type || e.tag);
 assert.deepEqual(semRotulo, []);
});

test('link que abre outra aba usa rel="noopener"', () => {
 const ruins = [];
 for (const nome of ['index.html', ...scripts]) {
  const fonte = read(nome);
  for (const m of fonte.matchAll(/target\s*=\s*['"]?_blank['"]?[^>\n]*/g)) {
   const janela = fonte.slice(Math.max(0, m.index - 200), m.index + 300);
   if (!/noopener/.test(janela)) ruins.push(`${nome}: ${m[0].slice(0, 60)}`);
  }
 }
 assert.deepEqual(ruins, []);
});

// ---------------------------------------------------------------------------------------
// Segurança de tela
// ---------------------------------------------------------------------------------------

/** Atribuições a innerHTML/outerHTML (e afins) que não são marcação literal fixa. */
export function htmlDinamico(codigo) {
 const semComentario = codigo.split('\n').filter(l => !/^\s*\/\//.test(l)).join('\n');
 const literalFixo = valor => {
  const abre = valor.trimStart()[0];
  if (abre !== "'" && abre !== '"') return false;
  const corpo = valor.trimStart().slice(1), fecha = corpo.indexOf(abre);
  if (fecha < 0) return false;
  return !/^\s*\+/.test(corpo.slice(fecha + 1));
 };
 const achados = [];
 for (const m of semComentario.matchAll(/\.(?:innerHTML|outerHTML)\s*=\s*([^;\n]*)|insertAdjacentHTML\s*\(|document\.write\s*\(/g))
  if (!m[1] || !literalFixo(m[1])) achados.push(m[0].slice(0, 60));
 return achados;
}

test('a tela escreve texto com textContent: innerHTML só em marcação fixa e conhecida', () => {
 let fixos = 0;
 for (const nome of scripts) {
  const codigo = read(nome);
  assert.deepEqual(htmlDinamico(codigo), [], `${nome}: innerHTML com valor dinâmico`);
  fixos += (codigo.split('\n').filter(l => !/^\s*\/\//.test(l)).join('\n').match(/\.innerHTML\s*=/g) || []).length;
 }
 assert.ok(fixos <= 1, `novo uso de innerHTML (${fixos}): prefira textContent`);
});

// ---------------------------------------------------------------------------------------
// Controles: sem isto, uma regra que parasse de casar deixaria tudo verde afirmando nada.
// ---------------------------------------------------------------------------------------

test('as guardas leem o suficiente da tela', () => {
 assert.ok(scripts.length >= 20, `só ${scripts.length} scripts lidos`);
 assert.ok(scripts.flatMap(nome => literais(read(nome))).length > 1500, 'poucos literais extraídos do JS');
 assert.ok(textoDoHtml.length > 500, 'pouco texto extraído do index.html');
 const controles = percorrer().filter(e => ['input', 'select', 'textarea'].includes(e.tag));
 assert.ok(controles.length >= 25, `só ${controles.length} campos lidos`);
 assert.ok([...html.matchAll(/<button\b/gi)].length >= 20, 'poucos botões lidos');
});

test('cada regra do glossário reconhece o defeito que descreve', () => {
 const amostras = ['Stakeholders', 'Ainda não identificado.', '1 vínculo(s)', 'Abrir cliente →', 'Abrir organização →', 'Deploy READY observado no provedor', 'Consumidor ainda não configurado.', 'Nenhum lead encontrado para estes filtros.'];
 for (const [regra] of BANIDOS) assert.ok(amostras.some(texto => regra.test(texto)), `a regra ${regra} não casa com nenhuma amostra`);
 // e não pega o texto que já foi corrigido
 for (const bom of ['Pessoas', 'Ainda sem: Backend, Domínios.', '2 contratações', 'Publicado e conferido no provedor', 'Ainda não chegou nenhum.'])
  for (const [regra] of BANIDOS) assert.ok(!regra.test(bom), `a regra ${regra} reprova "${bom}", que está certo`);
});

test('o detector de innerHTML reprova interpolação e concatenação, e aceita marcação fixa', () => {
 assert.equal(htmlDinamico('el.innerHTML = `<b>${nome}</b>`;').length, 1);
 assert.equal(htmlDinamico("el.innerHTML = '<b>' + nome + '</b>';").length, 1);
 assert.equal(htmlDinamico('el.innerHTML = nome;').length, 1);
 assert.equal(htmlDinamico("el.insertAdjacentHTML('beforeend', x);").length, 1);
 assert.equal(htmlDinamico("el.innerHTML = '<b>fixo</b>';").length, 0);
 assert.equal(htmlDinamico("// el.innerHTML = nome;").length, 0);
});
