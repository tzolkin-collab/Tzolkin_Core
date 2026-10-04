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
- **Criar:** clicar numa hora vazia (1h a partir da meia hora anterior) ou arrastar na grade (mouse).
- **Mover e esticar:** arrastar o evento (muda hora e dia, gruda de 15 em 15 min) e a alça de baixo (muda o fim). Esc cancela. O
  servidor recusando (409) desfaz e avisa. Toque não arrasta: toque abre o evento.
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
- Arrastar e esticar só com mouse. Por teclado, o caminho é abrir o evento e **Editar**.
- Sem recorrência, sem convidados, sem lembretes, sem fuso por pessoa (Brasília fixo, UTC-3).
- Eventos de dia inteiro de verdade (sem horário) não existem no modelo: um prazo é um intervalo de 24 h ou mais.
- Nenhuma integração externa. Fases 1 a 3 (Google Calendar e Meet, Outlook e Teams, Zoom e iCloud) dependem de credenciais OAuth que
  precisam ser criadas no Google Cloud e no Azure.
