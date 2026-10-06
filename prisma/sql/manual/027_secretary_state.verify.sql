-- Read-only checks after 027: FORCE RLS and policies on the three tables, the append-only event guard, the uniqueness the
-- store relies on, the runtime grants (events never UPDATE/DELETE) and no grant to PUBLIC or anon.
DO $$ BEGIN
 IF (SELECT count(*) FROM pg_class WHERE oid IN ('public."SecretaryConversation"'::regclass, 'public."SecretaryConversationEvent"'::regclass, 'public."SecretaryNameAlias"'::regclass)
   AND relrowsecurity AND relforcerowsecurity) <> 3 THEN RAISE EXCEPTION 'Missing secretary state FORCE RLS'; END IF;
 IF (SELECT count(*) FROM pg_policies WHERE schemaname='public' AND tablename='SecretaryConversation') <> 4 THEN RAISE EXCEPTION 'Unexpected conversation policies'; END IF;
 IF (SELECT count(*) FROM pg_policies WHERE schemaname='public' AND tablename='SecretaryConversationEvent') <> 2 THEN RAISE EXCEPTION 'Unexpected event policies'; END IF;
 IF (SELECT count(*) FROM pg_policies WHERE schemaname='public' AND tablename='SecretaryNameAlias') <> 4 THEN RAISE EXCEPTION 'Unexpected alias policies'; END IF;
 IF NOT EXISTS(SELECT 1 FROM pg_policies WHERE schemaname='public' AND tablename='SecretaryNameAlias' AND policyname='secretary_name_alias_delete' AND cmd='DELETE'
   AND qual LIKE '%OWNER%' AND qual LIKE '%MANAGER%') THEN RAISE EXCEPTION 'Alias delete is not limited to OWNER/MANAGER'; END IF;
 IF NOT EXISTS(SELECT 1 FROM pg_policies WHERE schemaname='public' AND tablename='SecretaryConversation' AND policyname='secretary_conversation_read' AND qual LIKE '%app_current_user()%')
   THEN RAISE EXCEPTION 'Conversation read policy is not per user'; END IF;
 IF NOT EXISTS(SELECT 1 FROM pg_trigger WHERE tgrelid='public."SecretaryConversationEvent"'::regclass AND tgname='secretary_conversation_event_append_only') THEN RAISE EXCEPTION 'Missing append-only event guard'; END IF;
 IF NOT EXISTS(SELECT 1 FROM pg_constraint WHERE conrelid='public."SecretaryConversationEvent"'::regclass AND conname='SecretaryConversationEvent_conversationId_seq_key') THEN RAISE EXCEPTION 'Missing event sequence uniqueness'; END IF;
 IF NOT EXISTS(SELECT 1 FROM pg_constraint WHERE conrelid='public."SecretaryConversationEvent"'::regclass AND conname='SecretaryConversationEvent_conversationId_clientTurnId_key') THEN RAISE EXCEPTION 'Missing client turn uniqueness'; END IF;
 IF NOT EXISTS(SELECT 1 FROM pg_constraint WHERE conrelid='public."SecretaryNameAlias"'::regclass AND conname='SecretaryNameAlias_salonId_kind_aliasFolded_key') THEN RAISE EXCEPTION 'Missing alias uniqueness'; END IF;
 IF NOT EXISTS(SELECT 1 FROM pg_constraint WHERE conrelid='public."SecretaryConversation"'::regclass AND conname='SecretaryConversation_retention') THEN RAISE EXCEPTION 'Missing conversation retention bound'; END IF;
 IF EXISTS(SELECT 1 FROM pg_roles WHERE rolname='app_runtime' AND (rolsuper OR rolbypassrls)) THEN RAISE EXCEPTION 'Unsafe runtime role'; END IF;
 IF EXISTS(SELECT 1 FROM pg_roles WHERE rolname='app_runtime') AND (has_table_privilege('app_runtime','"SecretaryConversationEvent"','UPDATE') OR has_table_privilege('app_runtime','"SecretaryConversationEvent"','DELETE'))
   THEN RAISE EXCEPTION 'Runtime may change events'; END IF;
 -- has_table_privilege with a list is true when ANY is held: every expected grant is checked on its own.
 IF EXISTS(SELECT 1 FROM pg_roles WHERE rolname='app_runtime') AND EXISTS(SELECT 1 FROM (VALUES
   ('"SecretaryConversation"','SELECT'),('"SecretaryConversation"','INSERT'),('"SecretaryConversation"','UPDATE'),('"SecretaryConversation"','DELETE'),
   ('"SecretaryConversationEvent"','SELECT'),('"SecretaryConversationEvent"','INSERT'),
   ('"SecretaryNameAlias"','SELECT'),('"SecretaryNameAlias"','INSERT'),('"SecretaryNameAlias"','UPDATE'),('"SecretaryNameAlias"','DELETE')) AS expected(tbl, priv)
   WHERE NOT has_table_privilege('app_runtime', expected.tbl, expected.priv)) THEN RAISE EXCEPTION 'Missing runtime grants'; END IF;
 IF EXISTS(SELECT 1 FROM pg_roles WHERE rolname='anon') AND (has_table_privilege('anon','"SecretaryConversation"','SELECT,INSERT,UPDATE,DELETE')
   OR has_table_privilege('anon','"SecretaryConversationEvent"','SELECT,INSERT,UPDATE,DELETE') OR has_table_privilege('anon','"SecretaryNameAlias"','SELECT,INSERT,UPDATE,DELETE'))
   THEN RAISE EXCEPTION 'Unexpected anon grant'; END IF;
 IF has_table_privilege('public','"SecretaryConversation"','SELECT,INSERT,UPDATE,DELETE') OR has_table_privilege('public','"SecretaryConversationEvent"','SELECT,INSERT,UPDATE,DELETE')
   OR has_table_privilege('public','"SecretaryNameAlias"','SELECT,INSERT,UPDATE,DELETE') THEN RAISE EXCEPTION 'Unexpected PUBLIC grant'; END IF;
END $$;
