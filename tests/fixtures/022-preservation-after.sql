DO $$ DECLARE tab record; checksum text; BEGIN
 FOR tab IN SELECT * FROM test_022_before LOOP
  EXECUTE format('SELECT md5(coalesce(string_agg(md5(row_to_json(t)::text), %L ORDER BY md5(row_to_json(t)::text)), %L)) FROM public.%I t','','',tab.name) INTO checksum;
  IF checksum<>tab.fingerprint THEN RAISE EXCEPTION 'Predecessor alterado: %',tab.name; END IF;
 END LOOP;
END $$;
DROP TABLE test_022_before;

