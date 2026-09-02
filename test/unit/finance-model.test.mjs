import test from 'node:test';
import assert from 'node:assert/strict';
import {needsRefresh,periodRows,cashSummary,bankBalance,movementSeries,paymentInstitution} from '../../apps/web/public/finance-model.js';
test('institution colors normalize identity and unknown names stay honest and stable',()=>{
 assert.equal(paymentInstitution('Itaú').color,paymentInstitution('ITAU').color);
 assert.notEqual(paymentInstitution('Nubank').color,paymentInstitution('Itaú').color);
 assert.deepEqual(paymentInstitution('Outro banco'),paymentInstitution('Outro banco'));
 assert.equal(paymentInstitution().name,'Instituição não informada');
 assert.equal(paymentInstitution('Nubank').logo,'nubank');
 assert.match(paymentInstitution('<script>test</script>').color,/^#[a-f0-9]{6}$/);
});
test('transaction institution comes from its account, not the counterparty',()=>{
 const rows=periodRows([{id:'a',bank:'Banco Inter',snapshot:{payload:{transactions:[{id:'x',date:'2026-08-02T12:00:00Z',description:'Pix Nubank',bank:'Nubank'}]}}}],'2026-08');
 assert.equal(rows[0].bank,'Banco Inter');
});
const now=Date.parse('2026-08-31T12:00:00Z');
test('balance excludes credit accounts, foreign currencies and refuses missing balances',()=>{
 const accounts=[{type:'BANK',currency:'BRL',balance:100},{type:'BANK',currency:'BRL',balance:50},{type:'CREDIT',currency:'BRL',balance:500},{type:'BANK',currency:'USD',balance:1000}];
 assert.equal(bankBalance(accounts,'BRL'),150);assert.equal(bankBalance([],'BRL'),null);assert.equal(bankBalance([...accounts,{type:'BANK',currency:'BRL',balance:null}],'BRL'),null);
});
test('movement line starts at zero and never invents an opening balance',()=>{
 const series=movementSeries({daily:[{day:'2026-08-02',incoming:100,outgoing:20},{day:'2026-08-04',incoming:0,outgoing:150}]},'2026-08');
 assert.equal(series.length,31);assert.equal(series[0].net,0);assert.equal(series[1].net,80);assert.equal(series[3].net,-70);assert.equal(series.at(-1).net,-70);
});
test('saved current month is reused for 12h; historical months stay cached',()=>{
 const snapshot={updated_at:new Date(now-3600000).toISOString(),payload:{time_zone:'America/Sao_Paulo'}};
 assert.equal(needsRefresh(snapshot,null,'2026-08',now),false);
 assert.equal(needsRefresh({...snapshot,updated_at:'2026-08-29'},null,'2026-08',now),true);
 assert.equal(needsRefresh({...snapshot,updated_at:'2026-07-01'},null,'2026-07',now),false);
 assert.equal(needsRefresh(null,null,'2026-07',now),true);
 assert.equal(needsRefresh({payload:{}},null,'2026-07',now),true);
});
test('persisted failure or interrupted attempt prevents a reload retry loop',()=>{
 for(const state of ['error','running'])assert.equal(needsRefresh(null,{payload:{state},updated_at:new Date(now-1000).toISOString()},'2026-08',now),false);
 assert.equal(needsRefresh(null,{payload:{state:'error'},updated_at:new Date(now-700000).toISOString()},'2026-08',now),true);
});
test('saved UTC snapshots are filtered to local month without deleting storage',()=>{
 const account={id:'a',snapshot:{payload:{transactions:[{id:'x',date:'2026-08-01T01:29:43Z'},{id:'y',date:'2026-08-03T12:00:00Z'}]}}};
 assert.deepEqual(periodRows([account],'2026-08').map(t=>t.id),['y']);assert.equal(account.snapshot.payload.transactions.length,2);
});
test('cash totals exclude cards, pending rows and other currencies',()=>{
 const accounts=[{id:'bank',type:'BANK',currency:'BRL'},{id:'card',type:'CREDIT',currency:'BRL'},{id:'dollar',type:'BANK',currency:'USD'}];
 const row={date:'2026-08-03T12:00:00Z',currency:'BRL',status:'POSTED',type:'CREDIT',amount:100,account_id:'bank'};
 const totals=cashSummary(accounts,[row,{...row,type:'DEBIT',amount:-20},{...row,account_id:'card'},{...row,account_id:'dollar',currency:'USD'},{...row,status:'PENDING'}],'BRL');
 assert.equal(totals.incoming,100);assert.equal(totals.outgoing,20);assert.equal(totals.net,80);
});
