// Selos (badge.css + tomDoEstado): a paleta cumpre contraste, todo tom existe no CSS, e todo ESTADO do
// sistema tem um tom decidido (nada cai sem cor por esquecimento, nada ganha a cor errada em silêncio).
import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { tomDoEstado, TOM_DO_ESTADO, TONS } from '../../apps/web/public/data-table.js';
import { SITUACOES } from '../../apps/web/public/client-edit.js';
import { ENGAGEMENT_STATUS } from '../../apps/api/src/modules/portfolio.mjs';

const css = readFileSync(new URL('../../apps/web/public/badge.css', import.meta.url), 'utf8');

const luz = hex => {
 const [r, g, b] = [1, 3, 5].map(i => parseInt(hex.slice(i, i + 2), 16) / 255).map(v => (v <= 0.03928 ? v / 12.92 : ((v + 0.055) / 1.055) ** 2.4));
 return 0.2126 * r + 0.7152 * g + 0.0722 * b;
};
const contraste = (a, b) => { const [x, y] = [luz(a), luz(b)].sort((p, q) => q - p); return (x + 0.05) / (y + 0.05); };
const cor = (tom, parte) => {
 const m = css.match(new RegExp(`--badge-${tom}-${parte}:\\s*(#[0-9a-fA-F]{6})`));
 assert.ok(m, `falta --badge-${tom}-${parte} no badge.css`);
 return m[1];
};

test('paleta: texto >= 4,5:1 sobre o fundo do selo e pontinho >= 3:1, em todos os tons', () => {
 for (const tom of TONS) {
  const texto = contraste(cor(tom, 'fg'), cor(tom, 'bg'));
  const ponto = contraste(cor(tom, 'dot'), cor(tom, 'bg'));
  assert.ok(texto >= 4.5, `${tom}: texto ${texto.toFixed(2)}:1 (mínimo 4,5)`);
  // O neutro não desenha pontinho; os demais, sim.
  if (tom !== 'neutral') assert.ok(ponto >= 3, `${tom}: pontinho ${ponto.toFixed(2)}:1 (mínimo 3)`);
 }
});

test('CSS: cada tom tem regra, e os nomes antigos seguem como apelido', () => {
 for (const tom of ['success', 'warning', 'danger', 'info', 'accent', 'neutral']) assert.match(css, new RegExp(`\\.${tom}\\b`), `tom ${tom} sem regra`);
 for (const antigo of ['active', 'building', 'failed']) assert.match(css, new RegExp(`\\.${antigo}\\b`), `apelido .${antigo} perdido: telas antigas ficariam sem cor`);
 assert.match(css, /height:\s*22px/, 'altura única do selo');
});

test('tomDoEstado: todo ciclo de vida, situação de contratação e etapa de lead tem tom válido', () => {
 const ciclos = SITUACOES.map(([valor]) => valor);
 const lead = ['open', 'qualified', 'won', 'lost', 'archived'];
 for (const estado of [...ciclos, ...ENGAGEMENT_STATUS, ...lead]) {
  assert.ok(Object.hasOwn(TOM_DO_ESTADO, estado), `estado "${estado}" sem tom decidido em TOM_DO_ESTADO`);
  assert.ok(TONS.includes(tomDoEstado(estado)), `tom inválido para "${estado}"`);
 }
 // não sobra tom para estado que não existe mais
 for (const estado of Object.keys(TOM_DO_ESTADO)) assert.ok([...ciclos, ...ENGAGEMENT_STATUS, ...lead].includes(estado), `"${estado}" em TOM_DO_ESTADO não é um estado do sistema`);
});

test('tomDoEstado: as decisões que importam (o que é bom, o que pede atenção, o que acabou)', () => {
 assert.equal(tomDoEstado('active'), 'success');
 assert.equal(tomDoEstado('won'), 'success');
 assert.equal(tomDoEstado('onboarding'), 'info');
 assert.equal(tomDoEstado('planned'), 'info');
 assert.equal(tomDoEstado('open'), 'info');
 assert.equal(tomDoEstado('paused'), 'warning');
 assert.equal(tomDoEstado('unclassified'), 'warning', 'não classificado pede atenção');
 for (const encerrado of ['completed', 'discontinued', 'lost', 'archived']) assert.equal(tomDoEstado(encerrado), 'neutral', `${encerrado} acabou: sem cor`);
 assert.equal(tomDoEstado('estado-que-nao-existe'), 'neutral', 'desconhecido sai neutro, não com a cor errada');
 assert.equal(tomDoEstado(undefined), 'neutral');
});
