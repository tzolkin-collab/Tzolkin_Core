# Handoff — Acompanhamento (agenda) no celular, intervalo, popup e sidebar (2026-10-05)

Branch de deploy: `codex/revisao-seguranca-core`. Tudo abaixo está publicado (último commit `fc7d70f`). Nenhuma migração nova nesta rodada; o banco está até a `053`.

## Entregue

- **Arrastar por toque** (`d2d9c75`, `apps/web/public/tracking.js`, `tracking.css`): segurar ~0,38 s num evento ou numa hora vazia "pega" o item (vibra); só então o dedo arrasta e a rolagem trava. Mexer antes de segurar é rolagem normal. A alça de esticar tem 22 px no toque, com pegador visível, e age de imediato. Constantes: `SEGURAR_MS`, `TOLERANCIA_TOQUE`.
- **Intervalo de dias no mini-calendário** (`434dac6`): arrastar de um dia a outro, ou Shift+clique. Visão interna `periodo` (`estado.fim`, `M.intervalo`, `M.janela('periodo', dia, ate)`); até 7 dias vira grade, mais que isso vira lista (máx. 62). As setas e os atalhos andam o tamanho do intervalo (`andar()`); escolher outra visão sai dele. Não é gravada como visão preferida.
- **Popup da atividade** (`46baa5c`, `agenda-evento.js`): Local e Link ficam logo abaixo da Sala; com a sala marcada o Local vira "Google Meet" (se vazio) e o Link trava, porque o Google gera. Campo "Adicionar contato como convidado" (datalist com os contatos do `/api/overview`, os da empresa escolhida primeiro) coloca o e-mail nos Convidados. `tracking.js` guarda `pessoas` e repassa ao `abrirEditor`.
- **Configurações → Agenda** (`732f057`): "Local quando a sala é escolhida" e "Convidar o contato principal da empresa". Valem só neste navegador (`agenda-prefs.js`: `localDoMeet`, `convidarContatoPrincipal`).
- **Sidebar** (`fc7d70f`): "Configurações" saiu do menu principal (`hidden:true` em `app.js`), onde duplicava o botão do rodapé.
- Documentado em `docs/AGENDA.md`. Testes: 688 unitários e 71 de UI passando (`npm run test:unit`, `npm run test:ui`).

## Atenção: `fc7d70f` levou arquivos de outra sessão

Usei `git add -A` e o commit incluiu 30 arquivos que não eram desta tarefa: `finance.mjs`, `marketing.mjs`, `payment-sales.mjs`, `finance.js`, `assets.mjs`, `controls.css`, `config-integracoes.js`, ícones em `logos/`, os três `docs/handoff-*` anteriores, o benchmark de inbound, o `.excalidraw`, e pequenos ajustes em `test/marketing.test.mjs` e `test/commercial-automations.test.mjs`. Já estão na branch de deploy. Os testes passaram com eles na árvore. Decisão pendente: manter, ou reverter só esses arquivos com um commit novo (isso apagaria as mudanças na árvore de trabalho de quem os fez). Não houve force-push.

## Limites e não verificado

- O toque foi testado só com eventos simulados; falta conferir num celular de verdade (segurar, arrastar, esticar, e o intervalo no mini-calendário, que usa `touch-action: none`).
- O pedido "config de calendário também no popup" foi interpretado como os padrões de videoconferência acima; não confirmado.
- Local padrão e contato principal ficam no `localStorage`, não acompanham a pessoa entre navegadores.
- Intervalo de dias: o mini-calendário não indica o intervalo na visão Mês.

## Próximas etapas em aberto (nenhuma foi pedida)

- Agendador de e-mails (`charge_created`, `due_reminder`, `welcome` da 1ª compra) sobre a fila existente.
- Seção "Dados" em Configurações.
- Descadastro real nos e-mails; leitura de respostas e bounces.
- E-mail de cobrança do Asaas (depende de o Core criar as cobranças Asaas; ver `docs/EMAIL-AUTOMACOES.md`).

## Comandos

No PowerShell 5.1 não existe `&&`. Para publicar:

```powershell
cd "D:\Códigos\Tzolkin\Projetos\Outros\Site - Tzolkin\tzolkin-core"; git push origin HEAD:codex/revisao-seguranca-core
```
