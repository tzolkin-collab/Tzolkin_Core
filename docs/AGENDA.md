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
- **Intervalo de dias:** no mini-calendário, arraste de um dia a outro (ou Shift+clique). Até 7 dias vira grade com essas colunas; mais que isso, lista. As setas andam o tamanho do intervalo; escolher uma visão sai dele.
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
| `apps/web/public/tabs.js` | Abas da casa (WAI-ARIA), reusadas no topo do diálogo para o tipo da atividade. |
| `apps/api/src/platform/agenda-recursos.mjs` | Detectores de migração: 047/048 (`criarDetector`) e 054 (`criarDetectorRegistro`). |
| `db/migrations/054_acompanhamento_registro.sql` | Abre `'registro'` no CHECK de `kind`. **Escrita em 2026-10-06, aplicada em 2026-10-07.** |

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

## Videoconferência: padrões em Configurações → Agenda (neste navegador)

- **Local quando a sala é escolhida** (padrão "Google Meet"; vazio = não preencher). Só preenche se o Local estiver vazio.
- **Convidar o contato principal da empresa**: ao escolher a sala, o e-mail do contato principal (ou o primeiro com e-mail) entra em Convidados. Dá para remover ou somar outros pelo campo "Adicionar contato como convidado".
- O link da reunião **não é perguntado**: quem gera é o Google (veja a seção seguinte).

## O tipo é uma aba: Call · Task · Registro (2026-10-06)

O tipo da atividade era um `<select>` no meio do formulário. Virou **aba no topo do diálogo**, porque ele não é um detalhe da
atividade: é o que decide quais campos fazem sentido. A aba escolhida **é** o `kind` que se grava.

- **Abas.** Call (`sessao`), Task (`tarefa`, e também `entregavel` e `feature`, que são de antes das abas) e Registro (`registro`).
  Usa o componente de abas da casa (`tabs.js`): `role=tablist/tab`, o formulário inteiro é o `tabpanel`, setas, Home e End andam.
  Trocar de aba **não apaga** o que já foi digitado nos campos comuns (título, cliente, contratação, quando).
- **Atividade já gravada** abre na aba do tipo dela, e salvar não reescreve o tipo: editar um `entregavel` na aba Task continua
  gravando `entregavel`. Tipo desconhecido (banco à frente da tela) abre em Task, que mostra mais.
- **Call** mostra a videoconferência (sala do Meet e convidados). **Task** e **Registro** não — lá a sala não tem o que fazer, e o
  painel do evento também só oferece "Adicionar videoconferência do Meet" em Call.
- **Task** exige início e prazo de entrega (é a diferença dela para o Registro); o segundo horário chama-se "Prazo de entrega".
- **Registro** é o que já aconteceu e se guarda: data e hora são opcionais, e não há lembrete nem repetição. Sem data, grava-se o
  instante em que o registro foi feito, descendo ao passo da grade (15 min) com a duração mínima dela (30 min) — o banco exige início
  e fim desde a migração 004, e inventar um compromisso de uma hora seria mentira. Ver `horarioDoRegistro` em `agenda-model.js`.
- **Registro não vira série:** repetir um registro não quer dizer nada. `serieInput` recusa o tipo (`KINDS_DE_SERIE`), e por isso a
  054 **não** mexe no CHECK de `service_activity_series`.

### O que saiu do formulário

- **Link da reunião.** A sala vem do Meet pela API do Google. O link **já gravado continua aparecendo** na visualização do evento e
  não é tocado ao salvar — só não é mais oferecido como campo.
- **Categoria.** Vem da contratação do cliente (`service_model`) e virou uma linha de descrição logo abaixo do Cliente, em texto. Os
  filtros por categoria da tela continuam funcionando, porque cada atividade segue gravando o seu `category`. Editando, a linha mostra
  a categoria que foi gravada na criação — ela não se troca por aqui. `advisory` (Assessoria) cai em `consultoria`: a lista do banco
  não tem "assessoria" (item 10 de [ACOMPANHAMENTO-REDESENHO.md](ACOMPANHAMENTO-REDESENHO.md)).
- **Local** deixou de ser digitado: é uma lista com o padrão de Configurações → Agenda, os locais já usados nas atividades carregadas
  e o da atividade aberta, mais "Outro local…" como último caso, para nenhuma edição perder o que estava gravado. Acento e caixa não
  criam duas opções.

### Como a janela aparece

Ao lado do X: três ícones — centralizado (o de sempre), popup no canto e lateral de altura cheia. Só CSS e classe no diálogo; o
formulário é o mesmo. A escolha vale **na hora**, na janela que está aberta (trocar no meio do preenchimento só muda o tamanho; nada
do formulário se perde), e **fica para as próximas aberturas** neste navegador, como as demais preferências da agenda
(`agenda-prefs.js`, chave `tzolkin-agenda-janela`). Abaixo de 700 px os três caem para o mesmo diálogo centralizado.

### Migração 054 (**aplicada em 2026-10-07**)

`db/migrations/054_acompanhamento_registro.sql` só troca o CHECK de `service_activities.kind` para aceitar `'registro'`, como a 048 fez
com os tópicos de push. Nada é apagado nem reescrito.

Aplicada, a aba Registro aparece. Em um banco sem ela, exatamente como na 047 e na 048: `GET /api/tracking` responde `agenda_registro: false`, a tela **não oferece** a aba Registro
(e diz que ela espera a migração), e quem tentar gravar o tipo recebe **409** com texto claro em vez da violação do CHECK vinda do
Postgres. Todo o resto das abas funciona sem ela. O detector é o `criarDetectorRegistro` de `agenda-recursos.mjs` (lê o CHECK em
`pg_constraint`, cacheia o "sim" e repergunta o "não" a cada 60 s).

### O que ficou para depois

O pedido de 06/10 é maior que isto. Os outros itens — descrição `.md` com `/coment`, links para GitHub e ads, anexos e pasta no Core,
relações entre tasks, vínculo com o produto, cronologia padronizada e o contrato na ficha do cliente — estão em
[ACOMPANHAMENTO-REDESENHO.md](ACOMPANHAMENTO-REDESENHO.md), cada um com o que falta para existir.

## Responsável da atividade (migração 060)

Toda atividade pode ter **uma pessoa responsável**: uma conta de operador (a mesma de Configurações → Acessos), escolhida no
campo "Responsável" logo abaixo da Contratação. Só entram na lista contas **ativas** com papel Administrador ou Membro; Leitor
e conta suspensa não aparecem e a API os recusa.

**Quem é avisado.**

| Situação | Lembrete (15 min antes etc.) | Aviso "atribuída a você" |
|---|---|---|
| Atividade **com** responsável | só os aparelhos dele | só os aparelhos dele |
| Atividade **sem** responsável | quem assinou os lembretes da agenda, como sempre foi | — |
| Responsável **suspenso** | cai no comportamento de sem responsável (a suspensão já revogou os aparelhos dele) | — |
| Trocar para quem já era, tirar, ou atribuir **a si mesmo** | — | não avisa |

O aparelho é achado pelo e-mail guardado quando foi registrado; sem e-mail, pelo subject de uma sessão da mesma pessoa. Quem
não tem aparelho cadastrado não recebe nada, e **não** cai para "todo mundo": o ponto é não incomodar os outros. O aviso de
atribuição usa o tópico dos lembretes da agenda, para não exigir um tópico novo.

**Trocar** vai por `PUT /api/tracking/:id/responsible` (a revisão é obrigatória) e deixa de/para em `service_activity_audit`
(`responsible_changed`). Na criação, `responsible_id` vai no próprio POST.

**Limites conhecidos.** Atividade que se **repete** ainda não tem responsável (a série não guarda a coluna e as ocorrências
nascem sem dono): a tela desativa o campo em vez de perder a escolha. Atividades criadas pelo bot (MCP) nascem sem responsável
até o MCP aprender o campo.

**Sem a migração 060** o campo não aparece, a API responde 409 com texto claro e o lembrete segue para quem assinou o tópico.

## Tags da atividade (migração 061)

Além da categoria — que continua vindo da contratação ou do cliente, automática e separada —, a atividade pode ter **tags**:
classificação livre, até **12 por atividade**, que aparecem sempre (no formulário e como etiquetas na visualização).

**Como se usa na tela.** No campo "Tags (opcional)": escolher uma da lista sugerida só a seleciona; digitar um nome novo e dar
Enter a cria na hora. "Revisão técnica" e "revisao tecnica" são a mesma tag (a comparação ignora acento, maiúscula e símbolo,
no servidor e na tela). Tirar uma tag da atividade é o × da etiqueta.

**Tag criada pela IA** (pelo MCP) **vale na hora**, mas leva o selo "IA" e a explicação "aguardando revisão" até alguém aprovar:
o ✓ da etiqueta, no formulário, aprova. Renomear, trocar a cor e arquivar existem na API e no MCP; ainda não há tela de catálogo.

**Nada se apaga.** Arquivar uma tag grava `archived_at`; tirar uma tag de uma atividade grava `removed_at`. O código das tags nunca
emite `DELETE` (há teste que confere).

| Onde | O quê |
|---|---|
| `GET /api/tags` | catálogo (`?arquivadas=1` inclui as arquivadas) e os tons disponíveis |
| `POST /api/tags` | cria; idempotente: nome que já existe devolve a tag existente (`created: false`) |
| `PUT /api/tags/:id` | aprova, renomeia, troca a cor, arquiva ou reativa; a revisão lida é obrigatória |
| `PUT /api/tracking/:id/tags` | define as tags da atividade (lista de ids; revisão obrigatória) |
| MCP | `listar_tags`, `criar_tag`, `revisar_tag`; parâmetro `tags` (lista de nomes) em `criar_atividade` e `editar_atividade` |

Ler é para qualquer operador logado; escrever exige Administrador ou Membro (Leitor lê, não cria nem muda).

**Limites conhecidos.** Atividade que se **repete** não tem tags (a tela desativa o campo); não há filtro por tag na agenda; falta a
tela para revisar o catálogo em bloco.

**Sem a migração 061** o campo não aparece, a leitura responde "indisponível" e a escrita responde 409 com texto claro.
