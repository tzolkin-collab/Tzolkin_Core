# Arquitetura

Atualização `[EXISTENTE E VERIFICADO]` de 2026-08-31: web e API agora são workspaces/processos separados (`apps/web` e `apps/api`). O web possui proxy local, sem acesso ao banco; a API não serve assets. Mapeamento, portas e garantias em [SPLIT-RUNTIME.md](SPLIT-RUNTIME.md). As referências históricas a `src/` correspondem agora a `apps/api/src/`; `public/` corresponde a `apps/web/public/`, e o módulo de assets pertence ao web.

Módulos, fronteiras e contratos. Conceitos em [DOMAIN-MODEL.md](DOMAIN-MODEL.md).

Revisão: **2026-09-03**.

---

## 1. Fronteiras

```
┌──────────────────────────────────────────────────────────────┐
│ TZOLKIN Core                                                 │
│  organizações · vínculos · catálogo · contratos · direitos   │
│  ─────────────────────────────────────────────────────────   │
│  banco tzolkin_core (exclusivo)                              │
└───────────────┬──────────────────────────────────────────────┘
                │ GET /v1/context  (server-to-server, credencial do produto)
                │ direito ao vivo, sem cache
   ┌────────────┼────────────┬─────────────┐
   ▼            ▼            ▼             ▼
┌────────┐ ┌─────────┐ ┌──────────┐ ┌──────────┐
│ Sites  │ │ Barber  │ │ Commerce │ │ Educare  │   backends dos produtos
│ leads  │ │ agenda  │ │ pedidos  │ │ matrícu- │   regra operacional +
│ forms  │ │ profis. │ │ estoque  │ │ las      │   banco próprio
└────────┘ └─────────┘ └──────────┘ └──────────┘
```

**O que o Core é:** autoridade sobre *quem é a organização*, *quem pertence a ela* e *o que ela contratou*.
**O que o Core não é:** backend das operações dos produtos. Agenda, pedido, matrícula, lead de cliente e consumidor final **não passam pelo Core** — [DATA-OWNERSHIP.md](DATA-OWNERSHIP.md).

Regras 1, 2 e 3 de [CONTEXT.md §3](CONTEXT.md#3-restrições-que-não-se-negociam-decidido) valem aqui sem exceção.

---

## 2. Módulos `[EXISTENTE E VERIFICADO]`

Estrutura conferida em 2026-08-30. Antes desta entrega tudo vivia em um único `src/server.mjs` de 102 linhas.

```
src/
  server.mjs              ponto de entrada: env, pool, listen. Reexporta createCore
  app.mjs                 composição: pipeline de requisição + registro dos módulos
  platform/
    http.mjs              validação, erros, JSON, cabeçalhos de segurança  ← fonte única das regras de formato
    router.mjs            casamento método + caminho, com ":param"
    session.mjs           sessão administrativa e limite de tentativas
    assets.mjs            arquivos estáticos (lista fixa)
  modules/
    identity.mjs          POST /api/login, POST /api/logout, Google OIDC
    workspace.mjs         GET /health, GET /api/overview                    ← contexto A
    catalog.mjs           GET /api/ecosystem + leitura de products
    directory.mjs         POST|PUT /api/tenants, PUT /api/memberships
    contracts.mjs         PUT /api/entitlements
    access.mjs            GET /v1/context                                   ← consumido pelos apps
    product-console.mjs   GET /api/products/:productId/console              ← contexto B
    deploys.mjs           GET /api/deploys                                  ← leitura de provedores
    delivery.mjs          GET/POST/PUT /api/delivery/*                      ← projetos e ativação
    finance*.mjs          /api/finance/*                                    ← projeções e vendas
    payment-*.mjs         /api/webhooks/*                                   ← registro de eventos
  integrations/
    vercel.mjs            adaptador Vercel, SOMENTE LEITURA
```

**Regra de dependência:** `modules/*` importa de `platform/*` e de `integrations/*`; nem `platform/*` nem `integrations/*` importam de `modules/*`. Adaptador de provedor não conhece o domínio: recebe configuração e devolve dado normalizado. `app.mjs` é o único que conhece todos. Módulo não chama módulo, exceto leituras de catálogo explicitamente exportadas (`catalog.mjs`).

### Os três contextos

Os contextos A, B e C do produto ([PRODUCT.md](PRODUCT.md)) são fronteiras de **consulta ao servidor**, não abas do frontend:

| Contexto | Estado | Endpoint |
|---|---|---|
| A — Gestão geral da TZOLKIN | `[EXISTENTE E VERIFICADO]` parcial | `GET /api/overview` — cadastro completo |
| B — Gestão de um produto | `[EXISTENTE E VERIFICADO]` primeira fatia | `GET /api/products/:productId/console` — só quem tem contrato daquele produto |
| C — Organização cliente | `[PROPOSTO]` — nada implementado | Não existe portal de cliente. Ver [ROADMAP.md](ROADMAP.md) |

O recorte do contexto B é feito **no servidor, por `JOIN` a partir de `entitlements`**. O navegador não filtra nem escolhe o recorte: se a organização não tem contrato daquele produto, ela não sai do banco.

---

## 3. Pipeline de requisição `[EXISTENTE E VERIFICADO]`

Ordem em `src/app.mjs`. A ordem é o desenho de segurança, não estilo.

1. **Cabeçalhos de segurança** — `Cache-Control: no-store`, `X-Content-Type-Options`, CSP `default-src 'self'`, `Referrer-Policy: no-referrer`.
2. **Método** — só `GET`, `POST`, `PUT`. Resto: `405`.
3. **Origem** — mutação exige `Origin` **exatamente** `http://127.0.0.1:<porta>`. Proteção CSRF do bootstrap.
4. **Estáticos** — só `GET`, e só de uma lista fixa de quatro arquivos. Nenhum caminho vem da URL.
5. **Rota** — casamento método + caminho. Rota inexistente **exige sessão antes** de responder 404/405, para não revelar quais rotas existem.
6. **Autenticação**, por rota:
   - `public` — `/health`, `/api/login`
   - `service` — `Bearer` casado contra `app_clients.token_hash`; devolve o `product_id` **do servidor**. O chamador **não escolhe o produto**
   - `admin` (padrão) — cookie `core_session`, validado em memória com expiração
7. **Corpo** — só em rota transacional; `application/json` obrigatório, teto de 16 KB.
8. **Transação** — `BEGIN` → handler → `INSERT audit_events` → `COMMIT`; qualquer erro faz `ROLLBACK`. Mutação e trilha entram juntas ou não entram.
9. **Erro** — traduzido por `describeError`: `23505` → 409, `23503` → 409, desconhecido → 500 genérico. Nenhum detalhe interno vaza.

---

## 4. Contratos de API `[EXISTENTE E VERIFICADO]`

### Interno (painel) — exige cookie de sessão

| Método | Rota | Devolve |
|---|---|---|
| `GET` | `/health` | público; confirma banco |
| `POST` | `/api/login` | cookie `HttpOnly; SameSite=Strict; Path=/; Max-Age=3600` |
| `POST` | `/api/logout` | expira o cookie e descarta a sessão |
| `GET` | `/api/overview` | `{tenants, products, memberships, entitlements}` |
| `GET` | `/api/ecosystem` | `{entries}` — catálogo do Notion |
| `POST` | `/api/tenants` | `{name, slug}` → `{ok, tenant_id}` |
| `PUT` | `/api/tenants` | `{tenant_id, status}` |
| `PUT` | `/api/memberships` | `{tenant_id, product_id, subject, active}` |
| `PUT` | `/api/entitlements` | `{tenant_id, product_id, plan, rights[], active}` |
| `GET` | `/api/products/:productId/console` | contexto de produto — abaixo |
| `GET` | `/api/deploys` | deploys por projeto, dos provedores configurados — [INTEGRATIONS.md §9](INTEGRATIONS.md#9-deploys--vercel-existente-e-verificado) |

Campo não previsto no corpo ⇒ `400`. Parâmetro de query não previsto ⇒ `400`. Não há "aceitar e ignorar".

### `GET /api/products/:productId/console`

```jsonc
{
  "product": { "id": "barber", "name": "TZOLKIN Barber",
               "catalog": { /* ficha do Notion, ou null */ } },
  "summary": { "organizations": 4, "active_contracts": 2,
               "revoked_contracts": 1, "suspended_organizations": 1,
               "reachable_memberships": 4 },
  "membership_scope": "product",
  "organizations": [ { "tenant_id": "…", "name": "…", "slug": "…", "status": "active",
                       "plan": "mensal", "contract_active": true, "rights": ["agenda.read"],
                       "contract_version": 3, "contract_updated_at": "…",
                       "active_memberships": 3, "total_memberships": 3 } ],
  "generated_at": "2026-08-30T…Z"
}
```

- Uma organização aparece **se e somente se** existe `entitlements` dela para este produto. Nada é inferido por nome, catálogo ou proximidade.
- `active_contracts` conta contrato ativo **de organização ativa** — mesmo critério de `/v1/context`. Contrato ativo de organização suspensa não concede nada e não infla o número.
- `active_memberships` / `total_memberships` contam **vínculos deste produto**, e `membership_scope: "product"` declara isso na própria resposta.
- Produto inválido no formato ⇒ `400`; inexistente ⇒ `404`. Credencial de app ⇒ `401`: esta rota é do operador interno.

### Externo (apps) — `GET /v1/context`

```
GET /v1/context?tenant_id=<uuid>&subject=<id externo>
Authorization: Bearer <token do produto>
```

```jsonc
{ "tenant_id": "…", "subject": "…", "product_id": "barber",
  "plan": "mensal", "rights": ["agenda.read"], "version": 3,
  "checked_at": "2026-08-30T…Z" }
```

O vínculo consultado é **deste produto**: uma pessoa vinculada a outro produto da mesma organização recebe `403`.

Contrato que o app precisa respeitar:

1. **Autentique a pessoa antes.** A credencial identifica o produto, não a sessão do usuário. Ela permite consultar membros daquele produto — nada além.
2. **Nunca a partir do navegador.** Token de serviço não vai para o frontend.
3. **`403` significa negado**, não "erro temporário". Trate como negação.
4. **`plan` não é preço nem autorização.** Autorize por `rights` e pelas regras do próprio app.
5. **Core indisponível não libera nada.** Sem resposta válida, ação sensível falha fechada.
6. **`version` é monotônico.** Ao adotar eventos, descarte versão menor que a já aplicada.

---

## Catálogo técnico e configurações `[EXISTENTE E VERIFICADO]`

Verificado em 2026-09-03 por `npm run test:unit` e consultas GET aos provedores. `modules/delivery.mjs` registra `GET /api/delivery/options`, `GET/POST /api/delivery/projects`, `PUT /api/delivery/projects/:id`, `POST /api/delivery/projects/:id/activate` e `GET /api/delivery/settings`. Todos exigem sessão administrativa. Cadastro e auditoria técnica usam uma transação própria nas tabelas `delivery_projects` e `delivery_audit`, sem misturar dados de clientes.

`integrations/delivery-settings.mjs` consulta somente configurações existentes de projetos Vercel e serviços App EasyPanel, validando o destino no inventário e projetando campos permitidos. `public/delivery.js` compara com o formulário atual e permite importação seletiva antes do salvamento normal. Nenhuma alteração remota, comando ou deploy é executado. Contrato, campos, limites e lacunas: [DELIVERY-CATALOG.md](DELIVERY-CATALOG.md).

## 5. Direção proposta `[PROPOSTO]`

Nada abaixo está implementado.

| Peça | Desenho | Por quê |
|---|---|---|
| Core modular monolítico | Manter um processo com módulos de fronteira explícita | Volume atual é cadastral; microsserviço aqui só adicionaria custo — [ADR 0001](decisions/0001-core-modular-com-bancos-separados.md) |
| Módulo financeiro com adaptadores | Um domínio financeiro no Core, um adaptador por provedor | Evita amarrar produto a provedor — [BILLING.md](BILLING.md) |
| Processamento assíncrono | Só onde há chamada externa que pode falhar (webhook, conciliação) | Fila para operação cadastral seria complexidade sem ganho |
| Eventos com contrato explícito | `event_id`, versão do contrato, `aggregate_id`, versão monotônica, `occurred_at`, produto/tenant | [INTEGRATIONS.md](INTEGRATIONS.md#4-contrato-de-evento-proposto) |
| Cache de direitos nos apps | **Não adotar sem definir a janela de revogação por risco.** Hoje: sem cache | Cache é troca entre latência e janela de revogação, e é decisão do usuário |
