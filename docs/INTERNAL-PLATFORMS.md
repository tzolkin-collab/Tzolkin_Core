# Plataformas dentro do Core

Implementação local. Vercel permanece somente leitura; EasyPanel inclui consultas e operações App com confirmação. As ações principais de projetos/deploys Vercel, serviços EasyPanel e destinos vinculados em Projetos e serviços abrem uma página do Core. Não usam iframe nem redirecionam para painéis externos. A cobertura atual está em [Operações EasyPanel](EASYPANEL-OPERATIONS.md); as etapas abaixo registram a evolução anterior.

## Telas e fontes estudadas

- [Vercel — projetos](https://vercel.com/docs/projects): organização por projeto, configuração e deploys.
- [Vercel — REST API](https://vercel.com/docs/rest-api): contratos de consulta de projetos, domínios e deploys.
- [EasyPanel — App](https://easypanel.io/docs/services/app): origem, build, deploys, domínios, recursos e operações.
- [EasyPanel — inspectAppService](https://easypanel.io/docs/api-reference/services-/-app/inspectAppService).
- [EasyPanel — listDomains](https://easypanel.io/docs/api-reference/domains/listDomains).

Adaptação ao design existente, com ícones SVG: Visão geral, Deploys, Configuração, Domínios. Não é uma réplica completa dos consoles dos provedores.

## Contrato local

`GET /api/platforms/resource?provider=vercel|easypanel&target_id=...&environment=production|staging|development`

Exige sessão administrativa; valida parâmetros únicos e presença do destino no inventário acessível antes de consultar. Credenciais exclusivamente no backend. Nenhum SQL de escrita nem operação de deploy.

| Seção | Vercel | EasyPanel |
| --- | --- | --- |
| Configuração | GET /v9/projects/{id} | GET /api/inspectAppService, apenas App |
| Domínios | GET /v9/projects/{id}/domains | GET /api/listDomains, filtrado por projeto/serviço |
| Deploys | GET /v6/deployments, projectId, últimos 20 | GET /api/listActions, filtro deployment e projeto/serviço, últimos 20 |

Cada seção tem status independente. Domínios limitados a 100; paginação/cortes são informados. Respostas limitadas a 1 MiB por chamada, timeout de 8 segundos, HTTPS obrigatório e redirects recusados. O servidor projeta os campos usados pela interface; não repassa payload bruto, env, comandos arbitrários, hooks, logs ou erros remotos. Falhas de consulta são genéricas.

URLs internas usam `#resource?provider=...&target_id=...&environment=...&tab=...`. Login seguido de abertura direta, abas, atualização, voltar e limpeza de dados ao sair/trocar contexto. Dados da página são reutilizados entre abas até Atualizar; inventário tem cache curto próprio.

## Limites explícitos

- Consulta de configuração não comprova configuração efetiva de um deploy, saúde ou ambiente ativo. A branch Vercel é consultada só para produção; EasyPanel tem configuração única do serviço.
- Deploys retornados são de todos os ambientes do projeto, não uma confirmação de qual recebe tráfego em produção. READY é apresentado como Pronto.
- HTTPS configurado no EasyPanel não valida o certificado. Verificação de domínio Vercel não é teste de disponibilidade.
- Logs, métricas de execução, segredos, restart, publicação, rollback e edição remota ainda não integrados.
- Serviços de dados têm identidade e consulta de domínios; configuração App não é aplicada a PostgreSQL/Redis.

## Validação

- 48 testes unitários passaram, incluindo autorização, destino fora do inventário, parâmetros duplicados, isolamento de falhas, limites de payload e omissão de segredos sintéticos.
- Preview isolado em memória para inspeção de navegação, abas e layout com a skill de navegador; não utiliza banco ou credenciais reais.
- Smoke autenticado no frontend local: HTTP 200 em recursos reais de ambos provedores; Vercel configuração/domínios/deploys ok, EasyPanel configuração/domínios ok e histórico unsupported.
- `/health`: tls-verified após reiniciar os dois processos locais.

Nada publicado nem alterado nas plataformas remotas nesta etapa.

## Ampliação EasyPanel — histórico

Histórico integrado por [listActions](https://easypanel.io/docs/api-reference/actions/listActions), validado contra systembots/evolution-api. Filtro remoto e local por projeto, serviço e tipo deployment; consulta 21 para sinalizar corte em 20. `done` vira Concluído (não prova saúde), `error` vira Falhou. Estados não reconhecidos permanecem Desconhecido. Datas sem offset são exibidas sem conversão presumida. Descrição, meta, email e logs não são enviados ao frontend. 49 testes unitários passaram. A validação anterior com unsupported é histórica e foi superada por esta integração.

### Lacunas identificadas na etapa do histórico (superadas parcialmente)

- Logs de execução e saída das ações: consultas próprias, limites, paginação e tratamento de conteúdo sensível.
- Métricas de CPU/memória e estado dos containers: endpoints próprios, disponibilidade depende da instalação.
- Armazenamento, portas e backups: visualização ainda não implementada.
- Configuração além de App: PostgreSQL, Redis, Compose e demais tipos precisam adaptadores específicos.
- Edição de origem/build, ambiente, recursos, domínios e volumes: ainda não implementada; exige validação, auditoria e confirmação das alterações.
- Operações publicar/reiniciar/parar: ainda não implementadas; adicionar controles no app não autoriza executar operações em serviços reais durante os testes.

Referência do mapa: [endpoints oficiais](https://easypanel.io/docs/api-reference/endpoints). A integração não deve ser apresentada como completa enquanto esses itens estiverem pendentes.
