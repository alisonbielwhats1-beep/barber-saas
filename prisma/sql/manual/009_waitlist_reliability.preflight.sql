-- Preflight SOMENTE LEITURA para a migration 009.
-- Execute apenas em banco descartavel/homologacao. Qualquer linha retornada
-- nas consultas de problemas deve ser analisada antes da migration.

-- Entradas que associam fila, agendamento ou cliente de tenants diferentes.
SELECT
  waitlist.id AS waitlist_id,
  waitlist."salonId" AS waitlist_salon_id,
  appointment."salonId" AS appointment_salon_id,
  client."salonId" AS client_salon_id
FROM "WaitlistEntry" AS waitlist
JOIN "Appointment" AS appointment ON appointment.id = waitlist."appointmentId"
LEFT JOIN "ClientProfile" AS client ON client.id = waitlist."clientId"
WHERE appointment."salonId" <> waitlist."salonId"
   OR (client.id IS NOT NULL AND client."salonId" <> waitlist."salonId")
ORDER BY waitlist."salonId", waitlist.id;

-- Duplicidades autenticadas ainda ativas impedem o indice parcial unico.
SELECT "salonId", "appointmentId", "clientId", COUNT(*) AS duplicates
FROM "WaitlistEntry"
WHERE "fulfilledAt" IS NULL AND "clientId" IS NOT NULL
GROUP BY "salonId", "appointmentId", "clientId"
HAVING COUNT(*) > 1;

-- Duplicidades de visitante ainda ativas impedem o indice parcial unico.
SELECT "salonId", "appointmentId", "guestPhone", COUNT(*) AS duplicates
FROM "WaitlistEntry"
WHERE "fulfilledAt" IS NULL
  AND "clientId" IS NULL
  AND "guestPhone" IS NOT NULL
GROUP BY "salonId", "appointmentId", "guestPhone"
HAVING COUNT(*) > 1;

-- Inventario dos tipos que serao normalizados para TIMESTAMPTZ.
SELECT table_name, column_name, data_type, datetime_precision
FROM information_schema.columns
WHERE table_schema = 'public'
  AND table_name = 'WaitlistEntry'
  AND column_name IN ('fulfilledAt', 'createdAt')
ORDER BY column_name;

-- Deve mostrar RLS ativo, RLS forcado e pelo menos uma policy tenant-scoped.
SELECT
  relation.relrowsecurity AS rls_enabled,
  relation.relforcerowsecurity AS rls_forced,
  (
    SELECT COUNT(*)
    FROM pg_policies AS policy
    WHERE policy.schemaname = 'public'
      AND policy.tablename = 'WaitlistEntry'
  ) AS policy_count
FROM pg_class AS relation
JOIN pg_namespace AS namespace ON namespace.oid = relation.relnamespace
WHERE namespace.nspname = 'public'
  AND relation.relname = 'WaitlistEntry';
