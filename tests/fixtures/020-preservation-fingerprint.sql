-- CI descartável: fingerprint somente das tabelas anteriores ao HQ.
SELECT format(
 'SELECT %L, count(*), md5(coalesce(string_agg(md5(row_to_json(t)::text), '''' ORDER BY md5(row_to_json(t)::text)), '''')) FROM public.%I t;', tablename,tablename
) FROM pg_tables WHERE schemaname='public' AND tablename NOT LIKE 'hq\_%' ORDER BY tablename
\gexec

