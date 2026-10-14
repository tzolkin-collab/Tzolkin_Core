# Handoff — 14/10/2026 — Acompanhamento: responsável, tags, formatação do .md, Meet e celular

Quem escreve: Claude (sessão local, Windows). Quem lê: a próxima sessão — local ou na nuvem — ou o Gustavo.
**Esta sessão não deixou nada pela metade escondido.** O que está pronto, o que está pela metade e o que depende do dono está
separado abaixo, com a prova de cada coisa. Comece pela seção 1.

> Regras do dono que valem aqui (memória do projeto, 2026-10-01): começar por `docs/STATUS.md`; **um item por vez, ponta a ponta**;
> copiar o que já existe em vez de inventar; não rodar `npm test` nem aplicar migração no banco compartilhado sem avisar;
> mensagens curtas. **Lembrete pedido pelo dono:** os destinos dos webhooks da Stripe e do Asaas continuam sem cadastro nos painéis
> — sem isso o Core não confirma pagamento. Citar no início de toda sessão até ele dizer que foi feito.

> **Atualização (mesmo dia, sessão na nuvem):** as migrações do responsável e das tags foram **renumeradas** para
> `060_responsavel_da_atividade.sql` e `061_tags_da_atividade.sql` (ainda **não aplicadas**); onde este texto diz 055/056 do
> responsável/tags, leia 060/061. `MENSAGEM_055`/`MENSAGEM_056` viraram `MENSAGEM_060`/`MENSAGEM_061`. O teste de tela das tags
> passa (a causa era o × que tirava a primeira tag, não só a expectativa). **Não rodado nesta sessão:** os testes que aplicam as
> migrações em PostgreSQL descartável (`test/agenda-responsavel.test.mjs`, `test/agenda-tags.test.mjs`) — sem servidor no ambiente.

## 1. Onde está cada coisa

| Item | Código | Banco de produção | No ar? |
|---|---|---|---|
| Formatação do .md na ficha (citação, tabela, divisória…) + trava | commitado (`2660a0c`) | **19 descrições reparadas** (18 citações, 3 tabelas) | **Não**: falta deploy |
| Meet: erros que dizem a causa | commitado (`6e3bad3`) | — | **Não**: falta deploy |
| Responsável por atividade + aviso só a ele | commitado (`139433a`) | migração `055_responsavel_da_atividade.sql` **NÃO aplicada** | **Não** |
| Acompanhamento no celular | commitado (`a73dfaf`) | — | **Não**: falta deploy |
| **Tags da atividade** (catálogo, tela, MCP) | **não commitado na `main`; está na branch `wip/tags-da-atividade`** | migração `056_tags_da_atividade.sql` **NÃO aplicada** | **Não**; **1 teste de tela falhando** (seção 3) |

**Por que nada está no ar:** o deploy depende de um clique no EasyPanel (projeto `other`, serviço `core`, **Deploy**). O token que a
sessão usava (`EASYPANEL_TOKEN` no `.env`) responde **401**: foi rotacionado ou expirou. A branch que a produção constrói é
`codex/revisao-seguranca-core`; os commits acima já estão nela, **exceto o das tags**. O push para `main` foi recusado pela trava de
permissão da sessão local; a `main` remota pode estar atrás.

## 2. O que mudou, e como conferir

### 2.1 Formatação do .md (`2660a0c`)
- **Causa:** o editor oferecia tabela, citação, código, divisor e destaque, mas a ficha só desenhava parágrafo, título, lista e
  checklist; o conversor de Markdown do bot só produzia esses quatro. O resto virava parágrafo com o símbolo cru (`> `, `| a | b |`).
  O Google Agenda também recebia o **JSON cru** do editor como descrição do convite.
- **Código:** `apps/web/public/agenda-descricao.js` (um desenho por tipo; desconhecido mostra o texto e avisa), conversor em
  `apps/api/src/platform/markdown-editorjs.mjs`.
- **Trava:** `test/unit/descricao-blocos.test.mjs` lê do próprio código as três listas (ferramentas do editor, desenhos da ficha,
  blocos do conversor) e quebra, nomeando a divergência, se alguém registrar uma ferramenta sem ensinar os outros dois.
  Provado: adicionando uma ferramenta falsa o teste falha.
- **Dados:** `scripts/reparar-descricoes.mjs` (simula por padrão; `--aplicar` grava). **Já aplicado em produção** em 13/10.
  Cópia do estado anterior em `.tmp/reparo-descricoes-antes-2026-10-13T21-16-45-898Z.json` — **gitignored e só na máquina local**.
  Rodar de novo diz "0 a reparar".

### 2.2 Meet (`6e3bad3`)
**Não está consertado; está diagnosticável.** Em produção: a conexão do Google existe, ativa, com o escopo certo, **mas 0 de 120
atividades têm sala**. Hipóteses, da mais provável: (1) o token foi cifrado com `META_MARKETING_KEY` e o servidor passou a abrir com
`CORE_SECRETS_KEY` (que tem prioridade; as duas chaves são diferentes e entraram no mesmo dia, 04/10); (2) Google Calendar API
desligada no projeto do Cloud; (3) app OAuth em modo "Testing" (token vence em 7 dias; a conexão tem 9+). **Não foi confirmado**:
decifrar o token para testar não foi feito, de propósito.
O código agora: chave que não abre o token → pede reconexão (antes: 500 genérico); o 403 do Google distingue API desligada, limite e
permissão; toda falha é gravada em `google_calendar_connections.last_error`.
**Para fechar:** deploy → o Gustavo desconecta e conecta o Google em Configurações → Integrações → cria uma Call com Meet → a mensagem
agora diz o motivo.

### 2.3 Responsável por atividade (`139433a`) — migração 055 pendente
- Coluna `service_activities.responsible_id` → `operator_accounts(id)`, nula. Só entra conta **ativa** de Administrador ou Membro.
- Lembrete: com responsável vai **só** aos aparelhos dele (e-mail do aparelho, ou subject da sessão); sem responsável, a quem assinou
  o tópico, como sempre foi; responsável suspenso cai no comportamento de sem responsável.
- Aviso "atribuída a você": só a quem passou a ser responsável (manter o mesmo, tirar e atribuir a si mesmo **não** avisam).
- Rota própria `PUT /api/tracking/:id/responsible` (revisão obrigatória; de/para na trilha `responsible_changed`).
- **Limites:** atividade que **se repete** não tem responsável (a série não guarda a coluna; a tela desativa o campo); atividades
  criadas pelo bot (MCP) nascem sem responsável; quem não tem aparelho cadastrado não recebe nada (de propósito: não cai para "todos").
- **Defeito conhecido:** o ícone do campo (`data-prop="responsavel"`) **não tinha máscara CSS** e viraria um quadrado cinza. A máscara
  foi acrescentada **no trabalho das tags** (branch `wip`), não na `main`. Ver seção 5.

### 2.4 Celular (`a73dfaf`)
Bloco final de CSS em `apps/web/public/tracking.css` (`@media (max-width: 700px)`, depois de todas as camadas antigas). A causa da
sobreposição dos campos: o formulário é uma coluna flexível de altura limitada e o rótulo **encolhia**; a correção é `flex: none`.
Teste de regressão `agenda no celular…` em `test/ui/smoke.test.mjs` **mede** (rótulo menor que o campo, campo passando da borda,
abas estreitas, botão fora da tela, pontos do mês) e falha sem a correção.

## 3. Tags da atividade — o que está pronto e o que não está (branch `wip/tags-da-atividade`)

Decisões do dono (14/10): as tags **aparecem sempre** (a categoria herdada do cliente segue automática e separada); tag criada pela IA
**vale na hora**, marcada "sugerida pela IA" até alguém revisar (aprovar, renomear ou arquivar).

**Pronto e provado:**
- `db/migrations/056_tags_da_atividade.sql`: `agenda_tags` e `service_activity_tags`; nada se apaga (arquivar é `archived_at`, tirar é `removed_at`).
- `apps/api/src/platform/agenda-tags.mjs` (lógica única: nome→slug sem acento, criar idempotente, revisar, definir tags da atividade) e
  `apps/api/src/modules/agenda-tags.mjs` (`GET/POST /api/tags`, `PUT /api/tags/:id`, `PUT /api/tracking/:id/tags`).
- `GET /api/tracking` devolve `agenda_tags`, `tags`, `activity_tags`.
- MCP: `listar_tags`, `criar_tag`, `revisar_tag`; parâmetro `tags` em `criar_atividade` e `editar_atividade`; as respostas levam as tags.
  **Corrigido de brinde:** editar **só o status**, **só a contratação** ou **só as tags** pelo MCP dava erro ("Nada para alterar").
- Testes: `test/unit/agenda-tags.test.mjs` (sem banco) e `test/agenda-tags.test.mjs` (**PostgreSQL descartável**, pela API da tela e
  pelo MCP; passou). **766 testes unitários passando.**
- Tela: campo "Tags (opcional)" no formulário (escolhe as que existem, cria com Enter, aprova a da IA com ✓, tira com ×), etiquetas na
  visualização, ícone (máscara CSS) de tags **e de responsável**.

**Pela metade / falhando:**
1. **`npm run test:ui` — 1 teste falha:** `agenda: tags só com a migração 056…`. Passa tudo (criar, aprovar, tirar, salvar com a rota
   de tags) e falha só na **última** asserção: as etiquetas na visualização do painel (esperado `['Revisão Técnica','Pendente IA']`).
   Já corrigido um erro do teste (faltava recarregar a agenda depois de atribuir as tags na API falsa); o diff atual não foi lido porque a
   sessão caiu. **Primeiro passo:** rodar `npm run test:ui` e ler o `actual`. Hipótese: a linha "Tags" da visualização
   (`etiquetasDe(dados.activity_tags?.[e.id])`) não está chegando ao painel `#peek-agenda`, ou o painel lê outra cópia de `dados`.
2. **Faltam**: tela para **renomear/arquivar/revisar** o catálogo (hoje só dá para aprovar pelo ✓ do formulário e pela API/MCP);
   tags em **séries** (o campo é desativado); filtro por tag na agenda; `docs/AGENDA.md` não descreve as tags.
3. **Duplicata de número de migração** (seção 5).

## 4. O que fica para o dono decidir

1. **Aplicar as migrações 055 (responsável) e 056 (tags)?** São aditivas (uma coluna; duas tabelas). Comando: `npm run db:migrate`
   (com o `.env` apontando para produção). Antes, rodar `node scripts/test-commercial.mjs test/agenda-responsavel.test.mjs` e
   `…test/agenda-tags.test.mjs` (banco descartável).
2. **Deploy** (clique no EasyPanel, ou renovar `EASYPANEL_TOKEN` no `.env` para a sessão fazer).
3. **Quem manda no acesso: o cadastro (Configurações → Acessos) ou `CORE_ALLOWED_EMAILS` no servidor?** Hoje as duas se somam e a do
   servidor vence: **suspender quem está na lista do servidor o promove a Administrador**. Levantamento completo: papel não é guarda de
   rota (105 de 204 rotas não checam papel; "Leitor" escreve em quase tudo); há 1 conta em produção; 6 tokens MCP ativos que qualquer
   sessão pode emitir, sem papel. Isso **precisa** ser decidido antes de o MCP ganhar acesso a criar clientes/ver Git/EasyPanel/bancos
   (item pedido, ainda não feito).
4. **Time fica ou sai?** Existe no banco e na API, sem tela e sem efeito.
5. **Role de produção** (`tzolkin_core_runtime`) está superusuária com DELETE em tudo; só deve ser corrigida **depois** de o código
   parar de depender de DELETE (`PUT /api/teams`, `accounts.mjs`).

## 5. Armadilhas e dívidas que já se conhecem

- **Numeração de migrações duplicada.** Em disco: `055_acompanhamento_assessoria` e `056_service_activity_links` (da outra frente,
  **já aplicadas** em produção) e `055_responsavel_da_atividade` e `056_tags_da_atividade` (minhas, **não aplicadas**). O executor
  identifica pelo **nome completo**, então funciona, mas confunde. **Recomendação:** renumerar as minhas para `060_` e `061_` **antes**
  de aplicar. Arquivos que mencionam "055" do responsável: `agenda-jobs.mjs`, `tracking.mjs`, `agenda-recursos.mjs`, `agenda-evento.js`,
  `agenda-model.js`, `smoke.test.mjs`, `agenda-abas.test.mjs`, `agenda-responsavel.test.mjs`, `docs/AGENDA.md`; atenção: `checkout-*`,
  `badges.test.mjs` e `theme.test.mjs` têm "055" sem relação — **não** trocar às cegas. As de "056": `app.mjs`, `agenda-tags.mjs` (2),
  `mcp.mjs`, `tracking.mjs`, `agenda-recursos.mjs`, `agenda-evento.js`, `smoke.test.mjs`, `agenda-tags.test.mjs`.
  As constantes `MENSAGEM_055`/`MENSAGEM_056` e os detectores (`criarDetectorResponsavel`, `criarDetectorTags`) leem o **banco**, não o número.
- **Teste de qualidade `sem cor fixa fora de token`** (`test/unit/…`): proíbe `rgba(...)`/hex em CSS. Use tokens (`var(--shadow-pop)`) ou `color-mix`.
- **Testes de tela dependem uns dos outros** (mesma página): rodar um isolado com `--test-name-pattern` costuma falhar. Rode `npm run test:ui` inteiro (~2,5 min).
- **`.env` local aponta para o banco de PRODUÇÃO.** Testes com banco só pelo executor isolado: `node scripts/test-commercial.mjs test/arquivo.test.mjs`
  ou `npm test`. Os testes novos de banco têm trava (`DATABASE_URL_TEST` com `tzolkin_test_`) e **pulam** fora dele.
- **Migração 035** (segunda cópia das conexões) e o resto da fase de "uma conexão, um dono": outra frente tocou nisso depois; não
  reverifiquei o estado. Conferir com `node --env-file=.env scripts/check-conexoes.mjs` (só leitura).
- **O Meet depende de ação do dono** (reconectar o Google) — não é só código.
- `apps/web/public/agenda-evento.js` é grande e tem camadas de CSS com `!important` (`tracking.css`); mexer no meio costuma criar o
  próximo erro. O bloco final de celular existe por isso.

## 6. Comandos úteis

```bash
npm run test:unit                       # rápido, sem banco (766 passando)
npm run test:ui                         # tela, banco falso, ~2,5 min (85 testes, 7 pulados de captura; 1 falhando: ver 3)
UI_SCREENSHOTS=1 npm run test:ui        # gera as capturas em test/ui/artifacts (gitignored)
node scripts/test-commercial.mjs test/agenda-tags.test.mjs   # banco DESCARTÁVEL, aplica todas as migrações duas vezes
node --env-file=.env scripts/check-conexoes.mjs              # só leitura, produção
```
