// Tipo da atividade: com conteúdo, não troca. O servidor decide (tela e MCP passam por ele); a tela só avisa, com a mesma definição.
import test from 'node:test';
import assert from 'node:assert/strict';
import { exigirTipoLivre, descricaoVazia, temConteudoNaLinha, MENSAGEM_TIPO_TRAVADO } from '../../apps/api/src/platform/agenda-tipo.mjs';
import * as M from '../../apps/web/public/agenda-model.js';

const VAZIA = '{"time":1,"blocks":[],"version":"2.30.6"}';
const COM_TEXTO = '{"time":1,"blocks":[{"type":"paragraph","data":{"text":"oi"}}]}';

/** Banco falso: devolve a linha, e diz se há apontamento/vínculo. */
const bancoCom = ({ linha, apontamento = false, vinculo = false, temTabelaDeVinculos = true }) => ({
 consultas: [],
 async query(sql) {
  this.consultas.push(sql);
  if (/FROM service_activities/.test(sql)) return { rows: linha ? [linha] : [] };
  if (/FROM service_time_logs/.test(sql)) return { rows: apontamento ? [{}] : [] };
  if (/to_regclass/.test(sql)) return { rows: [{ t: temTabelaDeVinculos ? 'service_activity_links' : null }] };
  if (/FROM service_activity_links/.test(sql)) return { rows: vinculo ? [{}] : [] };
  assert.fail('consulta inesperada: ' + sql);
 },
});
const vazia = { id: 'a', kind: 'sessao', description: VAZIA, location: null, meeting_url: null, google_event_id: null };

test('descrição só com a casca vazia do editor não é conteúdo; texto antigo e bloco com texto são', () => {
 assert.equal(descricaoVazia(null), true);
 assert.equal(descricaoVazia('  '), true);
 assert.equal(descricaoVazia(VAZIA), true);
 assert.equal(descricaoVazia(COM_TEXTO), false);
 assert.equal(descricaoVazia('texto cru antigo'), false);
 assert.equal(M.descricaoVazia(VAZIA), true, 'a tela usa a mesma definição');
 assert.equal(M.descricaoVazia(COM_TEXTO), false);
});

test('sem pedir outro tipo, nem consulta o banco', async () => {
 const db = bancoCom({ linha: vazia });
 assert.equal(await exigirTipoLivre(db, 'a', undefined), null);
 assert.equal(db.consultas.length, 0);
});

test('atividade vazia troca de tipo; dentro do mesmo grupo (entregavel -> tarefa) sempre passa, mesmo com conteúdo', async () => {
 await exigirTipoLivre(bancoCom({ linha: vazia }), 'a', 'tarefa');
 const task = { ...vazia, kind: 'entregavel', description: COM_TEXTO };
 const db = bancoCom({ linha: task });
 await exigirTipoLivre(db, 'a', 'tarefa');
 assert.equal(db.consultas.length, 1, 'mesmo grupo: só leu a linha');
});

test('com conteúdo na própria linha, recusa com 409 e a mensagem; cada campo conta', async () => {
 for (const parte of [{ description: COM_TEXTO }, { location: 'Sala 2' }, { meeting_url: 'https://meet.google.com/x' }, { google_event_id: 'evt' }]) {
  const linha = { ...vazia, ...parte };
  assert.equal(temConteudoNaLinha(linha), true);
  await assert.rejects(exigirTipoLivre(bancoCom({ linha }), 'a', 'registro'), e => e.status === 409 && e.message === MENSAGEM_TIPO_TRAVADO);
 }
});

test('apontamento ou vínculo também travam; sem a tabela de vínculos (banco antigo) não há o que proteger', async () => {
 await assert.rejects(exigirTipoLivre(bancoCom({ linha: vazia, apontamento: true }), 'a', 'tarefa'), e => e.status === 409);
 await assert.rejects(exigirTipoLivre(bancoCom({ linha: vazia, vinculo: true }), 'a', 'tarefa'), e => e.status === 409);
 await exigirTipoLivre(bancoCom({ linha: vazia, vinculo: true, temTabelaDeVinculos: false }), 'a', 'tarefa');
});

test('atividade que não existe: segue (a rota responde o 409 de sempre)', async () => {
 assert.equal(await exigirTipoLivre(bancoCom({ linha: null }), 'a', 'tarefa'), null);
});

test('a tela lista o que impede a troca, com a mesma regra', () => {
 assert.deepEqual(M.conteudoDaAtividade({ description: VAZIA }), []);
 assert.equal(M.tipoTravado({ description: VAZIA }), false);
 assert.deepEqual(M.conteudoDaAtividade({ description: COM_TEXTO, location: 'Sala' }, { logs: [{}], links: [{}] }), ['descrição', 'local', 'apontamentos', 'vínculos']);
 assert.equal(M.tipoTravado({ description: '' , meeting_url: 'https://x.y' }), true);
});

// ---- Lista da agenda: alcance e filtros (regra pura, sem tela) ----
test('janela da Agenda: 31 dias como sempre; alcance 1 é só o dia; valor estranho volta ao padrão', () => {
 assert.deepEqual(M.janela('agenda', '2026-10-14'), { from: '2026-10-14', to: '2026-11-14' });
 assert.deepEqual(M.janela('agenda', '2026-10-14', '2026-10-14', 1), { from: '2026-10-14', to: '2026-10-15' });
 assert.deepEqual(M.janela('agenda', '2026-10-14', '2026-10-14', 7), { from: '2026-10-14', to: '2026-10-21' });
 assert.deepEqual(M.janela('agenda', '2026-10-14', '2026-10-14', 99), { from: '2026-10-14', to: '2026-11-14' });
 assert.deepEqual(M.janela('dia', '2026-10-14', '2026-10-14', 7), { from: '2026-10-14', to: '2026-10-15' }, 'o alcance só vale na lista');
});

test('navegar e título da Agenda acompanham o alcance', () => {
 assert.equal(M.navegar('agenda', '2026-10-14', 1), '2026-11-13', 'padrão: 30 dias, como antes');
 assert.equal(M.navegar('agenda', '2026-10-14', 1, 1), '2026-10-15');
 assert.equal(M.navegar('agenda', '2026-10-14', -1, 7), '2026-10-07');
 assert.equal(M.titulo('agenda', '2026-10-14', '2026-10-14', 1), M.titulo('dia', '2026-10-14'), 'um dia só: título do dia, não de uma faixa');
 assert.ok(M.titulo('agenda', '2026-10-14').includes('–'), 'padrão: faixa');
});

test('filtrar: cada critério isola, todos se somam, e "sem valor" pega quem não tem', () => {
 const e = (id, o) => ({ id, title: 'T' + id, tenant_name: 'Alfa', status: 'planned', category: 'outro', kind: 'tarefa', engagement_id: null, responsible_id: null, ...o });
 const lista = [e(1, { kind: 'sessao', responsible_id: 'r1', engagement_id: 'c1' }), e(2, { responsible_id: 'r2' }), e(3, { engagement_id: 'c1', status: 'done' })];
 const ids = f => M.filtrar(lista, f).map(x => x.id);
 assert.deepEqual(ids({}), [1, 2, 3]);
 assert.deepEqual(ids({ aba: 'call' }), [1]);
 assert.deepEqual(ids({ aba: 'task' }), [2, 3]);
 assert.deepEqual(ids({ engagement: 'c1' }), [1, 3]);
 assert.deepEqual(ids({ engagement: M.SEM_VALOR }), [2]);
 assert.deepEqual(ids({ responsavel: 'r2' }), [2]);
 assert.deepEqual(ids({ responsavel: M.SEM_VALOR }), [3]);
 const tagsDe = x => ({ 1: ['t1'], 2: ['t1', 't2'] }[x.id] || []);
 assert.deepEqual(ids({ tag: 't1', tagsDe }), [1, 2]);
 assert.deepEqual(ids({ tag: 't2', tagsDe }), [2]);
 assert.deepEqual(ids({ tag: M.SEM_VALOR, tagsDe }), [3]);
 assert.deepEqual(ids({ aba: 'task', engagement: 'c1' }), [3], 'somados');
 assert.deepEqual(ids({ status: 'done' }), [3]);
 const textoExtra = x => (x.id === 2 ? 'Beto Lima Urgente' : '');
 assert.deepEqual(ids({ texto: 'beto', textoExtra }), [2], 'o texto olha o que a tela passa (responsável, tags)');
 assert.deepEqual(ids({ texto: 'call' }), [1], 'e o tipo');
 assert.deepEqual(ids({ texto: 'CONCLUÍDA'.slice(0, 5) }), [3], 'e a situação, sem acento nem caixa');
});
