# Notificações push

Aviso no aparelho da equipe quando algo acontece no Core. Hoje existe **um** aviso: **lead novo** chegou pelo intake comercial (o do formulário do TZOLKIN Sites e o dos outros produtos).

Estado em **2026-10-01**: servidor escrito e testado por unidade, **ainda não aplicado ao banco nem publicado**, e **não validado em aparelho real** (nem Android, nem iPhone). Ver §7.

Marcas: `[EXISTENTE E VERIFICADO]` = lido no código e coberto por teste. `[ESCRITO, NÃO PUBLICADO]` = está no repositório, mas não roda em produção. `[PROPOSTO]` = ainda não existe.

---

## 1. Como funciona

```
Sites ──POST /v1/commercial/intake──▶ Core grava o lead ──COMMIT──▶ afterCommit
                                                                        │
              celular do operador ◀── serviço de push (Google/Apple/…) ◀┘
                      │
          toca na notificação ──▶ painel abre na tela Inbound (?view=leads)
```

1. O operador, logado no painel, **assina o aparelho dele** (`PUT /api/push/subscriptions`). `[ESCRITO, NÃO PUBLICADO]`
2. O intake grava o lead. Só **depois do COMMIT**, e só se o lead foi **criado agora**, o Core avisa quem assinou o tópico `commercial.lead`. `[ESCRITO, NÃO PUBLICADO]`
3. O `sw.js` do painel mostra a notificação. `[EXISTENTE E VERIFICADO]` desde 02/09 (commit 770f138).
4. O toque na notificação abre o painel na tela **Inbound**, reaproveitando a aba já aberta. `[EXISTENTE E VERIFICADO]`

O aviso **nunca** altera a resposta do intake nem o status HTTP. Se o serviço de push estiver fora do ar, o lead já está gravado e só o aviso se perde (fica registrado em `failure_count`).

## 2. O que a notificação mostra

Só o que o `sw.js` lê: `title`, `body`, `tag`, `view`.

| Campo | Valor |
|---|---|
| `title` | `Lead novo — <nome do produto>` |
| `body` | `<organização> · <pessoa>` (ou "Um contato novo chegou.") |
| `tag` | `lead:<id do lead>`: uma por lead, para dois leads seguidos não virarem um só |
| `view` | `leads` (a tela Inbound) |

**Não leva** e-mail, telefone, mensagem nem origem. A notificação passa pelo serviço de push (criptografada de ponta a ponta até o aparelho) e aparece na tela bloqueada, então vai o mínimo.

## 3. API

Todas exigem sessão de operador (`auth: admin`) e a origem do painel (CSRF).

| Rota | O que faz |
|---|---|
| `GET /api/push/config` | `{enabled, publicKey, topics}`. A chave pública não é segredo: o navegador precisa dela para assinar |
| `GET /api/push/subscriptions` | "Meus aparelhos": id, tópicos e datas. **Nunca** devolve endpoint nem chaves |
| `PUT /api/push/subscriptions` | `{subscription, topics?}`. Assina ou religa o aparelho. O endpoint é único: se outro operador assinar o mesmo aparelho, ele passa a ser dele |
| `DELETE /api/push/subscriptions/:id` | Desliga (`revoked_at`). Só o dono. Não apaga a linha |
| `POST /api/push/test` | Manda um aviso de teste **só aos aparelhos de quem pediu** |

Sem as variáveis VAPID (§5) as rotas de escrita respondem `503 "Notificações push ainda não estão configuradas"`, e o resto do Core funciona igual.

As rotas de escrita usam `audit: false`: `audit_events.tenant_id` é obrigatório, e uma assinatura não pertence a organização nenhuma. O histórico mínimo vive na própria linha de `push_subscriptions`.

## 4. Banco (migração 037)

`push_subscriptions`: uma linha por aparelho.

- `endpoint` **único** e restrito a `https://` (CHECK); chaves com tamanho conferido (CHECK).
- `topics text[]` com CHECK de lista fechada. Hoje só `commercial.lead`. Tópico novo entra no CHECK junto com o código que o dispara.
- **Sem DELETE**: a role do Core não apaga linha (mesma regra da 034). Desligar é `revoked_at`.
- `last_success_at`, `last_failure_at` e `failure_count` mostram se o aparelho está recebendo.

A migração é **só criação** (tabela e índices novos). Pode rodar antes do deploy sem quebrar nada, porque o código antigo não a conhece.

## 5. Configuração

```bash
npx web-push generate-vapid-keys
```

| Variável | Onde | Observação |
|---|---|---|
| `VAPID_PUBLIC_KEY` | servidor | Também é entregue ao navegador por `/api/push/config` |
| `VAPID_PRIVATE_KEY` | **só** segredos do EasyPanel | Nunca em arquivo versionado nem em log |
| `VAPID_SUBJECT` | servidor | `https://core.tzolkin.cloud` (URL do site) ou `mailto:`. Prefira a URL: o assunto vai ao serviço de push, e não deve ser um e-mail pessoal |

Sem as três, o push fica desligado. **Guarde o par com cuidado:** trocar as chaves invalida todas as assinaturas existentes (cada operador precisa assinar de novo).

## 6. Segurança

- **SSRF.** O servidor faz POST para o `endpoint` que o navegador mandou. Sem filtro, uma sessão de operador (ou uma sessão sequestrada) faria o servidor chamar qualquer URL, inclusive a rede interna do EasyPanel e o banco. Só passa HTTPS de `fcm.googleapis.com`, `*.push.services.mozilla.com`, `*.push.apple.com` e `*.notify.windows.com`, sem usuário, senha ou porta. Coberto por teste (esquema, host qualquer, metadata da nuvem, sufixo falso, `@`, porta).
- **Conteúdo fixo.** O texto da notificação é montado no servidor a partir do lead. Nenhuma rota de push aceita título, corpo ou destino vindos do cliente.
- **Isolamento.** O operador só lista, desliga e testa os aparelhos dele (filtro por `operator_subject`, que vem da sessão).
- **Segredos.** Endpoint e chaves de assinatura nunca saem em resposta de API.
- **Falha não propaga.** O envio roda em `afterCommit`, fora da transação e da resposta. Se rodasse antes do COMMIT, um ROLLBACK deixaria o aviso de um lead que não existe.

## 7. Estado e o que falta

| Item | Estado |
|---|---|
| Migração 037, módulo `push.mjs`, `platform/webpush.mjs`, gancho `afterCommit`, aviso no intake | `[ESCRITO, NÃO PUBLICADO]`. 20 testes unitários; suíte unitária 379/379 |
| Teste de integração contra PostgreSQL (assinar, religar, revogar, ordem do COMMIT) | `[PROPOSTO]`. A suíte de banco não foi rodada nesta entrega |
| **Tela no painel** para ativar o aparelho (botão, lista de aparelhos, teste) | `[PROPOSTO]`. Hoje só a API existe |
| Chaves VAPID no EasyPanel | `[PROPOSTO]`. Nenhuma foi gerada para produção |
| Aplicar a 037 no banco de produção | `[PROPOSTO]`. Pede decisão do dono |
| **Validação em aparelho real** (Android e iPhone) | `[PROPOSTO]`. Nada foi enviado a um serviço de push de verdade |
| Preferências por produto e por serviço; tópicos além de lead novo | `[PROPOSTO]`. O CHECK e os índices comportam, o código não |
| Aviso de falha de entrega persistente (hoje só contador) | `[PROPOSTO]` |

No iPhone, o push só funciona com o painel **instalado** (Compartilhar → Adicionar à Tela de Início) e aberto por esse ícone, a partir do iOS 16.4.

## 8. Ordem para publicar

1. Gerar as chaves e pôr as três variáveis nos segredos do EasyPanel.
2. Aplicar a migração 037 (só cria tabela).
3. Publicar o código.
4. Em um aparelho real: abrir o painel, assinar, mandar o teste e conferir que a notificação chega e que o toque abre a tela Inbound.
5. Só então contar com o aviso de lead novo.
