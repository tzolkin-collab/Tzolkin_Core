# Linha de base — Pipeline, Campanhas e Fontes/Eventos

Data da leitura: **2026-10-05 17:51 BRT**. Fonte: banco do Core configurado neste checkout. Consulta agregada em transação **READ ONLY**, pelo módulo oficial do Core, com TLS e certificado verificados. Nenhum nome, e-mail, token ou payload foi selecionado.

## 1. Pipeline

| Indicador | Snapshot |
|---|---:|
| Funis ativos / padrão | 5 / 5 |
| Etapas semeadas | 40 — 10 LEAD, 20 OPEN, 5 WON, 5 LOST |
| Leads | 0 |
| Oportunidades | 0 |
| Tarefas | 0 |
| Requisitos de etapa ativos | 0 |
| Atribuições registradas | 0 |

**Leitura:** não existe amostra para calcular conversão, tempo entre etapas, bloqueios ou tarefas vencidas. As etapas e os cinco funis estão cadastrados, mas nenhum requisito de gate foi configurado. O Core registra mudanças de etapa do lead em commercial_activities como stage_changed; não havia atividades para analisar. A oportunidade guarda a entrada na etapa atual, mas sem oportunidades e sem uma série completa de estágios não há conversão histórica.

**Medições quando houver dados:** conversão por etapa e funil; tempo até primeiro contato e tempo em etapa; gates bloqueados por tarefas/campos; tarefas concluídas, vencidas e sem responsável; lead → oportunidade → venda.

## 2. Campanhas

| Indicador | Snapshot |
|---|---:|
| Contas Meta ativas | 2 |
| Campanhas conhecidas | 3 |
| Sincronizações registradas | 1 — status OK |
| Janela solicitada na última coleta | 2026-07-07 a 2026-10-05 |
| Campanhas com insights | 1 de 3 (33,3%) |
| Campanhas vinculadas a produto/contratação | 0 de 3 |
| Linhas diárias de insight | 1, referente a 2026-09-25 |
| Métricas nessa linha | R$ 10,83; 166 impressões; 10 cliques |
| Métricas de leads/compras | sem valor informado |

**Leitura:** a API Meta e a persistência funcionaram nessa única execução, mas cobertura de insights é baixa. Leads e compras sem valor significam dado ausente/não informado, não zero. A coleta continua sob demanda; esse snapshot não demonstra periodicidade nem frescor sustentado.

**Medições quando houver coletas recorrentes:** frescor por conta, cobertura campanha/dia, falhas parciais e paginação; gasto, impressões, cliques e conversões por moeda; correspondência anúncio → UTM → lead → pagamento confirmado e diferença frente ao provedor.

## 3. Fontes/Eventos

| Indicador | Snapshot |
|---|---:|
| Eventos de webhook Stripe | 6 — 4 aplicados, 2 não tratados |
| Eventos Asaas | 0 |
| Solicitações de intake/formulário | 0 |
| Leads com atribuição | 0 |
| Histórico genérico de eventos | não existe como domínio operacional |
| Configuração de pixels/tags/fontes genéricas | não encontrada no esquema |

**Leitura:** há histórico específico de webhooks de pagamento, com deduplicação. Isso não equivale ao histórico genérico necessário para pixels, tags e integrações de formulário. audit_events é trilha de auditoria, não um barramento de eventos. O schema atual guarda horário de recebimento para o webhook financeiro, mas não há timestamp original uniforme para medir latência ponta a ponta de todas as fontes.

**Medições após instrumentação:** captura e entrega por fonte/funil; duplicados, inválidos, não tratados e retentativas; latência entre ocorrência e processamento; volume e custo de retenção. Neste snapshot, a falta de fontes genéricas torna essas métricas indisponíveis, não iguais a zero.

## Conclusão e próximo passo

Esta leitura estabelece **ocupação/estado**, não um benchmark de desempenho: Pipeline e intake não têm registros, e Campanhas têm apenas uma linha de insight. Não calcular conversões nem declarar atribuição validada com estes dados.

Próximo passo seguro: validar um fluxo sintético em banco de teste isolado — uma fonte → formulário/lead → etapas/gates/tarefas; um webhook de pagamento de teste; e uma campanha com dados conhecidos — e então verificar deduplicação, vínculo e métricas de ponta a ponta. Só iniciar esse fluxo depois de confirmar que o destino é uma base de teste, para não inserir dados de ensaio na base compartilhada.

## Método e limites

- Apenas SELECT em transações PostgreSQL READ ONLY, com limite de 5 s por consulta.
- Transporte confirmado pelo módulo apps/api/src/platform/database.mjs como TLS com certificado validado.
- Não foi disparada nova coleta à Meta, não foram alteradas credenciais e não foi gravado dado sintético.
- Os números são um snapshot do ambiente configurado no checkout às 17:51 BRT; não devem ser tratados como benchmark histórico ou SLA.

