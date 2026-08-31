# Documentação do TZOLKIN Core

Documentação técnica versionada junto com o código, neste repositório. **Não substitui** a Wiki, os documentos empresariais nem as rotinas do Notion — descreve o software.

Última revisão completa: **2026-08-30**.

## Índice

| Documento | Responde a |
|---|---|
| [CONTEXT.md](CONTEXT.md) | O que existe hoje, o que foi decidido, o que é proposta e o que está travado esperando decisão |
| [PRODUCT.md](PRODUCT.md) | Quem usa, para quê, quais jornadas e o que está fora de escopo |
| [DOMAIN-MODEL.md](DOMAIN-MODEL.md) | Entidades, identificadores, relações e ciclos de vida |
| [ARCHITECTURE.md](ARCHITECTURE.md) | Módulos, fronteiras, contratos e o pipeline de requisição |
| [DATA-OWNERSHIP.md](DATA-OWNERSHIP.md) | Quem é dono de cada dado, isolamento e fonte de verdade |
| [BILLING.md](BILLING.md) | Fluxos financeiros, provedores, estados e conciliação |
| [INTEGRATIONS.md](INTEGRATIONS.md) | APIs, eventos, autenticação, falhas e sincronização |
| [SECURITY.md](SECURITY.md) | Identidade, permissões, segredos e auditoria |
| [DESIGN-SYSTEM.md](DESIGN-SYSTEM.md) | Tokens, componentes, navegação e estados de interface |
| [INFRASTRUCTURE.md](INFRASTRUCTURE.md) | Ambientes, bancos, migrações, backup, deploy e observabilidade |
| [ROADMAP.md](ROADMAP.md) | Entregas verticais, dependências e critérios de aceite |
| [TESTING.md](TESTING.md) | Estratégia, comandos e cobertura |
| [decisions/](decisions/) | ADRs — só decisões relevantes e difíceis de reverter |

## Como ler: classificação de maturidade

Todo bloco de conteúdo carrega uma destas marcas. **Nunca** apresente proposta como implementação.

| Marca | Significado |
|---|---|
| `[EXISTENTE E VERIFICADO]` | Está no código deste repositório e foi conferido na data da revisão (execução, teste ou consulta ao banco). |
| `[DECIDIDO]` | O usuário decidiu; ainda pode não estar implementado. |
| `[PROPOSTO]` | Sugestão técnica desta documentação. Não vale como acordo. |
| `[PENDENTE DE DECISÃO]` | Bloqueia trabalho. Está listado em [CONTEXT.md](CONTEXT.md#5-decisões-pendentes). |
| `🟡 HIPÓTESE` | Afirmação não validada, mantida à vista até ser confirmada ou descartada. |

## Como manter

1. **Uma fonte por regra.** Cada regra mora em um documento e os outros referenciam por link. Se você está prestes a repetir uma regra, coloque um link.
2. **Marca obrigatória.** Conteúdo novo nasce com uma das marcas acima. Promover de `[PROPOSTO]` para `[DECIDIDO]` exige uma decisão registrada do usuário; para `[EXISTENTE E VERIFICADO]`, exige código e verificação.
3. **Verificado tem data.** Toda afirmação `[EXISTENTE E VERIFICADO]` cita como foi conferida (arquivo, teste ou comando) e a data.
4. **ADR só para o que é caro reverter.** Escolha de banco, fronteira de dado, modelo de identidade, quem recebe dinheiro. Não crie ADR para nomear uma rota.
5. **Mudou o código, mudou o doc, no mesmo passo.** Um endpoint novo sem linha em [ARCHITECTURE.md](ARCHITECTURE.md) é entrega incompleta.
6. **Nunca escreva segredo aqui.** Nomes e finalidade de variáveis vão para `.env.example`; valores, jamais. Ver [SECURITY.md](SECURITY.md#5-segredos).
