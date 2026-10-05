import "./admin-presentation.css";
import { getTenantContext } from "@/lib/tenant";
import { withTenant } from "@/lib/prisma-tenant";
import { SidebarFooter } from "./sidebar-footer";
import { SalonSwitcher } from "./salon-switcher";
import { AdminSidebar } from "./admin-sidebar";
import { CommandPalette } from "./command-palette";
import { Toaster } from "@/components/ui/toast";
import { ThemeProvider } from "./theme-provider";
import { MobileNav } from "./mobile-nav";
import { isPlatformAdmin } from "@/lib/platform-admin";
import { AdminMobileHeader } from "./admin-mobile-header";
import { getPlanEntitlement } from "@/lib/plan-entitlements";
import { billingEnabled } from "@/lib/billing/config";
import { billingCapacityLabel } from "@/lib/billing/presentation";
import { currentTerms } from "@/lib/billing/change-terms";
import { loadPlanBadge } from "@/lib/billing/plan-badge";
import { ThemeToggle } from "./theme-toggle";
import { PlanShortcut } from "./plan-shortcut";
import { SecretaryDock } from "./servicos/secretaria/secretary-dock";
import { assertSecretaryEnvironment } from "@/lib/salon-secretary-runtime";
import { assertSecretaryRolloutAccess } from "@/lib/secretary-rollout";

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
      return { salon, memberships, unreadNotifications, badge, subscription: subscription ? await currentTerms(tx, subscription) : null };
    }),
  ]);
  const { salon, memberships, unreadNotifications, subscription, badge } = adminData;
  const planLabel = subscription ? billingCapacityLabel(subscription.plan, subscription.agendaLimit) : legacyPlanLabels[salon?.plan ?? "FREE"];
  const planShortcut = badge ?? { plan: subscription || (salon && salon.plan !== "FREE") ? planLabel : null, status: null, tone: "neutral" as const };
  const planHref = billingEnabled() ? "/assinatura" : "/configuracoes#plano";

  const membershipList = memberships.map((m) => ({
    id: m.salon.id,
    name: m.salon.name,
    role: m.role,
  }));
  const currentSalon = membershipList.find((m) => m.id === salonId)!;
  let secretaryEnabled = false;
  if (process.env.SALON_SECRETARY_FRONT_ENABLED === "true" && ["OWNER", "MANAGER", "RECEPTIONIST"].includes(role)) {
    try { assertSecretaryEnvironment(); assertSecretaryRolloutAccess(ctx); secretaryEnabled = true; } catch { /* Admission and environment gates both fail closed. */ }
  }

  return (
    <ThemeProvider>
    {/* Aplica o tema salvo antes do primeiro paint — evita flash dark→light */}
    <script
      dangerouslySetInnerHTML={{
        __html: `try{document.documentElement.setAttribute("data-theme",localStorage.getItem("admin-theme")==="light"?"admin-light":"admin-dark")}catch(e){document.documentElement.setAttribute("data-theme","admin-dark")}`,
      }}
    />
    <div className="admin-shell flex h-dvh overflow-hidden text-foreground" style={{ paddingTop: "var(--safe-top)", paddingLeft: "var(--safe-left)", paddingRight: "var(--safe-right)" }}>
      {/* ── Sidebar ─────────────────────────────────────── */}
      <AdminSidebar current={currentSalon} memberships={membershipList} role={role} plan={planLabel} unreadNotifications={unreadNotifications} isPlatformAdmin={platformAdmin} />

      {/* ── Main content ─────────────────────────────────── */}
      <main id="main-content" tabIndex={-1} className="admin-main scrollbar-dark min-h-0 min-w-0 flex-1 overflow-x-hidden overflow-y-auto">
        {role === "OWNER" && <header aria-label="Plano do estabelecimento" className="hidden min-h-16 items-center justify-end border-b border-border bg-surface-1 px-6 py-2 lg:flex print:hidden">
          <PlanShortcut {...planShortcut} href={planHref} />
        </header>}
        <AdminMobileHeader role={role} plan={planShortcut} planHref={planHref} />
        <div className="mx-auto w-full min-w-0 max-w-[1680px] p-4 pb-24 sm:p-5 md:p-6 lg:pb-6">{children}</div>
      </main>

      <MobileNav role={role} unreadNotifications={unreadNotifications} isPlatformAdmin={platformAdmin}
        accountControls={<div className="space-y-4"><div className="flex items-center justify-between gap-3">{role === "OWNER" && <PlanShortcut compact {...planShortcut} href={planHref} />}<ThemeToggle /></div><SalonSwitcher current={currentSalon} memberships={membershipList} /><SidebarFooter plan={planLabel} /></div>}
      />
      <CommandPalette role={role} />
      <Toaster />
      {secretaryEnabled && <SecretaryDock key={`${salonId}:${userId}`} voiceEnabled={process.env.SALON_SECRETARY_VOICE_ENABLED === "true"}
        voiceCorrection={process.env.SALON_SECRETARY_VOICE_CORRECTION === "true"} transcribeEnabled={process.env.SALON_SECRETARY_TRANSCRIBE_ENABLED === "true"}
        feedbackEnabled={process.env.SALON_SECRETARY_FEEDBACK === "true"} flowEnabled={process.env.SALON_SECRETARY_FLOW_WINDOW === "true"} />}
    </div>
    </ThemeProvider>
  );
}
