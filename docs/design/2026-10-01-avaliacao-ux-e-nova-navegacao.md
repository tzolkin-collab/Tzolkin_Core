# Core — avaliação de UX e proposta de navegação (2026-10-01)

Notas de uma varredura das 18 telas do contexto Geral, feita no navegador, logado, contra o banco
real. Largura do painel: ~725 px (celular). **Não cobre:** largura de desktop, ficha de pessoa,
detalhe de lead (não há lead), contexto de produto (Estrutura, Dados, Relações, Vínculos,
Automações, Templates, Atividade).

Status das afirmações: o que está aqui como "observado" vem da tela ou do código lido. O que está
marcado 🟡 HIPÓTESE não foi verificado.

---

## 1. Diagnóstico em uma frase

O Core tem **18 itens de menu para ~5 trabalhos reais**. Quatro telas (Empresas, Pessoas, Clientes,
Serviços) são vistas do mesmo registro, e sete (Conexões, Vercel, GitHub, EasyPanel, DNS, Banco de
dados, Redis) são inventários técnicos. Cada tela sozinha é razoável; o conjunto faz o operador
procurar onde está o que ele quer.

## 2. O que o operador realmente faz

| Trabalho | Pergunta que a tela responde |
|---|---|
| Hoje | O que pede minha atenção agora? |
| Clientes | Quem são, o que contrataram, quem é a pessoa de contato? |
| Receber | Quanto entrou, o que vence, o que está atrasado? |
| Leads | Quem chegou e o que faço com cada um? |
| Catálogo | O que a Tzolkin vende e opera? |
| Infraestrutura | Está no ar? O que está sem dono? |

## 3. Valor de cada item de menu (observado)

Legenda: **Manter**, **Fundir**, **Esconder** (até funcionar), **Rebaixar** (sai do menu principal).

| Item | O que há hoje | Veredito |
|---|---|---|
| Visão geral | KPIs e "o que merece atenção" (2 projetos com falha) | **Manter** e virar a página "Hoje" |
| Financeiro | Saldo de 3 contas/cartões, filtros de período | **Manter** |
| Clientes | 5 clientes, status, contratação, pessoas | **Manter** — vira a casa de tudo que é relacionamento |
| Empresas | 3 das mesmas 5 organizações; **abre a mesma ficha de Clientes**, rotulada "CLIENTE" | **Fundir** em Clientes (filtro "Empresas") |
| Pessoas | 7 pessoas, sem e-mail nem telefone na lista | **Fundir** em Clientes (aba ou busca global) |
| Serviços | 4 contratações; mesmos clientes, mesmo status | **Fundir** em Clientes (aba "Contratações") |
| Inbound | Sem leads; entrega do site e Meta não configurados | **Manter**, com um único caminho de configuração |
| E-mails | "Envio e recebimento ainda não integrados… rascunhos, não automações" | **Esconder** até enviar de verdade |
| Portfólio | 6 itens; gestão com 9 seções "Ainda não identificado" | **Manter** como catálogo, enxuto |
| Acompanhamento | Calendário vazio; a ficha do cliente diz que "ainda não liga atividade a contratação" | **Esconder** até ligar a contrato |
| Conexões | Reconciliação do que está ligado a cada cliente/item, com sugestões | **Manter** dentro de Infraestrutura (é o valor real) |
| Vercel / GitHub / EasyPanel | Inventário bruto por provedor | **Fundir** em abas de Infraestrutura |
| DNS | Zona da Hostinger, 16 registros, leitura | **Fundir** em Infraestrutura |
| Banco de dados | Database Navigator com 18 bancos | **Rebaixar** para "Avançado" |
| Redis e caches | Inventário; chaves, memória e operações "Não exposto" | **Esconder** (sem dado) |
| Acessos | "Nenhuma pessoa vinculada a um cliente" | **Tirar do Geral**; só no contexto de produto |

Resultado: **18 → 6 itens** — Hoje, Clientes, Leads, Financeiro, Portfólio, Infraestrutura —
mais "Avançado" recolhido (Banco de dados).

## 4. Notas por tela (0–10)

Critérios: Organização (a informação está onde se espera), Design (hierarquia, ruído, densidade),
UX (dá para cumprir a tarefa).

| Tela | Org. | Design | UX | Geral | Principal problema |
|---|---|---|---|---|---|
| Clientes | 7 | 7 | 6 | 6,7 | "Ativos" no subtítulo, mas a lista mistura Descontinuado e Concluído |
| Empresas | 4 | 6 | 4 | 4,7 | Sem ficha própria; abre a de Clientes |
| Pessoas | 6 | 6 | 5 | 5,7 | Sem contato; "Aluno · Aluno" |
| Inbound | 6 | 7 | 5 | 6,0 | Vazio sem ação; Campanhas depende de token da Meta |
| Portfólio | 4 | 5 | 5 | 4,7 | KPIs duplicam outras telas; gestão com 9 vazios |
| Serviços | 4 | 6 | 5 | 5,0 | Redundante com Clientes |
| Acompanhamento | 3 | 5 | 3 | 3,7 | Formulário bom, mas desligado de contrato |

## 5. Problemas específicos

**Pleonasmos e ruído (observado)**
- Empresas: todo cartão diz "Empresa" e "Cliente".
- Clientes: "Oferta / marca" repete "Contratação" ("Assessoria / Assessoria").
- Pessoas: "Aluno · Aluno", "Operacional · Contato operacional".
- Serviços: "Contratações de serviço 4", "Nesta lista 4", "Todos os tipos · 4".
- Portfólio: cartão "Clientes 5" duplica a tela Clientes; "0 contratos de acesso ativos" repetido
  em cada espaço; 9 "Ainda não identificado." seguidos na gestão.
- Acompanhamento: "0 atividades" três vezes; "Outubro **De** 2026".
- Botões "Abrir cliente →" / "Abrir organização →" repetidos em toda lista; o cartão inteiro
  deveria ser o alvo.

**Vocabulário**
Organização / empresa / cliente; stakeholders / pessoas; contrato de acesso / vínculo de acesso /
contratação; "deploy READY observado no provedor", "Sales" — inglês e jargão na tela do operador.
O Core precisa de um glossário de uma linha por conceito (ver §7).

**Estados vazios sem saída**
Inbound ("ainda não configurada"), Acessos, Redis e Acompanhamento descrevem a ausência sem dizer
o próximo passo. Regra proposta: tela sem dado mostra **uma** ação ou não aparece.

**Instruções de servidor na interface**
Inbound → Campanhas mostra "defina META_APP_ID… `npm run marketing:connect`". Isso é instrução de
quem opera o servidor, não de quem opera a empresa.

## 6. Defeitos encontrados (não só de design)

1. **Falso alarme "Não encontrado no provedor" — CORRIGIDO nesta sessão.**
   `product-topology.mjs` tratava o provedor que não respondeu como inventário vazio, e toda
   conexão confirmada virava `missing`. Com o GitHub indisponível, o aviso "1 conexão confirmada
   não foi encontrada… Revise antes do próximo deploy" aparecia sem o repositório ter sumido.
   Agora o estado é `unverified` ("Provedor sem resposta agora") e não entra na contagem do aviso.
   Teste novo em `test/unit/product-topology.test.mjs`.
2. **Favicon buscado 9× por repintura (36 requisições, 4 URLs) — CORRIGIDO.** Resultado agora fica
   em cache por URL em `icons.js` (36 → 4).
3. **Datas e campos do `/api/bootstrap` — CORRIGIDO.** `*_at` normalizados para o ISO do driver
   `pg`; catálogo sem o campo extra `id`.
4. 🟡 HIPÓTESE: o GitHub "não respondeu" nesta sessão local pode ser credencial ausente ou
   expirada no ambiente de desenvolvimento. Não verificado; vale conferir antes de concluir que o
   provedor está fora em produção.
5. A ficha de cliente admite: "o Acompanhamento ainda não liga atividade a contratação". Enquanto
   isso for verdade, as horas lançadas não pertencem a nenhum contrato.

## 7. Princípios para o redesenho

1. **Um substantivo por conceito.** Cliente (a relação comercial), Pessoa, Contratação (o que o
   cliente comprou), Item do portfólio (o que a Tzolkin vende). Abolir "organização", "stakeholder",
   "vínculo de acesso" da tela do operador.
2. **Uma tela, uma pergunta.** Se duas telas respondem à mesma pergunta, vira uma.
3. **Sem dado, sem ruído.** Vazio mostra no máximo uma frase e uma ação. Contador zerado que
   repete outra tela sai.
4. **Nada de engenharia no caminho do operador.** "Deploy READY observado" vira "No ar". Diagnóstico
   técnico fica em Infraestrutura.
5. **O cartão é o botão.** Sem "Abrir X →" repetido.
6. **Recurso que não funciona não aparece no menu.** Volta quando entregar valor (E-mails,
   Acompanhamento).
7. **Distinguir "não sei" de "não existe".** Provedor sem resposta nunca vira alarme (ver §6.1).

## 8. Proposta de navegação

```
Hoje            o que pede você agora (falhas, a classificar, parcelas, leads novos)
Clientes        lista agrupada por situação · filtros: Todos / Empresas / Pessoas físicas / Serviço
                ficha com abas: Contratações · Pessoas · Conexões · Financeiro
Leads           fila + campanhas, uma configuração só
Financeiro      contas, cobranças, vencimentos
Portfólio       o que a Tzolkin vende e opera (6 itens), gestão por item
Infraestrutura  Saúde · Vercel · GitHub · EasyPanel · DNS · Conexões
Avançado ▾      Banco de dados
```

Contexto de produto (sem alteração nesta etapa): Estrutura, Dados, Relações, Vínculos, Acessos,
Automações, Templates, Atividade. Mesma lógica deveria ser aplicada depois.

### Telas-chave

**Hoje** — lista de ações ordenada por urgência, não cartões de KPI. Cada linha: o que, de quem,
um botão. Exemplos reais de hoje: "2 projetos com falha", "1 cliente a classificar".

**Clientes** — grupos Ativos / Em implantação / Encerrados (recolhido). Cada cartão: nome, tipo
em uma palavra, status, **o que contratou** (um campo só), pessoa principal com contato. Sem
"Stakeholders 0". Cartão inteiro clicável.

**Ficha do cliente** — abas Contratações · Pessoas · Conexões · Financeiro. Absorve Empresas,
Pessoas e Serviços. Horas só voltam quando Acompanhamento estiver ligado a contrato.

**Portfólio** — remove os três KPIs do topo. O parágrafo de introdução vira uma frase. Cada
cartão: nome, tipo, estado ("No ar" / "Opera por contrato"), um botão. Editar e Cobrança passam
para dentro da gestão. Seções vazias da gestão recolhidas em "Ainda sem: Backend, Domínios, …".

**Infraestrutura** — abre em Saúde (falhas de deploy, conexões sem dono, domínios), com provedores
em abas. Banco de dados fica em "Avançado".

## 9. Plano de implementação

| Fase | Entrega | Risco | Esforço |
|---|---|---|---|
| 1 | Pleonasmos, "De", vocabulário, cartão clicável, vazios colapsados | Baixo | 1 dia |
| 2 | Esconder do menu: Acompanhamento, E-mails, Redis, Acessos (no Geral) | Baixo; código permanece | 0,5 dia |
| 3 | Fundir Empresas / Pessoas / Serviços em Clientes (ficha com abas) | Médio; toca `view-client` e navegação | 3–4 dias |
| 4 | Infraestrutura unificada (Saúde + abas) | Médio | 3–4 dias |
| 5 | Página "Hoje" como lista de ações | Médio; exige regras de prioridade | 2–3 dias |

Cada fase é publicável sozinha. A guarda `test/unit/redundant-titles.test.mjs` deve ser estendida
para cobrir cartões repetidos e vazios consecutivos.

## 10. Decisões que são do dono do produto

1. Fundir Empresas, Pessoas e Serviços em Clientes? (recomendado: sim)
2. Esconder E-mails e Acompanhamento do menu até funcionarem? (recomendado: sim)
3. Existe uso real de Redis e caches ou do Database Navigator no dia a dia? Se não, saem do menu.
4. A página "Hoje" substitui a Visão geral atual?

## 11. Referências desta sessão

- Carregamento: `/api/bootstrap` + hidratação progressiva; tela utilizável em ~0,45 s (carga
  quente) a ~1,7 s (conexão fria ao Postgres remoto), contra 3,89 s antes. Ver
  `docs/benchmarks/2026-10-01-core-loading.md`.
- ADR 0010 (Go + MySQL somente após gates): `docs/decisions/0010-go-mysql-somente-apos-gates.md`.
