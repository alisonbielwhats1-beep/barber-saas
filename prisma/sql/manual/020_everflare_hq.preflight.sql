-- Somente leitura. Confirmar destino contra APP_ENV/project ref antes de executar.
SELECT current_database(), current_user, inet_server_addr(), version();
DO $$ BEGIN
 IF to_regclass('public."User"') IS NULL THEN RAISE EXCEPTION 'User ausente'; END IF;
 IF NOT EXISTS (SELECT 1 FROM information_schema.columns WHERE table_schema='public' AND table_name='User' AND column_name='platformRole') THEN RAISE EXCEPTION 'Aplicação sem autorização global'; END IF;
 IF EXISTS (SELECT 1 FROM pg_roles WHERE rolname='app_runtime' AND (rolsuper OR rolbypassrls)) THEN RAISE EXCEPTION 'Runtime privilegiado'; END IF;
END $$;
SELECT tablename, policyname FROM pg_policies WHERE tablename LIKE 'hq_%';

