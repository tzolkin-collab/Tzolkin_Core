# EasyPanel no Core — cobertura atual

Implementação local, ainda não publicada. Não é uma integração completa do painel. Nenhuma ação de publicação, restart ou mudança de configuração foi executada nos serviços reais durante os testes.

## Consultas internas

| Área | Implementado | Limite |
| --- | --- | --- |
| Deploys | Últimas 20 ações de deployment, estado e saída individual | Concluído não comprova saúde; saída limitada e com redação de segredos |
| Métricas | CPU, memória e rede pelo monitor legado | Endpoint moderno retornou null nesta instalação |
| Containers | Identificação, imagem e estado do serviço | Sem terminal, comandos ou detalhes de rede |
| Volumes e portas | Listagem App/Box | Sem edição |
| Backups | Agendamentos de banco ou volume | Não comprova execução/restauração; sem edição |
| Logs | Adaptador para resposta Loki, período de uma hora e 100 linhas | Instalação real retornou erro; coleta não foi ativada automaticamente |
| Configuração | Campos seguros e revisão da configuração | Nunca envia configuração bruta, env ou credenciais ao navegador |

Consultas exigem sessão administrativa e destino presente no inventário acessível. Falhas e funcionalidades indisponíveis não são apresentadas como ausência de registros. Respostas remotas têm limite de tamanho, timeout e recusam redirects.

## Operações App

Na aba **Operações**: publicar, reconstruir sem cache, reiniciar, iniciar e parar. Formulários expansíveis permitem editar réplicas, CPU/memória, imagem, método de build, pasta/branch GitHub e substituição completa das variáveis.

- Build suporta Dockerfile, Nixpacks e Railpack. Não cobre todos os parâmetros dos builders. Campos não editados são preservados quando o builder não muda; trocar builder substitui sua configuração.
- Imagem só aparece para origem image; credenciais do registry permanecem no servidor.
- GitHub edita origem existente; não conecta uma nova conta/repositório.
- Variáveis exigem o conteúdo completo e nunca são pré-carregadas. O campo é limpo após envio aceito.
- Configurações não disparam deploy automaticamente. Após salvar, atualizar a página antes da próxima alteração.
- Outros tipos de serviço permanecem sem operações de escrita.

## Proteções

`GET /api/platforms/easypanel/section` consulta a seção; `POST /prepare` produz uma confirmação vinculada à sessão por dois minutos; `POST /execute` exige o identificador exato do serviço digitado pelo operador. Os caminhos completos de prepare/execute usam o prefixo `/api/platforms/easypanel`.

O backend valida tipo, valores, destino e fingerprint atual antes da escrita. Confirmações são de uso único, com bloqueio de concorrência por destino e proteção CSRF. Credenciais e valores preparados ficam apenas em memória, com expiração.

A migração aditiva `003_platform_operations.sql` foi aplicada ao banco do Core. Registra destino, ação, ator local, datas e estado, sem payload/segredos. Se a inserção inicial falha, nenhuma chamada de escrita é enviada. Aceito não significa concluído. Erro de transporte após tentativa é resultado desconhecido: não há retry automático.

Logs são limitados, renderizados como texto e passam por remoção de tokens conhecidos, linhas sensíveis, credenciais em URLs e blocos de chave privada. Isso reduz exposição, mas não garante remoção de todo conteúdo sensível arbitrário.

## Validação

- 58 testes unitários: projeção segura, validação, revisão obsoleta, sessão, confirmação, expiração, auditoria, falha de banco e ausência de retry.
- Escritas testadas apenas com mocks e preview isolado, sem `.env`, banco ou provedores reais.
- Smoke real somente leitura: settings, métricas, containers, portas, montagens e backups retornaram dados/estados válidos; logs retornaram erro explícito.
- Saúde do banco confirmou TLS verificado. A política de conexão não foi enfraquecida.

## Próximas lacunas

CRUD de domínios, portas, volumes e backups; configuração/operações específicas de PostgreSQL, Redis, Compose e demais tipos; integração do coletor de logs da instalação; paginação ampliada; parâmetros avançados de build/registry e gestão de segredos. Não apresentar essas capacidades como disponíveis.

Contratos consultados: [API oficial](https://easypanel.io/docs/api-reference/endpoints) e [configuração App](https://easypanel.io/docs/services/app).
