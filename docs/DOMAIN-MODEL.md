# Modelo de domínio

Entidades, identificadores, relações e ciclos de vida. Fonte única dos conceitos usados no restante da documentação.

Revisão: **2026-09-02**.

---

## 1. Por que não existe uma tabela "clientes"

"Cliente" é ambíguo e a ambiguidade vira bug de isolamento. O Core separa sete coisas que costumam ser tratadas como uma só:

| Conceito | O que é | Onde vive |
|---|---|---|
| **Pessoa / identidade** | Um ser humano autenticável | Fora do Core (IdP — [D4](CONTEXT.md#d4--qual-idp-substitui-o-bootstrap-de-senha-única)). O Core guarda apenas o identificador externo |
| **Organização** | Entidade que contrata, com CNPJ ou não | Core, tabela `tenants` |
| **Cliente comercial da TZOLKIN** | Organização com relação comercial ativa | Ainda não modelado separadamente — hoje se confunde com `tenants` |
| **Participação em um produto** | Uma organização usar um produto sob um plano | Core, tabela `entitlements` |
| **Consumidor final** | Quem compra do cliente, dentro do produto | **Backend do produto.** Nunca no Core |
| **Lead da TZOLKIN** | Interessado no que a TZOLKIN vende | `tzolkin-site`, schema `institucional.leads` |
| **Lead de uma organização cliente** | Interessado captado pelo cliente | **Backend do produto.** Nunca no Core |

Os dois últimos são deliberadamente diferentes. Ver [DATA-OWNERSHIP.md](DATA-OWNERSHIP.md).

---

## 2. Entidades implementadas `[EXISTENTE E VERIFICADO]`

Conferido em `db/schema.sql` e no banco em 2026-09-02.

### `tenants` — organização

| Coluna | Tipo | Regra |
|---|---|---|
| `id` | `uuid` PK | `gen_random_uuid()`. Identificador estável, usado por todos os apps |
| `name` | `text` | 2–160 caracteres |
| `slug` | `text` UNIQUE | `^[a-z0-9][a-z0-9-]{1,63}$`. Legível por humano |
| `status` | `text` | `active` \| `suspended` |
| `created_at` | `timestamptz` | |

**Ciclo de vida:** `active` ⇄ `suspended`. Não há exclusão — nenhuma rota apaga organização, e as tabelas filhas referenciam `tenants(id)` sem `ON DELETE`.
**Efeito de `suspended`:** `/v1/context` nega imediatamente, mesmo com contrato ativo.

### `memberships` — vínculo de pessoa com a organização, em um produto

| Coluna | Tipo | Regra |
|---|---|---|
| `tenant_id` | `uuid` | PK composta, FK → `tenants` |
| `subject` | `text` | PK composta, 1–200 caracteres |
| `product_id` | `text` | PK composta, FK → `products` |
| `active` | `boolean` | |

`subject` é o **identificador de identidade externa** — preferir `issuer + sub` do IdP. **Não é e-mail, não é prova de autenticação.** O app autentica a pessoa antes de perguntar ao Core.

**Escopo: organização E produto.** Uma pessoa vinculada em Barber não alcança Commerce, ainda que a mesma organização contrate os dois. A API declara `membership_scope: "product"`. Decisão em [ADR 0002](decisions/0002-vinculo-de-pessoa-por-produto.md); histórico em [D1](CONTEXT.md#d1--vínculo-de-pessoa-por-produto-resolvida).

**Ciclo de vida:** criado/atualizado por upsert; `active=false` revoga na consulta seguinte, sem cache.

### `products` — catálogo

| Coluna | Tipo | Regra |
|---|---|---|
| `id` | `text` PK | `^[a-z][a-z0-9-]{1,63}$`. Identificador estável — nunca muda |
| `name` | `text` | Nome exibido. Sincronizado do catálogo do Notion na importação |
| `portfolio_kind` | `text` | `product`, `platform` ou `service_line`; recorte do portfólio comercial |
| `lifecycle_status` | `text` | `draft`, `active` ou `archived`; produto novo de projeto técnico começa em `draft` |
| `brand_family` | `text` | Família de marca, hoje `tzolkin` |

Hoje: `sites`, `educare`, `barber`, `commerce`, `data`, `core`. Ver [D2](CONTEXT.md#d2--o-próprio-core-e-o-data-são-produtos-contratáveis).

`portfolio_kind` classifica o portfólio: Sites, Commerce e Data são `service_line`; Barber e Skiller são `product`; Core e Educare são `platform`.

`portfolio_kind` descreve o lugar do item no portfólio; não descreve como uma
contratação é cobrada. A taxonomia de `client_engagements.service_model` é
`on_demand` | `education` | `consulting` | `advisory` | `product`
(`unclassified` é o estado transitório de cadastro). Modalidade de cobrança
fica exclusivamente em `billing_offers.kind`: `one_time`, `installments` ou
`subscription`.

SaaS, app e white-label são recortes do produto, não da contratação. Enquanto
esses atributos forem cadastrais e não mudarem autorização, cobrança ou fluxo
operacional, permanecem no catálogo do Notion (`ecosystem_entries.payload`),
sem uma coluna redundante no Core. Se algum deles passar a dirigir uma regra
do sistema, desce-se então para uma coluna própria e com vocabulário explícito.

### `client_engagements` — contratação

| Coluna | Tipo | Regra |
|---|---|---|
| `tenant_id`, `product_id` | | Organização e produto relacionados |
| `service_model` | `text` | `on_demand`, `education`, `consulting`, `advisory`, `product` ou `unclassified` |
| `status` | `text` | `planned`, `active`, `paused`, `completed`, `discontinued` ou `unclassified` |
| `label` | `text` | Nome da contratação, 2–120 caracteres |

Esta tabela responde **o que foi vendido**. Ela não repete a modalidade de
cobrança, que pertence à oferta em `billing_offers.kind`.

### `ecosystem_entries` — ficha do Notion

| Coluna | Tipo | Regra |
|---|---|---|
| `id` | `text` PK | id do produto, ou `resource-N` |
| `kind` | `text` | `product` \| `resource` |
| `payload` | `jsonb` | Ficha cadastral: `name, category, description, status, url, source, note` |
| `imported_at` | `date` | |

**`payload.status` é cadastral.** Diz o que foi anotado no Notion, não se o serviço está no ar. Ver [CONTEXT.md §4](CONTEXT.md#4-endereços).

### `entitlements` — contrato de organização × produto

| Coluna | Tipo | Regra |
|---|---|---|
| `tenant_id`, `product_id` | | PK composta |
| `plan` | `text` | 1–80 caracteres. **Rótulo cadastral: não é preço nem autorização** |
| `active` | `boolean` | |
| `rights` | `text[]` | Máx. 30, cada um `^[a-z][a-z0-9_.:-]*$`, sem duplicados |
| `version` | `bigint` | **Monotônico**, incrementa a cada alteração |
| `updated_at` | `timestamptz` | |

**Ciclo de vida:** upsert por `(tenant_id, product_id)`; qualquer alteração incrementa `version`. Não há exclusão: revogar é `active=false`, preservando histórico e a monotonicidade.

`version` é o que permite ignorar evento antigo quando houver distribuição de eventos — [INTEGRATIONS.md](INTEGRATIONS.md#4-contrato-de-evento-proposto).

### `app_clients` — credencial de produto (server-to-server)

| Coluna | Tipo | Regra |
|---|---|---|
| `token_hash` | `text` PK | SHA-256 do token. **O token em claro nunca é persistido** |
| `product_id` | `text` | FK → `products` |
| `active` | `boolean` | |

Identifica o **produto que pergunta**, não uma sessão de usuário final. Hoje: 0 linhas — nenhum app real foi provisionado.

### `audit_events` — trilha transacional

| Coluna | Tipo |
|---|---|
| `id` | `uuid` PK |
| `type` | `text` — `tenant.created`, `tenant.status_changed`, `membership.changed`, `entitlement.changed` |
| `tenant_id` | `uuid` FK |
| `created_at` | `timestamptz` |

Gravado na **mesma transação** da mutação: ou os dois entram, ou nenhum. **Não é barramento de eventos** e não tem ator, payload nem produto — lacuna em [SECURITY.md](SECURITY.md#4-auditoria).

---

## 3. Relações

```
tenants 1 ──── N memberships N ──── 1 products   (pessoa vinculada à organização, em um produto)
tenants 1 ──── N entitlements N ──── 1 products
products 1 ──── N app_clients          (credencial por produto)
products 1 ──── 0..1 ecosystem_entries (ficha do Notion)
delivery_projects 1 ──── 0..1 products (produto draft criado pelo projeto)
tenants 1 ──── N audit_events
```

**A regra de acesso é a interseção**, avaliada em `/v1/context`:

```
acesso = tenants.status='active'
       ∧ memberships.active
       ∧ entitlements.active
       ∧ entitlements.product_id = memberships.product_id
       ∧ entitlements.product_id = produto da credencial que perguntou
```

Qualquer um dos cinco em falso ⇒ `403`. Sem cache: revogar vale na consulta seguinte.

---

## 4. Entidades ainda não modeladas `[PROPOSTO]`

Nada abaixo existe no código. Ordem sugerida e critérios em [ROADMAP.md](ROADMAP.md).

| Entidade | Para quê | Depende de |
|---|---|---|
| `people` | Identidade individual, hoje só um `text` | [D4](CONTEXT.md#d4--qual-idp-substitui-o-bootstrap-de-senha-única) |
| `legal_entities` | Entidade jurídica recebedora — o Core não guarda CNPJ hoje | [BILLING.md](BILLING.md) |
| `commercial_relationships` | Separar cliente comercial de organização técnica | — |
| `offers` / `price_versions` | Oferta e versão de preço; `plan` é só um rótulo | [BILLING.md](BILLING.md) |
| `contracts` | Contrato comercial, distinto de `entitlements` (direito técnico) | — |
| `subscriptions`, `invoices`, `charges`, `payments`, `settlements` | Ciclo financeiro — [BILLING.md](BILLING.md#2-estados-cada-um-é-uma-coisa-diferente) | [D3](CONTEXT.md#d3--quem-vende-e-quem-recebe-no-fluxo-consumidor--cliente) |
| `roles` / `grants` | Papel e escopo sobre o vínculo já existente, com expiração — opção C da [ADR 0002](decisions/0002-vinculo-de-pessoa-por-produto.md) | [SECURITY.md](SECURITY.md#3-permissões-proposto) |

Regra ao criar qualquer uma: **valor monetário nunca em ponto flutuante** (inteiro na menor unidade + moeda) e **nada de `tenant_id` indiscriminado** em tabela global — ver [DATA-OWNERSHIP.md](DATA-OWNERSHIP.md#a-fronteira-por-app).
