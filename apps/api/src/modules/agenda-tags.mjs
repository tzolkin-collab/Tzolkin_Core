// Tags da agenda (migração 056): catálogo, criação, revisão e as tags de cada atividade.
//
// Admin interno, como o resto da agenda. Ler é para qualquer operador logado; escrever exige quem trabalha (Administrador ou
// Membro), a mesma regra do comercial: Leitor lê as tags, não as cria nem as muda.
//
// Enquanto a migração 056 não está no banco as rotas de leitura respondem "indisponível" e as de escrita recusam com 409 e
// MENSAGEM_056, em vez de "relation does not exist".
import { input, isUuid, fail } from '../platform/http.mjs';
import { commercialPermission } from './commercial-keys.mjs';
import {
 criarDetectorTags, garantirTag, revisarTag, listarTags, definirTagsDaAtividade, autorDaPessoa, tagPublica as publica, MENSAGEM_056, TONS,
} from '../platform/agenda-tags.mjs';

export function agendaTagsRoutes(router, { detector = criarDetectorTags() } = {}) {
 const exigir = async db => { if (!(await detector(db))) throw fail(409, MENSAGEM_056); };

 router.get('/api/tags', async ({ pool, url, reply }) => {
  if (!(await detector(pool))) return reply(200, { available: false, tags: [], tones: TONS });
  reply(200, { available: true, tags: (await listarTags(pool, { arquivadas: url.searchParams.get('arquivadas') === '1' })).map(publica), tones: TONS });
 });

 // Criar é idempotente: pedir um nome que já existe devolve a tag que está lá (created:false), não um erro. É assim que a
 // tela, ao digitar "revisão técnica", acha a "Revisão Técnica" que já existe em vez de duplicar.
 router.post('/api/tags', async ({ client, body, operator }) => {
  await exigir(client);
  await commercialPermission(client, operator, true);
  const b = body; input(b, ['label', 'tone']);
  const { tag, criada } = await garantirTag(client, { label: b.label, tone: b.tone, autor: autorDaPessoa(operator) });
  return { body: { tag: publica(tag), created: criada }, type: criada ? 'agenda.tag.created' : 'agenda.tag.reused', tenant: null };
 }, { transactional: true, audit: false });

 // Revisar: aprovar, renomear, trocar a cor, arquivar ou reativar. A revisão lida é obrigatória.
 router.put('/api/tags/:id', async ({ client, params, body, operator }) => {
  await exigir(client);
  await commercialPermission(client, operator, true);
  if (!isUuid(params.id)) throw fail(400, 'Tag inválida.');
  const b = body; input(b, ['revision', 'label', 'tone', 'reviewed', 'archived']);
  if (!Number.isInteger(b.revision) || b.revision < 1) throw fail(400, 'Revisão inválida.');
  if (b.reviewed !== undefined && b.reviewed !== true) throw fail(400, 'A revisão só se aprova: para desfazer, arquive a tag.');
  if (b.archived !== undefined && typeof b.archived !== 'boolean') throw fail(400, 'Arquivar é verdadeiro ou falso.');
  const tag = await revisarTag(client, { id: params.id, revision: b.revision, label: b.label, tone: b.tone, reviewed: b.reviewed, archived: b.archived, autor: autorDaPessoa(operator) });
  return { body: { tag: publica(tag) }, type: 'agenda.tag.updated', tenant: null };
 }, { transactional: true, audit: false });

 // As tags de uma atividade. A revisão da ATIVIDADE é obrigatória e sobe: duas pessoas mexendo ao mesmo tempo não se sobrescrevem.
 router.put('/api/tracking/:id/tags', async ({ client, params, body, operator }) => {
  await exigir(client);
  await commercialPermission(client, operator, true);
  if (!isUuid(params.id)) throw fail(400, 'Atividade inválida.');
  const b = body; input(b, ['tags', 'revision']);
  if (!Array.isArray(b.tags) || !b.tags.every(isUuid) || !Number.isInteger(b.revision) || b.revision < 1) throw fail(400, 'Tags ou revisão inválidas.');
  const atividade = (await client.query('SELECT id,revision,archived_at FROM service_activities WHERE id=$1 FOR UPDATE', [params.id])).rows[0];
  if (!atividade) throw fail(404, 'Atividade não encontrada.');
  if (atividade.revision !== b.revision) throw fail(409, 'Registro alterado ou inexistente. Atualize a agenda.');
  const autor = autorDaPessoa(operator);
  const { adicionadas, removidas } = await definirTagsDaAtividade(client, { atividadeId: params.id, tagIds: b.tags, autor });
  if (!adicionadas.length && !removidas.length) return { body: { activity: { id: params.id, revision: atividade.revision }, changed: false }, type: 'agenda.tags.unchanged', tenant: null };
  const row = (await client.query('UPDATE service_activities SET revision=revision+1, updated_at=now() WHERE id=$1 RETURNING *', [params.id])).rows[0];
  await client.query('INSERT INTO service_activity_audit(activity_id,action,actor,details) VALUES($1,$2,$3,$4)',
   [params.id, 'tags_changed', operator?.email || operator?.subject || 'unknown', { adicionadas, removidas, revision: b.revision }]);
  return { body: { activity: row, changed: true }, type: 'agenda.tags.changed', tenant: null };
 }, { transactional: true, audit: false });
}
