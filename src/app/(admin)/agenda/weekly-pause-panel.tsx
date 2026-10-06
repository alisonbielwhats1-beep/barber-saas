"use client";

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { Coffee } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { WeekdayPicker } from "@/components/weekday-picker";
import { scheduleLabel, WEEKDAY_LABELS } from "@/lib/team-schedule";
import { previewWeeklyPause, saveWeeklyPause } from "./weekly-pause-actions";

export function WeeklyPausePanel({ professionals, initialOpen = false, hideTrigger = false, restoreFocus }: { professionals: { id: string; name: string }[]; initialOpen?: boolean; hideTrigger?: boolean; restoreFocus?: () => void }) {
  const router = useRouter();
  const [open, setOpen] = useState(initialOpen);
  const [pending, transition] = useTransition();
  const [days, setDays] = useState([1, 2, 3, 4, 5]);
  const [selected, setSelected] = useState(professionals.map(p => p.id));
  const [start, setStart] = useState("12:30");
  const [end, setEnd] = useState("14:30");
  const [review, setReview] = useState<Awaited<ReturnType<typeof previewWeeklyPause>> | null>(null);
  const [error, setError] = useState("");
  const [saved, setSaved] = useState(false);
  const toMinutes = (time: string) => { const [h, m] = time.split(":").map(Number); return h * 60 + m; };
  const invalidate = () => { setReview(null); setError(""); };
  return <>
    {!hideTrigger && <Button type="button" variant="outline" className="rounded-full" onClick={() => { setSelected(professionals.map(p => p.id)); setSaved(false); invalidate(); setOpen(true); }}><Coffee size={16} className="mr-2" />Pausa recorrente</Button>}
    <Dialog open={open} onOpenChange={value => { if (!pending) setOpen(value); }}><DialogContent onCloseAutoFocus={restoreFocus ? event => { event.preventDefault(); restoreFocus(); } : undefined} className="max-h-[85dvh] overflow-y-auto sm:max-w-xl"><DialogHeader><DialogTitle>Pausa recorrente</DialogTitle><DialogDescription>Reserve o almoço ou outra pausa na jornada semanal, sem precisar bloquear cada data.</DialogDescription></DialogHeader>
      {saved ? <div className="space-y-4"><p role="status">Pausa semanal salva. Os novos agendamentos já respeitam a jornada atualizada.</p><p className="text-sm text-muted-foreground">Reservas existentes foram mantidas. Confira na agenda as que coincidirem com a pausa.</p><Button onClick={() => setOpen(false)}>Concluir</Button></div> : <form className="space-y-4" onChange={invalidate} onSubmit={event => {
        event.preventDefault(); setError("");
        const input = { professionalIds: selected, weekdays: days, startMinutes: toMinutes(start), endMinutes: toMinutes(end) };
        transition(async () => { try {
          if (!review) setReview(await previewWeeklyPause(input));
          else { await saveWeeklyPause(input, review.version); setSaved(true); router.refresh(); }
        } catch (err) { setReview(null); setError(err instanceof Error ? err.message : "Não foi possível salvar. Suas escolhas foram mantidas."); } });
      }}>
        <fieldset disabled={pending} className="space-y-4">
          <legend className="sr-only">Configurar pausa semanal</legend>
          <div className="rounded-xl bg-muted/50 p-3 text-sm"><strong>Toda semana, a partir de agora</strong><p className="mt-1 text-xs text-muted-foreground">Sem data final. Para uma pausa temporária com começo e fim, use “Bloquear horário ou dia” na agenda.</p></div>
          <WeekdayPicker value={days} onChange={value => { invalidate(); setDays(value); }} />
          <div className="grid grid-cols-2 gap-3"><label className="text-sm">Início da pausa<Input required type="time" value={start} onChange={e => setStart(e.target.value)} /></label><label className="text-sm">Fim da pausa<Input required type="time" value={end} onChange={e => setEnd(e.target.value)} /></label></div>
          <fieldset className="space-y-1"><legend className="mb-2 text-sm font-medium">Para quem vale a pausa?</legend><button type="button" className="min-h-11 rounded-full border border-border px-3 text-xs" onClick={() => { invalidate(); setSelected(professionals.map(p => p.id)); }}>Selecionar toda a equipe atual</button>{professionals.map(p => <label key={p.id} className="flex min-h-11 items-center gap-2 text-sm"><input type="checkbox" checked={selected.includes(p.id)} onChange={e => setSelected(e.target.checked ? [...selected, p.id] : selected.filter(id => id !== p.id))} />{p.name}</label>)}</fieldset>
          <p className="text-xs text-muted-foreground">Mantém folgas e pausas já cadastradas. Para encurtar ou remover uma pausa existente, <a href="/configuracoes#jornadas" className="underline">edite a jornada em Configurações → Agenda</a>. Expedientes adicionais por data continuam como exceções explícitas.</p>
          {review && <div role="status" className="space-y-3 rounded-xl border border-primary/30 bg-primary/5 p-3"><h3 className="text-sm font-semibold">Confira como fica a jornada</h3>{review.professionals.map(p => <div key={p.id} className="text-sm"><strong>{p.name}</strong>{days.map(day => <p key={day} className="mt-1 text-xs">{WEEKDAY_LABELS[day]}: {scheduleLabel(p.before, day)} → {scheduleLabel(p.after, day)}</p>)}</div>)}<p className="text-xs">A pausa se repete toda semana. Reservas existentes não serão canceladas ou remarcadas.</p></div>}
          <Button type="submit" className="w-full rounded-full" disabled={pending || !selected.length || !days.length}>{pending ? "Aguarde…" : review ? "Confirmar pausa semanal" : "Revisar pausa"}</Button>
        </fieldset>
        {error && <p role="alert" className="text-sm text-destructive">{error}</p>}
      </form>}
    </DialogContent></Dialog>
  </>;
}
