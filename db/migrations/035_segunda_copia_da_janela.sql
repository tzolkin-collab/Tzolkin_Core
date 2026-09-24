-- 035 — Segunda cópia: o que a janela deixou nas tabelas antigas.
--
-- A 034 elegeu product_resource_bindings como a única resposta para "de quem é este
-- projeto?" e recolheu para lá o que existia nas duas tabelas antigas. Só que a tela
-- que está no ar continua gravando apenas nelas: "Vincular a produto…" grava em
-- product_deploy_bindings e "Vincular a serviço…" em service_deploy_bindings. Entre a
-- 034 e o deploy do código da fase seguinte existe uma JANELA em que todo vínculo novo
-- nasce só na tabela antiga e não aparece no registro novo.
--
-- Esta migração é a SEGUNDA CÓPIA, e nada além disso: roda imediatamente antes desse
-- deploy e recolhe o que apareceu na janela. Ela não redecide nada: a decisão de dono
-- tomada na 034 já está gravada no banco — na linha desligada e na trilha 'migrated'
-- dela — e é de lá que esta migração a lê, em vez de repetir a lista.
--
-- NÃO RELIGA E NÃO REATRIBUI: não há um único UPDATE aqui. O que já está no modelo
-- novo, ativo ou desligado, fica exatamente como está — é o NOT EXISTS por (provider,
-- external_id) que garante isso, e ele casa o RECURSO, não o par tipo+recurso, pelo
-- mesmo motivo da 034. Se a tabela antiga discordar do dono que o modelo novo já
-- registra, a migração ABORTA inteira sem gravar nada: escolher dono é decisão de
-- gente, e adivinhar aqui seria escolher por acaso.
--
-- IDEMPOTENTE: rodar duas vezes seguidas não falha nem duplica. Num banco onde nada
-- mudou desde a 034 ela não grava nada — nem linha, nem trilha.
--
-- ANTES DO DEPLOY, E NÃO DEPOIS. Ela compara as tabelas antigas com o registro novo
-- supondo que, na janela, só a tela antiga escreveu. Depois do deploy essa suposição
-- cai: o código novo desliga e reatribui sem tocar nas antigas, e o que sobrar lá vira
-- espelho velho, não vínculo a recolher. A segunda trava do bloco 2 percebe o caso mais
-- claro disso e diz com todas as letras que a migração está fora de hora, em vez de
-- acusar um conflito de donos que não existe.
--
-- MUDANÇA DE RESPOSTA NA JANELA, uma só, nomeada aqui como a 034 nomeou as duas dela:
-- excluir um projeto de entrega em DRAFT cujo produto ganhou vínculo pela tela antiga
-- passa de 200 para 409. A linha copiada abaixo — e a trilha dela — referenciam o
-- produto, e apps/api/src/modules/delivery.mjs apaga só product_deploy_bindings antes
-- do DELETE FROM products: a chave estrangeira recusa e o 23503 sai como 409 "Empresa
-- ou produto não encontrado.". Medido pelas rotas: sem esta migração o mesmo caminho
-- devolve 200 e apaga o produto. Até a fase do código, apague o vínculo pela tela de
-- Produtos antes de excluir o draft.
--
-- LIMITES CONHECIDOS, os dois do mesmo tipo: ela recolhe o que FALTA, não reconcilia o
-- que já está aqui.
--  1. Regravar pela tela antiga o MESMO dono de uma conexão que já está no modelo novo
--     é indistinguível de ruído; só a troca de dono aparece. É o limite da 034 também.
--  2. Trocar ambiente ou nome pela tela antiga, na janela, sobre uma linha que já está
--     no modelo novo não é recolhido: as cópias a pulam (NOT EXISTS) e não há UPDATE.
--     As duas tabelas voltam a discordar sobre o mesmo deploy — o desencontro que o
--     bloco de ambiente da 034 existiu para acabar — e o registro novo fica com o valor
--     velho bem na hora em que vira o único leitor, inclusive para o item "Deploy de
--     produção" do checklist de ativação, que lê environment='production'
--     (apps/api/src/modules/delivery.mjs). Recolher isso seria UPDATE, e UPDATE aqui é
--     decisão do dono, não da migração.
--
-- É por isso, e só por isso, que ela não repete o bloco de ambiente da 034: aquele
-- bloco consertou o desencontro do espelho da rota NOVA (environment nulo aqui e
-- 'production' lá), e vínculo criado pela tela antiga já nasce com ambiente preenchido
-- — é esse ambiente que as cópias abaixo trazem. O que fica de fora é o limite 2 acima,
-- e mais nada.
--
-- Uma transação por migração (scripts/migrate.mjs): falhou, nada fica aplicado.
-- Nenhum valor monetário é lido ou tocado. NENHUMA ESTRUTURA MUDA: colunas, restrições
-- e índices de que esta migração precisa já vieram na 034 e já estão em db/schema.sql,
-- que descreve um banco novo — e num banco novo não existe janela para recolher.

-- ---------------------------------------------------------------------------
-- 1. A tela antiga para de gravar enquanto esta migração roda
-- ---------------------------------------------------------------------------
-- A premissa desta migração é que a tela antiga continua no ar: é por isso que ela
-- existe. Sem esta trava, a trava de dono do bloco 2 julga um snapshot e as cópias dos
-- blocos 3 e 4 rodam sobre outro — em READ COMMITTED cada comando abre um snapshot
-- novo, inclusive os comandos do mesmo arquivo, o que foi conferido em banco
-- descartável. Um clique que caia nesse intervalo é copiado sem nunca ter passado pela
-- trava, e o ramo (c) — as duas tabelas antigas reivindicando o mesmo recurso — deixa
-- de valer: o empate passa a ser decidido pela ordem em que as cópias rodam, que é
-- exatamente o que aquele ramo existe para impedir. A trava final não pega, porque
-- sobra um só vínculo ativo.
--
-- SHARE bloqueia quem escreve e deixa quem lê em paz. Durante a migração, que é curta,
-- um clique em "Vincular a produto…" ou "Vincular a serviço…" espera o COMMIT — ou
-- devolve erro, se houver lock_timeout configurado — e grava normalmente depois. É o
-- comportamento certo para o momento do corte.
--
-- Só as duas antigas, e como PRIMEIRA instrução: travar também product_resource_bindings
-- faria a migração segurar uma tabela enquanto espera pela outra, e o "Desatrelar
-- conexões" apaga a antiga primeiro e a nova depois — o ciclo fecha e o banco mata uma
-- das duas transações (conferido: deadlock 40P01). Sendo a primeira instrução, a
-- migração não segura nada enquanto espera. E as rotas que gravam a tabela nova para um
-- deploy gravam a antiga na mesma transação, então elas também param aqui.
LOCK TABLE product_deploy_bindings, service_deploy_bindings IN SHARE MODE;

-- ---------------------------------------------------------------------------
-- 2. Travas: o que a migração se recusa a adivinhar
-- ---------------------------------------------------------------------------
-- Duas travas, e as duas antes de copiar: havendo desacordo, nada é gravado e a
-- mensagem nomeia o projeto a resolver. A primeira pergunta se a tabela antiga discorda
-- do dono que o registro novo já tem; a segunda, logo abaixo, pergunta outra coisa e
-- tem mensagem própria, para não chamar de conflito o que não é.
--
-- A primeira compara o DONO, e não a existência do par: depois da 034 toda linha das
-- tabelas antigas tem par no modelo novo, e par não é conflito.
--
-- São cinco ramos porque a janela tem cinco jeitos de produzir dois donos. Cada
-- ramo diz qual, e a chave sai marcada com a letra dele, porque só o ramo (a) entre
-- dois itens tem tela que resolva: "Produtos → Editar" grava nas duas tabelas. Os
-- outros só se resolvem no banco — não existe rota que apague vínculo de
-- product_deploy_bindings ou de service_deploy_bindings, e o select "Vincular a…" só
-- aparece para projeto que ainda não tem linha em nenhuma das duas (conferido em
-- apps/api/src/modules/*-deploy-bindings.mjs e em apps/web/public/app.js).
--
-- O que NÃO está aqui, de propósito: linha que sumiu da tabela antiga na janela (o
-- "Desatrelar conexões" apaga product_deploy_bindings por item). Sumiço não é
-- divergência — a resposta já está no modelo novo, que é a fonte de verdade.
DO $$
DECLARE conflitos text;
BEGIN
 SELECT string_agg(DISTINCT x.chave, ', ') INTO conflitos FROM (
  -- a) A tela antiga reclassificou um item, ou o recurso passou a ser de uma
  --    contratação (r.product_id nulo) e a tela antiga continua reivindicando item.
  SELECT d.provider || ':' || d.external_project_name || ' (a)' AS chave
    FROM product_deploy_bindings d
    JOIN product_resource_bindings r
      ON r.provider = d.provider AND r.external_id = d.external_project_id
   WHERE r.active AND r.product_id IS DISTINCT FROM d.product_id
  UNION ALL
  -- b) O mesmo do outro lado do dono: a contratação registrada discorda da antiga.
  SELECT s.provider || ':' || s.external_project_name || ' (b)'
    FROM service_deploy_bindings s
    JOIN product_resource_bindings r
      ON r.provider = s.provider AND r.external_id = s.external_project_id
   WHERE r.active AND r.engagement_id IS DISTINCT FROM s.engagement_id
  UNION ALL
  -- c) As duas tabelas antigas reivindicando o mesmo recurso: uma diz item, a outra
  --    diz contratação, e não há critério honesto para desempatar dentro do SQL.
  --    Sem esta trava as duas cópias abaixo desempatariam pela ordem em que rodam.
  SELECT s.provider || ':' || s.external_project_name || ' (c)'
    FROM service_deploy_bindings s
    JOIN product_deploy_bindings d
      ON d.provider = s.provider AND d.external_project_id = s.external_project_id
  UNION ALL
  -- d) A conexão DESLIGADA que a 034 deixou parqueada de propósito. A cópia abaixo a
  --    pula (o NOT EXISTS casa linha desligada também), então uma troca de dono pela
  --    tela antiga passaria em silêncio e a decisão registrada ficaria velha sem
  --    ninguém saber. O que a tabela antiga dizia quando a decisão foi tomada está
  --    guardado no before_value da trilha 'migrated' — comparar com ele é ler a
  --    decisão onde ela está, em vez de repetir a lista da 034 aqui.
  --    Só compara quando esse registro existe. Sem ele não há divergência a apurar, e
  --    sim outra pergunta, que a trava seguinte faz com a mensagem dela.
  --    Limite conhecido, o mesmo da 034: regravar o MESMO dono pela tela antiga é
  --    indistinguível de ruído; só a troca de dono aparece.
  SELECT d.provider || ':' || d.external_project_name || ' (d)'
    FROM product_deploy_bindings d
    JOIN product_resource_bindings r
      ON r.provider = d.provider AND r.external_id = d.external_project_id
   WHERE NOT r.active
     AND EXISTS (
      SELECT 1 FROM product_resource_audit a
       WHERE a.binding_id = r.id AND a.action = 'migrated'
         AND a.before_value->>'tabela' = 'product_deploy_bindings')
     AND d.product_id IS DISTINCT FROM (
      SELECT a.before_value->>'product_id_na_tabela_antiga'
        FROM product_resource_audit a
       WHERE a.binding_id = r.id AND a.action = 'migrated'
         AND a.before_value->>'tabela' = 'product_deploy_bindings'
       ORDER BY a.created_at DESC LIMIT 1)
  UNION ALL
  -- e) A mesma conexão desligada, agora reivindicada por uma contratação. Aqui não há
  --    o que comparar: a 034 copiou TODA linha de service_deploy_bindings como vínculo
  --    ativo, então uma contratação apontando para conexão desligada só pode ter
  --    nascido na janela — é reatribuição, e reatribuir é decisão de gente.
  SELECT s.provider || ':' || s.external_project_name || ' (e)'
    FROM service_deploy_bindings s
    JOIN product_resource_bindings r
      ON r.provider = s.provider AND r.external_id = s.external_project_id
   WHERE NOT r.active
 ) x;
 IF conflitos IS NOT NULL THEN
  RAISE EXCEPTION 'Dono divergente entre a tabela antiga e o registro novo; nada foi gravado: %. Resolva antes de migrar: o ramo (a) entre dois itens se resolve pela tela (Produtos → Editar grava nas duas tabelas); (b), (c), (d) e (e) só pelo banco, porque nenhuma tela desfaz vínculo já gravado nas tabelas antigas.', conflitos;
 END IF;
END $$;

-- A outra pergunta: existe conexão DESLIGADA cujo par sobreviveu na tabela antiga, mas
-- sem registro do que aquela tabela dizia quando a decisão foi tomada?
--
-- Antes do deploy isso não acontece: a única desligada é a que a 034 parqueou, e a
-- trilha 'migrated' dela guarda o dono declarado. Acontece DEPOIS do deploy, porque é
-- assim que o "Desvincular" da fase seguinte grava — active=false e trilha
-- 'deactivated', sem tocar na tabela antiga. Então esta trava não fala de dois donos:
-- ela diz que a migração está rodando fora de hora, que é o que de fato aconteceu.
DO $$
DECLARE sem_registro text;
BEGIN
 SELECT string_agg(DISTINCT d.provider || ':' || d.external_project_name, ', ') INTO sem_registro
   FROM product_deploy_bindings d
   JOIN product_resource_bindings r
     ON r.provider = d.provider AND r.external_id = d.external_project_id
  WHERE NOT r.active
    AND NOT EXISTS (
     SELECT 1 FROM product_resource_audit a
      WHERE a.binding_id = r.id AND a.action = 'migrated'
        AND a.before_value->>'tabela' = 'product_deploy_bindings');
 IF sem_registro IS NOT NULL THEN
  RAISE EXCEPTION 'Conexão desligada sem registro do que a tabela antiga dizia quando ela foi desligada: %. Isto é sinal de que o código da fase seguinte já está no ar e esta segunda cópia está rodando depois do deploy, quando o que sobra na tabela antiga é espelho velho e não vínculo a recolher. Nada foi gravado.', sem_registro;
 END IF;
END $$;

-- ---------------------------------------------------------------------------
-- 3. Cópia: vínculos de item que a tela antiga criou na janela
-- ---------------------------------------------------------------------------
-- Tudo o que sobra aqui nasceu de alguém clicando "Vincular a produto…" depois da 034,
-- com um dono declarado no ato. Por isso, e ao contrário da 034, nada nasce desligado:
-- a lista de conexões parqueadas era a decisão de UM caso concreto do banco de
-- produção, já gravada, e transformá-la em regra permanente faria a 035 recusar donos
-- que uma pessoa acabou de escolher.
--
-- created_at/updated_at vêm da tabela antiga: a data que importa é a do clique, não a
-- da migração. O ON CONFLICT repete a UNIQUE que a 022 criou, para o caso de o tipo
-- bater exatamente; protege sem inventar chave nova.
WITH novos AS (
 INSERT INTO product_resource_bindings
  (product_id, resource_type, provider, external_id, external_id_kind, display_name,
   environment, created_at, updated_at)
 SELECT d.product_id,
        CASE WHEN d.provider = 'vercel' THEN 'frontend' ELSE 'backend' END,
        d.provider, d.external_project_id,
        -- Id igual ao nome significa que o provedor não deu id: é o id nominal.
        CASE WHEN d.external_project_id = d.external_project_name THEN 'name' ELSE 'provider_id' END,
        d.external_project_name, d.environment,
        d.created_at, d.updated_at
   FROM product_deploy_bindings d
  WHERE NOT EXISTS (SELECT 1 FROM product_resource_bindings r
                     WHERE r.provider = d.provider AND r.external_id = d.external_project_id)
 ON CONFLICT (resource_type, provider, external_id) DO NOTHING
 RETURNING *
)
INSERT INTO product_resource_audit(binding_id, product_id, action, actor, reason, before_value, after_value)
-- O ator é a migração, não uma pessoa: ninguém decidiu isto agora, a decisão já estava
-- na tabela antiga. actor_subject e actor_email ficam nulos porque não há pessoa.
-- product_id_na_tabela_antiga repete n.product_id porque a cópia traz o dono tal e
-- qual; a chave fica no mesmo formato da 034 para quem lê a trilha não precisar saber
-- qual das duas migrações escreveu a linha.
SELECT n.id, n.product_id, 'migrated', 'migration:035',
       'cópia de product_deploy_bindings: vínculo de item criado pela tela antiga depois da 034',
       jsonb_build_object('tabela', 'product_deploy_bindings',
                          'provider', n.provider,
                          'external_project_id', n.external_id,
                          'product_id_na_tabela_antiga', n.product_id,
                          'observacao', 'a rota antiga grava sem trilha: o autor original é desconhecido'),
       to_jsonb(n)
  FROM novos n;

-- ---------------------------------------------------------------------------
-- 4. Cópia: vínculos de contratação que a tela antiga criou na janela
-- ---------------------------------------------------------------------------
-- Entram com engagement_id e product_id nulo, que é o caso que só passou a caber na
-- tabela depois da 034. A tabela antiga não tem created_at: usar updated_at é a melhor
-- aproximação honesta, e a trilha registra que é aproximação em vez de fingir data.
--
-- PREÇO HERDADO, e uma vez por linha copiada: é o mesmo do bloco 7 da 034. Em cada
-- projeto que entrar aqui, o "Confirmar" da tela de Produtos passa a devolver 409 com a
-- frase errada ("já está confirmado em outro produto… remova ou edite"), e a rota de
-- API por id cai no 500 do CHECK um_dono. Medido pelas rotas. Até a fase do código
-- trocar o texto e recusar antes do UPDATE, mexer nesses vínculos é pelo banco.
WITH novos AS (
 INSERT INTO product_resource_bindings
  (engagement_id, resource_type, provider, external_id, external_id_kind, display_name,
   environment, created_at, updated_at)
 SELECT s.engagement_id,
        CASE WHEN s.provider = 'vercel' THEN 'frontend' ELSE 'backend' END,
        s.provider, s.external_project_id,
        CASE WHEN s.external_project_id = s.external_project_name THEN 'name' ELSE 'provider_id' END,
        s.external_project_name, s.environment, s.updated_at, s.updated_at
   FROM service_deploy_bindings s
  WHERE NOT EXISTS (SELECT 1 FROM product_resource_bindings r
                     WHERE r.provider = s.provider AND r.external_id = s.external_project_id)
 ON CONFLICT (resource_type, provider, external_id) DO NOTHING
 RETURNING *
)
INSERT INTO product_resource_audit(binding_id, engagement_id, action, actor, reason, before_value, after_value)
SELECT n.id, n.engagement_id, 'migrated', 'migration:035',
       'cópia de service_deploy_bindings: vínculo de contratação criado pela tela antiga depois da 034',
       jsonb_build_object('tabela', 'service_deploy_bindings',
                          'provider', n.provider,
                          'external_project_id', n.external_id,
                          'observacao', 'a tabela antiga não guarda data de criação nem autor; created_at veio de updated_at'),
       to_jsonb(n)
  FROM novos n;

-- ---------------------------------------------------------------------------
-- 5. Trava final: nenhum recurso externo com dois vínculos ativos
-- ---------------------------------------------------------------------------
-- Depois das cópias, e não antes: se alguma coisa escapou das travas do bloco 2, é aqui
-- que a migração inteira volta atrás. Checkout e e-mail ficam fora porque uma mesma
-- conta Stripe ou Asaas serve legitimamente mais de um item do portfólio — a mesma
-- isenção, e pelo mesmo motivo, do bloco 9 da 034.
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
