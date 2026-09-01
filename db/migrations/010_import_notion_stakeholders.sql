-- Importa somente identidade profissional e papel. Telefones, e-mails, corpos de página e segredos ficam fora.
WITH imported(name,source_ref) AS (VALUES
 ('Gabriela','notion-assinatura-gabriela-corporativo'),
 ('Marcelle','notion-assinatura-marcelle'),
 ('Bernardo','notion-bzbarber-bernardo'),
 ('Carol','notion-kalidash-carol'),
 ('Iago Braz','notion-kalidash-iago'),
 ('Junior Goncalves','notion-kalidash-junior'),
 ('João Silva Guerra','notion-joao-mentoria')
)
INSERT INTO stakeholders(name,source_system,source_ref)
SELECT name,'notion',source_ref FROM imported
ON CONFLICT(source_system,source_ref) WHERE source_system IS NOT NULL AND source_ref IS NOT NULL
DO UPDATE SET name=EXCLUDED.name;

WITH links(tenant_ref,person_ref,role,title,is_primary) AS (VALUES
 ('36f2551e-c67e-80db-b25f-c702f422197d','notion-assinatura-gabriela-corporativo','decision_maker','Diretora de Novos Negócios',true),
 ('36f2551e-c67e-80db-b25f-c702f422197d','notion-assinatura-marcelle','operational','Contato operacional',false),
 ('3822551e-c67e-8045-a818-f79fdc387399','notion-bzbarber-bernardo','champion','Contato principal',true),
 ('3742551e-c67e-8087-bc8d-fba2f1fcbc78','notion-kalidash-carol','decision_maker','CMO',true),
 ('3742551e-c67e-8087-bc8d-fba2f1fcbc78','notion-kalidash-iago','technical','CFO / CTO',false),
 ('3742551e-c67e-8087-bc8d-fba2f1fcbc78','notion-kalidash-junior','operational','Gestor de tráfego',false),
 ('3832551e-c67e-80ff-9604-f594aae30101','notion-joao-mentoria','student','Aluno',true)
)
INSERT INTO organization_stakeholders(tenant_id,stakeholder_id,role,title,is_primary,contact_allowed,notes)
SELECT t.id,s.id,l.role,l.title,l.is_primary,true,'Importado do cadastro profissional do Notion'
FROM links l JOIN tenants t ON t.source_system='notion' AND t.source_ref=l.tenant_ref
JOIN stakeholders s ON s.source_system='notion' AND s.source_ref=l.person_ref
ON CONFLICT(tenant_id,stakeholder_id) DO UPDATE SET role=EXCLUDED.role,title=EXCLUDED.title,is_primary=EXCLUDED.is_primary;

