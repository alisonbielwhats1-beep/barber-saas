import "./admin-presentation.css";
import { getTenantContext } from "@/lib/tenant";
import { withTenant } from "@/lib/prisma-tenant";
import { SidebarFooter } from "./sidebar-footer";
import { SalonSwitcher } from "./salon-switcher";
import { cookies } from "next/headers";
import { AdminFrame, DesktopTopBar, SIDEBAR_COOKIE } from "./admin-sidebar";
import { CommandPalette } from "./command-palette";
import { Toaster } from "@/components/ui/toast";
import { DialogMobileSheetDefault } from "@/components/ui/dialog";
import { ThemeProvider } from "./theme-provider";
import { MobileNav } from "./mobile-nav";
import { isPlatformAdmin } from "@/lib/platform-admin";
import { AdminMobileHeader } from "./admin-mobile-header";
import { MobileTopBar } from "./mobile-top-bar";
import { getPlanEntitlement } from "@/lib/plan-entitlements";
import { billingEnabled } from "@/lib/billing/config";
import { billingCapacityLabel } from "@/lib/billing/presentation";
import { currentTerms } from "@/lib/billing/change-terms";
import { loadPlanBadge } from "@/lib/billing/plan-badge";
import { ThemeToggle } from "./theme-toggle";
import { PlanShortcut } from "./plan-shortcut";
import { complimentaryEntitlement, grantEntitlement } from "@/lib/billing/plan-grants";

const legacyPlanLabels = { FREE: "Gratuito", STARTER: "Starter", PRO: getPlanEntitlement("PRO").label, ENTERPRISE: "Enterprise" };

export default async function AdminLayout({ children }: { children: React.ReactNode }) {
  const ctx = await getTenantContext();
  const { userId, salonId, role } = ctx;

  // membership.findMany aqui é por userId (não salonId) de propósito: é a
  // lista de TODOS os salões do usuário, para o seletor — withTenant seta as
  // duas GUCs, e a policy de leitura de Membership aceita por usuário OU por
  // salão, então a linha do próprio usuário passa mesmo cruzando salão.
  const [platformAdmin, adminData] = await Promise.all([
    isPlatformAdmin(userId),
    withTenant(ctx, async (tx) => {
      const [salon, memberships, unreadNotifications, subscription] = await Promise.all([
        tx.salon.findUnique({
          where: { id: salonId },
          select: { name: true, plan: true },
        }),
        tx.membership.findMany({
          where: { userId },
          select: { role: true, salon: { select: { id: true, name: true } } },
        }),
        tx.notificationOutbox.count({
          where: {
            salonId,
            recipientKey: `USER:${userId}`,
            channel: "INTERNAL",
            readAt: null,
          },
        }),
        billingEnabled() ? tx.billingSubscription.findFirst({ where: { salonId, current: true, paidThrough: { not: null } } }) : null,
      ]);
      const legacyLabel = salon && salon.plan !== "FREE" ? legacyPlanLabels[salon.plan] : null;
      // Only the owner sees the shortcut; its situation includes pending and failed contracts.
      const badge = role === "OWNER" && billingEnabled() ? await loadPlanBadge(tx, salonId, legacyLabel) : null;
      const grant = await complimentaryEntitlement(tx, salonId);
      return { salon, memberships, unreadNotifications, badge, grant, subscription: subscription ? await currentTerms(tx, subscription) : null };
    }),
  ]);
  const { salon, memberships, unreadNotifications, subscription, badge, grant } = adminData;
  const planLabel = grant ? grantEntitlement(grant).label : subscription ? billingCapacityLabel(subscription.plan, subscription.agendaLimit) : legacyPlanLabels[salon?.plan ?? "FREE"];
  const planShortcut = grant ? { plan: planLabel, status: `Grátis até ${grant.throughDate.split("-").reverse().join("/")}`, tone: "neutral" as const } : badge ?? { plan: subscription || (salon && salon.plan !== "FREE") ? planLabel : null, status: null, tone: "neutral" as const };
  const planHref = billingEnabled() ? "/assinatura" : "/configuracoes#plano";

  const membershipList = memberships.map((m) => ({
    id: m.salon.id,
    name: m.salon.name,
    role: m.role,
  }));
  const currentSalon = membershipList.find((m) => m.id === salonId)!;
  let SecretaryDock: typeof import("./servicos/secretaria/secretary-dock-lazy").SecretaryDockLazy | undefined;
  if (process.env.SALON_SECRETARY_FRONT_ENABLED === "true" && ["OWNER", "MANAGER", "RECEPTIONIST"].includes(role)) {
    // Loaded only here, and the flag is fixed at build time (next.config env): with the Secretária off this branch is dead code,
    // so no admin page compiles the dock, its server actions or her runtime (the CI journeys timed out compiling them).
    try {
      const [{ assertSecretaryEnvironment }, { assertSecretaryRolloutAccess }, dock] = await Promise.all([import("@/lib/salon-secretary-runtime"), import("@/lib/secretary-rollout"),
        import("./servicos/secretaria/secretary-dock-lazy")]);
      assertSecretaryEnvironment(); assertSecretaryRolloutAccess(ctx); SecretaryDock = dock.SecretaryDockLazy;
    } catch { /* Admission and environment gates both fail closed. */ }
  }

  const sidebarOpen = (await cookies()).get(SIDEBAR_COOKIE)?.value !== "collapsed";
  const secretary = Boolean(SecretaryDock);
  const ownerPlan = role === "OWNER" ? { ...planShortcut, href: planHref } : null;

  return (
    <ThemeProvider>
    {/* Aplica o tema salvo antes do primeiro paint — evita flash dark→light */}
    <script
      dangerouslySetInnerHTML={{
        __html: `try{document.documentElement.setAttribute("data-theme",localStorage.getItem("admin-theme")==="light"?"admin-light":"admin-dark")}catch(e){document.documentElement.setAttribute("data-theme","admin-dark")}`,
      }}
    />
    {/* Só aqui as janelas viram painel inferior no celular; telas públicas, plataforma e HQ mantêm a janela centralizada. */}
    <DialogMobileSheetDefault>
    <div className="admin-shell flex h-dvh overflow-hidden text-foreground" style={{ paddingTop: "var(--safe-top)", paddingLeft: "var(--safe-left)", paddingRight: "var(--safe-right)" }}>
      {/* ── Menu lateral + área principal (o topo do computador precisa do estado do menu) ── */}
      <AdminFrame defaultOpen={sidebarOpen} current={currentSalon} memberships={membershipList} role={role} plan={planLabel}
        unreadNotifications={unreadNotifications} isPlatformAdmin={platformAdmin} secretary={secretary} planHref={role === "OWNER" ? planHref : null}>
        <main id="main-content" tabIndex={-1} className="admin-main scrollbar-dark min-h-0 min-w-0 flex-1 overflow-x-hidden overflow-y-auto">
          <DesktopTopBar unreadNotifications={unreadNotifications} plan={ownerPlan} />
          <AdminMobileHeader role={role} plan={planShortcut} planHref={planHref} unreadNotifications={unreadNotifications} />
          <MobileTopBar unreadNotifications={unreadNotifications} />
          {/* O espaço final cobre a barra inferior e o "+" de criar (84px). */}
          <div className="mx-auto w-full min-w-0 max-w-[1680px] p-4 pb-36 sm:p-5 md:p-6 lg:px-[26px] lg:pb-10 lg:pt-[22px]">{children}</div>
        </main>
      </AdminFrame>

      <MobileNav role={role} unreadNotifications={unreadNotifications} isPlatformAdmin={platformAdmin} secretary={secretary}
        accountControls={<div className="space-y-3 rounded-2xl bg-card p-3 ring-1 ring-inset ring-border"><div className="flex items-center justify-between gap-3">{role === "OWNER" && <PlanShortcut compact {...planShortcut} href={planHref} />}<ThemeToggle /></div><SalonSwitcher current={currentSalon} memberships={membershipList} /></div>}
        accountFooter={<SidebarFooter inline plan={planLabel} />}
      />
      <CommandPalette role={role} />
      <Toaster />
      {SecretaryDock && <SecretaryDock key={`${salonId}:${userId}`} voiceEnabled={process.env.SALON_SECRETARY_VOICE_ENABLED === "true"}
        voiceCorrection={process.env.SALON_SECRETARY_VOICE_CORRECTION === "true"} transcribeEnabled={process.env.SALON_SECRETARY_TRANSCRIBE_ENABLED === "true"}
        feedbackEnabled={process.env.SALON_SECRETARY_FEEDBACK === "true"} flowEnabled={process.env.SALON_SECRETARY_FLOW_WINDOW === "true"} />}
    </div>
    </DialogMobileSheetDefault>
    </ThemeProvider>
  );
}
