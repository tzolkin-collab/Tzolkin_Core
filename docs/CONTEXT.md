# Contexto

Fatos conferidos, restrições, hipóteses e decisões pendentes. Ponto de partida para qualquer trabalho no Core.

Revisão: **2026-08-30**. Convenção de marcas em [README.md](README.md#como-ler-classificação-de-maturidade).

---

## 1. Estado real do repositório `[EXISTENTE E VERIFICADO]`

Conferido em 2026-08-30 lendo os arquivos, executando `npm test` e consultando o banco `tzolkin_core`.

### Software

| Item | Realidade |
|---|---|
| Runtime | Node.js 24.18.1, ESM, **sem framework HTTP** (`node:http` puro) |
| Dependência de produção | uma só: `pg` ^8.23.0 |
| Banco | PostgreSQL 17.11 **remoto em EasyPanel**, base `tzolkin_core`, role `tzolkin_core_app` (dona da base) |
| Frontend | HTML/CSS/JS sem build, servido pelo próprio processo (`public/`) |
| Execução | `npm start` → `http://127.0.0.1:3100`, **só loopback**, recusa `NODE_ENV=production`. O processo é local; **o banco não** |
| Testes | 69 cenários de integração relatados na entrega anterior; 18 testes unitários aprovados nesta revisão, sem banco remoto — ver [TESTING.md](TESTING.md) |

### Dados hoje no banco

| Tabela | Linhas |
|---|---|
| `products` | 6 |
| `ecosystem_entries` | 13 (6 produtos + 7 atalhos) |
| `tenants` | **0** |
| `memberships` | **0** |
| `entitlements` | **0** |
| `app_clients` | **0** |
| `audit_events` | **0** |

**Consequência prática:** não existe nenhum cliente, contrato ou vínculo real registrado no Core. Todo painel legitimamente mostra estado vazio. Nenhuma associação entre cliente e produto foi inventada para preencher tela.

### O que o Core faz `[EXISTENTE E VERIFICADO]`

- Autenticação administrativa local por senha única (bootstrap, não IdP).
- Cadastro de organizações (`tenants`) com status ativo/suspenso.
- Vínculo de pessoas por identificador externo (`memberships`), **por organização E produto**.
- Catálogo de produtos e ficha importada do Notion (`ecosystem_entries`).
- Contratos por organização × produto com plano e direitos granulares (`entitlements`).
- Consulta server-to-server de acesso: `GET /v1/context`, autenticada por credencial **do produto**.
- Contexto de produto: `GET /api/products/:productId/console` — recorte da carteira daquele produto.
- Trilha transacional local em `audit_events`.

### O que o Core **não** faz `[EXISTENTE E VERIFICADO]`

Nenhuma linha de código para: cobrança, assinatura, Stripe, Asaas, Open Finance, Contabilizei, nota fiscal, e-mail, fila, webhook, evento distribuído, cache de direitos, IdP, MFA ou portal de cliente. As seções de [BILLING.md](BILLING.md) e [INTEGRATIONS.md](INTEGRATIONS.md) descrevem desenho, não implementação.

---

## 2. Divergências entre o briefing e o código

Levantadas na inspeção de 2026-08-30.

| # | Briefing dizia | Realidade conferida | Tratamento |
|---|---|---|---|
| 1 | "19 testes aprovados" | Contagem histórica. Resultados e limites da última verificação ficam em TESTING.md | [TESTING.md](TESTING.md) |
| 2 | "seis produtos e sete atalhos operacionais" | Confirmado: 13 linhas em `ecosystem_entries` | — |
| 3 | "Auditoria básica" | Confirmado, e é mínima: `audit_events` tem só `id, type, tenant_id, created_at`. **Não registra quem agiu, nem o quê mudou, nem o produto** | Lacuna aberta em [SECURITY.md](SECURITY.md#4-auditoria) |
| 4 | "Vínculos de usuários por identificador externo" | Era **por organização**: quem tinha vínculo alcançava todos os produtos contratados | **Corrigido** em 2026-08-30 — vínculo agora é por organização **e** produto ([D1](#d1--vínculo-de-pessoa-por-produto-resolvida)) |
| 5 | Endereços registrados dos produtos | Só `tzolkin.cloud` e `sites.tzolkin.cloud` responderam | [Seção 4](#4-endereços) |
| 6 | — | `products` guardava `Educare`; o catálogo do Notion diz `Educare by TZOLKIN` | Corrigido: a importação agora sincroniza o nome ([INTEGRATIONS.md](INTEGRATIONS.md#3-notion--catálogo-do-ecossistema-existente-e-verificado)) |
| 7 | — | `data` e `core` estão em `products`, logo podem receber contrato como qualquer produto vendável | [Decisão pendente D2](#d2--o-próprio-core-e-o-data-são-produtos-contratáveis) |
| 8 | "Core local", "bootstrap local" | **Só o processo é local.** O PostgreSQL está em EasyPanel, em host público, **sem TLS** — e o Redis do `chatbot-api` também | **Risco aberto** e prioritário: [SECURITY.md](SECURITY.md#o-banco-do-core-trafega-sem-tls-pela-internet-pública) |
| 9 | — | A conta Vercel tem **8 projetos**, não 3 | [§7](#7-o-que-a-vercel-revelou-existente-e-verificado) |

---

## 3. Restrições que não se negociam `[DECIDIDO]`

Vindas do usuário e da coordenação anterior (`../../COORDENACAO-CLAUDE.md`). Detalhamento nos documentos citados.

1. **O Core não é backend universal.** Regras operacionais ficam nos backends dos produtos — [ARCHITECTURE.md](ARCHITECTURE.md#1-fronteiras).
2. **O Core não recebe leads operacionais dos clientes.** Leads comerciais da TZOLKIN são coisa distinta — [DATA-OWNERSHIP.md](DATA-OWNERSHIP.md).
3. **O frontend não decide permissão.** Autorização, isolamento e cálculo financeiro ficam no servidor — [SECURITY.md](SECURITY.md).
4. **Nada de banco único indiscriminado.** Bases existentes são preservadas — [ADR 0001](decisions/0001-core-modular-com-bancos-separados.md).
5. **Controlar a infraestrutura não dá direito de acesso aos dados** dos clientes.
6. **Uma organização com vários produtos não autoriza mistura** de dados operacionais nem acesso cruzado.
7. **Cobrança paga ≠ dinheiro disponível. Cobrança ≠ nota fiscal.** — [BILLING.md](BILLING.md).
8. **Sem cobrança real, sem publicação, sem alteração de recurso externo** sem autorização específica.
9. **Equipe é variável.** Nada de nome, quantidade de pessoas ou permissão fixados em código.

---

## 4. Endereços

Conferido em 2026-08-30 a partir desta máquina, com `curl`. **Cadastro no Notion não é disponibilidade.**

| Endereço | Resultado |
|---|---|
| `https://tzolkin.cloud/` | **200**, Vercel — título `TZOLKIN \| Software de alto padrão` `[EXISTENTE E VERIFICADO]` |
| `https://sites.tzolkin.cloud/` | **200**, Vercel — título `Tzolkin Sites — Presença digital que gera conversa` `[EXISTENTE E VERIFICADO]` |
| `https://tzolkin-educare.vercel.app/` | **200** `[EXISTENTE E VERIFICADO]` |
| `https://educare.tzolkin.cloud/` | sem resposta |
| `https://ecom.tzolkin.cloud/` | sem resposta |
| `https://barber.tzolkin.cloud/` | sem resposta |
| `data.tzolkin.cloud`, `core.tzolkin.cloud` | sem resposta — endereços **propostos**, nunca publicados |

Ressalva metodológica: o resolvedor DNS desta máquina devolve um endereço genérico para qualquer subdomínio, inclusive inexistentes. Portanto "sem resposta" significa **nenhum serviço respondeu daqui**, e não prova de que o registro DNS não exista. Confirmar no painel de DNS/Vercel antes de tratar como fato.

**Nenhuma rota de login foi inventada** para esses endereços.

---

## 5. Decisões pendentes

Ordenadas por quanto bloqueiam. Enquanto abertas, nada que dependa delas é implementado.

### D1 — Vínculo de pessoa por produto `[RESOLVIDA]`

Decidida pelo usuário em 2026-08-30 e **implementada no mesmo dia**: opção B da [ADR 0002](decisions/0002-vinculo-de-pessoa-por-produto.md).

`memberships(tenant_id, subject, product_id)`. `GET /v1/context` exige que o vínculo seja **deste produto**: contratar outro produto não abre este. A API devolve `membership_scope: "product"`.

Aplicada pela migração `db/migrations/001_membership_por_produto.sql` com a tabela vazia — nenhum dado migrado, nenhum acesso alterado. Coberta por teste de negação entre produtos da mesma organização ([TESTING.md](TESTING.md)).

### D2 — O próprio Core e o Data são produtos contratáveis?

`products` contém `core` e `data`, então é possível registrar contrato de organização para eles como para Barber. Faz sentido para `data` (produto vendável); para `core` (gestão interna da TZOLKIN) provavelmente não. Sem decisão, não se cria bloqueio nem exceção no código.

### D3 — Quem vende e quem recebe no fluxo consumidor → cliente?

O segundo fluxo financeiro (consumidor final paga a um cliente da TZOLKIN dentro de um produto) não tem escopo definido. **Nada de split, repasse, conta conectada ou recebimento para terceiros é implementado antes disso.** Detalhes e o que precisa ser respondido: [BILLING.md](BILLING.md#fluxo-2--consumidor-paga-ao-cliente).

### D4 — Qual IdP substitui o bootstrap de senha única?

Hoje há uma senha administrativa global em memória de processo. Não é solução final. Alternativas e critérios: [SECURITY.md](SECURITY.md#2-identidade).

### D5 — Isolamento no banco: só query, ou RLS/separação física?

Hoje o isolamento é por query e por credencial de produto. A role da aplicação é **dona** das tabelas, e o dono contorna RLS por padrão — adotar RLS exige revisar roles antes. [DATA-OWNERSHIP.md](DATA-OWNERSHIP.md#3-isolamento).

---

## 7. O que a Vercel revelou `[EXISTENTE E VERIFICADO]`

Conferido em 2026-08-30 pela API da Vercel, em leitura, com a credencial do usuário.

**Oito projetos**, não três: `site-tzolkin`, `tzolkin-educare`, `tzolkin-sites`, `v1.0_site`, `designer`, `assinatura-formulario`, `kalidash-lp`, `tzolkin-lead-finder-web`. Nenhum de `barber`, `commerce`, `data` ou `core` — coerente com aqueles subdomínios não responderem ([§4](#4-endereços)).

| Achado | Consequência |
|---|---|
| **`tzolkin.cloud` roda código de 17/07/2026** | O último deploy do `site-tzolkin` é o commit `7328bee`, o mesmo que é o último commit local. Só que a pasta `tzolkin-site/` tem **47 arquivos modificados ou novos** desde então — incluindo a API de leads (`src/app/api/leads/route.ts`), as migrações e os scripts. **A captação de leads não está no ar**, e o trabalho não está commitado |
| **`tzolkin-sites` e `v1.0_site` não têm repositório Git conectado** | Sem fonte de verdade, sem rollback por commit, sem saber de que código saiu o que está no ar — e **não aceitam Deploy Hook**, que a Vercel só oferece a projeto conectado a Git |
| **`educare.tzolkin.cloud` não responde porque o domínio não está anexado** | O `tzolkin-educare` está ativo, mas só em `tzolkin-educare.vercel.app`. Fecha a pendência de [§4](#4-endereços) |
| O token criado é de **time**, não de projeto | Alcança e pode apagar os 8. O Core só lê, mas a credencial no `.env` é ampla — [INTEGRATIONS.md](INTEGRATIONS.md#escopo-do-token--atenção) |

### Estado do `tzolkin-site` em 2026-08-30

O trabalho não commitado foi verificado e **commitado na branch `feat/captacao-de-leads-e-produtos`** (`main` intocada, produção intocada). Verificação antes do commit: `tsc --noEmit` limpo · 18 testes locais aprovados · `eslint` sem erros (13 avisos de import não usado) · `next build` completo com 24 páginas · nenhum segredo nos arquivos versionados.

| Fato | Situação |
|---|---|
| Banco `tzolkin_institucional` | Schema aplicado: `institucional.leads` e `institucional.email_outbox`, **ambos vazios** |
| Variáveis em produção na Vercel | `DATABASE_URL` e `NEXT_PUBLIC_CHATBOT_API_URL`, ambas `sensitive`. **`RESEND_API_KEY`, `EMAIL_FROM` e `EMAIL_INTERNAL_TO` não existem** — o worker de e-mail não rodaria |
| Publicação | **Parada**, não por defeito no código — [SECURITY.md](SECURITY.md#consequência-direta-para-o-tzolkin-site-pendente-de-decisão) |
| Push em `main` | Dispara deploy de produção: o projeto Vercel está conectado ao repositório. Por isso o commit foi para uma branch |

---

## 6. Hipóteses ainda não validadas

- 🟡 **HIPÓTESE** Os produtos Barber, Commerce e Educare têm backend próprio em algum estágio. Nada neste workspace comprova; só `tzolkin-site` e `chatbot-api` existem aqui.
- 🟡 **HIPÓTESE** A conta Asaas da TZOLKIN tem os recursos citados em [BILLING.md](BILLING.md). Capacidade varia por conta e por aprovação; confirmar no painel antes de desenhar em cima.
- 🟡 **HIPÓTESE** A Contabilizei aceita integração programática. Não foi encontrada API pública oficial — ver [INTEGRATIONS.md](INTEGRATIONS.md#7-contabilizei).

## 8. Revisão Codex — branch própria

Em 2026-08-30, a pedido do usuário, o Core ganhou repositório Git local. O estado anterior foi preservado em `main`, commit `c617bf0`; correções na branch `codex/revisao-seguranca-core`. **Sem remoto configurado, push, deploy ou backup externo.** O repositório do institucional permanece separado e intocado nesta revisão.

- `DATABASE_SSL=require` exige TLS verificado; parâmetros conflitantes da URL são rejeitados antes da conexão.
- Rotação exige certificado/hostname verificados. Loopback sozinho não prova a existência de túnel seguro.
- `/v1/context` agora inclui `membership_scope: "product"`, conforme o contrato documentado.
- O transporte real da infraestrutura **não foi corrigido nem revalidado** nesta revisão. Testes novos usam driver simulado; não substituem a integração real.

### Continuação — EasyPanel

Inventário somente-leitura implementado no backend e na área Deploys. **25/25 testes unitários passaram**, sem acesso à infraestrutura real. URL HTTPS, credencial restrita, versão do painel e formato da resposta precisam ser validados para conectar. Nenhum disparo de deploy, reinício ou exclusão foi implementado. Detalhes e limitações em [INTEGRATIONS.md §10](INTEGRATIONS.md#10-easypanel--inventário-local-implementado-validação-real-pendente).
