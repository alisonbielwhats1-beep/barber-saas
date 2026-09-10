"use client";

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { Ban, Loader2 } from "lucide-react";
import { formatInTimeZone } from "date-fns-tz";
import { addCalendarDays } from "@/lib/time";
import { WeeklyPausePanel } from "./weekly-pause-panel";
import { WeekdayPicker } from "@/components/weekday-picker";
import { Dialog, DialogContent, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { blockAvailability, removeAvailabilityBlock, cancelSelectedAppointments, previewAvailabilityBlock } from "./availability-actions";

export type AvailabilityBlock = { id: string; professionalId: string; startAt: string; endAt: string; reason: string | null };

export type BlockSelection = { professionalId: string; startLocal: string; endLocal: string };

export type AvailabilityPreset = "interval" | "day";

export function AvailabilityPanel({ date, timezone, professionals, blocks, selection, initialPreset, dialogOnly = false, restoreFocus }: {
  date: string; timezone: string; professionals: { id: string; name: string }[]; blocks: AvailabilityBlock[];
  selection?: BlockSelection;
  initialPreset?: AvailabilityPreset;
  dialogOnly?: boolean;
  restoreFocus?: () => void;
}) {
  const startsAsDayOff = initialPreset === "day";
  const startsOpen = Boolean(selection || initialPreset);
  const router = useRouter();
  const [open, setOpen] = useState(startsOpen);
  const [activePreset, setActivePreset] = useState<AvailabilityPreset>(initialPreset ?? "interval");
  const [pending, startTransition] = useTransition();
  const [requestId, setRequestId] = useState(() => startsOpen ? crypto.randomUUID() : "");
  const [selected, setSelected] = useState<string[]>(selection ? [selection.professionalId] : initialPreset ? professionals.map(p => p.id) : []);
  const [start, setStart] = useState(selection?.startLocal ?? (startsAsDayOff ? `${date}T00:00` : `${date}T12:00`));
  const [end, setEnd] = useState(selection?.endLocal ?? (startsAsDayOff ? `${addCalendarDays(date, 1)}T00:00` : `${date}T13:00`));
  const [everyWeeks, setEveryWeeks] = useState<0 | 1 | 2 | 4>(0);
  const [count, setCount] = useState(4);
  const [repeatDays, setRepeatDays] = useState(false);
  const [weekdays, setWeekdays] = useState([1, 2, 3, 4, 5]);
  const [untilDate, setUntilDate] = useState(addCalendarDays(date, 30));
  const [reason, setReason] = useState(startsAsDayOff ? "Folga" : "");
  const [preview, setPreview] = useState<{ id: string; name: string; startAt: string }[] | null>(null);
  const [summary, setSummary] = useState<{ occurrences: number; first: string; last: string } | null>(null);
  const [error, setError] = useState("");
  const [affected, setAffected] = useState<{ id: string; version: number; name: string; startAt: string }[] | null>(null);
  const [toCancel, setToCancel] = useState<string[]>([]);
  const [cancelResults, setCancelResults] = useState<{ id: string; success: boolean; error?: string }[]>([]);
  const field = "mt-1 min-h-11 w-full rounded-lg border border-border bg-background px-3 text-sm";
  function begin(preset: AvailabilityPreset = "interval") {
    const dayOff = preset === "day";
    setActivePreset(preset);
    setRepeatDays(false); setWeekdays([1, 2, 3, 4, 5]); setUntilDate(addCalendarDays(date, 30));
    setEveryWeeks(0); setCount(4);
    setRequestId(crypto.randomUUID()); setStart(dayOff ? `${date}T00:00` : `${date}T12:00`); setEnd(dayOff ? `${addCalendarDays(date, 1)}T00:00` : `${date}T13:00`);
    setSelected(professionals.map(p => p.id)); setAffected(null); setToCancel([]); setCancelResults([]); setPreview(null); setError(""); setReason(dayOff ? "Folga" : ""); setOpen(true);
  }
  return <section aria-label="Disponibilidade da equipe" className={dialogOnly ? "contents" : "mb-3 rounded-xl border border-border bg-card px-3 py-2"}>
    {!dialogOnly && <>
    <div className="flex flex-wrap items-center justify-between gap-2">
      <div><p className="text-sm font-medium">Pausas e disponibilidade</p><a href="/configuracoes#jornadas" className="inline-flex min-h-11 items-center text-xs text-muted-foreground underline">Consultar expediente e jornadas</a></div>
      <div className="flex flex-wrap gap-2"><WeeklyPausePanel professionals={professionals} /><button type="button" onClick={() => begin()} className="inline-flex min-h-11 items-center gap-2 rounded-full border border-border px-4 text-sm font-medium hover:bg-muted"><Ban size={16} /> Bloquear horário ou dia</button></div>
    </div>
    {blocks.length > 0 && <details><summary className="flex min-h-11 cursor-pointer items-center text-xs">Ver {blocks.length} bloqueio(s) do período</summary><ul className="mt-2 divide-y divide-border">{blocks.map(block => <li key={block.id} className="flex flex-wrap items-center justify-between gap-2 py-2 text-xs">
      <span><strong>{professionals.find(p => p.id === block.professionalId)?.name}</strong> · {formatInTimeZone(new Date(block.startAt), timezone, "dd/MM HH:mm")} — {formatInTimeZone(new Date(block.endAt), timezone, "dd/MM HH:mm")} · {block.reason ?? "Indisponível"}</span>
      <button type="button" disabled={pending} className="min-h-11 rounded-lg px-3 underline disabled:opacity-50" onClick={() => {
        if (!window.confirm("Reabrir este período? Reservas canceladas não serão restauradas.")) return;
        startTransition(async () => { try { await removeAvailabilityBlock(block.id); router.refresh(); } catch { setError("Não foi possível reabrir o período."); } });
      }}>Reabrir período</button>
    </li>)}</ul></details>}
    {error && !open && <p role="alert" className="text-sm text-danger">{error}</p>}
    </>}
    <Dialog open={open} onOpenChange={value => { if (!pending) setOpen(value); }}><DialogContent onCloseAutoFocus={restoreFocus ? event => { event.preventDefault(); restoreFocus(); } : undefined} className="max-h-[85dvh] overflow-y-auto"><DialogHeader><DialogTitle>{activePreset === "day" ? "Adicionar folga" : "Bloquear disponibilidade"}</DialogTitle></DialogHeader>
      {affected !== null ? <div className="space-y-3"><p role="status">Disponibilidade bloqueada. {affected.length} reserva(s) continuam ativas.</p>
        {affected.length > 0 && <><p className="text-sm text-muted-foreground">Abra cada reserva na agenda para propor outro horário ou cancelar com motivo.</p><ul className="space-y-2">{affected.map(a => <li key={a.id}><a className="inline-flex min-h-11 items-center underline" href={`/agenda?date=${formatInTimeZone(new Date(a.startAt), timezone, "yyyy-MM-dd")}&appointment=${a.id}`}>{a.name} · {formatInTimeZone(new Date(a.startAt), timezone, "dd/MM HH:mm")}</a></li>)}</ul></>}
        {affected.length > 0 && <fieldset disabled={pending} className="space-y-2"><legend className="text-sm font-medium">Cancelar reservas selecionadas</legend>
          {affected.map(a => <label key={a.id} className="flex min-h-11 items-center gap-2 text-sm"><input type="checkbox" disabled={cancelResults.some(r => r.id === a.id && r.success)} checked={toCancel.includes(a.id)} onChange={e => setToCancel(e.target.checked ? [...toCancel, a.id] : toCancel.filter(id => id !== a.id))} />{a.name} · {formatInTimeZone(new Date(a.startAt), timezone, "dd/MM HH:mm")}</label>)}
          <p className="text-xs text-muted-foreground">Motivo: {reason}. O histórico será preservado e a fila não será promovida automaticamente.</p>
          <button type="button" disabled={!toCancel.length || pending} className="min-h-11 rounded-lg bg-danger px-3 text-sm text-white disabled:opacity-50" onClick={() => {
            if (!window.confirm(`Cancelar ${toCancel.length} reserva(s) selecionada(s)? Motivo: ${reason}`)) return;
            startTransition(async () => {
              try {
                const results = await cancelSelectedAppointments({ reason, appointments: affected.filter(a => toCancel.includes(a.id)).map(a => ({ id: a.id, version: a.version, requestId: crypto.randomUUID() })) });
                setCancelResults(results); setToCancel([]); router.refresh();
              } catch { setError("Não foi possível concluir. Revise as reservas antes de tentar novamente."); }
            });
          }}>Cancelar {toCancel.length} selecionada(s)</button>
          {cancelResults.map(r => <p role="status" key={r.id} className="text-sm">{affected.find(a => a.id === r.id)?.name}: {r.success ? "cancelado" : r.error}</p>)}
        </fieldset>}
        {error && <p role="alert" className="text-sm text-danger">{error}</p>}
        <button className="min-h-11 rounded-lg bg-primary px-4 text-primary-foreground" onClick={() => setOpen(false)}>Concluir</button>
      </div> : <form className="space-y-4" onChange={() => setPreview(null)} onSubmit={event => {
        event.preventDefault(); setError(""); startTransition(async () => {
          try {
          if (preview === null) {
            const review = await previewAvailabilityBlock({ id: requestId, professionalIds: selected, startLocal: start, endLocal: end, reason, everyWeeks: repeatDays ? 0 : everyWeeks, count: !repeatDays && everyWeeks ? count : 1, ...(repeatDays ? { weekdays, untilDate } : {}) });
            if ("error" in review) setError(review.error ?? "Não foi possível revisar.");
            else { setPreview(review.affected); setSummary(review); }
            return;
          }
          const result = await blockAvailability({ id: requestId, professionalIds: selected, startLocal: start, endLocal: end, reason, everyWeeks: repeatDays ? 0 : everyWeeks, count: !repeatDays && everyWeeks ? count : 1, ...(repeatDays ? { weekdays, untilDate } : {}) });
          if ("error" in result) setError(result.error ?? "Não foi possível bloquear.");
          else { setAffected(result.affected); router.refresh(); }
          } catch { setError("Não foi possível confirmar o bloqueio. Tente novamente."); }
        });
      }}>
        <fieldset disabled={pending} className="space-y-3"><legend className="mb-2 text-sm font-medium">Profissionais</legend>
          {professionals.map(p => <label key={p.id} className="flex min-h-11 items-center gap-2 text-sm"><input type="checkbox" checked={selected.includes(p.id)} onChange={e => setSelected(e.target.checked ? [...selected, p.id] : selected.filter(id => id !== p.id))} />{p.name}</label>)}
          <button type="button" className="min-h-11 rounded-lg border border-border px-3 text-sm" onClick={() => { setPreview(null); setStart(`${date}T00:00`); setEnd(`${addCalendarDays(date, 1)}T00:00`); }}>Dia inteiro</button>
          <label className="block text-sm">Início<input required type="datetime-local" value={start} onChange={e => setStart(e.target.value)} className={field} /></label>
          <label className="block text-sm">Fim<input required type="datetime-local" value={end} onChange={e => setEnd(e.target.value)} className={field} /></label>
          <label className="block text-sm">Repetir<select aria-label="Repetir" value={repeatDays ? "days" : everyWeeks} onChange={e => { setRepeatDays(e.target.value === "days"); if (e.target.value !== "days") setEveryWeeks(Number(e.target.value) as 0 | 1 | 2 | 4); }} className={field}><option value={0}>Não repetir</option><option value="days">Nos dias da semana que eu escolher</option><option value={1}>Toda semana, neste mesmo dia</option><option value={2}>A cada duas semanas</option><option value={4}>A cada quatro semanas</option></select></label>
          {repeatDays && <><WeekdayPicker value={weekdays} onChange={days => { setPreview(null); setWeekdays(days); }} /><label className="block text-sm">Repetir até<input required type="date" min={start.slice(0, 10)} value={untilDate} onChange={e => setUntilDate(e.target.value)} className={field} /></label><p className="text-xs text-muted-foreground">Repete o mesmo horário nos dias escolhidos, incluindo a data final. Para uma rotina sem data final, use “Pausa recorrente”.</p></>}
          {!repeatDays && everyWeeks > 0 && <label className="block text-sm">Número de ocorrências<input type="number" required min={2} max={52} value={count} onChange={e => setCount(Number(e.target.value))} className={field} /><span className="text-xs text-muted-foreground">Inclui o primeiro período. Cada ocorrência pode ser reaberta separadamente.</span></label>}
          <label className="block text-sm">Motivo<input required minLength={3} maxLength={200} value={reason} onChange={e => setReason(e.target.value)} placeholder="Ex.: almoço, férias ou reunião" className={field} /></label>
        </fieldset>
        {preview !== null && <div role="status" className="rounded-xl border border-primary/30 bg-primary/5 p-3 text-sm">{summary && <p className="mb-2">{summary.occurrences} período(s) por profissional · {formatInTimeZone(new Date(summary.first), timezone, "dd/MM HH:mm")} até {formatInTimeZone(new Date(summary.last), timezone, "dd/MM HH:mm")}</p>}<strong>{preview.length} reserva(s) no intervalo</strong><ul>{preview.map(a => <li key={a.id}>{a.name} · {formatInTimeZone(new Date(a.startAt), timezone, "dd/MM HH:mm")}</li>)}</ul><p className="mt-2 text-xs text-muted-foreground">Estas reservas serão mantidas. A lista será atualizada ao confirmar.</p></div>}
        <p className="text-xs text-muted-foreground">Horários no fuso {timezone}. Reservas existentes serão preservadas e listadas após o bloqueio.</p>
        {error && <p role="alert" className="text-sm text-danger">{error}</p>}
        <button disabled={pending || !selected.length} className="inline-flex min-h-11 items-center gap-2 rounded-lg bg-primary px-4 text-sm font-semibold text-primary-foreground disabled:opacity-50">{pending && <Loader2 size={16} className="animate-spin" />}{preview === null ? "Revisar bloqueio" : "Confirmar bloqueio"}</button>
      </form>}
    </DialogContent></Dialog>
  </section>;
}
