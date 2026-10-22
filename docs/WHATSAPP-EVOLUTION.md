# WhatsApp pela Evolution API

O Core manda WhatsApp pelas automações do funil, com o mesmo desenho do e-mail ([EMAIL-AUTOMACOES.md](EMAIL-AUTOMACOES.md)): a automação **não envia**, ela grava uma linha na fila (`whatsapp_outbox`) na mesma transação do evento, e um consumidor envia depois, em ritmo baixo. Backlog e decisões: [WHATSAPP-EVOLUTION-BACKLOG.md](WHATSAPP-EVOLUTION-BACKLOG.md).

## Variáveis (ou Configurações → Integrações → WhatsApp)

| Variável | Para quê |
|---|---|
| `EVOLUTION_URL` | Endereço https da Evolution |
| `EVOLUTION_INSTANCE` | Nome da instância já pareada (estado `open`) |
| `EVOLUTION_API_KEY` | Chave de acesso (secreta) |
| `WHATSAPP_TEAM_NUMBERS` | Números da equipe que recebem o aviso de lead novo, separados por vírgula |
| `WHATSAPP_ENVIO` | `ligado` para a fila enviar. Qualquer outro valor: nada sai, as mensagens só acumulam |

## Ligar, na ordem

1. Aplicar a migração `062_fila_de_whatsapp.sql` (só adiciona; sem ela a tela e as ações dizem que falta aplicá-la).
2. Preencher as três variáveis da Evolution e testar a conexão (Configurações → Integrações → WhatsApp → Testar).
3. Criar a automação no funil (Inbound → Automações): ação **Enviar WhatsApp ao lead** ou **Avisar a equipe no WhatsApp**. A mensagem aceita `{{name}}`, `{{first_name}}`, `{{email}}`, `{{whatsapp}}`, `{{company_name}}`, `{{product_name}}`.
4. Conferir na tela **WhatsApp** (menu CRM) que a mensagem aparece "Na fila" e que a Evolution está "Conectada".
5. Só então definir `WHATSAPP_ENVIO=ligado`.

## Como a fila se comporta

- 3 mensagens por ciclo de 30 s, com 4 s entre uma e outra. A Evolution não é a API oficial: rajada derruba o número.
- Instância desconectada: nada é pego nem gasta tentativa; a mensagem espera (e expira em 48 h).
- `unavailable` e `rate_limited` repetem (1 min, 5 min, 30 min, 2 h; até 5 tentativas). `rejected`, `unauthorized` e `not_found` falham de vez, com o motivo na tela e o botão Reenviar.
- Número que a Evolution recusa entra sozinho na lista de supressão (`whatsapp_suppressions`); a tela também permite bloquear um número à mão.
- O mesmo evento reentregue não enfileira duas vezes (`idempotency_key`).

## Ainda não existe

Recebimento das respostas do lead (webhook da Evolution) e caixa de entrada: épicos E5 e E6 do backlog.
