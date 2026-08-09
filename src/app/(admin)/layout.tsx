import { getTenantContext } from "@/lib/tenant";
import { withTenant } from "@/lib/prisma-tenant";
import { getBusinessExperience } from "@/config/business-experience";
import { BusinessExperienceProvider } from "@/components/business-experience-provider";
import { BusinessExperienceIcon } from "@/components/business-experience-icon";
import { SidebarFooter } from "./sidebar-footer";
import { SalonSwitcher } from "./salon-switcher";
import { SidebarNav } from "./sidebar-nav";
import { CommandPalette, OpenCommandPaletteButton } from "./command-palette";
import { Toaster } from "@/components/ui/toast";
import { ThemeProvider } from "./theme-provider";
import { MobileNav } from "./mobile-nav";

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
      className="experience-scope flex h-dvh overflow-hidden text-foreground"
    >
      {/* ── Sidebar ─────────────────────────────────────── */}
      <aside className="scrollbar-dark hidden w-60 shrink-0 flex-col overflow-y-auto border-r border-border/80 bg-surface-1/75 backdrop-blur-xl md:flex print:hidden">
        {/* Logo */}
        <div className="flex min-h-16 shrink-0 items-center gap-3 px-4">
          <span className="experience-icon-surface grid h-9 w-9 shrink-0 place-items-center rounded-xl border">
            <BusinessExperienceIcon name={experience.icon} className="h-[18px] w-[18px]" />
          </span>
          <span className="min-w-0">
            <span className="block text-[13px] font-semibold tracking-tight">SalonSaaS</span>
            <span className="experience-eyebrow block truncate text-[9px] font-semibold uppercase tracking-[0.18em]">
              {experience.shortLabel}
            </span>
          </span>
        </div>

        {/* Salon switcher */}
        <div className="shrink-0 px-3 pb-2">
          <SalonSwitcher current={currentSalon} memberships={membershipList} />
        </div>

        <div className="shrink-0 px-3 pb-3">
          <OpenCommandPaletteButton />
        </div>

        <div className="mx-3 mb-3 h-px bg-border/80" />

        {/* Navigation */}
        <SidebarNav role={role} unreadNotifications={unreadNotifications} />

        {/* User footer */}
        <SidebarFooter plan={salon?.plan ?? "FREE"} />
      </aside>

      {/* ── Main content ─────────────────────────────────── */}
      <main className="scrollbar-dark min-w-0 flex-1 overflow-y-auto">
        <div className="mx-auto max-w-[1440px] px-4 py-5 pb-24 sm:px-6 sm:py-6 md:px-8 md:py-8 md:pb-8">
          {children}
        </div>
      </main>

      <MobileNav role={role} unreadNotifications={unreadNotifications} />
      <CommandPalette role={role} />
      <Toaster />
    </div>
    </BusinessExperienceProvider>
    </ThemeProvider>
  );
}
