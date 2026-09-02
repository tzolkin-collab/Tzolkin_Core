# Cobrança e comunicação por oferta

## Central de e-mails

A sidebar possui E-mails, com Automações (regras em rascunho), Templates (referências) e Atividade (estado não integrado). GET `/api/emails` exige admin e projeta apenas configurações de comunicação, sem valores financeiros nem credenciais. O botão Configurar abre a oferta; use Atualizar ao retornar para reler as alterações.

As chaves ficam exclusivamente no `.env` ignorado pelo Git: `ASAAS_API_KEY`, `ASAAS_WEBHOOK_TOKEN`, `STRIPE_SECRET_KEY`, `STRIPE_WEBHOOK_SECRET`. `ASAAS_ENVIRONMENT` inicia como sandbox. `STRIPE_SECRET_KEY`, `ASAAS_API_KEY` e `ASAAS_ENVIRONMENT` alimentam a leitura de vendas do Financeiro; segredos de webhook permanecem reservados. E-mail reserva `EMAIL_PROVIDER`, `EMAIL_API_KEY`, `EMAIL_FROM`, sem escolher um fornecedor implicitamente.

## Implementado — configuração em rascunho

Produtos e planos → Cobrança e e-mails permite cadastrar várias ofertas por produto (incluindo serviços cadastrados como produto). Cada oferta tem slug, preço em unidade mínima, moeda, processador, modalidade e referências de templates por evento. Asaas é sugerido para Brasil/parcelamento; Stripe para assinaturas. É possível ajustar explicitamente. Parcelamento Stripe não está modelado nesta primeira versão.

GET/PUT `/api/billing/offers` exigem sessão administrativa; PUT exige origem e transação. A versão previne sobrescrita concorrente. Histórico de ofertas é gravado na mesma transação. Sem credenciais no frontend.

Ao salvar contrato com Plano igual ao slug de uma oferta do mesmo produto, o Core copia suas condições para `contract_billing`, sempre draft. Regravar o contrato não altera a cópia. Trocar plano de um contrato vinculado exige uma futura operação explícita de revisão e é bloqueado agora. Contratos anteriores não são migrados ou cobrados automaticamente.

## Webhooks — registro, não emissão

`POST /api/webhooks/stripe` e `POST /api/webhooks/asaas` são as únicas rotas do Core alcançáveis sem sessão e sem header Origin, autenticadas pela assinatura/token do próprio provedor. Deduplicam por `(provider,event_id)`, conciliam `payment_charges` sem retroceder estado (fila `NON_SEQUENTIALLY`) e preservam a primeira data de estorno/contestação/cancelamento. Só registram — não emitem cobrança, não alteram contrato, não mandam e-mail. Leitura em `GET /api/payments/webhooks`, admin.

## Gateway de checkout — cria sessão, só fluxo 1

`checkout_templates` guarda aparência e modo de exibição (HOSTED/EMBEDDED/ELEMENTS — ELEMENTS ainda não cria sessão) por produto, separado de `billing_offers` de propósito: a oferta é o que se cobra, o template é como a página aparece. CRUD em `GET`/`PUT /api/checkout-templates`, mesma disciplina de versão de `billing_offers`.

`POST /api/checkout/sessions` é pública e é a única rota do Core que efetivamente cria uma sessão de pagamento — cruza de propósito a linha `configuration_only`/`read_only` do resto deste documento. Preço, moeda e nome nunca vêm do corpo da requisição: são lidos de `billing_offers` no servidor a partir de `product_id`+`offer_slug`. Limitada por IP (`createIpThrottle`, janela própria — o contador de bootstrap em `platform/session.mjs` não serve a uma rota exposta). Só ofertas com `provider:'stripe'`; Asaas não tem Checkout Session/Elements e fica para quando for desenhado, não fingido. A página pública fica em `/c/:productId/:offerSlug`, com CSP própria (permite `js.stripe.com`) que não vaza para o resto do Core, estrito por padrão.

**Só fluxo 1** (Tzolkin vende, Tzolkin recebe): conta única via `STRIPE_SECRET_KEY`, sem Connect, sem split. Fluxo 2 (consumidor paga o cliente, ex.: TZOLKIN Barber) depende de D3 — ver `docs/decisions/0003`.

## Ainda não implementado / não ativado

- Criação de cobrança Asaas (Pix, boleto, cartão tokenizado) — API diferente da Stripe, ainda não desenhada aqui.
- Split, repasse e conta conectada (fluxo 2) — bloqueado em D3.
- Parcelamento Stripe e métodos além de cartão (Pix/boleto via Stripe) na sessão de checkout.
- Fila transacional de envio de e-mail, worker com retries e idempotência, templates reais, inbound e acompanhamento de entregas.
- Snapshot de cobrança no painel do cliente e seleção visual de ofertas no formulário de contratos.
- Efeitos de pagamentos sobre acesso. Nenhum atraso/cancelamento suspende acesso nesta versão.

A escolha do responsável por e-mails e os slugs são intenções em rascunho, não configuram notificações nos provedores. Antes de ativar, verificar templates, domínio/remetente, consentimento quando aplicável e notificações nativas para evitar duplicidade.

Financeiro deve distinguir fonte (Pluggy), instituição bancária e processador (Asaas/Stripe). Recebíveis, taxas, estornos e repasses serão preservados como registros distintos com relações; repasse bancário não é uma segunda receita. Não somar moedas ou saldos pendentes e disponíveis indiscriminadamente.

Referências: https://docs.asaas.com/docs/guia-de-cobrancas ; https://docs.asaas.com/docs/notificacoes ; https://docs.stripe.com/webhooks ; https://docs.stripe.com/billing/subscriptions/webhooks
