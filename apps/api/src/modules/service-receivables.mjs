// Recebimentos de linha de serviço — ADR 0008, opção B. Fase 1: domínio e registro manual.
//
// A COBRANÇA NASCE DO CONTRATO ACEITO. O plano guarda a fotografia da versão ativa
// de commercial_contracts que o operador viu. As parcelas somam exatamente o valor
// acordado, em inteiros da menor unidade: nunca ponto flutuante.
//
// PRÉVIA ANTES DE GRAVAR. /preview calcula e valida sem gravar nada; /plans
// recalcula tudo no servidor. O corpo nunca traz um plano pronto em que se confie.
//
// DONO AUTORIZA DINHEIRO. Aprovar, registrar cobrança, pagamento ou NFS-e, mudar
// vencimento e cancelar exigem papel owner. Montar e descartar rascunho basta membro.
//
// NESTA FASE NADA VAI A PROVEDOR. Só `manual`: Cobre PJ ou outra cobrança externa,
// registrada à mão. Asaas e Stripe entram na fase 2; `available` (crédito no extrato
// bancário) só na fase 3, pela conciliação. Nenhuma rota daqui grava `available`.
import { fail, input, isProductId, isUuid, onlyParams, text } from '../platform/http.mjs';
import { commercialPermission } from './commercial-keys.mjs';
import { requireProductFor } from './catalog.mjs';

export const PROVIDERS_NOW = ['manual'];
export const METHODS = ['pix', 'boleto', 'card', 'external'];
export const MAX_INSTALLMENTS = 60;

const PLAN_COLS = `p.id,p.contract_id,p.contract_version,p.contract_snapshot,p.tenant_id,p.product_id,p.total_minor,p.currency,
 p.provider,p.method,p.status,p.created_by,p.approved_by,p.approved_at,p.canceled_at,p.cancel_reason,p.revision,p.created_at,p.updated_at`;
// Datas como texto: o driver converteria `date` em Date na hora local e o dia
// poderia escorregar entre o banco e a tela.
const INSTALLMENT_COLS = `i.id,i.plan_id,i.sequence,i.amount_minor,i.currency,i.due_on::text AS due_on,i.status,i.external_ref,i.external_url,
 i.issued_at,i.paid_on::text AS paid_on,i.paid_source,i.payment_reference,i.invoice_number,i.invoice_issued_on::text AS invoice_issued_on,
 i.invoice_recorded_at,i.canceled_at,i.cancel_reason,i.revision,i.created_at,i.updated_at`;

const money = (minor, currency) => new Intl.NumberFormat('pt-BR', { style: 'currency', currency }).format(minor / 100);
export const todayInBrazil = clock => new Intl.DateTimeFormat('sv-SE', { timeZone: 'America/Sao_Paulo' }).format(new Date(clock()));

// ---------------------------------------------------------------------------
// Cálculo puro: sem banco, testável sozinho
// ---------------------------------------------------------------------------

export function isoDate(value, label = 'Data') {
 if (typeof value !== 'string' || !/^\d{4}-\d{2}-\d{2}$/.test(value)) throw fail(400, `${label} inválida.`);
 const [y, m, d] = value.split('-').map(Number);
 const date = new Date(Date.UTC(y, m - 1, d));
 if (y < 2000 || y > 2100 || date.getUTCMonth() !== m - 1 || date.getUTCDate() !== d) throw fail(400, `${label} inválida.`);
 return value;
}

/** Soma meses mantendo o dia; dia que não existe no mês cai no último (31/01 + 1 → 28 ou 29/02). */
export function addMonths(iso, months) {
 const [y, m, d] = iso.split('-').map(Number);
 const alvo = new Date(Date.UTC(y, m - 1 + months, 1));
 const ultimo = new Date(Date.UTC(alvo.getUTCFullYear(), alvo.getUTCMonth() + 1, 0)).getUTCDate();
 alvo.setUTCDate(Math.min(d, ultimo));
 return alvo.toISOString().slice(0, 10);
}

/** Parcelas mensais iguais; o resto dos centavos vai na primeira, como em payment-model. */
export function evenInstallments(total_minor, count, first_due_on) {
 const parcela = Math.floor(total_minor / count), resto = total_minor - parcela * count;
 return Array.from({ length: count }, (_, i) => ({
  sequence: i + 1, amount_minor: parcela + (i === 0 ? resto : 0), due_on: addMonths(first_due_on, i),
 }));
}

/**
 * Monta o plano a partir do corpo e do contrato. Aceita um calendário (N parcelas
 * mensais iguais a partir de uma data) OU a lista explícita — nunca os dois.
 */
export function buildPlan(body, contract) {
 input(body, ['contract_id', 'contract_version', 'provider', 'method', 'schedule', 'installments']);
 if (['asaas', 'stripe'].includes(body.provider))
  throw fail(409, 'Emissão pelo Asaas ou pela Stripe ainda não está disponível. Registre como cobrança externa.');
 if (!PROVIDERS_NOW.includes(body.provider)) throw fail(400, 'Processador inválido.');
 if (!METHODS.includes(body.method)) throw fail(400, 'Meio de pagamento inválido.');
 const total = Number(contract.amount_minor), currency = contract.currency;
 if (!Number.isSafeInteger(total) || total <= 0) throw fail(409, 'Contrato sem valor não gera cobrança.');

 const temCalendario = body.schedule !== undefined, temLista = body.installments !== undefined;
 if (temCalendario === temLista) throw fail(400, 'Envie o calendário ou a lista de parcelas, não os dois.');
 let parcelas;
 if (temCalendario) {
  const s = body.schedule;
  input(s, ['count', 'first_due_on']);
  if (!Number.isInteger(s.count) || s.count < 1 || s.count > MAX_INSTALLMENTS)
   throw fail(400, `O número de parcelas vai de 1 a ${MAX_INSTALLMENTS}.`);
  parcelas = evenInstallments(total, s.count, isoDate(s.first_due_on, 'Primeiro vencimento'));
 } else {
  if (!Array.isArray(body.installments) || !body.installments.length || body.installments.length > MAX_INSTALLMENTS)
   throw fail(400, `Envie de 1 a ${MAX_INSTALLMENTS} parcelas.`);
  parcelas = body.installments.map((p, i) => {
   input(p, ['amount_minor', 'due_on']);
   if (!Number.isSafeInteger(p.amount_minor) || p.amount_minor <= 0) throw fail(400, `Parcela ${i + 1}: valor inválido.`);
   return { sequence: i + 1, amount_minor: p.amount_minor, due_on: isoDate(p.due_on, `Vencimento da parcela ${i + 1}`) };
  });
 }
 if (parcelas.some(p => p.amount_minor <= 0)) throw fail(400, 'Valor pequeno demais para esse número de parcelas.');
 for (let i = 1; i < parcelas.length; i++)
  if (parcelas[i].due_on < parcelas[i - 1].due_on) throw fail(400, 'Os vencimentos precisam estar em ordem.');
 const soma = parcelas.reduce((t, p) => t + p.amount_minor, 0);
 if (soma !== total)
  throw fail(400, `As parcelas somam ${money(soma, currency)} e o contrato vale ${money(total, currency)}. Precisam fechar exatamente.`);
 return {
  provider: body.provider, method: body.method, currency, total_minor: total,
  installments: parcelas.map(p => ({ ...p, currency })),
 };
}

/** Totais por situação, em inteiros. "Vencida" é parcela a cobrar ou cobrada com vencimento passado. */
export function summarize(installments, today) {
 const soma = lista => lista.reduce((t, i) => t + i.amount_minor, 0);
 const por = status => installments.filter(i => i.status === status);
 const vencidas = installments.filter(i => ['scheduled', 'issued'].includes(i.status) && i.due_on < today);
 return {
  scheduled_minor: soma(por('scheduled')), issued_minor: soma(por('issued')),
  paid_minor: soma(por('paid')), available_minor: soma(por('available')),
  canceled_minor: soma(por('canceled')), overdue_minor: soma(vencidas), overdue_count: vencidas.length,
  invoices_pending: installments.filter(i => ['paid', 'available'].includes(i.status) && !i.invoice_number).length,
 };
}

// ---------------------------------------------------------------------------
// Banco
// ---------------------------------------------------------------------------

const planoDaLinha = row => row && ({ ...row, total_minor: Number(row.total_minor) });
const parcelaDaLinha = row => row && ({ ...row, amount_minor: Number(row.amount_minor) });
const ator = operator => operator?.email || operator?.subject || 'desconhecido';

async function registrar(client, planId, installmentId, action, before, after, operator) {
 await client.query(
  `INSERT INTO service_receivable_audit(plan_id,installment_id,action,before,after,actor_subject,actor_email)
   VALUES($1,$2,$3,$4,$5,$6,$7)`,
  [planId, installmentId, action, before, after, operator?.subject || 'desconhecido', operator?.email ?? null]);
}

const revisao = body => {
 if (!Number.isInteger(body.revision) || body.revision < 1) throw fail(400, 'Revisão inválida.');
 return body.revision;
};

/** Contrato travado, na versão que o operador viu, aceito e de item que cobra por contrato. */
async function contratoParaPlano(client, body) {
 if (!isUuid(body.contract_id)) throw fail(400, 'Contrato inválido.');
 if (!Number.isInteger(body.contract_version) || body.contract_version < 1) throw fail(400, 'Versão do contrato inválida.');
 const c = (await client.query(
  `SELECT c.id,c.version,c.status,c.tenant_id,c.product_id,c.title,c.amount_minor,c.currency,
          c.starts_on::text AS starts_on,c.ends_on::text AS ends_on,c.accepted_at,c.acceptance_reference,t.name AS organization_name
     FROM commercial_contracts c JOIN tenants t ON t.id=c.tenant_id
    WHERE c.id=$1 FOR UPDATE OF c`, [body.contract_id])).rows[0];
 if (!c) throw fail(404, 'Contrato não encontrado.');
 if (c.version !== body.contract_version) throw fail(409, 'O contrato mudou desde que a tela foi aberta. Recarregue antes de montar o plano.');
 if (c.status !== 'active') throw fail(409, 'Só contrato aceito e ativo gera plano de recebimento.');
 await requireProductFor(client, c.product_id, 'contract_billing', { missing: fail(409, 'O item do contrato está arquivado ou em rascunho.') });
 return c;
}

async function carregarPlano(client, id, revision) {
 if (!isUuid(id)) throw fail(400, 'Plano inválido.');
 const plano = planoDaLinha((await client.query(`SELECT ${PLAN_COLS} FROM service_receivable_plans p WHERE p.id=$1 FOR UPDATE`, [id])).rows[0]);
 if (!plano) throw fail(404, 'Plano não encontrado.');
 if (plano.revision !== revision) throw fail(409, 'Este plano foi alterado por outra pessoa. Recarregue antes de continuar.');
 return plano;
}

async function carregarParcela(client, id, revision) {
 if (!isUuid(id)) throw fail(400, 'Parcela inválida.');
 const row = (await client.query(
  `SELECT ${INSTALLMENT_COLS},p.status AS plan_status,p.provider,p.tenant_id,p.contract_id,c.status AS contract_status
     FROM service_installments i
     JOIN service_receivable_plans p ON p.id=i.plan_id
     JOIN commercial_contracts c ON c.id=p.contract_id
    WHERE i.id=$1 FOR UPDATE OF i,p`, [id])).rows[0];
 if (!row) throw fail(404, 'Parcela não encontrada.');
 if (row.revision !== revision) throw fail(409, 'Esta parcela foi alterada por outra pessoa. Recarregue antes de continuar.');
 const { plan_status, provider, tenant_id, contract_id, contract_status, ...parcela } = row;
 return { parcela: parcelaDaLinha(parcela), plan_status, provider, tenant_id, contract_id, contract_status };
}

async function parcelasDe(client, planIds) {
 if (!planIds.length) return [];
 return (await client.query(`SELECT ${INSTALLMENT_COLS} FROM service_installments i WHERE i.plan_id=ANY($1::uuid[]) ORDER BY i.plan_id,i.sequence`, [planIds]))
  .rows.map(parcelaDaLinha);
}

async function atualizarParcela(client, id, sets, params) {
 return parcelaDaLinha((await client.query(
  `UPDATE service_installments i SET ${sets},revision=i.revision+1,updated_at=now() WHERE i.id=$1 RETURNING ${INSTALLMENT_COLS}`,
  [id, ...params])).rows[0]);
}

// ---------------------------------------------------------------------------
// Rotas
// ---------------------------------------------------------------------------

export function serviceReceivableRoutes(router, { clock = Date.now } = {}) {
 const hoje = () => todayInBrazil(clock);
 const naoFuturo = (iso, label) => {
  if (isoDate(iso, label) > hoje()) throw fail(400, `${label} não pode estar no futuro.`);
  return iso;
 };

 // --- leitura ---------------------------------------------------------------
 router.get('/api/service-receivables', async ({ pool, url, reply, operator }) => {
  await commercialPermission(pool, operator);
  onlyParams(url.searchParams, ['product_id']);
  const product = url.searchParams.get('product_id');
  if (!isProductId(product)) throw fail(400, 'Produto inválido.');
  await requireProductFor(pool, product, 'contract_billing', { draft: true, missing: fail(404, 'Produto não encontrado.') });
  const planos = (await pool.query(
   `SELECT ${PLAN_COLS},t.name AS organization_name FROM service_receivable_plans p JOIN tenants t ON t.id=p.tenant_id
     WHERE p.product_id=$1 ORDER BY (p.status='canceled'),p.created_at DESC LIMIT 100`, [product])).rows.map(planoDaLinha);
  const parcelas = await parcelasDe(pool, planos.map(p => p.id));
  // Contratos aceitos sem plano vivo: é daqui que a tela oferece montar um plano.
  const contratos = (await pool.query(
   `SELECT c.id,c.version,c.title,c.amount_minor,c.currency,c.starts_on::text AS starts_on,c.ends_on::text AS ends_on,c.accepted_at,t.name AS organization_name
      FROM commercial_contracts c JOIN tenants t ON t.id=c.tenant_id
     WHERE c.product_id=$1 AND c.status='active'
       AND NOT EXISTS (SELECT 1 FROM service_receivable_plans p WHERE p.contract_id=c.id AND p.status<>'canceled')
     ORDER BY c.accepted_at DESC NULLS LAST LIMIT 100`, [product])).rows.map(c => ({ ...c, amount_minor: Number(c.amount_minor) }));
  const today = hoje();
  return reply(200, {
   today, providers: PROVIDERS_NOW, methods: METHODS,
   plans: planos.map(plano => {
    const lista = parcelas.filter(i => i.plan_id === plano.id);
    return { ...plano, installments: lista, summary: summarize(lista, today) };
   }),
   contracts: contratos,
  });
 }, { body: false });

 // --- prévia: calcula e valida, não grava ------------------------------------
 router.post('/api/service-receivables/preview', async ({ client, body, operator }) => {
  await commercialPermission(client, operator, true);
  const contrato = await contratoParaPlano(client, body);
  return { body: { preview: buildPlan(body, contrato), contract: { id: contrato.id, version: contrato.version, title: contrato.title } } };
 }, { transactional: true, audit: false });

 // --- criar rascunho ----------------------------------------------------------
 router.post('/api/service-receivables/plans', async ({ client, body, operator }) => {
  await commercialPermission(client, operator, true);
  const contrato = await contratoParaPlano(client, body);
  const plano = buildPlan(body, contrato);
  const fotografia = {
   id: contrato.id, version: contrato.version, title: contrato.title, organization_name: contrato.organization_name,
   amount_minor: Number(contrato.amount_minor), currency: contrato.currency, starts_on: contrato.starts_on,
   ends_on: contrato.ends_on, accepted_at: contrato.accepted_at, acceptance_reference: contrato.acceptance_reference,
  };
  let criado;
  try {
   criado = planoDaLinha((await client.query(
    `INSERT INTO service_receivable_plans AS p(contract_id,contract_version,contract_snapshot,tenant_id,product_id,total_minor,currency,provider,method,created_by)
     VALUES($1,$2,$3,$4,$5,$6,$7,$8,$9,$10) RETURNING ${PLAN_COLS}`,
    [contrato.id, contrato.version, fotografia, contrato.tenant_id, contrato.product_id, plano.total_minor, plano.currency,
     plano.provider, plano.method, ator(operator)])).rows[0]);
  } catch (error) {
   if (error.code === '23505') throw fail(409, 'Este contrato já tem um plano de recebimento vivo. Cancele o atual para montar outro.');
   throw error;
  }
  const parcelas = (await client.query(
   `INSERT INTO service_installments AS i(plan_id,sequence,amount_minor,currency,due_on)
    SELECT $1,x.s,x.a,$2,x.d FROM unnest($3::int[],$4::bigint[],$5::date[]) AS x(s,a,d)
    RETURNING ${INSTALLMENT_COLS}`,
   [criado.id, plano.currency, plano.installments.map(p => p.sequence), plano.installments.map(p => p.amount_minor),
    plano.installments.map(p => p.due_on)])).rows.map(parcelaDaLinha).sort((a, b) => a.sequence - b.sequence);
  await registrar(client, criado.id, null, 'plan_created', null, { plan: criado, installments: parcelas }, operator);
  return { tenant: contrato.tenant_id, type: 'service_receivable.plan_created', body: { plan: { ...criado, installments: parcelas } } };
 }, { transactional: true });

 // --- aprovar -----------------------------------------------------------------
 router.post('/api/service-receivables/plans/:id/approve', async ({ client, params, body, operator }) => {
  await commercialPermission(client, operator, true, true);
  input(body, ['revision']);
  const antes = await carregarPlano(client, params.id, revisao(body));
  if (antes.status !== 'draft') throw fail(409, 'Só plano em rascunho é aprovado.');
  const contrato = (await client.query('SELECT status FROM commercial_contracts WHERE id=$1', [antes.contract_id])).rows[0];
  if (contrato?.status === 'canceled') throw fail(409, 'O contrato foi cancelado: o plano não pode ser aprovado.');
  const depois = planoDaLinha((await client.query(
   `UPDATE service_receivable_plans p SET status='approved',approved_by=$2,approved_at=now(),revision=p.revision+1,updated_at=now()
     WHERE p.id=$1 RETURNING ${PLAN_COLS}`, [antes.id, ator(operator)])).rows[0]);
  await client.query(`UPDATE service_installments SET status='scheduled',revision=revision+1,updated_at=now() WHERE plan_id=$1 AND status='planned'`, [antes.id]);
  await registrar(client, antes.id, null, 'plan_approved', antes, depois, operator);
  return { tenant: antes.tenant_id, type: 'service_receivable.plan_approved', body: { plan: { ...depois, installments: await parcelasDe(client, [antes.id]) } } };
 }, { transactional: true });

 // --- cancelar plano ------------------------------------------------------------
 // Rascunho qualquer membro descarta; plano aprovado só o dono cancela, e só se
 // nenhuma parcela tiver cobrança registrada ou pagamento. Aí o caminho é
 // cancelar as parcelas a cobrar, uma a uma, e manter o histórico do que foi pago.
 router.post('/api/service-receivables/plans/:id/cancel', async ({ client, params, body, operator }) => {
  input(body, ['revision', 'reason']);
  const rev = revisao(body), motivo = text(body.reason, 2, 1000);
  await commercialPermission(client, operator, true);
  const antes = await carregarPlano(client, params.id, rev);
  if (antes.status === 'canceled') throw fail(409, 'O plano já está cancelado.');
  if (antes.status === 'approved') await commercialPermission(client, operator, true, true);
  const movimentadas = (await client.query(
   `SELECT count(*)::int AS n FROM service_installments WHERE plan_id=$1 AND status IN ('issued','paid','available')`, [antes.id])).rows[0].n;
  if (movimentadas) throw fail(409, `Há ${movimentadas} parcela(s) com cobrança registrada ou pagamento. Cancele as parcelas a cobrar uma a uma.`);
  const depois = planoDaLinha((await client.query(
   `UPDATE service_receivable_plans p SET status='canceled',canceled_at=now(),cancel_reason=$2,revision=p.revision+1,updated_at=now()
     WHERE p.id=$1 RETURNING ${PLAN_COLS}`, [antes.id, motivo])).rows[0]);
  await client.query(
   `UPDATE service_installments SET status='canceled',canceled_at=now(),cancel_reason=$2,revision=revision+1,updated_at=now()
     WHERE plan_id=$1 AND status IN ('planned','scheduled')`, [antes.id, motivo]);
  await registrar(client, antes.id, null, 'plan_canceled', antes, depois, operator);
  return { tenant: antes.tenant_id, type: 'service_receivable.plan_canceled', body: { plan: { ...depois, installments: await parcelasDe(client, [antes.id]) } } };
 }, { transactional: true });

 // --- ações de parcela: todas do dono -------------------------------------------
 const acaoDeParcela = (acao, campos, executar) =>
  router.post(`/api/service-receivables/installments/:id/${acao}`, async ({ client, params, body, operator }) => {
   await commercialPermission(client, operator, true, true);
   input(body, ['revision', ...campos]);
   const ctx = await carregarParcela(client, params.id, revisao(body));
   const { parcela: antes } = ctx;
   const { depois, action } = await executar({ client, body, ctx, antes });
   await registrar(client, antes.plan_id, antes.id, action, antes, depois, operator);
   return { tenant: ctx.tenant_id, type: `service_receivable.${action}`, body: { installment: depois } };
  }, { transactional: true });

 const exigirManual = ctx => {
  if (ctx.plan_status !== 'approved') throw fail(409, 'O plano ainda não foi aprovado.');
  if (ctx.provider !== 'manual') throw fail(409, 'Esta parcela é de processador integrado: o registro vem do provedor, não da tela.');
 };

 // Cobrança feita fora do Core (Cobre PJ ou outra): guarda a referência e o link.
 acaoDeParcela('issue', ['external_ref', 'external_url'], async ({ client, body, ctx, antes }) => {
  exigirManual(ctx);
  if (ctx.contract_status === 'canceled') throw fail(409, 'O contrato foi cancelado: não registre cobrança nova.');
  if (antes.status !== 'scheduled') throw fail(409, 'Só parcela a cobrar recebe cobrança.');
  const referencia = text(body.external_ref, 2, 200), link = httpsUrl(body.external_url);
  try {
   return {
    action: 'installment_issued',
    depois: await atualizarParcela(client, antes.id, "status='issued',issued_at=now(),external_ref=$2,external_url=$3", [referencia, link]),
   };
  } catch (error) {
   if (error.code === '23505') throw fail(409, 'Essa referência de cobrança já está registrada em outra parcela.');
   throw error;
  }
 });

 // Vencimento só muda antes de haver cobrança: a cobrança externa tem o próprio
 // vencimento. Para mudar depois, cancela-se a parcela e registra-se outra cobrança.
 acaoDeParcela('reschedule', ['due_on'], async ({ client, body, ctx, antes }) => {
  if (ctx.plan_status !== 'approved') throw fail(409, 'O plano ainda não foi aprovado.');
  if (antes.status !== 'scheduled') throw fail(409, 'Só parcela a cobrar, ainda sem cobrança, muda de vencimento.');
  const vencimento = isoDate(body.due_on, 'Vencimento');
  if (vencimento === antes.due_on) throw fail(409, 'O vencimento já é esse.');
  return { action: 'installment_rescheduled', depois: await atualizarParcela(client, antes.id, 'due_on=$2', [vencimento]) };
 });

 // Pagamento confirmado pelo operador. Não é "disponível": o crédito no extrato
 // é outro fato, da conciliação.
 acaoDeParcela('payment', ['paid_on', 'payment_reference'], async ({ client, body, ctx, antes }) => {
  exigirManual(ctx);
  if (!['scheduled', 'issued'].includes(antes.status)) throw fail(409, 'Só parcela a cobrar ou cobrada recebe pagamento.');
  const pagoEm = naoFuturo(body.paid_on, 'Data do pagamento');
  const referencia = body.payment_reference == null || body.payment_reference === '' ? null : text(body.payment_reference, 2, 200);
  return {
   action: 'installment_paid',
   depois: await atualizarParcela(client, antes.id, "status='paid',paid_on=$2,paid_source='manual',payment_reference=$3", [pagoEm, referencia]),
  };
 });

 acaoDeParcela('cancel', ['reason'], async ({ client, body, ctx, antes }) => {
  if (ctx.provider !== 'manual' && antes.status === 'issued')
   throw fail(409, 'Cobrança de processador integrado é cancelada no provedor, não por registro manual.');
  if (!['scheduled', 'issued'].includes(antes.status))
   throw fail(409, antes.status === 'paid' || antes.status === 'available'
    ? 'Parcela paga não é cancelada: estorno é outro registro.'
    : 'Só parcela a cobrar ou cobrada é cancelada.');
  const motivo = text(body.reason, 2, 1000);
  return {
   action: 'installment_canceled',
   depois: await atualizarParcela(client, antes.id, "status='canceled',canceled_at=now(),cancel_reason=$2", [motivo]),
  };
 });

 // NFS-e emitida pela Contabilizei (ADR 0008). Registro único: uma segunda nota
 // para a mesma parcela é justamente o que a decisão quer impedir.
 acaoDeParcela('invoice', ['number', 'issued_on'], async ({ client, body, antes }) => {
  if (!['issued', 'paid', 'available'].includes(antes.status)) throw fail(409, 'Só parcela cobrada ou paga recebe nota fiscal.');
  if (antes.invoice_number) throw fail(409, `Esta parcela já tem a NFS-e ${antes.invoice_number} registrada.`);
  const numero = text(body.number, 1, 60), emitidaEm = naoFuturo(body.issued_on, 'Data de emissão da nota');
  return {
   action: 'invoice_recorded',
   depois: await atualizarParcela(client, antes.id, 'invoice_number=$2,invoice_issued_on=$3,invoice_recorded_at=now()', [numero, emitidaEm]),
  };
 });
}

function httpsUrl(value) {
 if (value == null || value === '') return null;
 if (typeof value !== 'string' || value.length > 1000) throw fail(400, 'Link da cobrança inválido.');
 let url;
 try { url = new URL(value); } catch { throw fail(400, 'Link da cobrança inválido.'); }
 if (url.protocol !== 'https:' || url.username || url.password) throw fail(400, 'O link da cobrança precisa ser https e sem credenciais.');
 return url.href;
}
