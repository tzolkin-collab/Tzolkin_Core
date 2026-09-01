# Integrações

APIs, eventos, autenticação, falhas e sincronização. Requisitos financeiros ficam em [BILLING.md](BILLING.md); regras de segredo em [SECURITY.md](SECURITY.md#5-segredos).

Revisão: **2026-08-30**.

---

## 1. O que existe hoje

| Integração | Estado |
|---|---|
| **Core → Vercel, leitura de deploys** | `[EXISTENTE E VERIFICADO]` — fase 1 entregue em 2026-08-30 |
| Apps → Core, via `GET /v1/context` | `[EXISTENTE E VERIFICADO]`, mas **nenhum app real provisionado** (`app_clients` = 0 linhas) |
| Notion → Core, catálogo do ecossistema | `[EXISTENTE E VERIFICADO]`, importação manual |
| Core → EasyPanel | Consulta real autenticada validada: 3 projetos e 9 serviços — ver §10 |
| Stripe e Asaas | `[IMPLEMENTADO PARCIALMENTE]` — leitura mensal de vendas por API, sob demanda; sem webhooks ou criação de cobranças |
| Open Finance, Contabilizei, e-mail, webhooks | **Nada implementado** |

---

## 2. Apps → Core `[EXISTENTE E VERIFICADO]`

Contrato completo em [ARCHITECTURE.md](ARCHITECTURE.md#externo-apps--get-v1context). Aqui só o que diz respeito a operar a integração.

**Autenticação.** `Authorization: Bearer <token>`, casado contra `app_clients.token_hash` (SHA-256). O token em claro nunca é persistido. O `product_id` vem **do banco**, nunca do chamador.

**Provisionamento.** Nenhuma chave foi emitida para app real. Ao emitir:

1. Gerar token com entropia forte (≥ 32 bytes), fora de log e fora de canal compartilhado.
2. Guardar **só o hash** em `app_clients`.
3. Entregar o token em claro uma única vez, pelo canal combinado.
4. Rotação e revogação: `active=false` corta na consulta seguinte. Não há emissão nem rotação automatizada — lacuna.

**Falhas, e como o app deve tratar:**

| Resposta | Significa | O app deve |
|---|---|---|
| `200` | Acesso concedido, com `plan`, `rights`, `version` | Autorizar pelos `rights` e pelas próprias regras |
| `400` | Parâmetro inválido ou não previsto | Corrigir a chamada. Nunca enviar `product_id` |
| `401` | Credencial ausente, inválida ou inativa | Alertar operação. Não repetir em laço |
| `403` | **Negado** — falta organização ativa, vínculo ativo ou contrato ativo | Tratar como negação, não como erro temporário |
| `5xx` / timeout | Core indisponível | **Falhar fechado.** Não liberar permissão nova. Ver abaixo |

**Indisponibilidade do Core `[DECIDIDO]`:** não libera permissão nova. Hoje não há cache: sem resposta válida, não há autorização. Adotar cache exige definir antes a janela de revogação aceitável por tipo de ação — decisão do usuário, não padrão técnico.

**Sem distribuição de eventos.** Não há webhook do Core para os apps. `audit_events` é trilha transacional local, **não é barramento** — [DOMAIN-MODEL.md](DOMAIN-MODEL.md#audit_events--trilha-transacional). Os apps consultam ao vivo.

---

## 3. Notion — catálogo do ecossistema `[EXISTENTE E VERIFICADO]`

**Não há API do Notion em runtime.** O Core nunca chama o Notion enquanto atende requisição.

- **Fonte:** `db/notion-catalog.json`, versionado — 6 produtos e 7 atalhos, `imported_at` 2026-08-30.
- **Comando:** `node --env-file=.env scripts/import-notion.mjs`, manual.
- **Transacional e idempotente:** `products.id` e o id da entrada **nunca mudam**; `name` e `payload` são sincronizados a cada execução (`ON CONFLICT (id) DO UPDATE`). Rodar duas vezes dá o mesmo resultado.
- **Não cria contrato, organização, pessoa nem permissão.** Nenhuma credencial é importada.
- **Não sincroniza automaticamente.** Mudou no Notion, alguém atualiza o JSON e reexecuta.

Documentos, calendários e financeiro seguem no Notion e **não** são migrados — [DATA-OWNERSHIP.md](DATA-OWNERSHIP.md).

> Correção aplicada em 2026-08-30: a importação usava `ON CONFLICT DO NOTHING`, então `products.name` ficava com o valor semeado por `db/schema.sql` (`Educare`) em vez do valor do catálogo (`Educare by TZOLKIN`). Agora o catálogo é a fonte de verdade do nome exibido.

---

## 4. Contrato de evento `[PROPOSTO]`

Se e quando houver distribuição de eventos entre Core e apps, todo evento carrega:

| Campo | Para quê |
|---|---|
| `event_id` | Deduplicação. **Persistir os já processados** |
| `contract_version` | Evoluir o formato sem quebrar consumidor antigo |
| `aggregate_id` | Qual entidade mudou |
| `aggregate_version` | **Monotônica.** Versão menor que a aplicada é descartada |
| `occurred_at` | Informativo. **Nunca usar para ordenar** nem para saber se já processou |
| `product_id` / `tenant_id` | Escopo e roteamento |

Regras do consumidor: autenticar o emissor; ignorar duplicado; ignorar versão antiga; **reconciliar periodicamente** com o Core, porque evento perdido acontece. `entitlements.version` já é monotônico e serve de `aggregate_version`.

**Sem escrita offline genérica.** Fila fica no backend do app e **revalida direitos antes de executar**. O frontend não decide permissão nem aplica regra comercial.

---

## 5. Provedores de pagamento `[PARCIAL]`

O Financeiro consulta cobranças da Stripe e pagamentos do Asaas por mês, sob demanda, e persiste apenas a projeção necessária para exibir vendas, taxas, líquido, estornos e situação. A leitura é independente por provedor, não expõe chaves ao navegador e não mistura repasses bancários da Pluggy com receita. Webhooks e criação de cobranças continuam propostos. Capacidades pesquisadas na documentação oficial estão em [BILLING.md §4](BILLING.md#4-capacidades-dos-provedores) — incluindo autenticação de webhook, ordem de eventos, retentativas e idempotência de cada um. Não repetir aqui.

Do lado operacional, ao implementar:

- Endpoint de webhook **isento de proteção CSRF** (é chamada servidor-a-servidor) e **com o corpo bruto preservado** — reserializar quebra a verificação de assinatura da Stripe.
- Responder `2xx` rápido; processar em fila.
- Consumidor tolerante a campo desconhecido: os dois provedores adicionam atributos sem aviso.
- Monitorar a fila do Asaas: **15 falhas consecutivas interrompem o envio**, e eventos expiram em 14 dias.

---

## 6. Open Finance `[PROPOSTO]`

**Primeira fase: leitura apenas.** Contas, saldos, transações, última sincronização, consentimentos e expiração, conciliação.

**Não incluir movimentação de dinheiro nesta fase.**

Antes de escolher fornecedor, verificar: cobertura das instituições que a TZOLKIN de fato usa; fluxo e prazo de consentimento; renovação e expiração; requisitos regulatórios; custo.

> 🟡 **HIPÓTESE a derrubar antes de qualquer desenho:** que a API do Asaas agrega todas as contas bancárias. **Não presumir isso.** Asaas é provedor de pagamentos; agregação de contas de terceiros é outro produto, com outro regime.

Regra de leitura: **transferência entre contas próprias não é receita nova** — [BILLING.md](BILLING.md#6-conciliação-proposto).

---

## 7. Contabilizei

**Não foi localizada API pública oficial nem portal de desenvolvedores da Contabilizei** (pesquisa de 2026-08-30). O que existe é:

- Um projeto de terceiros no GitHub que faz engenharia reversa de endpoints internos. **Não construir em cima disso**: é frágil, não suportado e provavelmente contrário aos termos de uso.
- Integrações que a plataforma oferece **de dentro dela** — importação de extrato bancário e de nota fiscal de serviço em municípios específicos —, que são recursos do produto, não uma API para nós.

**Encaminhamento `[PROPOSTO]`:** assumir **exportação assistida** (arquivo gerado pelo Core, conferido por pessoa, enviado pelo canal da Contabilizei). Antes de qualquer automação, perguntar diretamente à Contabilizei se existe integração suportada para o plano da TZOLKIN. **Não inventar API.**

Divisão de responsabilidades em [BILLING.md §7](BILLING.md#7-contabilidade).

---

## 9. Deploys — Vercel `[EXISTENTE E VERIFICADO]`

Entregue em 2026-08-30. **Somente leitura**: o Core não dispara, não cancela, não promove e não altera nada na Vercel.

### Como está montado

`src/integrations/vercel.mjs` é o adaptador; `src/modules/deploys.mjs` é o domínio. Mesma forma proposta para pagamentos em [ADR 0003](decisions/0003-configuracao-de-cobranca-por-conta-e-oferta.md): o domínio fala "deploy", o adaptador traduz para o vocabulário do provedor. Um segundo provedor entra como adaptador novo, sem mexer no domínio.

| Chamada | Para quê |
|---|---|
| `GET /v9/projects` | Lista os projetos ao alcance da credencial |
| `GET /v7/deployments?projectId=…&limit=4` | Deploys recentes **de cada projeto** |

**Por que uma chamada por projeto:** a primeira versão pedia só os 20 deploys mais recentes do escopo inteiro e agrupava. Um projeto parado há semanas simplesmente sumia da tela — foi exatamente o que aconteceu com `site-tzolkin` na conferência. Listar por projeto custa N+1 requisições e mostra a verdade, inclusive projeto com zero deploys.

### Configuração

| Variável | Papel |
|---|---|
| `VERCEL_TOKEN` | Obrigatória para ligar. Sem ela o provedor não existe — e o painel mostra estado vazio, não erro |
| `VERCEL_TEAM_ID` | Opcional. **Só é necessária para token de conta inteira**: token de time ou de projeto dispensa, porque a Vercel infere do escopo |
| `VERCEL_API_BASE` | Opcional. Aponta o adaptador para outro endereço — usada pelos testes contra stub local |

### Garantias

- **Credencial só no servidor.** O navegador recebe o resultado normalizado; teste verifica que o token não aparece na resposta.
- **Erro de provedor não vaza nada.** 401/403/429/5xx viram mensagem própria; corpo bruto e credencial nunca saem.
- **Falha não derruba o painel.** Provedor fora do ar vira `status: "error"` no bloco de provedores; projeto que falhou isoladamente aparece marcado `partial`.
- **Corte nunca é silencioso.** Acima de 24 projetos, a resposta traz `truncated` com quantos ficaram de fora, e o painel diz.
- **Timeout de 8s** por chamada; cache de tela de 30s para não bater no provedor a cada troca de contexto.
- **Só `GET` é roteado.** `POST` e `PUT` em `/api/deploys` respondem 405 — coberto por teste.
- **Mensagem de commit vira assunto** (primeira linha, teto de 140 caracteres): corpo de commit chega a milhares de caracteres e o painel não é git log.
- **E-mail de quem commitou não sai do adaptador.**

### Escopo do token — atenção

A Vercel oferece três níveis: conta inteira, time e **projeto**. Um token de projeto nega qualquer requisição a outro projeto ou a recurso de time — é a única contenção real, porque **não existe permissão "somente leitura"** nos tokens.

O token em uso hoje é de **time**: alcança 8 projetos e pode escrever e apagar todos. O código só lê, mas a credencial guardada no `.env` é ampla. Trocar por tokens de escopo de projeto é recomendação aberta.

### Disparo de deploy — ainda não `[PROPOSTO]`

Quando existir, será por **Deploy Hook**: URL secreta por branch, sem token, revogável, 60 disparos/hora por projeto. Nunca pelo token amplo. Ressalva encontrada na prática: **Deploy Hook exige projeto conectado a um repositório Git** — projetos sem repo não podem ter um.

---

## 10. EasyPanel — inventário local `[CONSULTA REAL VALIDADA]`

Validação em 2026-08-30: consulta HTTPS autenticada bem-sucedida em `https://easypanel.landcriativa.com`, retornando 3 projetos e 9 serviços. Apenas leitura, sem alteração de infraestrutura. O processo do painel Core precisa ser reiniciado para carregar mudanças de código/ambiente; a validação foi feita diretamente pelo adaptador.

Revisão Codex de 2026-08-30: `src/integrations/easypanel.mjs` consulta somente `GET /api/listProjectsAndServices`; `GET /api/infrastructure/easypanel` exige sessão administrativa, recusa parâmetros inesperados e não aceita escrita. O painel apresenta o inventário na área Deploys, explicitamente separado de disponibilidade e histórico de deploy.

- Configuração: `EASYPANEL_URL` e `EASYPANEL_TOKEN`, somente no ambiente do servidor. Nenhum segredo configurado nesta entrega.
- HTTPS obrigatório, sem credencial na URL, sem redirecionamento, timeout de 8s, resposta limitada a 1 MiB, cache de 30s e consulta concorrente compartilhada.
- Retorna somente nomes de projetos/serviços e tipos conhecidos. Não consulta ambiente, senha de banco, configuração completa, logs ou métricas. Não dispara deploy nem reinicia/exclui serviços.
- Limites de 100 projetos e 200 serviços por projeto, com contagem explícita do corte. Tipo desconhecido vira `unknown`, nunca indicação inventada de saúde.
- Sem configuração: estado desconectado. Configuração incompleta ou falha: erro neutro, sem derrubar o painel.
- **Formato real confirmado:** `{projects: [{name, ...}], services: [{projectName, name, type, ...}]}`. O normalizador agrupa por projeto e descarta todos os demais campos, inclusive `token`, `env` e configurações de banco/app retornadas pela API. Mantém suporte ao formato agrupado dos testes; serviços órfãos e projetos duplicados são rejeitados. A versão exata do EasyPanel não foi identificada.
- 7 testes novos (25 unitários ao todo), incluindo sessão expirada, escrita negada e nenhuma consulta ao banco. UI adicionada, sem conferência visual nesta entrega.

Fontes oficiais consultadas: [introdução da API](https://easypanel.io/docs/api-reference), [listagem](https://easypanel.io/docs/api-reference/projects/listProjectsAndServices), [CLI e escopo da chave](https://easypanel.io/docs/cli). A chave atua com os acessos do usuário; não presumir privilégio somente-leitura. Preferir usuário restrito aos projetos necessários, após verificar suporte na versão instalada.

### Conexão real e ações futuras

A API oficial existe e é adequada: base `https://<painel>/api`, `Authorization: Bearer <token>`, com `listProjectsAndServices`, `inspectAppService`, `inspectPostgresService`, `getDockerContainers` para leitura e `POST /api/deployAppService` com `{projectName, serviceName, forceRebuild?}` para disparo.

O impedimento não é técnico: **na mesma superfície do mesmo token estão `destroyProject` e `deleteAppService`** — este último apaga serviço, arquivos, domínios, backups e imagem. Não há escopo somente-leitura documentado. Guardar esse token no `.env` do Core significa o Core segurar uma chave-mestra da infraestrutura que hospeda o próprio banco dele.

Existe `refreshAppDeployToken`, sugerindo token de deploy por serviço — mais estreito, a confirmar.

Antes de conectar: obter a URL HTTPS do usuário, revisar exposição/armazenamento de segredos e permissões, configurar a credencial fora da conversa, reiniciar o Core e validar a consulta. Isso é separado da implementação local, que não necessita token real. Ações de deploy continuam pendentes de autorização e auditoria.

---

## 11. Sistemas vizinhos neste workspace

Não são integrações do Core — são contexto. Nenhum deles fala com o Core hoje.

| Projeto | O que é | Relação com o Core |
|---|---|---|
| `tzolkin-site` | Next.js 15, institucional, publicado na Vercel. Captação de leads em banco próprio (`institucional.leads`) + `email_outbox` com consumidor Resend **ainda não ativado** | Nenhuma. Leads da TZOLKIN não vão para o Core — [DATA-OWNERSHIP.md](DATA-OWNERSHIP.md) |
| `chatbot-api` | Express + OpenAI + Google GenAI + Redis/BullMQ, consultor do site. Sem repositório git | Nenhuma |

`tzolkin-site` tem muitas alterações locais não commitadas (conferido em 2026-08-30). **Preservar. Não commitar, não reverter, não limpar.**
