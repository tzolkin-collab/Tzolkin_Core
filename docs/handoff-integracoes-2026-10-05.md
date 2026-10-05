# Handoff — logos das integrações e conexão Meta (2026-10-05)

## Adições e substituições concluídas

- `apps/web/public/logos/apple.svg`: adicionado do SVGL para identificar push em iPhone, iPad e macOS.
- `apps/web/public/logos/windows.svg`: adicionado do SVGL para identificar push em Windows.
- `apps/web/assets.mjs`: adicionadas as rotas estáticas de `apple.svg` e `windows.svg`.
- `apps/web/public/config-integracoes.js`: o cartão de notificações push escolhe Apple em dispositivos Apple e Windows em dispositivos Windows; mantém o sino genérico em plataformas não reconhecidas.
- `apps/web/public/logos/hostinger.svg`: substituído o pictograma genérico pelo H oficial Hostinger (fonte: `hostinger/logo`, `v3/h-icon.png`, MIT), incorporado ao SVG local.
- `docs/THIRD-PARTY-ICONS.md`: atualizada a origem e a regra de seleção dos ícones.

## Remoções

- Removido `apps/web/public/logos/hostinger-official-temp.png` depois de incorporar o asset no SVG. Nenhum dado de conta ou integração foi removido.

## Meta — estado observado e próximo passo

- O Core local (`http://127.0.0.1:3100/`) mostrou o aviso de que a Meta aceitou o App ID e o App Secret, mas a sessão local terminou ao recarregar.
- No Core de produção (`https://core.tzolkin.cloud/`), a tela ainda mostra Meta **Não configurado** e App ID/segredo ausentes no servidor. App ID `2255730705209983` e config ID `28684560031236835` estão apenas preenchidos no formulário aberto; não foram salvos.
- O campo de App Secret está vazio na produção. O usuário deve digitá-lo diretamente ali, clicar **Testar** e depois **Salvar**. Não copiar o segredo entre ambientes nem enviá-lo pelo chat.
- Nenhuma conta de anúncios foi conectada. Depois da configuração de produção, abrir Inbound → Campanhas → Conectar com Facebook e selecionar os ativos desejados. Antes da confirmação final de acesso na Meta, pedir confirmação no momento, identificando as contas e o escopo `ads_read`.
- O app da Meta continua em desenvolvimento; não foi publicado.

## Validação

- Não executei testes automatizados por não terem sido solicitados.
- O host do sistema é Windows; o seletor dinâmico exibirá a marca Windows neste dispositivo.
