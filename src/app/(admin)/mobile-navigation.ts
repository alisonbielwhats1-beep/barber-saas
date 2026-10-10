import {
  ArchiveX,
  Bell,
  Cake,
  CalendarClock,
  CalendarDays,
  ChartPie,
  Clock3,
  Crown,
  FileBarChart2,
  Globe,
  Images,
  KeyRound,
  Megaphone,
  Package,
  Repeat,
  Rocket,
  Scissors,
  Settings,
  ShieldCheck,
  ShoppingBag,
  Star,
  Users,
  UserX,
  UsersRound,
  Wallet,
  type LucideIcon,
} from "lucide-react";
import { DASHBOARD_ROLES, MANAGEMENT_ROLES } from "@/lib/role-permissions";
import { CONTEXT_AREAS, DESKTOP_AREAS, canSee, matchesPath } from "./sidebar-nav";

/** Bottom tab bar of the panel on phones and tablets (below 1024px): at most four destinations plus "Mais". */
export type MobileTab = { href: string; label: string; icon: LucideIcon; roles?: readonly string[]; badge?: "notifications" };

export const MOBILE_TABS: readonly MobileTab[] = [
  { href: "/hoje", label: "Hoje", icon: CalendarClock, roles: DASHBOARD_ROLES },
  { href: "/agenda", label: "Agenda", icon: CalendarDays },
  { href: "/clientes", label: "Clientes", icon: Users },
  { href: "/notificacoes", label: "Avisos", icon: Bell, badge: "notifications" },
];

export function mobileTabsFor(role: string) {
  return MOBILE_TABS.filter((tab) => canSee(tab, role));
}

/** Asks the "Mais" sheet to open (back button of module screens). */
export const OPEN_MORE_EVENT = "everflair:open-more";

export type MoreLink = { href: string; label: string; icon: LucideIcon };
export type MoreGroup = { title: string; links: MoreLink[] };

const LINK_ICONS: Record<string, LucideIcon> = {
  "/clientes?segment=vip": Crown,
  "/clientes?segment=birthday": Cake,
  "/clientes?segment=lapsed": UserX,
  "/clientes?segment=recurring": Repeat,
  "/clientes?status=excluded": ArchiveX,
  "/profissionais": UsersRound,
  "/configuracoes#horarios": Clock3,
  "/configuracoes#seguranca": KeyRound,
  "/servicos": Scissors,
  "/produtos": ShoppingBag,
  "/pacotes": Package,
  "/portfolio": Images,
  "/dashboard": ChartPie,
  "/financeiro": Wallet,
  "/relatorios": FileBarChart2,
  "/marketing": Megaphone,
  "/avaliacoes": Star,
  "/compartilhar": Globe,
  "/onboarding/configuracao": Rocket,
};

/**
 * Areas that already are tabs: the tab itself is their root ("Lista de clientes"), so only the shortcuts under it are
 * listed in "Mais" (segments and, for the owner, "Cadastros excluídos"), with the same role gate as the desktop sidebar.
 */
const TAB_AREAS = new Set(["Clientes"]);

/**
 * "Mais" groups, derived from the desktop navigation so both stay in sync.
 * A module listed under several areas appears once, under the area that owns its path.
 */
export function moreGroupsFor(role: string, isPlatformAdmin: boolean): MoreGroup[] {
  const groups: MoreGroup[] = [];
  for (const area of DESKTOP_AREAS) {
    if (!canSee(area, role)) continue;
    const context = CONTEXT_AREAS.find((item) => item.title === area.label);
    if (!context) continue;
    const links = context.links
      .filter((link) => canSee(link, role))
      .filter((link) => !(TAB_AREAS.has(area.label) && link.href === area.href))
      .filter((link) => {
        const path = link.path ?? link.href.split(/[?#]/)[0];
        const owner = DESKTOP_AREAS.find((candidate) => candidate.activePaths.some((active) => matchesPath(path, active)));
        return !owner || owner.label === area.label;
      })
      .map((link) => ({ href: link.href, label: link.label, icon: LINK_ICONS[link.href] ?? area.icon }));
    if (links.length) groups.push({ title: area.label, links });
  }
  const settings: MoreLink[] = [];
  if (MANAGEMENT_ROLES.some((allowed) => allowed === role)) settings.push({ href: "/configuracoes", label: "Configurações", icon: Settings });
  if (isPlatformAdmin) settings.push({ href: "/plataforma/solicitacoes", label: "Administração", icon: ShieldCheck });
  if (settings.length) groups.push({ title: "Ajustes", links: settings });
  return groups;
}

const EXTRA_TITLES: Array<[path: string, title: string]> = [
  ["/configuracoes", "Configurações"],
  ["/assinatura", "Meu plano"],
  ["/servicos/secretaria", "Secretária"],
  ["/plataforma", "Administração"],
];

/** Title for the compact top bar of a screen; tab roots have no back button. */
export function mobileScreenFor(pathname: string) {
  const tab = MOBILE_TABS.find((item) => item.href === pathname);
  if (tab) return { title: tab.href === "/notificacoes" ? "Notificações" : tab.label, isTabRoot: true };
  const extra = EXTRA_TITLES.find(([path]) => matchesPath(pathname, path));
  if (extra) return { title: extra[1], isTabRoot: false };
  for (const context of CONTEXT_AREAS) {
    const link = context.links.find((item) => item.path && item.path === pathname);
    if (link) return { title: link.label === "Visão geral" ? "Resultados" : link.label, isTabRoot: false };
  }
  const area = DESKTOP_AREAS.find((item) => item.activePaths.some((path) => matchesPath(pathname, path)));
  return { title: area?.label ?? "Everflair", isTabRoot: Boolean(area && MOBILE_TABS.some((item) => item.href === area.href)) };
}

