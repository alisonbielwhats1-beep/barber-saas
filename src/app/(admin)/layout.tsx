import Link from "next/link";
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
    <div className="flex min-h-screen bg-muted/30">
      <aside className="hidden w-64 shrink-0 border-r bg-background md:flex md:flex-col">
        <div className="flex h-16 items-center gap-2 border-b px-6 font-display text-lg">
          <span className="grid h-8 w-8 place-items-center rounded-md bg-primary text-primary-foreground">
            <Scissors className="h-4 w-4" />
          </span>
          <span>SalonSaaS</span>
        </div>
        <nav className="flex-1 space-y-1 p-3">
          {nav.map((item) => (
            <Link
              key={item.href}
              href={item.href}
              className="flex items-center gap-3 rounded-lg px-3 py-2 text-sm text-muted-foreground transition hover:bg-muted hover:text-foreground"
            >
              <item.icon className="h-4 w-4" />
              {item.label}
            </Link>
          ))}
        </nav>
        <SidebarFooter salonName={`${salon?.name ?? "Meu salão"} · ${salon?.plan ?? "FREE"}`} />
      </aside>

      <main className="flex-1 animate-fade-in">
        <div className="border-b bg-background px-6 py-3 md:px-10">
          <SalonSwitcher current={currentSalon} memberships={membershipList} />
        </div>
        <div className="p-6 md:p-10">{children}</div>
      </main>
    </div>
  );
}
