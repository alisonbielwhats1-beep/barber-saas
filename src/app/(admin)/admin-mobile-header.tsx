"use client";
import { usePathname } from "next/navigation";
import { BrandLogo } from "@/components/brand";
import type { PlanBadge } from "@/lib/billing/presentation";
import { PlanShortcut } from "./plan-shortcut";
import { NotificationsBell } from "./mobile-top-bar";
import { requestCommandPaletteOpen } from "./command-palette";
import { Search } from "lucide-react";

export function AdminMobileHeader({
  role,
  plan,
  planHref,
  unreadNotifications = 0,
}: {
  role: string;
  plan: PlanBadge;
  planHref: string;
  unreadNotifications?: number;
}) {
  const pathname = usePathname();
  const owner = role === "OWNER";
  if (pathname !== "/hoje") return null;
  return (
    <header
      role="region"
      aria-label="Marca, busca e notificações"
      className="app-topbar sticky top-0 z-30 flex items-center gap-1 border-b border-border bg-background/80 py-1.5 pl-4 pr-1.5 lg:hidden print:hidden"
    >
      <BrandLogo
        className={`!h-8 shrink-0 text-foreground ${owner ? "!w-[96px] sm:!w-[128px]" : "!w-[128px]"}`}
      />
      <button
        type="button"
        aria-label="Buscar"
        aria-haspopup="dialog"
        data-command-palette-trigger="true"
        onClick={(event) => requestCommandPaletteOpen(event.currentTarget)}
        className="press ml-auto grid h-11 w-11 shrink-0 place-items-center rounded-full text-foreground hover:bg-card-hover"
      >
        <Search aria-hidden="true" className="h-5 w-5" />
      </button>
      {owner && (
        <div
          role="group"
          aria-label="Plano do estabelecimento"
          className="min-w-0 max-w-40"
        >
          <PlanShortcut compact {...plan} href={planHref} />
        </div>
      )}
      <NotificationsBell count={unreadNotifications} />
    </header>
  );
}
