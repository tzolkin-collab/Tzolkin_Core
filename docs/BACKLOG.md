# Backlog do Core

O que está aberto, por ordem de risco. Cada item traz evidência em `arquivo:linha` ou consulta.

Levantado em **2026-09-03** por auditoria de sete frentes sobre o repositório — schema, rotas,
integrações, painel, testes, documentação e uma crítica de completude. **235 itens** classificados;
abaixo está o subconjunto acionável. O resto é o que já funciona.

> Regra deste documento: nada entra sem evidência. Se um item não tem arquivo, linha ou consulta
> que o prove, ele não está aqui.

---

## 1. Risco — não tem conserto depois

### 1.1 Backup local não é backup `[RESOLVIDO PELA METADE — 2026-09-03]`

Havia **1 backup para 19 bancos**. Hoje há **16 ativos**, escalonados entre 01:00 e 03:20
(`systembots` segue às 00:00). Um foi executado manualmente para provar que funciona.

O que continua aberto:

- **Destino é `Local Disk`** — mesmo servidor do banco. Protege contra `DROP TABLE` e migração
  ruim; **não protege contra o servidor morrer**. Precisa de destino externo.
- **Sem retenção definida.** A configuração original não tinha `retentionCount` e foi replicada
  como estava. Ou acumula até encher o disco, ou o padrão decide por você.
- **Restauração nunca testada.** Backup não restaurado é hipótese, não garantia.

### 1.2 Credenciais em texto aberto no Notion

O ADR do ecossistema sinalizou como prioridade e o item **não tem checkbox** — ninguém rastreia
se foi feito. Rotacionar os segredos expostos e removê-los das páginas.

### 1.3 Porta 9000 aberta à internet

O TLS resolveu interceptação, não exposição. Varredura e força bruta seguem possíveis.
Ver [SECURITY.md](SECURITY.md).

### 1.4 Certificado do Postgres vence em 31/08/2027

Com `sslmode=verify-full`, certificado vencido não degrada — **para**. Precisa de lembrete agendado.

---

## 2. Quebrado — funciona por acidente

### 2.1 O guia de produção mata o login Google `[RESOLVIDO — 2026-09-03]`

- Antes da correção, `apps/api/src/platform/google-identity.mjs:26` — o callback do OIDC executava
  `DELETE FROM operator_auth_flows ... RETURNING code_verifier, nonce`
- `scripts/configure-runtime-role.mjs:11` — `REVOKE DELETE ... FROM tzolkin_core_runtime`
- `docs/PRODUCTION-DEPLOY.md:20` — produção **deve** usar a `DATABASE_URL` dessa role

Seguir o próprio guia de endurecimento derruba a autenticação: o `DELETE` é negado, o fluxo lança,
e todo login cai em `/?auth_error=1`. **Só não aconteceu porque a role restrita nunca foi aplicada**
— `CORE_RUNTIME_DB_PASSWORD` está vazio.

Correção aplicada: a migração `017_google_auth_flow_consumed_at.sql` foi aplicada ao banco
`tzolkin_core` em 2026-09-03; o callback consome o estado com `UPDATE ... consumed_at IS NULL`.
A role continua sem `DELETE`; o teste de uso único cobre também a rejeição de replay.

### 2.2 Produto de projeto nasce invisível para sempre `[RESOLVIDO — 2026-09-03]`

`products.lifecycle_status` entra como `draft` (migração 015). A rota autenticada
`POST /api/delivery/projects/:id/activate` agora promove o produto com revisão concorrente; a tela
de Projetos expõe a ação. Leituras continuam filtrando por `active` — `catalog.mjs:4,7`,
`access.mjs:9,23`, `billing.mjs:34`, `checkout-gateway.mjs:60`, `emails.mjs:10`,
`stripe-catalog.mjs:41`, `workspace.mjs:29` — para não expor rascunhos.

### 2.3 `entitlements.plan` trava o contrato em 409 permanente `[RESOLVIDO — 2026-09-03]`

O campo é a chave da oferta comercial. O texto do formulário agora informa que ele identifica o slug
da oferta e as condições copiadas para o contrato, evitando o rótulo enganoso anterior.

### 2.4 Previsão recorrente subestima o ano inteiro `[RESOLVIDO — 2026-09-03]`

`finance_forecasts.recurrence` agora é expandida por ocorrência no período consultado. Uma previsão
`monthly` de R$ 5.000 com vencimento em janeiro e sem `end_date` entra no total do ano como **R$ 60.000**;
há teste para 31/01 e meses com menos dias.

### 2.5 Telas inalcançáveis `[RESOLVIDO — 2026-09-03]`

- E-mails e Mentorias agora aparecem na navegação geral.
- O alias morto `metrics` foi removido; o painel de métricas continua sendo renderizado dentro das
  telas que o usam.

### 2.6 Atalho de Projetos e serviços deixa a sidebar sem item ativo `[RESOLVIDO — 2026-09-03]`

O atalho agora abre a view visível de Projetos e serviços; `renderNav` (`app.js:150`) mantém o item
ativo e `aria-current` coerentes.

---

## 3. Dinheiro

| | |
|---|---|
| **R$ 19.000 nunca cobrados** | Status "Não enviado" no Notion. Não é inadimplência — a cobrança não saiu |
| **Webhooks não cadastrados nos painéis** | Rotas prontas, segredos preenchidos, destinos vazios. É o que falta para pagamento ser confirmado |
| **Skiller fatura sem existir como cliente** | 3 assinaturas ativas na Stripe, nenhum `tenant` correspondente |
| Chave Stripe é `sk_test` | Nada ali é receita real |

---

## 4. Modelos prontos e vazios

Construídos, testados, sem conteúdo. Cada um é uma tela que não se paga até alguém preencher.

- `app_clients` — credencial servidor-a-servidor. **Nenhuma rota escreve**; o provisionamento é manual
- `delivery_audit` e `service_activity_audit` — gravados a cada save, **nenhuma rota lê**
- `audit_events` — escrito por toda rota, **nenhum endpoint consulta**
- `service_activity_audit.actor` agora usa o e-mail (ou subject) da sessão administrativa;
  o fallback `unknown` só ocorre se uma sessão sem identidade chegar ao handler
- `teams` / `team_members` — criados em 2026-09-02; com três pessoas, ainda à frente da necessidade

---

## 5. Documentação divergente

**Itens obsoletos encontrados.** O padrão se repete: o documento nega funcionalidade que existe.

- **[CONTEXT.md](CONTEXT.md)** ainda conserva alguns números históricos (42 testes no resumo e 18
  na descrição da entrega); a fotografia atual está no início de [TESTING.md](TESTING.md).
- **[INTEGRATIONS.md](INTEGRATIONS.md)**, **[ARCHITECTURE.md](ARCHITECTURE.md)** e o índice do
  **[README.md](README.md)** foram atualizados nesta revisão; repetir a auditoria quando novas rotas
  ou integrações entrarem.
- **`TESTING.md`** agora registra 16 migrações e a medição atual da suíte unitária é 123 testes;
  contagens históricas mantidas no documento ainda precisam ser consolidadas.
- **ADR-0001 ainda `[PROPOSTO]`** — a decisão fundacional de que todo o repositório é a implementação
- **ADR-0003** foi atualizado para registrar implementação financeira parcial sem promover a
  proposta a decisão aprovada.
- **11 links quebrados apontando para `BILLING.md`** foram corrigidos em 8 documentos; referências
  sem seção equivalente agora apontam para o documento, e o fluxo 2 aponta para a seção de checkout.
- **A referência a `POST /connect_token` foi corrigida** em `PENDENCIAS.md` e `ROADMAP.md`: a rota
  permanece explicitamente futura e inexistente.

---

## 6. Configuração que mente

- **`PLUGGY_API_KEY` está no `.env` e nenhuma linha do repositório a lê.** Credencial persistida em
  disco sem consumidor — e contradiz o próprio desenho, que diz mantê-la apenas em memória
- **`PLUGGY_API_BASE`** agora é lida pelo adaptador, validada como origem HTTPS sem credenciais e
  coberta por teste; o padrão continua `https://api.pluggy.ai`.
- **`PLUGGY_ITEM_IDS` em variável de ambiente** — todo banco novo exige editar `.env` e redeployar
- **Sincronização do Pluggy não roda sozinha** — setembro tem 2 transações, outubro tem 0
- **Auto-deploy do EasyPanel desligado** — todo deploy exige chamada manual à API

---

## 7. Esperando decisão

| Decisão | O que trava |
|---|---|
| E-mails do Lucas e do Nathan | Contas e times ficam teóricos |
| Qual banco foi conectado e não aparece | Item Pluggy perdido |
| **D3** — quem vende e quem recebe | Barber, split, conta conectada |
| Responsável é do cliente ou da contratação? | No Assinatura são frentes com donos diferentes |
| Destino externo de backup | Ver 1.1 |

---

## 8. Fora do Core

- **lead-finder** — 11 commits não enviados; último deploy de produção **cancelado** há 33 dias
- **haylanderform** — branch de correção com 11 arquivos sujos
- **`tzolkin-sites` e `v1.0_site`** — sem repositório Git; ninguém sabe de que código veio o que
  está servindo
- **Leads em 503** e UTM capturado e descartado — o funil está quebrado nos dois pontos

---

## 9. Produto, projetos e integrações — atualização de escopo em 2026-09-03

Esta seção registra o que foi pedido para o painel e **continua incompleto**. Ela diferencia
uma evidência observada de uma conexão administrável: descobrir um recurso não cria nem confirma
um vínculo de negócio.

### 9.1 Topologia de produto ainda não é um cadastro completo

**Entregue agora:** `GET /api/products/topology` correlaciona nomes de produto com inventários de
Vercel, EasyPanel, GitHub e Hostinger e expõe frontend, backend, domínio, checkout e e-mail no
contexto de produto. A migração 022 acrescenta `product_resource_bindings` e uma trilha própria de
auditoria: recursos detectados podem ser confirmados; conexões manuais podem ser criadas; e vínculos
confirmados podem ser editados ou removidos inline, sem popup. A topologia também compara cada
vínculo confirmado com o inventário atual e avisa quando o recurso desapareceu. Ver
`apps/api/src/modules/product-topology.mjs`, `apps/api/src/modules/product-resource-bindings.mjs` e
os testes unitários correspondentes.

**Falta:**

- Criar ou adotar um `delivery_project` a partir de recursos detectados. O Skiller prova a lacuna:
  `products.id = 'skiller'` existe, mas não há `delivery_projects` nem `product_deploy_bindings`
  para ele até que o operador confirme/adote os recursos; a topologia não deve inventar o projeto.
- Executar a reconciliação também em tarefa periódica e levar seus alertas à visão geral. Hoje ela
  roda quando a topologia é aberta e já diferencia `Confirmado e observado`, `Manual` e
  `Não encontrado no provedor`.
- Acrescentar revisão otimista aos vínculos para proteger edições simultâneas. A auditoria registra
  antes/depois e operador, mas a API ainda não exige um número de versão do cliente.
- Resolver colisões de nome. A heurística atual exige um alias inequívoco e sinaliza como
  “Detectado”; não deve associar automaticamente recursos ambíguos a um produto.

### 9.2 Domínios e Hostinger

**Entregue agora:** leitura da zona `tzolkin.cloud`, restrita ao servidor, usada pela topologia e
por Gestão técnica. Ver `apps/api/src/integrations/hostinger-dns.mjs`.

**Falta:**

- Tela por produto para criar, editar, validar e remover registros DNS.
- Preview de diff, verificação de destino, snapshot/rollback e confirmação explícita antes de uma
  escrita na Hostinger. Não há `POST`, `PUT` ou `DELETE` DNS no Core.
- Mostrar destino CNAME/A/AAAA e estado de propagação sem expor credenciais; hoje o painel mostra
  somente dados necessários para identificar o registro.
- Modelar e validar domínio principal, subdomínios de suporte e domínio de e-mail como recursos
  distintos do produto.

### 9.3 GitHub, Vercel e EasyPanel

**Entregue agora:** inventário de Vercel e EasyPanel, leitura de domínios por recurso e detecção
do repositório quando a Vercel o informa. Para o Skiller foram observados `skiller-frontend` na
Vercel, `other / skiller` no EasyPanel e `skiller.tzolkin.cloud` na Hostinger.

**Falta:**

- Tela de arquitetura por produto com componentes persistidos, ambientes, branches, logs e
  histórico de deploy em uma mesma linha de operação.
- CRUD dos componentes e destinos sem depender de popup; o editor de Projetos atual continua
  separado da topologia descoberta.
- Ação de deploy segura por componente, com preview, confirmação, auditoria e rollback. A leitura
  de inventário não dispara deploy.
- Estado real de saúde, métricas, variáveis permitidas e logs redigidos do EasyPanel; hoje o
  inventário só lista tipo e nome de serviço.
- Reconciliação de repositórios quando a API GitHub não está configurada. O link da Vercel é uma
  evidência útil, mas não substitui o inventário e a permissão direta do GitHub.

### 9.4 Checkout, Stripe, e-mails e contratos

**Entregue agora:** o checklist do projeto passou a consultar nome/responsável, fonte, componentes,
conexão de deploy de produção, templates de e-mail, oferta, template de checkout e contrato ativo.
A API devolve a evidência de cada requisito, a interface mostra a contagem real e a ativação no
servidor é bloqueada enquanto houver pendência. Contratos de um produto em draft podem ser
preparados, mas não concedem acesso: as rotas de consumo continuam exigindo produto ativo.

**Falta:**

- Editor visual próprio de checkout usando o exemplo de referência que ainda será fornecido;
  não houve revisão nem implementação desse design.
- Configuração e teste de automações de e-mail reais. Templates salvos não equivalem a provedor,
  fila, remetente, evento, entrega, falha ou métricas. O Skiller não possui template cadastrado.
- Fluxo completo de contratos do cliente e da plataforma: minuta, revisão, assinatura, versão,
  vínculo com oferta e bloqueio/ativação de produto por requisitos contratuais.
- Evoluir o requisito contratual atual de um entitlement cadastral para o fluxo completo de
  minuta, assinatura e contrato de plataforma descrito acima.
- Relação de uma oferta Stripe/Asaas com o checkout publicado, domínio e produto; uma oferta
  isolada não prova que a cobrança está pronta para operar.

### 9.5 Gestão técnica de banco, Redis e APIs

**Entregue agora:** workspace do schema do Core com árvore `TZOLKIN Core → public → Tables`,
busca, visão geral e editor de campos/relações. Ver
`apps/web/public/management-workspace.js`.

**Falta:**

- Diagrama ER de verdade, com linhas navegáveis entre tabelas e agrupamento por domínio. A visão
  “Schema” ainda é uma visão de entidades com contagem de relações.
- Aba de dados com paginação, filtros e mascaramento por coluna, condicionada a permissão e
  auditoria. Hoje não há leitura de linhas de produção.
- Navegação por todos os bancos, schemas e tabelas. A implementação consulta somente o PostgreSQL
  do Core; não representa bancos externos nem bancos de cada produto.
- Conector Redis com métricas e visualização de chaves/TTL mascaradas. O cartão atual só usa o
  inventário do EasyPanel, sem conexão ao Redis ou métricas do Redis Cloud.
- Catálogo de APIs por produto com credenciais, health check, dependências e limites; a lista atual
  apenas projeta aplicações observadas.

### 9.6 Google Cloud

**Falta inteira:**

- Conector de leitura para Resource Manager, Service Usage, Cloud Billing/Budgets e BigQuery Billing
  Export. Não há credencial Google Cloud ativa nesta máquina; `GOOGLE_CLIENT_ID` e
  `GOOGLE_CLIENT_SECRET` existentes são somente para login OAuth do Core.
- Painel de projetos, APIs habilitadas, quotas, billing, budgets e links profundos para o Cloud
  Console.
- Assistente de OAuth: checklist de domínio, callback, branding, consentimento, ambiente e links
  diretos à tela correta do Google Auth Platform. A criação/publicação do cliente e a verificação
  de marca continuam sendo ações do Cloud Console.

### 9.7 Qualidade visual e validação humana

**Falta:**

- Review de design e UX página a página com decisão registrada para Projetos, Deploys, Produtos,
  Cobrança, E-mails, Contratos e Gestão técnica. Esta rodada corrigiu duas superfícies, não revisou
  todo o aplicativo.
- Remover os popups remanescentes e substituir por fluxos contextuais por página. Há confirmações
  de exclusão e diálogos genéricos no módulo de Projetos.
- Revisão completa de tipografia, contraste, densidade, responsividade e consistência de CSS no
  app branco. Não foi concluída.
- Teste visual manual em desktop e iPhone; o PWA, ícone ao adicionar à tela inicial e notificações
  push no iPhone ainda não foram validados em aparelho real.

### 9.8 Operação e segurança que continuam abertas

Além dos itens 1 a 8 deste backlog:

- Destino externo, retenção e restauração testada para os backups.
- Aplicar a role restrita de produção depois de preencher a senha de runtime e executar o
  checklist de deploy; a correção do login Google está no código, mas a configuração de produção
  ainda não foi demonstrada.
- Webhooks reais dos provedores de pagamento e entrega, com destinos configurados nos painéis.
- Leitura de `audit_events`, `delivery_audit` e `service_activity_audit` no painel para que a
  operação seja investigável.
