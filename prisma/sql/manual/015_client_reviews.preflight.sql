-- Preflight somente leitura da fase 015.
-- Executar no projeto Supabase identificado antes de qualquer aplicação.
-- Não altera dados nem cria objetos.

SELECT current_database() AS database_name,
       current_schema() AS schema_name,
       current_setting('server_version') AS server_version;

SELECT rolname, rolsuper, rolbypassrls, rolcanlogin
FROM pg_roles
WHERE rolname = 'app_runtime';

SELECT table_name
FROM information_schema.tables
WHERE table_schema = 'public'
  AND table_name IN ('Salon', 'Appointment', 'ClientProfile', 'ClientReview')
ORDER BY table_name;

SELECT column_name, data_type, character_maximum_length, is_nullable
FROM information_schema.columns
WHERE table_schema = 'public'
  AND table_name = 'ClientReview'
ORDER BY ordinal_position;

SELECT indexname
FROM pg_indexes
WHERE schemaname = 'public'
  AND tablename = 'ClientReview'
ORDER BY indexname;

SELECT conname, contype, pg_get_constraintdef(oid) AS definition
FROM pg_constraint
WHERE conrelid = to_regclass('public."ClientReview"')
ORDER BY conname;

SELECT relrowsecurity AS rls_enabled,
       relforcerowsecurity AS rls_forced
FROM pg_class
WHERE oid = to_regclass('public."ClientReview"');

SELECT policyname, cmd, qual, with_check
FROM pg_policies
WHERE schemaname = 'public'
  AND tablename = 'ClientReview'
ORDER BY policyname;

SELECT grantee, privilege_type
FROM information_schema.role_table_grants
WHERE table_schema = 'public'
  AND table_name = 'ClientReview'
  AND grantee = 'app_runtime'
ORDER BY privilege_type;

SELECT to_regclass('public."ClientReview"') AS client_review_table,
       CASE
         WHEN to_regclass('public."ClientReview"') IS NULL THEN 'tabela ainda não criada'
         ELSE 'tabela já existe: revise antes de reaplicar'
       END AS review_table_state;
