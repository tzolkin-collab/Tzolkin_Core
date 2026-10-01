import test from 'node:test';
import assert from 'node:assert/strict';
import { fitSize, MAX_SIDE } from '../../apps/web/public/media.js';

test('foto grande é reduzida mantendo a proporção; pequena não é ampliada', () => {
 assert.deepEqual(fitSize(4000, 3000), { width: 2000, height: 1500, scaled: true });
 assert.deepEqual(fitSize(3000, 4000), { width: 1500, height: 2000, scaled: true });
 assert.deepEqual(fitSize(800, 600), { width: 800, height: 600, scaled: false });
 assert.equal(fitSize(MAX_SIDE, 10).scaled, false);
});
