# Matriz de responsabilidades — proposta

Data: 07/09/2026. Substitui a ambiguidade de “centralizar tudo”; não altera automaticamente os ADRs anteriores.

| Objeto | Core | Produto | Serviço entregue | Infraestrutura |
|---|---|---|---|---|
| Identidade | Referência externa, contas internas, vínculos/grants | Autentica usuário final; aplica autorização no servidor | Pessoas responsáveis, sem criar identidade duplicada | IdP, segredos e disponibilidade |
| Organização/PF/grupo | Autoridade comercial; grupo precisa de modelo próprio | Tenant operacional derivado de vínculo confiável | Contratante da entrega | Separação lógica/física documentada |
| Stakeholder | Contato e papéis comerciais contextuais | Usuário operacional independente | Responsável/aceitante/financeiro | Não confundir dono do recurso com dono comercial |
| Produto/oferta | Catálogo, aquisição permitida, versão e preço | Regras específicas e limites consumidos | Escopo e entregáveis negociados | Repositório/deploy não cria oferta por si |
| Lead próprio TZOLKIN | Autoridade proposta após ingestão | Site captura e mantém buffer durável | Qualificação pode originar demanda | Outbox, monitoramento e retenção |
| Lead/consumidor do cliente | Sem cópia integral | Autoridade | Acesso mínimo para executar trabalho autorizado | Segregação e auditoria de acesso |
| Oportunidade/proposta | Dono; novos agregados propostos | Pode iniciar por referência | Estima e negocia escopo | Não decide estágio comercial |
| Contrato/aditivo/aceite | Autoridade e metadados/versões | Consome direitos resultantes | Define obrigações e aprovação | Armazena anexos com controle de acesso |
| Direitos | Autoridade, versão e revogação | Enforce no servidor e cache com validade acordada | Não decorrem só de existir projeto | Disponibilidade e entrega de eventos |
| Pagamento TZOLKIN | Ofertas e conciliação; provedor executa | Consome confirmação vinculada | Cobrança por marcos ou período | Segredos/webhooks/retries |
| Pagamento consumidor→cliente | Só agregado aprovado se necessário | Operação e conciliação do produto | Fora do contrato TZOLKIN salvo escopo | Conta conectada conforme decisão comercial |
| Comissão/repasse | Regra e fechamento quando definidos | Referências autorizadas | Condições contratuais | Não inferir divisão de valores |
| Pedido/estoque/agenda/matrícula | Resumo explícito, não motor universal | Autoridade operacional | Serviços internos podem usar tracking do Core | Hospeda; não se torna dono do negócio |
| Projeto/milestone/tarefa/SLA | Referência e visão consolidada | Operação própria quando for caso do produto | Dono da execução e aceite | Ambiente, publicação e rollback |
| Financeiro interno | Consolidação e previsão | Envia valores reconciliados e minimizados | Horas/custos com classificação | Custo de recurso, sem rateio fictício |
| Origem/atribuição | Histórico comercial próprio | Origem operacional do cliente permanece local | Indicação como evento | Correlação sem PII em logs |
| Retenção/exportação/exclusão | Política e orquestração de seus dados | Executa política dos próprios dados | Classifica documentação | Backup, restauração, expiração e prova técnica |

## Contratos de integração

**Existente:** GET /v1/context consulta direito por organização, pessoa e produto da credencial. POST /v1/commercial/intake está registrado, mas é parcial e tem os bloqueios G1–G4 do relatório. Não chamar esse endpoint de integração pronta.

**Proposto:** consulta/listagem de leads com paginação, detalhe, atualização de dono/estágio e atividades; eventos com event_id, versão, emissor, aggregate_id, occurred_at e versão monotônica quando aplicável. Eventos antigos não reativam direitos. Retries mantêm identidade; backoff/dead-letter têm dono e mecanismo de reprocessamento. OpenAPI deve registrar autenticação, erros, limites, exemplos e compatibilidade.

O Site confirma recebimento após persistência local e informa processamento pendente quando aplicável. Worker entrega ao Core; resposta associa IDs de origem/destino. Uma migração histórica preserva a origem; não transforma source_ref em chave de execução nova a cada tentativa.

## Governança proposta

| Ação | Quem pode (papel, não nome) | Evidência exigida |
|---|---|---|
| Criar/classificar produto | Gestor de portfólio | Ficha, dono e estado draft |
| Ativar venda/alterar preço | Responsável comercial autorizado | Oferta versionada; condições antigas preservadas |
| Ativar contrato/aditivo | Gestor contratual | Escopo, partes, vigência e aceite |
| Conceder/revogar direito | Operador com grant de acesso | Base contratual/exceção auditada |
| Emitir/rotacionar chave | Administrador de integrações | Escopo, expiração, ator; segredo não logado |
| Publicar/rollback | Operador de infraestrutura autorizado | Ambiente, revisão, backup e resultado auditado |
| Exportar/apagar dados | Responsável de dados autorizado | Escopo/finalidade, dependências e trilha |
| Conciliar/registrar repasse | Financeiro autorizado | Provedor, referência, moeda e reconciliação |

Não considerar esses papéis implementados: hoje há guardas específicas para owner em contas/times, autenticação geral e proteções por módulo. É necessário unificar autorização no servidor e testar negação em rotas diretas, jobs e exportações.

## Infraestrutura e evolução

Inventário deve registrar por recurso: dono, produto/contratação, ambiente, provedor, região, custo, dependências, domínio, banco, fila, backup, retenção e último restore. Vercel/EasyPanel são executores, não categorias de produto. Redis/chat e e-mail têm políticas próprias. Saúde do processo, saúde do banco e sucesso de ingestão são métricas diferentes.

Rollout proposto: feature flag de ingestão, contrato compatível com versão anterior, canário, reconciliação e reversão da flag sem perder outbox. Descontinuação exige consumidores inventariados, aviso/janela, métrica de uso e data de retirada. Migração de schema e migração de dados comerciais são entregas separadas.
