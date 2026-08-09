"use client";

import { useTransition } from "react";
import { useRouter } from "next/navigation";
import { ChevronsUpDown, Store, Check } from "lucide-react";
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

export function SalonSwitcher({
  current,
  memberships,
}: {
  current: Salon;
  memberships: Salon[];
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

  const trigger = (
    <div className="flex w-full items-center gap-3 rounded-xl px-3 py-2.5 text-left text-[12px]">
      <span className="experience-icon-surface grid h-9 w-9 shrink-0 place-items-center rounded-lg border">
        <Store className="h-4 w-4" />
      </span>
      <span className="min-w-0 flex-1">
        <span className="block text-[9px] font-semibold uppercase tracking-[0.16em] text-muted-foreground">Estabelecimento</span>
        <span className="mt-0.5 block truncate font-semibold text-foreground">{current.name}</span>
      </span>
      {memberships.length > 1 && (
        <ChevronsUpDown className="h-3 w-3 shrink-0 text-muted-foreground" />
      )}
    </div>
  );

  if (memberships.length <= 1) {
    return (
      <div className="experience-surface overflow-hidden">
        {trigger}
      </div>
    );
  }

  return (
    <DropdownMenu>
      <DropdownMenuTrigger
        className={cn(
          "experience-surface w-full overflow-hidden transition hover:border-border-strong hover:bg-card-hover disabled:opacity-60",
          pending && "opacity-60",
        )}
        disabled={pending}
      >
        {trigger}
      </DropdownMenuTrigger>
      <DropdownMenuContent align="start" className="min-w-[13rem]" sideOffset={4}>
        <DropdownMenuLabel className="text-[11px] uppercase tracking-wider text-muted-foreground">
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
