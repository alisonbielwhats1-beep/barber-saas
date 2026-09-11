-- 022 Agente Chefe: aditiva. Preflight, backup e autorização antes de Production.
BEGIN;
CREATE TABLE IF NOT EXISTS public.hq_agent_runs (
 id uuid PRIMARY KEY,
 "actorId" text NOT NULL REFERENCES public."User"(id) ON DELETE RESTRICT,
 question text NOT NULL CHECK (length(question) BETWEEN 3 AND 1000),
 answer text,
 snapshot jsonb NOT NULL,
 sources jsonb NOT NULL CHECK (jsonb_typeof(sources)='array'),
 status text NOT NULL CHECK (status IN ('running','completed','failed')),
 "errorCode" text,
 model text NOT NULL,
 "promptVersion" text NOT NULL,
 "chargeMicros" integer NOT NULL CHECK ("chargeMicros">=0),
 "inputTokens" integer CHECK ("inputTokens">=0),
 "outputTokens" integer CHECK ("outputTokens">=0),
 "createdAt" timestamptz(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
 "finishedAt" timestamptz(3),
 CHECK ((status='running' AND "finishedAt" IS NULL) OR (status<>'running' AND "finishedAt" IS NOT NULL)),
 CHECK (status<>'completed' OR (answer IS NOT NULL AND "inputTokens" IS NOT NULL AND "outputTokens" IS NOT NULL))
);
CREATE INDEX IF NOT EXISTS hq_agent_runs_created_idx ON public.hq_agent_runs ("createdAt");
CREATE INDEX IF NOT EXISTS hq_agent_runs_actor_created_idx ON public.hq_agent_runs ("actorId","createdAt");
ALTER TABLE public.hq_agent_runs ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.hq_agent_runs FORCE ROW LEVEL SECURITY;
REVOKE ALL ON public.hq_agent_runs FROM PUBLIC;
DROP POLICY IF EXISTS hq_select ON public.hq_agent_runs;
CREATE POLICY hq_select ON public.hq_agent_runs FOR SELECT USING (public.hq_is_admin());
DROP POLICY IF EXISTS hq_insert ON public.hq_agent_runs;
CREATE POLICY hq_insert ON public.hq_agent_runs FOR INSERT WITH CHECK (public.hq_is_admin() AND "actorId"=current_setting('app.current_user_id',true));
DROP POLICY IF EXISTS hq_update ON public.hq_agent_runs;
CREATE POLICY hq_update ON public.hq_agent_runs FOR UPDATE USING (public.hq_is_admin()) WITH CHECK (public.hq_is_admin());
DO $$ BEGIN
 IF EXISTS (SELECT 1 FROM pg_roles WHERE rolname='anon') THEN REVOKE ALL ON public.hq_agent_runs FROM anon; END IF;
 IF EXISTS (SELECT 1 FROM pg_roles WHERE rolname='authenticated') THEN REVOKE ALL ON public.hq_agent_runs FROM authenticated; END IF;
 IF EXISTS (SELECT 1 FROM pg_roles WHERE rolname='app_runtime') THEN
  REVOKE ALL ON public.hq_agent_runs FROM app_runtime;
  GRANT SELECT, INSERT, UPDATE ON public.hq_agent_runs TO app_runtime;
 END IF;
END $$;
COMMIT;
