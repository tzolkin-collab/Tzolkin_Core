-- Conexão com a Meta por OAuth (Facebook Login), no lugar de colar token.
--
-- Mesmo desenho do login com Google (operator_auth_flows): o `state` é um
-- segredo aleatório de uso único, guardado só como hash, com validade curta.
-- Ele é criado por um dono autenticado via POST com checagem de origem, e é o
-- que autentica o retorno da Meta.
--
-- O retorno NÃO pode depender do cookie de sessão: em desenvolvimento o cookie é
-- SameSite=Strict e não viaja no redirecionamento vindo de facebook.com. O
-- `state` guarda quem iniciou, e isso basta — sem um dono não se cria `state`.
--
-- Consumo por UPDATE ... consumed_at IS NULL, nunca DELETE: a role de produção
-- não tem esse privilégio. Consequência conhecida: as linhas ficam. É uma por
-- clique em "Conectar", então o volume é desprezível, mas não há limpeza.
CREATE TABLE IF NOT EXISTS marketing_oauth_states (
 state_hash text PRIMARY KEY CHECK (length(state_hash) = 64),
 provider text NOT NULL CHECK (provider IN ('meta')),
 -- A troca do código exige o MESMO redirect_uri do pedido de autorização.
 -- Guardar aqui garante isso mesmo se a configuração mudar no meio do fluxo.
 redirect_uri text NOT NULL CHECK (length(redirect_uri) BETWEEN 10 AND 500),
 operator_subject text,
 operator_email text,
 expires_at timestamptz NOT NULL,
 consumed_at timestamptz,
 created_at timestamptz NOT NULL DEFAULT now()
);

-- A credencial passa a registrar que entrou por OAuth.
ALTER TABLE marketing_credentials DROP CONSTRAINT IF EXISTS marketing_credentials_connected_via_check;
ALTER TABLE marketing_credentials ADD CONSTRAINT marketing_credentials_connected_via_check
 CHECK (connected_via IN ('script', 'panel', 'oauth'));
