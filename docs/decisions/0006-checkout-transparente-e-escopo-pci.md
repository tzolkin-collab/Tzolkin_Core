# ADR-0006: Checkout transparente com Elements, e o escopo PCI que o cartão Asaas cria

**Status:** `[ACEITA]` para o checkout transparente · `[PENDENTE DE DECISÃO]` para cartão no Asaas
**Date:** 2026-09-05
**Deciders:** Tzolkin

## Contexto

O checkout do Core hoje é Stripe Checkout hospedado: o comprador sai da nossa
página para uma página da Stripe. Isso tem duas consequências caras. A primeira é
de produto — a aparência do pagamento não é nossa, e o "montador de checkout"
controla quatro campos (cor, logo, raio, fonte), sendo que a fonte nem é aplicada.
A segunda é de negócio — não há Pix nem boleto, porque `payment_method_types` é
`['card']` fixo em `stripe-checkout.mjs:45`, e a oferta Asaas é recusada antes de
virar sessão (`checkout-gateway.mjs:95`).

A decisão de ir para transparente muda onde o pagamento acontece, e é isso que
torna esta uma ADR e não um cartão de backlog: **transparente move dado de
pagamento para perto do nosso código**, e o quanto ele chega perto depende do
provedor.

## Decisão

### 1. Só Elements. `HOSTED` e `EMBEDDED` saem do produto. `[ACEITA]`

O pagamento acontece na página `/c/`, com Stripe Payment Element. `ELEMENTS` já é
um valor aceito e persistível hoje, recusado na criação da sessão
(`checkout-gateway.mjs:96`) — passa a ser o único.

**Custo de reverter:** alto. A migração `025` converte todos os templates
existentes, `POST /api/checkout/sessions` é removida, e todo link de pagamento em
circulação passa a depender do caminho novo. Reverter exige migração inversa e
redeploy coordenado, não um `git revert`.

### 2. Com Stripe, o cartão nunca toca o Core. `[ACEITA]`

O Payment Element roda em iframe da Stripe. O número do cartão vai do navegador
direto para a Stripe; o nosso servidor vê `client_secret` e `payment_intent`, nunca
PAN. **Isso mantém o Core em SAQ-A**, que é o que `docs/DATA-OWNERSHIP.md` assume
e o que `docs/PRODUCT.md:91` promete.

### 3. Com Asaas, Pix e boleto são transparentes sem custo de escopo. `[ACEITA]`

Nenhum dado de cartão existe nesses fluxos. `POST /v3/payments` com
`billingType PIX|BOLETO`, QR e linha digitável renderizados na nossa página. O
webhook é a verdade; o polling é conforto de tela.

### 4. Cartão no Asaas leva o Core a PCI SAQ-D. `[PENDENTE DE DECISÃO]`

O Asaas **não tem chave publicável nem SDK de navegador**. Tokenizar exige
`POST /v3/creditCard/tokenize` a partir do servidor, com o PAN no corpo. Não
existe arranjo que evite isso e ainda ofereça cartão pelo Asaas.

O usuário pediu que a opção exista no montador, ciente da consequência. A decisão
de **ligar** fica pendente porque o custo não é de código:

- avaliação SAQ-D anual;
- varredura ASV trimestral por fornecedor aprovado;
- WAF ou revisão de código formal da página de pagamento;
- gestão de chaves, retenção e proteção de log;
- plano escrito de resposta a incidente.

**Enquanto pendente:** `ASAAS_CARD_ENABLED=false` no ambiente, e a opção não
aparece no montador. O código pode existir; o escopo, não.

**Custo de reverter:** o mais alto de todos, e assimétrico. Desligar a flag é
trivial. Sair do escopo depois de ter processado cartão não é: os registros, os
logs e as obrigações do período permanecem.

## Mitigações que valem independentemente da decisão 4

1. **Rota dedicada.** `POST /api/checkout/card-token` é a única que aceita dado de
   cartão. `POST /api/checkout/intents` recusa por construção: `input(body,keys)`
   (`platform/http.mjs:12`) rejeita chave desconhecida, então um corpo com
   `number` vira 400, não vazamento silencioso.
2. **`checkout_orders` não tem coluna de cartão.** Nem PAN, nem last4, nem
   bandeira. `method` basta para operar.
3. **PAN não persiste e não é logado.** Vida no processo: uma requisição.
4. **Balde de throttle próprio e apertado** nessa rota — teste de cartão roubado
   é o ataque esperado contra ela.

## Alternativas descartadas

| Alternativa | Por que não |
|---|---|
| Manter Stripe Checkout hospedado | Não resolve o pedido: a aparência continua sendo da Stripe e o montador continua decorativo. |
| Stripe Embedded Checkout | Ainda é a UI da Stripe dentro de um iframe; o tema é configurado no dashboard deles, não no nosso editor. Foi o que a referência RDS fez, e por isso o design lá só existia no modo Elements. |
| Cartão Asaas por iframe/campos hospedados | Não existe. Verificado: o Asaas não publica SDK de navegador nem chave publicável. |
| Rotear todo cartão pela Stripe e usar Asaas só para Pix/boleto | Tecnicamente limpo e mantém SAQ-A. Descartado **por ora** a pedido do usuário, que quer a escolha exposta no montador. Continua sendo o caminho recomendado se o SAQ-D não tiver dono. |
| Tokenizar no navegador chamando o Asaas direto | Exigiria a API key do Asaas no cliente. É pior: vaza a credencial e mantém o escopo. |

## Pendências

1. [ ] Dono nomeado e calendário do SAQ-D, antes de qualquer linha da etapa 7.
2. [ ] Decidir o tratamento do CPF em `checkout_orders`: guardar, hashear com
       pepper mantendo 3 dígitos, ou descartar após enviar ao provedor.
3. [ ] Confirmar que Pix e boleto estão ativados na conta Stripe antes de
       oferecê-los no editor — ambos são BRL e exigem habilitação.
