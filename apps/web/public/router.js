export const CONTEXTS = {
  general: {
   label: 'ESPAÇO DE TRABALHO',
   views: {
    // HOJE — o que se olha antes de decidir qualquer coisa.
    overview: { title: 'Visão geral', section: 'view-overview', metrics: false },
    finance: { title: 'Financeiro', section: 'view-finance', metrics:false },
    // RELACIONAMENTOS — com quem a TZOLKIN fala.
    companies: { title: 'Empresas', desc: "Organizações cadastradas, sejam ou não clientes.", section: 'view-companies', action: ['Nova empresa', 'tenant-dialog'], metrics:false },
    people: { title: 'Pessoas', desc: "Pessoas do relacionamento comercial, separadas dos acessos aos produtos.", section: 'view-people', action: ['Nova pessoa', 'stakeholder-dialog'], metrics:false },
    clients: { title: 'Clientes', desc: "Quem a TZOLKIN atende e o que cada um contratou.", section: 'view-clients', action: ['Novo cliente', 'tenant-dialog'], metrics:false },
    leads: { title: 'Inbound', desc: "Oportunidades em prospecção, por etapa.", section: 'view-commercial', metrics:false },
    // Campanhas mora dentro de Inbound, como uma aba (montarInbound).
    // Antes oculta (eram só rascunhos). Agora tem fila de envio de verdade: Atividade mostra o que saiu, o que está na fila e o que falhou.
    emails: { title: 'E-mails', section: 'view-emails', metrics:false },
    client: { title: 'Cliente', section: 'view-client', hidden:true, metrics:false },
    // PORTFÓLIO — o que a TZOLKIN tem para vender.
    products: { title: 'Portfólio', desc: "O que a TZOLKIN vende e opera.", section: 'view-products', action: ['Novo espaço', 'space-dialog'], metrics:false },
    // ENTREGA — o trabalho contratado e o andamento dele.
    services: { title: 'Contratações', desc: "Contratações de mentoria, consultoria, assessoria e sob demanda.", section: 'view-services', metrics:false },
    // A atividade e as horas pertencem a uma contratação (migração 041).
    tracking: { title: 'Acompanhamento', section: 'view-tracking', metrics:false },
    serviceCampaigns: { title: 'Campanhas do serviço', section: 'view-service-campaigns', metrics: false, hidden:true },
    // TECNOLOGIA — Conexões diz de quem é cada recurso; uma tela por provedor diz onde ele está.
    connections: { title: 'Conexões', desc: "O que está ligado a cada cliente, contratação ou item do portfólio. O inventário de cada provedor fica nas abas Vercel, GitHub e EasyPanel.", section: 'view-connections', action: ['Novo projeto', 'delivery-new'], metrics:false },
    vercel: { title: 'Vercel', section: 'view-vercel', metrics: false },
    github: { title: 'GitHub', section: 'view-github', metrics: false },
    easypanel: { title: 'EasyPanel', section: 'view-easypanel', metrics: false },
    dns: { title: 'DNS', section: 'view-dns', metrics: false },
    resource: { title: 'Projeto e serviço', section: 'view-resource', metrics: false, hidden:true },
    serverMetrics: { title: 'Métricas de servidor', section: 'view-server-metrics', metrics:false, hidden:true },
    // BASES DE DADOS
    database: { title: 'Banco de dados', section: 'view-database', metrics:false },
    // Oculta: todo número da tela é "Não exposto"; volta com métricas de verdade.
    redis: { title: 'Redis e caches', section: 'view-redis', metrics:false, hidden:true },
    // ADMINISTRAÇÃO
    // Acesso a produto é assunto do contexto de produto; no geral a tela só mostrava vazio.
    access: { title: 'Acessos', section: 'view-access', action: ['Vincular acesso', 'member-dialog'], hidden:true },
    // Oculta do menu: o botão Configurações do rodapé abre (igual ao contexto de produto).
    settings: { title: 'Configurações', section: 'view-settings', metrics:false, hidden:true },
    security: { title: 'Segurança', section: 'view-security', metrics:false, hidden:true },
   },
  },
  product: {
   label: 'GESTÃO DO PRODUTO',
   views: {
    product: { title: 'Visão geral', section: 'view-product' },
    'product-inbound': {title:'Inbound',section:'view-commercial',metrics:false},
    'product-keys': {title:'Chaves de integração',section:'view-product-keys',metrics:false},
    // "Clientes" aqui nunca foi a carteira: é quem tem acesso a ESTE item, que é o
    // que a tela mostra e o que o botão vincula. No contexto geral, Clientes é a
    // carteira — duas telas com o mesmo nome e conteúdos diferentes ensinavam errado.
    'product-orgs': { title: 'Acessos', section: 'view-product-orgs', action: ['Vincular cliente', 'entitlement-dialog'] },
    'product-engagements': { title: 'Contratações', section: 'view-product-engagements', metrics:false },
    'product-payments': { title: 'Cobrança', section: 'view-product-payments', metrics:false },
    'product-receivables': { title: 'Recebimentos', section: 'view-product-receivables', metrics:false },
    'product-emails': { title: 'E-mails', section: 'view-product-emails', metrics:false },
    // Campanhas do item mora dentro de Inbound, como uma aba (montarInbound).
    // Oculta do menu; o botão Configurações do rodapé abre em qualquer contexto.
    settings: { title: 'Configurações', section: 'view-settings', metrics:false, hidden:true },
   },
  },
};

export const SECTIONS = [
  'view-commercial','view-product-keys','view-tracking', 'view-resource', 'view-overview', 
  'view-clients', 'view-leads', 'view-companies', 'view-client', 'view-people', 'view-products', 'view-services', 
  'view-connections', 'view-access', 'view-database', 'view-redis', 'view-settings', 'view-security', 'view-vercel', 
  'view-github', 'view-easypanel', 'view-dns', 'view-server-metrics', 'view-product', 'view-product-orgs', 
  'view-product-engagements', 'view-product-payments', 'view-product-receivables', 'view-product-emails', 
  'view-service-campaigns', 'view-finance','view-emails'
];
