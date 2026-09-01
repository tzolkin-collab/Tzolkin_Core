# Infraestrutura

Ambientes, bancos, migrações, backup, deploy e observabilidade.

Revisão: **2026-08-30**.

---

## 1. Ambientes

> ### ⚠️ Correção de 2026-08-30, posterior à primeira redação
>
> Só o **processo** é local; o **banco é remoto**, hospedado em EasyPanel. O transporte do Core foi corrigido com TLS verificado e rotação da senha; ver [POSTGRES-TLS.md](POSTGRES-TLS.md). Outras lacunas de produção continuam abertas.

| Ambiente | Estado |
|---|---|
| **Aplicação: desenvolvimento local** | `[EXISTENTE E VERIFICADO]` — processo em loopback, é o único que existe |
| **Banco: já é um ambiente compartilhado** | `[EXISTENTE E VERIFICADO]` — PostgreSQL remoto em EasyPanel, alcançável pela internet pública |
| Homologação | `[PROPOSTO]` — não existe. **Não há separação entre desenvolvimento e produção no banco** |
| Produção | `[PROPOSTO]` — **bloqueada** pela lista em [SECURITY.md](SECURITY.md#7-antes-de-publicar-o-core) |

### Local `[EXISTENTE E VERIFICADO]`

| Item | Valor |
|---|---|
| Processo | `npm start` → `node --env-file=.env src/server.mjs` |
| Endereço | `http://127.0.0.1:3100` — **só loopback** |
| Guarda | Lança erro se `NODE_ENV=production` |
| Runtime | Node.js 24.18.1 |
| Banco | PostgreSQL 17.11 **remoto** (EasyPanel), base `tzolkin_core` — não é local |
| Timeouts | requisição 15s, cabeçalhos 10s |
| Pool | máx. 5 conexões, 8s para conectar |

A origem aceita em mutações é derivada da porta em execução. Trocar `PORT` continua funcionando; acessar por `localhost` em vez de `127.0.0.1` **não** funciona, porque a origem não bate.

**Não publicar o processo, não expor por túnel.** Isso protege a aplicação — **não** protege o banco, que já está exposto ([§2](#onde-os-bancos-realmente-estão)).

---

## 2. Bancos

Bancos separados por app, por decisão — [ADR 0001](decisions/0001-core-modular-com-bancos-separados.md).

| Banco | Dono | Conteúdo |
|---|---|---|
| `tzolkin_core` | Core | Organizações, vínculos, catálogo, contratos, credenciais de app, trilha |
| Banco institucional (schema `institucional`) | `tzolkin-site` | `leads`, `email_outbox` |
| Redis | `chatbot-api` | Sessões de chat |

### Onde os bancos realmente estão

`[EXISTENTE E VERIFICADO]` — conferido em 2026-08-30 inspecionando `DATABASE_URL` e `REDIS_URL` **sem imprimir os valores**, e testando a conexão.

| Fato | Verificação |
|---|---|
| O PostgreSQL do Core **não é local** | `DATABASE_URL` aponta para um host EasyPanel; hostname público, IPv4 público, porta 9000 |
| O Redis do `chatbot-api` também está em EasyPanel | `REDIS_URL` referencia o mesmo provedor |
| **O servidor oferece TLS; Core exige validação** | TLS 1.3 verificado em conexão real; `DATABASE_SSL=require`, `sslmode=verify-full`, certificado público confiado explicitamente. A role do Core rejeita conexões sem TLS; senha antiga rejeitada após rotação |
| Um só banco para tudo | Não há base separada de desenvolvimento; os testes rodam contra a **mesma** base que guarda o cadastro |

Correção passo a passo: [SECURITY.md §8](SECURITY.md#8-runbook-tls-no-postgresql-do-easypanel). Consequência prática: várias frases deste documento e do [SECURITY.md](SECURITY.md) que falavam em *"antes de qualquer ambiente compartilhado"* estão atrasadas — **o ambiente compartilhado já existe.**

### Preparação do Core `[EXISTENTE E VERIFICADO]`

`npm run db:setup` (`scripts/setup.mjs`), executado uma vez:

1. Se `.env` não existe, lê a conexão administrativa de um arquivo informado como argumento.
2. **Aborta** se `tzolkin_core` ou a role `tzolkin_core_app` já existirem — alvo existente exige verificação manual.
3. Cria a role `LOGIN NOSUPERUSER NOCREATEDB NOCREATEROLE` com senha aleatória de 36 bytes.
4. Cria a base com essa role como dona; `REVOKE ALL ON DATABASE ... FROM PUBLIC`.
5. Escreve `.env` com `wx` (nunca sobrescreve).
6. Aplica `db/schema.sql` e, em seguida, as migrações pendentes de `db/migrations/`.
7. Em falha, suprime detalhes de conexão da mensagem.

Depois: `node --env-file=.env scripts/import-notion.mjs`.

### Privilégio da role — lacuna conhecida

`tzolkin_core_app` é **dona** das tabelas. Consequências:

- Pode `DROP`, `ALTER` e apagar a própria trilha de auditoria.
- **Dono de tabela ignora RLS por padrão**, o que bloqueia [D5](CONTEXT.md#d5--isolamento-no-banco-só-query-ou-rlsseparação-física).

`[PROPOSTO]` Separar em duas roles antes de qualquer ambiente compartilhado: uma que aplica migração (dona) e outra que atende requisição (`SELECT/INSERT/UPDATE` no necessário, sem `DELETE` em `audit_events`).

---

## 3. Migrações

**Hoje `[EXISTENTE E VERIFICADO]`:**

- `db/schema.sql` é a **linha de base**, idempotente, aplicada uma vez pelo `db:setup`.
- `db/migrations/NNN_*.sql` são as alterações posteriores, aplicadas em ordem por `npm run db:migrate` (`scripts/migrate.mjs`).
- **Uma transação por migração:** falhou, nada daquele arquivo fica aplicado.
- O que já rodou é registrado em `schema_migrations`; reexecutar não reaplica nada — conferido rodando duas vezes.
- `db:setup` aplica a linha de base e em seguida as migrações pendentes.
- `npm run db:rotate-password` rotaciona a senha da role e reescreve o `.env` — e **recusa** texto claro e TLS sem certificado/hostname verificados, inclusive em loopback.

Aplicada até agora: `001_membership_por_produto.sql` ([ADR 0002](decisions/0002-vinculo-de-pessoa-por-produto.md)).

**`[PROPOSTO]` — ainda falta antes de qualquer ambiente compartilhado:**

- Reversão documentada, mesmo que manual — hoje não existe caminho de volta.
- Aplicadas por role própria, distinta da role da aplicação ([abaixo](#privilégio-da-role--lacuna-conhecida)).
- Alteração destrutiva em duas fases (expandir → migrar → contrair), nunca em uma.
- Corrigir a dívida: `scripts/import-notion.mjs` recria `ecosystem_entries` com `CREATE TABLE IF NOT EXISTS`, duplicando a definição que já está em `db/schema.sql`. Duas fontes para a mesma tabela é dívida — a definição deve morar só no schema.

---

## 4. Backup e restauração `[PROPOSTO]`

**Não existe rotina de backup do `tzolkin_core`.** Hoje o dado é cadastral e reconstruível (6 produtos + 13 fichas, vindos de um JSON versionado). **Isso deixa de ser verdade no minuto em que a primeira organização real for cadastrada.**

Mínimo antes de existir dado real:

- Backup automático, com retenção definida.
- **Restauração testada** em base separada, com periodicidade. Backup nunca restaurado não é backup.
- Objetivos explícitos de perda máxima aceitável (RPO) e tempo de recuperação (RTO).
- Backup cifrado, e cofre com acesso restrito e auditado.

---

## 5. Deploy e rollback `[PROPOSTO]`

**Não há deploy do Core.** Nenhum pipeline, imagem ou ambiente remoto. Publicar depende da lista de bloqueio em [SECURITY.md](SECURITY.md#7-antes-de-publicar-o-core).

Quando existir: separar migração de banco do deploy de aplicação; rollback ensaiado, não improvisado; segredos por ambiente, injetados fora do código; nenhuma alteração externa (DNS, provedor de pagamento) como efeito colateral de deploy.

Para referência, `tzolkin-site` já está na Vercel com segredo de produção configurado lá.

---

## 6. Observabilidade

**Hoje `[EXISTENTE E VERIFICADO]`:**

- `GET /health` — confirma o processo e uma consulta real ao banco.
- Uma linha de log na inicialização. **Sem log de requisição, sem log de erro, sem métrica.**
- `audit_events` — trilha de negócio, não de operação.

Erros são traduzidos para o cliente e **não são registrados em lugar nenhum**. Em produção isso significaria falha invisível.

**`[PROPOSTO]`:**

| Precisa | Para quê |
|---|---|
| Log estruturado com id de correlação | Rastrear uma requisição de ponta a ponta |
| **Log sem dado sensível** | Nunca senha, token, string de conexão ou dado pessoal desnecessário |
| Monitoramento de erro | Saber da falha antes do usuário |
| Monitoramento de integração | Fila do Asaas interrompida (15 falhas) e webhook não entregue precisam gerar alerta — [BILLING.md](BILLING.md#4-capacidades-dos-provedores) |
| Métrica de saúde | Latência, taxa de erro, saturação do pool |
| Alerta com destinatário definido | Alerta sem dono é ruído |

---

## 7. Preservar o que está no workspace `[DECIDIDO]`

- `tzolkin-core` agora tem Git local, inicializado com autorização do usuário em 2026-08-30. Base anterior em `main` (`c617bf0`), revisão em `codex/revisao-seguranca-core`. **Não há remoto configurado: commit local não é backup externo.**
- `tzolkin-site` está em repositório separado, branch `feat/captacao-de-leads-e-produtos`, commit `ba1d87c`. Preservar essa branch; nenhuma alteração nela faz parte da revisão do Core.
- `chatbot-api` não tem repositório git.
- `.env` de cada projeto fica fora do git e não é lido nem reproduzido em documentação.

### Conectividade do institucional em produção `[PENDENTE DE DECISÃO]`

Fechar a porta pública do banco não cria conectividade entre Vercel e a rede privada do EasyPanel. O túnel desta máquina serve ao desenvolvimento, não às funções hospedadas na Vercel.

Antes de fechar a exposição, inventariar os consumidores e aprovar um caminho de produção: endpoint PostgreSQL com TLS verificado e controle de rede adequado; conectividade privada efetivamente suportada pelo ambiente contratado; ou backend de captação hospedado junto ao banco, acessível por API HTTPS autenticada. São alternativas de arquitetura, não recursos contratados ou implementados.

Validar o caminho escolhido a partir de preview autorizado, com credencial de privilégio mínimo e dados sintéticos, antes da publicação. Não apontar a Vercel para `localhost` nem para hostname interno inacessível. PostgreSQL e Redis exigem verificação separada; não assumir que alterar um serviço corrige o outro.
