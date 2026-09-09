# Core interno — produção protegida com Google

## Arquitetura

`Navegador → Core/EasyPanel → Google OpenID Connect` e `Core → PostgreSQL com TLS verificado`.

O Core usa Authorization Code Flow com PKCE, `state` e `nonce`. O backend troca o código diretamente com o Google e valida assinatura RS256, emissor, audiência, expiração, nonce e `email_verified`. O e-mail precisa constar em `CORE_ALLOWED_EMAILS`. Tokens do Google não são persistidos; a sessão própria guarda apenas SHA-256 do token aleatório.

## Google Cloud

1. Google Cloud Console → Google Auth Platform. Configure a tela de consentimento.
2. Crie OAuth Client do tipo Web application.
3. Authorized JavaScript origin: o valor exato de `PUBLIC_ORIGIN`.
4. Authorized redirect URI: `PUBLIC_ORIGIN/api/auth/google/callback`.
5. Guarde Client ID e Client Secret exclusivamente nos segredos do EasyPanel.
6. Se o app ficar em Testing, adicione cada operador como Test user. Em Internal, exige Google Workspace da organização.

## Variáveis obrigatórias

`PUBLIC_ORIGIN`, `GOOGLE_CLIENT_ID`, `GOOGLE_CLIENT_SECRET`, `CORE_ALLOWED_EMAILS`, `DATABASE_URL` da role `tzolkin_core_runtime` e `DATABASE_SSL=require`. A senha compartilhada não é lida em produção.

`CORE_MARKETING_KEY` (32 bytes em base64) é obrigatória para conectar a credencial de marketing. Como desenvolvimento e produção apontam para o mesmo banco, ela precisa ter **o mesmo valor nos dois ambientes**: um token cifrado com uma chave não é legível pela outra. Sem ela o painel de Campanhas abre, avisa e desabilita a conexão — não quebra.

`META_APP_ID` e `META_APP_SECRET` são opcionais. Sem elas o token é gravado, mas o Core não confere escopos nem avisa quando estiver perto de expirar; e a troca de token curto por token de longa duração fica indisponível.

### `PORT` **é** lida em produção

> Correção de 2026-09-04. A documentação anterior herdou do `.env.example` e do [SPLIT-RUNTIME.md](SPLIT-RUNTIME.md) a frase "`PORT` antigo não é mais usado". Isso vale para o **bootstrap local**, que usa `API_PORT` (3102) e `WEB_PORT` (3100). **Não vale para produção.**

`apps/api/src/production.mjs` faz `server.listen(Number(process.env.PORT||3000),'0.0.0.0')`. Consequências:

| Situação | Efeito |
|---|---|
| `PORT` ausente | Escuta em 3000. É o padrão, agora também declarado como `ENV PORT=3000` no `Dockerfile`. |
| `PORT` definida | Escuta nesse valor. O `HEALTHCHECK` do `Dockerfile` lê a mesma variável em tempo de execução e acompanha. |
| `PORT` definida e proxy do EasyPanel apontando para outra porta | **Fora do ar com a app viva**: o container responde, o proxy devolve 502. O log traz `TZOLKIN Core production ready on 0.0.0.0:<porta>` — confira contra a porta publicada. |

**Armadilha conhecida:** copiar o `.env` local inteiro para as variáveis do EasyPanel traz `PORT=3100`, valor residual do frontend do bootstrap. Ou remova a variável, ou alinhe proxy e domínio ao mesmo número. `API_PORT`, `WEB_ORIGIN` e `CORE_ADMIN_PASSWORD` não são lidos pelo entrypoint de produção.

## Deploy e verificação

- Build pelo `Dockerfile`, porta 3000 (ou o valor de `PORT`), inicialmente uma réplica, health `/health`.
- O boot tenta abrir o banco 5 vezes, com espera exponencial de 1s a 30s, e registra a causa de cada falha no formato `[boot] tentativa N/5 ... [código] mensagem` — sem credencial. Esgotadas as tentativas, sai com código 1.
- Sem HTTPS, credenciais Google, allowlist ou TLS verificado, o processo recusa iniciar.
- Conta fora da allowlist não cria sessão.
- Mutação autorizada grava `actor_subject` e `actor_email`.
- Logout revoga a sessão persistida no Core.
- `.env`, tokens e chave privada não entram na imagem.

## Rollback

Manter a imagem anterior. Reverter se login autorizado falhar, `/health` não estabilizar, 5xx superar 1% por cinco minutos ou mutação não registrar ator. Migrações 007/008 são aditivas e podem permanecer.

## Pendências antes de tráfego real

- Criar as credenciais OAuth Google e informar origem/redirect exatos.
- Criar a role PostgreSQL restrita com `scripts/configure-runtime-role.mjs`.
- Backup e restauração do banco ensaiados.
- Validar o build no EasyPanel; Docker não está instalado na estação local.
