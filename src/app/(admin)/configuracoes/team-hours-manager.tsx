"use client";

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { WorkingHoursForm } from "../profissionais/working-hours-form";
import { commonDailyPause, replaceDailyShifts, scheduleLabel, scheduleTime, teamScheduleInput, WEEKDAY_LABELS, type WeeklyHours } from "@/lib/team-schedule";
import { saveTeamHours } from "./team-hours-actions";

type Professional = { id: string; name: string; workingHours: WeeklyHours[] };
const minutes = (time: string) => { const [h, m] = time.split(":").map(Number); return h * 60 + m; };

export function TeamHoursManager({ openMinutes, closeMinutes, professionals }: { openMinutes: number; closeMinutes: number; professionals: Professional[] }) {
  const router = useRouter();
  const commonPause = commonDailyPause(professionals.map(p => p.workingHours));
  const [open, setOpen] = useState(scheduleTime(openMinutes));
  const [close, setClose] = useState(closeMinutes === 1440 ? "00:00" : scheduleTime(closeMinutes));
  const [selected, setSelected] = useState(professionals.map(p => p.id));
  const [pauseEnabled, setPauseEnabled] = useState(Boolean(commonPause));
  const [pauseStart, setPauseStart] = useState(scheduleTime(commonPause?.startMinutes ?? 750));
  const [pauseEnd, setPauseEnd] = useState(scheduleTime(commonPause?.endMinutes ?? 900));
  const [review, setReview] = useState(false);
  const [message, setMessage] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [pending, transition] = useTransition();
  const parsed = teamScheduleInput.safeParse({ professionalIds: selected, openMinutes: minutes(open), closeMinutes: close === "00:00" ? 1440 : minutes(close), pause: pauseEnabled ? { startMinutes: minutes(pauseStart), endMinutes: minutes(pauseEnd) } : null, confirmed: true });

  return <section id="jornadas" aria-labelledby="team-hours-title" className="mb-6 scroll-mt-24 rounded-2xl border border-border bg-card p-5">
    <h2 id="team-hours-title" className="text-base font-semibold">Expediente, equipe e pausas</h2>
    <p className="mt-2 text-sm text-muted-foreground">A agenda do cliente usa os intervalos de cada profissional abaixo. O atendimento inteiro precisa caber em um intervalo livre. Folgas, bloqueios e reservas continuam valendo.</p>
    <div className="mt-4 space-y-3">
      {professionals.map(p => <details key={p.id} className="rounded-xl border border-border p-3">
        <summary className="cursor-pointer py-1 font-medium">{p.name}<span className="ml-2 text-xs font-normal text-muted-foreground">Ver dias e horários</span></summary>
        <dl className="mt-2 space-y-1 text-sm">{WEEKDAY_LABELS.map((day, index) => <div key={day} className="flex flex-wrap justify-between gap-x-4 gap-y-1"><dt>{day}</dt><dd className="text-muted-foreground">{scheduleLabel(p.workingHours, index)}</dd></div>)}</dl>
        <div className="mt-3"><WorkingHoursForm professionalId={p.id} professionalName={p.name} current={p.workingHours} salonHours={{ openMinutes, closeMinutes }} /></div>
      </details>)}
      {!professionals.length && <p className="text-sm">Cadastre um profissional para definir sua jornada.</p>}
    </div>
    <form className="mt-6 border-t border-border pt-5" onSubmit={e => { e.preventDefault(); setMessage(null); setError(null); if (!parsed.success) { setError(parsed.error.issues[0].message); return; } setReview(true); }} onChange={() => { setReview(false); setError(null); setMessage(null); }}>
      <fieldset disabled={pending} className="space-y-4">
        <legend className="mb-3 text-sm font-semibold">Aplicar um expediente em conjunto</legend>
        <p className="text-xs text-muted-foreground">Atualiza a referência do salão e os intervalos dos profissionais selecionados. Dias de folga são mantidos. Para jornadas diferentes, use “Horários” acima.</p>
        <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
          <label className="space-y-1 text-sm">Abertura do salão<Input type="time" required value={open} onChange={e => setOpen(e.target.value)} /></label>
          <label className="space-y-1 text-sm">Fechamento do salão<Input type="time" required value={close} onChange={e => setClose(e.target.value)} /><span className="text-xs text-muted-foreground">00:00 significa meia-noite ao encerrar o dia.</span></label>
        </div>
        <label className="flex min-h-11 items-center gap-2 text-sm"><input type="checkbox" checked={pauseEnabled} onChange={e => setPauseEnabled(e.target.checked)} />Incluir pausa diária nos dias de trabalho</label>
        {pauseEnabled && <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
          <label className="space-y-1 text-sm">Início da pausa<Input type="time" required value={pauseStart} onChange={e => setPauseStart(e.target.value)} /></label>
          <label className="space-y-1 text-sm">Fim da pausa<Input type="time" required value={pauseEnd} onChange={e => setPauseEnd(e.target.value)} /></label>
        </div>}
        <div className="flex flex-wrap gap-x-5 gap-y-1">{professionals.map(p => <label key={p.id} className="flex min-h-11 items-center gap-2 text-sm"><input type="checkbox" checked={selected.includes(p.id)} onChange={e => setSelected(e.target.checked ? [...selected, p.id] : selected.filter(id => id !== p.id))} />{p.name}</label>)}</div>
        {!review && <Button type="submit" disabled={!selected.length}>Revisar expediente</Button>}
        {review && parsed.success && <div className="space-y-3 rounded-xl border border-primary/30 bg-primary/5 p-4">
          <h3 className="text-sm font-semibold">Confira antes de aplicar</h3>
          {professionals.filter(p => selected.includes(p.id)).map(p => <div key={p.id} className="text-sm"><p className="font-medium">{p.name}</p>{[...new Set(p.workingHours.map(row => row.weekday))].sort().map(day => <p key={day} className="text-xs text-muted-foreground">{WEEKDAY_LABELS[day]}: {scheduleLabel(replaceDailyShifts(p.workingHours, parsed.data), day)}</p>)}{!p.workingHours.length && <p>Defina os dias de trabalho acima primeiro.</p>}</div>)}
          <p className="text-xs">Substitui os intervalos e pausas semanais dos profissionais selecionados. Reservas existentes são mantidas; revise na agenda as que coincidirem com a nova pausa. Bloqueios e expedientes adicionais por data permanecem.</p>
          <Button type="button" disabled={pending} onClick={() => transition(async () => { try { await saveTeamHours(parsed.data); setReview(false); setMessage("Expediente salvo. A disponibilidade do cliente já usa os novos intervalos."); router.refresh(); } catch (err) { setError(err instanceof Error ? err.message : "Não foi possível salvar. Tente novamente."); } })}>{pending ? "Salvando…" : "Confirmar e aplicar expediente"}</Button>
        </div>}
      </fieldset>
      {error && <p role="alert" className="mt-3 text-sm text-destructive">{error}</p>}
      {message && <p role="status" className="mt-3 text-sm">{message}</p>}
    </form>
  </section>;
}
