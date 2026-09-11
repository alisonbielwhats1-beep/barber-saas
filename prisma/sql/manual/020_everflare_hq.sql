-- 020 Everflare HQ. Aditiva; aplicar somente após preflight e backup.
BEGIN;
CREATE TABLE IF NOT EXISTS public.hq_accounts (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  "name" TEXT NOT NULL,
  "business" TEXT NOT NULL,
  "phone" TEXT,
  "whatsapp" TEXT,
  "instagram" TEXT,
  "email" TEXT,
  "city" TEXT,
  "segment" TEXT,
  "source" TEXT,
  "owner" TEXT,
  "notes" TEXT,
  "risk" TEXT NOT NULL DEFAULT 'Baixo',
  CHECK ("risk" IN ('Baixo', 'Médio', 'Alto')),
  "priority" TEXT NOT NULL DEFAULT 'Baixa',
  CHECK ("priority" IN ('Baixa', 'Média', 'Alta', 'Crítica')),
  "nextAction" TEXT,
  "createdAt" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP
);
CREATE TABLE IF NOT EXISTS public.hq_leads (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  "accountId" UUID NOT NULL,
  "interest" TEXT,
  "needs" TEXT,
  "suggestedPlan" TEXT,
  "quotedCents" INTEGER NOT NULL DEFAULT 0,
  CHECK ("quotedCents" >= 0),
  "temperature" TEXT NOT NULL DEFAULT 'Frio',
  CHECK ("temperature" IN ('Frio', 'Morno', 'Quente')),
  "status" TEXT NOT NULL DEFAULT 'Aberto',
  CHECK ("status" IN ('Aberto', 'Convertido', 'Perdido')),
  "createdAt" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  UNIQUE ("accountId")
);
CREATE TABLE IF NOT EXISTS public.hq_customers (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  "accountId" UUID NOT NULL,
  "status" TEXT NOT NULL DEFAULT 'Teste',
  CHECK ("status" IN ('Teste', 'Ativo', 'Inadimplente', 'Pausado', 'Cancelado')),
  "startedAt" DATE,
  "paymentMethod" TEXT,
  "satisfaction" TEXT NOT NULL DEFAULT 'Não avaliada',
  CHECK ("satisfaction" IN ('Não avaliada', 'Satisfeito', 'Neutro', 'Insatisfeito')),
  "createdAt" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  UNIQUE ("accountId")
);
CREATE TABLE IF NOT EXISTS public.hq_opportunities (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  "accountId" UUID NOT NULL,
  "title" TEXT NOT NULL,
  "stage" TEXT NOT NULL DEFAULT 'Novo Lead',
  CHECK ("stage" IN ('Novo Lead', 'Contatado', 'Interessado', 'Demonstração', 'Teste Grátis', 'Negociação', 'Fechado', 'Perdido')),
  "valueCents" INTEGER NOT NULL DEFAULT 0,
  CHECK ("valueCents" >= 0),
  "probability" INTEGER NOT NULL DEFAULT 0,
  CHECK ("probability" >= 0 AND "probability" <= 100),
  "stageChangedAt" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "createdAt" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP
);
CREATE TABLE IF NOT EXISTS public.hq_subscriptions (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  "customerId" UUID NOT NULL,
  "plan" TEXT NOT NULL,
  "amountCents" INTEGER NOT NULL DEFAULT 0,
  CHECK ("amountCents" >= 0),
  "discountCents" INTEGER NOT NULL DEFAULT 0,
  CHECK ("discountCents" >= 0),
  "interval" TEXT NOT NULL DEFAULT 'Mensal',
  CHECK ("interval" IN ('Mensal', 'Anual')),
  "startedAt" DATE NOT NULL,
  "nextBillingAt" DATE NOT NULL,
  "status" TEXT NOT NULL DEFAULT 'Teste',
  CHECK ("status" IN ('Teste', 'Ativo', 'Inadimplente', 'Pausado', 'Cancelado')),
  "trialEnd" DATE,
  "cancelledAt" TIMESTAMPTZ(3),
  "provider" TEXT,
  "externalId" TEXT,
  "createdAt" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CHECK ("discountCents" <= "amountCents"),
  CHECK (status <> 'Teste' OR "trialEnd" IS NOT NULL),
  CHECK (status <> 'Cancelado' OR "cancelledAt" IS NOT NULL)
);
CREATE TABLE IF NOT EXISTS public.hq_payments (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  "subscriptionId" UUID NOT NULL,
  "reference" DATE NOT NULL,
  "dueDate" DATE NOT NULL,
  "amountCents" INTEGER NOT NULL DEFAULT 0,
  CHECK ("amountCents" >= 0),
  "status" TEXT NOT NULL DEFAULT 'Pendente',
  CHECK ("status" IN ('Pendente', 'Pago', 'Cancelado')),
  "paidDate" DATE,
  "method" TEXT,
  "notes" TEXT,
  "externalId" TEXT,
  "createdAt" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CHECK ((status = 'Pago') = ("paidDate" IS NOT NULL)),
  UNIQUE ("subscriptionId", "reference")
);
CREATE TABLE IF NOT EXISTS public.hq_activities (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  "accountId" UUID,
  "kind" TEXT NOT NULL DEFAULT 'WhatsApp',
  CHECK ("kind" IN ('WhatsApp', 'Ligação', 'Reunião', 'Demonstração', 'Follow-up', 'Observação', 'E-mail', 'Mudança de status', 'Pagamento', 'Suporte', 'Bug', 'Feature Request', 'Feedback')),
  "description" TEXT NOT NULL,
  "actorId" TEXT,
  "entityType" TEXT,
  "entityId" TEXT,
  "metadata" JSONB,
  "createdAt" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP
);
CREATE TABLE IF NOT EXISTS public.hq_followups (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  "accountId" UUID NOT NULL,
  "title" TEXT NOT NULL,
  "dueAt" TIMESTAMPTZ(3) NOT NULL,
  "status" TEXT NOT NULL DEFAULT 'Pendente',
  CHECK ("status" IN ('Pendente', 'Concluído', 'Cancelado')),
  "notes" TEXT,
  "owner" TEXT,
  "completedAt" TIMESTAMPTZ(3),
  "createdAt" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CHECK ((status = 'Concluído') = ("completedAt" IS NOT NULL))
);
CREATE TABLE IF NOT EXISTS public.hq_support_tickets (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  "customerId" UUID NOT NULL,
  "title" TEXT NOT NULL,
  "description" TEXT NOT NULL,
  "category" TEXT NOT NULL DEFAULT 'Dúvida',
  CHECK ("category" IN ('Dúvida', 'Suporte', 'Bug', 'Financeiro', 'Outro')),
  "priority" TEXT NOT NULL DEFAULT 'Baixa',
  CHECK ("priority" IN ('Baixa', 'Média', 'Alta', 'Crítica')),
  "status" TEXT NOT NULL DEFAULT 'Aberto',
  CHECK ("status" IN ('Aberto', 'Em análise', 'Aguardando cliente', 'Resolvido', 'Fechado')),
  "resolution" TEXT,
  "owner" TEXT,
  "createdAt" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP
);
CREATE TABLE IF NOT EXISTS public.hq_bugs (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  "title" TEXT NOT NULL,
  "description" TEXT NOT NULL,
  "evidence" TEXT,
  "priority" TEXT NOT NULL DEFAULT 'Baixa',
  CHECK ("priority" IN ('Baixa', 'Média', 'Alta', 'Crítica')),
  "impact" TEXT,
  "status" TEXT NOT NULL DEFAULT 'Aberto',
  CHECK ("status" IN ('Aberto', 'Em análise', 'Em correção', 'Resolvido', 'Fechado')),
  "version" TEXT,
  "resolution" TEXT,
  "resolvedAt" TIMESTAMPTZ(3),
  "createdAt" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP
);
CREATE TABLE IF NOT EXISTS public.hq_feature_requests (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  "title" TEXT NOT NULL,
  "description" TEXT NOT NULL,
  "category" TEXT,
  "status" TEXT NOT NULL DEFAULT 'Recebida',
  CHECK ("status" IN ('Recebida', 'Em análise', 'Planejada', 'Em desenvolvimento', 'Entregue', 'Descartada')),
  "priority" TEXT NOT NULL DEFAULT 'Baixa',
  CHECK ("priority" IN ('Baixa', 'Média', 'Alta', 'Crítica')),
  "impact" TEXT,
  "normalizedTitle" TEXT NOT NULL,
  "createdAt" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  UNIQUE ("normalizedTitle")
);
CREATE TABLE IF NOT EXISTS public.hq_bug_customers (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  "bugId" UUID NOT NULL,
  "customerId" UUID NOT NULL,
  "createdAt" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  UNIQUE ("bugId", "customerId")
);
CREATE TABLE IF NOT EXISTS public.hq_feature_request_customers (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  "featureId" UUID NOT NULL,
  "customerId" UUID NOT NULL,
  "createdAt" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  UNIQUE ("featureId", "customerId")
);
CREATE TABLE IF NOT EXISTS public.hq_feedbacks (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  "customerId" UUID NOT NULL,
  "kind" TEXT NOT NULL DEFAULT 'Elogio',
  CHECK ("kind" IN ('Elogio', 'Reclamação', 'Sugestão', 'Experiência', 'Usabilidade')),
  "description" TEXT NOT NULL,
  "activityId" UUID,
  "ticketId" UUID,
  "bugId" UUID,
  "featureId" UUID,
  "createdAt" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP
);
CREATE INDEX IF NOT EXISTS "hq_accounts_createdAt_idx" ON public.hq_accounts ("createdAt");
CREATE INDEX IF NOT EXISTS "hq_accounts_name_idx" ON public.hq_accounts ("name");
CREATE INDEX IF NOT EXISTS "hq_accounts_business_idx" ON public.hq_accounts ("business");
CREATE INDEX IF NOT EXISTS "hq_accounts_city_idx" ON public.hq_accounts ("city");
CREATE INDEX IF NOT EXISTS "hq_accounts_segment_idx" ON public.hq_accounts ("segment");
CREATE INDEX IF NOT EXISTS "hq_accounts_risk_idx" ON public.hq_accounts ("risk");
CREATE INDEX IF NOT EXISTS "hq_accounts_priority_idx" ON public.hq_accounts ("priority");
DO $$ BEGIN
 ALTER TABLE public.hq_leads ADD CONSTRAINT "hq_leads_accountId_fkey" FOREIGN KEY ("accountId") REFERENCES public.hq_accounts(id) ON DELETE RESTRICT;
EXCEPTION WHEN duplicate_object THEN NULL; END $$;
CREATE INDEX IF NOT EXISTS "hq_leads_createdAt_idx" ON public.hq_leads ("createdAt");
CREATE INDEX IF NOT EXISTS "hq_leads_accountId_idx" ON public.hq_leads ("accountId");
CREATE INDEX IF NOT EXISTS "hq_leads_temperature_idx" ON public.hq_leads ("temperature");
CREATE INDEX IF NOT EXISTS "hq_leads_status_idx" ON public.hq_leads ("status");
DO $$ BEGIN
 ALTER TABLE public.hq_customers ADD CONSTRAINT "hq_customers_accountId_fkey" FOREIGN KEY ("accountId") REFERENCES public.hq_accounts(id) ON DELETE RESTRICT;
EXCEPTION WHEN duplicate_object THEN NULL; END $$;
CREATE INDEX IF NOT EXISTS "hq_customers_createdAt_idx" ON public.hq_customers ("createdAt");
CREATE INDEX IF NOT EXISTS "hq_customers_accountId_idx" ON public.hq_customers ("accountId");
CREATE INDEX IF NOT EXISTS "hq_customers_status_idx" ON public.hq_customers ("status");
DO $$ BEGIN
 ALTER TABLE public.hq_opportunities ADD CONSTRAINT "hq_opportunities_accountId_fkey" FOREIGN KEY ("accountId") REFERENCES public.hq_accounts(id) ON DELETE RESTRICT;
EXCEPTION WHEN duplicate_object THEN NULL; END $$;
CREATE INDEX IF NOT EXISTS "hq_opportunities_createdAt_idx" ON public.hq_opportunities ("createdAt");
CREATE INDEX IF NOT EXISTS "hq_opportunities_accountId_idx" ON public.hq_opportunities ("accountId");
CREATE INDEX IF NOT EXISTS "hq_opportunities_stage_idx" ON public.hq_opportunities ("stage");
DO $$ BEGIN
 ALTER TABLE public.hq_subscriptions ADD CONSTRAINT "hq_subscriptions_customerId_fkey" FOREIGN KEY ("customerId") REFERENCES public.hq_customers(id) ON DELETE RESTRICT;
EXCEPTION WHEN duplicate_object THEN NULL; END $$;
CREATE INDEX IF NOT EXISTS "hq_subscriptions_createdAt_idx" ON public.hq_subscriptions ("createdAt");
CREATE INDEX IF NOT EXISTS "hq_subscriptions_customerId_idx" ON public.hq_subscriptions ("customerId");
CREATE INDEX IF NOT EXISTS "hq_subscriptions_nextBillingAt_idx" ON public.hq_subscriptions ("nextBillingAt");
CREATE INDEX IF NOT EXISTS "hq_subscriptions_status_idx" ON public.hq_subscriptions ("status");
DO $$ BEGIN
 ALTER TABLE public.hq_payments ADD CONSTRAINT "hq_payments_subscriptionId_fkey" FOREIGN KEY ("subscriptionId") REFERENCES public.hq_subscriptions(id) ON DELETE RESTRICT;
EXCEPTION WHEN duplicate_object THEN NULL; END $$;
CREATE INDEX IF NOT EXISTS "hq_payments_createdAt_idx" ON public.hq_payments ("createdAt");
CREATE INDEX IF NOT EXISTS "hq_payments_subscriptionId_idx" ON public.hq_payments ("subscriptionId");
CREATE INDEX IF NOT EXISTS "hq_payments_dueDate_idx" ON public.hq_payments ("dueDate");
CREATE INDEX IF NOT EXISTS "hq_payments_status_idx" ON public.hq_payments ("status");
DO $$ BEGIN
 ALTER TABLE public.hq_activities ADD CONSTRAINT "hq_activities_accountId_fkey" FOREIGN KEY ("accountId") REFERENCES public.hq_accounts(id) ON DELETE RESTRICT;
EXCEPTION WHEN duplicate_object THEN NULL; END $$;
CREATE INDEX IF NOT EXISTS "hq_activities_createdAt_idx" ON public.hq_activities ("createdAt");
CREATE INDEX IF NOT EXISTS "hq_activities_accountId_idx" ON public.hq_activities ("accountId");
DO $$ BEGIN
 ALTER TABLE public.hq_followups ADD CONSTRAINT "hq_followups_accountId_fkey" FOREIGN KEY ("accountId") REFERENCES public.hq_accounts(id) ON DELETE RESTRICT;
EXCEPTION WHEN duplicate_object THEN NULL; END $$;
CREATE INDEX IF NOT EXISTS "hq_followups_createdAt_idx" ON public.hq_followups ("createdAt");
CREATE INDEX IF NOT EXISTS "hq_followups_accountId_idx" ON public.hq_followups ("accountId");
CREATE INDEX IF NOT EXISTS "hq_followups_dueAt_idx" ON public.hq_followups ("dueAt");
CREATE INDEX IF NOT EXISTS "hq_followups_status_idx" ON public.hq_followups ("status");
DO $$ BEGIN
 ALTER TABLE public.hq_support_tickets ADD CONSTRAINT "hq_support_tickets_customerId_fkey" FOREIGN KEY ("customerId") REFERENCES public.hq_customers(id) ON DELETE RESTRICT;
EXCEPTION WHEN duplicate_object THEN NULL; END $$;
CREATE INDEX IF NOT EXISTS "hq_support_tickets_createdAt_idx" ON public.hq_support_tickets ("createdAt");
CREATE INDEX IF NOT EXISTS "hq_support_tickets_customerId_idx" ON public.hq_support_tickets ("customerId");
CREATE INDEX IF NOT EXISTS "hq_support_tickets_priority_idx" ON public.hq_support_tickets ("priority");
CREATE INDEX IF NOT EXISTS "hq_support_tickets_status_idx" ON public.hq_support_tickets ("status");
CREATE INDEX IF NOT EXISTS "hq_bugs_createdAt_idx" ON public.hq_bugs ("createdAt");
CREATE INDEX IF NOT EXISTS "hq_bugs_priority_idx" ON public.hq_bugs ("priority");
CREATE INDEX IF NOT EXISTS "hq_bugs_status_idx" ON public.hq_bugs ("status");
CREATE INDEX IF NOT EXISTS "hq_feature_requests_createdAt_idx" ON public.hq_feature_requests ("createdAt");
CREATE INDEX IF NOT EXISTS "hq_feature_requests_status_idx" ON public.hq_feature_requests ("status");
CREATE INDEX IF NOT EXISTS "hq_feature_requests_priority_idx" ON public.hq_feature_requests ("priority");
DO $$ BEGIN
 ALTER TABLE public.hq_bug_customers ADD CONSTRAINT "hq_bug_customers_bugId_fkey" FOREIGN KEY ("bugId") REFERENCES public.hq_bugs(id) ON DELETE RESTRICT;
EXCEPTION WHEN duplicate_object THEN NULL; END $$;
DO $$ BEGIN
 ALTER TABLE public.hq_bug_customers ADD CONSTRAINT "hq_bug_customers_customerId_fkey" FOREIGN KEY ("customerId") REFERENCES public.hq_customers(id) ON DELETE RESTRICT;
EXCEPTION WHEN duplicate_object THEN NULL; END $$;
CREATE INDEX IF NOT EXISTS "hq_bug_customers_createdAt_idx" ON public.hq_bug_customers ("createdAt");
CREATE INDEX IF NOT EXISTS "hq_bug_customers_bugId_idx" ON public.hq_bug_customers ("bugId");
CREATE INDEX IF NOT EXISTS "hq_bug_customers_customerId_idx" ON public.hq_bug_customers ("customerId");
DO $$ BEGIN
 ALTER TABLE public.hq_feature_request_customers ADD CONSTRAINT "hq_feature_request_customers_featureId_fkey" FOREIGN KEY ("featureId") REFERENCES public.hq_feature_requests(id) ON DELETE RESTRICT;
EXCEPTION WHEN duplicate_object THEN NULL; END $$;
DO $$ BEGIN
 ALTER TABLE public.hq_feature_request_customers ADD CONSTRAINT "hq_feature_request_customers_customerId_fkey" FOREIGN KEY ("customerId") REFERENCES public.hq_customers(id) ON DELETE RESTRICT;
EXCEPTION WHEN duplicate_object THEN NULL; END $$;
CREATE INDEX IF NOT EXISTS "hq_feature_request_customers_createdAt_idx" ON public.hq_feature_request_customers ("createdAt");
CREATE INDEX IF NOT EXISTS "hq_feature_request_customers_featureId_idx" ON public.hq_feature_request_customers ("featureId");
CREATE INDEX IF NOT EXISTS "hq_feature_request_customers_customerId_idx" ON public.hq_feature_request_customers ("customerId");
DO $$ BEGIN
 ALTER TABLE public.hq_feedbacks ADD CONSTRAINT "hq_feedbacks_customerId_fkey" FOREIGN KEY ("customerId") REFERENCES public.hq_customers(id) ON DELETE RESTRICT;
EXCEPTION WHEN duplicate_object THEN NULL; END $$;
DO $$ BEGIN
 ALTER TABLE public.hq_feedbacks ADD CONSTRAINT "hq_feedbacks_activityId_fkey" FOREIGN KEY ("activityId") REFERENCES public.hq_activities(id) ON DELETE RESTRICT;
EXCEPTION WHEN duplicate_object THEN NULL; END $$;
DO $$ BEGIN
 ALTER TABLE public.hq_feedbacks ADD CONSTRAINT "hq_feedbacks_ticketId_fkey" FOREIGN KEY ("ticketId") REFERENCES public.hq_support_tickets(id) ON DELETE RESTRICT;
EXCEPTION WHEN duplicate_object THEN NULL; END $$;
DO $$ BEGIN
 ALTER TABLE public.hq_feedbacks ADD CONSTRAINT "hq_feedbacks_bugId_fkey" FOREIGN KEY ("bugId") REFERENCES public.hq_bugs(id) ON DELETE RESTRICT;
EXCEPTION WHEN duplicate_object THEN NULL; END $$;
DO $$ BEGIN
 ALTER TABLE public.hq_feedbacks ADD CONSTRAINT "hq_feedbacks_featureId_fkey" FOREIGN KEY ("featureId") REFERENCES public.hq_feature_requests(id) ON DELETE RESTRICT;
EXCEPTION WHEN duplicate_object THEN NULL; END $$;
CREATE INDEX IF NOT EXISTS "hq_feedbacks_createdAt_idx" ON public.hq_feedbacks ("createdAt");
CREATE INDEX IF NOT EXISTS "hq_feedbacks_customerId_idx" ON public.hq_feedbacks ("customerId");
CREATE INDEX IF NOT EXISTS "hq_feedbacks_activityId_idx" ON public.hq_feedbacks ("activityId");
CREATE INDEX IF NOT EXISTS "hq_feedbacks_ticketId_idx" ON public.hq_feedbacks ("ticketId");
CREATE INDEX IF NOT EXISTS "hq_feedbacks_bugId_idx" ON public.hq_feedbacks ("bugId");
CREATE INDEX IF NOT EXISTS "hq_feedbacks_featureId_idx" ON public.hq_feedbacks ("featureId");

DO $$ BEGIN
 ALTER TABLE public.hq_activities ADD CONSTRAINT hq_activity_actor_fkey FOREIGN KEY ("actorId") REFERENCES public."User"(id) ON DELETE RESTRICT;
EXCEPTION WHEN duplicate_object THEN NULL; END $$;
CREATE OR REPLACE FUNCTION public.hq_is_admin() RETURNS boolean
LANGUAGE sql STABLE SET search_path = pg_catalog, public AS $$
 SELECT current_setting('app.hq_access', true) = 'enabled'
 AND EXISTS (SELECT 1 FROM public."User"
 WHERE id = NULLIF(current_setting('app.current_user_id', true), '')
 AND "platformRole" = 'SUPER_ADMIN')
$$;
REVOKE ALL ON FUNCTION public.hq_is_admin() FROM PUBLIC;
ALTER TABLE public.hq_accounts ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.hq_accounts FORCE ROW LEVEL SECURITY;
REVOKE ALL ON public.hq_accounts FROM PUBLIC;
DROP POLICY IF EXISTS hq_select ON public.hq_accounts;
CREATE POLICY hq_select ON public.hq_accounts FOR SELECT USING (public.hq_is_admin()) ;
DROP POLICY IF EXISTS hq_insert ON public.hq_accounts;
CREATE POLICY hq_insert ON public.hq_accounts FOR INSERT  WITH CHECK (public.hq_is_admin());
DROP POLICY IF EXISTS hq_update ON public.hq_accounts;
CREATE POLICY hq_update ON public.hq_accounts FOR UPDATE USING (public.hq_is_admin()) WITH CHECK (public.hq_is_admin());
DO $$ BEGIN
 IF EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'anon') THEN REVOKE ALL ON public.hq_accounts FROM anon; END IF;
 IF EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'authenticated') THEN REVOKE ALL ON public.hq_accounts FROM authenticated; END IF;
 IF EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'app_runtime') THEN
 REVOKE ALL ON public.hq_accounts FROM app_runtime;
 GRANT SELECT, INSERT, UPDATE ON public.hq_accounts TO app_runtime;
 GRANT EXECUTE ON FUNCTION public.hq_is_admin() TO app_runtime;
 END IF;
END $$;
ALTER TABLE public.hq_leads ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.hq_leads FORCE ROW LEVEL SECURITY;
REVOKE ALL ON public.hq_leads FROM PUBLIC;
DROP POLICY IF EXISTS hq_select ON public.hq_leads;
CREATE POLICY hq_select ON public.hq_leads FOR SELECT USING (public.hq_is_admin()) ;
DROP POLICY IF EXISTS hq_insert ON public.hq_leads;
CREATE POLICY hq_insert ON public.hq_leads FOR INSERT  WITH CHECK (public.hq_is_admin());
DROP POLICY IF EXISTS hq_update ON public.hq_leads;
CREATE POLICY hq_update ON public.hq_leads FOR UPDATE USING (public.hq_is_admin()) WITH CHECK (public.hq_is_admin());
DO $$ BEGIN
 IF EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'anon') THEN REVOKE ALL ON public.hq_leads FROM anon; END IF;
 IF EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'authenticated') THEN REVOKE ALL ON public.hq_leads FROM authenticated; END IF;
 IF EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'app_runtime') THEN
 REVOKE ALL ON public.hq_leads FROM app_runtime;
 GRANT SELECT, INSERT, UPDATE ON public.hq_leads TO app_runtime;
 GRANT EXECUTE ON FUNCTION public.hq_is_admin() TO app_runtime;
 END IF;
END $$;
ALTER TABLE public.hq_customers ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.hq_customers FORCE ROW LEVEL SECURITY;
REVOKE ALL ON public.hq_customers FROM PUBLIC;
DROP POLICY IF EXISTS hq_select ON public.hq_customers;
CREATE POLICY hq_select ON public.hq_customers FOR SELECT USING (public.hq_is_admin()) ;
DROP POLICY IF EXISTS hq_insert ON public.hq_customers;
CREATE POLICY hq_insert ON public.hq_customers FOR INSERT  WITH CHECK (public.hq_is_admin());
DROP POLICY IF EXISTS hq_update ON public.hq_customers;
CREATE POLICY hq_update ON public.hq_customers FOR UPDATE USING (public.hq_is_admin()) WITH CHECK (public.hq_is_admin());
DO $$ BEGIN
 IF EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'anon') THEN REVOKE ALL ON public.hq_customers FROM anon; END IF;
 IF EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'authenticated') THEN REVOKE ALL ON public.hq_customers FROM authenticated; END IF;
 IF EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'app_runtime') THEN
 REVOKE ALL ON public.hq_customers FROM app_runtime;
 GRANT SELECT, INSERT, UPDATE ON public.hq_customers TO app_runtime;
 GRANT EXECUTE ON FUNCTION public.hq_is_admin() TO app_runtime;
 END IF;
END $$;
ALTER TABLE public.hq_opportunities ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.hq_opportunities FORCE ROW LEVEL SECURITY;
REVOKE ALL ON public.hq_opportunities FROM PUBLIC;
DROP POLICY IF EXISTS hq_select ON public.hq_opportunities;
CREATE POLICY hq_select ON public.hq_opportunities FOR SELECT USING (public.hq_is_admin()) ;
DROP POLICY IF EXISTS hq_insert ON public.hq_opportunities;
CREATE POLICY hq_insert ON public.hq_opportunities FOR INSERT  WITH CHECK (public.hq_is_admin());
DROP POLICY IF EXISTS hq_update ON public.hq_opportunities;
CREATE POLICY hq_update ON public.hq_opportunities FOR UPDATE USING (public.hq_is_admin()) WITH CHECK (public.hq_is_admin());
DO $$ BEGIN
 IF EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'anon') THEN REVOKE ALL ON public.hq_opportunities FROM anon; END IF;
 IF EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'authenticated') THEN REVOKE ALL ON public.hq_opportunities FROM authenticated; END IF;
 IF EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'app_runtime') THEN
 REVOKE ALL ON public.hq_opportunities FROM app_runtime;
 GRANT SELECT, INSERT, UPDATE ON public.hq_opportunities TO app_runtime;
 GRANT EXECUTE ON FUNCTION public.hq_is_admin() TO app_runtime;
 END IF;
END $$;
ALTER TABLE public.hq_subscriptions ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.hq_subscriptions FORCE ROW LEVEL SECURITY;
REVOKE ALL ON public.hq_subscriptions FROM PUBLIC;
DROP POLICY IF EXISTS hq_select ON public.hq_subscriptions;
CREATE POLICY hq_select ON public.hq_subscriptions FOR SELECT USING (public.hq_is_admin()) ;
DROP POLICY IF EXISTS hq_insert ON public.hq_subscriptions;
CREATE POLICY hq_insert ON public.hq_subscriptions FOR INSERT  WITH CHECK (public.hq_is_admin());
DROP POLICY IF EXISTS hq_update ON public.hq_subscriptions;
CREATE POLICY hq_update ON public.hq_subscriptions FOR UPDATE USING (public.hq_is_admin()) WITH CHECK (public.hq_is_admin());
DO $$ BEGIN
 IF EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'anon') THEN REVOKE ALL ON public.hq_subscriptions FROM anon; END IF;
 IF EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'authenticated') THEN REVOKE ALL ON public.hq_subscriptions FROM authenticated; END IF;
 IF EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'app_runtime') THEN
 REVOKE ALL ON public.hq_subscriptions FROM app_runtime;
 GRANT SELECT, INSERT, UPDATE ON public.hq_subscriptions TO app_runtime;
 GRANT EXECUTE ON FUNCTION public.hq_is_admin() TO app_runtime;
 END IF;
END $$;
ALTER TABLE public.hq_payments ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.hq_payments FORCE ROW LEVEL SECURITY;
REVOKE ALL ON public.hq_payments FROM PUBLIC;
DROP POLICY IF EXISTS hq_select ON public.hq_payments;
CREATE POLICY hq_select ON public.hq_payments FOR SELECT USING (public.hq_is_admin()) ;
DROP POLICY IF EXISTS hq_insert ON public.hq_payments;
CREATE POLICY hq_insert ON public.hq_payments FOR INSERT  WITH CHECK (public.hq_is_admin());
DROP POLICY IF EXISTS hq_update ON public.hq_payments;
CREATE POLICY hq_update ON public.hq_payments FOR UPDATE USING (public.hq_is_admin()) WITH CHECK (public.hq_is_admin());
DO $$ BEGIN
 IF EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'anon') THEN REVOKE ALL ON public.hq_payments FROM anon; END IF;
 IF EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'authenticated') THEN REVOKE ALL ON public.hq_payments FROM authenticated; END IF;
 IF EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'app_runtime') THEN
 REVOKE ALL ON public.hq_payments FROM app_runtime;
 GRANT SELECT, INSERT, UPDATE ON public.hq_payments TO app_runtime;
 GRANT EXECUTE ON FUNCTION public.hq_is_admin() TO app_runtime;
 END IF;
END $$;
ALTER TABLE public.hq_activities ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.hq_activities FORCE ROW LEVEL SECURITY;
REVOKE ALL ON public.hq_activities FROM PUBLIC;
DROP POLICY IF EXISTS hq_select ON public.hq_activities;
CREATE POLICY hq_select ON public.hq_activities FOR SELECT USING (public.hq_is_admin()) ;
DROP POLICY IF EXISTS hq_insert ON public.hq_activities;
CREATE POLICY hq_insert ON public.hq_activities FOR INSERT  WITH CHECK (public.hq_is_admin());
DO $$ BEGIN
 IF EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'anon') THEN REVOKE ALL ON public.hq_activities FROM anon; END IF;
 IF EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'authenticated') THEN REVOKE ALL ON public.hq_activities FROM authenticated; END IF;
 IF EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'app_runtime') THEN
 REVOKE ALL ON public.hq_activities FROM app_runtime;
 GRANT SELECT, INSERT ON public.hq_activities TO app_runtime;
 GRANT EXECUTE ON FUNCTION public.hq_is_admin() TO app_runtime;
 END IF;
END $$;
ALTER TABLE public.hq_followups ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.hq_followups FORCE ROW LEVEL SECURITY;
REVOKE ALL ON public.hq_followups FROM PUBLIC;
DROP POLICY IF EXISTS hq_select ON public.hq_followups;
CREATE POLICY hq_select ON public.hq_followups FOR SELECT USING (public.hq_is_admin()) ;
DROP POLICY IF EXISTS hq_insert ON public.hq_followups;
CREATE POLICY hq_insert ON public.hq_followups FOR INSERT  WITH CHECK (public.hq_is_admin());
DROP POLICY IF EXISTS hq_update ON public.hq_followups;
CREATE POLICY hq_update ON public.hq_followups FOR UPDATE USING (public.hq_is_admin()) WITH CHECK (public.hq_is_admin());
DO $$ BEGIN
 IF EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'anon') THEN REVOKE ALL ON public.hq_followups FROM anon; END IF;
 IF EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'authenticated') THEN REVOKE ALL ON public.hq_followups FROM authenticated; END IF;
 IF EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'app_runtime') THEN
 REVOKE ALL ON public.hq_followups FROM app_runtime;
 GRANT SELECT, INSERT, UPDATE ON public.hq_followups TO app_runtime;
 GRANT EXECUTE ON FUNCTION public.hq_is_admin() TO app_runtime;
 END IF;
END $$;
ALTER TABLE public.hq_support_tickets ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.hq_support_tickets FORCE ROW LEVEL SECURITY;
REVOKE ALL ON public.hq_support_tickets FROM PUBLIC;
DROP POLICY IF EXISTS hq_select ON public.hq_support_tickets;
CREATE POLICY hq_select ON public.hq_support_tickets FOR SELECT USING (public.hq_is_admin()) ;
DROP POLICY IF EXISTS hq_insert ON public.hq_support_tickets;
CREATE POLICY hq_insert ON public.hq_support_tickets FOR INSERT  WITH CHECK (public.hq_is_admin());
DROP POLICY IF EXISTS hq_update ON public.hq_support_tickets;
CREATE POLICY hq_update ON public.hq_support_tickets FOR UPDATE USING (public.hq_is_admin()) WITH CHECK (public.hq_is_admin());
DO $$ BEGIN
 IF EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'anon') THEN REVOKE ALL ON public.hq_support_tickets FROM anon; END IF;
 IF EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'authenticated') THEN REVOKE ALL ON public.hq_support_tickets FROM authenticated; END IF;
 IF EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'app_runtime') THEN
 REVOKE ALL ON public.hq_support_tickets FROM app_runtime;
 GRANT SELECT, INSERT, UPDATE ON public.hq_support_tickets TO app_runtime;
 GRANT EXECUTE ON FUNCTION public.hq_is_admin() TO app_runtime;
 END IF;
END $$;
ALTER TABLE public.hq_bugs ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.hq_bugs FORCE ROW LEVEL SECURITY;
REVOKE ALL ON public.hq_bugs FROM PUBLIC;
DROP POLICY IF EXISTS hq_select ON public.hq_bugs;
CREATE POLICY hq_select ON public.hq_bugs FOR SELECT USING (public.hq_is_admin()) ;
DROP POLICY IF EXISTS hq_insert ON public.hq_bugs;
CREATE POLICY hq_insert ON public.hq_bugs FOR INSERT  WITH CHECK (public.hq_is_admin());
DROP POLICY IF EXISTS hq_update ON public.hq_bugs;
CREATE POLICY hq_update ON public.hq_bugs FOR UPDATE USING (public.hq_is_admin()) WITH CHECK (public.hq_is_admin());
DO $$ BEGIN
 IF EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'anon') THEN REVOKE ALL ON public.hq_bugs FROM anon; END IF;
 IF EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'authenticated') THEN REVOKE ALL ON public.hq_bugs FROM authenticated; END IF;
 IF EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'app_runtime') THEN
 REVOKE ALL ON public.hq_bugs FROM app_runtime;
 GRANT SELECT, INSERT, UPDATE ON public.hq_bugs TO app_runtime;
 GRANT EXECUTE ON FUNCTION public.hq_is_admin() TO app_runtime;
 END IF;
END $$;
ALTER TABLE public.hq_feature_requests ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.hq_feature_requests FORCE ROW LEVEL SECURITY;
REVOKE ALL ON public.hq_feature_requests FROM PUBLIC;
DROP POLICY IF EXISTS hq_select ON public.hq_feature_requests;
CREATE POLICY hq_select ON public.hq_feature_requests FOR SELECT USING (public.hq_is_admin()) ;
DROP POLICY IF EXISTS hq_insert ON public.hq_feature_requests;
CREATE POLICY hq_insert ON public.hq_feature_requests FOR INSERT  WITH CHECK (public.hq_is_admin());
DROP POLICY IF EXISTS hq_update ON public.hq_feature_requests;
CREATE POLICY hq_update ON public.hq_feature_requests FOR UPDATE USING (public.hq_is_admin()) WITH CHECK (public.hq_is_admin());
DO $$ BEGIN
 IF EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'anon') THEN REVOKE ALL ON public.hq_feature_requests FROM anon; END IF;
 IF EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'authenticated') THEN REVOKE ALL ON public.hq_feature_requests FROM authenticated; END IF;
 IF EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'app_runtime') THEN
 REVOKE ALL ON public.hq_feature_requests FROM app_runtime;
 GRANT SELECT, INSERT, UPDATE ON public.hq_feature_requests TO app_runtime;
 GRANT EXECUTE ON FUNCTION public.hq_is_admin() TO app_runtime;
 END IF;
END $$;
ALTER TABLE public.hq_bug_customers ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.hq_bug_customers FORCE ROW LEVEL SECURITY;
REVOKE ALL ON public.hq_bug_customers FROM PUBLIC;
DROP POLICY IF EXISTS hq_select ON public.hq_bug_customers;
CREATE POLICY hq_select ON public.hq_bug_customers FOR SELECT USING (public.hq_is_admin()) ;
DROP POLICY IF EXISTS hq_insert ON public.hq_bug_customers;
CREATE POLICY hq_insert ON public.hq_bug_customers FOR INSERT  WITH CHECK (public.hq_is_admin());
DROP POLICY IF EXISTS hq_update ON public.hq_bug_customers;
CREATE POLICY hq_update ON public.hq_bug_customers FOR UPDATE USING (public.hq_is_admin()) WITH CHECK (public.hq_is_admin());
DO $$ BEGIN
 IF EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'anon') THEN REVOKE ALL ON public.hq_bug_customers FROM anon; END IF;
 IF EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'authenticated') THEN REVOKE ALL ON public.hq_bug_customers FROM authenticated; END IF;
 IF EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'app_runtime') THEN
 REVOKE ALL ON public.hq_bug_customers FROM app_runtime;
 GRANT SELECT, INSERT, UPDATE ON public.hq_bug_customers TO app_runtime;
 GRANT EXECUTE ON FUNCTION public.hq_is_admin() TO app_runtime;
 END IF;
END $$;
ALTER TABLE public.hq_feature_request_customers ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.hq_feature_request_customers FORCE ROW LEVEL SECURITY;
REVOKE ALL ON public.hq_feature_request_customers FROM PUBLIC;
DROP POLICY IF EXISTS hq_select ON public.hq_feature_request_customers;
CREATE POLICY hq_select ON public.hq_feature_request_customers FOR SELECT USING (public.hq_is_admin()) ;
DROP POLICY IF EXISTS hq_insert ON public.hq_feature_request_customers;
CREATE POLICY hq_insert ON public.hq_feature_request_customers FOR INSERT  WITH CHECK (public.hq_is_admin());
DROP POLICY IF EXISTS hq_update ON public.hq_feature_request_customers;
CREATE POLICY hq_update ON public.hq_feature_request_customers FOR UPDATE USING (public.hq_is_admin()) WITH CHECK (public.hq_is_admin());
DO $$ BEGIN
 IF EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'anon') THEN REVOKE ALL ON public.hq_feature_request_customers FROM anon; END IF;
 IF EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'authenticated') THEN REVOKE ALL ON public.hq_feature_request_customers FROM authenticated; END IF;
 IF EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'app_runtime') THEN
 REVOKE ALL ON public.hq_feature_request_customers FROM app_runtime;
 GRANT SELECT, INSERT, UPDATE ON public.hq_feature_request_customers TO app_runtime;
 GRANT EXECUTE ON FUNCTION public.hq_is_admin() TO app_runtime;
 END IF;
END $$;
ALTER TABLE public.hq_feedbacks ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.hq_feedbacks FORCE ROW LEVEL SECURITY;
REVOKE ALL ON public.hq_feedbacks FROM PUBLIC;
DROP POLICY IF EXISTS hq_select ON public.hq_feedbacks;
CREATE POLICY hq_select ON public.hq_feedbacks FOR SELECT USING (public.hq_is_admin()) ;
DROP POLICY IF EXISTS hq_insert ON public.hq_feedbacks;
CREATE POLICY hq_insert ON public.hq_feedbacks FOR INSERT  WITH CHECK (public.hq_is_admin());
DROP POLICY IF EXISTS hq_update ON public.hq_feedbacks;
CREATE POLICY hq_update ON public.hq_feedbacks FOR UPDATE USING (public.hq_is_admin()) WITH CHECK (public.hq_is_admin());
DO $$ BEGIN
 IF EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'anon') THEN REVOKE ALL ON public.hq_feedbacks FROM anon; END IF;
 IF EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'authenticated') THEN REVOKE ALL ON public.hq_feedbacks FROM authenticated; END IF;
 IF EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'app_runtime') THEN
 REVOKE ALL ON public.hq_feedbacks FROM app_runtime;
 GRANT SELECT, INSERT, UPDATE ON public.hq_feedbacks TO app_runtime;
 GRANT EXECUTE ON FUNCTION public.hq_is_admin() TO app_runtime;
 END IF;
END $$;
COMMIT;
