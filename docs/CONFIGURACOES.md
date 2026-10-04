# Configurações — plano de arquitetura

Status: **fase 1 construída** (casca, Aparência, Notificações, Aplicativo). O resto continua proposto. Decisões 1 e 2 confirmadas em 2026-10-04.

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
2. **Agenda e Teclado**: lembrete padrão e preferências da agenda saem de Notificações para a seção Agenda.
3. **Conexões**: Google (agenda e Meet) entra aqui; Meta e processadores migram.
4. **Financeiro e Anúncios**.
5. **Conta e Administração**: depende da decisão D4 (IdP): sem login por pessoa, Perfil e sessões ficam limitados.

Cada fase termina com teste de tela (claro, escuro, celular), teste de "indisponível" e atualização desta página.

## 7. Decisões em aberto

1. **Configurações no menu.** `[DECIDIDO]` Item em Administração, além do rodapé.
2. **Conexões.** `[DECIDIDO]` Configuração em Configurações (fase 3); operação nas telas de Tecnologia.
3. **Conta por pessoa.** Preferência pessoal no banco só faz sentido com login individual. Enquanto for a senha única (D4), Minha conta tem um operador só.
4. **Quem pode mudar escopo Espaço.** Hoje todo operador logado pode tudo. Criar papel "administrador" agora, ou depois?
