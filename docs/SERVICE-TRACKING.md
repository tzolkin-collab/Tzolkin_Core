# Acompanhamento de serviços

## Entrega inicial — 2026-08-31

Agenda mensal interna, filtro por cliente, categorias de atividade (mentoria,
consultoria, software, educacional, outro), sessões/entregáveis/features/tarefas,
status com revisão otimista, apontamentos manuais e gráfico de horas por dia.
PostgreSQL persiste registros e auditoria na mesma transação. UUID do comando
permite repetir criação/apontamento após resposta perdida sem duplicar a gravação.
Não há garantia de disponibilidade absoluta ou recuperação após perda do servidor.
Não foram configurados backups externos nem executado ensaio de restauração.

Somente administrador interno. O filtro de cliente NÃO é autorização de portal.
O ator da sessão administrativa é gravado na auditoria; equipes continuam pendentes.
Agenda em America/Sao_Paulo; formulário atual usa UTC-03. Sem recorrências, edição
de horário, convites externos ou sincronização. Status pode ser reaberto; histórico
é preservado. Apontamentos são acrescentados, não apagados; correções auditadas
estão pendentes. As horas do mês usam worked_on, não a data prevista da sessão.
Resumos de atividades incluem intervalos que cruzam o mês e não medem presença.
Resultados limitados a 500 atividades e 500 apontamentos com aviso de truncamento.

## Contratação — 2026-10-02 (migração 041)

A atividade pode pertencer a uma contratação (`service_activities.engagement_id`, opcional). O banco garante,
com chave composta `(engagement_id, tenant_id)`, que a contratação é da mesma empresa; a rota confere antes
e responde 400, e recusa contratação arquivada para atividade nova. Atividade antiga ou geral da empresa
continua válida (sem contratação). `PUT /api/tracking/:id/engagement` troca ou tira a contratação, com
revisão otimista e auditoria (`engagement_changed`). `GET /api/tracking` aceita `engagement_id` e devolve as
contratações em curso para o formulário. A ficha da empresa separa as horas do mês por contratação, e a hora
sem contratação aparece por último. O item de menu Acompanhamento voltou.
Continua pendente: responsável por operador (decisão sua: do cliente ou da contratação), orçamento de horas,
participantes, objetivos e anexos. Categoria da atividade não substitui a categoria canônica do produto.

## Próximas camadas, ainda não implementadas

O pedido do dono de 2026-10-06 sobre a tela de atividade está destrinchado em
[ACOMPANHAMENTO-REDESENHO.md](ACOMPANHAMENTO-REDESENHO.md), item a item, com o que falta para cada um existir —
participantes (item 9) e anexos (item 4) do número 1 abaixo são de lá.

1. Contratação (restante): responsáveis, participantes, orçamento de horas, objetivos, critérios de aceite
   e anexos.
2. Métricas: definições versionadas com slug, nome, unidade, fonte, dimensões,
   numerador/denominador, período, metas e visibilidade. Mentoria: presença por
   participante elegível, progresso de objetivos e avaliação antes/depois.
   Consultoria: entregas aceitas/pactuadas, pontualidade, consumo do orçamento,
   retrabalho e indicadores de resultado acordados. Horas não provam resultado.
3. Calendário: recorrência com exceções, reagendamento, conflitos, participantes,
   lembretes e conector de calendário externo. Não enviar convites sem confirmação.
4. Email outbound: provedor/domínio autorizado, templates versionados, outbox
   transacional, worker com tentativas limitadas/backoff, chave de idempotência,
   fila de falhas, eventos de entrega/bounce e cancelamento de lembretes obsoletos.
   Timeout de envio é resultado desconhecido: reconciliar antes de reenviar.
5. Email inbound: validar assinatura e replay do webhook, deduplicar eventos e
   Message-ID, associar thread/cliente sem confiar no remetente como autorização,
   sanitizar HTML, limitar anexos, verificar malware, retenção e acesso privado.
6. Resiliência: backup cifrado fora do host, restauração testada, objetivos RPO/RTO,
   métricas/alertas, migrações compatíveis, upload privado e URLs temporárias.
7. Portal: autenticação nominal, isolamento por tenant no servidor e no cache,
   papéis, direitos por contratação e testes de acesso cruzado. API atual é admin.

Core é fonte cadastral; cada app mantém execução específica. Integrações futuras
publicam eventos versionados; não exigir acesso SQL irrestrito aos bancos dos apps.
