// Automações de e-mail: modelo, fila (transactional outbox), consumidor com retentativa e as rotas da tela de Atividade.
import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { renderizar, escaparHtml, ErroDeModelo, VARIAVEIS_DO_LEAD, VARIAVEIS_CONHECIDAS, rodapeDoLead } from '../../apps/api/src/platform/email-modelo.mjs';
import { enfileirar, enfileirarParaLead, MENSAGEM_051 } from '../../apps/api/src/platform/email-saida.mjs';
import { ACTIONS, EVENTOS_COM_LEAD, EVENTS, emitEvent, validateActions } from '../../apps/api/src/platform/automations.mjs';
import { processarFila, ESPERAS_MS, MAX_TENTATIVAS, VALIDADE_MS, emailFilaRoutes } from '../../apps/api/src/modules/email-fila.mjs';
import { ErroDeEmail, enviarEmail } from '../../apps/api/src/platform/email.mjs';

const ENV = { EMAIL_PROVIDER: 'resend', EMAIL_API_KEY: 're_AbCdEf0123456789xyz', EMAIL_FROM: 'Tzolkin <contato@tzolkin.cloud>' };
const OPERADOR = { subject: 'op-1', email: 'gustavo@exemplo.test' };
const corpo = b => ({ headers: { 'content-type': 'application/json' }, async *[Symbol.asyncIterator]() { yield Buffer.from(JSON.stringify(b)); } });
const MODELO = { subject: 'Bem-vindo à {{product_name}}, {{name}}', body: 'Olá {{name}},\n\nrecebemos seu contato pela {{company_name}}.\n\nAbraço', preheader: 'Obrigado, {{name}}' };

// ---------- modelo ----------
test('modelo: troca as variáveis, gera texto e HTML, e o valor é dado (escapado no HTML, sem quebra de linha no assunto)', () => {
 const r = renderizar(MODELO, { name: 'Maria', email: 'm@x.co', product_name: 'Tzolkin', company_name: 'Alfa' }, { rodape: rodapeDoLead('Tzolkin') });
 assert.equal(r.assunto, 'Bem-vindo à Tzolkin, Maria');
 assert.match(r.texto, /^Olá Maria,\n\nrecebemos seu contato pela Alfa\.\n\nAbraço\n\n--\nVocê recebeu este e-mail porque entrou em contato com Tzolkin/);
 assert.match(r.html, /<p style="margin:0 0 14px">Olá Maria,<\/p>/); assert.match(r.html, /Obrigado, Maria<\/span>/);
 // o valor nunca vira marcação nem cabeçalho
 const ruim = renderizar(MODELO, { name: '<img src=x onerror=alert(1)>\r\nBcc: x@y.co', product_name: 'P', company_name: 'C' });
 assert.ok(!ruim.html.includes('<img') && ruim.html.includes('&lt;img'), 'HTML escapado');
 assert.ok(!/[\r\n]/.test(ruim.assunto), 'assunto sem quebra de linha');
 assert.equal(escaparHtml(`<a href="x">&'</a>`), '&lt;a href=&quot;x&quot;&gt;&amp;&#39;&lt;/a&gt;');
});

test('modelo: variável desconhecida ou de outro tipo de e-mail é erro claro, e assunto ou corpo vazios também', () => {
 assert.throws(() => renderizar({ subject: 'Olá {{nome}}', body: 'x' }, {}), e => e instanceof ErroDeModelo && e.status === 400 && /\{\{nome\}\} é desconhecida/.test(e.message));
 assert.throws(() => renderizar({ subject: 'Pagamento {{plan}}', body: 'x' }, { plan: 'Pro' }), e => /\{\{plan\}\} não existe neste tipo de e-mail/.test(e.message) && /\{\{name\}\}/.test(e.message));
 assert.throws(() => renderizar({ subject: '   ', body: 'x' }, {}), /assunto ficou vazio/);
 assert.throws(() => renderizar({ subject: 'ok', body: ' \n ' }, {}), /corpo ficou vazio/);
 assert.deepEqual(VARIAVEIS_CONHECIDAS, ['name', 'email', 'product_name', 'company_name', 'plan', 'amount', 'due_date']);
 assert.deepEqual(VARIAVEIS_DO_LEAD, ['name', 'email', 'product_name', 'company_name']);
 assert.equal(renderizar({ subject: 'A {{ name }}', body: 'B' }, { name: 'x' }).assunto, 'A x', 'espaços dentro das chaves valem');
});

test('o editor e o modelo falam das mesmas variáveis', () => {
 const ui = readFileSync(new URL('../../apps/web/public/product-emails.js', import.meta.url), 'utf8');
 for (const v of ['{{name}}', '{{product_name}}']) assert.ok(ui.includes(v), v);
});

// ---------- ação da automação ----------
test('ação "Enviar e-mail": entra no catálogo, só valida com template e só vale em evento de lead', () => {
 assert.deepEqual(Object.keys(ACTIONS), ['tarefa.criar', 'responsavel.atribuir', 'email.enviar']);
 assert.deepEqual(validateActions([{ action: 'email.enviar', template: 'boas-vindas' }]), [{ action: 'email.enviar', template: 'boas-vindas' }]);
 const falha = a => assert.throws(() => validateActions([a]), e => e.status === 400);
 falha({ action: 'email.enviar' }); falha({ action: 'email.enviar', template: 'Com Espaço' }); falha({ action: 'email.enviar', template: 'ok', para: 'x@y.co' });
 assert.deepEqual([...EVENTOS_COM_LEAD], ['lead.criado', 'lead.mudou_de_etapa', 'lead.qualificado', 'lead.descartado', 'lead.restaurado']);
 for (const e of EVENTOS_COM_LEAD) assert.ok(e in EVENTS);
});

function clienteDeLead({ lead = { email: 'Maria@Exemplo.com', lead_name: 'Maria Souza', company: 'Alfa', product: 'Tzolkin' }, template = { payload: MODELO }, jaNaFila = false, semTabela = false } = {}) {
 const sql = [];
 return {
  sql,
  async query(texto, p = []) {
   sql.push({ texto, p });
   if (texto.startsWith('SAVEPOINT') || texto.startsWith('RELEASE') || texto.startsWith('ROLLBACK')) return { rows: [] };
   if (texto.includes('FROM automations')) return { rows: [{ id: 'auto-1', name: 'Boas-vindas', actions: [{ action: 'email.enviar', template: 'boas-vindas' }] }] };
   if (texto.includes('FROM commercial_leads l')) return { rows: lead ? [lead] : [] };
   if (texto.includes('FROM email_templates')) return { rows: template ? [template] : [] };
   if (texto.startsWith('INSERT INTO email_outbox')) { if (semTabela) throw Object.assign(new Error('relation'), { code: '42P01' }); return { rows: jaNaFila ? [] : [{ id: 'mail-1' }] }; }
   if (texto.startsWith('INSERT INTO automation_runs')) return { rows: [] };
   return { rows: [] };
  },
 };
}
const rodar = c => emitEvent(c, 'lead.criado', { spaceId: 'sites', tenantId: 't1', leadId: 'l1' });
const run = c => c.sql.find(q => q.texto.startsWith('INSERT INTO automation_runs')).p;

test('automação de lead: renderiza com os dados do lead e ENFILEIRA na mesma transação (não envia)', async () => {
 const c = clienteDeLead();
 assert.equal(await rodar(c), 1);
 const ins = c.sql.find(q => q.texto.startsWith('INSERT INTO email_outbox'));
 const [chave, tipo, produto, modelo, evento, automacao, lead, para, nome, assunto, texto, html, por] = ins.p;
 assert.equal(chave, 'auto:auto-1:lead.criado:l1:boas-vindas', 'uma vez por automação, evento, lead e template');
 assert.deepEqual([tipo, produto, modelo, evento, automacao, lead, por], ['automacao', 'sites', 'boas-vindas', 'lead.criado', 'auto-1', 'l1', 'automacao']);
 assert.deepEqual([para, nome], ['maria@exemplo.com', 'Maria Souza'], 'endereço em minúsculas');
 assert.equal(assunto, 'Bem-vindo à Tzolkin, Maria Souza');
 assert.match(texto, /Olá Maria Souza,/); assert.match(texto, /Para não receber mais mensagens, responda este e-mail/); assert.match(html, /<p style=/);
 assert.equal(run(c)[5], 'OK'); assert.match(run(c)[6], /E-mail "Bem-vindo à Tzolkin, Maria Souza" na fila para maria@exemplo\.com/);
 assert.ok(!c.sql.some(q => /fetch|resend/i.test(q.texto)), 'a automação não fala com o provedor');
});

test('automação de lead: reentrega não enfileira de novo; lead sem e-mail, template que não existe e variável errada viram FAILED claro', async () => {
 const dup = clienteDeLead({ jaNaFila: true });
 await rodar(dup);
 assert.match(run(dup)[6], /já estava na fila/); assert.equal(run(dup)[5], 'OK');
 const semEmail = clienteDeLead({ lead: { email: null, lead_name: 'Ana', company: 'A', product: 'P' } });
 await rodar(semEmail);
 assert.equal(run(semEmail)[5], 'FAILED'); assert.match(run(semEmail)[6], /não tem um e-mail válido/);
 assert.ok(!semEmail.sql.some(q => q.texto.startsWith('INSERT INTO email_outbox')));
 const semModelo = clienteDeLead({ template: null });
 await rodar(semModelo);
 assert.match(run(semModelo)[6], /template "boas-vindas" não existe/);
 const variavelErrada = clienteDeLead({ template: { payload: { subject: 'Plano {{plan}}', body: 'x' } } });
 await rodar(variavelErrada);
 assert.equal(run(variavelErrada)[5], 'FAILED'); assert.match(run(variavelErrada)[6], /\{\{plan\}\} não existe neste tipo de e-mail/);
 const antiga = clienteDeLead({ semTabela: true });
 await rodar(antiga);
 assert.equal(run(antiga)[5], 'FAILED'); assert.equal(run(antiga)[6], MENSAGEM_051);
 await assert.rejects(enfileirarParaLead(clienteDeLead({ lead: null }), { modelo: 'x', spaceId: 'sites', leadId: 'l', automationId: 'a', evento: 'lead.criado' }), /Lead não encontrado/);
 // sem lead no evento (oportunidade): não faz sentido
 const semLead = clienteDeLead();
 await emitEvent(semLead, 'oportunidade.ganha', { spaceId: 'sites', tenantId: 't1', opportunityId: 'o1' });
 assert.match(run(semLead)[6], /só funciona em evento de lead/);
});

// ---------- consumidor da fila ----------
function bancoDaFila({ pegos = [], suprimidos = [], expirados = 0, presos = 0, semTabela = false } = {}) {
 const log = [];
 return {
  log,
  async query(sql, p = []) {
   log.push({ sql, p });
   if (semTabela) throw Object.assign(new Error('relation'), { code: '42P01' });
   if (sql.includes("status='sending' AND locked_at <")) return { rows: [], rowCount: presos };
   if (sql.includes("SET status='cancelled'") && sql.includes('created_at <')) return { rows: [], rowCount: expirados };
   if (sql.includes("SET status='sending'")) return { rows: pegos };
   if (sql.includes('FROM email_suppressions')) return { rows: suprimidos.includes(p[0]) ? [{}] : [] };
   return { rows: [], rowCount: 1 };
  },
 };
}
const atualizacoes = (db, trecho) => db.log.filter(q => q.sql.includes(trecho));
const msg = (id, to = 'a@b.co', attempts = 1) => ({ id, to_email: to, subject: 'Assunto', body_text: 'texto', body_html: '<p>html</p>', attempts });

test('fila: envia o lote, marca enviado com o id do provedor e respeita o tamanho do lote', async () => {
 const db = bancoDaFila({ pegos: [msg('m1'), msg('m2')] });
 const enviados = [];
 const r = await processarFila(db, { env: ENV, lote: 10, agora: () => 1000000, enviar: async x => { enviados.push(x); return { id: 'prov-' + x.para.length }; } });
 assert.equal(r.enviados, 2);
 assert.deepEqual(enviados.map(x => [x.para, x.assunto, x.texto, x.html]), [['a@b.co', 'Assunto', 'texto', '<p>html</p>'], ['a@b.co', 'Assunto', 'texto', '<p>html</p>']]);
 assert.equal(atualizacoes(db, "status='sent'").length, 2);
 const reserva = db.log.find(q => q.sql.includes("SET status='sending'"));
 assert.equal(reserva.p[0], 10, 'o lote limita o ritmo'); assert.match(reserva.sql, /FOR UPDATE SKIP LOCKED/);
});

test('fila: falha do provedor (5xx) tenta de novo com espera crescente; recusa (422) e esgotamento viram "falhou" com o motivo', async () => {
 const agora = () => 5000000;
 const rede = async () => { throw new ErroDeEmail('O Resend não respondeu como esperado.', 502); };
 for (const [tentativa, esperaMs] of [[1, 60000], [2, 300000], [3, 1800000], [4, 7200000]]) {
  const db = bancoDaFila({ pegos: [msg('m1', 'a@b.co', tentativa)] });
  const r = await processarFila(db, { env: ENV, agora, enviar: rede });
  assert.equal(r.adiados, 1, `tentativa ${tentativa}`);
  const up = atualizacoes(db, "status='queued', locked_at=NULL, next_attempt_at")[0];
  assert.equal(up.p[1], new Date(agora() + esperaMs).toISOString(), `espera depois da tentativa ${tentativa}`);
  assert.match(up.p[2], /não respondeu/);
 }
 assert.deepEqual([...ESPERAS_MS], [60000, 300000, 1800000, 7200000]);
 const esgotado = bancoDaFila({ pegos: [msg('m1', 'a@b.co', MAX_TENTATIVAS)] });
 assert.equal((await processarFila(esgotado, { env: ENV, agora, enviar: rede })).falhas, 1, 'na última tentativa não agenda de novo');
 const recusa = bancoDaFila({ pegos: [msg('m1', 'a@b.co', 1)] });
 const r = await processarFila(recusa, { env: ENV, agora, enviar: async () => { throw new ErroDeEmail('O Resend não enviou: The tzolkin.cloud domain is not verified.', 422); } });
 assert.equal(r.falhas, 1); assert.equal(r.adiados, 0, 'recusa do provedor não adianta insistir');
 assert.match(atualizacoes(recusa, "status='failed'")[0].p[1], /domain is not verified/);
 const inesperado = bancoDaFila({ pegos: [msg('m1')] });
 assert.equal((await processarFila(inesperado, { env: ENV, agora, enviar: async () => { throw new Error('socket hang up'); } })).adiados, 1, 'erro de rede também tenta de novo');
});

test('fila: endereço suprimido não recebe; reserva presa volta; passou de 48 h cancela; sem e-mail configurado não envia, mas ainda expira', async () => {
 const db = bancoDaFila({ pegos: [msg('m1', 'fora@b.co'), msg('m2', 'ok@b.co')], suprimidos: ['fora@b.co'], presos: 2, expirados: 3 });
 const para = [];
 const r = await processarFila(db, { env: ENV, agora: () => 9000000, enviar: async x => { para.push(x.para); return { id: 'x' }; } });
 assert.deepEqual([r.suprimidos, r.enviados, r.reenfileirados, r.expirados], [1, 1, 2, 3]);
 assert.deepEqual(para, ['ok@b.co'], 'o suprimido nunca chegou ao provedor');
 assert.match(atualizacoes(db, "status='suppressed'")[0].p[0], /m1/);
 assert.equal(VALIDADE_MS, 48 * 3600000);
 const presa = db.log.find(q => q.sql.includes("status='sending' AND locked_at <"));
 assert.equal(presa.p[0], new Date(9000000 - 5 * 60000).toISOString());
 const exp = db.log.find(q => q.sql.includes('created_at <') && q.sql.includes("'cancelled'"));
 assert.equal(exp.p[0], new Date(9000000 - VALIDADE_MS).toISOString()); assert.match(exp.sql, /kind='automacao'/, 'e-mail de teste não expira por aqui');
 // sem configuração: não reserva nada
 const sem = bancoDaFila({ pegos: [msg('m1')], expirados: 1 });
 const s = await processarFila(sem, { env: {}, enviar: async () => assert.fail('não pode enviar') });
 assert.deepEqual([s.desligado, s.expirados, s.enviados], [true, 1, 0]);
 assert.ok(!sem.log.some(q => q.sql.includes("SET status='sending'")));
});

test('fila: migração 051 ausente e erro de banco não derrubam o ciclo', async () => {
 assert.equal((await processarFila(bancoDaFila({ semTabela: true }), { env: ENV })).indisponivel, true);
 const quebrado = { async query() { throw new Error('banco fora'); } };
 const silencio = console.error; console.error = () => {};
 try { assert.equal((await processarFila(quebrado, { env: ENV })).erro, true); } finally { console.error = silencio; }
});

// ---------- rotas ----------
function montar({ env = ENV, db = {}, fetchImpl = async () => ({ ok: true, status: 200, json: async () => ({ id: 'em_1' }) }), agora = 1000 } = {}) {
 const rotas = {}, regs = {}; let t = agora;
 const reg = m => (p, h, o) => { rotas[`${m} ${p}`] = h; regs[`${m} ${p}`] = o; };
 emailFilaRoutes({ get: reg('GET'), post: reg('POST'), put: reg('PUT') }, { env, fetchImpl, clock: () => t });
 const log = [];
 const q = async (sql, params = []) => {
  log.push({ sql, params });
  for (const [trecho, fn] of Object.entries(db)) if (sql.includes(trecho)) { const r = fn(params, sql); if (r instanceof Error) throw r; return r; }
  return { rows: [], rowCount: 0 };
 };
 return { rotas, regs, log, pool: { query: q }, client: { query: q }, avancar: ms => { t += ms; } };
}
const reply = () => { const s = {}; return { fn: (st, c) => { s.status = st; s.corpo = c; }, s }; };
const dbModelo = { 'FROM products': () => ({ rows: [{ name: 'Tzolkin' }] }), 'FROM email_templates': () => ({ rows: [{ payload: MODELO }] }) };

test('rotas: pré-visualização renderiza com dados de exemplo e não envia nada; variável errada vira 400', async () => {
 const m = montar({ db: dbModelo, fetchImpl: async () => assert.fail('preview não envia') });
 const r = reply();
 await m.rotas['POST /api/emails/preview']({ pool: m.pool, req: corpo({ product_id: 'sites', slug: 'boas-vindas' }), reply: r.fn });
 assert.equal(r.s.corpo.assunto, 'Bem-vindo à Tzolkin, Maria Souza'); assert.match(r.s.corpo.texto, /recebemos seu contato pela Empresa Exemplo/);
 assert.deepEqual(r.s.corpo.variaveis, ['name', 'email', 'product_name', 'company_name']);
 assert.ok(!('html' in r.s.corpo), 'a tela só mostra texto');
 const ruim = montar({ db: { ...dbModelo, 'FROM email_templates': () => ({ rows: [{ payload: { subject: 'x {{plan}}', body: 'y' } }] }) } });
 await assert.rejects(ruim.rotas['POST /api/emails/preview']({ pool: ruim.pool, req: corpo({ product_id: 'sites', slug: 'boas-vindas' }), reply: reply().fn }), e => e.status === 400 && /\{\{plan\}\}/.test(e.message));
 const semModelo = montar({ db: { 'FROM products': () => ({ rows: [{ name: 'T' }] }) } });
 await assert.rejects(semModelo.rotas['POST /api/emails/preview']({ pool: semModelo.pool, req: corpo({ product_id: 'sites', slug: 'nao-existe' }), reply: reply().fn }), e => e.status === 404);
 await assert.rejects(m.rotas['POST /api/emails/preview']({ pool: m.pool, req: corpo({ product_id: 'Sites!', slug: 'x' }), reply: reply().fn }), e => e.status === 400);
});

test('rotas: teste manda o modelo SÓ para o operador, marcado [Teste], com limite de 30 s', async () => {
 const enviados = [];
 const m = montar({ db: dbModelo, fetchImpl: async (url, o) => { enviados.push(JSON.parse(o.body)); return { ok: true, status: 200, json: async () => ({ id: 'em_1' }) }; } });
 const chamar = () => { const r = reply(); return m.rotas['POST /api/emails/teste']({ pool: m.pool, req: corpo({ product_id: 'sites', slug: 'boas-vindas' }), reply: r.fn, operator: OPERADOR }).then(() => r.s); };
 const r = await chamar();
 assert.equal(r.status, 200); assert.equal(r.corpo.para, 'gustavo@exemplo.test');
 assert.deepEqual(enviados[0].to, ['gustavo@exemplo.test']); assert.equal(enviados[0].subject, '[Teste] Bem-vindo à Tzolkin, Maria Souza');
 assert.ok(enviados[0].html.includes('<p style='), 'o teste leva o HTML');
 await assert.rejects(chamar(), e => e.status === 429);
 m.avancar(31000);
 assert.equal((await chamar()).status, 200);
 await assert.rejects(m.rotas['POST /api/emails/teste']({ pool: m.pool, req: corpo({ product_id: 'sites', slug: 'boas-vindas' }), reply: reply().fn, operator: { subject: 'x' } }), e => e.status === 409);
 const semConfig = montar({ env: {}, db: dbModelo });
 await assert.rejects(semConfig.rotas['POST /api/emails/teste']({ pool: semConfig.pool, req: corpo({ product_id: 'sites', slug: 'boas-vindas' }), reply: reply().fn, operator: OPERADOR }), e => e.status === 503);
});

test('rotas: atividade lista a fila com contagens; sem a 051 explica; supressão tira da fila; reenviar só o que falhou', async () => {
 const m = montar({ db: {
  'FROM email_outbox ORDER BY': () => ({ rows: [{ id: 'm1', kind: 'automacao', to_email: 'a@b.co', subject: 'Oi', status: 'sent' }] }),
  'GROUP BY status': () => ({ rows: [{ status: 'sent', n: 4 }, { status: 'failed', n: 1 }] }),
  'FROM email_suppressions': () => ({ rows: [{ n: 2 }] }),
 } });
 const r = reply();
 await m.rotas['GET /api/emails/outbox']({ pool: m.pool, reply: r.fn });
 assert.deepEqual([r.s.corpo.disponivel, r.s.corpo.envio_configurado, r.s.corpo.contagem, r.s.corpo.suprimidos], [true, true, { sent: 4, failed: 1 }, 2]);
 assert.ok(!JSON.stringify(r.s.corpo).includes('body_text'), 'a lista não traz o corpo');
 const antiga = montar({ db: { email_outbox: () => Object.assign(new Error('relation'), { code: '42P01' }) } });
 const a = reply(); await antiga.rotas['GET /api/emails/outbox']({ pool: antiga.pool, reply: a.fn });
 assert.equal(a.s.corpo.disponivel, false);
 // supressão
 const s = montar({ db: { "UPDATE email_outbox SET status='suppressed'": () => ({ rowCount: 3, rows: [] }) } });
 const sup = await s.rotas['POST /api/emails/suppress']({ client: s.client, body: { email: 'Fora@Exemplo.com', reason: 'pediu_para_sair' }, operator: OPERADOR });
 assert.deepEqual(sup.response, { ok: true, email: 'fora@exemplo.com', tirados_da_fila: 3 });
 assert.equal(s.log[0].params[0], 'fora@exemplo.com'); assert.equal(s.regs['POST /api/emails/suppress'].transactional, true);
 await assert.rejects(s.rotas['POST /api/emails/suppress']({ client: s.client, body: { email: 'sem-arroba' }, operator: OPERADOR }), e => e.status === 400);
 await assert.rejects(s.rotas['POST /api/emails/suppress']({ client: s.client, body: { email: 'a@b.co', reason: 'porque sim' }, operator: OPERADOR }), e => e.status === 400);
 // reenviar
 const id = '00000000-0000-4000-8000-000000000001';
 const re = montar({ db: { "SET status='queued', attempts=0": () => ({ rowCount: 1, rows: [{ id }] }) } });
 assert.deepEqual((await re.rotas['POST /api/emails/outbox/:id/reenviar']({ client: re.client, params: { id } })).response, { ok: true });
 const nao = montar();
 await assert.rejects(nao.rotas['POST /api/emails/outbox/:id/reenviar']({ client: nao.client, params: { id } }), e => e.status === 409 && /falhou/.test(e.message));
 await assert.rejects(nao.rotas['POST /api/emails/outbox/:id/reenviar']({ client: nao.client, params: { id: 'x' } }), e => e.status === 400);
});

test('enfileirar é idempotente pela chave; enviarEmail leva o HTML quando há', async () => {
 const c = { async query(sql, p) { c.ultimo = p; return { rows: c.dup ? [] : [{ id: 'novo' }] }; } };
 assert.deepEqual(await enfileirar(c, { chave: 'k'.repeat(10), para: 'a@b.co', assunto: 'a', texto: 'b', html: '<p>b</p>' }), { criado: true, id: 'novo' });
 c.dup = true;
 assert.deepEqual(await enfileirar(c, { chave: 'k'.repeat(10), para: 'a@b.co', assunto: 'a', texto: 'b', html: '<p>b</p>' }), { criado: false, id: null });
 let corpoEnviado;
 await enviarEmail({ env: ENV, para: 'a@b.co', assunto: 'x', texto: 'y', html: '<p>y</p>', fetchImpl: async (u, o) => { corpoEnviado = JSON.parse(o.body); return { ok: true, status: 200, json: async () => ({ id: 'e' }) }; } });
 assert.equal(corpoEnviado.html, '<p>y</p>');
});

test('migração 051 e a fiação: fila única por chave, supressão ativa única, nada de DROP; o consumidor liga em produção e não em desenvolvimento', () => {
 const sql = readFileSync(new URL('../../db/migrations/051_fila_de_email.sql', import.meta.url), 'utf8').replace(/--.*$/gm, '');
 assert.ok(!/\bDROP\b|\bDELETE\b|\bTRUNCATE\b/i.test(sql));
 assert.match(sql, /idempotency_key text NOT NULL UNIQUE/);
 assert.match(sql, /UNIQUE INDEX IF NOT EXISTS email_suppressions_ativa ON email_suppressions \(email\) WHERE revoked_at IS NULL/);
 for (const st of ['queued', 'sending', 'sent', 'failed', 'cancelled', 'suppressed']) assert.ok(sql.includes(`'${st}'`), st);
 const app = readFileSync(new URL('../../apps/api/src/app.mjs', import.meta.url), 'utf8');
 const prod = readFileSync(new URL('../../apps/api/src/production.mjs', import.meta.url), 'utf8');
 const dev = readFileSync(new URL('../../apps/api/src/server.mjs', import.meta.url), 'utf8');
 assert.match(app, /emailFilaRoutes\(router/); assert.match(prod, /iniciarFilaDeEmail\(\{pool\}\)/);
 assert.match(dev, /AGENDA_JOBS === '1' \? iniciarFilaDeEmail/, 'em desenvolvimento só com a chave ligada (o .env aponta para o banco compartilhado)');
});
