"use client";

import { useTransition } from "react";
import { useRouter } from "next/navigation";
import { ChevronsUpDown, Store, Check } from "lucide-react";
import { BrandMark } from "@/components/brand";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuLabel,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { setActiveSalon } from "@/lib/tenant-actions";
import { cn } from "@/lib/utils";

type Salon = { id: string; name: string; role: string };

const ROLE_LABELS: Record<string, string> = { OWNER: "Dono(a)", MANAGER: "Gerente", RECEPTIONIST: "Recepção", PROFESSIONAL: "Profissional" };
const roleLabel = (role: string) => ROLE_LABELS[role] ?? role.toLowerCase();

export function SalonSwitcher({
  current,
  memberships,
  compact = false,
  variant = "default",
}: {
  current: Salon;
  memberships: Salon[];
  compact?: boolean;
  /** "sidebar": cabeçalho do menu lateral do computador (símbolo, salão e papel), como no protótipo. */
  variant?: "default" | "sidebar";
}) {
  const router = useRouter();
  const [pending, startTransition] = useTransition();

  function pick(salonId: string) {
    if (salonId === current.id) return;
    startTransition(async () => {
      await setActiveSalon(salonId);
      router.refresh();
    });
  }

  if (variant === "sidebar") return <SidebarSalonSwitcher current={current} memberships={memberships} compact={compact} pending={pending} pick={pick} />;

  const trigger = (
    <div className={`flex min-h-11 w-full items-center gap-2 rounded-md px-2 py-1.5 text-left text-[13px] ${compact ? "justify-center" : ""}`}>
      <Store className="h-4 w-4 shrink-0 text-foreground" />
      <span className={compact ? "sr-only" : "flex-1 truncate font-medium text-foreground"}>{current.name}</span>
      {!compact && memberships.length > 1 && (
        <ChevronsUpDown className="h-3 w-3 shrink-0 text-muted-foreground" />
      )}
    </div>
  );

  if (memberships.length <= 1) {
    return (
      <div title={current.name} className="rounded-md border border-border bg-muted/30">
        {trigger}
      </div>
    );
  }

  return (
    <DropdownMenu>
      <DropdownMenuTrigger
        title={current.name}
        className={cn(
          "w-full rounded-md border border-border bg-muted/30 transition hover:bg-muted disabled:opacity-60",
          pending && "opacity-60",
        )}
        disabled={pending}
      >
        {trigger}
      </DropdownMenuTrigger>
      <DropdownMenuContent align="start" className="min-w-[13rem]" sideOffset={4}>
        <DropdownMenuLabel className="text-xs uppercase tracking-wider text-muted-foreground">
          Trocar de salão
        </DropdownMenuLabel>
        <DropdownMenuSeparator />
        {memberships.map((m) => (
          <DropdownMenuItem
            key={m.id}
            onSelect={() => pick(m.id)}
            disabled={pending}
            className="gap-2"
          >
            <Check
              className={cn("h-3 w-3 shrink-0 text-primary", m.id !== current.id && "opacity-0")}
            />
            <div className="flex-1">
              <p className="text-sm font-medium">{m.name}</p>
              <p className="text-xs text-muted-foreground capitalize">{m.role.toLowerCase()}</p>
            </div>
          </DropdownMenuItem>
        ))}
      </DropdownMenuContent>
    </DropdownMenu>
  );
}

function SidebarSalonSwitcher({ current, memberships, compact, pending, pick }: { current: Salon; memberships: Salon[]; compact: boolean; pending: boolean; pick: (salonId: string) => void }) {
  const many = memberships.length > 1;
  const content = (
    <>
      <span role="img" aria-label="Everflair" className="grid h-8 w-8 shrink-0 place-items-center rounded-lg bg-muted text-foreground ring-1 ring-inset ring-border-strong">
        <BrandMark className="!h-[18px] !w-[18px]" />
      </span>
      <span className={compact ? "sr-only" : "flex min-w-0 flex-1 flex-col leading-tight"}>
        <span className="line-clamp-2 break-words text-sm font-semibold">{current.name}</span>
        <span className="text-xs text-muted-foreground">{roleLabel(current.role)}</span>
      </span>
      {many && !compact && <ChevronsUpDown aria-hidden="true" className="h-3.5 w-3.5 shrink-0 text-muted-foreground" />}
    </>
  );
  const box = cn("flex min-h-11 w-full items-center gap-2.5 rounded-lg px-1.5 py-1 text-left text-foreground", compact && "w-10 justify-center px-0");
  if (!many) return <div title={`${current.name} · ${roleLabel(current.role)}`} className={box}>{content}</div>;
  return (
    <DropdownMenu>
      <DropdownMenuTrigger
        title={`${current.name} · ${roleLabel(current.role)}`}
        aria-label={`Salão atual: ${current.name}. Trocar de salão`}
        disabled={pending}
        className={cn(box, "transition-colors hover:bg-card-hover focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring disabled:opacity-60 data-[state=open]:bg-card-hover", pending && "opacity-60")}
      >
        {content}
      </DropdownMenuTrigger>
      <DropdownMenuContent align="start" className="w-[248px]" sideOffset={4}>
        <DropdownMenuLabel className="text-xs font-semibold uppercase tracking-[0.04em] text-muted-foreground">Trocar de salão</DropdownMenuLabel>
        {memberships.map((m) => (
          <DropdownMenuItem key={m.id} onSelect={() => pick(m.id)} disabled={pending} className="min-h-12 gap-2">
            <Check aria-hidden="true" className={cn("h-4 w-4 shrink-0", m.id !== current.id && "opacity-0")} />
            <div className="min-w-0 flex-1">
              <p className="truncate text-sm font-medium">{m.name}</p>
              <p className="text-xs text-muted-foreground">{roleLabel(m.role)}</p>
            </div>
          </DropdownMenuItem>
        ))}
      </DropdownMenuContent>
    </DropdownMenu>
  );
}
