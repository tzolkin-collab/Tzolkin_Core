# TZOLKIN Core — bootstrap local

Gestão transversal do ecossistema: organizações, vínculos de pessoas por identificador externo, catálogo de produtos e contratos com direitos. **Não** contém operação dos clientes, leads dos apps, cobrança nem dados de pagamento.

**Documentação técnica em [`docs/`](docs/)** — comece por [docs/CONTEXT.md](docs/CONTEXT.md) para o estado real, e [docs/README.md](docs/README.md) para o índice.

## Rodar

```bash
npm start
```

→ `http://127.0.0.1:3100`. Use exatamente esse endereço: mutações exigem essa origem, e `localhost` não é aceito no lugar de `127.0.0.1`.

`npm start` inicia **dois processos**: frontend em 3100 e API em 3102. Também podem rodar separadamente com `npm run start:web` e `npm run start:api`. Só a API carrega o `.env`. Veja [Separação frontend/API](docs/SPLIT-RUNTIME.md).

Primeira vez, na ordem:

```bash
npm run db:setup
node --env-file=.env scripts/import-notion.mjs
npm test
```

Banco já existente, depois de atualizar o código:

```bash
npm run db:migrate
```

> ### ⚠️ O banco não é local
>
> O PostgreSQL do Core é remoto. Transporte corrigido em 2026-08-30 (2026-08-31 UTC): **TLS 1.3 com certificado e hostname verificados**, senha rotacionada e conexões sem TLS bloqueadas para a role do Core. `GET /health` reporta `tls-verified`.
>
> Certificado, renovação e limites: [docs/POSTGRES-TLS.md](docs/POSTGRES-TLS.md). Isso não libera o bootstrap para produção nem resolve o transporte dos outros aplicativos.

A senha do operador é `CORE_ADMIN_PASSWORD` no `.env`, gerada no setup e nunca enviada aos logs. Não compartilhar o arquivo — ele também tem a conexão do banco. Variáveis documentadas em [`.env.example`](.env.example).

## Limites do bootstrap

- Escuta só em loopback e recusa `NODE_ENV=production`. **Não publicar, não expor por túnel.**
- Sessões em memória do processo: `HttpOnly`, `SameSite=Strict`, uma hora, descartadas ao reiniciar. Cookie sem `Secure` porque é HTTP local; produção exige HTTPS, IdP, MFA e sessões persistentes.
- Administrador local é operador **global**, não cliente. **Não existe portal de login de clientes.**
- `subject` é identificador de identidade externa (preferir `issuer + sub`), não e-mail nem prova de autenticação. O vínculo é por organização **e** produto: quem tem acesso a um produto não alcança outro da mesma organização.
- Direitos consultados ao vivo, sem cache: revogar vale na consulta seguinte. Não há webhooks; `audit_events` é trilha transacional local, não barramento.
- Planos são metadados de contrato. **Não há motor de cobrança.**
- Frontend só apresenta e serializa formulário. Autorização, recorte e persistência ficam no servidor.

Lista completa do que falta para produção: [docs/SECURITY.md](docs/SECURITY.md#7-antes-de-publicar-o-core).

## Estrutura

```
apps/api/src/         API, autenticação, banco, módulos e integrações
apps/web/public/      painel (HTML/CSS/JS, sem build)
apps/web/server.mjs   servidor web local e proxy de origem única
apps/web/assets.mjs   allowlist dos arquivos públicos
db/                   schema.sql (linha de base), migrations/ e catálogo do Notion
scripts/              dev.mjs, setup.mjs, migrate.mjs, import-notion.mjs
test/                 suítes de integração contra PostgreSQL real
```

Detalhes e regra de dependência entre módulos: [docs/ARCHITECTURE.md](docs/ARCHITECTURE.md).

## Contextos do painel

- **Gestão geral** — carteira, portfólio, contratos e vínculos da TZOLKIN.
- **Gestão de um produto** — só as organizações com contrato daquele produto. O recorte é feito no servidor; trocar de contexto descarta o que estava na tela e revalida a sessão.

Uma organização só aparece no contexto de um produto depois que um contrato daquele produto é registrado. **Nada é inferido.**

## Projetos e serviços

Cadastro modular com seleção de repositório GitHub, componentes de monorepo, stacks, dependências e vínculos por ambiente com destinos existentes na Vercel e no EasyPanel. Salvar grava somente configuração e auditoria no Core: não cria recursos nem dispara deploy. Cadastro completo não significa publicação verificada.

Configuração, limites e próximos passos: [docs/DELIVERY-CATALOG.md](docs/DELIVERY-CATALOG.md).

## Deploys (leitura)

Com `VERCEL_TOKEN` no ambiente, o painel mostra os deploys recentes de cada projeto da Vercel: estado, ambiente, branch, commit, autor e links. **Somente leitura** — o Core não dispara, cancela nem promove deploy. Sem o token, a tela mostra estado vazio, não erro.

Detalhes, garantias e o caso do EasyPanel: [docs/INTEGRATIONS.md](docs/INTEGRATIONS.md#9-deploys--vercel-existente-e-verificado).

## Ecossistema importado do Notion

Seis produtos e sete atalhos operacionais, importados em 30/08/2026 de `db/notion-catalog.json`. Documentos, calendários e financeiro seguem no Notion: esta etapa não migra conteúdo nem cria sincronização automática. Status exibidos são cadastrais, não monitoramento. Nenhuma credencial é importada.

A importação é transacional e idempotente: `products.id` nunca muda; nome e ficha são sincronizados a partir do catálogo. Não cria contratos, organizações nem permissões.

## Testes

```bash
npm test
```

69 cenários contra banco real e servidor temporário de loopback (a integração de deploys roda contra stub local, sem tocar em provedor externo): autenticação, CSRF/origem, campos extras, isolamento entre organizações e entre produtos, negação de acesso cruzado entre produtos da mesma organização, revogação, suspensão, expiração, limite de tentativas e recorte do contexto de produto. Cria e remove apenas registros sintéticos da execução. Não envia e-mail e não altera dados existentes.

Estratégia, cobertura e lacunas: [docs/TESTING.md](docs/TESTING.md).

A logo é o SVG original preto/branco aprovado, idêntico ao do institucional.

Páginas internas de Vercel e EasyPanel, contratos de API e limites: [docs/INTERNAL-PLATFORMS.md](docs/INTERNAL-PLATFORMS.md).

Cobertura atual de consultas, configurações e operações EasyPanel: [docs/EASYPANEL-OPERATIONS.md](docs/EASYPANEL-OPERATIONS.md).
