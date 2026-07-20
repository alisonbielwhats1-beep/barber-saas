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
    <div className="flex w-full items-center gap-2 rounded-md px-2 py-1.5 text-left text-[12px]">
      <Store className="h-3 w-3 shrink-0 text-primary" />
      <span className="flex-1 truncate font-medium text-foreground">{current.name}</span>
      {memberships.length > 1 && (
        <ChevronsUpDown className="h-3 w-3 shrink-0 text-muted-foreground" />
      )}
    </div>
  );

  if (memberships.length <= 1) {
    return (
      <div className="rounded-md border border-border bg-muted/30">
        {trigger}
      </div>
    );
  }

  return (
    <DropdownMenu>
      <DropdownMenuTrigger
        className={cn(
          "w-full rounded-md border border-border bg-muted/30 transition hover:bg-muted disabled:opacity-60",
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
