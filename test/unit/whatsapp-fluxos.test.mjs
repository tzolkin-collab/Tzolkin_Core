import test from 'node:test';
import assert from 'node:assert/strict';
import { validarFluxo, validarDados, iniciarFluxo, variaveisDoFluxoInvalidas, JANELA_FINAL_MIN } from '../../apps/api/src/platform/fluxos.mjs';
import { processarFluxos } from '../../apps/api/src/modules/whatsapp-fluxos.mjs';
import { validateActions } from '../../apps/api/src/platform/automations.mjs';

const FLUXO = '11111111-1111-4111-8111-111111111111', LEAD = '22222222-2222-4222-8222-222222222222', AUTO = '33333333-3333-4333-8333-333333333333';
const T0 = Date.parse('2026-10-26T12:00:00Z');
const min = n => n * 60000;
const msg = texto => ({ tipo: 'mensagem', texto });
const espera = minutos => ({ tipo: 'espera', minutos });

// ---------- validação ----------
test('validarFluxo: aceita o fluxo certo e normaliza', () => {
 const f = validarFluxo({ space_id: 'sites', name: '  Boas-vindas corretor ', steps: [msg('Oi, {{first_name}}!'), espera(10), msg('Interesse: {{dados.interesse}}')] });
 assert.deepEqual(f, { name: 'Boas-vindas corretor', status: 'rascunho', stop_on_reply: true, instance: null, gatilho: null, steps: [msg('Oi, {{first_name}}!'), espera(10), msg('Interesse: {{dados.interesse}}')] });
 assert.equal(validarFluxo({ name: 'ok ok', status: 'ativo', stop_on_reply: false, instance: 'teste', steps: [msg('oi oi')] }).instance, 'teste');
});

test('validarFluxo: recusa o que quebraria na hora de rodar, com a mensagem para a tela', () => {
 const base = { name: 'Fluxo', steps: [msg('Olá, tudo bem?')] };
 const erro = (corpo, re) => assert.throws(() => validarFluxo(corpo), e => e.status === 400 && re.test(e.message), JSON.stringify(corpo).slice(0, 80));
 erro({ ...base, steps: [] }, /1 a 20 passos/);
 erro({ ...base, steps: Array.from({ length: 21 }, () => msg('olá olá')) }, /1 a 20 passos/);
 erro({ ...base, steps: [espera(5)] }, /pelo menos uma mensagem/);
 erro({ ...base, steps: [msg('Oi, tudo bem?'), espera(5)] }, /não pode terminar numa espera/);
 erro({ ...base, steps: [msg('Oi {{inexistente}}')] }, /Variável desconhecida no passo 1: \{\{inexistente\}\}/);
 erro({ ...base, steps: [msg('Oi {{dados.com espaço}}')] }, /Variável desconhecida/);
 erro({ ...base, steps: [msg('oi oi'), espera(0), msg('oi oi')] }, /espera do passo 2/);
 erro({ ...base, steps: [msg('oi oi'), espera(43201), msg('oi oi')] }, /espera do passo 2/);
 erro({ ...base, steps: [msg('oi oi'), espera(1.5), msg('oi oi')] }, /espera do passo 2/);
 erro({ ...base, steps: [{ tipo: 'audio' }] }, /tipo desconhecido/);
 erro({ ...base, steps: [{ tipo: 'mensagem', texto: 'oi oi', extra: 1 }] }, /./);
 erro({ ...base, steps: [msg('x'.repeat(1001))] }, /./);
 erro({ ...base, steps: ['texto solto'] }, /Passo 1 inválido/);
 erro({ ...base, status: 'voando' }, /Situação/);
 erro({ ...base, stop_on_reply: 'sim' }, /parar quando a pessoa responde/);
 erro({ ...base, instance: 'nome ruim!' }, /Instância inválida/);
 erro({ ...base, name: 'a' }, /./);
 erro({ ...base, intruso: 1 }, /./);
});

test('variaveisDoFluxoInvalidas: as do lead e {{dados.chave}} valem; o resto não', () => {
 assert.deepEqual(variaveisDoFluxoInvalidas('Oi {{name}} {{ first_name }} {{dados.foco}} {{dados.interesse_2}}'), []);
 assert.deepEqual(variaveisDoFluxoInvalidas('{{foco}} {{dados.}} {{dados.1x}} {{Name}}'), ['foco', 'dados.', 'dados.1x', 'Name']);
});

test('validarDados: chaves simples, valores curtos, no máximo 10', () => {
 assert.deepEqual(validarDados(undefined), {});
 assert.deepEqual(validarDados({ foco: ' Lançamento ', vip: true, n: 3 }), { foco: 'Lançamento', vip: 'true', n: '3' });
 for (const ruim of ['x', [], { 'chave ruim': 'a' }, { '1a': 'a' }, { a: { b: 1 } }, { a: 'x'.repeat(201) }, Object.fromEntries(Array.from({ length: 11 }, (_, i) => [`k${i}`, 'v']))])
  assert.throws(() => validarDados(ruim), e => e.status === 400, JSON.stringify(ruim).slice(0, 40));
});

test('ação "Iniciar fluxo" nas automações: valida o fluxo e os dados, e o catálogo de eventos de fluxo existe', () => {
 assert.deepEqual(validateActions([{ action: 'fluxo.iniciar', flow_id: FLUXO, dados: { foco: 'Lançamento' } }]), [{ action: 'fluxo.iniciar', flow_id: FLUXO, dados: { foco: 'Lançamento' } }]);
 assert.deepEqual(validateActions([{ action: 'fluxo.iniciar', flow_id: FLUXO }])[0].dados, {});
 for (const ruim of [{ action: 'fluxo.iniciar' }, { action: 'fluxo.iniciar', flow_id: 'x' }, { action: 'fluxo.iniciar', flow_id: FLUXO, dados: 'x' }, { action: 'fluxo.iniciar', flow_id: FLUXO, extra: 1 }])
  assert.throws(() => validateActions([ruim]), e => e.status === 400);
});

// ---------- banco de mentira: modela só as consultas que o motor faz ----------
function banco({ fluxo = null, lead = { email: 'a@b.co', whatsapp: '5531997599216', lead_name: 'Marina Duarte', phone: null, company: 'Marina', product: 'Sites' }, inbox = [], suprimidos = [], falharAoEnfileirar = false } = {}) {
 const s = { runs: [], outbox: [], eventos: [], transacoes: [], sql: [] };
 if (fluxo) s.fluxo = fluxo;
 const para = r => ({ ...r });
 const aplicar = (r, campos, params) => { for (const m of campos.matchAll(/(\w+)=\$(\d+)/g)) r[m[1]] = params[Number(m[2]) - 1]; };
 async function query(sql, p = []) {
  s.sql.push(sql);
  if (/^\s*(BEGIN|COMMIT|ROLLBACK)/.test(sql)) { s.transacoes.push(sql.trim()); return { rows: [] }; }
  if (/FROM whatsapp_flows WHERE id=/.test(sql)) return { rows: s.fluxo && s.fluxo.id === p[0] ? [para(s.fluxo)] : [] };
  if (/^\s*INSERT INTO whatsapp_flow_runs/.test(sql)) {
   if (s.runs.some(r => r.idempotency_key === p[4])) return { rows: [] };
   const r = { id: `run-${s.runs.length + 1}`, flow_id: p[0], space_id: p[1], lead_id: p[2], automation_id: p[3], idempotency_key: p[4], number: p[5], instance: p[6], steps: JSON.parse(p[7]), stop_on_reply: p[8], dry_run: p[9], input: JSON.parse(p[10]),
    step: 0, status: 'running', outcome: null, run_after: new Date(T0).toISOString(), started_at: new Date(T0).toISOString(), last_sent_at: null, locked_at: null, attempts: 0, log: [] };
   s.runs.push(r); return { rows: [{ id: r.id }] };
  }
  if (/^\s*SELECT l\.email, l\.whatsapp/.test(sql)) return { rows: lead ? [lead] : [] };
  if (/^\s*UPDATE whatsapp_flow_runs SET locked_at=\$2, attempts=attempts\+1/.test(sql)) {
   const [lote, agora, presas] = p;
   const alvo = s.runs.filter(r => r.status === 'running' && r.run_after <= agora && (!r.locked_at || r.locked_at < presas)).sort((a, b) => a.run_after.localeCompare(b.run_after)).slice(0, lote);
   for (const r of alvo) { r.locked_at = agora; r.attempts += 1; }
   return { rows: alvo.map(para) };
  }
  if (/log=\$2::jsonb, attempts=0, locked_at=NULL WHERE id=\$1/.test(sql)) {
   const r = s.runs.find(x => x.id === p[0]); const campos = sql.match(/SET (.*), log=\$2::jsonb, attempts=0/)[1];
   aplicar(r, campos, p); r.log = JSON.parse(p[1]); r.attempts = 0; r.locked_at = null; return { rows: [] };
  }
  if (/outcome=CASE WHEN attempts >= \$3/.test(sql)) {
   const r = s.runs.find(x => x.id === p[0]); r.locked_at = null; r.run_after = p[1]; r.log = JSON.parse(p[4]);
   if (r.attempts >= p[2]) { r.status = 'failed'; r.outcome = 'erro'; r.finished_at = p[3]; }
   return { rows: [] };
  }
  if (/FROM whatsapp_inbox/.test(sql)) return { rows: inbox.some(m => m.from.endsWith(p[0]) && m.em > p[1]) ? [{}] : [] };
  if (/FROM whatsapp_suppressions/.test(sql)) return { rows: suprimidos.includes(p[0]) ? [{}] : [] };
  if (/SELECT name FROM products/.test(sql)) return { rows: [{ name: 'Sites' }] };
  if (/^\s*INSERT INTO whatsapp_outbox/.test(sql)) {
   if (falharAoEnfileirar) throw new Error('banco indisponível');
   if (s.outbox.some(o => o.chave === p[0])) return { rows: [] };
   s.outbox.push({ chave: p[0], tipo: p[1], para: p[6], nome: p[7], texto: p[8], por: p[9], instancia: p[10], lead: p[5], evento: p[3] }); return { rows: [{ id: `o${s.outbox.length}` }] };
  }
  if (/FROM commercial_leads WHERE id=\$1/.test(sql)) return { rows: [{ tenant_id: 'tenant-1', pipeline_id: 'funil-1', stage_id: 'etapa-1' }] };
  throw new Error('consulta não modelada: ' + sql.slice(0, 80));
 }
 const client = { query, release() {} };
 s.pool = { query, async connect() { return client; } };
 s.client = client;
 s.emitir = async (c, evento, ctx) => { s.eventos.push({ evento, ctx }); };
 return s;
}
const fluxo = (extra = {}) => ({ id: FLUXO, space_id: 'sites', name: 'Boas-vindas', status: 'ativo', stop_on_reply: true, instance: null, steps: [msg('Oi, {{first_name}}! Vi seu interesse em {{dados.interesse}}.'), espera(60), msg('Posso ajudar com algo?')], ...extra });
const ciclo = (s, quando, extra = {}) => processarFluxos(s.pool, { env: { EVOLUTION_INSTANCE: 'teste' }, agora: () => quando, criarAdaptador: () => ({ configured: false }), emitir: s.emitir, ...extra });

// ---------- iniciar ----------
test('iniciarFluxo: grava a execução com a cópia dos passos, o número do lead e os dados; o mesmo evento não entra duas vezes', async () => {
 const s = banco({ fluxo: fluxo() });
 const dados = { interesse: 'lançamento' };
 const r1 = await iniciarFluxo(s.client, { flowId: FLUXO, spaceId: 'sites', leadId: LEAD, automationId: AUTO, evento: 'lead.criado', dados });
 assert.match(r1, /Fluxo "Boas-vindas" iniciado para 5531997599216$/);
 assert.equal(s.runs.length, 1);
 assert.deepEqual({ n: s.runs[0].number, passos: s.runs[0].steps.length, dry: s.runs[0].dry_run, input: s.runs[0].input, lead: s.runs[0].lead_id }, { n: '5531997599216', passos: 3, dry: false, input: dados, lead: LEAD });
 assert.match(await iniciarFluxo(s.client, { flowId: FLUXO, spaceId: 'sites', leadId: LEAD, automationId: AUTO, evento: 'lead.criado', dados }), /já estava rodando/);
 assert.equal(s.runs.length, 1);
});

test('iniciarFluxo: recusa rascunho, arquivado, outro espaço, fluxo inexistente, lead sem WhatsApp e número ruim; teste marca dry_run', async () => {
 const base = { flowId: FLUXO, spaceId: 'sites', leadId: LEAD, automationId: AUTO, evento: 'lead.criado' };
 await assert.rejects(iniciarFluxo(banco({ fluxo: fluxo({ status: 'rascunho' }) }).client, base), /está em rascunho/);
 await assert.rejects(iniciarFluxo(banco({ fluxo: fluxo({ status: 'arquivado' }) }).client, base), /arquivado/);
 await assert.rejects(iniciarFluxo(banco({ fluxo: fluxo() }).client, { ...base, spaceId: 'outro' }), /não existe neste espaço/);
 await assert.rejects(iniciarFluxo(banco().client, base), /não existe neste espaço/);
 await assert.rejects(iniciarFluxo(banco({ fluxo: fluxo(), lead: { email: '', whatsapp: '', lead_name: 'X', phone: null, company: 'x', product: 'Sites' } }).client, base), /não tem um WhatsApp válido/);
 await assert.rejects(iniciarFluxo(banco({ fluxo: fluxo() }).client, { flowId: FLUXO, spaceId: 'sites', numero: '123', evento: 'manual' }), /número de WhatsApp válido/);
 await assert.rejects(iniciarFluxo(banco({ fluxo: fluxo() }).client, { ...base, flowId: 'x' }), /Fluxo inválido/);
 const t = banco({ fluxo: fluxo({ status: 'teste' }) });
 assert.match(await iniciarFluxo(t.client, base), /modo de teste: nada será enviado/);
 assert.equal(t.runs[0].dry_run, true);
 const manual = banco({ fluxo: fluxo() });
 await iniciarFluxo(manual.client, { flowId: FLUXO, spaceId: 'sites', numero: '(31) 99759-9216', nome: 'Gustavo', evento: 'manual', chave: 'fluxo:manual:abc' });
 assert.equal(manual.runs[0].number, '5531997599216');
 assert.equal(manual.runs[0].lead_id, null);
});

// ---------- andar ----------
test('o fluxo anda: manda a 1ª mensagem, espera 60 min, manda a 2ª, observa 24 h e dá o resultado "sem resposta" (e emite o evento)', async () => {
 const s = banco({ fluxo: fluxo() });
 await iniciarFluxo(s.client, { flowId: FLUXO, spaceId: 'sites', leadId: LEAD, automationId: AUTO, evento: 'lead.criado', dados: { interesse: 'lançamento' } });
 let r = await ciclo(s, T0);
 assert.equal(r.andaram, 1);
 assert.deepEqual(s.outbox.map(o => o.texto), ['Oi, Marina! Vi seu interesse em lançamento.'], 'só a 1ª mensagem, com o nome e o dado da automação');
 assert.equal(s.outbox[0].chave, 'fluxo:run-1:0');
 assert.deepEqual({ tipo: s.outbox[0].tipo, para: s.outbox[0].para, evento: s.outbox[0].evento, lead: s.outbox[0].lead }, { tipo: 'lead', para: '5531997599216', evento: 'fluxo', lead: LEAD });
 assert.equal(s.runs[0].step, 2);
 assert.equal(s.runs[0].run_after, new Date(T0 + min(60)).toISOString());
 r = await ciclo(s, T0 + min(30));
 assert.equal(r.andaram, 0, 'ainda esperando: nada anda');
 r = await ciclo(s, T0 + min(61));
 assert.deepEqual(s.outbox.map(o => o.texto).slice(1), ['Posso ajudar com algo?']);
 assert.equal(s.runs[0].status, 'running');
 assert.equal(s.runs[0].step, 3);
 assert.equal(s.runs[0].run_after, new Date(T0 + min(61) + min(JANELA_FINAL_MIN)).toISOString(), 'janela final de 24 h depois da última mensagem');
 assert.equal(s.eventos.length, 0);
 r = await ciclo(s, T0 + min(61) + min(JANELA_FINAL_MIN) + 1000);
 assert.equal(r.sem_resposta, 1);
 assert.deepEqual({ status: s.runs[0].status, outcome: s.runs[0].outcome }, { status: 'done', outcome: 'sem_resposta' });
 assert.deepEqual(s.eventos, [{ evento: 'fluxo.sem_resposta', ctx: { spaceId: 'sites', tenantId: 'tenant-1', leadId: LEAD, pipelineId: 'funil-1', stageId: 'etapa-1' } }]);
 assert.equal(s.outbox.length, 2, 'nenhuma mensagem a mais');
 assert.ok(s.runs[0].log.length >= 4);
 assert.equal(s.transacoes.filter(x => x === 'BEGIN').length, s.transacoes.filter(x => x === 'COMMIT').length, 'cada execução em uma transação fechada');
});

test('a pessoa respondeu (pelo webhook): encerra com "respondeu", emite o evento e a próxima mensagem NÃO sai', async () => {
 const inbox = [];
 const s = banco({ fluxo: fluxo(), inbox });
 await iniciarFluxo(s.client, { flowId: FLUXO, spaceId: 'sites', leadId: LEAD, automationId: AUTO, evento: 'lead.criado' });
 await ciclo(s, T0);
 inbox.push({ from: '5531997599216', em: new Date(T0 + min(20)).toISOString() });
 const r = await ciclo(s, T0 + min(61));
 assert.equal(r.respondeu, 1);
 assert.equal(s.outbox.length, 1, 'a 2ª mensagem não saiu');
 assert.deepEqual({ status: s.runs[0].status, outcome: s.runs[0].outcome }, { status: 'stopped', outcome: 'respondeu' });
 assert.deepEqual(s.eventos.map(e => e.evento), ['fluxo.respondeu']);
});

test('sem webhook, a Evolution diz se a pessoa respondeu; Evolution fora do ar não encerra o fluxo por engano', async () => {
 const vindas = (...ts) => ({ ok: true, messages: ts.map(t => ({ fromMe: false, timestamp: t })) });
 for (const [resposta, esperado] of [[vindas(Math.floor((T0 + min(30)) / 1000)), 'respondeu'], [vindas(Math.floor((T0 - min(30)) / 1000)), 'enviou'], [{ ok: false, reason: 'unavailable' }, 'enviou']]) {
  const s = banco({ fluxo: fluxo() });
  await iniciarFluxo(s.client, { flowId: FLUXO, spaceId: 'sites', leadId: LEAD, automationId: AUTO, evento: 'lead.criado' });
  await ciclo(s, T0);
  const consultas = [];
  const r = await ciclo(s, T0 + min(61), { criarAdaptador: o => ({ configured: true, async findMessages(q) { consultas.push({ o, q }); return resposta; } }) });
  assert.equal(r[esperado === 'respondeu' ? 'respondeu' : 'enviaram'], 1, JSON.stringify(resposta));
  assert.deepEqual(consultas[0], { o: { env: { EVOLUTION_INSTANCE: 'teste' }, instance: 'teste' }, q: { where: { key: { remoteJid: '5531997599216@s.whatsapp.net' } }, page: 1, offset: 20 } });
 }
});

test('modo de teste: anda o fluxo inteiro SEM enfileirar nada, com espera de no máximo 1 minuto e o log do que enviaria', async () => {
 const s = banco({ fluxo: fluxo({ status: 'teste' }) });
 await iniciarFluxo(s.client, { flowId: FLUXO, spaceId: 'sites', leadId: LEAD, automationId: AUTO, evento: 'lead.criado', dados: { interesse: 'x' } });
 await ciclo(s, T0);
 assert.equal(s.runs[0].run_after, new Date(T0 + min(1)).toISOString(), 'a espera de 60 min vira 1 min em teste');
 await ciclo(s, T0 + min(2));
 assert.equal(s.runs[0].step, 3);
 assert.equal(s.runs[0].run_after, new Date(T0 + min(2) + min(1)).toISOString(), 'a janela final também vale 1 min');
 await ciclo(s, T0 + min(4));
 assert.equal(s.runs[0].outcome, 'sem_resposta');
 assert.equal(s.outbox.length, 0, 'em teste nada vai para a fila');
 assert.ok(s.runs[0].log.some(l => /^Teste, não enviada: Oi, Marina/.test(l.nota)));
});

test('número bloqueado nunca recebe: o fluxo encerra com "suprimido" e nada é enfileirado', async () => {
 const s = banco({ fluxo: fluxo(), suprimidos: ['5531997599216'] });
 await iniciarFluxo(s.client, { flowId: FLUXO, spaceId: 'sites', leadId: LEAD, automationId: AUTO, evento: 'lead.criado' });
 const r = await ciclo(s, T0);
 assert.equal(r.suprimidos, 1);
 assert.deepEqual({ status: s.runs[0].status, outcome: s.runs[0].outcome }, { status: 'stopped', outcome: 'suprimido' });
 assert.equal(s.outbox.length, 0);
});

test('sem "parar quando a pessoa responde": segue até o fim, sem janela final e sem evento', async () => {
 const s = banco({ fluxo: fluxo({ stop_on_reply: false, steps: [msg('Primeira mensagem'), espera(5), msg('Segunda mensagem')] }), inbox: [{ from: '5531997599216', em: new Date(T0 + min(1)).toISOString() }] });
 await iniciarFluxo(s.client, { flowId: FLUXO, spaceId: 'sites', leadId: LEAD, automationId: AUTO, evento: 'lead.criado' });
 await ciclo(s, T0); await ciclo(s, T0 + min(6));
 assert.deepEqual(s.outbox.map(o => o.texto), ['Primeira mensagem', 'Segunda mensagem'], 'mesmo com resposta, segue');
 assert.deepEqual({ status: s.runs[0].status, outcome: s.runs[0].outcome }, { status: 'done', outcome: null });
 assert.equal(s.eventos.length, 0);
});

test('mensagem que fica vazia depois de preencher os dados falha a execução com o motivo, sem enviar', async () => {
 const s = banco({ fluxo: fluxo({ steps: [msg('{{dados.nao_veio}}')] }) });
 await iniciarFluxo(s.client, { flowId: FLUXO, spaceId: 'sites', leadId: LEAD, automationId: AUTO, evento: 'lead.criado' });
 const r = await ciclo(s, T0);
 assert.equal(r.falhas, 1);
 assert.deepEqual({ status: s.runs[0].status, outcome: s.runs[0].outcome }, { status: 'failed', outcome: 'erro' });
 assert.match(s.runs[0].log.at(-1).nota, /passo 1 ficou vazia/);
 assert.equal(s.outbox.length, 0);
});

test('erro do banco ao enfileirar: desfaz, tenta de novo em 1 min e desiste na 5ª tentativa; nada de mensagem duplicada', async () => {
 const s = banco({ fluxo: fluxo(), falharAoEnfileirar: true });
 await iniciarFluxo(s.client, { flowId: FLUXO, spaceId: 'sites', leadId: LEAD, automationId: AUTO, evento: 'lead.criado' });
 const silencio = console.error; console.error = () => {};
 let quando = T0;
 try {
  for (let n = 1; n <= 5; n++) {
   const r = await ciclo(s, quando);
   assert.equal(r.falhas, 1, `tentativa ${n}`);
   if (n < 5) { assert.equal(s.runs[0].status, 'running'); assert.equal(s.runs[0].run_after, new Date(quando + min(1)).toISOString()); quando += min(1); }
  }
 } finally { console.error = silencio; }
 assert.deepEqual({ status: s.runs[0].status, outcome: s.runs[0].outcome }, { status: 'failed', outcome: 'erro' });
 assert.equal(s.outbox.length, 0);
 assert.ok(s.transacoes.includes('ROLLBACK'));
 assert.equal((await ciclo(s, quando + min(5))).andaram, 0, 'execução falhada não volta a andar');
});

test('execução presa (processo caiu no meio) volta a andar depois de 5 minutos; antes disso, não', async () => {
 const s = banco({ fluxo: fluxo() });
 await iniciarFluxo(s.client, { flowId: FLUXO, spaceId: 'sites', leadId: LEAD, automationId: AUTO, evento: 'lead.criado' });
 s.runs[0].locked_at = new Date(T0).toISOString();
 assert.equal((await ciclo(s, T0 + min(2))).andaram, 0);
 assert.equal((await ciclo(s, T0 + min(6))).andaram, 1);
});

test('sem a migração 070 o ciclo diz "indisponível" em vez de lançar', async () => {
 const pool = { async query() { throw Object.assign(new Error('x'), { code: '42P01' }); }, async connect() { throw new Error('não deveria conectar'); } };
 assert.equal((await processarFluxos(pool, { agora: () => T0 })).indisponivel, true);
});

test('migração 070: só adiciona, executa cópia dos passos e a lista de eventos inclui os de fluxo', async () => {
 const { readFileSync } = await import('node:fs');
 const sql = readFileSync(new URL('../../db/migrations/070_fluxos_de_whatsapp.sql', import.meta.url), 'utf8').replace(/--.*$/gm, '');
 assert.ok(/CREATE TABLE IF NOT EXISTS whatsapp_flows/.test(sql) && /CREATE TABLE IF NOT EXISTS whatsapp_flow_runs/.test(sql));
 assert.equal(/\b(DROP TABLE|DELETE FROM|TRUNCATE|DROP COLUMN)\b/i.test(sql), false, 'só adiciona');
 assert.match(sql, /idempotency_key text NOT NULL UNIQUE/);
 assert.match(sql, /steps jsonb NOT NULL/);
 assert.match(sql, /'fluxo\.respondeu', 'fluxo\.sem_resposta'/);
});
