# WhatsApp no Core: gestão completa da Evolution, fluxos de mensagem e contextos

Desenho e backlog. Não há código novo aqui: este documento decide o que construir e em que ordem. Estado atual da integração: [WHATSAPP-EVOLUTION.md](WHATSAPP-EVOLUTION.md). Backlog anterior (E1 a E7): [WHATSAPP-EVOLUTION-BACKLOG.md](WHATSAPP-EVOLUTION-BACKLOG.md).

Marcador `🟡 HIPÓTESE` = afirmação ainda não validada contra a instância real (por exemplo, caminho exato de um endpoint da Evolution).

## 1. Objetivo

1. **Gerir a Evolution inteira pelo Core**: listar todas as instâncias do servidor, criar e parear, ver a saúde, conversar (texto e mídia) e administrar chats, sem abrir o painel da Evolution.
2. **Fluxos**: automações **diretas no WhatsApp**, como sequências de mensagens e envio de dados, com espera, condição e ramo.
3. **Automações**: o motor **geral do CRM**, interno e externo (lead, oportunidade, tarefa, WhatsApp, webhooks). É ele que dispara os fluxos e passa dados a eles.
4. **Contextos (espaços)**: cada instância, modelo de mensagem, regra, fluxo e automação pertence a um espaço (Sites, institucional, etc.), sem misturar dados.

## 2. Estado de hoje (verificado no código em 2026-10-26)

| Peça | Estado |
|---|---|
| Adaptador da Evolution | 3 chamadas: `fetchInstances`, `connectionState`, `sendText` ([evolution.mjs](../apps/api/src/integrations/evolution.mjs)) |
| Fila de saída | Pronta: ritmo (3 por ciclo, 4 s entre mensagens), retentativa, supressão, instância por mensagem |
| Entrada | Webhook só para `messages.upsert` de terceiros, individual; `@lid`, grupo, status e mensagem própria são descartados |
| Automações | `automations` com um gatilho e até 5 ações soltas; gatilhos só de lead e oportunidade; sem espera nem condição ([automations.mjs](../apps/api/src/platform/automations.mjs)) |
| Agentes de IA | Prontos no código: debounce de 8 s, 9 ferramentas, handoff para pessoa; ligados só com `AGENTES_EXECUCAO` e chave da Anthropic |
| Espera/agendador | Só em `ai_agent_jobs` (`run_after`); não existe para automações |
| Contexto na mensagem | `space_id` em automações e funis; a instância não pertence a um espaço |
| Editor visual | `fluxo.js` desenha funis em canvas (arrasta, zoom, painel lateral); serve de referência |

## 3. API da Evolution disponível

Servidor da Tzolkin: Evolution **2.3.7** (confirmado pela página de status do servidor). Documentação oficial: [docs.evolutionfoundation.com.br](https://docs.evolutionfoundation.com.br/evolution-api). A coluna "Na doc" diz se o endpoint consta na referência técnica oficial; o que está só no código do repositório fica marcado `🟡 HIPÓTESE` até conferir no servidor.

| Área | Na doc oficial | Só no código do repositório (🟡 HIPÓTESE) |
|---|---|---|
| Instância | `create`, `connect`, `connectionState`, `fetchInstances`, `restart`, `logout`, `delete`, `setPresence` | |
| Mensagens | `sendText`, `sendMedia`, `sendButtons`, `sendList`, `sendContact`, `sendLocation`, `sendPoll`, `sendReaction`, `sendTemplate`, `findMessages`, `markMessageAsRead` | `sendWhatsAppAudio`, `sendSticker`, `getBase64FromMediaMessage`, `updateMessage`, `deleteMessageForEveryone` |
| Chats | `findChats`, `findContacts`, `archiveChat`, `whatsappNumbers` (checar número) | `findChatByRemoteJid`, `markChatUnread`, `fetchProfilePictureUrl` |
| Webhook e eventos | `Get Webhook`, `Set Webhook`, `Set WebSocket` | lista exata de eventos: `MESSAGES_UPSERT`, `MESSAGES_UPDATE`, `CONNECTION_UPDATE`, `QRCODE_UPDATED` |
| Outros | grupos, etiquetas, settings, proxy, perfil, templates, catálogo, chamadas | privacidade, bloqueio |

Autenticação: cabeçalho `apikey` (a chave global lista e administra todas as instâncias; a chave de uma instância só enxerga a própria). A doc oficial não detalha o cabeçalho nem a lista de eventos: conferir no servidor antes da F1.

Não há SDK oficial. O painel oficial (`evolution-manager-v2`) e o `/manager` da própria Evolution servem de referência de telas; a licença de ambos aparece como "Other": ler o arquivo de licença antes de reaproveitar código.

## 4. Desenho

### 4.0 Fluxos × Automações (decisão do dono, 2026-10-26)

| | **Automações** | **Fluxos** |
|---|---|---|
| Escopo | Geral do CRM, **interno e externo** | Só WhatsApp (e o que ele envia) |
| Faz | Reage a um evento e executa ações: criar tarefa, atribuir, mover de etapa, e-mail, webhook, **iniciar um fluxo** | Executa uma sequência de mensagens e envio de dados, com espera, condição e ramo |
| Gatilho | Evento do CRM, de tarefa ou de WhatsApp | **Sempre uma automação** (ação "iniciar fluxo") ou um gatilho do próprio WhatsApp |
| Dados | Têm o contexto do evento (lead, organização, tarefa, oferta) | Recebem um **payload** da automação que os iniciou e o usam nas mensagens e condições |

Regras:
1. **Um fluxo só começa com uma automação** (ou resposta a uma conversa já aberta). A ação "iniciar fluxo" leva um payload com os dados que o fluxo precisa (por exemplo `{ lead, oferta, foco, origem }`). O payload fica em `flow_runs.input` e é visível no histórico.
2. **O fluxo devolve eventos às automações**: `fluxo.concluido`, `fluxo.respondeu`, `fluxo.sem_resposta`, `fluxo.erro`. Assim uma automação pode reagir ao que aconteceu no WhatsApp (criar tarefa, mover de etapa, avisar a equipe).
3. **Tarefas também são automatizáveis e disparam automações**: novos eventos `tarefa.criada`, `tarefa.concluida`, `tarefa.vencida`, e ação "criar tarefa" que pode ser encadeada.
4. **Encadeamento**: uma automação pode terminar em outra (via evento) com proteção contra ciclo (profundidade máxima e chave de idempotência por evento de origem).
5. **Externo**: ação "chamar webhook" (com assinatura e dados do contexto) e gatilho por webhook de entrada, para integrar sistemas de fora.
6. O que existe hoje continua valendo: as 5 ações atuais e os gatilhos de lead e oportunidade ficam; nada migra para dentro de fluxo.

### 4.1 Camadas

1. **Canal**: adaptador da Evolution. Só fala com o WhatsApp; não decide nada.
2. **Motor de automações e de fluxos**: automações (geral do CRM) disparam fluxos (sequências de WhatsApp); ver 4.0. Espera, condição e ramo ainda não existem.
3. **Contextos**: dono de tudo. Todo fluxo, instância, modelo e regra tem `space_id`.

### 4.2 Modelo de dados proposto (só adiciona)

- `whatsapp_instance_spaces(instance, space_id, is_default)`: qual número atende qual espaço.
- `message_templates(id, space_id, slug, channel, body, variables)`: modelos por espaço (WhatsApp e, depois, e-mail).
- `flows(id, space_id, name, trigger, definition jsonb, status draft|test|live, version)`.
- `flow_runs(id, flow_id, lead_id, automation_id, input jsonb, step, state jsonb, status, run_after, locked_at, attempts)`: uma linha por lead dentro de um fluxo; é o que torna a espera durável.
- `flow_run_events(run_id, step, result, at)`: histórico do que aconteceu.
- `whatsapp_events(instance, kind, payload, at)`: conexão, QR, status de entrega e leitura (para saúde e gatilhos).
- `space_whatsapp_settings(space_id, business_hours, hourly_cap, optout_text, default_flow)`.

`definition` guarda os passos como dados (JSON versionado), nunca código. O fluxo `live` é imutável: editar cria nova versão, e os `flow_runs` em curso terminam na versão em que começaram.

### 4.3 Catálogo

**Gatilhos de fluxo**: sempre a ação "iniciar fluxo" de uma automação (com payload), ou os de WhatsApp abaixo. **Gatilhos de automação** (os de lead e oportunidade já existem; entram `tarefa.criada`, `tarefa.concluida`, `tarefa.vencida`, `fluxo.*` e webhook de entrada): `whatsapp.mensagem_recebida`, `whatsapp.palavra_chave`, `whatsapp.entregue`, `whatsapp.lida`, `whatsapp.sem_resposta` (temporizador), `whatsapp.instancia_caiu`.

**Passos**: enviar mensagem (modelo ou texto), enviar mídia, esperar (duração ou "próxima janela de horário"), condição (respondeu, palavra-chave, etapa do funil, horário), ramo, criar tarefa, atribuir responsável, mover de etapa, passar ao agente de IA, passar a uma pessoa, enviar e-mail, chamar webhook, encerrar.

**Condições**: `respondeu`, `não respondeu em X`, `texto contém`, `etapa é`, `dentro do horário`, `tem consentimento`.

### 4.4 Execução

- Um ciclo (padrão da fila atual) pega `flow_runs` com `run_after <= now()` usando `FOR UPDATE SKIP LOCKED`.
- Cada passo roda em transação; envio de mensagem só **enfileira** em `whatsapp_outbox` (a fila já cuida de ritmo, supressão e instância). O fluxo nunca fala com a Evolution direto.
- Idempotência: chave `flow:{run}:{passo}` na fila, como `ia:{job}` e `auto:{automação}:…` hoje.
- Falha de um passo marca o run e registra o motivo; não derruba outros runs.
- Mensagem recebida: o webhook procura `flow_runs` aguardando resposta daquele número e retoma; se não houver, aplica gatilhos `mensagem_recebida` do espaço.
- Convivência com o agente: passo "passar ao agente" abre `ai_handoffs` ao contrário (agente ativo); pessoa que responde no Core pausa o fluxo.

### 4.5 Segurança e limites

A Evolution não é a API oficial: rajada e repetição derrubam o número.
- Teto por hora por instância e por espaço; pausa entre mensagens (já existe).
- **Horário de atendimento** por espaço; fora dele, a espera vai para a próxima janela.
- **Modo de teste** (`test`): o fluxo roda inteiro, grava o que enviaria e não envia nada.
- **Consentimento**: o formulário do Sites hoje manda `contact_allowed: false`. Regra explícita por espaço sobre se o fluxo ativo roda sem aceite; o padrão é não rodar. Decisão do dono, ver seção 7.
- **Primeiro envio de um fluxo novo exige confirmação** de quem o publica.
- "sair" e variações encerram o fluxo do número (já suprime hoje).
- Nada de envio em massa nesta fase.

## 5. Épicos, em ordem

| Id | Épico | Entrega | Pronto quando |
|---|---|---|---|
| F1 | Adaptador completo | Instância, mensagens (texto e mídia) e chats no adaptador, com testes e stub; sem tela | Cada chamada coberta por teste; caminhos conferidos no servidor 2.3.7 |
| F2 | Instâncias, pareamento e saúde | Tela: **listar todas as instâncias** do servidor (nome, número, estado, não lidas), criar, parear (QR/código), reiniciar, sair, apagar; webhook gerenciado pelo Core; "última mensagem há X"; fila parada | Ver e administrar todas as instâncias sem abrir a Evolution |
| F3 | Eventos | `CONNECTION_UPDATE`, `QRCODE_UPDATED`, `MESSAGES_UPDATE` (entregue e lida), mensagens próprias enviadas pelo celular, contato `@lid` | Nada é descartado sem registro; status de entrega aparece na conversa |
| F4 | Chat completo | Histórico (`findMessages`), mídia, foto de perfil, arquivar, não lida, apagar | Atender inteiramente dentro do Core |
| F5 | Contextos | Instância por espaço, modelos de mensagem, horário, teto e regras por espaço | Dois espaços usam números e regras diferentes sem cruzar dados |
| F6 | Automações do CRM ampliadas | Gatilhos de tarefa (`criada`, `concluida`, `vencida`), ação "iniciar fluxo" com payload, "chamar webhook", encadeamento com proteção contra ciclo, agendador (espera) para automações | Uma automação dispara outra e uma tarefa concluída dispara uma automação, sem duplicar |
| F7 | Base de fluxos | `flows`, `flow_runs` (com `input`), scheduler, passos de envio, espera e encerramento, eventos de volta às automações; configuração por formulário | Fluxo de teste iniciado por automação roda ponta a ponta, sobrevive a reinício e não duplica envio |
| F8 | Condições e gatilhos de WhatsApp | Condição, ramo, `mensagem_recebida`, `palavra_chave`, `sem_resposta`, `entregue`, `lida` | Exemplo da seção 6 roda no modo de teste |
| F9 | Editor de fluxo | Canvas reaproveitando `fluxo.js`, painel lateral, validação, versões, modo de teste e publicação com confirmação | Criar, testar e publicar sem tocar em JSON |

Ordem de canal e fluxo: F1 → F2 → F3 → F5 → F6 → F7 → F8 → F9, com F4 em paralelo depois da F3. **Os épicos de resultado (5A) entram nessa ordem**: R1 depois da F3, R2 antes da F7. F2 e F5 são pré-requisito de ligar qualquer fluxo em produção. Fluxo por **formulário primeiro** (F7/F8) e editor visual só na F9 (decisão do dono).

## 5A. Orientação a resultado

**Falha do desenho original:** os épicos F1 a F9 entregam canal, fluxo e contexto, e nenhum mede resultado. Hoje a tela de WhatsApp conta só mensagens não lidas, status da fila e números bloqueados. Regra daqui para frente: **toda peça de WhatsApp declara que resultado de negócio ela move e como o Core sabe se moveu.**

### Cadeia de resultado de um lead

`lead criado → primeira resposta nossa (tempo) → lead respondeu → conversa qualificada → oportunidade criada → ganha (valor) | perdida (motivo)`

O Core já tem os elos fora do WhatsApp: etapas `WON`/`LOST` e `estimated_value_minor` no funil, motivos de perda (`lost_reasons`), atribuição de anúncio (`commercial_attributions`: UTM, campanha, `fbc`, `fbp`) e o módulo de marketing da Meta. Falta ligar a **conversa** a essa cadeia e medir cada passo.

### O que medir (cada número fatiado por espaço, funil, instância, fluxo, passo, agente de IA, campanha e responsável)

| Pergunta | Métrica |
|---|---|
| Respondemos rápido? | Tempo até a primeira resposta; leads sem resposta além do SLA do espaço |
| O lead engaja? | Taxa de entrega, de leitura e de resposta; conversas abertas sem resposta há X horas |
| O fluxo funciona? | Conversão por passo e por fluxo; fluxos que atingiram o objetivo, expiraram ou falharam |
| O agente de IA ajuda? | Conversas resolvidas sem pessoa, transferidas, tokens e custo por conversa |
| A campanha dá retorno? | Campanha → conversa → oportunidade → ganho; custo por conversa e por ganho; receita atribuída |
| O que perdemos? | Perdas por motivo e por etapa em que a conversa esfriou |

### Objetivo por fluxo e por agente

Todo fluxo e todo agente tem um **objetivo** com evento de sucesso e prazo (por exemplo `respondeu`, `reuniao_marcada`, `oportunidade_criada`, `ganha`). Cada execução termina como **atingiu**, **não atingiu** ou **expirou**, e isso vira evento para as automações (`fluxo.objetivo_atingido`, `fluxo.objetivo_expirou`).

### Fechar o ciclo com os anúncios

O Core guarda `fbc`, `fbp` e `event_id` de cada lead. Quando o lead avança (qualificado, ganho, com valor), o Core pode enviar a **conversão à Meta** (API de conversões), para a campanha otimizar por quem de fato compra e não só por quem preenche o formulário. Respeita o consentimento registrado na sessão do lead.

### Alertas

Lead sem resposta além do SLA, instância desconectada, conversa esfriando em etapa avançada e fluxo com conversão abaixo do esperado criam tarefa e avisam a equipe (pela automação, não por regra fixa).

### Épicos de resultado

| Id | Épico | Entrega | Pronto quando |
|---|---|---|---|
| R1 | Marcos e vínculo | Registrar os marcos da conversa (primeira resposta nossa, primeira do lead, entregue, lida) e ligar conversa, lead, oportunidade e campanha | Dá para responder "quanto tempo levamos para responder este lead" e "de qual campanha veio esta conversa" |
| R2 | Painel de resultados | Tela por espaço, instância, fluxo, agente e campanha com as métricas da tabela acima e a cadeia lead → ganho | O dono vê, sem abrir o banco, o que o WhatsApp rendeu na semana |
| R3 | Objetivo e desfecho | Objetivo com prazo em fluxo e agente, desfecho por execução e eventos para as automações | Cada fluxo mostra quantos atingiram o objetivo |
| R4 | Retorno à Meta e custo por resultado | Conversões enviadas à Meta e custo por conversa e por ganho, usando o gasto que o módulo de marketing já lê | Uma campanha mostra custo por ganho e a conversão chega à Meta com `event_id` |
| R5 | Alertas de SLA | Gatilhos de SLA vencido, instância caída e conversa esfriando, como eventos de automação | Lead parado gera tarefa sozinho |

**Posição na ordem:** R1 entra logo depois da F3 (precisa dos eventos de entrega e leitura). A F2 já deve mostrar um **resultado básico** ao lado da saúde (respostas recebidas e tempo médio até a primeira resposta). R2 vem antes da F7: não se constrói fluxo sem poder medir se ele funciona. R3 e R5 acompanham a F7 e a F8. R4 depende de R1 e do consentimento.

## 6. Exemplo de aceite (funil `corretor`, espaço `sites`)

Automação `lead.criado` no espaço `sites`, funil `corretor`: avisa a equipe, cria tarefa "Retornar em 1 h" e executa a ação **iniciar fluxo "boas-vindas corretor"** com o payload `{ lead, oferta, foco, origem }`.

| Passo do fluxo | Comportamento |
|---|---|
| 1. Mensagem inicial | Modelo do espaço, usando `foco` e `oferta` do payload |
| 2. Espera 10 min, dentro do horário | Sem resposta: o agente de IA assume |
| 3. Lead escreve "preço" | Envia o modelo "Pacote Lançamento" e emite `fluxo.respondeu` |
| 4. 24 h sem resposta | Um lembrete, uma vez, e emite `fluxo.sem_resposta` |
| 5. Lead escreve "sair" | Supressão e fluxo encerrado |
| Pessoa responde pelo Core | Fluxo e agente pausam |

Automações que reagem ao fluxo: `fluxo.respondeu` move o lead de etapa e conclui a tarefa; `fluxo.sem_resposta` cria tarefa "Ligar para o lead". A tarefa concluída pode, por sua vez, disparar outra automação.

## 7. Decisões

Respondidas pelo dono em 2026-10-26:
1. **Fluxos e automações são coisas diferentes** (ver 4.0): fluxos são sequências de WhatsApp com gatilho vindo de automação e passagem de dados; automações são o motor geral do CRM, interno e externo, e tarefas também as disparam.
2. **Fluxo por formulário primeiro**, editor visual depois (F9).
3. **Consentimento: dono não sabe se precisa.** Padrão adotado até decisão: fluxo ativo **não roda** para lead com `contact_allowed: false`, exceto quando o próprio lead iniciou a conversa pelo WhatsApp. É a opção segura contra banimento e contra reclamação; pode ser relaxada por espaço depois. Vale confirmar com orientação jurídica (LGPD) antes de rodar fluxos ativos em campanha.
4. **Servidor**: Evolution 2.3.7 em `evolutionapi.landcriativa.com`; documentação oficial em `docs.evolutionfoundation.com.br`.
5. **Instâncias**: o Core deve **listar todas as instâncias** do servidor (F2). Isso exige a chave global da Evolution guardada no Core.

Ainda abertas:
- Quem pode criar e apagar instâncias (só o dono, ou também membros).
- Se a chave global fica na tela de Integrações (cifrada, como as demais) ou só em variável de ambiente.

## 8. Fora do escopo desta fase

Envio em massa, campanhas, WhatsApp Business oficial (Meta Cloud API), chamadas, grupos, e agente de voz. Os passos de grupo e etiqueta da Evolution ficam para depois dos épicos acima.

## 9. Estado da entrega (2026-10-26)

| Épico | Estado |
|---|---|
| F1 Adaptador completo | **Feito.** Corpos conferidos na Evolution 2.3.7 real; achados: `setWebhook` exige o corpo aninhado em `webhook`, `findMessages` pagina por `page`/`offset` e o horário vem de `messageTimestamp`. |
| F2 Instâncias e saúde | **Metade feita:** aba Visão geral (todas as instâncias, estado, webhook, última mensagem, fila, resultado básico). Falta criar, parear por QR, reiniciar e apagar pela tela. |
| F4 Chat | **Feito em versão 1:** conversas e histórico direto da Evolution (sem webhook), paginado, com atualização a cada 20 s. Falta enviar e receber mídia, arquivar e marcar como lida. |
| F6 Automações ampliadas | **Parcial:** ação "Iniciar fluxo de WhatsApp" (com dados), eventos `fluxo.respondeu` e `fluxo.sem_resposta`. Faltam gatilhos de tarefa, webhook externo e encadeamento com proteção de ciclo. |
| F7 Base de fluxos | **Feito em versão 1 (migração 070):** passos de mensagem e espera, espera durável, parar quando a pessoa responde (banco ou Evolution), janela final de 24 h, modo de teste, início manual para um número, execuções com log, formulário na aba Fluxos. |
| F8 Condições e gatilhos de WhatsApp | Não começou (condição, ramo, palavra-chave, `sem_resposta` por tempo). |
| F9 Editor visual | Não começou (hoje o fluxo é por formulário, como decidido). |
| F3, F5, R1 a R5 | Não começaram. |

A migração 070 **não está aplicada em produção**: sem ela a aba Fluxos avisa e a ação "Iniciar fluxo" falha com mensagem clara. Fluxo ativo envia pela fila de WhatsApp, então só envia de verdade com `WHATSAPP_ENVIO` ligado.

## 10. Decisões tomadas olhando os concorrentes (2026-10-26)

Referências: Kommo, Respond.io e Intercom Fin. O que adotamos e onde está no código:

| Padrão do mercado | Decisão no Core |
|---|---|
| Kommo: a conversa nova vira lead na etapa de entrada do funil | **Instância conectada a um funil** (migração 071, `whatsapp_instance_funnels`). A captura consulta a Evolution (funciona sem webhook), cria o lead pelo mesmo `aceitarLead` do formulário e agenda o turno do agente. Só vale para conversa nova; histórico antigo não é importado. |
| Kommo: gatilho na etapa do funil inicia o robô | **Gatilho dentro do fluxo** (`whatsapp_flows.automation_id`): o fluxo cria e mantém uma automação oculta "Fluxo: nome", que o inicia levando os dados do lead. Automação continua sendo a camada geral do CRM. |
| Respond.io: etapas de espera, ramo e atribuição | Passos de mensagem e espera hoje; condição e ramo ficam para a F8. |
| Fin: resposta humana encerra a IA; passagem com contexto | Já valia: assumir a conversa pausa o agente (`assumir`/`devolver`); fluxo para quando a pessoa responde. |
| Todos: testar antes de ligar | Fluxo em modo **teste** roda inteiro sem enviar (cada espera vale 1 minuto). O MCP orienta a começar por ele. |
| Todos: IA e fluxo no mesmo lugar | Abas: Visão geral, Conversas, **Automação** (Fluxos e Agentes de IA juntos), Atividade. |
| Modelo grátis para testar | Provedor **Gemini** (chave do AI Studio em Integrações); agente com modelo `gemini-...` usa essa chave. Limites do plano grátis (429) são esperados. |
| Tudo acessível por API | **7 ferramentas MCP**: `whatsapp_instancias`, `whatsapp_conectar_instancia_funil`, `whatsapp_listar_fluxos`, `whatsapp_salvar_fluxo`, `whatsapp_iniciar_fluxo`, `whatsapp_listar_agentes`, `whatsapp_salvar_agente`. Usam as mesmas funções da tela. |

Estado: a migração 071 **não está aplicada em produção**. Sem ela, a conexão instância↔funil e o gatilho do fluxo avisam com mensagem clara em vez de falhar.
