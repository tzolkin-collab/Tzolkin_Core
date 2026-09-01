# Financeiro interno — Meu Pluggy

Escopo: contas próprias autorizadas em PLUGGY_ITEM_IDS, com credenciais da mesma aplicação. Não importa contas de clientes, não inicia pagamentos e não altera o banco de origem.

## Uso

Menu Financeiro abre todas as contas e extratos já salvos. Cards filtram a conta; mês e conta selecionados são lembrados no navegador (somente filtros, nunca valores ou transações em localStorage).
Ao abrir, snapshots históricos válidos são reutilizados; o mês atual é atualizado em segundo plano quando a última gravação tem 12 horas. Períodos ausentes são importados automaticamente para todas as contas. Há uma só ação manual: Atualizar dados.
Os dados salvos permanecem visíveis durante a atualização; falhas preservam o snapshot anterior e são indicadas. Tentativas com erro/interrompidas têm intervalo de dez minutos antes de nova tentativa automática, registrado no banco. Requisições concorrentes para a mesma conta/período compartilham uma execução no processo atual.
Extrato consolidado, busca, filtro de entrada/saída e páginas de 30 linhas. Gráfico e indicadores usam somente movimentos efetivados de contas BANK na moeda selecionada. Entradas e saídas são brutas, incluem transferências e não representam receitas, despesas contábeis ou lucro. Cartões e moedas diferentes não são somados.
Detalhes recolhidos mostram datas de consulta e atualização do banco separadamente.

### Composição visual aprovada

Tema claro fixo, resumo sem cards contornados, filtro de conta/período na mesma barra e contas recolhidas abaixo do extrato. Saldo em contas é o último saldo consultado de contas BANK na moeda selecionada, nunca uma soma de cartões. Um saldo ausente torna o total indisponível em vez de virar zero.

O gráfico principal é **Movimento acumulado**, partindo de zero: não é histórico de saldo, que ainda não está disponível. O gráfico secundário mostra entradas e saídas diárias com valores acessíveis por seleção de dia. A seção de categorias identifica as saídas como não categorizadas, sem inventar classificação. Transações abrem detalhes ao clicar no texto, também acessíveis pelo teclado.

## Persistência e segurança

- Migração 005 cria finance_snapshots: projeções mínimas, sem credenciais, CPF, números de conta ou payload bruto.
- Contas por item; extrato por conta/mês. Gravação atômica somente após todas as páginas chegarem. Falha preserva o snapshot anterior.
- Deduplicação pelo ID da transação; substituição do mês remove registros excluídos pelo provedor quando ressincronizado.
- Cursor extraído apenas do parâmetro after, host HTTPS fixo, sem seguir URLs/redirecionamentos fornecidos pelo provedor.
- API key em memória por até 110 minutos; credenciais nunca enviadas ao browser.
- Rotas administrativas: sessão e CSRF existentes. Conta precisa pertencer a um item atualmente configurado.
- Timeout de 12 segundos e limite de 50 páginas: exceder falha sem gravar extrato parcial.
- A aplicação continua sendo bootstrap local. Antes de produção: identidade individual, autorização por função, retenção, backup/restauração testados e revisão da segurança da infraestrutura.

## Limites explícitos

Atualização automática ocorre ao abrir a tela, não como scheduler permanente. Sem webhooks ou varredura histórica completa. Meses antigos precisam de atualização explícita para refletir correções posteriores do provedor. A primeira leitura de snapshots legados força uma atualização para corrigir os limites mensais: consulta um envelope UTC e filtra exatamente o mês em America/Sao_Paulo, incluindo a última noite local. O histórico armazenado não é um livro contábil nem trilha imutável. Autorizações revogadas no banco podem deixar snapshots históricos no Core; remover o Item ID bloqueia a exposição por essas rotas, mas não apaga armazenamento. Não há garantia de snapshot consistente entre páginas caso o banco atualize dados durante a consulta. Coalescência de requisições vale para um processo; múltiplas réplicas exigirão trava distribuída.

## Verificação

`npm run test:unit`; `node --env-file=.env scripts/check-pluggy.mjs` verifica apenas acesso aos itens. `node scripts/preview-finance.mjs` oferece QA com dados sintéticos em 3101, sem .env. O app real fica em 3100.

Referências oficiais:
- https://docs.pluggy.ai/reference/accounts-list
- https://docs.pluggy.ai/reference/transactions-list-by-cursor
- https://docs.pluggy.ai/docs/transactions
