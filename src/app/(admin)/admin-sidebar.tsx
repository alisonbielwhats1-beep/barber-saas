"use client";

import { useEffect, useState } from "react";
import Link from "next/link";
import { usePathname } from "next/navigation";
import { useSession } from "next-auth/react";
import { Bell, PanelLeft, Search } from "lucide-react";
import {
  AnimatedSidebar,
  AnimatedSidebarProvider,
  AnimatedSidebarTrigger,
  useAnimatedSidebar,
  useAnimatedSidebarPanel,
} from "@/components/ui/animated-sidebar";
import type { PlanBadge } from "@/lib/billing/presentation";
import { cn } from "@/lib/utils";
import { SidebarNav } from "./sidebar-nav";
import { SidebarFooter } from "./sidebar-footer";
import { SalonSwitcher } from "./salon-switcher";
import { commandShortcutLabel } from "@/lib/platform-shortcut";
import { requestCommandPaletteOpen } from "./command-palette";
import { desktopTitleFor } from "./mobile-navigation";
import { PlanShortcut } from "./plan-shortcut";

type Salon = { id: string; name: string; role: string };

export type AdminSidebarProps = {
  current: Salon;
  memberships: Salon[];
  role: string;
  plan: string;
  unreadNotifications: number;
  isPlatformAdmin: boolean;
  /** Mostra "Secretária" no menu (só quando o painel dela existe para este acesso). */
  secretary?: boolean;
  /** "Plano e assinatura" no grupo de conta, só para quem é dono. */
  planHref?: string | null;
};

/** Cookie com a preferência de menu recolhido, lido no servidor para não piscar ao recarregar. */
export const SIDEBAR_COOKIE = "admin-sidebar";

/**
 * Moldura do computador (a partir de lg): menu lateral no padrão do protótipo (aberto por padrão, recolhe em ícones
 * pelo botão do topo ou Ctrl/⌘+B) e a área principal, que recebe a barra de topo. No celular a navegação fica na
 * barra de abas e no "Mais" (MobileNav).
 */
export function AdminFrame({
  defaultOpen = true,
  children,
  ...props
}: AdminSidebarProps & { defaultOpen?: boolean; children: React.ReactNode }) {
  return (
    <AnimatedSidebarProvider
      defaultOpen={defaultOpen}
      mobile={false}
      onOpenChange={(open) => {
        document.cookie = `${SIDEBAR_COOKIE}=${open ? "expanded" : "collapsed"}; path=/; max-age=31536000; samesite=lax`;
      }}
      className="h-full min-h-0 min-w-0 flex-1"
    >
      <AdminSidebar {...props} />
      {children}
    </AnimatedSidebarProvider>
  );
}

export function AdminSidebar(props: AdminSidebarProps) {
  const { open } = useAnimatedSidebar();
  return (
    <AnimatedSidebar
      ariaLabel="Menu do estabelecimento"
      variant="sidebar"
      collapsible="icon"
      data-collapsed={!open}
      className="print:hidden"
      panelClassName="admin-sidebar h-full"
    >
      <SidebarBody {...props} />
    </AnimatedSidebar>
  );
}

function SidebarBody({ current, memberships, role, plan, unreadNotifications, isPlatformAdmin, secretary = false, planHref = null }: AdminSidebarProps) {
  const { collapsed } = useAnimatedSidebarPanel();
  return (
    <>
      <div className={cn("flex min-h-14 shrink-0 items-center py-1.5", collapsed ? "justify-center px-2" : "px-2")}>
        <SalonSwitcher current={current} memberships={memberships} compact={collapsed} variant="sidebar" />
      </div>
      <SidebarNav role={role} unreadNotifications={unreadNotifications} isPlatformAdmin={isPlatformAdmin} secretary={secretary} planHref={planHref} />
      <SidebarFooter plan={plan} role={current.role} compact={collapsed} />
    </>
  );
}

/**
 * Barra de topo do computador: recolher menu, título da tela, plano (dono), busca, avisos e a pessoa.
 * O título é texto simples: cada página mantém o seu próprio h1.
 */
export function DesktopTopBar({
  unreadNotifications,
  plan,
}: {
  unreadNotifications: number;
  plan?: (PlanBadge & { href: string }) | null;
}) {
  const pathname = usePathname();
  const { data: session } = useSession();
  const { open } = useAnimatedSidebar();
  const [shortcut, setShortcut] = useState<"⌘K" | "Ctrl K">("Ctrl K");
  useEffect(() => setShortcut(commandShortcutLabel(navigator.platform)), []);
  const name = session?.user?.name ?? "";
  const initials = name.split(" ").filter(Boolean).map((part) => part[0]).slice(0, 2).join("").toUpperCase();
  const toggleLabel = open ? "Recolher menu" : "Expandir menu";
  const bellLabel = unreadNotifications > 0 ? `Notificações, ${unreadNotifications} não lidas` : "Notificações";

  return (
    <header aria-label="Barra do painel" className="sticky top-0 z-30 hidden h-[3.25rem] shrink-0 items-center gap-2 border-b border-border bg-background/95 pl-2.5 pr-3.5 backdrop-blur lg:flex print:hidden">
      <AnimatedSidebarTrigger
        title={`${toggleLabel} (Ctrl+B)`}
        aria-label={toggleLabel}
        aria-controls="admin-navigation"
        className="h-9 min-h-9 w-9 min-w-9 rounded-[9px] text-muted-foreground transition-colors hover:bg-card-hover hover:text-foreground"
      >
        <PanelLeft aria-hidden="true" className="h-4 w-4" strokeWidth={1.8} />
      </AnimatedSidebarTrigger>
      <span aria-hidden="true" className="h-[18px] w-px bg-border-strong" />
      <p className="ml-1 min-w-0 truncate text-base font-semibold">{desktopTitleFor(pathname)}</p>
      <span className="flex-1" />
      {plan && (
        <div aria-label="Plano do estabelecimento" className="min-w-0">
          <PlanShortcut compact {...plan} />
        </div>
      )}
      <button
        type="button"
        onClick={(event) => requestCommandPaletteOpen(event.currentTarget)}
        aria-haspopup="dialog"
        aria-keyshortcuts="Control+K Meta+K"
        aria-label={`Buscar (${shortcut})`}
        data-command-palette-trigger="true"
        className="mr-1 flex h-9 w-[190px] items-center gap-2 rounded-lg border border-border-strong bg-card px-2.5 text-sm text-muted-foreground transition-colors hover:text-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
      >
        <Search aria-hidden="true" className="h-3.5 w-3.5 shrink-0" />
        Buscar
        <kbd className="ml-auto rounded-[5px] border border-border-strong px-1 text-xs font-normal">{shortcut}</kbd>
      </button>
      <Link
        href="/notificacoes"
        prefetch={false}
        aria-label={bellLabel}
        title={bellLabel}
        className="relative grid h-9 w-9 place-items-center rounded-[9px] text-foreground transition-colors hover:bg-card-hover focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
      >
        <Bell aria-hidden="true" className="h-4 w-4" strokeWidth={1.8} />
        {unreadNotifications > 0 && (
          <span aria-hidden="true" className="absolute right-[7px] top-[7px] h-2 w-2 rounded-full bg-[hsl(var(--selection-solid))] ring-2 ring-background" />
        )}
      </Link>
      {initials && (
        <span role="img" aria-label={name} title={name} className="grid h-8 w-8 shrink-0 place-items-center rounded-full bg-muted text-xs font-semibold">
          {initials}
        </span>
      )}
    </header>
  );
}
