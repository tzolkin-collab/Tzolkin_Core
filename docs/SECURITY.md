# Segurança

Identidade, permissões, segredos e auditoria. Isolamento de dados em [DATA-OWNERSHIP.md](DATA-OWNERSHIP.md#3-isolamento).

Revisão: **2026-08-30**.

---

## 1. Postura atual

> A **aplicação** é um bootstrap local: escuta só em `127.0.0.1`, recusa `NODE_ENV=production` e não deve ser publicada nem exposta por túnel.
>
> O **banco não é local.** Ver o risco aberto logo abaixo.

### O banco do Core trafega sem TLS pela internet pública

`[EXISTENTE E VERIFICADO]` — 2026-08-30. **Risco aberto, não corrigido.**

| Fato | Como foi verificado |
|---|---|
| O PostgreSQL do Core está em EasyPanel, não nesta máquina | `DATABASE_URL` inspecionada **sem imprimir o valor** |
| O host é público: nome DNS público, IPv4 público, porta 9000 | Resolução de nome e conexão bem-sucedida daqui |
| **O servidor recusa TLS** | Conexão com `ssl` exigido falha: *"The server does not support SSL connections"* — com e sem verificação de certificado |
| A string de conexão traz `sslmode=disable` | Coerente com o servidor não oferecer TLS. Não é opção do cliente |

**O que isso significa na prática:** a senha do banco e todo o conteúdo das consultas — organizações, vínculos, contratos, direitos — **trafegam em texto claro pela internet** a cada requisição, incluindo cada execução de `npm test`. Quem estiver no caminho da rede lê tudo e captura a credencial. Como a role da aplicação é **dona** das tabelas ([INFRASTRUCTURE.md](INFRASTRUCTURE.md#privilégio-da-role--lacuna-conhecida)), essa credencial permite ler, alterar e apagar a base inteira, inclusive a trilha de auditoria.

**Não é só o Core.** Conferido em 2026-08-30: os três serviços de dados do ecossistema estão no **mesmo host** EasyPanel, todos sem TLS —

| Serviço | Porta | Dono |
|---|---|---|
| PostgreSQL `tzolkin_core` | 9000 | Core |
| PostgreSQL `tzolkin_institucional` | 9000 | `tzolkin-site` (leads) |
| Redis | 1000 | `chatbot-api` |

Usuários de banco distintos, mesmo servidor exposto. Fechar a exposição resolve os três de uma vez; deixar aberto mantém os três em risco.

### Consequência direta para o `tzolkin-site` `[PENDENTE DE DECISÃO]`

> `POST /api/leads` grava **nome completo, e-mail, WhatsApp e empresa** de quem preenche o formulário público. Publicar essa rota hoje faz esse dado pessoal viajar dos servidores da Vercel até o EasyPanel **em texto claro pela internet pública**, junto da credencial do banco, a cada lead.
>
> Enquanto o Core não tem nenhum cliente real cadastrado, o institucional passaria a receber dado pessoal de terceiros no minuto seguinte à publicação. **Por isso a publicação está parada**, e não por problema no código: `tsc` limpo, 18 testes passando, build completo — verificado em 2026-08-30.

**Isto não é corrigível dentro deste repositório.** Depende de mudança na infraestrutura. O que este repositório faz é **medir, mostrar e bloquear** — [§8](#8-runbook-corrigir-o-transporte-do-banco) tem o procedimento.

Enquanto não resolvido: **tratar a senha atual do banco como comprometida** e rotacioná-la assim que houver canal seguro; e **não cadastrar cliente real** no Core, porque hoje o dado sairia em claro pela rede.

### O que o Core já faz a respeito `[EXISTENTE E VERIFICADO]`

Não conserta a exposição — impede que ela seja esquecida.

| Salvaguarda | Comportamento |
|---|---|
| Medição real do transporte | Na inicialização, `src/platform/database.mjs` tenta TLS e verifica se o socket resultante é de fato criptografado. Nada é presumido |
| `DATABASE_SSL` | `require` recusa iniciar sem criptografia (**estado-alvo**) · `allow` tenta e cai para texto claro avisando (**padrão hoje**, porque o servidor não oferece TLS) · `disable` nem tenta |
| Aviso na inicialização | Bloco destacado no console quando o transporte fica em texto claro para host remoto. **Sem hostname, sem credencial** |
| Visível no painel | Faixa vermelha permanente no topo do espaço de trabalho, em todos os contextos |
| Visível por máquina | `GET /health` devolve `database_transport`: `tls-verified`, `tls-unverified`, `plaintext` ou `unknown`. **Nunca afirma segurança sem prova** |
| Rotação bloqueada | `npm run db:rotate-password` **recusa** rodar sobre texto claro: trocar a senha por um canal que a expõe entrega a senha nova a quem já lia a antiga |
| Base de teste separável | `DATABASE_URL_TEST` faz `npm test` usar outra base. Sem ela, os testes escrevem na mesma base do cadastro |

### O que já protege `[EXISTENTE E VERIFICADO]`

Conferido no código e coberto por teste ([TESTING.md](TESTING.md)) — tudo abaixo protege a **aplicação**, e nenhum item compensa o transporte do banco:

| Proteção | Como |
|---|---|
| Senha administrativa | `scrypt` com sal fixo, comparação em tempo constante (`timingSafeEqual`). Mínimo de 24 caracteres, validado na inicialização |
| Sessão | Token aleatório de 32 bytes; **só o SHA-256 é guardado**; cookie `HttpOnly; SameSite=Strict; Path=/; Max-Age=3600`; expiração verificada **no servidor** |
| CSRF | Mutação exige `Origin` **exatamente** igual à origem do bootstrap |
| Força bruta | 10 tentativas de login por minuto |
| Superfície | Só `GET`, `POST`, `PUT`. Estáticos de lista fixa — nenhum caminho vem da URL |
| Entrada | Campo não previsto ⇒ `400`. Parâmetro de query não previsto ⇒ `400`. Corpo limitado a 16 KB. Controle de caracteres rejeitado |
| Escalonamento | Credencial de app **não** abre painel administrativo. Chamador **não escolhe** o produto |
| Cabeçalhos | CSP `default-src 'self'`, `frame-ancestors 'none'`, `nosniff`, `no-store`, `Referrer-Policy: no-referrer` |
| Vazamento de erro | Erros de banco traduzidos; nada interno na resposta |
| Descoberta de rota | Rota inexistente exige sessão antes de responder 404/405 |
| Segredo em log | Senha e string de conexão nunca são impressas. `scripts/setup.mjs` suprime detalhes até em falha |

### O que falta para produção

| Lacuna | Consequência |
|---|---|
| Senha administrativa única e global | Não há identidade individual. **Não dá para saber quem fez o quê** |
| Sessão em memória do processo | Reinício derruba todas; não escala além de um processo |
| Cookie sem `Secure` | Aceitável só porque é HTTP em loopback. Em produção, obrigatório, com HTTPS |
| Sem MFA | — |
| Limite de tentativas global e em memória | Não distingue origem; some no reinício; não vale entre instâncias |
| Sem papéis nem escopo | Todo operador é administrador global |
| Sem expiração de acesso | Colaborador temporário fica para sempre |
| Auditoria mínima | Ver [§4](#4-auditoria) |
| Sem migração versionada | [INFRASTRUCTURE.md](INFRASTRUCTURE.md#3-migrações) |
| Role da aplicação é dona das tabelas | Impede RLS eficaz sem revisão — [D5](CONTEXT.md#d5--isolamento-no-banco-só-query-ou-rlsseparação-física) |
| **Banco sem TLS na internet pública** | Credencial e dados em texto claro — [acima](#o-banco-do-core-trafega-sem-tls-pela-internet-pública) |
| Testes rodam contra a mesma base do cadastro | Não há base de desenvolvimento separada |
| `VERCEL_TOKEN` no `.env` é de **time** | Alcança e pode apagar os 8 projetos. O Core só lê, mas a credencial é ampla — trocar por escopo de projeto ([INTEGRATIONS.md](INTEGRATIONS.md#escopo-do-token--atenção)) |

---

## 2. Identidade

### Hoje `[EXISTENTE E VERIFICADO]`

- **Operador interno:** senha única em `CORE_ADMIN_PASSWORD`. Operador **global**, não cliente.
- **Pessoa de organização:** o Core guarda apenas `memberships.subject`, um identificador externo. **Não é e-mail e não é prova de autenticação** — quem autentica é o app, antes de perguntar.
- **App:** token portador por produto, hash em `app_clients`.
- **Cliente:** não existe. Sem portal, sem login, sem rota.

### D4 — Qual IdP `[PENDENTE DE DECISÃO]`

Critérios para decidir:

1. O Core **não precisa ser emissor de identidade**. Precisa ser autoridade sobre vínculo e direito. São coisas separadas.
2. Qualquer que seja o IdP, o backend valida **assinatura, emissor, audiência, expiração**, e depois **vínculo ativo e produto autorizado** — as duas últimas só o Core sabe.
3. Precisa suportar: identidade individual, participação em várias organizações e produtos, MFA, revogação e acesso temporário com expiração.
4. **Não impor stack sem comparar alternativas** (IdP gerenciado, OIDC autohospedado, identidade própria). Cada uma muda custo, prazo e dependência.

Enquanto aberto: nada de publicar o Core, e nada de credencial administrativa compartilhada como solução final.

---

## 3. Permissões `[PROPOSTO]`

Nada disso existe. Desenho mínimo para a equipe variável:

- **Identidade individual** por pessoa. Nunca conta compartilhada.
- **Participação** em várias organizações e produtos, cada uma com o próprio papel.
- **Papel + escopo**: o escopo é a organização, o produto, ou a TZOLKIN inteira.
- **Acesso temporário** com expiração obrigatória para colaborador variável — expira sozinho, sem depender de alguém lembrar.
- **Revogação imediata**, valendo na próxima verificação.
- **Toda concessão e revogação auditada**, com ator.
- **Nenhum nome ou quantidade de pessoas em código** — [CONTEXT.md §3](CONTEXT.md#3-restrições-que-não-se-negociam-decidido), regra 9.

Até existir, o recorte por produto na interface é **conforto visual, não contenção de segurança** — está dito também em [DATA-OWNERSHIP.md](DATA-OWNERSHIP.md#lacunas-conhecidas).

---

## 4. Auditoria

### Hoje `[EXISTENTE E VERIFICADO]`

`audit_events(id, type, tenant_id, created_at)`, gravado **na mesma transação** da mutação. Tipos: `tenant.created`, `tenant.status_changed`, `membership.changed`, `entitlement.changed`.

A garantia real é a atomicidade: **não existe mutação sem trilha**.

### Lacunas

| Falta | Por que importa |
|---|---|
| **Ator** | Com senha única não há quem registrar. Depende de [D4](#d4--qual-idp-pendente-de-decisão) |
| **O que mudou** | Só o tipo é gravado; não o antes/depois |
| **Produto** | `entitlement.changed` não diz de qual produto |
| **Leitura e exportação** | Não são auditadas. Exportação é acesso a dado |
| **Retenção e proteção** | Sem política; a role da aplicação pode apagar a própria trilha |

Ao evoluir: ator, ação, alvo, antes/depois, origem, correlação da requisição; **append-only**, com a role da aplicação sem `DELETE`.

---

## 5. Segredos

### Regras `[DECIDIDO]`

1. **Nunca em código, nunca em documentação, nunca em log, nunca em prompt.**
2. `.env` fora do git (já em `.gitignore`) e nunca compartilhado — contém também a string de conexão.
3. **`.env.example` documenta nome, finalidade e obrigatoriedade. Nunca valor.**
4. Segredo de banco de produção não entra em preview de terceiro.
5. Token de serviço nunca chega ao frontend; do lado do Core, só o hash é guardado.
6. Rotação possível sem redeploy do consumidor.

### Variáveis `[EXISTENTE E VERIFICADO]`

Nomes e finalidade em [`.env.example`](../.env.example). São três: `DATABASE_URL`, `CORE_ADMIN_PASSWORD`, `PORT`. Nenhum valor foi lido ou reproduzido nesta documentação.

---

## 6. Critérios de aceitação de segurança `[DECIDIDO]`

Herdados da revisão cruzada anterior. Valem para o Core e para qualquer app que consuma `/v1/context`.

1. Token vencido, audiência errada, usuário removido ou tenant forjado são **rejeitados no backend**.
2. Usuário A não lê, altera nem exporta dado do tenant B — **inclusive por ID direto e por job**.
3. Revogação vale dentro da janela aprovada; evento antigo não reativa direito.
4. Core indisponível **não libera permissão nova**; cache só vale enquanto vigente e adequado ao risco.
5. Evento duplicado ou fora de ordem não duplica efeito nem retrocede estado.

Cobertura atual em [TESTING.md](TESTING.md). Os itens 3 e 5 só ficam plenamente exercitáveis quando houver eventos.

---

## 7. Antes de publicar o Core

Lista de bloqueio. Enquanto qualquer item estiver aberto, **não publicar**:

- [ ] **Transporte do banco resolvido** ([acima](#o-banco-do-core-trafega-sem-tls-pela-internet-pública)) e senha rotacionada — precede todo o resto
- [ ] Base de desenvolvimento separada da que guarda o cadastro
- [ ] IdP definido e implementado ([D4](#d4--qual-idp-pendente-de-decisão)); fim da senha administrativa única
- [ ] MFA para operador interno
- [ ] HTTPS obrigatório e cookie `Secure`
- [ ] Sessões persistentes, com revogação
- [ ] Papéis e escopos ([§3](#3-permissões-proposto))
- [ ] Auditoria com ator e alterações ([§4](#4-auditoria))
- [ ] Proteção de abuso distribuída, não em memória de processo
- [ ] Defesa de isolamento no banco ([D5](CONTEXT.md#d5--isolamento-no-banco-só-query-ou-rlsseparação-física))
- [ ] Credencial de banco com privilégio mínimo, separada da que aplica migração
- [ ] Migrações versionadas, backup e restauração **testada** ([INFRASTRUCTURE.md](INFRASTRUCTURE.md))
- [ ] Monitoramento de erro e de integrações
- [ ] Deploy e rollback documentados e ensaiados

---

## 8. Runbook: corrigir o transporte do banco

`[PROPOSTO]` — passos no EasyPanel, que **só o usuário executa**. Nenhuma alteração de infraestrutura foi feita por esta sessão.

Conforme a documentação do EasyPanel, **serviços PostgreSQL são privados por padrão**: ficam só na rede interna do projeto, alcançáveis pelo hostname interno na porta 5432. A exposição pública é opcional, feita na aba **Expose**, e foi ativada em algum momento — é ela que publica a porta 9000 no servidor.

### Opção 1 — Tirar da internet (recomendada)

Elimina a exposição, não apenas a interceptação. É também o que a documentação do EasyPanel recomenda.

1. Nos serviços **PostgreSQL** e **Redis**, desligar a exposição pública na aba **Expose**.
2. Apps que rodam no mesmo EasyPanel passam a usar a **URL interna** da aba *Credentials* — rede privada, sem passar pela internet.
3. Para desenvolvimento nesta máquina, alcançar o banco por **túnel autenticado** (SSH ou WireGuard) até o servidor, e apontar a `DATABASE_URL` para o `127.0.0.1` local do túnel.
4. Com o túnel, `describeTarget` passa a ver loopback e o aviso some — **corretamente**, porque o tráfego passa a ir cifrado pelo túnel.
5. Rodar `npm run db:rotate-password` (agora vai deixar) e conferir que `npm start` sobe sem o bloco de aviso.

### Opção 2 — Manter exposto, com TLS

Protege o tráfego, mas a porta segue aberta ao mundo: varredura e força bruta continuam possíveis.

1. Habilitar TLS no serviço PostgreSQL (certificado e `ssl = on` na configuração do contêiner).
2. Restringir a porta no firewall do servidor/provedor aos IPs que precisam — a própria documentação do EasyPanel recomenda isso somado a uma porta publicada única.
3. Trocar a `DATABASE_URL` para `sslmode=verify-full` e definir `DATABASE_SSL=require` no `.env`.
4. `npm start` deve subir sem aviso; `GET /health` deve responder `tls-verified`. Se responder `tls-unverified`, o certificado não está sendo validado — **não parar aí**.
5. Rotacionar a senha.

### Depois de qualquer das opções

- [ ] `GET /health` reporta `tls-verified` (ou o host é loopback via túnel)
- [ ] `npm start` sobe sem o bloco de aviso, e a faixa some do painel
- [ ] Senha rotacionada por canal seguro; `.env.bak` apagado depois de conferir
- [ ] `DATABASE_SSL=require` fixado no `.env`, para não regredir em silêncio
- [ ] `DATABASE_URL_TEST` apontando para base separada, para os testes pararem de escrever na base do cadastro
- [ ] Verificar se mais alguma porta de banco está publicada no EasyPanel além dessas duas
