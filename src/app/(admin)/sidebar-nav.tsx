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
  type LucideIcon,
} from "lucide-react";
import { cn } from "@/lib/utils";

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
  roles?: string[];
};
type Item = NavItem;

/** Papéis que enxergam dados financeiros — espelha FINANCE_ROLES do tenant.ts. */
const FINANCE_ONLY = ["SUPER_ADMIN", "OWNER", "MANAGER"];

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
      { href: "/dashboard", label: "Dashboard", icon: LayoutDashboard },
      { href: "/agenda", label: "Agenda", icon: CalendarDays },
    ],
  },
  {
    title: "Catálogo",
    items: [
      { href: "/servicos", label: "Serviços", icon: Scissors },
      { href: "/produtos", label: "Produtos", icon: ShoppingBag },
      { href: "/pacotes", label: "Pacotes", icon: Layers },
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
      { href: "/financeiro", label: "Financeiro", icon: Wallet, roles: FINANCE_ONLY },
      { href: "/pagamentos", label: "Pagamentos", icon: CreditCard, soon: true, roles: FINANCE_ONLY },
      { href: "/relatorios", label: "Relatórios", icon: FileBarChart, roles: FINANCE_ONLY },
    ],
  },
  {
    title: "Crescimento",
    items: [
      { href: "/marketing",     label: "Marketing",     icon: Megaphone },
      { href: "/compartilhar",  label: "Compartilhar",  icon: Share2 },
    ],
  },
];

export function SidebarNav({ role }: { role: string }) {
  const pathname = usePathname();

  return (
    <nav className="flex-1 space-y-4 px-3 pb-4">
      {visibleGroups(role).map((group) => (
        <div key={group.title}>
          <p className="mb-1 px-2.5 text-[10px] font-semibold uppercase tracking-widest text-muted-foreground/60">
            {group.title}
          </p>
          <div className="space-y-0.5">
            {group.items.map((item) => (
              <NavRow key={item.href} item={item} pathname={pathname} />
            ))}
          </div>
        </div>
      ))}

      <div className="pt-1">
        <NavRow
          item={{ href: "/configuracoes", label: "Configurações", icon: Settings }}
          pathname={pathname}
        />
      </div>
    </nav>
  );
}

function NavRow({ item, pathname }: { item: Item; pathname: string }) {
  const { href, label, icon: Icon, soon } = item;
  const active = pathname === href || pathname.startsWith(href + "/");

  if (soon) {
    return (
      <div
        className="flex cursor-default items-center gap-2.5 rounded-lg px-2.5 py-1.5 text-[13px] text-muted-foreground/45"
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
      className={cn(
        "relative flex items-center gap-2.5 rounded-lg px-2.5 py-1.5 text-[13px] transition-colors",
        active
          ? "bg-primary/10 font-medium text-foreground"
          : "text-muted-foreground hover:bg-card-hover hover:text-foreground",
      )}
    >
      {active && (
        <span className="absolute left-0 top-1/2 h-4 w-0.5 -translate-y-1/2 rounded-full bg-primary" />
      )}
      <Icon className={cn("h-3.5 w-3.5 shrink-0", active && "text-primary")} />
      {label}
    </Link>
  );
}
