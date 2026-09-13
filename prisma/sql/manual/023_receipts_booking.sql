-- Manual 023. Aplicação exige preflight, backup restaurável e autorização do ambiente.
BEGIN;
ALTER TABLE "AppointmentService" DROP CONSTRAINT IF EXISTS "AppointmentService_appointmentId_serviceId_key";
DROP INDEX IF EXISTS "AppointmentService_appointmentId_serviceId_key";
ALTER TABLE "Payment" ADD COLUMN IF NOT EXISTS "extraServices" jsonb NOT NULL DEFAULT '[]';
ALTER TABLE "Payment" ADD COLUMN IF NOT EXISTS "surchargeCents" integer NOT NULL DEFAULT 0;
ALTER TABLE "Payment" ADD COLUMN IF NOT EXISTS "adjustmentReason" text;
ALTER TABLE "Payment" ADD COLUMN IF NOT EXISTS "recordedAt" timestamptz(3);
UPDATE "Payment" SET "recordedAt"="paidAt" WHERE "recordedAt" IS NULL;
ALTER TABLE "Payment" ALTER COLUMN "recordedAt" SET DEFAULT CURRENT_TIMESTAMP;
ALTER TABLE "Payment" ALTER COLUMN "recordedAt" SET NOT NULL;
ALTER TABLE "FlexibleWaitlist" ADD COLUMN IF NOT EXISTS "serviceIds" text[] NOT NULL DEFAULT '{}';
CREATE TABLE IF NOT EXISTS "WaitlistOffer" (
 id text PRIMARY KEY, "salonId" text NOT NULL, "waitlistId" text NOT NULL,
 "professionalId" text NOT NULL, "startAt" timestamptz(3) NOT NULL, "endAt" timestamptz(3) NOT NULL,
 "expiresAt" timestamptz(3) NOT NULL, status text NOT NULL DEFAULT 'OFFERED',
 "serviceIds" text[] NOT NULL, "resourceIds" text[] NOT NULL, "serviceSnapshots" jsonb NOT NULL DEFAULT '[]', "priceCents" integer NOT NULL,
 "createdAt" timestamptz(3) NOT NULL DEFAULT CURRENT_TIMESTAMP, "appointmentId" text,
 FOREIGN KEY ("waitlistId","salonId") REFERENCES "FlexibleWaitlist"(id,"salonId") ON DELETE RESTRICT,
 FOREIGN KEY ("professionalId","salonId") REFERENCES "Professional"(id,"salonId") ON DELETE RESTRICT,
 FOREIGN KEY ("appointmentId","salonId") REFERENCES "Appointment"(id,"salonId") ON DELETE RESTRICT,
 CHECK (status IN ('OFFERED','ACCEPTED','DECLINED','EXPIRED','WITHDRAWN')),
 CHECK ("endAt">"startAt" AND "expiresAt"<="startAt" AND "priceCents">=0 AND cardinality("serviceIds") BETWEEN 1 AND 10)
);
ALTER TABLE "WaitlistOffer" ADD COLUMN IF NOT EXISTS "serviceSnapshots" jsonb NOT NULL DEFAULT '[]';
CREATE INDEX IF NOT EXISTS "WaitlistOffer_salonId_professionalId_status_expiresAt_idx" ON "WaitlistOffer"("salonId","professionalId",status,"expiresAt");
ALTER TABLE "WaitlistOffer" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "WaitlistOffer" FORCE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS offer_tenant ON "WaitlistOffer";
CREATE POLICY offer_tenant ON "WaitlistOffer" USING ("salonId"=app_current_salon()) WITH CHECK ("salonId"=app_current_salon());
REVOKE ALL ON "WaitlistOffer" FROM PUBLIC;
DO $$ DECLARE r text; BEGIN
 FOREACH r IN ARRAY ARRAY['anon','authenticated'] LOOP
 IF EXISTS(SELECT 1 FROM pg_roles WHERE rolname=r) THEN EXECUTE format('REVOKE ALL ON "WaitlistOffer" FROM %I',r); END IF;
 END LOOP;
 IF EXISTS(SELECT 1 FROM pg_roles WHERE rolname='app_runtime') THEN GRANT SELECT,INSERT,UPDATE ON "WaitlistOffer" TO app_runtime; END IF;
 IF NOT EXISTS(SELECT 1 FROM pg_constraint WHERE conname='payment_valid_adjustments') THEN
 ALTER TABLE "Payment" ADD CONSTRAINT payment_valid_adjustments CHECK (jsonb_typeof("extraServices")='array' AND "surchargeCents">=0 AND ("surchargeCents"=0 OR coalesce(length(trim("adjustmentReason")),0)>=3));
 END IF;
END $$;
-- Mesmo lock em ofertas, reservas e recursos: fecha a janela entre consulta e escrita.
-- O domínio adquire appointment/professional antes deste lock; nunca adquirir professional depois, salvo lock já possuído.
CREATE OR REPLACE FUNCTION booking_offer_guard() RETURNS trigger LANGUAGE plpgsql SECURITY INVOKER SET search_path=public,pg_temp AS $$
DECLARE gap interval;
BEGIN
 SELECT make_interval(mins => "bufferMinutes") INTO gap FROM "Salon" WHERE id=NEW."salonId";
 gap := coalesce(gap, interval '0 minutes');
 PERFORM pg_advisory_xact_lock(hashtextextended('offer-salon:'||NEW."salonId",0));
 IF TG_TABLE_NAME='WaitlistOffer' THEN
  IF NEW.status='OFFERED' AND NEW."expiresAt">clock_timestamp() THEN
   IF NOT EXISTS(SELECT 1 FROM "FlexibleWaitlist" w WHERE w.id=NEW."waitlistId" AND w."salonId"=NEW."salonId" AND w."professionalId"=NEW."professionalId" AND w.status='WAITING') THEN RAISE EXCEPTION 'Pedido indisponível'; END IF;
   IF EXISTS(SELECT 1 FROM "WaitlistOffer" o WHERE o."salonId"=NEW."salonId" AND o.id<>NEW.id AND o.status='OFFERED' AND o."expiresAt">clock_timestamp() AND (o."waitlistId"=NEW."waitlistId" OR ((o."professionalId"=NEW."professionalId" AND o."startAt"<NEW."endAt"+gap AND o."endAt"+gap>NEW."startAt") OR (o."resourceIds" && NEW."resourceIds" AND o."startAt"<NEW."endAt" AND o."endAt">NEW."startAt"))))
   OR EXISTS(SELECT 1 FROM "Appointment" a WHERE a."salonId"=NEW."salonId" AND a."professionalId"=NEW."professionalId" AND a.status::text IN ('PENDING','CONFIRMED','IN_PROGRESS') AND a."startAt"<NEW."endAt"+gap AND a."endAt"+gap>NEW."startAt")
   OR EXISTS(SELECT 1 FROM "ResourceBooking" r WHERE r."salonId"=NEW."salonId" AND r."resourceId"=ANY(NEW."resourceIds") AND r.active AND r."startAt"<NEW."endAt" AND r."endAt">NEW."startAt")
   THEN RAISE EXCEPTION 'Horário indisponível para oferta' USING ERRCODE='23P01'; END IF;
  END IF;
 ELSIF TG_TABLE_NAME='Appointment' THEN
  IF NEW.status::text IN ('PENDING','CONFIRMED','IN_PROGRESS') AND EXISTS(SELECT 1 FROM "WaitlistOffer" o WHERE o."salonId"=NEW."salonId" AND o."professionalId"=NEW."professionalId" AND o.status='OFFERED' AND o."expiresAt">clock_timestamp() AND o."startAt"<NEW."endAt"+gap AND o."endAt"+gap>NEW."startAt") THEN RAISE EXCEPTION 'Horário aguardando aceite da fila' USING ERRCODE='23P01'; END IF;
 ELSE
  IF NEW.active AND EXISTS(SELECT 1 FROM "WaitlistOffer" o WHERE o."salonId"=NEW."salonId" AND NEW."resourceId"=ANY(o."resourceIds") AND o.status='OFFERED' AND o."expiresAt">clock_timestamp() AND o."startAt"<NEW."endAt" AND o."endAt">NEW."startAt") THEN RAISE EXCEPTION 'Recurso aguardando aceite da fila' USING ERRCODE='23P01'; END IF;
 END IF;
 RETURN NEW;
END $$;
DROP TRIGGER IF EXISTS booking_offer_guard ON "WaitlistOffer";
CREATE TRIGGER booking_offer_guard BEFORE INSERT OR UPDATE ON "WaitlistOffer" FOR EACH ROW EXECUTE FUNCTION booking_offer_guard();
DROP TRIGGER IF EXISTS booking_offer_guard ON "Appointment";
CREATE TRIGGER booking_offer_guard BEFORE INSERT OR UPDATE OF "startAt","endAt","professionalId",status ON "Appointment" FOR EACH ROW EXECUTE FUNCTION booking_offer_guard();
DROP TRIGGER IF EXISTS booking_offer_guard ON "ResourceBooking";
CREATE TRIGGER booking_offer_guard BEFORE INSERT OR UPDATE ON "ResourceBooking" FOR EACH ROW EXECUTE FUNCTION booking_offer_guard();
REVOKE ALL ON FUNCTION booking_offer_guard() FROM PUBLIC;
COMMIT;
