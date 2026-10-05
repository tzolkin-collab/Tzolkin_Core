// Dados 100% sintéticos para os testes de tela. Nenhum nome, e-mail ou valor vem do banco real.
//
// O banco é falso (um objeto com `query`), mas o servidor é o createCore de verdade, com as
// rotas, a sessão, a verificação de origem e o servidor de arquivos reais: o que se testa é a
// tela falando com a API como em produção, sem Postgres e sem provedor externo.

export const SENHA = 'senha-sintetica-de-teste-de-tela-123';
export const EMPRESA = '11111111-1111-4111-8111-111111111111';
export const PESSOA_FISICA = '22222222-2222-4222-8222-222222222222';
export const ENCERRADA = '33333333-3333-4333-8333-333333333333';
export const ANA = '2aaaaaa1-aaaa-4aaa-8aaa-aaaaaaaaaaa1';
export const BRUNO = '2bbbbbb2-bbbb-4bbb-8bbb-bbbbbbbbbbb2';

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
  { id: ANA, name: 'Ana Contato', role: 'decision_maker', title: 'Diretora', tenant_id: EMPRESA, is_primary: true, contact_allowed: false, email: 'ana@exemplo.test', phone: '11999990000' },
  { id: BRUNO, name: 'Bruno Aluno', role: 'student', title: 'Aluno', tenant_id: PESSOA_FISICA, is_primary: true, contact_allowed: false },
 ],
};

export const FUNIL = '44444444-4444-4444-8444-444444444444';
const ETAPAS = [['Novos', 'LEAD', 2], ['Em contato', 'LEAD', 0], ['Qualificação', 'OPEN', 0], ['Proposta', 'OPEN', 0], ['Negociação', 'OPEN', 0], ['Assinatura do contrato', 'OPEN', 0], ['Ganho', 'WON', 0], ['Perdido', 'LOST', 0]];

export const LEAD = '66666666-6666-4666-8666-666666666666';
const ETAPA = i => `55555555-5555-4555-8555-55555555550${i}`;
const LEAD_LINHA = { id: LEAD, product_id: 'mentorias', name: 'Lead de teste', email: 'lead@exemplo.test', whatsapp: null, status: 'open', interest: 'Mentoria', source_system: 'tzolkin-site',
 source_created_at: ago, created_at: ago, owner_id: null, owner_name: null, owner_email: null, pipeline_id: FUNIL, stage_id: ETAPA(0), stage_name: 'Novos', organization_name: 'Empresa Alfa' };
const OPORTUNIDADE = { id: '77777777-7777-4777-8777-777777777777', pipeline_id: FUNIL, stage_id: ETAPA(2), stage_name: 'Qualificação', stage_kind: 'OPEN', tenant_id: EMPRESA, organization_name: 'Empresa Alfa',
 stakeholder_id: null, contact_name: null, lead_id: null, title: 'Venda de teste', value_minor: '450000', currency: 'BRL', origin: 'INBOUND', owner_id: null, owner_name: null,
 expected_close_at: null, entered_stage_at: ago, closed_at: null, lost_reason_id: null, version: 1, created_at: ago };

const CAMPOS = [
 { id: 'a1111111-1111-4111-8111-111111111111', space_id: 'mentorias', entity: 'lead', key: 'porte', label: 'Porte', type: 'SELECT', options: ['Micro', 'Pequena'], required: false, is_active: true, position: 0, version: 1 },
 { id: 'a2222222-2222-4222-8222-222222222222', space_id: 'mentorias', entity: 'lead', key: 'observacao', label: 'Observação', type: 'TEXT', options: null, required: true, is_active: true, position: 1, version: 1 },
 { id: 'a3333333-3333-4333-8333-333333333333', space_id: 'mentorias', entity: 'lead', key: 'antigo', label: 'Campo antigo', type: 'TEXT', options: null, required: false, is_active: false, position: 2, version: 2 },
 { id: 'a4444444-4444-4444-8444-444444444444', space_id: 'mentorias', entity: 'opportunity', key: 'orcamento', label: 'Orçamento', type: 'NUMBER', options: null, required: false, is_active: true, position: 0, version: 1 },
];

const DONO = { id: 'bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb', name: 'Dono Teste', email: 'dono@exemplo.test' };
const TAREFAS = [
 { id: 'c1111111-1111-4111-8111-111111111111', opportunity_id: null, title: 'Ligar para o lead', tag: 'Geral', due_at: '2026-09-03T12:00:00.000Z', owner_id: null, owner_name: null, source: 'automacao', done_at: null, version: 1 },
 { id: 'c2222222-2222-4222-8222-222222222222', opportunity_id: null, title: 'Mandar o portfólio', tag: 'Vendas', due_at: null, owner_id: DONO.id, owner_name: 'Dono Teste', source: 'manual', done_at: '2026-09-02T12:00:00.000Z', version: 2 },
];
const AUTOMACOES = [
 { id: 'd1111111-1111-4111-8111-111111111111', space_id: 'mentorias', pipeline_id: FUNIL, stage_id: null, name: 'Ligar logo', trigger_event: 'lead.criado',
  actions: [{ action: 'tarefa.criar', title: 'Ligar para o lead', tag: 'Geral', delay_days: 2 }], is_enabled: true, version: 1, last_run_at: ago, last_result: 'OK' },
];

const REQUISITOS = [
 { id: 'e1111111-1111-4111-8111-111111111111', pipeline_id: FUNIL, stage_id: '55555555-5555-4555-8555-555555555501', stage_name: 'Em contato', stage_kind: 'LEAD', gate: 'ENTER', kind: 'ACTION',
  title: 'Confirmar o telefone', field_entity: null, field_key: null, tag: 'Cadastro', owner_id: null, due_days: 2, position: 0, is_active: true, version: 1 },
];

// 1x1 PNG válido: o navegador consegue decodificar, e o servidor reconhece pelos primeiros bytes.
export const PNG_1X1 = Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNkYPhfDwAChwGA60e6kgAAAABJRU5ErkJggg==', 'base64');

/** Banco falso. Reconhece só as consultas que as telas testadas fazem; o resto volta vazio. */
export function bancoFalso() {
 const fotos = [];
 const consultas = [];
 // Escritas que as telas fizeram (para o teste conferir o que foi gravado) e o estado editável do lead
 const escritas = [];
 const lead = { version: 1, name: 'Lead de teste', email: 'lead@exemplo.test', whatsapp: null, message: 'Quero saber mais' };
 return {
  fotos, consultas, escritas, lead,
  async query(sql, params = []) {
   consultas.push(sql.replace(/\s+/g, ' ').slice(0, 90));
   // Edições: empresa, pessoa e lead leem a linha (FOR UPDATE) e gravam; o estado muda de verdade, como no banco
   if (/^SELECT id,name,status,relationship_kind,lifecycle_status,organization_type FROM tenants WHERE id=\$1 FOR UPDATE/.test(sql.replace(/\s+/g, ' ').trim())) {
    const t = DADOS.tenants.find(x => x.id === params[0]);
    return { rows: t ? [{ id: t.id, name: t.name, status: t.status, relationship_kind: t.relationship_kind, lifecycle_status: t.lifecycle_status, organization_type: t.organization_type }] : [] };
   }
   if (/^UPDATE tenants SET status=\$2,name=\$3/.test(sql.trim())) {
    const t = DADOS.tenants.find(x => x.id === params[0]);
    Object.assign(t, { status: params[1], name: params[2], relationship_kind: params[3], lifecycle_status: params[4], organization_type: params[5] });
    escritas.push({ tipo: 'tenant', params }); return { rows: [], rowCount: 1 };
   }
   if (/FROM stakeholders s JOIN organization_stakeholders os ON os\.stakeholder_id = s\.id/.test(sql)) {
    const p = DADOS.stakeholders.find(x => x.id === params[0] && x.tenant_id === params[1]);
    return { rows: p ? [{ id: p.id, name: p.name, email: p.email ?? null, phone: p.phone ?? null, role: p.role, title: p.title ?? null, is_primary: p.is_primary, contact_allowed: p.contact_allowed }] : [] };
   }
   if (/SELECT 1 FROM stakeholders WHERE lower\(email\)/.test(sql)) return { rows: [], rowCount: 0 };
   if (/^UPDATE stakeholders SET name=\$2, email=\$3, phone=\$4/.test(sql.trim())) {
    const p = DADOS.stakeholders.find(x => x.id === params[0]); Object.assign(p, { name: params[1], email: params[2], phone: params[3] });
    escritas.push({ tipo: 'pessoa', params }); return { rows: [], rowCount: 1 };
   }
   if (/^UPDATE organization_stakeholders SET role=\$3/.test(sql.trim())) {
    const p = DADOS.stakeholders.find(x => x.id === params[1] && x.tenant_id === params[0]); Object.assign(p, { role: params[2], title: params[3], is_primary: params[4], contact_allowed: params[5] });
    escritas.push({ tipo: 'vinculo', params }); return { rows: [], rowCount: 1 };
   }
   if (/^SELECT \* FROM commercial_leads WHERE id=\$1 FOR UPDATE/.test(sql.trim()))
    return { rows: [{ ...LEAD_LINHA, version: lead.version, name: lead.name, email: lead.email, whatsapp: lead.whatsapp, message: lead.message, loss_reason: null, status: 'open' }] };
   if (/^UPDATE commercial_leads SET status=\$2,owner_id=\$3,loss_reason=\$4,name=\$5/.test(sql.trim())) {
    Object.assign(lead, { name: params[4], email: params[5], whatsapp: params[6], message: params[7], version: lead.version + 1 });
    escritas.push({ tipo: 'lead', params }); return { rows: [], rowCount: 1 };
   }
   if (/INSERT INTO commercial_activities/.test(sql)) { escritas.push({ tipo: 'atividade', params }); return { rows: [], rowCount: 1 }; }
   // /api/bootstrap: uma linha, uma coluna por coleção
   if (/AS resource_bindings/.test(sql) && /jsonb_agg/.test(sql))
    return { rows: [{ tenants: DADOS.tenants, products: DADOS.products, memberships: [], entitlements: [], engagements: DADOS.engagements, stakeholders: DADOS.stakeholders, entries: [], resource_bindings: [] }] };
   // /api/overview (o Acompanhamento lê as empresas dele)
   if (/SELECT os\.tenant_id,os\.role,os\.title,os\.is_primary,os\.contact_allowed,s\.id,s\.name,s\.email,s\.phone\s+FROM organization_stakeholders os JOIN stakeholders s ON s\.id=os\.stakeholder_id ORDER BY s\.name/.test(sql)) return { rows: DADOS.stakeholders };
   if (sql === 'SELECT * FROM tenants ORDER BY created_at DESC') return { rows: DADOS.tenants };
   // Inbound: lista e detalhe de lead, oportunidades da etapa e motivos de perda
   if (/FROM commercial_leads l JOIN tenants t ON t.id=l.tenant_id LEFT JOIN operator_accounts a ON a.id=l.owner_id LEFT JOIN pipeline_stages st/.test(sql)) return { rows: [LEAD_LINHA] };
   if (/SELECT l\.\*,t\.name AS organization_name/.test(sql)) return { rows: [{ ...LEAD_LINHA, version: lead.version, name: lead.name, email: lead.email, whatsapp: lead.whatsapp, service_model: 'education', message: lead.message, source_ref: 'ref-1', privacy: {}, tenant_id: EMPRESA, estimated_value_minor: null, expected_close_at: null, loss_reason: null, custom_data: { porte: 'Micro', antigo: 'valor guardado' } }] };
   if (/FROM commercial_opportunities o JOIN pipeline_stages s ON s\.id=o\.stage_id LEFT JOIN client_engagements/.test(sql)) return { rows: [] };
   if (/FROM commercial_opportunities o\s+JOIN pipeline_stages s ON s\.id=o\.stage_id JOIN tenants t/.test(sql)) return { rows: params[1] === ETAPA(2) ? [OPORTUNIDADE] : [] };
   if (/SELECT id,name,kind,position FROM pipeline_stages WHERE pipeline_id=\$1 ORDER BY position/.test(sql))
    return { rows: ETAPAS.map(([name, kind], i) => ({ id: ETAPA(i), name, kind, position: i })) };
   if (/FROM lost_reasons WHERE is_active/.test(sql)) return { rows: [{ id: '88888888-8888-4888-8888-888888888888', name: 'Sem orçamento' }, { id: '99999999-9999-4999-8999-999999999999', name: 'Sem resposta' }] };
   // Histórico da empresa (trilha de auditoria)
   if (/FROM audit_events e WHERE e\.tenant_id=\$1/.test(sql))
    return { rows: [
     { at: '2026-09-02T12:00:00.000Z', source: 'empresa', type: 'tenant.updated', actor: 'dono@exemplo.test', details: { before: { relationship_kind: 'prospect' }, after: { relationship_kind: 'customer' } } },
     { at: '2026-09-01T12:00:00.000Z', source: 'atividade', type: 'time_logged', actor: 'dono@exemplo.test', details: null },
    ] };
   // Requisitos de etapa do funil
   if (/FROM stage_requirements r JOIN pipeline_stages s ON s\.id=r\.stage_id WHERE r\.pipeline_id=\$1/.test(sql)) return { rows: REQUISITOS };
   // Fase 5: responsáveis, tarefas do lead e automações do espaço
   if (/SELECT id,name,email FROM operator_accounts WHERE status='active'/.test(sql)) return { rows: [DONO] };
   if (/FROM commercial_tasks t LEFT JOIN operator_accounts a ON a\.id=t\.owner_id WHERE t\.lead_id=\$1/.test(sql)) return { rows: TAREFAS };
   if (/FROM automations a WHERE \(\$1::text IS NULL OR a\.space_id=\$1\)/.test(sql)) return { rows: AUTOMACOES.filter(a => !params[0] || a.space_id === params[0]) };
   // Campos próprios do espaço: lista do gerenciador e do detalhe do lead
   if (/FROM space_fields WHERE \(\$1::text IS NULL OR space_id=\$1\)/.test(sql)) return { rows: CAMPOS.filter(c => !params[0] || c.space_id === params[0]) };
   if (/FROM space_fields WHERE space_id=\$1 ORDER BY entity/.test(sql)) return { rows: CAMPOS.map(({ version, space_id, ...c }) => c) };
   // Acompanhamento: contratações em curso oferecidas ao formulário de atividade
   if (/FROM client_engagements WHERE archived_at IS NULL ORDER BY label/.test(sql))
    return { rows: DADOS.engagements.filter(e => e.status === 'active').map(e => ({ id: e.id, tenant_id: e.tenant_id, label: e.label, service_model: e.service_model, status: e.status, product_id: e.product_id })) };
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
