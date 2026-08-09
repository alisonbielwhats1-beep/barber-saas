import { getTenantContext } from "@/lib/tenant";
import { withTenant } from "@/lib/prisma-tenant";
import { getBusinessExperience } from "@/config/business-experience";
import { BusinessExperienceProvider } from "@/components/business-experience-provider";
import { ProductWordmark } from "@/components/product-wordmark";
import { SidebarFooter } from "./sidebar-footer";
import { SalonSwitcher } from "./salon-switcher";
import { SidebarNav } from "./sidebar-nav";
import { CommandPalette } from "./command-palette";
import { Toaster } from "@/components/ui/toast";
import { ThemeProvider } from "./theme-provider";
import { MobileNav } from "./mobile-nav";
import { AppTopbar } from "./app-topbar";

export default async function AdminLayout({ children }: { children: React.ReactNode }) {
  const ctx = await getTenantContext();
  const { userId, salonId, role } = ctx;

  // membership.findMany aqui é por userId (não salonId) de propósito: é a
  // lista de TODOS os salões do usuário, para o seletor — withTenant seta as
  // duas GUCs, e a policy de leitura de Membership aceita por usuário OU por
  // salão, então a linha do próprio usuário passa mesmo cruzando salão.
  const { salon, memberships, unreadNotifications } = await withTenant(ctx, async (tx) => {
    const [salon, memberships, unreadNotifications] = await Promise.all([
      tx.salon.findUnique({
        where: { id: salonId },
        select: { name: true, plan: true, segment: true },
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
  });

  const membershipList = memberships.map((m) => ({
    id: m.salon.id,
    name: m.salon.name,
    role: m.role,
  }));
  const currentSalon = membershipList.find((m) => m.id === salonId)!;
  const experience = getBusinessExperience(salon?.segment);

  return (
    <ThemeProvider>
    <BusinessExperienceProvider segment={salon?.segment}>
    {/* Aplica o tema salvo antes do primeiro paint — evita flash dark→light */}
    <script
      dangerouslySetInnerHTML={{
        __html: `try{if(localStorage.getItem("admin-theme")==="light")document.documentElement.setAttribute("data-theme","admin-light")}catch(e){}`,
      }}
    />
    <div
      data-business-experience={experience.id}
      data-experience-direction={experience.visual.direction}
      data-experience-density={experience.visual.density}
      data-dashboard-layout={experience.visual.dashboardLayout}
      className="app-shell experience-scope flex h-dvh overflow-hidden text-foreground"
    >
      {/* ── Sidebar ─────────────────────────────────────── */}
      <aside className="app-sidebar scrollbar-dark hidden w-[16.5rem] shrink-0 flex-col overflow-y-auto border-r border-border/75 md:flex print:hidden">
        {/* Logo */}
        <div className="shrink-0 px-5 pb-4 pt-5">
          <ProductWordmark compact className="text-[17px]" />
          <span className="experience-eyebrow mt-0.5 block truncate text-[9px] font-semibold uppercase tracking-[0.2em]">
            Experiência {experience.shortLabel}
          </span>
        </div>

        {/* Salon switcher */}
        <div className="shrink-0 px-4 pb-4">
          <SalonSwitcher current={currentSalon} memberships={membershipList} />
        </div>

        {/* Navigation */}
        <SidebarNav role={role} unreadNotifications={unreadNotifications} />

        {/* User footer */}
        <SidebarFooter plan={salon?.plan ?? "FREE"} />
      </aside>

      {/* ── Main content ─────────────────────────────────── */}
      <div className="flex min-w-0 flex-1 flex-col overflow-hidden">
        <AppTopbar
          salonName={salon?.name ?? currentSalon.name}
          unreadNotifications={unreadNotifications}
        />
        <main className="scrollbar-dark min-w-0 flex-1 overflow-y-auto">
          <div className="app-content-stage px-4 py-5 pb-28 sm:px-6 sm:py-7 md:px-8 md:py-8 md:pb-10 xl:px-10">
            {children}
          </div>
        </main>
      </div>

      <MobileNav role={role} unreadNotifications={unreadNotifications} />
      <CommandPalette role={role} />
      <Toaster />
    </div>
    </BusinessExperienceProvider>
    </ThemeProvider>
  );
}
