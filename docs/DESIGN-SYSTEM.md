# Design system

Tokens, componentes, navegação e estados. Interface interna de trabalho — **não é landing page**.

Direção mais recente do usuário: minimalismo com alta legibilidade, referências Vercel/ElevenLabs/Antigravity, logos SVGL e ícones funcionais Lucide, nunca emojis. Ver [DESIGN-360.md](DESIGN-360.md), que distingue proposta de redesign da implementação atual e prevalece sobre orientações anteriores de preservar integralmente a apresentação.

Revisão: **2026-08-30**.

---

## 1. Princípios `[DECIDIDO]`

Atualização aprovada em 2026-08-31: manter identidade, cores e tipografia existentes; modernizar inputs e simplificar a configuração com divulgação progressiva. **Nunca usar emojis como ícones.** Catálogo e navegação usam SVG de traço com `aria-hidden`, acompanhado de rótulo textual. Fluxo do catálogo: repositório primeiro, cards por serviço e revisão antes de salvar; detalhes técnicos recolhidos. Ver [DELIVERY-CATALOG.md](DELIVERY-CATALOG.md).

1. **Ferramenta, não peça de marketing.** Sem herói, sem prova social, sem persuasão.
2. **Nenhuma métrica fictícia.** Todo número sai do banco. Não havendo dado, a tela diz que não há.
3. **Nenhum gráfico sem decisão associada.** Gráfico que não muda uma escolha não entra.
4. **Nenhum menu vazio.** Módulo não implementado não aparece na navegação.
5. **Contexto inequívoco.** A qualquer momento dá para responder *de qual produto e de qual organização são estes dados?*
6. **Trocar de contexto invalida o que está na tela** e revalida no servidor.
7. **Login objetivo.** Sem explicação sobre `.env`, bootstrap ou arquitetura.
8. **Proibido contorno duplo em inputs.** Hover altera apenas a cor da borda; foco usa um único contorno sobre a borda existente, sem anel externo ou sombra de foco. O indicador de teclado deve continuar visível. Aplica-se também ao login administrativo.
9. **Responsividade sem esconder conteúdo.** Até 900 px a navegação vira uma faixa horizontal rolável, com contexto e logout acessíveis. Cards refluem, textos longos quebram, tabelas rolam dentro do próprio contêiner e modais respeitam a altura dinâmica da tela. Não usar `overflow-x:hidden` na página para mascarar falhas. No celular, campos usam 16 px e ações principais têm alvo de pelo menos 44 px.

Validação de responsividade em 2026-08-31: seis seções gerais no preview isolado em 320, 390, 768, 1024 e 1440 px, sem overflow horizontal da página; formulário de recursos EasyPanel e modal de cliente conferidos em 390 px. Dados sintéticos: não substitui validação com todos os conteúdos reais ou teclado virtual de um dispositivo físico.

---

## 2. Tokens `[EXISTENTE E VERIFICADO]`

Em `public/style.css`, alinhados com o institucional (`tzolkin-site/src/app/globals.css`).

| Token | Valor | Origem |
|---|---|---|
| `--brand` | `#4a21bb` | **Idêntico** ao institucional (modo claro) |
| `--brand-ink` | `#5660f1` | Institucional — violeta para texto/link sobre fundo claro |
| `--radius` | `10px` | Equivale ao `0.625rem` do institucional |
| `--bg` / `--surface` | `#fafafa` / `#fff` | Superfícies neutras |
| `--text` / `--muted` | `#171717` / `#737373` | |
| `--line` | `#e9e9eb` | Divisórias |
| `--brand-soft` | `#f1edfa` | Fundo de estado ativo e aviso |

Escala tipográfica: base 14px; H1 30px (−1.1px de espaçamento), H2 15px, corpo 13px, auxiliar 11–12px. Numerais em `tabular-nums` para os números não dançarem entre atualizações.

### Tipografia — pendência conhecida

O institucional usa **Geist** (`next/font/google`). O Core declara `Geist, "Geist Sans", Inter, "Segoe UI", Arial, sans-serif`: se a fonte estiver instalada na máquina, ela é usada; senão cai na pilha do sistema.

**Por quê:** a CSP do Core é `default-src 'self'` e o bootstrap não fala com host externo. Fechar essa lacuna exige **autohospedar** o arquivo da fonte e servi-lo de `public/`. `[PENDENTE DE DECISÃO]` — pesa peso de asset contra fidelidade de marca.

Institucional também usa Archivo e Montserrat; nenhuma delas foi trazida para o Core, que é ferramenta interna.

---

## 3. Marca `[EXISTENTE E VERIFICADO]`

`public/logo.svg` é **o SVG original aprovado**, idêntico em geometria a `tzolkin-site/public/logotzolkin.svg`: quadrado arredondado `#0A0A0A`, um círculo apenas contornado e outro preenchido em `#FAFAF7` — as duas esferas.

Conferido byte a byte contra o institucional em 2026-08-30. **Não redesenhar, não recolorir, não recriar.** O favicon animado do institucional não foi trazido: ferramenta interna não precisa de animação de marca.

Lockup do painel: marca + `TZOLKIN` com o rótulo `CORE` abaixo, em maiúsculas espaçadas.

---

## 4. Navegação e contexto `[EXISTENTE E VERIFICADO]`

### Seletor de contexto

Na barra lateral, acima da navegação: `<select>` nativo com `TZOLKIN · Gestão geral` e, sob um `optgroup`, cada produto. Nativo por decisão — teclado, leitor de tela e mobile funcionam sem código próprio.

No contexto de produto o seletor muda para as cores da marca, e é o elemento mais visível da barra.

### A troca de contexto, em ordem

1. Fecha qualquer formulário aberto — ele carrega o contexto anterior pré-selecionado.
2. **Esvazia tabelas, métricas, painéis e avisos.** Nenhum número do contexto anterior sobrevive na tela.
3. Redesenha navegação e cabeçalho.
4. **Só então** consulta o servidor, que revalida a sessão e devolve o recorte.

### Navegação por contexto

| Contexto | Itens |
|---|---|
| Gestão geral | Ecossistema · Clientes · Produtos e planos · Pessoas e acessos |
| Produto | Visão geral · Organizações |

Comercial, pagamentos, relatórios e configurações **não aparecem** — não existem. Princípio 4.

### Indicação de contexto

- Trilha: `TZOLKIN` ou `TZOLKIN · <Produto>`, seguida da tela atual.
- Sobretítulo: `TZOLKIN CORE` ou `PRODUTO · <NOME>`.
- `data-context` no `<body>` governa as variações visuais.

---

## 5. Componentes `[EXISTENTE E VERIFICADO]`

| Componente | Uso |
|---|---|
| Barra lateral | Marca, seletor de contexto, navegação, identificação do espaço, sair |
| Barra superior | Trilha de contexto + atualizar |
| Faixa de métricas | 3–4 números, colunas automáticas; auxiliar opcional para qualificar o número |
| Tabela | Listas com ação por linha. Rola dentro do próprio contêiner — **o corpo da página nunca rola na horizontal** |
| Painel de contexto | Ficha do produto: identificador, descrição, status cadastral, ressalva e links |
| Painel de lista | Registros com título + detalhe e ação de editar |
| Diálogo | `<dialog>` nativo: foco preso, `Esc` fecha, fundo esmaecido |
| Cartão de estado vazio | Símbolo, o que houve, por que, e uma ação real |

Botões: `primary` (ação principal), `secondary` (alternativa), `quiet`/`table-action` (ação de linha). Alvo mínimo de toque 40–44px.

---

## 6. Estados

Toda tela cobre os quatro. Nenhum inventa dado.

| Estado | Como aparece |
|---|---|
| **Carregando** | Botão desabilitado com cursor de espera. Sem esqueleto falso |
| **Vazio** | Diz o que não há e por quê, e oferece a ação que resolve. Ex.: *"Nenhuma organização contratou TZOLKIN Barber. O Core não infere vínculos: uma organização só aparece aqui depois que um contrato deste produto é registrado."* |
| **Erro** | Mensagem do servidor, em português, no formulário ou no aviso da página. `role="alert"` |
| **Sucesso** | Aviso discreto (`role="status"`, `aria-live="polite"`) e a lista já atualizada |

**Sessão expirada:** qualquer `401` limpa o estado, fecha diálogos e volta ao login. Não há tentativa de renovar por conta própria.

**Honestidade nos números.** "Contratos ativos" conta contrato ativo **de organização ativa** — o mesmo critério de `/v1/context`. Contrato ativo de organização suspensa aparece como *Organização suspensa*, sem cor de sucesso, e não entra na conta. "Pessoas alcançadas" traz o auxiliar *com vínculo neste produto*, porque a contagem é do produto em contexto e não da organização inteira.

---

## 7. Acessibilidade `[EXISTENTE E VERIFICADO]`

- Anel de foco visível de 3px em todo elemento interativo — conferido navegando por teclado.
- Navegação e ações são `<button>`; troca de contexto é `<select>`. Nada de `div` clicável.
- `aria-current="page"` no item ativo; `aria-label` nas ações de linha (*"Suspender Cliente X"*), porque só o rótulo seria ambíguo.
- `role="status"` / `role="alert"` nos avisos; `.sr-only` para cabeçalhos de coluna sem texto visível.
- Diálogo nativo entrega foco preso e `Esc`.
- Ícones decorativos com `aria-hidden`.

**Não verificado:** contraste medido, leitor de tela real, `prefers-reduced-motion`. Não afirmar conformidade WCAG sem auditoria.

---

## 8. Responsividade `[EXISTENTE E VERIFICADO]`

Conferido em 1440×900 e 375×812 em 2026-08-30.

| Faixa | Comportamento |
|---|---|
| ≥ 851px | Barra lateral fixa de 232px; métricas em colunas |
| 601–850px | Barra lateral de 190px; grades reduzidas |
| ≤ 600px | Barra lateral vira cabeçalho; navegação em duas colunas; métricas em 2×N; seletor de contexto em destaque |

Tabelas largas rolam dentro do contêiner. Escuro não é suportado: `color-scheme: light` é declarado, para não haver inversão parcial pelo navegador.
