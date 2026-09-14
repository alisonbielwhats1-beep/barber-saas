"use client";

import Link from "next/link";
import { usePathname, useSearchParams } from "next/navigation";
import {
  Bell,
  CalendarClock,
  CalendarDays,
  ChartNoAxesCombined,
  Image as ImageIcon,
  Layers3,
  LayoutDashboard,
  ListChecks,
  Megaphone,
  Settings,
  Share2,
  ShieldCheck,
  ShoppingBag,
  Star,
  Users,
  UsersRound,
  Wallet,
  Scissors,
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

export type NavItem = {
  href: string;
  label: string;
  icon: LucideIcon;
  soon?: boolean;
  roles?: readonly string[];
};

/** Lista completa usada no menu mobile, onde cada módulo continua explícito. */
export const GROUPS: { title: string; items: NavItem[] }[] = [
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
      { href: "/pacotes", label: "Pacotes", icon: Layers3, roles: MANAGEMENT_ROLES },
      { href: "/portfolio", label: "Portfólio", icon: ImageIcon },
    ],
  },
  {
    title: "Pessoas",
    items: [
      { href: "/clientes", label: "Clientes", icon: Users },
      { href: "/avaliacoes", label: "Avaliações", icon: Star, roles: MANAGEMENT_ROLES },
      { href: "/profissionais", label: "Equipe", icon: UsersRound },
    ],
  },
  {
    title: "Financeiro",
    items: [
      { href: "/financeiro", label: "Financeiro", icon: Wallet, roles: FINANCIAL_ROLES },
      { href: "/relatorios", label: "Relatórios", icon: ChartNoAxesCombined, roles: FINANCIAL_ROLES },
    ],
  },
  {
    title: "Crescimento",
    items: [
      { href: "/marketing", label: "Marketing", icon: Megaphone, roles: MARKETING_ROLES },
      { href: "/compartilhar", label: "Compartilhar", icon: Share2 },
      { href: "/onboarding/configuracao", label: "Guia de início", icon: ListChecks, roles: MANAGEMENT_ROLES },
    ],
  },
];

export function visibleGroups(role: string) {
  return GROUPS.map((group) => ({
    ...group,
    items: group.items.filter((item) => !item.roles || item.roles.includes(role)),
  })).filter((group) => group.items.length > 0);
}

type DesktopArea = NavItem & { activePaths: readonly string[] };

/** O desktop usa áreas; os módulos internos aparecem num painel contextual. */
export const DESKTOP_AREAS: DesktopArea[] = [
  { href: "/hoje", label: "Hoje", icon: CalendarClock, activePaths: ["/hoje"], roles: DASHBOARD_ROLES },
  { href: "/agenda", label: "Agenda", icon: CalendarDays, activePaths: ["/agenda"] },
  { href: "/clientes", label: "Clientes", icon: Users, activePaths: ["/clientes"] },
  { href: "/profissionais", label: "Equipe", icon: UsersRound, activePaths: ["/profissionais"] },
  { href: "/servicos", label: "Catálogo", icon: Layers3, activePaths: ["/servicos", "/produtos", "/pacotes", "/portfolio"] },
  { href: "/dashboard", label: "Resultados", icon: ChartNoAxesCombined, activePaths: ["/dashboard", "/financeiro", "/relatorios"], roles: FINANCIAL_ROLES },
  { href: "/compartilhar", label: "Crescimento", icon: Megaphone, activePaths: ["/marketing", "/avaliacoes", "/compartilhar", "/onboarding/configuracao"] },
  { href: "/notificacoes", label: "Notificações", icon: Bell, activePaths: ["/notificacoes"] },
];

function matchesPath(pathname: string, path: string) {
  return pathname === path || pathname.startsWith(`${path}/`);
}

function canSee(item: NavItem, role: string) {
  return !item.roles || item.roles.includes(role);
}

export function SidebarNav({
  role,
  unreadNotifications = 0,
  isPlatformAdmin = false,
  collapsed = true,
}: {
  role: string;
  unreadNotifications?: number;
  isPlatformAdmin?: boolean;
  collapsed?: boolean;
}) {
  const pathname = usePathname();
  const areas = DESKTOP_AREAS.filter((area) => canSee(area, role));

  return (
    <nav id="admin-navigation" aria-label="Navegação principal" className="scrollbar-dark min-h-0 flex-1 overflow-y-auto overflow-x-hidden px-3 pb-4">
      <div className="space-y-1">
        {areas.map((area) => (
          <NavRow key={area.href} item={area} active={area.activePaths.some((path) => matchesPath(pathname, path))} collapsed={collapsed} badgeCount={area.href === "/notificacoes" ? unreadNotifications : 0} />
        ))}
      </div>

      {MANAGEMENT_ROLES.some((allowedRole) => allowedRole === role) && (
        <div className="mt-3 border-t border-border pt-3">
          <NavRow item={{ href: "/configuracoes", label: "Configurações", icon: Settings }} active={matchesPath(pathname, "/configuracoes")} collapsed={collapsed} />
        </div>
      )}
      {isPlatformAdmin && (
        <div className="pt-1">
          <NavRow item={{ href: "/plataforma/solicitacoes", label: "Administração", icon: ShieldCheck }} active={matchesPath(pathname, "/plataforma")} collapsed={collapsed} />
        </div>
      )}
    </nav>
  );
}

function NavRow({ item, active, badgeCount = 0, collapsed }: { item: NavItem; active: boolean; badgeCount?: number; collapsed: boolean }) {
  const Icon = item.icon;
  return (
    <Link href={item.href} prefetch={false} aria-current={active ? "page" : undefined} title={collapsed ? item.label : undefined} aria-label={collapsed ? item.label : undefined} className={cn("relative flex min-h-11 items-center gap-3 rounded-xl px-2.5 py-1.5 text-[13px] transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring", active ? "bg-[hsl(var(--selection))] font-medium text-[hsl(var(--selection-foreground))]" : "text-muted-foreground hover:bg-card-hover hover:text-foreground")}>
      {active && <span aria-hidden="true" className="absolute left-0 top-1/2 h-5 w-0.5 -translate-y-1/2 rounded-full bg-[hsl(var(--selection-foreground))]" />}
      <Icon aria-hidden="true" className={cn("shrink-0", collapsed ? "mx-auto h-5 w-5" : "h-[18px] w-[18px]")} strokeWidth={1.8} />
      <span className={collapsed ? "sr-only" : "min-w-0 flex-1 truncate"}>{item.label}</span>
      <span className={collapsed ? "absolute right-0 top-0" : undefined}><UnreadBadge count={badgeCount} /></span>
    </Link>
  );
}

type ContextLink = { href: string; label: string; path?: string; segment?: string; status?: string; roles?: readonly string[] };

const CONTEXT_AREAS: Array<{ title: string; paths: readonly string[]; links: ContextLink[] }> = [
  {
    title: "Clientes",
    paths: ["/clientes"],
    links: [
      { href: "/clientes", label: "Lista de clientes", path: "/clientes" },
      { href: "/clientes?segment=vip", label: "Clientes VIP", path: "/clientes", segment: "vip" },
      { href: "/clientes?segment=birthday", label: "Aniversariantes", path: "/clientes", segment: "birthday" },
      { href: "/clientes?segment=lapsed", label: "Clientes inativos", path: "/clientes", segment: "lapsed" },
      { href: "/clientes?segment=recurring", label: "Clientes recorrentes", path: "/clientes", segment: "recurring" },
      { href: "/clientes?status=excluded", label: "Cadastros excluídos", path: "/clientes", status: "excluded", roles: ["OWNER"] },
    ],
  },
  {
    title: "Equipe",
    paths: ["/profissionais"],
    links: [
      { href: "/profissionais", label: "Colaboradores", path: "/profissionais" },
      { href: "/configuracoes#horarios", label: "Jornadas e horários", roles: MANAGEMENT_ROLES },
      { href: "/servicos", label: "Serviços da equipe" },
      { href: "/configuracoes#seguranca", label: "Acessos e permissões", roles: MANAGEMENT_ROLES },
    ],
  },
  {
    title: "Catálogo",
    paths: ["/servicos", "/produtos", "/pacotes", "/portfolio"],
    links: [
      { href: "/servicos", label: "Serviços", path: "/servicos" },
      { href: "/produtos", label: "Produtos", path: "/produtos", roles: MANAGEMENT_ROLES },
      { href: "/pacotes", label: "Pacotes e planos", path: "/pacotes", roles: MANAGEMENT_ROLES },
      { href: "/portfolio", label: "Portfólio", path: "/portfolio" },
    ],
  },
  {
    title: "Resultados",
    paths: ["/dashboard", "/financeiro", "/relatorios"],
    links: [
      { href: "/dashboard", label: "Visão geral", path: "/dashboard" },
      { href: "/financeiro", label: "Financeiro", path: "/financeiro" },
      { href: "/relatorios", label: "Relatórios", path: "/relatorios" },
    ],
  },
  {
    title: "Crescimento",
    paths: ["/marketing", "/avaliacoes", "/compartilhar", "/onboarding/configuracao"],
    links: [
      { href: "/marketing", label: "Marketing", path: "/marketing", roles: MARKETING_ROLES },
      { href: "/avaliacoes", label: "Avaliações", path: "/avaliacoes", roles: MANAGEMENT_ROLES },
      { href: "/compartilhar", label: "Presença online", path: "/compartilhar" },
      { href: "/onboarding/configuracao", label: "Guia de início", path: "/onboarding/configuracao", roles: MANAGEMENT_ROLES },
    ],
  },
];

/** Painel secundário que dá contexto sem voltar a lotar a barra de ícones. */
export function DesktopContextNav({ role }: { role: string }) {
  const pathname = usePathname();
  const searchParams = useSearchParams();
  const area = CONTEXT_AREAS.find((candidate) => candidate.paths.some((path) => matchesPath(pathname, path)));
  if (!area) return null;

  const segment = searchParams.get("segment");
  const status = searchParams.get("status");

  return (
    <nav aria-label={`Navegação de ${area.title}`} className="w-52 shrink-0 border-r border-border bg-surface-1 px-3 py-5">
      <p className="px-3 text-sm font-semibold text-foreground">{area.title}</p>
      <div className="mt-3 space-y-1">
        {area.links.filter((link) => !link.roles || link.roles.includes(role)).map((link) => {
          const active = link.path ? matchesPath(pathname, link.path) && (link.segment ? segment === link.segment : link.status ? status === link.status : !segment && !status) : false;
          return (
            <Link key={link.href} href={link.href} prefetch={false} aria-current={active ? "page" : undefined} className={cn("flex min-h-11 items-center rounded-xl px-3 text-[13px] transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring", active ? "bg-[hsl(var(--selection))] font-medium text-[hsl(var(--selection-foreground))]" : "text-muted-foreground hover:bg-card-hover hover:text-foreground")}>
              {link.label}
            </Link>
          );
        })}
      </div>
    </nav>
  );
}
