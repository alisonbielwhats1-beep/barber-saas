DO $$ BEGIN IF current_database()<>'salon_schema_ci' THEN RAISE EXCEPTION 'Not disposable CI'; END IF; END $$;
CREATE TABLE ci019_before (kind text, id text, value jsonb);
INSERT INTO ci019_before SELECT 'Service',id,to_jsonb(s) FROM "Service" s;
INSERT INTO ci019_before SELECT 'Appointment',id,to_jsonb(s) FROM "Appointment" s;
INSERT INTO ci019_before SELECT 'AppointmentService',"appointmentId"||':'||position,to_jsonb(s) FROM "AppointmentService" s;
INSERT INTO ci019_before SELECT 'ClientProfile',id,to_jsonb(s) FROM "ClientProfile" s;
