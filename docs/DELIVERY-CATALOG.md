# Catálogo técnico — primeira entrega

`[EXISTENTE E VERIFICADO]` Atualizado em 2026-08-31: testes unitários/HTTP, consulta de leitura aos provedores reais e preview de interface isolado.

Na gestão geral: **Projetos e serviços → Seus repositórios → Configurar**. Projetos já vinculados têm a ação **Abrir projeto**. A alternativa **Criar rascunho sem repositório** continua disponível.

## Fluxo visual `[EXISTENTE E VERIFICADO]`

Atualização de 2026-08-31: repositórios visíveis na página, busca local, conexão por plataforma, indicação de arquivamento e vínculos existentes. A interface preserva os tokens da marca e usa SVG de traço, sem emojis, na navegação e no catálogo.

O cadastro tem três etapas: **Projeto → Serviços → Revisão**. O nome é sugerido pelo repositório. Serviços são adicionados por cards Website, API, Worker, Biblioteca, Banco ou Cache; identificador, stack, runtime, gerenciador, dependências e comandos ficam em **Configurações avançadas**. Ao adicionar outra parte de código, a estrutura passa para monorepo. Os selects continuam nativos para preservar teclado e acessibilidade.

Selecionar um destino consulta automaticamente a configuração. O preenchimento automático só ocorre em **componente novo, com um único vínculo, mesmo repositório confirmado e campo não editado**. Preserva componentes existentes, campos manuais e valores já importados. A origem é exibida; valores ausentes/restritos/automáticos não são inventados. A branch padrão do GitHub é uma sugestão explícita, não prova de publicação. PostgreSQL/Redis do seletor de tipos são presets editáveis, não detecção de infraestrutura.

Os detalhes da comparação ficam recolhidos em **Valores detectados e diferenças**, com importação seletiva preservada. Trocar destino invalida a consulta anterior, sem apagar silenciosamente os valores preenchidos. Não é permitido avançar à revisão enquanto uma detecção estiver em andamento. Nenhuma dessas ações grava até **Salvar projeto**.

## Implementado

- Seleção e busca de repositórios GitHub acessíveis, sem incluir arquivados em novos vínculos.
- Rascunhos sem repositório, responsável ou destinos, com pendências calculadas.
- Projeto com aplicação única ou monorepo; até 20 componentes de código/dados.
- Stack, runtime, gerenciador, pasta relativa, dependências e configuração avançada por componente. Comandos são metadados: nunca executados.
- Destino existente por componente e ambiente (desenvolvimento, homologação, produção). IDs são conferidos no inventário do servidor; salvar não altera configuração remota.
- Dependências validadas, sem ciclos; bibliotecas sem deploy; destinos incompatíveis com a função rejeitados.
- Edição com revisão otimista: uma edição desatualizada retorna 409 em vez de sobrescrever outra.
- Auditoria transacional com antes/depois. Ator `local-operator` declara a limitação atual: não há identidade individual no bootstrap.
- Estado de deploy explicitamente `not_observed`. Cadastro completo **não** significa aplicação publicada ou saudável.
- Consulta sob demanda da configuração segura de projetos Vercel e serviços App do EasyPanel, comparação com os campos atuais do formulário e importação seletiva para o cadastro.

## Módulos

- `platform/delivery-model.mjs`: validação e presets de stack, sem conhecimento de provedores.
- `integrations/github.mjs`: GitHub somente leitura e paginado (até 500, corte explícito).
- `integrations/delivery-options.mjs`: inventário com falhas isoladas e cache de 30 segundos, usando adaptadores GitHub/Vercel/EasyPanel.
- `integrations/delivery-settings.mjs`: leitura sob demanda, projeção estrita e estados por campo; nenhuma resposta bruta é persistida ou enviada ao navegador.
- `modules/delivery.mjs`: endpoints administrativos e transação específica, sem misturar auditoria técnica com auditoria dos clientes.
- `public/delivery.js` e `public/delivery.css`: formulário e apresentação isolados.
- Migração aditiva `002_delivery_catalog.sql`: `delivery_projects` (agregado JSONB, revisão) e `delivery_audit`.

O agregado JSONB mantém componentes e dependências consistentes numa única revisão. Não é banco de configurações livres: o backend rejeita campos fora do contrato. Um repositório só pode ser vinculado a um projeto do cadastro.

## Conexões

GitHub: `GITHUB_TOKEN` no servidor, idealmente restrito aos repositórios necessários e apenas leitura. Como alternativa **explícita no bootstrap local**, `GITHUB_USE_CLI=true` usa `gh api` com a conta já autenticada no keyring, sem extrair o token e sem shell. Token explícito tem precedência. Esta alternativa não é autenticação multiusuário nem solução para publicar o Core.

Vercel e EasyPanel reutilizam suas variáveis existentes. Nada recebe credenciais pelo formulário. A lista indica indisponibilidade, conexão ausente e cortes de paginação. Vínculos anteriores podem ser preservados em falhas de consulta; novos vínculos precisam existir na lista do servidor.

## API

- `GET /api/delivery/options`: inventários e presets.
- `GET /api/delivery/projects`: até 200 cadastros recentes, com `truncated` explícito.
- `POST /api/delivery/projects`: criar rascunho/cadastro.
- `PUT /api/delivery/projects/:id`: editar, exigindo `revision` atual.

Todas exigem sessão administrativa. Escritas mantêm CSRF, limite de corpo de 16 KB e validação no backend. Nenhuma rota de provisionamento/deploy ou alteração de segredos existe.

## Consultar e importar configurações

No formulário, escolher destino dispara a consulta; **Atualizar detecção** permite consultar novamente. Em **Valores detectados e diferenças**, a tabela compara o formulário (incluindo edições ainda não salvas) com a consulta remota. Marque os campos diferentes e clique em **Preencher selecionados no formulário**. Somente **Salvar projeto** persiste a alteração com revisão e auditoria existentes.

`GET /api/delivery/settings?provider=vercel&target_id=...&environment=production` exige sessão, parâmetros únicos e destino encontrado no inventário acessível. Não consulta nem altera o banco. Falha de inventário retorna 503; destino ausente, 404; consulta incompatível retorna `status:error`. Tipos não suportados retornam `status:unsupported`, sem consultar configurações de bancos, caches ou Compose.

- **Vercel:** pasta raiz, presets Next.js/Vite reconhecidos, versão Node, branch de produção, comando de build em formato seguro e pasta de saída explícita. Configuração de projeto não inclui overrides em `vercel.json` ou no deploy. Branch de preview/homologação não é inferida da branch de produção.
- **EasyPanel App:** pasta e branch de fontes Git/GitHub; nome do repositório apenas quando a fonte GitHub o identifica. `/` da fonte significa raiz do repositório. Imagem/Dockerfile não permite inferir stack/runtime. O serviço tem configuração única: o ambiente do vínculo é organização do Core, não uma configuração remota separada.
- Valores automáticos, ausentes e comandos restritos aparecem com estados distintos e não podem apagar campos locais por importação. Comandos livres podem conter segredos inline: só padrões npm/pnpm/yarn/bun build/start/dev (com `run` e sufixo simples opcionais) são exibidos. Não há leitura de env, credenciais, scripts ou URLs de deploy no frontend.
- Resposta remota limitada a 1 MiB, timeout de 8 segundos, HTTPS e redirects recusados. A projeção descarta todos os campos não permitidos; não há logs de respostas brutas.
- Importar não muda repositório nem escolhe destinos automaticamente. Um aviso destaca repositório divergente/não confirmado. Os campos do componente são compartilhados entre ambientes; a branch pertence ao vínculo. Uma nova consulta é necessária após trocar destino/plataforma/ambiente.

Fontes: [Vercel — configuração de projetos](https://vercel.com/docs/projects/managing-projects) e [EasyPanel — Inspect app service](https://easypanel.io/docs/api-reference/services-/-app/inspectAppService). O formato de fonte GitHub do EasyPanel foi conferido por leitura no painel conectado, sem registrar seu conteúdo bruto.

## Verificação e limites

Testes unitários/HTTP com dependências simuladas: autenticação, CSRF, validação, paginação, indisponibilidade, auditoria e rollback, edição concorrente e escolha de destino. Preview visual isolado: `node scripts/preview-delivery.mjs` em 3101, sem `.env`, banco ou provedores reais. Todos os dados desse preview são descartados ao parar o processo.

A detecção automática de pastas/stacks/branches, conciliação vínculo × commit efetivamente implantado, criação de repositórios/PR Draft, provisionamento, deploy, domínios e gestão de segredos são próximas etapas — **não implementadas**. Rascunho aqui é cadastro interno, não PR Draft no GitHub. Nenhum sistema existente foi automaticamente cadastrado por semelhança de nome.

Também continuam pendentes a aplicação de configurações do Core nas plataformas e a exportação/versionamento de um manifesto de infraestrutura no Git. Esta entrega cobre o sentido plataforma → formulário → cadastro; não é sincronização bidirecional.

Fonte do endpoint GitHub: [List repositories for the authenticated user](https://docs.github.com/en/rest/repos/repos#list-repositories-for-the-authenticated-user).
