-- Exclusivo do PostgreSQL descartável do CI, com dados do seed fictício.
CREATE TABLE "_018Preservation" ("tableName" text PRIMARY KEY, "snapshot" jsonb NOT NULL);
DO $$ DECLARE tbl text; BEGIN
  IF current_database() <> 'salon_schema_ci' THEN RAISE EXCEPTION 'Fixture exclusiva de salon_schema_ci'; END IF;
  IF (SELECT count(*) FROM "Appointment") = 0 THEN RAISE EXCEPTION 'Upgrade requer reservas existentes'; END IF;
  FOREACH tbl IN ARRAY ARRAY['Salon', 'User', 'Professional', 'ClientProfile', 'Appointment', 'WorkingHours', 'TimeOff', 'AuditLog'] LOOP
    EXECUTE format('INSERT INTO "_018Preservation" SELECT %L, coalesce(jsonb_agg(to_jsonb(t) ORDER BY id), ''[]''::jsonb) FROM %I t', tbl, tbl);
  END LOOP;
END $$;
