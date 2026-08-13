-- PREFLIGHT SOMENTE LEITURA — NÃO É MIGRATION E NÃO CORRIGE DADOS.
--
-- AppointmentProduct não possui salonId no schema atual. A policy RLS herda
-- o tenant pelo Appointment pai, mas uma FK futura ainda deve impedir que o
-- productId aponte para Product de outro tenant. Até essa migration aditiva
-- ser desenhada, homologada e explicitamente autorizada, o domínio valida os
-- dois lados antes de criar o vínculo.
--
-- Gate para qualquer hardening futuro: todas as consultas abaixo devem
-- retornar zero anomalias e a policy deve continuar habilitada/forçada.

SELECT
  COUNT(*)::bigint AS cross_tenant_appointment_products
FROM "AppointmentProduct" ap
JOIN "Appointment" a ON a.id = ap."appointmentId"
JOIN "Product" p ON p.id = ap."productId"
WHERE a."salonId" <> p."salonId";

SELECT
  COUNT(*)::bigint AS orphan_appointment_products
FROM "AppointmentProduct" ap
LEFT JOIN "Appointment" a ON a.id = ap."appointmentId"
LEFT JOIN "Product" p ON p.id = ap."productId"
WHERE a.id IS NULL OR p.id IS NULL;

SELECT
  c.relrowsecurity AS rls_enabled,
  c.relforcerowsecurity AS rls_forced,
  COUNT(pol.polname)::bigint AS policy_count
FROM pg_class c
JOIN pg_namespace n ON n.oid = c.relnamespace
LEFT JOIN pg_policy pol ON pol.polrelid = c.oid
WHERE n.nspname = 'public'
  AND c.relname = 'AppointmentProduct'
GROUP BY c.relrowsecurity, c.relforcerowsecurity;

