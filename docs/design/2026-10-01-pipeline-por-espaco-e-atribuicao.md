# Pipeline por espaço, clientes por espaço e padrão de atribuição — avaliação

Status: **`[AVALIAÇÃO]`** em 2026-10-01. **Fase 1 implementada em 2026-10-02** (migração 040, `commercial-pipelines.mjs`, barra do funil no Inbound),
com as 4 recomendações do §6 aceitas pelo dono ("pode"): vários funis por espaço, campos próprios por espaço (fase 4), nasce a contratação
ao ganhar (fase 3), só espaços da TZOLKIN. **Fase 2 (dedupe por e-mail) e fase 3 (mover, qualificar, descartar, ganhar → contratação) feitas em 2026-10-02**
(`commercial-intake.mjs`, `commercial-leadflow.mjs`, migração 042). A fase 4 (campos próprios por espaço, `space_data`) também foi feita em 2026-10-02 (migração 043). A fase 5 (eventos e automações, com tarefas mínimas) também foi feita em 2026-10-02 (migração 044). Ficam de fora, na lista: fontes ("Conectar fonte"), exigências por etapa, atraso de automação, webhook de entrada.
Base de cópia: o desenho de leads da Kalidash (`Projetos/Carol/Kalidash/docs/plano-schema.md`,
`apps/admin/src/lib/leadFlow.ts`, `lifecycle.ts`, `documents.ts`), só trocando o contexto de aplicação.

## 1. O pedido, como entendi

1. **Pipeline vinculada a espaço.** Espaço = item do Portfólio (`products`: plataforma, linha de serviço,
   consultoria e assessoria, interno). Cada funil pertence a um espaço.
2. **Clientes por espaço, com campos próprios.** O mesmo cliente pode estar em vários espaços, e cada espaço
   pode ter campos que só ele usa (ex.: Mentorias pede turma; Sites pede nicho e domínio).
3. **Padrão de UTM e de passagem de dados.** Um contrato único do que o site/produto manda ao Core, que
   leva a origem do lead até o funil, o cliente e o financeiro.
4. **Leads centralizados no Core**, regra de negócio nos produtos (decisão do dono).

🟡 HIPÓTESE: "campos únicos" = campos **próprios/exclusivos de um espaço**, não restrição de unicidade.
Confirmar.

## 2. O que já existe (verificado no código)

| Peça | Estado | Onde |
|---|---|---|
| Espaço | Existe, com tipo, tags, ciclo de vida e capacidades por tipo | `products`, `catalog.mjs` (`KIND_REGISTRY`), migração 036 |
| Lead por espaço | **Existe**: o lead grava `product_id`; a chave de intake é por espaço e o intake recusa produto diferente da chave (403) | `commercial_leads.product_id`, `commercial-intake.mjs` |
| Funil | **Não existe.** Lead tem um status único (`open/qualified/won/lost/archived`); não há pipeline, etapa, oportunidade nem tarefa | `commercial_leads` |
| Cliente por espaço | Existe como relação: `client_engagements` (empresa × espaço), `entitlements` (empresa × espaço), `memberships` (pessoa × empresa × espaço) | migrações 009, 025 |
| Campo próprio por espaço | **Não existe.** Nem definição de campo nem coluna de valores | — |
| Atribuição | Existe e é boa: UTM padrão, `utm_tzolkin` (`<produto>.<nicho>`), IDs de anúncio Meta, `fbclid`/`gclid`, `fbc`/`fbp` (com consentimento), sessão, geo, primeiro e último toque | `platform/attribution.mjs`, migração 038, `docs/ATTRIBUTION.md` |
| Casamento com campanha | `commercial_attributions.meta_campaign_id` = `marketing_campaigns.external_id` | migração 038 |
| Passagem de dados do espaço | **Não existe**: o payload do intake não tem bloco para dado específico do espaço | `validateIntake` |
| Dedupe de pessoa/empresa | **Não existe**: cada lead cria uma empresa nova (`slug lead-<hash>`) e uma pessoa nova | `commercial-intake.mjs` |

**Achado que pesa:** hoje 100% dos leads criam uma empresa e uma pessoa novas. O mesmo contato enviando duas
vezes vira duas empresas. A lógica da Kalidash (`resolveParties`) resolve isso.

**Janela livre:** o banco tem 0 leads e 0 pedidos de intake (medido em 01/10). Mudar o modelo agora **não migra
dado nenhum**.

## 3. O que a Kalidash já tem para copiar

| Kalidash | Serve para | Ajuste de contexto |
|---|---|---|
| `Pipeline` (um funil = uma oferta) + `Stage` (tipo LEAD/OPEN/WON/LOST) | funil | **acrescentar `space_id`** (→ `products.id`) |
| `Source` + `PipelineSource` (1 formulário → 1 pipeline) | liga o formulário ao funil | reaproveita a chave de intake do espaço |
| `Lead`, `LeadSubmission` (envio bruto), `LeadState` | lead de verdade | estende `commercial_leads` (expansão, sem apagar nada) |
| `Opportunity`, `OpportunityContact`, `LostReason` | negociação | tabelas novas |
| `Contact` / `Company` com dedupe por e-mail, CPF e CNPJ alfanumérico | pessoa e empresa sem duplicar | Contact = `stakeholders`, Company = `tenants` |
| `CustomField` (entidade, chave, rótulo, tipo, opções) + `customData` | campos próprios | **escopo por espaço** (ver §4) |
| `Task`, `StageRequirement` (campo ou ação, bloqueia entrar/sair da etapa) | tarefas e requisitos de etapa | fase seguinte |
| Eventos `objeto.ação` e automações gerenciadas | automação | fila do outbox que já existe |
| `leadFlow.ts` (`createLead`, `moveLeadStage`, `discardLead`, `qualifyLead`) e `lifecycle.ts` (`canAdvance`) | regra | portar para servidor, mesma lógica |
| `documents.ts` (CPF, CNPJ alfanumérico) | validação | copiar quase literal |

## 4. Desenho proposto (para decidir)

**Pipeline por espaço.** `pipelines.space_id NOT NULL → products(id)`. Um espaço pode ter **mais de um** funil
(ex.: Sites: um por nicho). Só espaços com a capacidade `commercial` têm funil. O lead herda o espaço do funil.
A chave de intake do espaço só alimenta funis **daquele** espaço (a regra de hoje, estendida).

**Campos próprios por espaço (opção A, recomendada).** Tabela de definição `space_fields`
(`space_id`, `entity` = lead | oportunidade | cliente-no-espaço, `key`, `label`, `type`, `options`, `required`) e
valores em `custom_data jsonb` nas linhas de lead, oportunidade e `client_engagements`.
O valor mora na **relação empresa × espaço**, não na empresa: a mesma empresa em dois espaços tem campos
diferentes. Chave que não está definida no espaço → **400** (mesma política do `input()` do intake).

| Alternativa | Por que não |
|---|---|
| B. `jsonb` solto, sem definição | Sem tipo, sem rótulo, sem validação; vira lixo em um mês |
| C. Tabela/colunas por espaço | É o "banco por produto" que o dono rejeitou; migração a cada espaço novo |

**Padrão de atribuição e passagem de dados (v1, em cima do que já existe).**
1. Mantém o bloco `attribution` de `ATTRIBUTION.md`, sem quebrar o hash dos pedidos antigos.
2. `utm_tzolkin` passa a ser `<espaço>.<nicho>`, e o servidor **confere que o prefixo é o espaço da chave**
   (hoje só valida o formato). Impede lead "sites.x" vindo da chave de outro espaço.
3. Novo bloco opcional `space_data` no intake, validado contra `space_fields` do espaço da chave.
4. Convenção de montagem da URL de anúncio (parâmetros dinâmicos da Meta para `meta_*_id`) escrita em
   `ATTRIBUTION.md`, para o site e os anúncios nascerem iguais.
5. Fonte, pipeline e espaço aparecem no lead desde o primeiro toque; primeiro e último toque ficam guardados.

## 5. O que avaliar antes de implementar

1. **Quais espaços têm funil?** Só `commercial` (plataforma, linha de serviço, consultoria). Interno não.
2. **Um espaço, vários funis?** Recomendo sim (nichos de Sites).
3. **Oportunidade × contrato comercial × contratação.** Hoje são três registros (`commercial_contracts`,
   `client_engagements`, `entitlements`). Ao ganhar uma oportunidade, qual deles nasce? Sem decidir isso, duplica.
4. **Campos próprios:** quais tipos (texto, número, data, lista, sim/não, link), obrigatoriedade e o que acontece
   ao remover um campo que já tem valor (recomendo desativar, nunca apagar).
5. **Lead de produto de cliente no Core** (ex.: Kalidash): a regra atual do `DATA-OWNERSHIP.md` diz que não, e o
   `STATUS.md` marca essa regra como desatualizada. Se entrar, há papel de operador/controlador de dado pessoal
   (LGPD) a definir em contrato. Recomendo começar só pelos espaços da Tzolkin.
6. **UTM no site hoje:** o BACKLOG (03/09) dizia "UTM capturado e descartado" e "leads em 503". 🟡 Não verificado
   no `tzolkin-site` agora; precisa de conferência antes de afirmar que o site manda atribuição.
7. **CPF:** guardar só o hash (HMAC) para dedupe, sem texto claro; a Kalidash cifra e faz hash. Segurança fica por
   último, como combinado, mas CPF em claro não deve entrar.

## 6. Decisões mínimas do dono

| # | Decisão | Recomendação |
|---|---|---|
| 1 | "Campos únicos" = campos próprios do espaço (definidos por espaço)? | Sim, opção A |
| 2 | Um espaço pode ter vários funis? | Sim |
| 3 | Ao ganhar a oportunidade, nasce qual registro (contrato, contratação ou os dois)? | Contratação (`client_engagements`); o contrato comercial segue ADR 0008 |
| 4 | Começar só com leads dos espaços da Tzolkin? | Sim |

## 7. Ordem de implementação (depois das decisões)

Segue as fases do próprio plano da Kalidash, adaptadas: **1** funil por espaço, etapas e oportunidade ·
**2** dedupe de pessoa/empresa e CNPJ alfanumérico · **3** leads (fonte, "Ver leads", qualificar) ·
**4** campos por espaço, tarefas e requisitos de etapa · **5** eventos e automações.
Cada fase é de expansão (só `ADD`), publicável sozinha e fecha com teste no banco descartável.
