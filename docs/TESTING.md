# Testes

Estratégia, comandos e cobertura.

Revisão: **2026-09-03**.

Verificação atual em 2026-09-03: `npm run test:unit` passou com **123/123 testes** e `npm test`
passou com **237/237 testes**, incluindo PostgreSQL real e endpoints de webhook.

---

## 1. Estratégia `[EXISTENTE E VERIFICADO]`

**Integração contra PostgreSQL real, não simulação.** Cada suíte sobe um servidor Core numa porta efêmera de loopback e conversa com ele por HTTP, como um cliente de verdade.

Por quê: o que precisa ser garantido — isolamento, negação de acesso, atomicidade de transação, restrições do banco — não sobrevive a *mock*. Um teste que simula o banco não prova isolamento nenhum.

**Regras das suítes:**

| Regra | Como |
|---|---|
| Base separada quando houver | `DATABASE_URL_TEST` tem precedência sobre `DATABASE_URL`. **Sem ela, os testes escrevem na mesma base do cadastro** — hoje é o caso |
| Só registro sintético | Nomes e `slug` únicos por execução (`randomUUID`) |
| Limpeza obrigatória | Bloco `finally` remove exatamente o que a execução criou |
| Nunca toca dado existente | Remoção por lista de ids da própria execução, nunca por critério amplo |
| Tempo controlado | `clock` injetável, para testar expiração sem esperar uma hora |
| Sem efeito externo | Nenhum e-mail, cobrança ou chamada a provedor |

---

## 2. Comandos

Verificação segura desta revisão, sem `.env`, banco ou provedor externo:

```bash
npm run test:unit
```

**18/18 aprovados em 2026-08-30 (Codex).** Cobrem política TLS com driver simulado, configuração efetiva do driver `pg` sem conectar, negação de downgrade/conflitos, guarda de rotação e formato de `/v1/context`. Não provam certificado do servidor real, isolamento no PostgreSQL ou infraestrutura corrigida.

Após a entrega do inventário EasyPanel: **25/25 unitários aprovados**, incluindo 7 novos testes em `test/unit/easypanel.test.mjs`. A API HTTP do Core é exercitada em loopback com sessão real e pool que recusa consultas; o provedor é simulado. Sem banco remoto, sem credencial real e sem prova de compatibilidade com a versão do painel do usuário.

As suítes abaixo são integrações separadas; `npm test` não inclui `test/unit/`. Execute ambos para uma verificação completa, usando base dedicada para integração.

Após configurar a chave do EasyPanel: **27/27 unitários aprovados**. Dois testes novos cobrem o formato real de listas separadas, descarte de segredos, serviços órfãos e projetos duplicados. Consulta real de leitura pelo adaptador confirmada com 3 projetos e 9 serviços; nenhuma alteração remota executada.

```bash
npm test
```

Roda `node --env-file=.env --test "test/**/*.test.mjs"`. Exige o banco preparado e **migrado** ([INFRASTRUCTURE.md](INFRASTRUCTURE.md#preparação-do-core-existente-e-verificado)) e o catálogo importado — a suíte principal confere as 16 migrações.

Uma suíte isolada:

```bash
node --env-file=.env --test test/product-console.test.mjs
```

---

## 3. Cobertura atual `[EXISTENTE E VERIFICADO]`

**108 cenários, 108 aprovados** — execução de 2026-08-31, já com TLS verificado no banco. O teste de `require` aceita tanto rejeição segura quanto TLS realmente verificado, sem depender de o servidor continuar inseguro.

> **Correção de 2026-08-31.** O script rodava `test/*.test.mjs`, que **não casa subpastas**: os 5 arquivos em `test/unit/` nunca eram executados, e a contagem de 69 omitia 39 cenários. O glob passou a ser `test/**/*.test.mjs`. Suíte que não roda não é rede de proteção — é a ilusão de uma.

### `test/core.test.mjs` — segurança e contrato (21)

| Cenário | Prova |
|---|---|
| `/health` confirma banco | Processo e conexão vivos |
| `/api/overview` e `/api/ecosystem` sem sessão ⇒ 401 | Sem leitura anônima |
| Login de outra origem ⇒ 403 | Proteção CSRF |
| Senha errada ⇒ 401 | |
| Login emite cookie `HttpOnly` + `SameSite=Strict` | |
| Catálogo com 6 produtos, 7 atalhos e sem campo secreto | Importação íntegra |
| Campo não previsto em `tenants` ⇒ 400 | Entrada estrita |
| Cria duas organizações isoladas | |
| Vínculo e contrato persistem; `/v1/context` devolve os direitos | Caminho feliz ponta a ponta |
| Credencial de app em rota administrativa ⇒ 401 | **Sem escalonamento** |
| Outra organização sem vínculo ⇒ 403 | **Isolamento entre organizações** |
| Chamador tenta escolher `product_id` ⇒ 400 | **Produto vem da credencial** |
| Revogar vínculo nega na consulta seguinte | **Sem cache** |
| Vínculo sem produto ⇒ 400 | Produto é obrigatório no vínculo |
| Vínculo em um produto **não** abre outro produto da mesma organização | **Sem acesso cruzado**, garantido pelo Core |
| Revogar contrato incrementa `version` e nega | Monotonicidade |
| Suspender organização nega o acesso | |
| Sessão expirada ⇒ 401 **no servidor** | Expiração não é do navegador |
| Tentativas de login limitadas ⇒ 429 | |

### `test/deploys.test.mjs` — integração de deploys (18)

Roda contra um **stub HTTP local** que imita a Vercel: nenhuma chamada sai da máquina, nenhuma conta é tocada, nenhum deploy é disparado.

| Cenário | Prova |
|---|---|
| Token vai como `Bearer`, `projectId` na query | Contrato com o provedor |
| `teamId` só quando explicitamente configurado | Token de time/projeto dispensa |
| Projetos sem repositório Git são sinalizados | Sem repo não há commit nem Deploy Hook |
| Normaliza só o que o painel usa | **E-mail de quem commitou não sai do adaptador** |
| Corpo de commit longo vira assunto | Painel não é git log |
| 401/429/5xx viram mensagem própria | **Credencial e corpo bruto nunca vazam no erro** |
| Registro só existe com token configurado | Sem chave vazia mandada ao provedor |
| `/api/deploys` sem sessão ⇒ 401; query inesperada ⇒ 400 | |
| Sem provedor ⇒ estado vazio honesto, não erro | |
| **Todo projeto aparece, inclusive sem nenhum deploy** | Regressão do defeito encontrado na conferência |
| Um projeto falhando não derruba os outros | Resposta declara `incomplete` |
| Provedor fora do ar degrada o painel, não quebra | Continua 200, com `status: error` |
| Cache de 30s poupa o provedor, e expira | |
| **`POST` e `PUT` em `/api/deploys` ⇒ 405** | O endpoint não escreve |

### `test/database-policy.test.mjs` — transporte do banco (14)

| Cenário | Prova |
|---|---|
| Loopback distinguido de host remoto | A base do veredito `insecure` |
| `sslmode` da URL é reportado, não ignorado | Intenção explícita é respeitada |
| `DATABASE_SSL` inválido e `DATABASE_URL` ausente ⇒ erro | Configuração não silencia |
| **`require` rejeita transporte inadequado ou retorna TLS verificado** | Não depende de o servidor real continuar sem TLS; falhas determinísticas cobertas em `test/unit/` |
| `allow` conecta e reporta o transporte com honestidade | `insecure = texto claro E host remoto` |
| Aviso só aparece quando inseguro, **e não contém hostname nem credencial** | Aviso não vira vazamento |
| `DATABASE_URL_TEST` tem precedência | Base de teste separável |
| `/health` reporta `plaintext` / `tls-verified` / `tls-unverified` / **`unknown` quando não medido** | **Nunca afirmar segurança sem prova** |
| `/api/overview` carrega o estado, sem host nem credencial | O operador vê no painel |

### `test/product-console.test.mjs` — contexto de produto (16)

| Cenário | Prova |
|---|---|
| Anônimo ⇒ 401 | |
| Credencial de app ⇒ 401 | Rota é do operador, não do produto |
| Produto inexistente ⇒ 404; formato inválido ⇒ 400 | Inclui maiúscula e início com dígito |
| Parâmetro de query não previsto ⇒ 400 | |
| Produto sem contratos devolve zeros e lista vazia | **Estado vazio real, sem dado inventado** |
| Só lista organizações com contrato **daquele** produto | **Isolamento entre produtos** — a de `sites` não aparece em `barber` nem em `educare` |
| Devolve plano, direitos, status e contagem de vínculos | |
| Declara `membership_scope: "product"` | Torna o escopo do vínculo verificável pelo consumidor |
| Pessoas contadas por produto, não por organização | Vínculo em `sites` não conta no `commerce` da mesma organização |
| Contrato revogado continua visível e sai do total ativo; `version` incrementa | Histórico preservado |
| Organização suspensa é sinalizada e sai do total ativo | Mesmo critério de `/v1/context` |
| Produto catalogado traz a ficha do Notion; não catalogado traz `null` | Ausência não é erro nem invenção |
| Sessão expirada ⇒ 401 no servidor | |

---

## 4. Lacunas de cobertura

Conhecidas e não disfarçadas:

| Lacuna | Por quê |
|---|---|
| **Frontend não tem teste automatizado** | Verificado à mão: desktop 1440×900 e mobile 375×812, em 2026-08-30 — [§5](#5-conferência-visual) |
| Reversão de migração | Não há caminho de volta documentado ([INFRASTRUCTURE.md](INFRASTRUCTURE.md#3-migrações)) |
| Concorrência | Duas alterações simultâneas do mesmo contrato não são exercitadas |
| Volume | Nenhum teste com cadastro grande; `/api/overview` não tem paginação |
| Eventos duplicados/fora de ordem | Não há eventos ainda ([SECURITY.md](SECURITY.md#6-critérios-de-aceitação-de-segurança-decidido), critério 5) |
| Financeiro | Não há código financeiro |
| Isolamento no banco | Só isolamento por query é testado; não há RLS ([D5](CONTEXT.md#d5--isolamento-no-banco-só-query-ou-rlsseparação-física)) |
| Contraste e leitor de tela | Não medidos — [DESIGN-SYSTEM.md](DESIGN-SYSTEM.md#7-acessibilidade-existente-e-verificado) |
| Restauração de backup | Há 16 backups PostgreSQL agendados, mas nenhum ensaio de restauração registrado ([INFRASTRUCTURE.md](INFRASTRUCTURE.md#4-backup-e-restauração-proposto)) |

---

## 5. Conferência visual

Feita em 2026-08-30 numa **instância descartável** na porta 3199, com senha gerada na hora e registros sintéticos (`slug` com prefixo `preview-`), pelo mesmo método das suítes. Os registros foram **removidos ao final** e o banco voltou ao estado anterior — conferido por contagem: `tenants`, `memberships`, `entitlements`, `audit_events`, `app_clients` = 0; `products` = 6; `ecosystem_entries` = 13.

Verificado: login; gestão geral com métricas e carteira; troca para contexto de produto; recorte correto (organização de `sites` ausente em `barber`); contrato revogado e organização suspensa exibidos sem cor de sucesso e fora do total ativo; produto sem contratos com estado vazio honesto; ficha do Notion presente; formulário de contrato com produto pré-selecionado pelo contexto; troca de contexto limpando a tela antes de consultar; sair encerrando a sessão; foco de teclado visível; layout em desktop e mobile.

Duas correções saíram daí: a contagem de direitos passou a usar o mesmo critério de `/v1/context` (contrato ativo **e** organização ativa), e a troca de contexto passou a fechar formulário aberto.

Segunda passagem, após o vínculo por produto: formulário de acesso com seletor de produto, lista de acessos exibindo o produto de cada vínculo, e a métrica "Pessoas alcançadas" com o auxiliar *com vínculo neste produto*.

**Ao repetir:** se a autenticação impedir a conferência, peça ao usuário para entrar. **Não contorne a proteção.**

---

## 6. Ao acrescentar teste

1. Regra nova de segurança ou isolamento **nasce com teste**. Testes isolados vão em `test/unit/`; isolamento real continua exigindo PostgreSQL dedicado.
2. Provar **negação**, não só o caminho feliz.
3. Registro sintético identificável e removido no `finally`.
4. Nunca remover por critério amplo — sempre pelos ids da execução.
5. Nada de efeito externo. Provedor financeiro: só sandbox, e só com autorização específica.
6. Arquivo em `test/**/*.test.mjs` — inclusive em subpasta — já entra em `npm test`, sem editar `package.json`.
