# Core interno — produção protegida com Google

## Arquitetura

`Navegador → Core/EasyPanel → Google OpenID Connect` e `Core → PostgreSQL com TLS verificado`.

O Core usa Authorization Code Flow com PKCE, `state` e `nonce`. O backend troca o código diretamente com o Google e valida assinatura RS256, emissor, audiência, expiração, nonce e `email_verified`. O e-mail precisa constar em `CORE_ALLOWED_EMAILS`. Tokens do Google não são persistidos; a sessão própria guarda apenas SHA-256 do token aleatório.

## Google Cloud

1. Google Cloud Console → Google Auth Platform. Configure a tela de consentimento.
2. Crie OAuth Client do tipo Web application.
3. Authorized JavaScript origin: o valor exato de `PUBLIC_ORIGIN`.
4. Authorized redirect URI: `PUBLIC_ORIGIN/api/auth/google/callback`.
5. Guarde Client ID e Client Secret exclusivamente nos segredos do EasyPanel.
6. Se o app ficar em Testing, adicione cada operador como Test user. Em Internal, exige Google Workspace da organização.

## Variáveis obrigatórias

`PUBLIC_ORIGIN`, `GOOGLE_CLIENT_ID`, `GOOGLE_CLIENT_SECRET`, `CORE_ALLOWED_EMAILS`, `DATABASE_URL` da role `tzolkin_core_runtime` e `DATABASE_SSL=require`. A senha compartilhada não é lida em produção.

`META_MARKETING_KEY` (32 bytes em base64) é obrigatória para conectar a credencial de marketing. Como desenvolvimento e produção apontam para o mesmo banco, ela precisa ter **o mesmo valor nos dois ambientes**: um token cifrado com uma chave não é legível pela outra. Sem ela o painel de Campanhas abre, avisa e desabilita a conexão — não quebra.

`META_APP_ID` e `META_APP_SECRET` habilitam o botão **Conectar com Facebook** — OAuth, o mesmo fluxo que ferramentas como a Utmify usam. Sem elas o painel só aceita token colado, o Core não confere escopos nem avisa quando o token estiver perto de expirar, e a troca de token curto por longo fica indisponível.

`META_LOGIN_CONFIG_ID` (opcional) troca o login clássico pelo **Login do Facebook para Empresas**. É o ID de uma *configuração* criada no painel da Meta; não é segredo, mas fica no servidor como as outras e o painel recebe só o modo (`login_mode`).

### Meta — dois modos de login

| | Sem `META_LOGIN_CONFIG_ID` (clássico) | Com `META_LOGIN_CONFIG_ID` (Empresas) |
|---|---|---|
| Diálogo | `scope=ads_read`, `auth_type=rerequest` | `config_id`, `response_type=code`, `override_default_response_type=true`, sem `scope` |
| Quem entra | Conta pessoal do Facebook | Portfólio empresarial (com a configuração de token de sistema) |
| Token gravado | Usuário, ~60 dias, trocado por token longo no servidor | Usuário do sistema de integração, **não expira** (ou 60 dias, se a configuração pedir); nunca passa por `fb_exchange_token` |
| Painel | "Expira em N dias — reconecte antes" + aviso aos 14 dias | "Não expira" (com validade de 60 dias, a mesma contagem do clássico) |

Quem decide o que gravar é o `debug_token` conferido no retorno, não o modo. Token do usuário do sistema (`expires_at` 0 ou `type` `SYSTEM_USER`) **nunca** vai para `fb_exchange_token`: essa troca é para token de usuário de curta duração, e renovar token de sistema com validade exige `set_token_expires_in_60_days=true` (sem ele a Meta dá erro para empresas obrigadas a usar validade). O Core grava o token como veio do código, com a data que o `debug_token` informar, ou sem data quando não expira. Só a configuração de **token de usuário** segue o caminho clássico (troca por token longo e grava a data). `connected_via` fica `oauth` nos dois casos.

O `expires_at` 0 e o `type` `SYSTEM_USER` são os valores observados, mas não constam da referência oficial do `debug_token`: confirme no primeiro teste com o app real (**Conferir na Meta** mostra o resultado).

### Meta — passo a passo do Login para Empresas (token que não expira)

1. `developers.facebook.com` → **Meus apps** → criar app do tipo **Empresa**. O Login do Facebook para Empresas só existe nesse tipo de app.
2. Adicionar o produto **Login do Facebook para Empresas**.
3. Nas configurações do produto, em **URIs de redirecionamento do OAuth válidos**, cadastrar exatamente `https://core.tzolkin.cloud/api/marketing/meta/callback`. A Meta compara caractere por caractere; barra no fim ou `http` no lugar de `https` faz a autorização falhar.
4. **Configurações** → criar configuração:
   - nome livre (ex.: `Core — leitura de anúncios`);
   - tipo de token: **token de acesso do usuário do sistema** (quem autoriza entra com o portfólio empresarial);
   - validade do token: **nunca expira**. A opção de 60 dias também conecta (o painel mostra a data e avisa aos 14 dias), mas a renovação automática (`fb_exchange_token` com `set_token_expires_in_60_days=true`) não está implementada: é preciso reconectar antes de vencer;
   - ativos: **contas de anúncio**;
   - permissões: só **`ads_read`**;
   - criar.
5. Copiar o **ID da configuração** para `META_LOGIN_CONFIG_ID`. ID e chave secreta do app (Configurações do app → Básico) vão para `META_APP_ID` e `META_APP_SECRET`. Só números no ID; valor malformado faz o botão responder 503 citando a variável, antes de ir à Meta.
6. Reiniciar o serviço, abrir **Campanhas → Conectar com Facebook**, escolher o portfólio dono das contas de anúncio e autorizar. O cartão deve mostrar **Não expira**; **Conferir na Meta** roda o `debug_token` de novo.

Por que só `ads_read`: pela referência da Meta ela cobre as contas de anúncio que você possui **ou às quais recebeu acesso**. `business_management` ficou de fora de propósito — lê **e escreve** na API do Gerenciador de Negócios e permissão desnecessária é motivo comum de rejeição na Análise do App. Nada de `ads_management`: esta integração não escreve.

### Meta — quando entram Análise do App, Acesso Avançado e verificação

- **App em Desenvolvimento, conectando o portfólio da própria TZOLKIN:** não exige análise. As permissões com acesso padrão só podem ser pedidas a quem tem papel no app, e para testar o token de usuário do sistema a pessoa precisa ter papel no app **e** controle total do portfólio que autoriza.
- **Atender negócios que a TZOLKIN não possui nem gerencia** (cliente conectando o próprio portfólio): exige **Acesso Avançado** aprovado na **Análise do App**, permissão por permissão (`ads_read`; a Meta exige também acesso avançado a `public_profile` para apps de Login para Empresas antes de ir ao ar). Desde 01/02/2023 pedir acesso avançado exige o app **conectado a uma empresa verificada** (Verificação da Empresa).
- **Atenção antes de dar esse passo:** o Core guarda **uma** credencial ativa por provedor. Um cliente conectando hoje revogaria a credencial da TZOLKIN. Conectar clientes depende de migração e de mudança de desenho, ainda não decididas.

### Meta — modo clássico (sem `META_LOGIN_CONFIG_ID`)

Mesmo app, mesma URI de retorno, permissão `ads_read` pedida por `scope`. Em Desenvolvimento só quem tem papel no app autoriza. O token que volta é de usuário, com ~60 dias, e a Meta não renova sozinha: o painel avisa com 14 dias de antecedência e diz que configurar `META_LOGIN_CONFIG_ID` elimina a expiração.

`META_REDIRECT_URI` sobrescreve o endereço de retorno quando o Core estiver atrás de outro domínio.

### Meta — versão da Graph API

Padrão `v26.0` (lançada em 29/07/2026), conferida em 15/09/2026 contra os changelogs da Graph e da Marketing API: nenhuma mudança nos campos lidos (contas, campanhas, insights), em `debug_token`, `oauth/access_token` ou `dialog/oauth`. A `v21.0` anterior já tinha expirado na Marketing API em 09/09/2025 e é removida da Graph em 21/01/2027. `META_GRAPH_VERSION` sobrescreve o padrão sem mudar código (basta reiniciar o serviço).

### `PORT` **é** lida em produção

> Correção de 2026-09-04. A documentação anterior herdou do `.env.example` e do [SPLIT-RUNTIME.md](SPLIT-RUNTIME.md) a frase "`PORT` antigo não é mais usado". Isso vale para o **bootstrap local**, que usa `API_PORT` (3102) e `WEB_PORT` (3100). **Não vale para produção.**

`apps/api/src/production.mjs` faz `server.listen(Number(process.env.PORT||3000),'0.0.0.0')`. Consequências:

| Situação | Efeito |
|---|---|
| `PORT` ausente | Escuta em 3000. É o padrão, agora também declarado como `ENV PORT=3000` no `Dockerfile`. |
| `PORT` definida | Escuta nesse valor. O `HEALTHCHECK` do `Dockerfile` lê a mesma variável em tempo de execução e acompanha. |
| `PORT` definida e proxy do EasyPanel apontando para outra porta | **Fora do ar com a app viva**: o container responde, o proxy devolve 502. O log traz `TZOLKIN Core production ready on 0.0.0.0:<porta>` — confira contra a porta publicada. |

**Armadilha conhecida:** copiar o `.env` local inteiro para as variáveis do EasyPanel traz `PORT=3100`, valor residual do frontend do bootstrap. Ou remova a variável, ou alinhe proxy e domínio ao mesmo número. `API_PORT`, `WEB_ORIGIN` e `CORE_ADMIN_PASSWORD` não são lidos pelo entrypoint de produção.

## Deploy e verificação

- Build pelo `Dockerfile`, porta 3000 (ou o valor de `PORT`), inicialmente uma réplica, health `/health`.
- O boot tenta abrir o banco 5 vezes, com espera exponencial de 1s a 30s, e registra a causa de cada falha no formato `[boot] tentativa N/5 ... [código] mensagem` — sem credencial. Esgotadas as tentativas, sai com código 1.
- Sem HTTPS, credenciais Google, allowlist ou TLS verificado, o processo recusa iniciar.
- Conta fora da allowlist não cria sessão.
- Mutação autorizada grava `actor_subject` e `actor_email`.
- Logout revoga a sessão persistida no Core.
- `.env`, tokens e chave privada não entram na imagem.

## Rollback

Manter a imagem anterior. Reverter se login autorizado falhar, `/health` não estabilizar, 5xx superar 1% por cinco minutos ou mutação não registrar ator. Migrações 007/008 são aditivas e podem permanecer.

## Pendências antes de tráfego real

- Criar as credenciais OAuth Google e informar origem/redirect exatos.
- Criar a role PostgreSQL restrita com `scripts/configure-runtime-role.mjs`.
- Backup e restauração do banco ensaiados.
- Validar o build no EasyPanel; Docker não está instalado na estação local.
