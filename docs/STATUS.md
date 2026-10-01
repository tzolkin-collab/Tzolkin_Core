# Status e plano atual do Core

Consolidação de **2026-09-29**, verificada contra o código. **Este é o ponto de entrada.** Se outro documento discordar dele, confira o código e corrija um dos dois.

**Como foi verificado:** `npm run test:unit` (318 aprovados) e `npm test` completo num banco descartável (**519 aprovados, 0 falhas, 0 ignorados**), ambos com o código não commitado. O restante é leitura estática do código, dos documentos e do `git log`, por cinco leituras independentes; os pontos de maior peso foram conferidos de novo à mão.

**O que continua não verificado:** o estado do banco de produção. A consulta de contagens foi negada pelo classificador de permissões e não foi repetida. Só rodou `scripts/check-conexoes.mjs`, que já existia e é somente leitura. Ver §5.

---

## 1. Qual documento seguir

| Para saber… | Leia | Situação |
|---|---|---|
| O que fazer agora | **[LISTA-COMPLETA.md](LISTA-COMPLETA.md)** (substitui o §3 deste arquivo, 01/10) | vigente |
| O que o Core faz hoje | [FEATURES.md](FEATURES.md) | **desatualizado**: foto de 14/09 (30 migrações, 377 testes). Real: 35 migrações escritas, 034 aplicada |
| Riscos abertos, com evidência | [BACKLOG.md](BACKLOG.md) §1, §3, §9.8 | vigente. Contagens de §9.9 são de 05/09 |
| Decisões tomadas | [decisions/README.md](decisions/README.md) | vigente (0001 e 0003 seguem `PROPOSTO`) |
| Cobrança de linhas de serviço | [handoff-2026-09-14-portfolio-e-cobranca.md](handoff-2026-09-14-portfolio-e-cobranca.md) | vigente até 16/09; não cobre 21–24/09 |
| Operação de produção e Meta | [PRODUCTION-DEPLOY.md](PRODUCTION-DEPLOY.md) | vigente (15/09) |
| Testes | [TESTING.md](TESTING.md) | contagem desatualizada (460 em 16/09; hoje 519) |
| Modelo e regras | [DOMAIN-MODEL.md](DOMAIN-MODEL.md), [BILLING.md](BILLING.md) | DOMAIN-MODEL §4 ainda lista como "não modeladas" entidades de cobrança que existem |
| Integrações | [INTEGRATIONS.md](INTEGRATIONS.md) | vigente (14/09) |

**Superados ou históricos. Não use como lista de tarefas:**

| Documento | Por quê |
|---|---|
| [handoff-2026-09-14-core-estado-atual.md](handoff-2026-09-14-core-estado-atual.md) | Substituído pelo handoff de 16/09 |
| [CORE-EXECUTION-TODO.md](CORE-EXECUTION-TODO.md) | Escrito em 02/09, 77 caixas abertas (71 + 6 decisões). **Reconciliado no §4 deste arquivo** |
| [ROADMAP.md](ROADMAP.md) | Base de 30/08. E1.8 diz que o EasyPanel real está pendente, mas 10 serviços foram lidos em 05/09 |
| [PENDENCIAS.md](PENDENCIAS.md) | Números de 02/09. Diz que falta `PUT /api/tenants`, que existe (só altera `status`) |
| [CONTEXT.md](CONTEXT.md) | Fatos de 30/08 e 03/09. Vale pelas restrições da §3 e por D1–D5 |
| [auditoria-2026-09-07/](auditoria-2026-09-07/) | Propostas. O estado de G1–G9 está no §3.D abaixo; o README da auditoria não foi atualizado |
| `PRODUCT.md`, `ARCHITECTURE.md`, `DATA-OWNERSHIP.md`, `UX-RELATION-MAP.md`, `DESIGN-SYSTEM.md` | Citam Barber, Commerce e Data (removidos em 14/09). `PRODUCT.md:31` diz que financeiro e equipe não existem; `DATA-OWNERSHIP.md:20` põe o lead só no Site; `DESIGN-SYSTEM.md` contradiz o CSS (cor, raio, largura da sidebar) |

---

## 2. Onde estamos

**Portfólio ativo:** `core` (internal), `skiller` (product), `educare` (platform), `sites`, `mentorias`, `consultorias` (service_line). O tipo governa o que o item pode fazer ([ADR 0007](decisions/0007-portfolio-kind-rotulo-ou-regra.md)).

**Cobrança de linha de serviço:** fase 1 da [ADR 0008](decisions/0008-origem-da-cobranca-de-servicos.md) feita (migração 033). Fase 2 (Asaas) e fase 3 (disponível pela conciliação) não existem.

**Frente em andamento — "uma conexão, um dono":**

| Peça | Estado verificado |
|---|---|
| Migração 034 | Aplicada em produção em 24/09. `check-conexoes.mjs` rodado hoje: 0 ativas sem dono, 0 recursos com dois vínculos, 0 só na tabela antiga, 0 divergentes; 1 desligada (`site-proposta-magic`) |
| Migração 035 | Commitada e enviada ao remoto (nada a enviar). **Não aplicada** (não confirmável sem ler o banco) |
| Código da fase seguinte | **Não commitado**: 25 arquivos alterados e 7 novos (`connections.js`, `connections.css` e 5 testes). **Testes passam: 519/519** |
| Já feito nesse código não commitado | Tela Serviços lista mentorias com filtro por tipo (`app.js:706`); projeto técnico não cria mais item `product` (`delivery.mjs`) |

---

## 3. Checklist único

### A. Fechar a frente das conexões

- [x] Testar o código não commitado (519/519 em 29/09)
- [ ] **Commitar** esse código (24 dias de trabalho de duas frentes sem commit)
- [ ] Corrigir as pendências conhecidas da memória do projeto (500→409 na rota por id de conexão de contratação; texto errado no 409 ao confirmar projeto de contratação; leitores sem filtro `active`). **Não reverifiquei** se o código novo já as cobre
- [ ] Deploy do código e, imediatamente antes, a migração 035
- [ ] Rodar `scripts/check-conexoes.mjs` depois
- [ ] Decidir: dropar `product_deploy_bindings` e `service_deploy_bindings` (migração 036)
- [ ] Corrigir o foco do menu no celular: `openNavigation` chama `$('sidebar').focus()` (`app.js:216`), mas o `<aside>` não tem `tabindex="-1"` (`index.html:41`)
- [ ] Teste para o filtro de Serviços (não há)

### B. Risco sem volta

- [ ] Backup com destino externo, retenção e restauração testada (16 backups em disco local)
- [ ] Rotacionar e retirar as credenciais em texto aberto no Notion
- [ ] Fechar ou restringir a porta 9000 do EasyPanel
- [ ] **Lembrete do certificado do Postgres (vence 31/08/2027): não existe em nenhum lugar do repositório**, só o texto do BACKLOG
- [ ] Aplicar a role restrita de produção. **Antes, corrigir `PUT /api/teams`:** faz `DELETE FROM team_members` (`accounts.mjs:128`), único `DELETE` do código de runtime, e falha com a role sem DELETE sempre que o corpo trouxer `members`
- [ ] `ASAAS_CARD_ENABLED=false` é só convenção: nenhum código lê a variável. Se cartão Asaas deve ficar bloqueado, falta a trava no código

### C. Cobrança de linha de serviço (ADR 0008)

- [ ] Confirmar se a fase 1 (Recebimentos) foi para produção
- [ ] Contrato comercial sem lead: **confirmado aberto**, `POST /api/commercial/contracts` responde 404 sem `lead_id` válido (`commercial-workspace.mjs:58`)
- [ ] Perguntas ao Contabilizei, Asaas (Pix Automático, tarifa) e Inter
- [ ] Fase 2: emissão pelo Asaas, só com autorização específica do dono
- [ ] Fase 3: disponível pela conciliação Pluggy

### D. Auditoria de 07/09 — estado verificado

| Gap | Estado | O que falta |
|---|---|---|
| G1 intake vs índice | **Resolvido** no código (sem `ON CONFLICT`, advisory lock, índice `(product_id,source_system,source_ref)`; teste com trigger e rollback) | Nada no código. Passou na suíte de 29/09 |
| G2 migração e transação | **Quase resolvido**: nenhuma migração tem `BEGIN/COMMIT` de arquivo; `migrate.mjs` é o único dono | Dois arquivos `015_*`; sem teste de falha injetada nem lint que impeça `COMMIT` futuro |
| G3 idempotência | **Resolvido** (chave por produto, hash, 409, concorrência testada com 6 chamadas) | Dedupe por contato e sugestão de merge; `source_system` cai em `'tzolkin-site'` por padrão |
| G4 credenciais | **Resolvido** (escopos, expiração obrigatória, token uma vez, rotação, revogação, trilha) | Operador sem linha em `operator_accounts`, ou `local-bootstrap`, passa nas ações só de owner (`commercial-keys.mjs:12`); uso da chave não é auditado, só `last_used_at` |
| G5 checkout de Sites | **Resolvido** (`CAPABILITIES.checkout` exclui `service_line`; gateway responde 404) | Teste HTTP direto de `/api/checkout/sessions` com `sites`; `checkout-gateway.test.mjs` só usa `skiller` |
| G6 leads | **Parcial**: fila, detalhe, dono, atividades, perda motivada, PF | `commercial_attributions` guarda um toque só; sem oportunidades múltiplas nem histórico de estágio dedicado |
| G7 Site→Core | **Parcial**: outbox com lease, backoff e reprocesso existe | `004_core_outbox.sql` e `migrate-core-leads.mjs` estão **não commitados no repositório do site**, e a suíte do Core depende deles; sem mapa de IDs, reconciliação nem correlação |
| G8 consentimento | **Aberto** | Core valida aviso e data; o Site grava `contact_allowed=false` sem captar nada. Faltam finalidade, revogação, retenção, exportação e exclusão |
| G9 documentação | **Aberto** | Ver §1 |

### E. Decisões que só o dono toma

- [ ] **D3** — quem vende e quem recebe no fluxo consumidor → cliente
- [ ] **D4** — IdP. Produção usa Google OIDC; MFA e portal de cliente seguem fora. Fechar ou reescrever
- [ ] **D5** — RLS ou isolamento por query
- [ ] ADR 0006, item 4 — cartão Asaas leva o Core a PCI SAQ-D; tratamento do CPF; Pix/boleto ativos na Stripe
- [ ] ADR 0001 e 0003 seguem `PROPOSTO`
- [ ] Responsável é da contratação ou do cliente?
- [ ] `acquisition_mode` e `billing_mode`: não existem em código nem em migração
- [ ] Regra de identificação do cliente no checkout: `checkout_orders` não tem `tenant_id` nem `lead_id`
- [ ] Vocabulário de tags e marcas (só existe `finance_forecasts.tags`, texto livre)
- [ ] Regra de sincronização do Notion para clientes e contatos (só o catálogo de produtos tem regra)
- [ ] Provedor e escopo das métricas de servidor
- [ ] E-mails do Lucas e do Nathan; qual banco falhou no Meu Pluggy
- [ ] Publicação do `tzolkin-site`; fonte de marca no Core

**Resolvidas, podem sair da lista:** ambiguidade de `service_model='education'` (as duas telas dizem "Mentoria"); "produto vs serviço vs projeto vs mentoria" ([ADR 0007](decisions/0007-portfolio-kind-rotulo-ou-regra.md)); emissor de NFS-e (Contabilizei, ADR 0008); `delivery.mjs` criar tudo como `product` (corrigido no código não commitado).

### F. Integrações e operação — confirmado aberto no código

- [ ] Webhooks Stripe e Asaas: as rotas existem, autenticadas e deduplicadas; falta cadastrar destinos nos painéis
- [ ] Pluggy: `PLUGGY_ITEM_IDS` ainda é variável de ambiente, não há tabela nem sincronização periódica
- [ ] Push no iPhone: não existe VAPID, tabela nem rota; só o `sw.js` exibe a mensagem
- [ ] Leitores de `audit_events`, `delivery_audit` e `service_activity_audit`: nenhuma rota lê, o explorador de banco as esconde
- [ ] Reconciliação agendada: não há `setInterval`, cron nem `.github/`; a de vínculos roda só ao abrir a tela
- [ ] `PUT /api/tenants` só troca `status`; reclassificar organização continua sem rota
- [ ] Interface de contas e times: a API existe, nenhuma tela a chama
- [ ] Tela Segurança e Métricas de servidor: placeholders ocultos
- [ ] Alertas operacionais: não há módulo

### G. Fora do Core

- [ ] `lead-finder`: 11 commits não enviados; `haylanderform`: branch com 11 arquivos sujos
- [ ] `tzolkin-sites` e `v1.0_site` sem repositório Git
- [ ] `tzolkin-site`: arquivos novos e alterações sem commit (`004_core_outbox.sql`, `migrate-core-leads.mjs`, `public/ads/`)

---

## 4. CORE-EXECUTION-TODO reconciliado

O arquivo original segue como está. Ele tem 71 itens nas etapas 0–11 e 6 decisões pendentes (77 caixas); este é o veredito dos 71 por etapa. As decisões estão no §3.E. **FEITO** = código encontrado; nenhum item recebeu teste próprio além da suíte geral. Itens que exigem decisão ou olho humano ficam separados.

| Etapa | Feito | Parcial | Aberto | Só humano |
|---|:-:|:-:|:-:|:-:|
| 0 Estabilizar | 1 | 3 | 1 | 0 |
| 1 Modelo de domínio | 2 | 4 | 1 | 1 |
| 2 Navegação | 3 | 2 | 1 | 1 |
| 3 Sistema visual | 1 | 2 | 0 | 3 |
| 4 Visualização | 0 | 3 | 1 | 0 |
| 5 Relacionamentos | 1 | 5 | 0 | 0 |
| 6 Comercial e portfólio | 2 | 3 | 1 | 0 |
| 7 Educacional | 0 | 1 | 3 | 0 |
| 8 Pagamentos e fiscal | 0 | 6 | 1 | 0 |
| 9 Integrações | 0 | 5 | 1 | 0 |
| 10 Gestão e segurança | 0 | 3 | 2 | 0 |
| 11 Qualidade | 0 | 5 | 1 | 1 |
| **Total (71 itens das etapas)** | **10** | **42** | **13** | **6** |

**O que está de fato feito:** sidebar num só CSS; telas vazias fora da navegação; organização como entidade-base; pessoa como stakeholder; Serviços separado do catálogo; Mentorias fora da sidebar; portfólio por tipo; Empresas; Serviços com filtro por tipo (código não commitado).

**Abertos de verdade:** captura visual de referência; vocabulário de tags; filtros globais; checkout ligado ao cliente; modelo educacional inteiro (turma, aluno, matrícula); conciliação venda→banco→repasse; nota fiscal do Asaas (contradiz a ADR 0008, deve sair do TODO); métricas de servidor; alertas; staging.

**O TODO está errado em:**
- A ordem da navegação (Visualização, Relacionamentos, Operação, Educacional, Gestão, Tecnologia). O código usa Hoje, Relacionamentos, Portfólio, Entrega, Tecnologia, Bases de dados, Administração, fixada em `web-nav.test.mjs`.
- "Sidebar só com módulos que têm dado e ação": há 18 itens visíveis contra 9 na decisão de 02/09; só 6 declaram ação principal; `emails` não tem ícone próprio.
- "Nota fiscal do Asaas": a NFS-e é da Contabilizei.
- "Clientes = organizações com contratação ativa": a tela filtra por `relationship_kind='customer'`.

**Parcial que mais pesa:** Pessoas não mostra e-mail nem telefone; Leads sem "próximo passo" nem conversão em cliente (marcar `won` não muda o tenant); ficha da empresa é grade, sem abas, sem pagamentos nem documentos; previsões recorrentes têm vínculo no backend, mas o formulário envia sempre `null`, e não há edição nem exclusão de previsão; vendas sem produto, oferta, cliente nem origem; contratos sem anexos; Stripe e Asaas sem leitura de clientes e assinaturas; sem log nem prévia de importação do Notion.

## 5. Ainda não verificado, e por quê

- **Banco de produção.** Contagens de tabelas, se a 035 está aplicada, quantos contratos e leads existem, permissões reais da role. A leitura foi negada. Para liberar, é preciso uma regra de permissão explícita do Bash para esse script somente leitura, ou rodar você mesmo.
- **Deploy.** Não há como saber, pelo repositório, qual commit está no ar no EasyPanel.
- **Telas em navegador.** Nenhuma tela foi aberta; a de Recebimentos exige login do dono. O que se sabe das telas vem do código e de testes de contrato textual.
- **Responsividade, contraste, leitor de tela, iPhone.** Só validação humana.
- **Pendências da memória (§3.A, 3º item).** Não conferi se o código novo as resolve.

## 6. Documentação a corrigir

1. `CORE-EXECUTION-TODO.md`: aplicar o §4 (marcar os 10 feitos, corrigir os 4 pontos errados, tirar a NFS-e do Asaas).
2. `FEATURES.md`, `TESTING.md`: 35 migrações, 519 testes, recebimentos, Conexões.
3. `ROADMAP.md`: E9 entregue, E1.8 verificado em 05/09.
4. `PRODUCT.md`, `ARCHITECTURE.md`, `DATA-OWNERSHIP.md`, `DOMAIN-MODEL.md`, `DESIGN-SYSTEM.md`, `UX-RELATION-MAP.md`: Barber/Commerce/Data e as afirmações de G9.
5. `PENDENCIAS.md`: mover o que vale para cá e arquivar.
6. `auditoria-2026-09-07/README.md`: registrar o estado dos gaps (§3.D).
7. Numeração: dois arquivos `015_*`.

## 7. Como manter

Um único checklist vivo: este. Item novo entra em §3 com o documento de origem; item fechado é marcado e datado, não apagado, até a próxima consolidação.
