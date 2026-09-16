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

## Linhas de serviço — cobrança nasce do contrato comercial `[DECIDIDO]` — 2026-09-14

Mentorias, Consultorias e Sites são `service_line`: o cliente contrata trabalho e mantém o que foi
entregue. Elas não ganham `checkout` nem contrato de acesso só para reutilizar o fluxo de SaaS.

Fluxo decidido na [ADR 0008](decisions/0008-origem-da-cobranca-de-servicos.md) (opção B). A **fase 1**
está implementada; ver abaixo o que cada fase cobre.

1. somente uma versão **aceita** de `commercial_contracts` pode gerar plano de recebimento. Não há
   entidade de proposta antes dele (a opção C pode entrar depois, sem quebrar este fluxo);
2. o contrato fixa escopo, valor, moeda, vencimentos e responsável. Aditivo ou renovação vira nova
   versão e não reescreve cobranças já emitidas;
3. cada vencimento origina uma cobrança no Asaas, ou um registro de cobrança externa no Cobre PJ;
4. webhook do provedor confirma **pago**, sem depender do retorno do checkout;
5. **disponível** só quando o crédito aparece no **extrato bancário**, pela conciliação via Pluggy.
   O saldo informado pelo processador (Asaas, Stripe) não conta como caixa;
6. a NFS-e é emitida **uma única vez, pela Contabilizei**. O Core registra a nota, não emite. Migrar a
   emissão para o Asaas depende de a Contabilizei confirmar que importa a nota sem duplicar;
7. atraso muda a operação financeira, mas não revoga automaticamente uma entrega ou acesso sem
   política contratual explícita.

Asaas é o caminho técnico principal para Brasil. Pix Automático se aplica somente a obrigação
periódica, como mentoria mensal; consultoria pontual usa Pix, boleto ou cartão. Stripe continua
adequada para cartão e exterior. Contabilizei permanece registro externo/manual enquanto não houver
API oficial confirmada. Ver [INTEGRATIONS.md §7](INTEGRATIONS.md#7-contabilizei-e-cobrança-de-serviços).

### Fase 1 — plano, parcelas e registro manual `[EXISTENTE E VERIFICADO]` — 2026-09-16

Migração `033_service_receivables.sql` e módulo `apps/api/src/modules/service-receivables.mjs`.
Nenhuma chamada a provedor.

- **Quem cobra por contrato:** a capacidade `contract_billing` (`catalog.mjs`), que só
  `service_line` tem. Produto e plataforma continuam cobrando por oferta e checkout.
- **Plano de recebimento** (`service_receivable_plans`): nasce de um contrato `active`, na versão
  que o operador viu, e guarda a fotografia dele (valor, moeda, vigência, aceite). Há um plano vivo
  por contrato; refazer é cancelar o anterior.
- **Parcelas** (`service_installments`): somam exatamente o valor do contrato, em inteiros. A tela
  gera parcelas mensais iguais, com o resto dos centavos na primeira; a API também aceita a lista
  explícita. Situações: `planned` (rascunho) → `scheduled` (aprovado) → `issued` (cobrança
  registrada) → `paid`; ou `canceled`. `available` existe no banco, mas nenhuma rota o grava nesta
  fase.
- **Prévia antes de gravar:** `POST /api/service-receivables/preview` calcula e valida sem gravar.
  `POST /plans` recalcula tudo no servidor.
- **O dono autoriza dinheiro:** aprovar, registrar cobrança, pagamento ou NFS-e, mudar vencimento
  e cancelar exigem papel `owner`. Membro monta e descarta rascunho.
- **Cobrança externa (Cobre PJ ou outra):** registrada com referência e link `https`. A mesma
  referência não quita duas parcelas.
- **Pagamento manual:** data que não pode estar no futuro (dia de Brasília). Pago não é disponível.
- **NFS-e:** o número e a data da nota emitida pela Contabilizei. Registro único por parcela.
- **Travas:** vencimento só muda antes da cobrança; parcela paga não é cancelada (estorno é outro
  registro); plano com parcela cobrada ou paga não é cancelado inteiro; reclassificar a linha de
  serviço com plano vivo é recusado.
- **Trilha:** cada ação grava antes e depois em `service_receivable_audit`, além de `audit_events`
  da empresa.
- **Tela:** contexto da linha de serviço → **Recebimentos**. Mostra contratos aceitos sem plano,
  montagem com prévia, planos com resumo (a cobrar, cobrada, paga, disponível, vencidas, NFS-e
  pendentes) e ações por parcela.
- **Rotas:** `GET /api/service-receivables?product_id=`, `POST /api/service-receivables/preview`,
  `POST /api/service-receivables/plans`, `POST /plans/:id/approve|cancel` e
  `POST /installments/:id/issue|reschedule|payment|cancel|invoice`.

### Fase 2 — emissão pelo Asaas `[PROPOSTO]`

Cria cobrança real; só com autorização específica. Uma chave de idempotência por tentativa;
estado desconhecido bloqueia nova tentativa automática; cancelamento e mudança de vencimento no
provedor; o webhook marca `paid` (`paid_source = 'webhook'`), reaproveitando a deduplicação de
`payment_webhook_events`. Pix Automático só para obrigação periódica, depois de confirmar
elegibilidade e tarifa.

### Fase 3 — disponível pela conciliação bancária `[PROPOSTO]`

`available` só com o crédito no extrato lido pela Pluggy. Precisa de regras próprias: tarifa
descontada pelo processador, repasse agrupado de várias cobranças (repasse não é segunda receita)
e se a Pluggy lê o Contabilizei.bank — pergunta em aberto.

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
