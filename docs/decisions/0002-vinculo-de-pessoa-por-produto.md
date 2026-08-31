# ADR 0002 — Escopo do vínculo de pessoa: organização ou produto

- **Status:** `[ACEITA]` — opção **B**, decidida pelo usuário e implementada em 2026-08-30.
- **Data:** 2026-08-30
- **Referência:** [D1](../CONTEXT.md#d1--vínculo-de-pessoa-por-produto-resolvida)

## Contexto

Como estava antes desta decisão:

```sql
memberships(tenant_id, subject, active)   -- PK (tenant_id, subject)
```

E `/v1/context` casa a pessoa **pela organização**:

```sql
JOIN memberships m ON m.tenant_id = t.id
WHERE t.id = $1 AND m.subject = $2 AND e.product_id = $3
  AND t.status='active' AND m.active AND e.active
```

O produto entra pelo **contrato** (`e.product_id`), não pelo vínculo. Consequência: se a organização contrata Barber e Commerce, **toda pessoa com vínculo ativo alcança os dois**.

Isso contraria a regra 6 de [CONTEXT.md §3](../CONTEXT.md#3-restrições-que-não-se-negociam-decidido): contratar vários produtos não autoriza acesso cruzado.

**Por que foi decidido agora:** `memberships` estava com 0 linhas. Corrigir com a tabela vazia custou uma migração sem dado a migrar; depois de haver clientes reais custaria janela de migração e versionamento do contrato `/v1/context`.

## Opções

### A — Manter por organização, e segmentar por direitos

Vínculo continua na organização; o que separa os produtos são os `rights` do contrato, aplicados pelo backend de cada produto.

- **A favor:** nada muda; modelo simples; menos administração para o operador.
- **Contra:** o Core deixa de responder "esta pessoa pode usar este produto?" — só responde "esta organização pode". A segmentação vira responsabilidade de cada app, e um app que a esqueça abre acesso cruzado sem que o Core perceba. **Não cumpre a regra 6 no Core.**

### B — Vínculo por produto (recomendada)

```sql
memberships(tenant_id, subject, product_id, active)   -- PK (tenant_id, subject, product_id)
```

`/v1/context` passa a exigir `m.product_id = e.product_id`.

- **A favor:** cumpre a regra 6 **no Core**, não por confiança no app. O Core passa a responder a pergunta certa. Revogar de um produto sem tirar do outro fica trivial.
- **Contra:** migração; mais administração (uma linha por pessoa × produto); mudança no contrato dos apps.
- **Migração:** para cada vínculo existente, criar uma linha por produto que a organização contrata. Preserva o acesso atual e **não amplia nada** — só torna explícito o que estava implícito.

### C — Híbrido: vínculo na organização + concessão por produto

Vínculo na organização (a pessoa pertence a ela) mais uma tabela de concessão por produto, com papel e expiração.

- **A favor:** separa "pertence a" de "pode usar", que são coisas diferentes; encaixa naturalmente papel e acesso temporário ([SECURITY.md](../SECURITY.md#3-permissões-proposto)).
- **Contra:** duas tabelas e duas operações; mais superfície para inconsistência.

## Decisão: opção B

Escolhida pelo usuário em 2026-08-30, com evolução para C prevista quando existirem papéis — a estrutura de B é o núcleo de C: a concessão de C é a linha de B com papel e expiração acrescentados.

### O que foi implementado

| Onde | Mudança |
|---|---|
| `db/migrations/001_membership_por_produto.sql` | `product_id` com FK, PK `(tenant_id, subject, product_id)`, backfill expandindo cada vínculo por contrato existente |
| `src/modules/access.mjs` | `/v1/context` casa `m.product_id = e.product_id` |
| `src/modules/directory.mjs` | `PUT /api/memberships` exige `product_id`; vínculo sem produto ⇒ `400` |
| `src/modules/product-console.mjs` | Contagens de pessoas por produto; `membership_scope: "product"` |
| `public/` | Formulário de acesso com seletor de produto; rótulos e nota de escopo atualizados |
| `test/` | Negação entre produtos da mesma organização; contagem por produto; vínculo sem produto rejeitado |

O backfill expande cada vínculo em uma linha por produto já contratado: **preserva o acesso existente e não amplia nada**. Aplicado com a tabela vazia — nenhum registro migrado na prática.

## Custo de reverter

- **A → B:** cresce com o número de vínculos. Hoje: zero.
- **B → A:** simples, mas amplia acesso — exigiria revisão de segurança.
- **B → C:** aditivo, baixo.
