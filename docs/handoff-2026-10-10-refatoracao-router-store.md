# Handoff: Refatoração de Estado e Roteamento (Fase 1 e Início da Fase 2)

**Data:** 10 de Outubro de 2026
**Objetivo:** Desacoplar a gestão de estado e o roteamento de dentro do monolítico `app.js`, resolvendo bugs de assincronia e organizando a casa para futuras implementações, mantendo a arquitetura puramente em Vanilla JS.

---

## 1. O que foi construído até o momento

### 1.1 Estado Reativo (`store.js`)
- Criamos o arquivo estático genérico `store.js` implementando o padrão **PubSub / Observer** (`subscribe`, `set`, `get`).
- Para garantir **compatibilidade total imediata** (backward compatibility) com os milhares de locais no código que manipulavam diretamente o objeto `state` (ex: `state.overview = data`), nós exportamos um `Proxy`.
- O `stateProxy` intercepta todas as atribuições em `app.js` e dispara eventos transparentes no motor do `store`, preparando o terreno para que os módulos passem a se inscrever ativamente sem quebrar a tela atual.
- Registrado e exposto o arquivo no `assets.mjs`.

### 1.2 Separação de Rotas (`router.js`)
- Iniciamos a "Fase 2" extraindo do `app.js` as gigantescas constantes `CONTEXTS` e `SECTIONS` para um arquivo dedicado (`router.js`).
- O `app.js` agora importa essas listas diretamente.

### 1.3 Adaptação de Testes de Código Estático (AST)
- A suíte do projeto contém testes como `web-nav.test.mjs` e `web-contract.test.mjs` que agem como um *Linter* customizado, varrendo o código com expressões regulares e buscando por `CONTEXTS` e `SECTIONS`.
- Atualizamos essas suites para apontarem para o `router.js` nas asserções de navegação, enquanto continuam lendo o `app.js` para as asserções de botões (como a validação do `renderNav`).
- **Resultado:** O sistema passou ileso em todos os 730 testes unitários e todos os testes de UI de ponta-a-ponta (integração visual).

---

## 2. Próximos Passos (Onde Paramos)

A infraestrutura básica para reatividade foi inserida com sucesso. Para "seguir", estes são os próximos movimentos técnicos recomendados:

1. **Extrair a Lógica de Visão (`renderNav` e `switchView`):**
   - Retirar essas funções do `app.js` e levá-las para o `router.js`.
   - Como fazer: Em vez do `router.js` manipular a tela diretamente chamando `renderCompanies()`, o roteador apenas fará `store.set('view', novaTela)`.
   - O `app.js` (como orquestrador) se inscreverá nisso: `store.subscribe('view', (view) => { if (view === 'companies') renderCompanies(); })`.
   - Isso aniquilará a dependência circular e limpará centenas de linhas.

2. **Inversão dos Módulos Filhos:**
   - Atualizar `connections.js`, `tracking.js` e `finance.js` para usarem `store.subscribe('overview', render)`.
   - Isso removerá todos os bugs visuais de concorrência que ocorriam quando uma promise da API resolvia tarde demais.

3. **Fase 3: Sanitização Anti-XSS (DOM Builder):**
   - Mapear os resíduos de `innerHTML` nas Views e substituí-los pelo uso construtivo de DOM seguro.
