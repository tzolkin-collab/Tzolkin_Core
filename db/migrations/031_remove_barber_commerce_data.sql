-- Barber, Commerce e Data saem do portfólio.
--
-- REMOÇÃO, NÃO ARQUIVAMENTO. Decisão do dono em 2026-09-14: as três frentes
-- deixam de existir no Core, com a ficha do Notion e a contratação planejada do
-- Bzbarber, que era a única coisa apontando para elas. A empresa Bzbarber fica.
--
-- Esta migração roda com a role dona da base; a role de produção não tem DELETE.
-- Se aparecer qualquer outra linha apontando para as três, ela para antes de
-- apagar: sumir com contrato, oferta, checkout ou campanha não faz parte disto.

DO $$
DECLARE
 r record;
 n integer;
BEGIN
 -- Varre toda coluna product_id, com ou sem chave estrangeira: algumas trilhas
 -- (histórico de oferta, revisões de checkout) guardam o id sem FK e ficariam
 -- órfãs sem que o banco reclamasse.
 FOR r IN
  SELECT table_name FROM information_schema.columns
   WHERE table_schema = 'public' AND column_name = 'product_id' AND table_name <> 'client_engagements'
 LOOP
  EXECUTE format('SELECT count(*) FROM %I WHERE product_id IN (''barber'',''commerce'',''data'')', r.table_name) INTO n;
  IF n > 0 THEN
   RAISE EXCEPTION 'Remoção cancelada: % linha(s) em % ainda apontam para barber, commerce ou data.', n, r.table_name;
  END IF;
 END LOOP;

 SELECT count(*) INTO n FROM client_engagements
  WHERE product_id IN ('barber', 'commerce', 'data')
    AND NOT (source_system = 'notion' AND source_ref = 'bzbarber-barber');
 IF n > 0 THEN
  RAISE EXCEPTION 'Remoção cancelada: % contratação(ões) além da do Bzbarber apontam para barber, commerce ou data.', n;
 END IF;
END $$;

-- Criada pela 009 a partir do Notion; planejada, sem deploy, campanha nem trilha.
DELETE FROM client_engagements
 WHERE product_id = 'barber' AND source_system = 'notion' AND source_ref = 'bzbarber-barber';

DELETE FROM ecosystem_entries
 WHERE kind = 'product' AND id IN ('barber', 'commerce', 'data');

DELETE FROM products
 WHERE id IN ('barber', 'commerce', 'data');
