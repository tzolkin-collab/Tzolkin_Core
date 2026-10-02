# Lista completa do que está aberto — 2026-10-01

Junta, sem repetir, o que estava espalhado em `STATUS.md §3`, `BACKLOG.md`, `PENDENCIAS.md`, `FEATURES.md`,
`ROADMAP.md`, `CORE-EXECUTION-TODO.md`, nos dois handoffs, nas ADRs e no que apareceu nesta sessão.
Cada linha traz a **fonte** e, quando a fonte é antiga, **"não reverificado"**: o número ou o estado pode ter
mudado desde a data do documento.

Prioridade: **P0** irreversível ou trava dinheiro/uso real · **P1** fecha o ciclo lead → cliente → contrato →
cobrança → pagamento · **P2** melhora ou limpa. **[D]** depende de decisão do dono. **[VOCÊ]** só o dono alcança
(painel, produção, contrato).

Esta lista **substitui `STATUS.md §3` como checklist vivo**. O resto do `STATUS.md` continua valendo.

---

## 0. Lembretes que você pediu

- [ ] **[VOCÊ] Cadastrar os destinos dos webhooks Stripe e Asaas nos painéis.** Rotas prontas, autenticadas e
  deduplicadas; falta o destino. Sem isso o Core nunca sabe que alguém pagou. *(STATUS §3.F, PENDENCIAS §2.)*
  Você pediu para ser lembrado: **aparece primeiro em toda sessão até fechar**.

## 1. Leads e funil — a frente atual

- [x] **P1** O site manda o lead **direto** ao intake do Core (decisão: tudo centralizado, sem banco por produto).
  *(feito em 02/10, commit `eeeb5cd` no `tzolkin-site`, branch `codex/publicacao-institucional`, **local, sem push**. 34 testes; formato conferido contra `validateIntake` do Core.)*
- [x] **P1** Remover do Core o worker/fila do site: `integrations/institutional-outbox.mjs`, `modules/inbound-delivery.mjs`,
  linha "Entrega do site" em `commercial.js`, variáveis `INBOUND_SITE_*`, e os trechos de teste que leem o SQL do site
  (`scripts/test-commercial.mjs:10`, `test/commercial-intake.test.mjs`).
  *(feito em 01/10: worker, rota, tela e variáveis `INBOUND_*` saíram; testes verdes.)*
- [x] **P1** Corrigir `DATA-OWNERSHIP.md` (lead só no Site) e registrar a decisão em ADR 0011.
  *(feito em 01/10: ADR 0011 e `DATA-OWNERSHIP.md`.)*
- [x] **P1** **Rede de segurança do envio** sem banco: o site tenta o intake 2 a 3 vezes (idempotente) e, se falhar,
  manda e-mail interno com o lead. *(proposta, [D])*
  *(feito em 02/10: 3 tentativas e e-mail interno; só vale com `RESEND_API_KEY`, `EMAIL_FROM` e `EMAIL_INTERNAL_TO` no site.)*
- [ ] **P1** Dedupe por CPF (hash) e CNPJ alfanumérico no intake. O e-mail já deduplica pessoa e empresa (02/10); o documento entra
  quando o formulário pedir. *(STATUS §3.D G3.)*
- [x] **P1** Funil por espaço: pipeline, etapas, fontes, oportunidade (copiar o desenho da Kalidash).
  *(`design/2026-10-01-pipeline-por-espaco-e-atribuicao.md`.)* **[D]** 4 decisões nesse documento.
  *(fase 1 feita em 02/10: migração 040, funis por espaço com funil padrão, etapas, oportunidades e o lead entrando no funil pelo `utm_tzolkin`. **Migração 040 ainda não aplicada no banco compartilhado.** Faltam: fontes, qualificar/descartar/mover o lead pela tela, ganhar → contratação.)*
- [ ] **P0 [VOCÊ]** Aplicar a migração **040** (funil por espaço) no banco compartilhado, antes do deploy do Core. Só adiciona tabelas e colunas; o banco tem 0 leads.
- [ ] **P0 [VOCÊ]** Aplicar a migração **041** (acompanhamento por contratação) no banco compartilhado, junto com a 040. Só adiciona uma coluna, uma chave e um índice; o banco tem 0 atividades.
- [ ] **P0 [VOCÊ]** Aplicar a migração **042** (oportunidade guarda a contratação que criou) junto com a 040 e a 041. Só adiciona uma coluna e um índice; o banco tem 0 oportunidades.
- [ ] **P0 [VOCÊ]** Aplicar a migração **045** (a trilha de auditoria ganha a coluna `details`) junto com as outras. Só adiciona uma coluna opcional.
- [ ] **P0 [VOCÊ]** Aplicar a migração **044** (eventos, automações e tarefas) junto com as outras. Só cria três tabelas; o banco tem 0 leads.
- [ ] **P0 [VOCÊ]** Aplicar a migração **043** (campos próprios por espaço) junto com as outras. Cria uma tabela, duas colunas com padrão e semeia os 4 campos do site; o banco tem 0 leads.
- [ ] **P2** Campos próprios: "obrigatório" vale só no intake; a edição não força preencher os que já existiam. Edição de valor na lista e filtro por campo ficam para depois (os valores moram em `jsonb`; se virar gargalo, tabela própria, como a Kalidash prevê).
- [x] **P1** Funil, fase 5: eventos e automações (e as tarefas mínimas que a ação "criar tarefa" pede).
  *(feito em 02/10: migração 044, `platform/automations.mjs`, `commercial-automations.mjs`, tarefas no lead e gerenciador de automações no Inbound. **Migração 044 ainda não aplicada no banco compartilhado.** Ações de hoje: criar tarefa e atribuir responsável.)*
- [ ] **P1** Funil, o que as fases 3 a 5 deixaram: fontes do lead ("Conectar fonte"), exigências por etapa (bloquear entrar ou sair), automação com atraso (precisa de agendador; ADR 0011 diz sem worker), ações de e-mail e de push na automação, gatilho por webhook de entrada (pagamento confirmado move a oportunidade para Ganho: o Core já recebe Stripe e Asaas), lead criado pela tela (outbound) e mover o lead em lote. **[D]**
- [ ] **P1** Acompanhamento: responsável por operador (depende da decisão: do cliente ou da contratação), orçamento de horas, participantes e anexos.
- [x] **P1** Fase 3 do funil: qualificar, descartar e mover o lead pela tela; ganhar a oportunidade cria a contratação (decisão 3).
  *(feito em 02/10: `commercial-leadflow.mjs`, migração 042 e a tela. **Migração 042 ainda não aplicada no banco compartilhado.** Falta uso com lead real.)*
- [x] **P1** Fase 2 do plano da Kalidash: dedupe de pessoa e empresa (e-mail, CPF por hash, CNPJ alfanumérico) no intake.
  *(feito em 02/10 por e-mail: o mesmo e-mail, em qualquer caixa e em qualquer espaço, reaproveita a pessoa; a empresa é reaproveitada se for da pessoa e tiver o mesmo nome; cliente que volta sai com `returning_client`. Sem migração. Falta CPF por hash e CNPJ: o site não envia documento, então entram quando o formulário pedir.)*
- [x] **P1** Campos próprios por espaço (`space_fields` + `custom_data`) e bloco `space_data` no intake. **[D]**
  *(feito em 02/10: migração 043, `commercial-fields.mjs`, `platform/space-fields.mjs`, gerenciador no Inbound e painel "Dados do espaço" no lead. **Migração 043 ainda não aplicada no banco compartilhado.** Decisão tomada pela recomendação (opção A, só os espaços da Tzolkin); mude se quiser outra.)*
- [x] **P1** `utm_tzolkin`: conferir no servidor que o prefixo é o espaço da chave.
  *(feito em 02/10: o prefixo errado é ignorado para escolher o funil; o site também descarta `utm_tzolkin` que não comece por `sites.`.)*
- [x] **P1** Convenção de URL de anúncio (parâmetros dinâmicos da Meta) escrita em `ATTRIBUTION.md`.
  *(feito em 02/10 em `ATTRIBUTION.md`.)*
- [x] **P1** Tarefas, eventos `objeto.ação` e automações (fases 4 e 5 do plano). *(02/10: tarefas mínimas, dez eventos e automações com duas ações. Requisitos de etapa e automações gerenciadas seguem no item de funil mais abaixo.)*
- [x] **P1** Lead sem "próximo passo" nem conversão em cliente: marcar `won` não muda o `tenant`. *(STATUS §4.)* *(02/10: ganhar a oportunidade cria a contratação e promove a empresa a cliente; o próximo passo é a tarefa.)*
- [ ] **P1** Contrato comercial para cliente que não veio de lead: `POST /api/commercial/contracts` exige `lead_id`
  (as mentorias vieram do Notion). *(handoff 16/09 §5.1.)* **[D]**
- [ ] **P1** Decidir qual registro nasce ao ganhar uma oportunidade (contrato, contratação ou os dois). **[D]**
- [ ] **P1** G6: atribuição de toque único, sem oportunidades múltiplas nem histórico de estágio. *(STATUS §3.D.)*
- [ ] **P1** G8 consentimento: finalidade, revogação, retenção, exportação e exclusão (o site grava
  `contact_allowed=false` sem captar nada). *(STATUS §3.D.)*
- [ ] **P1** Primeiro lead real chegando e visível na tela (hoje: 0 leads, 0 pedidos de intake, 3 chaves nunca usadas;
  medido em 01/10).
- [x] **P2** Verificar no `tzolkin-site` se o UTM ainda é descartado e se a rota de leads ainda dá 503 *(BACKLOG 03/09,
  não reverificado)*.
  *(confirmado e corrigido em 02/10: o formulário nunca conseguia mandar UTM, a rota recusava campo desconhecido. Agora captura e envia.)*
- [ ] **P0 [VOCÊ]** Cadastrar no **ambiente de produção do site** (Vercel): `CORE_INTAKE_URL`, `CORE_INTAKE_KEY` (chave nova do espaço sites,
  escopo `commercial:intake`; o segredo aparece uma vez), `RESEND_API_KEY`, `EMAIL_FROM`, `EMAIL_INTERNAL_TO`. Revisar e mergear a branch do site.
  Sem isso o formulário responde 503 e nenhum lead entra. *(`tzolkin-site/db/README.md`.)*
- [ ] **P1** Primeiro lead real de ponta a ponta com o site novo (formulário → Core → tela de Inbound), em prévia da Vercel antes da produção.
- [x] **P1** O Core ainda não tem onde guardar porte, funcionários, Instagram e site do formulário: hoje vão no início da mensagem.
  Resolve com o bloco `space_data` (campos por espaço). *(feito em 02/10 nos dois lados: o Core guarda e o site manda em `space_data`, com volta ao formato antigo se o Core não conhecer o bloco. Depende do deploy do Core com a migração 043.)*
- [ ] **P2 [D]** "Educacional TZOLKIN" entra no espaço **sites** com modelo `education`. Deveria ir para Mentorias/Educare? *(desta sessão.)*
- [ ] **P2** Código morto no site: `LeadDirectForm.tsx` (ninguém importa), `chatApi.saveLead` (ninguém chama), `db/001–003` e `scripts/email-worker.mjs`
  (legado, fila nunca preenchida). Remover de vez.
- [ ] **P2** Escolher se o CRM da Kalidash (outro contrato) segue separado; leads de produto de cliente no Core exigem
  papel de operador de dado pessoal definido em contrato. **[D]**

## 2. Risco sem volta

- [ ] **P0 [VOCÊ]** Backup com **destino externo**, retenção e restauração testada. 16 backups em disco local do mesmo
  servidor. Já existe um bucket R2. *(STATUS §3.B, PENDENCIAS §1, BACKLOG §1.1.)*
- [ ] **P0 [VOCÊ]** Rotacionar e retirar as credenciais em texto aberto no Notion. *(BACKLOG §1.2.)*
- [ ] **P0 [VOCÊ]** Fechar ou restringir a porta 9000 do EasyPanel. *(BACKLOG §1.3.)*
- [ ] **P0** **Rotacionar as chaves do R2 e o token `cfat_`**: apareceram em conversa. Criar novas restritas ao bucket
  `core`. *(desta sessão.)*
- [ ] **P0** Lembrete agendado do certificado do Postgres (vence 31/08/2027); não existe em lugar nenhum do repositório.
  *(STATUS §3.B.)*
- [ ] **P1** Aplicar a role restrita de produção. Antes, corrigir `PUT /api/teams` (`accounts.mjs:128` faz `DELETE FROM
  team_members`, o único `DELETE` do runtime). *(STATUS §3.B.)*
- [ ] **P1** `ASAAS_CARD_ENABLED=false` é só convenção; nenhum código lê a variável. Falta a trava. *(STATUS §3.B.)*
- [ ] **P1** `local-bootstrap` passa nas ações só de owner (`commercial-keys.mjs:12`); uso de chave de integração não é
  auditado, só `last_used_at`. *(STATUS §3.D G4.)*

## 3. Dinheiro, cobrança e fiscal

- [ ] **P0 [VOCÊ]** **R$ 19.000 nunca cobrados** (Notion: "não enviado"). Não é técnico. *(PENDENCIAS §2, BACKLOG §3.)*
- [ ] **P0 [VOCÊ]** Chave Stripe é `sk_test`: nada lido ali é receita real. *(não reverificado, 02/09.)*
- [ ] **P1** Skiller fatura (3 assinaturas ativas na Stripe) sem cliente, contrato ou direito no Core. *(não reverificado.)*
- [ ] **P1** Confirmar se a fase 1 de Recebimentos (ADR 0008) foi para produção; a tela nunca foi vista no navegador
  com login do dono. *(STATUS §3.C.)*
- [ ] **P1 [D]** Fase 2 da ADR 0008: emissão pelo Asaas, **só com autorização específica do dono**. *(handoff 16/09.)*
- [ ] **P1** Fase 3: "disponível" pela conciliação Pluggy; depende de a Pluggy ler a conta Contabilizei.bank.
- [ ] **P1** Perguntas a Contabilizei, Asaas (Pix Automático, tarifa) e Inter. *(`INTEGRATIONS.md §7`.)*
- [ ] **P1** Venda do checkout sem cliente explícito: `checkout_orders` não tem `tenant_id` nem `lead_id`. **[D]**
- [ ] **P1** Vendas sem produto, oferta, cliente nem origem na tela; contratos sem anexos. *(STATUS §4.)*
- [ ] **P1** Stripe e Asaas sem leitura de clientes e assinaturas; conciliação venda → banco → repasse.
- [ ] **P2** Previsões recorrentes: o formulário envia sempre `null` no vínculo; sem edição nem exclusão. *(STATUS §4.)*
- [ ] **P2** Editor visual de checkout. Fluxo completo de contratos (minuta, assinatura, versão). *(BACKLOG §9.4.)*
- [ ] **P2** Relação oferta Stripe/Asaas ↔ checkout publicado ↔ domínio ↔ produto. *(BACKLOG §9.4.)*
- [ ] **P2 [D]** ADR 0006 item 4: cartão Asaas leva o Core a PCI SAQ-D; tratamento do CPF; Pix/boleto na Stripe.
- [ ] **P2 [D]** Ofertas: a Stripe tem 9, o Core conhece 1. *(não reverificado.)*

## 4. Conexões, infraestrutura e deploy

- [ ] **P1** Pendências da frente "uma conexão, um dono": 500 → 409 na rota por id de conexão de contratação; texto do
  409 ao confirmar projeto de contratação; leitores sem filtro `active`. *(STATUS §3.A, não reverificado.)*
- [ ] **P1 [D]** Dropar `product_deploy_bindings` e `service_deploy_bindings`. *(STATUS §3.A.)*
- [ ] **P1** Reconciliação **agendada** de vínculos (hoje só ao abrir a tela; não há cron). *(STATUS §3.F.)*
- [ ] **P1** O GitHub "não responde" no ambiente local: verificar se é credencial local ou provedor. *(desta sessão,
  🟡 hipótese.)*
- [ ] **P2** Adotar `delivery_project` a partir de recursos detectados (Skiller prova a lacuna); revisão otimista nos
  vínculos; colisão de nomes. *(BACKLOG §9.1.)*
- [ ] **P2** E1.7 fase 2: disparo de deploy da Vercel por Deploy Hook. E12: Vercel igual ao EasyPanel. E13: provisionar
  projeto a partir do repositório. E14: escrita de DNS na Hostinger. *(ROADMAP.)*
- [ ] **P2** Saúde, métricas e logs do EasyPanel; tela de arquitetura por produto; ação de deploy com prévia e rollback.
- [ ] **P2** Banco: ER de verdade, aba de dados com paginação e máscara, todos os bancos, Redis com métricas, catálogo de APIs.
- [ ] **P2** Google Cloud inteiro (Resource Manager, billing, quotas, assistente de OAuth). *(BACKLOG §9.6.)*
- [ ] **P2** Auto-deploy do EasyPanel desligado; `PLUGGY_API_KEY` no `.env` sem consumidor. *(BACKLOG §6.)*
- [ ] **P2** Descobrir o que está no ar em produção (qual commit); o repositório não diz. *(STATUS §5.)*

## 5. Clientes, pessoas, empresas e portfólio (domínio e tela)

- [x] **A fusão de Empresas/Pessoas/Contratações em abas de Clientes foi revertida** (`ecdf52d`, 01/10). Contradizia
  `UX-RELATION-MAP.md` e o E10 ("Empresas e Pessoas passam a ser irmãs"). O menu voltou a ter 14 itens.
- [ ] **P1 [D]** Menu: confirmar a saída de E-mails, Redis e Acessos (ocultos por mim em 01/10). O Acompanhamento voltou em 02/10.
- [ ] **P1** Pessoas sem e-mail nem telefone na lista. *(STATUS §4.)*
- [ ] **P1** Ficha da empresa em grade, sem abas, pagamentos nem documentos. *(STATUS §4; `DESIGN-360.md`.)*
- [x] **P1** Acompanhamento não liga atividade a contratação (a própria ficha admite). Decidir religar ou remover. **[D]**
  *(decidido por você em 02/10: religar. Migração 041, rota, formulário, ficha da empresa por contratação e menu de volta. **Migração 041 ainda não aplicada no banco compartilhado.** Falta uso com dado real: hoje há 0 atividades.)*
- [ ] **P1 [D]** Responsável é do cliente ou da contratação? *(PENDENCIAS §5.)* `acquisition_mode` e `billing_mode` não existem.
- [x] **P1** `PUT /api/tenants` só troca `status`; reclassificar organização continua sem rota. *(STATUS §3.F.)*
  *(feito em 02/10: a rota troca nome, relacionamento, tipo e ciclo de vida, com o antes e o depois na trilha (migração 045), e a ficha ganhou "Editar empresa". O identificador não muda; a organização interna não se reclassifica. **Migração 045 ainda não aplicada no banco compartilhado.**)*
- [ ] **P2** Modelo educacional inteiro: turma, aluno, matrícula, responsável financeiro. *(TODO etapa 7.)*
- [ ] **P2 [D]** Vocabulário de tags e marcas; regra de sincronização do Notion para clientes e contatos (**superada pelo bloco 11**); importação sem log
  nem prévia. *(STATUS §3.E.)*
- [ ] **P2** Fotos: pessoa (stakeholder), avatar nas listas, validar remover/tornar principal na tela, backup do bucket,
  limites por espaço. *(desta sessão.)*
- [ ] **P2** Página "Hoje" como lista de ações; Infraestrutura unificada; "Serviços contratados" duplicado no Portfólio.
  *(`design/2026-10-01-avaliacao-ux-e-nova-navegacao.md`.)*
- [ ] **P2** Captura visual de referência, filtros globais, staging. *(STATUS §4.)*
- [ ] **P2** Decidir se Mentorias e Consultorias viram um espaço só (ADR 0009, item fora de escopo). **[D]**

## 6. Integrações

- [ ] **P1** Pluggy: `PLUGGY_ITEM_IDS` em tabela; widget Pluggy Connect (`POST /connect_token`); sincronização agendada
  (setembro 2 transações, outubro 0). *(ROADMAP, STATUS §3.F.)*
- [ ] **P1 [VOCÊ]** Qual banco falhou no Meu Pluggy; e-mails do Lucas e do Nathan. *(PENDENCIAS §5.)*
- [ ] **P1** Push: o código e a migração 037 existem; **falta validar no iPhone** (VAPID, preferências, avaliação no
  servidor). O STATUS de 29/09 dizia que não existia: desatualizado. *(verificar.)*
- [ ] **P2** Meta Ads: renovação e coleta periódica dependem de operação manual. *(FEATURES.)*
- [ ] **P2** E-mails: provedor, fila, remetente, métricas; o Skiller não tem template. *(BACKLOG §9.4.)*
- [ ] **P2** PWA e ícone na tela inicial do iPhone nunca validados em aparelho. *(BACKLOG §9.7.)*

## 7. Identidade, papéis, auditoria

- [ ] **P1 [D]** D3 (quem vende e quem recebe no fluxo consumidor → cliente), D4 (IdP: produção usa Google OIDC; fechar
  ou reescrever), D5 (RLS ou isolamento por query). *(STATUS §3.E.)*
- [ ] **P1** Leitores de `audit_events`, `delivery_audit`, `service_activity_audit`: nenhuma rota lê. *(STATUS §3.F.)*
- [ ] **P2** E3 papéis e acesso temporário; E6 auditoria completa (antes/depois, retenção); `audit_events.tenant_id NOT NULL`
  impede evento sem cliente. *(ROADMAP, PENDENCIAS §6.)*
- [ ] **P2** E8 contexto de organização cliente (portal). Interface de contas e times (a API existe).
- [ ] **P2** Telas Segurança e Métricas de servidor (placeholders ocultos); alertas operacionais. *(STATUS §3.F.)*
- [ ] **P2** E4: reversão de migração documentada, role de migração separada, restauração testada.

## 8. Qualidade, testes e publicação

- [ ] **P1** Mergear o [PR #1](https://github.com/tzolkin-collab/Tzolkin_Core/pull/1) (base `feature/push-lead-novo`; a cadeia
  precisa entrar em `codex/revisao-seguranca-core`) e fazer o deploy; migração antes do deploy. **[VOCÊ]**
- [ ] **P1 [VOCÊ]** Variáveis em produção (EasyPanel): `R2_ACCOUNT_ID`, `R2_BUCKET`, `R2_ENDPOINT`, `R2_ACCESS_KEY_ID`,
  `R2_SECRET_ACCESS_KEY`. A migração 039 já está no banco compartilhado.
- [ ] **P1** CI: não há `.github/`, nem execução automática de `test:unit`, `test` e `test:ui`.
- [ ] **P2** G2: dois arquivos `015_*`; teste de falha injetada; lint contra `COMMIT` em migração. G5: teste HTTP de
  `/api/checkout/sessions` com `sites`. Teste do filtro de Serviços. *(STATUS §3.D.)*
- [ ] **P2** Foco do menu no celular (`app.js`: `$('sidebar').focus()` sem `tabindex="-1"` no `<aside>`). *(STATUS §3.A.)*
- [ ] **P2** Remover os popups remanescentes (módulo de Projetos); revisão página a página de tipografia, contraste e
  responsividade. *(BACKLOG §9.7.)*
- [ ] **P2** Camada de tela (`test:ui`) cobre 11 telas com dados sintéticos; faltam detalhe de lead, remover foto e Inbound
  com lead. *(desta sessão.)*

## 9. Documentação a corrigir

- [ ] `CORE-EXECUTION-TODO.md` (aplicar o §4 do STATUS), `FEATURES.md`, `TESTING.md`, `ROADMAP.md`, `PENDENCIAS.md`.
- [ ] `PRODUCT.md`, `ARCHITECTURE.md`, `DATA-OWNERSHIP.md`, `DOMAIN-MODEL.md`, `DESIGN-SYSTEM.md`, `UX-RELATION-MAP.md`
  (citam Barber/Commerce/Data e a regra antiga de lead).
- [ ] `decisions/README.md`: ADR 0009 ainda diz "036 não aplicada" (foi aplicada). ADR 0001 e 0003 seguem `PROPOSTO`.
- [ ] `auditoria-2026-09-07/README.md`: registrar o estado de G1 a G9.
- [ ] ADR 0010 cita `spikes/go-mysql`, que só tem pastas vazias (o git não registra). Escrever o spike ou ajustar a ADR. **[D]**

## 10. Fora do Core

- [ ] `tzolkin-site`: `004_core_outbox.sql`, `migrate-core-leads.mjs` e `public/ads/` sem commit; **vão sair do desenho** se o
  site passar a postar direto. Publicação do site e fonte de marca no Core. *(STATUS §3.G.)*
- [ ] `lead-finder` (11 commits não enviados), `haylanderform` (branch com 11 arquivos sujos), `tzolkin-sites` e `v1.0_site`
  (sem repositório Git). *(PENDENCIAS §4, não reverificado.)*

---

## 11. Substituir o Notion pelo Core (decisão do dono em 01/10)

> **Conflito de registro:** o único texto escrito sobre isso diz o **contrário**. O ADR do Notion "Ecossistema TZOLKIN"
> (30/08, aprovado por Gustavo) afirma: "Notion continua sendo a base de conhecimento atual. A visão Core não autoriza
> substituir ou migrar Notion agora". `DATA-OWNERSHIP.md`, `INTEGRATIONS.md` e `UX-RELATION-MAP.md` repetem que
> documentos, calendários e financeiro seguem no Notion e o Core não sincroniza. Isto aqui é uma decisão **nova e ainda não
> registrada**. O mesmo ADR já lista CRM, operação, financeiro operacional e dados como escopo candidato do Core.

- [ ] **P1 [D]** Registrar a decisão em ADR (substituindo o trecho acima) e fechar o que "100%" inclui: o que migra, o que
  só arquiva e o que fica de fora.
- [ ] **P1** Inventário completo do Notion (bancos, páginas, contagens, anexos, links, responsáveis). Cobertura de hoje: só
  busca por palavra; o banco das ~900 tarefas **não foi localizado**.
- [ ] **P1 [D]** Tarefas e calendário ("Tasks — Gustavo", "Tasks — Lucas", "Minhas Tarefas"): módulo de tarefas por operador.
  O Acompanhamento existe, mas está oculto e sem ligação a contratação. As tarefas do Projeto Assinatura vivem no **Asana**,
  não no Notion, e são do cliente: ficam fora por enquanto (🟡 suposição a partir de "nada que meus clientes veem"; confirmar).
- [ ] **P1** Documentos e Wiki (Central de documentos INTERNOS, ADRs, handoffs, scripts, base de conhecimento): módulo de
  documentos com editor, versões, busca, tags e vínculo a cliente e espaço. Hoje só existe `docs/*.md` no repositório.
- [ ] **P1** Financeiro executivo (Ganhos mensais, parcelas por projeto): levar para Financeiro e Recebimentos.
- [ ] **P1** Clientes, contatos e produtos: importação do Notion com prévia, dedupe e log (hoje só o catálogo de produtos, manual).
- [ ] **P2** Páginas que os clientes veem (Projeto Assinatura: Frente Marcelle, Gabi; timeline e status por cliente).
  **Fora do escopo por enquanto** (decisão de 01/10: "nada que meus clientes veem"). Reavaliar junto com o portal do cliente (E8).
- [ ] **P1** Credenciais em texto aberto no Notion: **não migrar segredo nenhum**; rotacionar e guardar só no servidor (liga
  ao P0 da seção 2).
- [ ] **P2** Skills do plugin Tzolkin (cobrar, status-geral, registrar, notion-wiki, memória) apontam para o Notion: repontar
  para o Core ou aposentar.
- [ ] **P2** Corte: congelar o Notion em somente leitura, arquivar e ter plano de volta.
- [ ] **P2** Corrigir "o Notion é a fonte de verdade" em `DATA-OWNERSHIP.md`, `INTEGRATIONS.md`, `UX-RELATION-MAP.md`,
  `README.md` e no ADR do ecossistema.

---

## Contagem (itens abertos)

| Bloco | Abertos |
|---|---:|
| 0. Lembretes que você pediu | 1 |
| 1. Leads e funil | 20 |
| 2. Risco sem volta | 8 |
| 3. Dinheiro, cobrança e fiscal | 15 |
| 4. Conexões, infraestrutura e deploy | 11 |
| 5. Clientes, pessoas, empresas e portfólio | 10 |
| 6. Integrações | 6 |
| 7. Identidade, papéis, auditoria | 6 |
| 8. Qualidade, testes e publicação | 7 |
| 9. Documentação a corrigir | 5 |
| 10. Fora do Core | 2 |
| 11. Substituir o Notion pelo Core | 11 |
| **Total** | **102** |

Contados por script nas linhas de cada item. Fechados e mantidos no histórico: 18. Dos 102 abertos: **P0: 14**, **[VOCÊ]: 15**, **[D] (decisão sua): 16**. Os 900 itens que você citou não estão neste repositório (devem estar no Notion); esta lista é o que o código, os documentos e as sessões mostram.
