"use client";

import { useEffect, useRef, useState } from "react";
import { searchAppointmentClients } from "./client-search-actions";
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
import { createAppointmentManually, createRecurringAppointments, getLastAppointmentServices } from "./actions";
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
  priceType?: string;
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
  canOverrideBreak,
  canRepeat,
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
  canOverrideBreak: boolean;
  canRepeat: boolean;
  timezone: string;
}) {
  const [pending, setPending] = useState(false);
  const submitting = useRef(false);
  const [error, setError] = useState<string | null>(null);
  const [selectedProId, setSelectedProId] = useState(professionalId);
  const [date, setDate] = useState(slotStartLocal.slice(0, 10));
  const [time, setTime] = useState(slotStartLocal.slice(11, 16));
  const [clientId, setClientId] = useState("");
  const [clientQuery, setClientQuery] = useState("");
  const [clientResults, setClientResults] = useState<ClientOption[]>([]);
  const [chosenClient, setChosenClient] = useState<ClientOption | null>(null);
  const [searchingClients, setSearchingClients] = useState(false);
  const [clientSearchError, setClientSearchError] = useState("");
  useEffect(() => {
    let active = true;
    const term = clientQuery.trim();
    setClientResults([]);
    setClientSearchError("");
    setSearchingClients(term.length >= 2);
    if (term.length < 2) return;
    const timer = setTimeout(() => {
      void searchAppointmentClients(term).then(result => {
        if (active) setClientResults(result);
      }).catch(() => {
        if (active) setClientSearchError("Não foi possível pesquisar. Tente digitar novamente.");
      }).finally(() => { if (active) setSearchingClients(false); });
    }, 250);
    return () => { active = false; clearTimeout(timer); };
  }, [clientQuery]);
  const matchingClients = clientQuery.trim().length >= 2 ? clientResults : clients;
  const clientOptions = chosenClient && !matchingClients.some(c => c.id === chosenClient.id)
    ? [chosenClient, ...matchingClients] : matchingClients;
  const [selectedServices, setSelectedServices] = useState<string[]>([]);
  const [loadingLast, setLoadingLast] = useState(false);
  const [lastMessage, setLastMessage] = useState<string | null>(null);
  const lastRequest = useRef(0);
  const [mode, setMode] = useState<"existing" | "new">("existing");
  const [repeat, setRepeat] = useState(false);
  const [frequency, setFrequency] = useState<"WEEKLY" | "BIWEEKLY">("WEEKLY");
  const [occurrences, setOccurrences] = useState(4);
  const [overrideConflict, setOverrideConflict] = useState<
    "AFTER_WORKING_HOURS" | "SLOT_TAKEN" | "WORKING_HOURS_BREAK" | "PROFESSIONAL_UNAVAILABLE" | null
  >(null);
  const [overrideReason, setOverrideReason] = useState("");
  const [seriesResult, setSeriesResult] = useState<{ created: number; skipped: number } | null>(null);
  const [lastFormData, setLastFormData] = useState<FormData | null>(null);
  const idempotencyKeyRef = useRef<string | null>(null);
  const confirmedExceptions = useRef<{ afterHoursReason?: string; break?: boolean; breakReason?: string; blockReason?: string; overbookReason?: string }>({});

  const proNow = professionals.find((p) => p.id === selectedProId);
  const availableServices = services.filter((s) =>
    proNow?.serviceIds.includes(s.id),
  );

  function resetAttempt() {
    idempotencyKeyRef.current = null;
    confirmedExceptions.current = {};
    setOverrideConflict(null);
    setError(null);
  }

  function runMutation(action: () => Promise<void>) {
    if (submitting.current) return;
    submitting.current = true;
    lastRequest.current++;
    setLoadingLast(false);
    setPending(true);
    void action().catch(() => {
      setError("Não foi possível confirmar. Confira sua conexão e tente novamente; suas escolhas foram mantidas.");
    }).finally(() => {
      submitting.current = false;
      setPending(false);
    });
  }

  async function useLastServices() {
    const request = ++lastRequest.current;
    setLoadingLast(true);
    setLastMessage(null);
    try {
      const result = await getLastAppointmentServices(clientId);
      if (request !== lastRequest.current) return;
      if ("error" in result) { setLastMessage(result.error); return; }
      if (!result.serviceIds.length) {
        setLastMessage("Nenhuma reserva anterior encontrada. Escolha os serviços abaixo.");
        return;
      }
      if (result.serviceIds.some(id => !availableServices.some(service => service.id === id))) {
        setLastMessage("A última reserva contém serviços indisponíveis para este profissional. Escolha os serviços abaixo.");
        return;
      }
      setSelectedServices(result.serviceIds);
      resetAttempt();
      setLastMessage("Serviços da última reserva selecionados. Confira os valores atuais e escolha a data e a hora.");
    } catch {
      if (request === lastRequest.current) setLastMessage("Não foi possível consultar a última reserva. Tente novamente.");
    } finally {
      if (request === lastRequest.current) setLoadingLast(false);
    }
  }

  function buildPayload(
    form: FormData,
  ) {
    const idempotencyKey = idempotencyKeyRef.current ?? crypto.randomUUID();
    idempotencyKeyRef.current = idempotencyKey;
    const serviceIds = form.getAll("serviceIds").map(String).filter(Boolean);
    const base =
      mode === "existing"
        ? {
            professionalId: selectedProId,
            serviceIds,
            clientId: String(form.get("clientId")),
            startLocal: `${String(form.get("date"))}T${String(form.get("time"))}`,
            idempotencyKey,
            notes: (form.get("notes") as string) || null,
          }
        : {
            professionalId: selectedProId,
            serviceIds,
            clientName: String(form.get("clientName")),
            clientPhone: (form.get("clientPhone") as string) || null,
            startLocal: `${String(form.get("date"))}T${String(form.get("time"))}`,
            idempotencyKey,
            notes: (form.get("notes") as string) || null,
          };
    return {
      ...base,
      ...(confirmedExceptions.current.afterHoursReason ? { afterHoursReason: confirmedExceptions.current.afterHoursReason } : {}),
      ...(confirmedExceptions.current.overbookReason ? { overbookReason: confirmedExceptions.current.overbookReason } : {}),
      ...(confirmedExceptions.current.blockReason ? { timeOffOverrideReason: confirmedExceptions.current.blockReason } : {}),
      ...(confirmedExceptions.current.break ? { overrideConfirmed: true as const } : {}),
      ...(confirmedExceptions.current.breakReason ? { workingHoursBreakReason: confirmedExceptions.current.breakReason } : {}),
    };
  }

  async function onSubmit(e: React.FormEvent<HTMLFormElement>) {
    e.preventDefault();
    setError(null);
    setOverrideConflict(null);
    const form = new FormData(e.currentTarget);
    if (form.getAll("serviceIds").length === 0) {
      setError("Selecione pelo menos um serviço");
      return;
    }
    setLastFormData(form);

    if (repeat) {
      const payload = buildPayload(form);
      runMutation(async () => {
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
    runMutation(async () => {
      const result = await createAppointmentManually(payload);
      if ("error" in result) {
        if (
          (result.code === "AFTER_WORKING_HOURS" && canOverbook) ||
          (result.code === "SLOT_TAKEN" && canOverbook) ||
          (result.code === "PROFESSIONAL_UNAVAILABLE" && canOverbook) ||
          (result.code === "WORKING_HOURS_BREAK" && canOverrideBreak)
        ) {
          setOverrideConflict(result.code);
        } else {
          setError(result.error);
        }
      } else {
        onOpenChange(false);
      }
    });
  }

  function onOverrideConfirm() {
    if (!lastFormData) return;
    const reason = overrideReason.trim();
    if (overrideConflict !== "WORKING_HOURS_BREAK" && reason.length < 3) return;
    setError(null);
    if (overrideConflict === "WORKING_HOURS_BREAK") { confirmedExceptions.current.break = true; confirmedExceptions.current.breakReason = reason || undefined; }
    if (overrideConflict === "PROFESSIONAL_UNAVAILABLE") confirmedExceptions.current.blockReason = reason;
    if (overrideConflict === "AFTER_WORKING_HOURS") confirmedExceptions.current.afterHoursReason = reason;
    if (overrideConflict === "SLOT_TAKEN") confirmedExceptions.current.overbookReason = reason;
    const payload = buildPayload(lastFormData);
    runMutation(async () => {
      const result = await createAppointmentManually(payload);
      if ("error" in result) {
        if ((result.code === "AFTER_WORKING_HOURS" && canOverbook) ||
          (result.code === "SLOT_TAKEN" && canOverbook) ||
          (result.code === "PROFESSIONAL_UNAVAILABLE" && canOverbook) ||
          (result.code === "WORKING_HOURS_BREAK" && canOverrideBreak)) {
          setOverrideConflict(result.code);
          setOverrideReason("");
        } else setError(result.error);
      } else {
        onOpenChange(false);
      }
    });
  }

  const startLabel = `${date.slice(8, 10)}/${date.slice(5, 7)}/${date.slice(0, 4)} às ${time}`;

  if (seriesResult) {
    return (
      <Dialog open={open} onOpenChange={onOpenChange}>
        <DialogContent className="max-h-[calc(100dvh-1rem)] overflow-y-auto">
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
      <DialogContent className="max-h-[85dvh] overflow-y-auto">
        <DialogHeader>
          <DialogTitle>Novo agendamento</DialogTitle>
          <DialogDescription>Escolha cliente, serviços, data e hora do atendimento.</DialogDescription>
        </DialogHeader>

        <form
          onSubmit={onSubmit}
          onChange={resetAttempt}
          className="grid gap-4"
        >
          <fieldset disabled={pending} className="grid min-w-0 gap-4">
          <div className="grid grid-cols-2 gap-3">
            <div className="min-w-0">
              <label htmlFor="appointment-date" className="mb-1 block text-sm font-medium">Data</label>
              <Input id="appointment-date" name="date" type="date" required value={date}
                onChange={e => setDate(e.target.value)} className="min-w-0" />
            </div>
            <div className="min-w-0">
              <label htmlFor="appointment-time" className="mb-1 block text-sm font-medium">Hora de início</label>
              <Input id="appointment-time" name="time" type="time" step={60} required value={time}
                onChange={e => setTime(e.target.value)} aria-describedby="appointment-time-help" />
            </div>
          </div>
          <p id="appointment-time-help" className="-mt-2 text-xs text-muted-foreground">
            Você pode informar qualquer minuto, como 09:15 ou 11:50. Horário do estabelecimento ({timezone}).
          </p>
          <div>
            <label htmlFor="appointment-professional" className="mb-1 block text-sm font-medium">Profissional</label>
            <select
              id="appointment-professional"
              className="flex h-10 w-full rounded-md border border-input bg-background px-3 text-sm"
              value={selectedProId}
              onChange={(e) => {
                setSelectedProId(e.target.value);
                setSelectedServices([]);
                lastRequest.current++;
                setLoadingLast(false);
                setLastMessage(null);
              }}
            >
              {professionals.map((p) => (
                <option key={p.id} value={p.id}>{p.name}</option>
              ))}
            </select>
          </div>

          <div className="flex items-center gap-2 text-sm">
            <button
              type="button"
              onClick={() => { setMode("existing"); resetAttempt(); }}
              className={`rounded-md px-3 py-1 ${mode === "existing" ? "bg-primary text-primary-foreground" : "bg-muted"}`}
            >
              Cliente existente
            </button>
            <button
              type="button"
              onClick={() => {
                setMode("new"); resetAttempt(); lastRequest.current++;
                setLoadingLast(false); setLastMessage(null);
              }}
              className={`rounded-md px-3 py-1 ${mode === "new" ? "bg-primary text-primary-foreground" : "bg-muted"}`}
            >
              Novo cliente
            </button>
          </div>

          {mode === "existing" ? (
            <div>
              <label htmlFor="appointment-client-search" className="mb-1 block text-sm font-medium">Pesquisar cliente</label>
              <Input id="appointment-client-search" type="search" maxLength={100} value={clientQuery}
                placeholder="Digite nome ou telefone" autoComplete="off"
                onChange={e => { e.stopPropagation(); setClientQuery(e.target.value); }}
                aria-describedby="appointment-client-search-status" />
              <p id="appointment-client-search-status" role="status" className="my-2 text-xs text-muted-foreground">
                {clientSearchError || (searchingClients ? "Pesquisando…" : clientQuery.trim().length >= 2
                  ? matchingClients.length ? `${matchingClients.length} resultado(s).${matchingClients.length === 50 ? " Refine a busca para encontrar outros clientes." : ""}` : "Nenhum cliente encontrado."
                  : "Digite pelo menos 2 caracteres para buscar em todos os clientes disponíveis.")}
              </p>
              <label htmlFor="appointment-client" className="mb-1 block text-sm font-medium">Cliente</label>
              <select
                id="appointment-client"
                name="clientId"
                value={clientId}
                onChange={e => {
                  setClientId(e.target.value);
                  setChosenClient(clientOptions.find(c => c.id === e.target.value) ?? null);
                  lastRequest.current++;
                  setLoadingLast(false);
                  setLastMessage(null);
                }}
                required
                className="flex h-10 w-full rounded-md border border-input bg-background px-3 text-sm"
              >
                <option value="">Selecione…</option>
                {clientOptions.map((c) => (
                  <option key={c.id} value={c.id}>
                    {c.name}{c.phone ? ` — ${c.phone}` : ""}
                  </option>
                ))}
              </select>
              {clientId && <Button type="button" variant="outline" className="mt-2 w-full"
                disabled={loadingLast} onClick={useLastServices}>
                {loadingLast ? "Consultando…" : "Usar serviços da última reserva"}
              </Button>}
              {lastMessage && <p role="status" className="mt-2 text-sm text-muted-foreground">{lastMessage}</p>}
            </div>
          ) : (
            <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
              <div>
                <label htmlFor="appointment-client-name" className="mb-1 block text-sm font-medium">Nome</label>
                <Input id="appointment-client-name" name="clientName" required />
              </div>
              <div>
                <label htmlFor="appointment-client-phone" className="mb-1 block text-sm font-medium">WhatsApp</label>
                <Input id="appointment-client-phone" name="clientPhone" placeholder="(11) 91234-5678" />
              </div>
            </div>
          )}

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
                    checked={selectedServices.includes(service.id)}
                    onChange={e => {
                      lastRequest.current++;
                      setLoadingLast(false);
                      setLastMessage(null);
                      setSelectedServices(current => e.target.checked
                        ? [...current, service.id] : current.filter(id => id !== service.id));
                    }}
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

          <div>
            <label htmlFor="appointment-notes" className="mb-1 block text-sm font-medium">Observações</label>
            <Input id="appointment-notes" name="notes" placeholder="Ex.: cliente pediu franja curta" />
          </div>

          {canRepeat && <div className="rounded-md border border-border p-3">
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
              <div className="mt-3 grid grid-cols-1 gap-3 sm:grid-cols-2">
                <div>
                  <label htmlFor="appointment-frequency" className="mb-1 block text-xs font-medium text-muted-foreground">
                    Frequência
                  </label>
                  <select
                    id="appointment-frequency"
                    value={frequency}
                    onChange={(e) => setFrequency(e.target.value as "WEEKLY" | "BIWEEKLY")}
                    className="flex h-9 w-full rounded-md border border-input bg-background px-2 text-sm"
                  >
                    <option value="WEEKLY">Toda semana</option>
                    <option value="BIWEEKLY">A cada 2 semanas</option>
                  </select>
                </div>
                <div>
                  <label htmlFor="appointment-occurrences" className="mb-1 block text-xs font-medium text-muted-foreground">
                    Nº de ocorrências
                  </label>
                  <Input
                    id="appointment-occurrences"
                    type="number"
                    min={2}
                    max={24}
                    value={occurrences}
                    onChange={(e) => setOccurrences(Math.min(24, Math.max(2, Number(e.target.value) || 2)))}
                    className="h-9"
                  />
                </div>
                <p className="sm:col-span-2 text-[11px] text-muted-foreground">
                  Datas com conflito de horário ou bloqueio do salão são puladas automaticamente — o
                  resto da série é criado.
                </p>
              </div>
            )}
          </div>}

          {overrideConflict && !repeat && (
            <div className="rounded-md border border-danger/40 bg-danger/5 p-3">
              <p className="flex items-center gap-1.5 text-sm font-medium text-danger">
                <AlertTriangle className="h-4 w-4" />
                {overrideConflict === "AFTER_WORKING_HOURS" ? "Término após o expediente"
                  : overrideConflict === "WORKING_HOURS_BREAK"
                  ? "Pausa do profissional"
                  : overrideConflict === "PROFESSIONAL_UNAVAILABLE" ? "Horário bloqueado"
                  : "Horário já ocupado"}
              </p>
              <p className="mt-1 text-xs text-muted-foreground">
                {overrideConflict === "AFTER_WORKING_HOURS" ? "Confirme este atendimento terminando após o expediente. O horário de fechamento e a disponibilidade pública serão mantidos. Informe o motivo."
                  : overrideConflict === "WORKING_HOURS_BREAK"
                  ? "Você pode criar este encaixe manual durante a pausa. Confirme abaixo; o motivo é opcional."
                  : overrideConflict === "PROFESSIONAL_UNAVAILABLE" ? "Você pode agendar neste bloqueio. O bloqueio será mantido para os clientes e a exceção ficará registrada. Informe o motivo."
                  : "Você pode encaixar mesmo assim (overbooking). A ação fica registrada na trilha de auditoria — informe o motivo."}
              </p>
              <label htmlFor="appointment-override-reason" className="mt-2 block text-xs font-medium">
                Motivo da exceção{overrideConflict === "WORKING_HOURS_BREAK" ? " (opcional)" : ""}
              </label>
              <Input
                id="appointment-override-reason"
                value={overrideReason}
                onChange={(e) => {
                  e.stopPropagation();
                  setOverrideReason(e.target.value);
                }}
                placeholder={overrideConflict === "WORKING_HOURS_BREAK"
                  ? "Motivo da exceção (opcional)"
                  : "Motivo da exceção (obrigatório)"}
                className="mt-2"
              />
              <Button
                type="button"
                variant="outline"
                size="sm"
                disabled={pending || (
                  overrideConflict !== "WORKING_HOURS_BREAK" && overrideReason.trim().length < 3
                )}
                onClick={onOverrideConfirm}
                className="mt-2 border-danger/40 text-danger hover:bg-danger/10"
              >
                {overrideConflict === "AFTER_WORKING_HOURS" ? "Agendar com término após o expediente"
                  : overrideConflict === "WORKING_HOURS_BREAK"
                  ? "Agendar durante a pausa"
                  : overrideConflict === "PROFESSIONAL_UNAVAILABLE" ? "Agendar mantendo o bloqueio"
                  : "Encaixar mesmo assim"}
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
          <p className="text-xs text-muted-foreground">Início: {startLabel}. Disponibilidade e valores são conferidos ao confirmar.</p>
          </fieldset>
        </form>
      </DialogContent>
    </Dialog>
  );
}
