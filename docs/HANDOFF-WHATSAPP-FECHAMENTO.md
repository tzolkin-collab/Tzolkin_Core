# Handoff de fechamento: WhatsApp no Core (2026-10-26)

Documento para quem pegar o projeto depois, ou para o próprio time decidir se retoma. Escrito sem enfeite: o que existe, o que funciona, o que não funciona e o que ficou no ar.

## 1. Resumo em cinco linhas

- O Core tem WhatsApp via Evolution API: ver instâncias, ler conversas, responder, fluxos de mensagem, agentes de IA e conexão de instância a funil. Tudo está no código e **commitado e enviado para a `main`** (último commit do trabalho: `98ecac5`).
- **O que está rodando em produção é uma versão antiga.** A versão nova não consegue subir (ver seção 4). Por isso as correções mais recentes não chegaram ao ar.
- Nenhum envio de teste pela tela chegou a ser confirmado como "saiu". Esse é o único teste que faltou para saber se o caminho principal funciona.
- Os testes automáticos passam (984), mas eles usam bancos e Evolution de mentira. Passar nos testes não prova que funciona no ar.
- Nada aqui foi apagado do banco. Há dados de teste e bloqueios automáticos para limpar (seção 6).

## 2. O que foi construído

| Parte | Onde | Estado |
|---|---|---|
| Adaptador da Evolution (instâncias, mensagens, webhook) | `apps/api/src/integrations/evolution.mjs` | Feito. Lê direção e status das mensagens do formato real da 2.3.7. |
| Visão geral das instâncias | `whatsapp-saude.mjs`, `whatsapp-visao.js` | Feito. |
| Conversas (leitura direto da Evolution, tela de chat) | `whatsapp-chat.mjs`, `whatsapp.js` | Feito. Junta telefone e `@lid` da mesma pessoa (commit `c93e2ac`). |
| Fila de envio com ritmo e interruptor | `whatsapp-fila.mjs` | Feito. |
| Fluxos (sequências de mensagens com espera) | `whatsapp-fluxos.mjs`, `platform/fluxos.mjs`, `whatsapp-fluxos.js` | Feito em versão 1. Migração 070. |
| Gatilho dentro do fluxo | mesmo módulo, migração 071 | Feito. |
| Instância conectada a funil (conversa nova vira lead) | `whatsapp-captura.mjs`, migração 071 | Feito, nunca visto funcionando em produção. |
| Agentes de IA (Claude e Gemini) | `platform/agentes*.mjs`, `integrations/gemini.mjs` | Feito. Execução só roda com o interruptor ligado e a chave do provedor. |
| 7 ferramentas MCP de WhatsApp | `mcp-whatsapp.mjs` | Feito. |
| Desenho e decisões | `docs/WHATSAPP-FLUXOS-DESENHO.md` | Seções 1 a 10. |

## 3. Banco de produção

- Migrações aplicadas nesta sequência de trabalho: **069**, **070** e **071**.
- **067 e 068 não foram aplicadas** (decisão explícita de não aplicar).
- A role do Core não tem `DELETE`: bloqueios e desligamentos são feitos marcando `revoked_at` ou `create_leads = false`.

## 4. O que está quebrado agora

### 4.1 O Core novo não sobe em produção
O log do serviço mostra, repetidamente:

`[boot] tentativa N/5 de abrir o banco falhou: [ERR_TLS_CERT_ALTNAME_INVALID] Host: systembots_evolution-api-db. is not in the cert's altnames: DNS:easypanel.landcriativa.com`

- O certificado do banco só vale para `easypanel.landcriativa.com`; o Core tenta com o nome interno.
- O que resolve isso é a variável `DATABASE_TLS_SERVERNAME=easypanel.landcriativa.com` **chegar ao processo que falha**. Foi dito que ela existe no serviço; o log mostra que em pelo menos um processo ela não chega.
- Há tentativas de subida em paralelo no log, o que sugere mais de uma instância ou réplica do Core, uma delas sem a variável. **Não foi confirmado.**
- Enquanto isso, uma versão antiga continua no ar e processa a fila.

Prova de que a versão no ar é antiga: as mensagens mais recentes na fila falharam com o texto antigo de erro ("o número pode não ter WhatsApp"), que foi trocado em `9b103d7`.

### 4.2 Envio de mensagens pela tela
- Causa encontrada e corrigida em código: celulares de 12 dígitos (`55` + DDD + 8 dígitos) eram recusados pelo próprio Core antes de chegar à Evolution (`normalizarNumero`). Correção em `98ecac5`. **Não chegou à produção** (item 4.1).
- Depois de uma falha, o Core colocava o número numa lista de bloqueio automática. Para respostas digitadas por uma pessoa isso foi corrigido (`85f233a`); há também botão "Liberar este número". **Também não chegou à produção.**

### 4.3 Contatos `@lid`
- Bug conhecido da Evolution 2.3.7 (issue `#1872` no GitHub): contatos que o WhatsApp esconde atrás de um identificador interno recebem `exists: false`.
- A correção está na Evolution `2.4.0-rc2` (PR `#2544`). O servidor da Evolution **foi atualizado** para a 2.4.0 e a licença gratuita foi ativada. O envio para um contato `@lid` **nunca foi testado** depois disso.

### 4.4 Core local
- `http://localhost:3100` dava "Origem não permitida" no login. Corrigido em `7a311bd`. O Core local não processa a fila (não tem `AGENDA_JOBS=1` nem `WHATSAPP_ENVIO` no `.env`).

## 5. Evolution API (servidor compartilhado)

- Endereço: `evolutionapi.landcriativa.com`. Atualizado pelo dono do servidor para a 2.4.0; licença `active`.
- Instâncias abertas na última leitura: `omni-64128a78-830245`, `gabi_prod`, `teste`, `lucas-prod`, `Adriano Pessoal`, `amanda-prod`, `saulo_prod`. **Várias são de outras operações**, não do Core.
- A instância `teste` teve o webhook trocado (só `MESSAGES_UPSERT`); houve um backup do webhook anterior. O segredo do webhook do Core em produção deu 401 e **não foi resolvido**.
- Existe um backup do banco da Evolution feito **antes** da atualização? **Não sei.** Confirmar com quem fez a atualização.

## 6. Limpeza pendente

1. **Leads "TESTE"** criados pelos testes do intake: apagar pelo painel.
2. **Bloqueios automáticos** (`whatsapp_suppressions`, motivo `sem_whatsapp`) criados por esses erros em números que existem: liberar. No código novo há botão; no ar antigo, só direto no banco (`UPDATE whatsapp_suppressions SET revoked_at = now() WHERE revoked_at IS NULL AND reason = 'sem_whatsapp'`; conferir a lista antes).
3. **Mensagens `failed`** na fila: podem ser reenviadas ou ignoradas.
4. **Interruptores:** conferir se `WHATSAPP_ENVIO` está ligado em produção. Ligado, qualquer fluxo ativo ou resposta manual envia de verdade.
5. **Chaves:** chave nova da intake do Sites foi gerada durante o trabalho; chave global da Evolution e do Gemini ficam guardadas cifradas pela tela de Integrações.

## 7. Para retomar (ordem sugerida)

1. Fazer o Core novo subir (item 4.1): descobrir qual instância/serviço está sem `DATABASE_TLS_SERVERNAME`.
2. Pela tela, liberar um número bloqueado e enviar um "Teste". Anotar o resultado.
3. Testar um contato `@lid` na Evolution 2.4.
4. Só então continuar com fluxos, agentes e conexão de instância a funil.

## 8. Para encerrar sem retomar

1. Desligar o envio: `WHATSAPP_ENVIO` fora de `ligado`.
2. Parar a execução dos agentes (interruptor "Execução dos agentes" no cartão do Claude).
3. Desativar fluxos ativos e agentes ativos (não se apaga: muda o status para "arquivado" / `is_active=false`).
4. Desconectar as instâncias do funil (`criar_leads=false` em `whatsapp_instance_funnels`).
5. Se o objetivo for só conversar no WhatsApp e automatizar, existem produtos prontos (Chatwoot, Kommo, Respond.io) que dispensam o Core para isso. O que o Core tinha de diferente era ligar o WhatsApp direto aos leads e funis da Tzolkin.

## 9. O que NÃO foi verificado

- Nenhuma mensagem enviada pela tela do Core confirmada como entregue neste trabalho.
- Fluxo ativo, agente de IA com Gemini e captura de conversas nunca foram executados em produção.
- A versão que está rodando em produção, qual commit é, e quantas instâncias do Core existem.
- Se a Evolution 2.4 mudou algum formato de resposta além do que foi lido (instâncias, conversas e histórico funcionaram em leitura).
