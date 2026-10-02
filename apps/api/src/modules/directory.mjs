// Organizações (tenants) e vínculos de identidade externa (memberships).
//
// O vínculo é por organização E produto: a pessoa alcança apenas os produtos
// em que foi vinculada, mesmo que a organização contrate outros.
// Decisão em docs/decisions/0002-vinculo-de-pessoa-por-produto.md.
import { input, text, isUuid, isProductId, fail } from '../platform/http.mjs';
import {requireProductFor} from './catalog.mjs';

const RELATIONSHIPS = ['internal', 'customer', 'prospect', 'partner'];
const LIFECYCLES = ['lead', 'onboarding', 'active', 'paused', 'completed', 'discontinued', 'unclassified'];
const ORGANIZATIONS = ['company', 'person', 'nonprofit', 'internal'];

export function directoryRoutes(router) {
 router.post('/api/tenants', async ({ client, body }) => {
  input(body, ['name', 'slug', 'relationship_kind', 'lifecycle_status', 'organization_type']);
  const name = text(body.name, 2, 160);
  const slug = text(body.slug, 2, 64);
  const relationship = body.relationship_kind || 'customer';
  const lifecycle = body.lifecycle_status || 'active';
  const organization = body.organization_type || 'company';
  if (!/^[a-z0-9][a-z0-9-]+$/.test(slug)) throw fail(400, 'Use letras minúsculas, números e hífen no identificador.');
  if (!['internal','customer','prospect','partner'].includes(relationship) ||
      !['lead','onboarding','active','paused','completed','discontinued','unclassified'].includes(lifecycle) ||
      !['company','person','nonprofit','internal'].includes(organization)) throw fail(400, 'Classificação inválida.');
  const created = await client.query(
   'INSERT INTO tenants(name,slug,relationship_kind,lifecycle_status,organization_type) VALUES($1,$2,$3,$4,$5) RETURNING id',
   [name, slug, relationship, lifecycle, organization]);
  return { tenant: created.rows[0].id, type: 'tenant.created' };
 }, { transactional: true });

 // Contratações (criar, editar por id, arquivar) moraram aqui como um upsert por
 // rótulo que sobrescrevia outra contratação em silêncio. Hoje ficam em
 // modules/portfolio.mjs, junto do portfólio a que elas se ligam.

 router.post('/api/stakeholders', async ({ client, body }) => {
  input(body, ['tenant_id', 'name', 'role', 'title', 'is_primary', 'contact_allowed', 'email', 'phone']);
  if (!isUuid(body.tenant_id) || !['owner','decision_maker','champion','finance','technical','operational','student','contact'].includes(body.role) ||
      typeof body.is_primary !== 'boolean' || typeof body.contact_allowed !== 'boolean') throw fail(400, 'Stakeholder inválido.');
  // E-mail e telefone são opcionais. O e-mail identifica a pessoa (o intake do site reaproveita por ele), então um e-mail que já
  // existe não cria a pessoa de novo. Telefone no mesmo formato do intake: só dígitos, de 10 a 15.
  const email = body.email ? text(body.email, 3, 320).toLowerCase() : null;
  if (email && !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) throw fail(400, 'E-mail inválido.');
  const phone = body.phone ? text(body.phone, 8, 40).replace(/[\s()+.-]/g, '') : null;
  if (phone && !/^\d{10,15}$/.test(phone)) throw fail(400, 'Telefone inválido: use DDD e número, com 10 a 15 dígitos.');
  if (email && (await client.query('SELECT 1 FROM stakeholders WHERE lower(email)=$1', [email])).rowCount) throw fail(409, 'Já existe uma pessoa com este e-mail.');
  const person=await client.query('INSERT INTO stakeholders(name,email,phone) VALUES($1,$2,$3) RETURNING id',[text(body.name,2,160),email,phone]);
  await client.query(`INSERT INTO organization_stakeholders(tenant_id,stakeholder_id,role,title,is_primary,contact_allowed)
   VALUES($1,$2,$3,$4,$5,$6)`,[body.tenant_id,person.rows[0].id,body.role,body.title?text(body.title,2,120):null,body.is_primary,body.contact_allowed]);
  return { tenant: body.tenant_id, type: 'stakeholder.created' };
 }, { transactional: true });

 // Altera o que a organização é: situação (ativa/suspensa), nome e a classificação (relacionamento, ciclo de vida, tipo).
 // O identificador (slug) não muda: ele está em links e integrações. A organização interna não se reclassifica, e
 // "interna" só vale para ela. O que mudou fica na trilha (antes e depois), não só o fato de ter mudado.
 router.put('/api/tenants', async ({ client, body }) => {
  input(body, ['tenant_id', 'status', 'name', 'relationship_kind', 'lifecycle_status', 'organization_type']);
  if (!isUuid(body.tenant_id)) throw fail(400, 'Tenant/status inválido.');
  const campos = ['status', 'name', 'relationship_kind', 'lifecycle_status', 'organization_type'].filter(k => body[k] !== undefined);
  if (!campos.length) throw fail(400, 'Informe o que mudar.');
  const valido = {
   status: v => ['active', 'suspended'].includes(v),
   relationship_kind: v => RELATIONSHIPS.includes(v),
   lifecycle_status: v => LIFECYCLES.includes(v),
   organization_type: v => ORGANIZATIONS.includes(v),
  };
  for (const k of campos) if (k !== 'name' && !valido[k](body[k])) throw fail(400, k === 'status' ? 'Tenant/status inválido.' : 'Classificação inválida.');
  const novoNome = body.name === undefined ? undefined : text(body.name, 2, 160);
  const antes = (await client.query('SELECT id,name,status,relationship_kind,lifecycle_status,organization_type FROM tenants WHERE id=$1 FOR UPDATE', [body.tenant_id])).rows[0];
  if (!antes) throw fail(404, 'Tenant não encontrado.');
  const depois = { ...antes, ...Object.fromEntries(campos.map(k => [k, k === 'name' ? novoNome : body[k]])) };
  const mudou = campos.filter(k => depois[k] !== antes[k]);
  const classificacao = mudou.filter(k => ['relationship_kind', 'lifecycle_status', 'organization_type'].includes(k));
  if (classificacao.length) {
   if (antes.relationship_kind === 'internal' || antes.organization_type === 'internal') throw fail(409, 'A organização interna não se reclassifica.');
   if (depois.relationship_kind === 'internal' || depois.organization_type === 'internal') throw fail(400, '"Interna" só vale para a organização da própria Tzolkin.');
  }
  if (mudou.length) await client.query(
   'UPDATE tenants SET status=$2,name=$3,relationship_kind=$4,lifecycle_status=$5,organization_type=$6 WHERE id=$1',
   [antes.id, depois.status, depois.name, depois.relationship_kind, depois.lifecycle_status, depois.organization_type]);
  const so = mudou.length === 1 && mudou[0] === 'status';
  const pick = o => Object.fromEntries(mudou.map(k => [k, o[k]]));
  return { tenant: antes.id, type: so || !mudou.length ? 'tenant.status_changed' : 'tenant.updated', ...(mudou.length && !so ? { details: { before: pick(antes), after: pick(depois) } } : {}) };
 }, { transactional: true });

 router.put('/api/memberships', async ({ client, body }) => {
  input(body, ['tenant_id', 'product_id', 'subject', 'active']);
  if (!isUuid(body.tenant_id) || typeof body.active !== 'boolean') throw fail(400, 'Vínculo inválido.');
  if (!isProductId(body.product_id)) throw fail(400, 'Produto inválido.');
  await requireProductFor(client, body.product_id, 'access', { missing: fail(400, 'Produto não está disponível para acesso.') });
  // A FK de product_id recusa produto inexistente; o erro vira 409 em describeError.
  await client.query(
   `INSERT INTO memberships(tenant_id,subject,product_id,active) VALUES($1,$2,$3,$4)
    ON CONFLICT(tenant_id,subject,product_id) DO UPDATE SET active=EXCLUDED.active`,
   [body.tenant_id, text(body.subject), body.product_id, body.active]);
  return { tenant: body.tenant_id, type: 'membership.changed' };
 }, { transactional: true });
}
