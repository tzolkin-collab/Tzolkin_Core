
ALTER TABLE stakeholders DROP CONSTRAINT IF EXISTS stakeholders_name_check;
ALTER TABLE stakeholders ADD CONSTRAINT stakeholders_name_check CHECK(length(name) BETWEEN 2 AND 200);
ALTER TABLE tenants DROP CONSTRAINT IF EXISTS tenants_name_check;
ALTER TABLE tenants ADD CONSTRAINT tenants_name_check CHECK(length(name) BETWEEN 2 AND 200);
