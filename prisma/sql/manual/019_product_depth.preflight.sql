BEGIN TRANSACTION READ ONLY;
DO $$ BEGIN
 IF current_database() <> 'salon_schema_ci' THEN RAISE EXCEPTION '019: only the authorized disposable GitHub database is allowed'; END IF;
 IF to_regprocedure('public.app_current_salon()') IS NULL OR to_regclass('public."ProfessionalOpening"') IS NULL THEN RAISE EXCEPTION '019: predecessor schema missing'; END IF;
 IF EXISTS (SELECT 1 FROM "Service" WHERE "durationMin" <= 0) THEN RAISE EXCEPTION '019: invalid legacy service duration'; END IF;
 IF EXISTS (SELECT 1 FROM "Appointment" a LEFT JOIN "ClientProfile" c ON a."clientId"=c.id AND a."salonId"=c."salonId" WHERE c.id IS NULL) THEN RAISE EXCEPTION '019: invalid existing tenant relation'; END IF;
END $$;
COMMIT;
