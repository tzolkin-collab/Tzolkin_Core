# Auditoria de produto e arquitetura — TZOLKIN Core

Data: 07/09/2026. Escopo: checkout local disponível, não certificação de produção.

## Conclusão

O Core tem módulos reais de identidade, relacionamento, acesso, financeiro, checkout e infraestrutura. Ainda não constitui uma jornada comercial integrada. O intake é uma implementação parcial com bloqueios de persistência e idempotência; o institucional não o consome. Sites exibe uma intenção de inbound que ainda navega para organizações. Prioridade: integridade e política de autorização, depois fluxo comercial, depois publicação.

Artefatos preparatórios:

1. [Catálogo de produtos e serviços](01-catalogo.md).
2. [Responsabilidades Core × produto × serviço × infraestrutura](02-responsabilidades.md).
3. [Jornadas e estados](03-jornadas.md).

São propostas de consolidação para adoção oficial, não decisões empresariais já aprovadas.

## Método e limites

Foram confrontados docs, schema SQL, migrações, handlers HTTP, código da interface e testes locais em tzolkin-core e tzolkin-site. O catálogo importado do Notion é um snapshot de 30/08, não consulta atual ao Notion. Os backends próprios de Barber, Commerce, Educare, Data e Skiller não foram auditados. Ausência abaixo significa ausência no escopo inspecionado, não inexistência em outros repositórios.

Não foram consultados registros de produção, segredos, infraestrutura remota ou a interface autenticada em navegador. Assim, banco significa definição versionada, não schema aplicado; interface significa auditoria estática dos fluxos. Contagens, disponibilidade, configuração de provedores, responsividade e acessibilidade em execução permanecem não verificadas. Não foram feitas migrações, deploys ou alterações funcionais.

**Implementado:** caminho presente no código; não implica ativação em produção. **Parcial:** estrutura ou caminho existe, mas não fecha a jornada. **Proposto:** desenho recomendado sem implementação comprovada. **Ausente:** não localizado no escopo. **Não verificado:** evidência insuficiente para classificar execução externa.

## Evidências principais

Os caminhos abaixo são relativos a tzolkin-core, salvo prefixo ../tzolkin-site.

| ID | Fonte | Evidência |
|---|---|---|
| E1 | apps/api/src/modules/commercial-intake.mjs | Intake, upserts, idempotência, emissão e revogação de chave |
| E2 | db/migrations/015_commercial_intake.sql | Leads, atribuição 1:1 e chave idempotente global |
| E3 | db/migrations/009_organizations_engagements_stakeholders.sql | Índice parcial de origem de stakeholder e tipos de organização |
| E4 | scripts/migrate.mjs | Runner envolve cada arquivo em transação |
| E5 | apps/web/public/app.js, linhas 742 e 754 | Sites: inbound abre product-orgs; texto Sem checkout |
| E6 | apps/api/src/modules/checkout-gateway.mjs | Gateway aceita produto ativo com oferta/template; sem política Sites |
| E7 | apps/api/src/modules/billing.mjs; catalog.mjs | Oferta aceita produto ativo ou draft; sem política por jornada |
| E8 | ../tzolkin-site/src/server/leads/repository.ts; validation.mjs | Persistência local e email_outbox; sem outbox Core; campos fechados sem consentimento |
| E9 | apps/api/src/app.mjs; modules/accounts.mjs | Autenticação geral e owner em contas/times; não há autorização uniforme por ação |
| E10 | apps/api/src/modules/contracts.mjs | Entitlement chamado contrato; snapshot de cobrança não é instrumento contratual |
| E11 | docs/PRODUCT.md; DOMAIN-MODEL.md; DATA-OWNERSHIP.md; PENDENCIAS.md | Afirmações antigas conflitantes com módulos atuais |
| E12 | db/migrations/014_e9_taxonomia_comercial.sql; db/notion-catalog.json | Taxonomia e catálogo com versões divergentes |
| E13 | modules/tracking.mjs; delivery.mjs; finance.mjs; finance-forecasts.mjs | Agenda/apontamento, projetos técnicos, consultas e previsões reais no código |
| E14 | apps/api/src/platform/database.mjs; docs/TESTING.md | Testes de banco podem usar DATABASE_URL quando não há URL dedicada |

## Gaps críticos e reprodução exigida

### G1 — Intake não fecha persistência [P0, parcial]

E1 usa `ON CONFLICT(source_system,source_ref)` para stakeholders. E3 cria índice único parcial com `WHERE source_system IS NOT NULL AND source_ref IS NOT NULL`. O alvo de conflito não traz esse predicado e não há restrição única total equivalente no schema inspecionado. PostgreSQL não pode inferir esse índice para o alvo atual. Impacto esperado: erro e rollback do intake. Confirmar em banco descartável migrado antes de expor o endpoint.

Aceite: aplicar baseline+migrações numa base vazia; enviar intake válido por HTTP; verificar lead, pessoa, organização, atribuição e resposta atômica. Injetar falha intermediária e comprovar zero efeitos parciais.

### G2 — Migração quebra a atomicidade prometida [P0, parcial]

E4 abre BEGIN, executa arquivo, grava schema_migrations e faz COMMIT. E2 também contém BEGIN/COMMIT. O COMMIT interno termina a transação antes do registro do runner: uma falha posterior pode deixar estrutura aplicada sem registro. Dois arquivos têm prefixo 015, mas o runner identifica pelo nome completo: isso é confusão de ordenação, não prova de que um seja ignorado.

Aceite: um único dono da transação, falha injetada antes de registrar migração reverte DDL/dados; segunda execução não reaplica; upgrade de snapshot antigo preserva dados. Não reescrever histórico aplicado sem inventário e estratégia de compatibilidade.

### G3 — Idempotência e identidade comercial frágeis [P0, parcial]

E1 consulta chave+produto; E2 usa PK só na chave. Produtos diferentes disputam chave global. A resposta anterior é devolvida sem comparar hash do payload. Requisições simultâneas podem passar pelo SELECT e terminar em conflito. Lead usa origem hardcoded tzolkin-site e source_ref=chave; organização faz upsert por slug recebido, inclusive alterando nome existente. Pessoa identifica submissão, não pessoa; contratação é sobrescrita por tenant+label.

Aceite: chave no escopo do emissor/produto, hash canônico, payload diferente retorna 409, repetição concorrente retorna mesmos IDs, sem erro 500 nem duplicação; origem estável independente do evento; submissão não renomeia organização existente sem resolução explícita. Dedupe por contato deve sugerir merge auditável; e-mail compartilhado não prova identidade nem autoriza acesso.

### G4 — Credencial concede uma superfície maior que sua finalidade [P0 antes da publicação, parcial]

E1 cria chave vinculada a produto e permite revogar por hash, mas não oferece inventário de IDs operacionais, escopos, expiração, último uso ou trilha de rotação. Emissão/revogação usam audit:false. E9 diferencia auth service/admin, mas intake e contexto compartilham classe de credencial e não há escopo intake explícito. Contas/times têm owner; essa guarda não é aplicada uniformemente às ações de chave.

Aceite: owner ou permissão específica para emitir/revogar; token mostrado uma vez; listagem retorna ID público, nunca token/hash; escopo mínimo, expiração e rotação com sobreposição controlada; chave revogada e produto errado negados; ator/data/resultado auditados sem segredos.

### G5 — Sites não tem bloqueio efetivo de checkout [P0 antes da publicação, parcial]

E5 declara Sem checkout. E6/E7 verificam cadastro/oferta, não jornada. Com Sites ativo e oferta/template, o código não impede criar sessão Stripe. Isso é possibilidade no código, não cobrança observada.

Aceite: política de backend por capacidade comercial rejeita oferta pública, publicação de checkout e criação de sessão de Sites. Testar por HTTP direto e template antigo. A regra não elimina cobrança contratual de um serviço vendido por proposta: separa aquisição pública de cobrança após contratação.

### G6 — Lead não vira trabalho comercial [P1, parcial/ausente]

Há status open/qualified/won/lost/archived no SQL, mas não foi localizada API de listagem/detalhe/edição de leads nem timeline. Não há dono comercial, motivo de perda ou histórico de estágio em E2. commercial_attributions tem PK lead_id: guarda uma atribuição, não sequência de toques. O intake transforma educação/consultoria/assessoria em on_demand e exige company, apesar de o domínio aceitar pessoa física.

Aceite: fila paginada por produto, detalhe, responsável, atividades, mudanças de estágio, perda motivada, reativação e trilha; PF sem empresa fictícia; service_model validado por vocabulário, não convertido silenciosamente; origem original preservada.

### G7 — Site → Core não existe de ponta a ponta [P1, ausente]

E8 grava lead institucional e fila de e-mail. Fila de e-mail não é fila de entrega ao Core. O Site tem validação de contato, hash e locks de idempotência mais completos que o intake. Não foi localizado teste conjunto nem migração dos registros institucionais para o Core. Script migrate-leads do Site não deve ser confundido com migração intersistemas.

Aceite: gravação local+outbox Core atômica, worker com lease/retry/backoff, estado dead-letter e reprocessamento; correlação e latência sem expor PII; indisponibilidade Core não perde lead. Ensaio de migração com mapa de IDs, contagens reconciliadas, exceções e reexecução sem duplicar.

### G8 — Preferências de contato sem evidência [P1 antes de ingestão real, ausente/parcial]

E8 não aceita campo de consentimento; E1 grava contact_allowed=true sem evidência recebida. Não há versão de aviso, finalidade ou timestamp nesse fluxo. Constatação técnica; a auditoria não determina a base legal aplicável.

Aceite: decisão documentada de tratamento por finalidade, aviso versionado, prova quando consentimento for exigido, preferência de comunicação separada e revogável; não presumir autorização de marketing por enviar formulário. Retenção, exportação e exclusão precisam de fluxos e testes próprios, inclusive outboxes e cópias.

### G9 — Documentação perdeu autoridade [P1, parcial]

PRODUCT diz não existir financeiro, equipes ou checkout; módulos atuais existem. DOMAIN-MODEL lista estruturas de cobrança como futuras apesar de descrever entidades recentes. DATA-OWNERSHIP mantém lead comercial só no Site enquanto intake cria no Core. PENDENCIAS diz não existir PUT /api/tenants, mas directory.mjs o implementa. Datas e contagens antigas não comprovam estado atual.

Aceite: uma definição canônica por conceito; docs ligadas a rotas/schema/testes; maturidade e data por capacidade; diferenciar cadastro, disponibilidade observada, saúde e autorização para vender.

## Auditoria da interface e nomenclaturas

| Área | Estado | Gap entre promessa e comportamento | Direção e aceite |
|---|---|---|---|
| Sites / Captação inbound | Parcial | Abre organizações, não leads | Fila própria com origem, estágio e dono; estados vazio/erro distinguíveis |
| Sites / Sem checkout | Parcial | Texto sem imposição no gateway | Mesma política em UI/API; links diretos negados |
| Clientes / Pessoas | Implementado no código | Stakeholder não equivale a usuário com permissão | Separar contato, papel comercial, identidade e vínculo de acesso |
| Contratos / Acessos | Parcial | Entitlement é tratado como contrato | Contrato comercial tem aceite/escopo; direito técnico é derivado |
| Produtos / Serviços / Projetos | Parcial | Catálogo, contratação e recurso técnico ainda exigem interpretação | Cada tela mostra tipo e vínculo; deploy não comprova produto vendável |
| Financeiro | Parcial | Leitura/previsão não prova conciliação nem margem | Mostrar origem, período, atualização e cobertura de vínculo |
| Checkout | Parcial | Editor/schema maior que execução HOSTED/EMBEDDED Stripe | Tipos sem executor identificados como indisponíveis; sucesso só confirmado por evento reconciliado |
| Operação | Parcial | Agenda e apontamento não são OMS universal | Navegação por modelo de negócio; pedidos/estoque/matrícula no produto |
| Permissões | Parcial | Seleção visual de contexto não estabelece RBAC | Testar URL direta e API com ator sem grant |
| Responsividade, teclado, foco e leitor de tela | Não verificado | Leitura de código não comprova usabilidade | QA a 360/768/1440 px, teclado, contraste, erro e rede lenta |

Os dados estáticos em ../tzolkin-site/src/client/shared/data/servicesData.ts incluem métricas e hashes ilustrativos de repositórios. Não foi comprovado uso desses campos na renderização atual; tratá-los como conteúdo de demonstração a rastrear, não prova de integração GitHub ou resultado de cliente.

## Cobertura transversal solicitada

| Área | Estado e lacuna | Critério mínimo |
|---|---|---|
| Identidade e equipe | Sessões e contas existem; RBAC por recurso parcial | Matriz ator×ação×escopo e testes negativos |
| Organizações | company/person/nonprofit/internal e prospect/customer/partner/internal; grupo econômico ausente | Relação entre organizações explícita sem herdar acesso automaticamente |
| Pessoas | Stakeholders e memberships distintos; vínculo comercial aceita um role por par | Permitir múltiplos papéis contextuais sem duplicar pessoa |
| Comercial e origem | Intake parcial; oportunidade/proposta/negociação sem agregado próprio identificado | Lead pode ter várias oportunidades e vários toques, sem sobrescrever história |
| Contratos | Engagement e direitos existentes; escopo, anexos, aditivo, aceite completos ausentes | Versão assinada/aceita e mudança auditável |
| Cobrança | Ofertas, snapshots, gateway e webhooks presentes | Pedido→pagamento→contrato→direito reconciliado; duplicado não concede duas vezes |
| Repasse/comissão | Sem jornada completa comprovada | Definir vendedor/recebedor, regras e conciliação antes de executar |
| OMS e operação vertical | Fora dos backends inspecionados; tracking interno presente | Contrato de resumo por produto, sem copiar operação bruta |
| Entrega | Projetos e vínculos de deploy presentes; SLA/milestone/aceite completo não comprovado | Responsável, prazo, dependências e aprovação por entrega |
| Infraestrutura | Adaptadores EasyPanel/Vercel/DNS/banco presentes | Inventário atual, backup externo e restore ensaiado, rollback verificável |
| E-mail/Redis/filas | Outbox institucional presente; ingestão Core sem fila | Dono por mensagem/evento, retries e monitoramento por fila |
| Financeiro interno | Snapshots/previsões/apontamentos presentes; fechamento e centros de custo completos não comprovados | Vínculo rastreável entre lançamento, contrato e custo; pendência sem rateio inventado |
| Relatórios | Financeiro parcial; funil/retensão/utilização dependem de eventos e custos | Definir numerador, denominador, janela, fonte e atualização de cada métrica |
| Dados/LGPD | Propriedade documentada, evidência de tratamento incompleta | Retenção/exportação/exclusão auditadas por dono |
| Governança | Guardas específicas, sem política uniforme | Produto, preço, acesso, contrato, publicação e exclusão com grants explícitos |
| Evolução | Migrações e /v1 presentes; política de compatibilidade e descontinuação incompleta | Versão de evento, contrato, janela de compatibilidade e plano de retirada |

## Roadmap com gates

| Etapa | Prioridade / dono sugerido | Entrega | Aceite de saída |
|---|---|---|---|
| 0 | P0 / produto + arquitetura | Adotar os três artefatos; decidir donos e jornadas | Cada item tem tipo, adquirente, vendedor, recebedor e responsável; dúvidas explícitas |
| 1 | P0 / backend + QA | G1/G2 e banco de testes dedicado | Instalação limpa, upgrade, falha/rollback e replay passam; testes não usam cadastro real |
| 2 | P0 / segurança + backend | G4/G5 | Grants e escopos negam ações indevidas; Sites bloqueado no gateway |
| 3 | P0 / backend | G3 | Concorrência, hash, conflito e isolamento entre emissores comprovados |
| 4 | P1 / produto + backend | Modelo comercial, G6/G8 | PF, oportunidade, dono, atividades, perdas e finalidade representados; API validada |
| 5 | P1 / frontend | Lista e detalhe inbound | Filtros/paginação, estados vazios/erro, permissões e acessibilidade verificados |
| 6 | P1 / integração | G7 e documentação de API | OpenAPI, exemplos, erros, limites; outbox e contrato Site→Core em ambiente isolado |
| 7 | P1 / dados + operação | Migração antiga e ensaio operacional | Dry run, contagens, mapa de origem, exceções, replay e rollback documentados |
| 8 | P1 / operação | Candidato de publicação EasyPanel | Backup/restore, segredos, observabilidade, smoke, rollback e aceite operacional; então publicar |
| 9 | P2 / produto | Contratos completos e jornadas SaaS/educação | Pagamento, cancelamento, renovação e direitos independentes com reconciliação |

Não há prazo estimado sem inventário de produção e disponibilidade dos responsáveis. A ordem original foi ajustada para antecipar bloqueio de checkout e autorização antes de expor novas superfícies.

## Decisões recomendadas — propostas

- Core é autoridade comercial consolidada da TZOLKIN; Site é canal de aquisição com buffer durável. Leads de clientes permanecem nos produtos.
- Separar portfolio_kind, service_model, acquisition_mode e billing_mode; cada dimensão responde uma pergunta. Política executável, não if de navegação isolado.
- Introduzir oportunidade e contrato comercial próprios. Não promover automaticamente formulário em contrato ou acesso.
- Preferir integração por API/evento minimizado a banco universal. Banco compartilhado simplificaria consulta, mas amplia acoplamento e exposição; cópia total por eventos duplica problemas de propriedade e exclusão.
- Cadastro de pessoa não autentica usuário. Merge comercial nunca concede memberships ou direitos.
- Sites tem inbound consultivo e cobrança pós-contratação; Commerce precisa confirmar se vende implantação, licença ou ambos. Educare é plataforma; ofertas educacionais são itens vendáveis subordinados.
- Recursos técnicos pertencem à infraestrutura e se vinculam a produto ou contratação. Ativar deploy não ativa venda nem contrato automaticamente.
- A direção aprova modelo comercial e exceções; produto mantém catálogo/jornadas; engenharia implementa contratos; operação aprova prontidão. Esses são papéis sugeridos, sem atribuir nomes não confirmados.

## Validação executada

`npm run test:unit`: 155 testes, 155 passaram, 0 falhas, 07/09/2026. Não foi criada suíte nova nem alterado código de aplicação. A pesquisa em test/ não encontrou cobertura nominal de commercial intake. Suíte PostgreSQL não executada: testConnectionString pode cair na base de cadastro, e não foi provisionada base isolada para esta auditoria. Isso mantém G1/G2 como achados estáticos com reprodução explicitamente pendente, não resultados de teste inventados.

Próxima evidência necessária para fechar auditoria operacional: schema aplicado e migrations em leitura, teste de integração isolado, inventário de produtos externos, walkthrough autenticado e restore em ambiente descartável. Nenhuma afirmação de publicação ou receita foi atualizada a partir de documentos antigos.
