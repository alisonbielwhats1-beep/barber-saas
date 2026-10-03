"use client";

import { PanelLeftClose, PanelLeftOpen } from "lucide-react";
import { BrandLogo, BrandMark } from "@/components/brand";
import {
  AnimatedSidebar,
  AnimatedSidebarProvider,
  AnimatedSidebarTrigger,
  useAnimatedSidebar,
  useAnimatedSidebarPanel,
} from "@/components/ui/animated-sidebar";
import { cn } from "@/lib/utils";
import { ThemeToggle } from "./theme-toggle";
import { SidebarNav } from "./sidebar-nav";
import { SidebarFooter } from "./sidebar-footer";
import { SalonSwitcher } from "./salon-switcher";
import { OpenCommandPaletteButton } from "./command-palette";

type Salon = { id: string; name: string; role: string };

type AdminSidebarProps = {
  current: Salon;
  memberships: Salon[];
  role: string;
  plan: string;
  unreadNotifications: number;
  isPlatformAdmin: boolean;
};

/**
 * Barra flutuante do computador (a partir de lg). Entra recolhida em ícones e
 * expande com animação pelo botão ou por Ctrl/⌘+B. No celular a mesma
 * navegação aparece na gaveta de MobileNav.
 */
export function AdminSidebar(props: AdminSidebarProps) {
  return (
    <AnimatedSidebarProvider defaultOpen={false} mobile={false} className="hidden min-h-0 w-auto shrink-0 lg:flex print:hidden">
      <DesktopSidebar {...props} />
    </AnimatedSidebarProvider>
  );
}

function DesktopSidebar(props: AdminSidebarProps) {
  const { open } = useAnimatedSidebar();
  return (
    <AnimatedSidebar
      ariaLabel="Menu do estabelecimento"
      variant="floating"
      collapsible="icon"
      data-collapsed={!open}
      panelClassName="admin-sidebar"
    >
      <SidebarBody {...props} />
    </AnimatedSidebar>
  );
}

function SidebarBody({ current, memberships, role, plan, unreadNotifications, isPlatformAdmin }: AdminSidebarProps) {
  const { collapsed } = useAnimatedSidebarPanel();
  const label = collapsed ? "Expandir menu" : "Recolher menu";
  return (
    <>
      <div className={cn("flex shrink-0 items-center p-3", collapsed ? "flex-col gap-1" : "justify-between")}>
        {collapsed ? (
          <span role="img" aria-label="Everflair — símbolo Flair" className="grid h-11 w-11 place-items-center text-[hsl(var(--selection-foreground))]">
            <BrandMark className="!h-8 !w-8" />
          </span>
        ) : <BrandLogo className="!h-11 !w-[144px] text-[hsl(var(--selection-foreground))]" />}
        <AnimatedSidebarTrigger title={`${label} (Ctrl+B)`} aria-controls="admin-navigation" className="text-muted-foreground transition-colors hover:bg-card-hover hover:text-foreground">
          {collapsed ? <PanelLeftOpen size={19} aria-hidden="true" /> : <PanelLeftClose size={19} aria-hidden="true" />}
        </AnimatedSidebarTrigger>
      </div>
      <div className={cn("flex px-3 pb-3", collapsed ? "justify-center" : "items-center justify-between")}>
        {!collapsed && <span className="text-xs font-medium text-muted-foreground">Aparência</span>}
        <ThemeToggle />
      </div>
      <div className="space-y-2 px-3 pb-3">
        <SalonSwitcher current={current} memberships={memberships} compact={collapsed} />
        <OpenCommandPaletteButton compact={collapsed} />
      </div>
      <SidebarNav role={role} unreadNotifications={unreadNotifications} isPlatformAdmin={isPlatformAdmin} />
      <SidebarFooter plan={plan} compact={collapsed} />
    </>
  );
}
