// Histórico da empresa (trilha de auditoria): o texto de cada linha. Sem DOM, para o teste unitário importar.
// Tipos que não estão aqui aparecem como vieram, sem inventar tradução.
export const TIPOS = {
 'tenant.created': 'Empresa criada',
 'tenant.updated': 'Empresa alterada',
 'tenant.status_changed': 'Situação da empresa alterada',
 'stakeholder.created': 'Pessoa cadastrada',
 'stakeholder.updated': 'Pessoa alterada',
 'engagement.created': 'Contratação criada',
 'engagement.updated': 'Contratação alterada',
 'engagement.archived': 'Contratação arquivada',
 'membership.changed': 'Acesso de pessoa alterado',
 'entitlement.changed': 'Direito de acesso alterado',
 'opportunity_created': 'Oportunidade criada',
 'opportunity_moved': 'Oportunidade mudou de etapa',
 'opportunity_move_blocked': 'Mudança de etapa bloqueada por requisito',
 'marketing.binding.saved': 'Campanha vinculada a uma contratação',
 'service_receivable.plan_created': 'Plano de recebimento criado',
 'service_receivable.plan_approved': 'Plano de recebimento aprovado',
 'service_receivable.plan_canceled': 'Plano de recebimento cancelado',
 'delivery.product_activated': 'Item do portfólio ativado',
 // trilha das atividades do Acompanhamento
 'activity:created': 'Atividade criada',
 'activity:status_changed': 'Atividade: situação alterada',
 'activity:time_logged': 'Tempo registrado',
 'activity:engagement_changed': 'Atividade: contratação alterada',
};

const CAMPOS = { name: 'Nome', relationship_kind: 'Relacionamento', lifecycle_status: 'Ciclo de vida', organization_type: 'Tipo', status: 'Situação', email: 'E-mail', phone: 'Telefone', role: 'Papel', title: 'Cargo', is_primary: 'Contato principal', contact_allowed: 'Pode ser contatada' };
const VALORES = {
 customer: 'Cliente', prospect: 'Prospect', partner: 'Parceiro', internal: 'Interna',
 lead: 'Lead', onboarding: 'Em implantação', active: 'Ativo', paused: 'Pausado', completed: 'Concluído', discontinued: 'Descontinuado', unclassified: 'Não classificado', suspended: 'Suspensa',
 company: 'Empresa', person: 'Pessoa física', nonprofit: 'Sem fins lucrativos',
 owner: 'Proprietário', decision_maker: 'Decisor', champion: 'Champion', finance: 'Financeiro', technical: 'Técnico', operational: 'Operacional', student: 'Aluno', contact: 'Contato',
 true: 'Sim', false: 'Não',
};
const valor = v => (v == null || v === '' ? '—' : VALORES[v] || String(v));

/** `{ title, detail }` de uma linha do histórico. `detail` só quando a trilha guardou o que mudou. */
export function describe(item) {
 const chave = item.source === 'atividade' ? `activity:${item.type}` : item.type;
 const title = TIPOS[chave] || item.type;
 const d = item.details;
 if (d && typeof d === 'object' && d.before && d.after) {
  const linhas = Object.keys(d.after).map(k => `${CAMPOS[k] || k}: ${valor(d.before[k])} → ${valor(d.after[k])}`);
  return { title, detail: linhas.join(' · ') };
 }
 return { title, detail: '' };
}
