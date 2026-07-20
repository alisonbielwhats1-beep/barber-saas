"use client";

import { useTransition } from "react";
import { useRouter } from "next/navigation";
import { ChevronsUpDown, Store } from "lucide-react";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuLabel,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { setActiveSalon } from "@/lib/tenant-actions";

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

  // Se só há 1, mostra chip estático (sem menu)
  if (memberships.length <= 1) {
    return (
      <div className="flex items-center gap-2 rounded-md border bg-card px-3 py-1.5 text-sm">
        <Store className="h-3.5 w-3.5 text-primary" />
        <span className="font-medium">{current.name}</span>
      </div>
    );
  }

  return (
    <DropdownMenu>
      <DropdownMenuTrigger className="flex items-center gap-2 rounded-md border bg-card px-3 py-1.5 text-sm transition hover:bg-muted disabled:opacity-60">
        <Store className="h-3.5 w-3.5 text-primary" />
        <span className="font-medium">{current.name}</span>
        <ChevronsUpDown className="h-3.5 w-3.5 text-muted-foreground" />
      </DropdownMenuTrigger>
      <DropdownMenuContent align="start" className="min-w-[16rem]">
        <DropdownMenuLabel>Trocar de salão</DropdownMenuLabel>
        <DropdownMenuSeparator />
        {memberships.map((m) => (
          <DropdownMenuItem
            key={m.id}
            checked={m.id === current.id}
            onSelect={() => pick(m.id)}
            disabled={pending}
          >
            <div className="flex-1">
              <p className="text-sm font-medium">{m.name}</p>
              <p className="text-xs text-muted-foreground">{m.role.toLowerCase()}</p>
            </div>
          </DropdownMenuItem>
        ))}
      </DropdownMenuContent>
    </DropdownMenu>
  );
}
