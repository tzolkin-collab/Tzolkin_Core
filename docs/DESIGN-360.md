# Core 360 — direção de design

Data: 2026-08-31. Requisitos do usuário e proposta para o redesign; não representa funcionalidades já implementadas.

## Primeira aplicação visual — 2026-08-31

Aplicada a camada compartilhada `apps/web/public/design.css`, carregada após os estilos estruturais: textos e labels maiores, contraste reforçado, navegação neutra, ações primárias escuras, cantos moderados, menos sombras e abas de recurso com indicador inferior. O frontend real foi reiniciado e a entrega do CSS confirmada por HTTP 200.

Revisão visual com dados sintéticos: Clientes em desktop e Deploys em desktop/celular de 390 px, sem overflow horizontal da página nesta checagem. 58 testes unitários passaram. Esta é a primeira aplicação, não a conclusão do redesign: fonte autohospedada, substituição dos ícones por Lucide/logos SVGL, ficha 360, feed, notificações e gráficos permanecem pendentes. Nenhum dado demonstrativo foi introduzido no app real.

## Objetivo

EasyPanel agora usa seu SVG oficial local no componente compartilhado de logo, incluindo conexões, cards, destinos vinculados e cabeçalho da página interna de recurso. A marca substitui o fallback genérico de servidor; ícones funcionais dos tipos de serviço continuam distintos.

Atualização de implementação: ícones funcionais agora usam 21 SVGs selecionados de lucide-static; GitHub e Vercel usam logos locais do SVGL. Licenças/fontes em THIRD-PARTY-ICONS.md. Cards de Projetos e serviços derivam contagens de serviços/destinos, stacks e ambientes do cadastro e exibem repositório, responsável pelo projeto, atualização e vínculos/branches expansíveis. Inventário EasyPanel usa linhas de serviço tipadas. O campo `author` da listagem Vercel vem de `creator.username` e é rotulado como Criador do deploy, não autor do commit. Nenhuma inferência de saúde é feita. Validação: 60 testes unitários e revisão visual isolada desktop/mobile (390 px); logos carregados localmente. Dados sintéticos apenas em `preview-delivery.mjs --cards`.

Um workspace minimalista, legível e revisado para operar a Tzolkin e compreender cada cliente. A complexidade fica no modelo de dados e na divulgação progressiva, não em uma tela de cadastro interminável.

## Referências examinadas

- [Vercel / Geist](https://vercel.com/geist/introduction): documentação e apresentação visual do sistema. Referência de hierarquia tipográfica, superfícies neutras, divisórias e consistência.
- [ElevenLabs UI](https://ui.elevenlabs.io/): biblioteca pública e exemplos visuais de componentes. Referência de controles compactos, agrupamento e feedback. Não houve auditoria do painel autenticado completo.
- [Google Antigravity IDE](https://antigravity.google/product/antigravity-ide): página oficial e imagens de editor, agente e revisão de artefatos. Referência de contexto, área de trabalho e detalhes adjacentes. Não copiar brilhos, gradientes ou o layout de IDE literalmente.
- [SVGL](https://svgl.app/): fonte preferencial para logos de serviços e marcas disponíveis, respeitando suas regras de uso. Logos de clientes vêm do cadastro autorizado, com fallback de iniciais.
- [Lucide](https://lucide.dev/guide/): biblioteca escolhida para ícones funcionais SVG. Não misturar famílias; importar apenas os ícones utilizados e preservar licença.

## Problemas observados no código atual

- Rótulos de 9–12 px e cores claras demais para informação operacional.
- Títulos de seção pouco distintos do corpo e muitas descrições pequenas.
- Ícones manuais com geometria inconsistente e símbolos Unicode remanescentes.
- Repetição de cards, badges e avisos, sem hierarquia suficiente entre conteúdo principal e auxiliar.
- Fonte Geist declarada como preferência, mas não distribuída pelo app; aparência depende da máquina.
- Regras CSS acumuladas por seção. O redesign deve consolidar os componentes, não apenas acrescentar overrides indefinidamente.

## Regras visuais

1. Nunca emojis. Ícone representa objeto, ação ou estado; não é enfeite. Ações ambíguas mantêm rótulo textual e botões só com ícone têm nome acessível.
2. Base clara neutra; texto principal escuro. Violeta Tzolkin restrito a seleção, foco e destaques relevantes. Cores semânticas reservadas a estados reais, sempre acompanhadas de texto.
3. Tipografia proposta: corpo 14–16 px, rótulos 13–14 px, metadados 12–13 px, seções 18–20 px, título de página 26–30 px. Não reduzir a fonte para fazer o layout caber. Fonte autohospedada, com fallback estável.
4. Contraste como critério de aceite: texto comum pelo menos 4,5:1; texto grande e indicadores essenciais pelo menos 3:1. Medir combinações reais, inclusive estados desabilitados distinguíveis e foco.
5. Uma borda discreta por componente. Proibido borda + anel separado no input. Foco visível no mesmo perímetro, sem depender somente de hover.
6. Cards só para unidades que se beneficiam de agrupamento. Listas e feeds usam linhas e divisórias; evitar card dentro de card dentro de card.
7. Escala de espaçamento consistente (4, 8, 12, 16, 24, 32). Cantos moderados (6–10 px em controles; 10–12 px em painéis). Sombras pequenas apenas para elevação útil.
8. Uma ação primária por contexto. Operações secundárias ficam próximas do conteúdo ou em menu contextual; ações destrutivas separadas e confirmadas.
9. Modais para decisões curtas. Fichas e formulários extensos têm página própria; painel lateral para consulta/edição pontual sem perder a lista de origem.
10. Dados reais: desconhecido, indisponível, vazio e zero são estados diferentes. Nenhum gráfico, contador ou notificação decorativo.

## Componentes de informação

| Componente | Função | Regra |
| --- | --- | --- |
| Indicador | Responder uma pergunta operacional | Valor, unidade, período e comparação apenas quando válidos |
| Gráfico | Mostrar evolução ou distribuição | Poucas séries, legenda e resumo acessível; dados tabulares disponíveis; sem 3D |
| Card de cliente/projeto | Identificar e resumir uma entidade | Nome, estado, responsável e próxima ação; não repetir toda a ficha |
| Feed | Mostrar o que aconteceu | Ator, evento, objeto, data e origem; agrupar repetições |
| Notificação | Informar o que exige atenção | Relevância, destino acionável e leitura; não duplicar todo evento do feed |
| Tabela | Comparar muitos registros | Colunas prioritárias, filtros claros, rolagem local e ações consistentes |
| Estado vazio | Explicar ausência de conteúdo | Explicação curta e ação útil, sem gráficos falsos |

## Página de cliente 360 proposta

- Cabeçalho: nome, identificação pessoa/empresa, estado, responsável interno e ação principal contextual.
- Resumo: poucos indicadores relevantes, pendências e próxima ação. Não preencher com métricas sem fonte.
- Navegação: Visão geral, Pessoas e empresas, Contratações, Financeiro, Entregas, Documentos e Atividade. Subdivisões por contexto quando necessárias, não uma única faixa com dezenas de abas.
- Visão geral: situação do relacionamento, evolução relevante, contratações ativas e feed recente. Detalhes ficam nas áreas correspondentes.
- Stakeholders: pessoa, empresa vinculada, papel, contato principal e canais. Avatar/monograma é apoio; o nome permanece visível.
- Origem: canal, campanha e histórico de atribuição legíveis; UTMs técnicas ficam no detalhe, não como uma parede de tags.
- Cadastro inicial curto, com complementação progressiva e indicação de requisitos para contratar, faturar ou ativar serviços.

## Revisão obrigatória

- Revisão visual de lista de clientes e ficha 360 antes de replicar o padrão aos módulos.
- Desktop, tablet e celular: 320, 390, 768, 1024 e 1440 px, além de zoom de 200%.
- Dados longos, muitos registros, ausência de logo, nomes repetidos, estados vazios, loading, erro e falta de permissão.
- Teclado, ordem de foco, labels, contraste, movimento reduzido e alvos de toque.
- Comparação de capturas de tela, não apenas testes unitários ou medidas de overflow.
- Gráficos, notificações, feed persistente e ficha 360 ainda exigem implementação de dados e comportamento. Não apresentar protótipos como módulos conectados.

## Sequência

1. Consolidar tokens, fonte, biblioteca de ícones e componentes-base.
2. Validar uma fatia vertical: lista de clientes e ficha 360 com origem dos dados explícita.
3. Aplicar o padrão a produtos, projetos e infraestrutura.
4. Expandir feed, notificações e gráficos conforme seus módulos de domínio forem implementados.

Esta direção substitui a ideia de preservar todas as decisões visuais anteriores. Preserva identidade e funcionalidades, mas permite rever hierarquia, navegação, densidade e componentes.
