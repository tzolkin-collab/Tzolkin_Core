# Auditoria de UX — Etapa 0

Data: 2026-09-02

## Diagnóstico objetivo

- A aplicação contém 21 seções de tela, mas nem todas representam um fluxo utilizável.
- `style.css` e `design.css` têm regras sobrepostas para sidebar, navegação, contexto, topo e busca. A ordem de carregamento passa a decidir o resultado visual.
- Mentorias, Configurações, Segurança e Métricas de servidor são telas de espera, não funcionalidades.
- Métricas reaproveitava o conteúdo de Visão geral, logo não oferecia uma leitura própria.
- A navegação apresentava módulos antes de eles terem dados, ação principal ou estado de vazio específico.

## Decisão aplicada

Os seguintes itens deixam de aparecer na sidebar até terem modelo de dados, ação principal e conteúdo próprio:

- Métricas operacionais;
- Mentorias;
- Configurações;
- Segurança;
- Métricas de servidor.

## Navegação que fica exposta agora

| Grupo | Itens |
|---|---|
| Visualização | Visão geral, Acompanhamento, Financeiro |
| Relacionamentos | Empresas, Pessoas |
| Operação | Leads, Clientes, Serviços, Produtos |
| Gestão | Acessos |
| Tecnologia | Deploys |

## Critério para reintroduzir um item

Cada item precisa ter, antes de entrar na sidebar:

1. entidade e fonte de dados definidas;
2. objetivo de trabalho claro;
3. ação principal possível;
4. estado vazio honesto e útil;
5. permissão, responsividade e teste definidos.

## Próximo corte técnico

Consolidar a camada visual em um único arquivo de regras de interface. `style.css` deve ficar com fundações compartilhadas; `design.css` deve deixar de reimplementar os mesmos seletores.
