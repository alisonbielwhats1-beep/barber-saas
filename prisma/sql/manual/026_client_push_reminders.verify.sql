BEGIN TRANSACTION READ ONLY;
SELECT enumlabel FROM pg_enum WHERE enumtypid = 'public."NotificationChannel"'::regtype AND enumlabel = 'PUSH';
SELECT c.relname, c.relrowsecurity, c.relforcerowsecurity, p.polname,
       pg_get_expr(p.polqual, p.polrelid) AS using_expression,
       pg_get_expr(p.polwithcheck, p.polrelid) AS check_expression
FROM pg_class c LEFT JOIN pg_policy p ON p.polrelid = c.oid
WHERE c.oid = 'public."ClientPushSubscription"'::regclass;
SELECT conname, pg_get_constraintdef(oid) FROM pg_constraint
WHERE conrelid = 'public."ClientPushSubscription"'::regclass ORDER BY conname;
SELECT count(*) AS subscriptions FROM public."ClientPushSubscription";
COMMIT;
