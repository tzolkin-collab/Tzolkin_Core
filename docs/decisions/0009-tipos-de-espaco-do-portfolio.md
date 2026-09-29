# ADR 0009 — Tipos de espaço do portfólio

- **Status:** `[ACEITA]` em 2026-09-29 (código pronto; migração `036` escrita, **não aplicada**)
- **Substitui em parte:** [ADR 0007](0007-portfolio-kind-rotulo-ou-regra.md) (o vocabulário de tipos)
- **Referências:** migração `036_portfolio_espacos.sql`, `apps/api/src/modules/catalog.mjs` (`KIND_REGISTRY`), `portfolio.mjs`

## Contexto

O Portfólio é onde a TZOLKIN cadastra **espaços**: o que ela vende ou opera. Havia quatro tipos
(`product`, `platform`, `service_line`, `internal`). O levantamento de 2026-09-29 mostrou que
`product` e `platform` **não tinham nenhuma diferença funcional**: todas as capacidades os listavam
juntos, e só o rótulo, o ícone e o texto mudavam. Além disso:

- os tipos estavam escritos duas vezes, na API e no painel, e o painel ainda tinha ids de item fixos
  no código;
- não existia tela para criar ou editar um espaço; só a API;
- Mentorias e Consultorias eram duas linhas de serviço separadas, sem noção de tag.

## Decisão

1. **Plataforma** passa a ser um só tipo: software B2B ou B2C que o cliente usa, muitas vezes por
   assinatura (Skiller, Educare). `product` deixa de existir como tipo. O valor antigo continua aceito
   na escrita e lido como `platform`, até a migração `036` regravar as linhas.
2. **Consultoria e assessoria** (`advisory`) é um tipo novo, com **tags** (`products.tags`, até 8).
   Tem as regras de linha de serviço: trabalho sob contrato, cobrança por contrato aceito (ADR 0008).
3. **Linha de serviço** (Sites) e **Interno** (Core) ficam como estão.
4. **Os tipos vêm de um registro só** (`KIND_REGISTRY`): rótulo, plural, ícone, texto e ordem. O painel
   os recebe em `GET /api/overview` e `GET /api/portfolio`, e não guarda dicionário próprio.
5. O painel ganha o cadastro de espaços: **Novo espaço** e **Editar**, com tipo e tags.

## Fora desta decisão, de propósito

**Fundir Mentorias e Consultorias num espaço só.** Move contratações, recursos, planos de recebimento e
campanhas de produção. O id de um item é imutável e a role de produção não faz `DELETE`: um dos dois
itens seria arquivado e o outro reclassificado para `advisory`, com tags. É ação do dono, item a item,
com conferência, e não um script automático.

## Custo de reverter

Baixo enquanto a `036` não for aplicada. Depois dela: o CHECK aceita um valor a mais e a tabela tem uma
coluna a mais, ambos inofensivos; a única mudança de dado é `product` → `platform`, com trilha em
`portfolio_audit` (`actor_subject = 'migration:036'`) e reversível por `UPDATE` inverso.

## Ordem de aplicação

1. Aplicar a `036` **antes** do deploy: o código novo seleciona `tags` e oferece `advisory`.
2. Deploy do código.
3. Depois, se o dono quiser, unificar Mentorias e Consultorias.

## Alternativas descartadas

| Alternativa | Por que não |
|---|---|
| Manter `product` e `platform` | Sem diferença funcional; dois nomes para a mesma regra confundem quem cadastra. |
| Tag no lugar de tipo | Tag não carrega regra. Consultoria precisa das capacidades de trabalho sob contrato. |
| Fundir Mentorias e Consultorias na migração | Move dado de produção sem conferência, e o id não muda. |
