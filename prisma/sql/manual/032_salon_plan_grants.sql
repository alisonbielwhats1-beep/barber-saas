-- Additive; run only after preflight, backup, staging validation and approval.
BEGIN;
CREATE TABLE IF NOT EXISTS public."SalonPlanGrant" (
 id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
 "salonId" text NOT NULL REFERENCES public."Salon"(id) ON DELETE RESTRICT,
 "actorUserId" text NOT NULL,
 "requestKey" uuid NOT NULL,
 "planCode" text NOT NULL,
 "catalogVersion" text NOT NULL,
 "amountCents" integer NOT NULL,
 "agendaLimit" integer NOT NULL,
 "throughDate" varchar(10) NOT NULL,
 reason text NOT NULL,
 "createdAt" timestamptz(3) NOT NULL DEFAULT now(),
 "endsAt" timestamptz(3) NOT NULL,
 "revokedAt" timestamptz(3),
 CONSTRAINT plan_grant_valid CHECK (
   "planCode" IN ('INDIVIDUAL','TEAM','TEAM_PLUS','TEAM_MAX')
   AND "amountCents">0 AND "agendaLimit" = CASE "planCode" WHEN 'INDIVIDUAL' THEN 1 WHEN 'TEAM' THEN 3 WHEN 'TEAM_PLUS' THEN 5 WHEN 'TEAM_MAX' THEN 10 END
   AND "endsAt">"createdAt" AND length(reason) BETWEEN 3 AND 500
   AND "throughDate" ~ '^[0-9]{4}-[0-9]{2}-[0-9]{2}$'
 ),
 CONSTRAINT "SalonPlanGrant_salonId_requestKey_key" UNIQUE ("salonId","requestKey")
);
CREATE INDEX IF NOT EXISTS "SalonPlanGrant_salonId_endsAt_idx" ON public."SalonPlanGrant" ("salonId","endsAt");
CREATE UNIQUE INDEX IF NOT EXISTS plan_grant_current ON public."SalonPlanGrant" ("salonId") WHERE "revokedAt" IS NULL;
ALTER TABLE public."SalonPlanGrant" ENABLE ROW LEVEL SECURITY;
ALTER TABLE public."SalonPlanGrant" FORCE ROW LEVEL SECURITY;
REVOKE ALL ON public."SalonPlanGrant" FROM PUBLIC;
DROP POLICY IF EXISTS plan_grant_read ON public."SalonPlanGrant";
CREATE POLICY plan_grant_read ON public."SalonPlanGrant" FOR SELECT USING
 ("salonId"=current_setting('app.current_salon',true) OR public.hq_is_admin());
DROP POLICY IF EXISTS plan_grant_insert ON public."SalonPlanGrant";
CREATE POLICY plan_grant_insert ON public."SalonPlanGrant" FOR INSERT WITH CHECK
 (public.hq_is_admin() AND "actorUserId"=current_setting('app.current_user_id',true));
DROP POLICY IF EXISTS plan_grant_update ON public."SalonPlanGrant";
CREATE POLICY plan_grant_update ON public."SalonPlanGrant" FOR UPDATE USING
 (public.hq_is_admin()) WITH CHECK (public.hq_is_admin());
CREATE OR REPLACE FUNCTION public.protect_plan_grant() RETURNS trigger
 LANGUAGE plpgsql SET search_path=pg_catalog,public AS $$
BEGIN
 IF TG_OP='DELETE' THEN RAISE EXCEPTION 'Plan grant history is immutable'; END IF;
 IF (to_jsonb(NEW)-'revokedAt') IS DISTINCT FROM (to_jsonb(OLD)-'revokedAt')
    OR OLD."revokedAt" IS NOT NULL OR NEW."revokedAt" IS NULL THEN
   RAISE EXCEPTION 'Only first revocation of a plan grant is permitted';
 END IF;
 RETURN NEW;
END $$;
DROP TRIGGER IF EXISTS protect_plan_grant ON public."SalonPlanGrant";
CREATE TRIGGER protect_plan_grant BEFORE UPDATE OR DELETE ON public."SalonPlanGrant"
 FOR EACH ROW EXECUTE FUNCTION public.protect_plan_grant();
DO $$ BEGIN
 IF EXISTS(SELECT 1 FROM pg_roles WHERE rolname='anon') THEN REVOKE ALL ON public."SalonPlanGrant" FROM anon; END IF;
 IF EXISTS(SELECT 1 FROM pg_roles WHERE rolname='authenticated') THEN REVOKE ALL ON public."SalonPlanGrant" FROM authenticated; END IF;
 IF EXISTS(SELECT 1 FROM pg_roles WHERE rolname='app_runtime') THEN
   REVOKE ALL ON public."SalonPlanGrant" FROM app_runtime;
   GRANT SELECT,INSERT ON public."SalonPlanGrant" TO app_runtime;
   GRANT UPDATE("revokedAt") ON public."SalonPlanGrant" TO app_runtime;
 END IF;
END $$;
COMMIT;
