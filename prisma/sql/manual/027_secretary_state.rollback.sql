-- Rollback of 027. Turn SALON_SECRETARY_PERSISTED_STATE and SALON_SECRETARY_NAME_ALIASES off (and restart the app) before
-- running it: open conversations are then lost (fail closed: SESSION_NOT_FOUND, nothing executes) and learned aliases are
-- dropped. Conversation state holds customer names and the owner's words; aliases hold typed names: export them first only
-- if the owner asked to keep them.
BEGIN;
SELECT pg_advisory_xact_lock(hashtextextended('migration:027_secretary_state',0));
SELECT (SELECT count(*) FROM "SecretaryConversation") AS conversations,
  (SELECT count(*) FROM "SecretaryConversationEvent") AS events,
  (SELECT count(*) FROM "SecretaryNameAlias") AS aliases;
DROP TABLE IF EXISTS "SecretaryConversationEvent";
DROP TABLE IF EXISTS "SecretaryConversation";
DROP TABLE IF EXISTS "SecretaryNameAlias";
DROP FUNCTION IF EXISTS public.secretary_conversation_event_append_only();
COMMIT;
