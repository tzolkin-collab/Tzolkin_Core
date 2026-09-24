-- 034 — Uma conexão, um dono.
--
-- Hoje a mesma pergunta ("de quem é este projeto da Vercel?") tem três respostas
-- possíveis: product_deploy_bindings (019), service_deploy_bindings (020) e
-- product_resource_bindings (022). Três tabelas para o mesmo fato significa que
-- um recurso pode aparecer em dois donos ao mesmo tempo sem nada reclamar.
--
-- Esta migração escolhe product_resource_bindings como a única resposta: ela já
-- guarda todos os tipos de recurso, já tem trilha própria (product_resource_audit,
-- com o autor original das linhas que existem hoje) e já é a tabela lida pela
-- topologia do portfólio e pelo checklist de ativação. O que faltava era o outro
-- lado do dono — a contratação — e o estado da conexão.
--
-- A FORMA É A DA MIGRAÇÃO 026. marketing_campaign_bindings já resolveu o mesmo
-- problema para campanhas: `active boolean`, `num_nonnulls(product_id, engagement_id)`,
-- actor_subject/actor_email e índices parciais `WHERE active`. Nada aqui inventa
-- padrão novo, justamente para as duas tabelas se lerem do mesmo jeito.
--
-- DESVINCULAR É UPDATE, NUNCA DELETE. `active=false` guarda o último dono e o
-- motivo; religar reaproveita a linha, porque a UNIQUE da 022 continua valendo.
-- Atenção: isto é regra de código, e não do banco. A role de produção é dona do
-- banco e tem DELETE hoje (conferido em leitura); tirar o DELETE dela é parte da
-- decisão de permissões que o dono ainda não tomou. Até lá, as duas rotas de
-- DELETE da 022 continuam apagando linha de verdade.
--
-- EXPANSÃO, NÃO CONTRAÇÃO. Nada apaga linha, coluna ou tabela. Mas expansão não é
-- o mesmo que invisível: com as colunas novas preenchidas, DOIS caminhos do código
-- que está no ar mudam de resposta, e os dois estão nomeados onde acontecem —
-- o CHECK `um_dono` no bloco 3 e a cópia de contratações no bloco 7. Nenhum dos
-- dois é alcançável pela tela hoje; os dois pedem conserto na fase do código.
-- As tabelas antigas continuam intactas e continuam sendo lidas e gravadas como
-- hoje, porque o deploy do código novo ainda não saiu. Quando (e se) elas saem é
-- decisão do dono, ainda em aberto.
--
-- IDEMPOTENTE: aplicar duas vezes seguidas não falha nem duplica linha. Colunas
-- entram com IF NOT EXISTS, restrições só são criadas se ainda não existirem, e
-- cada cópia é protegida por NOT EXISTS + ON CONFLICT DO NOTHING.
--
-- Uma transação por migração (scripts/migrate.mjs): falhou, nada fica aplicado.
-- Nenhum valor monetário é lido ou tocado aqui.

-- ---------------------------------------------------------------------------
-- 1. A conexão ganha o segundo dono, o estado e a origem do identificador
-- ---------------------------------------------------------------------------
ALTER TABLE product_resource_bindings
 ADD COLUMN IF NOT EXISTS engagement_id uuid REFERENCES client_engagements(id),
 ADD COLUMN IF NOT EXISTS active boolean NOT NULL DEFAULT true,
 ADD COLUMN IF NOT EXISTS deactivated_at timestamptz,
 ADD COLUMN IF NOT EXISTS unbind_reason text,
 ADD COLUMN IF NOT EXISTS external_id_kind text NOT NULL DEFAULT 'provider_id',
 ADD COLUMN IF NOT EXISTS revision integer NOT NULL DEFAULT 1,
 ADD COLUMN IF NOT EXISTS actor_subject text,
 ADD COLUMN IF NOT EXISTS actor_email text;

-- Conexão de contratação não tem item do portfólio: sem isto, o dono do lado da
-- contratação só caberia inventando um item de mentira para satisfazer o NOT NULL.
ALTER TABLE product_resource_bindings ALTER COLUMN product_id DROP NOT NULL;

-- ---------------------------------------------------------------------------
-- 2. A trilha passa a caber os dois donos e as ações que o modelo novo tem
-- ---------------------------------------------------------------------------
-- Sem engagement_id aqui, a cópia das conexões de contratação não teria como
-- registrar de quem é a linha que acabou de nascer. actor/actor_subject/actor_email
-- convivem: `actor` é o que as 13 linhas antigas já guardam (o e-mail do operador)
-- e não é reescrito; as duas colunas novas são o formato da 026, para o código da
-- fase seguinte gravar sujeito e e-mail separados sem adivinhar um a partir do outro.
ALTER TABLE product_resource_audit
 ADD COLUMN IF NOT EXISTS engagement_id uuid REFERENCES client_engagements(id),
 ADD COLUMN IF NOT EXISTS actor_subject text,
 ADD COLUMN IF NOT EXISTS actor_email text,
 ADD COLUMN IF NOT EXISTS reason text;

-- Trilha de conexão de contratação não tem item do portfólio para citar.
ALTER TABLE product_resource_audit ALTER COLUMN product_id DROP NOT NULL;

-- ---------------------------------------------------------------------------
-- 3. Restrições novas, criadas só quando ainda não existem
-- ---------------------------------------------------------------------------
-- O laço existe para não precisar de DROP: rodar de novo encontra a restrição pelo
-- nome e não faz nada. `db/schema.sql` cria as mesmas restrições com os mesmos
-- nomes, então num banco novo este bloco também não tem o que fazer.
--
-- Por que cada uma:
--  · um_dono — o coração da regra, na forma exata de marketing_binding_um_lado_so.
--    Só a conexão ATIVA precisa de um dono, e é isso que deixa desvincular sem
--    DELETE: desligada pode guardar o dono anterior sem mentir que ele ainda vale.
--    PREÇO CONHECIDO, e é o único da migração: PUT /api/product-resource-bindings
--    com o `id` de uma conexão de contratação (as três do bloco 7) grava product_id
--    sem zerar engagement_id, a linha fica com dois donos e o banco recusa — 500 em
--    vez do 409 que o caminho irmão da mesma rota já devolve. Nenhuma tela chega
--    nesses ids (a topologia descarta linha sem product_id), então é rota de API
--    direta; a fase do código recusa com 409 antes do UPDATE, como o irmão faz.
--  · desativacao — "quando foi desligada" e "está desligada" não podem discordar.
--  · contratacao_tipo — checkout e e-mail são configuração do item que vende
--    (billing_offers, checkout_templates, email_templates têm tabela própria),
--    nunca infraestrutura entregue a uma organização. Os dois tipos continuam
--    valendo para o item: o formulário do produto os oferece hoje.
--  · external_id_kind — 'name' é o id nominal legado, gravado quando o provedor
--    não deu id no momento do vínculo. É o registro que autoriza a tela a casar
--    por nome, e só nesse caso.
--  · unbind_reason / reason — desligar sem dizer por quê não é registro, é buraco.
--  · revision — mesma trava de concorrência otimista de delivery_projects.revision.
DO $$
DECLARE alvo record;
BEGIN
 FOR alvo IN SELECT * FROM (VALUES
  ('product_resource_bindings', 'product_resource_bindings_um_dono',
   'CHECK (NOT active OR num_nonnulls(product_id, engagement_id) = 1)'),
  ('product_resource_bindings', 'product_resource_bindings_desativacao',
   'CHECK (active = (deactivated_at IS NULL))'),
  ('product_resource_bindings', 'product_resource_bindings_contratacao_tipo',
   'CHECK (engagement_id IS NULL OR resource_type NOT IN (''checkout'', ''email''))'),
  ('product_resource_bindings', 'product_resource_bindings_external_id_kind_check',
   'CHECK (external_id_kind IN (''provider_id'', ''name''))'),
  ('product_resource_bindings', 'product_resource_bindings_unbind_reason_check',
   'CHECK (unbind_reason IS NULL OR length(unbind_reason) BETWEEN 2 AND 1000)'),
  ('product_resource_bindings', 'product_resource_bindings_revision_check',
   'CHECK (revision >= 1)'),
  ('product_resource_audit', 'product_resource_audit_reason_check',
   'CHECK (reason IS NULL OR length(reason) BETWEEN 2 AND 1000)')
 ) AS t(tabela, nome, definicao) LOOP
  IF NOT EXISTS (SELECT 1 FROM pg_constraint
                  WHERE conname = alvo.nome AND conrelid = alvo.tabela::regclass) THEN
   EXECUTE format('ALTER TABLE %I ADD CONSTRAINT %I %s', alvo.tabela, alvo.nome, alvo.definicao);
  END IF;
 END LOOP;
END $$;

-- Esta é a única restrição SUBSTITUÍDA, e não acrescentada: o CHECK da 022 aceita
-- só created, updated e deleted, e o modelo novo precisa de verbos que digam o que
-- de fato aconteceu — desligar não é apagar, reatribuir não é editar. 'detached' é
-- o verbo que o botão "Desatrelar conexões" quer gravar; hoje ele grava 'deleted'
-- porque o CHECK não aceitava outra coisa e a transação inteira caía.
-- Só amplia a lista: nenhuma linha existente deixa de passar.
ALTER TABLE product_resource_audit DROP CONSTRAINT IF EXISTS product_resource_audit_action_check;
ALTER TABLE product_resource_audit ADD CONSTRAINT product_resource_audit_action_check
 CHECK (action IN ('created','updated','deleted','deactivated','reactivated','reassigned','detached','migrated'));

CREATE INDEX IF NOT EXISTS product_resource_bindings_engagement_idx
 ON product_resource_bindings(engagement_id, resource_type) WHERE active AND engagement_id IS NOT NULL;
CREATE INDEX IF NOT EXISTS product_resource_audit_engagement_idx
 ON product_resource_audit(engagement_id, created_at DESC) WHERE engagement_id IS NOT NULL;
-- A trilha já era pesquisável por item; por conexão, não. É a pergunta que a tela
-- da fase seguinte faz ("o que já aconteceu com este vínculo?").
CREATE INDEX IF NOT EXISTS product_resource_audit_binding_idx
 ON product_resource_audit(binding_id, created_at DESC);

COMMENT ON COLUMN product_resource_bindings.engagement_id IS
 'Dono quando a conexão é trabalho entregue a uma organização. Exclusivo com product_id (034).';
COMMENT ON COLUMN product_resource_bindings.active IS
 'Desvincular é UPDATE active=false, nunca DELETE: a linha desligada guarda o último dono e o motivo.';
COMMENT ON COLUMN product_resource_bindings.external_id_kind IS
 'provider_id = id estável do provedor. name = id nominal legado; só nesse caso casar por nome é legítimo.';

-- ---------------------------------------------------------------------------
-- 4. Conexões que nascem desligadas
-- ---------------------------------------------------------------------------
-- Uma linha das tabelas antigas registra um projeto que existe no provedor mas
-- cujo dono real ainda não existe no Core. Copiá-la como conexão ativa de um item
-- do portfólio seria afirmar um vínculo que ninguém decidiu. Ela entra desligada,
-- com o motivo gravado, e quem for o dono é decisão de quem operar a tela depois.
-- O motivo é deliberadamente genérico: o material da proposta é confidencial e
-- nome de cliente não entra em migração, comentário nem trilha.
--
-- E ela entra SEM product_id. A regra geral ("desligada guarda o último dono na
-- própria coluna") vale para a fase do código, que vai filtrar por `active`; hoje
-- nenhum leitor filtra. Gravar product_id='sites' aqui faria a topologia casar esta
-- linha com a entrada que a tela de Produtos já mostra e lhe dar o `binding_id` que
-- ela hoje não tem — e com o binding_id vêm os botões "Editar" e "Remover", que
-- apagam a linha nova E a linha antiga de product_deploy_bindings de onde ela veio.
-- Parqueada sem dono, a topologia a ignora (`byProduct.get(null)` não acha produto),
-- o "Desatrelar conexões" do item sites não a alcança, e o último dono fica onde não
-- corre risco: no before_value da trilha 'migrated' do bloco 6.
--
-- Tabela temporária, e não a lista repetida em três lugares, para as travas dos
-- blocos 5 e 6 e a cópia do bloco 6 nunca divergirem. ON COMMIT DROP porque a
-- migração roda dentro de uma transação (scripts/migrate.mjs).
--
-- É a única migração do repositório que usa CREATE TEMP TABLE, e isso só funciona
-- porque a role que aplica as migrações é dona do banco (`REVOKE ALL ON DATABASE
-- ... FROM PUBLIC`, em scripts/setup.mjs, tirou TEMPORARY de PUBLIC). Se a decisão
-- de permissões ainda em aberto criar uma role de migração que não seja dona, dê
-- TEMPORARY a ela — senão esta migração falha por um motivo que não tem nada a ver
-- com o que ela faz.
-- `dono_declarado` é o item que a tabela antiga dizia ser o dono quando a decisão
-- foi tomada (leitura de produção em 2026-09-24). Não é para ser copiado para lugar
-- nenhum: serve só para a trava abaixo perceber se alguém reclassificou a conexão
-- pela tela antiga depois da decisão — aí a decisão precisa ser tomada de novo.
CREATE TEMP TABLE conexoes_que_nascem_desligadas (
 provider text NOT NULL,
 external_project_id text NOT NULL,
 dono_declarado text NOT NULL,
 motivo text NOT NULL,
 PRIMARY KEY (provider, external_project_id)
) ON COMMIT DROP;
INSERT INTO conexoes_que_nascem_desligadas VALUES
 ('vercel', 'prj_uxe3ctzAKcIM1avrqWRSRJW6VOyx', 'sites', 'proposta comercial; aguarda a contratação do cliente');

-- ---------------------------------------------------------------------------
-- 5. Travas: o que a migração se recusa a adivinhar
-- ---------------------------------------------------------------------------
-- Copiar em silêncio escolheria um dono por acaso. Se as três tabelas discordarem,
-- nada é aplicado e a mensagem diz qual projeto resolver pela tela antes.
-- Conferido em produção (leitura, dentro de READ ONLY) em 2026-09-24: 0 conflitos.
-- Conexão já desligada fica fora: desligar é decisão registrada, não divergência —
-- é também o que faz esta trava continuar passando na segunda aplicação.
--
-- Esta trava NÃO isenta checkout e e-mail, e a do bloco 9 isenta: é de propósito,
-- porque as duas perguntam coisas diferentes. O bloco 9 pergunta se sobraram dois
-- vínculos ativos do mesmo recurso, e ali uma mesma conta Stripe sob dois itens é
-- legítima. Aqui a pergunta é se a cópia do bloco 6 vai pular uma linha da tabela
-- antiga — e o NOT EXISTS dela casa por (provider, external_id) sem olhar tipo.
-- Isentar checkout aqui trocaria um aborto com mensagem por um sumiço silencioso:
-- bastaria alguém ter classificado um projeto de deploy como 'checkout' (a rota
-- valida tipo e provedor separadamente, então 'checkout' com 'vercel' passa) para
-- a conexão de deploy não ser copiada e ninguém ficar sabendo.
DO $$
DECLARE conflitos text;
BEGIN
 SELECT string_agg(DISTINCT x.provider || ':' || x.nome, ', ') INTO conflitos FROM (
  SELECT d.provider, d.external_project_name AS nome
    FROM product_deploy_bindings d
    JOIN product_resource_bindings r
      ON r.provider = d.provider AND r.external_id = d.external_project_id
   WHERE r.active AND r.product_id IS DISTINCT FROM d.product_id
  UNION ALL
  -- Compara o dono, e não a mera existência da linha: depois da primeira aplicação
  -- toda linha de service_deploy_bindings tem par aqui, e par não é conflito.
  SELECT s.provider, s.external_project_name
    FROM service_deploy_bindings s
    JOIN product_resource_bindings r
      ON r.provider = s.provider AND r.external_id = s.external_project_id
   WHERE r.active AND r.engagement_id IS DISTINCT FROM s.engagement_id
  UNION ALL
  -- As duas tabelas antigas reivindicando o mesmo projeto: uma diz item, a outra
  -- diz contratação, e não há critério honesto para desempatar dentro do SQL.
  SELECT s.provider, s.external_project_name
    FROM service_deploy_bindings s
    JOIN product_deploy_bindings d
      ON d.provider = s.provider AND d.external_project_id = s.external_project_id
 ) x;
 IF conflitos IS NOT NULL THEN
  RAISE EXCEPTION 'Conexão com dois donos. Resolva pela tela antes de migrar: %', conflitos;
 END IF;
END $$;

-- Se uma conexão da lista do bloco 4 já tiver sido confirmada como vínculo ativo
-- pela tela depois da decisão, a cópia abaixo a pularia em silêncio e ela ficaria
-- ativa contra a decisão registrada. Melhor abortar e pedir uma nova decisão.
DO $$
DECLARE confirmadas text;
BEGIN
 SELECT string_agg(r.provider || ':' || r.display_name, ', ') INTO confirmadas
   FROM product_resource_bindings r
   JOIN conexoes_que_nascem_desligadas x
     ON x.provider = r.provider AND x.external_project_id = r.external_id
  WHERE r.active;
 IF confirmadas IS NOT NULL THEN
  RAISE EXCEPTION 'Conexão marcada para nascer desligada já está confirmada como ativa: %. Reveja a decisão antes de migrar.', confirmadas;
 END IF;
END $$;

-- O outro jeito de a decisão ficar velha: alguém usou "Vincular a produto…" (a tela
-- antiga, que grava só em product_deploy_bindings) e trocou o dono declarado depois
-- da decisão. A cópia abaixo descarta o dono declarado dessa linha, então a troca
-- passaria em silêncio — e trocar de dono é decisão de gente, não ruído.
DO $$
DECLARE trocadas text;
BEGIN
 SELECT string_agg(d.provider || ':' || d.external_project_name, ', ') INTO trocadas
   FROM conexoes_que_nascem_desligadas x
   JOIN product_deploy_bindings d
     ON d.provider = x.provider AND d.external_project_id = x.external_project_id
  WHERE d.product_id IS DISTINCT FROM x.dono_declarado;
 IF trocadas IS NOT NULL THEN
  RAISE EXCEPTION 'Conexão marcada para nascer desligada mudou de dono na tabela antiga desde a decisão: %. Reveja a decisão antes de migrar.', trocadas;
 END IF;
END $$;

-- ---------------------------------------------------------------------------
-- 6. Cópia: deploys de item do portfólio que só existem na tabela antiga
-- ---------------------------------------------------------------------------
-- A tela antiga ("Vincular a produto…") grava só em product_deploy_bindings, e a
-- rota nova grava nas duas. Por isso sobram aqui as linhas gravadas pela tela antiga
-- antes de a rota nova existir. Em produção é 1 linha, e é justamente a do bloco 4.
--
-- A migração NÃO INVENTA DONO: a linha vem com o dono que a tabela antiga já diz,
-- e a da lista do bloco 4 vem sem dono nenhum, porque lá o dono declarado é o que
-- a decisão do dono recusou. Atribuir a uma contratação é decisão de gente, feita
-- depois pela tela e gravada como 'reassigned'.
--
-- NOT EXISTS por (provider, external_id) e não por (resource_type, provider,
-- external_id): o que não pode duplicar é o RECURSO, mesmo que alguém o tenha
-- classificado com outro tipo. O ON CONFLICT repete a UNIQUE que a 022 criou, para
-- o caso de o tipo bater exatamente — protege sem inventar uma chave nova.
WITH novos AS (
 INSERT INTO product_resource_bindings
  (product_id, resource_type, provider, external_id, external_id_kind, display_name,
   environment, active, deactivated_at, unbind_reason, created_at, updated_at)
 -- Dono só para quem nasce ativa; a da lista fica parqueada sem dono (ver bloco 4).
 SELECT CASE WHEN x.motivo IS NULL THEN d.product_id ELSE NULL END,
        CASE WHEN d.provider = 'vercel' THEN 'frontend' ELSE 'backend' END,
        d.provider, d.external_project_id,
        -- Id igual ao nome significa que o provedor não deu id: é o id nominal.
        CASE WHEN d.external_project_id = d.external_project_name THEN 'name' ELSE 'provider_id' END,
        d.external_project_name, d.environment,
        x.motivo IS NULL,
        CASE WHEN x.motivo IS NULL THEN NULL ELSE now() END,
        x.motivo,
        d.created_at, d.updated_at
   FROM product_deploy_bindings d
   LEFT JOIN conexoes_que_nascem_desligadas x
     ON x.provider = d.provider AND x.external_project_id = d.external_project_id
  WHERE NOT EXISTS (SELECT 1 FROM product_resource_bindings r
                     WHERE r.provider = d.provider AND r.external_id = d.external_project_id)
 ON CONFLICT (resource_type, provider, external_id) DO NOTHING
 RETURNING *
)
INSERT INTO product_resource_audit(binding_id, product_id, action, actor, reason, before_value, after_value)
-- O ator é a migração, não uma pessoa: ninguém decidiu isto hoje, a decisão já estava
-- na tabela antiga. actor_subject e actor_email ficam nulos porque não há pessoa.
--
-- O `reason` diz sempre de onde a linha veio, porque é isso que a ação 'migrated'
-- significa; o motivo do desligamento entra depois, concatenado, em vez de substituir
-- a origem — senão justamente a linha que mais precisa de explicação seria a única
-- cuja trilha não diz de que tabela ela saiu.
--
-- O before_value é o único lugar onde o dono que a tabela antiga declarava fica
-- guardado para a linha parqueada: é o join com product_deploy_bindings que o traz.
SELECT n.id, n.product_id, 'migrated', 'migration:034',
       'cópia de product_deploy_bindings para o modelo de dono único'
         || COALESCE('; nasce desligada: ' || n.unbind_reason, ''),
       jsonb_build_object('tabela', 'product_deploy_bindings',
                          'provider', n.provider,
                          'external_project_id', n.external_id,
                          'product_id_na_tabela_antiga', d.product_id,
                          'observacao', 'a rota antiga grava sem trilha: o autor original é desconhecido'),
       to_jsonb(n)
  FROM novos n
  JOIN product_deploy_bindings d
    ON d.provider = n.provider AND d.external_project_id = n.external_id;

-- Se a linha da lista sumiu da tabela antiga entre a decisão e a migração (a rota
-- "Desatrelar conexões" apaga product_deploy_bindings por item), a cópia acima não
-- teria o que copiar e a decisão do dono evaporaria sem deixar rastro. Aqui ela
-- deixa: ou a conexão existe desligada na tabela nova, ou a migração não passa.
--
-- A trava só vale onde havia o que copiar. Banco novo — `db/schema.sql` mais as
-- migrações, que é como nascem os bancos de teste e qualquer ambiente novo — tem
-- product_deploy_bindings vazia: lá a lista não descreve nada que possa ter sumido,
-- e exigir a linha transformaria a decisão de um banco em regra de todos. O limite
-- conhecido: se um dia TODAS as linhas da tabela antiga forem apagadas, a trava
-- silencia junto — é o preço de não ter marca de "este banco é aquele banco".
DO $$
DECLARE sumidas text;
BEGIN
 IF NOT EXISTS (SELECT 1 FROM product_deploy_bindings) THEN RETURN; END IF;
 SELECT string_agg(x.provider || ':' || x.external_project_id, ', ') INTO sumidas
   FROM conexoes_que_nascem_desligadas x
  WHERE NOT EXISTS (SELECT 1 FROM product_resource_bindings r
                     WHERE r.provider = x.provider AND r.external_id = x.external_project_id
                       AND NOT r.active);
 IF sumidas IS NOT NULL THEN
  RAISE EXCEPTION 'Conexão marcada para nascer desligada não existe mais: %. Reveja a decisão antes de migrar.', sumidas;
 END IF;
END $$;

-- ---------------------------------------------------------------------------
-- 7. Cópia: deploys de contratação
-- ---------------------------------------------------------------------------
-- São os vínculos que hoje só existem em service_deploy_bindings. Eles entram com
-- engagement_id e product_id nulo — é exatamente o caso que só passou a caber na
-- tabela depois do bloco 1.
--
-- Contratação encerrada continua dona: posse não é estado de operação, e a ficha da
-- organização já esconde só as contratações arquivadas.
--
-- MUDANÇA DE RESPOSTA NA JANELA, e é a única visível pela tela. Confirmar um destes
-- três projetos pela tela de Produtos (o botão "Confirmar" de um projeto detectado
-- na Vercel) passa de 200 para 409: a rota compara o dono anterior com o que está
-- sendo pedido, e o dono anterior agora é uma contratação, com product_id nulo.
-- O bloqueio é o que o modelo novo quer — antes, esse clique roubava em silêncio um
-- projeto de uma contratação e criava o dono duplo que esta migração existe para
-- acabar. O que está errado é só a frase, que fala em "outro produto" e manda editar
-- ou remover o vínculo: editar cai no 500 do bloco 3 e remover apaga a conexão da
-- contratação. A fase do código troca o texto por "pertence a uma contratação; use
-- Reatribuir". Até lá, o jeito certo de mexer nesses três é pelo banco, não pela tela.
--
-- A tabela antiga não tem created_at. Usar updated_at é a melhor aproximação honesta,
-- e a trilha registra que é aproximação em vez de fingir uma data exata.
WITH novos AS (
 INSERT INTO product_resource_bindings
  (engagement_id, resource_type, provider, external_id, external_id_kind, display_name,
   environment, created_at, updated_at)
 SELECT s.engagement_id,
        CASE WHEN s.provider = 'vercel' THEN 'frontend' ELSE 'backend' END,
        s.provider, s.external_project_id,
        -- O vínculo 'designer' nasceu da semente da 020 com id igual ao nome, porque
        -- na época não se tinha o id da Vercel. É o único id nominal do banco hoje.
        CASE WHEN s.external_project_id = s.external_project_name THEN 'name' ELSE 'provider_id' END,
        s.external_project_name, s.environment, s.updated_at, s.updated_at
   FROM service_deploy_bindings s
  WHERE NOT EXISTS (SELECT 1 FROM product_resource_bindings r
                     WHERE r.provider = s.provider AND r.external_id = s.external_project_id)
 ON CONFLICT (resource_type, provider, external_id) DO NOTHING
 RETURNING *
)
INSERT INTO product_resource_audit(binding_id, engagement_id, action, actor, reason, before_value, after_value)
SELECT n.id, n.engagement_id, 'migrated', 'migration:034',
       'cópia de service_deploy_bindings para o modelo de dono único',
       jsonb_build_object('tabela', 'service_deploy_bindings',
                          'provider', n.provider,
                          'external_project_id', n.external_id,
                          'observacao', 'a tabela antiga não guarda data de criação nem autor; created_at veio de updated_at'),
       to_jsonb(n)
  FROM novos n;

-- ---------------------------------------------------------------------------
-- 8. Ambiente das conexões de deploy espelhadas
--    (BLOCO ISOLADO — remova-o inteiro para manter o ambiente nulo)
-- ---------------------------------------------------------------------------
-- As conexões de deploy que a rota nova espelhou ficaram com environment nulo aqui e
-- 'production' na tabela antiga. A diferença não é uma escolha do operador: o espelho
-- grava `row.environment || 'production'` na tabela antiga, isto é, o 'production' veio
-- de um padrão do código. Este bloco adota o que a tabela antiga já diz, para as duas
-- não continuarem discordando sobre o mesmo deploy — e é o que faz o item "Deploy de
-- produção" do checklist de ativação (que exige environment='production') poder ficar
-- pronto algum dia.
--
-- Está isolado de propósito: se o dono preferir que o ambiente continue nulo até
-- alguém confirmar um a um, basta apagar este bloco; o resto da migração não depende
-- dele. Cada linha alterada sobe de revisão e deixa trilha 'updated' com o antes e o
-- depois, para a mudança ser reversível olhando o registro.
WITH alvo AS (
 SELECT r.id, to_jsonb(r) AS antes, d.environment AS ambiente
   FROM product_resource_bindings r
   JOIN product_deploy_bindings d
     ON d.provider = r.provider AND d.external_project_id = r.external_id AND d.product_id = r.product_id
  WHERE r.environment IS NULL AND r.active AND r.resource_type IN ('frontend', 'backend')
), aplicado AS (
 UPDATE product_resource_bindings r
    SET environment = a.ambiente, revision = r.revision + 1, updated_at = now()
   FROM alvo a
  WHERE r.id = a.id
 RETURNING r.*
)
INSERT INTO product_resource_audit(binding_id, product_id, action, actor, reason, before_value, after_value)
SELECT aplicado.id, aplicado.product_id, 'updated', 'migration:034',
       'ambiente adotado de product_deploy_bindings: as duas tabelas discordavam sobre o mesmo deploy',
       alvo.antes, to_jsonb(aplicado)
  FROM aplicado JOIN alvo ON alvo.id = aplicado.id;

-- ---------------------------------------------------------------------------
-- 9. Trava final: nenhum recurso externo com dois vínculos ativos
-- ---------------------------------------------------------------------------
-- Depois das cópias, e não antes: se alguma coisa escapou das travas do bloco 5, é
-- aqui que a migração inteira volta atrás. Checkout e e-mail ficam fora porque uma
-- mesma conta Stripe ou Asaas serve legitimamente mais de um item do portfólio.
--
-- É trava de migração, e não índice único: um índice apertaria a regra para o código
-- que está em produção agora, que ainda não sabe desligar um vínculo, e transformaria
-- uma reclassificação pela tela em erro de banco. O índice entra junto com o deploy
-- que ensina o código a conviver com ele.
DO $$
DECLARE repetidos text;
BEGIN
 SELECT string_agg(x.chave, ', ') INTO repetidos FROM (
  SELECT provider || ':' || external_id AS chave
    FROM product_resource_bindings
   WHERE active AND resource_type NOT IN ('checkout', 'email')
   GROUP BY provider, external_id HAVING count(*) > 1
 ) x;
 IF repetidos IS NOT NULL THEN
  RAISE EXCEPTION 'Recurso externo com mais de um vínculo ativo: %. A migração não escolhe dono.', repetidos;
 END IF;
END $$;

-- ---------------------------------------------------------------------------
-- 10. As tabelas antigas, marcadas no próprio banco
-- ---------------------------------------------------------------------------
-- Só documentação: a estrutura e os dados das duas continuam exatamente como estavam,
-- porque o código em produção ainda grava nelas. O comentário existe para quem abrir
-- o banco não ter de descobrir sozinho qual das três tabelas responde pelo dono.
COMMENT ON TABLE product_deploy_bindings IS
 'Espelho legado do vínculo item x deploy. Fonte de verdade desde a 034: product_resource_bindings.';
COMMENT ON TABLE service_deploy_bindings IS
 'Espelho legado do vínculo contratação x deploy. Fonte de verdade desde a 034: product_resource_bindings.engagement_id.';
