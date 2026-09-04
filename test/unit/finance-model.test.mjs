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

// A lista de marcas alimenta três consumidores. Se divergir do disco, o sintoma
// é um 404 silencioso e o selo cai no pictograma genérico — como se o banco não
// fosse reconhecido. Este teste transforma isso em falha visível.
test('every bundled brand has a file on disk and is served by the asset map',async()=>{
 const {BANK_LOGOS}=await import('../../apps/web/public/finance-model.js');
 const {existsSync}=await import('node:fs');
 assert.ok(BANK_LOGOS.length>0);
 for(const nome of BANK_LOGOS){
  assert.match(nome,/^[a-z0-9]{2,32}$/,`slug fora do formato: ${nome}`);
  assert.ok(existsSync(new URL(`../../apps/web/public/logos/${nome}.svg`,import.meta.url)),`sem arquivo: ${nome}.svg`);
 }
 // Todo logo que o modelo aponta precisa estar na lista empacotada.
 const apontados=new Set(['nubank','inter','asaas','mastercard','itau','bradesco','santander','bancodobrasil','caixa','c6bank','btgpactual','sicredi','sicoob','mercadopago','pagbank','picpay','stripe']);
 for(const alvo of apontados)assert.ok(BANK_LOGOS.includes(alvo),`marca apontada e não empacotada: ${alvo}`);
});

test('institution resolves a logo from the bank name, and unknown stays honest',()=>{
 assert.equal(paymentInstitution('Nu Pagamentos').logo,'nubank');
 assert.equal(paymentInstitution('Itaú').logo,'itau');
 assert.equal(paymentInstitution('PagSeguro').logo,'pagbank');
 assert.equal(paymentInstitution('Banco Que Não Existe').logo,null);
 // Banco reconhecido sem marca oficial fica sem logo, e o selo cai no
 // pictograma neutro com a cor da instituição. Nunca uma marca inventada.
 assert.equal(paymentInstitution('Banco Inter').logo,'inter');
 assert.equal(paymentInstitution('Banco Inter').name,'Banco Inter');
});

// Uma marca fabricada — retângulo com o nome escrito por cima — passou por logo
// de banco antes deste teste existir. É pior que marca ausente: afirma ser o
// logo oficial. <text> denuncia isso, e proporção fora do quadrado denuncia
// wordmark, que o selo de 20px esmaga.
test('bundled brands are real square vectors, never fabricated wordmarks',async()=>{
 const {BANK_LOGOS,WIDE_LOGOS}=await import('../../apps/web/public/finance-model.js');
 const {readFileSync}=await import('node:fs');
 for(const nome of BANK_LOGOS){
  const svg=readFileSync(new URL(`../../apps/web/public/logos/${nome}.svg`,import.meta.url),'utf8');
  assert.ok(!/<text/.test(svg),`${nome}.svg desenha texto: marca fabricada, não oficial`);
  const vb=(svg.match(/viewBox="([^"]+)"/)||[])[1];
  assert.ok(vb,`${nome}.svg sem viewBox`);
  const [,,w,h]=vb.trim().split(/[\s,]+/).map(Number);
  const razao=w/h;
  // Marca larga é permitida, mas precisa estar declarada: assim ela renderiza
  // por altura em vez de ser esmagada num quadrado de 20px sem ninguém notar.
  const larga=WIDE_LOGOS.includes(nome);
  if(larga)assert.ok(razao>1.5,`${nome}.svg está em WIDE_LOGOS mas é quadrado (${razao.toFixed(2)})`);
  else assert.ok(razao>0.85&&razao<1.18,`${nome}.svg tem proporção ${razao.toFixed(2)}: declare em WIDE_LOGOS ou use o símbolo quadrado`);
 }
});

test('brazilDay and brazilYear format dates accurately in America/Sao_Paulo timezone',async()=>{
 const {brazilDay,brazilYear}=await import('../../apps/web/public/finance-model.js');
 assert.equal(brazilDay('2026-08-01T01:29:43Z'),'2026-07-31');
 assert.equal(brazilDay('2026-08-01T03:00:00Z'),'2026-08-01');
 assert.equal(brazilYear('2026-01-01T01:00:00Z'),'2025');
 assert.equal(brazilYear('2026-01-01T03:00:00Z'),'2026');
});

test('periodRows filters correctly by year, day, and custom date range',async()=>{
 const {periodRows}=await import('../../apps/web/public/finance-model.js');
 const account={id:'a',bank:'Nubank',snapshot:{payload:{transactions:[
  {id:'t1',date:'2025-12-31T12:00:00Z',amount:10},
  {id:'t2',date:'2026-08-01T12:00:00Z',amount:20},
  {id:'t3',date:'2026-08-02T12:00:00Z',amount:30},
  {id:'t4',date:'2026-09-05T12:00:00Z',amount:40},
 ]}}};
 assert.deepEqual(periodRows([account],'2026').map(t=>t.id),['t4','t3','t2']);
 assert.deepEqual(periodRows([account],'2025').map(t=>t.id),['t1']);
 assert.deepEqual(periodRows([account],'2026-08-02').map(t=>t.id),['t3']);
 assert.deepEqual(periodRows([account],{mode:'day',day:'2026-08-01'}).map(t=>t.id),['t2']);
 assert.deepEqual(periodRows([account],{mode:'custom',start:'2026-08-02',end:'2026-09-05'}).map(t=>t.id),['t4','t3']);
});

test('movementSeries computes series for year, day, and custom range',async()=>{
 const {movementSeries}=await import('../../apps/web/public/finance-model.js');
 const summary={daily:[
  {day:'2026-01-15',incoming:100,outgoing:20},
  {day:'2026-08-02',incoming:200,outgoing:50},
  {day:'2026-08-04',incoming:50,outgoing:100},
 ]};
 const yearSeries=movementSeries(summary,'2026');
 assert.equal(yearSeries.length,12);
 assert.equal(yearSeries[0].incoming,100);
 assert.equal(yearSeries[0].net,80);
 assert.equal(yearSeries[7].incoming,250);
 assert.equal(yearSeries[7].outgoing,150);
 assert.equal(yearSeries[7].net,180);

 const daySeries=movementSeries(summary,'2026-08-02');
 assert.equal(daySeries.length,1);
 assert.equal(daySeries[0].incoming,200);
 assert.equal(daySeries[0].outgoing,50);
 assert.equal(daySeries[0].net,150);

 const customSeries=movementSeries(summary,{mode:'custom',start:'2026-08-01',end:'2026-08-04'});
 assert.equal(customSeries.length,4);
 assert.equal(customSeries[1].incoming,200);
 assert.equal(customSeries[3].outgoing,100);
});
