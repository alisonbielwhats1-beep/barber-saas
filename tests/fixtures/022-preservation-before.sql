-- Somente CI sintético. Inventário do predecessor, antes da migration 022.
CREATE TABLE test_022_before (name text PRIMARY KEY, fingerprint text NOT NULL);
DO $$ DECLARE tab record; checksum text; BEGIN
 FOR tab IN SELECT tablename FROM pg_tables WHERE schemaname='public' AND tablename NOT IN ('test_022_before','hq_agent_runs') LOOP
  EXECUTE format('SELECT md5(coalesce(string_agg(md5(row_to_json(t)::text), %L ORDER BY md5(row_to_json(t)::text)), %L)) FROM public.%I t','','',tab.tablename) INTO checksum;
  INSERT INTO test_022_before VALUES(tab.tablename,checksum);
 END LOOP;
END $$;

