# Pendências operacionais

O que está aberto **fora do código**: risco de infraestrutura, dinheiro que não entrou, modelos implementados e vazios, e trabalho parado em outros repositórios.

Este documento existe porque essas pendências viviam só em conversa. Conversa não é registro: some, e o risco continua.

Revisão: **2026-09-02**.

**Não duplica outros documentos.** Decisão que bloqueia trabalho mora em [CONTEXT.md §5](CONTEXT.md#5-decisões-pendentes). Entrega planejada mora em [ROADMAP.md](ROADMAP.md). Aqui fica o que não é nem uma coisa nem outra: o estado da operação.

---

## 1. Risco sem volta

Ordenado por irreversibilidade, não por esforço. O critério é: **se der errado, dá para desfazer?**

| Item | Situação | Se acontecer |
|---|---|---|
| **Backup sem destino externo** | 16 backups PostgreSQL ativos, todos em **Local Disk** no mesmo servidor | Protege contra apagar tabela por engano. **Não protege contra perder o servidor**, que é o cenário sem volta |
| **Restauração de backup não testada** | Nenhum ensaio registrado em ambiente isolado | Backup sem restauração verificada continua sendo hipótese |
| **Credenciais em texto aberto no Notion** | Sinalizado como prioridade pelo próprio ADR de infraestrutura. Nunca tratado, e sem item rastreando | Vazamento do Notion vira vazamento de tudo. Rotação depois do fato não desfaz cópia |
| **Porta 9000 exposta à internet** | `easypanel.landcriativa.com:9000` aceita conexão de qualquer IP, verificado por sondagem. O TLS resolveu interceptação, não exposição | Varredura e força bruta continuam possíveis contra um painel que administra 19 bancos |
| **Certificado do Postgres vence** | `notAfter = 2027-08-31` `[EXISTENTE E VERIFICADO]` — conferido em 2026-09-02 com `openssl x509 -enddate -in certs/postgres-server.crt` | Com `verify-full`, vencimento **não degrada: para**. O Core perde o banco de uma vez, sem aviso prévio |

**Se for fazer uma só coisa:** backup dos bancos de cliente. É a única da lista que não tem conserto depois — e é configuração de painel, não desenvolvimento.

**Estado atual:** os 16 agendamentos estão escalonados para evitar quinze `pg_dump` simultâneos,
mas ainda usam disco local. A decisão de destino (S3, outro host, off-site) e de retenção precisa
vir antes de considerar a proteção concluída.

---

## 2. Dinheiro parado

| Item | Situação | O que trava |
|---|---|---|
| **R$ 19.000 nunca cobrados** | Não é inadimplência: é cobrança que nunca saiu | Nada técnico. Depende de emitir |
| **Webhooks sem destino cadastrado** | Rotas prontas e testadas, segredos preenchidos no `.env`, **destinos vazios nos painéis** da Stripe e do Asaas. `payment_webhook_events` e `payment_charges` com **0 linhas** `[EXISTENTE E VERIFICADO]` — contados em 2026-09-02 | É o passo que falta para pagamento virar confirmação. Sem isso, o Core nunca sabe que alguém pagou |
| **Skiller fatura sem existir no Core** | 3 assinaturas ativas na Stripe. `entitlements` com **0 linhas** `[EXISTENTE E VERIFICADO]` — contado em 2026-09-02 | Receita real sem cliente, contrato ou direito correspondente. A conciliação não tem em que se apoiar |
| **Chave Stripe é de teste** | `STRIPE_SECRET_KEY` começa com `sk_test` `[EXISTENTE E VERIFICADO]` — conferido em 2026-09-02 | Nada que o Core leu ou criou na Stripe é receita real. Inclui o checkout publicado |

---

## 3. Modelos prontos e vazios

Implementados, testados, sem uso. Cada linha é capacidade construída que ainda não virou operação.

`[EXISTENTE E VERIFICADO]` — contagens feitas em 2026-09-02 por consulta direta ao banco.

| Tabela | Linhas | O que fica travado enquanto estiver vazia |
|---|---|---|
| `delivery_projects` | 0 | O cadastro técnico não conhece nenhum dos ~23 projetos que existem em disco |
| `entitlements` | 0 | Nenhum contrato. A regra de acesso de `/v1/context` nunca concede nada |
| `teams` | 0 | Times não existem; papel dentro de time é teórico |
| `operator_accounts` | 1 | Cadastro tem uma conta. Autorização real continua no `CORE_ALLOWED_EMAILS` |
| `payment_charges` | 0 | Nenhum pagamento observado (ver §2) |
| `billing_offers` | 1 | A Stripe tem 9 ofertas no catálogo; o Core conhece 1 |
| `service_time_logs` | — | Sem apontamento não há resposta para "esse cliente dá lucro?" |

---

## 4. Fora do Core

Trabalho parado em outros repositórios, verificado em 2026-09-02 pela consulta de deploys e pelo estado local dos repositórios.

- **lead-finder** — 11 commits não enviados; deploy cancelado há 33 dias
- **haylanderform** — branch de correção pela metade
- **tzolkin-sites** e **v1.0_site** — sem repositório associado; sem repositório não há commit, rollback por commit nem Deploy Hook
- **EasyPanel** — auto-deploy desligado
- **Sincronização do Pluggy** — setembro com 2 transações, outubro com 0; a leitura não é periódica

---

## 5. Esperando decisão que só você toma

As que bloqueiam código estão em [CONTEXT.md §5](CONTEXT.md#5-decisões-pendentes) — inclusive [D3](CONTEXT.md#d3--quem-vende-e-quem-recebe-no-fluxo-consumidor--cliente), que trava Barber, split e conta conectada. As operacionais são estas:

| Pergunta | Sem resposta, o que fica parado |
|---|---|
| E-mails do Lucas e do Nathan | Contas e times seguem teóricos; a divergência do cadastro não zera |
| Qual banco foi conectado ontem no Meu Pluggy | Não dá para separar as três hipóteses (item novo, Meu Pluggy diferente, ou portal sem propagar) |
| Destino do backup: disco local, S3 ou outro host | Bloqueia a execução do item mais urgente da §1 |
| Responsável é do cliente ou da contratação | No Assinatura são frentes diferentes; o modelo escolhe um dos dois |

---

## 6. Limitações registradas

Coisas que o software hoje não faz e que apareceram trabalhando, não em planejamento.

- **`audit_events.tenant_id` é `NOT NULL`.** Evento sem cliente associado — alteração de conta de operador, por exemplo — não tem onde ser gravado. As rotas de conta usam `audit:false`. Lacuna da E6 em [ROADMAP.md](ROADMAP.md).
- **Não existe reclassificação de organização pela API.** `POST /api/tenants` só insere. Tirar um cliente de `unclassified` exige SQL com auditoria manual. Falta `PUT /api/tenants`.
- **`PLUGGY_ITEM_IDS` é variável de ambiente.** Cada banco novo exige editar `.env` e redeployar. Deveria ser tabela, alimentada por um futuro widget Pluggy Connect — o `POST /connect_token` ainda não existe.
- **A Pluggy não permite listar itens.** `GET /items` responde 401 em toda variação; item só se busca por id. Item criado fora do `.env` é invisível para o Core.

---

## Como manter

Mesma regra do [README](README.md): marca de maturidade obrigatória, verificação com data e como foi conferida, e link em vez de repetir.

Uma pendência sai daqui de três formas: **resolvida** (some), **virou entrega planejada** (vai para o [ROADMAP](ROADMAP.md)) ou **virou decisão pendente** (vai para [CONTEXT.md §5](CONTEXT.md#5-decisões-pendentes)). Item que só envelhece na lista é sinal de que ninguém decidiu se importa — e isso também é informação.
