-- Disposable CI only: production already has the restricted runtime role.
DO $$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_roles WHERE rolname='app_runtime') THEN
    CREATE ROLE app_runtime NOLOGIN NOSUPERUSER NOBYPASSRLS;
  END IF;
END $$;
