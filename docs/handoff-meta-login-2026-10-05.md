# Handoff — conexão Meta Ads no Core (2026-10-05)

## Ações concluídas

- **Adicionado na Meta:** URL OAuth válida `https://core.tzolkin.cloud/api/marketing/meta/callback` em Login do Facebook para Empresas → Configurações → URIs de redirecionamento OAuth válidos. A tela confirmou que as alterações foram salvas.
- **Remoções:** nenhuma.
- **App:** permanece em modo de desenvolvimento (não publicado).
- **Configuração Business Login:** `Core - leitura ads`, ID `28684560031236835`, criada anteriormente, com permissão `ads_read` e validade sem expiração.

## Preparação no Core

- O formulário de Configurações → Integrações → Meta foi aberto em `https://core.tzolkin.cloud/`.
- App ID `2255730705209983` e ID de configuração `28684560031236835` estão preenchidos no formulário, mas **ainda não foram salvos**.
- `META_APP_SECRET` permanece vazio. Por ser uma credencial de autenticação, o usuário deve digitá-la diretamente no Core/EasyPanel; não enviar no chat.
- Próximo passo do usuário: inserir o App Secret; clicar **Testar**; se a Meta confirmar que App ID e segredo pertencem ao mesmo app, clicar **Salvar**.
- Depois, abrir Inbound → Campanhas → Conectar com Facebook e autorizar o portfólio empresarial com papel no app e acesso às contas de anúncios.

## Limites / pendências

- Nenhuma chave ou token foi lido, copiado, enviado ou salvo pelo agente.
- A autorização de conta de anúncios ainda não ocorreu; portanto, não existe token conectado para verificar.
- Não houve deploy ou reinício do serviço.
