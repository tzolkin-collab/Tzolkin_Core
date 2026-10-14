// Tags da agenda (migração 056): a lógica que a tela (rotas) e a IA (MCP) compartilham.
//
// Fica num lugar só para as duas portas se comportarem igual: o mesmo nome vira o mesmo slug, a mesma tag não nasce duas
// vezes, e a regra de revisão (pessoa nasce revisada, IA nasce "sugerida" e vale na hora) não depende de quem chama.
//
// Sem HTTP aqui. Quem chama passa um `db` (client dentro de uma transação, ou pool) e quem está agindo.
import { fail, text } from './http.mjs';

export const TONS = Object.freeze(['accent', 'info', 'success', 'warning', 'danger', 'neutral']);
export const MAX_TAGS_POR_ATIVIDADE = 12;
export const MENSAGEM_056 = 'As tags ainda não estão disponíveis neste banco: falta aplicar a migração 056.';

/**
 * O nome vira o identificador: sem acento, minúsculo, hífen no lugar do resto. "Revisão Técnica" e "revisao tecnica"
 * são a MESMA tag, e é por isso que a IA, que escreve de um jeito diferente a cada vez, não multiplica tags parecidas.
 */
export function slugDaTag(label) {
 const slug = String(label ?? '').normalize('NFD').replace(/[̀-ͯ]/g, '').toLowerCase()
  .replace(/[^a-z0-9]+/g, '-').replace(/^-+|-+$/g, '').slice(0, 40).replace(/-+$/g, '');
 if (!slug) throw fail(400, 'Nome de tag inválido: use letras ou números.');
 return slug;
}

/** Valida nome e cor de uma tag. Sem cor, neutra. */
export function tagInput(b) {
 const label = text(b?.label, 2, 40);
 const tone = b?.tone === undefined || b?.tone === null || b?.tone === '' ? 'neutral' : b.tone;
 if (!TONS.includes(tone)) throw fail(400, 'Cor de tag inválida.');
 return { label, tone, slug: slugDaTag(label) };
}

/**
 * A migração 056 chegou ao banco? Lembrado: verdadeiro nunca volta a falso; falso só é reverificado depois de `ttl`, para a
 * primeira consulta depois de aplicar já enxergar o recurso. Lê o catálogo do Postgres (como o detector do Registro) e não
 * information_schema, para não se misturar com a conta de perguntas do detector da 047/048.
 */
export function criarDetectorTags({ relogio = Date.now, ttl = 60000 } = {}) {
 let ok = false, verificadoEm = -Infinity;
 return async function tagsDisponiveis(db) {
  if (ok) return true;
  if (relogio() - verificadoEm < ttl) return false;
  verificadoEm = relogio();
  const r = await db.query(
   `SELECT (to_regclass(current_schema() || '.agenda_tags') IS NOT NULL AND to_regclass(current_schema() || '.service_activity_tags') IS NOT NULL) AS ok`);
  ok = r.rows[0]?.ok === true;
  return ok;
 };
}

/** Quem agiu, no formato que fica gravado: "person:<e-mail>" ou "ai:<ator>". Revela de onde veio cada tag. */
export const autorDaPessoa = operator => `person:${operator?.email || operator?.subject || 'desconhecido'}`;
export const autorDaIa = ator => `ai:${String(ator || 'mcp').slice(0, 80)}`;
const origemDe = autor => (String(autor).startsWith('ai:') ? 'ai' : 'person');

/**
 * Garante que a tag existe e devolve { tag, criada }. Se já existe (mesmo slug), devolve a que está lá — é assim que "Revisão
 * Técnica" e "revisao tecnica" viram uma tag só. Tag arquivada que alguém volta a pedir é reativada; se quem pede é a IA, ela
 * volta marcada para revisar, porque alguém tinha decidido tirá-la de circulação.
 */
export async function garantirTag(db, { label, tone = 'neutral', autor }) {
 const v = tagInput({ label, tone });
 const origem = origemDe(autor);
 const nova = (await db.query(
  `INSERT INTO agenda_tags(slug,label,tone,origin,created_by,reviewed_at,reviewed_by)
   VALUES($1,$2,$3,$4,$5,${origem === 'person' ? 'now()' : 'NULL'},${origem === 'person' ? '$5' : 'NULL'})
   ON CONFLICT (slug) DO NOTHING RETURNING *`, [v.slug, v.label, v.tone, origem, autor])).rows[0];
 if (nova) return { tag: nova, criada: true };
 let tag = (await db.query('SELECT * FROM agenda_tags WHERE slug=$1 FOR UPDATE', [v.slug])).rows[0];
 if (tag.archived_at) {
  tag = (await db.query(
   `UPDATE agenda_tags SET archived_at=NULL, revision=revision+1, updated_at=now(),
      reviewed_at=${origem === 'person' ? 'now()' : 'NULL'}, reviewed_by=${origem === 'person' ? '$2' : 'NULL'}
    WHERE id=$1 RETURNING *`, [tag.id, autor])).rows[0];
 }
 return { tag, criada: false };
}

/**
 * Revisa uma tag: aprovar (reviewed), renomear, trocar a cor, arquivar ou reativar. A revisão que quem chamou leu é
 * obrigatória (concorrência otimista, como o resto do Core). Aprovar é para quem tem poder de revisar e vale igual para
 * pessoa e IA: o que fica gravado é QUEM revisou.
 */
export async function revisarTag(db, { id, revision, label, tone, reviewed, archived, autor }) {
 const atual = (await db.query('SELECT * FROM agenda_tags WHERE id=$1 FOR UPDATE', [id])).rows[0];
 if (!atual) throw fail(404, 'Tag não encontrada.');
 if (atual.revision !== revision) throw fail(409, 'Esta tag foi alterada por outra pessoa. Recarregue antes de salvar.');
 const sets = [], valores = [id, revision];
 const poe = (coluna, valor) => { valores.push(valor); sets.push(`${coluna}=$${valores.length}`); };
 if (label !== undefined) {
  const v = tagInput({ label, tone: tone ?? atual.tone });
  if (v.slug !== atual.slug) {
   const dono = (await db.query('SELECT id FROM agenda_tags WHERE slug=$1', [v.slug])).rows[0];
   if (dono && dono.id !== id) throw fail(409, 'Já existe outra tag com esse nome.');
   poe('slug', v.slug);
  }
  poe('label', v.label);
 }
 if (tone !== undefined) {
  if (!TONS.includes(tone)) throw fail(400, 'Cor de tag inválida.');
  poe('tone', tone);
 }
 if (reviewed === true) { sets.push('reviewed_at=now()'); poe('reviewed_by', autor); }
 if (archived === true) sets.push('archived_at=now()');
 if (archived === false) sets.push('archived_at=NULL');
 if (!sets.length) throw fail(400, 'Nada para alterar.');
 return (await db.query(
  `UPDATE agenda_tags SET ${sets.join(',')}, revision=revision+1, updated_at=now() WHERE id=$1 AND revision=$2 RETURNING *`, valores)).rows[0];
}

/** A tag como a tela e a IA a veem. `reviewed` é só "alguém já revisou"; quem revisou fica em reviewed_by. */
export const tagPublica = t => ({
 id: t.id, slug: t.slug, label: t.label, tone: t.tone, origin: t.origin, created_by: t.created_by ?? null,
 reviewed: Boolean(t.reviewed_at), reviewed_by: t.reviewed_by ?? null, archived: Boolean(t.archived_at), revision: t.revision ?? null, uses: t.uses ?? 0,
});

/** Catálogo para a tela e para a IA. `uses` = em quantas atividades a tag está valendo. */
export async function listarTags(db, { arquivadas = false } = {}) {
 return (await db.query(
  `SELECT t.id,t.slug,t.label,t.tone,t.origin,t.created_by,t.reviewed_at,t.reviewed_by,t.archived_at,t.revision,
     (SELECT count(*)::int FROM service_activity_tags s WHERE s.tag_id=t.id AND s.removed_at IS NULL) AS uses
   FROM agenda_tags t ${arquivadas ? '' : 'WHERE t.archived_at IS NULL'} ORDER BY lower(t.label)`)).rows;
}

/** Tags valendo em cada atividade, em um Map id -> [tag]. Uma consulta só para a janela inteira da agenda. */
export async function tagsDasAtividades(db, ids) {
 const mapa = new Map();
 if (!ids.length) return mapa;
 const { rows } = await db.query(
  `SELECT s.activity_id,t.id,t.slug,t.label,t.tone,t.origin,t.reviewed_at
   FROM service_activity_tags s JOIN agenda_tags t ON t.id=s.tag_id
   WHERE s.activity_id=ANY($1::uuid[]) AND s.removed_at IS NULL ORDER BY lower(t.label)`, [ids]);
 for (const r of rows) {
  const { activity_id, ...tag } = r;
  if (!mapa.has(activity_id)) mapa.set(activity_id, []);
  mapa.get(activity_id).push(tag);
 }
 return mapa;
}

/**
 * Define as tags de uma atividade: o que estiver na lista passa a valer, o que não estiver deixa de valer. Devolve o que
 * mudou, para quem chama poder gravar a trilha. Tag arquivada só pode ficar se já estava na atividade — não se escolhe de novo.
 */
export async function definirTagsDaAtividade(db, { atividadeId, tagIds, autor }) {
 const desejadas = [...new Set(tagIds)];
 if (desejadas.length > MAX_TAGS_POR_ATIVIDADE) throw fail(400, `No máximo ${MAX_TAGS_POR_ATIVIDADE} tags por atividade.`);
 const existentes = desejadas.length ? (await db.query('SELECT id,archived_at FROM agenda_tags WHERE id=ANY($1::uuid[])', [desejadas])).rows : [];
 if (existentes.length !== desejadas.length) throw fail(400, 'Alguma tag não existe.');
 const atuais = (await db.query('SELECT tag_id,removed_at FROM service_activity_tags WHERE activity_id=$1 FOR UPDATE', [atividadeId])).rows;
 const valendo = new Set(atuais.filter(a => !a.removed_at).map(a => a.tag_id));
 const conhecidas = new Set(atuais.map(a => a.tag_id));
 for (const t of existentes) if (t.archived_at && !valendo.has(t.id)) throw fail(409, 'Tag arquivada não pode ser escolhida de novo: reative-a antes.');
 const adicionadas = [], removidas = [];
 for (const id of desejadas) {
  if (valendo.has(id)) continue;
  if (conhecidas.has(id)) await db.query('UPDATE service_activity_tags SET removed_at=NULL, removed_by=NULL, added_by=$3, added_at=now() WHERE activity_id=$1 AND tag_id=$2', [atividadeId, id, autor]);
  else await db.query('INSERT INTO service_activity_tags(activity_id,tag_id,added_by) VALUES($1,$2,$3)', [atividadeId, id, autor]);
  adicionadas.push(id);
 }
 for (const id of valendo) {
  if (desejadas.includes(id)) continue;
  await db.query('UPDATE service_activity_tags SET removed_at=now(), removed_by=$3 WHERE activity_id=$1 AND tag_id=$2', [atividadeId, id, autor]);
  removidas.push(id);
 }
 return { adicionadas, removidas };
}
