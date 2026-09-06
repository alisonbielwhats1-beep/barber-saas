DO $$ BEGIN
  IF (SELECT count(*) FROM information_schema.columns WHERE table_schema = 'public' AND table_name = 'Appointment' AND column_name IN ('checkedInAt', 'checkedInById')) <> 2 THEN RAISE EXCEPTION 'Check-in incompleto'; END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_class WHERE oid = '"ProfessionalOpening"'::regclass AND relrowsecurity AND relforcerowsecurity) THEN RAISE EXCEPTION 'RLS incompleta'; END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conrelid = '"ProfessionalOpening"'::regclass AND conname = 'ProfessionalOpening_valid_interval' AND convalidated) THEN RAISE EXCEPTION 'Constraint de intervalo ausente'; END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conrelid = '"ProfessionalOpening"'::regclass AND contype = 'f' AND array_length(conkey, 1) = 2) THEN RAISE EXCEPTION 'FK tenant ausente'; END IF;
END $$;
