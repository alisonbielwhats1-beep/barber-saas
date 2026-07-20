"use client";

import { useState, useTransition } from "react";
import { Clock } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import {
  Dialog,
  DialogClose,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
  DialogTrigger,
} from "@/components/ui/dialog";
import { setWorkingHours } from "./actions";
import { minutesToHHMM, hhmmToMinutes } from "@/lib/utils";

const WEEKDAYS = ["Domingo", "Segunda", "Terça", "Quarta", "Quinta", "Sexta", "Sábado"];

type Row = { weekday: number; enabled: boolean; start: string; end: string };

function buildRows(
  current: { weekday: number; startMinutes: number; endMinutes: number }[],
): Row[] {
  return Array.from({ length: 7 }, (_, weekday) => {
    const existing = current.find((c) => c.weekday === weekday);
    return {
      weekday,
      enabled: !!existing,
      start: minutesToHHMM(existing?.startMinutes ?? 9 * 60),
      end: minutesToHHMM(existing?.endMinutes ?? 18 * 60),
    };
  });
}

export function WorkingHoursForm({
  professionalId,
  professionalName,
  current,
}: {
  professionalId: string;
  professionalName: string;
  current: { weekday: number; startMinutes: number; endMinutes: number }[];
}) {
  const [open, setOpen] = useState(false);
  const [rows, setRows] = useState<Row[]>(buildRows(current));
  const [pending, startTransition] = useTransition();
  const [error, setError] = useState<string | null>(null);

  function updateRow(i: number, patch: Partial<Row>) {
    setRows((r) => r.map((row, idx) => (idx === i ? { ...row, ...patch } : row)));
  }

  function copyToAll(i: number) {
    const src = rows[i];
    setRows((r) => r.map((row) => ({ ...row, start: src.start, end: src.end })));
  }

  function submit() {
    setError(null);
    startTransition(async () => {
      try {
        await setWorkingHours(
          professionalId,
          rows.map((r) => ({
            weekday: r.weekday,
            enabled: r.enabled,
            startMinutes: hhmmToMinutes(r.start),
            endMinutes: hhmmToMinutes(r.end),
          })),
        );
        setOpen(false);
      } catch (err) {
        setError(err instanceof Error ? err.message : "Erro ao salvar");
      }
    });
  }

  return (
    <Dialog
      open={open}
      onOpenChange={(o) => {
        setOpen(o);
        if (o) setRows(buildRows(current));
      }}
    >
      <DialogTrigger asChild>
        <Button variant="ghost" size="sm">
          <Clock className="h-4 w-4" /> Horários
        </Button>
      </DialogTrigger>
      <DialogContent className="max-h-[85vh] overflow-y-auto sm:max-w-xl">
        <DialogHeader>
          <DialogTitle>Horários de {professionalName}</DialogTitle>
          <DialogDescription>
            Marque os dias e defina início/fim. A agenda usa isso para calcular a
            ocupação e os slots disponíveis pro cliente reservar.
          </DialogDescription>
        </DialogHeader>

        <div className="grid gap-2">
          {rows.map((row, i) => (
            <div
              key={row.weekday}
              className="flex items-center gap-3 rounded-md border p-3"
            >
              <label className="flex min-w-[130px] cursor-pointer items-center gap-2">
                <input
                  type="checkbox"
                  className="h-4 w-4 accent-primary"
                  checked={row.enabled}
                  onChange={(e) => updateRow(i, { enabled: e.target.checked })}
                />
                <span className="text-sm font-medium">{WEEKDAYS[row.weekday]}</span>
              </label>
              <Input
                type="time"
                value={row.start}
                onChange={(e) => updateRow(i, { start: e.target.value })}
                disabled={!row.enabled}
                className="w-28"
              />
              <span className="text-muted-foreground">–</span>
              <Input
                type="time"
                value={row.end}
                onChange={(e) => updateRow(i, { end: e.target.value })}
                disabled={!row.enabled}
                className="w-28"
              />
              <Button
                type="button"
                variant="ghost"
                size="sm"
                onClick={() => copyToAll(i)}
                disabled={!row.enabled}
                title="Aplicar este horário em todos os dias"
                className="ml-auto text-xs"
              >
                Copiar
              </Button>
            </div>
          ))}
        </div>

        {error && (
          <p className="rounded-md bg-destructive/10 px-3 py-2 text-sm text-destructive">
            {error}
          </p>
        )}

        <DialogFooter>
          <DialogClose asChild>
            <Button variant="outline" type="button">Cancelar</Button>
          </DialogClose>
          <Button onClick={submit} disabled={pending}>
            {pending ? "Salvando…" : "Salvar horários"}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
