# ADR 0011 — Leads centralizados no Core; regra de negócio nos produtos

- **Status:** `[ACEITA]` em 2026-10-01, decisão do dono. Substitui o trecho "Os dois tipos de lead não se misturam" de
  `DATA-OWNERSHIP.md`.
- **Referências:** `docs/design/2026-10-01-pipeline-por-espaco-e-atribuicao.md`, `docs/ATTRIBUTION.md`,
  ADR "Ecossistema TZOLKIN" no Notion (30/08), que já põe CRM entre o escopo do Core.

## Contexto

O desenho anterior mandava o lead da TZOLKIN para um banco **institucional**, do `tzolkin-site`, e um worker do Core
lia a fila `institucional.core_outbox` desse banco e chamava o intake do próprio Core. Isso exigia um banco por
produto só para guardar lead, três variáveis de ambiente (`INBOUND_SITE_DATABASE_URL`, `INBOUND_SITE_API_KEY`,
`PUBLIC_ORIGIN`) e um processo no Core que só roda em produção. A expectativa original do Core era outra:
**centralizar toda a parte de leads e deixar a lógica de negócio nos produtos.**

## Decisão

1. **Todo lead dos espaços da TZOLKIN vive no Core** (`commercial_leads`, `commercial_attributions`), não em banco de
   produto.
2. **O produto chama o intake do Core direto** (`POST /v1/commercial/intake`), com a chave do espaço, servidor a servidor.
   O intake já é idempotente e valida espaço, escopo e formato.
3. **Sem fila, sem worker, sem banco intermediário.** Saíram do Core: `integrations/institutional-outbox.mjs`,
   `modules/inbound-delivery.mjs`, a linha "Entrega do site" do Inbound e as variáveis `INBOUND_SITE_*`.
4. **A regra de negócio fica no produto** (o que perguntar, como qualificar, o que oferecer). O Core guarda o lead, a
   atribuição, o funil e o histórico.

## Em aberto (não decidido por esta ADR)

- **Lead de produto de cliente** (ex.: Kalidash, outro contrato) no Core: continua **fora** por enquanto. Entrar exige definir
  papel de operador de dado pessoal (LGPD) em contrato.
- **Rede de segurança do envio.** Sem a fila, um Core fora do ar no momento do envio perderia o lead. Proposta: o site tenta o
  intake 2 a 3 vezes (a chave de idempotência evita duplicar) e, se falhar, manda e-mail interno com o lead. `[PROPOSTO]`

## Custo de reverter

Baixo. O desenho antigo ainda existe no histórico do git (`institutional-outbox.mjs`, `inbound-delivery.mjs`) e nas migrações
do `tzolkin-site`, que não foram apagadas nem aplicadas por aqui.

## Alternativas descartadas

| Alternativa | Por que não |
|---|---|
| Manter o banco institucional com fila e worker | Um banco por produto e um processo a mais; foi o que o dono rejeitou |
| Lead no banco de cada produto, resumo no Core | Espalha o funil; sem visão única por espaço |
| Escrita dupla (site e Core) | Dois registros do mesmo lead, sem dono |
