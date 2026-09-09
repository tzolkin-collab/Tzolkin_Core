# Catálogo consolidado — proposta para adoção oficial

Data: 07/09/2026. Estados referem-se ao workspace; operação externa não verificada. Fonte: db/notion-catalog.json, migrações 009/014/020, docs/DOMAIN-MODEL.md e dados comerciais do Site. Não é inventário exaustivo de repositórios externos.

## Fichas comerciais

A tabela e a ficha técnica de mesmo ID formam a ficha-padrão completa. Onde o modelo é recomendado, não implica oferta já aprovada ou preço praticado.

| ID / o que é | Quem compra / tipo de cliente | Como entra / papel do lead | Como paga (proposta) | O que é entregue / operação | Estado observado |
|---|---|---|---|---|---|
| sites — linha de sites e landing pages | Empresa ou profissional PF | Inbound/indicação → qualificação → proposta | Valor por escopo, à vista ou parcelas após contrato | Site, implantação e eventual manutenção; projeto, não OMS | Catálogo + intake parcial; backend próprio não auditado |
| commerce — linha de comércio eletrônico | Lojista/empresa | Venda consultiva; lead é comprador da implantação | Implantação e eventual manutenção; licença só se confirmada | Loja e integração; pedidos/estoque no produto | service_line no SQL; docs antigas chamam SaaS; decisão comercial necessária |
| barber — produto vertical | Barbearia/gestor | Demonstração ou checkout elegível; lead do SaaS distinto de cliente da barbearia | Assinatura proposta | Software de agenda/operação; agenda no produto | Cadastro; execução externa não verificada |
| skiller — produto cadastrado | Público comprador não definido pelas fontes lidas | Aquisição e onboarding precisam de ficha do dono | Recorrência mencionada em docs históricos; atual não verificada | Funcionalidade específica não estabelecida nesta auditoria | Cadastro confirmado; descrição de negócio insuficiente |
| educare — plataforma educacional | Aluno PF ou empresa patrocinadora | Interesse → oferta/turma → matrícula | À vista, parcelas ou acesso por período conforme oferta | Conteúdo, formação e acompanhamento; matrícula/progresso no produto | Cadastro; execução externa não verificada |
| data — linha de tracking/inteligência | Empresa com aquisição digital | Diagnóstico → proposta; lead compra serviço | Projeto/consultoria/assessoria, conforme contrato | Instrumentação e análise; eventos brutos nas soluções próprias | service_line; catálogo histórico diz planejamento |
| core — plataforma interna | Equipe TZOLKIN; sem comprador externo confirmado | Provisionamento interno, sem lead de venda por padrão | Custo interno; não criar assinatura fictícia | Relacionamento, contratos, direitos e visão consolidada | Módulos locais implementados/parciais |
| institucional — tzolkin-site, canal de aquisição | Visitante interessado nas ofertas TZOLKIN | Formulário/chat/encaminhamento; lead da própria TZOLKIN | Não recebe pagamento no fluxo de lead inspecionado | Conteúdo e captação, com persistência e fila de e-mail | Implementado localmente; ligação Core ausente |
| consultoria — modalidade de serviço | Empresa ou profissional | Diagnóstico/indicação → escopo | Por escopo ou período acordado | Diagnóstico, orientação e entregáveis | Vocabulário consulting no banco; jornada completa ausente |
| assessoria — modalidade de serviço | Empresa ou profissional | Venda consultiva → plano de trabalho | Recorrência contratual proposta | Execução continuada, agenda e apontamento | Vocabulário advisory e tracking presentes; SLA completo não comprovado |
| sob-demanda — modalidade de serviço | Empresa ou profissional | Pedido → orçamento → aceite | Por entrega/escopo | Projeto específico, implantação ou integração | on_demand e engagements presentes; oportunidade/contrato completos ausentes |

Não criar consultoria, assessoria e sob demanda automaticamente como três produtos: são modalidades que podem ocorrer em várias linhas. Core comercializa o que a TZOLKIN vende; consumidor final da barbearia/loja não é cliente comercial TZOLKIN por consequência.

## Fichas técnicas e ciclo de vida

Para todos os itens comerciais, **empresa/PF** é a parte contratante, **stakeholder** é a pessoa de contato com papel contextual, **contrato** registra obrigações e aceite, **entitlement** registra direito técnico quando houver software. Nenhum deles substitui os demais. Para Core/institucional, organização interna e equipe substituem adquirente externo.

| ID | Dados gerados / ficam no produto ou serviço | Consulta ao Core / dados no Core | Nunca enviar ao Core neste desenho | Ciclo / telas necessárias / API necessária | Infraestrutura |
|---|---|---|---|---|---|
| sites | Briefing, arquivos e execução da entrega | Lead próprio, oportunidade, parte contratante, contrato, responsáveis e resumo de entrega | Leads dos sites dos clientes, credenciais e conteúdo privado integral | J1/J6; inbound, detalhe, proposta, entrega; intake + consultas comerciais propostas | Projetos e vínculos Vercel/EasyPanel suportados no Core; destino de cada entrega deve ser confirmado |
| commerce | Catálogo da loja, pedidos, estoque, compradores | Contratação da implantação/licença e direitos quando aplicáveis | Pedidos e PII de consumidores por padrão | J1 ou J2 conforme decisão; comercial no Core, OMS na loja; contexto/eventos mínimos | Domínio histórico ecom.tzolkin.cloud; stack/banco atuais não verificados |
| barber | Agenda, profissionais, clientes finais e atendimentos | Organização assinante, membros e direitos | Histórico de atendimento e PII dos clientes da barbearia | J2; assinatura/acessos Core, agenda produto; /v1/context existente, eventos propostos | Domínio histórico barber.tzolkin.cloud; execução não verificada |
| skiller | A definir pelo dono antes de integrar | Organização/comprador, contrato e direitos conforme modelo confirmado | Base operacional bruta e credenciais | J2 apenas hipótese; ficha funcional, telas e API pendentes | Repositório/deploy não auditados |
| educare | Turmas, matrículas, conteúdo e progresso | Relação comercial direta com comprador, contrato e direito de acesso minimizado | Notas, respostas e progresso detalhado; dados de alunos de clientes terceiros | J3; oferta comercial no Core, matrícula/progresso no produto; contexto + vínculo de matrícula proposto | Snapshot aponta Vercel; subdomínio e execução atuais não verificados |
| data | Eventos, atribuição operacional e fontes de clientes | Contratação, responsáveis, SLA e agregados aprovados | Eventos brutos, identificadores de visitantes, credenciais de plataformas | J1/J6; comercial e acompanhamento; API de resumo proposta | Destino proposto no catálogo antigo, não prova de deploy |
| core | Relacionamento, auditoria, catálogo e direitos | É autoridade dos dados consolidados | Não importar operação completa de outros produtos | J4/J5; navegação por contexto, governança e conciliação; módulos HTTP existentes/parciais | Node, PostgreSQL, web/API separados; Docker e docs EasyPanel presentes, produção não verificada |
| institucional | Submissão original, outboxes, conteúdo | Envia lead próprio; lê recibo/status de ingestão, não cadastro global | Sessões brutas de chat e dados além da finalidade comercial | J0; formulário + confirmação persistida; /api/leads existente, worker Core proposto | Next.js/PostgreSQL; Vercel documentada; chatbot-api é componente separado, não produto vendável comprovado |
| consultoria | Diagnósticos e entregáveis | Contrato, agenda, horas e resumos autorizados | Documentação confidencial completa por padrão | J1/J6; proposta, contrato, entregas; APIs comerciais propostas + tracking existente | Ferramentas e armazenamento por contratação; sem deploy obrigatório |
| assessoria | Atividades recorrentes e entregáveis | Contrato, responsáveis, horas, SLA e cobrança | Bases operacionais integrais do cliente | J1/J6; agenda, capacidade, renovação; tracking existente + contrato proposto | Recursos vinculados à contratação, não convertidos automaticamente em produto |
| sob-demanda | Projeto/implantação | Oportunidade, contrato e milestones resumidos | Segredos, bancos e dados de operação do cliente | J1/J6; orçamento, aprovação, execução, encerramento; APIs propostas | Repositório, ambientes, domínio e rollback por entrega |

## Ofertas públicas que precisam de vínculo explícito

O Site apresenta Landing Pages & Sites de Conversão, E-commerce Global Headless, Tagueamento de Fluxo & CAPI, Pagamentos Globais & API Pix Direta e Sistemas de Mensalidade & SaaS. O validador de leads também inclui Cardápios Virtuais, Solução Personalizada, Ferramentas TZOLKIN e Educacional TZOLKIN.

| Oferta | Vínculo recomendado | Decisão pendente |
|---|---|---|
| Landing pages / sites institucionais | sites + on_demand | Escopo, manutenção e aceite |
| E-commerce global | commerce + on_demand | Existe licença SaaS vendável além da implantação? |
| Tracking / CAPI | data + consulting/on_demand/advisory | Quem mantém mensuração e qual SLA? |
| Cardápios virtuais | Sob demanda; produto específico não comprovado | Implantação única ou licença? |
| Pagamentos globais / API Pix | Serviço de integração | Vendedor/recebedor, provedor e operação; não presumir produto financeiro próprio |
| Mensalidade / SaaS | Serviço ou produto a identificar | Desenvolver software e vender acesso a software são ofertas distintas |
| Ferramentas / solução personalizada / outro | Fila de qualificação sem produto inventado | Classificar antes de proposta |
| Educacional | educare + education | Oferta, turma, comprador e recebedor |

Gate do catálogo: responsável de cada frente confirma comprador, oferta, operação, dados, recebedor, infraestrutura e evidência de disponibilidade. Até lá, status cadastral não autoriza venda automática.
