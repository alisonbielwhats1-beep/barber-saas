-- Additive. Run 027_secretary_state.preflight.sql first (read-only; it accepts only the local disposable cluster
-- everflair_service_mvp@127.0.0.1:55441 or the CI database salon_schema_ci). Never Production without approval.
-- D1 (rec 17): the Secretary's conversation state outlives one process, behind SALON_SECRETARY_PERSISTED_STATE, and the
-- names the owner taught by picking a candidate, behind SALON_SECRETARY_NAME_ALIASES (both default off).
-- Raw-SQL tables, no Prisma model (prisma/schema.prisma untouched): the application reaches them through $queryRaw inside
-- withTenant (app.current_salon + app.current_user_id).
--  * "SecretaryConversation": one row per top-level conversation (id = the Secretary sessionId), owned by one user of one
--    salon (RLS by salon AND user). "state" holds the exact JSON text of the orchestrator aggregate (it contains customer
--    names and the owner's words). A conversation lives at most 2 h from its start, on the database clock. Expired rows are
--    deleted when their owner starts a conversation and by 027_secretary_state.purge.sql, which MUST be scheduled
--    (027_secretary_state.schedule.sql or the platform job runner, every 30 min) before either flag is turned on: without
--    it an expired conversation of a user who never comes back stays stored. Optimistic concurrency: "version" moves on every
--    lease and every save (UPDATE … WHERE version = expected); "leaseUntil" marks a turn in progress (never a DB
--    transaction held across a model call).
--  * "SecretaryConversationEvent": append-only (UPDATE refused; DELETE only through the conversation's own removal),
--    codes-only payload, UNIQUE(conversationId, seq) and UNIQUE(conversationId, clientTurnId).
--  * "SecretaryNameAlias": salon-wide (RLS by salon), folded typed text → chosen entity id; deleting one needs an
--    OWNER or MANAGER membership.
BEGIN;
SELECT pg_advisory_xact_lock(hashtextextended('migration:027_secretary_state',0));

CREATE TABLE IF NOT EXISTS "SecretaryConversation" (
  "id" UUID PRIMARY KEY,
  "salonId" TEXT NOT NULL REFERENCES "Salon"("id") ON DELETE CASCADE,
  "userId" TEXT NOT NULL REFERENCES "User"("id") ON DELETE CASCADE,
  "status" TEXT NOT NULL DEFAULT 'OPEN' CHECK ("status" IN ('OPEN','CANCELLED','CLOSED','EXPIRED')),
  "version" INTEGER NOT NULL DEFAULT 1 CHECK ("version" > 0),
  "stateSchema" INTEGER NOT NULL CHECK ("stateSchema" > 0),
  "state" JSONB NOT NULL CHECK (jsonb_typeof("state")='object' AND jsonb_typeof("state"->'json')='string' AND octet_length("state"::text) <= 4194304),
  "leaseUntil" TIMESTAMPTZ(3),
  "expiresAt" TIMESTAMPTZ(3) NOT NULL,
  "createdAt" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "SecretaryConversation_salonId_id_key" UNIQUE ("salonId","id"),
  -- A conversation lives at most 2 h from its start (activity slides it). The store computes "expiresAt" on the database
  -- clock (now() + the time left, never past "createdAt" + 2 h), so an application clock far from it cannot break this.
  CONSTRAINT "SecretaryConversation_retention" CHECK ("expiresAt" <= "createdAt" + interval '3 hours')
);
CREATE INDEX IF NOT EXISTS "SecretaryConversation_actor_open_idx" ON "SecretaryConversation"("salonId","userId","status","updatedAt");
CREATE INDEX IF NOT EXISTS "SecretaryConversation_expiresAt_idx" ON "SecretaryConversation"("expiresAt");

CREATE TABLE IF NOT EXISTS "SecretaryConversationEvent" (
  "id" UUID PRIMARY KEY,
  "conversationId" UUID NOT NULL,
  "salonId" TEXT NOT NULL,
  "userId" TEXT NOT NULL,
  "seq" INTEGER NOT NULL CHECK ("seq" > 0),
  "kind" TEXT NOT NULL CHECK ("kind" IN ('TURN_STARTED','TURN_OUTCOME','SELECTION','CONFIRMATION','DISCARD','RESUME','CANCEL')),
  "clientTurnId" UUID,
  -- Codes only (never names, messages or ids of customers): bounded.
  "payload" JSONB NOT NULL DEFAULT '{}'::jsonb CHECK (jsonb_typeof("payload")='object' AND octet_length("payload"::text) <= 2048),
  "createdAt" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "SecretaryConversationEvent_conversation_fkey" FOREIGN KEY ("salonId","conversationId")
    REFERENCES "SecretaryConversation"("salonId","id") ON DELETE CASCADE,
  CONSTRAINT "SecretaryConversationEvent_conversationId_seq_key" UNIQUE ("conversationId","seq"),
  CONSTRAINT "SecretaryConversationEvent_conversationId_clientTurnId_key" UNIQUE ("conversationId","clientTurnId")
);
CREATE INDEX IF NOT EXISTS "SecretaryConversationEvent_salonId_createdAt_idx" ON "SecretaryConversationEvent"("salonId","createdAt");

CREATE TABLE IF NOT EXISTS "SecretaryNameAlias" (
  "id" UUID PRIMARY KEY,
  "salonId" TEXT NOT NULL REFERENCES "Salon"("id") ON DELETE CASCADE,
  "kind" TEXT NOT NULL CHECK ("kind" IN ('customer','professional','service')),
  "aliasFolded" TEXT NOT NULL CHECK (char_length("aliasFolded") BETWEEN 2 AND 200),
  "targetId" TEXT NOT NULL CHECK (char_length("targetId") BETWEEN 1 AND 100),
  -- sha256 of the sorted ids the exact/substring search returned when the owner picked (empty set included).
  "candidateSet" TEXT CHECK ("candidateSet" IS NULL OR "candidateSet" ~ '^[0-9a-f]{64}$'),
  "createdBy" TEXT REFERENCES "User"("id") ON DELETE SET NULL,
  "createdAt" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "lastUsedAt" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "useCount" INTEGER NOT NULL DEFAULT 1 CHECK ("useCount" >= 0),
  CONSTRAINT "SecretaryNameAlias_salonId_kind_aliasFolded_key" UNIQUE ("salonId","kind","aliasFolded")
);
CREATE INDEX IF NOT EXISTS "SecretaryNameAlias_lastUsedAt_idx" ON "SecretaryNameAlias"("lastUsedAt");

-- Events are append-only. The only DELETE allowed is the cascade of their conversation's own removal (the parent row is
-- already gone when the cascade runs).
CREATE OR REPLACE FUNCTION public.secretary_conversation_event_append_only() RETURNS trigger
LANGUAGE plpgsql SET search_path=pg_catalog,public AS $$
BEGIN
 IF TG_OP = 'DELETE' AND NOT EXISTS (SELECT 1 FROM public."SecretaryConversation" c WHERE c."id" = OLD."conversationId") THEN
  RETURN OLD;
 END IF;
 RAISE EXCEPTION 'Secretary conversation events are append-only';
END $$;
DROP TRIGGER IF EXISTS secretary_conversation_event_append_only ON "SecretaryConversationEvent";
CREATE TRIGGER secretary_conversation_event_append_only BEFORE UPDATE OR DELETE ON "SecretaryConversationEvent"
  FOR EACH ROW EXECUTE FUNCTION public.secretary_conversation_event_append_only();

ALTER TABLE "SecretaryConversation" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "SecretaryConversation" FORCE ROW LEVEL SECURITY;
ALTER TABLE "SecretaryConversationEvent" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "SecretaryConversationEvent" FORCE ROW LEVEL SECURITY;
ALTER TABLE "SecretaryNameAlias" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "SecretaryNameAlias" FORCE ROW LEVEL SECURITY;
REVOKE ALL ON "SecretaryConversation" FROM PUBLIC;
REVOKE ALL ON "SecretaryConversationEvent" FROM PUBLIC;
REVOKE ALL ON "SecretaryNameAlias" FROM PUBLIC;

-- Conversations: the authenticated user of the active salon only. Unlike 026, the read policy does not hide expired rows,
-- on purpose: PostgreSQL applies SELECT policies to the rows a DELETE … WHERE reads, so hiding them would stop the runtime
-- deleting its own expired conversations (and make an UPDATE that ends one an RLS error). Every runtime read and lease
-- already filters "expiresAt" > now(); the scheduled purge deletes the rest.
DROP POLICY IF EXISTS secretary_conversation_read ON "SecretaryConversation";
CREATE POLICY secretary_conversation_read ON "SecretaryConversation" FOR SELECT USING ("salonId" = app_current_salon() AND "userId" = app_current_user());
DROP POLICY IF EXISTS secretary_conversation_insert ON "SecretaryConversation";
CREATE POLICY secretary_conversation_insert ON "SecretaryConversation" FOR INSERT WITH CHECK ("salonId" = app_current_salon() AND "userId" = app_current_user());
DROP POLICY IF EXISTS secretary_conversation_update ON "SecretaryConversation";
CREATE POLICY secretary_conversation_update ON "SecretaryConversation" FOR UPDATE USING ("salonId" = app_current_salon() AND "userId" = app_current_user())
  WITH CHECK ("salonId" = app_current_salon() AND "userId" = app_current_user());
DROP POLICY IF EXISTS secretary_conversation_delete ON "SecretaryConversation";
CREATE POLICY secretary_conversation_delete ON "SecretaryConversation" FOR DELETE USING ("salonId" = app_current_salon() AND "userId" = app_current_user());

-- Events: read and append by the same user, only for a conversation that user owns (the subquery sees own rows only).
DROP POLICY IF EXISTS secretary_conversation_event_read ON "SecretaryConversationEvent";
CREATE POLICY secretary_conversation_event_read ON "SecretaryConversationEvent" FOR SELECT USING ("salonId" = app_current_salon() AND "userId" = app_current_user());
DROP POLICY IF EXISTS secretary_conversation_event_insert ON "SecretaryConversationEvent";
CREATE POLICY secretary_conversation_event_insert ON "SecretaryConversationEvent" FOR INSERT WITH CHECK ("salonId" = app_current_salon() AND "userId" = app_current_user()
  AND EXISTS (SELECT 1 FROM "SecretaryConversation" c WHERE c."id" = "conversationId" AND c."salonId" = "SecretaryConversationEvent"."salonId" AND c."userId" = "SecretaryConversationEvent"."userId"));

-- Aliases: shared by the salon's team; the learner is the authenticated user; only OWNER/MANAGER may delete one.
DROP POLICY IF EXISTS secretary_name_alias_read ON "SecretaryNameAlias";
CREATE POLICY secretary_name_alias_read ON "SecretaryNameAlias" FOR SELECT USING ("salonId" = app_current_salon());
DROP POLICY IF EXISTS secretary_name_alias_insert ON "SecretaryNameAlias";
CREATE POLICY secretary_name_alias_insert ON "SecretaryNameAlias" FOR INSERT WITH CHECK ("salonId" = app_current_salon() AND "createdBy" = app_current_user());
DROP POLICY IF EXISTS secretary_name_alias_update ON "SecretaryNameAlias";
CREATE POLICY secretary_name_alias_update ON "SecretaryNameAlias" FOR UPDATE USING ("salonId" = app_current_salon()) WITH CHECK ("salonId" = app_current_salon());
DROP POLICY IF EXISTS secretary_name_alias_delete ON "SecretaryNameAlias";
CREATE POLICY secretary_name_alias_delete ON "SecretaryNameAlias" FOR DELETE USING ("salonId" = app_current_salon() AND EXISTS (
  SELECT 1 FROM "Membership" m WHERE m."salonId" = app_current_salon() AND m."userId" = app_current_user() AND m."role" IN ('OWNER','MANAGER')));

DO $$ BEGIN
 IF EXISTS(SELECT 1 FROM pg_roles WHERE rolname='anon') THEN
  REVOKE ALL ON "SecretaryConversation" FROM anon; REVOKE ALL ON "SecretaryConversationEvent" FROM anon; REVOKE ALL ON "SecretaryNameAlias" FROM anon;
 END IF;
 IF EXISTS(SELECT 1 FROM pg_roles WHERE rolname='authenticated') THEN
  REVOKE ALL ON "SecretaryConversation" FROM authenticated; REVOKE ALL ON "SecretaryConversationEvent" FROM authenticated; REVOKE ALL ON "SecretaryNameAlias" FROM authenticated;
 END IF;
 IF EXISTS(SELECT 1 FROM pg_roles WHERE rolname='app_runtime') THEN
  REVOKE ALL ON "SecretaryConversation" FROM app_runtime;
  REVOKE ALL ON "SecretaryConversationEvent" FROM app_runtime;
  REVOKE ALL ON "SecretaryNameAlias" FROM app_runtime;
  GRANT SELECT,INSERT,UPDATE,DELETE ON "SecretaryConversation" TO app_runtime;
  GRANT SELECT,INSERT ON "SecretaryConversationEvent" TO app_runtime;
  GRANT SELECT,INSERT,UPDATE,DELETE ON "SecretaryNameAlias" TO app_runtime;
 END IF;
END $$;
COMMIT;
