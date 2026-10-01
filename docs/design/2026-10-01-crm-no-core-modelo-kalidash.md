# CRM no Core: portar o modelo da Kalidash (proposta)

Status: **`[PROPOSTO]`** em 2026-10-01. Nada implementado. Depende das decisões do §8.

Origem da ideia: o sistema da Kalidash (`Projetos/Carol/Kalidash`) tem um modelo de leads,
empresas, oportunidades e eventos bem pensado. Este documento diz o que dele vale levar para o
Core, o que não vale, e em que ordem.

---

## 1. Restrições que moldam a proposta

1. **A Kalidash é um contrato separado.** Os dados dela (leads, pessoas, oportunidades) pertencem
   ao backend dela. O Core **não os recebe**: `docs/DATA-OWNERSHIP.md` diz "O Core não recebe
   leads operacionais de clientes", e `docs/DOMAIN-MODEL.md` lista "Lead de uma organização
   cliente" como "Backend do produto. Nunca no Core".
2. Portanto não se "pluga" o formulário da Kalidash no Core. O que se leva é o **modelo** (o
   desenho), para o CRM da **própria Tzolkin**, que capta leads de tzolkin.cloud e dos produtos
   da casa.
3. 🟡 HIPÓTESE a confirmar: o contrato com a Kalidash pode tratar documentação e desenho de
   domínio como entrega do cliente. Reaproveitar o **conceito** é prática comum; copiar
   texto, telas ou código talvez dependa do contrato. Ver §8, decisão 1.

## 2. O que a Kalidash tem de fato (verificado no repositório)

| Parte | Estado real |
|---|---|
| Definição de domínio (`docs/dominio.md` v2.1) | Escrita e confirmada. Boa. |
| Porta de entrada de formulário (`docs/inbound-leads.md`) | Especificada: `connect.js`, API direta, webhook; payload único. |
| Motor de eventos (`admin/src/lib/events.ts`) | Existe, mas roda **em memória, no navegador** ("Tudo em memória, sem servidor"). |
| Leads, pessoas, empresas, pipelines, tarefas, automações | Dados de **mock** (`src/mocks/*`). |
| Gatilhos por webhook (`docs/gatilhos-personalizados.md`) | "Nada disto está implementado." |
| Banco | `dominio.md`: "Nada foi alterado no banco." `plano-schema.md` existe, não aplicado. |
| Backend real | API Go + MySQL (~1.000 linhas): oportunidades, notas, e-mail, blog. Sem lead, empresa, fonte ou evento no servidor. |

Conclusão: o que "funciona bem" é o **desenho e o protótipo de tela**. Portamos uma
especificação, não um sistema rodando. Isso é mais barato do que portar código, mas não é prova
de que o modelo aguenta uso real.

## 3. O que o Core já tem

| Peça | Onde |
|---|---|
| Lead (status `open/qualified/won/lost/archived`, dono, motivo de perda, versão otimista) | `commercial_leads` |
| Atribuição estendida (UTM, IDs Meta, sessão, geo) | `commercial_attributions` (migração 038) |
| Intake idempotente por chave de app | `commercial_intake_requests`, escopo `commercial:intake` |
| Atividades (timeline) | `commercial_activities` |
| Contrato comercial com aceite | `commercial_contracts` + auditoria |
| Pessoa e empresa | `stakeholders`, `organization_stakeholders`, `tenants` |
| Fila de saída com `FOR UPDATE SKIP LOCKED` | `institutional-outbox.mjs` |
| Push de lead novo | commit `8e64e1e` |

O que **falta**, e a Kalidash já desenhou: oportunidade separada de lead, funil com etapas,
tarefas e requisitos por etapa, deduplicação de pessoa e empresa no intake, catálogo de eventos
no servidor.

## 4. Pré-requisito: o funil está vazio

Hoje o Inbound do Core mostra **0 leads** e "Entrega do site: ainda não configurada". Construir
funil, oportunidade e tarefas sobre um fluxo sem lead é construir no escuro. **A Fase 0 é fazer
o lead chegar** (configurar o consumidor da entrega do site) e ver os primeiros leads reais antes
de investir no resto.

## 5. Mapeamento Kalidash → Core

| Kalidash | Core | Ação |
|---|---|---|
| Pessoa (`Contact`) | `stakeholders` | já existe; falta deduplicar por e-mail/CPF |
| Empresa (`Company`) | `tenants` | já existe; falta estado "em análise" (sem CNPJ) e validação de CNPJ alfanumérico |
| Lead | `commercial_leads` | já existe |
| Oportunidade | `commercial_opportunities` | **nova** |
| Pipeline, Etapa | `commercial_pipelines`, `commercial_stages` | **novas** |
| Fonte | `commercial_sources` (liga formulário → pipeline) | **nova**; reaproveita as chaves `app_clients` |
| Tarefa | `commercial_tasks` | **nova** |
| Requisito de etapa | `commercial_stage_requirements` | **nova** |
| Envio bruto (`LeadSubmission`) | `commercial_intake_requests` | estender para guardar o payload original |
| Evento / automação | `commercial_events` (fila) + despachante no servidor | **novo**, sobre o padrão do outbox existente |
| Campo personalizado | `jsonb` no lead/oportunidade | 🟡 adiar; só se houver demanda real |

## 6. O que levar e o que não levar

**Levar (conceitos)**
- Lead ≠ oportunidade. Lead é interesse não trabalhado; oportunidade é negociação.
- Toda pipeline tem fonte, e o lead sabe de onde veio.
- Cada etapa declara o que exige; dado faltante vira tarefa, e etapa pode bloquear.
- Cliente é estado, não entidade.
- Eventos `objeto.ação` num catálogo fechado, com "outro" como escape.
- Automação manual sempre existe: a automática chama a mesma ação que o botão.
- Pessoa e empresa não duplicam (busca por e-mail, CPF, CNPJ).
- Validação de CNPJ alfanumérico (em vigor desde 31/07/2026, segundo a doc da Kalidash).

**Não levar**
- Código do protótipo (mocks, motor em memória no navegador).
- O banco MySQL: o Core fica em Postgres (ADR 0010).
- Campos personalizados e gatilhos por webhook de entrada na primeira leva. O próprio documento
  da Kalidash deixa a segurança dos webhooks "para a fase de segurança".

## 7. Plano em fases

| Fase | Entrega | Esforço | Risco |
|---|---|---|---|
| 0 | Fazer leads chegarem: configurar o consumidor da entrega do site; ver os 3 primeiros leads reais | 0,5–1 dia | Baixo |
| 1 | Deduplicação de pessoa/empresa no intake; validador de CNPJ alfanumérico; empresa "em análise" | 2–3 dias | Baixo |
| 2 | Pipeline, etapas e oportunidade; a tela Inbound vira Leads · Funil | 4–6 dias | Médio |
| 3 | Tarefas e requisitos de etapa | 3 dias | Médio |
| 4 | Catálogo de eventos e despachante no servidor; automações gerenciadas | 5–7 dias | Médio |
| 5 | Gatilhos por webhook (pagamento confirmado move para Ganho), com assinatura | a definir | Alto |

Total das fases 1 a 4: cerca de 3 a 4 semanas. Cada fase é publicável sozinha, com migração só
de expansão (como a 038), de modo que o código antigo continua funcionando.

Efeito no menu (ver `2026-10-01-avaliacao-ux-e-nova-navegacao.md`): o item **Inbound** deixa de
ser uma tela vazia e vira **Leads**, com abas Leads · Funil · Tarefas. Campanhas passa para uma
área de marketing, fora do caminho principal.

## 8. Decisões para o dono do produto

1. **Contrato e propriedade intelectual.** O contrato com a Kalidash permite reaproveitar o
   desenho de domínio no CRM da Tzolkin? Se não estiver claro, reescrever os conceitos com
   vocabulário próprio, sem copiar texto.
2. **Destino do CRM da Tzolkin.** É só ferramenta interna do Core, ou vira também um **produto
   de prateleira** (um "CRM como linha de serviço" para outros clientes, como a Kalidash)? A
   segunda opção pede um repositório separado, não código dentro do Core.
3. **Fase 0 primeiro.** Concordar em não construir funil antes de haver lead real chegando.
4. **Empresa "em análise".** Estado novo em `tenants`, ou campo derivado dos contratos?

## 9. Riscos

- **Modelar demais cedo.** Funil, tarefas e eventos sobre zero leads reais. Mitigação: Fase 0
  como condição.
- **Dados de cliente entrando por acidente.** Qualquer ponte com a Kalidash quebra a regra de
  propriedade dos dados. Mitigação: o Core só recebe leads da própria Tzolkin, e a chave
  `commercial:intake` continua por produto.
- **LGPD.** Telefone, documento e campos extras exigem consentimento registrado (já há
  `privacy` no lead) e, na especificação da Kalidash, criptografia em repouso (lá "planejada").
  Decidir antes da Fase 1 se o Core cifra documento.
- **Motor de eventos duplicado.** Evitar uma segunda fila: usar o padrão do outbox atual.
