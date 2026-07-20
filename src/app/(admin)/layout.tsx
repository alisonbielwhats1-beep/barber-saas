import {
  LayoutDashboard,
  CalendarDays,
  Scissors,
  Users,
  UserCog,
  Settings,
  ShoppingBag,
  Image as ImageIcon,
} from "lucide-react";
import { prisma } from "@/lib/prisma";
import { getTenantContext } from "@/lib/tenant";
import { SidebarFooter } from "./sidebar-footer";
import { SalonSwitcher } from "./salon-switcher";
import { NavLink } from "./nav-link";

const nav = [
  { href: "/dashboard", label: "Dashboard", icon: LayoutDashboard },
  { href: "/agenda", label: "Agenda", icon: CalendarDays },
  { href: "/servicos", label: "Serviços", icon: Scissors },
  { href: "/produtos", label: "Produtos", icon: ShoppingBag },
  { href: "/portfolio", label: "Portfolio", icon: ImageIcon },
  { href: "/profissionais", label: "Profissionais", icon: UserCog },
  { href: "/clientes", label: "Clientes", icon: Users },
  { href: "/configuracoes", label: "Configurações", icon: Settings },
];

export default async function AdminLayout({ children }: { children: React.ReactNode }) {
  const { userId, salonId } = await getTenantContext();

  const [salon, memberships] = await Promise.all([
    prisma.salon.findUnique({
      where: { id: salonId },
      select: { name: true, plan: true },
    }),
    prisma.membership.findMany({
      where: { userId },
      select: { role: true, salon: { select: { id: true, name: true } } },
    }),
  ]);

  const membershipList = memberships.map((m) => ({
    id: m.salon.id,
    name: m.salon.name,
    role: m.role,
  }));
  const currentSalon = membershipList.find((m) => m.id === salonId)!;

  return (
    <div className="flex h-screen overflow-hidden bg-background">
      {/* ── Sidebar ─────────────────────────────────────── */}
      <aside className="hidden w-56 shrink-0 flex-col border-r border-border md:flex scrollbar-dark overflow-y-auto">
        {/* Logo */}
        <div className="flex h-12 shrink-0 items-center gap-2 px-4">
          <span className="grid h-6 w-6 shrink-0 place-items-center rounded bg-primary">
            <Scissors className="h-3.5 w-3.5 text-primary-foreground" />
          </span>
          <span className="text-[13px] font-semibold tracking-tight">SalonSaaS</span>
        </div>

        {/* Salon switcher */}
        <div className="shrink-0 px-3 pb-2">
          <SalonSwitcher current={currentSalon} memberships={membershipList} />
        </div>

        {/* Divider */}
        <div className="mx-3 mb-3 h-px bg-border" />

        {/* Navigation */}
        <nav className="flex-1 space-y-0.5 px-3">
          {nav.map((item) => (
            <NavLink key={item.href} href={item.href} label={item.label} icon={item.icon} />
          ))}
        </nav>

        {/* User footer */}
        <SidebarFooter plan={salon?.plan ?? "FREE"} />
      </aside>

      {/* ── Main content ─────────────────────────────────── */}
      <main className="flex-1 overflow-y-auto scrollbar-dark">
        <div className="animate-fade-in p-6 md:p-8">{children}</div>
      </main>
    </div>
  );
}
