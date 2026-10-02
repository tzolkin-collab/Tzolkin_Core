// Dados 100% sintéticos para os testes de tela. Nenhum nome, e-mail ou valor vem do banco real.
//
// O banco é falso (um objeto com `query`), mas o servidor é o createCore de verdade, com as
// rotas, a sessão, a verificação de origem e o servidor de arquivos reais: o que se testa é a
// tela falando com a API como em produção, sem Postgres e sem provedor externo.

export const SENHA = 'senha-sintetica-de-teste-de-tela-123';
export const EMPRESA = '11111111-1111-4111-8111-111111111111';
export const PESSOA_FISICA = '22222222-2222-4222-8222-222222222222';
export const ENCERRADA = '33333333-3333-4333-8333-333333333333';

const ago = '2026-09-01T12:00:00.000Z';
const tenant = (id, name, organization_type, lifecycle_status) =>
 ({ id, name, slug: name.toLowerCase().replace(/\W+/g, '-'), status: 'active', created_at: ago, source_ref: 'fixture', source_system: 'fixture',
  lifecycle_status, organization_type, relationship_kind: 'customer' });
const product = (id, name, portfolio_kind) =>
 ({ id, name, tags: [], revision: 1, created_at: ago, updated_at: ago, archived_at: null, brand_family: 'tzolkin', archived_from: null,
  portfolio_kind, lifecycle_status: 'active' });

export const DADOS = {
 tenants: [
  tenant(EMPRESA, 'Empresa Alfa', 'company', 'active'),
  tenant(PESSOA_FISICA, 'Beto Pessoa Física', 'person', 'onboarding'),
  tenant(ENCERRADA, 'Gama Encerrada', 'company', 'discontinued'),
 ],
 products: [product('plataforma-a', 'Plataforma A', 'platform'), product('mentorias', 'Mentorias', 'service_line')],
 memberships: [], entitlements: [],
 engagements: [
  { id: 'e1', label: 'Mentoria Alfa', status: 'active', revision: 1, tenant_id: EMPRESA, created_at: ago, product_id: 'mentorias', source_ref: 'x', updated_at: ago, archived_at: null, service_model: 'education', source_system: 'fixture' },
  { id: 'e2', label: 'Assessoria Gama', status: 'completed', revision: 1, tenant_id: ENCERRADA, created_at: ago, product_id: 'mentorias', source_ref: 'y', updated_at: ago, archived_at: null, service_model: 'advisory', source_system: 'fixture' },
 ],
 stakeholders: [
  { id: 's1', name: 'Ana Contato', role: 'decision_maker', title: 'Diretora', tenant_id: EMPRESA, is_primary: true, contact_allowed: false },
  { id: 's2', name: 'Bruno Aluno', role: 'student', title: 'Aluno', tenant_id: PESSOA_FISICA, is_primary: true, contact_allowed: false },
 ],
};

export const FUNIL = '44444444-4444-4444-8444-444444444444';
const ETAPAS = [['Novos', 'LEAD', 2], ['Em contato', 'LEAD', 0], ['Qualificação', 'OPEN', 0], ['Proposta', 'OPEN', 0], ['Negociação', 'OPEN', 0], ['Assinatura do contrato', 'OPEN', 0], ['Ganho', 'WON', 0], ['Perdido', 'LOST', 0]];

// 1x1 PNG válido: o navegador consegue decodificar, e o servidor reconhece pelos primeiros bytes.
export const PNG_1X1 = Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNkYPhfDwAChwGA60e6kgAAAABJRU5ErkJggg==', 'base64');

/** Banco falso. Reconhece só as consultas que as telas testadas fazem; o resto volta vazio. */
export function bancoFalso() {
 const fotos = [];
 const consultas = [];
 return {
  fotos, consultas,
  async query(sql, params = []) {
   consultas.push(sql.replace(/\s+/g, ' ').slice(0, 90));
   // /api/bootstrap: uma linha, uma coluna por coleção
   if (/AS resource_bindings/.test(sql) && /jsonb_agg/.test(sql))
    return { rows: [{ tenants: DADOS.tenants, products: DADOS.products, memberships: [], entitlements: [], engagements: DADOS.engagements, stakeholders: DADOS.stakeholders, entries: [], resource_bindings: [] }] };
   // funil do espaço (Inbound): um funil padrão com as 8 etapas e 2 leads em "Novos"
   if (/FROM pipelines p JOIN products pr/.test(sql))
    return { rows: [{ id: FUNIL, space_id: 'mentorias', space_name: 'Mentorias', slug: 'padrao', name: 'Funil padrão', offer_name: null, is_default: true, is_active: true, position: 0, version: 1 }] };
   if (/FROM pipeline_stages s WHERE s.pipeline_id=ANY/.test(sql))
    return { rows: ETAPAS.map(([name, kind, leads], i) => ({ id: `55555555-5555-4555-8555-55555555550${i}`, pipeline_id: FUNIL, name, kind, position: i, color: null, probability: null, stale_days: null, leads, opportunities: 0, value_minor: '0' })) };
   // ficha da empresa
   if (/FROM tenants WHERE id=\$1/.test(sql) && !/AS tenant_id/.test(sql)) {
    const t = DADOS.tenants.find(x => x.id === params[0]);
    return { rows: t ? [{ id: t.id, name: t.name, slug: t.slug, organization_type: t.organization_type, relationship_kind: t.relationship_kind, lifecycle_status: t.lifecycle_status, status: t.status, created_at: t.created_at }] : [] };
   }
   if (/FROM organization_stakeholders os JOIN stakeholders/.test(sql))
    return { rows: DADOS.stakeholders.filter(s => s.tenant_id === params[0]).map(({ id, name, role, title, is_primary, contact_allowed }) => ({ id, name, role, title, is_primary, contact_allowed })) };
   if (/FROM client_engagements e LEFT JOIN products p/.test(sql))
    return { rows: DADOS.engagements.filter(e => e.tenant_id === params[0]).map(e => ({ ...e, product_name: 'Mentorias', portfolio_kind: 'service_line', product_lifecycle_status: 'active' })) };
   // fotos
   if (/AS tenant_id FROM tenants/.test(sql)) return { rows: DADOS.tenants.some(t => t.id === params[0]) ? [{ tenant_id: params[0] }] : [] };
   if (/count\(\*\) FROM media_objects/.test(sql)) return { rows: [{ count: String(fotos.filter(f => f.owner_id === params[1]).length) }] };
   if (/INSERT INTO media_objects/.test(sql)) {
    const [owner_type, owner_id, tenant_id, object_key, content_type, byte_size, , original_name, is_primary] = params;
    const linha = { id: `m${fotos.length + 1}`, owner_type, owner_id, tenant_id, object_key, content_type, byte_size, original_name, is_primary, created_at: ago };
    fotos.push(linha); return { rows: [linha] };
   }
   if (/FROM media_objects WHERE owner_type/.test(sql)) return { rows: fotos.filter(f => f.owner_id === params[1]) };
   return { rows: [] };
  },
  async connect() { return { query: (...a) => this.query(...a), release() {} }; },
 };
}

/** R2 falso: guarda os bytes em memória e devolve uma imagem embutida como "URL assinada". */
export function r2Falso() {
 const objetos = new Map();
 return {
  objetos, configured: true,
  put: async (chave, bytes, tipo) => { objetos.set(chave, { bytes, tipo }); },
  remove: async chave => { objetos.delete(chave); },
  signedGetUrl: () => `data:image/png;base64,${PNG_1X1.toString('base64')}`,
 };
}
