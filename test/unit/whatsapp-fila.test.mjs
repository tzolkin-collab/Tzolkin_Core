import test from 'node:test';
import assert from 'node:assert/strict';
import { validateActions, emitEvent, ACTIONS } from '../../apps/api/src/platform/automations.mjs';
import { renderizarMensagem, variaveisInvalidas, enfileirarParaLead, enfileirarParaEquipe, MENSAGEM_062 } from '../../apps/api/src/platform/whatsapp-saida.mjs';
import { processarFila, envioLigado, MAX_TENTATIVAS, ESPERAS_MS } from '../../apps/api/src/modules/whatsapp-fila.mjs';

const LIGADO = { WHATSAPP_ENVIO: 'ligado' };
const LEAD = { email: 'maria@exemplo.com', whatsapp: '(31) 99759-9216', lead_name: 'Maria Souza', phone: null, company: 'Alfa', product: 'Tzolkin Sites' };
const DADOS = { spaceId: 'sites', leadId: 'l1', automationId: 'a1', evento: 'lead.criado' };

// Banco falso: guarda as consultas e responde por trecho do SQL.
function banco({ lead = LEAD, jaNaFila = false, semTabela = false, pegos = [], suprimidos = [], acoes = null, devidas = [] } = {}) {
 const sql = [];
 return {
  sql,
  async query(texto, p = []) {
   sql.push({ texto, p });
   if (acoes && texto.includes('FROM automations')) return { rows: [{ id: 'auto-1', name: 'Regra', actions: acoes }] };
   if (texto.includes('FROM commercial_leads l')) return { rows: lead ? [lead] : [] };
   if (texto.startsWith('INSERT INTO whatsapp_outbox')) { if (semTabela) throw Object.assign(new Error('relation'), { code: '42P01' }); return { rows: jaNaFila ? [] : [{ id: 'wa-1' }] }; }
   if (texto.startsWith('SELECT DISTINCT instance')) return { rows: devidas };
   if (texto.includes("SET status='sending'")) return { rows: pegos };
   if (texto.includes('FROM whatsapp_suppressions')) return { rows: suprimidos.includes(p[0]) ? [{}] : [] };
   return { rows: [], rowCount: 0 };
  },
 };
}
const adaptadorFake = ({ conectado = true, resposta = { ok: true, messageId: 'M1' }, enviados = [], instance = 'padrao' } = {}) => ({
 configured: true, instance,
 async connectionState() { return { ok: true, state: conectado ? 'open' : 'close', connected: conectado }; },
 async sendText(m) { enviados.push(m); return resposta; },
});
const SEM_PAUSA = { pausar: async () => {} };
const mensagem = tentativas => ({ id: 'm1', to_number: '5531997599216', body_text: 'oi', attempts: tentativas });

test('o catálogo ganhou as duas ações de WhatsApp, e mensagem com variável desconhecida é recusada', () => {
 assert.ok('whatsapp.enviar' in ACTIONS && 'whatsapp.avisar_equipe' in ACTIONS);
 assert.deepEqual(validateActions([{ action: 'whatsapp.enviar', message: 'Oi {{first_name}}!' }]), [{ action: 'whatsapp.enviar', message: 'Oi {{first_name}}!' }]);
 assert.deepEqual(validateActions([{ action: 'whatsapp.avisar_equipe', message: 'Lead novo: {{name}} ({{whatsapp}})' }]).map(a => a.action), ['whatsapp.avisar_equipe']);
 for (const ruim of [{ action: 'whatsapp.enviar' }, { action: 'whatsapp.enviar', message: 'x' }, { action: 'whatsapp.enviar', message: 'Oi {{senha}}' }, { action: 'whatsapp.enviar', message: 'Oi', para: '1' }, { action: 'whatsapp.enviar', message: 'a'.repeat(1001) }]) {
  assert.throws(() => validateActions([ruim]), e => e.status === 400, JSON.stringify(ruim).slice(0, 60));
 }
});

test('mensagem: troca as variáveis, e variável sem valor some sem deixar espaço duplo', () => {
 assert.equal(renderizarMensagem('Oi {{first_name}}, aqui é a Tzolkin.', { first_name: 'Maria' }), 'Oi Maria, aqui é a Tzolkin.');
 assert.equal(renderizarMensagem('Oi {{first_name}} {{company_name}}!', { first_name: 'Maria' }), 'Oi Maria !');
 assert.deepEqual(variaveisInvalidas('{{name}} {{x}} {{ y }}'), ['x', 'y']);
});

test('enviar ao lead: normaliza o número, enfileira na transação e não duplica', async () => {
 const c = banco();
 const r = await enfileirarParaLead(c, { mensagem: 'Oi {{first_name}}!', ...DADOS });
 assert.match(r, /na fila para 5531997599216/);
 const ins = c.sql.find(q => q.texto.startsWith('INSERT INTO whatsapp_outbox')).p;
 assert.equal(ins[1], 'lead'); assert.equal(ins[6], '5531997599216'); assert.equal(ins[8], 'Oi Maria!');
 assert.match(await enfileirarParaLead(banco({ jaNaFila: true }), { mensagem: 'Oi', ...DADOS }), /já estava na fila/);
});

test('enviar ao lead: sem WhatsApp válido ou sem a migração 062, falha com mensagem clara', async () => {
 await assert.rejects(enfileirarParaLead(banco({ lead: { ...LEAD, whatsapp: null, phone: null } }), { mensagem: 'Oi', ...DADOS }), /WhatsApp válido/);
 await assert.rejects(enfileirarParaLead(banco({ lead: null }), { mensagem: 'Oi', ...DADOS }), /Lead não encontrado/);
 await assert.rejects(enfileirarParaLead(banco({ semTabela: true }), { mensagem: 'Oi', ...DADOS }), new RegExp(MENSAGEM_062));
});

test('avisar a equipe: uma linha por número, e sem número configurado falha', async () => {
 const c = banco();
 const r = await enfileirarParaEquipe(c, { mensagem: 'Lead: {{name}}', ...DADOS, env: { WHATSAPP_TEAM_NUMBERS: '31997599216, (11) 98888-7777' } });
 assert.match(r, /2 números da equipe/);
 const linhas = c.sql.filter(q => q.texto.startsWith('INSERT INTO whatsapp_outbox')).map(q => [q.p[1], q.p[6]]);
 assert.deepEqual(linhas, [['equipe', '5531997599216'], ['equipe', '5511988887777']]);
 await assert.rejects(enfileirarParaEquipe(banco(), { mensagem: 'x y', ...DADOS, env: {} }), /Nenhum número da equipe/);
});

test('o motor roda a ação de WhatsApp em evento de lead e registra FAILED fora dele', async () => {
 const acoes = [{ action: 'whatsapp.enviar', message: 'Oi {{first_name}}' }];
 const c = banco({ acoes });
 assert.equal(await emitEvent(c, 'lead.criado', { spaceId: 'sites', tenantId: 't1', leadId: 'l1' }), 1);
 assert.ok(c.sql.some(q => q.texto.startsWith('INSERT INTO whatsapp_outbox')));
 assert.equal(c.sql.find(q => q.texto.startsWith('INSERT INTO automation_runs')).p[5], 'OK');
 const fora = banco({ acoes });
 await emitEvent(fora, 'oportunidade.ganha', { spaceId: 'sites', tenantId: 't1', opportunityId: 'o1' });
 assert.equal(fora.sql.find(q => q.texto.startsWith('INSERT INTO automation_runs')).p[5], 'FAILED');
});

test('fila: com o envio desligado nada sai, nem a Evolution é chamada', async () => {
 const enviados = [];
 const a = adaptadorFake({ enviados });
 let consultou = false; a.connectionState = async () => { consultou = true; return { ok: true, connected: true }; };
 const r = await processarFila(banco({ pegos: [mensagem(1)] }), { env: {}, adaptador: a, ...SEM_PAUSA });
 assert.equal(r.desligado, true); assert.equal(consultou, false); assert.equal(enviados.length, 0);
 assert.equal(envioLigado({ WHATSAPP_ENVIO: 'LIGADO' }), true); assert.equal(envioLigado({ WHATSAPP_ENVIO: 'desligado' }), false);
});

test('fila: instância desconectada não pega nem gasta tentativa', async () => {
 const c = banco({ pegos: [mensagem(1)] });
 const r = await processarFila(c, { env: LIGADO, adaptador: adaptadorFake({ conectado: false }), ...SEM_PAUSA });
 assert.equal(r.desconectado, true);
 assert.ok(!c.sql.some(q => q.texto.includes("SET status='sending'")));
});

test('fila: envia no ritmo (pausa entre mensagens), marca enviada e respeita a supressão', async () => {
 const enviados = [], pausas = [];
 const c = banco({ pegos: [{ id: 'm1', to_number: '5531997599216', body_text: 'um', attempts: 1 }, { id: 'm2', to_number: '5511988887777', body_text: 'dois', attempts: 1 }, { id: 'm3', to_number: '5521977776666', body_text: 'tres', attempts: 1 }], suprimidos: ['5511988887777'] });
 const r = await processarFila(c, { env: LIGADO, adaptador: adaptadorFake({ enviados }), pausar: async ms => { pausas.push(ms); } });
 assert.deepEqual(enviados.map(m => m.text), ['um', 'tres']);
 assert.equal(r.enviados, 2); assert.equal(r.suprimidos, 1); assert.equal(pausas.length, 2);
 assert.ok(c.sql.some(q => q.texto.includes("status='sent'") && q.p[2] === 'M1'));
});

test('fila: falha temporária volta com espera crescente; recusa definitiva falha; número sem WhatsApp entra na supressão', async () => {
 const agora = () => 1_000_000;
 const com = (tentativas, resposta) => { const c = banco({ pegos: [mensagem(tentativas)] }); return processarFila(c, { env: LIGADO, adaptador: adaptadorFake({ resposta }), agora, ...SEM_PAUSA }).then(r => ({ r, c })); };
 let { r, c } = await com(2, { ok: false, reason: 'unavailable' });
 assert.equal(r.adiados, 1);
 assert.equal(c.sql.find(q => q.texto.includes("SET status='queued', locked_at=NULL, next_attempt_at")).p[1], new Date(1_000_000 + ESPERAS_MS[1]).toISOString());
 ({ r } = await com(MAX_TENTATIVAS, { ok: false, reason: 'rate_limited' }));
 assert.equal(r.falhas, 1, 'na última tentativa desiste');
 ({ r, c } = await com(1, { ok: false, reason: 'rejected' }));
 assert.equal(r.falhas, 1);
 assert.ok(c.sql.some(q => q.texto.startsWith('INSERT INTO whatsapp_suppressions')), 'número recusado vai para a supressão');
 ({ c } = await com(1, { ok: false, reason: 'rejected', detail: 'invalid_text' }));
 assert.ok(!c.sql.some(q => q.texto.startsWith('INSERT INTO whatsapp_suppressions')), 'texto inválido não culpa o número');
});

test('fila: sem a migração 062 o ciclo diz indisponível em vez de lançar', async () => {
 const pool = { async query() { throw Object.assign(new Error('relation'), { code: '42P01' }); } };
 assert.equal((await processarFila(pool, { env: LIGADO, adaptador: adaptadorFake(), ...SEM_PAUSA })).indisponivel, true);
});

test('migração 062: só adiciona, número só com dígitos, idempotência única e supressão revogável', async () => {
 const { readFileSync } = await import('node:fs');
 const sql = readFileSync(new URL('../../db/migrations/062_fila_de_whatsapp.sql', import.meta.url), 'utf8');
 assert.doesNotMatch(sql.replace(/--.*$/gm, ''), /\b(DROP|DELETE|TRUNCATE|ALTER)\b/i);
 assert.match(sql, /idempotency_key text NOT NULL UNIQUE/);
 assert.match(sql, /to_number ~ '\^\[0-9\]\{10,15\}\$'/);
 assert.match(sql, /revoked_at timestamptz/);
});

test('fila: cada mensagem sai pela instância dela; instância desconectada não leva as outras junto', async () => {
 const enviados = { padrao: [], suporte: [], comercial: [] };
 const adaptadores = { padrao: adaptadorFake({ enviados: enviados.padrao }), suporte: adaptadorFake({ enviados: enviados.suporte, instance: 'suporte' }), comercial: adaptadorFake({ enviados: enviados.comercial, instance: 'comercial', conectado: false }) };
 const c = banco({ devidas: [{ instance: null }, { instance: 'suporte' }, { instance: 'comercial' }], pegos: [
  { id: 'a', to_number: '5531997599216', body_text: 'padrao', attempts: 1, instance: null },
  { id: 'b', to_number: '5511988887777', body_text: 'suporte', attempts: 1, instance: 'suporte' }] });
 const r = await processarFila(c, { env: LIGADO, adaptador: adaptadores.padrao, criarAdaptador: nome => adaptadores[nome], ...SEM_PAUSA });
 assert.equal(r.enviados, 2);
 assert.deepEqual(enviados.padrao.map(m => m.text), ['padrao']);
 assert.deepEqual(enviados.suporte.map(m => m.text), ['suporte']);
 assert.equal(enviados.comercial.length, 0);
 const pegar = c.sql.find(q => q.texto.includes("SET status='sending'"));
 assert.deepEqual(pegar.p[2].sort(), ['', 'suporte'], 'a instância desconectada fica fora do que é pego');
});

test('fila: com todas as instâncias desconectadas não pega nada', async () => {
 const c = banco({ devidas: [{ instance: 'comercial' }], pegos: [{ id: 'a', to_number: '5531997599216', body_text: 'x', attempts: 1, instance: 'comercial' }] });
 const r = await processarFila(c, { env: LIGADO, adaptador: adaptadorFake(), criarAdaptador: () => adaptadorFake({ conectado: false }), ...SEM_PAUSA });
 assert.equal(r.desconectado, true);
 assert.ok(!c.sql.some(q => q.texto.includes("SET status='sending'")));
});

test('migração 064: só adiciona colunas opcionais e índices', async () => {
 const { readFileSync } = await import('node:fs');
 const sql = readFileSync(new URL('../../db/migrations/064_whatsapp_instancias.sql', import.meta.url), 'utf8').replace(/--.*$/gm, '');
 assert.doesNotMatch(sql, /\b(DROP|DELETE|TRUNCATE|UPDATE|RENAME)\b/i);
 assert.equal((sql.match(/ADD COLUMN IF NOT EXISTS instance text CHECK \(instance IS NULL OR/g) || []).length, 2);
 assert.doesNotMatch(sql, /NOT NULL/, 'a coluna é opcional: o que já foi gravado continua válido');
});
