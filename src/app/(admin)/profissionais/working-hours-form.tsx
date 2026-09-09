"use client";

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
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

type Row = { weekday: number; enabled: boolean; intervals: { start: string; end: string }[] };

function buildRows(
  current: { weekday: number; startMinutes: number; endMinutes: number }[],
  salonHours?: { openMinutes: number; closeMinutes: number },
): Row[] {
  return Array.from({ length: 7 }, (_, weekday) => {
    const existing = current.filter((c) => c.weekday === weekday).sort((a, b) => a.startMinutes - b.startMinutes);
    return {
      weekday, enabled: existing.length > 0,
      intervals: (existing.length ? existing : [{ startMinutes: salonHours?.openMinutes ?? 540, endMinutes: salonHours?.closeMinutes ?? 1080 }]).map((interval) => ({
        start: minutesToHHMM(interval.startMinutes), end: minutesToHHMM(interval.endMinutes),
      })),
    };
  });
}

export function WorkingHoursForm({
  professionalId,
  professionalName,
  current,
  salonHours,
}: {
  professionalId: string;
  professionalName: string;
  current: { weekday: number; startMinutes: number; endMinutes: number }[];
  salonHours?: { openMinutes: number; closeMinutes: number };
}) {
  const router = useRouter();
  const [open, setOpen] = useState(false);
  const [rows, setRows] = useState<Row[]>(buildRows(current, salonHours));
  const [pending, startTransition] = useTransition();
  const [error, setError] = useState<string | null>(null);

  function updateRow(i: number, patch: Partial<Row>) {
    setRows((r) => r.map((row, idx) => (idx === i ? { ...row, ...patch } : row)));
  }

  function copyToAll(i: number) {
    const src = rows[i];
    setRows((r) => r.map((row) => ({ ...row, intervals: src.intervals.map((interval) => ({ ...interval })) })));
  }

  function submit() {
    setError(null);
    startTransition(async () => {
      try {
        await setWorkingHours(
          professionalId,
          rows.flatMap((r) => r.enabled ? r.intervals.map((interval) => ({
            weekday: r.weekday,
            enabled: r.enabled,
            startMinutes: hhmmToMinutes(interval.start),
            endMinutes: hhmmToMinutes(interval.end),
          })) : []),
        );
        setOpen(false);
        router.refresh();
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
        if (o) { setRows(buildRows(current, salonHours)); setError(null); }
      }}
    >
      <DialogTrigger asChild>
        <Button variant="ghost" size="sm">
          <Clock className="h-4 w-4" /> Horários
        </Button>
      </DialogTrigger>
      <DialogContent className="max-h-[85dvh] overflow-y-auto sm:max-w-xl">
        <DialogHeader>
          <DialogTitle>Horários de {professionalName}</DialogTitle>
          <DialogDescription>
            Estes intervalos definem os horários disponíveis para reserva. Para uma pausa das 12h30 às 15h, encerre o primeiro intervalo às 12h30 e inicie o próximo às 15h. Fim às 00:00 significa meia-noite ao encerrar o dia.
          </DialogDescription>
        </DialogHeader>

        <div className="grid gap-2">
          {rows.map((row, i) => (
            <div
              key={row.weekday}
              className="grid gap-3 rounded-xl border border-border p-3"
            >
              <label className="flex min-w-0 cursor-pointer items-center gap-2 sm:min-w-[130px]">
                <input
                  type="checkbox"
                  className="h-4 w-4 accent-primary"
                  checked={row.enabled}
                  onChange={(e) => updateRow(i, { enabled: e.target.checked })}
                />
                <span className="text-sm font-medium">{WEEKDAYS[row.weekday]}</span>
              </label>
              {row.intervals.map((interval, index) => (
                <div key={index} className="flex min-w-0 items-center gap-2">
                  <Input type="time" aria-label={`Início ${WEEKDAYS[row.weekday]}, intervalo ${index + 1}`}
                    value={interval.start} disabled={!row.enabled} className="min-w-0 flex-1"
                    onChange={(e) => updateRow(i, { intervals: row.intervals.map((item, j) => j === index ? { ...item, start: e.target.value } : item) })} />
                  <span aria-hidden="true">–</span>
                  <Input type="time" aria-label={`Fim ${WEEKDAYS[row.weekday]}, intervalo ${index + 1}`}
                    value={interval.end === "24:00" ? "00:00" : interval.end} disabled={!row.enabled} className="min-w-0 flex-1"
                    onChange={(e) => updateRow(i, { intervals: row.intervals.map((item, j) => j === index ? { ...item, end: e.target.value === "00:00" ? "24:00" : e.target.value } : item) })} />
                  {row.intervals.length > 1 && <Button type="button" variant="ghost" disabled={!row.enabled}
                    aria-label={`Remover intervalo ${index + 1} de ${WEEKDAYS[row.weekday]}`}
                    onClick={() => updateRow(i, { intervals: row.intervals.filter((_, j) => j !== index) })}>×</Button>}
                </div>
              ))}
              {row.enabled && <Button type="button" variant="outline" disabled={row.intervals.length >= 6}
                onClick={() => updateRow(i, { intervals: [...row.intervals, { start: "14:00", end: "18:00" }] })}>Adicionar intervalo</Button>}
              <Button
                type="button"
                variant="ghost"
                size="sm"
                onClick={() => copyToAll(i)}
                disabled={!row.enabled}
                title="Aplicar este horário em todos os dias"
                className="w-full text-xs sm:ml-auto sm:w-auto"
              >
                Copiar intervalos para os outros dias
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
