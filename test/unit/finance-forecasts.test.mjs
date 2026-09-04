import test from 'node:test';
import assert from 'node:assert/strict';
import { expandForecastRows } from '../../apps/api/src/modules/finance-forecasts.mjs';

const row = (overrides = {}) => ({id:'forecast-1',name:'Assinatura',direction:'income',amount_minor:'500000',currency:'BRL',recurrence:'monthly',due_date:'2026-01-31',end_date:null,tags:[],...overrides});

test('expands recurring forecasts across a year and clamps month ends', () => {
 const items = expandForecastRows([row()], '2026-01-01', '2026-12-31');
 assert.deepEqual(items.map(item => item.due_date), ['2026-01-31','2026-02-28','2026-03-31','2026-04-30','2026-05-31','2026-06-30','2026-07-31','2026-08-31','2026-09-30','2026-10-31','2026-11-30','2026-12-31']);
 assert.equal(items.reduce((sum,item) => sum + item.amount_minor, 0), 6000000);
});

test('does not repeat one-time forecasts and respects end dates', () => {
 const items = expandForecastRows([
  row({id:'once',name:'Única',recurrence:'once',due_date:'2026-01-10'}),
  row({id:'limited',name:'Limitada',end_date:'2026-03-15'}),
 ], '2026-02-01', '2026-05-31');
 assert.deepEqual(items.map(item => [item.id,item.due_date]), [['limited','2026-02-28']]);
});
