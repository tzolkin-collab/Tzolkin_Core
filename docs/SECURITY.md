# Segurança

Identidade, permissões, segredos e auditoria. Isolamento de dados em [DATA-OWNERSHIP.md](DATA-OWNERSHIP.md#3-isolamento).

Revisão: **2026-08-30**.

---

## 1. Postura atual

### Perfil de produção preparado — Google OpenID Connect

O entrypoint de produção não aceita senha compartilhada. Exige HTTPS, credenciais OAuth Google e allowlist explícita. Usa Authorization Code + PKCE, `state` e `nonce`; valida assinatura RS256, emissor, audiência, expiração e e-mail verificado.

Tokens Google não são persistidos. A sessão do Core é persistente e revogável e guarda apenas o hash do token. Auditoria registra `actor_subject` e `actor_email`; registros históricos permanecem nulos.

Variáveis: `PUBLIC_ORIGIN`, `GOOGLE_CLIENT_ID`, `GOOGLE_CLIENT_SECRET` e `CORE_ALLOWED_EMAILS`. Migrações 007/008 são aditivas.

> A **aplicação** é um bootstrap local: escuta só em `127.0.0.1`, recusa `NODE_ENV=production` e não deve ser publicada nem exposta por túnel.
>
> O **banco não é local.** Seu transporte foi corrigido; os demais requisitos de produção continuam pendentes.

### Estado atual do transporte — corrigido em 2026-08-30 (2026-08-31 UTC)

Core conectado com **TLS 1.3, certificado e hostname verificados**. Senha da role exclusiva rotacionada; a senha antiga e novas conexões sem TLS foram testadas e rejeitadas. `/health` responde `tls-verified`. O padrão do código é `require`, sem fallback.

Detalhes, backup, renovação do certificado próprio e reversão: [POSTGRES-TLS.md](POSTGRES-TLS.md).

O servidor ainda aceita conexões legadas de outras roles. Institucional e Redis não foram migrados nesta manutenção; formulários do institucional continuam desabilitados. Não interpretar esta correção como liberação do Core para produção.

### O banco do Core trafega sem TLS pela internet pública

`[HISTÓRICO — diagnóstico anterior à correção acima]` — o relato até a próxima seção de salvaguardas descreve o estado anterior; não representa a conexão atual do Core.

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

Usuários de banco distintos, mesmo servidor exposto. Cada serviço precisa de transporte e conectividade verificados separadamente. Fechar portas sem preparar os consumidores pode interromper os apps; ver [conectividade de produção](INFRASTRUCTURE.md#conectividade-do-institucional-em-produção-pendente-de-decisão).

### Consequência direta para o `tzolkin-site` `[PENDENTE DE DECISÃO]`

> `POST /api/leads` grava **nome completo, e-mail, WhatsApp e empresa** de quem preenche o formulário público. Publicar essa rota hoje faz esse dado pessoal viajar dos servidores da Vercel até o EasyPanel **em texto claro pela internet pública**, junto da credencial do banco, a cada lead.
>
> Enquanto o Core não tem nenhum cliente real cadastrado, o institucional passaria a receber dado pessoal de terceiros no minuto seguinte à publicação. **Por isso a publicação está parada**, e não por problema no código: `tsc` limpo, 18 testes passando, build completo — verificado em 2026-08-30.

**Isto não é corrigível dentro deste repositório.** Depende de mudança na infraestrutura. O que este repositório faz é **medir, mostrar e bloquear** — [§8](#8-runbook-tls-no-postgresql-do-easypanel) tem o procedimento.

Enquanto não resolvido: **tratar a senha atual do banco como comprometida** e rotacioná-la assim que houver canal seguro; e **não cadastrar cliente real** no Core, porque hoje o dado sairia em claro pela rede.

### O que o Core já faz a respeito `[EXISTENTE E VERIFICADO]`

Além da correção de infraestrutura documentada acima, mantém as seguintes verificações.

| Salvaguarda | Comportamento |
|---|---|
| Medição real do transporte | Na inicialização, `src/platform/database.mjs` tenta TLS e verifica se o socket resultante é de fato criptografado. Nada é presumido |
| `DATABASE_SSL` | `require` exige TLS com certificado e hostname verificados, sem fallback; rejeita URL conflitante · `allow` mantém diagnóstico legado, respeitando exigências TLS da URL · `disable` não tenta TLS e rejeita URL que o exija |
| Aviso na inicialização | Bloco destacado no console quando o transporte fica em texto claro para host remoto. **Sem hostname, sem credencial** |
| Visível no painel | Faixa vermelha permanente no topo do espaço de trabalho, em todos os contextos |
| Visível por máquina | `GET /health` devolve `database_transport`: `tls-verified`, `tls-unverified`, `plaintext` ou `unknown`. **Nunca afirma segurança sem prova** |
| Rotação bloqueada | `npm run db:rotate-password` exige `require` e recusa texto claro, TLS não verificado e estado desconhecido, inclusive em loopback |
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
| Migrações sem reversão documentada e sem role separada | Migrações numeradas já existem — [INFRASTRUCTURE.md](INFRASTRUCTURE.md#3-migrações) |
| Role da aplicação é dona das tabelas | Impede RLS eficaz sem revisão — [D5](CONTEXT.md#d5--isolamento-no-banco-só-query-ou-rlsseparação-física) |
| Porta pública e outros consumidores legados | Core está com TLS verificado; firewall, migração dos demais apps e Redis continuam pendentes |
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

Nomes e finalidade em [`.env.example`](../.env.example), incluindo conexão, política TLS, banco de testes e integração Vercel. Esse arquivo é a fonte da lista de variáveis; nenhum segredo é reproduzido aqui.

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

- [x] **Transporte do Core resolvido** com TLS verificado e senha rotacionada — [registro](POSTGRES-TLS.md)
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

## 8. Runbook: TLS no PostgreSQL do EasyPanel

Procedimento completo. Os passos 1–5 são no servidor, pelo painel do EasyPanel; o 6 é em cada cliente.

**Estado em 2026-08-31:** feito para o banco `tzolkin_core`. Falta o `tzolkin_institucional` — [§8.9](#89-o-que-ainda-falta).

### Antes de começar

- **Backup.** Aba *Backups* do serviço, ou `pg_dump`. Os passos 3 e 5 reiniciam ou recarregam o PostgreSQL.
- **Saiba o hostname exato que os clientes usam.** O certificado tem de casar com ele: `verify-full` valida o nome contra o SAN. Errar aqui faz todo cliente recusar a conexão depois.
- O serviço Postgres do EasyPanel roda a **imagem oficial** do PostgreSQL, com os dados em `/var/lib/postgresql/data` dentro do contêiner (e em `/etc/easypanel/projects/<projeto>/<serviço>/data` no host).

### 1. Gerar certificado e chave

Abra **Overview → Shell → Bash** no serviço Postgres e gere o par **dentro do diretório de dados**:

```bash
cd /var/lib/postgresql/data
openssl req -new -x509 -nodes -days 3650 \
  -subj "/CN=SEU-HOSTNAME/O=Tzolkin" \
  -addext "subjectAltName=DNS:SEU-HOSTNAME" \
  -keyout server.key -out server.crt
```

- `CN` **e** `subjectAltName` precisam ser o hostname que o cliente digita. Clientes modernos validam o SAN, não o CN.
- **Os nomes `server.crt` e `server.key` importam:** são os valores padrão de `ssl_cert_file` e `ssl_key_file`, relativos ao diretório de dados. Usando esses nomes, não é preciso configurar caminho nenhum.
- Autoassinado é adequado aqui: a confiança vem de você distribuir o `.crt` aos clientes, não de uma CA pública.
- Validade: escolha longa e **anote o vencimento**. Com `verify-full`, certificado vencido não degrada — derruba a conexão.

### 2. Ajustar as permissões

```bash
chown postgres:postgres server.key server.crt
chmod 0600 server.key
```

O PostgreSQL **recusa iniciar** se a chave for mais permissiva que `0600` (ou `0640` com dono `root`). É a causa mais comum de o serviço não voltar depois deste procedimento.

### 3. Ligar o TLS

Ainda no Shell, acrescente ao `postgresql.conf` do diretório de dados:

```bash
echo "ssl = on" >> /var/lib/postgresql/data/postgresql.conf
```

Existe a alternativa de sobrescrever o comando em **Advanced** (`postgres -c ssl=on`). A própria documentação do EasyPanel pede cautela com override de comando, e editar o `postgresql.conf` persiste no volume de dados e sobrevive a redeploys. Prefira o arquivo.

### 4. Reiniciar e conferir

**Overview → Stop**, depois **Start**. Acompanhe os logs na própria aba: se a chave estiver com permissão errada ou o certificado malformado, o PostgreSQL falha ao subir e diz o motivo.

Confirme de um cliente que o TLS passou a ser oferecido, antes de exigir no passo seguinte.

### 5. Exigir TLS — sem isto, nada muda de fato

**`ssl = on` apenas oferece TLS. Não proíbe texto claro.** Um cliente com `sslmode=disable` continua entrando sem criptografia, e é assim que a maioria dos aplicativos está configurada por padrão.

Para exigir, edite o `pg_hba.conf` do diretório de dados e troque `host` por **`hostssl`** nas linhas que atendem conexões externas:

```
hostssl   tzolkin_core   tzolkin_core_app   0.0.0.0/0   scram-sha-256
```

Recarregue sem reiniciar:

```bash
psql -U postgres -c "SELECT pg_reload_conf();"
```

> **Cuidado para não se trancar para fora.** As URLs internas que o EasyPanel gera usam `sslmode=disable`, porque atravessam só a rede privada. Se você aplicar `hostssl` a *tudo*, os aplicativos hospedados no próprio EasyPanel param de conectar. Por isso a regra é escrita por banco e por usuário — exija TLS nas conexões que vêm de fora e deixe a rede interna como está.

### 6. Configurar cada cliente

O `server.crt` é **público** — pode ser copiado e versionado à vontade. O `server.key` **nunca** sai do servidor.

```
postgres://usuario:senha@HOST:PORTA/base?sslmode=verify-full&sslrootcert=/caminho/absoluto/server.crt
```

- `verify-full` valida a cadeia **e** o hostname. É o único nível que protege contra um servidor se passando por outro.
- Use **caminho absoluto**: caminho relativo depende do diretório de onde o processo subiu.
- Onde o cliente não lê arquivo do disco de forma confiável — funções serverless, por exemplo —, passe o PEM por variável de ambiente e entregue ao driver (`ssl: { ca: process.env.DB_CA_CERT }`).

No Core, fixe também `DATABASE_SSL=require` no `.env`: assim a aplicação recusa subir se o transporte regredir.

### 7. Verificar de verdade

Não confie na ausência de erro. Confirme os dois lados:

```bash
npm start          # deve subir sem o bloco de aviso
curl -s http://127.0.0.1:3100/health    # database_transport: "tls-verified"
```

E confirme que texto claro **é recusado** — conectando com `sslmode=disable`, a resposta esperada é `pg_hba.conf rejects connection ... no encryption`. Se conectar, o passo 5 não pegou naquele usuário.

### 8. Depois

- **Rotacione a senha.** Ela trafegou em texto claro por tempo indeterminado: trate como comprometida. `npm run db:rotate-password` — o script exige TLS verificado e agora deixa rodar.
- **Firewall.** TLS resolve interceptação e roubo de credencial; **não** resolve exposição. A porta segue aberta à internet, e varredura e força bruta continuam possíveis. A documentação do EasyPanel recomenda restringir a porta no firewall do servidor ou do provedor.
- **Agende o vencimento do certificado.**

### 8.9 O que ainda falta

Conferido em 2026-08-31 medindo as conexões:

| Item | Estado |
|---|---|
| `tzolkin_core` exige TLS | ✅ texto claro recusado pelo `pg_hba.conf`; `/health` responde `tls-verified` |
| `tzolkin_institucional` **oferece** TLS | ✅ o mesmo certificado serve — é o mesmo servidor |
| `tzolkin_institucional` **exige** TLS | ❌ falta o passo 5 para o usuário do institucional |
| Cliente do `tzolkin-site` | ❌ `.env.local` ainda com `sslmode=disable`: conecta em texto claro |
| `DATABASE_URL` de produção na Vercel | ❓ é `sensitive`, não legível. Provavelmente `disable`, e precisa do certificado por variável de ambiente |
| `sslrootcert` do Core | ⚠ caminho relativo — quebra se o processo subir de outro diretório |
| Senha do banco | ⚠ trafegou em claro; rotação destravada, ainda não feita |
| Porta 9000 | ⚠ continua publicada na internet |

Ordem sugerida: passo 5 para o institucional → cliente do site → variável na Vercel → rotação de senha → firewall.
