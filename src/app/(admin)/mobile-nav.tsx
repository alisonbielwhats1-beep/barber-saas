"use client";

import { useEffect, useRef } from "react";
import Link from "next/link";
import { usePathname } from "next/navigation";
import {
  LayoutDashboard,
  CalendarClock,
  CalendarDays,
  Users,
  MoreHorizontal,
  X,
} from "lucide-react";
import { cn } from "@/lib/utils";
import { UnreadBadge } from "@/components/unread-badge";
import { BrandLogo } from "@/components/brand";
import {
  AnimatedSidebar,
  AnimatedSidebarClose,
  AnimatedSidebarProvider,
  AnimatedSidebarTrigger,
  useAnimatedSidebar,
} from "@/components/ui/animated-sidebar";
import { DASHBOARD_ROLES } from "@/lib/role-permissions";
import { SidebarNav } from "./sidebar-nav";
import {
  COMMAND_PALETTE_NAVIGATE_EVENT,
  OPEN_COMMAND_PALETTE_EVENT,
  OpenCommandPaletteButton,
  requestCommandPaletteOpen,
} from "./command-palette";

/**
 * Navegação compacta do admin (a barra lateral só aparece a partir de lg).
 * 3 atalhos principais + "Mais", que desliza a gaveta com a mesma navegação
 * por áreas do computador.
 */
const PRIMARY: Array<{
  href: string;
  label: string;
  icon: typeof LayoutDashboard;
  roles?: readonly string[];
}> = [
  { href: "/hoje", label: "Hoje", icon: CalendarClock, roles: DASHBOARD_ROLES },
  { href: "/agenda", label: "Agenda", icon: CalendarDays },
  { href: "/clientes", label: "Clientes", icon: Users },
];

type MobileNavProps = {
  role: string;
  unreadNotifications?: number;
  isPlatformAdmin?: boolean;
  accountControls?: React.ReactNode;
  /** Perfil e "Sair": ficam no fim do menu para a lista de módulos aparecer logo. */
  accountFooter?: React.ReactNode;
};

export function MobileNav(props: MobileNavProps) {
  return (
    <AnimatedSidebarProvider mobile shortcut={false} className="contents">
      <MobileNavBar {...props} />
    </AnimatedSidebarProvider>
  );
}

function MobileNavBar({
  role,
  unreadNotifications = 0,
  isPlatformAdmin = false,
  accountControls,
  accountFooter,
}: MobileNavProps) {
  const pathname = usePathname();
  const { openMobile: open, setOpenMobile, triggerRef } = useAnimatedSidebar();
  const openRef = useRef(open);
  const paletteRequestPendingRef = useRef(false);

  useEffect(() => {
    openRef.current = open;
    if (open || !paletteRequestPendingRef.current) return;
    // A gaveta já fechou e devolveu o foco ao "Mais": agora a busca pode abrir
    // como único modal, voltando para esse gatilho estável ao fechar.
    paletteRequestPendingRef.current = false;
    const returnTarget = triggerRef.current;
    queueMicrotask(() => requestCommandPaletteOpen(returnTarget));
  }, [open, triggerRef]);

  useEffect(() => {
    const closeBeforePalette = (event: Event) => {
      if (!openRef.current) return;
      event.preventDefault();
      paletteRequestPendingRef.current = true;
      setOpenMobile(false);
    };
    const closeAfterNavigation = () => setOpenMobile(false);
    window.addEventListener(OPEN_COMMAND_PALETTE_EVENT, closeBeforePalette);
    window.addEventListener(COMMAND_PALETTE_NAVIGATE_EVENT, closeAfterNavigation);
    return () => {
      window.removeEventListener(OPEN_COMMAND_PALETTE_EVENT, closeBeforePalette);
      window.removeEventListener(COMMAND_PALETTE_NAVIGATE_EVENT, closeAfterNavigation);
    };
  }, [setOpenMobile]);

  useEffect(() => {
    const desktop = window.matchMedia("(min-width: 1024px)");
    const closeOnDesktop = (event: MediaQueryListEvent) => {
      if (event.matches) setOpenMobile(false);
    };
    desktop.addEventListener("change", closeOnDesktop);
    return () => desktop.removeEventListener("change", closeOnDesktop);
  }, [setOpenMobile]);

  useEffect(() => { setOpenMobile(false); }, [pathname, setOpenMobile]);

  const isActive = (href: string) =>
    pathname === href || pathname.startsWith(href + "/");
  const moreActive = open || !PRIMARY.some((item) => isActive(item.href));

  return (
    <>
      <AnimatedSidebar ariaLabel="Todos os módulos" panelClassName="pt-[var(--safe-top,0px)]">
        <h2 className="sr-only">Todos os módulos</h2>
        {/* Cabeçalho reserva o canto do botão Fechar, que fica por último no DOM. */}
        <div className="flex min-h-16 shrink-0 items-center border-b border-border pl-4 pr-16">
          <BrandLogo className="!h-9 !w-[120px] text-[hsl(var(--selection-foreground))]" />
        </div>
        <div className="scrollbar-dark flex-1 space-y-4 overflow-y-auto px-4 pb-6 pt-4">
          {accountControls}
          <OpenCommandPaletteButton />
          <div className="-mx-3">
            <SidebarNav id="admin-mobile-navigation" role={role} unreadNotifications={unreadNotifications} isPlatformAdmin={isPlatformAdmin} />
          </div>
          {accountFooter}
        </div>
        {/* Por último no DOM: o foco entra pela Busca e o Tab fecha o ciclo aqui. */}
        <AnimatedSidebarClose aria-label="Fechar janela" className="absolute right-3 top-[calc(var(--safe-top,0px)+0.625rem)] text-muted-foreground hover:bg-card-hover hover:text-foreground">
          <X aria-hidden="true" className="h-4 w-4" />
        </AnimatedSidebarClose>
      </AnimatedSidebar>

      {/* Barra inferior */}
      <nav style={{ paddingLeft: "var(--safe-left)", paddingRight: "var(--safe-right)" }} className="admin-mobile-bar fixed inset-x-0 bottom-0 z-50 flex border-t border-border bg-card/95 pb-[env(safe-area-inset-bottom)] backdrop-blur lg:hidden print:hidden">
        {PRIMARY.filter((item) => !item.roles || item.roles.includes(role)).map((item) => {
          const active = !open && isActive(item.href);
          return (
            <Link
              key={item.href}
              href={item.href}
              prefetch={false}
              onClick={() => setOpenMobile(false)}
              className={cn(
                "admin-mobile-bar-item flex min-h-14 flex-1 flex-col items-center gap-1 pb-3 pt-2.5 text-xs font-medium transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-inset",
                active ? "text-primary" : "text-muted-foreground",
              )}
            >
              <span className="relative">
                <item.icon className="h-5 w-5" strokeWidth={active ? 2.4 : 2} />
              </span>
              {item.label}
            </Link>
          );
        })}
        <AnimatedSidebarTrigger
          aria-label="Abrir todos os módulos"
          aria-haspopup="dialog"
          className={cn(
            "admin-mobile-bar-item flex min-h-14 flex-1 flex-col items-center gap-1 rounded-none pb-3 pt-2.5 text-xs font-medium transition-colors focus-visible:ring-inset",
            moreActive ? "text-primary" : "text-muted-foreground",
          )}
        >
          <span className="relative"><MoreHorizontal className="h-5 w-5" strokeWidth={moreActive ? 2.4 : 2} /><UnreadBadge count={unreadNotifications} className="absolute -right-3 -top-2" /></span>
          Mais
        </AnimatedSidebarTrigger>
      </nav>
    </>
  );
}
