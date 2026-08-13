"use client";

import { useRef, useState, useTransition } from "react";
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
} from "lucide-react";
import { formatMoney } from "@/lib/utils";
import { ptBR } from "date-fns/locale";
import { formatInTimeZone } from "date-fns-tz";
import {
  updateAppointmentStatus,
  cancelAppointment,
  duplicateAppointment,
  editAppointment,
  getComandaData,
  removeWaitlistEntry,
} from "./actions";
import {
  STATUS,
  canOpenAppointmentCheckout,
  nextActions,
  type ApptStatus,
} from "./agenda-status";
import { ComandaPanel } from "./comanda-panel";
import type { Appointment } from "./agenda-board";

const ACTION_ICON: Record<string, typeof Check> = {
  CONFIRMED: Check,
  IN_PROGRESS: Play,
  COMPLETED: CircleCheck,
  NO_SHOW: UserX,
};

function waLink(phone: string | null, clientName: string, salonName: string, when: string) {
  const digits = (phone ?? "").replace(/\D/g, "");
  const full = digits.length <= 11 ? `55${digits}` : digits;
  const msg = `Olá ${clientName.split(" ")[0]}! Passando para confirmar seu horário em ${salonName} ${when}. Podemos confirmar? 💈`;
  return `https://wa.me/${full}?text=${encodeURIComponent(msg)}`;
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
    `<div class="row"><span>${escapeHtml(service.serviceName)}</span><b>${escapeHtml(formatMoney(service.priceCents))}</b></div>`,
  ).join("");
  const productRows = receipt.products.map((product) =>
    `<div class="row"><span>${product.quantity}× ${escapeHtml(product.product.name)}</span><b>${escapeHtml(formatMoney(product.quantity * product.priceCentsUnit))}</b></div>`,
  ).join("");
  const discountRow = receipt.payment.discountCents > 0
    ? `<div class="row"><span>Desconto</span><b>- ${escapeHtml(formatMoney(receipt.payment.discountCents))}</b></div>`
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
    <div class="total"><span>Total recebido</span><span>${escapeHtml(formatMoney(receipt.payment.amountCents))}</span></div>
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
  timezone,
  canCreate,
  canCancel,
  onClose,
}: {
  appt: Appointment | null;
  salonName: string;
  timezone: string;
  canCreate: boolean;
  canCancel: boolean;
  onClose: () => void;
}) {
  const [pending, startTransition] = useTransition();
  const [error, setError] = useState<string | null>(null);
  const [view, setView] = useState<ViewMode>("detail");
  const [cancelMode, setCancelMode] = useState(false);
  const [cancelReason, setCancelReason] = useState("");
  const [removeWaitlistId, setRemoveWaitlistId] = useState<string | null>(null);
  const [removeWaitlistReason, setRemoveWaitlistReason] = useState("");
  const mutationKeys = useRef(new Map<string, string>());

  const start = appt ? new Date(appt.startAt) : new Date();
  const end = appt ? new Date(appt.endAt) : new Date();
  const [editDate, setEditDate] = useState(() => formatInTimeZone(start, timezone, "yyyy-MM-dd"));
  const [editTime, setEditTime] = useState(() => formatInTimeZone(start, timezone, "HH:mm"));
  const [editNotes, setEditNotes] = useState(appt?.notes ?? "");

  if (!appt) return null;

  const cfg = STATUS[appt.status as keyof typeof STATUS] ?? STATUS.CONFIRMED;
  const whenLabel = formatInTimeZone(start, timezone, "d 'de' MMMM 'às' HH:mm", { locale: ptBR });

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
    startTransition(async () => {
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

  function openEdit() {
    if (!appt) return;
    setEditDate(formatInTimeZone(start, timezone, "yyyy-MM-dd"));
    setEditTime(formatInTimeZone(start, timezone, "HH:mm"));
    setEditNotes(appt.notes ?? "");
    setError(null);
    setView("edit");
  }

  function saveEdit() {
    if (!appt) return;
    setError(null);
    startTransition(async () => {
      const result = await editAppointment({
        id: appt.id,
        professionalId: appt.professionalId,
        serviceIds: appt.serviceIds,
        startLocal: `${editDate}T${editTime}`,
        notes: editNotes || null,
        idempotencyKey: mutationKey("edit"),
        expectedVersion: appt.version,
      });
      if ("error" in result) {
        setError(result.error);
      } else {
        onClose();
      }
    });
  }

  return (
    <Dialog open={!!appt} onOpenChange={(o) => !o && onClose()}>
      <DialogContent className="max-h-[calc(100dvh-1rem)] max-w-md gap-0 overflow-y-auto overscroll-contain p-0 pb-[env(safe-area-inset-bottom)]">
        <div className="h-1.5 w-full" style={{ background: cfg.color }} />

        <div className="p-5">
          <DialogHeader className="mb-4 flex-row items-center justify-between space-y-0">
            <div className="flex items-center gap-2">
              {view !== "detail" && (
                <button
                  onClick={() => { setView("detail"); setError(null); }}
                  className="text-muted-foreground hover:text-foreground"
                >
                  <ArrowLeft className="h-4 w-4" />
                </button>
              )}
              <DialogTitle className="text-lg">
                {view === "comanda"
                  ? isCompletedAwaitingPayment ? "Registrar recebimento" : "Fechar comanda"
                  : appt.clientName}
              </DialogTitle>
            </div>
            <span
              className="rounded-full px-2.5 py-1 text-[11px] font-semibold"
              style={{ background: `${cfg.color}22`, color: cfg.color }}
            >
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
          {view === "edit" && (
            <div className="space-y-3">
              <p className="text-[12px] font-medium text-muted-foreground">
                Editando agendamento de{" "}
                <span className="font-semibold text-foreground">{appt.clientName}</span>
              </p>

              <div className="grid grid-cols-2 gap-2">
                <div>
                  <label className="mb-1 block text-[11px] font-medium text-muted-foreground">
                    Data
                  </label>
                  <input
                    type="date"
                    value={editDate}
                    onChange={(e) => {
                      mutationKeys.current.delete("edit");
                      setEditDate(e.target.value);
                    }}
                    className="w-full rounded-lg border border-border bg-surface-1 px-3 py-2 text-[13px] focus:outline-none focus:ring-1 focus:ring-primary"
                  />
                </div>
                <div>
                  <label className="mb-1 block text-[11px] font-medium text-muted-foreground">
                    Horário
                  </label>
                  <input
                    type="time"
                    value={editTime}
                    onChange={(e) => {
                      mutationKeys.current.delete("edit");
                      setEditTime(e.target.value);
                    }}
                    className="w-full rounded-lg border border-border bg-surface-1 px-3 py-2 text-[13px] focus:outline-none focus:ring-1 focus:ring-primary"
                  />
                </div>
              </div>

              <div>
                <label className="mb-1 block text-[11px] font-medium text-muted-foreground">
                  Observações
                </label>
                <textarea
                  value={editNotes}
                  onChange={(e) => {
                    mutationKeys.current.delete("edit");
                    setEditNotes(e.target.value);
                  }}
                  rows={3}
                  placeholder="Preferências, alergias, observações…"
                  className="w-full resize-none rounded-lg border border-border bg-surface-1 px-3 py-2 text-[13px] placeholder:text-muted-foreground focus:outline-none focus:ring-1 focus:ring-primary"
                />
              </div>

              {error && (
                <p className="rounded-lg bg-danger/10 px-3 py-2 text-[13px] text-danger">
                  {error}
                </p>
              )}

              <div className="flex gap-2 pt-1">
                <button
                  disabled={pending}
                  onClick={saveEdit}
                  className="inline-flex flex-1 items-center justify-center gap-1.5 rounded-lg bg-primary px-4 py-2.5 text-[13px] font-medium text-primary-foreground transition hover:bg-primary/90 disabled:opacity-50"
                >
                  {pending ? (
                    <span className="h-3.5 w-3.5 animate-spin rounded-full border-2 border-primary-foreground border-t-transparent" />
                  ) : (
                    <Save className="h-3.5 w-3.5" />
                  )}
                  Salvar alterações
                </button>
                <button
                  onClick={() => { setView("detail"); setError(null); }}
                  className="inline-flex items-center justify-center gap-1.5 rounded-lg border border-border px-4 py-2.5 text-[13px] text-muted-foreground transition hover:text-foreground"
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
              <div className="space-y-2.5 text-sm">
                <Row icon={Scissors} label={appt.serviceName} />
                <Row
                  icon={Clock}
                  label={`${formatInTimeZone(start, timezone, "HH:mm")} – ${formatInTimeZone(end, timezone, "HH:mm")} · ${formatInTimeZone(start, timezone, "EEEE, d MMM", { locale: ptBR })}`}
                />
                <Row icon={User} label={appt.clientPhone ?? "Sem telefone"} />
                <Row
                  icon={StickyNote}
                  label={appt.notes || "Sem observações"}
                  muted={!appt.notes}
                />
                <div className="flex items-center justify-between rounded-lg bg-surface-1 px-3 py-2">
                  <span className="text-muted-foreground">Valor</span>
                  <span className="font-semibold">{formatMoney(appt.priceCents)}</span>
                </div>
                {appt.isOverbooked && (
                  <div className="flex items-center gap-1.5 rounded-lg bg-danger/10 px-3 py-2 text-danger">
                    <AlertTriangle className="h-4 w-4" />
                    <span className="text-[12px] font-medium">
                      Overbooking deliberado — registrado na trilha de auditoria.
                    </span>
                  </div>
                )}
                {appt.waitlistCount > 0 && (
                  <div className="rounded-lg border border-amber-500/20 bg-amber-500/10 p-3 text-amber-700 dark:text-amber-400">
                    <p className="flex items-center gap-1.5 font-semibold">
                      <Users className="h-4 w-4" />
                      Fila de espera · {appt.waitlistCount}
                    </p>
                    <ol className="mt-2 space-y-2">
                      {appt.waitlist.map((entry) => (
                        <li
                          key={entry.id}
                          className="flex min-h-11 items-center justify-between gap-3 rounded-lg bg-background/70 px-3 py-2"
                        >
                          <div className="min-w-0">
                            <p className="truncate text-[12px] font-semibold">
                              #{entry.position} · {entry.name}
                            </p>
                            {entry.phone && (
                              <p className="text-[11px] text-muted-foreground">{entry.phone}</p>
                            )}
                            <p className="truncate text-[11px] text-muted-foreground">
                              {entry.serviceName}
                            </p>
                          </div>
                          {canCancel && (
                            <button
                              type="button"
                              disabled={pending}
                              onClick={() => {
                                setRemoveWaitlistId(entry.id);
                                setRemoveWaitlistReason("");
                              }}
                              className="min-h-11 shrink-0 rounded-lg px-3 text-[11px] font-medium text-danger hover:bg-danger/10 disabled:opacity-50"
                              aria-label={`Remover ${entry.name} da fila`}
                            >
                              Remover da fila
                            </button>
                          )}
                        </li>
                      ))}
                    </ol>
                    {removeWaitlistId && (
                      <div className="mt-3 rounded-lg border border-border bg-background p-3">
                        <p className="text-[12px] font-semibold text-foreground">
                          Remover somente esta pessoa da fila?
                        </p>
                        <p className="mt-1 text-[11px] text-muted-foreground">
                          O agendamento confirmado não será alterado. As demais posições serão atualizadas.
                        </p>
                        <input
                          value={removeWaitlistReason}
                          onChange={(event) => setRemoveWaitlistReason(event.target.value)}
                          placeholder="Motivo da remoção"
                          maxLength={500}
                          className="mt-2 min-h-11 w-full rounded-lg border border-border bg-background px-3 text-xs text-foreground"
                        />
                        <div className="mt-2 flex gap-2">
                          <button
                            type="button"
                            onClick={() => setRemoveWaitlistId(null)}
                            className="min-h-11 flex-1 rounded-lg border border-border px-3 text-xs text-foreground"
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
                            className="min-h-11 flex-1 rounded-lg bg-danger px-3 text-xs font-semibold text-white disabled:opacity-40"
                          >
                            Remover da fila
                          </button>
                        </div>
                      </div>
                    )}
                  </div>
                )}
                {appt.events.length > 0 && (
                  <div className="rounded-lg border border-border bg-surface-1 p-3">
                    <p className="mb-2 flex items-center gap-1.5 text-[12px] font-semibold">
                      <History className="h-4 w-4 text-muted-foreground" />
                      Histórico imutável
                    </p>
                    <ol className="space-y-2 border-l border-border pl-3">
                      {appt.events.map((event) => (
                        <li key={event.id} className="text-[11px] leading-relaxed">
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
                <p className="mt-3 rounded-lg bg-danger/10 px-3 py-2 text-[13px] text-danger">
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
                      className="inline-flex min-h-11 items-center gap-1.5 rounded-lg px-3 py-2 text-[13px] font-medium text-white transition hover:opacity-90 disabled:opacity-50"
                      style={{ background: target.color }}
                    >
                      <Icon className="h-4 w-4" />
                      {target.label}
                    </button>
                  );
                })}
              </div>

              {/* Utility actions */}
              <div className="mt-3 grid grid-cols-2 gap-2 border-t border-border pt-3">
                {isMutable && (
                  <button
                    onClick={openEdit}
                    className="inline-flex min-h-11 items-center justify-center gap-1.5 rounded-lg bg-primary/10 px-3 py-2 text-[13px] font-medium text-primary transition hover:bg-primary/20"
                  >
                    <Pencil className="h-4 w-4" />
                    Editar
                  </button>
                )}
                <a
                  href={waLink(appt.clientPhone, appt.clientName, salonName, whenLabel)}
                  target="_blank"
                  rel="noopener noreferrer"
                  className="inline-flex items-center justify-center gap-1.5 rounded-lg bg-[#25D366]/15 px-3 py-2 text-[13px] font-medium text-[#25D366] transition hover:bg-[#25D366]/25"
                >
                  <MessageCircle className="h-4 w-4" />
                  WhatsApp
                </a>
                {canCreate && (
                  <button
                    disabled={pending}
                    onClick={() =>
                      run(() => duplicateAppointment(appt.id, mutationKey("duplicate")))
                    }
                    className="inline-flex min-h-11 items-center justify-center gap-1.5 rounded-lg border border-border px-3 py-2 text-[13px] font-medium text-muted-foreground transition hover:text-foreground disabled:opacity-50"
                    title="Criar nova visita na semana seguinte"
                  >
                    <Copy className="h-4 w-4" />
                    Repetir
                  </button>
                )}
                {canOpenComanda ? (
                  <button
                    onClick={() => { setError(null); setView("comanda"); }}
                    className="inline-flex items-center justify-center gap-1.5 rounded-lg border border-border px-3 py-2 text-[13px] font-medium text-muted-foreground transition hover:border-primary/40 hover:text-primary"
                    title={isCompletedAwaitingPayment
                      ? "Registrar o pagamento pendente"
                      : "Fechar comanda e registrar pagamento"}
                  >
                    <CreditCard className="h-4 w-4" />
                    {isCompletedAwaitingPayment ? "Registrar recebimento" : "Fechar comanda"}
                  </button>
                ) : canCreate && appt.status === "COMPLETED" && appt.hasPayment ? (
                  <button
                    onClick={() => startTransition(async () => {
                      try {
                        const receipt = await getComandaData(appt.id);
                        printReceipt(receipt, salonName, timezone);
                      } catch (receiptError) {
                        setError(receiptError instanceof Error
                          ? receiptError.message
                          : "Não foi possível carregar o recibo");
                      }
                    })}
                    className="inline-flex items-center justify-center gap-1.5 rounded-lg border border-border px-3 py-2 text-[13px] font-medium text-muted-foreground transition hover:text-foreground"
                    title="Imprimir recibo"
                  >
                    <Receipt className="h-4 w-4" />
                    Recibo
                  </button>
                ) : null}
              </div>

              {/* Cancel */}
              {isMutable && canCancel && (cancelMode ? (
                <div className="mt-3 space-y-2 rounded-lg border border-danger/40 bg-danger/5 p-3">
                  <label className="block text-[12px] font-medium text-danger" htmlFor="cancel-reason">
                    Motivo do cancelamento
                  </label>
                  <textarea
                    id="cancel-reason"
                    value={cancelReason}
                    onChange={(event) => {
                      mutationKeys.current.delete("cancel");
                      setCancelReason(event.target.value);
                    }}
                    rows={3}
                    maxLength={500}
                    autoFocus
                    className="w-full resize-none rounded-lg border border-border bg-background px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-ring"
                    placeholder="Explique o motivo para o histórico e para o cliente"
                  />
                  <p className="text-[11px] text-muted-foreground">
                    O registro será preservado, o horário liberado e o cliente do agendamento notificado.
                  </p>
                  {appt.waitlistCount > 0 && (
                    <p className="rounded-lg border border-amber-500/30 bg-amber-500/10 px-3 py-2 text-[12px] font-medium text-amber-700 dark:text-amber-400">
                      Este cancelamento não promove ninguém. As {appt.waitlistCount} entrada(s)
                      serão encerradas e deixarão de aparecer como fila ativa.
                    </p>
                  )}
                  <div className="flex gap-2">
                    <button
                      type="button"
                      onClick={() => { setCancelMode(false); setCancelReason(""); }}
                      className="min-h-11 flex-1 rounded-lg border border-border px-3 text-sm"
                    >
                      Voltar
                    </button>
                    <button
                      type="button"
                      disabled={pending || cancelReason.trim().length < 3}
                      onClick={() =>
                        run(() =>
                          cancelAppointment(
                            appt.id,
                            cancelReason.trim(),
                            mutationKey("cancel"),
                            appt.version,
                          ),
                        )
                      }
                      className="min-h-11 flex-1 rounded-lg bg-danger px-3 text-sm font-medium text-white disabled:opacity-40"
                    >
                      Confirmar cancelamento
                    </button>
                  </div>
                </div>
              ) : (
                <button
                  disabled={pending}
                  onClick={() => setCancelMode(true)}
                  title={
                    appt.waitlistCount > 0
                      ? "Ao cancelar pelo estabelecimento, a fila será encerrada sem promoção automática"
                      : undefined
                  }
                  className="mt-2 inline-flex min-h-11 w-full items-center justify-center gap-1.5 rounded-lg border border-border px-3 py-2 text-[13px] font-medium text-muted-foreground transition hover:border-danger/50 hover:text-danger disabled:opacity-50"
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
    RESCHEDULED: "Agendamento remarcado",
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
