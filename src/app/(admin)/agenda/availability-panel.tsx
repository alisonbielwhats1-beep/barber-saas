"use client";

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { Ban, Loader2 } from "lucide-react";
import { formatInTimeZone } from "date-fns-tz";
import { addCalendarDays } from "@/lib/time";
import { Dialog, DialogContent, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { blockAvailability, removeAvailabilityBlock, cancelSelectedAppointments } from "./availability-actions";

export type AvailabilityBlock = { id: string; professionalId: string; startAt: string; endAt: string; reason: string | null };

export function AvailabilityPanel({ date, timezone, professionals, blocks }: {
  date: string; timezone: string; professionals: { id: string; name: string }[]; blocks: AvailabilityBlock[];
}) {
  const router = useRouter();
  const [open, setOpen] = useState(false);
  const [pending, startTransition] = useTransition();
  const [requestId, setRequestId] = useState("");
  const [selected, setSelected] = useState<string[]>([]);
  const [start, setStart] = useState(`${date}T12:00`);
  const [end, setEnd] = useState(`${date}T13:00`);
  const [reason, setReason] = useState("");
  const [error, setError] = useState("");
  const [affected, setAffected] = useState<{ id: string; version: number; name: string; startAt: string }[] | null>(null);
  const [toCancel, setToCancel] = useState<string[]>([]);
  const [cancelResults, setCancelResults] = useState<{ id: string; success: boolean; error?: string }[]>([]);
  const field = "mt-1 min-h-11 w-full rounded-lg border border-border bg-background px-3 text-sm";
  function begin() {
    setRequestId(crypto.randomUUID()); setStart(`${date}T12:00`); setEnd(`${date}T13:00`);
    setSelected(professionals.map(p => p.id)); setAffected(null); setToCancel([]); setCancelResults([]); setError(""); setReason(""); setOpen(true);
  }
  return <section aria-label="Disponibilidade da equipe" className="rounded-xl border border-border bg-card p-3">
    <div className="flex flex-wrap items-center justify-between gap-2">
      <div><p className="text-sm font-medium">Disponibilidade da equipe</p><p className="text-xs text-muted-foreground">Pausas, ausências e folgas por profissional.</p></div>
      <button type="button" onClick={begin} className="inline-flex min-h-11 items-center gap-2 rounded-lg border border-border px-3 text-sm font-medium"><Ban size={16} /> Bloquear horário ou dia</button>
    </div>
    {blocks.length > 0 && <ul className="mt-2 divide-y divide-border">{blocks.map(block => <li key={block.id} className="flex flex-wrap items-center justify-between gap-2 py-2 text-xs">
      <span><strong>{professionals.find(p => p.id === block.professionalId)?.name}</strong> · {formatInTimeZone(new Date(block.startAt), timezone, "dd/MM HH:mm")} — {formatInTimeZone(new Date(block.endAt), timezone, "dd/MM HH:mm")} · {block.reason ?? "Indisponível"}</span>
      <button type="button" disabled={pending} className="min-h-11 rounded-lg px-3 underline disabled:opacity-50" onClick={() => {
        if (!window.confirm("Reabrir este período? Reservas canceladas não serão restauradas.")) return;
        startTransition(async () => { try { await removeAvailabilityBlock(block.id); router.refresh(); } catch { setError("Não foi possível reabrir o período."); } });
      }}>Reabrir período</button>
    </li>)}</ul>}
    {error && !open && <p role="alert" className="text-sm text-danger">{error}</p>}
    <Dialog open={open} onOpenChange={value => { if (!pending) setOpen(value); }}><DialogContent className="max-h-[85dvh] overflow-y-auto"><DialogHeader><DialogTitle>Bloquear disponibilidade</DialogTitle></DialogHeader>
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
      </div> : <form className="space-y-4" onSubmit={event => {
        event.preventDefault(); setError(""); startTransition(async () => {
          try {
          const result = await blockAvailability({ id: requestId, professionalIds: selected, startLocal: start, endLocal: end, reason });
          if ("error" in result) setError(result.error ?? "Não foi possível bloquear.");
          else { setAffected(result.affected); router.refresh(); }
          } catch { setError("Não foi possível confirmar o bloqueio. Tente novamente."); }
        });
      }}>
        <fieldset disabled={pending} className="space-y-3"><legend className="mb-2 text-sm font-medium">Profissionais</legend>
          {professionals.map(p => <label key={p.id} className="flex min-h-11 items-center gap-2 text-sm"><input type="checkbox" checked={selected.includes(p.id)} onChange={e => setSelected(e.target.checked ? [...selected, p.id] : selected.filter(id => id !== p.id))} />{p.name}</label>)}
          <button type="button" className="min-h-11 rounded-lg border border-border px-3 text-sm" onClick={() => { setStart(`${date}T00:00`); setEnd(`${addCalendarDays(date, 1)}T00:00`); }}>Dia inteiro</button>
          <label className="block text-sm">Início<input required type="datetime-local" value={start} onChange={e => setStart(e.target.value)} className={field} /></label>
          <label className="block text-sm">Fim<input required type="datetime-local" value={end} onChange={e => setEnd(e.target.value)} className={field} /></label>
          <label className="block text-sm">Motivo<input required minLength={3} maxLength={200} value={reason} onChange={e => setReason(e.target.value)} placeholder="Ex.: almoço, férias ou reunião" className={field} /></label>
        </fieldset>
        <p className="text-xs text-muted-foreground">Horários no fuso {timezone}. Reservas existentes serão preservadas e listadas após o bloqueio.</p>
        {error && <p role="alert" className="text-sm text-danger">{error}</p>}
        <button disabled={pending || !selected.length} className="inline-flex min-h-11 items-center gap-2 rounded-lg bg-primary px-4 text-sm font-semibold text-primary-foreground disabled:opacity-50">{pending && <Loader2 size={16} className="animate-spin" />}Bloquear novas reservas</button>
      </form>}
    </DialogContent></Dialog>
  </section>;
}
