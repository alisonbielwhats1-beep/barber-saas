-- Fila de espera confiavel e tenant-safe.
-- Migration aditiva: preserva todas as entradas e nao promove/cancela dados.
-- Aplicar somente depois do preflight zerar os problemas reportados.

BEGIN;

ALTER TABLE "WaitlistEntry"
  ADD COLUMN IF NOT EXISTS "cancelledAt" TIMESTAMPTZ(3),
  ADD COLUMN IF NOT EXISTS "cancelledByType" "AppointmentActorType",
  ADD COLUMN IF NOT EXISTS "cancelledById" TEXT,
  ADD COLUMN IF NOT EXISTS "cancelledReason" TEXT,
  ADD COLUMN IF NOT EXISTS "professionalId" TEXT,
  ADD COLUMN IF NOT EXISTS "startAt" TIMESTAMPTZ(3),
  ADD COLUMN IF NOT EXISTS "endAt" TIMESTAMPTZ(3),
  ADD COLUMN IF NOT EXISTS "timezone" TEXT,
  ADD COLUMN IF NOT EXISTS "serviceSnapshots" JSONB,
  ADD COLUMN IF NOT EXISTS "priceCents" INTEGER;

-- As versoes antigas foram criadas como timestamp sem fuso pelo Prisma. Esses
-- valores representam instantes UTC; a conversao preserva o instante.
DO $$
DECLARE
  target_column TEXT;
BEGIN
  FOREACH target_column IN ARRAY ARRAY['fulfilledAt', 'createdAt']
  LOOP
    IF EXISTS (
      SELECT 1
      FROM information_schema.columns
      WHERE table_schema = 'public'
        AND table_name = 'WaitlistEntry'
        AND column_name = target_column
        AND data_type = 'timestamp without time zone'
    ) THEN
      EXECUTE format(
        'ALTER TABLE "WaitlistEntry" ALTER COLUMN %I TYPE TIMESTAMPTZ(3) USING %I AT TIME ZONE ''UTC''',
        target_column,
        target_column
      );
    END IF;
  END LOOP;
END $$;

-- Entradas legadas passam a carregar o snapshot exato do agendamento ao qual
-- estavam ligadas. Nenhum valor existente e reinterpretado ou descartado.
UPDATE "WaitlistEntry" AS waitlist
SET
  "professionalId" = appointment."professionalId",
  "startAt" = appointment."startAt",
  "endAt" = appointment."endAt",
  "timezone" = appointment."timezone",
  "priceCents" = appointment."priceCents",
  "serviceSnapshots" = COALESCE(
    (
      SELECT jsonb_agg(
        jsonb_build_object(
          'serviceId', item."serviceId",
          'serviceName', item."serviceName",
          'durationMin', item."durationMin",
          'priceCents', item."priceCents"
        )
        ORDER BY item.position
      )
      FROM "AppointmentService" AS item
      WHERE item."appointmentId" = appointment.id
        AND item."salonId" = appointment."salonId"
    ),
    jsonb_build_array(
      jsonb_build_object(
        'serviceId', service.id,
        'serviceName', service.name,
        'durationMin', GREATEST(
          1,
          ROUND(EXTRACT(EPOCH FROM (appointment."endAt" - appointment."startAt")) / 60)::INTEGER
        ),
        'priceCents', appointment."priceCents"
      )
    )
  )
FROM "Appointment" AS appointment
JOIN "Service" AS service
  ON service.id = appointment."serviceId"
 AND service."salonId" = appointment."salonId"
WHERE appointment.id = waitlist."appointmentId"
  AND appointment."salonId" = waitlist."salonId"
  AND (
    waitlist."professionalId" IS NULL
    OR waitlist."startAt" IS NULL
    OR waitlist."endAt" IS NULL
    OR waitlist."timezone" IS NULL
    OR waitlist."serviceSnapshots" IS NULL
    OR waitlist."priceCents" IS NULL
  );

ALTER TABLE "WaitlistEntry"
  ALTER COLUMN "professionalId" SET NOT NULL,
  ALTER COLUMN "startAt" SET NOT NULL,
  ALTER COLUMN "endAt" SET NOT NULL,
  ALTER COLUMN "timezone" SET NOT NULL,
  ALTER COLUMN "serviceSnapshots" SET NOT NULL,
  ALTER COLUMN "priceCents" SET NOT NULL;

CREATE UNIQUE INDEX IF NOT EXISTS "WaitlistEntry_id_salonId_key"
  ON "WaitlistEntry" (id, "salonId");

-- Unicidade somente enquanto a pessoa continua aguardando. Uma entrada
-- concluida ou cancelada permanece no historico e pode ser refeita depois.
CREATE UNIQUE INDEX IF NOT EXISTS "WaitlistEntry_active_client_key"
  ON "WaitlistEntry" ("salonId", "appointmentId", "clientId")
  WHERE "fulfilledAt" IS NULL
    AND "cancelledAt" IS NULL
    AND "clientId" IS NOT NULL;

CREATE UNIQUE INDEX IF NOT EXISTS "WaitlistEntry_active_guest_key"
  ON "WaitlistEntry" ("salonId", "appointmentId", "guestPhone")
  WHERE "fulfilledAt" IS NULL
    AND "cancelledAt" IS NULL
    AND "clientId" IS NULL
    AND "guestPhone" IS NOT NULL;

CREATE INDEX IF NOT EXISTS "WaitlistEntry_salonId_appointmentId_cancelledAt_fulfilledAt_createdAt_idx"
  ON "WaitlistEntry" (
    "salonId",
    "appointmentId",
    "cancelledAt",
    "fulfilledAt",
    "createdAt"
  );

CREATE INDEX IF NOT EXISTS "WaitlistEntry_salonId_professionalId_startAt_idx"
  ON "WaitlistEntry" ("salonId", "professionalId", "startAt");

ALTER TABLE "WaitlistEntry"
  DROP CONSTRAINT IF EXISTS "WaitlistEntry_appointmentId_fkey",
  DROP CONSTRAINT IF EXISTS "WaitlistEntry_clientId_fkey";

DO $$ BEGIN
  ALTER TABLE "WaitlistEntry"
    ADD CONSTRAINT "WaitlistEntry_appointment_tenant_fkey"
    FOREIGN KEY ("appointmentId", "salonId")
    REFERENCES "Appointment"(id, "salonId")
    ON DELETE CASCADE NOT VALID;
EXCEPTION WHEN duplicate_object THEN NULL;
END $$;

DO $$ BEGIN
  ALTER TABLE "WaitlistEntry"
    ADD CONSTRAINT "WaitlistEntry_professional_tenant_fkey"
    FOREIGN KEY ("professionalId", "salonId")
    REFERENCES "Professional"(id, "salonId")
    ON DELETE RESTRICT NOT VALID;
EXCEPTION WHEN duplicate_object THEN NULL;
END $$;

DO $$ BEGIN
  ALTER TABLE "WaitlistEntry"
    ADD CONSTRAINT "WaitlistEntry_client_tenant_fkey"
    FOREIGN KEY ("clientId", "salonId")
    REFERENCES "ClientProfile"(id, "salonId")
    ON DELETE CASCADE NOT VALID;
EXCEPTION WHEN duplicate_object THEN NULL;
END $$;

ALTER TABLE "WaitlistEntry"
  VALIDATE CONSTRAINT "WaitlistEntry_appointment_tenant_fkey";
ALTER TABLE "WaitlistEntry"
  VALIDATE CONSTRAINT "WaitlistEntry_client_tenant_fkey";
ALTER TABLE "WaitlistEntry"
  VALIDATE CONSTRAINT "WaitlistEntry_professional_tenant_fkey";

DO $$ BEGIN
  ALTER TABLE "WaitlistEntry"
    ADD CONSTRAINT "WaitlistEntry_single_terminal_state_check"
    CHECK (NOT ("fulfilledAt" IS NOT NULL AND "cancelledAt" IS NOT NULL))
    NOT VALID;
EXCEPTION WHEN duplicate_object THEN NULL;
END $$;

ALTER TABLE "WaitlistEntry"
  VALIDATE CONSTRAINT "WaitlistEntry_single_terminal_state_check";

DO $$ BEGIN
  ALTER TABLE "WaitlistEntry"
    ADD CONSTRAINT "WaitlistEntry_valid_interval_check"
    CHECK ("startAt" < "endAt") NOT VALID;
EXCEPTION WHEN duplicate_object THEN NULL;
END $$;

DO $$ BEGIN
  ALTER TABLE "WaitlistEntry"
    ADD CONSTRAINT "WaitlistEntry_nonnegative_price_check"
    CHECK ("priceCents" >= 0) NOT VALID;
EXCEPTION WHEN duplicate_object THEN NULL;
END $$;

ALTER TABLE "WaitlistEntry"
  VALIDATE CONSTRAINT "WaitlistEntry_valid_interval_check";
ALTER TABLE "WaitlistEntry"
  VALIDATE CONSTRAINT "WaitlistEntry_nonnegative_price_check";

COMMIT;
