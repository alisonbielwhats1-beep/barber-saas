"use client";
import { StaffVisitDialog, type StaffVisitDraft } from "./visit-form";
import { ServiceRepeater } from "@/components/service-repeater";

import { useEffect, useRef, useState } from "react";
import { searchAppointmentClients } from "./client-search-actions";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { AlertTriangle, Repeat } from "lucide-react";
import { AppointmentSteps, AppointmentSummaryRow, ClientChoice } from "./appointment-flow-ui";
import { normalizeSearch } from "@/components/ui/search-picker";
import { isDateKey } from "@/lib/time";
import "./appointment-flow.css";
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
  initialClient,
}: {
  initialClient?: ClientOption;
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
  const [visitMode, setVisitMode] = useState(false);
  const [visitDraft, setVisitDraft] = useState<StaffVisitDraft | null>(null);
  const [step, setStep] = useState(0);
  const [contextOpen, setContextOpen] = useState(false);
  const [discarding, setDiscarding] = useState(false);
  const [clientName, setClientName] = useState("");
  const [clientPhone, setClientPhone] = useState("");
  const [notes, setNotes] = useState("");
  const [serviceQuery, setServiceQuery] = useState("");
  const titleRef = useRef<HTMLHeadingElement>(null);
  const bodyRef = useRef<HTMLDivElement>(null);
  const errorRef = useRef<HTMLParagraphElement>(null);
  useEffect(() => {
    titleRef.current?.focus();
    if (bodyRef.current) bodyRef.current.scrollTop = 0;
  }, [step, contextOpen, visitMode, discarding]);
  const [pending, setPending] = useState(false);
  const submitting = useRef(false);
  const [error, setError] = useState<string | null>(null);
  useEffect(() => { if (error) errorRef.current?.scrollIntoView?.({ block: "nearest" }); }, [error]);
  const [selectedProId, setSelectedProId] = useState(professionalId);
  const [date, setDate] = useState(slotStartLocal.slice(0, 10));
  const [time, setTime] = useState(slotStartLocal.slice(11, 16));
  const [clientId, setClientId] = useState(initialClient?.id ?? "");
  const [clientQuery, setClientQuery] = useState("");
  const [clientResults, setClientResults] = useState<ClientOption[]>([]);
  const [chosenClient, setChosenClient] = useState<ClientOption | null>(initialClient ?? null);
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
  const clientOptions = chosenClient
    ? [chosenClient, ...matchingClients.filter(client => client.id !== chosenClient.id)] : matchingClients;
  const [selectedServices, setSelectedServices] = useState<string[]>([]);
  const [loadingLast, setLoadingLast] = useState(false);
  const [lastMessage, setLastMessage] = useState<string | null>(null);
  const lastRequest = useRef(0);
  const [mode, setMode] = useState<"existing" | "new">("existing");
  const [repeat, setRepeat] = useState(false);
  const [frequency, setFrequency] = useState<"WEEKLY" | "BIWEEKLY">("WEEKLY");
  const [occurrences, setOccurrences] = useState(4);
  const [overrideConflict, setOverrideConflict] = useState<
    "OUTSIDE_WORKING_HOURS" | "AFTER_WORKING_HOURS" | "SLOT_TAKEN" | "WORKING_HOURS_BREAK" | "PROFESSIONAL_UNAVAILABLE" | null
  >(null);
  const [overrideReason, setOverrideReason] = useState("");
  const [seriesResult, setSeriesResult] = useState<{ created: number; skipped: number } | null>(null);
  const [lastFormData, setLastFormData] = useState<FormData | null>(null);
  const idempotencyKeyRef = useRef<string | null>(null);
  const confirmedExceptions = useRef<{ scheduleReason?: string; afterHoursReason?: string; break?: boolean; breakReason?: string; blockReason?: string; overbookReason?: string }>({});

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
      ...(confirmedExceptions.current.scheduleReason ? { scheduleOverrideReason: confirmedExceptions.current.scheduleReason } : {}),
      ...(confirmedExceptions.current.afterHoursReason ? { afterHoursReason: confirmedExceptions.current.afterHoursReason } : {}),
      ...(confirmedExceptions.current.overbookReason ? { overbookReason: confirmedExceptions.current.overbookReason } : {}),
      ...(confirmedExceptions.current.blockReason ? { timeOffOverrideReason: confirmedExceptions.current.blockReason } : {}),
      ...(confirmedExceptions.current.break ? { overrideConfirmed: true as const } : {}),
      ...(confirmedExceptions.current.breakReason ? { workingHoursBreakReason: confirmedExceptions.current.breakReason } : {}),
    };
  }

  async function onSubmit(e: React.FormEvent<HTMLFormElement>) {
    e.preventDefault();
    if (submitting.current) return;
    setError(null);
    if (!isDateKey(date) || !/^(?:[01]\d|2[0-3]):[0-5]\d$/.test(time)) {
      setContextOpen(true); setError("Informe uma data e um horário válidos."); return;
    }
    if (contextOpen) { setContextOpen(false); setServiceQuery(""); return; }
    if ((mode === "existing" && !clientId) || (mode === "new" && clientName.trim().length < 2)) {
      setStep(0); setError("Selecione um cliente ou informe o nome do novo cliente."); return;
    }
    if (step === 0) { setStep(1); return; }
    if (selectedServices.some(id => !availableServices.some(service => service.id === id))) {
      setStep(1); setError("Há serviços incompatíveis com o profissional. Altere o profissional ou remova esses serviços."); return;
    }
    const form = new FormData();
    form.set("clientId", clientId); form.set("clientName", clientName); form.set("clientPhone", clientPhone);
    form.set("date", date); form.set("time", time); form.set("notes", notes);
    selectedServices.forEach(id => form.append("serviceIds", id));
    if (form.getAll("serviceIds").length === 0) {
      setError("Selecione pelo menos um serviço");
      return;
    }
    if (step === 1) { setStep(2); return; }
    setOverrideConflict(null);
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
          (["OUTSIDE_WORKING_HOURS", "AFTER_WORKING_HOURS", "PROFESSIONAL_UNAVAILABLE"].includes(result.code ?? "") && (canOverbook || canOverrideBreak)) ||
          (result.code === "SLOT_TAKEN" && canOverbook) ||
          (result.code === "PROFESSIONAL_UNAVAILABLE" && canOverbook) ||
          (result.code === "WORKING_HOURS_BREAK" && canOverrideBreak)
        ) {
          setOverrideConflict(result.code as Exclude<typeof overrideConflict, null>);
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
    if (["OUTSIDE_WORKING_HOURS", "AFTER_WORKING_HOURS", "PROFESSIONAL_UNAVAILABLE"].includes(overrideConflict ?? "")) confirmedExceptions.current.scheduleReason = reason;
    if (overrideConflict === "SLOT_TAKEN") confirmedExceptions.current.overbookReason = reason;
    const payload = buildPayload(lastFormData);
    runMutation(async () => {
      const result = await createAppointmentManually(payload);
      if ("error" in result) {
        if ((["OUTSIDE_WORKING_HOURS", "AFTER_WORKING_HOURS", "PROFESSIONAL_UNAVAILABLE"].includes(result.code ?? "") && (canOverbook || canOverrideBreak)) ||
          (result.code === "SLOT_TAKEN" && canOverbook) ||
          (result.code === "PROFESSIONAL_UNAVAILABLE" && canOverbook) ||
          (result.code === "WORKING_HOURS_BREAK" && canOverrideBreak)) {
          setOverrideConflict(result.code as Exclude<typeof overrideConflict, null>);
          setOverrideReason("");
        } else setError(result.error);
      } else {
        onOpenChange(false);
      }
    });
  }

  const startLabel = `${date.split("-").reverse().join("/")} · ${time}`;
  const selectedCatalog = selectedServices.map(id => services.find(service => service.id === id));
  const duration = selectedCatalog.reduce((sum, service) => sum + (service?.durationMin ?? 0), 0);
  const total = selectedCatalog.reduce((sum, service) => sum + (service?.priceCents ?? 0), 0);
  const startMinute = Number(time.slice(0, 2)) * 60 + Number(time.slice(3, 5));
  const endMinute = startMinute + duration;
  const endLabel = `${String(Math.floor(endMinute / 60) % 24).padStart(2, "0")}:${String(endMinute % 60).padStart(2, "0")}${endMinute >= 1440 ? " (+1 dia)" : ""}`;
  const clientLabel = mode === "new" ? clientName : chosenClient?.name;
  function requestClose(next: boolean) {
    if (submitting.current) return;
    if (!next && (clientId || clientName || selectedServices.length || notes)) setDiscarding(true);
    else onOpenChange(next);
  }
  function editContext() { setContextOpen(true); }
  if (visitMode) return <StaffVisitDialog open={open} onOpenChange={onOpenChange}
    onBack={draft => {
      setVisitDraft(draft); setDate(draft.date); setTime(draft.time);
      setMode(draft.newClient ? "new" : "existing"); setClientId(draft.clientId);
      setChosenClient(draft.chosen); setClientName(draft.name); setClientPhone(draft.phone);
      setVisitMode(false); resetAttempt();
    }}
    initialDraft={{ date, time, clientId, newClient: mode === "new", name: clientName, phone: clientPhone, chosen: chosenClient,
      rows: visitDraft?.rows ?? selectedServices.map(serviceId => ({ serviceId, professionalId: selectedProId, time: "" })) }}
    professionals={professionals} services={services} clients={clients} slotStartLocal={`${date}T${time}`} canOverride={canOverbook || canOverrideBreak} />;

  if (seriesResult) return <Dialog open={open} onOpenChange={onOpenChange}><DialogContent>
    <DialogHeader><DialogTitle>Série criada</DialogTitle><DialogDescription>Resultado da criação dos agendamentos.</DialogDescription></DialogHeader>
    <p>{seriesResult.created} agendamento(s) criado(s). {seriesResult.skipped > 0 && `${seriesResult.skipped} data(s) pulada(s) por conflito de horário ou bloqueio do salão.`}</p>
    <DialogFooter><Button onClick={() => onOpenChange(false)}>Fechar</Button></DialogFooter>
  </DialogContent></Dialog>;

  return <Dialog open={open} onOpenChange={requestClose}>
    <DialogContent mobileSheet className={`appointment-flow-dialog ${discarding ? "appointment-discard-dialog" : ""}`} onEscapeKeyDown={e => { if (submitting.current) e.preventDefault(); }} onPointerDownOutside={e => { if (submitting.current) e.preventDefault(); }}>
      <DialogHeader className="appointment-flow-header">
        <DialogTitle ref={titleRef} tabIndex={-1} className="pr-10 text-lg outline-none">{discarding ? "Descartar agendamento?" : contextOpen ? "Data, horário e profissional" : "Novo agendamento"}</DialogTitle>
        <DialogDescription className="sr-only">Escolha cliente e serviços, revise e confirme. Horários no fuso {timezone}.</DialogDescription>
        {!discarding && <AppointmentSteps step={step} />}
      </DialogHeader>
      <form onSubmit={onSubmit} onChange={resetAttempt} className="flex min-h-0 flex-1 flex-col">
        <div ref={bodyRef} className="appointment-flow-body">
          <fieldset disabled={pending} className="min-w-0 space-y-4">
          {discarding ? <p className="text-sm text-muted-foreground">As escolhas ainda não confirmadas serão descartadas.</p> : contextOpen ? <>
            <div className="grid grid-cols-2 gap-3">
              <label className="grid min-w-0 gap-1 text-sm">Data<Input name="date" type="date" required value={date} onChange={e => setDate(e.target.value)} /></label>
              <label className="grid min-w-0 gap-1 text-sm">Hora de início<Input name="time" type="time" step={60} required value={time} onChange={e => setTime(e.target.value)} /></label>
            </div>
            <p className="text-xs text-muted-foreground">Qualquer minuto, como 09:15 ou 11:50. Horário do estabelecimento ({timezone}).</p>
            <label className="grid gap-1 text-sm">Profissional
              <input aria-label="Buscar profissional" type="search" placeholder="Buscar profissional" className="min-h-11 rounded-lg border border-border bg-background px-3 text-base" onChange={e => { e.stopPropagation(); setServiceQuery(e.target.value); }} value={serviceQuery} />
            </label>
            <div className="max-h-64 overflow-y-auto rounded-xl border border-border">
              {professionals.filter(pro => normalizeSearch(pro.name).includes(normalizeSearch(serviceQuery))).map(pro => <button type="button" key={pro.id} aria-pressed={selectedProId === pro.id} className="min-h-12 w-full border-b border-border px-3 text-left text-sm last:border-0 aria-pressed:bg-primary/10" onClick={() => { setSelectedProId(pro.id); lastRequest.current++; setLoadingLast(false); setLastMessage(null); resetAttempt(); }}>{pro.name}{selectedProId === pro.id ? " ✓" : ""}</button>)}
            </div>
            {selectedServices.some(id => !proNow?.serviceIds.includes(id)) && <p role="alert" className="text-sm text-warning">Este profissional não realiza todos os serviços selecionados. Suas escolhas foram mantidas; ajuste-as antes de confirmar.</p>}
          </> : <>
            {step < 2 && <div className="flex items-center justify-between gap-2 rounded-xl border border-border bg-surface-1 px-3 py-1 text-sm"><span className="min-w-0 break-words">{startLabel}<span className="block text-xs text-muted-foreground">{proNow?.name || "Escolha o profissional"}</span></span><button type="button" onClick={() => { setServiceQuery(""); editContext(); }} className="min-h-11 shrink-0 px-2 text-primary" aria-label="Alterar data, horário e profissional">Alterar</button></div>}
            {step === 0 && <>
              <h2 className="text-xl font-semibold">Quem é o cliente?</h2>
              {mode === "existing" ? <>
                <ClientChoice query={clientQuery} onQuery={setClientQuery} options={clientOptions} selected={clientId} searching={searchingClients} error={clientSearchError} onSelect={client => { setClientId(client.id); setChosenClient(client); lastRequest.current++; setLoadingLast(false); setLastMessage(null); resetAttempt(); }} />
                <Button type="button" variant="outline" className="min-h-11 w-full" onClick={() => { setMode("new"); lastRequest.current++; setLoadingLast(false); resetAttempt(); }} aria-label="Novo cliente">+ Novo cliente</Button>
              </> : <>
                <label className="grid gap-1 text-sm">Nome<Input name="clientName" required minLength={2} value={clientName} onChange={e => setClientName(e.target.value)} autoComplete="name" /></label>
                <label className="grid gap-1 text-sm">WhatsApp (opcional)<Input name="clientPhone" type="tel" value={clientPhone} onChange={e => setClientPhone(e.target.value)} placeholder="(11) 91234-5678" /></label>
                <p className="text-xs text-muted-foreground">O cliente será cadastrado ao confirmar o agendamento.</p>
                <Button type="button" variant="outline" onClick={() => { setMode("existing"); resetAttempt(); }}>Escolher cliente existente</Button>
              </>}
            </>}
            {step === 1 && <>
              <div className="flex items-center justify-between gap-3 text-sm"><p className="min-w-0 break-words"><span className="text-muted-foreground">Cliente · </span>{clientLabel}</p><button type="button" onClick={() => setStep(0)} aria-label="Alterar cliente" className="min-h-11 shrink-0 px-2 text-primary">Alterar</button></div>
              <h2 className="text-xl font-semibold">Escolha os serviços</h2>
              {professionals.length > 1 && <div className="space-y-2">
                <Button type="button" variant="outline" className="h-auto min-h-11 w-full whitespace-normal" disabled={repeat || Boolean(notes.trim())} onClick={() => setVisitMode(true)}>{visitDraft ? "Retomar serviços com profissionais diferentes" : "Adicionar outro profissional"}</Button>
                {(repeat || notes.trim()) && <p className="text-xs text-muted-foreground">A visita com profissionais diferentes não recebe recorrência ou observações neste fluxo. Mantenha este agendamento ou remova essas opções para continuar.</p>}
              </div>}
              {mode === "existing" && clientId && <Button type="button" variant="outline" className="h-auto min-h-11 w-full whitespace-normal" disabled={loadingLast} onClick={useLastServices}>{loadingLast ? "Consultando…" : "Usar serviços da última reserva"}</Button>}
              {lastMessage && <p role="status" className="text-sm text-muted-foreground">{lastMessage}</p>}
              <Input aria-label="Buscar serviço" type="search" value={serviceQuery} onChange={e => { e.stopPropagation(); setServiceQuery(e.target.value); }} placeholder="Buscar serviço" />
              <div className="appointment-service-list rounded-xl border border-border">
                {availableServices.filter(service => normalizeSearch(service.name).includes(normalizeSearch(serviceQuery))).map(service => <label key={service.id} data-selected={selectedServices.includes(service.id)} className="appointment-service-option flex min-h-14 cursor-pointer items-center gap-3 border-b border-border px-3 py-3 last:border-0">
                  <span className="min-w-0 flex-1 break-words text-sm"><span className="block font-medium">{service.name}</span><span className="text-xs text-muted-foreground">{formatDuration(service.durationMin)} · {service.priceType === "FROM" ? "A partir de " : ""}{formatMoney(service.priceCents)}</span></span>
                  <input type="checkbox" className="h-5 w-5 shrink-0 accent-primary" checked={selectedServices.includes(service.id)} disabled={!selectedServices.includes(service.id) && selectedServices.length >= 10} onChange={e => { lastRequest.current++; setLoadingLast(false); setLastMessage(null); setSelectedServices(current => e.target.checked ? [...current, service.id] : current.filter(id => id !== service.id)); resetAttempt(); }} />
                </label>)}
                {!availableServices.filter(service => normalizeSearch(service.name).includes(normalizeSearch(serviceQuery))).length && <p className="p-4 text-sm text-muted-foreground">Nenhum serviço encontrado para este profissional. Altere a busca ou o profissional.</p>}
              </div>
              {selectedServices.length > 0 && <details className="rounded-xl border border-border p-3"><summary className="min-h-11 cursor-pointer py-3 text-sm font-medium">Quantidade e ordem dos serviços</summary><ServiceRepeater ids={selectedServices} services={services} onChange={ids => { lastRequest.current++; setLoadingLast(false); setSelectedServices(ids); resetAttempt(); }} /></details>}
              <details className="rounded-xl border border-border p-3"><summary className="min-h-11 cursor-pointer py-3 text-sm font-medium">Observações{notes ? " · preenchidas" : ""}</summary><Input name="notes" aria-label="Observações" value={notes} onChange={e => setNotes(e.target.value)} placeholder="Preferências para este atendimento" /></details>
              {canRepeat && <details className="rounded-xl border border-border p-3"><summary className="min-h-11 cursor-pointer py-3 text-sm font-medium">Recorrência{repeat ? " · ativa" : ""}</summary>
                <label className="flex min-h-11 items-center gap-2 text-sm"><input type="checkbox" checked={repeat} onChange={e => setRepeat(e.target.checked)} /><Repeat size={16} aria-hidden />Repetir agendamento</label>
                {repeat && <div className="grid grid-cols-2 gap-3"><label className="grid min-w-0 gap-1 text-sm">Frequência<select value={frequency} onChange={e => setFrequency(e.target.value as "WEEKLY" | "BIWEEKLY")} className="min-h-11 rounded-lg border border-border bg-background px-2"><option value="WEEKLY">Toda semana</option><option value="BIWEEKLY">A cada 2 semanas</option></select></label><label className="grid min-w-0 gap-1 text-sm">Nº de ocorrências<Input type="number" min={2} max={24} value={occurrences} onChange={e => setOccurrences(Math.min(24, Math.max(2, Number(e.target.value) || 2)))} /></label><p className="col-span-2 text-xs text-muted-foreground">Datas com conflito ou bloqueio são puladas; o restante da série é criado.</p></div>}
              </details>}
            </>}
            {step === 2 && <>
              <h2 className="text-xl font-semibold">Revise o agendamento</h2>
              <div><AppointmentSummaryRow label="Cliente" onEdit={() => setStep(0)}>{clientLabel}<span className="block text-muted-foreground">{mode === "new" ? clientPhone : chosenClient?.phone}</span></AppointmentSummaryRow>
              <AppointmentSummaryRow label="Data e horário" onEdit={() => { setServiceQuery(""); editContext(); }}>{startLabel}–{endLabel} · {formatDuration(duration)}</AppointmentSummaryRow>
              <AppointmentSummaryRow label="Profissional" onEdit={() => { setServiceQuery(""); editContext(); }}>{proNow?.name}</AppointmentSummaryRow>
              <AppointmentSummaryRow label="Serviços" onEdit={() => setStep(1)}>{selectedCatalog.map((service, index) => <div key={index} className="flex justify-between gap-3 py-1"><span>{service?.name}</span><span className="shrink-0">{service?.priceType === "FROM" ? "Desde " : ""}{formatMoney(service?.priceCents ?? 0)}</span></div>)}</AppointmentSummaryRow>
              {notes && <AppointmentSummaryRow label="Observações" onEdit={() => setStep(1)}>{notes}</AppointmentSummaryRow>}
              {repeat && <AppointmentSummaryRow label="Recorrência" onEdit={() => setStep(1)}>{occurrences} ocorrências · {frequency === "WEEKLY" ? "Toda semana" : "A cada 2 semanas"}<p className="text-xs text-muted-foreground">Datas com conflito ou bloqueio serão puladas. O valor estimado é por ocorrência.</p></AppointmentSummaryRow>}</div>
              <p className="text-xs text-muted-foreground">O horário e os valores serão conferidos ao confirmar. O total pode variar conforme a data e os serviços escolhidos.</p>
            </>}
          </>}
          {overrideConflict && !repeat && step === 2 && !contextOpen && !discarding && (
            <div className="rounded-md border border-danger/40 bg-danger/5 p-3">
              <p className="flex items-center gap-1.5 text-sm font-medium text-danger">
                <AlertTriangle className="h-4 w-4" />
                {["OUTSIDE_WORKING_HOURS", "AFTER_WORKING_HOURS"].includes(overrideConflict ?? "") ? "Fora do expediente / folga"
                  : overrideConflict === "WORKING_HOURS_BREAK"
                  ? "Pausa do profissional"
                  : overrideConflict === "PROFESSIONAL_UNAVAILABLE" ? "Horário bloqueado"
                  : "Horário já ocupado"}
              </p>
              <p className="mt-1 text-xs text-muted-foreground">
                {["OUTSIDE_WORKING_HOURS", "AFTER_WORKING_HOURS"].includes(overrideConflict ?? "") ? "Este horário está fora da jornada. Confirme a exceção para este atendimento e informe o motivo."
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
                {["OUTSIDE_WORKING_HOURS", "AFTER_WORKING_HOURS"].includes(overrideConflict ?? "") ? "Agendar fora do expediente"
                  : overrideConflict === "WORKING_HOURS_BREAK"
                  ? "Agendar durante a pausa"
                  : overrideConflict === "PROFESSIONAL_UNAVAILABLE" ? "Agendar mantendo o bloqueio"
                  : "Encaixar mesmo assim"}
              </Button>
            </div>
          )}

          {error && <p ref={errorRef} role="alert" className="rounded-lg bg-danger/10 p-3 text-sm text-danger">{error}</p>}
          </fieldset>
        </div>
        <div className="appointment-flow-footer space-y-3">
          {!discarding && !contextOpen && step > 0 && <div className="flex flex-wrap justify-between gap-1 text-sm"><span>{selectedServices.length} serviço(s) · {formatDuration(duration)}</span><span>Estimativa: <strong>{formatMoney(total)}</strong></span></div>}
          {discarding ? <div className="grid grid-cols-2 gap-3"><Button type="button" variant="outline" className="h-auto min-h-12 whitespace-normal" onClick={() => setDiscarding(false)}>Continuar editando</Button><Button type="button" variant="destructive" onClick={() => onOpenChange(false)}>Descartar</Button></div> : <div className="flex gap-3">
            <Button type="button" variant="outline" className="min-h-12" disabled={pending} onClick={() => { if (contextOpen) { setContextOpen(false); setServiceQuery(""); } else if (step > 0) { setStep(step - 1); setError(null); } else requestClose(false); }}>Voltar</Button>
            <Button type="submit" className="h-auto min-h-12 flex-1 whitespace-normal" disabled={pending || loadingLast || (step > 0 && !contextOpen && !selectedServices.length) || Boolean(overrideConflict && !contextOpen && step === 2)}>{pending ? "Agendando…" : contextOpen ? "Aplicar" : step === 0 ? "Continuar" : step === 1 ? "Revisar" : repeat ? "Criar série" : "Confirmar agendamento"}</Button>
          </div>}
        </div>
      </form>
    </DialogContent>
  </Dialog>;
}
