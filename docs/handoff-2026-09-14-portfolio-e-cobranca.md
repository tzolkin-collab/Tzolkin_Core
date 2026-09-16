# Handoff — portfólio por tipo e cobrança das linhas de serviço

Aberto em **2026-09-14**, atualizado em **2026-09-16**. Para continuar num chat novo, peça:
*"Leia `docs/handoff-2026-09-14-portfolio-e-cobranca.md` e continue de onde parou."*

- **Repositório:** `D:\Códigos\Tzolkin\Projetos\Outros\Site - Tzolkin\tzolkin-core`
- **Branch:** `codex/revisao-seguranca-core`. A `main` preserva o estado antigo.
- **Remoto:** `origin` (`tzolkin-collab/Tzolkin_Core`), sincronizado em 2026-09-16 até este handoff.
  O deploy de produção não foi feito nesta sessão.
- **Banco compartilhado (produção):** migração `033_service_receivables.sql` aplicada.
- **Última verificação completa:** `npm test` com 460 aprovados, 0 falhas, 0 ignorados e código de
  saída 0, num banco descartável.
- **Árvore de trabalho:** limpa.

O outro handoff, `docs/handoff-2026-09-14-core-estado-atual.md`, é um retrato de 14/09 anterior a
estas entregas. Ele ainda cita a migração 032 e 386 testes.

---

## 1. O que está entregue

| Frente | Migração | Commit | Estado |
|---|---|---|---|
| Remover Barber, Commerce e Data do portfólio | `031` | `04d08da` | ✅ em produção no banco |
| Classificação do portfólio e contextos de Mentorias e Consultorias | `032` | `dde07ef` | ✅ |
| Opção B da ADR 0007: o tipo governa o que o item pode fazer | — | `98cd9f5` | ✅ |
| Importador do Notion preserva a classificação | — | `7d4b4c8` | ✅ |
| Desenho da cobrança de linha de serviço (ADR 0008) e pesquisa Contabilizei | — | `b4f7296`, `fe555b2` | ✅ ADR aceita |
| `npm test` sempre num banco descartável | — | `7a757ae` | ✅ |
| Harness não deixa banco descartável para trás | — | `70e7ccf` | ✅ |
| **Recebimentos de linha de serviço — ADR 0008, fase 1** | `033` | `82a374f` | ✅ migração aplicada; deploy não feito |

Houve também commits de outras frentes no meio (`8c3e75a` chaves de integração, `d085831` Deploys,
`24e240b` ficha da empresa, `92f98ba` login da Meta para empresas). Eles estão no outro handoff e
no `git log`.

---

## 2. Portfólio e política de capacidades (ADR 0007)

**Classificação atual no banco:**
- `skiller`: `product`
- `educare`: `platform` (assinatura de cursos e conteúdos)
- `sites`, `mentorias` e `consultorias`: `service_line`
- `core`: `internal`

**Teste para separar produto de serviço:** se o cliente cancelar, ele perde acesso a algo nosso
(produto) ou fica com o que entregamos (serviço)?

**A política vive em `apps/api/src/modules/catalog.mjs` (`CAPABILITIES`).** Rota nenhuma testa id
nem tipo por conta própria.

| Capacidade | `product` | `platform` | `service_line` | `internal` |
|---|:-:|:-:|:-:|:-:|
| `access`: contrato de acesso, vínculo, chave `context:read`, `/v1/context` | sim | sim | não | não |
| `checkout`: oferta, template, checkout público | sim | sim | não | não |
| `product_engagement`: contratação com `service_model = 'product'` | sim | sim | não | não |
| `commercial`: captação, chaves `commercial:*`, contratações | sim | sim | sim | não |
| `contract_billing`: cobrança a partir de contrato aceito (ADR 0008) | não | não | sim | não |
| `operate`: recursos, deploys, e-mails, campanhas | sim | sim | sim | sim |

- **Painel:** monta a navegação de cada contexto pelas capacidades que a API devolve
  (`VIEW_CAPABILITIES` em `app.js`).
- **Reclassificação:** `PUT /api/portfolio/:id` recusa mudar o tipo enquanto houver algo vivo
  dependendo de uma capacidade que o tipo novo perde.

---

## 3. Recebimentos de linha de serviço — fase 1 (ADR 0008)

**Detalhes completos:** `docs/BILLING.md` ("Fase 1") e a seção Implementação da
`docs/decisions/0008-origem-da-cobranca-de-servicos.md`.

**Decisões do dono (14/09):**
- a cobrança nasce de uma versão **aceita** de `commercial_contracts`;
- a NFS-e é emitida **pela Contabilizei**; o Core só registra;
- **disponível** é só o crédito no extrato bancário, pela conciliação via Pluggy.

**O que existe:**
- **Tabelas:** `service_receivable_plans` (guarda a versão e uma cópia do contrato aceito; um plano
  vivo por contrato), `service_installments` e `service_receivable_audit`.
- **Módulos:** `apps/api/src/modules/service-receivables.mjs` e a tela
  `apps/web/public/service-receivables.js`, na aba **Recebimentos** do contexto da linha de serviço.
- **Fluxo:** prévia (não grava) → rascunho → aprovação do dono → por parcela:
  - registrar a cobrança externa (Cobre PJ ou outra, com referência e link `https`);
  - registrar o pagamento, sem data futura;
  - registrar a NFS-e, uma única vez;
  - mudar o vencimento, só antes da cobrança;
  - cancelar.
- **Parcelas:** somam exatamente o contrato, em inteiros. A tela gera parcelas mensais iguais, com o
  resto dos centavos na primeira. A lista explícita de parcelas só existe pela API.
- **Permissões:** o dono (`owner`) faz todas as ações com dinheiro; o membro monta e descarta
  rascunho.
- **Pago e disponível:** `paid` e `available` são situações distintas, e nenhuma rota grava
  `available`.
- **Nada vai a provedor nesta fase.**

**Verificação:**
- `test/unit/service-receivables.test.mjs` cobre cálculo e travas;
- `test/service-receivables.test.mjs` percorre o fluxo inteiro contra PostgreSQL real, inclusive os
  `CHECK` do banco.

**A tela não foi conferida no navegador:** exige login do dono.

---

## 4. Primeiros passos no próximo chat

1. **Deploy em produção**, se o dono pedir. O código já está no remoto; o deploy segue o processo do
   outro handoff (EasyPanel, projeto `other`, serviço `core`).
2. **Conferir a aba Recebimentos no painel.** Hoje **não há nenhum contrato comercial ativo** no
   banco, então a tela vai mostrar "Nenhum contrato aceito aguardando plano". Para testar de verdade:
   Inbound → lead → criar contrato → aceitar com referência → Recebimentos → montar plano.
3. **Resolver a lacuna de contrato sem lead** (§5, item 1) antes de cobrar clientes que não vieram
   de inbound.

---

## 5. Pendências, em ordem sugerida

1. **Contrato comercial para cliente que não veio de lead.** `POST /api/commercial/contracts` exige
   `lead_id`, mas a coluna aceita nulo. As mentorias existentes (João Mentoria, Rafael Sales) vieram
   do Notion, não de inbound: hoje não há caminho no painel para criar o contrato delas e, portanto,
   para cobrá-las. Decidir se o contrato nasce da contratação (`client_engagements`) ou da empresa,
   sem lead.
2. **Fase 2 da ADR 0008 — emissão pelo Asaas.**
   - Cria cobrança real: **só com autorização específica do dono**.
   - Idempotência por tentativa; estado desconhecido não gera nova tentativa automática.
   - Cancelamento e mudança de vencimento no provedor.
   - O webhook marca `paid` (`paid_source = 'webhook'`), reaproveitando `payment_webhook_events`.
3. **Fase 3 — disponível pela conciliação bancária.**
   - Crédito no extrato Pluggy, considerando tarifa descontada e repasse agrupado. Repasse não é
     segunda receita.
   - Depende de saber se a Pluggy lê o Contabilizei.bank.
4. **Perguntas aos fornecedores** (lista completa em `docs/INTEGRATIONS.md` §7):
   - **Contabilizei:**
     - existe API ou webhook do Contabilizei.bank ou do Cobre PJ?
     - o extrato do Asaas entra automático ou por OFX?
     - se o Asaas emitir a NFS-e, a nota é importada sem duplicar?
     - a conta pode ser lida por Open Finance?
   - **Asaas:** a TZOLKIN é elegível ao Pix Automático? Qual a tarifa efetiva?
   - **Inter:** tarifas da API de cobrança.
5. **Pendências da ADR 0007:**
   - `delivery.mjs` ainda cria todo projeto técnico como `product`, e o checklist de ativação
     pressupõe produto;
   - `service_model = 'education'` ficou ambíguo: a tela chama de "Educacional" (`app.js`) e de
     "Mentoria" (`campaigns.js`);
   - dimensões `acquisition_mode` e `billing_mode`, apontadas pela auditoria de 07/09.
6. **Documentação datada:** `PRODUCT.md` e a auditoria de 07/09 ainda citam Barber, Commerce e Data
   como registro da época. O outro handoff está desatualizado.

---

## 6. Armadilhas conhecidas

- **`npm test` roda num banco descartável** (`scripts/test-commercial.mjs --all`). Ele cria o banco,
  aplica `schema.sql` e as migrações (duas vezes), importa o catálogo do Notion, roda em série e
  apaga no final. Não escreve no banco de produção. Um arquivo sozinho:
  ```bash
  node scripts/test-commercial.mjs test/arquivo.test.mjs
  ```
- **A suíte completa leva cerca de 4 minutos.** Se um `tzolkin_test_commercial_*` sobrar no
  servidor, algo interrompeu o harness antes do `DROP`.
- **Migração no banco de produção é com o dono.** O sistema de permissões bloqueou o assistente em
  `npm run db:migrate`. O assistente também não faz exclusão permanente de dado.
- **Arquivos com CRLF.** `app.js`, `index.html` e `assets.mjs` usam CRLF: edição por script precisa
  respeitar o fim de linha. Os avisos "LF will be replaced by CRLF" do git são inofensivos.
- **Mocks dos testes unitários casam o SQL pelo prefixo** `SELECT id,name FROM products`.
  `findProductFor` mantém esse prefixo de propósito.
- **Datas `date` do PostgreSQL:** o módulo de recebimentos as seleciona como texto (`::text`),
  porque o driver `pg` as converteria em `Date` na hora local.
- **Rascunho aceita contrato de acesso de propósito:** o checklist de ativação do projeto exige
  contrato preparado. Rascunho nunca dá acesso.
- **ID de item do portfólio nunca muda:** aparece em `/c/:productId` e em chaves emitidas. Excluir é
  arquivar; a role de produção não tem DELETE.
- **Stripe no Brasil não serve para Pix de serviço:** é por convite, limitado a R$ 3.000 e sem Pix
  Automático. Para Mentorias e Consultorias, o caminho técnico é o Asaas (pesquisa de 14/09).

---

## 7. Arquivos de referência

- **Decisões:** `docs/decisions/0007-portfolio-kind-rotulo-ou-regra.md`,
  `docs/decisions/0008-origem-da-cobranca-de-servicos.md` e `docs/decisions/README.md`.
- **Cobrança e integrações:** `docs/BILLING.md` (linhas de serviço, fases 1 a 3) e
  `docs/INTEGRATIONS.md` §7 (Contabilizei, alternativas e perguntas).
- **Modelo e estado:** `docs/DOMAIN-MODEL.md`, `docs/FEATURES.md`, `docs/TESTING.md` e
  `docs/CONTEXT.md` (D2 resolvida).
- **Código:**
  - política: `apps/api/src/modules/catalog.mjs` e `portfolio.mjs`;
  - recebimentos: `service-receivables.mjs`;
  - contratos comerciais: `commercial-workspace.mjs`;
  - tela: `apps/web/public/app.js` (`VIEW_CAPABILITIES`) e `service-receivables.js`.
- **Migrações:** `db/migrations/031_remove_barber_commerce_data.sql`,
  `032_classificacao_do_portfolio.sql` e `033_service_receivables.sql`.
