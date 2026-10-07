# Acompanhamento — redesenho da tela de atividade

Pedido do dono em **2026-10-06** sobre o diálogo de atividade (`apps/web/public/agenda-evento.js`). O pedido inteiro foi quebrado em
itens; **só o item 1 foi feito**. Esta página existe para os outros não se perderem, e diz, item a item, **o que falta para cada um
existir** — não o que seria bonito ter.

Quem for pegar um item daqui: leia antes [STATUS.md](STATUS.md) e [AGENDA.md](AGENDA.md). A seção "O tipo é uma aba" do AGENDA.md
descreve o que já está no ar.

## Feito

### 1. O tipo virou aba, e cada aba mostra o que faz sentido ✅ (2026-10-06)

Call · Task · Registro no topo do diálogo; trocar de aba troca os campos e não perde o que já foi digitado. Meet só em Call; Task exige
início e prazo; Registro não exige data. "Link da reunião" saiu do formulário (continua à vista na visualização); "Local" virou lista;
"Categoria" saiu e virou uma linha abaixo do Cliente; três ícones de janela ao lado do X. Detalhes em [AGENDA.md](AGENDA.md).

**Migração aplicada (2026-10-07):** `db/migrations/054_acompanhamento_registro.sql` abriu `'registro'` no CHECK de
`service_activities.kind` no banco compartilhado, com autorização do dono e depois de um backup completo dos dados (83 tabelas,
756 linhas, em `backups/2026-10-07-antes-da-054/`, fora do git). A aba Registro passa a aparecer e a API aceita o tipo.

## A fazer

Numerados na ordem em que o dono falou. Nenhum foi começado.

### 2. Descrição em .md, com menu de barra e `/coment`

O campo Descrição vira um editor como o do Notion: digitar `/` abre o menu de blocos (título, lista, citação, código, divisor…), e
`/coment` marca um trecho e pendura um comentário em popup.
**Falta:** decidir o formato gravado (Markdown em `service_activities.description`, que é `text`, ou uma coluna `description_doc jsonb`
com a árvore de blocos) — e, se for jsonb, uma migração. Comentário ancorado em trecho **não tem onde morar**: precisa de tabela nova
(atividade, âncora do trecho, autor, texto, resolvido, data), portanto migração. Decidir também se o editor é escrito na casa ou se
entra uma dependência de front — hoje o repositório **não tem nenhuma** (só `pg` em produção), e isso é decisão do dono.

### 3. TASK com link para o GitHub e para as plataformas de anúncios

Na aba Task, campos para apontar a tarefa ao que ela mexe: repositório/issue/PR no GitHub e campanha/conjunto/anúncio no Meta (e nas
demais plataformas de ads).
**Falta:** onde gravar — não há coluna nem tabela de vínculo externo em `service_activities`; precisa de migração (uma tabela de
vínculos `atividade → sistema → id externo → url` serve para este item e para o 6). O Core já fala com o GitHub e com a Meta
(`INTEGRATIONS.md`), então a leitura do nome do repositório ou da campanha é viável sem credencial nova.

### 4. Anexos e pasta estruturada no Core

Anexar documentos à atividade e criar uma pasta por atividade (ou por contratação) onde o que foi feito é guardado de forma
estruturada, para virar base de acompanhamento.
**Falta:** tabela de anexos (atividade, chave no R2, nome, tipo, tamanho, quem subiu) e as rotas de upload e de leitura — portanto
migração. O armazenamento já está decidido: **R2 privado, com URL assinada** (decisão do projeto, mesma regra das fotos de empresa e
pessoa). Falta definir a convenção de caminho da "pasta" e quem pode ver o quê.

### 5. Relações entre tasks e documentos

Uma task aponta para outras tasks (depende de, bloqueia, faz parte de) e para documentos.
**Falta:** tabela de relação (origem, destino, tipo da relação), portanto migração. Antes dela, o dono precisa fechar **quais tipos de
relação existem** — sem isso a tabela nasce como texto livre e não dá para desenhar nada em cima. Depende do item 4 para a parte de
documentos.

### 6. Vínculo da task com o produto, mostrando e guardando os dados da mudança

Ligar a task ao produto no Git, nas plataformas de ads ou dentro do Core, e **guardar o que mudou** (commits, métricas antes/depois)
junto da atividade.
**Falta:** a tabela de vínculos do item 3, mais um lugar para o retrato dos dados no momento da mudança (snapshot) — outra migração.
Falta também decidir **quando** o retrato é tirado (ao concluir a task? todo dia?) e por quanto tempo fica. Depende do item 3.

### 7. REGISTRO salvo no Core, com anexo e descrição, incluindo cronologia .md padronizada

A aba Registro guarda qualquer coisa reutilizável: cronologias, documentos, briefings. A cronologia tem um formato `.md` padronizado
que um leitor transforma em nós e desenha como fluxo, para o cliente ver dentro de mentoria e assessoria.
**Falta:** o item 4 para o anexo (a aba já existe, a 054 está aplicada); e **escrever o formato da cronologia .md** —
ele não existe em lugar nenhum ainda, e é o que trava o resto. O desenho do fluxo e o acesso do cliente dependem de portal de cliente,
que o Core **não tem** (D4, em [STATUS.md](STATUS.md) §3.E).

### 8. Contrato sai do Acompanhamento e vai para a aba do cliente, só para administrador e financeiro

O contrato não fica na tela de atividade: fica na ficha do cliente, isolado por risco, visível só para quem administra e para o
financeiro.
**Falta:** um papel "financeiro" — hoje o Core tem administrador e operador, não há essa distinção; mexer nisso é migração e decisão do
dono. Falta também a aba de documentos na ficha da empresa (a ficha hoje é uma grade sem abas, veja [STATUS.md](STATUS.md) §4) e o item
4 para guardar o arquivo.

### 9. Pessoas do cliente como participantes em Task e Registro

Era a letra (h) do item 1 e **ficou de fora de propósito**. Em Call os stakeholders do cliente já entram como convidados — mas esses
convidados vão para o Google, não para o Core: `POST /api/tracking/:id/meet` repassa a lista e nada fica gravado aqui. Em Task e
Registro não há Google para onde mandar.
**Falta:** tabela de participantes da atividade (atividade, pessoa, papel), portanto migração. Foi deixado fora em vez de improvisar
um campo de texto, como manda a regra de não inventar schema.

### 10. Categoria "assessoria" própria

A categoria agora vem da contratação (`service_model`), e `advisory` cai em `consultoria` porque a lista de categorias do banco
(migração 004: `mentoria`, `consultoria`, `software`, `educacional`, `outro`) não tem "assessoria". Na tela o dono vê "Consultoria"
onde contratou assessoria.
**Falta:** migração trocando o CHECK de `service_activities.category` (mesma forma da 054) e um tom para ela em `TOM_DA_CATEGORIA`
(`agenda-model.js`). Decisão do dono: vale abrir a categoria ou "Consultoria" basta?

## Regra que vale para todos

Nenhum destes itens pode inventar tabela ou coluna por conta própria. Migração se **escreve** e **não se aplica**: o banco compartilhado
é o de produção, e aplicar é decisão do dono (foi assim com a 047, a 048 e com a 054, esta última aplicada em 2026-10-07 depois de backup).
