BEGIN TRANSACTION READ ONLY;
DO $$ DECLARE n integer; BEGIN
 SELECT count(*) INTO n FROM pg_class WHERE oid IN ('"PhysicalResource"'::regclass,'"ResourceBooking"'::regclass,'"ClientDependent"'::regclass,'"CareEntry"'::regclass,'"FlexibleWaitlist"'::regclass,'"FlexibleWaitlistService"'::regclass) AND relrowsecurity AND relforcerowsecurity;
 IF n<>6 THEN RAISE EXCEPTION '019: RLS missing'; END IF;
 SELECT count(*) INTO n FROM pg_constraint WHERE conname IN ('resource_no_overlap','resource_valid_interval','resource_valid_kind','service_valid_stages','care_valid_content','dependent_valid_name','flexible_valid_window');
 IF n<>7 THEN RAISE EXCEPTION '019: integrity constraints missing'; END IF;
 SELECT count(*) INTO n FROM pg_trigger WHERE tgname IN ('product_reserve_primary','product_reserve_additional','product_update_resources') AND tgenabled='O';
 IF n<>3 THEN RAISE EXCEPTION '019: resource triggers missing'; END IF;
END $$;
COMMIT;
