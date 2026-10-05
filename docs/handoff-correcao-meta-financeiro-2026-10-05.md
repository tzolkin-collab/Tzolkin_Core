# Handoff — Meta OAuth e visão anual do Financeiro

Data: 2026-10-05

## Sintomas observados

- A janela do Facebook recebeu `redirect_uri=http://127.0.0.1:3100/api/marketing/meta/callback`, reproduzido na aba aberta do Chrome. Esse callback local em HTTP explica o aviso de transferência insegura.
- O quadro anual do Financeiro agregava snapshots já salvos dos doze meses, mas `refresh()` solicitava extrato e vendas somente para o mês corrente. Meses sem snapshot permaneciam vazios, produzindo totais anuais zerados.

## Ações de alteração

- Alterado `apps/api/src/modules/marketing.mjs`: o callback agora usa `META_REDIRECT_URI` ou a origem HTTPS de `PUBLIC_ORIGIN`; sem origem segura o Core responde 503 antes de redirecionar para a Meta.
- Reiniciada a API local (porta 3102) para carregar a correção; o processo agora está escutando nessa porta.
- Iniciado o servidor web local na porta 3100, que estava parado e causava `Failed to fetch`; confirmado HTTP 200 na página e em `/health`.
- Salvo `META_LOGIN_CONFIG_ID=28684560031236835` no registro de credenciais existente. A checagem do Core agora retorna `login_mode=business`; o token já conectado continua sendo o antigo até nova autorização.
- Sincronizado setembro de 2026 da conta Nubank pela rota normal `POST /api/finance/transactions/sync`: o snapshot passou de 16 para 33 transações, com R$ 1.698,63 em entradas e R$ 1.509,77 em saídas.
- Recalculado o consolidado salvo de 2026: Nubank com 422 transações, R$ 47.266,36 em entradas e R$ 47.835,64 em saídas; Banco Inter com R$ 1.457,99 em cada sentido. Novembro e dezembro têm snapshots sem transações.
- Alterado `apps/api/src/modules/finance.mjs`: cada conta informa os meses com extrato persistido, para a tela distinguir meses faltantes por conta.
- Alterado `apps/api/src/modules/payment-sales.mjs`: cada processador informa os meses com vendas persistidas.
- Alterado `apps/web/public/finance.js`: na visão anual, busca todos os meses ainda sem snapshot; o botão de atualização força todos os meses do ano selecionado. Recarrega os quadros depois das sincronizações para mostrar o agregado novo.
- Atualizado `docs/FINANCE.md` com a importação anual de períodos ausentes.
- Atualizado `docs/PRODUCTION-DEPLOY.md` com a exigência de callback HTTPS para Login da Meta.
- Adicionado este handoff para registrar as alterações.

## Remoções

- Nenhuma rota ou credencial foi removida. O snapshot antigo de setembro foi substituído atomicamente pela atualização do provedor; nenhuma transação bancária foi alterada na Nubank.

## Estado e limites

- Não foram executados testes nem houve deploy. Nenhuma nova autorização OAuth foi concluída.
- O ambiente `.env` local declara `PUBLIC_ORIGIN=https://core.tzolkin.cloud`; o próximo início de login pelo ambiente local usa esse callback HTTPS. O modo Empresas está ativo, mas é preciso reconectar e autorizar para trocar o token atual, que ainda expira em 04/12/2026.
- Os meses anuais ausentes serão importados ao abrir a visão anual; isso pode fazer até 12 consultas mensais por conta e por processador na primeira carga do ano selecionado.
