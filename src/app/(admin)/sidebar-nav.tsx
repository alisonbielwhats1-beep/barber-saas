"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import {
  LayoutDashboard,
  CalendarClock,
  CalendarDays,
  Scissors,
  Users,
  UserCog,
  Settings,
  ShoppingBag,
  Image as ImageIcon,
  Wallet,
  Layers,
  Megaphone,
  FileBarChart,
  CreditCard,
  ClipboardCheck,
  Share2,
  Bell,
  ShieldCheck,
  Star,
  type LucideIcon,
} from "lucide-react";
import { cn } from "@/lib/utils";
import { UnreadBadge } from "@/components/unread-badge";
import {
  DASHBOARD_ROLES,
  FINANCIAL_ROLES,
  MANAGEMENT_ROLES,
  MARKETING_ROLES,
} from "@/lib/role-permissions";

/**
 * Navegação agrupada por área. Ícones Lucide, todos 14px, mesmo estilo.
 * `soon: true` marca módulos ainda não construídos — renderizam desabilitados
 * com selo "Breve" em vez de link, pra não cair em 404.
 *
 * A lista vive no client porque ícones do lucide são funções e RSC não
 * serializa função como prop de Server → Client Component.
 */
export type NavItem = {
  href: string;
  label: string;
  icon: LucideIcon;
  soon?: boolean;
  /** Se presente, o item só aparece para estes papéis. */
  roles?: readonly string[];
};
type Item = NavItem;

/**
 * Esconder o item é só cortesia visual — a proteção real está em
 * `requireRole()` na própria página. Nunca confie só nisto.
 */
export function visibleGroups(role: string) {
  return GROUPS.map((g) => ({
    ...g,
    items: g.items.filter((i) => !i.roles || i.roles.includes(role)),
  })).filter((g) => g.items.length > 0);
}

export const GROUPS: { title: string; items: Item[] }[] = [
  {
    title: "Principal",
    items: [
      { href: "/hoje", label: "Hoje", icon: CalendarClock, roles: DASHBOARD_ROLES },
      { href: "/dashboard", label: "Dashboard", icon: LayoutDashboard, roles: FINANCIAL_ROLES },
      { href: "/agenda", label: "Agenda", icon: CalendarDays },
      { href: "/notificacoes", label: "Notificações", icon: Bell },
    ],
  },
  {
    title: "Catálogo",
    items: [
      { href: "/servicos", label: "Serviços", icon: Scissors },
      { href: "/produtos", label: "Produtos", icon: ShoppingBag, roles: MANAGEMENT_ROLES },
      { href: "/pacotes", label: "Pacotes", icon: Layers, roles: MANAGEMENT_ROLES },
      { href: "/portfolio", label: "Portfolio", icon: ImageIcon },
    ],
  },
  {
    title: "Pessoas",
    items: [
      { href: "/clientes", label: "Clientes", icon: Users },
      { href: "/avaliacoes", label: "Avaliações", icon: Star, roles: MANAGEMENT_ROLES },
      { href: "/profissionais", label: "Profissionais", icon: UserCog },
    ],
  },
  {
    title: "Financeiro",
    items: [
      { href: "/financeiro", label: "Financeiro", icon: Wallet, roles: FINANCIAL_ROLES },
      { href: "/fechamento", label: "Fechamento", icon: ClipboardCheck, roles: FINANCIAL_ROLES },
      { href: "/pagamentos", label: "Pagamentos", icon: CreditCard, roles: FINANCIAL_ROLES },
      { href: "/relatorios", label: "Relatórios", icon: FileBarChart, roles: FINANCIAL_ROLES },
    ],
  },
  {
    title: "Crescimento",
    items: [
      { href: "/marketing",     label: "Marketing",     icon: Megaphone, roles: MARKETING_ROLES },
      { href: "/compartilhar",  label: "Compartilhar",  icon: Share2 },
    ],
  },
];

export function SidebarNav({
  role,
  unreadNotifications = 0,
  isPlatformAdmin = false,
  collapsed = false,
}: {
  role: string;
  unreadNotifications?: number;
  isPlatformAdmin?: boolean;
  collapsed?: boolean;
}) {
  const pathname = usePathname();

  return (
    <nav id="admin-navigation" aria-label="Navegação principal" className={`scrollbar-dark min-h-0 flex-1 overflow-y-auto overflow-x-hidden px-3 pb-4 ${collapsed ? "space-y-2" : "space-y-4"}`}>
      {visibleGroups(role).map((group) => (
        <div key={group.title}>
          <p className={collapsed ? "sr-only" : "mb-1 px-2.5 text-[10px] font-semibold uppercase tracking-widest text-muted-foreground"}>
            {group.title}
          </p>
          <div className="space-y-0.5">
            {group.items.map((item) => (
              <NavRow
                key={item.href}
                item={item}
                pathname={pathname}
                collapsed={collapsed}
                badgeCount={item.href === "/notificacoes" ? unreadNotifications : 0}
              />
            ))}
          </div>
        </div>
      ))}

      {MANAGEMENT_ROLES.some((allowedRole) => allowedRole === role) && (
        <div className="pt-1">
          <NavRow
            item={{ href: "/configuracoes", label: "Configurações", icon: Settings }}
            pathname={pathname}
            collapsed={collapsed}
          />
        </div>
      )}
      {isPlatformAdmin && (
        <div className="pt-1">
          <NavRow
            item={{ href: "/plataforma/solicitacoes", label: "Administração", icon: ShieldCheck }}
            pathname={pathname}
            collapsed={collapsed}
          />
        </div>
      )}
    </nav>
  );
}

function NavRow({
  item,
  pathname,
  badgeCount = 0,
  collapsed = false,
}: {
  item: Item;
  pathname: string;
  badgeCount?: number;
  collapsed?: boolean;
}) {
  const { href, label, icon: Icon, soon } = item;
  const active = pathname === href || pathname.startsWith(href + "/");

  if (soon) {
    return (
      <div
        className="flex min-h-11 cursor-default items-center gap-2.5 rounded-lg px-2.5 py-1.5 text-[13px] text-muted-foreground/45"
        title="Em breve"
      >
        <Icon className="h-3.5 w-3.5 shrink-0" />
        <span className="flex-1">{label}</span>
        <span className="rounded-full border border-border bg-surface-1 px-1.5 py-0.5 text-[9px] font-medium uppercase tracking-wide text-muted-foreground/70">
          Breve
        </span>
      </div>
    );
  }

  return (
    <Link
      href={href}
      prefetch={false}
      aria-current={active ? "page" : undefined}
      title={collapsed ? label : undefined}
      aria-label={collapsed ? label : undefined}
      className={cn(
        "relative flex min-h-11 items-center gap-2.5 rounded-lg px-2.5 py-1.5 text-[13px] transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring",
        active
          ? "bg-[hsl(var(--selection))] font-medium text-[hsl(var(--selection-foreground))]"
          : "text-muted-foreground hover:bg-card-hover hover:text-foreground",
      )}
    >
      {active && (
        <span className="absolute left-0 top-1/2 h-4 w-0.5 -translate-y-1/2 rounded-full bg-[hsl(var(--selection-foreground))]" />
      )}
      <Icon className={cn("shrink-0", collapsed ? "mx-auto h-[18px] w-[18px]" : "h-3.5 w-3.5")} />
      <span className={collapsed ? "sr-only" : "min-w-0 flex-1 truncate"}>{label}</span>
      <span className={collapsed ? "absolute right-0 top-0" : undefined}><UnreadBadge count={badgeCount} /></span>
    </Link>
  );
}
