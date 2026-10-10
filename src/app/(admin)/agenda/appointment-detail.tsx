"use client";
import "./appointment-flow.css";
import { ServiceRepeater } from "@/components/service-repeater";

import { useRef, useState } from "react";
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import {
  Check,
  Play,
  CircleCheck,
  UserX,
  Ban,
  MessageCircle,
  Phone,
  Clock,
  User,
  Scissors,
  StickyNote,
  Copy,
  Receipt,
  Pencil,
  X,
  Save,
  CreditCard,
  ArrowLeft,
  Users,
  AlertTriangle,
  History,
  CalendarClock,
} from "lucide-react";
import { formatMoney, formatDuration } from "@/lib/utils";
import { servicePriceLabel } from "@/lib/service-price";
import { localDateTimeToUtc } from "@/lib/time";
import { isValidPhoneBR, normalizePhone } from "@/lib/phone";
import { ptBR } from "date-fns/locale";
import { formatInTimeZone } from "date-fns-tz";
import {
  updateAppointmentStatus,
  cancelAppointment,
  duplicateAppointment,
  editAppointment,
  getComandaData,
  removeWaitlistEntry,
  promoteWaitlist,
  cancelAndPromoteWaitlist,
} from "./actions";
import {
  STATUS,
  ACTION_LABELS,
  statusActionClasses,
  canOpenAppointmentCheckout,
  nextActions,
  type ApptStatus,
} from "./agenda-status";
import { ComandaPanel } from "./comanda-panel";
import type { ServiceOption } from "./appointment-form";
import type { Appointment, WaitlistEntryView } from "./agenda-board";
import { SeriesEditor } from "./series-editor";
import { CarePanel } from "./care-panel";

const HISTORY_PREVIEW_COUNT = 3;
/** Stable ref callback: focuses an element once, when it mounts (no keyboard pops up on phones). */
const focusOnMount = (node: HTMLElement | null) => node?.focus();

const ACTION_ICON: Record<string, typeof Check> = {
  CONFIRMED: Check,
  IN_PROGRESS: Play,
  COMPLETED: CircleCheck,
  NO_SHOW: UserX,
};

function waMessageLink(phone: string | null, msg: string) {
  const digits = (phone ?? "").replace(/\D/g, "");
  const full = digits.length <= 11 ? `55${digits}` : digits;
  return `https://wa.me/${full}?text=${encodeURIComponent(msg)}`;
}

function waLink(phone: string | null, clientName: string, salonName: string, when: string) {
  return waMessageLink(phone, `Olá ${clientName.split(" ")[0]}! Passando para confirmar seu horário em ${salonName} ${when}. Podemos confirmar? 💈`);
}

function waitlistWaLink(phone: string | null, clientName: string, salonName: string) {
  return waMessageLink(phone, `Olá ${clientName.split(" ")[0]}! Aqui é do ${salonName}. Você está na nossa fila de espera e conseguimos outro horário para você. Qual fica melhor? 💈`);
}

function telLink(phone: string | null): string | null {
  return phone && isValidPhoneBR(phone) ? `tel:+55${normalizePhone(phone)}` : null;
}

function escapeHtml(value: string): string {
  return value.replace(/[&<>"]/g, (character) => ({
    "&": "&amp;",
    "<": "&lt;",
    ">": "&gt;",
    '"': "&quot;",
  })[character]!);
}

function printReceipt(
  receipt: Awaited<ReturnType<typeof getComandaData>>,
  salonName: string,
  timezone: string,
) {
  if (!receipt.payment) throw new Error("Pagamento não encontrado");
  const receiptCurrency = receipt.payment.currency;
  const when = formatInTimeZone(
    new Date(receipt.startAt),
    timezone,
    "d 'de' MMMM 'de' yyyy 'às' HH:mm",
    { locale: ptBR },
  );
  const services = receipt.serviceItems.length > 0
    ? receipt.serviceItems
    : [{ serviceName: receipt.service.name, priceCents: receipt.priceCents }];
  const serviceRows = services.map((service) =>
    `<div class="row"><span>${escapeHtml(service.serviceName)}</span><b>${escapeHtml(formatMoney(service.priceCents, receiptCurrency))}</b></div>`,
  ).join("");
  const productRows = receipt.products.map((product) =>
    `<div class="row"><span>${product.quantity}× ${escapeHtml(product.productName)}</span><b>${escapeHtml(formatMoney(product.quantity * product.priceCentsUnit, receiptCurrency))}</b></div>`,
  ).join("");
  const discountRow = receipt.payment.discountCents > 0
    ? `<div class="row"><span>Desconto</span><b>- ${escapeHtml(formatMoney(receipt.payment.discountCents, receiptCurrency))}</b></div>`
    : "";
  const method = ({
    CASH: "Dinheiro",
    CREDIT_CARD: "Crédito",
    DEBIT_CARD: "Débito",
    PIX: "Pix",
    TRANSFER: "Transferência",
  } as const)[receipt.payment.method];
  const html = `<!doctype html><html lang="pt-BR"><head><meta charset="utf-8"><title>Recibo</title>
  <style>
    *{font-family:ui-sans-serif,system-ui,Arial,sans-serif;box-sizing:border-box}
    body{margin:0;padding:40px;color:#111}
    .card{max-width:420px;margin:0 auto;border:1px solid #e5e5e5;border-radius:16px;padding:28px}
    h1{font-size:18px;margin:0 0 2px}
    .muted{color:#777;font-size:12px}
    .row{display:flex;justify-content:space-between;padding:10px 0;border-bottom:1px dashed #e5e5e5;font-size:14px}
    .total{display:flex;justify-content:space-between;padding-top:16px;font-size:20px;font-weight:700}
    .tag{display:inline-block;margin-top:16px;font-size:11px;color:#2ECC8B;font-weight:700}
  </style></head><body>
  <div class="card">
    <h1>${escapeHtml(salonName)}</h1>
    <p class="muted">Recibo de atendimento</p>
    <div style="height:16px"></div>
    <div class="row"><span>Cliente</span><b>${escapeHtml(receipt.client.name)}</b></div>
    <div class="row"><span>Data</span><b>${escapeHtml(when)}</b></div>
    ${serviceRows}${productRows}${discountRow}
    <div class="row"><span>Forma</span><b>${escapeHtml(method)}</b></div>
    <div class="row"><span>Pagamento</span><b>${escapeHtml(receipt.payment.id)}</b></div>
    <div class="total"><span>Total recebido</span><span>${escapeHtml(formatMoney(receipt.payment.amountCents, receiptCurrency))}</span></div>
    <span class="tag">✓ PAGO</span>
  </div>
  <script>window.onload=function(){window.print()}</script>
  </body></html>`;
  const w = window.open("", "_blank", "width=480,height=640");
  if (w) {
    w.document.write(html);
    w.document.close();
  }
}

type ViewMode = "detail" | "edit" | "comanda";

export function AppointmentDetail({
  appt,
  salonName,
  professionalName,
  timezone,
  canCreate,
  canCancel,
  canOverrideSchedule = false,
  services = [],
  onScheduleWaitlist,
  onClose,
}: {
  appt: Appointment | null;
  professionalName?: string;
  salonName: string;
  timezone: string;
  canCreate: boolean;
  canCancel: boolean;
  canOverrideSchedule?: boolean;
  services?: ServiceOption[];
  /** Abre o agendamento pré-preenchido para atender a pessoa em outro horário. */
  onScheduleWaitlist?: (entry: WaitlistEntryView) => void;
  onClose: () => void;
}) {
  const [pending, setPending] = useState(false);
  const submitting = useRef(false);
  function runMutation(action: () => Promise<void>) {
    if (submitting.current) return;
    submitting.current = true;
    setPending(true);
    void action().catch(() => setError("Não foi possível concluir. Confira sua conexão e tente novamente.")).finally(() => {
      submitting.current = false;
      setPending(false);
    });
  }
  const [error, setError] = useState<string | null>(null);
  const [view, setView] = useState<ViewMode>("detail");
  const [editReview, setEditReview] = useState(false);
  const [cancelMode, setCancelMode] = useState(false);
  const [cancelReason, setCancelReason] = useState("");
  const [promoteOnCancel, setPromoteOnCancel] = useState(false);
  const [removeWaitlistId, setRemoveWaitlistId] = useState<string | null>(null);
  const [removeWaitlistReason, setRemoveWaitlistReason] = useState("");
  const [historyExpanded, setHistoryExpanded] = useState(false);
  const mutationKeys = useRef(new Map<string, string>());

  const start = appt ? new Date(appt.startAt) : new Date();
  const end = appt ? new Date(appt.endAt) : new Date();
  const [editDate, setEditDate] = useState(() => formatInTimeZone(start, timezone, "yyyy-MM-dd"));
  const [editTime, setEditTime] = useState(() => formatInTimeZone(start, timezone, "HH:mm"));
  const [editNotes, setEditNotes] = useState(appt?.notes ?? "");
  const [editServices, setEditServices] = useState(appt?.serviceIds ?? []);
  const [editBaseline, setEditBaseline] = useState(appt);
  const [serviceSearch, setServiceSearch] = useState("");
  const [afterHours, setAfterHours] = useState(false);
  const [afterHoursReason, setAfterHoursReason] = useState("");
  const [overbook, setOverbook] = useState(false);
  const [overbookReason, setOverbookReason] = useState("");
  const confirmedEditExceptions = useRef<{ scheduleOverrideReason?: string; afterHoursReason?: string; overbookReason?: string }>({});
  const [savedMessage, setSavedMessage] = useState<string | null>(null);

  if (!appt) return null;

  const cfg = STATUS[appt.status as keyof typeof STATUS] ?? STATUS.CONFIRMED;
  const whenLabel = formatInTimeZone(start, timezone, "d 'de' MMMM 'às' HH:mm", { locale: ptBR });
  const clientPhoneHref = telLink(appt.clientPhone);
  const baseline = editBaseline ?? appt;
  const servicesChanged = editServices.length !== baseline.serviceIds.length || editServices.some((id, i) => id !== baseline.serviceIds[i]);
  const selectedCatalog = editServices.map(id => services.find(service => service.id === id));
  const unknownService = selectedCatalog.some(service => !service);
  const previewDuration = servicesChanged ? selectedCatalog.reduce((total, service) => total + (service?.durationMin ?? 0), 0) : Math.round((new Date(baseline.endAt).getTime() - new Date(baseline.startAt).getTime()) / 60_000);
  const previewPrice = servicesChanged ? selectedCatalog.reduce((total, service) => total + (service?.priceCents ?? 0), 0) : baseline.priceCents;
  let editEndLabel: string | null = null;
  try {
    const proposedStart = localDateTimeToUtc(`${editDate}T${editTime}`, timezone);
    editEndLabel = formatInTimeZone(new Date(proposedStart.getTime() + previewDuration * 60_000), timezone, "HH:mm 'de' dd/MM");
  } catch { /* Campos incompletos permanecem editáveis, sem permitir envio. */ }

  const now = new Date();
  const isCompletedAwaitingPayment = appt.status === "COMPLETED" && !appt.hasPayment;
  const canOpenComanda = canCreate && canOpenAppointmentCheckout({
    status: appt.status,
    hasPayment: appt.hasPayment,
    startAt: start,
    now,
  });
  const isMutable =
    ["PENDING", "CONFIRMED"].includes(appt.status) && start.getTime() > now.getTime();
  const availableActions = nextActions(appt.status).filter(
    (status) =>
      !["IN_PROGRESS", "COMPLETED", "NO_SHOW"].includes(status) ||
      start.getTime() <= now.getTime(),
  );

  function mutationKey(action: string) {
    const existing = mutationKeys.current.get(action);
    if (existing) return existing;
    const created = crypto.randomUUID();
    mutationKeys.current.set(action, created);
    return created;
  }

  function run(fn: () => Promise<{ error: string } | { success: true } | void>) {
    setError(null);
    runMutation(async () => {
      try {
        const result = await fn();
        if (result && "error" in result) {
          setError(result.error);
          return;
        }
        onClose();
      } catch (e) {
        setError(e instanceof Error ? e.message : "Erro");
      }
    });
  }

  function invalidateEdit() {
    setEditReview(false);
    mutationKeys.current.delete("edit");
    setAfterHours(false);
    setAfterHoursReason("");
    setOverbook(false);
    setOverbookReason("");
    confirmedEditExceptions.current = {};
    setError(null);
  }

  function openEdit() {
    if (!appt) return;
    setEditDate(formatInTimeZone(start, timezone, "yyyy-MM-dd"));
    setEditTime(formatInTimeZone(start, timezone, "HH:mm"));
    setEditNotes(appt.notes ?? "");
    setEditServices(appt.serviceIds);
    setEditBaseline(appt);
    setServiceSearch("");
    setSavedMessage(null);
    invalidateEdit();
    setView("edit");
  }

  function saveEdit(confirmAfterHours = false, confirmOverbook = false) {
    if (!appt) return;
    if (confirmAfterHours) confirmedEditExceptions.current.scheduleOverrideReason = afterHoursReason.trim();
    if (confirmOverbook) confirmedEditExceptions.current.overbookReason = overbookReason.trim();
    setError(null);
    runMutation(async () => {
      try {
        const result = await editAppointment({
          id: appt.id,
          professionalId: baseline.professionalId,
          serviceIds: editServices,
          ...confirmedEditExceptions.current,
          startLocal: `${editDate}T${editTime}`,
          notes: editNotes || null,
          idempotencyKey: mutationKey("edit"),
          expectedVersion: baseline.version,
        });
        if ("error" in result) {
          setError(result.error);
          if (["AFTER_WORKING_HOURS", "OUTSIDE_WORKING_HOURS", "WORKING_HOURS_BREAK", "PROFESSIONAL_UNAVAILABLE"].includes(result.code ?? "") && (canOverrideSchedule || canCancel)) setAfterHours(true);
          if (result.code === "SLOT_TAKEN" && canCancel) { setAfterHours(false); setOverbook(true); }
        } else {
          setSavedMessage(result.requiresAcceptance ? "Agendamento atualizado. O novo horário já está reservado; aguardando a resposta do cliente." : "Agendamento atualizado.");
        }
      } catch {
        setError("Não foi possível salvar. Confira sua conexão e tente novamente; suas alterações foram mantidas.");
      }
    });
  }

  return (
    <Dialog open={!!appt} onOpenChange={(o) => !o && !submitting.current && onClose()}>
      <DialogContent onEscapeKeyDown={(event) => { if (submitting.current) event.preventDefault(); }} onPointerDownOutside={(event) => { if (submitting.current) event.preventDefault(); }} className="appointment-detail-dialog max-h-[calc(100dvh-1rem)] max-w-md gap-0 overflow-y-auto overscroll-contain p-0 pb-[env(safe-area-inset-bottom)]">
        <div className="p-5">
          <DialogHeader className="mb-4 pr-8 flex-row items-center justify-between space-y-0">
            <div className="flex min-w-0 items-center gap-2">
              {view !== "detail" && !savedMessage && (
                <button
                  disabled={pending}
                  onClick={() => { setView("detail"); setError(null); }}
                  aria-label="Voltar aos detalhes do agendamento"
                  className="grid min-h-11 min-w-11 place-items-center rounded-[10px] text-muted-foreground transition-colors hover:bg-card-hover hover:text-foreground lg:min-h-9 lg:min-w-9"
                >
                  <ArrowLeft className="h-4 w-4" />
                </button>
              )}
              <DialogTitle className="min-w-0 break-words text-lg font-semibold">
                {view === "comanda"
                  ? isCompletedAwaitingPayment ? "Registrar recebimento" : "Fechar comanda"
                  : appt.clientName}
              </DialogTitle>
            </div>
            <span
              className={`inline-flex h-[22px] shrink-0 items-center gap-1.5 whitespace-nowrap rounded-full px-2.5 text-xs font-medium ${cfg.badgeClass}`}
            >
              <span aria-hidden="true" className="h-1.5 w-1.5 rounded-full bg-current" />
              {cfg.label}
            </span>
          </DialogHeader>

          {/* ── COMANDA MODE ─────────────────────────────────── */}
          {view === "comanda" && (
            <ComandaPanel
              apptId={appt.id}
              onClose={() => { setView("detail"); onClose(); }}
            />
          )}

          {/* ── EDIT MODE ─────────────────────────────────────── */}
          {savedMessage && <div className="space-y-3"><p role="status" className="rounded-xl border border-success/30 bg-success/10 p-3 text-sm">{savedMessage}</p><button className="inline-flex min-h-11 items-center justify-center gap-1.5 rounded-[10px] bg-primary px-4 text-sm font-semibold text-primary-foreground transition-colors hover:bg-primary/90 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2 disabled:opacity-50 lg:min-h-9 lg:rounded-[9px]" onClick={onClose}>Concluir</button></div>}
          {view === "edit" && !savedMessage && (
            <div className="space-y-3">
              <p className="text-xs font-medium text-muted-foreground">
                Editando agendamento de{" "}
                <span className="font-semibold text-foreground">{appt.clientName}</span>
              </p>

              <div className="grid grid-cols-1 gap-2 min-[420px]:grid-cols-2">
                <div>
                  <label className="mb-1 block text-xs font-medium text-muted-foreground">
                    Data
                  </label>
                  <input
                    type="date"
                    aria-label="Data do agendamento"
                    disabled={pending}
                    value={editDate}
                    onChange={(e) => {
                      invalidateEdit();
                      setEditDate(e.target.value);
                      setError(null);
                    }}
                    className="min-h-11 w-full rounded-[10px] border border-border-strong bg-background px-3 text-sm focus:outline-none focus:ring-2 focus:ring-ring lg:min-h-10"
                  />
                </div>
                <div>
                  <label className="mb-1 block text-xs font-medium text-muted-foreground">
                    Horário
                  </label>
                  <input
                    type="time"
                    aria-label="Horário do agendamento"
                    disabled={pending}
                    value={editTime}
                    onChange={(e) => {
                      invalidateEdit();
                      setEditTime(e.target.value);
                      setError(null);
                    }}
                    className="min-h-11 w-full rounded-[10px] border border-border-strong bg-background px-3 text-sm focus:outline-none focus:ring-2 focus:ring-ring lg:min-h-10"
                  />
                </div>
              </div>

              <fieldset disabled={pending} className="min-w-0 space-y-2">
                <legend className="text-sm font-semibold">Serviços do agendamento</legend>
                <input aria-label="Buscar serviços para editar" type="search" value={serviceSearch} onChange={event => setServiceSearch(event.target.value)} placeholder="Buscar serviço" className="min-h-11 w-full rounded-[10px] border border-border-strong bg-background px-3 text-sm focus:outline-none focus:ring-2 focus:ring-ring lg:min-h-10" />
                <p className="text-xs text-muted-foreground">Desmarque para substituir ou marque outros para adicionar. Até 10 serviços.</p>
                <div className="max-h-52 overflow-y-auto rounded-xl border border-border">
                  {services.filter(service => service.name.toLocaleLowerCase("pt-BR").includes(serviceSearch.toLocaleLowerCase("pt-BR"))).map(service => (
                    <label key={service.id} className="flex min-h-11 cursor-pointer items-start gap-2.5 border-b border-border p-3 text-sm transition-colors last:border-0 hover:bg-card-hover">
                      <input type="checkbox" className="mt-0.5 h-4 w-4 shrink-0 accent-[hsl(var(--foreground))]" checked={editServices.includes(service.id)} disabled={!editServices.includes(service.id) && editServices.length >= 10} onChange={event => {
                        invalidateEdit();
                        setEditServices(event.target.checked ? [...editServices, service.id] : editServices.filter(id => id !== service.id));
                      }} />
                      <span>{service.name}<span className="block text-xs text-muted-foreground">{formatDuration(service.durationMin)} · {servicePriceLabel(service)}</span></span>
                    </label>
                  ))}
                </div>
                <ServiceRepeater ids={editServices} services={services} onChange={ids => { invalidateEdit(); setEditServices(ids); }} />
                {unknownService && <p className="text-xs text-warning">Há serviços históricos fora do catálogo. Para alterar os serviços, selecione uma nova combinação disponível. <button type="button" className="underline" onClick={() => { invalidateEdit(); setEditServices(editServices.filter(id => services.some(service => service.id === id))); }}>Remover serviços indisponíveis da seleção</button></p>}
                <p className="text-xs">{editServices.length} serviço(s) selecionado(s).</p>
              </fieldset>

              <p role="status" className="rounded-xl border border-border bg-card p-3 text-sm">
                Duração {servicesChanged ? "prevista" : "atual"}: <strong>{formatDuration(previewDuration)}</strong>.
                {editEndLabel ? <> Término previsto: <strong>{editEndLabel}</strong>.</> : " Informe uma data e um horário válidos."}
                <span className="mt-1 block text-xs text-muted-foreground">Valor {servicesChanged ? "base dos serviços" : "atual"}: {formatMoney(previewPrice)}. {servicesChanged ? "O total final considera as regras do dia; serviços com preço a partir de podem variar. " : ""}Ao salvar, os serviços e o horário serão atualizados imediatamente. O novo horário ficará reservado enquanto o cliente aceita ou recusa.</span>
              </p>

              <div>
                <label className="mb-1 block text-xs font-medium text-muted-foreground">
                  Observações
                </label>
                <textarea
                  aria-label="Observações do agendamento"
                  disabled={pending}
                  value={editNotes}
                  onChange={(e) => {
                    invalidateEdit();
                    setEditNotes(e.target.value);
                  }}
                  rows={3}
                  placeholder="Preferências, alergias, observações…"
                  className="w-full resize-none rounded-[10px] border border-border-strong bg-background px-3 py-2 text-sm placeholder:text-muted-foreground focus:outline-none focus:ring-2 focus:ring-ring"
                />
              </div>

              {error && (
                <p role="alert" className="rounded-xl border border-danger/30 bg-danger/10 px-3 py-2 text-sm text-danger">
                  {error}
                </p>
              )}

              {afterHours && <div className="space-y-2 rounded-xl border border-warning/40 bg-warning/10 p-3">
                <p className="text-sm">Confirmar este atendimento na folga, pausa ou fora do expediente? A exceção vale somente para esta reserva.</p>
                <label htmlFor="edit-after-hours-reason" className="block text-xs font-medium text-muted-foreground">Motivo da exceção</label>
                <input id="edit-after-hours-reason" maxLength={200} disabled={pending} value={afterHoursReason} onChange={event => { mutationKeys.current.delete("edit"); setAfterHoursReason(event.target.value); }} className="min-h-11 w-full rounded-[10px] border border-border-strong bg-background px-3 text-sm focus:outline-none focus:ring-2 focus:ring-ring lg:min-h-10" />
                <button disabled={pending || afterHoursReason.trim().length < 3} onClick={() => saveEdit(true)} className="inline-flex min-h-11 items-center justify-center gap-1.5 rounded-[10px] border border-border-strong px-3 text-sm font-semibold text-foreground transition-colors hover:bg-card-hover focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring disabled:opacity-50 lg:min-h-9 lg:rounded-[9px]">Confirmar exceção de jornada</button>
              </div>}
              {overbook && <div className="space-y-2 rounded-xl border border-warning/40 bg-warning/10 p-3">
                <p className="text-sm font-medium">Encaixar neste horário ocupado?</p>
                <p className="text-xs text-muted-foreground">Os dois atendimentos serão mantidos. Confirme o encaixe e informe o motivo; para cliente com conta, o horário já fica reservado enquanto aguarda a resposta.</p>
                <label htmlFor="edit-overbook-reason" className="block text-xs font-medium text-muted-foreground">Motivo do encaixe</label>
                <input id="edit-overbook-reason" maxLength={200} disabled={pending} value={overbookReason} onChange={event => { mutationKeys.current.delete("edit"); setOverbookReason(event.target.value); }} className="min-h-11 w-full rounded-[10px] border border-border-strong bg-background px-3 text-sm focus:outline-none focus:ring-2 focus:ring-ring lg:min-h-10" />
                <button disabled={pending || overbookReason.trim().length < 3} onClick={() => saveEdit(false, true)} className="inline-flex min-h-11 items-center justify-center gap-1.5 rounded-[10px] border border-border-strong px-3 text-sm font-semibold text-foreground transition-colors hover:bg-card-hover focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring disabled:opacity-50 lg:min-h-9 lg:rounded-[9px]">Confirmar encaixe</button>
              </div>}
              {editReview && <section aria-label="Revisão das alterações" className="rounded-xl border border-border bg-card p-3 text-sm" hidden={!editReview}>
                <h3 className="font-semibold">Confira antes de salvar</h3>
                <p className="mt-2 text-muted-foreground">Antes: {formatInTimeZone(new Date(baseline.startAt), timezone, "dd/MM/yyyy · HH:mm")} · {baseline.serviceName} · {formatMoney(baseline.priceCents)}</p>
                <p className="mt-2">Depois: {editDate.split("-").reverse().join("/")} · {editTime} — {editEndLabel}</p>
                <p>{servicesChanged ? selectedCatalog.map(service => service?.name).join(" + ") : baseline.serviceName} · {formatMoney(previewPrice)}{servicesChanged ? " (estimativa)" : ""}</p>
                {professionalName && <p>{professionalName}</p>}
                {editNotes && <p className="mt-2 break-words">{editNotes}</p>}
              </section>}
              <div className="flex gap-2 pt-1">
                <button
                  disabled={pending || afterHours || overbook || !editEndLabel || !editServices.length || (servicesChanged && unknownService)}
                  onClick={() => { if (editReview) saveEdit(); else setEditReview(true); }}
                  className="inline-flex min-h-11 items-center justify-center gap-1.5 rounded-[10px] bg-primary px-4 text-sm font-semibold text-primary-foreground transition-colors hover:bg-primary/90 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2 disabled:opacity-50 lg:min-h-9 lg:rounded-[9px] flex-1"
                >
                  {pending ? (
                    <span className="h-3.5 w-3.5 animate-spin rounded-full border-2 border-primary-foreground border-t-transparent" />
                  ) : (
                    <Save className="h-3.5 w-3.5" />
                  )}
                  {editReview ? "Salvar alterações" : "Revisar alterações"}
                </button>
                <button
                  disabled={pending}
                  onClick={() => { setView("detail"); setError(null); }}
                  className="inline-flex min-h-11 items-center justify-center gap-1.5 rounded-[10px] border border-border-strong px-3 text-sm font-semibold text-foreground transition-colors hover:bg-card-hover focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring disabled:opacity-50 lg:min-h-9 lg:rounded-[9px] px-4"
                >
                  <X className="h-3.5 w-3.5" />
                  Cancelar
                </button>
              </div>
            </div>
          )}

          {/* ── DETAIL VIEW ──────────────────────────────────── */}
          {view === "detail" && (
            <>
              <div hidden={cancelMode}>
              {canCancel && appt.seriesId && <SeriesEditor appointmentId={appt.id} />}
              {(canCancel || !canCreate) && <CarePanel appointmentId={appt.id} timezone={timezone} writable={["IN_PROGRESS", "COMPLETED"].includes(appt.status)} />}
              <div className="space-y-2.5 text-sm">
                {professionalName && <Row icon={User} label={professionalName} />}
                <Row icon={Scissors} label={appt.serviceName} />
                {appt.stages?.filter(s => s.processingMin || s.finishingMin).map((s, i) => <div key={i} className="rounded-xl border border-border p-3 text-xs"><strong className="text-sm font-semibold">{s.name}</strong><div className="mt-2 flex gap-0.5 overflow-hidden rounded-md" aria-label="Etapas do atendimento"><span className="bg-muted p-2" style={{ flex: s.durationMin - s.processingMin - s.finishingMin }}>Execução {s.durationMin - s.processingMin - s.finishingMin} min</span>{s.processingMin > 0 && <span className="bg-muted/60 p-2 text-muted-foreground" style={{ flex: s.processingMin, backgroundImage: "repeating-linear-gradient(135deg, hsl(var(--foreground) / .06) 0 4px, transparent 4px 8px)" }}>Processamento {s.processingMin} min</span>}{s.finishingMin > 0 && <span className="bg-muted p-2 text-muted-foreground" style={{ flex: s.finishingMin }}>Finalização {s.finishingMin} min</span>}</div></div>)}
                <Row
                  icon={Clock}
                  label={`${formatInTimeZone(start, timezone, "HH:mm")} – ${formatInTimeZone(end, timezone, "HH:mm")} · ${formatInTimeZone(start, timezone, "EEEE, d MMM", { locale: ptBR })}`}
                />
                {appt.pendingReschedule && (
                  <div className="rounded-xl border border-warning/30 bg-warning/10 px-3 py-2.5 text-warning">
                    <p className="text-sm font-semibold">{appt.pendingReschedule.status === "REJECTED" ? "Cliente recusou a alteração · entre em contato" : "Aguardando aceite do cliente"}</p>
                    <p className="mt-1 text-xs leading-relaxed">
                      Novo horário: {formatInTimeZone(new Date(appt.pendingReschedule.targetStartAt), timezone, "dd/MM/yyyy 'às' HH:mm")} · {appt.pendingReschedule.targetProfessionalName}.
                    </p>
                    <p className="mt-1 text-xs">Novo valor: {formatMoney(appt.pendingReschedule.targetPriceCents)}</p>
                    {appt.pendingReschedule.reason && <p className="mt-1 text-xs">Motivo: {appt.pendingReschedule.reason}</p>}
                  </div>
                )}
                {clientPhoneHref ? (
                  <a href={clientPhoneHref} className="flex min-h-11 items-center gap-2.5 font-medium text-foreground underline-offset-4 hover:underline">
                    <Phone className="h-4 w-4 shrink-0" />
                    {appt.clientPhone} · Ligar
                  </a>
                ) : (
                  <Row icon={User} label={appt.clientPhone ? `${appt.clientPhone} · telefone inválido` : "Sem telefone"} />
                )}
                <Row
                  icon={StickyNote}
                  label={appt.notes || "Sem observações"}
                  muted={!appt.notes}
                />
                <div className="flex min-h-11 items-center justify-between rounded-xl border border-border px-3 py-2">
                  <span className="text-muted-foreground">Valor</span>
                  <span className="whitespace-nowrap font-semibold tabular-nums">{formatMoney(appt.priceCents)}</span>
                </div>
                {appt.isOverbooked && (
                  <div className="flex items-center gap-2 rounded-xl border border-danger/30 bg-danger/10 px-3 py-2 text-danger">
                    <AlertTriangle aria-hidden="true" className="h-4 w-4 shrink-0" />
                    <span className="text-xs font-medium">
                      Overbooking deliberado — registrado na trilha de auditoria.
                    </span>
                  </div>
                )}
                {appt.waitlistCount > 0 && (
                  <div className="rounded-xl border border-border p-3">
                    <p className="flex items-center gap-1.5 text-xs font-semibold uppercase tracking-[.04em] text-muted-foreground">
                      <Users aria-hidden="true" className="h-4 w-4" />
                      Fila de espera · {appt.waitlistCount}
                    </p>
                    <ol className="mt-2 space-y-2">
                      {appt.waitlist.map((entry) => {
                        const entryTel = telLink(entry.phone);
                        return (
                          <li
                            key={entry.id}
                            className="space-y-2 rounded-xl border border-border bg-card px-3 py-2.5"
                          >
                            <div className="min-w-0">
                              <p className="truncate text-sm font-semibold">
                                #{entry.position} · {entry.name}
                              </p>
                              {entry.phone && (entryTel ? (
                                <a href={entryTel} className="inline-flex min-h-11 items-center text-xs text-muted-foreground underline-offset-2 hover:underline">
                                  {entry.phone}
                                </a>
                              ) : (
                                <p className="text-xs text-muted-foreground">{entry.phone}</p>
                              ))}
                              <p className="truncate text-xs text-muted-foreground">
                                {entry.serviceName}
                              </p>
                            </div>
                            {(canCancel || entryTel) && (
                              <div className="flex flex-wrap gap-1.5">
                                {canCancel && onScheduleWaitlist && (
                                  <button
                                    type="button"
                                    disabled={pending}
                                    onClick={() => onScheduleWaitlist(entry)}
                                    className="inline-flex min-h-11 items-center justify-center gap-1.5 rounded-[10px] bg-primary px-4 text-sm font-semibold text-primary-foreground transition-colors hover:bg-primary/90 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2 disabled:opacity-50 lg:min-h-9 lg:rounded-[9px] flex-1 basis-full px-3"
                                  >
                                    <CalendarClock className="h-4 w-4" />
                                    Agendar em outro horário
                                  </button>
                                )}
                                {canCancel && appt.status === "CANCELLED" && entry.position === 1 && (
                                  <button
                                    type="button"
                                    disabled={pending}
                                    onClick={() => run(() => promoteWaitlist(appt.id, entry.id))}
                                    className="inline-flex min-h-11 items-center justify-center gap-1.5 rounded-[10px] border border-border-strong px-3 text-sm font-semibold text-foreground transition-colors hover:bg-card-hover focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring disabled:opacity-50 lg:min-h-9 lg:rounded-[9px] flex-1"
                                  >
                                    Promover
                                  </button>
                                )}
                                {entryTel && (
                                  <a
                                    href={waitlistWaLink(entry.phone, entry.name, salonName)}
                                    target="_blank"
                                    rel="noopener noreferrer"
                                    className="inline-flex min-h-11 items-center justify-center gap-1.5 rounded-[10px] border border-border-strong px-3 text-sm font-semibold text-foreground transition-colors hover:bg-card-hover focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring disabled:opacity-50 lg:min-h-9 lg:rounded-[9px] flex-1"
                                  >
                                    <MessageCircle className="h-4 w-4" />
                                    WhatsApp
                                  </a>
                                )}
                                {canCancel && (
                                  <button
                                    type="button"
                                    disabled={pending}
                                    onClick={() => {
                                      setRemoveWaitlistId(entry.id);
                                      setRemoveWaitlistReason("");
                                    }}
                                    className="inline-flex min-h-11 items-center justify-center gap-1.5 rounded-[10px] border border-border-strong px-3 text-sm font-semibold text-foreground transition-colors hover:bg-card-hover focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring disabled:opacity-50 lg:min-h-9 lg:rounded-[9px] flex-1 border-danger/40 text-danger hover:bg-danger/10"
                                    aria-label={`Remover ${entry.name} da fila`}
                                  >
                                    Remover da fila
                                  </button>
                                )}
                              </div>
                            )}
                          </li>
                        );
                      })}
                    </ol>
                    {removeWaitlistId && (
                      <div className="mt-3 rounded-xl border border-border bg-card p-3">
                        <p className="text-sm font-semibold text-foreground">
                          Remover somente esta pessoa da fila?
                        </p>
                        <p className="mt-1 text-xs text-muted-foreground">
                          O agendamento confirmado não será alterado. As demais posições serão atualizadas.
                        </p>
                        <input
                          value={removeWaitlistReason}
                          onChange={(event) => setRemoveWaitlistReason(event.target.value)}
                          placeholder="Motivo da remoção"
                          maxLength={500}
                          className="mt-2 min-h-11 w-full rounded-[10px] border border-border-strong bg-background px-3 text-sm focus:outline-none focus:ring-2 focus:ring-ring lg:min-h-10"
                        />
                        <div className="mt-2 flex gap-2">
                          <button
                            type="button"
                            onClick={() => setRemoveWaitlistId(null)}
                            className="inline-flex min-h-11 items-center justify-center gap-1.5 rounded-[10px] border border-border-strong px-3 text-sm font-semibold text-foreground transition-colors hover:bg-card-hover focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring disabled:opacity-50 lg:min-h-9 lg:rounded-[9px] flex-1"
                          >
                            Voltar
                          </button>
                          <button
                            type="button"
                            disabled={pending || removeWaitlistReason.trim().length < 3}
                            onClick={() => run(() => removeWaitlistEntry(
                              removeWaitlistId,
                              removeWaitlistReason.trim(),
                            ))}
                            className="inline-flex min-h-11 items-center justify-center gap-1.5 rounded-[10px] bg-destructive px-3 text-sm font-semibold text-destructive-foreground transition-colors hover:bg-destructive/90 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring disabled:opacity-40 lg:min-h-9 lg:rounded-[9px] flex-1"
                          >
                            Remover da fila
                          </button>
                        </div>
                      </div>
                    )}
                  </div>
                )}
                {appt.events.length > 0 && (
                  <div className="rounded-xl border border-border p-3">
                    <div className="mb-2 flex items-center justify-between">
                      <p className="flex items-center gap-1.5 text-xs font-semibold uppercase tracking-[.04em] text-muted-foreground">
                        <History aria-hidden="true" className="h-4 w-4" />
                        Histórico imutável
                      </p>
                      {appt.events.length > HISTORY_PREVIEW_COUNT && (
                        <button
                          type="button"
                          onClick={() => setHistoryExpanded((open) => !open)}
                          className="inline-flex min-h-11 items-center px-1 text-xs font-semibold text-foreground underline-offset-4 hover:underline"
                        >
                          {historyExpanded ? "Ver menos" : `Ver tudo (${appt.events.length})`}
                        </button>
                      )}
                    </div>
                    <ol className="space-y-2 border-l border-border pl-3">
                      {(historyExpanded ? appt.events : appt.events.slice(0, HISTORY_PREVIEW_COUNT)).map((event) => (
                        <li key={event.id} className="text-xs leading-relaxed">
                          <p className="font-medium">{eventTitle(event.eventType)}</p>
                          {event.eventType === "RESCHEDULED" && event.previousStartAt && event.startAt && (
                            <p className="text-muted-foreground">
                              {formatHistoryTime(event.previousStartAt, timezone)} → {formatHistoryTime(event.startAt, timezone)}
                            </p>
                          )}
                          {event.previousStatus && event.status && (
                            <p className="text-muted-foreground">
                              {statusName(event.previousStatus)} → {statusName(event.status)}
                            </p>
                          )}
                          <p className="text-muted-foreground">
                            {event.actorName ?? actorName(event.actorType)} · {formatInTimeZone(new Date(event.createdAt), timezone, "dd/MM/yyyy HH:mm")}
                          </p>
                          {event.reason && <p className="mt-0.5 text-muted-foreground">Motivo: {event.reason}</p>}
                        </li>
                      ))}
                    </ol>
                  </div>
                )}
              </div>

              {error && (
                <p role="alert" className="mt-3 rounded-xl border border-danger/30 bg-danger/10 px-3 py-2 text-sm text-danger">
                  {error}
                </p>
              )}

              {/* Status action buttons */}
              <div className="mt-4 flex flex-wrap gap-2">
                {availableActions.map((s) => {
                  const Icon = ACTION_ICON[s] ?? Check;
                  const target = STATUS[s];
                  return (
                    <button
                      key={s}
                      disabled={pending}
                      onClick={() =>
                        run(() =>
                          updateAppointmentStatus(appt.id, s as ApptStatus, {
                            idempotencyKey: mutationKey(`status:${s}`),
                            expectedVersion: appt.version,
                          }),
                        )
                      }
                      className={`inline-flex min-h-11 items-center justify-center gap-1.5 rounded-[10px] px-4 text-sm font-semibold transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring disabled:opacity-50 lg:min-h-9 lg:rounded-[9px] ${statusActionClasses(s)}`}
                    >
                      <Icon className="h-4 w-4" />
                      {ACTION_LABELS[s] ?? target.label}
                    </button>
                  );
                })}
              </div>

              {/* Utility actions */}
              <div className="mt-3 grid grid-cols-1 gap-2 border-t border-border pt-3 min-[340px]:grid-cols-2">
                {isMutable && (
                  <><button
                    onClick={openEdit}
                    className="inline-flex min-h-11 items-center justify-center gap-1.5 rounded-[10px] border border-border-strong px-3 text-sm font-semibold text-foreground transition-colors hover:bg-card-hover focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring disabled:opacity-50 lg:min-h-9 lg:rounded-[9px]"
                  >
                    <Pencil aria-hidden="true" className="h-4 w-4" />
                    Editar
                  </button><button onClick={openEdit} className="inline-flex min-h-11 items-center justify-center gap-1.5 rounded-[10px] border border-border-strong px-3 text-sm font-semibold text-foreground transition-colors hover:bg-card-hover focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring disabled:opacity-50 lg:min-h-9 lg:rounded-[9px]"><CalendarClock aria-hidden="true" className="h-4 w-4" />Reagendar</button></>
                )}
                {clientPhoneHref && <a
                  href={waLink(appt.clientPhone, appt.clientName, salonName, whenLabel)}
                  target="_blank"
                  rel="noopener noreferrer"
                  className="inline-flex min-h-11 items-center justify-center gap-1.5 rounded-[10px] border border-border-strong px-3 text-sm font-semibold text-foreground transition-colors hover:bg-card-hover focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring disabled:opacity-50 lg:min-h-9 lg:rounded-[9px]"
                >
                  <MessageCircle className="h-4 w-4" />
                  WhatsApp
                </a>}
                {telLink(appt.clientPhone) && (
                  <a
                    href={telLink(appt.clientPhone)!}
                    className="inline-flex min-h-11 items-center justify-center gap-1.5 rounded-[10px] border border-border-strong px-3 text-sm font-semibold text-foreground transition-colors hover:bg-card-hover focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring disabled:opacity-50 lg:min-h-9 lg:rounded-[9px]"
                  >
                    <Phone className="h-4 w-4" />
                    Ligar
                  </a>
                )}
                {canCreate && (
                  <button
                    disabled={pending}
                    onClick={() =>
                      run(() => duplicateAppointment(appt.id, mutationKey("duplicate")))
                    }
                    className="inline-flex min-h-11 items-center justify-center gap-1.5 rounded-[10px] border border-border-strong px-3 text-sm font-semibold text-foreground transition-colors hover:bg-card-hover focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring disabled:opacity-50 lg:min-h-9 lg:rounded-[9px]"
                    title="Criar nova visita na semana seguinte"
                  >
                    <Copy className="h-4 w-4" />
                    Repetir
                  </button>
                )}
                {canOpenComanda ? (
                  <button
                    onClick={() => { setError(null); setView("comanda"); }}
                    className="inline-flex min-h-11 items-center justify-center gap-1.5 rounded-[10px] border border-border-strong px-3 text-sm font-semibold text-foreground transition-colors hover:bg-card-hover focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring disabled:opacity-50 lg:min-h-9 lg:rounded-[9px]"
                    title={isCompletedAwaitingPayment
                      ? "Registrar o pagamento pendente"
                      : "Fechar comanda e registrar pagamento"}
                  >
                    <CreditCard className="h-4 w-4" />
                    {isCompletedAwaitingPayment ? "Registrar recebimento" : "Fechar comanda"}
                  </button>
                ) : canCreate && appt.status === "COMPLETED" && appt.hasPayment ? (
                  <button
                    onClick={() => runMutation(async () => {
                      try {
                        const receipt = await getComandaData(appt.id);
                        printReceipt(receipt, salonName, timezone);
                      } catch (receiptError) {
                        setError(receiptError instanceof Error
                          ? receiptError.message
                          : "Não foi possível carregar o recibo");
                      }
                    })}
                    className="inline-flex min-h-11 items-center justify-center gap-1.5 rounded-[10px] border border-border-strong px-3 text-sm font-semibold text-foreground transition-colors hover:bg-card-hover focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring disabled:opacity-50 lg:min-h-9 lg:rounded-[9px]"
                    title="Imprimir recibo"
                  >
                    <Receipt className="h-4 w-4" />
                    Recibo
                  </button>
                ) : null}
              </div>

              </div>
              {/* Cancel */}
              {isMutable && canCancel && (cancelMode ? (
                <div className="mt-3 space-y-2 rounded-xl border border-danger/40 bg-danger/5 p-3">
                  <h3 ref={focusOnMount} tabIndex={-1} className="text-base font-semibold focus:outline-none">Cancelar este agendamento?</h3><p className="text-sm">{appt.clientName} · {whenLabel}<br />{professionalName} · {appt.serviceName}</p>{error && <p role="alert" className="text-sm text-danger">{error}</p>}
                  <label className="block text-xs font-medium text-muted-foreground" htmlFor="cancel-reason">
                    Motivo do cancelamento (opcional)
                  </label>
                  <textarea
                    id="cancel-reason" disabled={pending}
                    value={cancelReason}
                    onChange={(event) => {
                      mutationKeys.current.delete("cancel");
                      setCancelReason(event.target.value);
                    }}
                    rows={3}
                    maxLength={500}
                    className="w-full resize-none rounded-[10px] border border-border-strong bg-background px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-ring"
                    placeholder="Opcional: fica no histórico e aparece para o cliente"
                  />
                  <p className="text-xs text-muted-foreground">
                    O registro será preservado, o horário liberado e o cliente do agendamento notificado.
                  </p>
                  {appt.waitlist[0] && (
                    <div className="space-y-1 rounded-xl border border-border bg-card px-3 py-2 text-xs text-muted-foreground">
                      <label className="flex min-h-11 items-center gap-2.5 text-sm font-medium text-foreground">
                        <input
                          type="checkbox"
                          className="h-5 w-5 shrink-0 accent-[hsl(var(--foreground))]"
                          checked={promoteOnCancel}
                          disabled={pending}
                          onChange={(event) => {
                            mutationKeys.current.delete("cancel");
                            setPromoteOnCancel(event.target.checked);
                          }}
                        />
                        Passar este horário para {appt.waitlist[0].name} (#1 da fila)
                      </label>
                      <p>
                        {promoteOnCancel
                          ? "O horário é conferido para a fila antes de cancelar. Se não servir, nada é cancelado."
                          : "Sem marcar esta opção, a fila continua e ninguém entra no horário sozinho."}
                      </p>
                    </div>
                  )}
                  <div className="flex gap-2">
                    <button
                      type="button"
                      disabled={pending} onClick={() => { setCancelMode(false); setCancelReason(""); setPromoteOnCancel(false); }}
                      className="inline-flex min-h-11 items-center justify-center gap-1.5 rounded-[10px] border border-border-strong px-3 text-sm font-semibold text-foreground transition-colors hover:bg-card-hover focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring disabled:opacity-50 lg:min-h-9 lg:rounded-[9px] flex-1"
                    >
                      Voltar
                    </button>
                    <button
                      type="button"
                      disabled={pending}
                      onClick={() =>
                        run(() =>
                          promoteOnCancel && appt.waitlist[0]
                            ? cancelAndPromoteWaitlist({
                                appointmentId: appt.id,
                                entryId: appt.waitlist[0].id,
                                reason: cancelReason.trim(),
                                idempotencyKey: mutationKey("cancel"),
                                expectedVersion: appt.version,
                              })
                            : cancelAppointment(
                                appt.id,
                                cancelReason.trim() || undefined,
                                mutationKey("cancel"),
                                appt.version,
                              ),
                        )
                      }
                      className="inline-flex min-h-11 items-center justify-center gap-1.5 rounded-[10px] bg-destructive px-3 text-sm font-semibold text-destructive-foreground transition-colors hover:bg-destructive/90 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring disabled:opacity-40 lg:min-h-9 lg:rounded-[9px] flex-1"
                    >
                      {promoteOnCancel && appt.waitlist[0] ? "Cancelar e passar o horário" : "Confirmar cancelamento"}
                    </button>
                  </div>
                </div>
              ) : (
                <button
                  disabled={pending}
                  onClick={() => setCancelMode(true)}
                  title={
                    appt.waitlistCount > 0
                      ? "Ao cancelar, você pode passar o horário para a primeira pessoa da fila"
                      : undefined
                  }
                  className="inline-flex min-h-11 items-center justify-center gap-1.5 rounded-[10px] border border-border-strong px-3 text-sm font-semibold text-foreground transition-colors hover:bg-card-hover focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring disabled:opacity-50 lg:min-h-9 lg:rounded-[9px] mt-2 w-full border-danger/40 bg-danger/10 text-danger hover:bg-danger/15"
                >
                  <Ban className="h-4 w-4" />
                  Cancelar agendamento
                </button>
              ))}
            </>
          )}
        </div>
      </DialogContent>
    </Dialog>
  );
}

function eventTitle(eventType: string): string {
  return {
    CREATED: "Agendamento criado",
    RESCHEDULE_ACCEPTED: "Cliente aceitou a alteração",
    RESCHEDULED: "Agendamento remarcado",
    RESCHEDULE_REQUESTED: "Alteração aguardando aceite",
    RESCHEDULE_REJECTED: "Cliente recusou a alteração",
    STATUS_CHANGED: "Status atualizado",
    CANCELLED: "Agendamento cancelado",
    WAITLIST_FULFILLED: "Vaga preenchida pela lista de espera",
    REMINDER_MARKED: "Lembrete registrado",
  }[eventType] ?? "Agendamento atualizado";
}

function actorName(actorType: string): string {
  return {
    CLIENT: "Cliente",
    STAFF: "Equipe",
    SYSTEM: "Sistema",
    GUEST: "Visitante",
  }[actorType] ?? "Sistema";
}

function statusName(status: string): string {
  return STATUS[status as keyof typeof STATUS]?.label ?? status;
}

function formatHistoryTime(value: string, timezone: string): string {
  return formatInTimeZone(new Date(value), timezone, "dd/MM/yyyy HH:mm");
}

function Row({
  icon: Icon,
  label,
  muted,
}: {
  icon: typeof Clock;
  label: string;
  muted?: boolean;
}) {
  return (
    <div className="flex items-center gap-2.5">
      <Icon className="h-4 w-4 shrink-0 text-muted-foreground" />
      <span className={muted ? "text-muted-foreground" : ""}>{label}</span>
    </div>
  );
}
