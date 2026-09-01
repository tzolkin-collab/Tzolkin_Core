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

## Deploy e verificação

- Build pelo `Dockerfile`, porta 3000, inicialmente uma réplica, health `/health`.
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
