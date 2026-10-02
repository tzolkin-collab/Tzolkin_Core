import { randomUUID, createHash } from 'node:crypto';
import { fail, isUuid, onlyParams } from '../platform/http.mjs';
import { createR2 } from '../platform/r2.mjs';

// Fotos de empresas e leads, no R2 privado. Ver db/migrations/039_media_objects.sql.
//
// O envio passa PELO servidor (como no upload da Kalidash), e não direto do navegador,
// por dois motivos: o conteúdo é verificado antes de ir para o bucket, e o bucket não
// precisa de regra de CORS. A leitura é que sai do servidor: URL assinada de poucos
// minutos, gerada a cada listagem para o operador logado. Nada público, nada gravado.

export const MAX_BYTES = 8 * 1024 * 1024;
const MAX_PER_OWNER = 20;
const OWNERS = { tenant: 'tenants', lead: 'commercial_leads' };

/**
 * Tipo pelos primeiros bytes. O Content-Type que o navegador manda é só uma
 * declaração; SVG fica de fora de propósito (carrega script).
 */
export function sniffImage(bytes) {
 if (bytes.length >= 3 && bytes[0] === 0xff && bytes[1] === 0xd8 && bytes[2] === 0xff) return { type: 'image/jpeg', ext: 'jpg' };
 if (bytes.length >= 8 && bytes.subarray(0, 8).equals(Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]))) return { type: 'image/png', ext: 'png' };
 if (bytes.length >= 6 && /^GIF8[79]a$/.test(bytes.subarray(0, 6).toString('latin1'))) return { type: 'image/gif', ext: 'gif' };
 if (bytes.length >= 12 && bytes.subarray(0, 4).toString('latin1') === 'RIFF' && bytes.subarray(8, 12).toString('latin1') === 'WEBP') return { type: 'image/webp', ext: 'webp' };
 return null;
}

const cleanName = value => {
 if (!value) return null;
 const base = String(value).split(/[\\/]/).pop().replace(/[\u0000-\u001f]/g, '').trim().slice(0, 200);
 return base || null;
};

async function readBody(req, limit) {
 const declared = Number(req.headers['content-length']);
 if (declared > limit) throw fail(413, 'A imagem passa de 8 MB.');
 const chunks = []; let length = 0;
 for await (const chunk of req) {
  length += chunk.length;
  if (length > limit) throw fail(413, 'A imagem passa de 8 MB.');
  chunks.push(chunk);
 }
 return Buffer.concat(chunks);
}

function ownerFrom(searchParams) {
 onlyParams(searchParams, ['owner_type', 'owner_id', 'name']);
 const type = searchParams.get('owner_type'), id = searchParams.get('owner_id');
 if (!OWNERS[type] || !isUuid(id)) throw fail(400, 'Dono da foto inválido.');
 return { type, id };
}

// A tabela do dono vem de uma lista fechada (OWNERS), nunca da requisição.
async function resolveOwner(pool, { type, id }) {
 const sql = type === 'tenant' ? 'SELECT id AS tenant_id FROM tenants WHERE id=$1' : 'SELECT tenant_id FROM commercial_leads WHERE id=$1';
 const row = (await pool.query(sql, [id])).rows[0];
 if (!row) throw fail(404, type === 'tenant' ? 'Empresa não encontrada.' : 'Lead não encontrado.');
 return row.tenant_id;
}

const shape = (row, r2) => ({
 id: row.id, content_type: row.content_type, byte_size: row.byte_size, is_primary: row.is_primary,
 original_name: row.original_name, created_at: row.created_at, url: r2.signedGetUrl(row.object_key),
});

export function mediaRoutes(router, { env = process.env, fetchImpl, clock = Date.now, r2 = createR2({ env, ...(fetchImpl ? { fetchImpl } : {}), clock }) } = {}) {
 const needStorage = () => { if (!r2.configured) throw fail(503, 'O armazenamento de arquivos não está configurado no servidor.'); };
 const audit = (pool, type, tenantId, operator) =>
  pool.query('INSERT INTO audit_events(type,tenant_id,actor_subject,actor_email) VALUES($1,$2,$3,$4)', [type, tenantId, operator?.subject, operator?.email]);

 router.post('/api/media', async ({ req, url, pool, reply, operator }) => {
  needStorage();
  const owner = ownerFrom(url.searchParams);
  const bytes = await readBody(req, MAX_BYTES);
  if (!bytes.length) throw fail(400, 'Nenhuma imagem enviada.');
  const kind = sniffImage(bytes);
  if (!kind) throw fail(415, 'Envie uma imagem JPEG, PNG, WebP ou GIF.');
  const tenantId = await resolveOwner(pool, owner);
  const count = Number((await pool.query('SELECT count(*) FROM media_objects WHERE owner_type=$1 AND owner_id=$2 AND deleted_at IS NULL', [owner.type, owner.id])).rows[0].count);
  if (count >= MAX_PER_OWNER) throw fail(409, `Cada registro aceita até ${MAX_PER_OWNER} fotos.`);
  // O nome do objeto é nosso; o nome enviado só serve para exibir.
  const key = `media/${owner.type}/${owner.id}/${randomUUID()}.${kind.ext}`;
  await r2.put(key, bytes, kind.type);
  try {
   const { rows: [row] } = await pool.query(
    `INSERT INTO media_objects(owner_type,owner_id,tenant_id,object_key,content_type,byte_size,sha256,original_name,is_primary,uploaded_by,uploaded_email)
     VALUES($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11) RETURNING *`,
    [owner.type, owner.id, tenantId, key, kind.type, bytes.length, createHash('sha256').update(bytes).digest('hex'),
     cleanName(url.searchParams.get('name')), count === 0, operator?.subject || 'desconhecido', operator?.email || null]);
   await audit(pool, 'media_uploaded', tenantId, operator);
   return reply(201, shape(row, r2));
  } catch (error) {
   // O objeto já subiu e o registro não gravou: não deixar arquivo órfão no bucket.
   await r2.remove(key).catch(() => {});
   throw error;
  }
 }, { body: false });

 router.get('/api/media', async ({ url, pool, reply }) => {
  needStorage();
  const owner = ownerFrom(url.searchParams);
  const { rows } = await pool.query(
   'SELECT * FROM media_objects WHERE owner_type=$1 AND owner_id=$2 AND deleted_at IS NULL ORDER BY is_primary DESC, created_at', [owner.type, owner.id]);
  return reply(200, { photos: rows.map(row => shape(row, r2)) });
 });

 router.post('/api/media/:id/primary', async ({ params, pool, reply, operator }) => {
  if (!isUuid(params.id)) throw fail(400, 'Foto inválida.');
  const client = await pool.connect();
  try {
   await client.query('BEGIN');
   const row = (await client.query('SELECT * FROM media_objects WHERE id=$1 AND deleted_at IS NULL FOR UPDATE', [params.id])).rows[0];
   if (!row) throw fail(404, 'Foto não encontrada.');
   await client.query('UPDATE media_objects SET is_primary=false WHERE owner_type=$1 AND owner_id=$2 AND is_primary', [row.owner_type, row.owner_id]);
   await client.query('UPDATE media_objects SET is_primary=true WHERE id=$1', [row.id]);
   await client.query('INSERT INTO audit_events(type,tenant_id,actor_subject,actor_email) VALUES($1,$2,$3,$4)', ['media_primary', row.tenant_id, operator?.subject, operator?.email]);
   await client.query('COMMIT');
  } catch (error) { await client.query('ROLLBACK'); throw error; } finally { client.release(); }
  return reply(200, { ok: true });
 }, { body: false });

 router.delete('/api/media/:id', async ({ params, pool, reply, operator }) => {
  if (!isUuid(params.id)) throw fail(400, 'Foto inválida.');
  const client = await pool.connect();
  let removed;
  try {
   await client.query('BEGIN');
   removed = (await client.query('UPDATE media_objects SET deleted_at=now(), is_primary=false WHERE id=$1 AND deleted_at IS NULL RETURNING *', [params.id])).rows[0];
   if (!removed) throw fail(404, 'Foto não encontrada.');
   // Apagou a principal: a foto mais antiga que sobrar assume.
   if (removed.is_primary) await client.query(
    `UPDATE media_objects SET is_primary=true WHERE id=(SELECT id FROM media_objects
      WHERE owner_type=$1 AND owner_id=$2 AND deleted_at IS NULL ORDER BY created_at LIMIT 1)`, [removed.owner_type, removed.owner_id]);
   await client.query('INSERT INTO audit_events(type,tenant_id,actor_subject,actor_email) VALUES($1,$2,$3,$4)', ['media_deleted', removed.tenant_id, operator?.subject, operator?.email]);
   await client.query('COMMIT');
  } catch (error) { await client.query('ROLLBACK'); throw error; } finally { client.release(); }
  // Depois do commit: se o bucket falhar, o registro já está marcado como apagado e a
  // foto não aparece mais; o objeto sobra no bucket, não na tela.
  if (r2.configured) await r2.remove(removed.object_key).catch(() => {});
  return reply(200, { ok: true });
 }, { body: false });
}
