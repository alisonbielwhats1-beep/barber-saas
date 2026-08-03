-- ============================================================================
-- DIAGNÓSTICO DE RLS — SOMENTE LEITURA. Não altera nada.
-- ============================================================================
--
-- Rode este script ANTES de qualquer outro desta pasta, no SQL Editor do
-- Supabase, e guarde a saída.
--
-- Ele responde a pergunta que decide se o RLS vale alguma coisa neste banco:
-- **a role que a aplicação usa é dona das tabelas?** Dono de tabela ignora
-- policies de RLS por padrão. Se a resposta for sim e não usarmos
-- FORCE ROW LEVEL SECURITY, o `ENABLE ROW LEVEL SECURITY` não bloqueia nada —
-- o painel continua funcionando, os testes passam, e a proteção é ilusória.
-- Segurança falsa é pior que ausência de segurança, porque ninguém revisa.
--
-- Como interpretar cada seção está escrito junto do respectivo resultado.
-- ============================================================================


-- ─── 1. Quem sou eu neste banco ─────────────────────────────────────────────
-- `is_superuser = true` → RLS é ignorado, ponto final. Precisa de outra role.
SELECT
  current_user                                        AS role_atual,
  session_user                                        AS role_da_sessao,
  current_database()                                  AS banco,
  (SELECT rolsuper  FROM pg_roles WHERE rolname = current_user) AS is_superuser,
  (SELECT rolbypassrls FROM pg_roles WHERE rolname = current_user) AS ignora_rls_sempre;


-- ─── 2. Quem é dono de cada tabela ──────────────────────────────────────────
-- Se `dono` = a role da seção 1, o RLS só vale com FORCE.
-- `rls_ativo` mostra o estado atual; `rls_forcado` é o que resolve o bypass.
SELECT
  c.relname                        AS tabela,
  pg_get_userbyid(c.relowner)      AS dono,
  c.relrowsecurity                 AS rls_ativo,
  c.relforcerowsecurity            AS rls_forcado
FROM pg_class c
JOIN pg_namespace n ON n.oid = c.relnamespace
WHERE n.nspname = 'public'
  AND c.relkind = 'r'
ORDER BY c.relname;


-- ─── 3. Policies que já existem ─────────────────────────────────────────────
-- Esperado num banco ainda sem RLS: nenhuma linha.
SELECT
  tablename  AS tabela,
  policyname AS policy,
  cmd        AS comando,
  qual       AS condicao_leitura,
  with_check AS condicao_escrita
FROM pg_policies
WHERE schemaname = 'public'
ORDER BY tablename, policyname;


-- ─── 4. Tabelas tenant-scoped sem RLS ───────────────────────────────────────
-- Toda tabela abaixo guarda dado de um salão específico. Enquanto
-- `rls_ativo = false`, o isolamento depende inteiramente do filtro `salonId`
-- escrito à mão nas queries da aplicação.
SELECT
  t.tabela,
  COALESCE(c.relrowsecurity, false) AS rls_ativo
FROM (VALUES
  ('Appointment'), ('AppointmentProduct'), ('ClientProfile'),
  ('ClientSubscription'), ('Expense'), ('Membership'), ('MembershipPlan'),
  ('Package'), ('PackagePurchase'), ('Payment'), ('PortfolioItem'),
  ('Product'), ('Professional'), ('ProfessionalService'), ('Salon'),
  ('Service'), ('TimeOff'), ('UserInvite'), ('UserInviteEvent'),
  ('WorkingHours')
) AS t(tabela)
LEFT JOIN pg_class c
  ON c.relname = t.tabela
 AND c.relnamespace = 'public'::regnamespace
ORDER BY rls_ativo, t.tabela;


-- ─── 5. As GUCs de sessão estão setadas? ────────────────────────────────────
-- Rodando manualmente no SQL Editor, o esperado é vazio nas duas: as GUCs são
-- setadas pela aplicação, por transação. Se aparecer valor aqui, alguém deixou
-- configuração fixa no banco — o que furaria o isolamento para todas as
-- conexões.
SELECT
  COALESCE(NULLIF(current_setting('app.current_salon',   TRUE), ''), '(vazio)') AS app_current_salon,
  COALESCE(NULLIF(current_setting('app.current_user_id', TRUE), ''), '(vazio)') AS app_current_user_id;
