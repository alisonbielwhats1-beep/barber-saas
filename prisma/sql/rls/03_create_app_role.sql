-- ============================================================================
-- Role dedicada para a aplicação — pré-requisito do RLS
-- ============================================================================
--
-- ⚠️  NÃO SUBSTITUA A SENHA E COMMITE O RESULTADO. Ver seção "SENHA" abaixo.
--
-- ─── POR QUE ESTE ARQUIVO EXISTE ────────────────────────────────────────────
-- Rodamos `00_diagnose_rls.sql` e confirmamos: a role que a `DATABASE_URL` usa
-- hoje é `postgres`, com `rolbypassrls = true`. Essa é uma role com o atributo
-- BYPASSRLS — e esse atributo ignora TODA policy de RLS, sempre, em qualquer
-- tabela, mesmo com FORCE ROW LEVEL SECURITY. Não é contornável por policy
-- nenhuma; é assim que o Postgres define o atributo.
--
-- Ou seja: `01_enable_rls.sql` pode estar tecnicamente perfeito e ainda assim
-- proteger zero dado, porque a conexão que a aplicação usa está isenta por
-- definição. Antes de ativar RLS de verdade, a aplicação precisa se conectar
-- como uma role SEM esse atributo.
--
-- Rodamos também `pg_class` e confirmamos: RLS já está `ENABLE`d nas 21
-- tabelas da aplicação — `User` incluída — (aparentemente por um
-- comportamento padrão do Supabase ao criar tabela pelo painel), mas sem
-- nenhuma policy. Isso significa que, JÁ HOJE, qualquer role sem BYPASSRLS e
-- sem ser dona das tabelas recebe zero linhas de SELECT/INSERT/UPDATE/DELETE
-- em todas elas. A role nova só volta a funcionar depois que
-- `01_enable_rls.sql` criar as policies — e, especificamente para `User`,
-- depois que a seção 5 daquele arquivo rodar o `DISABLE ROW LEVEL SECURITY`
-- explícito (ver o incidente documentado lá: contar "20 tabelas" aqui, sem
-- incluir `User`, foi o que fez essa tabela ficar de fora do `DISABLE` da
-- primeira vez).
--
-- ─── SENHA ───────────────────────────────────────────────────────────────
-- `CREATE ROLE ... LOGIN PASSWORD` exige uma senha literal — não há como
-- evitar isso na sintaxe do Postgres. Gere uma senha forte e cole no lugar de
-- `TROCAR_SENHA_AQUI` DIRETO no SQL Editor do Supabase, sem salvar o arquivo
-- editado em lugar nenhum, e sem commitar. O jeito mais simples de gerar uma:
--
--   openssl rand -base64 32
--
-- Se este arquivo chegar a ser commitado com uma senha real, ela precisa ser
-- tratada como comprometida: rode `ALTER ROLE app_runtime PASSWORD '...'`
-- de novo com uma nova, porque o histórico do git é permanente e o
-- repositório é público.
--
-- ─── O QUE ESTA ROLE PODE FAZER ─────────────────────────────────────────────
-- SELECT/INSERT/UPDATE/DELETE nas 22 tabelas que `schema.prisma` define (+
-- SELECT/INSERT só em "AuditLog", append-only) — nem uma a mais. Sem CREATE,
-- sem ALTER, sem DROP: esta app nunca roda `prisma
-- migrate` em runtime (usa SQL manual revisado, ver `prisma/sql/manual/`), e
-- dar privilégio de DDL a uma role de aplicação é superfície de ataque sem
-- necessidade nenhuma correspondente.
--
-- `_prisma_migrations` fica de fora de propósito — é tabela de controle do
-- Prisma CLI, não é lida pela aplicação em nenhum momento de execução.
--
-- ─── DEPOIS DE RODAR ESTE ARQUIVO ───────────────────────────────────────────
-- A role existe, mas NADA muda em produção ainda — `DATABASE_URL` continua
-- apontando para `postgres`. Os próximos passos, cada um só depois de
-- confirmar o anterior, são:
--
--   1. Montar a nova connection string com este usuário, mesmo host/porta/
--      pooler da atual (ver CLAUDE.md — armadilhas 1 e 2: host
--      aws-1-sa-east-1, porta 6543 com ?pgbouncer=true para DATABASE_URL,
--      porta 5432 sem o parâmetro para DIRECT_URL).
--   2. Testar essa connection string ISOLADA — psql ou um script descartável —
--      ANTES de tocar em qualquer env var da Vercel. Neste ponto ainda não há
--      policy nenhuma criada, então o teste esperado é "consigo conectar mas
--      todo SELECT volta vazio" — isso confirma que RLS está de fato
--      bloqueando quem não é `postgres`, exatamente o comportamento que
--      queremos.
--   3. Só então aplicar `01_enable_rls.sql` (cria as policies).
--   4. Testar de novo com a mesma connection string isolada: agora os SELECTs
--      devem voltar vazios (sem GUC setada) ou com os dados corretos (com a
--      GUC setada manualmente via `SELECT set_config(...)`) — nunca com dado
--      de outro salão.
--   5. Migrar as ~241 chamadas `prisma.*` da aplicação para
--      `withTenant`/`withSalon`/`withUser` (`src/lib/prisma-tenant.ts`).
--   6. Só depois de tudo isso validado, trocar `DATABASE_URL`/`DIRECT_URL` na
--      Vercel (via arquivo, nunca pipe do PowerShell — armadilha 4) e fazer
--      redeploy. Esse é o único passo que afeta produção, e é reversível
--      trocando as env vars de volta para as credenciais de `postgres`.
-- ============================================================================


-- ─── Cria a role ─────────────────────────────────────────────────────────
-- NOLOGIN por padrão seria mais seguro, mas esta role é literalmente para
-- login da aplicação — por isso LOGIN explícito. Sem SUPERUSER, sem
-- CREATEDB, sem CREATEROLE, sem BYPASSRLS (o padrão já é não ter; deixado
-- explícito para não depender de default de versão do Postgres).

CREATE ROLE app_runtime
  LOGIN
  PASSWORD 'TROCAR_SENHA_AQUI'
  NOSUPERUSER
  NOCREATEDB
  NOCREATEROLE
  NOBYPASSRLS
  NOREPLICATION
  CONNECTION LIMIT -1;

-- Nunca dê `GRANT postgres TO app_runtime` nem qualquer membership em role
-- que tenha BYPASSRLS ou seja superuser — isso herdaria o atributo e anularia
-- todo o propósito deste arquivo.


-- ─── Acesso ao banco e ao schema ────────────────────────────────────────────

GRANT CONNECT ON DATABASE postgres TO app_runtime;
GRANT USAGE ON SCHEMA public TO app_runtime;


-- ─── DML nas 22 tabelas da aplicação (+ AuditLog à parte) — nada de DDL ────

GRANT SELECT, INSERT, UPDATE, DELETE ON TABLE
  "User",
  "Salon",
  "Membership",
  "Professional",
  "Service",
  "ProfessionalService",
  "WorkingHours",
  "TimeOff",
  "ClientProfile",
  "Appointment",
  "Payment",
  "Product",
  "AppointmentProduct",
  "PortfolioItem",
  "Package",
  "PackagePurchase",
  "MembershipPlan",
  "ClientSubscription",
  "Expense",
  "UserInvite",
  "UserInviteEvent",
  "WaitlistEntry",
  "SalonClosure"
TO app_runtime;

-- "AuditLog" fica de fora deste GRANT geral de propósito: é append-only
-- (só SELECT + INSERT, ver 007_fase2_recorrencia_overbooking_bloqueio.sql)
-- — uma trilha de auditoria que a própria aplicação pode UPDATE/DELETE não
-- serve pra nada.

GRANT SELECT, INSERT ON TABLE "SalonAccessEvent" TO app_runtime;


-- ─── Confirmação ─────────────────────────────────────────────────────────
-- Espera-se: rolsuper = false, rolbypassrls = false, rolcanlogin = true.
SELECT
  rolname AS role,
  rolsuper AS is_superuser,
  rolbypassrls AS ignora_rls_sempre,
  rolcanlogin AS pode_logar
FROM pg_roles
WHERE rolname = 'app_runtime';
