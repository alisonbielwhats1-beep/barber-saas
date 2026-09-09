"use client";

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
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

type Professional = { id: string; name: string; workingHours: WeeklyHours[] };

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
    <section id="jornadas" aria-labelledby="team-hours-title" className="mb-6 scroll-mt-24 rounded-2xl border border-border bg-card p-5">
      <h2 id="team-hours-title" className="text-base font-semibold">Expediente, equipe e pausas</h2>
      <p className="mt-2 text-sm text-muted-foreground">
        A agenda do cliente usa a jornada de cada profissional. O atendimento inteiro precisa caber em um intervalo livre.
      </p>

      <div className="mt-4 space-y-3">
        <h3 className="text-sm font-semibold">Jornadas individuais</h3>
        <p className="text-xs text-muted-foreground">
          Use “Horários” para dias diferentes, como um profissional começar às 14h na terça-feira e trabalhar sem pausa nesse dia.
        </p>
        {professionals.map((professional) => (
          <details key={professional.id} className="rounded-xl border border-border p-3">
            <summary className="cursor-pointer py-1 font-medium">
              {professional.name}
              <span className="ml-2 text-xs font-normal text-muted-foreground">Ver dias e horários</span>
            </summary>
            <dl className="mt-2 space-y-1 text-sm">
              {WEEKDAY_LABELS.map((day, index) => (
                <div key={day} className="flex flex-wrap justify-between gap-x-4 gap-y-1">
                  <dt>{day}</dt>
                  <dd className="text-muted-foreground">{scheduleLabel(professional.workingHours, index)}</dd>
                </div>
              ))}
            </dl>
            <div className="mt-3">
              <WorkingHoursForm
                professionalId={professional.id}
                professionalName={professional.name}
                current={professional.workingHours}
                salonHours={{ openMinutes, closeMinutes }}
              />
            </div>
          </details>
        ))}
        {!professionals.length && <p className="text-sm">Cadastre um profissional para definir sua jornada.</p>}
      </div>

      <form className="mt-6 border-t border-border pt-5" onSubmit={submitReview} onChange={resetReview}>
        <fieldset disabled={pending} className="space-y-4">
          <legend className="mb-3 text-sm font-semibold">Horário geral do estabelecimento</legend>
          <p className="text-xs leading-relaxed text-muted-foreground">
            Define quando o salão pode funcionar. Salvar estes campos sozinho não muda os horários individuais da equipe.
          </p>
          <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
            <label className="space-y-1 text-sm">
              Abertura do salão
              <Input type="time" required value={open} onChange={(event) => setOpen(event.target.value)} />
            </label>
            <label className="space-y-1 text-sm">
              Fechamento do salão
              <Input type="time" required value={close} onChange={(event) => setClose(event.target.value)} />
              <span className="text-xs text-muted-foreground">00:00 significa meia-noite ao encerrar o dia.</span>
            </label>
          </div>

          <div className="rounded-xl border border-border bg-surface-1 p-4">
            <label className="flex min-h-11 items-center gap-2 text-sm font-medium">
              <input
                type="checkbox"
                checked={copyToTeam}
                onChange={(event) => {
                  setCopyToTeam(event.target.checked);
                  if (!event.target.checked) setSelected([]);
                }}
              />
              Também substituir os horários dos profissionais
            </label>
            <p className="mt-1 text-xs leading-relaxed text-muted-foreground">
              Ative somente quando quiser copiar o mesmo expediente para a equipe. Horários especiais e pausas diferentes dos profissionais selecionados serão substituídos; os dias de folga serão preservados.
            </p>
          </div>

          {copyToTeam && (
            <div className="space-y-4 rounded-xl border border-warning/30 bg-warning/5 p-4">
              <div>
                <h3 className="text-sm font-semibold">Profissionais que receberão o horário geral</h3>
                <p className="mt-1 text-xs text-muted-foreground">
                  Selecione apenas quem realmente deve perder a jornada personalizada.
                </p>
              </div>
              <div className="flex flex-wrap gap-x-5 gap-y-1">
                {professionals.map((professional) => (
                  <label key={professional.id} className="flex min-h-11 items-center gap-2 text-sm">
                    <input
                      type="checkbox"
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
              <label className="flex min-h-11 items-center gap-2 text-sm">
                <input type="checkbox" checked={pauseEnabled} onChange={(event) => setPauseEnabled(event.target.checked)} />
                Incluir a mesma pausa em todos os dias de trabalho selecionados
              </label>
              {pauseEnabled && (
                <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
                  <label className="space-y-1 text-sm">
                    Início da pausa
                    <Input type="time" required value={pauseStart} onChange={(event) => setPauseStart(event.target.value)} />
                  </label>
                  <label className="space-y-1 text-sm">
                    Fim da pausa
                    <Input type="time" required value={pauseEnd} onChange={(event) => setPauseEnd(event.target.value)} />
                  </label>
                </div>
              )}
            </div>
          )}

          {!review && (
            <Button type="submit" disabled={copyToTeam && !selected.length}>
              {copyToTeam ? "Revisar horário e equipe" : "Revisar horário do salão"}
            </Button>
          )}

          {review && parsedSalon.success && (!copyToTeam || parsedTeam.success) && (
            <div className="space-y-3 rounded-xl border border-primary/30 bg-primary/5 p-4">
              <h3 className="text-sm font-semibold">Confira antes de salvar</h3>
              <p className="text-sm">
                <span className="font-medium">Horário do salão:</span>{" "}
                {scheduleTime(openMinutes)}–{scheduleTime(closeMinutes)} → {scheduleTime(parsedSalon.data.openMinutes)}–{scheduleTime(parsedSalon.data.closeMinutes)}
              </p>

              {!copyToTeam && (
                <p className="rounded-lg border border-success/20 bg-success/5 px-3 py-2 text-xs">
                  Os profissionais manterão os horários individuais atuais.
                </p>
              )}

              {copyToTeam && parsedTeam.success && professionals
                .filter((professional) => selected.includes(professional.id))
                .map((professional) => (
                  <div key={professional.id} className="rounded-lg border border-border bg-card/70 p-3 text-sm">
                    <p className="font-medium">{professional.name}</p>
                    {[...new Set(professional.workingHours.map((row) => row.weekday))].sort().map((day) => (
                      <p key={day} className="mt-1 text-xs text-muted-foreground">
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

              <Button type="button" disabled={pending} onClick={confirmChanges}>
                {pending
                  ? "Salvando…"
                  : copyToTeam
                    ? "Confirmar e substituir horários"
                    : "Salvar somente horário do salão"}
              </Button>
            </div>
          )}
        </fieldset>
        {error && <p role="alert" className="mt-3 text-sm text-destructive">{error}</p>}
        {message && <p role="status" className="mt-3 text-sm">{message}</p>}
      </form>
    </section>
  );
}
