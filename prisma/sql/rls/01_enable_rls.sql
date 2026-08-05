-- ============================================================================
-- Row-Level Security — isolamento entre salões no próprio banco
-- ============================================================================
--
-- ✅ APLICADO EM PRODUÇÃO. As policies abaixo já existem no banco — este
-- arquivo agora é a referência de auditoria e a base para reaplicar depois de
-- um rollback (`02_rollback_rls.sql`), não mais um rascunho pendente. Ele é
-- idempotente (`CREATE OR REPLACE FUNCTION`, `DROP POLICY IF EXISTS` antes de
-- cada `CREATE POLICY`), então rodar de novo do zero é seguro.
--
-- A `DATABASE_URL` de produção ainda usa a role `postgres` (`BYPASSRLS`), o
-- que faz este arquivo já aplicado ter, por ora, efeito zero sobre o app —
-- ver `03_create_app_role.sql` para o que falta antes da troca de conexão.
--
-- ─── POR QUÊ ────────────────────────────────────────────────────────────────
-- Hoje o isolamento entre salões depende inteiramente do filtro `salonId`
-- escrito à mão em 241 chamadas espalhadas por 39 arquivos. Uma query sem o
-- filtro vaza dados de outro salão e nada avisa. Com RLS, o banco devolve zero
-- linhas nesse caso — a falha vira ausência de dado em vez de vazamento.
--
-- ─── PRÉ-REQUISITOS — todos cumpridos ───────────────────────────────────────
-- 0. ✅ `postgres` tem `rolbypassrls = true` (confirmado, `00_diagnose_rls.sql`).
--    `03_create_app_role.sql` cria a role sem esse atributo; falta apontar a
--    aplicação para ela.
-- 1. ✅ Queries de tabela tenant-scoped migradas para o client tenant-aware
--    (`src/lib/prisma-tenant.ts`), que seta as GUCs por transação.
-- 2. ✅ Rotas públicas (`/book/*`, `/api/availability`, `/api/appointments`)
--    setando `app.current_salon` depois de resolver o salão pelo slug.
-- 3. ✅ `signup`/`onboarding` chamando `setSalonGuc` logo após criar o Salon.
-- 4. ⚠️ Não há ambiente de teste separado — aplicado direto em produção,
--    mitigado pelo item 0 (postgres ainda ignora RLS por completo).
--
-- ─── AS TRÊS GUCs ───────────────────────────────────────────────────────────
-- `app.current_salon`     — salão ativo da requisição.
-- `app.current_user_id`   — usuário logado.
-- `app.invite_token_hash` — hash do token de convite sendo lido/aceito.
--
-- A segunda existe por um motivo específico: `getTenantContext()` descobre o
-- salão LENDO a tabela Membership, então essa leitura não pode depender de já
-- saber o salão. Sem essa GUC, a consulta volta vazia, o código conclui que o
-- usuário não tem salão nenhum e redireciona todo mundo para o onboarding.
--
-- A terceira resolve o mesmo tipo de problema para convites: quem abre o link
-- do convite não tem sessão nem salão — só o token da URL. Ver seção 6.
--
-- Todas são setadas com `is_local => true`, valendo só dentro da transação.
-- Isso é obrigatório aqui: a `DATABASE_URL` usa PgBouncer em transaction mode,
-- onde a conexão é reciclada entre transações e um SET de sessão vazaria para
-- a requisição seguinte — de outro salão.
--
-- ─── FAIL-CLOSED ────────────────────────────────────────────────────────────
-- GUC não setada → a função devolve NULL → `"salonId" = NULL` é NULL → a linha
-- não passa. Ou seja: esquecer de setar o contexto esconde dados, nunca expõe.
-- ============================================================================


-- ─── Funções auxiliares ─────────────────────────────────────────────────────

CREATE OR REPLACE FUNCTION app_current_salon() RETURNS TEXT AS $$
  SELECT NULLIF(current_setting('app.current_salon', TRUE), '')
$$ LANGUAGE SQL STABLE;

CREATE OR REPLACE FUNCTION app_current_user() RETURNS TEXT AS $$
  SELECT NULLIF(current_setting('app.current_user_id', TRUE), '')
$$ LANGUAGE SQL STABLE;

CREATE OR REPLACE FUNCTION app_current_invite_token() RETURNS TEXT AS $$
  SELECT NULLIF(current_setting('app.invite_token_hash', TRUE), '')
$$ LANGUAGE SQL STABLE;


-- ============================================================================
-- 1. Tabelas com coluna `salonId` — policy uniforme
-- ============================================================================
-- FORCE é o que faz o RLS valer também para o dono das tabelas. No Supabase a
-- role da aplicação normalmente É a dona, e sem FORCE todas as policies abaixo
-- seriam silenciosamente ignoradas.
--
-- A lista é explícita de propósito: adicionar tabela nova ao schema sem
-- adicionar aqui deixa a tabela desprotegida, e uma lista visível é mais fácil
-- de auditar do que descoberta automática.

DO $$
DECLARE
  t TEXT;
  tabelas TEXT[] := ARRAY[
    'Appointment',
    'ClientProfile',
    'ClientSubscription',
    'Expense',
    'MembershipPlan',
    'Package',
    'PackagePurchase',
    'PortfolioItem',
    'Product',
    'Professional',
    'Service',
    'UserInvite',
    'WaitlistEntry',
    'WorkingHours',
    'SalonClosure',
    'AuditLog'
  ];
BEGIN
  FOREACH t IN ARRAY tabelas LOOP
    EXECUTE format('ALTER TABLE %I ENABLE ROW LEVEL SECURITY', t);
    EXECUTE format('ALTER TABLE %I FORCE  ROW LEVEL SECURITY', t);
    EXECUTE format('DROP POLICY IF EXISTS tenant_isolation ON %I', t);
    EXECUTE format(
      'CREATE POLICY tenant_isolation ON %I
         USING ("salonId" = app_current_salon())
         WITH CHECK ("salonId" = app_current_salon())', t);
  END LOOP;
END $$;


-- ============================================================================
-- 2. Salon — leitura pública, escrita restrita
-- ============================================================================
-- A vitrine `/book/[slug]` é pública por definição: qualquer pessoa com o link
-- precisa ler nome, endereço, horários e descrição sem estar logada. É também
-- por ela que as rotas públicas traduzem slug → salonId para então setar a GUC.
-- Fechar a leitura aqui criaria um impasse: não dá para descobrir o id do salão
-- sem já saber o id do salão.
--
-- O que a tabela guarda é vitrine — nada sigiloso. O dado sensível (cliente,
-- atendimento, financeiro) está nas tabelas da seção 1, essas sim fechadas.

ALTER TABLE "Salon" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "Salon" FORCE  ROW LEVEL SECURITY;

DROP POLICY IF EXISTS salon_public_read ON "Salon";
CREATE POLICY salon_public_read ON "Salon"
  FOR SELECT USING (TRUE);

-- INSERT fica aberto porque o cadastro cria o salão antes de existir id para
-- pôr na GUC. Quem pode criar salão é decidido pela aplicação (rate limit +
-- checagem de membership em `signup`/`createSalon`), não aqui.
DROP POLICY IF EXISTS salon_insert ON "Salon";
CREATE POLICY salon_insert ON "Salon"
  FOR INSERT WITH CHECK (TRUE);

DROP POLICY IF EXISTS salon_update ON "Salon";
CREATE POLICY salon_update ON "Salon"
  FOR UPDATE USING (id = app_current_salon())
  WITH CHECK (id = app_current_salon());

DROP POLICY IF EXISTS salon_delete ON "Salon";
CREATE POLICY salon_delete ON "Salon"
  FOR DELETE USING (id = app_current_salon());


-- ============================================================================
-- 3. Membership — a tabela que resolve o tenant
-- ============================================================================
-- Dois acessos legítimos e diferentes:
--   a) "quais salões são meus?" — feito ANTES de haver salão ativo, na
--      resolução do contexto. Depende de `app.current_user_id`.
--   b) "quem é a equipe deste salão?" — já dentro de um salão, na tela de
--      profissionais. Depende de `app.current_salon`.
-- A policy de leitura aceita as duas; escrita exige contexto de salão.

ALTER TABLE "Membership" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "Membership" FORCE  ROW LEVEL SECURITY;

DROP POLICY IF EXISTS membership_read ON "Membership";
CREATE POLICY membership_read ON "Membership"
  FOR SELECT USING (
    "userId"  = app_current_user()
    OR "salonId" = app_current_salon()
  );

-- No cadastro o vínculo nasce junto do salão. Exigimos que a GUC já aponte
-- para o salão recém-criado (ver pré-requisito 4) — assim nem o cadastro
-- consegue criar vínculo num salão de terceiro.
DROP POLICY IF EXISTS membership_write ON "Membership";
CREATE POLICY membership_write ON "Membership"
  FOR ALL USING ("salonId" = app_current_salon())
  WITH CHECK ("salonId" = app_current_salon());


-- ============================================================================
-- 4. Tabelas sem `salonId` — herdam o isolamento do pai
-- ============================================================================

ALTER TABLE "ProfessionalService" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "ProfessionalService" FORCE  ROW LEVEL SECURITY;
DROP POLICY IF EXISTS tenant_isolation ON "ProfessionalService";
CREATE POLICY tenant_isolation ON "ProfessionalService"
  USING (EXISTS (
    SELECT 1 FROM "Professional" p
    WHERE p.id = "ProfessionalService"."professionalId"
      AND p."salonId" = app_current_salon()))
  WITH CHECK (EXISTS (
    SELECT 1 FROM "Professional" p
    WHERE p.id = "ProfessionalService"."professionalId"
      AND p."salonId" = app_current_salon()));

ALTER TABLE "TimeOff" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "TimeOff" FORCE  ROW LEVEL SECURITY;
DROP POLICY IF EXISTS tenant_isolation ON "TimeOff";
CREATE POLICY tenant_isolation ON "TimeOff"
  USING (EXISTS (
    SELECT 1 FROM "Professional" p
    WHERE p.id = "TimeOff"."professionalId"
      AND p."salonId" = app_current_salon()))
  WITH CHECK (EXISTS (
    SELECT 1 FROM "Professional" p
    WHERE p.id = "TimeOff"."professionalId"
      AND p."salonId" = app_current_salon()));

ALTER TABLE "Payment" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "Payment" FORCE  ROW LEVEL SECURITY;
DROP POLICY IF EXISTS tenant_isolation ON "Payment";
CREATE POLICY tenant_isolation ON "Payment"
  USING (EXISTS (
    SELECT 1 FROM "Appointment" a
    WHERE a.id = "Payment"."appointmentId"
      AND a."salonId" = app_current_salon()))
  WITH CHECK (EXISTS (
    SELECT 1 FROM "Appointment" a
    WHERE a.id = "Payment"."appointmentId"
      AND a."salonId" = app_current_salon()));

ALTER TABLE "AppointmentProduct" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "AppointmentProduct" FORCE  ROW LEVEL SECURITY;
DROP POLICY IF EXISTS tenant_isolation ON "AppointmentProduct";
CREATE POLICY tenant_isolation ON "AppointmentProduct"
  USING (EXISTS (
    SELECT 1 FROM "Appointment" a
    WHERE a.id = "AppointmentProduct"."appointmentId"
      AND a."salonId" = app_current_salon()))
  WITH CHECK (EXISTS (
    SELECT 1 FROM "Appointment" a
    WHERE a.id = "AppointmentProduct"."appointmentId"
      AND a."salonId" = app_current_salon()));

ALTER TABLE "UserInviteEvent" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "UserInviteEvent" FORCE  ROW LEVEL SECURITY;
DROP POLICY IF EXISTS tenant_isolation ON "UserInviteEvent";
CREATE POLICY tenant_isolation ON "UserInviteEvent"
  USING (EXISTS (
    SELECT 1 FROM "UserInvite" i
    WHERE i.id = "UserInviteEvent"."inviteId"
      AND i."salonId" = app_current_salon()))
  WITH CHECK (EXISTS (
    SELECT 1 FROM "UserInvite" i
    WHERE i.id = "UserInviteEvent"."inviteId"
      AND i."salonId" = app_current_salon()));


-- ============================================================================
-- 5. Tabelas deixadas FORA do RLS — de propósito
-- ============================================================================
-- `User`  — a autenticação precisa achar a pessoa pelo e-mail antes de existir
--           qualquer salão. Um usuário também pode pertencer a vários salões,
--           então não há um `salonId` que descreva a linha. O isolamento do que
--           se lê de User continua sendo responsabilidade da aplicação.
--
-- Tabelas do NextAuth (Account, Session, VerificationToken), se existirem, ficam
-- fora pelo mesmo motivo: são consultadas antes de haver contexto de tenant.
--
-- ⚠️  INCIDENTE (04/08/2026): esta seção só documentava a intenção, sem
-- executar o `DISABLE` de fato. O Supabase ativa RLS por padrão em toda
-- tabela criada pelo painel — `User` incluída, apesar de nunca ter passado
-- por um `ENABLE ROW LEVEL SECURITY` nosso. RLS ativo + zero policy = bloqueia
-- todo mundo (fail-closed), então na troca de `DATABASE_URL` para `app_runtime`
-- login e a listagem de equipe no booking quebraram imediatamente
-- (`Inconsistent query result: Field user is required to return data, got
-- null`). Corrigido ao vivo com o `DISABLE` abaixo; a linha existe aqui para
-- este arquivo continuar correto se algum dia for reaplicado depois de um
-- rollback (`02_rollback_rls.sql` não mexe em `User`, então sem esta linha o
-- mesmo incidente se repetiria).

ALTER TABLE "User" DISABLE ROW LEVEL SECURITY;


-- ============================================================================
-- 6. UserInvite — leitura adicional por token, sem salão conhecido
-- ============================================================================
-- Quem abre `/convite/[token]` não tem sessão nem salonId — só o token da
-- URL. `UserInvite` já tem a policy `tenant_isolation` da seção 1 (exige
-- salonId = app_current_salon()), que cobre toda a operação de quem JÁ está
-- autenticado num salão (criar, reenviar, revogar convite). Esta seção
-- resolve o outro lado: o convidado, que só tem o token.
--
-- Diferente de Salon (seção 2), abrir a tabela inteira para leitura pública
-- vazaria e-mail, nome e papel de QUALQUER convite de QUALQUER salão. Por
-- isso a policy abaixo não usa `USING (TRUE)` — ela só libera a ÚNICA linha
-- cujo tokenHash bate com o hash setado na GUC `app.invite_token_hash`, que
-- só quem tem o token original (256 bits aleatórios, nunca listável) consegue
-- produzir. `src/lib/prisma-tenant.ts` (`withInviteToken`) seta essa GUC antes
-- de ler; depois de descobrir o salonId da linha, o código troca para
-- `setSalonGuc` na mesma transação — daí em diante toda escrita (aceitar o
-- convite, criar Membership/Professional) passa pela `tenant_isolation`
-- normal, não por esta policy.
--
-- É SELECT apenas: esta policy nunca autoriza INSERT/UPDATE/DELETE. Ter o
-- token não deveria bastar para escrever no convite de outra pessoa — a
-- escrita exige o salonId, que só se obtém DEPOIS de já ter passado por essa
-- leitura restrita, com o código explicitamente trocando de GUC.
--
-- Policies permissivas do mesmo comando se combinam com OR: um SELECT passa
-- se `tenant_isolation` OU esta autorizar. Não muda nada para quem já tem
-- salão ativo — só abre a exceção mínima para quem tem só o token.

DROP POLICY IF EXISTS user_invite_token_read ON "UserInvite";
CREATE POLICY user_invite_token_read ON "UserInvite"
  FOR SELECT USING ("tokenHash" = app_current_invite_token());
