# Cobrança e comunicação por oferta

## Central de e-mails

A sidebar possui E-mails, com Automações (regras em rascunho), Templates (referências) e Atividade (estado não integrado). GET `/api/emails` exige admin e projeta apenas configurações de comunicação, sem valores financeiros nem credenciais. O botão Configurar abre a oferta; use Atualizar ao retornar para reler as alterações.

As chaves ficam exclusivamente no `.env` ignorado pelo Git: `ASAAS_API_KEY`, `ASAAS_WEBHOOK_TOKEN`, `STRIPE_SECRET_KEY`, `STRIPE_WEBHOOK_SECRET`. `ASAAS_ENVIRONMENT` inicia como sandbox. E-mail reserva `EMAIL_PROVIDER`, `EMAIL_API_KEY`, `EMAIL_FROM`, sem escolher um fornecedor implicitamente. Esses campos não são consumidos por integração ativa nesta etapa.

## Implementado — configuração em rascunho

Produtos e planos → Cobrança e e-mails permite cadastrar várias ofertas por produto (incluindo serviços cadastrados como produto). Cada oferta tem slug, preço em unidade mínima, moeda, processador, modalidade e referências de templates por evento. Asaas é sugerido para Brasil/parcelamento; Stripe para assinaturas. É possível ajustar explicitamente. Parcelamento Stripe não está modelado nesta primeira versão.

GET/PUT `/api/billing/offers` exigem sessão administrativa; PUT exige origem e transação. A versão previne sobrescrita concorrente. Histórico de ofertas é gravado na mesma transação. Sem credenciais no frontend.

Ao salvar contrato com Plano igual ao slug de uma oferta do mesmo produto, o Core copia suas condições para `contract_billing`, sempre draft. Regravar o contrato não altera a cópia. Trocar plano de um contrato vinculado exige uma futura operação explícita de revisão e é bloqueado agora. Contratos anteriores não são migrados ou cobrados automaticamente.

## Ainda não implementado / não ativado

- Integrações diretas Asaas/Stripe, importação de pagamentos, clientes externos e criação de cobranças.
- Webhooks autenticados, deduplicação por provedor/conta/ambiente/evento e reconciliação de eventos fora de ordem.
- Fila transacional de envio, worker com retries e idempotência, templates reais, inbound e acompanhamento de entregas.
- Snapshot de cobrança no painel do cliente e seleção visual de ofertas no formulário de contratos.
- Efeitos de pagamentos sobre acesso. Nenhum atraso/cancelamento suspende acesso nesta versão.

A escolha do responsável por e-mails e os slugs são intenções em rascunho, não configuram notificações nos provedores. Antes de ativar, verificar templates, domínio/remetente, consentimento quando aplicável e notificações nativas para evitar duplicidade.

Financeiro deve distinguir fonte (Pluggy), instituição bancária e processador (Asaas/Stripe). Recebíveis, taxas, estornos e repasses serão preservados como registros distintos com relações; repasse bancário não é uma segunda receita. Não somar moedas ou saldos pendentes e disponíveis indiscriminadamente.

Referências: https://docs.asaas.com/docs/guia-de-cobrancas ; https://docs.asaas.com/docs/notificacoes ; https://docs.stripe.com/webhooks ; https://docs.stripe.com/billing/subscriptions/webhooks
