DO $$
BEGIN
  IF EXISTS (
    SELECT 1 FROM migration020_test.records b FULL JOIN (
      SELECT 'Service'::text AS kind, id, to_jsonb(s) - 'priceType' - 'priceNote' AS payload, "priceType", "priceNote" FROM public."Service" s
      UNION ALL SELECT 'AppointmentService', id, to_jsonb(s) - 'priceType' - 'priceNote', "priceType", "priceNote" FROM public."AppointmentService" s
    ) a USING (kind, id)
    WHERE a.payload IS DISTINCT FROM b.payload OR a."priceType" IS DISTINCT FROM 'FIXED' OR a."priceNote" IS NOT NULL
  ) THEN RAISE EXCEPTION '020: legacy records changed'; END IF;
  IF EXISTS (SELECT 1 FROM migration020_test.security b JOIN pg_class a USING (oid)
    WHERE a.relrowsecurity IS DISTINCT FROM b.relrowsecurity OR a.relforcerowsecurity IS DISTINCT FROM b.relforcerowsecurity OR a.relacl::text IS DISTINCT FROM b.acl)
    THEN RAISE EXCEPTION '020: table security changed'; END IF;
END $$;
