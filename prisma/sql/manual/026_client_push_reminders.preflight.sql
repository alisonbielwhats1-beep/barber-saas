BEGIN TRANSACTION READ ONLY;
SELECT current_database(), current_user, inet_server_addr(), inet_server_port();
SELECT to_regclass('public."ClientPushSubscription"') AS existing_subscription_table;
SELECT enumlabel FROM pg_enum WHERE enumtypid = 'public."NotificationChannel"'::regtype ORDER BY enumsortorder;
SELECT c.relname, c.relrowsecurity, c.relforcerowsecurity
FROM pg_class c WHERE c.oid IN ('public."NotificationOutbox"'::regclass, 'public."ClientProfile"'::regclass);
SELECT count(*) AS existing_notifications FROM public."NotificationOutbox";
COMMIT;
