-- Todas as escritas e a role existem somente nesta transação de teste.
BEGIN;
DO $$ BEGIN IF current_database() <> 'salon_schema_ci' THEN RAISE EXCEPTION 'Banco incorreto'; END IF; END $$;
CREATE ROLE opening_ci_runtime NOLOGIN NOSUPERUSER NOBYPASSRLS;
GRANT USAGE ON SCHEMA public TO opening_ci_runtime;
GRANT SELECT, INSERT ON "ProfessionalOpening" TO opening_ci_runtime;
SELECT set_config('test.salon', "salonId", true), set_config('test.pro', id, true) FROM "Professional" ORDER BY id LIMIT 1;
SELECT set_config('test.other_salon', "salonId", true), set_config('test.other_pro', id, true) FROM "Professional" WHERE "salonId" <> current_setting('test.salon') ORDER BY id LIMIT 1;
INSERT INTO "ProfessionalOpening" (id, "salonId", "professionalId", "dateKey", "startMinutes", "endMinutes", reason)
VALUES ('opening-ci-own', current_setting('test.salon'), current_setting('test.pro'), '2032-08-05', 1080, 1200, 'Fixture CI'),
('opening-ci-other', current_setting('test.other_salon'), current_setting('test.other_pro'), '2032-08-05', 1080, 1200, 'Fixture CI');
SET LOCAL ROLE opening_ci_runtime;
SELECT set_config('app.current_salon', current_setting('test.salon'), true);
DO $$ BEGIN
  IF (SELECT count(*) FROM "ProfessionalOpening") <> 1 THEN RAISE EXCEPTION 'Vazamento entre tenants'; END IF;
  BEGIN
    INSERT INTO "ProfessionalOpening" (id, "salonId", "professionalId", "dateKey", "startMinutes", "endMinutes", reason)
    VALUES ('opening-ci-forbidden', current_setting('test.other_salon'), current_setting('test.other_pro'), '2032-08-05', 1080, 1200, 'Fixture CI');
    RAISE EXCEPTION 'Escrita cross-tenant aceita';
  EXCEPTION WHEN insufficient_privilege THEN NULL; END;
  BEGIN
    INSERT INTO "ProfessionalOpening" (id, "salonId", "professionalId", "dateKey", "startMinutes", "endMinutes", reason)
    VALUES ('opening-ci-wrong-pro', current_setting('test.salon'), current_setting('test.other_pro'), '2032-08-05', 1080, 1200, 'Fixture CI');
    RAISE EXCEPTION 'Profissional de outro tenant aceito';
  EXCEPTION WHEN foreign_key_violation THEN NULL; END;
  BEGIN
    INSERT INTO "ProfessionalOpening" (id, "salonId", "professionalId", "dateKey", "startMinutes", "endMinutes", reason)
    VALUES ('opening-ci-invalid', current_setting('test.salon'), current_setting('test.pro'), '2032-08-05', 1200, 1080, 'Fixture CI');
    RAISE EXCEPTION 'Intervalo invertido aceito';
  EXCEPTION WHEN check_violation THEN NULL; END;
END $$;
SELECT set_config('app.current_salon', '', true);
DO $$ BEGIN IF EXISTS (SELECT 1 FROM "ProfessionalOpening") THEN RAISE EXCEPTION 'Leitura sem tenant'; END IF; END $$;
ROLLBACK;
