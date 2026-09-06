DO $$ DECLARE item record; actual jsonb; BEGIN
  IF current_database() <> 'salon_schema_ci' THEN RAISE EXCEPTION 'Fixture exclusiva de salon_schema_ci'; END IF;
  FOR item IN SELECT * FROM "_018Preservation" LOOP
    IF item."tableName" = 'Appointment' THEN
      SELECT coalesce(jsonb_agg(to_jsonb(t) - 'checkedInAt' - 'checkedInById' ORDER BY id), '[]'::jsonb) INTO actual FROM "Appointment" t;
    ELSE
      EXECUTE format('SELECT coalesce(jsonb_agg(to_jsonb(t) ORDER BY id), ''[]''::jsonb) FROM %I t', item."tableName") INTO actual;
    END IF;
    IF actual IS DISTINCT FROM item.snapshot THEN RAISE EXCEPTION 'Dados alterados indevidamente em %', item."tableName"; END IF;
  END LOOP;
  IF EXISTS (SELECT 1 FROM "Appointment" WHERE "checkedInAt" IS NOT NULL OR "checkedInById" IS NOT NULL) THEN RAISE EXCEPTION 'Chegada não pode ser inferida de reservas antigas'; END IF;
END $$;
DROP TABLE "_018Preservation";
