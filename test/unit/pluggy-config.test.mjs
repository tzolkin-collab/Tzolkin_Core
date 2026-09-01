import test from 'node:test';
import assert from 'node:assert/strict';
import {pluggyItemIds} from '../../apps/api/src/integrations/pluggy-config.mjs';

test('Pluggy suporta múltiplos itens, espaços e deduplicação', () => {
  assert.deepEqual(pluggyItemIds({PLUGGY_ITEM_IDS:' item-a, item-b,item-a, '}), ['item-a','item-b']);
});
test('Pluggy mantém compatibilidade e prioriza lista explícita', () => {
  assert.deepEqual(pluggyItemIds({PLUGGY_ITEM_ID:'legacy'}), ['legacy']);
  assert.deepEqual(pluggyItemIds({PLUGGY_ITEM_IDS:'new',PLUGGY_ITEM_ID:'legacy'}), ['new']);
  assert.deepEqual(pluggyItemIds({}), []);
});
test('Pluggy rejeita URLs e caracteres inválidos sem expor o valor', () => {
  assert.throws(() => pluggyItemIds({PLUGGY_ITEM_IDS:'https://example.com'}), /identificadores/);
});
