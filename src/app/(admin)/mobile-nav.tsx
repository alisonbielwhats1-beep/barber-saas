"use client";

import { useState } from "react";
import Link from "next/link";
import { usePathname } from "next/navigation";
import {
  LayoutDashboard,
  CalendarDays,
  Users,
  MoreHorizontal,
  Settings,
  Bell,
  X,
} from "lucide-react";
import { cn } from "@/lib/utils";
import { UnreadBadge } from "@/components/unread-badge";
import { DASHBOARD_ROLES, MANAGEMENT_ROLES } from "@/lib/role-permissions";
import { visibleGroups } from "./sidebar-nav";
import { OpenCommandPaletteButton } from "./command-palette";

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
}: {
  role: string;
  unreadNotifications?: number;
}) {
  const pathname = usePathname();
  const [open, setOpen] = useState(false);

  const isActive = (href: string) =>
    pathname === href || pathname.startsWith(href + "/");

  return (
    <>
      {/* Painel "Mais" — todos os módulos agrupados */}
      {open && (
        <div className="fixed inset-0 z-50 flex flex-col bg-background md:hidden">
          <div className="flex items-center justify-between border-b border-border px-5 py-4">
            <p className="text-sm font-semibold">Todos os módulos</p>
            <button
              onClick={() => setOpen(false)}
              aria-label="Fechar menu"
              className="grid h-8 w-8 place-items-center rounded-lg text-muted-foreground hover:bg-muted hover:text-foreground"
            >
              <X className="h-4 w-4" />
            </button>
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
                        onClick={() => setOpen(false)}
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
                onClick={() => setOpen(false)}
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
          </div>
        </div>
      )}

      {/* Barra inferior */}
      <nav className="fixed inset-x-0 bottom-0 z-50 flex border-t border-border bg-card/95 pb-[env(safe-area-inset-bottom)] backdrop-blur md:hidden print:hidden">
        {PRIMARY.filter((item) => !item.roles || item.roles.includes(role)).map((item) => {
          const active = !open && isActive(item.href);
          return (
            <Link
              key={item.href}
              href={item.href}
              prefetch={false}
              onClick={() => setOpen(false)}
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
        <button
          onClick={() => setOpen((o) => !o)}
          className={cn(
            "flex flex-1 flex-col items-center gap-1 pb-3 pt-2.5 text-[10px] font-medium transition-colors",
            open ? "text-primary" : "text-muted-foreground",
          )}
        >
          <MoreHorizontal className="h-5 w-5" strokeWidth={open ? 2.4 : 2} />
          Mais
        </button>
      </nav>
    </>
  );
}
