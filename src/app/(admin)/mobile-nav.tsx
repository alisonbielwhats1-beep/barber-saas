"use client";

import { useEffect, useRef, useState } from "react";
import Link from "next/link";
import { usePathname } from "next/navigation";
import {
  LayoutDashboard,
  CalendarDays,
  Users,
  MoreHorizontal,
  Settings,
  Bell,
  ShieldCheck,
} from "lucide-react";
import { cn } from "@/lib/utils";
import { UnreadBadge } from "@/components/unread-badge";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogTitle,
  DialogTrigger,
} from "@/components/ui/dialog";
import { DASHBOARD_ROLES, MANAGEMENT_ROLES } from "@/lib/role-permissions";
import { visibleGroups } from "./sidebar-nav";
import {
  COMMAND_PALETTE_NAVIGATE_EVENT,
  OPEN_COMMAND_PALETTE_EVENT,
  OpenCommandPaletteButton,
  requestCommandPaletteOpen,
} from "./command-palette";

/**
 * Navegação mobile do admin (a sidebar é `hidden md:flex`).
 * 3 atalhos principais + "Mais" abre painel com todos os módulos.
 */
const PRIMARY: Array<{
  href: string;
  label: string;
  icon: typeof LayoutDashboard;
  roles?: readonly string[];
}> = [
  { href: "/dashboard", label: "Início", icon: LayoutDashboard, roles: DASHBOARD_ROLES },
  { href: "/agenda", label: "Agenda", icon: CalendarDays },
  { href: "/clientes", label: "Clientes", icon: Users },
  { href: "/notificacoes", label: "Alertas", icon: Bell },
];

export function MobileNav({
  role,
  unreadNotifications = 0,
  isPlatformAdmin = false,
}: {
  role: string;
  unreadNotifications?: number;
  isPlatformAdmin?: boolean;
}) {
  const pathname = usePathname();
  const [open, setOpen] = useState(false);
  const openRef = useRef(false);
  const moreTriggerRef = useRef<HTMLButtonElement>(null);
  const paletteRequestPendingRef = useRef(false);

  function setMobileOpen(nextOpen: boolean) {
    openRef.current = nextOpen;
    setOpen(nextOpen);
  }

  useEffect(() => {
    const closeBeforePalette = (event: Event) => {
      if (!openRef.current) return;
      event.preventDefault();
      paletteRequestPendingRef.current = true;
      setMobileOpen(false);
    };
    const closeAfterNavigation = () => setMobileOpen(false);
    window.addEventListener(OPEN_COMMAND_PALETTE_EVENT, closeBeforePalette);
    window.addEventListener(COMMAND_PALETTE_NAVIGATE_EVENT, closeAfterNavigation);
    return () => {
      window.removeEventListener(OPEN_COMMAND_PALETTE_EVENT, closeBeforePalette);
      window.removeEventListener(COMMAND_PALETTE_NAVIGATE_EVENT, closeAfterNavigation);
    };
  }, []);

  useEffect(() => {
    const desktop = window.matchMedia("(min-width: 768px)");
    const closeOnDesktop = (event: MediaQueryListEvent) => {
      if (event.matches) setMobileOpen(false);
    };
    desktop.addEventListener("change", closeOnDesktop);
    return () => desktop.removeEventListener("change", closeOnDesktop);
  }, []);

  const isActive = (href: string) =>
    pathname === href || pathname.startsWith(href + "/");

  return (
    <>
      {/* Painel "Mais" — todos os módulos agrupados */}
      <Dialog open={open} onOpenChange={setMobileOpen}>
        <DialogContent
          className="inset-0 z-[60] flex h-dvh max-h-none w-full max-w-none translate-x-0 translate-y-0 flex-col gap-0 overflow-hidden rounded-none border-0 bg-background p-0 pr-0 md:hidden"
          onCloseAutoFocus={(event) => {
            if (!paletteRequestPendingRef.current) return;
            event.preventDefault();
            paletteRequestPendingRef.current = false;
            const returnTarget = moreTriggerRef.current;
            if (returnTarget?.isConnected) returnTarget.focus();

            // Radix has released the MobileNav focus scope. Replaying the
            // request now guarantees that the palette is the only open modal.
            queueMicrotask(() => requestCommandPaletteOpen(returnTarget));
          }}
        >
          <div className="border-b border-border px-5 py-4 pr-16">
            <DialogTitle className="text-sm font-semibold">Todos os módulos</DialogTitle>
            <DialogDescription className="sr-only">
              Escolha uma área do painel ou busque uma tela.
            </DialogDescription>
          </div>
          <div className="scrollbar-dark flex-1 space-y-5 overflow-y-auto px-5 py-5 pb-24">
            <OpenCommandPaletteButton />
            {visibleGroups(role).map((group) => (
              <div key={group.title}>
                <p className="mb-2 text-[10px] font-semibold uppercase tracking-widest text-muted-foreground/60">
                  {group.title}
                </p>
                <div className="grid grid-cols-2 gap-2">
                  {group.items.map((item) =>
                    item.soon ? (
                      <div
                        key={item.href}
                        className="flex items-center gap-2.5 rounded-xl border border-border bg-card px-3 py-3 text-[13px] text-muted-foreground/45"
                      >
                        <item.icon className="h-4 w-4 shrink-0" />
                        {item.label}
                      </div>
                    ) : (
                      <Link
                        key={item.href}
                        href={item.href}
                        prefetch={false}
                        onClick={() => setMobileOpen(false)}
                        className={cn(
                          "flex items-center gap-2.5 rounded-xl border px-3 py-3 text-[13px] font-medium transition-colors",
                          isActive(item.href)
                            ? "border-primary/40 bg-primary/10 text-foreground"
                            : "border-border bg-card text-muted-foreground",
                        )}
                      >
                        <item.icon
                          className={cn("h-4 w-4 shrink-0", isActive(item.href) && "text-primary")}
                        />
                        <span className="min-w-0 flex-1 truncate">{item.label}</span>
                        <UnreadBadge
                          count={item.href === "/notificacoes" ? unreadNotifications : 0}
                        />
                      </Link>
                    ),
                  )}
                </div>
              </div>
            ))}
            {MANAGEMENT_ROLES.some((allowedRole) => allowedRole === role) && (
              <Link
                href="/configuracoes"
                prefetch={false}
                onClick={() => setMobileOpen(false)}
                className={cn(
                  "flex items-center gap-2.5 rounded-xl border px-3 py-3 text-[13px] font-medium transition-colors",
                  isActive("/configuracoes")
                    ? "border-primary/40 bg-primary/10 text-foreground"
                    : "border-border bg-card text-muted-foreground",
                )}
              >
                <Settings className="h-4 w-4 shrink-0" />
                Configurações
              </Link>
            )}
            {isPlatformAdmin && (
              <Link
                href="/plataforma/solicitacoes"
                prefetch={false}
                onClick={() => setMobileOpen(false)}
                className="flex items-center gap-2.5 rounded-xl border border-primary/30 bg-primary/10 px-3 py-3 text-[13px] font-medium text-foreground"
              >
                <ShieldCheck className="h-4 w-4 shrink-0 text-primary" />
                Administração da plataforma
              </Link>
            )}
          </div>
        </DialogContent>

      {/* Barra inferior */}
      <nav className="fixed inset-x-0 bottom-0 z-50 flex border-t border-border bg-card/95 pb-[env(safe-area-inset-bottom)] backdrop-blur md:hidden print:hidden">
        {PRIMARY.filter((item) => !item.roles || item.roles.includes(role)).map((item) => {
          const active = !open && isActive(item.href);
          return (
            <Link
              key={item.href}
              href={item.href}
              prefetch={false}
              onClick={() => setMobileOpen(false)}
              className={cn(
                "flex flex-1 flex-col items-center gap-1 pb-3 pt-2.5 text-[10px] font-medium transition-colors",
                active ? "text-primary" : "text-muted-foreground",
              )}
            >
              <span className="relative">
                <item.icon className="h-5 w-5" strokeWidth={active ? 2.4 : 2} />
                <UnreadBadge
                  count={item.href === "/notificacoes" ? unreadNotifications : 0}
                  className="absolute -right-3 -top-2"
                />
              </span>
              {item.label}
            </Link>
          );
        })}
        <DialogTrigger asChild>
          <button
            ref={moreTriggerRef}
            aria-label="Abrir todos os módulos"
            className={cn(
              "flex flex-1 flex-col items-center gap-1 pb-3 pt-2.5 text-[10px] font-medium transition-colors",
              open ? "text-primary" : "text-muted-foreground",
            )}
          >
            <MoreHorizontal className="h-5 w-5" strokeWidth={open ? 2.4 : 2} />
            Mais
          </button>
        </DialogTrigger>
      </nav>
      </Dialog>
    </>
  );
}
