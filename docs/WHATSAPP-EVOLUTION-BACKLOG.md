# WhatsApp (Evolution API) no Core: backlog

**Objetivo:** o Core assume todo o WhatsApp da Tzolkin. Lead entra pelo intake, a equipe é avisada e o lead recebe resposta; o que o lead responder cai numa caixa de entrada no Core. O bot em Go (`services/whatsapp-bot`) está aposentado e não será publicado.

**Decisões já tomadas:** v1 manda aviso à equipe e resposta ao lead; respostas entram no Core pelo webhook da Evolution; o padrão técnico é o mesmo do e-mail (outbox transacional + fila + automações).

**Fora da v1:** envio em massa, campanhas, mídia (imagem, áudio, documento), atendimento por bot/IA, várias instâncias.

## Épicos, em ordem

| # | Épico | Entrega | Valor | Depende de | Status |
|---|---|---|---|---|---|
| E1 | Conexão | Adaptador, credenciais, teste de conexão, estado nas integrações | Dá para configurar e testar a Evolution | — | **Pronto** (falta commit) |
| E2 | Saída | Fila de envio com retentativa e ritmo baixo; lista de quem pediu para não receber | Mensagem sai sem perda e sem risco de duplicar | E1, migração | A fazer |
| E3 | Automações | Ações "Enviar WhatsApp ao lead" e "Avisar a equipe no WhatsApp"; templates por espaço | Lead novo vira aviso e resposta sozinhos | E2 | A fazer |
| E4 | Atividade e saúde | Tela de envios (status e motivo), instância conectada, fila parada | Dá para acompanhar sem olhar o banco | E2 | A fazer |
| E5 | Entrada | Webhook `/webhooks/evolution` com segredo; mensagens ligadas ao lead pelo telefone | Resposta do lead não se perde | E1, migração | A fazer |
| E6 | Caixa de entrada | Tela de conversas por lead; marcar como lida; responder pelo Core | Equipe atende dentro do Core | E5 | A fazer |
| E7 | Entrada em produção | Publicar, variáveis no Easypanel, webhook apontado na Evolution, teste ponta a ponta | Funciona de verdade | E3, E5 | A fazer |

Ordem de entrega sugerida: **E2 → E3 → E4** (v1 de saída, acompanhável), depois **E5 → E6** (entrada), e **E7** no fim de cada bloco.

## Critérios de aceite por épico

- **E2:** a mesma mensagem nunca sai duas vezes (chave de idempotência); `unavailable` e `rate_limited` repetem, `rejected` e `unauthorized` não; quem respondeu "sair" não recebe mais; ritmo configurável.
- **E3:** lead criado pelo intake dispara aviso à equipe (`WHATSAPP_TEAM_NUMBERS`) e resposta ao lead com o nome e o interesse dele; automação desligável por espaço; nada é enviado se a Evolution não estiver conectada, e o motivo fica visível.
- **E4:** lista de envios com lead, texto, status, tentativas e motivo; indicador de conexão; botão para reenviar o que falhou.
- **E5:** webhook recusa chamada sem o segredo; só `messages.upsert` é gravada; mensagem repetida não duplica; telefone sem lead conhecido vira conversa sem lead, não é descartada.
- **E6:** conversa mostra o histórico do lead (enviadas e recebidas); contador de não lidas; resposta enviada entra na mesma fila de E2.
- **E7:** teste real com o número da equipe; documentação em `docs/WHATSAPP-EVOLUTION.md`.

## Riscos e decisões que precisam do dono

1. **Evolution é API não oficial.** Há risco de banimento do número, principalmente com envio frio. Mitigação: ritmo baixo, só responder a quem pediu contato, opt-out respeitado. Decisão: qual número será usado em produção?
2. **Servidor da Evolution.** Hoje aponta para `evolutionapi.landcriativa.com`, instância `teste`. Decisão: usar esse servidor mesmo ou subir uma Evolution própria da Tzolkin, com instância de nome definitivo.
3. **Chave exposta.** A chave de teste foi escrita em conversa; trocar antes de produção.
4. **Consentimento (LGPD).** O formulário precisa deixar claro que o contato será por WhatsApp. Decisão: ajustar o texto do formulário do site.
5. **Migração.** Nenhuma migração é aplicada sem ok explícito.

## Pendências de infra ligadas (fora deste backlog, mas bloqueiam o teste ponta a ponta)

- Envs do Worker do site: `EMAIL_FROM` sem aspas, `NEXT_PUBLIC_WHATSAPP_NUMBER=5531997599216`, redeploy e novo teste do formulário.
- Criar o espaço "institucional" e a chave de intake própria no Core.
- Token novo da Vercel e `VERCEL_TEAM_ID` no `.env` do Core; token da Cloudflare (DNS, leitura) para o adaptador.
