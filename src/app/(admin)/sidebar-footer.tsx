"use client";

import { signOut, useSession } from "next-auth/react";
import { LogOut } from "lucide-react";
import { PwaInstallButton } from "@/components/pwa-install-button";

/** `inline` junta perfil e "Sair" numa linha só (menu "Mais" do celular). */
export function SidebarFooter({ plan, compact = false, inline = false }: { plan: string; compact?: boolean; inline?: boolean }) {
  const { data: session } = useSession();
  const name = session?.user?.name ?? "Usuário";
  const initials = name
    .split(" ")
    .map((n) => n[0])
    .slice(0, 2)
    .join("")
    .toUpperCase();

  return (
    <div className={`shrink-0 border-t border-border px-3 py-3 ${inline ? "flex items-center gap-2" : "space-y-2"}`}>
      <div className={`flex items-center gap-2.5 ${compact ? "justify-center" : ""} ${inline ? "min-w-0 flex-1" : ""}`}>
        <div title={`${name} · ${plan}`} className="grid h-8 w-8 shrink-0 place-items-center rounded-full bg-[hsl(var(--selection))] text-xs font-semibold text-[hsl(var(--selection-foreground))]">
          {initials}
        </div>
        <div className={compact ? "sr-only" : "min-w-0 flex-1"}>
          <p className="truncate text-[13px] font-medium leading-none">{name}</p>
          <p className="mt-0.5 text-xs text-muted-foreground">{plan}</p>
        </div>
      </div>
      <div className={`flex items-center ${compact ? "flex-col" : "justify-end gap-1"}`}>
        <PwaInstallButton />
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
