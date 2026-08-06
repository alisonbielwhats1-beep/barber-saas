-- Preflight SOMENTE LEITURA para a migration 008 da Fase 2.
--
-- Execute primeiro em uma cópia descartável/homologação. Este arquivo não
-- corrige nem remove dados. As consultas de problemas devem retornar zero linhas
-- antes do rollout; qualquer resultado exige análise humana e um plano separado.

-- Inventário do volume afetado.
SELECT
  COUNT(*) AS total_appointments,
  COUNT(*) FILTER (WHERE status IN ('PENDING', 'CONFIRMED', 'IN_PROGRESS'))
    AS active_appointments,
  MIN("startAt") AS oldest_start,
  MAX("startAt") AS newest_start
FROM "Appointment";

-- Deve retornar true: as policies das novas tabelas dependem do helper de
-- tenant já usado pelo runtime. A migration inteira faz rollback se ele não
-- existir, mas verificar aqui produz um diagnóstico mais claro antes da janela.
SELECT
  to_regprocedure('public.app_current_salon()') IS NOT NULL
    AS app_current_salon_exists;

-- Deve retornar zero linhas: intervalos vazios ou invertidos impedem a CHECK.
SELECT id, "salonId", "professionalId", "startAt", "endAt", status
FROM "Appointment"
WHERE "startAt" >= "endAt"
ORDER BY "salonId", "professionalId", "startAt";

-- Deve retornar zero linhas: FKs legadas por id não garantem que cliente,
-- profissional e serviço pertençam ao mesmo tenant do Appointment. A Fase 2
-- não tenta decidir automaticamente como corrigir uma associação cruzada.
SELECT
  appointment.id AS appointment_id,
  appointment."salonId" AS appointment_salon_id,
  client."salonId" AS client_salon_id,
  professional."salonId" AS professional_salon_id,
  service."salonId" AS service_salon_id
FROM "Appointment" AS appointment
JOIN "ClientProfile" AS client ON client.id = appointment."clientId"
JOIN "Professional" AS professional ON professional.id = appointment."professionalId"
JOIN "Service" AS service ON service.id = appointment."serviceId"
WHERE client."salonId" <> appointment."salonId"
   OR professional."salonId" <> appointment."salonId"
   OR service."salonId" <> appointment."salonId"
ORDER BY appointment."salonId", appointment.id;

-- Deve retornar zero linhas: conflitos legados impedem a exclusion constraint.
-- Intervalos adjacentes são permitidos porque a regra é [início, fim).
SELECT
  left_appointment."salonId",
  left_appointment."professionalId",
  left_appointment.id AS left_appointment_id,
  right_appointment.id AS right_appointment_id,
  left_appointment."startAt" AS left_start,
  left_appointment."endAt" AS left_end,
  right_appointment."startAt" AS right_start,
  right_appointment."endAt" AS right_end
FROM "Appointment" AS left_appointment
JOIN "Appointment" AS right_appointment
  ON right_appointment."salonId" = left_appointment."salonId"
 AND right_appointment."professionalId" = left_appointment."professionalId"
 AND right_appointment.id > left_appointment.id
 AND right_appointment.status IN ('PENDING', 'CONFIRMED', 'IN_PROGRESS')
 AND NOT right_appointment."isOverbooked"
 AND right_appointment."startAt" < left_appointment."endAt"
 AND right_appointment."endAt" > left_appointment."startAt"
WHERE left_appointment.status IN ('PENDING', 'CONFIRMED', 'IN_PROGRESS')
  AND NOT left_appointment."isOverbooked"
ORDER BY left_appointment."salonId", left_appointment."professionalId", left_appointment."startAt";

-- Deve retornar zero linhas: timezone precisa existir no catálogo IANA do
-- PostgreSQL e também ser aceito pelo runtime JavaScript.
SELECT salon.id, salon.slug, salon.timezone
FROM "Salon" AS salon
LEFT JOIN pg_timezone_names AS timezone_catalog
  ON timezone_catalog.name = salon.timezone
WHERE timezone_catalog.name IS NULL
ORDER BY salon.id;

-- Evidência dos tipos atuais; a migration converte apenas timestamp sem fuso e
-- não reaplica offset quando a coluna já é timestamptz.
SELECT table_name, column_name, data_type, datetime_precision
FROM information_schema.columns
WHERE table_schema = 'public'
  AND (table_name, column_name) IN (
    ('Appointment', 'startAt'),
    ('Appointment', 'endAt'),
    ('Appointment', 'reminderSentAt'),
    ('Appointment', 'cancelledAt'),
    ('Appointment', 'createdAt'),
    ('Appointment', 'updatedAt'),
    ('Payment', 'paidAt'),
    ('TimeOff', 'startAt'),
    ('TimeOff', 'endAt'),
    ('SalonClosure', 'startAt'),
    ('SalonClosure', 'endAt')
  )
ORDER BY table_name, column_name;
