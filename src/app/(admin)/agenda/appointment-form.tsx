"use client";

import { useRef, useState, useTransition } from "react";
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
} from "@/components/ui/dialog";
import { AlertTriangle, Repeat } from "lucide-react";
import { createAppointmentManually, createRecurringAppointments } from "./actions";
import { formatMoney, formatDuration } from "@/lib/utils";

export type ProOption = {
  id: string;
  name: string;
  serviceIds: string[];
};
export type ServiceOption = {
  id: string;
  name: string;
  durationMin: number;
  priceCents: number;
};
export type ClientOption = { id: string; name: string; phone: string | null };

export function AppointmentDialog({
  open,
  onOpenChange,
  slotStartLocal,
  professionalId,
  professionals,
  services,
  clients,
  canOverbook,
  timezone,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  slotStartLocal: string;
  professionalId: string;
  professionals: ProOption[];
  services: ServiceOption[];
  clients: ClientOption[];
  canOverbook: boolean;
  timezone: string;
}) {
  const [pending, startTransition] = useTransition();
  const [error, setError] = useState<string | null>(null);
  const [selectedProId, setSelectedProId] = useState(professionalId);
  const [mode, setMode] = useState<"existing" | "new">("existing");
  const [repeat, setRepeat] = useState(false);
  const [frequency, setFrequency] = useState<"WEEKLY" | "BIWEEKLY">("WEEKLY");
  const [occurrences, setOccurrences] = useState(4);
  const [conflict, setConflict] = useState(false);
  const [overbookReason, setOverbookReason] = useState("");
  const [seriesResult, setSeriesResult] = useState<{ created: number; skipped: number } | null>(null);
  const [lastFormData, setLastFormData] = useState<FormData | null>(null);
  const idempotencyKeyRef = useRef<string | null>(null);

  const proNow = professionals.find((p) => p.id === selectedProId);
  const availableServices = services.filter((s) =>
    proNow?.serviceIds.includes(s.id),
  );

  function buildPayload(form: FormData, overbookReasonValue?: string) {
    const idempotencyKey = idempotencyKeyRef.current ?? crypto.randomUUID();
    idempotencyKeyRef.current = idempotencyKey;
    const serviceIds = form.getAll("serviceIds").map(String).filter(Boolean);
    const base =
      mode === "existing"
        ? {
            professionalId: selectedProId,
            serviceIds,
            clientId: String(form.get("clientId")),
            startLocal: slotStartLocal,
            idempotencyKey,
            notes: (form.get("notes") as string) || null,
          }
        : {
            professionalId: selectedProId,
            serviceIds,
            clientName: String(form.get("clientName")),
            clientPhone: (form.get("clientPhone") as string) || null,
            startLocal: slotStartLocal,
            idempotencyKey,
            notes: (form.get("notes") as string) || null,
          };
    return overbookReasonValue ? { ...base, overbookReason: overbookReasonValue } : base;
  }

  async function onSubmit(e: React.FormEvent<HTMLFormElement>) {
    e.preventDefault();
    setError(null);
    setConflict(false);
    const form = new FormData(e.currentTarget);
    if (form.getAll("serviceIds").length === 0) {
      setError("Selecione pelo menos um serviço");
      return;
    }
    setLastFormData(form);

    if (repeat) {
      const payload = buildPayload(form);
      startTransition(async () => {
        const result = await createRecurringAppointments({
          ...payload,
          frequency,
          occurrences,
        });
        if ("error" in result) {
          setError(result.error);
        } else {
          setSeriesResult({ created: result.created, skipped: result.skipped.length });
        }
      });
      return;
    }

    const payload = buildPayload(form);
    startTransition(async () => {
      const result = await createAppointmentManually(payload);
      if ("error" in result) {
        if (result.error === "Horário já ocupado" && canOverbook) {
          setConflict(true);
        } else {
          setError(result.error);
        }
      } else {
        onOpenChange(false);
      }
    });
  }

  function onOverbookConfirm() {
    if (!lastFormData || overbookReason.trim().length < 3) return;
    setError(null);
    const payload = buildPayload(lastFormData, overbookReason.trim());
    startTransition(async () => {
      const result = await createAppointmentManually(payload);
      if ("error" in result) {
        setError(result.error);
      } else {
        onOpenChange(false);
      }
    });
  }

  const startLabel = `${slotStartLocal.slice(8, 10)}/${slotStartLocal.slice(5, 7)}/${slotStartLocal.slice(0, 4)} às ${slotStartLocal.slice(11)} (${timezone})`;

  if (seriesResult) {
    return (
      <Dialog open={open} onOpenChange={onOpenChange}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>Série criada</DialogTitle>
          </DialogHeader>
          <p className="text-sm">
            {seriesResult.created} agendamento{seriesResult.created !== 1 ? "s" : ""} criado
            {seriesResult.created !== 1 ? "s" : ""}.
            {seriesResult.skipped > 0 &&
              ` ${seriesResult.skipped} data${seriesResult.skipped !== 1 ? "s" : ""} pulada${seriesResult.skipped !== 1 ? "s" : ""} por conflito de horário ou bloqueio do salão.`}
          </p>
          <DialogFooter>
            <Button onClick={() => onOpenChange(false)}>Fechar</Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    );
  }

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-h-[85vh] overflow-y-auto">
        <DialogHeader>
          <DialogTitle>Novo agendamento</DialogTitle>
          <DialogDescription>Início: {startLabel}</DialogDescription>
        </DialogHeader>

        <form
          onSubmit={onSubmit}
          onChange={() => {
            idempotencyKeyRef.current = null;
            setConflict(false);
          }}
          className="grid gap-4"
        >
          <div>
            <label className="mb-1 block text-sm font-medium">Profissional</label>
            <select
              className="flex h-10 w-full rounded-md border border-input bg-background px-3 text-sm"
              value={selectedProId}
              onChange={(e) => setSelectedProId(e.target.value)}
            >
              {professionals.map((p) => (
                <option key={p.id} value={p.id}>{p.name}</option>
              ))}
            </select>
          </div>

          <div>
            <label className="mb-1 block text-sm font-medium">Serviços</label>
            <div className="max-h-48 space-y-2 overflow-y-auto rounded-md border border-input p-2">
              {availableServices.map((service) => (
                <label
                  key={service.id}
                  className="flex min-h-11 cursor-pointer items-center gap-3 rounded-md px-2 py-1.5 hover:bg-muted"
                >
                  <input
                    type="checkbox"
                    name="serviceIds"
                    value={service.id}
                    className="h-4 w-4"
                  />
                  <span className="min-w-0 flex-1 text-sm">{service.name}</span>
                  <span className="shrink-0 text-xs text-muted-foreground">
                    {formatDuration(service.durationMin)} · {formatMoney(service.priceCents)}
                  </span>
                </label>
              ))}
            </div>
            {availableServices.length === 0 && (
              <p className="mt-1 text-xs text-muted-foreground">
                Este profissional não realiza nenhum serviço ainda. Vincule em Profissionais → Editar.
              </p>
            )}
          </div>

          <div className="flex items-center gap-2 text-sm">
            <button
              type="button"
              onClick={() => setMode("existing")}
              className={`rounded-md px-3 py-1 ${mode === "existing" ? "bg-primary text-primary-foreground" : "bg-muted"}`}
            >
              Cliente existente
            </button>
            <button
              type="button"
              onClick={() => setMode("new")}
              className={`rounded-md px-3 py-1 ${mode === "new" ? "bg-primary text-primary-foreground" : "bg-muted"}`}
            >
              Novo cliente
            </button>
          </div>

          {mode === "existing" ? (
            <div>
              <label className="mb-1 block text-sm font-medium">Cliente</label>
              <select
                name="clientId"
                required
                className="flex h-10 w-full rounded-md border border-input bg-background px-3 text-sm"
              >
                <option value="">Selecione…</option>
                {clients.map((c) => (
                  <option key={c.id} value={c.id}>
                    {c.name}{c.phone ? ` — ${c.phone}` : ""}
                  </option>
                ))}
              </select>
            </div>
          ) : (
            <div className="grid grid-cols-2 gap-3">
              <div>
                <label className="mb-1 block text-sm font-medium">Nome</label>
                <Input name="clientName" required />
              </div>
              <div>
                <label className="mb-1 block text-sm font-medium">WhatsApp</label>
                <Input name="clientPhone" placeholder="(11) 91234-5678" />
              </div>
            </div>
          )}

          <div>
            <label className="mb-1 block text-sm font-medium">Observações</label>
            <Input name="notes" placeholder="Ex.: cliente pediu franja curta" />
          </div>

          <div className="rounded-md border border-border p-3">
            <label className="flex items-center gap-2 text-sm font-medium">
              <input
                type="checkbox"
                checked={repeat}
                onChange={(e) => setRepeat(e.target.checked)}
                className="h-4 w-4"
              />
              <Repeat className="h-3.5 w-3.5" />
              Repetir agendamento
            </label>
            {repeat && (
              <div className="mt-3 grid grid-cols-2 gap-3">
                <div>
                  <label className="mb-1 block text-xs font-medium text-muted-foreground">
                    Frequência
                  </label>
                  <select
                    value={frequency}
                    onChange={(e) => setFrequency(e.target.value as "WEEKLY" | "BIWEEKLY")}
                    className="flex h-9 w-full rounded-md border border-input bg-background px-2 text-sm"
                  >
                    <option value="WEEKLY">Toda semana</option>
                    <option value="BIWEEKLY">A cada 2 semanas</option>
                  </select>
                </div>
                <div>
                  <label className="mb-1 block text-xs font-medium text-muted-foreground">
                    Nº de ocorrências
                  </label>
                  <Input
                    type="number"
                    min={2}
                    max={24}
                    value={occurrences}
                    onChange={(e) => setOccurrences(Math.min(24, Math.max(2, Number(e.target.value) || 2)))}
                    className="h-9"
                  />
                </div>
                <p className="col-span-2 text-[11px] text-muted-foreground">
                  Datas com conflito de horário ou bloqueio do salão são puladas automaticamente — o
                  resto da série é criado.
                </p>
              </div>
            )}
          </div>

          {conflict && !repeat && (
            <div className="rounded-md border border-danger/40 bg-danger/5 p-3">
              <p className="flex items-center gap-1.5 text-sm font-medium text-danger">
                <AlertTriangle className="h-4 w-4" />
                Horário já ocupado
              </p>
              <p className="mt-1 text-xs text-muted-foreground">
                Você pode encaixar mesmo assim (overbooking). A ação fica registrada na trilha de
                auditoria — informe o motivo.
              </p>
              <Input
                value={overbookReason}
                onChange={(e) => setOverbookReason(e.target.value)}
                placeholder="Motivo do encaixe (obrigatório)"
                className="mt-2"
              />
              <Button
                type="button"
                variant="outline"
                size="sm"
                disabled={pending || overbookReason.trim().length < 3}
                onClick={onOverbookConfirm}
                className="mt-2 border-danger/40 text-danger hover:bg-danger/10"
              >
                Encaixar mesmo assim
              </Button>
            </div>
          )}

          {error && (
            <p className="rounded-md bg-destructive/10 px-3 py-2 text-sm text-destructive">
              {error}
            </p>
          )}

          <DialogFooter>
            <DialogClose asChild>
              <Button variant="outline" type="button">Cancelar</Button>
            </DialogClose>
            <Button type="submit" disabled={pending || availableServices.length === 0}>
              {pending ? "Agendando…" : repeat ? "Criar série" : "Confirmar"}
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  );
}
