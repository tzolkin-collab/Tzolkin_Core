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
Ator registrado como admin-bootstrap: identidade nominal e equipes pendentes.
Agenda em America/Sao_Paulo; formulário atual usa UTC-03. Sem recorrências, edição
de horário, convites externos ou sincronização. Status pode ser reaberto; histórico
é preservado. Apontamentos são acrescentados, não apagados; correções auditadas
estão pendentes. As horas do mês usam worked_on, não a data prevista da sessão.
Resumos de atividades incluem intervalos que cruzam o mês e não medem presença.
Resultados limitados a 500 atividades e 500 apontamentos com aviso de truncamento.

## Próximas camadas, ainda não implementadas

1. Contratação: ligar atividade a produto/oferta e contratação, responsáveis,
   participantes, orçamento de horas, objetivos, critérios de aceite e anexos.
   Categoria da atividade não substitui a categoria canônica do produto.
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
