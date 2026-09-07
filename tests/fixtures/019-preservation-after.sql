DO $$ DECLARE mismatches integer; BEGIN
 IF current_database()<>'salon_schema_ci' THEN RAISE EXCEPTION 'Not disposable CI'; END IF;
 WITH after_rows AS (
 SELECT 'Service' kind,id,to_jsonb(s)-ARRAY['processingMin','finishingMin','physicalResourceId','variantGroup','variantLabel'] value FROM "Service" s
 UNION ALL SELECT 'Appointment',id,to_jsonb(s)-ARRAY['dependentId','dependentName'] FROM "Appointment" s
 UNION ALL SELECT 'AppointmentService',"appointmentId"||':'||position,to_jsonb(s)-ARRAY['processingMin','finishingMin'] FROM "AppointmentService" s
 UNION ALL SELECT 'ClientProfile',id,to_jsonb(s) FROM "ClientProfile" s
 ) SELECT count(*) INTO mismatches FROM ci019_before b FULL JOIN after_rows a USING(kind,id) WHERE a.value IS DISTINCT FROM b.value;
 IF mismatches<>0 THEN RAISE EXCEPTION '019 changed % existing records',mismatches; END IF;
END $$;
