# ADR 0007 — O que `portfolio_kind` governa: rótulo cadastral ou regra do sistema

- **Status:** `[ACEITA]` — classificação do portfólio (migração `032`) e opção **B**, implementada em 2026-09-14
- **Data:** 2026-09-14
- **Referências:** [ADR 0005](0005-taxonomia-cliente-produto-servico.md) · [D2](../CONTEXT.md#d2--o-próprio-core-e-o-data-são-produtos-contratáveis) · [auditoria de 07/09, decisões recomendadas](../auditoria-2026-09-07/README.md#decisões-recomendadas--propostas) · migrações `014`, `030`, `031`, `032`

## Contexto

A tabela `products` guarda **itens do portfólio**, não só produtos. `portfolio_kind`
diz o tipo de cada um: `product`, `platform` ou `service_line`. A palavra "produto"
aparece ainda em outros dois lugares com sentidos diferentes: no nome da tabela e em
`client_engagements.service_model = 'product'`.

### Portfólio antes desta decisão `[EXISTENTE E VERIFICADO]`

Conferido no banco depois da migração `031`, que removeu Barber, Commerce e Data, e
antes da `032`. O estado depois dela está em [Classificação decidida](#classificação-decidida-aceita).

| Item | `portfolio_kind` | O que está ligado a ele |
|---|---|---|
| `skiller` | `product` | 1 oferta, 1 template de checkout, 6 recursos |
| `educare` | `platform` | 1 template de checkout, 2 recursos |
| `core` | `platform` | 3 recursos |
| `sites` | `service_line` | 2 recursos |

`entitlements`, `memberships` e `app_clients` têm **0 linhas**. As 4 contratações
existentes não apontam para item nenhum. Nenhum `delivery_project` criou item.

### O que `portfolio_kind` decidia: nada

Situação antes da implementação; as linhas citadas são do código daquele momento.
Nenhuma rota lia o tipo para permitir ou recusar. Ele era validado no CRUD
(`portfolio.mjs:98`) e lido só para exibição (`product-console.mjs:37`,
`marketing.mjs:250`, `app.js:776`). Consequências conferidas no código:

1. **A regra existe, mas pelo id.** `billing.mjs:39` recusa oferta e
   `checkout-gateway.mjs:92` e `:108` recusam checkout quando `product_id === 'sites'`.
   A tela repete o teste em `app.js:762` e trata `skiller` à parte em `app.js:423`.
   Uma linha de serviço nova criada por `POST /api/portfolio` passa por nenhuma
   dessas travas: aceita oferta já em rascunho e checkout público assim que ativada.
2. **Acesso aceita qualquer tipo.** Contrato de acesso (`contracts.mjs:12`), vínculo
   de pessoa (`directory.mjs:53`), chave com escopo `context:read`
   (`commercial-keys.mjs:28`) e `/v1/context` (`access.mjs:10` e `:27`) olham só
   `lifecycle_status`. Dá para dar acesso a `sites`, que não tem usuário logando por
   ele, e a `core` — era a pendência D2, decidida abaixo.
3. **Contratação "produto" aceita item de qualquer tipo.** A `030` exige `product_id`
   quando `service_model = 'product'`, mas `portfolio.mjs:131` não confere o tipo:
   dá para registrar venda de produto apontando para `sites`.
4. **Projeto técnico fixa o tipo.** `delivery.mjs:101` cria todo item novo como
   `product` em rascunho, inclusive quando o trabalho é sob demanda.
5. **Rascunho parecia ter tratamento desigual, mas é intencional.** Vínculo de pessoa
   exige item ativo; contrato de acesso aceita rascunho. O checklist de ativação do
   projeto (`delivery.mjs:17`) exige um contrato preparado **antes** de ativar, e
   `/v1/context` só responde para item ativo. Rascunho aceita contrato, mas não dá
   acesso. O comentário antigo em `catalog.mjs` é que estava errado, e foi corrigido.

A auditoria de 07/09 já recomendou: *separar as dimensões, com política executável,
não `if` isolado*.

### Por que decidir agora

- **As tabelas de acesso estão vazias.** Impor regra hoje não revoga nada. Com
  clientes reais, cada linha fora da regra vira revisão caso a caso — o mesmo motivo
  que antecipou a [ADR 0002](0002-vinculo-de-pessoa-por-produto.md).
- **O CRUD de portfólio vai ganhar tela** (próximo passo em
  [FEATURES.md](../FEATURES.md#próxima-ordem-de-execução)). A partir daí o tipo é
  preenchido por operador, e um campo que não governa nada é preenchido sem cuidado.

## Vocabulário

Vale para qualquer opção.

| Tipo | O que é | Como se vende | Exemplo |
|---|---|---|---|
| `product` | Software que o cliente usa; o acesso das pessoas passa pelo Core | Assinatura ou licença de uso | Skiller |
| `platform` | Software onde se assina o conteúdo que roda nele | Assinatura de cursos e conteúdos | Educare |
| `service_line` | Frente de trabalho feito por pessoas, sob contrato; ninguém loga por ela | Proposta ou formulário | Sites, Mentorias, Consultorias |
| `internal` | Software da própria TZOLKIN, sem comprador externo | Não se vende | Core |

Teste para separar produto de serviço: **se o cliente cancelar, ele perde acesso a
algo nosso, ou fica com o que entregamos?**

Mentoria e consultoria existem nos dois eixos, com papéis diferentes:
- como **linha do portfólio**, onde se capta, cobra e comunica;
- como **`service_model` da contratação**, o tipo de contrato.

Uma consultoria vendida dentro de Sites continua sendo contratação de Sites, com
`service_model = 'consulting'`. Sob demanda e assessoria seguem só como modalidade.

## Classificação decidida `[ACEITA]`

Decidida pelo dono em 2026-09-14 e aplicada pela migração `032`, com trilha em
`portfolio_audit` (`actor_subject = 'migration:032'`).

| Item | Tipo | Decisão |
|---|---|---|
| `core` | `internal` | Mudou de `platform`. Está no portfólio para guardar a própria infraestrutura (repositório, backend, domínio), não para ser vendido. **Responde D2.** |
| `skiller` | `product` | Sem mudança. |
| `sites` | `service_line` | Sem mudança. |
| `educare` | `platform` | Sem mudança: plataforma de assinatura de cursos e conteúdos. |
| `mentorias` | `service_line` | **Novo**, ativo, com contexto próprio no painel. Recebeu as duas contratações de `service_model = 'education'` que não tinham item. |
| `consultorias` | `service_line` | **Novo**, ativo, com contexto próprio no painel. Não havia contratação de consultoria sem item. |

O placeholder "Mentorias" da navegação geral saiu. Ele descrevia turmas e matrículas,
que são do Educare, e agora a linha Mentorias tem contexto próprio.

Sozinha, a `032` não mudava regra nenhuma: os novos contextos recebiam a navegação
de produto. Isso foi corrigido pela opção B, abaixo.

## Opções

### A — Manter como rótulo cadastral

O tipo continua descritivo. Documenta-se o vocabulário acima e nada muda no código.

- **A favor:** custo zero; nenhum teste muda.
- **Contra:** as travas de Sites seguem por id, e item novo nasce sem nenhuma. D2
  segue sem resposta. Não cumpre a recomendação da auditoria.

### B — Capacidades derivadas do tipo, numa política única (aceita e implementada)

Uma tabela de capacidades por tipo, no código, consultada por uma política única em
`catalog.mjs`: `CAPABILITIES`, `findProductFor` e `requireProductFor`. Ela substitui
os `if` por id. Ciclo de vida continua sendo outro eixo: quem chama diz se aceita
rascunho.

O tipo **`internal`** (migração `032`) só tem a capacidade de operar: é assim que D2
passa de classificação a regra.

| Capacidade (`catalog.mjs`) | Onde se aplica | `product` | `platform` | `service_line` | `internal` |
|---|---|:-:|:-:|:-:|:-:|
| `access` — contrato de acesso, vínculo de pessoa, chave `context:read`, `/v1/context` | `contracts.mjs`, `directory.mjs`, `commercial-keys.mjs`, `access.mjs` | sim | sim | **não** | **não** |
| `checkout` — oferta, template e checkout público | `billing.mjs`, `checkout-templates.mjs`, `checkout-gateway.mjs` | sim | sim | **não** | **não** |
| `product_engagement` — contratação com `service_model = 'product'` | `portfolio.mjs` | sim | sim | **não** | **não** |
| `commercial` — captação, chaves `commercial:*` e demais contratações | `commercial-keys.mjs`, `access.mjs`, `portfolio.mjs` | sim | sim | sim | **não** |
| `operate` — recursos, deploys, e-mails e campanhas | `findEditableProduct` nos módulos de operação | sim | sim | sim | sim |

No checkout público, um item sem a capacidade recebe o mesmo 404 de oferta
inexistente: rota pública não explica a classificação do portfólio. Nas rotas do
painel, a recusa é 409 e diz o tipo e o motivo.

Na matriz, `product` e `platform` ficam com as mesmas capacidades. A distinção entre
eles continua sendo de portfólio. Fundi-los seria uma simplificação possível, fora
desta ADR.

- **A favor:** tira as regras escritas por id do servidor e da tela. Item novo nasce
  já com as regras do tipo. Resolve D2. É uma função e uma migração pequena, sem
  dado a mover.
- **Contra:** quando uma exceção aparecer dentro de um tipo — uma linha de serviço
  que precise de checkout —, a matriz não a expressa. Aí se passa para C, que é
  aditiva. Os testes de integração que usam `sites` como produto com acesso precisam
  trocar de item.

### C — Capacidades como colunas por item

O tipo continua rótulo; cada item ganha colunas próprias, como `grants_access`,
`public_checkout` e `accepts_intake`. É a regra do
[DOMAIN-MODEL](../DOMAIN-MODEL.md#products--catálogo) levada ao pé da letra: atributo
que dirige regra desce para coluna própria.

- **A favor:** qualquer combinação por item.
- **Contra:** três booleanos são oito combinações, e a maioria não faz sentido (linha
  de serviço com acesso). O operador preenche tudo à mão, e tipo e colunas divergem
  com o tempo. Resolve exceções que ainda não existem.

## Implementação `[EXISTENTE E VERIFICADO]`

Feita em 2026-09-14. Não precisou de migração de dado: o tipo `internal` e a
reclassificação já estavam na `032`.

1. **Política única** em `catalog.mjs`. `requireProductFor` devolve o item ou recusa
   com 409 dizendo o tipo e o motivo ("TZOLKIN Mentorias é uma linha de serviço e
   não vende por checkout").
2. **Saíram os `if` por id** do servidor (`billing.mjs`, `checkout-gateway.mjs`) e
   da tela (`sites` e `skiller` em `app.js`).
3. **A chave é conferida duas vezes:** ao ser emitida, e a cada uso em
   `authenticateApp`. Se o item for reclassificado depois, a chave antiga para de
   valer na consulta seguinte.
4. **Reclassificar não corta em silêncio.** `PUT /api/portfolio/:id` recusa mudar
   para um tipo que perde uma capacidade enquanto houver algo vivo dependendo dela:
   contrato de acesso, vínculo, chave, oferta ou contratação em curso.
5. **A API devolve as capacidades** de cada item, em `/api/overview`,
   `/api/portfolio` e no console do item. O console também traz as contratações do
   item.
6. **A tela monta o contexto pelas capacidades.** Linha de serviço mostra Inbound,
   Chaves, Contratações, E-mails e Campanhas; não mostra Clientes (contrato de
   acesso) nem Cobrança. Item interno mostra só o que se opera. Os formulários de
   vínculo e de contrato só oferecem itens com acesso.
7. **Testes:** `test/unit/capabilities.test.mjs`, novo, cobre a matriz, a recusa por
   tipo, a emissão de chave e a trava de reclassificação. Os testes de integração
   trocaram `sites` por `educare` onde exercitam acesso, e passaram a exigir a recusa
   para `sites`.

**Não feito:** `delivery.mjs` ainda cria todo projeto técnico como `product`. O
checklist de ativação pressupõe produto (oferta, checkout e contrato), então pedir o
tipo exige também um checklist por tipo. Fica como pendência.

## Custo de reverter

- **A → B:** foi baixo. Na implementação havia zero linhas de acesso, zero ofertas
  em linha de serviço e zero projetos com item.
- **B → A:** simples no código, mas **amplia** o que é permitido. Exige revisão de
  segurança, como B → A na ADR 0002.
- **B → C:** aditivo. Criam-se as colunas preenchidas pela matriz, e a política
  passa a lê-las.
- **Classificação da `032`:** baixo. `core` volta a `platform` pelo CRUD. As duas
  linhas novas são arquivadas pelo CRUD, e as duas contratações voltam a
  `product_id` nulo com o estado anterior guardado em `portfolio_audit`.

## Alternativas descartadas

| Alternativa | Por que não |
|---|---|
| Renomear `products` para `portfolio_items` | 18 chaves estrangeiras, `/c/:productId` em links públicos de checkout e chaves já emitidas. É o custo mais alto de todos e não muda nenhum comportamento: o problema é regra, não nome. |
| Impor a matriz no banco, com trigger ou `CHECK` entre tabelas | A regra tocaria cerca de 20 tabelas por trigger. O Core já isola por consulta no servidor ([D5](../CONTEXT.md#d5--isolamento-no-banco-só-query-ou-rlsseparação-física)); endurecer no banco é decisão daquela pendência, não desta. |
| Derivar capacidade de `service_model` | `service_model` descreve a contratação, não o item. A mesma linha pode ter contratações de modelos diferentes. |
| Manter as travas por id e só documentar | É a opção A com outro nome: item novo continua sem trava. |

## Pendências

1. [x] Escolher A, B ou C: **B**, implementada em 2026-09-14.
2. [x] D2: o Core é `internal`. Decidido em 2026-09-14, aplicado na `032`.
3. [x] Confirmar a matriz de B:
   - `platform` tem checkout público: sim, o Educare vende por assinatura.
   - `service_line` aceita intake: sim, o Sites já usa.
   - Mentoria e consultoria **não** vendem por checkout. A matriz vale como está.
4. [ ] **Cobrança das linhas de serviço.** O dono quer cobrar Mentorias e
       Consultorias pela conta PJ da Contabilizei, ou por outra via com API.
       Pesquisa em andamento. A cobrança por proposta **não** passa pela capacidade
       `checkout`: é outro fluxo, a desenhar quando a via for escolhida.
5. [ ] Projeto técnico com tipo: `delivery.mjs` ainda cria todo item como
       `product`, e o checklist de ativação pressupõe produto.
6. [ ] Nome do `service_model`: a `014` trocou `mentorship` por `education`. Com
       Educare como plataforma e Mentorias como linha, `education` ficou ambíguo; a
       tela chama o mesmo valor de "Educacional" (`app.js`) e de "Mentoria"
       (`campaigns.js`).
7. [ ] Fora desta ADR, apontadas pela auditoria: `acquisition_mode` e `billing_mode`
       como dimensões próprias. `billing_offers.kind` já cobre parte do segundo.
