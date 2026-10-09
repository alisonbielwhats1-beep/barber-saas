-- Non-destructive rollback: disable PLATFORM_PLAN_GRANTS_ENABLED and revert code.
-- That removes courtesy access; coordinate with affected owners first.
-- Keep every grant and HQ audit entry. Never DROP or truncate these records.
BEGIN READ ONLY;
SELECT "planCode",count(*) AS grants FROM public."SalonPlanGrant" GROUP BY "planCode";
COMMIT;
