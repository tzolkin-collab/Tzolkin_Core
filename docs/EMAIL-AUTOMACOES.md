# Automações de e-mail

Status: **construído para leads** (migração 051 **ainda não aplicada**). **E-mail de cobrança (pagamento, atraso…) NÃO está ligado**: veja "O que falta".

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

## O que falta (decisões, não código)

- **E-mail de cobrança** (pagamento confirmado, atraso, renovação…). Hoje o webhook só registra o estado da cobrança (`payment_charges`), e **nada liga uma cobrança a um cliente, uma oferta ou um e-mail**: o checkout não manda metadados e o webhook não guarda e-mail nem oferta. Para enviar, é preciso decidir e construir: (1) gravar no checkout qual oferta e quem comprou, (2) resolver o destinatário (Stripe traz o e-mail no evento; no Asaas é preciso consultar o cliente), (3) quem envia: o Core ou o próprio provedor (`email_owner` na oferta, hoje só intenção), para não duplicar, e (4) os eventos de cobrança entrarem na mesma fila. A fila e o consumidor já servem; é a origem dos dados que falta.
- **Consentimento e descadastro de verdade** (link de sair, não só "responda pedindo"): vale para mensagem de marketing; os e-mails de hoje são resposta a quem pediu contato.
- **Respostas e bounces** (inbound): o Core não lê caixa de entrada; um endereço que devolve erro só aparece como falha.
