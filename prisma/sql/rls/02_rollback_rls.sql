-- ============================================================================
-- ROLLBACK do RLS — volta ao estado anterior a `01_enable_rls.sql`
-- ============================================================================
--
-- Rode isto se, depois de aplicar o RLS, o painel ficar vazio, o login mandar
-- todo mundo para o onboarding ou a vitrine pública parar de listar horários.
-- São exatamente os sintomas de contexto de tenant não chegando ao banco.
--
-- Desligar o RLS não apaga nem altera nenhum dado — só remove as policies e a
-- exigência de contexto. A aplicação volta a depender do filtro `salonId`
-- escrito nas queries, que é como ela sempre funcionou.
--
-- Guarde a saída de `00_diagnose_rls.sql` antes de aplicar o 01: é com ela que
-- se confere que o rollback devolveu tudo ao lugar.
-- ============================================================================

DO $$
DECLARE
  t TEXT;
  tabelas TEXT[] := ARRAY[
    'Appointment', 'AppointmentProduct', 'ClientProfile', 'ClientSubscription',
    'Expense', 'Membership', 'MembershipPlan', 'Package', 'PackagePurchase',
    'Payment', 'PortfolioItem', 'Product', 'Professional',
    'ProfessionalService', 'Salon', 'Service', 'TimeOff', 'UserInvite',
    'UserInviteEvent', 'WorkingHours'
  ];
BEGIN
  FOREACH t IN ARRAY tabelas LOOP
    -- Remove toda policy da tabela, seja qual for o nome — inclusive as do
    -- arquivo antigo, que usava só `tenant_isolation`.
    EXECUTE format(
      'DO $inner$
       DECLARE p TEXT;
       BEGIN
         FOR p IN SELECT policyname FROM pg_policies
                   WHERE schemaname = ''public'' AND tablename = %L
         LOOP
           EXECUTE format(''DROP POLICY IF EXISTS %%I ON %%I'', p, %L);
         END LOOP;
       END $inner$;', t, t);

    EXECUTE format('ALTER TABLE %I NO FORCE ROW LEVEL SECURITY', t);
    EXECUTE format('ALTER TABLE %I DISABLE ROW LEVEL SECURITY', t);
  END LOOP;
END $$;

DROP FUNCTION IF EXISTS app_current_salon();
DROP FUNCTION IF EXISTS app_current_user();

-- Confirmação: todas devem voltar com rls_ativo = false e zero policies.
SELECT
  c.relname             AS tabela,
  c.relrowsecurity      AS rls_ativo,
  c.relforcerowsecurity AS rls_forcado,
  (SELECT count(*) FROM pg_policies p
    WHERE p.schemaname = 'public' AND p.tablename = c.relname) AS policies
FROM pg_class c
JOIN pg_namespace n ON n.oid = c.relnamespace
WHERE n.nspname = 'public' AND c.relkind = 'r'
ORDER BY c.relname;
