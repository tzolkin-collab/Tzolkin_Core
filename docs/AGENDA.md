# Agenda (Acompanhamento)

Calendário no estilo do Google Calendar sobre as atividades de serviço (`service_activities`). Fase 0 pronta; integrações com
calendários externos (Fases 1 a 3) ainda não existem.

## O que a tela faz

- **Visões:** Dia, Semana (padrão no desktop), Mês e Agenda (lista). No celular abre em Dia. A última visão fica no navegador
  (`localStorage`, chave `tzolkin-agenda-visao`).
- **Navegação:** Hoje, setas, mini-calendário, e atalhos `t` `d` `w` `m` `a` `c` `←` `→` (não valem digitando nem com painel aberto).
- **Grade de horas** (Dia e Semana): evento posicionado e dimensionado pela duração, linha do horário atual, faixa "dia todo" para
  prazos de um dia ou mais, evento que atravessa a meia-noite aparece nos dois dias.
- **Sobreposição como no Google:** dois eventos que começam em horas diferentes (30 min ou mais) ficam em cascata (o de baixo recua e
  fica por cima); começando juntos, ou três ou mais, dividem a largura em colunas iguais.
- **Criar:** clicar numa hora vazia (1h a partir da meia hora anterior) ou arrastar na grade (mouse; no toque, segurar e arrastar).
- **Mover e esticar:** arrastar o evento (muda hora e dia, gruda de 15 em 15 min) e a alça de baixo (muda o fim). Esc cancela. O
  servidor recusando (409) desfaz e avisa. No celular: toque abre o evento; **segurar ~0,4 s** o evento (ou uma hora vazia) "pega" e o dedo arrasta (a rolagem trava só nesse momento); a alça de baixo, maior no toque, estica de imediato.
- **Painel do evento:** Detalhes (com Concluir, Reabrir, Cancelar, Editar) e Tempo (apontamentos). **Editar** envia só o que mudou.
- **Filtros:** busca (sem acento), categorias, situação e cliente. Cor do evento = categoria.
- **Tema:** só tokens, vale no claro e no escuro. Abaixo de 1100 px os filtros viram um bloco recolhido.

## Arquivos

| Arquivo | Papel |
|---|---|
| `apps/web/public/agenda-model.js` | Contas puras: datas em Brasília, janelas, recorte por dia, sobreposição, filtros. Testado isoladamente. |
| `apps/web/public/tracking.js` | Estado, busca de dados e desenho das quatro visões; arrastar/esticar. |
| `apps/web/public/agenda-evento.js` | Formulário (criar/editar) e painel lateral do evento. |
| `apps/web/public/agenda-dom.js` | Elemento, botão, campo. |
| `apps/web/public/tracking.css` | Estilo, só tokens. |
| `apps/api/src/modules/tracking.mjs` | `GET /api/tracking`, `POST /api/tracking`, **`PUT /api/tracking/:id`** (novo), status, contratação, tempo. |
| `apps/api/src/platform/tracking-model.mjs` | Validação: `activityInput`, `activityUpdateInput`, `trackingRange`. |
| `db/migrations/047_agenda_campos.sql` | Colunas `description`, `location`, `meeting_url`. **Aplicada em 2026-10-04.** |

## API

- `GET /api/tracking?month=AAAA-MM` (como antes) **ou** `?from=AAAA-MM-DD&to=AAAA-MM-DD` (`to` exclusivo, de 1 a 62 dias). Aceita
  `tenant_id` e `engagement_id`. A resposta traz `agenda_campos` (veja abaixo).
- `PUT /api/tracking/:id` com `revision` obrigatória e qualquer um de `title`, `category`, `kind`, `starts_at`+`ends_at` (sempre juntos),
  `description`, `location`, `meeting_url`. Revisão velha ou atividade inexistente: **409**. Vazio ou `null` limpa descrição, local e link.
- `description` (até 2000), `location` (200, uma linha), `meeting_url` (500, **só https**, sem credencial embutida: vira link na tela).

## Migração 047 (aplicada em 2026-10-04)

Aplicada no banco compartilhado com `npm run db:migrate` (era a única pendente; a tabela `service_activities` tinha 0 linhas). Só **adicionou** colunas opcionais. O texto abaixo vale para qualquer banco que ainda não a tenha (ambiente novo, restauração antiga). Enquanto ela não for aplicada:

- tudo o que já existia continua funcionando (o SQL de criar é idêntico ao anterior quando os campos novos não vêm);
- `GET` devolve `agenda_campos: false` e a tela **não mostra** descrição, local nem link;
- criar ou editar **com** esses campos devolve 409 com a mensagem "falta aplicar a migração 047" (nunca um erro de coluna do banco).

Depois de aplicar, a primeira consulta (até 1 minuto) já passa a oferecer os campos. Aplicar não exige reiniciar nada: no Core de produção isso já valeu assim que o deploy com a agenda subiu.

## Testes

- `test/unit/agenda-model.test.mjs`, `test/unit/agenda-api.test.mjs`.
- `test/ui/smoke.test.mjs`, testes `agenda: …`: usam um `/api/tracking` simulado dentro da página (`COM_AGENDA`), que registra os PUT/POST.
  Com `UI_SCREENSHOTS=1` gera as capturas `test/ui/artifacts/100*-Agenda-*.png` (claro e escuro, desktop e celular).

## Limites da fase 0

- Prazo de vários dias aparece repetido em cada dia coberto (faixa "dia todo" e chips do mês), não como barra contínua.
- No toque, arrastar exige segurar antes (senão é rolagem). Por teclado, setas e Shift+setas movem e esticam o evento focado.
- Sem convidados e sem fuso por pessoa (Brasília fixo, UTC-3). Repetição só semanal e mensal (sem anual nem "todo 1º dia útil"); lembrete só por push.
- Eventos de dia inteiro de verdade (sem horário) não existem no modelo: um prazo é um intervalo de 24 h ou mais.
- Nenhuma integração externa. Fases 1 a 3 (Google Calendar e Meet, Outlook e Teams, Zoom e iCloud) dependem de credenciais OAuth que
  precisam ser criadas no Google Cloud e no Azure.

## Lembretes e repetição (migração 048, **ainda não aplicada ao banco compartilhado**)

- **Lembrete por atividade.** No formulário, "Avisar": *Padrão da agenda* (não grava nada: `reminders` fica `NULL`), *Não avisar* (`[]`) ou
  *Personalizado* (até 3 tempos: na hora, 5 min, 15 min, 30 min, 1 h, 2 h, 1 dia antes). O padrão da agenda se escolhe em **Configurações → Notificações**
  (`/api/agenda/preferencias`, uma linha, começa em 15 min).
- **Quem envia.** `agenda-jobs.mjs` roda a cada minuto no servidor: acha o que venceu nos últimos 20 min e manda push (tópico `agenda.lembrete`) a quem ligou esse
  assunto. `agenda_reminders_sent` (atividade, antecedência) garante **um aviso só**, mesmo com dois ciclos ou dois servidores. Lembrete que passou de 20 min
  (servidor parado) é descartado.
- **Atividade recorrente (série).** "Repetir": toda semana (dias marcados, "a cada N semanas") ou todo mês (no dia do evento; em mês curto cai no último dia),
  terminando nunca, numa data ou após N vezes. Só para eventos de até 24 h. Cada ocorrência é uma atividade comum com `series_id` (arrasta, conclui,
  cancela e registra tempo normalmente); marca ↻ no calendário. O servidor gera 13 meses à frente e a cada 6 h estende as séries sem fim.
- **Editar.** Mexer numa ocorrência a desliga da série (`series_detached`). Em "Aplicar a": *Só este evento* ou *Este e os próximos* (`PUT /api/tracking/series/:id`:
  título, categoria, tipo, textos, hora, duração, lembrete; o dia não muda por aqui, e ocorrência já mexida à mão não é sobrescrita).
- **Encerrar.** No painel, "Encerrar repetição" pede confirmação: *só os próximos a partir deste* ou *todos os próximos* (`POST /api/tracking/series/:id/end`).
  A role do Core não apaga linha, então as futuras ainda planejadas recebem `archived_at` e somem da agenda; o passado fica.
- **Sem a 048** o banco responde `agenda_lembretes: false`, a tela não mostra lembrete nem repetição e a API devolve 409 "falta aplicar a migração 048".
- Arquivos: `recorrencia.mjs` (regras, testado), `agenda.mjs` (rotas), `agenda-jobs.mjs`, `agenda-recursos.mjs` (detector 047/048), `agenda-repeticao.js`
  (blocos do formulário), `notificacoes.js` (Configurações).

## Google Meet (migração 049, **ainda não aplicada ao banco compartilhado**)

- **Conta por operador.** Em Configurações → Integrações → *Google Agenda e Meet*, cada pessoa conecta a PRÓPRIA conta Google (OAuth com o cliente do login, escopo só de eventos do Calendar). O Core guarda só o *refresh token*, **cifrado** (AES-256-GCM, chave `CORE_SECRETS_KEY` fora do banco). Token de acesso nunca é gravado.
- **Criar a sala.** No formulário (atividade avulsa): *Sala → Adicionar videoconferência do Google Meet* (o mesmo texto do Google Agenda), com convidados opcionais (e-mails; o Google manda o convite). Ou, no painel de uma atividade existente, *Criar sala do Meet*. O evento nasce na agenda de quem clicou, o link do Meet vai para "Link da reunião" e `google_event_id` fica na atividade. Uma sala por atividade; repetir o pedido devolve a mesma (o `requestId` é estável).
- **Acompanha.** Mudar horário, título ou textos atualiza o evento no Google; cancelar a atividade apaga o evento (e avisa os convidados). Melhor esforço: se o Google falhar, a atividade muda do mesmo jeito e o erro vai para o log.
- **Se o Google falhar ao criar.** A atividade fica salva e a tela avisa que a sala não foi criada (sem duplicar); dá para tentar de novo pelo painel.
- **Conexão expirada ou revogada** (`invalid_grant`): a conexão é marcada como revogada e a tela pede para conectar de novo.
- **Não vale para séries** (atividade que se repete): a sala é por evento avulso.
- **Sem a 049**: a tela diz "indisponível", não oferece a sala, e a API devolve 409 com a mensagem. Endereço de retorno a cadastrar no Google Cloud: `<PUBLIC_ORIGIN>/api/google/calendar/callback`.
- Arquivos: `platform/google-calendar.mjs` (conversa com o Google), `modules/google-calendar.mjs` (rotas, detector, sincronização), `config-integracoes.js` (conexão), blocos "Videoconferência" em `agenda-evento.js`.
