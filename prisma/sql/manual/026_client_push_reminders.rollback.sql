-- Non-destructive rollback: disable CLIENT_PUSH_ENABLED, revert the application
-- and retain subscriptions/outbox history. Dropping the enum value is unsafe.
BEGIN TRANSACTION READ ONLY;
SELECT count(*) AS subscriptions FROM public."ClientPushSubscription";
SELECT channel, status, count(*) FROM public."NotificationOutbox" GROUP BY channel, status;
COMMIT;
