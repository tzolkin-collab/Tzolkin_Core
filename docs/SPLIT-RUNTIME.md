# Frontend e API separados

`[EXISTENTE E VERIFICADO]` 2026-08-31. Workspaces npm, diretórios e processos independentes. A separação preserva contratos HTTP e interface; não introduz framework nem libera publicação do bootstrap.

| Parte | Diretório | Porta local | Responsabilidade |
|---|---|---|---|
| Web | `apps/web` | 3100 | Assets públicos e proxy local de origem única |
| API | `apps/api` | 3102 | Sessões, autorização, banco e integrações |
| Ferramentas | `db`, `scripts`, `test` | — | Migrações e testes do monorepo |

O web não importa módulos da API e não depende de `pg`. A API não lê nem serve assets do frontend. A dependência `pg` no root é de desenvolvimento, para testes; o pacote da API declara sua dependência de execução.

## Executar

Na raiz, `npm start` inicia os dois processos. Alternativamente, use `npm run start:api` e `npm run start:web` em terminais independentes. O orquestrador local encerra o outro processo se um deles falhar; não é supervisor de produção.

O `.env` da raiz é carregado **apenas pela API**. Certificados relativos e scripts de banco continuam executados a partir da raiz. `PORT` antigo não é usado. Portas alternativas: `API_PORT` e `WEB_ORIGIN` na configuração da API; `WEB_PORT` e `API_ORIGIN` no ambiente do processo web. Mantenha os valores coerentes. O web deliberadamente não lê o arquivo de credenciais. Os padrões são 3100/3102.

## Comunicação e segurança

O navegador chama `/api/*`, `/v1/*` e `/health` na origem do web. O proxy encaminha somente essas rotas à API local fixa. Não há CORS aberto nem reescrita de Origin para contornar CSRF.

- Proxy somente para `http://127.0.0.1:<porta>`, sem credenciais, query ou caminho na origem configurada.
- Host do web conferido contra seu endereço local exato; sem confiar em headers de proxy enviados pelo cliente.
- POST/PUT exigem origem exata nas duas camadas. Cookies continuam `HttpOnly; SameSite=Strict`; a sessão mora exclusivamente na API. Reiniciar apenas o web não encerra a sessão.
- Apenas headers de autenticação/origem/conteúdo necessários são encaminhados. Nenhum token de provedor vai ao frontend.
- Allowlist de arquivos públicos, corpo de proxy limitado a 16 KiB, timeout e erro genérico quando a API está offline. Nenhum log de corpo/token.
- API não atende `/` ou `/app.js`. Banco continua exigindo TLS verificado.

## Verificação

`npm run test:unit` inclui `test/unit/web-api.test.mjs`: web e API distintos, assets, isolamento, login, cookies, CSRF, limite de corpo, logout e API offline. Imports dos testes existentes foram atualizados. A suíte completa contra PostgreSQL deve preferir `DATABASE_URL_TEST`; o teste de proxy usa memória.

Preview sintético: `node scripts/preview-delivery.mjs` em 3101, API em porta efêmera, sem banco/provedores reais.

## Publicação `[PENDENTE]`

A estrutura permite empacotar frontend e backend separadamente. Não foi criado deploy, domínio ou rewrite de produção. Os entrypoints web/API continuam recusando `NODE_ENV=production`.

Para Vercel + EasyPanel: hospedar assets do web, configurar proxy HTTPS de origem única para a API e adaptar origem/cookies ao domínio público. Antes disso, concluir identidade individual, sessões persistentes, GitHub App, gestão de segredos, backups e revisão de exposição. Não publicar removendo apenas o bloqueio de produção: o proxy local não é configuração pronta para internet.
