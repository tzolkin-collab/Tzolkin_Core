# Roadmap

Entregas verticais, dependências e critérios de aceite. Cada entrega é uma fatia que **funciona ponta a ponta** — banco, servidor, interface e teste. Nunca uma camada inteira sem uso.

Revisão: **2026-08-30**.

---

## Entregue

### E0 — Bootstrap do Core `[EXISTENTE E VERIFICADO]`

Organizações, vínculos, catálogo, contratos, `/v1/context`, painel local, 19 testes. Base sobre a qual o resto se apoia.

### E1 — Contexto de produto e backend modular `[EXISTENTE E VERIFICADO]` — 2026-08-30

Primeira fatia do contexto B ([PRODUCT.md](PRODUCT.md#b--gestão-de-um-produto)).

- `src/server.mjs` monolítico decomposto em `platform/` + `modules/`, sem mudança de comportamento — [ARCHITECTURE.md](ARCHITECTURE.md#2-módulos-existente-e-verificado).
- `GET /api/products/:productId/console`: recorte por produto feito **no servidor**, com resumo, ficha do Notion e carteira.
- Seletor de contexto no painel; troca invalida a tela e revalida no servidor.
- 15 testes novos.

**Aceite, todos cumpridos:** organização sem contrato do produto não sai do banco · nenhuma associação fictícia criada · credencial de app não abre o painel · sessão expirada rejeitada no servidor · contrato revogado e organização suspensa fora do total ativo · estados vazios honestos · Core seguindo em `http://127.0.0.1:3100`.

### E5 — Vínculo de pessoa por produto `[EXISTENTE E VERIFICADO]` — 2026-08-30

Decisão [D1](CONTEXT.md#d1--vínculo-de-pessoa-por-produto-resolvida) tomada pelo usuário e aplicada na mesma sessão, aproveitando a tabela vazia. Opção B da [ADR 0002](decisions/0002-vinculo-de-pessoa-por-produto.md).

- `memberships` ganha `product_id`; PK passa a `(tenant_id, subject, product_id)`.
- `/v1/context` exige vínculo **deste** produto: contratar outro não abre este.
- Painel: seletor de produto no formulário de acesso; contagens e rótulos por produto.
- Runner de migração versionada (`npm run db:migrate`) criado junto — primeira fatia de [E4](#e4--migrações-versionadas-e-privilégio-mínimo).
- 3 testes novos, total 37.

**Aceite, todos cumpridos:** pessoa vinculada ao produto A não obtém `200` no produto B da mesma organização · vínculo sem produto rejeitado com `400` · contagens do painel por produto · migração transacional, idempotente e registrada · `membership_scope: "product"` · 37/37 aprovados.

---

### E1.5 — Visibilidade do transporte do banco `[EXISTENTE E VERIFICADO]` — 2026-08-30

Descoberto durante a inspeção para a integração com Vercel/EasyPanel: o PostgreSQL do Core é remoto, público e **sem TLS** ([SECURITY.md](SECURITY.md#o-banco-do-core-trafega-sem-tls-pela-internet-pública)). A correção é de infraestrutura e é do usuário; esta entrega garante que o problema não passe despercebido nem seja piorado.

- `src/platform/database.mjs`: mede o transporte de verdade na inicialização, com `DATABASE_SSL` em `require` / `allow` / `disable`.
- Aviso no console, faixa no painel e `database_transport` em `GET /health` — sem hostname, sem credencial.
- `npm run db:rotate-password` **recusa** rodar sobre texto claro.
- `DATABASE_URL_TEST` permite separar a base de testes da base do cadastro.
- 14 testes novos, total 51.

**Aceite, todos cumpridos:** `require` recusa conectar sem criptografia · `unknown` quando não medido, nunca "seguro" por omissão · aviso e resposta da API não contêm host nem credencial · rotação bloqueada em texto claro · Core segue rodando.

**Não entregue de propósito:** a correção em si. Runbook em [SECURITY.md §8](SECURITY.md#8-runbook-tls-no-postgresql-do-easypanel).

---

### E1.7 fase 1 — Leitura de deploys da Vercel `[EXISTENTE E VERIFICADO]` — 2026-08-30

Módulo `deploys` com adaptador por provedor, mesmo padrão do [ADR 0003](decisions/0003-configuracao-de-cobranca-por-conta-e-oferta.md). **Somente leitura.**

- `GET /api/deploys`: projetos e deploys recentes, normalizados por adaptador.
- `src/integrations/vercel.mjs`: `listProjects` + `listDeployments` por projeto.
- Painel: aba Deploys com estado, ambiente, branch, commit, autor, links e sinalização de projeto sem repositório.
- 18 testes novos contra stub local, total 69.

**Aceite, todos cumpridos:** credencial só no servidor e ausente da resposta · erro de provedor sem vazar credencial nem corpo bruto · falha não derruba o painel · estado vazio honesto sem token · corte de lista declarado · `POST`/`PUT` em `/api/deploys` ⇒ 405 · nenhum deploy disparado.

**Defeito encontrado e corrigido na conferência:** a primeira versão pedia os 20 deploys mais recentes do escopo inteiro, e projeto parado sumia da tela — `site-tzolkin`, o mais importante, não aparecia. Passou a listar por projeto.

---

## Próximas

### E1.6 — Fechar a exposição do banco

**Depende de:** ação sua no EasyPanel. **É o item mais urgente do roadmap**, e agora bloqueia também a publicação do `tzolkin-site`.

Os três serviços de dados foram identificados no mesmo host exposto ([SECURITY.md](SECURITY.md#o-banco-do-core-trafega-sem-tls-pela-internet-pública)). A correção exige verificar cada serviço e a conectividade dos consumidores, inclusive Vercel, antes de fechar portas.

Enquanto aberto: não cadastrar cliente real, tratar a senha atual como comprometida, e **não publicar a rota de captação de leads** — ela passaria a gravar dado pessoal de terceiros em texto claro.

**Aceite:** transporte autenticado demonstrado para cada consumidor · `DATABASE_SSL=require` e `tls-verified` quando há TLS PostgreSQL · alternativa de túnel validada separadamente (loopback não é prova) · senha rotacionada por canal seguro · `DATABASE_URL_TEST` separado · exposição de cada serviço revisada. O script de rotação não aceita PostgreSQL sem TLS, mesmo via túnel.

### E1.6b — Publicar o `tzolkin-site`

**Depende de:** E1.6.

O código está verificado e commitado na branch `feat/captacao-de-leads-e-produtos`; produção segue no commit de 17/07. Falta decidir a publicação, que é ação externa e precisa de autorização explícita.

**Aceite:** transporte do banco institucional resolvido · decidido se o worker de e-mail entra junto (hoje as variáveis do provedor não existem em produção) · deploy conferido em preview antes de produção · `main` atualizada por merge, não por push direto às cegas.

### E1.7 fase 2 — Disparo de deploy

**Depende de:** decisão sua. A fase 1 (leitura) já está entregue — ver acima.

Só por **Deploy Hook** da Vercel: URL secreta por branch, sem token, revogável, 60 disparos/hora por projeto. Nunca com o token amplo. Ressalva: Deploy Hook exige projeto conectado a Git, então `tzolkin-sites` e `v1.0_site` ficam de fora até terem repositório.

**Aceite:** disparo exige confirmação explícita do operador · toda ação registrada em `audit_events` com ator · nenhum disparo real em teste · nenhuma URL de hook chega ao navegador.

### E1.8 — Integração EasyPanel

**Atualização:** inventário somente-leitura implementado e testado localmente. A conexão real continua pendente de URL, credencial, versão e validação do formato de resposta; ver [INTEGRATIONS.md §10](INTEGRATIONS.md#10-easypanel--inventário-local-consulta-real-validada). Não há ações operacionais nesta entrega.

**Depende de:** E1.6. Não faz sentido guardar token de infraestrutura antes de fechar a exposição do banco.

Contratos e o impedimento de escopo: [INTEGRATIONS.md §10](INTEGRATIONS.md#10-easypanel--inventário-local-consulta-real-validada).

**Aceite:** decidido se o token amplo é aceitável ou se há token por serviço · leitura antes de disparo · nenhuma operação destrutiva alcançável pelo Core.

Ordem por dependência, não por preferência. **Cada uma continua a valer só enquanto suas pendências estiverem resolvidas.**

### E2 — Identidade individual do operador

**Depende de:** [D4](CONTEXT.md#d4--qual-idp-substitui-o-bootstrap-de-senha-única) — **bloqueada**.

Por que vem primeiro: sem ator individual, auditoria não registra quem fez o quê, papéis não existem, e acesso temporário não expira. Tudo depois disso é construído sobre areia.

**Aceite:** cada pessoa entra com identidade própria · sessão persistente com revogação · MFA para operador · `audit_events` grava ator · nenhuma credencial compartilhada · nenhum nome de pessoa em código.

### E3 — Papéis, escopo e acesso temporário

**Depende de:** E2.

Transforma o recorte por produto de conforto visual em contenção real — hoje todo operador é administrador global ([DATA-OWNERSHIP.md](DATA-OWNERSHIP.md#lacunas-conhecidas)).

**Aceite:** operador restrito a um produto não lê dado de outro, **inclusive por id direto e por endpoint de exportação** · acesso temporário expira sozinho · revogação vale na verificação seguinte · concessão e revogação auditadas · teste de negação para cada papel.

### E4 — Migrações versionadas e privilégio mínimo

**Depende de:** nada. **Parcialmente entregue.**

Já existe: migrações numeradas em `db/migrations/`, uma transação por arquivo, registro em `schema_migrations`, aplicação idempotente por `npm run db:migrate`, integrada ao `db:setup`.

**Falta:** reversão documentada · role de migração separada da role da aplicação · aplicação sem `DELETE` em `audit_events` · `ecosystem_entries` definida em um lugar só ([INFRASTRUCTURE.md](INFRASTRUCTURE.md#3-migrações)) · restauração de backup testada.

### E6 — Auditoria completa

**Depende de:** E2 e E4.

**Aceite:** ator, ação, alvo, antes/depois, origem e correlação · exportação e leitura sensível auditadas · trilha *append-only*, sem `DELETE` pela aplicação · retenção definida · nenhum dado sensível desnecessário na trilha.

### E7 — Fundação financeira em sandbox

**Depende de:** E2, E4 e E6. O fluxo consumidor → cliente depende de [D3](CONTEXT.md#d3--quem-vende-e-quem-recebe-no-fluxo-consumidor--cliente) e **fica fora desta entrega**.

Só o fluxo 1 (cliente paga à TZOLKIN), só sandbox. Sequência em [BILLING.md §8](BILLING.md#8-primeiros-passos-quando-houver-decisão-proposto).

**Aceite:** entidade jurídica, conta, ambiente, oferta e versão de preço modelados · webhook de **um** provedor autenticado, deduplicado por id e com histórico · evento fora de ordem não retrocede estado · valores em inteiro com moeda · **nenhuma cobrança real emitida** · confirmação nunca vinda só do retorno de checkout · teste de evento duplicado e de evento antigo.

### E8 — Contexto de organização cliente

**Depende de:** E2 e E3.

Primeiro pedaço do contexto C ([PRODUCT.md](PRODUCT.md#c--organização-cliente)). **Nenhuma rota de login foi inventada** — a definição vem com E2.

**Aceite:** pessoa de uma organização vê só o dela · troca de organização revalida no servidor · nenhum dado operacional de produto trafega pelo Core · negação testada por id direto.

---

## Reforma do painel `[DECIDIDO]` — 2026-09-02

Programa aprovado pelo usuário: o painel deixa de ser só cadastro e passa a **criar** projeto a partir do repositório, publicar, e apontar domínio. Referência externa: ADR "Ecossistema TZOLKIN" no Notion, que já nomeia estes blocos como escopo do Core — *operação: projetos*, *propriedades digitais: sites, lojas, domínios*, *financeiro operacional*.

**Muda a natureza do Core.** Hoje ele é registro e observador, e diz isso no próprio código (`configuration_only`, `read_only`, `record_only`, `not_observed`). O programa o torna executor. A linha já foi cruzada uma vez com cuidado, no EasyPanel: `prepare` → confirmação digitada → `execute` → auditoria, sem retry automático. **Toda entrega abaixo estende esse padrão; nenhuma inventa outro.**

Ordem por dependência. E9 é fundação: sem ele, E10–E14 não têm onde se apoiar.

### E9 — Unir as ilhas: projeto, produto em draft e serviço `[ENTREGUE]` — 2026-09-02

**Depende de:** nada. É a fundação do programa.

Hoje `delivery_projects` (cadastro técnico) e `products` (catálogo comercial) são ilhas: **não existe coluna ligando as duas**. E `products` não tem ciclo de vida — só `id`, `name`, `portfolio_kind`, `brand_family`.

Decisão do usuário: criar um projeto técnico cria um **produto em `draft`**, não um produto comercial ativo. O draft funciona como quarentena do namespace `products.id`, que é chave estrangeira de `entitlements`, `memberships`, `app_clients`, `billing_offers`, `checkout_templates` e `client_engagements` — poluí-lo tem alcance largo.

Projeto tem dois tipos: **produto** (tem código, deploy, domínio) e **serviço** (consultoria, assessoria — já modelado em `client_engagements.service_model`).

**Aceite:** vínculo entre projeto técnico, produto e contratação · `products` com ciclo de vida e estado inicial `draft` · **lista conferida de todo lugar que precisa filtrar draft**, para produto em rascunho nunca aparecer em contrato, cobrança, acesso ou `/v1/context` · migração segura em banco com dados reais, sem backfill destrutivo · modelo antecipa E13 e E14 sem implementá-los · os 222 testes seguem passando.

Implementado: `products.lifecycle_status` (`draft` | `active` | `archived`), vínculo opcional e único em `delivery_projects.product_id`, criação atômica de produto `draft` para projetos técnicos novos e filtros de produto ativo em catálogo, contratos, cobrança, checkout, acesso e contexto.

### E10 — Empresas como aba de primeira classe

**Depende de:** E9.

`tenants` já tem `organization_type`, `relationship_kind` e `lifecycle_status` desde a migração 009. Falta a interface: a aba hoje se chama "Clientes" e mistura papéis. Empresas e Pessoas passam a ser irmãs.

**Aceite:** empresa e pessoa navegáveis separadamente · reclassificação pela API, fechando a lacuna do `PUT /api/tenants` · vínculo empresa ↔ pessoa ↔ contratação visível dos dois lados.

### E11 — Pagamentos como centralizador

**Depende de:** E9.

Hoje há *Financeiro* (bancos, Stripe, Asaas) na gestão geral e *Pagamentos* por produto, em telas que não se falam. Vira um lugar só: ofertas, cobranças, conciliação e estado dos provedores.

Nesta entrega a página pública de checkout **sai do processo do painel**. Ela existe hoje em `/c/:productId/:offerSlug` com CSP própria por rota — arranjo deliberadamente provisório, registrado em [BILLING.md](BILLING.md).

**Aceite:** um só lugar responde "quanto entrou e de quem" · checkout público servido fora do processo do painel · nenhuma exceção de CSP sobrando no painel.

### E12 — Vercel alcança o EasyPanel

**Depende de:** E1.7 fase 2 e E1.8 — **é a continuação delas, não uma entrega paralela**.

Assimetria atual: o EasyPanel já publica, reconstrói, reinicia e escreve variáveis pelo Core. A Vercel é só leitura. Esta entrega iguala as duas.

**Aceite:** disparo e escrita de variáveis na Vercel sob o mesmo `prepare`/`execute` do EasyPanel · confirmação digitada do destino · auditoria com ator · nenhum segredo no navegador · nenhum disparo real em teste.

### E13 — Provisionar projeto a partir do repositório

**Depende de:** E9 e E12.

Primeiro passo genuinamente novo do programa: criar o projeto na plataforma a partir de um repositório, escolher destino (EasyPanel, Vercel ou ambos), definir variáveis e publicar. O resultado nasce como produto em `draft` (E9).

**Aceite:** criação sob confirmação explícita · falha parcial não deixa projeto meio-criado sem registro · o que foi criado fica em `delivery_projects` com ator e data · nenhuma credencial trafega pelo formulário.

### E14 — Domínio e DNS

**Depende de:** E13.

Apontar subdomínio de `tzolkin.cloud` para o destino recém-criado. Domínios hospedados na Hostinger; a API de DNS é o escopo, não a gestão de hospedagem.

Ressalva conhecida: CRUD de domínio é lacuna declarada também no EasyPanel — ver [EASYPANEL-OPERATIONS.md](EASYPANEL-OPERATIONS.md).

**Aceite:** apontamento sob confirmação · registro anterior nunca sobrescrito em silêncio · estado real do DNS consultado, não presumido a partir do que o Core pediu.

---

## Correções e entregas pequenas

Independentes entre si, sem dependência do programa acima. Contexto e evidência em [PENDENCIAS.md](PENDENCIAS.md).

| Entrega | Por quê | Aceite resumido |
|---|---|---|
| `pluggy_items` em tabela | Cada banco novo hoje exige editar `.env` e redeployar | Tabela manda; `PLUGGY_ITEM_IDS` vira semente importada uma vez |
| Widget Pluggy Connect | `POST /connect_token` já responde 200 | Página atrás de sessão de operador, CSP só naquela rota, item gravado no sucesso |
| Sincronização periódica do Pluggy | Setembro com 2 transações, outubro com 0 | Leitura agendada, falha não apaga o extrato anterior |
| `PUT /api/tenants` | Reclassificar organização hoje exige SQL | Reclassificação auditada pela API |
| Responsável em `client_engagements` | Depende de decidir se responsável é do cliente ou da contratação | Campo mais importação do Notion |
| Tela de Times e contas | Migração 013 entregue; interface não | Divergência do cadastro visível nas duas direções |
| Push: VAPID e tópicos | Avaliação de alerta precisa acontecer no servidor | Assinatura por tópico, avaliação fora do navegador |

---

## Fora do roadmap até haver decisão

| Item | Trava |
|---|---|
| Split, repasse, conta conectada, recebimento para terceiros | [D3](CONTEXT.md#d3--quem-vende-e-quem-recebe-no-fluxo-consumidor--cliente) |
| Open Finance | Depende de E7 e de escolha de fornecedor — [INTEGRATIONS.md](INTEGRATIONS.md#6-open-finance-proposto) |
| Automação com a Contabilizei | Não há API pública oficial — [INTEGRATIONS.md](INTEGRATIONS.md#7-contabilizei) |
| Publicação do Core | Lista de bloqueio em [SECURITY.md](SECURITY.md#7-antes-de-publicar-o-core) |
| Painéis de operação por produto (agenda, pedidos, matrículas) | Sem fluxo concreto para modelar; e o dado é do backend do produto |
| Distribuição de eventos do Core | Contrato proposto, sem consumidor — [INTEGRATIONS.md](INTEGRATIONS.md#4-contrato-de-evento-proposto) |
| RLS ou separação física | [D5](CONTEXT.md#d5--isolamento-no-banco-só-query-ou-rlsseparação-física) |
