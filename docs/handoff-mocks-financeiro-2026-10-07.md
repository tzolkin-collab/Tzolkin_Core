# Handoff — mocks temporários do financeiro

**Data:** 07/10/2026  
**Escopo:** somente apresentação no frontend; nenhuma gravação ou alteração na API, banco de dados, contas ou extratos.

## Alterações para a demonstração

- `apps/web/public/finance.js`: saldo do card principal substituído visualmente por **R$ 8.143,29** quando a moeda selecionada é BRL. O cálculo original `bankBalance(picked(), currency)` foi mantido e pode ser reativado.
- `apps/web/public/finance.js`: o card **Saídas** mostra **R$ 16.284,73** em BRL. O cálculo original `summary.outgoing` foi mantido em comentário; extratos, gráficos, filtros e transações continuam usando os dados reais da API.
- `apps/web/public/finance.js`: **Entradas** permanece ligado a `summary.incoming`, portanto mostra os dados que a API importou (aproximadamente R$ 48 mil, conforme pedido).
- `apps/web/public/finance.js`: adicionado o card temporário **Investimentos diversos**, com **R$ 3.286,47** em BRL. Não há investimento persistido nem integração criada.
- `apps/web/public/finance.css`: grade dos indicadores ajustada para quatro cards em telas largas; o layout existente de duas colunas em telas menores permanece.

## Para retirar os mocks depois

1. Em `apps/web/public/finance.js`, remover a constante `mockBRL` e `topMetrics` e o laço que renderiza `topMetrics`.
2. Restaurar a renderização de **Saldo em contas** com `balance` e de **Saídas** com `usable ? summary.outgoing : null`; manter **Entradas** com `usable ? summary.incoming : null`.
3. Remover o item **Investimentos diversos**. Ele é apenas um valor visual temporário, sem fonte real.
4. Em `apps/web/public/finance.css`, restaurar `grid-template-columns: 1.35fr 1fr 1fr` se voltarem a existir somente três indicadores.
5. Apagar este handoff quando a demonstração terminar.

Os valores mock são condicionados à moeda BRL. Para outras moedas, saldo e saídas continuam exibindo os cálculos funcionais, e investimentos aparece indisponível.
