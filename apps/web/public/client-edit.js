// Opções de classificação da empresa, usadas pela edição no lugar da ficha (inline-edit.js + PUT /api/tenants).
// O diálogo "Editar empresa" que morava aqui foi substituído por editar cada campo na própria ficha.
// O identificador (slug) não muda: ele está em links e integrações. A organização interna não se reclassifica.
export const RELACIONAMENTOS = [['customer', 'Cliente'], ['prospect', 'Prospect'], ['partner', 'Parceiro']];
export const TIPOS = [['company', 'Empresa'], ['person', 'Pessoa física'], ['nonprofit', 'Organização sem fins lucrativos']];
export const SITUACOES = [['lead', 'Lead'], ['onboarding', 'Em implantação'], ['active', 'Ativo'], ['paused', 'Pausado'], ['completed', 'Concluído'], ['discontinued', 'Descontinuado'], ['unclassified', 'Não classificado']];
