# Mapa de funcionalidades do Core

Fotografia verificável do produto em **2026-09-14**. Este documento responde “o que o Core faz
hoje?”. Riscos e trabalho pendente ficam no [BACKLOG.md](BACKLOG.md); sequência de entregas fica no
[ROADMAP.md](ROADMAP.md).

## Estado atual `[EXISTENTE E VERIFICADO]`

- API Node.js e painel web separados em `apps/api` e `apps/web`.
- PostgreSQL com 30 migrações aplicadas, da `001` à `030`.
- `npm test`: **377 aprovados, 0 falhas e 1 ignorado** em 2026-09-14. O ignorado exige uma
  `DATABASE_URL_TEST` dedicada porque cria trigger e exerce rollback deliberadamente.
- Produção usa Google OIDC; o bootstrap local usa senha e escuta apenas em loopback.
- Valores de segredos não aparecem neste documento nem atravessam respostas administrativas.

## Capacidades operacionais

| Área | O que está disponível | Limite atual |
|---|---|---|
| Identidade e administração | Google OIDC em produção, sessão persistida, contas, papéis, times e allowlist de emergência | MFA e portal de cliente não existem |
| Organizações e pessoas | Empresas/PF/grupos, stakeholders, canais de contato, vínculo pessoa × organização × produto | Preferências de contato ainda não formam uma central de consentimento |
| Portfólio | CRUD de produtos, plataformas e linhas de serviço; draft/ativo/arquivado; revisão otimista; auditoria | Interface do CRUD ainda precisa ser conectada ao novo endpoint `/api/portfolio` |
| Contratações | Criar, editar, arquivar e restaurar por ID, com tipo de serviço e produto opcional | Contrato jurídico completo continua separado |
| Acesso de produto | Entitlements, direitos versionados, memberships por produto e credenciais servidor a servidor | Provisionamento de credencial ainda é administrativo |
| Comercial | Intake por chave escopada, leads, responsável, atividades, estágio, perda, contratos comerciais e fila institucional | Jornada de proposta e assinatura ainda é parcial |
| Projetos e entrega | Cadastro técnico, componentes, ambientes, vínculos de deploy, checklist e ativação | Provisionamento integral e rollback remoto seguem incompletos |
| Deploy e infraestrutura | Inventários Vercel/EasyPanel, recursos, domínios, histórico e operações EasyPanel confirmadas/auditadas | Vercel permanece majoritariamente leitura; DNS não tem escrita pelo Core |
| Cobrança e checkout | Ofertas, templates, checkout Stripe, catálogo Stripe e webhooks Stripe/Asaas idempotentes | Webhooks precisam estar cadastrados nos painéis; Asaas não usa o gateway Stripe |
| Financeiro e bancos | Contas/transações Pluggy, snapshots, vendas Stripe/Asaas e previsões recorrentes | Itens Pluggy ainda dependem de configuração e não sincronizam por agenda própria |
| E-mail | Templates por produto e projeção dos eventos disponíveis | Não há fila/provedor de envio completo nem métricas de entrega |
| Marketing | Meta Ads por token ou OAuth, contas/campanhas/insights, vínculo a produto ou contratação | Renovação e coleta periódica ainda dependem da operação |
| Acompanhamento | Atividades de serviço, agenda, status, horas e auditoria | Trilha existe no banco, mas ainda não tem leitor dedicado no painel |
| PWA | Manifesto, ícones e service worker para push | Assinaturas VAPID, preferências e avaliação de alertas no servidor faltam |

## Fundações prontas com operação incompleta

- `audit_events`, `delivery_audit` e `service_activity_audit`: gravam histórico; faltam consulta e
  investigação no painel.
- `product_resource_bindings`: confirma vínculos descobertos; falta reconciliação agendada e
  resolução assistida de ambiguidades.
- `checkout_templates` e `email_templates`: configuram experiência e conteúdo; publicação, entrega
  e observabilidade ainda não estão completas.
- `finance_snapshots`: preserva a última leitura útil; falta scheduler, conciliação e cadastro de
  itens Pluggy no banco.
- `operator_accounts`, `teams` e `team_members`: modelo e API existem; composição real depende dos
  e-mails dos operadores.
- Backup: 16 rotinas ativas no EasyPanel; destino externo, retenção e ensaio de restauração seguem
  abertos.

## Mudanças consolidadas nesta fase

1. O painel deixou de tratar tudo como “Produtos e planos” e separou portfólio, serviços,
   contratações, projetos, pagamentos e campanhas.
2. O contexto de produto centraliza organizações, cobrança, e-mails, campanhas e recursos daquele
   produto, sem misturar dados de outro produto da mesma organização.
3. Nubank e Inter aparecem pelo nome quando a leitura Pluggy traz contas bancárias reais.
4. Stripe e Asaas compartilham histórico normalizado de webhook, preservando autenticação,
   deduplicação e progressão de estado fora de ordem.
5. Meta Ads passou a usar credencial cifrada no servidor e OAuth com apenas `ads_read`.
6. O intake comercial ganhou chave por produto, idempotência, fila institucional e trilha.
7. O portfólio ganhou revisão concorrente e arquivamento reversível; exclusão física não faz parte
   do fluxo administrativo.
8. O estado OIDC de uso único passou de `DELETE` para `UPDATE consumed_at`, compatível com a role de
   produção sem permissão de exclusão.

## Próxima ordem de execução

1. Ligar a interface ao CRUD de portfólio e contratações da migração 030.
2. Cadastrar e validar webhooks reais em ambiente de teste, depois executar reconciliação.
3. Persistir itens Pluggy e criar sincronização agendada por conta com estado observável.
4. Implementar assinatura push por tópico geral/produto/serviço e preferências do operador.
5. Enviar backups a armazenamento externo, definir retenção e provar restauração isolada.
6. Expor as trilhas de auditoria e aplicar definitivamente a role restrita em produção.
