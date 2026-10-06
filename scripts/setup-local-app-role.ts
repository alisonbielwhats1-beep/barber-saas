/** Local-only: creates `local_app_runtime`, a login role with the same table privileges the
 * production `app_runtime` role gets from prisma/sql (rls/03_create_app_role.sql + manual/*),
 * so the whole admin UI can be tested against the disposable MVP database.
 *
 * Never production. Never touches `mvp_service_runtime` (the least-privilege role the security
 * suites assert). No SUPERUSER, no BYPASSRLS, no role membership, no DDL. A table is granted only
 * when production protects it the same way the local copy does: RLS enabled + forced with at
 * least one policy, or "User" (RLS explicitly disabled in production too). Tables that production
 * protects with RLS but the local copy does not (schema drift) stay inaccessible. */
import { PrismaClient } from '@prisma/client';

export const LOCAL_APP_ROLE = 'local_app_runtime';

type Privilege = 'SELECT' | 'INSERT' | 'UPDATE' | 'DELETE';
const SI: Privilege[] = ['SELECT', 'INSERT'], SIU: Privilege[] = ['SELECT', 'INSERT', 'UPDATE'];
const SIUD: Privilege[] = ['SELECT', 'INSERT', 'UPDATE', 'DELETE'];
/** Final production privileges of app_runtime (GRANTs minus later REVOKEs), derived twice
 * independently from the repository SQL on 27/09/2026 with full agreement. */
export const PRODUCTION_APP_GRANTS: Record<string, Privilege[]> = {
  User: SIUD, Salon: SIUD, Membership: SIUD, Professional: SIUD, Service: SIUD, ProfessionalService: SIUD,
  WorkingHours: SIUD, TimeOff: SIUD, ClientProfile: SIUD, Appointment: SIUD, Payment: SIUD, Product: SIUD,
  AppointmentProduct: SIUD, PortfolioItem: SIUD, Package: SIUD, PackagePurchase: SIUD, MembershipPlan: SIUD,
  ClientSubscription: SIUD, Expense: SIUD, UserInvite: SIUD, UserInviteEvent: SIUD, WaitlistEntry: SIUD,
  SalonClosure: SIUD, AuditLog: SI, ClientReview: SIU, SalonAccessEvent: SI, AppointmentService: SIUD,
  AppointmentEvent: SI, NotificationOutbox: SIU, ServicePricingRule: SIUD, RescheduleProposal: SIU,
  ProfessionalOpening: SIUD, PhysicalResource: SIUD, ResourceBooking: SIUD, WaitlistOffer: SIU,
  // Production relies on RLS for these; granted locally only if the local copy has it too.
  PlatformInvoice: SIU, PlatformInvoiceEvent: SI, ClientDependent: SIUD, CareEntry: SI,
  FlexibleWaitlist: SIUD, FlexibleWaitlistService: SIUD, AuthIdentity: SIU,
  BillingSubscription: SIU, BillingCharge: SIU, BillingEvent: SI, BillingInbox: SIU, BillingQueue: SIU,
  BillingPlanChange: SIU, hq_accounts: SIU, hq_leads: SIU, hq_customers: SIU, hq_opportunities: SIU,
  hq_subscriptions: SIU, hq_payments: SIU, hq_activities: SI, hq_followups: SIU, hq_support_tickets: SIU,
  hq_bugs: SIU, hq_feature_requests: SIU, hq_bug_customers: SIU, hq_feature_request_customers: SIU,
  hq_feedbacks: SIU, hq_agent_runs: SIU,
  // prisma/sql/manual/026_secretary_feedback.sql (append-only for the runtime; granted only once applied with FORCE RLS).
  SecretaryFeedback: SI,
  // prisma/sql/manual/027_secretary_state.sql (D1; events append-only; granted only once applied with FORCE RLS).
  SecretaryConversation: SIUD, SecretaryConversationEvent: SI, SecretaryNameAlias: SIUD,
};
/** Production disables RLS on "User" on purpose (login looks users up before any tenant exists). */
const RLS_DISABLED_IN_PRODUCTION = new Set(['User']);

const quote = (name: string) => '"' + name.replace(/"/g, '""') + '"';

export async function ensureLocalAppRole(adminUrl: string) {
  const url = new URL(adminUrl);
  if (url.hostname !== '127.0.0.1' || url.port !== '55441' || url.pathname !== '/everflair_service_mvp') throw Error('LOCAL_APP_ROLE_LOCAL_DATABASE_REQUIRED');
  const admin = new PrismaClient({ datasources: { db: { url: adminUrl } } });
  try {
    const [db] = await admin.$queryRaw<{ name: string; host: string; port: number }[]>`SELECT current_database() AS name, host(inet_server_addr()) AS host, inet_server_port() AS port`;
    if (db.name !== 'everflair_service_mvp' || db.host !== '127.0.0.1' || db.port !== 55441) throw Error('LOCAL_APP_ROLE_UNSAFE_DATABASE');
    const exists = await admin.$queryRaw<{ n: number }[]>`SELECT count(*)::int AS n FROM pg_roles WHERE rolname = ${LOCAL_APP_ROLE}`;
    if (!exists[0].n) await admin.$executeRawUnsafe(`CREATE ROLE ${LOCAL_APP_ROLE} LOGIN NOSUPERUSER NOCREATEDB NOCREATEROLE NOBYPASSRLS NOREPLICATION`);
    else await admin.$executeRawUnsafe(`ALTER ROLE ${LOCAL_APP_ROLE} LOGIN NOSUPERUSER NOCREATEDB NOCREATEROLE NOBYPASSRLS NOREPLICATION`);
    await admin.$executeRawUnsafe(`GRANT CONNECT ON DATABASE everflair_service_mvp TO ${LOCAL_APP_ROLE}`);
    await admin.$executeRawUnsafe(`GRANT USAGE ON SCHEMA public TO ${LOCAL_APP_ROLE}`);
    const tables = await admin.$queryRaw<{ t: string; rls: boolean; force: boolean; policies: number }[]>`
      SELECT c.relname AS t, c.relrowsecurity AS rls, c.relforcerowsecurity AS force,
        (SELECT count(*)::int FROM pg_policies p WHERE p.schemaname = 'public' AND p.tablename = c.relname) AS policies
      FROM pg_class c JOIN pg_namespace n ON n.oid = c.relnamespace WHERE n.nspname = 'public' AND c.relkind = 'r'`;
    const granted: string[] = [], skipped: string[] = [];
    for (const table of tables) {
      // Idempotent: start from nothing on every run, then grant exactly the production set.
      await admin.$executeRawUnsafe(`REVOKE ALL ON TABLE public.${quote(table.t)} FROM ${LOCAL_APP_ROLE}`);
      const privileges = PRODUCTION_APP_GRANTS[table.t];
      const protectedLikeProduction = RLS_DISABLED_IN_PRODUCTION.has(table.t) || table.rls && table.force && table.policies > 0;
      if (!privileges || !protectedLikeProduction) { skipped.push(table.t); continue; }
      await admin.$executeRawUnsafe(`GRANT ${privileges.join(', ')} ON TABLE public.${quote(table.t)} TO ${LOCAL_APP_ROLE}`);
      granted.push(table.t);
    }
    const [role] = await admin.$queryRaw<{ super: boolean; bypass: boolean; memberships: number }[]>`
      SELECT rolsuper AS super, rolbypassrls AS bypass,
        (SELECT count(*)::int FROM pg_auth_members m WHERE m.member = r.oid) AS memberships
      FROM pg_roles r WHERE rolname = ${LOCAL_APP_ROLE}`;
    if (role.super || role.bypass || role.memberships) throw Error('LOCAL_APP_ROLE_PRIVILEGED');
    return { role: LOCAL_APP_ROLE, granted: granted.sort(), skipped: skipped.sort() };
  } finally { await admin.$disconnect(); }
}

