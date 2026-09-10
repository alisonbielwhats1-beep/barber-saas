"use client";

import type { Ref } from "react";
import { Ban, CalendarOff, CalendarPlus, ChevronDown, Plus, Coffee, Settings2, MousePointer2 } from "lucide-react";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuLabel,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";

type AgendaQuickActionsProps = {
  canCreateAppointment: boolean;
  canManageAvailability: boolean;
  disabled?: boolean;
  triggerRef?: Ref<HTMLButtonElement>;
  onNewAppointment: () => void;
  onNewBlock: () => void;
  onNewDayOff: () => void;
  onWeeklyPause?: () => void;
  onManageAvailability?: () => void;
  onSelectBlock?: () => void;
};

export function AgendaQuickActions({
  canCreateAppointment,
  canManageAvailability,
  disabled = false,
  triggerRef,
  onNewAppointment,
  onNewBlock,
  onNewDayOff,
  onWeeklyPause,
  onManageAvailability,
  onSelectBlock,
}: AgendaQuickActionsProps) {
  if (!canCreateAppointment && !canManageAvailability) return null;

  return (
    <DropdownMenu>
      <DropdownMenuTrigger asChild>
        <button
          ref={triggerRef}
          type="button"
          disabled={disabled}
          aria-label="Abrir ações rápidas da agenda"
          className="fixed bottom-[calc(4.5rem+env(safe-area-inset-bottom))] right-3 z-40 inline-flex h-11 w-11 items-center justify-center rounded-full bg-primary text-primary-foreground shadow-md transition hover:brightness-105 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2 disabled:opacity-40 lg:static lg:z-auto lg:h-auto lg:w-auto lg:min-h-11 lg:gap-1.5 lg:rounded-lg lg:px-4 lg:py-2 lg:text-[13px] lg:font-semibold lg:shadow-none print:hidden"
        >
          <Plus aria-hidden="true" className="h-5 w-5 lg:h-4 lg:w-4" />
          <span className="sr-only lg:not-sr-only">Novo</span>
          <ChevronDown aria-hidden="true" className="hidden h-3.5 w-3.5 lg:block" />
        </button>
      </DropdownMenuTrigger>
      <DropdownMenuContent
        side="top"
        align="end"
        collisionPadding={16}
        className="max-h-[var(--radix-dropdown-menu-content-available-height)] w-[min(18rem,calc(100vw-2rem))] overflow-y-auto rounded-xl p-2 shadow-xl"
      >
        <DropdownMenuLabel className="px-3 pb-2 pt-1">Criar na agenda</DropdownMenuLabel>
        {canCreateAppointment && (
          <DropdownMenuItem onSelect={onNewAppointment} className="min-h-14 rounded-lg px-3 py-2">
            <span className="grid h-9 w-9 shrink-0 place-items-center rounded-full bg-primary/10 text-primary">
              <CalendarPlus aria-hidden="true" className="h-4 w-4" />
            </span>
            <span>
              <span className="block font-medium">Novo agendamento</span>
              <span className="block text-xs text-muted-foreground">Escolha cliente, serviço e horário.</span>
            </span>
          </DropdownMenuItem>
        )}
        {canCreateAppointment && canManageAvailability && <DropdownMenuSeparator />}
        {canManageAvailability && (
          <>
            {onWeeklyPause && <DropdownMenuItem onSelect={onWeeklyPause} className="min-h-11 rounded-lg px-3"><Coffee aria-hidden="true" className="h-4 w-4" />Pausa recorrente</DropdownMenuItem>}
            <DropdownMenuItem onSelect={onNewBlock} className="min-h-14 rounded-lg px-3 py-2">
              <span className="grid h-9 w-9 shrink-0 place-items-center rounded-full bg-warning/10 text-warning">
                <Ban aria-hidden="true" className="h-4 w-4" />
              </span>
              <span>
                <span className="block font-medium">Novo bloqueio de horário</span>
                <span className="block text-xs text-muted-foreground">Indisponibilize um intervalo desta data.</span>
              </span>
            </DropdownMenuItem>
            {onSelectBlock && <DropdownMenuItem onSelect={onSelectBlock} className="min-h-11 rounded-lg px-3"><MousePointer2 aria-hidden="true" className="h-4 w-4" />Selecionar intervalo na grade</DropdownMenuItem>}
            {onManageAvailability && <DropdownMenuItem onSelect={onManageAvailability} className="min-h-11 rounded-lg px-3"><Settings2 aria-hidden="true" className="h-4 w-4" />Expediente e bloqueios</DropdownMenuItem>}
            <DropdownMenuItem onSelect={onNewDayOff} className="min-h-14 rounded-lg px-3 py-2">
              <span className="grid h-9 w-9 shrink-0 place-items-center rounded-full bg-muted text-muted-foreground">
                <CalendarOff aria-hidden="true" className="h-4 w-4" />
              </span>
              <span>
                <span className="block font-medium">Adicionar folga</span>
                <span className="block text-xs text-muted-foreground">Reserve o dia inteiro para quem não atenderá.</span>
              </span>
            </DropdownMenuItem>
          </>
        )}
      </DropdownMenuContent>
    </DropdownMenu>
  );
}
