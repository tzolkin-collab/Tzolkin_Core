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

## Respostas dos leads (webhook e caixa de entrada)

A Evolution avisa o Core de cada mensagem recebida; o Core guarda em `whatsapp_inbox` (migração `063_caixa_de_entrada_whatsapp.sql`) e mostra na aba **Conversas** do menu WhatsApp.

1. Aplicar a migração 063 (só adiciona).
2. Definir `EVOLUTION_WEBHOOK_SECRET` (uma string longa e aleatória). Sem ele o webhook responde 503.
3. Na Evolution, configurar o webhook da instância: URL `https://core.tzolkin.cloud/api/webhooks/evolution`, evento `MESSAGES_UPSERT` e o cabeçalho `x-webhook-secret` com o mesmo segredo (ou `Authorization: Bearer <segredo>`). Webhook por evento desligado (`webhookByEvents: false`).
4. Mandar uma mensagem de um celular para o número da instância e conferir que a conversa aparece.

O que o webhook faz e não faz:
- Guarda só mensagem recebida de uma pessoa (nada de grupo, status, mensagem nossa nem de outra instância). Mídia não é baixada: vira "[mídia]" (ou a legenda).
- Liga a mensagem ao lead pelos 8 últimos dígitos do telefone; sem lead, a conversa existe do mesmo jeito.
- A mesma mensagem reentregue não duplica (`provider_message_id` único).
- Quem responde só "sair", "parar", "pare", "stop", "cancelar", "descadastrar" ou "remover" entra na lista de supressão e o que estava na fila para o número é cancelado.
- Não responde ao lead, não cria lead e não dispara automação.

Responder pela aba Conversas **entra na fila de saída**, com o mesmo ritmo e o mesmo interruptor `WHATSAPP_ENVIO`. Número bloqueado não recebe resposta.

## Agentes de IA

A aba **WhatsApp → Agentes de IA** configura quem atende (migração `065`); o motor que executa vem na migração `066`. O fluxo de um turno:

1. O webhook guarda a mensagem do lead e, se a execução estiver ligada, marca um **turno** para daqui a 8 segundos (mensagens seguidas empurram o mesmo turno: o agente responde uma vez, depois que o lead parou de digitar).
2. O agente que atende é o primeiro **ligado** cuja instância e cujos funis batem com o lead. Número sem lead em funil não é atendido por agente.
3. O motor lê as últimas 20 mensagens, monta as instruções (instruções do agente, contexto, materiais, dados do lead e as regras fixas) e fala com o modelo da Anthropic. O modelo pode usar **só** as ferramentas que o agente tem e que o motor sabe executar; as ferramentas nunca recebem o lead, o número ou a instância do modelo, porque o turno já nasce preso a uma conversa.
4. A resposta (limpa de markdown, até 1000 caracteres) entra na fila de saída **pela instância da conversa**, com o mesmo ritmo e o mesmo interruptor `WHATSAPP_ENVIO` de qualquer mensagem.

**Para ligar** (nesta ordem): aplicar as migrações 064, 065 e 066 → preencher `ANTHROPIC_API_KEY` e definir `AGENTES_EXECUCAO=ligado` em Configurações → Integrações → Claude (agentes de IA) → criar o agente e ligá-lo → conferir em **Últimas execuções**. Sem a chave ou com `AGENTES_EXECUCAO` diferente de `ligado`, nada chama o modelo.

**Ferramentas que o motor executa hoje:** buscar lead e histórico, consultar a base de conhecimento (contexto e materiais do agente), registrar anotação, criar e concluir tarefa, corrigir nome e e-mail do lead, consultar contratos e pagamentos, enviar um template de e-mail do espaço e transferir para uma pessoa. **Em breve** (a configuração fica salva, mas o modelo não as recebe): mover de etapa, consultar e marcar horário na agenda, gerar link de pagamento. Capacidades: só texto; áudio, imagem, documento, ligação e retomar conversa parada dependem de voz, mídia e agendamento.

**Limites do motor:** no máximo 8 respostas por hora por conversa, 6 voltas com o modelo por turno, 3 tarefas e 1 e-mail por resposta, 3 tentativas por turno (a Anthropic fora do ar ou pedindo calma repete com espera crescente; chave recusada não repete).

**Passar para uma pessoa:** enquanto a conversa está com uma pessoa, nenhum agente responde. Ela passa sozinha quando alguém responde pela aba Conversas ou quando o agente usa a ferramenta de transferir (que avisa a equipe no WhatsApp). Na conversa, **Assumir conversa** e **Devolver ao agente** fazem isso à mão.
