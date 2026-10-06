-- Retention purge for 027: expired conversations (their events cascade with them), aliases nobody used for a year and
-- customer aliases whose customer was merged or erased. The runtime only removes its own expired conversations when the
-- owner starts one; this catches users who never come back, so it MUST be scheduled (027_secretary_state.schedule.sql, or
-- the platform job runner every 30 minutes) before SALON_SECRETARY_PERSISTED_STATE or SALON_SECRETARY_NAME_ALIASES is on.
-- FORCE RLS applies to the table owner too, so this runs as a maintenance role that bypasses RLS (superuser or
-- BYPASSRLS) and fails closed with any other role. Never the runtime.
BEGIN;
DO $$ BEGIN
 IF NOT EXISTS (SELECT 1 FROM pg_roles WHERE rolname = current_user AND (rolsuper OR rolbypassrls)) THEN
  RAISE EXCEPTION '027 purge: run as the maintenance role (superuser or BYPASSRLS); nothing was deleted';
 END IF;
END $$;
DELETE FROM "SecretaryConversation" WHERE "expiresAt" < now();
DELETE FROM "SecretaryNameAlias" a WHERE a."lastUsedAt" < now() - interval '365 days'
  OR (a."kind" = 'customer' AND NOT EXISTS (SELECT 1 FROM "ClientProfile" c WHERE c."id" = a."targetId" AND c."salonId" = a."salonId" AND c."mergedIntoId" IS NULL));
COMMIT;
