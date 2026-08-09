"use client";

import { createContext, useContext } from "react";
import Link from "next/link";
import { usePathname } from "next/navigation";
import { Bell } from "lucide-react";
import { BottomNav } from "./bottom-nav";
import { UnreadBadge } from "@/components/unread-badge";
import { cn } from "@/lib/utils";

const UnreadNotificationsContext = createContext(0);

function hidesPrimaryNavigation(pathname: string): boolean {
  return ["/agendar", "/login", "/cadastro", "/welcome"].some((segment) =>
    pathname.includes(segment),
  );
}

export function ClientShell({
  children,
  salonSlug,
  unreadNotifications,
}: {
  children: React.ReactNode;
  salonSlug: string;
  unreadNotifications: number;
}) {
  const pathname = usePathname();
  const hideNavigation = hidesPrimaryNavigation(pathname);

  return (
    <UnreadNotificationsContext.Provider value={unreadNotifications}>
      <div
        className={cn(
          "mx-auto min-h-dvh w-full",
          hideNavigation ? "max-w-[760px]" : "max-w-[1180px]",
          !hideNavigation && "pb-[calc(6.75rem+env(safe-area-inset-bottom))]",
        )}
      >
        {children}
      </div>
      {!hideNavigation && (
        <BottomNav salonSlug={salonSlug} unreadNotifications={unreadNotifications} />
      )}
    </UnreadNotificationsContext.Provider>
  );
}

export function ClientNotificationLink({
  salonSlug,
  className,
}: {
  salonSlug: string;
  className?: string;
}) {
  const unreadNotifications = useContext(UnreadNotificationsContext);
  const accessibleLabel = unreadNotifications > 0
    ? `Notificações, ${unreadNotifications} ${unreadNotifications === 1 ? "não lida" : "não lidas"}`
    : "Notificações";

  return (
    <Link
      href={`/book/${salonSlug}/notificacoes`}
      aria-label={accessibleLabel}
      className={cn(
        "relative grid h-11 w-11 place-items-center rounded-full border border-border bg-card text-muted-foreground transition-colors hover:text-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring",
        className,
      )}
    >
      <Bell className="h-4 w-4" />
      <UnreadBadge
        count={unreadNotifications}
        className="absolute -right-1 -top-1"
      />
    </Link>
  );
}
