# ADRs

Registro de decisões de arquitetura. **Só o que é relevante e caro reverter**: escolha de banco, fronteira de dado, modelo de identidade, quem recebe dinheiro. Nomear uma rota não vira ADR.

| # | Decisão | Status |
|---|---|---|
| [0001](0001-core-modular-com-bancos-separados.md) | Core modular com bancos separados por app | `[PROPOSTO]` |
| [0002](0002-vinculo-de-pessoa-por-produto.md) | Escopo do vínculo de pessoa: organização ou produto | `[ACEITA]` — opção B, implementada |
| [0003](0003-configuracao-de-cobranca-por-conta-e-oferta.md) | Configuração de cobrança por conta e oferta, não por produto | `[PROPOSTO]` |
| [0004](0004-integracoes-comerciais-por-produto.md) | Integrações comerciais no contexto do produto | `[ACEITA]` |
| [0005](0005-taxonomia-cliente-produto-servico.md) | Separar cliente, pessoa, oferta, projeto e linha educacional | `[ACEITA]` |
| [0006](0006-checkout-transparente-e-escopo-pci.md) | Checkout transparente com Elements; escopo PCI do cartão Asaas | `[ACEITA]` para o transparente · `[PENDENTE DE DECISÃO]` para cartão Asaas |

## Regras

1. **Status é honesto.** `[PROPOSTO]` e `[PENDENTE DE DECISÃO]` são estados legítimos e permanecem até haver decisão do usuário. **Hipótese não vira ADR aprovada.**
2. **Toda ADR diz o custo de reverter.** É o que justifica ser uma ADR.
3. **Alternativas descartadas ficam registradas, com o motivo.** Sem isso a discussão se repete daqui a seis meses.
4. **ADR não é editada para mudar de ideia.** Cria-se outra que a substitui, e a antiga passa a `[SUBSTITUÍDA POR NNNN]`.
5. Numeração sequencial, nome em kebab-case.
