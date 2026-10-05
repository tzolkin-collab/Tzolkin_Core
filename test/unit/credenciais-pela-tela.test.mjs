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
 assert.deepEqual(Object.keys(PROVEDORES), ['vercel', 'github', 'easypanel', 'push', 'hostinger']);
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
