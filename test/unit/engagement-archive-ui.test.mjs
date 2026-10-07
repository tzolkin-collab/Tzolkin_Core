// "Excluir contratação" na ficha do cliente: o botão arquiva pela rota que já existe (portfolio.mjs), sem apagar nada.
// Estas guardas leem o código-fonte da tela; o comportamento da rota é coberto em test/tracking-engagement.test.mjs.
import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';

const fonte = nome => readFileSync(new URL(`../../apps/web/public/${nome}`, import.meta.url), 'utf8');
const api = readFileSync(new URL('../../apps/api/src/modules/portfolio.mjs', import.meta.url), 'utf8');

test('a rota que o botão chama existe e arquiva sem apagar (archived_at, com revisão)', () => {
  assert.match(api, /\['archive', true\]/, 'a ação archive é registrada para contratações');
  assert.match(api, /router\.post\(`\/api\/engagements\/:id\/\$\{acao\}`/);
  assert.match(api, /UPDATE client_engagements SET archived_at=/, 'arquivar só preenche archived_at');
  assert.doesNotMatch(api, /DELETE FROM client_engagements/, 'nenhuma contratação é apagada de verdade');
});

test('o botão Excluir confirma antes e manda a revisão para a rota de arquivar', () => {
  const app = fonte('app.js'), index = fonte('index.html');
  assert.match(index, /<dialog id="archive-engagement-dialog"/, 'o diálogo de confirmação existe');
  assert.match(index, /id="archive-engagement-form"/);
  assert.match(app, /openArchiveEngagementDialog\(engagement,/, 'o botão abre a confirmação, não arquiva direto');
  assert.match(app, /'\/api\/engagements\/'\+encodeURIComponent\(archivingEngagement\.id\)\+'\/archive','POST',\{revision:archivingEngagement\.revision\}/,
    'a chamada usa o id e a revisão da contratação');
});
