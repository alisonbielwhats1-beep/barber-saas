"use client";

import { useEffect, useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { AlertTriangle, ChevronDown } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { cn } from "@/lib/utils";
import { WorkingHoursForm } from "../profissionais/working-hours-form";
import {
  commonDailyPause,
  replaceDailyShifts,
  salonHoursInput,
  scheduleLabel,
  scheduleTime,
  teamScheduleInput,
  WEEKDAY_LABELS,
  type WeeklyHours,
} from "@/lib/team-schedule";
import { saveSalonHours, saveTeamHours } from "./team-hours-actions";
import { checkboxClass, checkRowClass, labelClass, noteClass } from "./settings-ui";

type Professional = { id: string; name: string; workingHours: WeeklyHours[] };

const initials = (name: string) => name.split(/\s+/).filter(Boolean).slice(0, 2).map(part => part[0]).join("").toUpperCase();
const cardClass = "flex min-w-0 flex-col gap-3.5 rounded-[14px] border border-border bg-card p-4";

const minutes = (time: string) => {
  const [hours, value] = time.split(":").map(Number);
  return hours * 60 + value;
};

export function TeamHoursManager({
  openMinutes,
  closeMinutes,
  professionals,
}: {
  openMinutes: number;
  closeMinutes: number;
  professionals: Professional[];
}) {
  const router = useRouter();
  const [focusedProfessional, setFocusedProfessional] = useState<string | null>(null);
  const [expanded, setExpanded] = useState<string[]>([]);
  useEffect(() => {
    const id = new URLSearchParams(window.location.search).get("professional");
    if (id && professionals.some(pro => pro.id === id)) {
      setFocusedProfessional(id);
      setExpanded(open => open.includes(id) ? open : [...open, id]);
      requestAnimationFrame(() => document.getElementById(`hours-${id}`)?.scrollIntoView({ block: "nearest" }));
    }
  }, [professionals]);
  const commonPause = commonDailyPause(professionals.map((professional) => professional.workingHours));
  const [open, setOpen] = useState(scheduleTime(openMinutes));
  const [close, setClose] = useState(closeMinutes === 1440 ? "00:00" : scheduleTime(closeMinutes));
  const [copyToTeam, setCopyToTeam] = useState(false);
  const [selected, setSelected] = useState<string[]>([]);
  const [pauseEnabled, setPauseEnabled] = useState(Boolean(commonPause));
  const [pauseStart, setPauseStart] = useState(scheduleTime(commonPause?.startMinutes ?? 750));
  const [pauseEnd, setPauseEnd] = useState(scheduleTime(commonPause?.endMinutes ?? 900));
  const [review, setReview] = useState(false);
  const [message, setMessage] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [pending, transition] = useTransition();

  const sharedHours = {
    openMinutes: minutes(open),
    closeMinutes: close === "00:00" ? 1440 : minutes(close),
    confirmed: true as const,
  };
  const parsedSalon = salonHoursInput.safeParse(sharedHours);
  const parsedTeam = teamScheduleInput.safeParse({
    ...sharedHours,
    professionalIds: selected,
    pause: pauseEnabled
      ? { startMinutes: minutes(pauseStart), endMinutes: minutes(pauseEnd) }
      : null,
  });

  function resetReview() {
    setReview(false);
    setError(null);
    setMessage(null);
  }

  function submitReview(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setMessage(null);
    setError(null);
    const result = copyToTeam ? parsedTeam : parsedSalon;
    if (!result.success) {
      setError(result.error.issues[0].message);
      return;
    }
    setReview(true);
  }

  function confirmChanges() {
    transition(async () => {
      try {
        if (copyToTeam) {
          if (!parsedTeam.success) return;
          await saveTeamHours(parsedTeam.data);
          setMessage("Horário do salão e jornadas selecionadas foram atualizados.");
        } else {
          if (!parsedSalon.success) return;
          await saveSalonHours(parsedSalon.data);
          setMessage("Horário do salão salvo. As jornadas individuais não foram alteradas.");
        }
        setReview(false);
        router.refresh();
      } catch (err) {
        setError(err instanceof Error ? err.message : "Não foi possível salvar. Tente novamente.");
      }
    });
  }

  return (
    <section id="jornadas" aria-labelledby="team-hours-title" className="scroll-mt-24 space-y-3.5 lg:space-y-4">
      <div className={cardClass}>
        <h3 id="team-hours-title" className="text-sm font-semibold">Expediente, equipe e pausas</h3>
        <p className={noteClass}>
          A agenda do cliente usa a jornada de cada profissional. O atendimento inteiro precisa caber em um intervalo livre.
        </p>

        <div className="space-y-2.5">
          <h4 className="text-sm font-semibold">Jornadas individuais</h4>
          <p className={noteClass}>
            Use “Horários” para dias diferentes, como um profissional começar às 14h na terça-feira e trabalhar sem pausa nesse dia.
          </p>
          {professionals.map((professional) => {
            const open = expanded.includes(professional.id);
            const days = new Set(professional.workingHours.map((row) => row.weekday)).size;
            const listId = `hours-days-${professional.id}`;
            return (
              <div key={professional.id} id={`hours-${professional.id}`} className={cn("flex min-w-0 flex-col gap-2.5 rounded-xl border bg-background px-3.5 py-3", focusedProfessional === professional.id ? "border-border-strong" : "border-border")}>
                <div className="flex min-w-0 items-center gap-2.5">
                  <span aria-hidden="true" className="grid h-[34px] w-[34px] shrink-0 place-items-center rounded-full bg-muted text-xs font-semibold text-foreground">{initials(professional.name)}</span>
                  <span className="min-w-0 flex-1">
                    <span className="block text-sm font-medium [overflow-wrap:anywhere]">{professional.name}</span>
                    <span className="block text-xs text-muted-foreground">{days ? `${days} ${days === 1 ? "dia" : "dias"} por semana` : "Sem jornada definida"}</span>
                  </span>
                </div>
                <div className="flex flex-wrap items-center justify-between gap-x-2 gap-y-1">
                  <button
                    type="button"
                    aria-expanded={open}
                    aria-controls={listId}
                    onClick={() => setExpanded((current) => current.includes(professional.id) ? current.filter((id) => id !== professional.id) : [...current, professional.id])}
                    className="-ml-1 inline-flex min-h-11 items-center gap-1 rounded-lg px-1 text-sm font-medium text-muted-foreground hover:text-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring lg:min-h-8"
                  >
                    {open ? "Ocultar dias" : "Ver dias e horários"}<span className="sr-only"> · {professional.name}</span>
                    <ChevronDown aria-hidden="true" className={cn("h-4 w-4 transition-transform", open && "rotate-180")} />
                  </button>
                  <div className="ml-auto [&>button]:border [&>button]:border-border-strong">
                    <WorkingHoursForm
                      professionalId={professional.id}
                      professionalName={professional.name}
                      current={professional.workingHours}
                      salonHours={{ openMinutes, closeMinutes }}
                    />
                  </div>
                </div>
                <dl id={listId} hidden={!open} className="border-t border-border text-sm">
                  {WEEKDAY_LABELS.map((day, index) => (
                    <div key={day} className="flex min-h-[38px] flex-wrap items-baseline justify-between gap-x-4 gap-y-0.5 border-b border-border py-2 last:border-b-0">
                      <dt className="text-muted-foreground">{day}</dt>
                      <dd className="tabular-nums">{scheduleLabel(professional.workingHours, index)}</dd>
                    </div>
                  ))}
                </dl>
              </div>
            );
          })}
          {!professionals.length && (
            <div className="rounded-[14px] border border-dashed border-border-strong px-4 py-5 text-center">
              <p className="text-sm font-medium">Nenhum profissional ativo</p>
              <p className={cn(noteClass, "mt-1")}>Cadastre um profissional para definir sua jornada.</p>
            </div>
          )}
        </div>
      </div>

      <form className={cardClass} onSubmit={submitReview} onChange={resetReview}>
        <fieldset disabled={pending} className="flex min-w-0 flex-col gap-3.5">
          <legend className="mb-3.5 text-sm font-semibold">Horário geral do estabelecimento</legend>
          <p className={noteClass}>
            Define quando o salão pode funcionar. Salvar estes campos sozinho não muda os horários individuais da equipe.
          </p>
          <div className="grid grid-cols-1 gap-3.5 sm:grid-cols-2 sm:gap-4">
            <label className="flex min-w-0 flex-col gap-1.5">
              <span className={labelClass}>Abertura do salão</span>
              <Input type="time" required value={open} onChange={(event) => setOpen(event.target.value)} className="tabular-nums" />
            </label>
            <label className="flex min-w-0 flex-col gap-1.5">
              <span className={labelClass}>Fechamento do salão</span>
              <Input type="time" required value={close} onChange={(event) => setClose(event.target.value)} className="tabular-nums" />
              <span className={noteClass}>00:00 significa meia-noite ao encerrar o dia.</span>
            </label>
          </div>

          <div className="flex flex-col gap-1 rounded-xl border border-border bg-background px-3.5 py-3">
            <label className={cn(checkRowClass, "font-medium")}>
              <input
                type="checkbox"
                className={checkboxClass}
                checked={copyToTeam}
                onChange={(event) => {
                  setCopyToTeam(event.target.checked);
                  if (!event.target.checked) setSelected([]);
                }}
              />
              Também substituir os horários dos profissionais
            </label>
            <p className={noteClass}>
              Ative somente quando quiser copiar o mesmo expediente para a equipe. Horários especiais e pausas diferentes dos profissionais selecionados serão substituídos; os dias de folga serão preservados.
            </p>
          </div>

          {copyToTeam && (
            <div className="flex flex-col gap-3 rounded-xl border border-warning/40 bg-warning/10 px-3.5 py-3">
              <div className="flex items-start gap-2.5">
                <AlertTriangle aria-hidden="true" className="mt-0.5 h-4 w-4 shrink-0 text-warning" />
                <div>
                  <h4 className="text-sm font-semibold">Profissionais que receberão o horário geral</h4>
                  <p className={cn(noteClass, "mt-0.5")}>
                    Selecione apenas quem realmente deve perder a jornada personalizada.
                  </p>
                </div>
              </div>
              <div className="flex flex-wrap gap-x-5">
                {professionals.map((professional) => (
                  <label key={professional.id} className={checkRowClass}>
                    <input
                      type="checkbox"
                      className={checkboxClass}
                      aria-label={`Substituir horário de ${professional.name}`}
                      checked={selected.includes(professional.id)}
                      onChange={(event) => setSelected(event.target.checked
                        ? [...selected, professional.id]
                        : selected.filter((id) => id !== professional.id))}
                    />
                    {professional.name}
                  </label>
                ))}
              </div>
              <label className={checkRowClass}>
                <input type="checkbox" className={checkboxClass} checked={pauseEnabled} onChange={(event) => setPauseEnabled(event.target.checked)} />
                Incluir a mesma pausa em todos os dias de trabalho selecionados
              </label>
              {pauseEnabled && (
                <div className="grid grid-cols-1 gap-3.5 sm:grid-cols-2 sm:gap-4">
                  <label className="flex min-w-0 flex-col gap-1.5">
                    <span className={labelClass}>Início da pausa</span>
                    <Input type="time" required value={pauseStart} onChange={(event) => setPauseStart(event.target.value)} className="tabular-nums" />
                  </label>
                  <label className="flex min-w-0 flex-col gap-1.5">
                    <span className={labelClass}>Fim da pausa</span>
                    <Input type="time" required value={pauseEnd} onChange={(event) => setPauseEnd(event.target.value)} className="tabular-nums" />
                  </label>
                </div>
              )}
            </div>
          )}

          {!review && (
            <Button type="submit" className="self-start" disabled={copyToTeam && !selected.length}>
              {copyToTeam ? "Revisar horário e equipe" : "Revisar horário do salão"}
            </Button>
          )}

          {review && parsedSalon.success && (!copyToTeam || parsedTeam.success) && (
            <div className="flex flex-col gap-3 rounded-xl border border-border-strong bg-muted/40 px-3.5 py-3">
              <h4 className="text-sm font-semibold">Confira antes de salvar</h4>
              <p className="text-sm tabular-nums">
                <span className="font-medium">Horário do salão:</span>{" "}
                {scheduleTime(openMinutes)}–{scheduleTime(closeMinutes)} → {scheduleTime(parsedSalon.data.openMinutes)}–{scheduleTime(parsedSalon.data.closeMinutes)}
              </p>

              {!copyToTeam && (
                <p className="rounded-xl border border-border-strong bg-card px-3.5 py-2.5 text-xs">
                  Os profissionais manterão os horários individuais atuais.
                </p>
              )}

              {copyToTeam && parsedTeam.success && professionals
                .filter((professional) => selected.includes(professional.id))
                .map((professional) => (
                  <div key={professional.id} className="border-t border-border-strong pt-2.5 text-sm">
                    <p className="font-semibold [overflow-wrap:anywhere]">{professional.name}</p>
                    {[...new Set(professional.workingHours.map((row) => row.weekday))].sort().map((day) => (
                      <p key={day} className="mt-1 text-xs tabular-nums text-muted-foreground">
                        {WEEKDAY_LABELS[day]}: {scheduleLabel(professional.workingHours, day)} → {scheduleLabel(replaceDailyShifts(professional.workingHours, parsedTeam.data), day)}
                      </p>
                    ))}
                    {!professional.workingHours.length && <p>Defina os dias de trabalho acima primeiro.</p>}
                  </div>
                ))}

              {copyToTeam && (
                <p className="text-xs font-medium text-warning">
                  Os intervalos mostrados à direita substituirão os horários atuais. Reservas e dias de folga serão mantidos.
                </p>
              )}

              <Button type="button" className="h-auto self-start whitespace-normal py-2 text-center" disabled={pending} onClick={confirmChanges}>
                {pending
                  ? "Salvando…"
                  : copyToTeam
                    ? "Confirmar e substituir horários"
                    : "Salvar somente horário do salão"}
              </Button>
            </div>
          )}
        </fieldset>
        {error && <p role="alert" className="rounded-xl border border-danger/40 bg-danger/10 px-3.5 py-3 text-sm">{error}</p>}
        {message && <p role="status" className="rounded-xl border border-border-strong bg-background px-3.5 py-3 text-sm">{message}</p>}
      </form>
    </section>
  );
}
