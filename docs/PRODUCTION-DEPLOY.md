# Core interno — produção protegida

## Arquitetura escolhida

`Navegador → Cloudflare Access (identidade + MFA + política) → EasyPanel/Core → PostgreSQL TLS verificado`.

Painel e API compartilham uma origem. A API revalida o JWT do Access (RS256, `iss`, `aud`, expiração) e a allowlist. O hostname direto do EasyPanel não concede acesso: sem assertion válido, a API retorna 401. Assets são públicos e não contêm configuração ou dados.

## Pré-deploy obrigatório

1. Criar aplicação Self-hosted no Cloudflare Zero Trust para o domínio do Core.
2. Política Allow: somente grupo/e-mails internos; exigir MFA no provedor de identidade. Não usar Bypass.
3. Copiar Team domain e Application Audience (`AUD`). Fixar `CORE_ALLOWED_EMAILS` ou `CORE_ALLOWED_DOMAIN` também no backend.
4. EasyPanel: build do `Dockerfile`, porta 3000, uma réplica inicialmente, health `/health`.
5. Variáveis obrigatórias: `NODE_ENV=production`, `PUBLIC_ORIGIN`, `CF_ACCESS_TEAM_DOMAIN`, `CF_ACCESS_AUD`, allowlist, `DATABASE_URL`, `DATABASE_SSL=require`, credenciais Pluggy/EasyPanel/Vercel necessárias. `CORE_ADMIN_PASSWORD` não é usado em produção.
6. O `PUBLIC_ORIGIN` precisa ser exatamente o domínio HTTPS coberto pelo Access. Mutações recusam outros Origins.
7. Aplicar migrações antes da troca de tráfego. A 007 é aditiva e registra o ator.

## Verificação

- Container recusa iniciar sem HTTPS, Access audience, allowlist ou TLS verificado no banco.
- Requisição direta à API sem assertion → 401.
- Usuário fora da allowlist → 401 mesmo autenticado no Access.
- Operador autorizado + MFA → painel; mutação grava `actor_subject`/`actor_email`.
- Logout encerra sessão do Access.
- `.env`, tokens e chave privada não entram na imagem (`.dockerignore`).

## Rollback

Manter a imagem/commit anterior no EasyPanel. Reverter tráfego se login autorizado falhar, `/health` não ficar estável, taxa 5xx superar 1% em 5 minutos, ou uma mutação não registrar ator. A migração 007 é aditiva e pode permanecer no rollback; não apagar colunas durante incidente.

## Pendências que impedem tráfego real

- Cloudflare Access criado e testado com MFA.
- Domínio definitivo e DNS proxied.
- Role de runtime sem propriedade das tabelas e sem `DELETE` em auditoria.
- Backup e restauração do PostgreSQL ensaiados.
- Build da imagem validado pelo EasyPanel (Docker não está instalado na estação local).
