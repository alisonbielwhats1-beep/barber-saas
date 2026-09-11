"use client";

import { useState, useTransition, type CSSProperties } from "react";
import { formatInTimeZone } from "date-fns-tz";
import { Ban, CalendarPlus, Loader2 } from "lucide-react";
import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { useRouter } from "next/navigation";
import { removeAvailabilityBlock } from "./availability-actions";

export type AvailabilityBlock = {
  id: string;
  professionalId: string;
  startAt: string;
  endAt: string;
  reason: string | null;
};

export type AvailabilityBlockScheduleTarget = {
  professionalId: string;
  startLocal: string;
};

function timeRange(block: AvailabilityBlock, timezone: string) {
  return `${formatInTimeZone(new Date(block.startAt), timezone, "HH:mm")}–${formatInTimeZone(new Date(block.endAt), timezone, "HH:mm")}`;
}

function dateTimeRange(block: AvailabilityBlock, timezone: string) {
  const startDate = formatInTimeZone(new Date(block.startAt), timezone, "dd/MM/yyyy");
  const endDate = formatInTimeZone(new Date(block.endAt), timezone, "dd/MM/yyyy");
  if (startDate === endDate) return `${startDate} · ${timeRange(block, timezone)}`;
  return `${startDate} ${formatInTimeZone(new Date(block.startAt), timezone, "HH:mm")} – ${endDate} ${formatInTimeZone(new Date(block.endAt), timezone, "HH:mm")}`;
}

export function AvailabilityBlockTrigger({
  block,
  professionalName,
  timezone,
  onOpen,
  className = "",
  style,
}: {
  block: AvailabilityBlock;
  professionalName: string;
  timezone: string;
  onOpen?: (block: AvailabilityBlock) => void;
  className?: string;
  style?: CSSProperties;
}) {
  const reason = block.reason ?? "Indisponível";
  const content = <>Bloqueado · {reason}</>;
  const sharedClassName = `overflow-hidden border-y border-border bg-muted/80 text-left text-muted-foreground ${className}`;
  const sharedStyle = {
    ...style,
    backgroundImage: "repeating-linear-gradient(135deg, transparent, transparent 6px, hsl(var(--border) / .35) 6px, hsl(var(--border) / .35) 7px)",
  };

  if (!onOpen) {
    return (
      <div
        role="note"
        aria-label={`Bloqueio de ${professionalName}, ${timeRange(block, timezone)}, ${reason}`}
        className={`pointer-events-auto ${sharedClassName}`}
        style={sharedStyle}
      >
        {content}
      </div>
    );
  }

  return (
    <button
      type="button"
      aria-label={`Abrir bloqueio de ${professionalName}, ${timeRange(block, timezone)}, ${reason}`}
      onClick={(event) => {
        event.stopPropagation();
        onOpen(block);
      }}
      className={`pointer-events-auto cursor-pointer transition hover:bg-muted focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-ring ${sharedClassName}`}
      style={sharedStyle}
    >
      {content}
    </button>
  );
}

export function AvailabilityBlockDialog({
  open,
  onOpenChange,
  block,
  professionalName,
  timezone,
  onSchedule,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  block: AvailabilityBlock;
  professionalName: string;
  timezone: string;
  onSchedule?: (target: AvailabilityBlockScheduleTarget) => void;
}) {
  const router = useRouter();
  const [pending, startTransition] = useTransition();
  const [step, setStep] = useState<"details" | "confirm" | "reopened">("details");
  const [error, setError] = useState("");
  const reason = block.reason ?? "Indisponível";
  const canScheduleAfterReopening = Boolean(onSchedule) &&
    new Date(block.endAt).getTime() - new Date(block.startAt).getTime() < 24 * 60 * 60 * 1000;

  function changeOpen(nextOpen: boolean) {
    if (pending) return;
    if (!nextOpen) {
      setStep("details");
      setError("");
    }
    onOpenChange(nextOpen);
  }

  function confirmReopening() {
    setError("");
    startTransition(async () => {
      try {
        await removeAvailabilityBlock(block.id);
        setStep("reopened");
        router.refresh();
      } catch {
        setError("Não foi possível reabrir o horário. Atualize a agenda e tente novamente.");
      }
    });
  }

  function scheduleNow() {
    if (!onSchedule) return;
    const target = {
      professionalId: block.professionalId,
      startLocal: formatInTimeZone(new Date(block.startAt), timezone, "yyyy-MM-dd'T'HH:mm"),
    };
    changeOpen(false);
    onSchedule(target);
  }

  return (
    <Dialog open={open} onOpenChange={changeOpen}>
      <DialogContent className="max-h-[85dvh] overflow-y-auto sm:max-w-md">
        <DialogHeader>
          <DialogTitle>Bloqueio de horário</DialogTitle>
          <DialogDescription>
            Este período não aparece como disponível para os clientes.
          </DialogDescription>
        </DialogHeader>

        {step === "reopened" ? (
          <div className="space-y-4">
            <div role="status" className="rounded-xl border border-primary/30 bg-primary/10 p-4">
              <p className="font-semibold text-foreground">Horário reaberto</p>
              <p className="mt-1 text-sm text-muted-foreground">
                A disponibilidade foi atualizada e a alteração ficou registrada.
              </p>
            </div>
            <DialogFooter>
              <Button type="button" variant="outline" onClick={() => changeOpen(false)}>
                Concluir
              </Button>
              {canScheduleAfterReopening && (
                <Button type="button" onClick={scheduleNow}>
                  <CalendarPlus className="mr-2 h-4 w-4" />
                  Agendar neste horário
                </Button>
              )}
            </DialogFooter>
          </div>
        ) : (
          <div className="space-y-4">
            <div className="rounded-xl border border-border bg-muted/40 p-4">
              <p className="flex items-center gap-2 text-sm font-semibold">
                <Ban className="h-4 w-4 text-danger" aria-hidden="true" />
                {reason}
              </p>
              <dl className="mt-3 grid gap-2 text-sm">
                <div>
                  <dt className="text-xs text-muted-foreground">Profissional</dt>
                  <dd className="font-medium">{professionalName}</dd>
                </div>
                <div>
                  <dt className="text-xs text-muted-foreground">Período</dt>
                  <dd className="font-medium">{dateTimeRange(block, timezone)}</dd>
                </div>
              </dl>
            </div>

            {step === "confirm" && (
              <div className="rounded-xl border border-warning/40 bg-warning/10 p-4 text-sm">
                <p className="font-semibold text-foreground">Reabrir este período?</p>
                <p className="mt-1 text-muted-foreground">
                  O horário voltará a ficar disponível para clientes e equipe. Reservas canceladas não serão restauradas.
                </p>
              </div>
            )}
            {error && <p role="alert" className="text-sm text-danger">{error}</p>}

            <DialogFooter>
              {step === "confirm" ? (
                <>
                  <Button type="button" variant="outline" disabled={pending} onClick={() => setStep("details")}>
                    Manter bloqueio
                  </Button>
                  <Button type="button" variant="destructive" disabled={pending} onClick={confirmReopening}>
                    {pending && <Loader2 className="mr-2 h-4 w-4 animate-spin" />}
                    Confirmar reabertura
                  </Button>
                </>
              ) : (
                <>
                  <Button type="button" variant="outline" onClick={() => changeOpen(false)}>
                    Fechar
                  </Button>
                  {onSchedule && <Button type="button" onClick={scheduleNow}>
                    Agendar mantendo bloqueio
                  </Button>}
                  <Button type="button" variant="destructive" onClick={() => setStep("confirm")}>
                    Reabrir horário
                  </Button>
                </>
              )}
            </DialogFooter>
          </div>
        )}
      </DialogContent>
    </Dialog>
  );
}
