# Core — plano de execução

Status: reconciliado em `STATUS.md §4`. A ordem importa: cada etapa reduz ambiguidades da seguinte.

## Etapa 0 — estabilizar antes de desenhar

- [ ] Fazer inventário das telas, rotas, componentes e estilos existentes.
- [ ] Identificar CSS duplicado ou conflitante e escolher uma única camada visual.
- [x] Remover da navegação páginas sem conteúdo ou função real. *(feito: telas vazias retiradas do menu e mantidas apenas com dados úteis)*
- [ ] Capturar referência visual do painel atual em desktop e celular.
- [ ] Definir critérios de pronto: dado real, ação principal, vazio útil, responsividade e teste.

## Etapa 1 — modelo de domínio e fonte de verdade

- [ ] Validar no Notion a lista de organizações, contatos, projetos, contratos e pagamentos.
- [x] Definir uma organização como entidade-base: empresa, pessoa física, interna ou parceira. *(feito: `tenants` governa organizações)*
- [ ] Definir cliente como relacionamento comercial ativo, não como tipo de organização.
- [ ] Definir lead como estágio de relacionamento, não como cadastro paralelo.
- [x] Definir pessoa como stakeholder, com papéis e vínculos com uma ou mais organizações. *(feito: `stakeholders` e vínculos implementados)*
- [ ] Definir produto, serviço, projeto, marca e oferta sem sobreposição.
- [ ] Aprovar vocabulário de tags: marca, produto, serviço, canal, projeto e origem.
- [ ] Criar mapeamento Notion → Core com dono de cada campo e regra de sincronização.

## Etapa 2 — arquitetura da navegação

- [ ] Reduzir a sidebar aos módulos que têm dado e ação utilizáveis.
- [ ] Definir a ordem final: Hoje, CRM, Portfólio, Entrega, Tecnologia, Bases de dados, Administração (fixada em `web-nav.test.mjs`).
- [ ] Validar se Produtos pertence a Operação ou a uma área própria de Portfólio.
- [x] Definir Serviços como execução/projetos, separado do catálogo. *(feito: `client_engagements` / Serviços separados de produtos)*
- [x] Manter Mentorias fora da sidebar até haver turma, aluno e matrícula modelados. *(feito: mentorias integradas em serviços)*
- [ ] Manter Configurações, Segurança e Métricas de servidor como subpáginas de Gestão/Tecnologia até possuírem conteúdo real.
- [ ] Definir um ícone semântico e uma ação principal por item de navegação.

## Etapa 3 — sistema visual e sidebar

- [ ] Escolher uma direção visual única e documentar tokens de cor, espaçamento, tipografia e estados.
- [ ] Confirmar disponibilidade/licença de Myriad Pro; usar fallback equivalente quando não instalada.
- [x] Reconstruir a sidebar em um único componente/CSS, eliminando overrides acumulados. *(feito: sidebar em componente/CSS único e com tabindex="-1" para foco no celular)*
- [ ] Projetar estados normal, hover, ativo, foco, carregamento e mobile.
- [ ] Revisar contraste, teclado, leitores de tela e toque em celular.
- [ ] Validar visualmente em desktop, tablet e celular antes de avançar.

## Etapa 4 — telas de visualização

- [ ] Visão geral: prioridades do dia, receita, clientes, projetos e integrações com links acionáveis.
- [ ] Acompanhamento: tarefas, prazos, responsáveis, bloqueios e relação com projeto/cliente.
- [ ] Financeiro: saldo, recebimentos, despesas, previsões e repasses, sempre distinguindo real de estimado.
- [ ] Definir filtros globais por período, marca, produto, cliente e projeto onde fizer sentido.

## Etapa 5 — relacionamentos

- [x] Empresas: diretório de organizações, tipo, status e pessoas vinculadas. *(feito: tela Empresas no ar)*
- [ ] Pessoas: diretório de stakeholders, papel, contato, organizações e permissões.
- [ ] Clientes: visão comercial de organizações com contratação ativa.
- [ ] Leads: pipeline com origem, interesse, responsável, próximo passo e conversão.
- [ ] Criar detalhe de organização com abas: visão geral, pessoas, ofertas, projetos, pagamentos e documentos.
- [ ] Garantir que uma pessoa não seja apresentada como empresa e que empresa não seja duplicada como cliente.

## Etapa 6 — operação comercial e portfólio

- [x] Produtos: catálogo de produtos, plataformas e linhas de serviço. *(feito: portfólio por tipo segundo ADR 0007)*
- [ ] Ofertas/planos: preço, moeda, recorrência, canal e processador de pagamento.
- [x] Serviços: modelo de contratação (consultoria, assessoria, sob demanda, educacional). *(feito: com filtro por tipo de serviço e teste)*
- [ ] Projetos: escopo, status, responsáveis, repositório, entregas e vínculo com cliente/produto.
- [ ] Checkout: vincular venda a cliente/lead de forma explícita, sem inferir somente por e-mail.
- [ ] Criar uma visão de vendas com produto, oferta, cliente, origem, status e valor.

## Etapa 7 — educacional

- [ ] Modelar programa/mentoria, turma, aluno, matrícula e responsável financeiro.
- [ ] Relacionar aluno a pessoa e, quando aplicável, empresa pagadora.
- [ ] Relacionar matrícula a oferta, contrato, cobrança e acesso ao produto.
- [ ] Criar visão de Mentorias somente após esse modelo existir.

## Etapa 8 — pagamentos, contratos e fiscal

- [ ] Centralizar Stripe, Asaas e e-mail em Pagamentos.
- [ ] Modelar venda, assinatura, cobrança, parcela, recebimento, taxa e repasse.
- [ ] Exibir data prevista, data recebida, valor bruto, líquido e situação de cada evento.
- [ ] Modelar contratos e anexos com vínculo à organização, oferta e projeto.
- [ ] Integrar nota fiscal emitida (pela Contabilizei segundo ADR 0008, e não pelo Asaas) à cobrança/contrato correspondente.
- [ ] Diferenciar valores reais, simulados e previstos em todos os gráficos e totais.
- [ ] Implementar previsões recorrentes com vínculo opcional a cliente, produto e projeto.

## Etapa 9 — integrações e importação

- [ ] Auditar Stripe: produtos, preços, clientes, assinaturas, pagamentos e webhooks.
- [ ] Auditar Asaas: clientes, cobranças, parcelas, notas fiscais e webhooks.
- [ ] Auditar Open Finance: instituição real, conta/cartão e sincronização de transações.
- [ ] Importar clientes do Notion com prévia, deduplicação, exclusão explícita do Doutor e log de importação.
- [ ] Criar rotina de conciliação: venda → recebimento → conta bancária → repasse.
- [ ] Nunca expor segredos, dados de cartão ou logs sensíveis no painel.

## Etapa 10 — gestão, segurança e tecnologia

- [ ] Gestão: usuários, equipes, papéis e permissões.
- [ ] Segurança: sessões, auditoria, política de acesso, transporte TLS e alertas.
- [ ] Tecnologia: deploys, saúde dos serviços, inventário e histórico seguro.
- [ ] Métricas de servidor: somente após definir provedor, métricas permitidas e frequência de coleta.
- [ ] Definir alertas operacionais e responsáveis por cada integração crítica.

## Etapa 11 — qualidade e publicação

- [ ] Testar cada fluxo com dados vazios, dados parciais e dados completos.
- [ ] Testar filtros, busca, criação, edição, exclusão autorizada e permissões.
- [ ] Testar responsividade em celular, tablet e desktop.
- [ ] Fazer revisão de acessibilidade: teclado, foco, contraste e textos.
- [ ] Fazer revisão de segurança: autenticação, autorização, CSRF, vazamento de dados e logs.
- [ ] Validar staging com dados de teste antes de produção.
- [ ] Fazer checklist de deploy, monitoramento e rollback.

## Decisões pendentes que bloqueiam o desenho

- [ ] Fonte de dados e regra de sincronização do Notion.
- [ ] Vocabulário final de tags e marcas.
- [x] Diferença operacional entre produto, serviço, projeto e mentoria. *(resolvido na ADR 0007)*
- [ ] Regra de identificação do cliente no checkout.
- [x] Escopo de emissão fiscal no Asaas. *(resolvido na ADR 0008: emissor é a Contabilizei)*
- [ ] Provedor e escopo das métricas de servidor.
