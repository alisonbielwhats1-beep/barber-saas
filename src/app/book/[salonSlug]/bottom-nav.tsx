"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { Home, ShoppingBag, Calendar, CalendarPlus, Bell, type LucideIcon } from "lucide-react";
import { UnreadBadge } from "@/components/unread-badge";
import { cn } from "@/lib/utils";

type BottomNavItem = {
  href: string;
  icon: LucideIcon;
  label: string;
  match: (pathname: string) => boolean;
  prominent?: boolean;
  badgeCount?: number;
};

export function BottomNav({
  salonSlug,
  unreadNotifications = 0,
}: {
  salonSlug: string;
  unreadNotifications?: number;
}) {
  const pathname = usePathname();
  const items: BottomNavItem[] = [
    {
      href: `/book/${salonSlug}`,
      icon: Home,
      label: "Início",
      match: (p: string) => p === `/book/${salonSlug}`,
    },
    {
      href: `/book/${salonSlug}/produtos`,
      icon: ShoppingBag,
      label: "Loja",
      match: (p: string) => p.includes("/produtos") || p.includes("/carrinho"),
    },
    {
      href: `/book/${salonSlug}/agendar`,
      icon: CalendarPlus,
      label: "Agendar",
      prominent: true,
      match: (p: string) => p.includes("/agendar"),
    },
    {
      href: `/book/${salonSlug}/minhas`,
      icon: Calendar,
      label: "Reservas",
      match: (p: string) => p.includes("/minhas"),
    },
    {
      href: `/book/${salonSlug}/notificacoes`,
      icon: Bell,
      label: "Notificações",
      badgeCount: unreadNotifications,
      match: (p: string) => p.includes("/notificacoes"),
    },
  ];

  return (
    <nav
      aria-label="Navegação principal do cliente"
      className="fixed inset-x-0 bottom-0 z-50 mx-auto w-full max-w-[480px] border-t border-border/80 bg-card/95 px-2 pb-[max(0.5rem,env(safe-area-inset-bottom))] pt-2 shadow-[0_-10px_30px_rgba(0,0,0,0.2)] backdrop-blur md:max-w-4xl md:px-6 lg:max-w-6xl lg:rounded-t-2xl lg:border-x lg:px-8"
    >
      <div className="grid grid-cols-5 items-end gap-1">
      {items.map((it) => {
        const active = it.match(pathname);
        const prominent = it.prominent === true;
        const badgeCount = it.badgeCount ?? 0;
        return (
          <Link
            key={it.label}
            href={it.href}
            aria-current={active ? "page" : undefined}
            aria-label={badgeCount > 0 ? `${it.label}, ${badgeCount} não lidas` : it.label}
            className={cn(
              "group flex min-h-14 min-w-0 flex-col items-center justify-end gap-1 rounded-xl px-1 py-1.5 text-[10px] font-medium transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring",
              active ? "text-primary" : "text-muted-foreground hover:text-foreground",
            )}
          >
            <span
              className={cn(
                "relative grid h-8 w-8 place-items-center rounded-full transition-colors",
                active && !prominent && "bg-primary/15",
                prominent && active && "h-11 w-11 bg-primary text-primary-foreground shadow-lg shadow-primary/20",
                prominent && !active && "h-11 w-11 border border-border bg-muted text-muted-foreground",
              )}
            >
              <it.icon aria-hidden="true" className="h-5 w-5" strokeWidth={active ? 2.5 : 2} />
              <UnreadBadge count={badgeCount} className="absolute -right-2 -top-1" />
            </span>
            <span className={cn("max-w-full truncate", prominent && active && "font-semibold text-foreground")}>
              {it.label}
            </span>
          </Link>
        );
      })}
      </div>
    </nav>
  );
}
