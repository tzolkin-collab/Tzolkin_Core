# Configurações — plano de arquitetura

Status: **fases 1 a 5 construídas** (casca, Aparência, Notificações, Aplicativo, Agenda, Teclado, Integrações, credenciais pela tela, Perfil e sessão, Acessos, Auditoria). O resto continua proposto. Decisões 1 e 2 confirmadas em 2026-10-04.

## 1. Problema

Configurações hoje é uma tela só, com blocos empilhados (Aparência, Notificações). O que é configuração já está espalhado pelo Core:
Conexões (Tecnologia), Segurança e Acessos (ocultas), chaves de financeiro e Meta (campanhas), preferências da agenda, push e tudo do PWA.
Cada novo assunto vai piorar isso. Falta um lugar com divisão clara por **de quem é a configuração** e **o que ela afeta**.

## 2. Princípio: três escopos, nunca misturados

| Escopo | De quem é | Onde mora | Exemplos |
|---|---|---|---|
| **Neste navegador** | do aparelho | `localStorage` / permissão do navegador | tema, instalação do app, permissão de notificação |
| **Minha conta** | da pessoa (`operator.subject`) | banco, por operador | aparelhos com push e seus assuntos, atalhos, visão padrão da agenda |
| **Espaço de trabalho** | de todos | banco, uma linha por assunto | lembrete padrão da agenda, conexões (Google, Meta, Stripe, Asaas, bancos), financeiro |

Cada seção declara o escopo e a tela **mostra** o escopo (um selo "Só neste navegador", "Sua conta", "Todo o espaço"). Quem muda algo de
escopo "Espaço" precisa de permissão; quem muda algo pessoal nunca afeta outra pessoa.

## 3. Estrutura da tela

Desktop: coluna de seções à esquerda, conteúdo à direita. Celular: lista de seções que abre a seção (voltar no topo).
Endereço: `/?view=settings&secao=notificacoes`, para o link, o botão voltar e a notificação poderem abrir direto numa seção.

```
CONFIGURAÇÕES
  Pessoal
    Perfil e sessão        Minha conta   e-mail, sair, encerrar outras sessões (depende do IdP, D4)
    Aparência              Navegador     tema (hoje)
    Notificações           Conta         aparelhos, assuntos, teste (hoje) + silêncio (horário)
    Aplicativo             Navegador     instalar, estado das permissões, como mudar o resto no Chrome
    Teclado                Navegador     lista de atalhos (a mesma da agenda, `?`)
  Espaço de trabalho
    Agenda                 Espaço        lembrete padrão (hoje), semana começa em, fuso, duração padrão
    Conexões               Espaço        Google (agenda e Meet), Meta, Stripe, Asaas, bancos, Vercel, GitHub, EasyPanel, DNS
    Financeiro             Espaço        contas e processadores, moeda, competência
    Anúncios               Espaço        contas de anúncio, coleta, orçamento padrão
    E-mail                 Espaço        remetente, domínios, modelos
  Administração
    Acessos                Espaço        quem entra em qual produto
    Segurança e auditoria  Espaço        sessões ativas, histórico de alterações
    Dados                  Espaço        banco, Redis, retenção
```

A seção **Aplicativo** não pode ligar "iniciar ao fazer login", "abrir como janela", Local, Câmera ou Microfone: esses controles são do Chrome
(`chrome://apps`, como na captura). O Core só mostra o que o navegador deixa ler (instalado ou não, permissão de notificação) e explica onde mudar.
O Core não usa Local, Câmera nem Microfone, e a recomendação é **não pedir** essas permissões.

## 4. Como o código se organiza

Um registro de seções, cada uma em seu módulo, carregada só quando aberta:

```
apps/web/public/   (arquivos soltos, como o resto do Core; cada um entra em apps/web/assets.mjs)
  config-indice.js   registro: [{ id, titulo, grupo, escopo, descricao, carregar: () => import('./x.js') }]
  settings.js        a casca: coluna de seções, selo de escopo, seção aberta
  config-aparencia.js  notificacoes.js  config-aplicativo.js   (fase 1)
  config-agenda.js  config-conexoes.js  config-financeiro.js  config-anuncios.js ...   (próximas)
```

Entrada direta: `/?secao=notificacoes` abre Configurações nessa seção (o parâmetro sai da barra de endereço, como `?view=`).
Celular: as seções viram uma fileira de botões no topo (não uma lista que abre cada seção).

Contrato de cada seção: `montar(raiz, { api, operador, espaco })` devolve uma função de limpeza. Uma seção:
- declara o que precisa (permissão, migração); sem isso mostra "indisponível" com o motivo, nunca some em silêncio;
- mostra estado antes de ação (conectado, erro, precisa reautorizar, última verificação);
- nunca recebe nem exibe segredo (só "configurado: sim/não" e a data);
- grava com revisão (concorrência otimista, como a agenda) e confirma "Salvo".

No servidor: `GET /api/configuracoes` devolve o que cada seção precisa para decidir se aparece (permissões, migrações, conexões), em uma chamada.
Preferências pessoais: tabela `operator_preferences(operator_subject, chave, valor jsonb, revision)`.

## 5. O que migra de onde

| Hoje | Vai para |
|---|---|
| `settings.js` (Aparência) | `config/aparencia.js` |
| `notificacoes.js` | `config/notificacoes.js` |
| Tela Conexões (Tecnologia) | Seção Conexões; o menu Tecnologia continua com Vercel, GitHub, EasyPanel, DNS como telas de **operação**, e a **configuração** (chaves, vínculo) fica em Configurações |
| Banner "chave não configurada" no Financeiro / Campanhas | link para a seção correspondente |
| Retorno OAuth da Meta (`?meta=`) | volta para Configurações → Conexões |
| Segurança ("Em breve"), Acessos | Administração |

## 6. Fases

1. **Casca** `[FEITO]`: coluna de seções, `?secao=`, selos de escopo, Aparência e Notificações dentro dela, Aplicativo (somente leitura, botão Instalar quando o Chrome oferece). Configurações ganhou item no menu, em Administração, além do botão do rodapé.
2. **Agenda e Teclado** `[FEITO]`: seção Agenda (escopo misto, cada bloco com o seu selo): lembrete padrão (espaço, vinda de Notificações, que agora só aponta para ela), visão em que a agenda abre e duração de atividade nova (ambas neste navegador, `agenda-prefs.js`). Seção Teclado lista os atalhos da agenda (`agenda-atalhos.js`, a mesma lista da janela do `?`). Ficaram para depois, por pedirem coluna nova no banco: semana começando no domingo e fuso.
3. **Integrações** (3a `[FEITO]`): seção só leitura, `GET /api/integrations/status`, que diz para cada serviço (Login Google, Stripe, Asaas, Pluggy, Meta, e-mail, Vercel, GitHub, EasyPanel, Hostinger, push) se está ligado, incompleto ou não configurado, **o nome das variáveis que faltam** (nunca o valor; há teste que garante que nenhum valor vaza), e um botão "Abrir" para a tela de operação. A Meta mostra também se há conta conectada, expirada ou com erro. O nome é **Integrações** porque a tela "Conexões" do menu já existe e é outra coisa (a quem pertence cada recurso: projeto, deploy, domínio).
   3b `[FEITO, migração 049 não aplicada]` **Google Agenda e Meet**: conexão por operador em Integrações e botão "Criar sala do Meet" no evento. Detalhes em `docs/AGENDA.md`.
4. **Financeiro e Anúncios**.
5. **Conta e Administração** `[FEITO]`: a D4 já estava resolvida em produção (login individual pelo Google, `operator_accounts` com papéis `owner`, `member`, `viewer`). Seções novas: **Perfil e sessão** (quem é, papel e como entrou, até quando vale a sessão, Sair, **Encerrar as outras sessões** da mesma pessoa), **Acessos** (a lista de contas com papel e situação; o administrador altera e adiciona; quem entra só pela lista do servidor aparece num aviso, porque não se suspende por aqui) e **Auditoria** (trilha das empresas + histórico de credenciais, em ordem, sem valores; contas, times e sessões entram pela tabela `operator_audit`, migração 053: quem mudou, o antes e o depois do cadastro, só quando algo mudou, sem senha, token nem hash; sem a 053 a tela avisa que falta). O menu ganhou o grupo **Administração**.

Cada fase termina com teste de tela (claro, escuro, celular), teste de "indisponível" e atualização desta página.

## 6b. Fase 4 — credenciais pela tela, em vez do `.env` `[ETAPA 1 FEITA, migração 050 não aplicada]`

**Etapa 1 (Vercel, GitHub, EasyPanel, Hostinger).** Construída: `platform/env-vivo.mjs` (o `process.env` com as credenciais da tela por cima; a tela vence; relê do banco a cada 15 s ou ao gravar; sem `CORE_SECRETS_KEY` ou sem a 050 é igual ao `process.env`), `platform/credenciais.mjs` (catálogo, validação, Testar), `modules/integrations-credentials.mjs` (`GET/PUT /api/integrations/credentials`, `POST …/test`, `DELETE …/:provedor/:nome`) e migração `050_credenciais_de_integracao.sql`. Os módulos antigos não mudaram a leitura (`env.VERCEL_TOKEN`): passaram a receber o ambiente vivo. Cada card ganhou **Configurar** (campo de senha que nunca volta preenchido, Testar, Salvar, Remover da tela, histórico). Salvar testa no provedor antes de gravar. Caches de 30 s dos módulos podem atrasar a troca nesse intervalo. **Etapa 2 (push) `[FEITA]`.** Provedor `push` no catálogo (chave pública, chave privada, assunto): Testar confere se o par casa (a pública nasce da privada) e não envia aviso. **Gerar chaves** cria o par NO servidor, guarda cifrado e devolve só a pública; havendo chaves, pede confirmação, porque trocar desativa os aparelhos já ativados (as assinaturas foram feitas com a chave antiga: elas são marcadas como revogadas, e o navegador, ao ativar de novo, descarta a assinatura antiga e faz outra). O push passou a ler as chaves a cada pedido (`senderDe` refaz o envio quando elas mudam) e o ciclo da agenda relê as credenciais da tela. **E-mail ficou de fora de propósito:** nenhum código envia e-mail hoje (a tela de E-mails está oculta, "rascunhos"), então guardar `EMAIL_PROVIDER` e `EMAIL_API_KEY` pela tela não ligaria nada; entra quando o envio existir. **Etapa 3 (Stripe e Asaas) `[FEITA]`.** Stripe: chave secreta, chave publicável, segredo do webhook. Asaas: chave da API, ambiente, token do webhook. **Testar** chama o provedor com uma leitura (saldo): Stripe confere a chave e se a publicável é do mesmo modo (live ou test); Asaas usa a URL do ambiente escolhido (sandbox por padrão) e explica chave de ambiente errado. O webhook só tem o formato conferido (só um evento real prova que bate com o do provedor, e a tela diz isso). **Campos críticos** (chave secreta, ambiente, segredo e token de webhook) exigem confirmação para TROCAR ou REMOVER um valor que já está em uso: a tela pede um segundo clique com o motivo ("o endpoint no Stripe precisa estar com o MESMO valor, senão os pagamentos deixam de ser confirmados"), e o servidor recusa com 409 se a confirmação não vier (`confirmar: true` no PUT, `?confirmar=1` no DELETE). Primeira definição e campos comuns não pedem. Todos os módulos de cobrança passaram a ler o ambiente vivo. **Etapa 4 (Pluggy) `[FEITA]`.** ID do cliente, segredo do cliente e as conexões (itens, separados por vírgula; sobrepõem `PLUGGY_ITEM_ID` legado). **Testar** autentica na Pluggy e consulta cada item (até 10), dizendo QUAL item não existe naquela conta. A Pluggy guarda o token de acesso por ~110 min: agora ela o descarta quando o ID ou o segredo mudam, para a troca valer na hora. A etapa 5 usa a mesma base: cada uma só acrescenta o provedor em `credenciais.mjs`.

Objetivo: ligar, trocar e remover cada integração em Configurações → Integrações, sem editar variável de ambiente nem reiniciar.

**Onde ficam os valores.** Tabela `integration_credentials(provider, nome, valor cifrado, impressão digital, quem e quando)`, cifrada com `CORE_SECRETS_KEY` (o mesmo mecanismo do token do Google). A tela **nunca** mostra o valor depois de salvo: só "configurada", a data, quem salvou e a impressão digital (para responder "trocaram a chave?"). Remover marca como revogada (a role do Core não apaga linha).

**Quem vence.** O valor da tela vence o do `.env`; se não houver valor na tela, vale o `.env` (compatível: nada para de funcionar no dia em que isto sair). O card diz de onde vem: "pela tela" ou "pelo servidor".

**O que continua só no ambiente** (é o que o Core precisa para subir ou para se proteger, antes de qualquer tela):
`DATABASE_URL`, `DATABASE_SSL`, `CORE_RUNTIME_DB_PASSWORD`, `CORE_SECRETS_KEY`, `PUBLIC_ORIGIN`, `WEB_ORIGIN`, `PORT`, `API_PORT`, `NODE_ENV`,
`GOOGLE_CLIENT_ID` e `GOOGLE_CLIENT_SECRET` (o login com Google precisa deles antes de existir sessão) e `CORE_ALLOWED_EMAILS` (porta de emergência).

**O que migra** (tudo o que hoje é variável de uma integração): Stripe (chave, segredo do webhook, chave pública), Asaas (chave, token do webhook, ambiente), Pluggy (id, segredo, itens), Meta (app id, segredo, configuração de login), Vercel (token, time), GitHub (token), EasyPanel (endereço, token), Hostinger (chave, zona), e-mail (provedor, chave) e push (as chaves VAPID, que a própria tela **gera**).

**Cada card ganha:** formulário com campos de senha, **Testar** (faz uma chamada de leitura ao provedor e só grava se responder), **Salvar**, **Remover**, e o histórico de quem mudou e quando (sem valores).

**O que muda no código.** Hoje os módulos leem `env.X` ao subir. Passam a pedir a um resolvedor (`credencial(provedor, nome)`: tela, depois ambiente), com cache curto que a gravação invalida, para a troca valer na hora. Uma integração por vez, cada uma com teste de "tela vence ambiente" e de "sem nenhum dos dois".

**Ordem proposta.** 1) infraestrutura (tabela, cifra, resolvedor, formulário e Testar) com Vercel, GitHub, EasyPanel e Hostinger, que são só leitura; 2) e-mail e push (gerar VAPID pela tela); 3) Stripe e Asaas (mexem com dinheiro e webhooks: cada troca de segredo de webhook pede confirmação); 4) Pluggy; 5) Meta (a conta conectada continua no produto, só app id e segredo vêm para cá).

**Etapa 5 (Meta) `[FEITA]`.** Só o APLICATIVO vem para a tela: ID, chave secreta, configuração do Login para Empresas e endereço de retorno. A conta de anúncios continua sendo conectada dentro de cada produto (Inbound → Campanhas), com o token cifrado no banco como antes. **Testar** pede o token do aplicativo à Meta por POST (a chave não vai em endereço): só sai se ID e chave forem do mesmo aplicativo. ID e chave são campos críticos: trocar o aplicativo em uso pede confirmação e avisa que a conta já conectada pode precisar ser conectada de novo. A chave que cifra o token da Meta agora é `META_MARKETING_KEY` se existir, senão a `CORE_SECRETS_KEY` (uma chave só serve para tudo).

**Etapa 6 (e-mail) `[FEITA]`.** Provedor Resend (`platform/email.mjs`, REST, sem biblioteca): provedor, chave (`re_…`) e remetente (`Nome <voce@dominio>`). **Testar** confere a chave e se o domínio do remetente está verificado no Resend; chave restrita a ENVIO (a recomendada) não consegue listar domínios, e a tela diz que a conferência do domínio sai do e-mail de teste. **Enviar e-mail de teste** manda UM e-mail só para o endereço de quem está logado (o destinatário não é digitável), com limite de um a cada 30 s e as credenciais do momento. As automações e modelos de e-mail seguem em rascunho: nada os liga ainda a esse envio.

**Fase 4 concluída** para tudo o que tem código por trás: Vercel, GitHub, EasyPanel, Hostinger, push, Stripe, Asaas, Pluggy, Meta e e-mail. Ficam no `.env`, de propósito, só as variáveis de bootstrap (banco, `CORE_SECRETS_KEY`, endereços, login com Google).

## 7. Decisões em aberto

1. **Configurações no menu.** `[DECIDIDO]` Item em Administração, além do rodapé.
2. **Conexões.** `[DECIDIDO]` Configuração em Configurações (fase 3, como **Integrações**); operação nas telas de Tecnologia.
3. **Conta por pessoa.** Preferência pessoal no banco só faz sentido com login individual. Enquanto for a senha única (D4), Minha conta tem um operador só.
4. **Quem pode mudar escopo Espaço.** `[DECIDIDO E FEITO PARA CREDENCIAIS]` O papel de administrador já existia (`owner`). Só ele testa, salva, remove e gera chaves de integração (o servidor recusa com 403 e a tela desabilita os botões para os demais, que continuam vendo o estado). Quem entra pela lista do servidor e não tem conta cadastrada conta como administrador, para o primeiro acesso não se trancar. Outras configurações de escopo Espaço (lembrete padrão da agenda) seguem abertas a qualquer operador.
