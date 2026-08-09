"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import {
  LayoutDashboard,
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
  Share2,
  Bell,
  type LucideIcon,
} from "lucide-react";
import { cn } from "@/lib/utils";
import { UnreadBadge } from "@/components/unread-badge";
import { useBusinessExperience } from "@/components/business-experience-provider";
import {
  genericBusinessExperience,
  type BusinessExperience,
} from "@/config/business-experience";
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
export function visibleGroups(
  role: string,
  experience: BusinessExperience = genericBusinessExperience,
) {
  return GROUPS.map((g) => ({
    ...g,
    items: g.items
      .filter((i) => !i.roles || i.roles.includes(role))
      .map((item) => {
        if (item.href === "/profissionais") {
          return { ...item, label: experience.navigation.professionals };
        }
        if (item.href === "/servicos") {
          return { ...item, label: experience.navigation.services };
        }
        return item;
      }),
  })).filter((g) => g.items.length > 0);
}

export const GROUPS: { title: string; items: Item[] }[] = [
  {
    title: "Principal",
    items: [
      { href: "/dashboard", label: "Dashboard", icon: LayoutDashboard, roles: DASHBOARD_ROLES },
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
      { href: "/profissionais", label: "Profissionais", icon: UserCog },
    ],
  },
  {
    title: "Financeiro",
    items: [
      { href: "/financeiro", label: "Financeiro", icon: Wallet, roles: FINANCIAL_ROLES },
      { href: "/pagamentos", label: "Pagamentos", icon: CreditCard, soon: true, roles: FINANCIAL_ROLES },
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
}: {
  role: string;
  unreadNotifications?: number;
}) {
  const pathname = usePathname();
  const experience = useBusinessExperience();

  return (
    <nav className="flex-1 space-y-5 px-3 pb-5">
      {visibleGroups(role, experience).map((group) => (
        <div key={group.title}>
          <p className="mb-2 flex items-center gap-2 px-2.5 text-[9px] font-semibold uppercase tracking-[0.19em] text-muted-foreground/55">
            {group.title}
            <span aria-hidden="true" className="h-px flex-1 bg-border/60" />
          </p>
          <div className="space-y-1">
            {group.items.map((item) => (
              <NavRow
                key={item.href}
                item={item}
                pathname={pathname}
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
}: {
  item: Item;
  pathname: string;
  badgeCount?: number;
}) {
  const { href, label, icon: Icon, soon } = item;
  const active = pathname === href || pathname.startsWith(href + "/");

  if (soon) {
    return (
      <div
        className="flex min-h-11 cursor-default items-center gap-3 rounded-xl px-3 py-2 text-[13px] text-muted-foreground/40"
        title="Em breve"
      >
        <span className="grid h-8 w-8 shrink-0 place-items-center rounded-lg border border-border/50 bg-card/50">
          <Icon className="h-3.5 w-3.5" />
        </span>
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
      className={cn(
        "group relative flex min-h-12 items-center gap-3 rounded-xl border px-2.5 py-2 text-[13px] transition duration-200",
        active
          ? "experience-active-nav experience-accent-border bg-card/75 font-semibold shadow-sm"
          : "border-transparent text-muted-foreground hover:translate-x-0.5 hover:border-border/70 hover:bg-card/60 hover:text-foreground",
      )}
    >
      <span
        className={cn(
          "grid h-8 w-8 shrink-0 place-items-center rounded-lg border transition-colors",
          active
            ? "experience-icon-surface"
            : "border-border/50 bg-surface-1/60 group-hover:border-border",
        )}
      >
        <Icon className={cn("h-3.5 w-3.5", active && "experience-accent-text")} />
      </span>
      <span className="min-w-0 flex-1 truncate">{label}</span>
      <UnreadBadge count={badgeCount} />
    </Link>
  );
}
