"use client";

import { signOut, useSession } from "next-auth/react";
import { LogOut } from "lucide-react";
import { PwaInstallButton } from "@/components/pwa-install-button";
import { cn } from "@/lib/utils";
import { ThemeToggle } from "./theme-toggle";

const ROLE_LABELS: Record<string, string> = { OWNER: "Dono(a)", MANAGER: "Gerente", RECEPTIONIST: "Recepção", PROFESSIONAL: "Profissional" };

/**
 * Pessoa no fim do menu lateral (padrão do protótipo): avatar, nome e papel, com tema, instalar e sair embaixo.
 * `inline` junta perfil e "Sair" numa linha só (menu "Mais" do celular, onde o tema fica no cartão do topo).
 */
export function SidebarFooter({ plan, role, compact = false, inline = false }: { plan: string; role?: string; compact?: boolean; inline?: boolean }) {
  const { data: session } = useSession();
  const name = session?.user?.name ?? "Usuário";
  const initials = name
    .split(" ")
    .map((n) => n[0])
    .slice(0, 2)
    .join("")
    .toUpperCase();
  const subtitle = role ? ROLE_LABELS[role] ?? plan : plan;
  const action = "grid h-8 shrink-0 place-items-center rounded-md text-muted-foreground transition-colors hover:bg-card-hover hover:text-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring";

  if (inline) {
    return (
      <div className="flex shrink-0 items-center gap-2 border-t border-border px-3 py-3">
        <div className="flex min-w-0 flex-1 items-center gap-2.5">
          <div title={`${name} · ${plan}`} className="grid h-8 w-8 shrink-0 place-items-center rounded-full bg-muted text-xs font-semibold">
            {initials}
          </div>
          <div className="min-w-0 flex-1">
            <p className="truncate text-sm font-semibold leading-tight">{name}</p>
            <p className="truncate text-xs text-muted-foreground">{subtitle}</p>
          </div>
        </div>
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
    );
  }

  return (
    <div className={cn("flex shrink-0 flex-col gap-1.5 border-t border-border py-1.5", compact ? "items-center px-0 py-2.5" : "px-3")}>
      <div title={compact ? `${name} · ${subtitle}` : undefined} className="flex min-w-0 items-center gap-2.5">
        <div aria-hidden={compact ? undefined : true} className="grid h-8 w-8 shrink-0 place-items-center rounded-full bg-muted text-xs font-semibold">
          {initials}
        </div>
        <div className={compact ? "sr-only" : "min-w-0 flex-1 leading-tight"}>
          <p className="truncate text-sm font-semibold">{name}</p>
          <p className="truncate text-xs text-muted-foreground">{subtitle}</p>
        </div>
      </div>
      <div className={cn("flex items-center gap-1", compact && "flex-col")}>
        <ThemeToggle className={cn(action, "h-8 w-auto flex-1 border-0 bg-transparent", compact && "w-9 flex-none")} />
        <PwaInstallButton className={cn(action, "h-8 w-auto flex-1", compact && "w-9 flex-none")} />
        <button
          onClick={() => signOut({ callbackUrl: "/" })}
          title="Sair"
          aria-label="Sair da conta"
          className={cn(action, "flex-1", compact && "w-9 flex-none")}
        >
          <LogOut className="h-4 w-4" strokeWidth={1.8} />
        </button>
      </div>
    </div>
  );
}
