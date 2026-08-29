import type { CSSProperties } from "react";
import { Scissors } from "lucide-react";
import Image from "next/image";
import { getTenantContext } from "@/lib/tenant";
import { withTenant } from "@/lib/prisma-tenant";
import { hexToHslTriple, readableForeground } from "@/lib/color";
import { normalizeImageUrl } from "@/lib/images";
import { SidebarFooter } from "./sidebar-footer";
import { SalonSwitcher } from "./salon-switcher";
import { SidebarNav } from "./sidebar-nav";
import { CommandPalette, OpenCommandPaletteButton } from "./command-palette";
import { Toaster } from "@/components/ui/toast";
import { ThemeProvider } from "./theme-provider";
import { MobileNav } from "./mobile-nav";
import { isPlatformAdmin } from "@/lib/platform-admin";

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
          select: { name: true, plan: true, themeColorHex: true, logoUrl: true },
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
  const brandHsl = hexToHslTriple(salon?.themeColorHex);
  const salonLogo = normalizeImageUrl(salon?.logoUrl);
  const brandStyle = brandHsl
    ? ({
        "--primary": brandHsl,
        "--accent": brandHsl,
        "--ring": brandHsl,
        "--primary-foreground": readableForeground(salon?.themeColorHex) ?? "0 0% 100%",
      } as CSSProperties)
    : undefined;

  return (
    <ThemeProvider>
    {/* Aplica o tema salvo antes do primeiro paint — evita flash dark→light */}
    <script
      dangerouslySetInnerHTML={{
        __html: `try{if(localStorage.getItem("admin-theme")==="light")document.documentElement.setAttribute("data-theme","admin-light")}catch(e){}`,
      }}
    />
    <div className="admin-shell flex h-dvh overflow-hidden text-foreground" style={brandStyle}>
      {/* ── Sidebar ─────────────────────────────────────── */}
      <aside className="admin-sidebar scrollbar-dark hidden w-56 shrink-0 flex-col overflow-y-auto border-r border-border lg:flex print:hidden">
        {/* Logo */}
        <div className="flex h-14 shrink-0 items-center gap-2.5 px-4">
          <span className="admin-brand-mark relative grid h-9 w-11 shrink-0 place-items-center overflow-hidden rounded-xl border border-border bg-white p-1">
            {salonLogo ? (
              <Image
                src={salonLogo}
                alt={`Logo de ${salon?.name ?? "seu salão"}`}
                fill
                sizes="44px"
                className="object-contain p-1"
              />
            ) : (
              <span className="grid h-full w-full place-items-center rounded-lg bg-primary">
                <Scissors className="h-3.5 w-3.5 text-primary-foreground" aria-hidden="true" />
              </span>
            )}
          </span>
          <div className="min-w-0">
            <span className="block text-[13px] font-semibold tracking-tight">SalonSaaS</span>
            <span className="block text-[9px] font-medium uppercase tracking-[0.16em] text-muted-foreground/70">
              Painel de operação
            </span>
          </div>
        </div>

        {/* Salon switcher */}
        <div className="shrink-0 px-3 pb-2">
          <SalonSwitcher current={currentSalon} memberships={membershipList} />
        </div>

        <div className="shrink-0 px-3 pb-3">
          <OpenCommandPaletteButton />
        </div>

        <div className="mx-3 mb-3 h-px bg-border" />

        {/* Navigation */}
        <SidebarNav role={role} unreadNotifications={unreadNotifications} isPlatformAdmin={platformAdmin} />

        {/* User footer */}
        <SidebarFooter plan={salon?.plan ?? "FREE"} />
      </aside>

      {/* ── Main content ─────────────────────────────────── */}
      <main id="main-content" tabIndex={-1} className="admin-main scrollbar-dark min-h-0 min-w-0 flex-1 overflow-x-hidden overflow-y-auto">
        <div className="mx-auto w-full min-w-0 max-w-[1400px] p-4 pb-24 sm:p-6 md:p-8 lg:pb-8">{children}</div>
      </main>

      <MobileNav role={role} unreadNotifications={unreadNotifications} isPlatformAdmin={platformAdmin} />
      <CommandPalette role={role} />
      <Toaster />
    </div>
    </ThemeProvider>
  );
}
