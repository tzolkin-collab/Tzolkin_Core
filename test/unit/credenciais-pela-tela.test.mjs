// Credenciais de integração pela tela (etapa 1: Vercel, GitHub, EasyPanel, Hostinger): ambiente vivo, validação, rotas e cifra.
import test from 'node:test';
import assert from 'node:assert/strict';
import { randomBytes } from 'node:crypto';
import { criarEnvVivo, vivo as processoVivo } from '../../apps/api/src/platform/env-vivo.mjs';
import { seal, open } from '../../apps/api/src/platform/secrets.mjs';
import { PROVEDORES, validarValores, testarProvedor } from '../../apps/api/src/platform/credenciais.mjs';
import { integrationsCredentialsRoutes, MENSAGEM_050 } from '../../apps/api/src/modules/integrations-credentials.mjs';
import { estadoDasIntegracoes } from '../../apps/api/src/modules/integrations-status.mjs';
import { buildRegistry, deploysRoutes } from '../../apps/api/src/modules/deploys.mjs';
import { createHostingerDnsAdapterVivo } from '../../apps/api/src/integrations/hostinger-dns.mjs';
import { fail } from '../../apps/api/src/platform/http.mjs';

const CHAVE = randomBytes(32);
const BASE = { CORE_SECRETS_KEY: CHAVE.toString('base64') };
const OPERADOR = { subject: 'op-1', email: 'gustavo@exemplo.test' };
const mudo = { log() {}, error() {} };
const linha = (nome, valor) => { const s = seal(valor, CHAVE); return { nome, ciphertext: s.ciphertext, iv: s.iv, tag: s.tag }; };
const bancoCom = (rows, { erro } = {}) => ({ calls: 0, async query() { this.calls++; if (erro) throw erro; return { rows }; } });
const resposta = (corpoJson, status = 200, headers = {}) => ({ ok: status < 400, status, json: async () => corpoJson, headers: { get: k => headers[k.toLowerCase()] ?? null } });

// ---------- ambiente vivo ----------
test('o valor da tela vence o do .env; sem valor na tela, vale o .env; sem chave, nada de override', async () => {
 const v = criarEnvVivo({ base: { ...BASE, VERCEL_TOKEN: 'do-servidor', GITHUB_TOKEN: 'gh-servidor' }, log: mudo });
 assert.equal(v.env.VERCEL_TOKEN, 'do-servidor');
 await v.carregar(bancoCom([linha('VERCEL_TOKEN', 'da-tela-123456')]));
 assert.equal(v.env.VERCEL_TOKEN, 'da-tela-123456', 'a tela vence');
 assert.equal(v.env.GITHUB_TOKEN, 'gh-servidor', 'sem valor na tela vale o servidor');
 assert.deepEqual(['VERCEL_TOKEN', 'GITHUB_TOKEN', 'EASYPANEL_URL'].map(n => v.origem(n)), ['tela', 'servidor', null]);
 assert.ok('VERCEL_TOKEN' in v.env && Object.keys(v.env).includes('VERCEL_TOKEN'));
 const semChave = criarEnvVivo({ base: { VERCEL_TOKEN: 'x' }, log: mudo });
 await semChave.carregar(bancoCom([linha('VERCEL_TOKEN', 'da-tela-123456')]));
 assert.equal(semChave.env.VERCEL_TOKEN, 'x', 'sem CORE_SECRETS_KEY a tela não pode valer');
 assert.equal(semChave.temChave(), false);
});

test('o ambiente vivo é só de leitura; remover a linha devolve o valor do servidor; erro de leitura mantém o que já estava', async () => {
 const v = criarEnvVivo({ base: { ...BASE, VERCEL_TOKEN: 'servidor' }, log: mudo });
 await v.carregar(bancoCom([linha('VERCEL_TOKEN', 'tela-1234567')]));
 assert.throws(() => { v.env.VERCEL_TOKEN = 'hack'; }, TypeError);
 assert.equal(v.env.VERCEL_TOKEN, 'tela-1234567');
 await v.carregar(bancoCom([]));
 assert.equal(v.env.VERCEL_TOKEN, 'servidor');
 await v.carregar(bancoCom([linha('VERCEL_TOKEN', 'tela-1234567')]));
 await v.garantir(bancoCom([], { erro: new Error('banco fora') }));   // ainda "novo": nem relê
 assert.equal(v.env.VERCEL_TOKEN, 'tela-1234567');
 v.invalidar();
 await v.garantir(bancoCom([], { erro: new Error('banco fora') }));    // relê, falha, não lança e mantém
 assert.equal(v.env.VERCEL_TOKEN, 'tela-1234567', 'falha ao ler não apaga a credencial em uso');
});

test('migração 050 ausente (42P01) = só o ambiente; credencial ilegível é ignorada e o log cita só o NOME', async () => {
 const v = criarEnvVivo({ base: { ...BASE, VERCEL_TOKEN: 'servidor' }, log: mudo });
 await v.carregar(bancoCom([], { erro: Object.assign(new Error('relation'), { code: '42P01' }) }));
 assert.equal(v.env.VERCEL_TOKEN, 'servidor');
 const mensagens = [];
 const ruim = linha('GITHUB_TOKEN', 'segredo-do-github-123'); ruim.tag = Buffer.alloc(16);
 const v2 = criarEnvVivo({ base: { ...BASE }, log: { error: (...a) => mensagens.push(a.join(' ')) } });
 await v2.carregar(bancoCom([ruim, linha('VERCEL_TOKEN', 'ok-123456789')]));
 assert.equal(v2.env.GITHUB_TOKEN, undefined); assert.equal(v2.env.VERCEL_TOKEN, 'ok-123456789');
 assert.ok(mensagens.some(m => m.includes('GITHUB_TOKEN')) && !mensagens.some(m => m.includes('segredo-do-github')));
});

test('garantir respeita o intervalo: não vai ao banco a cada pedido', async () => {
 let agora = 0;
 const v = criarEnvVivo({ base: BASE, relogio: () => agora, ttl: 15000, log: mudo });
 const db = bancoCom([]);
 await v.garantir(db); await v.garantir(db); await v.garantir(db);
 assert.equal(db.calls, 1);
 agora = 16000; await v.garantir(db);
 assert.equal(db.calls, 2);
 v.invalidar(); await v.garantir(db);
 assert.equal(db.calls, 3);
});

// ---------- validação e teste ----------
test('só campos conhecidos, não vazios, no formato certo', () => {
 const ok = validarValores('easypanel', { EASYPANEL_URL: ' https://painel.exemplo.test ', EASYPANEL_TOKEN: 'token-longo-123' }, fail);
 assert.deepEqual(ok, { EASYPANEL_URL: 'https://painel.exemplo.test', EASYPANEL_TOKEN: 'token-longo-123' });
 const recusa = (p, v, re) => assert.throws(() => validarValores(p, v, fail), e => e.status === 400 && re.test(e.message));
 recusa('easypanel', { EASYPANEL_URL: 'http://painel.exemplo.test' }, /https/);
 recusa('easypanel', { EASYPANEL_URL: 'https://u:p@painel.exemplo.test' }, /sem usuário/);
 recusa('easypanel', { EASYPANEL_URL: 'https://painel.exemplo.test/x/y' }, /caminho/);
 recusa('vercel', { VERCEL_TOKEN: 'curto' }, /8 a 500/);
 recusa('vercel', { VERCEL_TOKEN: 'tem espaço no meio' }, /8 a 500/);
 recusa('vercel', { VERCEL_TOKEN: 'abcdefghij\nklmno' }, /8 a 500/);
 recusa('vercel', { VERCEL_TOKEN: '   ' }, /vazio/);
 recusa('vercel', { SEGREDO_QUALQUER: 'abcdefghij' }, /desconhecido/);
 recusa('vercel', { VERCEL_TOKEN: 12345678 }, /texto/);
 recusa('vercel', {}, /Nada para salvar/);
 recusa('hostinger', { HOSTINGER_DNS_ZONE: 'não é domínio' }, /domínio/);
 recusa('inexistente', { X: 'y' }, /Provedor desconhecido/);
 assert.deepEqual(Object.keys(PROVEDORES), ['vercel', 'github', 'easypanel', 'pluggy', 'push', 'stripe', 'asaas', 'meta', 'hostinger']);
 for (const p of Object.values(PROVEDORES)) for (const c of p.campos) assert.match(c.nome, /^[A-Z][A-Z0-9_]{2,63}$/, 'cabe na CHECK da migração');
});

test('testar: sucesso por provedor, falha sem ecoar o segredo, campo obrigatório faltando e mistura com o valor atual', async () => {
 const SEGREDO = 'tok-SEGREDO-987654321';
 const chamadas = [];
 const rede = async (url, o = {}) => {
  chamadas.push({ url: String(url), auth: o.headers?.Authorization });
  const u = String(url);
  if (u.includes('vercel')) return resposta({ projects: [{ id: 'p1', name: 'site' }] });
  if (u.includes('github')) return resposta([{ id: 1, full_name: 'a/b', default_branch: 'main' }]);
  if (u.includes('listProjectsAndServices')) { let lido = false; return { ok: true, status: 200, body: { getReader: () => ({ read: async () => (lido ? { done: true } : (lido = true, { value: new TextEncoder().encode('[]'), done: false })), cancel() {}, releaseLock() {} }) } }; }
  if (u.includes('hostinger')) return resposta([{ name: '@', type: 'A', ttl: 300, records: [{ content: '1.2.3.4' }] }]);
  return resposta({}, 500);
 };
 assert.match((await testarProvedor('vercel', { VERCEL_TOKEN: SEGREDO }, () => '', rede)).mensagem, /Vercel respondeu/);
 assert.equal(chamadas.at(-1).auth, `Bearer ${SEGREDO}`);
 assert.match((await testarProvedor('github', { GITHUB_TOKEN: SEGREDO }, () => '', rede)).mensagem, /GitHub respondeu \(1 repositórios/);
 assert.match((await testarProvedor('hostinger', { HOSTINGER_API_KEY: SEGREDO }, () => '', rede)).mensagem, /1 registros na zona tzolkin\.cloud/);
 // mistura: só o token vem no pedido; o endereço vale o de hoje (do servidor ou da tela)
 const ep = await testarProvedor('easypanel', { EASYPANEL_TOKEN: SEGREDO }, n => (n === 'EASYPANEL_URL' ? 'https://painel.exemplo.test' : ''), rede);
 assert.equal(ep.ok, true, ep.mensagem);
 assert.ok(chamadas.at(-1).url.startsWith('https://painel.exemplo.test/api/listProjectsAndServices'));
 assert.deepEqual(await testarProvedor('easypanel', { EASYPANEL_TOKEN: SEGREDO }, () => '', rede), { ok: false, mensagem: 'Falta informar: Endereço do painel.' });
 // falha: mensagem clara, sem o segredo
 const ruim = await testarProvedor('vercel', { VERCEL_TOKEN: SEGREDO }, () => '', async () => resposta({}, 403));
 assert.equal(ruim.ok, false); assert.match(ruim.mensagem, /^Não foi possível validar:/); assert.ok(!ruim.mensagem.includes(SEGREDO));
 const eco = await testarProvedor('vercel', { VERCEL_TOKEN: SEGREDO }, () => '', async () => { throw new Error(`falhou com ${SEGREDO} na URL`); });
 assert.ok(!eco.mensagem.includes(SEGREDO), 'segredo ecoado pelo erro é mascarado');
 const dns = await testarProvedor('hostinger', { HOSTINGER_API_KEY: SEGREDO }, () => '', async () => resposta({}, 401));
 assert.match(dns.mensagem, /recusou a chave/);
});

// ---------- rotas ----------
function montar({ env = BASE, fetchImpl = async () => resposta({ projects: [] }), db = {} } = {}) {
 const rotas = {}, regs = {};
 const reg = metodo => (p, h, o) => { rotas[`${metodo} ${p}`] = h; regs[`${metodo} ${p}`] = o; };
 const v = criarEnvVivo({ base: env, log: mudo });
 integrationsCredentialsRoutes({ get: reg('GET'), post: reg('POST'), put: reg('PUT'), delete: reg('DELETE') }, { vivo: v, env, fetchImpl });
 const log = [];
 const q = async (sql, params = []) => {
  log.push({ sql, params });
  for (const [trecho, fn] of Object.entries(db)) if (sql.includes(trecho)) { const r = fn(params, sql); if (r instanceof Error) throw r; return r; }
  return { rows: [], rowCount: 0 };
 };
 return { rotas, regs, v, log, pool: { query: q }, client: { query: q } };
}
const reply = () => { const s = {}; return { fn: (st, c) => { s.status = st; s.corpo = c; }, s }; };
const corpo = b => ({ headers: { 'content-type': 'application/json' }, async *[Symbol.asyncIterator]() { yield Buffer.from(JSON.stringify(b)); } });

test('GET: segredo nunca devolve valor; o que não é segredo devolve; mostra de onde vale e quem mudou', async () => {
 const m = montar({
  env: { ...BASE, VERCEL_TOKEN: 'servidor-SEGREDO-1', EASYPANEL_URL: 'https://painel.exemplo.test' },
  db: {
   'FROM integration_credentials WHERE': () => ({ rows: [{ provider: 'github', nome: 'GITHUB_TOKEN', fingerprint: 'abcd1234abcd1234', updated_by: 'gustavo@exemplo.test', created_at: '2026-10-04T12:00:00Z' }] }),
   'FROM integration_credentials_history': () => ({ rows: [{ provider: 'github', nome: 'GITHUB_TOKEN', action: 'set', actor: 'gustavo@exemplo.test', created_at: '2026-10-04T12:00:00Z' }] }),
  },
 });
 await m.v.carregar({ query: async () => ({ rows: [linha('GITHUB_TOKEN', 'tela-SEGREDO-2')] }) });
 const r = reply();
 await m.rotas['GET /api/integrations/credentials']({ pool: m.pool, reply: r.fn });
 const texto = JSON.stringify(r.s.corpo);
 assert.ok(!texto.includes('SEGREDO'), 'nenhum segredo, de nenhuma origem, vai para a tela');
 const por = id => r.s.corpo.provedores.find(p => p.id === id);
 const campo = (id, nome) => por(id).campos.find(c => c.nome === nome);
 assert.deepEqual([campo('vercel', 'VERCEL_TOKEN').origem, campo('github', 'GITHUB_TOKEN').origem, campo('hostinger', 'HOSTINGER_API_KEY').origem], ['servidor', 'tela', null]);
 assert.ok(!('valor' in campo('vercel', 'VERCEL_TOKEN')));
 assert.equal(campo('easypanel', 'EASYPANEL_URL').valor, 'https://painel.exemplo.test', 'campo sem segredo mostra o valor atual');
 assert.equal(campo('github', 'GITHUB_TOKEN').impressao, 'abcd1234abcd1234');
 assert.deepEqual(por('github').historico, [{ nome: 'GITHUB_TOKEN', acao: 'set', por: 'gustavo@exemplo.test', em: '2026-10-04T12:00:00Z' }]);
 assert.deepEqual([r.s.corpo.migracao, r.s.corpo.chave], [true, true]);
});

test('GET sem a migração 050 mostra só o que vem do servidor', async () => {
 const m = montar({ env: { ...BASE, VERCEL_TOKEN: 'x-1234567' }, db: { integration_credentials: () => Object.assign(new Error('relation'), { code: '42P01' }) } });
 const r = reply();
 await m.rotas['GET /api/integrations/credentials']({ pool: m.pool, reply: r.fn });
 assert.equal(r.s.corpo.migracao, false);
 assert.equal(r.s.corpo.provedores[0].campos[0].origem, 'servidor');
});

test('salvar: testa antes, cifra com a chave, revoga a anterior, registra no histórico sem valor e invalida o ambiente', async () => {
 const m = montar({ fetchImpl: async () => resposta({ projects: [{ id: 'p', name: 'x' }] }) });
 let invalidou = 0; const original = m.v.invalidar; m.v.invalidar = () => { invalidou++; original(); };
 const r = await m.rotas['PUT /api/integrations/credentials']({ client: m.client, body: { provider: 'vercel', valores: { VERCEL_TOKEN: 'token-NOVO-123456', VERCEL_TEAM_ID: 'team_abc123' } }, operator: OPERADOR });
 assert.deepEqual(r.response.campos, ['VERCEL_TOKEN', 'VERCEL_TEAM_ID']);
 assert.equal(m.regs['PUT /api/integrations/credentials'].transactional, true);
 const ins = m.log.filter(q => q.sql.startsWith('INSERT INTO integration_credentials('));
 assert.equal(ins.length, 2);
 const [provedor, nome, ct, iv, tag, , por] = ins[0].params;
 assert.deepEqual([provedor, nome, por], ['vercel', 'VERCEL_TOKEN', 'gustavo@exemplo.test']);
 assert.equal(open({ ciphertext: ct, iv, tag }, CHAVE), 'token-NOVO-123456', 'decifra com a chave do servidor');
 assert.ok(!JSON.stringify(m.log.map(q => q.params.map(p => (Buffer.isBuffer(p) ? '' : String(p))))).includes('token-NOVO'), 'o valor em claro não vai ao banco');
 assert.equal(m.log.filter(q => q.sql.startsWith('UPDATE integration_credentials SET revoked_at')).length, 2, 'a linha antiga é revogada, não apagada');
 const hist = m.log.filter(q => q.sql.includes('integration_credentials_history'));
 assert.equal(hist.length, 2); assert.ok(hist.every(h => !h.params.some(p => String(p).includes('token-NOVO'))));
 assert.equal(invalidou, 1);
});

test('valor que o provedor recusa NÃO é gravado (422), e sem chave (503) ou sem migração (409) também não', async () => {
 const recusa = montar({ fetchImpl: async () => resposta({}, 403) });
 await assert.rejects(recusa.rotas['PUT /api/integrations/credentials']({ client: recusa.client, body: { provider: 'vercel', valores: { VERCEL_TOKEN: 'token-RUIM-123456' } }, operator: OPERADOR }), e => e.status === 422 && /Não foi possível validar/.test(e.message) && !e.message.includes('RUIM'));
 assert.equal(recusa.log.filter(q => q.sql.includes('INSERT')).length, 0, 'nada foi gravado');
 const semChave = montar({ env: {}, fetchImpl: async () => resposta({ projects: [] }) });
 await assert.rejects(semChave.rotas['PUT /api/integrations/credentials']({ client: semChave.client, body: { provider: 'vercel', valores: { VERCEL_TOKEN: 'token-OK-123456' } }, operator: OPERADOR }), e => e.status === 503 && /CORE_SECRETS_KEY/.test(e.message));
 const semMigracao = montar({ fetchImpl: async () => resposta({ projects: [] }), db: { 'SELECT 1 FROM integration_credentials': () => Object.assign(new Error('relation'), { code: '42P01' }) } });
 await assert.rejects(semMigracao.rotas['PUT /api/integrations/credentials']({ client: semMigracao.client, body: { provider: 'vercel', valores: { VERCEL_TOKEN: 'token-OK-123456' } }, operator: OPERADOR }), e => e.status === 409 && e.message === MENSAGEM_050);
});

test('testar sem salvar: a rota de teste não escreve nada e devolve só ok e mensagem', async () => {
 const m = montar({ fetchImpl: async () => resposta({ projects: [] }) });
 const r = reply();
 await m.rotas['POST /api/integrations/credentials/test']({ req: corpo({ provider: 'vercel', valores: { VERCEL_TOKEN: 'token-TESTE-123456' } }), reply: r.fn });
 assert.equal(r.s.corpo.ok, true);
 assert.deepEqual(Object.keys(r.s.corpo).sort(), ['mensagem', 'ok']);
 assert.equal(m.log.length, 0);
});

test('remover: revoga e registra; o que veio do servidor não se remove pela tela; campo desconhecido é 404', async () => {
 const m = montar({ db: { 'UPDATE integration_credentials SET revoked_at=now() WHERE nome': p => (p[0] === 'GITHUB_TOKEN' ? { rowCount: 1, rows: [{ fingerprint: 'abcd1234abcd1234' }] } : { rowCount: 0, rows: [] }) } });
 const r = await m.rotas['DELETE /api/integrations/credentials/:provider/:nome']({ client: m.client, params: { provider: 'github', nome: 'GITHUB_TOKEN' }, operator: OPERADOR });
 assert.deepEqual(r.response, { ok: true });
 assert.ok(m.log.some(q => q.sql.includes("'removed'") && q.params[2] === 'abcd1234abcd1234'));
 await assert.rejects(m.rotas['DELETE /api/integrations/credentials/:provider/:nome']({ client: m.client, params: { provider: 'vercel', nome: 'VERCEL_TOKEN' }, operator: OPERADOR }), e => e.status === 404 && /EasyPanel/.test(e.message));
 await assert.rejects(m.rotas['DELETE /api/integrations/credentials/:provider/:nome']({ client: m.client, params: { provider: 'vercel', nome: 'OUTRA' }, operator: OPERADOR }), e => e.status === 404);
});

// ---------- os módulos antigos enxergam a tela sem mudar a leitura ----------
test('os módulos que leem `env.X` passam a ver o valor da tela: registro de deploys, estado das integrações e DNS', async () => {
 const v = criarEnvVivo({ base: { ...BASE }, log: mudo });
 assert.equal(buildRegistry(v.env).length, 0);
 assert.equal(estadoDasIntegracoes(v.env).find(i => i.id === 'vercel').estado, 'nao_configurado');
 await v.carregar(bancoCom([linha('VERCEL_TOKEN', 'token-da-tela-1234')]));
 assert.equal(buildRegistry(v.env).length, 1, 'o token da tela cria o provedor');
 assert.equal(estadoDasIntegracoes(v.env).find(i => i.id === 'vercel').estado, 'configurado');
 // o adaptador de DNS relê o ambiente vivo a cada uso
 const antes = processoVivo._sobre.size;
 processoVivo._sobre.set('HOSTINGER_API_KEY', 'chave-da-tela-1234'); processoVivo._sobre.set('HOSTINGER_DNS_ZONE', 'exemplo.test');
 try {
  const chamadas = [];
  const dns = createHostingerDnsAdapterVivo({ fetchImpl: async url => { chamadas.push(String(url)); return resposta([]); } });
  assert.equal(dns.configured, true);
  assert.equal((await dns.readZone()).status, 'ok');
  assert.ok(chamadas[0].includes('/zones/exemplo.test'));
  processoVivo._sobre.set('HOSTINGER_DNS_ZONE', 'zona inválida');
  assert.equal((await dns.readZone()).status, 'invalid', 'configuração inválida vira estado, não exceção');
 } finally { processoVivo._sobre.delete('HOSTINGER_API_KEY'); processoVivo._sobre.delete('HOSTINGER_DNS_ZONE'); assert.equal(processoVivo._sobre.size, antes); }
 // rota de deploys: função é consultada a cada pedido; lista fixa (testes) continua valendo
 let n = 0; const rotas = {};
 deploysRoutes({ get: (p, h) => { rotas[p] = h; } }, { registry: () => { n++; return []; } });
 const r = reply();
 await rotas['/api/deploys']({ url: new URL('http://x.test/api/deploys'), reply: r.fn });
 await rotas['/api/deploys']({ url: new URL('http://x.test/api/deploys'), reply: r.fn });
 assert.equal(n, 2); assert.equal(r.s.corpo.configured, false);
});

test('migração 050: só adiciona, uma credencial ativa por nome e o histórico não tem coluna de valor', async () => {
 const { readFileSync } = await import('node:fs');
 const sql = readFileSync(new URL('../../db/migrations/050_credenciais_de_integracao.sql', import.meta.url), 'utf8');
 const limpo = sql.replace(/--.*$/gm, '');
 assert.ok(!/\bDROP\b|\bDELETE\b|\bTRUNCATE\b/i.test(limpo));
 assert.match(limpo, /UNIQUE INDEX IF NOT EXISTS integration_credentials_ativa ON integration_credentials \(nome\) WHERE revoked_at IS NULL/);
 const historico = limpo.slice(limpo.indexOf('CREATE TABLE IF NOT EXISTS integration_credentials_history'));
 assert.ok(!/ciphertext|token_|valor|value/i.test(historico.split(');')[0]), 'o histórico nunca guarda valor');
 const app = readFileSync(new URL('../../apps/api/src/app.mjs', import.meta.url), 'utf8');
 assert.match(app, /integrationsCredentialsRoutes\(router/); assert.match(app, /await vivo\.garantir\(pool\)/);
});

// ---------- etapa 2: notificações push (chaves VAPID pela tela) ----------
import { parDeChavesConfere } from '../../apps/api/src/platform/credenciais.mjs';
import { gerarChavesVapid, vapidConfig, senderDe, senderPadrao, _reiniciarSenderPadrao } from '../../apps/api/src/platform/webpush.mjs';
import { pushRoutes } from '../../apps/api/src/modules/push.mjs';

test('VAPID: formato de cada campo e o par precisa conferir (pública nasce da privada)', async () => {
 const par = gerarChavesVapid();
 assert.equal(par.publicKey.length, 87); assert.equal(par.privateKey.length, 43);
 assert.equal(parDeChavesConfere(par.publicKey, par.privateKey), true);
 const outro = gerarChavesVapid();
 assert.equal(parDeChavesConfere(par.publicKey, outro.privateKey), false, 'par trocado é detectado');
 assert.equal(parDeChavesConfere('lixo', 'lixo'), false);
 const ok = validarValores('push', { VAPID_PUBLIC_KEY: par.publicKey, VAPID_PRIVATE_KEY: par.privateKey, VAPID_SUBJECT: 'https://core.exemplo.test' }, fail);
 assert.equal(Object.keys(ok).length, 3);
 const recusa = (v, re) => assert.throws(() => validarValores('push', v, fail), e => e.status === 400 && re.test(e.message));
 recusa({ VAPID_PUBLIC_KEY: 'curta' }, /87 caracteres/);
 recusa({ VAPID_PRIVATE_KEY: par.publicKey }, /43 caracteres/);
 recusa({ VAPID_SUBJECT: 'http://inseguro.test' }, /https/);
 recusa({ VAPID_SUBJECT: 'contato@exemplo.test' }, /mailto/);
 assert.equal(validarValores('push', { VAPID_SUBJECT: 'mailto:eu@exemplo.test' }, fail).VAPID_SUBJECT, 'mailto:eu@exemplo.test');
 // Testar: só confere o par, não envia aviso nenhum
 const certo = await testarProvedor('push', { VAPID_PUBLIC_KEY: par.publicKey, VAPID_PRIVATE_KEY: par.privateKey, VAPID_SUBJECT: 'https://x.test' }, () => '');
 assert.deepEqual([certo.ok, /Nenhum aviso foi enviado/.test(certo.mensagem)], [true, true]);
 const errado = await testarProvedor('push', { VAPID_PUBLIC_KEY: par.publicKey, VAPID_PRIVATE_KEY: outro.privateKey, VAPID_SUBJECT: 'https://x.test' }, () => '');
 assert.equal(errado.ok, false); assert.match(errado.mensagem, /não é a par/); assert.ok(!errado.mensagem.includes(outro.privateKey));
});

test('gerar chaves: guarda as três cifradas, devolve SÓ a pública, e desativa os aparelhos antigos', async () => {
 const m = montar({ env: { ...BASE, PUBLIC_ORIGIN: 'https://core.exemplo.test' }, db: { 'UPDATE push_subscriptions': () => ({ rowCount: 3, rows: [] }) } });
 const r = await m.rotas['POST /api/integrations/credentials/push/gerar']({ client: m.client, body: {}, operator: OPERADOR });
 assert.equal(m.regs['POST /api/integrations/credentials/push/gerar'].transactional, true);
 assert.deepEqual(Object.keys(r.response).sort(), ['aparelhos_desativados', 'assunto', 'ok', 'publica']);
 assert.equal(r.response.assunto, 'https://core.exemplo.test', 'assunto padrão: o endereço público do Core');
 assert.equal(r.response.aparelhos_desativados, 3);
 const ins = m.log.filter(q => q.sql.startsWith('INSERT INTO integration_credentials('));
 assert.deepEqual(ins.map(q => q.params[1]), ['VAPID_PUBLIC_KEY', 'VAPID_PRIVATE_KEY', 'VAPID_SUBJECT']);
 const privada = open({ ciphertext: ins[1].params[2], iv: ins[1].params[3], tag: ins[1].params[4] }, CHAVE);
 const publica = open({ ciphertext: ins[0].params[2], iv: ins[0].params[3], tag: ins[0].params[4] }, CHAVE);
 assert.equal(publica, r.response.publica); assert.equal(parDeChavesConfere(publica, privada), true, 'o par gravado confere');
 assert.ok(!JSON.stringify(r.response).includes(privada), 'a privada não volta');
 assert.ok(m.log.some(q => q.sql.startsWith('UPDATE push_subscriptions SET revoked_at')));
 assert.ok(!JSON.stringify(m.log.map(q => q.params.map(p => (Buffer.isBuffer(p) ? '' : String(p))))).includes(privada), 'a privada em claro não vai ao banco');
});

test('gerar chaves: havendo chaves hoje exige confirmação; sem assunto válido, 400; sem chave de cifra, 503; sem a 050, 409', async () => {
 const comChaves = montar({ env: { ...BASE, PUBLIC_ORIGIN: 'https://core.exemplo.test', VAPID_PUBLIC_KEY: 'x'.repeat(87), VAPID_PRIVATE_KEY: 'y'.repeat(43) } });
 await assert.rejects(comChaves.rotas['POST /api/integrations/credentials/push/gerar']({ client: comChaves.client, body: {}, operator: OPERADOR }), e => e.status === 409 && /Confirme/.test(e.message));
 assert.equal(comChaves.log.filter(q => q.sql.includes('INSERT')).length, 0, 'sem confirmação nada muda');
 const confirmou = await comChaves.rotas['POST /api/integrations/credentials/push/gerar']({ client: comChaves.client, body: { confirmar: true }, operator: OPERADOR });
 assert.equal(confirmou.response.ok, true);
 const semAssunto = montar({ env: { ...BASE } });
 await assert.rejects(semAssunto.rotas['POST /api/integrations/credentials/push/gerar']({ client: semAssunto.client, body: {}, operator: OPERADOR }), e => e.status === 400 && /Assunto/.test(e.message));
 const comAssunto = await semAssunto.rotas['POST /api/integrations/credentials/push/gerar']({ client: semAssunto.client, body: { subject: 'mailto:eu@exemplo.test' }, operator: OPERADOR });
 assert.equal(comAssunto.response.assunto, 'mailto:eu@exemplo.test');
 const semChave = montar({ env: { PUBLIC_ORIGIN: 'https://core.exemplo.test' } });
 await assert.rejects(semChave.rotas['POST /api/integrations/credentials/push/gerar']({ client: semChave.client, body: {}, operator: OPERADOR }), e => e.status === 503);
 const semMigracao = montar({ env: { ...BASE, PUBLIC_ORIGIN: 'https://core.exemplo.test' }, db: { 'SELECT 1 FROM integration_credentials': () => Object.assign(new Error('relation'), { code: '42P01' }) } });
 await assert.rejects(semMigracao.rotas['POST /api/integrations/credentials/push/gerar']({ client: semMigracao.client, body: {}, operator: OPERADOR }), e => e.status === 409 && e.message === MENSAGEM_050);
});

test('o push lê as chaves a CADA pedido: chaves definidas pela tela valem sem reiniciar, e o envio é refeito quando elas mudam', async () => {
 const rotas = {};
 pushRoutes({ get: (p, h) => { rotas['GET ' + p] = h; }, post: (p, h) => { rotas['POST ' + p] = h; }, put: (p, h) => { rotas['PUT ' + p] = h; }, delete: (p, h) => { rotas['DELETE ' + p] = h; } });
 const consulta = async () => { let saida; await rotas['GET /api/push/config']({ reply: (s, c) => { saida = c; } }); return saida; };
 assert.equal((await consulta()).enabled, false, 'sem chaves, desligado');
 const par = gerarChavesVapid();
 const antes = processoVivo._sobre.size;
 for (const [k, v] of [['VAPID_PUBLIC_KEY', par.publicKey], ['VAPID_PRIVATE_KEY', par.privateKey], ['VAPID_SUBJECT', 'https://core.exemplo.test']]) processoVivo._sobre.set(k, v);
 try {
  const c = await consulta();
  assert.deepEqual([c.enabled, c.publicKey], [true, par.publicKey], 'a chave da tela aparece sem reiniciar');
  _reiniciarSenderPadrao();
  const a = senderPadrao(); assert.equal(typeof a, 'function'); assert.equal(senderPadrao(), a, 'mesmas chaves: reaproveita o envio');
  const novo = gerarChavesVapid();
  processoVivo._sobre.set('VAPID_PUBLIC_KEY', novo.publicKey); processoVivo._sobre.set('VAPID_PRIVATE_KEY', novo.privateKey);
  assert.notEqual(senderPadrao(), a, 'chaves novas: envio refeito');
  assert.equal((await consulta()).publicKey, novo.publicKey);
 } finally { for (const k of ['VAPID_PUBLIC_KEY', 'VAPID_PRIVATE_KEY', 'VAPID_SUBJECT']) processoVivo._sobre.delete(k); _reiniciarSenderPadrao(); assert.equal(processoVivo._sobre.size, antes); }
 assert.equal((await consulta()).enabled, false, 'tirou as chaves, desliga');
 assert.equal(senderDe(null), null);
});

// ---------- etapa 3: Stripe e Asaas (dinheiro e webhooks) ----------
import { createStripeSales, createAsaasSales } from '../../apps/api/src/integrations/payment-sales.mjs';
import { readFileSync } from 'node:fs';

const SK = 'sk_live_' + 'A1b2C3d4E5f6G7h8'; const SK_TESTE = 'sk_test_' + 'A1b2C3d4E5f6G7h8';
const PK_LIVE = 'pk_live_' + 'Z9y8X7w6V5u4T3s2'; const PK_TESTE = 'pk_test_' + 'Z9y8X7w6V5u4T3s2';
const WH = 'whsec_' + 'abcdef0123456789ABCDEF';

test('Stripe e Asaas: formato de cada campo', () => {
 const ok = validarValores('stripe', { STRIPE_SECRET_KEY: SK, STRIPE_PUBLISHABLE_KEY: PK_LIVE, STRIPE_WEBHOOK_SECRET: WH }, fail);
 assert.equal(Object.keys(ok).length, 3);
 assert.equal(validarValores('stripe', { STRIPE_SECRET_KEY: 'rk_live_' + 'Qwerty1234567890' }, fail).STRIPE_SECRET_KEY.startsWith('rk_live_'), true, 'chave restrita vale');
 const recusa = (p, v, re) => assert.throws(() => validarValores(p, v, fail), e => e.status === 400 && re.test(e.message));
 recusa('stripe', { STRIPE_SECRET_KEY: 'pk_live_' + 'Z9y8X7w6V5u4T3s2' }, /sk_live_/);
 recusa('stripe', { STRIPE_SECRET_KEY: 'sk_live_curta' }, /inválida/);
 recusa('stripe', { STRIPE_PUBLISHABLE_KEY: SK }, /pk_live_/);
 recusa('stripe', { STRIPE_WEBHOOK_SECRET: 'segredo-qualquer-1234567' }, /whsec_/);
 recusa('asaas', { ASAAS_ENVIRONMENT: 'producao' }, /production ou sandbox/);
 recusa('asaas', { ASAAS_WEBHOOK_TOKEN: 'curto' }, /16 a 255/);
 assert.equal(validarValores('asaas', { ASAAS_API_KEY: '$aact_YTU5YTE0M2M2N2I4MTliNzk0YTI5N2U5MzdjNWZmNDQ6OjAwMDAwMDAwMDAwMDAwNjU0NzE6OiRhYWNoXzM0' }, fail).ASAAS_API_KEY.startsWith('$aact_'), true, 'a chave real do Asaas começa com $');
 for (const id of ['stripe', 'asaas']) for (const c of PROVEDORES[id].campos) assert.match(c.nome, /^[A-Z][A-Z0-9_]{2,63}$/);
});

test('Stripe: Testar confere a chave no Stripe, o modo das duas chaves e o formato do webhook, sem ecoar segredo', async () => {
 const chamadas = [];
 const rede = status => async (url, o = {}) => { chamadas.push({ url: String(url), auth: o.headers?.Authorization }); return resposta({}, status); };
 const bom = await testarProvedor('stripe', { STRIPE_SECRET_KEY: SK, STRIPE_PUBLISHABLE_KEY: PK_LIVE, STRIPE_WEBHOOK_SECRET: WH }, () => '', rede(200));
 assert.equal(bom.ok, true, bom.mensagem);
 assert.match(bom.mensagem, /modo live/); assert.match(bom.mensagem, /mesmo modo/); assert.match(bom.mensagem, /só um evento real confirma/);
 assert.deepEqual([chamadas[0].url, chamadas[0].auth], ['https://api.stripe.com/v1/balance', `Bearer ${SK}`]);
 const teste = await testarProvedor('stripe', { STRIPE_SECRET_KEY: SK_TESTE }, () => '', rede(200));
 assert.match(teste.mensagem, /modo test/);
 const misturado = await testarProvedor('stripe', { STRIPE_SECRET_KEY: SK, STRIPE_PUBLISHABLE_KEY: PK_TESTE }, () => '', rede(200));
 assert.equal(misturado.ok, false); assert.match(misturado.mensagem, /modos diferentes/);
 const recusada = await testarProvedor('stripe', { STRIPE_SECRET_KEY: SK }, () => '', rede(401));
 assert.equal(recusada.ok, false); assert.match(recusada.mensagem, /recusou a chave secreta/); assert.ok(!recusada.mensagem.includes(SK));
 // só o segredo do webhook no pedido: a chave que já vale (servidor ou tela) é a testada
 const so = await testarProvedor('stripe', { STRIPE_WEBHOOK_SECRET: WH }, n => (n === 'STRIPE_SECRET_KEY' ? SK : ''), rede(200));
 assert.equal(so.ok, true, so.mensagem); assert.equal(chamadas.at(-1).auth, `Bearer ${SK}`);
});

test('Asaas: Testar usa o ambiente certo (sandbox por padrão) e explica chave do ambiente errado', async () => {
 const chamadas = [];
 const rede = status => async (url, o = {}) => { chamadas.push({ url: String(url), chave: o.headers?.access_token }); return resposta({}, status); };
 const sand = await testarProvedor('asaas', { ASAAS_API_KEY: '$aact_chave-de-teste-123' }, () => '', rede(200));
 assert.match(sand.mensagem, /ambiente sandbox/); assert.ok(chamadas[0].url.startsWith('https://api-sandbox.asaas.com/v3/finance/balance'));
 const prod = await testarProvedor('asaas', { ASAAS_API_KEY: '$aact_chave-real-1234567', ASAAS_ENVIRONMENT: 'production', ASAAS_WEBHOOK_TOKEN: 'token-do-webhook-1234' }, () => '', rede(200));
 assert.match(prod.mensagem, /ambiente production/); assert.match(prod.mensagem, /só um evento real/);
 assert.ok(chamadas[1].url.startsWith('https://api.asaas.com/v3/finance/balance'));
 const errada = await testarProvedor('asaas', { ASAAS_API_KEY: '$aact_chave-real-1234567' }, () => '', rede(401));
 assert.equal(errada.ok, false); assert.match(errada.mensagem, /Confira se a chave é do ambiente certo/); assert.ok(!errada.mensagem.includes('chave-real'));
});

test('trocar chave, ambiente ou webhook JÁ EM USO exige confirmação; definir pela primeira vez e campos comuns, não', async () => {
 const rede = async () => resposta({ available: [] });
 // chave do Stripe em uso (vem do servidor): trocar pede confirmação
 const m = montar({ env: { ...BASE, STRIPE_SECRET_KEY: SK }, fetchImpl: rede });
 await assert.rejects(m.rotas['PUT /api/integrations/credentials']({ client: m.client, body: { provider: 'stripe', valores: { STRIPE_SECRET_KEY: 'sk_live_' + 'Novo1234567890AB' } }, operator: OPERADOR }),
  e => e.status === 409 && /Confirme a troca/.test(e.message) && /muda a conta usada nas cobranças/.test(e.message));
 assert.equal(m.log.filter(q => q.sql.includes('INSERT')).length, 0, 'sem confirmação nada muda');
 const ok = await m.rotas['PUT /api/integrations/credentials']({ client: m.client, body: { provider: 'stripe', valores: { STRIPE_SECRET_KEY: 'sk_live_' + 'Novo1234567890AB' }, confirmar: true }, operator: OPERADOR });
 assert.deepEqual(ok.response.campos, ['STRIPE_SECRET_KEY']);
 // segredo de webhook em uso: a mensagem diz que o painel do Stripe precisa ter o mesmo valor
 const w = montar({ env: { ...BASE, STRIPE_SECRET_KEY: SK, STRIPE_WEBHOOK_SECRET: WH }, fetchImpl: rede });
 await assert.rejects(w.rotas['PUT /api/integrations/credentials']({ client: w.client, body: { provider: 'stripe', valores: { STRIPE_WEBHOOK_SECRET: 'whsec_' + 'zzzzzzzz00000000AAAA' } }, operator: OPERADOR }), e => e.status === 409 && /MESMO valor/.test(e.message));
 // primeira definição (nada em uso): sem confirmação
 const novo = montar({ env: { ...BASE }, fetchImpl: rede });
 const primeira = await novo.rotas['PUT /api/integrations/credentials']({ client: novo.client, body: { provider: 'asaas', valores: { ASAAS_API_KEY: '$aact_primeira-chave-123' } }, operator: OPERADOR });
 assert.equal(primeira.response.ok, true);
 // campo que não é crítico (chave publicável), mesmo havendo uma em uso: sem confirmação
 const pub = montar({ env: { ...BASE, STRIPE_SECRET_KEY: SK, STRIPE_PUBLISHABLE_KEY: PK_LIVE }, fetchImpl: rede });
 const trocouPub = await pub.rotas['PUT /api/integrations/credentials']({ client: pub.client, body: { provider: 'stripe', valores: { STRIPE_PUBLISHABLE_KEY: 'pk_live_' + 'Outra1234567890A' } }, operator: OPERADOR });
 assert.equal(trocouPub.response.ok, true);
});

test('remover um campo crítico exige confirmação (?confirmar=1); campo comum, não', async () => {
 const m = montar({ db: { 'UPDATE integration_credentials SET revoked_at=now() WHERE nome': () => ({ rowCount: 1, rows: [{ fingerprint: 'abcd1234abcd1234' }] }) } });
 const sem = new URL('http://x.test/api/integrations/credentials/asaas/ASAAS_WEBHOOK_TOKEN');
 await assert.rejects(m.rotas['DELETE /api/integrations/credentials/:provider/:nome']({ client: m.client, params: { provider: 'asaas', nome: 'ASAAS_WEBHOOK_TOKEN' }, operator: OPERADOR, url: sem }), e => e.status === 409 && /Confirme a remoção/.test(e.message) && /MESMO valor/.test(e.message));
 assert.equal(m.log.length, 0, 'sem confirmação nada muda');
 const com = new URL('http://x.test/api/integrations/credentials/asaas/ASAAS_WEBHOOK_TOKEN?confirmar=1');
 assert.deepEqual((await m.rotas['DELETE /api/integrations/credentials/:provider/:nome']({ client: m.client, params: { provider: 'asaas', nome: 'ASAAS_WEBHOOK_TOKEN' }, operator: OPERADOR, url: com })).response, { ok: true });
 const comum = await m.rotas['DELETE /api/integrations/credentials/:provider/:nome']({ client: m.client, params: { provider: 'stripe', nome: 'STRIPE_PUBLISHABLE_KEY' }, operator: OPERADOR, url: new URL('http://x.test/x') });
 assert.deepEqual(comum.response, { ok: true });
});

test('GET marca os campos críticos com o aviso de troca; segredo de dinheiro nunca volta', async () => {
 const m = montar({ env: { ...BASE, STRIPE_SECRET_KEY: SK, ASAAS_API_KEY: '$aact_SEGREDO-do-asaas-1', STRIPE_PUBLISHABLE_KEY: PK_LIVE } });
 const r = reply();
 await m.rotas['GET /api/integrations/credentials']({ pool: m.pool, reply: r.fn });
 const campo = (id, nome) => r.s.corpo.provedores.find(p => p.id === id).campos.find(c => c.nome === nome);
 assert.deepEqual([campo('stripe', 'STRIPE_SECRET_KEY').critico, campo('stripe', 'STRIPE_PUBLISHABLE_KEY').critico], [true, false]);
 assert.match(campo('stripe', 'STRIPE_WEBHOOK_SECRET').aviso_troca, /MESMO valor/);
 assert.equal(campo('stripe', 'STRIPE_PUBLISHABLE_KEY').valor, PK_LIVE, 'chave publicável não é segredo');
 const texto = JSON.stringify(r.s.corpo);
 assert.ok(!texto.includes(SK) && !texto.includes('SEGREDO-do-asaas'));
});

test('as rotas de cobrança leem o ambiente vivo: a chave da tela vale sem reiniciar', async () => {
 const antes = processoVivo._sobre.size;
 const chamadas = [];
 const fetcher = async (url, o = {}) => { chamadas.push({ url: String(url), auth: o.headers?.Authorization, chave: o.headers?.access_token }); return resposta({ data: [], has_more: false }); };
 try {
  await assert.rejects(createStripeSales({ fetcher })('2026-09'), e => e.status === 503, 'sem chave: não configurada');
  processoVivo._sobre.set('STRIPE_SECRET_KEY', SK);
  await createStripeSales({ fetcher })('2026-09');
  assert.equal(chamadas.at(-1).auth, `Bearer ${SK}`, 'a chave da tela foi usada');
  processoVivo._sobre.set('ASAAS_API_KEY', '$aact_da-tela-1234567'); processoVivo._sobre.set('ASAAS_ENVIRONMENT', 'production');
  await createAsaasSales({ fetcher })('2026-09');
  assert.ok(chamadas.at(-1).url.startsWith('https://api.asaas.com/v3/payments'), 'o ambiente da tela decide a URL');
  assert.equal(chamadas.at(-1).chave, '$aact_da-tela-1234567');
 } finally { for (const k of ['STRIPE_SECRET_KEY', 'ASAAS_API_KEY', 'ASAAS_ENVIRONMENT']) processoVivo._sobre.delete(k); assert.equal(processoVivo._sobre.size, antes); }
 // os demais módulos de cobrança usam o mesmo ambiente por padrão (não o process.env congelado)
 for (const arquivo of ['modules/payment-sales.mjs', 'modules/payment-webhooks.mjs', 'modules/product-payments.mjs', 'modules/stripe-catalog.mjs', 'modules/checkout-gateway.mjs', 'integrations/payment-sales.mjs']) {
  const fonte = readFileSync(new URL(`../../apps/api/src/${arquivo}`, import.meta.url), 'utf8');
  assert.match(fonte, /env-vivo\.mjs/, arquivo); assert.match(fonte, /env\s*=\s*vivo\.env/, arquivo);
 }
});

// ---------- etapa 4: Pluggy (bancos) ----------
import { createPluggy } from '../../apps/api/src/integrations/pluggy.mjs';
import { itensDePluggy } from '../../apps/api/src/platform/credenciais.mjs';

test('Pluggy: formato dos campos e lista de itens sem repetição', () => {
 const ok = validarValores('pluggy', { PLUGGY_CLIENT_ID: 'abc12345-def6-7890', PLUGGY_CLIENT_SECRET: 'segredo-da-pluggy-1234', PLUGGY_ITEM_IDS: 'item-1, item_2 ,item-1' }, fail);
 assert.equal(ok.PLUGGY_ITEM_IDS, 'item-1, item_2 ,item-1');
 assert.deepEqual(itensDePluggy(ok.PLUGGY_ITEM_IDS), ['item-1', 'item_2'], 'sem repetição e sem espaços');
 const recusa = (v, re) => assert.throws(() => validarValores('pluggy', v, fail), e => e.status === 400 && re.test(e.message));
 recusa({ PLUGGY_CLIENT_ID: 'curto' }, /inválido/);
 recusa({ PLUGGY_ITEM_IDS: 'item com espaço,outro' }, /só letras/);
 recusa({ PLUGGY_ITEM_IDS: Array.from({ length: 21 }, (_, i) => `item-${i}`).join(',') }, /No máximo 20/);
 recusa({ PLUGGY_ITEM_IDS: ' , ' }, /pelo menos um/);
});

test('Pluggy: Testar autentica, confere cada item e diz qual não existe; sem ecoar segredo', async () => {
 const SEGREDO = 'segredo-PLUGGY-987654321';
 const chamadas = [];
 const rede = (itensOk = ['item-1', 'item-2'], authStatus = 200) => async (url, o = {}) => {
  const u = String(url); chamadas.push({ url: u, metodo: o.method || 'GET', chave: o.headers?.['X-API-KEY'], corpo: o.body });
  if (u.endsWith('/auth')) return authStatus === 200 ? resposta({ apiKey: 'AK-1' }) : resposta({}, authStatus);
  const id = decodeURIComponent(u.split('/items/')[1]);
  return resposta({}, itensOk.includes(id) ? 200 : 404);
 };
 const base = { PLUGGY_CLIENT_ID: 'abc12345-def6', PLUGGY_CLIENT_SECRET: SEGREDO };
 const sem = await testarProvedor('pluggy', base, () => '', rede());
 assert.equal(sem.ok, true); assert.match(sem.mensagem, /Nenhuma conexão \(item\) informada/);
 const dois = await testarProvedor('pluggy', { ...base, PLUGGY_ITEM_IDS: 'item-1,item-2' }, () => '', rede());
 assert.match(dois.mensagem, /as 2 conexões responderam/);
 assert.equal(chamadas.find(c => c.url.includes('/items/item-1')).chave, 'AK-1', 'o token obtido é usado nos itens');
 assert.deepEqual(JSON.parse(chamadas.find(c => c.url.endsWith('/auth')).corpo), { clientId: 'abc12345-def6', clientSecret: SEGREDO });
 const falta = await testarProvedor('pluggy', { ...base, PLUGGY_ITEM_IDS: 'item-1,item-x' }, () => '', rede(['item-1']));
 assert.equal(falta.ok, false); assert.match(falta.mensagem, /este item não foi encontrado nesta conta: item-x/);
 const recusada = await testarProvedor('pluggy', { ...base, PLUGGY_ITEM_IDS: 'item-1' }, () => '', rede([], 401));
 assert.equal(recusada.ok, false); assert.match(recusada.mensagem, /recusou o ID e o segredo/); assert.ok(!recusada.mensagem.includes(SEGREDO));
 // só os itens no pedido: ID e segredo que já valem (servidor ou tela) são usados na autenticação
 const mistura = await testarProvedor('pluggy', { PLUGGY_ITEM_IDS: 'item-2' }, n => ({ PLUGGY_CLIENT_ID: 'abc12345-def6', PLUGGY_CLIENT_SECRET: SEGREDO })[n] || '', rede());
 assert.equal(mistura.ok, true, mistura.mensagem);
});

test('Pluggy: trocar ID ou segredo descarta o token de acesso obtido com as credenciais antigas', async () => {
 const env = { PLUGGY_CLIENT_ID: 'cliente-antigo', PLUGGY_CLIENT_SECRET: 'segredo-antigo-123' };
 const auths = [];
 let n = 0;
 const fetcher = async (url, o = {}) => {
  const u = String(url);
  if (u.endsWith('/auth')) { auths.push(JSON.parse(o.body).clientId); return resposta({ apiKey: `chave-${++n}` }); }
  return resposta({ status: 'UPDATED', lastUpdatedAt: null, results: [] });
 };
 const p = createPluggy({ env, fetcher, clock: () => 0 });
 await p.accounts('item-1');
 await p.accounts('item-1');
 assert.deepEqual(auths, ['cliente-antigo'], 'mesmas credenciais: o token é reaproveitado');
 env.PLUGGY_CLIENT_ID = 'cliente-novo';
 await p.accounts('item-1');
 assert.deepEqual(auths, ['cliente-antigo', 'cliente-novo'], 'credencial trocada: autentica de novo, sem esperar o token vencer');
});

test('o Financeiro e a Pluggy leem o ambiente vivo por padrão', async () => {
 const { readFileSync } = await import('node:fs');
 for (const arquivo of ['modules/finance.mjs', 'integrations/pluggy.mjs']) {
  const fonte = readFileSync(new URL(`../../apps/api/src/${arquivo}`, import.meta.url), 'utf8');
  assert.match(fonte, /env-vivo\.mjs/, arquivo); assert.match(fonte, /env\s*=\s*vivo\.env/, arquivo);
 }
});

// ---------- etapa 5: Meta (só o aplicativo; a conta continua conectada dentro do produto) ----------
import { readKey } from '../../apps/api/src/platform/secrets.mjs';
import { chaveConfigurada, oauthConfigurado, modoDeLogin } from '../../apps/api/src/modules/marketing.mjs';

test('Meta: formato dos campos', () => {
 const ok = validarValores('meta', { META_APP_ID: '123456789012345', META_APP_SECRET: 'a1b2c3d4e5f6a7b8c9d0e1f2a3b4c5d6', META_LOGIN_CONFIG_ID: '987654321', META_REDIRECT_URI: 'https://core.exemplo.test/api/marketing/meta/callback' }, fail);
 assert.equal(Object.keys(ok).length, 4);
 const recusa = (v, re) => assert.throws(() => validarValores('meta', v, fail), e => e.status === 400 && re.test(e.message));
 recusa({ META_APP_ID: 'app-123' }, /só números/);
 recusa({ META_APP_ID: '123' }, /só números/);
 recusa({ META_LOGIN_CONFIG_ID: 'abc' }, /só números/);
 recusa({ META_REDIRECT_URI: 'http://inseguro.test/x' }, /https/);
 recusa({ META_REDIRECT_URI: 'https://x.test/cb?token=1' }, /parâmetros/);
 recusa({ META_APP_SECRET: 'curto' }, /8 a 500/);
});

test('Meta: Testar pede o token do aplicativo por POST (a chave nunca vai no endereço) e explica quando ID e chave não combinam', async () => {
 const SEGREDO = 'a1b2c3d4e5f6a7b8c9d0e1f2a3b4c5d6';
 const chamadas = [];
 const rede = (status, corpoJson = { access_token: 'APPTOKEN' }) => async (url, o = {}) => { chamadas.push({ url: String(url), metodo: o.method, corpo: String(o.body) }); return resposta(corpoJson, status); };
 const ok = await testarProvedor('meta', { META_APP_ID: '123456789012345', META_APP_SECRET: SEGREDO, META_LOGIN_CONFIG_ID: '987654321' }, () => '', rede(200));
 assert.equal(ok.ok, true, ok.mensagem); assert.match(ok.mensagem, /aceitou o ID e a chave secreta/); assert.match(ok.mensagem, /só uma conexão real confirma/);
 assert.equal(chamadas[0].metodo, 'POST'); assert.ok(!chamadas[0].url.includes(SEGREDO) && !chamadas[0].url.includes('?'), 'nada de segredo no endereço');
 assert.match(chamadas[0].corpo, /client_id=123456789012345/); assert.match(chamadas[0].corpo, /grant_type=client_credentials/);
 const recusada = await testarProvedor('meta', { META_APP_ID: '123456789012345', META_APP_SECRET: SEGREDO }, () => '', rede(400, { error: { message: 'Invalid client_secret' } }));
 assert.equal(recusada.ok, false); assert.match(recusada.mensagem, /mesmo aplicativo/); assert.ok(!recusada.mensagem.includes(SEGREDO));
 const semToken = await testarProvedor('meta', { META_APP_ID: '123456789012345', META_APP_SECRET: SEGREDO }, () => '', rede(200, {}));
 assert.equal(semToken.ok, false);
 const mistura = await testarProvedor('meta', { META_APP_SECRET: SEGREDO }, n => (n === 'META_APP_ID' ? '123456789012345' : ''), rede(200));
 assert.equal(mistura.ok, true, 'o ID que já vale (servidor ou tela) completa o pedido');
});

test('Meta: trocar o aplicativo (ID ou chave) em uso pede confirmação e avisa que a conta conectada pode cair; opcionais não', async () => {
 const rede = async () => resposta({ access_token: 'APPTOKEN' });
 const SEGREDO = 'a1b2c3d4e5f6a7b8c9d0e1f2a3b4c5d6';
 const m = montar({ env: { ...BASE, META_APP_ID: '123456789012345', META_APP_SECRET: SEGREDO }, fetchImpl: rede });
 await assert.rejects(m.rotas['PUT /api/integrations/credentials']({ client: m.client, body: { provider: 'meta', valores: { META_APP_ID: '999999999999999' } }, operator: OPERADOR }), e => e.status === 409 && /conectar de novo/.test(e.message));
 const ok = await m.rotas['PUT /api/integrations/credentials']({ client: m.client, body: { provider: 'meta', valores: { META_APP_ID: '999999999999999' }, confirmar: true }, operator: OPERADOR });
 assert.equal(ok.response.ok, true);
 const opc = montar({ env: { ...BASE, META_APP_ID: '123456789012345', META_APP_SECRET: SEGREDO }, fetchImpl: rede });
 assert.equal((await opc.rotas['PUT /api/integrations/credentials']({ client: opc.client, body: { provider: 'meta', valores: { META_LOGIN_CONFIG_ID: '987654321' } }, operator: OPERADOR })).response.ok, true, 'campo opcional não pede confirmação');
 const primeira = montar({ env: { ...BASE }, fetchImpl: rede });
 assert.equal((await primeira.rotas['PUT /api/integrations/credentials']({ client: primeira.client, body: { provider: 'meta', valores: { META_APP_ID: '123456789012345', META_APP_SECRET: SEGREDO } }, operator: OPERADOR })).response.ok, true, 'primeira definição não pede');
});

test('a chave que cifra o token da Meta: META_MARKETING_KEY se existir, senão a chave única do Core', () => {
 const k1 = randomBytes(32).toString('base64'), k2 = randomBytes(32).toString('base64');
 assert.deepEqual(readKey({ META_MARKETING_KEY: k1, CORE_SECRETS_KEY: k2 }), Buffer.from(k1, 'base64'), 'quem já tem a chave da Meta segue com ela');
 assert.deepEqual(readKey({ CORE_SECRETS_KEY: k2 }), Buffer.from(k2, 'base64'), 'só a chave única: vale');
 assert.deepEqual(readKey({ META_MARKETING_KEY: k1 }), Buffer.from(k1, 'base64'));
 assert.throws(() => readKey({}), e => e.status === 503 && /META_MARKETING_KEY/.test(e.message));
 assert.equal(chaveConfigurada({ CORE_SECRETS_KEY: k2 }), true);
 assert.equal(chaveConfigurada({}), false);
});

test('a Meta lê o ambiente vivo: ID e chave da tela fazem o OAuth ficar disponível sem reiniciar', async () => {
 const v = criarEnvVivo({ base: { ...BASE }, log: mudo });
 assert.equal(oauthConfigurado(v.env), false);
 const SEGREDO = 'a1b2c3d4e5f6a7b8c9d0e1f2a3b4c5d6';
 await v.carregar(bancoCom([linha('META_APP_ID', '123456789012345'), linha('META_APP_SECRET', SEGREDO)]));
 assert.equal(oauthConfigurado(v.env), true, 'ID e chave definidos pela tela ligam o OAuth');
 assert.equal(modoDeLogin(v.env), 'classic');
 await v.carregar(bancoCom([linha('META_APP_ID', '123456789012345'), linha('META_APP_SECRET', SEGREDO), linha('META_LOGIN_CONFIG_ID', '987654321')]));
 assert.equal(modoDeLogin(v.env), 'business');
 const { readFileSync } = await import('node:fs');
 const fonte = readFileSync(new URL('../../apps/api/src/modules/marketing.mjs', import.meta.url), 'utf8');
 assert.match(fonte, /env-vivo\.mjs/); assert.match(fonte, /env\s*=\s*vivo\.env/);
});
