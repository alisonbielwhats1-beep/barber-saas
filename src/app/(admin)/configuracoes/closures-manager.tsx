"use client";

import { useRef, useState } from "react";
import { useFormOperation } from "../use-form-operation";
import { useRouter } from "next/navigation";
import { ptBR } from "date-fns/locale";
import { formatInTimeZone } from "date-fns-tz";
import { CalendarOff, Plus, Trash2, Loader2 } from "lucide-react";
import { Input } from "@/components/ui/input";
import { Button } from "@/components/ui/button";
import { IconButton } from "@/components/ui/icon-button";
import { cn } from "@/lib/utils";
import { createSalonClosure, deleteSalonClosure } from "../agenda/actions";
import { labelClass, SettingsBlock, subPanelClass } from "./settings-ui";

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
  const [pending, startTransition] = useFormOperation();
  const formRef = useRef<HTMLFormElement>(null);
  const [open, setOpen] = useState(false);
  const [error, setError] = useState<string | null>(null);

  function run(fn: () => Promise<{ error: string } | { success: true }>, resetDraft = false) {
    setError(null);
    startTransition(async () => {
      try {
      const result = await fn();
      if ("error" in result) setError(result.error);
      else {
        if (resetDraft) { setOpen(false); formRef.current?.reset(); }
        router.refresh();
      }
      } catch { setError("Não foi possível atualizar o fechamento. Tente novamente."); }
    });
  }

  function onSubmit(e: React.FormEvent<HTMLFormElement>) {
    e.preventDefault();
    const f = new FormData(e.currentTarget);
    const startDate = String(f.get("startDate"));
    const endDate = String(f.get("endDate") || startDate);
    const reason = (f.get("reason") as string) || null;
    run(() => createSalonClosure({ startDate, endDate, reason }), true);
  }

  return (
    <SettingsBlock
      hint={<>
        Feriado, reforma, viagem — impede novo agendamento (do cliente e do admin) no período. Não
        cancela reservas que já existiam antes do bloqueio.
        {" "}Para almoço ou outra pausa semanal, use <a href="/agenda" className="font-medium text-foreground underline underline-offset-4">Pausa recorrente na agenda</a>.
      </>}
      action={canManage && (
        <Button type="button" size="sm" variant="outline" aria-expanded={open} disabled={pending} className="max-lg:w-full" onClick={() => setOpen((o) => !o)}>
          <Plus aria-hidden="true" className="h-4 w-4" />
          Fechar um dia
        </Button>
      )}
    >
      <h3 className="sr-only">Fechamentos por data</h3>

      <div hidden={!open}>
        <form ref={formRef} onSubmit={onSubmit} aria-busy={pending} className={cn(subPanelClass, "grid gap-3.5 sm:grid-cols-2 sm:gap-4")}>
          <div className="flex min-w-0 flex-col gap-1.5">
            <label htmlFor="closures-manager-startDate" className={labelClass}>De<span aria-hidden="true"> *</span></label>
            <Input id="closures-manager-startDate" name="startDate" type="date" required />
          </div>
          <div className="flex min-w-0 flex-col gap-1.5">
            <label htmlFor="closures-manager-endDate" className={labelClass}>Até</label>
            <Input id="closures-manager-endDate" name="endDate" type="date" />
          </div>
          <div className="flex min-w-0 flex-col gap-1.5 sm:col-span-2">
            <label htmlFor="closures-manager-reason" className={labelClass}>Motivo (opcional)</label>
            <Input id="closures-manager-reason" name="reason" placeholder="Ex.: Feriado de Corpus Christi" maxLength={200} />
          </div>
          {error && <p role="alert" className="text-sm text-danger sm:col-span-2">{error}</p>}
          <div className="flex flex-wrap gap-2.5 sm:col-span-2">
            <Button type="submit" size="sm" disabled={pending}>
              {pending ? <Loader2 aria-label="Salvando" className="h-4 w-4 animate-spin" /> : "Bloquear"}
            </Button>
            <Button type="button" size="sm" variant="outline" disabled={pending} onClick={() => setOpen(false)}>
              Recolher
            </Button>
          </div>
        </form>
      </div>

      {closures.length === 0 ? (
        <div className="flex flex-col items-center gap-2.5 rounded-[14px] border border-dashed border-border-strong px-4 py-5 text-center">
          <span className="grid h-10 w-10 place-items-center rounded-full bg-muted text-muted-foreground"><CalendarOff aria-hidden="true" className="h-4 w-4" /></span>
          <p className="text-sm font-medium">Nenhum bloqueio futuro cadastrado.</p>
        </div>
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
                className="flex min-w-0 items-center justify-between gap-3 rounded-xl border border-border bg-background px-3.5 py-2.5"
              >
                <div className="min-w-0">
                  <p className="text-sm font-medium">
                    {sameDay
                      ? formatInTimeZone(start, timezone, "d 'de' MMMM", { locale: ptBR })
                      : `${formatInTimeZone(start, timezone, "d MMM", { locale: ptBR })} – ${formatInTimeZone(end, timezone, "d MMM", { locale: ptBR })}`}
                  </p>
                  {c.reason && <p className="text-xs text-muted-foreground [overflow-wrap:anywhere]">{c.reason}</p>}
                </div>
                {canManage && (
                  <IconButton
                    label="Remover bloqueio"
                    type="button"
                    disabled={pending}
                    onClick={() => run(() => deleteSalonClosure(c.id))}
                    className="shrink-0 hover:bg-danger/10 hover:text-danger"
                  >
                    <Trash2 aria-hidden="true" className="h-4 w-4" />
                  </IconButton>
                )}
              </li>
            );
          })}
        </ul>
      )}
    </SettingsBlock>
  );
}
