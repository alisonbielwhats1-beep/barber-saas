"use client";

import { Fragment, useEffect, useId, useState } from "react";
import { usePathname, useSearchParams } from "next/navigation";
import {
  Bell,
  CalendarClock,
  Crown,
  CalendarDays,
  ChartNoAxesCombined,
  Layers3,
  Megaphone,
  Settings,
  ShieldCheck,
  Sparkles,
  Users,
  UsersRound,
  type LucideIcon,
} from "lucide-react";
import {
  AnimatedSidebarMenu,
  AnimatedSidebarMenuButton,
  AnimatedSidebarMenuItem,
  AnimatedSidebarMenuSub,
  AnimatedSidebarMenuSubButton,
  AnimatedSidebarMenuSubItem,
} from "@/components/ui/animated-sidebar";
import { UnreadBadge } from "@/components/unread-badge";
import { openSecretary } from "./secretary-open";
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

type DesktopArea = NavItem & { activePaths: readonly string[] };

/** Áreas principais; os módulos internos aparecem como submenu da área. */
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

export function matchesPath(pathname: string, path: string) {
  return pathname === path || pathname.startsWith(`${path}/`);
}

export function canSee(item: { roles?: readonly string[] }, role: string) {
  return !item.roles || item.roles.includes(role);
}

/**
 * Navegação por áreas, usada na barra do computador e na gaveta do celular.
 * Áreas com módulos internos abrem um submenu animado; a da rota atual já
 * começa aberta.
 */
export function SidebarNav({
  id = "admin-navigation",
  role,
  unreadNotifications = 0,
  isPlatformAdmin = false,
  secretary = false,
  planHref = null,
}: {
  id?: string;
  role: string;
  unreadNotifications?: number;
  isPlatformAdmin?: boolean;
  /** "Secretária" logo depois da Agenda; abre o painel dela (que escuta o evento). */
  secretary?: boolean;
  /** "Plano e assinatura" no grupo de conta (só dono). */
  planHref?: string | null;
}) {
  const pathname = usePathname();
  const searchParams = useSearchParams();
  const segment = searchParams?.get("segment") ?? null;
  const status = searchParams?.get("status") ?? null;
  const areas = DESKTOP_AREAS.filter((area) => canSee(area, role));
  const activeArea = areas.find((area) => area.activePaths.some((path) => matchesPath(pathname, path)));
  const activeGroup = activeArea && contextFor(activeArea) ? activeArea.label : null;
  const [openSection, setOpenSection] = useState<string | null>(activeGroup);
  const menuId = useId();

  useEffect(() => {
    if (activeGroup) setOpenSection(activeGroup);
  }, [activeGroup]);

  return (
    <nav id={id} aria-label="Navegação principal" className="scrollbar-dark min-h-0 flex-1 overflow-y-auto overflow-x-hidden px-2 pb-1.5 pt-1">
      <AnimatedSidebarMenu>
        {areas.map((area) => {
          const Icon = area.icon;
          const context = contextFor(area);
          const links = context?.links.filter((link) => canSee(link, role)) ?? [];
          const active = area === activeArea;
          const submenuId = `${menuId}-${area.label}`;
          return (
            <Fragment key={area.href}>
            <AnimatedSidebarMenuItem>
              <AnimatedSidebarMenuButton
                href={links.length ? undefined : area.href}
                isActive={active}
                ariaExpanded={links.length ? openSection === area.label : undefined}
                ariaControls={submenuId}
                icon={<Icon className="h-4 w-4" strokeWidth={1.8} />}
                badge={area.href === "/notificacoes" ? <UnreadBadge count={unreadNotifications} /> : undefined}
                onSelect={() => {
                  if (links.length) setOpenSection((current) => (current === area.label ? null : area.label));
                }}
              >
                {area.label}
              </AnimatedSidebarMenuButton>
              {links.length ? (
                <AnimatedSidebarMenuSub id={submenuId} aria-label={`Navegação de ${area.label}`} open={openSection === area.label}>
                  {links.map((link) => (
                    <AnimatedSidebarMenuSubItem key={link.href}>
                      <AnimatedSidebarMenuSubButton href={link.href} isActive={isContextLinkActive(link, pathname, segment, status)}>
                        {link.label}
                      </AnimatedSidebarMenuSubButton>
                    </AnimatedSidebarMenuSubItem>
                  ))}
                </AnimatedSidebarMenuSub>
              ) : null}
            </AnimatedSidebarMenuItem>
            {secretary && area.href === "/agenda" && (
              <AnimatedSidebarMenuItem>
                <AnimatedSidebarMenuButton
                  className="secretary-nav-item"
                  icon={<Sparkles className="h-4 w-4 text-[hsl(var(--selection-foreground))]" strokeWidth={1.8} />}
                  onSelect={openSecretary}
                >
                  Secretária
                </AnimatedSidebarMenuButton>
              </AnimatedSidebarMenuItem>
            )}
            </Fragment>
          );
        })}
      </AnimatedSidebarMenu>

      {(MANAGEMENT_ROLES.some((allowedRole) => allowedRole === role) || planHref || isPlatformAdmin) && (
        <div className="mt-2 border-t border-border pt-2">
          <AnimatedSidebarMenu>
            {MANAGEMENT_ROLES.some((allowedRole) => allowedRole === role) && (
              <AnimatedSidebarMenuItem>
                <AnimatedSidebarMenuButton href="/configuracoes" isActive={matchesPath(pathname, "/configuracoes")} icon={<Settings className="h-4 w-4" strokeWidth={1.8} />}>
                  Configurações
                </AnimatedSidebarMenuButton>
              </AnimatedSidebarMenuItem>
            )}
            {planHref && (
              <AnimatedSidebarMenuItem>
                <AnimatedSidebarMenuButton href={planHref} isActive={matchesPath(pathname, "/assinatura")} icon={<Crown className="h-4 w-4" strokeWidth={1.8} />}>
                  Plano e assinatura
                </AnimatedSidebarMenuButton>
              </AnimatedSidebarMenuItem>
            )}
          </AnimatedSidebarMenu>
        </div>
      )}
      {isPlatformAdmin && (
        <div className="pt-0.5">
          <AnimatedSidebarMenu>
            <AnimatedSidebarMenuItem>
              <AnimatedSidebarMenuButton href="/plataforma/solicitacoes" isActive={matchesPath(pathname, "/plataforma")} icon={<ShieldCheck className="h-4 w-4" strokeWidth={1.8} />}>
                Administração
              </AnimatedSidebarMenuButton>
            </AnimatedSidebarMenuItem>
          </AnimatedSidebarMenu>
        </div>
      )}
    </nav>
  );
}

export type ContextLink = { href: string; label: string; path?: string; segment?: string; status?: string; roles?: readonly string[] };

export const CONTEXT_AREAS: Array<{ title: string; paths: readonly string[]; links: ContextLink[] }> = [
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

function contextFor(area: DesktopArea) {
  return CONTEXT_AREAS.find((context) => context.title === area.label);
}

function isContextLinkActive(link: ContextLink, pathname: string, segment: string | null, status: string | null) {
  if (!link.path || !matchesPath(pathname, link.path)) return false;
  if (link.segment) return segment === link.segment;
  if (link.status) return status === link.status;
  return !segment && !status;
}
