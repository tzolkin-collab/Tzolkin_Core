-- Acompanhamento: categoria assessoria
--
-- Escrita em 2026-10-07. Amplia a lista de categorias do banco para incluir "assessoria".
-- Antes disso, advisory caía em consultoria por falta da opção no banco.

ALTER TABLE service_activities DROP CONSTRAINT IF EXISTS service_activities_category_check;
ALTER TABLE service_activities ADD CONSTRAINT service_activities_category_check
 CHECK (category IN ('mentoria','consultoria','software','educacional','assessoria','outro'));
