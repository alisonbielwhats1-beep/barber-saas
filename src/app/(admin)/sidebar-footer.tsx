"use client";

import { signOut, useSession } from "next-auth/react";
import { LogOut } from "lucide-react";
import { ThemeToggle } from "./theme-toggle";

export function SidebarFooter({ plan }: { plan: string }) {
  const { data: session } = useSession();
  const name = session?.user?.name ?? "Usuário";
  const initials = name
    .split(" ")
    .map((n) => n[0])
    .slice(0, 2)
    .join("")
    .toUpperCase();

  return (
    <div className="shrink-0 border-t border-border/70 p-3">
      <div className="experience-surface flex items-center gap-2.5 p-2.5">
        <div className="experience-icon-surface grid h-9 w-9 shrink-0 place-items-center rounded-full border text-[11px] font-semibold">
          {initials}
        </div>
        <div className="min-w-0 flex-1">
          <p className="truncate text-[13px] font-semibold leading-none">{name}</p>
          <p className="mt-1 text-[9px] font-semibold uppercase tracking-[0.15em] text-muted-foreground">Plano {plan}</p>
        </div>
        <ThemeToggle />
        <button
          onClick={() => signOut({ callbackUrl: "/" })}
          title="Sair"
          aria-label="Sair da conta"
          className="grid h-9 w-9 shrink-0 place-items-center rounded-lg text-muted-foreground transition hover:bg-muted hover:text-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
        >
          <LogOut className="h-3.5 w-3.5" />
        </button>
      </div>
    </div>
  );
}
