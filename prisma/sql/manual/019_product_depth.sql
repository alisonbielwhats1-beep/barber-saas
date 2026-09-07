BEGIN;
SET LOCAL lock_timeout = '5s';
SET LOCAL statement_timeout = '60s';
-- AlterTable
ALTER TABLE "Service" ADD COLUMN IF NOT EXISTS "finishingMin" INTEGER NOT NULL DEFAULT 0,
ADD COLUMN IF NOT EXISTS "physicalResourceId" TEXT,
ADD COLUMN IF NOT EXISTS "processingMin" INTEGER NOT NULL DEFAULT 0,
ADD COLUMN IF NOT EXISTS "variantGroup" TEXT,
ADD COLUMN IF NOT EXISTS "variantLabel" TEXT;

-- AlterTable
ALTER TABLE "Appointment" ADD COLUMN IF NOT EXISTS "dependentId" TEXT,
ADD COLUMN IF NOT EXISTS "dependentName" TEXT;

-- AlterTable
ALTER TABLE "AppointmentService" ADD COLUMN IF NOT EXISTS "finishingMin" INTEGER NOT NULL DEFAULT 0,
ADD COLUMN IF NOT EXISTS "processingMin" INTEGER NOT NULL DEFAULT 0;

-- CreateTable
CREATE TABLE IF NOT EXISTS "PhysicalResource" (
    "id" TEXT NOT NULL,
    "salonId" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "kind" TEXT NOT NULL,
    "active" BOOLEAN NOT NULL DEFAULT true,

    CONSTRAINT "PhysicalResource_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE IF NOT EXISTS "ResourceBooking" (
    "appointmentId" TEXT NOT NULL,
    "resourceId" TEXT NOT NULL,
    "salonId" TEXT NOT NULL,
    "startAt" TIMESTAMPTZ(3) NOT NULL,
    "endAt" TIMESTAMPTZ(3) NOT NULL,
    "active" BOOLEAN NOT NULL,

    CONSTRAINT "ResourceBooking_pkey" PRIMARY KEY ("appointmentId","resourceId")
);
ALTER TABLE "ResourceBooking" ADD COLUMN IF NOT EXISTS retired BOOLEAN NOT NULL DEFAULT false;

-- CreateTable
CREATE TABLE IF NOT EXISTS "ClientDependent" (
    "id" TEXT NOT NULL,
    "salonId" TEXT NOT NULL,
    "clientId" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "relationship" TEXT NOT NULL,
    "active" BOOLEAN NOT NULL DEFAULT true,
    "createdAt" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "ClientDependent_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE IF NOT EXISTS "CareEntry" (
    "id" TEXT NOT NULL,
    "salonId" TEXT NOT NULL,
    "appointmentId" TEXT NOT NULL,
    "authorId" TEXT NOT NULL,
    "authorName" TEXT NOT NULL,
    "body" TEXT NOT NULL,
    "photo" BYTEA,
    "photoConsent" BOOLEAN NOT NULL DEFAULT false,
    "createdAt" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "CareEntry_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE IF NOT EXISTS "FlexibleWaitlist" (
    "id" TEXT NOT NULL,
    "salonId" TEXT NOT NULL,
    "clientId" TEXT NOT NULL,
    "professionalId" TEXT NOT NULL,
    "fromDate" VARCHAR(10) NOT NULL,
    "toDate" VARCHAR(10) NOT NULL,
    "startMinutes" INTEGER NOT NULL,
    "endMinutes" INTEGER NOT NULL,
    "status" TEXT NOT NULL DEFAULT 'WAITING',
    "fulfilledAppointmentId" TEXT,
    "createdAt" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "FlexibleWaitlist_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE IF NOT EXISTS "FlexibleWaitlistService" (
    "waitlistId" TEXT NOT NULL,
    "salonId" TEXT NOT NULL,
    "serviceId" TEXT NOT NULL,

    CONSTRAINT "FlexibleWaitlistService_pkey" PRIMARY KEY ("waitlistId","serviceId")
);

-- CreateIndex
CREATE UNIQUE INDEX IF NOT EXISTS "PhysicalResource_id_salonId_key" ON "PhysicalResource"("id", "salonId");

-- CreateIndex
CREATE UNIQUE INDEX IF NOT EXISTS "PhysicalResource_salonId_name_key" ON "PhysicalResource"("salonId", "name");

-- CreateIndex
CREATE INDEX IF NOT EXISTS "ResourceBooking_salonId_resourceId_startAt_idx" ON "ResourceBooking"("salonId", "resourceId", "startAt");

-- CreateIndex
CREATE INDEX IF NOT EXISTS "ClientDependent_salonId_clientId_idx" ON "ClientDependent"("salonId", "clientId");

-- CreateIndex
CREATE UNIQUE INDEX IF NOT EXISTS "ClientDependent_id_clientId_salonId_key" ON "ClientDependent"("id", "clientId", "salonId");

-- CreateIndex
CREATE INDEX IF NOT EXISTS "CareEntry_salonId_appointmentId_createdAt_idx" ON "CareEntry"("salonId", "appointmentId", "createdAt");

-- CreateIndex
CREATE INDEX IF NOT EXISTS "FlexibleWaitlist_salonId_professionalId_status_createdAt_idx" ON "FlexibleWaitlist"("salonId", "professionalId", "status", "createdAt");

-- CreateIndex
CREATE UNIQUE INDEX IF NOT EXISTS "FlexibleWaitlist_id_salonId_key" ON "FlexibleWaitlist"("id", "salonId");

-- CreateIndex
CREATE INDEX IF NOT EXISTS "FlexibleWaitlistService_salonId_idx" ON "FlexibleWaitlistService"("salonId");

-- AddForeignKey
DO $$ BEGIN IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conrelid = '"Service"'::regclass AND conname = 'Service_physicalResourceId_salonId_fkey') THEN ALTER TABLE "Service" ADD CONSTRAINT "Service_physicalResourceId_salonId_fkey" FOREIGN KEY ("physicalResourceId", "salonId") REFERENCES "PhysicalResource"("id", "salonId") ON DELETE RESTRICT ON UPDATE CASCADE; END IF; END $$;

-- AddForeignKey
DO $$ BEGIN IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conrelid = '"Appointment"'::regclass AND conname = 'Appointment_dependentId_clientId_salonId_fkey') THEN ALTER TABLE "Appointment" ADD CONSTRAINT "Appointment_dependentId_clientId_salonId_fkey" FOREIGN KEY ("dependentId", "clientId", "salonId") REFERENCES "ClientDependent"("id", "clientId", "salonId") ON DELETE RESTRICT ON UPDATE CASCADE; END IF; END $$;

-- AddForeignKey
DO $$ BEGIN IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conrelid = '"PhysicalResource"'::regclass AND conname = 'PhysicalResource_salonId_fkey') THEN ALTER TABLE "PhysicalResource" ADD CONSTRAINT "PhysicalResource_salonId_fkey" FOREIGN KEY ("salonId") REFERENCES "Salon"("id") ON DELETE RESTRICT ON UPDATE CASCADE; END IF; END $$;

-- AddForeignKey
DO $$ BEGIN IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conrelid = '"ResourceBooking"'::regclass AND conname = 'ResourceBooking_resourceId_salonId_fkey') THEN ALTER TABLE "ResourceBooking" ADD CONSTRAINT "ResourceBooking_resourceId_salonId_fkey" FOREIGN KEY ("resourceId", "salonId") REFERENCES "PhysicalResource"("id", "salonId") ON DELETE RESTRICT ON UPDATE CASCADE; END IF; END $$;

-- AddForeignKey
DO $$ BEGIN IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conrelid = '"ResourceBooking"'::regclass AND conname = 'ResourceBooking_appointmentId_salonId_fkey') THEN ALTER TABLE "ResourceBooking" ADD CONSTRAINT "ResourceBooking_appointmentId_salonId_fkey" FOREIGN KEY ("appointmentId", "salonId") REFERENCES "Appointment"("id", "salonId") ON DELETE RESTRICT ON UPDATE CASCADE; END IF; END $$;

-- AddForeignKey
DO $$ BEGIN IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conrelid = '"ResourceBooking"'::regclass AND conname = 'ResourceBooking_salonId_fkey') THEN ALTER TABLE "ResourceBooking" ADD CONSTRAINT "ResourceBooking_salonId_fkey" FOREIGN KEY ("salonId") REFERENCES "Salon"("id") ON DELETE RESTRICT ON UPDATE CASCADE; END IF; END $$;

-- AddForeignKey
DO $$ BEGIN IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conrelid = '"ClientDependent"'::regclass AND conname = 'ClientDependent_clientId_salonId_fkey') THEN ALTER TABLE "ClientDependent" ADD CONSTRAINT "ClientDependent_clientId_salonId_fkey" FOREIGN KEY ("clientId", "salonId") REFERENCES "ClientProfile"("id", "salonId") ON DELETE RESTRICT ON UPDATE CASCADE; END IF; END $$;

-- AddForeignKey
DO $$ BEGIN IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conrelid = '"ClientDependent"'::regclass AND conname = 'ClientDependent_salonId_fkey') THEN ALTER TABLE "ClientDependent" ADD CONSTRAINT "ClientDependent_salonId_fkey" FOREIGN KEY ("salonId") REFERENCES "Salon"("id") ON DELETE RESTRICT ON UPDATE CASCADE; END IF; END $$;

-- AddForeignKey
DO $$ BEGIN IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conrelid = '"CareEntry"'::regclass AND conname = 'CareEntry_appointmentId_salonId_fkey') THEN ALTER TABLE "CareEntry" ADD CONSTRAINT "CareEntry_appointmentId_salonId_fkey" FOREIGN KEY ("appointmentId", "salonId") REFERENCES "Appointment"("id", "salonId") ON DELETE RESTRICT ON UPDATE CASCADE; END IF; END $$;

-- AddForeignKey
DO $$ BEGIN IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conrelid = '"CareEntry"'::regclass AND conname = 'CareEntry_salonId_fkey') THEN ALTER TABLE "CareEntry" ADD CONSTRAINT "CareEntry_salonId_fkey" FOREIGN KEY ("salonId") REFERENCES "Salon"("id") ON DELETE RESTRICT ON UPDATE CASCADE; END IF; END $$;

-- AddForeignKey
DO $$ BEGIN IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conrelid = '"FlexibleWaitlist"'::regclass AND conname = 'FlexibleWaitlist_clientId_salonId_fkey') THEN ALTER TABLE "FlexibleWaitlist" ADD CONSTRAINT "FlexibleWaitlist_clientId_salonId_fkey" FOREIGN KEY ("clientId", "salonId") REFERENCES "ClientProfile"("id", "salonId") ON DELETE RESTRICT ON UPDATE CASCADE; END IF; END $$;

-- AddForeignKey
DO $$ BEGIN IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conrelid = '"FlexibleWaitlist"'::regclass AND conname = 'FlexibleWaitlist_salonId_fkey') THEN ALTER TABLE "FlexibleWaitlist" ADD CONSTRAINT "FlexibleWaitlist_salonId_fkey" FOREIGN KEY ("salonId") REFERENCES "Salon"("id") ON DELETE RESTRICT ON UPDATE CASCADE; END IF; END $$;

-- AddForeignKey
DO $$ BEGIN IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conrelid = '"FlexibleWaitlist"'::regclass AND conname = 'FlexibleWaitlist_professionalId_salonId_fkey') THEN ALTER TABLE "FlexibleWaitlist" ADD CONSTRAINT "FlexibleWaitlist_professionalId_salonId_fkey" FOREIGN KEY ("professionalId", "salonId") REFERENCES "Professional"("id", "salonId") ON DELETE RESTRICT ON UPDATE CASCADE; END IF; END $$;

-- AddForeignKey
DO $$ BEGIN IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conrelid = '"FlexibleWaitlistService"'::regclass AND conname = 'FlexibleWaitlistService_waitlistId_salonId_fkey') THEN ALTER TABLE "FlexibleWaitlistService" ADD CONSTRAINT "FlexibleWaitlistService_waitlistId_salonId_fkey" FOREIGN KEY ("waitlistId", "salonId") REFERENCES "FlexibleWaitlist"("id", "salonId") ON DELETE RESTRICT ON UPDATE CASCADE; END IF; END $$;

-- AddForeignKey
DO $$ BEGIN IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conrelid = '"FlexibleWaitlistService"'::regclass AND conname = 'FlexibleWaitlistService_serviceId_salonId_fkey') THEN ALTER TABLE "FlexibleWaitlistService" ADD CONSTRAINT "FlexibleWaitlistService_serviceId_salonId_fkey" FOREIGN KEY ("serviceId", "salonId") REFERENCES "Service"("id", "salonId") ON DELETE RESTRICT ON UPDATE CASCADE; END IF; END $$;

-- AddForeignKey
DO $$ BEGIN IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conrelid = '"FlexibleWaitlistService"'::regclass AND conname = 'FlexibleWaitlistService_salonId_fkey') THEN ALTER TABLE "FlexibleWaitlistService" ADD CONSTRAINT "FlexibleWaitlistService_salonId_fkey" FOREIGN KEY ("salonId") REFERENCES "Salon"("id") ON DELETE RESTRICT ON UPDATE CASCADE; END IF; END $$;
DO $$ DECLARE table_name text; role_name text; BEGIN
  FOREACH table_name IN ARRAY ARRAY['PhysicalResource','ResourceBooking','ClientDependent','CareEntry','FlexibleWaitlist','FlexibleWaitlistService'] LOOP
    EXECUTE format('ALTER TABLE %I ENABLE ROW LEVEL SECURITY', table_name);
    EXECUTE format('ALTER TABLE %I FORCE ROW LEVEL SECURITY', table_name);
    EXECUTE format('DROP POLICY IF EXISTS product_tenant ON %I', table_name);
    EXECUTE format('CREATE POLICY product_tenant ON %I USING ("salonId" = app_current_salon()) WITH CHECK ("salonId" = app_current_salon())', table_name);
    EXECUTE format('REVOKE ALL ON %I FROM PUBLIC', table_name);
    FOREACH role_name IN ARRAY ARRAY['anon','authenticated'] LOOP
      IF EXISTS (SELECT 1 FROM pg_roles WHERE rolname=role_name) THEN EXECUTE format('REVOKE ALL ON %I FROM %I',table_name,role_name); END IF;
    END LOOP;
    IF EXISTS (SELECT 1 FROM pg_roles WHERE rolname='app_runtime') THEN
      EXECUTE format('GRANT SELECT, INSERT ON %I TO app_runtime',table_name);
      IF table_name <> 'CareEntry' THEN EXECUTE format('GRANT UPDATE, DELETE ON %I TO app_runtime',table_name); END IF;
    END IF;
  END LOOP;
END $$;

DO $$ BEGIN
 IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname='resource_no_overlap') THEN
  ALTER TABLE "ResourceBooking" ADD CONSTRAINT resource_no_overlap EXCLUDE USING gist ("salonId" WITH =, "resourceId" WITH =, tstzrange("startAt", "endAt", '[)') WITH &&) WHERE (active);
 END IF;
 IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname='resource_valid_interval') THEN
  ALTER TABLE "ResourceBooking" ADD CONSTRAINT resource_valid_interval CHECK ("endAt" > "startAt");
  ALTER TABLE "PhysicalResource" ADD CONSTRAINT resource_valid_kind CHECK (kind IN ('ROOM','EQUIPMENT') AND length(trim(name)) BETWEEN 2 AND 100);
  ALTER TABLE "Service" ADD CONSTRAINT service_valid_stages CHECK ("processingMin" >= 0 AND "finishingMin" >= 0 AND "processingMin" + "finishingMin" < "durationMin");
  ALTER TABLE "CareEntry" ADD CONSTRAINT care_valid_content CHECK (length(trim(body)) BETWEEN 3 AND 8000 AND (photo IS NULL OR ("photoConsent" AND octet_length(photo) <= 1048576)));
  ALTER TABLE "ClientDependent" ADD CONSTRAINT dependent_valid_name CHECK (length(trim(name)) BETWEEN 2 AND 120 AND length(trim(relationship)) BETWEEN 2 AND 80);
  ALTER TABLE "FlexibleWaitlist" ADD CONSTRAINT flexible_valid_window CHECK (status IN ('WAITING','FULFILLED','CANCELLED') AND "startMinutes" >= 0 AND "endMinutes" <= 1440 AND "startMinutes" < "endMinutes" AND "fromDate"::date <= "toDate"::date AND "toDate"::date - "fromDate"::date <= 60);
 END IF;
END $$;

-- Snapshot allocation at booking time; later service edits cannot move old allocations.
CREATE OR REPLACE FUNCTION product_reserve_resource() RETURNS trigger LANGUAGE plpgsql SECURITY INVOKER SET search_path = public, pg_temp AS $$
DECLARE a "Appointment"%ROWTYPE; rid text;
BEGIN
 IF TG_TABLE_NAME = 'Appointment' THEN a := NEW;
 ELSE SELECT * INTO STRICT a FROM "Appointment" WHERE id=NEW."appointmentId" AND "salonId"=NEW."salonId"; END IF;
 IF current_setting('app.preserve_resource_snapshot', true) = a.id THEN RETURN NEW; END IF;
 SELECT "physicalResourceId" INTO rid FROM "Service" WHERE id=NEW."serviceId" AND "salonId"=a."salonId";
 IF rid IS NOT NULL THEN
  PERFORM id FROM "PhysicalResource" WHERE id=rid AND "salonId"=a."salonId" AND active FOR SHARE;
  IF NOT FOUND THEN RAISE EXCEPTION 'Resource unavailable' USING ERRCODE='23514'; END IF;
  INSERT INTO "ResourceBooking" ("appointmentId","resourceId","salonId","startAt","endAt",active)
   VALUES (a.id,rid,a."salonId",a."startAt",a."endAt",a.status::text IN ('PENDING','CONFIRMED','IN_PROGRESS')) ON CONFLICT ("appointmentId","resourceId") DO UPDATE SET "startAt"=EXCLUDED."startAt", "endAt"=EXCLUDED."endAt", active=EXCLUDED.active, retired=false;
 END IF;
 RETURN NEW;
END $$;
CREATE OR REPLACE FUNCTION product_update_resources() RETURNS trigger LANGUAGE plpgsql SECURITY INVOKER SET search_path = public, pg_temp AS $$
DECLARE allocation record;
BEGIN
 IF current_setting('app.reset_resource_snapshot', true) = NEW.id THEN
  UPDATE "ResourceBooking" SET active=false, retired=true WHERE "appointmentId"=NEW.id AND "salonId"=NEW."salonId";
  RETURN NEW;
 END IF;
 IF NEW.status::text IN ('PENDING','CONFIRMED','IN_PROGRESS') AND (NEW."startAt" IS DISTINCT FROM OLD."startAt" OR NEW."endAt" IS DISTINCT FROM OLD."endAt") THEN
  FOR allocation IN SELECT "resourceId" FROM "ResourceBooking" WHERE "appointmentId"=NEW.id AND "salonId"=NEW."salonId" AND NOT retired ORDER BY "resourceId" LOOP
   PERFORM id FROM "PhysicalResource" WHERE id=allocation."resourceId" AND "salonId"=NEW."salonId" AND active FOR SHARE;
   IF NOT FOUND THEN RAISE EXCEPTION 'Resource unavailable' USING ERRCODE='23514'; END IF;
  END LOOP;
 END IF;
 UPDATE "ResourceBooking" SET "startAt"=NEW."startAt", "endAt"=NEW."endAt", active=NEW.status::text IN ('PENDING','CONFIRMED','IN_PROGRESS') WHERE "appointmentId"=NEW.id AND "salonId"=NEW."salonId" AND NOT retired;
 RETURN NEW;
END $$;
DROP TRIGGER IF EXISTS product_reserve_primary ON "Appointment";
CREATE TRIGGER product_reserve_primary AFTER INSERT ON "Appointment" FOR EACH ROW EXECUTE FUNCTION product_reserve_resource();
DROP TRIGGER IF EXISTS product_reserve_additional ON "AppointmentService";
CREATE TRIGGER product_reserve_additional AFTER INSERT ON "AppointmentService" FOR EACH ROW EXECUTE FUNCTION product_reserve_resource();
DROP TRIGGER IF EXISTS product_update_resources ON "Appointment";
CREATE TRIGGER product_update_resources AFTER UPDATE OF "startAt","endAt",status ON "Appointment" FOR EACH ROW EXECUTE FUNCTION product_update_resources();
REVOKE ALL ON FUNCTION product_reserve_resource(), product_update_resources() FROM PUBLIC;
COMMIT;
