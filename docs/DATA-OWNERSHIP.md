# Propriedade dos dados

Quem é dono de cada dado, como o isolamento é feito e qual é a fonte de verdade. Conceitos em [DOMAIN-MODEL.md](DOMAIN-MODEL.md).

Revisão: **2026-08-30**.

---

## 1. Mapa de propriedade

Cada dado tem **um** dono. O dono decide o schema, guarda o registro e responde por ele. Os demais leem por contrato de API — nunca pelo banco do outro.

| Dado | Dono | Onde está | Estado |
|---|---|---|---|
| Organização, status | **Core** | `tzolkin_core.tenants` | `[EXISTENTE E VERIFICADO]` |
| Vínculo pessoa ↔ organização ↔ produto | **Core** | `tzolkin_core.memberships` | `[EXISTENTE E VERIFICADO]` |
| Catálogo de produtos | **Core** (espelho do Notion) | `products`, `ecosystem_entries` | `[EXISTENTE E VERIFICADO]` |
| Contrato e direitos | **Core** | `tzolkin_core.entitlements` | `[EXISTENTE E VERIFICADO]` |
| Credencial de app | **Core** | `app_clients` (só hash) | `[EXISTENTE E VERIFICADO]` |
| **Lead comercial da TZOLKIN** | **`tzolkin-site`** | banco institucional, schema `institucional.leads` | `[EXISTENTE E VERIFICADO]` — banco **separado** do Core |
| Fila de e-mail do institucional | **`tzolkin-site`** | `institucional.email_outbox` | `[EXISTENTE E VERIFICADO]` |
| Sessão de chat do consultor | **`chatbot-api`** | Redis | `[EXISTENTE E VERIFICADO]` |
| **Lead de uma organização cliente** | **Backend do produto** | banco do produto | Fora do Core, por decisão |
| **Consumidor final** | **Backend do produto** | banco do produto | Fora do Core, por decisão |
| Agenda, pedido, estoque, matrícula, progresso | **Backend do produto** | banco do produto | Fora do Core, por decisão |
| Documentos, calendários, financeiro executivo | **Notion** | workspace | Fonte de verdade; o Core não sincroniza |
| Contabilidade fiscal | **Contabilizei** | plataforma deles | [BILLING.md](BILLING.md) |
| Dado de cartão | **Provedor** (Stripe/Asaas) | tokenização/checkout | Nunca no Core — [BILLING.md](BILLING.md) |

### Os dois tipos de lead não se misturam `[DECIDIDO]`

- **Lead da TZOLKIN**: alguém interessado no que a TZOLKIN vende. Captado em `tzolkin.cloud`, gravado no banco institucional. É insumo do comercial próprio.
- **Lead de uma organização cliente**: alguém interessado no que o *cliente* vende, captado dentro de um produto. Pertence ao cliente.

**O Core não recebe leads operacionais de clientes.** Se um resumo de gestão for necessário algum dia, ele é definido explicitamente, minimizado e documentado — não é subproduto de nada.

---

## 2. Fonte de verdade quando há duas cópias

| Dado | Fonte de verdade | Cópia | Regra |
|---|---|---|---|
| Nome e ficha do produto | **Notion** | `products.name`, `ecosystem_entries.payload` | A importação sobrescreve nome e ficha; **`products.id` nunca muda**, para não quebrar contratos existentes |
| Status/endereço do produto | **Notion** (cadastral) | `payload.status`, `payload.url` | Cadastro ≠ disponibilidade — [CONTEXT.md §4](CONTEXT.md#4-endereços) |
| Direitos de acesso | **Core** | nenhuma | Sem cache. O app não guarda direito nem aceita direito vindo do navegador |
| Financeiro executivo | **Notion**, hoje | — | O Core não lê nem escreve no Notion em runtime |
| Estado de pagamento | **Provedor** | espelho local futuro | Espelho só se reconcilia periodicamente — [BILLING.md](BILLING.md) |

**Não há sincronização automática com o Notion.** A importação é um comando manual e idempotente — [INTEGRATIONS.md](INTEGRATIONS.md#3-notion--catálogo-do-ecossistema-existente-e-verificado).

---

## 3. Isolamento

### Como é feito hoje `[EXISTENTE E VERIFICADO]`

| Camada | Mecanismo |
|---|---|
| Recorte por produto | `JOIN` a partir de `entitlements` no servidor. Organização sem contrato do produto **não sai do banco** |
| Alcance da pessoa | Vínculo é por organização **e** produto: contratar outro produto não abre este |
| Escolha do produto | Derivada da credencial (`app_clients.product_id`), **nunca** de parâmetro do chamador. Enviar `product_id` na query ⇒ `400` |
| Escopo do operador | Sessão administrativa; **global** — não há operador restrito a um produto |
| Banco | Base `tzolkin_core` dedicada, role própria, `REVOKE ALL ON SCHEMA public FROM PUBLIC` |
| Frontend | Só apresenta. Trocar de contexto descarta o que estava na tela e refaz a consulta ao servidor |

Coberto por teste: organização com contrato de `sites` não aparece no contexto de `barber`; pessoa vinculada em um produto recebe `403` em outro produto da **mesma** organização; organização sem vínculo recebe `403`; credencial de app não abre painel administrativo. Ver [TESTING.md](TESTING.md).

### Lacunas conhecidas

| Lacuna | Risco | Estado |
|---|---|---|
| Operador é sempre administrador global | Recorte por produto é conforto visual, não contenção | [SECURITY.md](SECURITY.md#3-permissões-proposto) |
| Sem defesa no próprio banco | Bug de query não encontra segunda barreira | [D5](CONTEXT.md#d5--isolamento-no-banco-só-query-ou-rlsseparação-física), abaixo |
| Sem paginação em `/api/overview` | Resposta cresce linearmente com o cadastro | [ROADMAP.md](ROADMAP.md) |

### D5 — RLS ou separação física `[PENDENTE DE DECISÃO]`

Isolamento não pode depender só de middleware. Ao decidir:

- **A role da aplicação é dona das tabelas.** Dono de tabela **ignora RLS** por padrão. Adotar RLS exige antes separar a role que aplica migração da role que atende requisição, e considerar `FORCE ROW LEVEL SECURITY`.
- O isolamento tem de valer também para **jobs, exportações e relatórios**, não só para as rotas HTTP.
- **Não colocar `tenant_id` em toda tabela indiscriminadamente.** `products` e `ecosystem_entries` são globais; carimbá-las com tenant seria errado. Ver abaixo.

### A fronteira por app

Cada app declara o próprio escopo. Não existe regra única:

| App | Escopo do banco | `tenant_id` nas tabelas? |
|---|---|---|
| Core | multi-organização | Sim nas tabelas de organização; **não** em `products`/`ecosystem_entries` (globais) |
| `tzolkin-site` | institucional, banco próprio | Não. Leads são da TZOLKIN, não de tenant |
| Produto com banco exclusivo por cliente | uma organização por base | Redundante — o isolamento é a própria base |
| Produto multi-organização | várias por base | Obrigatório, e com defesa no banco |

Ao criar um app novo, **documente aqui a fronteira dele antes da primeira tabela.**

---

## 4. Regras de acesso a dado `[DECIDIDO]`

1. **Nunca confiar no tenant vindo do navegador.** Ele vem da sessão ou da credencial, validados no servidor.
2. **Nunca aceitar direito enviado pelo cliente HTTP.** Direito é lido do banco a cada consulta.
3. **ID direto não é autorização.** Conhecer um UUID não dá acesso: `/v1/context` exige a interseção dos cinco predicados de [DOMAIN-MODEL.md §3](DOMAIN-MODEL.md#3-relações).
4. **Core indisponível não libera permissão nova.**
5. **Controlar a infraestrutura não dá direito de ler dado de cliente.** Acesso a banco de produção é operação auditada, não rotina.
6. **Exportação é acesso a dado**, com as mesmas regras de escopo e auditoria.
