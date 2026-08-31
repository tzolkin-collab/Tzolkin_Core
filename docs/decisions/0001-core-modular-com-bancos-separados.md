# ADR 0001 — Core modular com bancos separados por app

- **Status:** `[PROPOSTO]` — formaliza a direção acordada em `../../../COORDENACAO-CLAUDE.md`; ainda não aprovada como ADR.
- **Data:** 2026-08-30

## Contexto

O ecossistema tem seis produtos e três bancos vivos (Core, institucional, Redis do chatbot). O Core precisa ser autoridade sobre organizações, vínculos e direitos sem virar o backend de todo mundo.

Três caminhos costumam ser propostos:

1. **Banco único** para tudo.
2. **Banco por tenant.**
3. **Microsserviços** com base por serviço.

O volume atual é cadastral: 6 produtos, 13 fichas, zero organizações. A equipe tem 4–5 pessoas, com participação variável.

## Decisão proposta

**O Core é uma aplicação modular em um processo, com banco exclusivo. Cada app mantém o próprio banco. A integração é por API, com contrato explícito.**

- Módulos com fronteira declarada em código (`platform/` + `modules/`), não pacotes separados.
- `tzolkin_core` guarda só o que é do Core; nada de operação de produto.
- Bancos existentes são preservados: nenhuma migração de dado por conta desta decisão.
- Banco por tenant **não** é adotado.
- Microsserviço **não** é adotado agora.

## Por quê

**Contra banco único:** transformaria o Core em backend universal, contrariando a regra 1 de [CONTEXT.md §3](../CONTEXT.md#3-restrições-que-não-se-negociam-decidido), e faria toda falha de isolamento virar falha global.

**Contra banco por tenant:** multiplica migração, backup e conexão por cliente. Com zero organizações cadastradas, é custo antes de qualquer benefício. Continua sendo a opção certa para um produto específico que exija separação física — decidido caso a caso, não como padrão.

**Contra microsserviços:** exigiria orquestração, observabilidade distribuída e disciplina de contrato que a equipe atual não tem folga para manter. Modularidade dá a fronteira sem o custo operacional.

**A favor:** módulo com fronteira explícita pode virar serviço depois. O contrário — desmontar microsserviços prematuros — é bem mais caro.

## Consequências

**Boas**
- Fronteira legível: quem lê `src/modules/` vê os domínios.
- Um processo, um banco, um deploy: operação simples.
- Reversível na direção certa (módulo → serviço).

**Ruins, e assumidas**
- Um processo é um ponto único de falha. Aceitável em ferramenta interna; **não** aceitável para o backend de um produto cliente.
- Fronteira em código depende de disciplina; o compilador não impede um atalho. Mitigado pela regra de dependência em [ARCHITECTURE.md](../ARCHITECTURE.md#2-módulos-existente-e-verificado).
- Consolidar dado de vários apps exigirá API ou evento, nunca `JOIN` entre bancos.

## Custo de reverter

- **Módulo → serviço:** baixo, se as fronteiras forem respeitadas.
- **Bancos separados → banco único:** alto. Migração de dado com janela de indisponibilidade.
- **Banco único → separados:** muito alto. É o principal motivo de não começar unindo.

## Aberto

- [D5](../CONTEXT.md#d5--isolamento-no-banco-só-query-ou-rlsseparação-física) — defesa de isolamento dentro do banco.
- Se algum produto exigir separação física por cliente, essa exceção é decidida e documentada por produto.
