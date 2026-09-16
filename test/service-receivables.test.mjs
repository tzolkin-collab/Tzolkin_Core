// Recebimentos de linha de serviço (ADR 0008, fase 1) contra PostgreSQL real.
// Cria e remove apenas registros sintéticos desta execução.
import test from 'node:test';
import assert from 'node:assert/strict';
import { randomUUID, randomBytes } from 'node:crypto';
import pg from 'pg';
import { createCore } from '../apps/api/src/server.mjs';
import { testConnectionString } from '../apps/api/src/platform/database.mjs';

test('Recebimentos de linha de serviço', async t => {
 const pool = new pg.Pool({ connectionString: testConnectionString().connectionString, max: 3 });
 const adminPassword = randomBytes(32).toString('base64url');
 // 16/09/2026 12:00 em Brasília: "hoje" fixo para as datas de pagamento e nota.
 const server = createCore({ pool, adminPassword, clock: () => Date.parse('2026-09-16T15:00:00Z') });
 await new Promise(resolve => server.listen(0, '127.0.0.1', resolve));
 const origin = `http://127.0.0.1:${server.address().port}`;
 let cookie = '';
 const tenants = [], contracts = [], plans = [];
 const req = async (path, method = 'GET', body) => {
  const r = await fetch(origin + path, { method, headers: { origin, 'Content-Type': 'application/json', cookie }, body: body === undefined ? undefined : JSON.stringify(body) });
  return { status: r.status, body: await r.json() };
 };
 const contratoAtivo = async (product, amount = 120000) => {
  const row = (await pool.query(
   `INSERT INTO commercial_contracts(tenant_id,product_id,title,scope,amount_minor,currency,status,accepted_at,acceptance_reference,version)
    VALUES($1,$2,'Contrato sintético','Escopo de teste',$3,'BRL','active',now(),'aceite de teste',2) RETURNING id,version`,
   [tenants[0], product, amount])).rows[0];
  contracts.push(row.id);
  return row;
 };

 try {
  await t.test('prepara operador, empresa e contratos', async () => {
   const login = await fetch(origin + '/api/login', { method: 'POST', headers: { origin, 'Content-Type': 'application/json' }, body: JSON.stringify({ password: adminPassword }) });
   assert.equal(login.status, 200);
   cookie = login.headers.get('set-cookie').split(';')[0];
   const tenant = await req('/api/tenants', 'POST', { name: 'Recebimentos sintético', slug: `test-${randomUUID()}` });
   assert.equal(tenant.status, 200);
   tenants.push(tenant.body.tenant_id);
  });

  let mentoria, planId, parcelas;

  await t.test('só linha de serviço lista e cobra por contrato', async () => {
   mentoria = await contratoAtivo('mentorias');
   const lista = await req('/api/service-receivables?product_id=mentorias');
   assert.equal(lista.status, 200);
   assert.ok(lista.body.contracts.some(c => c.id === mentoria.id && c.amount_minor === 120000));
   const produto = await req('/api/service-receivables?product_id=skiller');
   assert.equal(produto.status, 409);
   assert.match(produto.body.message, /cobra por oferta e checkout/);
   const skiller = await contratoAtivo('skiller');
   const recusa = await req('/api/service-receivables/preview', 'POST', { contract_id: skiller.id, contract_version: 2, provider: 'manual', method: 'pix', schedule: { count: 1, first_due_on: '2026-10-05' } });
   assert.equal(recusa.status, 409);
  });

  await t.test('prévia calcula e não grava', async () => {
   const corpo = { contract_id: mentoria.id, contract_version: 2, provider: 'manual', method: 'pix', schedule: { count: 3, first_due_on: '2026-10-31' } };
   const previa = await req('/api/service-receivables/preview', 'POST', corpo);
   assert.equal(previa.status, 200, JSON.stringify(previa.body));
   assert.deepEqual(previa.body.preview.installments.map(p => [p.amount_minor, p.due_on]),
    [[40000, '2026-10-31'], [40000, '2026-11-30'], [40000, '2026-12-31']]);
   assert.equal((await pool.query('SELECT count(*)::int AS n FROM service_receivable_plans WHERE contract_id=$1', [mentoria.id])).rows[0].n, 0);
   const versaoVelha = await req('/api/service-receivables/preview', 'POST', { ...corpo, contract_version: 1 });
   assert.equal(versaoVelha.status, 409);
  });

  await t.test('cria rascunho com fotografia do contrato; segundo plano vivo é recusado', async () => {
   const corpo = { contract_id: mentoria.id, contract_version: 2, provider: 'manual', method: 'pix', schedule: { count: 3, first_due_on: '2026-10-31' } };
   const criado = await req('/api/service-receivables/plans', 'POST', corpo);
   assert.equal(criado.status, 200, JSON.stringify(criado.body));
   planId = criado.body.plan.id;
   plans.push(planId);
   assert.equal(criado.body.plan.status, 'draft');
   assert.equal(criado.body.plan.contract_snapshot.acceptance_reference, 'aceite de teste');
   assert.deepEqual(criado.body.plan.installments.map(p => p.status), ['planned', 'planned', 'planned']);
   assert.equal((await req('/api/service-receivables/plans', 'POST', corpo)).status, 409);
   const lista = await req('/api/service-receivables?product_id=mentorias');
   assert.ok(!lista.body.contracts.some(c => c.id === mentoria.id), 'contrato com plano vivo sai da lista de pendentes');
  });

  await t.test('aprovar exige a revisão atual e libera as parcelas', async () => {
   assert.equal((await req(`/api/service-receivables/plans/${planId}/approve`, 'POST', { revision: 9 })).status, 409);
   const ok = await req(`/api/service-receivables/plans/${planId}/approve`, 'POST', { revision: 1 });
   assert.equal(ok.status, 200, JSON.stringify(ok.body));
   assert.equal(ok.body.plan.status, 'approved');
   parcelas = ok.body.plan.installments;
   assert.deepEqual(parcelas.map(p => p.status), ['scheduled', 'scheduled', 'scheduled']);
  });

  await t.test('cobrança externa, pagamento e NFS-e; pago não é disponível', async () => {
   const [primeira] = parcelas;
   const referencia = `cobre-${randomUUID()}`;
   const emitida = await req(`/api/service-receivables/installments/${primeira.id}/issue`, 'POST', { revision: primeira.revision, external_ref: referencia, external_url: 'https://pagamento.exemplo/abc' });
   assert.equal(emitida.status, 200, JSON.stringify(emitida.body));
   assert.equal(emitida.body.installment.status, 'issued');
   const futuro = await req(`/api/service-receivables/installments/${primeira.id}/payment`, 'POST', { revision: emitida.body.installment.revision, paid_on: '2026-09-17' });
   assert.equal(futuro.status, 400);
   const paga = await req(`/api/service-receivables/installments/${primeira.id}/payment`, 'POST', { revision: emitida.body.installment.revision, paid_on: '2026-09-16', payment_reference: 'pix-e2e' });
   assert.equal(paga.status, 200, JSON.stringify(paga.body));
   assert.equal(paga.body.installment.status, 'paid');
   assert.equal(paga.body.installment.paid_on, '2026-09-16', 'a data não escorrega de fuso');
   const nota = await req(`/api/service-receivables/installments/${primeira.id}/invoice`, 'POST', { revision: paga.body.installment.revision, number: '2026/000123', issued_on: '2026-09-16' });
   assert.equal(nota.status, 200, JSON.stringify(nota.body));
   assert.equal(nota.body.installment.invoice_number, '2026/000123');
   const segundaNota = await req(`/api/service-receivables/installments/${primeira.id}/invoice`, 'POST', { revision: nota.body.installment.revision, number: '999', issued_on: '2026-09-16' });
   assert.equal(segundaNota.status, 409);
   const cancelarPaga = await req(`/api/service-receivables/installments/${primeira.id}/cancel`, 'POST', { revision: nota.body.installment.revision, reason: 'teste' });
   assert.equal(cancelarPaga.status, 409);
   // A mesma cobrança não quita duas parcelas.
   const repetida = await req(`/api/service-receivables/installments/${parcelas[1].id}/issue`, 'POST', { revision: parcelas[1].revision, external_ref: referencia });
   assert.equal(repetida.status, 409);
  });

  await t.test('vencimento, cancelamento de parcela e resumo', async () => {
   const [, segunda, terceira] = parcelas;
   const adiada = await req(`/api/service-receivables/installments/${segunda.id}/reschedule`, 'POST', { revision: segunda.revision, due_on: '2026-12-10' });
   assert.equal(adiada.status, 200, JSON.stringify(adiada.body));
   assert.equal(adiada.body.installment.due_on, '2026-12-10');
   const cancelada = await req(`/api/service-receivables/installments/${terceira.id}/cancel`, 'POST', { revision: terceira.revision, reason: 'escopo reduzido' });
   assert.equal(cancelada.status, 200, JSON.stringify(cancelada.body));
   assert.equal((await req(`/api/service-receivables/plans/${planId}/cancel`, 'POST', { revision: 2, reason: 'refazer' })).status, 409, 'plano com parcela paga não é cancelado inteiro');

   const lista = await req('/api/service-receivables?product_id=mentorias');
   const plano = lista.body.plans.find(p => p.id === planId);
   assert.deepEqual(plano.summary, {
    scheduled_minor: 40000, issued_minor: 0, paid_minor: 40000, available_minor: 0, canceled_minor: 40000,
    overdue_minor: 0, overdue_count: 0, invoices_pending: 0,
   });
   const trilha = (await pool.query('SELECT action FROM service_receivable_audit WHERE plan_id=$1 ORDER BY created_at', [planId])).rows.map(r => r.action);
   assert.deepEqual(trilha.sort(), ['installment_canceled', 'installment_issued', 'installment_paid', 'installment_rescheduled', 'invoice_recorded', 'plan_approved', 'plan_created']);
  });

  await t.test('o banco recusa estado incoerente mesmo sem passar pela API', async () => {
   await assert.rejects(
    () => pool.query("UPDATE service_installments SET status='paid' WHERE id=$1", [parcelas[1].id]),
    e => e.code === '23514', 'pago exige data e origem do pagamento');
   await assert.rejects(
    () => pool.query("UPDATE service_installments SET invoice_number='1' WHERE id=$1", [parcelas[1].id]),
    e => e.code === '23514', 'nota exige data de emissão');
  });

  await t.test('reclassificar a linha com plano vivo é recusado', async () => {
   const portfolio = await req('/api/portfolio');
   const item = portfolio.body.items.find(i => i.id === 'mentorias');
   const r = await req('/api/portfolio/mentorias', 'PUT', { name: item.name, portfolio_kind: 'product', brand_family: item.brand_family, revision: item.revision });
   assert.equal(r.status, 409);
   assert.match(r.body.message, /planos de recebimento vivos/);
  });
 } finally {
  const client = await pool.connect();
  try {
   await client.query('BEGIN');
   await client.query('DELETE FROM service_receivable_audit WHERE plan_id=ANY($1::uuid[])', [plans]);
   await client.query('DELETE FROM service_installments WHERE plan_id=ANY($1::uuid[])', [plans]);
   await client.query('DELETE FROM service_receivable_plans WHERE id=ANY($1::uuid[])', [plans]);
   await client.query('DELETE FROM commercial_contracts WHERE id=ANY($1::uuid[])', [contracts]);
   await client.query('DELETE FROM audit_events WHERE tenant_id=ANY($1::uuid[])', [tenants]);
   await client.query('DELETE FROM tenants WHERE id=ANY($1::uuid[])', [tenants]);
   await client.query('COMMIT');
  } catch (error) { await client.query('ROLLBACK'); throw error; } finally { client.release(); }
  server.closeAllConnections();
  await new Promise(resolve => server.close(resolve));
  await pool.end();
 }
});
