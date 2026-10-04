// Tema escuro: a paleta cumpre contraste, nenhum token de cor ficou sem versão escura, o script do <head>
// escolhe o tema certo (sistema por padrão) e os CSS já migrados não voltam a ter cor fixa.
import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import vm from 'node:vm';

const lerPublico = nome => readFileSync(new URL(`../../apps/web/public/${nome}`, import.meta.url), 'utf8').replace(/\r\n/g, '\n');
const style = lerPublico('style.css');
const tema = lerPublico('theme.css');
const selos = lerPublico('badge.css');

// ---- paleta -----------------------------------------------------------------------------------------------
const bloco = (css, abertura) => {
 const i = css.indexOf(abertura);
 assert.ok(i >= 0, `bloco ${abertura} não encontrado`);
 return css.slice(i, css.indexOf('\n}', i));
};
const variaveis = texto => Object.fromEntries([...texto.matchAll(/--([\w-]+):\s*([^;]+);/g)].map(m => [m[1], m[2].trim()]));
const claro = variaveis(bloco(style, ':root {'));
const escuro = variaveis(bloco(tema, ':root[data-theme="dark"]'));
const selosClaro = variaveis(bloco(selos, ':root {'));
const selosEscuro = variaveis(bloco(selos, ':root[data-theme="dark"]'));

const luz = hex => {
 const [r, g, b] = [1, 3, 5].map(i => parseInt(hex.slice(i, i + 2), 16) / 255).map(v => (v <= 0.03928 ? v / 12.92 : ((v + 0.055) / 1.055) ** 2.4));
 return 0.2126 * r + 0.7152 * g + 0.0722 * b;
};
const contraste = (a, b) => { const [x, y] = [luz(a), luz(b)].sort((p, q) => q - p); return (x + 0.05) / (y + 0.05); };
const hex = (paleta, nome) => {
 const v = paleta[nome];
 assert.match(v ?? '', /^#[0-9a-fA-F]{6}$/, `--${nome} precisa ser #rrggbb para o teste medir (veio "${v}")`);
 return v;
};

test('escuro: texto, texto apagado e cores de estado >= 4,5:1 sobre todos os fundos', () => {
 const fundos = ['bg', 'surface', 'surface-subtle', 'surface-muted', 'surface-hover', 'nav-active'];
 const textos = ['text', 'text-strong', 'muted', 'faint', 'success', 'warning', 'danger', 'brand-ink'];
 for (const f of fundos) for (const t of textos) {
  const c = contraste(hex(escuro, t), hex(escuro, f));
  assert.ok(c >= 4.5, `escuro: --${t} sobre --${f} = ${c.toFixed(2)}:1 (mínimo 4,5)`);
 }
});

test('escuro: botão primário (texto sobre --brand) e foco legíveis', () => {
 assert.ok(contraste(hex(escuro, 'on-brand'), hex(escuro, 'brand')) >= 7, 'texto do botão primário');
 assert.ok(contraste(hex(escuro, 'brand'), hex(escuro, 'bg')) >= 7, 'botão primário destaca do fundo');
 assert.ok(contraste(hex(escuro, 'focus-ring'), hex(escuro, 'bg')) >= 3, 'anel de foco >= 3:1 (WCAG 1.4.11)');
 assert.ok(contraste(hex(escuro, 'line'), hex(escuro, 'bg')) >= 1.2, 'a divisória precisa ser visível');
});

test('escuro: selos (texto >= 4,5:1, pontinho >= 3:1 sobre o fundo do selo) em todos os tons', () => {
 for (const tom of ['neutral', 'success', 'warning', 'danger', 'info', 'accent']) {
  const texto = contraste(hex(selosEscuro, `badge-${tom}-fg`), hex(selosEscuro, `badge-${tom}-bg`));
  assert.ok(texto >= 4.5, `escuro / ${tom}: texto ${texto.toFixed(2)}:1`);
  if (tom !== 'neutral') {
   const ponto = contraste(hex(selosEscuro, `badge-${tom}-dot`), hex(selosEscuro, `badge-${tom}-bg`));
   assert.ok(ponto >= 3, `escuro / ${tom}: pontinho ${ponto.toFixed(2)}:1`);
  }
  // o selo precisa se separar do fundo da tela, senão vira texto solto
  assert.ok(contraste(hex(selosEscuro, `badge-${tom}-bg`), hex(escuro, 'bg')) >= 1.1, `escuro / ${tom}: fundo do selo some no fundo da tela`);
 }
 assert.deepEqual(Object.keys(selosEscuro).sort(), Object.keys(selosClaro).filter(k => k.startsWith('badge-')).sort(), 'todo token de selo do claro tem o do escuro');
});

test('todo token de COR do claro foi redefinido no escuro (esquecer um deixa uma mancha clara)', () => {
 const naoCor = /^(radius|sidebar-width|header-height|page-gutter|page-max-width|font|fs-|shadow-)/;
 const aliases = new Set(['ink']); // --ink: var(--text) acompanha sozinho
 const faltam = Object.keys(claro).filter(k => !naoCor.test(k) && !aliases.has(k) && !(k in escuro));
 assert.deepEqual(faltam, [], `tokens sem versão escura: ${faltam.join(', ')}`);
 for (const sombra of ['shadow-pop', 'shadow-side']) assert.ok(sombra in escuro, `${sombra} precisa de versão escura (sombra clara some no escuro)`);
});

// ---- script do <head> -------------------------------------------------------------------------------------
function rodarBoot({ guardado, sistemaEscuro }) {
 const atributos = {}; const meta = { content: '', setAttribute(k, v) { this.content = v; } };
 const ouvintes = [];
 const depósito = new Map(guardado ? [['tzolkin-tema', guardado]] : []);
 const sandbox = {
  document: { documentElement: { setAttribute: (k, v) => { atributos[k] = v; } }, querySelector: () => meta },
  localStorage: { getItem: k => depósito.get(k) ?? null, setItem: (k, v) => depósito.set(k, v), removeItem: k => depósito.delete(k) },
 };
 sandbox.window = sandbox;
 sandbox.matchMedia = () => ({ matches: sistemaEscuro, addEventListener: (_, f) => ouvintes.push(f) });
 vm.runInNewContext(readFileSync(new URL('../../apps/web/public/theme-boot.js', import.meta.url), 'utf8'), sandbox);
 return { atributos, meta, depósito, ouvintes, api: sandbox.TzolkinTema, mudarSistema(v) { sandbox.matchMedia = () => ({ matches: v }); } };
}

test('theme-boot: sem escolha segue o sistema; escolha explícita vence o sistema', () => {
 assert.equal(rodarBoot({ sistemaEscuro: true }).atributos['data-theme'], 'dark');
 assert.equal(rodarBoot({ sistemaEscuro: false }).atributos['data-theme'], 'light');
 assert.equal(rodarBoot({ guardado: 'claro', sistemaEscuro: true }).atributos['data-theme'], 'light');
 assert.equal(rodarBoot({ guardado: 'escuro', sistemaEscuro: false }).atributos['data-theme'], 'dark');
 assert.equal(rodarBoot({ guardado: 'lixo', sistemaEscuro: true }).atributos['data-theme-pref'], 'sistema', 'valor inválido guardado vira "sistema"');
});

test('theme-boot: definir grava/limpa a escolha, e a cor da barra do navegador acompanha o tema', () => {
 const c = rodarBoot({ sistemaEscuro: false });
 assert.equal(c.meta.content, '#ffffff');
 c.api.definir('escuro');
 assert.equal(c.depósito.get('tzolkin-tema'), 'escuro');
 assert.equal(c.atributos['data-theme'], 'dark');
 assert.equal(c.meta.content, '#111111');
 c.api.definir('sistema');
 assert.equal(c.depósito.has('tzolkin-tema'), false, '"sistema" apaga a escolha guardada');
 assert.equal(c.atributos['data-theme-pref'], 'sistema');
 assert.equal(c.ouvintes.length, 1, 'escuta a mudança de tema do sistema');
});

test('theme-boot: com o armazenamento bloqueado (navegação privada) não quebra', () => {
 const sandbox = { document: { documentElement: { setAttribute() {} }, querySelector: () => null }, localStorage: { getItem() { throw new Error('bloqueado'); }, setItem() { throw new Error('bloqueado'); }, removeItem() { throw new Error('bloqueado'); } } };
 sandbox.window = sandbox; sandbox.matchMedia = () => ({ matches: true, addEventListener() {} });
 vm.runInNewContext(readFileSync(new URL('../../apps/web/public/theme-boot.js', import.meta.url), 'utf8'), sandbox);
 assert.doesNotThrow(() => sandbox.TzolkinTema.definir('escuro'));
 assert.equal(sandbox.TzolkinTema.preferencia(), 'sistema');
});

test('index.html: o script do tema roda antes de qualquer CSS e theme.css vem logo após style.css', () => {
 const html = lerPublico('index.html');
 const boot = html.indexOf('/theme-boot.js');
 assert.ok(boot > 0 && boot < html.indexOf('rel="stylesheet"'), 'theme-boot.js antes do primeiro CSS (senão a página pisca clara)');
 assert.ok(html.indexOf('/theme.css') > html.indexOf('/style.css'), 'theme.css depois de style.css');
 assert.ok(html.indexOf('<meta name="theme-color"') < boot, 'a meta theme-color precisa existir quando o script roda');
 assert.match(html, /id="open-settings"/, 'botão Configurações no menu lateral');
});

// ---- guarda: sem cor fixa nos CSS já migrados -------------------------------------------------------------
// Cor fixa em CSS de tela é o que não vira escuro. Valem só: tokens (linhas "--x: valor"), fallback de var(--x, #fff),
// comentários. Os arquivos da lista abaixo foram migrados; ao migrar outro, ponha na lista.
const MIGRADOS = ['style.css', 'controls.css', 'peek.css', 'tabs.css', 'theme.css', 'badge.css', 'overview.css'];
const semPermitidos = css => css
 .replace(/\/\*[\s\S]*?\*\//g, '')
 .replace(/var\(\s*--[\w-]+\s*,(?:[^()]|\([^()]*\))*\)/g, 'var(--x)') // fallback dentro de var()
 .split('\n').filter(l => !/^\s*--[\w-]+\s*:/.test(l)).join('\n');       // declaração de token

for (const arquivo of MIGRADOS) {
 test(`sem cor fixa fora de token: ${arquivo}`, () => {
  const sobras = [...semPermitidos(lerPublico(arquivo)).matchAll(/#[0-9a-fA-F]{3,8}\b|rgba?\([^)]*\)|hsla?\([^)]*\)/g)].map(m => m[0]);
  assert.deepEqual(sobras, [], `${arquivo} tem cor fixa (vira mancha no escuro): use um token de style.css`);
 });
}
