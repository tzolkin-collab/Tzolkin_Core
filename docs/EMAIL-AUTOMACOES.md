# Automações de e-mail

Status: **leads** (migração 051 aplicada) e **cobrança no Stripe** (migração 052 ainda não aplicada). Asaas e compra fora do checkout do Core: veja "O que falta".

## O que existe

```
evento do funil (lead criado, mudou de etapa, qualificado, descartado, restaurado)
   └─ automação com a ação "Enviar e-mail ao lead"  (Inbound → Automações)
        └─ renderiza o template do espaço com os dados do lead
             └─ grava em email_outbox, NA MESMA TRANSAÇÃO do evento      (platform/email-saida.mjs)
                  └─ o consumidor da fila envia pelo Resend, com retentativa   (modules/email-fila.mjs)
```

- **A automação não manda e-mail.** Ela enfileira, dentro da transação do evento: ou o lead e o e-mail existem juntos, ou nenhum dos dois. Se a automação falhar, o lead entra do mesmo jeito e a falha fica no histórico dela (`automation_runs`).
- **Uma vez só.** `idempotency_key = auto:<automação>:<evento>:<lead>:<template>` é única: o mesmo evento reentregue não enfileira de novo.
- **O que foi enviado fica gravado já renderizado** (assunto, texto e HTML): mudar o template depois não reescreve o passado.
- **Templates** são os de cada espaço (E-mails → Templates, no contexto do produto). Variáveis de e-mail de lead: `{{name}}`, `{{email}}`, `{{product_name}}`, `{{company_name}}`. Variável de outro tipo (`{{plan}}`, `{{due_date}}`) ou desconhecida é erro dito antes de enviar (na automação, na pré-visualização e no teste), nunca um "vazio" silencioso. O valor de uma variável é dado: no HTML é escapado, no assunto quebra de linha vira espaço.
- **Todo e-mail automático leva o rodapé** "Você recebeu este e-mail porque entrou em contato com … Para não receber mais, responda pedindo para sair".
- **Só vale em evento de lead**, e o template precisa existir no espaço da automação (checado ao salvar a automação, não só na hora de rodar).

## O consumidor da fila

| Regra | Valor |
|---|---|
| Ritmo | até 10 e-mails a cada 30 s (20 por minuto), um por vez |
| Reserva | `FOR UPDATE SKIP LOCKED` + `status='sending'`: dois consumidores nunca pegam o mesmo; reserva presa por mais de 5 min volta para a fila |
| Falha do provedor (5xx, rede) | tenta de novo depois de 1 min, 5 min, 30 min, 2 h; desiste na 5ª tentativa (`failed`) |
| Recusa do provedor (domínio não verificado, chave ruim) | `failed` na hora, com o motivo; **Reenviar** em E-mails → Atividade |
| Validade | e-mail automático que ficou mais de **48 h** na fila é cancelado (por exemplo, e-mail ainda não configurado) em vez de sair fora de contexto |
| Supressão | endereço em `email_suppressions` nunca recebe (**Não enviar mais a este endereço** em Atividade; tira também da fila) |
| Sem e-mail configurado | não envia nada; os e-mails esperam (até 48 h) |
| Onde roda | no processo do Core em produção. **Em desenvolvimento só com `AGENDA_JOBS=1`**, porque o `.env` local aponta para o banco compartilhado e um servidor local mandaria e-mail de verdade |

## Telas

- **E-mails → Atividade** (agora no menu): contagem dos últimos 30 dias, lista dos 50 mais recentes com situação, motivo da falha e as ações Reenviar e Não enviar mais a este endereço. Sem a 051, explica em vez de mostrar fila vazia.
- **Templates → Enviar teste para mim:** manda a versão salva, com dados de exemplo, SÓ para o e-mail de quem está logado (1 a cada 30 s).
- **Inbound → Automações:** ação "Enviar e-mail ao lead" com a escolha do template do espaço.
- **Configurações → Integrações → E-mail:** provedor, chave e remetente (ver `CONFIGURACOES.md`).

## Para ligar em produção

1. Aplicar a migração `051_fila_de_email.sql` (só adiciona duas tabelas).
2. Configurar o e-mail (Resend) e usar "Enviar e-mail de teste" em Integrações.
3. Criar um template do espaço, usar "Enviar teste para mim" e conferir a caixa de entrada (e o spam).
4. Criar a automação (Inbound → Automações → Quando: Lead criado → Então: Enviar e-mail ao lead). **Comece por um funil ou etapa específicos** e confira em Atividade antes de abrir para todos os leads.

## E-mail de cobrança (Stripe, checkout do Core) — migração 052 **ainda não aplicada**

```
checkout do Core cria a sessão no Stripe COM produto e oferta (metadata)         (modules/checkout-gateway.mjs)
   └─ webhook checkout.session.completed traz comprador + metadata
        └─ UMA linha em billing_purchases (ids do Stripe, e-mail e nome do comprador, produto, oferta)
             └─ se está pago e a oferta manda o Core enviar: renderiza e ENFILEIRA   (platform/email-cobranca.mjs)
   └─ eventos seguintes chegam só com ids do Stripe: acha-se a compra por eles
```

| Evento do Stripe | E-mail (evento da oferta) | Achado por |
|---|---|---|
| `checkout.session.completed` pago / `async_payment_succeeded` | `payment_confirmed` | sessão |
| `invoice.paid` de ciclo de assinatura | `renewal` (a 1ª fatura é a própria compra: não repete) | assinatura |
| `invoice.payment_failed` | `overdue` (com `{{due_date}}` = próxima tentativa) | assinatura |
| `charge.refunded` | `refunded` (valor ESTORNADO) | intenção de pagamento |
| `customer.subscription.deleted` | `canceled` | assinatura |

- **Quem envia.** Só quando a oferta tem `email_owner = core` **e** template definido para o evento. Se o responsável é o provedor (o Stripe manda o dele), nada é enfileirado: sem duplicidade. A compra é registrada nos dois casos (os eventos seguintes precisam dela).
- **Variáveis de cobrança:** `{{name}}`, `{{email}}`, `{{product_name}}`, `{{plan}}` (nome da oferta), `{{amount}}` (já formatado: R$ 49,00), `{{due_date}}` (só tem valor em falha de pagamento). `{{company_name}}` não existe aqui. A pré-visualização e o teste usam as variáveis do tipo do template (pelo evento dele); template com variável de outro tipo não vira e-mail: o motivo fica registrado e nada quebrado sai.
- **Não derruba o webhook.** O gancho roda num savepoint na transação do webhook: se falhar, só ele é desfeito e o webhook é registrado e respondido 200 do mesmo jeito (o Stripe reentregaria sem fim). Sem a 052 (ou a 051), ignora em silêncio.
- **Uma vez só.** Chave `cobranca:stripe:<evento>:<id do objeto>`; o Stripe já deduplica por evento, e a chave cobre o resto.
- **Rodapé** próprio: "Você recebeu este e-mail por causa da sua compra de …".
- **Dado pessoal.** `billing_purchases` guarda e-mail e nome de quem comprou, só para falar com a pessoa sobre a própria compra. Compra fora do checkout do Core não entra.

### Para ligar
1. Aplicar a 051 (fila) e a 052 (compras). 2. Em Produtos e planos → Cobrança e e-mails, na oferta: responsável pelos e-mails = **Core** e os templates dos eventos. 3. Criar os templates (evento certo em cada um) e usar **Enviar teste para mim**. 4. Fazer UMA compra de teste de ponta a ponta com o cartão de teste do Stripe (modo test) e conferir em E-mails → Atividade. **Só então** virar a chave para live.

## O que falta (decisões, não código)

- **Asaas** e **compra fora do checkout do Core**: sem a oferta ligada à cobrança, não há template. O Asaas só passa a entrar quando o Core criar as cobranças dele (fase 2 de `BILLING.md`) e gravar a oferta na `externalReference`.
- **`charge_created` e `due_reminder`**: avisar ANTES do vencimento exige agendador. `welcome` de compra: poderia sair do `payment_confirmed` da 1ª compra; não foi pedido.
- **Consentimento e descadastro de verdade** (link de sair, não só "responda pedindo"): vale para marketing; os e-mails de hoje são resposta a quem pediu contato ou sobre a própria compra.
- **Respostas e bounces** (inbound): o Core não lê caixa de entrada; um endereço que devolve erro só aparece como falha.
