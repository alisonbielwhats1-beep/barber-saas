"use client";

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { ptBR } from "date-fns/locale";
import { formatInTimeZone } from "date-fns-tz";
import { CalendarOff, Plus, Trash2, Loader2 } from "lucide-react";
import { Input } from "@/components/ui/input";
import { Button } from "@/components/ui/button";
import { IconButton } from "@/components/ui/icon-button";
import { createSalonClosure, deleteSalonClosure } from "../agenda/actions";

export type Closure = {
  id: string;
  startAt: string;
  endAt: string;
  reason: string | null;
};

/**
 * Bloqueio de dia(s) inteiro(s) do salão — feriado, reforma, viagem. Some do
 * agendamento público E do manual do admin nesse intervalo, pros três (não
 * cancela retroativamente o que já existia antes de o bloqueio ser criado).
 */
export function ClosuresManager({
  closures,
  canManage,
  timezone,
}: {
  closures: Closure[];
  canManage: boolean;
  timezone: string;
}) {
  const router = useRouter();
  const [pending, startTransition] = useTransition();
  const [open, setOpen] = useState(false);
  const [error, setError] = useState<string | null>(null);

  function run(fn: () => Promise<{ error: string } | { success: true }>) {
    setError(null);
    startTransition(async () => {
      const result = await fn();
      if ("error" in result) setError(result.error);
      else {
        setOpen(false);
        router.refresh();
      }
    });
  }

  function onSubmit(e: React.FormEvent<HTMLFormElement>) {
    e.preventDefault();
    const f = new FormData(e.currentTarget);
    const startDate = String(f.get("startDate"));
    const endDate = String(f.get("endDate") || startDate);
    const reason = (f.get("reason") as string) || null;
    run(() => createSalonClosure({ startDate, endDate, reason }));
  }

  return (
    <div className="rounded-2xl border border-border bg-card p-5">
      <div className="mb-4 flex items-center justify-between">
        <div className="flex items-center gap-2">
          <CalendarOff className="h-4 w-4 text-muted-foreground" />
          <h3 className="text-[13px] font-semibold">Bloqueios do salão</h3>
        </div>
        {canManage && (
          <Button type="button" size="sm" variant="outline" onClick={() => setOpen((o) => !o)}>
            <Plus className="mr-1 h-3.5 w-3.5" />
            Novo bloqueio
          </Button>
        )}
      </div>
      <p className="mb-4 text-[12px] text-muted-foreground">
        Feriado, reforma, viagem — impede novo agendamento (do cliente e do admin) no período. Não
        cancela reservas que já existiam antes do bloqueio.
      </p>

      {open && (
        <form onSubmit={onSubmit} className="mb-4 grid gap-3 rounded-xl border border-border p-4 sm:grid-cols-2">
          <div>
            <label className="mb-1 block text-[12px] font-medium">De</label>
            <Input name="startDate" type="date" required />
          </div>
          <div>
            <label className="mb-1 block text-[12px] font-medium">Até</label>
            <Input name="endDate" type="date" />
          </div>
          <div className="sm:col-span-2">
            <label className="mb-1 block text-[12px] font-medium">Motivo (opcional)</label>
            <Input name="reason" placeholder="Ex.: Feriado de Corpus Christi" maxLength={200} />
          </div>
          {error && <p className="text-[12px] text-destructive sm:col-span-2">{error}</p>}
          <div className="flex gap-2 sm:col-span-2">
            <Button type="submit" size="sm" disabled={pending}>
              {pending ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : "Bloquear"}
            </Button>
            <Button type="button" size="sm" variant="outline" onClick={() => setOpen(false)}>
              Cancelar
            </Button>
          </div>
        </form>
      )}

      {closures.length === 0 ? (
        <p className="text-[12px] text-muted-foreground">Nenhum bloqueio futuro cadastrado.</p>
      ) : (
        <ul className="space-y-2">
          {closures.map((c) => {
            const start = new Date(c.startAt);
            const end = new Date(new Date(c.endAt).getTime() - 1);
            const sameDay =
              formatInTimeZone(start, timezone, "yyyy-MM-dd") ===
              formatInTimeZone(end, timezone, "yyyy-MM-dd");
            return (
              <li
                key={c.id}
                className="flex items-center justify-between rounded-lg border border-border bg-surface-1 px-3 py-2"
              >
                <div className="min-w-0">
                  <p className="text-[13px] font-medium">
                    {sameDay
                      ? formatInTimeZone(start, timezone, "d 'de' MMMM", { locale: ptBR })
                      : `${formatInTimeZone(start, timezone, "d MMM", { locale: ptBR })} – ${formatInTimeZone(end, timezone, "d MMM", { locale: ptBR })}`}
                  </p>
                  {c.reason && <p className="truncate text-[11px] text-muted-foreground">{c.reason}</p>}
                </div>
                {canManage && (
                  <IconButton
                    label="Remover bloqueio"
                    type="button"
                    disabled={pending}
                    onClick={() => run(() => deleteSalonClosure(c.id))}
                    className="shrink-0 hover:bg-danger/10 hover:text-danger"
                  >
                    <Trash2 className="h-3.5 w-3.5" />
                  </IconButton>
                )}
              </li>
            );
          })}
        </ul>
      )}
    </div>
  );
}
