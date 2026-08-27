-- Preflight somente leitura da fase 016.
-- Executar no projeto correto, com backup e autorização, antes da aplicação.
-- Este arquivo não cria, altera nem remove objetos.

SELECT current_database() AS database_name,
       current_schema() AS schema_name,
       current_setting('server_version') AS server_version;

SELECT rolname, rolsuper, rolbypassrls, rolcanlogin
FROM pg_roles
WHERE rolname = 'app_runtime';

SELECT table_name
FROM information_schema.tables
WHERE table_schema = 'public'
  AND table_name IN ('Salon', 'Appointment', 'Professional', 'ServicePricingRule', 'RescheduleProposal')
ORDER BY table_name;

SELECT typname, enumlabel
FROM pg_enum
JOIN pg_type ON pg_type.oid = pg_enum.enumtypid
WHERE typname IN ('AppointmentEventType', 'PricingRuleTargetType', 'PricingAdjustmentType', 'RescheduleProposalStatus')
ORDER BY typname, enumsortorder;

SELECT table_name, column_name, data_type, is_nullable
FROM information_schema.columns
WHERE table_schema = 'public'
  AND table_name IN ('ServicePricingRule', 'RescheduleProposal')
ORDER BY table_name, ordinal_position;

SELECT indexname
FROM pg_indexes
WHERE schemaname = 'public'
  AND tablename IN ('ServicePricingRule', 'RescheduleProposal')
ORDER BY tablename, indexname;

SELECT conrelid::regclass AS table_name,
       conname,
       contype,
       pg_get_constraintdef(oid) AS definition
FROM pg_constraint
WHERE conrelid IN (
  to_regclass('public."ServicePricingRule"'),
  to_regclass('public."RescheduleProposal"')
)
ORDER BY table_name, conname;

SELECT relname AS table_name,
       relrowsecurity AS rls_enabled,
       relforcerowsecurity AS rls_forced
FROM pg_class
WHERE oid IN (
  to_regclass('public."ServicePricingRule"'),
  to_regclass('public."RescheduleProposal"')
)
ORDER BY relname;

SELECT tablename, policyname, cmd, qual, with_check
FROM pg_policies
WHERE schemaname = 'public'
  AND tablename IN ('ServicePricingRule', 'RescheduleProposal')
ORDER BY tablename, policyname;

SELECT table_name, grantee, privilege_type
FROM information_schema.role_table_grants
WHERE table_schema = 'public'
  AND table_name IN ('ServicePricingRule', 'RescheduleProposal')
  AND grantee = 'app_runtime'
ORDER BY table_name, privilege_type;

SELECT COUNT(*) AS salons_above_public_limit
FROM "Salon"
WHERE "maxBookingLeadDays" > 60;

SELECT to_regclass('public."ServicePricingRule"') AS pricing_rule_table,
       to_regclass('public."RescheduleProposal"') AS proposal_table,
       to_regclass('public."Appointment"') AS appointment_table,
       to_regclass('public."Professional"') AS professional_table;
