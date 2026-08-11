"use client";

import { signOut, useSession } from "next-auth/react";
import { LogOut } from "lucide-react";
import { ThemeToggle } from "./theme-toggle";
import { PwaInstallButton } from "@/components/pwa-install-button";

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
    <div className="shrink-0 border-t border-border px-3 py-3">
      <div className="flex items-center gap-2.5">
        <div className="grid h-7 w-7 shrink-0 place-items-center rounded-full bg-primary/15 text-[11px] font-semibold text-primary">
          {initials}
        </div>
        <div className="min-w-0 flex-1">
          <p className="truncate text-[13px] font-medium leading-none">{name}</p>
          <p className="mt-0.5 text-[11px] text-muted-foreground">{plan}</p>
        </div>
        <PwaInstallButton />
        <ThemeToggle />
        <button
          onClick={() => signOut({ callbackUrl: "/" })}
          title="Sair"
          aria-label="Sair da conta"
          className="grid h-11 w-11 shrink-0 place-items-center rounded-lg text-muted-foreground transition hover:bg-muted hover:text-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
        >
          <LogOut className="h-4 w-4" />
        </button>
      </div>
    </div>
  );
}
