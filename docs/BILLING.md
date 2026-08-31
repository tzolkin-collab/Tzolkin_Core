# Financeiro

> **Estado: `[PROPOSTO]` inteiro.** Não existe uma linha de código financeiro no Core: nenhuma tabela, rota, chave de provedor ou webhook. Este documento é desenho e pesquisa, não implementação. Conferido em 2026-08-30.

Conceitos em [DOMAIN-MODEL.md](DOMAIN-MODEL.md). Mecânica de integração em [INTEGRATIONS.md](INTEGRATIONS.md).

---

## 1. Os dois fluxos, que nunca se misturam `[DECIDIDO]`

### Fluxo 1 — Cliente paga à TZOLKIN

A TZOLKIN vende, a TZOLKIN recebe. Assinatura de SaaS, projeto de site, matrícula em conteúdo. É o único fluxo com desenho aqui.

### Fluxo 2 — Consumidor paga ao cliente

Um consumidor final paga *ao cliente da TZOLKIN*, dentro de um produto (agendamento no Barber, pedido no Commerce).

> **`[PENDENTE DE DECISÃO]` — [D3](CONTEXT.md#d3--quem-vende-e-quem-recebe-no-fluxo-consumidor--cliente).**
> **Não implementar recebimento para terceiros, split, repasse ou conta conectada em produção** antes de responder:
> 1. Quem é o vendedor perante o consumidor — a TZOLKIN ou o cliente?
> 2. Quem é o recebedor legal do dinheiro?
> 3. Quem responde por estorno, contestação e reembolso?
> 4. Quem emite documento fiscal ao consumidor?
> 5. Que obrigações regulatórias e contratuais isso cria para a TZOLKIN?
>
> As respostas mudam produto, contabilidade e risco. Sem elas, o desenho seria chute.

---

## 2. Estados: cada um é uma coisa diferente

O erro clássico é achatar isso em "pago / não pago". Cada transição é um fato distinto, com dono e momento próprios.

| Estado | O que significa | O que **não** significa |
|---|---|---|
| **Contratação** | Acordo comercial fechado | Que houve cobrança |
| **Assinatura** | Compromisso recorrente ativo | Que a parcela do mês foi paga |
| **Parcela** | Quota devida em uma data | Que existe cobrança emitida |
| **Cobrança** | Instrumento emitido (Pix, boleto, fatura) | Nota fiscal. **Nunca** |
| **Tentativa de pagamento** | Uma tentativa, que pode falhar | Pagamento |
| **Pagamento confirmado** | O provedor confirmou o pagamento | Dinheiro disponível para sacar |
| **Liquidação** | Fundos disponíveis na conta | Receita reconhecida contabilmente |
| **Taxa** | Custo do provedor, deduzido | Despesa já classificada |
| **Estorno** | Devolução voluntária | Contestação |
| **Contestação** | Disputa aberta pelo pagador | Estorno |
| **Conciliação** | Nosso registro bate com o do provedor e com o extrato | Fechamento contábil |
| **Documento fiscal** | NF emitida | Cobrança |

Duas regras que caem de imediato:

- **Cobrança paga ≠ dinheiro disponível.** Confirmação e liquidação são eventos separados, com datas diferentes. No Asaas isso é explícito: `PAYMENT_CONFIRMED` significa pagamento processado **com saldo ainda não disponível**; `PAYMENT_RECEIVED` significa valor disponível na conta.
- **Cobrança ≠ nota fiscal.** Emitir cobrança não emite documento fiscal, e vice-versa.

---

## 3. Configuração: provedor não se amarra a produto `[PROPOSTO]`

Direção do usuário: Stripe como padrão para assinaturas SaaS; Asaas como padrão para cobranças gerais no Brasil (Pix, boleto, serviços). **Direção não é regra rígida** — um produto pode precisar dos dois, e um provedor pode atender vários produtos.

Por isso a configuração de cobrança é uma entidade própria, com estas dimensões:

| Dimensão | Por que existe |
|---|---|
| Entidade jurídica recebedora | Quem emite e recebe. Pode haver mais de um CNPJ |
| Conta do provedor | Uma entidade pode ter várias contas |
| Ambiente (teste/produção) | Nunca inferido; sempre explícito e armazenado |
| Produto | Contexto do que está sendo cobrado |
| Oferta e versão do preço | Preço muda; contrato antigo mantém a versão que assinou |
| Contrato | O acordo específico |
| Modalidade | Pix, boleto, cartão, assinatura, à vista, parcelado |
| Moeda | Explícita sempre |
| Referências externas | `stripe_customer_id`, `asaas_payment_id` etc., com o provedor identificado |

Ver [ADR 0003](decisions/0003-configuracao-de-cobranca-por-conta-e-oferta.md).

**Ambiente é dimensão de primeira classe.** Chave de sandbox com URL de produção (ou o inverso) é erro comum — no Asaas a chave começa com `$aact_hmlg_` em sandbox e `$aact_prod_` em produção, e a URL base tem de casar.

---

## 4. Capacidades dos provedores

Pesquisa na documentação oficial em 2026-08-30. **Vale para a documentação, não para a conta da TZOLKIN** — recurso disponível varia por conta e aprovação (🟡 HIPÓTESE em [CONTEXT.md §6](CONTEXT.md#6-hipóteses-ainda-não-validadas)). Confirmar no painel antes de desenhar em cima.

### Stripe

| Aspecto | O que a documentação diz |
|---|---|
| Idempotência | Header `Idempotency-Key` em todo `POST`. Sugerem UUID v4. Chaves podem ser removidas **após 24 horas**; reutilizar depois disso gera nova requisição. Parâmetros diferentes com a mesma chave dão erro. `GET`/`DELETE` não usam |
| Assinatura de webhook | Header `Stripe-Signature` com `t=` e `v1=`, HMAC-SHA256 sobre `timestamp + "." + corpo bruto`. **Corpo bruto, sem reserialização.** Tolerância padrão das bibliotecas: 5 minutos. Ignorar esquemas que não sejam `v1`. Nunca usar tolerância `0` |
| Defesa adicional | Além da assinatura, restringir por lista de IPs da Stripe |
| Ordem dos eventos | **Não há garantia de ordem.** Eventos distintos podem compartilhar o mesmo `created` (segundos) — não usar `created` para ordenar nem para saber se já processou |
| Duplicatas | Registrar os `event.id` processados. Em alguns casos dois Events são gerados: distinguir por `data.object.id` + `event.type` |
| Retentativa | Até **3 dias** com backoff exponencial em produção; poucas horas em sandbox. Reenvio manual: 15 dias pelo Dashboard, 30 pela CLI |
| Resposta | Devolver `2xx` **rápido**, antes da lógica pesada. Processar em fila assíncrona |
| Rota de webhook | Isentar de proteção CSRF (é chamada de servidor, não do navegador) |
| Checkout | **Webhook é obrigatório para fulfillment.** Não dá para depender do redirecionamento: o cliente pode pagar e perder a conexão antes da página de retorno. Ouvir `checkout.session.completed` e, para métodos de notificação postergada, `checkout.session.async_payment_succeeded` (e `async_payment_failed`). Verificar `payment_status` e tornar a função de fulfillment idempotente |

### Asaas

| Aspecto | O que a documentação diz |
|---|---|
| Autenticação da API | Header `access_token` (**não** `Authorization: Bearer`). Sandbox `https://api-sandbox.asaas.com/v3`, produção `https://api.asaas.com/v3` |
| Autenticação do webhook | Token configurável, enviado em `asaas-access-token`. **Nunca usar a API Key como token de webhook.** Validar o header antes de processar |
| Entrega | **At least once**: o mesmo evento pode chegar mais de uma vez com o mesmo `id` (`evt_…`). Persistir o `id` e deduplicar |
| Ordem | Configurável na criação do webhook: `SEQUENTIALLY` preserva ordem, mas **um evento lento ou com falha bloqueia toda a fila**; `NON_SEQUENTIALLY` tem vazão maior e não garante ordem |
| Falhas | Após **15 falhas consecutivas** a fila é interrompida: novos eventos continuam a ser gerados, mas param de ser enviados até reativação. Eventos ficam disponíveis por até **14 dias**; depois são apagados |
| Eventos de cobrança | Ciclo: `PAYMENT_CREATED` → `PAYMENT_CONFIRMED` (processado, **sem saldo disponível**) → `PAYMENT_RECEIVED` (**disponível**). Também `PAYMENT_OVERDUE`, `PAYMENT_UPDATED`, `PAYMENT_DELETED`, `PAYMENT_RESTORED`, `PAYMENT_REFUNDED`, `PAYMENT_PARTIALLY_REFUNDED`, `PAYMENT_CHARGEBACK_REQUESTED`, `PAYMENT_CHARGEBACK_DISPUTE`, `PAYMENT_AWAITING_CHARGEBACK_REVERSAL`, além de eventos de cartão, antecipação, negativação e split |
| Campos novos | A documentação avisa que atributos podem ser adicionados sem aviso: o consumidor **não pode quebrar** com campo desconhecido |

**Leitura conjunta:** os dois provedores entregam pelo menos uma vez, sem ordem garantida. Portanto deduplicação por id de evento e tolerância a evento fora de ordem **não são otimização** — são requisito.

---

## 5. Requisitos inegociáveis para qualquer implementação `[DECIDIDO]`

1. **Credenciais só no servidor.** Nunca no frontend, nunca em log, nunca em documentação — [SECURITY.md](SECURITY.md#5-segredos).
2. **Webhook autenticado**: assinatura (Stripe) ou `asaas-access-token` (Asaas), sempre antes de qualquer efeito.
3. **Idempotência na emissão**: chave estável derivada do que está sendo cobrado, não aleatória por tentativa.
4. **Deduplicação por id de evento**, persistida.
5. **Tolerância a evento fora de ordem**: nunca retroceder estado com evento antigo. Comparar por versão/estado, não por timestamp.
6. **Retentativa controlada**, com teto e backoff. Sem laço infinito.
7. **Histórico de processamento**: o que chegou, quando, o que virou, o que falhou.
8. **Conciliação periódica** com o provedor e com o extrato — [seção 6](#6-conciliação-proposto).
9. **Sem ponto flutuante.** Inteiro na menor unidade da moeda + código da moeda.
10. **Confirmação nunca vem só do retorno do checkout.** Só webhook confirmado, com estado verificado no provedor.
11. **Nunca cobrar por um segundo provedor** enquanto o primeiro estiver em estado desconhecido. Timeout não é falha: é desconhecido, e exige consulta antes de qualquer nova tentativa.
12. **Mudança financeira sensível exige autorização explícita e auditoria** com ator identificado.
13. **Nada de dado bruto de cartão.** Tokenização/checkout do provedor.
14. **Sandbox por padrão.** Cobrança real só com autorização específica do usuário para aquela operação.

---

## 6. Conciliação `[PROPOSTO]`

Três camadas, comparadas periodicamente. Divergência é registrada, não silenciada:

1. **Nosso registro** — o que achamos que cobramos e recebemos.
2. **Registro do provedor** — o que o provedor diz que aconteceu, incluindo taxas.
3. **Extrato bancário** — o que de fato entrou na conta (via Open Finance, [INTEGRATIONS.md](INTEGRATIONS.md#6-open-finance-proposto)).

Regras:

- **Transferência entre contas próprias não é receita nova.** Precisa ser identificada e excluída, ou os números inflam.
- Taxa do provedor é despesa, e entra separada do valor bruto.
- Liquidação é o evento que muda a tesouraria — não a confirmação do pagamento.
- Conciliação bate registros; **não** faz fechamento contábil.

---

## 7. Contabilidade

A **Contabilizei** continua responsável pela contabilidade fiscal. O Core é financeiro **operacional**: sabe o que foi cobrado, pago e liquidado; não apura tributo, não classifica plano de contas, não fecha exercício.

Divisão de responsabilidade a acordar antes de qualquer integração:

| Responsabilidade | Quem |
|---|---|
| Emitir cobrança e acompanhar pagamento | Core |
| Emitir documento fiscal | A definir — Contabilizei, prefeitura ou emissor |
| Classificar lançamento | Contabilizei |
| Conciliar banco × cobrança | Core (operacional) / Contabilizei (contábil) |
| Apurar tributo e fechar competência | Contabilizei |

Sobre integração programática: **não foi encontrada API pública oficial da Contabilizei** — ver [INTEGRATIONS.md](INTEGRATIONS.md#7-contabilizei). Presumir exportação assistida.

---

## 8. Primeiros passos, quando houver decisão `[PROPOSTO]`

Em ordem, e **em sandbox**:

1. Modelar entidade jurídica, conta de provedor e ambiente. Sem isso, tudo que vier depois amarra produto a provedor.
2. Modelar oferta e versão de preço, separadas de `entitlements.plan`.
3. Receber webhook de **um** provedor, em sandbox: autenticação, deduplicação, histórico. Sem emitir cobrança.
4. Emitir uma cobrança de teste com chave de idempotência e acompanhar até a liquidação simulada.
5. Conciliação manual assistida, comparando as três camadas.
6. Só então avaliar Open Finance e automação.

O fluxo 2 (consumidor → cliente) **não entra nessa ordem** enquanto [D3](CONTEXT.md#d3--quem-vende-e-quem-recebe-no-fluxo-consumidor--cliente) estiver aberta.
