"use client";

import { createContext, useContext, useState } from "react";
import Link from "next/link";
import { usePathname } from "next/navigation";
import { Bell, Moon, Sun } from "lucide-react";
import { BottomNav } from "./bottom-nav";
import { UnreadBadge } from "@/components/unread-badge";
import { cn } from "@/lib/utils";
import { DialogThemeProvider } from "@/components/ui/dialog";

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
  initialTheme = "salon-dark",
}: {
  children: React.ReactNode;
  salonSlug: string;
  unreadNotifications: number;
  initialTheme?: "salon-dark" | "salon-light";
}) {
  const pathname = usePathname();
  const hideNavigation = hidesPrimaryNavigation(pathname);
  const [theme, setTheme] = useState(initialTheme);
  function toggleTheme() {
    const next = theme === "salon-dark" ? "salon-light" : "salon-dark";
    setTheme(next);
    try {
      document.cookie = `everflair-client-theme=${next === "salon-light" ? "light" : "dark"}; Path=/; Max-Age=31536000; SameSite=Lax${location.protocol === "https:" ? "; Secure" : ""}`;
    } catch { /* The current view still changes when persistence is blocked. */ }
  }

  return (
    <UnreadNotificationsContext.Provider value={unreadNotifications}>
      <DialogThemeProvider value={theme}>
      <div data-theme={theme} className="client-app min-h-dvh bg-background text-foreground">
      <div
        id="main-content"
        tabIndex={-1}
        className={cn(
          "client-shell mx-auto min-h-dvh w-full max-w-[480px] outline-none md:max-w-4xl md:px-6 lg:max-w-6xl lg:px-8",
          !hideNavigation && "pb-[calc(6.75rem+env(safe-area-inset-bottom))]",
        )}
      >
        <div className="client-appearance-bar">
          <button type="button" onClick={toggleTheme} aria-label={theme === "salon-dark" ? "Usar tema claro" : "Usar tema escuro"} className="inline-flex min-h-11 items-center gap-2 rounded-full px-3 text-xs font-medium text-muted-foreground hover:bg-muted focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring">
            {theme === "salon-dark" ? <Sun className="h-4 w-4" aria-hidden="true" /> : <Moon className="h-4 w-4" aria-hidden="true" />}
            {theme === "salon-dark" ? "Tema claro" : "Tema escuro"}
          </button>
        </div>
        {children}
      </div>
      {!hideNavigation && (
        <BottomNav salonSlug={salonSlug} unreadNotifications={unreadNotifications} />
      )}
      </div>
      </DialogThemeProvider>
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
