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
import { ThemeToggle } from "./theme-toggle";
import { BrandLogo } from "@/components/brand";

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
      const [salon, memberships, unreadNotifications] = await Promise.all([
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
      ]);
      return { salon, memberships, unreadNotifications };
    }),
  ]);
  const { salon, memberships, unreadNotifications } = adminData;

  const membershipList = memberships.map((m) => ({
    id: m.salon.id,
    name: m.salon.name,
    role: m.role,
  }));
  const currentSalon = membershipList.find((m) => m.id === salonId)!;

  return (
    <ThemeProvider>
    {/* Aplica o tema salvo antes do primeiro paint — evita flash dark→light */}
    <script
      dangerouslySetInnerHTML={{
        __html: `try{document.documentElement.setAttribute("data-theme",localStorage.getItem("admin-theme")==="light"?"admin-light":"admin-dark")}catch(e){document.documentElement.setAttribute("data-theme","admin-dark")}`,
      }}
    />
    <div className="admin-shell flex h-dvh overflow-hidden text-foreground">
      {/* ── Sidebar ─────────────────────────────────────── */}
      <AdminSidebar current={currentSalon} memberships={membershipList} role={role} plan={salon?.plan ?? "FREE"} unreadNotifications={unreadNotifications} isPlatformAdmin={platformAdmin} />

      {/* ── Main content ─────────────────────────────────── */}
      <main id="main-content" tabIndex={-1} className="admin-main scrollbar-dark min-h-0 min-w-0 flex-1 overflow-x-hidden overflow-y-auto">
        <header role="region" className="flex items-center justify-between border-b border-border bg-surface-1 px-4 py-2 lg:hidden" aria-label="Marca e aparência">
          <BrandLogo className="!h-9 !w-[142px] text-[hsl(var(--selection-foreground))]" />
          <ThemeToggle />
        </header>
        <div className="mx-auto w-full min-w-0 max-w-[1680px] p-4 pb-24 sm:p-5 md:p-6 lg:pb-6">{children}</div>
      </main>

      <MobileNav role={role} unreadNotifications={unreadNotifications} isPlatformAdmin={platformAdmin}
        accountControls={<div className="space-y-4"><SalonSwitcher current={currentSalon} memberships={membershipList} /><SidebarFooter plan={salon?.plan ?? "FREE"} /></div>}
      />
      <CommandPalette role={role} />
      <Toaster />
    </div>
    </ThemeProvider>
  );
}
