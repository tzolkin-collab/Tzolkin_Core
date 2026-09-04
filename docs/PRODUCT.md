# Produto

Quem usa o Core, para quê, e o que ele deliberadamente não faz.

Revisão: **2026-08-30**.

---

## 1. Usuários

Equipe de 4–5 pessoas com participação variável. **Nenhum nome, quantidade ou permissão fica no código** — [CONTEXT.md §3](CONTEXT.md#3-restrições-que-não-se-negociam-decidido), regra 9.

| Papel | O que precisa | Hoje |
|---|---|---|
| **Operador interno** | Cadastrar organização, registrar contrato, conceder/revogar acesso, ver a carteira por produto | `[EXISTENTE E VERIFICADO]` — é o único usuário do Core |
| **Responsável por um produto** | Ver só a carteira do seu produto, sem ruído dos outros | `[EXISTENTE E VERIFICADO]` como recorte de tela; **não** como permissão — todo operador ainda é administrador global |
| **Colaborador temporário** | Acesso com escopo e prazo | `[PROPOSTO]` — [SECURITY.md](SECURITY.md#3-permissões-proposto) |
| **Backend de um produto** | Perguntar se uma pessoa pode usar o produto por aquela organização | `[EXISTENTE E VERIFICADO]` — `GET /v1/context` |
| **Cliente (organização)** | Ver o que contratou, gerir seus usuários | `[PROPOSTO]` — **não existe portal de cliente** |

---

## 2. Os três contextos

Fronteiras de dado, não abas. Implementação em [ARCHITECTURE.md](ARCHITECTURE.md#os-três-contextos).

### A — Gestão geral da TZOLKIN

Comercial próprio, portfólio, clientes, contratos, receita/despesa/tesouraria, equipe, integrações, indicadores.

**Hoje:** portfólio, clientes, contratos e vínculos. **Não existe:** comercial próprio, financeiro, equipe, integrações, indicadores consolidados. Não há menu para nenhum deles — [DESIGN-SYSTEM.md](DESIGN-SYSTEM.md#6-estados).

### B — Gestão de um produto

Clientes do produto, ofertas e planos, comercial, operação, pagamentos, relatórios, configurações.

**Hoje:** seleção de produto, visão geral, organizações contratantes e direitos em vigor. **Não existe:** ofertas, comercial, operação, pagamentos, relatórios, configurações.

A operação específica de cada produto — projetos e formulários (Sites), pedidos e estoque (Commerce), agenda e profissionais (Barber), conteúdo e matrículas (Educare), fontes e funis (Data) — é **escopo proposto**, e mora no backend do produto, não aqui.

### C — Organização cliente

Produtos contratados, usuários, permissões, operação e dados daquela organização.

**Hoje:** nada. Não há autenticação de cliente, portal nem rota. Nenhuma foi inventada.

**Restrição que governa este contexto:** uma organização pode contratar vários produtos; isso **não** autoriza misturar dados operacionais nem acesso cruzado. O vínculo de pessoa é por organização **e** produto, e o Core recusa o acesso cruzado no próprio `/v1/context` — [ADR 0002](decisions/0002-vinculo-de-pessoa-por-produto.md).

---

## 3. Jornadas

### J1 — Registrar uma organização e dar acesso `[EXISTENTE E VERIFICADO]`

1. Operador entra no painel local.
2. **Clientes → Novo cliente**: nome + identificador.
3. **Produtos e planos → Vincular produto**: organização, produto, plano, direitos, status.
4. **Pessoas e acessos → Vincular pessoa**: organização, **produto** e identificador externo da conta no app. O vínculo vale só para aquele produto.
5. O backend do produto passa a receber `200` em `/v1/context` para aquela pessoa.

Revogar é o passo inverso, e vale na consulta seguinte — não há cache.

### J2 — Trabalhar no contexto de um produto `[EXISTENTE E VERIFICADO]`

1. Operador escolhe o produto no seletor de contexto da barra lateral.
2. A tela **descarta os dados do contexto anterior** antes de qualquer requisição.
3. O servidor revalida a sessão e devolve **só** as organizações com contrato daquele produto.
4. Navegação, métricas e ações passam a ser as do produto; o cabeçalho mostra `TZOLKIN · <Produto>`.
5. Sem contratos, a tela diz exatamente isso e oferece a ação de registrar o primeiro.

### J3 — App consulta acesso `[EXISTENTE E VERIFICADO]`

O backend do produto autentica a pessoa, chama `/v1/context` com a credencial do produto e autoriza pelos `rights`. Contrato completo em [ARCHITECTURE.md](ARCHITECTURE.md#externo-apps--get-v1context).

### J4 — Cliente contrata e paga `[PROPOSTO]`

Não implementada. Depende de [BILLING.md](BILLING.md) e das pendências [D3](CONTEXT.md#d3--quem-vende-e-quem-recebe-no-fluxo-consumidor--cliente) e [D4](CONTEXT.md#d4--qual-idp-substitui-o-bootstrap-de-senha-única).

---

## 4. Não objetivos

Compromissos, não omissões.

1. **Não virar backend universal.** Operação dos apps não migra para o Core.
2. **Não ser motor genérico de CRM/OMS/ERP** antes de existir fluxo concreto para modelar.
3. **Não substituir a contabilidade fiscal.** A Contabilizei segue responsável — [BILLING.md](BILLING.md).
4. **Não guardar dado de consumidor final** de cliente nenhum.
5. **Não guardar lead operacional** dos clientes.
6. **Não movimentar dinheiro na primeira fase de Open Finance.** Só leitura — [INTEGRATIONS.md](INTEGRATIONS.md#6-open-finance-proposto).
7. **Não armazenar dado bruto de cartão.** Tokenização/checkout do provedor.
8. **Não exibir métrica sem dado real** nem gráfico sem decisão associada — [DESIGN-SYSTEM.md](DESIGN-SYSTEM.md).
9. **Não criar menu para módulo inexistente.**
10. **Não publicar o Core** enquanto a identidade for a senha única de bootstrap.

---

## 5. Ciclos comerciais diferentes `[DECIDIDO]`

Serviço, SaaS e conteúdo têm ciclos distintos de venda, contratação, entrega e cobrança. O modelo precisa suportar os três **sem** um `plan` único fazer as vezes de tudo:

| | Serviço (Sites) | SaaS (Barber, Commerce) | Conteúdo (Educare) |
|---|---|---|---|
| Venda | proposta, escopo negociado | autosserviço ou proposta | matrícula |
| Contratação | contrato com entregas | assinatura recorrente | acesso por período ou turma |
| Entrega | por marco | contínua | por progresso |
| Cobrança | parcelas, à vista | recorrência | à vista ou parcelado |

Hoje `entitlements.plan` é um rótulo cadastral e não modela nada disso — por isso `offers`/`price_versions`/`contracts` aparecem como entidades ainda não modeladas em [DOMAIN-MODEL.md](DOMAIN-MODEL.md#4-entidades-ainda-não-modeladas-proposto).
