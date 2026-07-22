"use client";

import { useState, useTransition } from "react";
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
} from "lucide-react";
import { formatMoney } from "@/lib/utils";
import { format } from "date-fns";
import { ptBR } from "date-fns/locale";
import {
  updateAppointmentStatus,
  cancelAppointment,
  duplicateAppointment,
  editAppointment,
} from "./actions";
import { STATUS, nextActions, type ApptStatus } from "./agenda-status";
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

function printReceipt(
  appt: { clientName: string; serviceName: string; priceCents: number; startAt: string },
  salonName: string,
) {
  const when = format(new Date(appt.startAt), "d 'de' MMMM 'de' yyyy 'às' HH:mm", { locale: ptBR });
  const price = formatMoney(appt.priceCents);
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
    <h1>${salonName}</h1>
    <p class="muted">Recibo de atendimento</p>
    <div style="height:16px"></div>
    <div class="row"><span>Cliente</span><b>${appt.clientName}</b></div>
    <div class="row"><span>Serviço</span><b>${appt.serviceName}</b></div>
    <div class="row"><span>Data</span><b>${when}</b></div>
    <div class="total"><span>Total</span><span>${price}</span></div>
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
  onClose,
}: {
  appt: Appointment | null;
  salonName: string;
  onClose: () => void;
}) {
  const [pending, startTransition] = useTransition();
  const [error, setError] = useState<string | null>(null);
  const [view, setView] = useState<ViewMode>("detail");

  const start = appt ? new Date(appt.startAt) : new Date();
  const end = appt ? new Date(appt.endAt) : new Date();
  const [editDate, setEditDate] = useState(() => format(start, "yyyy-MM-dd"));
  const [editTime, setEditTime] = useState(() => format(start, "HH:mm"));
  const [editNotes, setEditNotes] = useState(appt?.notes ?? "");

  if (!appt) return null;

  const cfg = STATUS[appt.status as keyof typeof STATUS] ?? STATUS.CONFIRMED;
  const whenLabel = `${format(start, "d 'de' MMMM 'às' HH:mm", { locale: ptBR })}`;

  const canOpenComanda =
    appt.status === "CONFIRMED" ||
    appt.status === "IN_PROGRESS" ||
    appt.status === "PENDING";

  function run(fn: () => Promise<void>) {
    setError(null);
    startTransition(async () => {
      try {
        await fn();
        onClose();
      } catch (e) {
        setError(e instanceof Error ? e.message : "Erro");
      }
    });
  }

  function openEdit() {
    if (!appt) return;
    setEditDate(format(start, "yyyy-MM-dd"));
    setEditTime(format(start, "HH:mm"));
    setEditNotes(appt.notes ?? "");
    setError(null);
    setView("edit");
  }

  function saveEdit() {
    if (!appt) return;
    const startAt = new Date(`${editDate}T${editTime}:00`).toISOString();
    run(() => editAppointment({ id: appt.id, startAt, notes: editNotes || null }));
  }

  return (
    <Dialog open={!!appt} onOpenChange={(o) => !o && onClose()}>
      <DialogContent className="max-w-md gap-0 overflow-hidden p-0">
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
                {view === "comanda" ? "Fechar comanda" : appt.clientName}
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
                    onChange={(e) => setEditDate(e.target.value)}
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
                    onChange={(e) => setEditTime(e.target.value)}
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
                  onChange={(e) => setEditNotes(e.target.value)}
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
                  label={`${format(start, "HH:mm")} – ${format(end, "HH:mm")} · ${format(start, "EEEE, d MMM", { locale: ptBR })}`}
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
              </div>

              {error && (
                <p className="mt-3 rounded-lg bg-danger/10 px-3 py-2 text-[13px] text-danger">
                  {error}
                </p>
              )}

              {/* Status action buttons */}
              <div className="mt-4 flex flex-wrap gap-2">
                {nextActions(appt.status).map((s) => {
                  const Icon = ACTION_ICON[s] ?? Check;
                  const target = STATUS[s];
                  return (
                    <button
                      key={s}
                      disabled={pending}
                      onClick={() => run(() => updateAppointmentStatus(appt.id, s as ApptStatus))}
                      className="inline-flex items-center gap-1.5 rounded-lg px-3 py-2 text-[13px] font-medium text-white transition hover:opacity-90 disabled:opacity-50"
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
                <button
                  onClick={openEdit}
                  className="inline-flex items-center justify-center gap-1.5 rounded-lg bg-primary/10 px-3 py-2 text-[13px] font-medium text-primary transition hover:bg-primary/20"
                >
                  <Pencil className="h-4 w-4" />
                  Editar
                </button>
                <a
                  href={waLink(appt.clientPhone, appt.clientName, salonName, whenLabel)}
                  target="_blank"
                  rel="noopener noreferrer"
                  className="inline-flex items-center justify-center gap-1.5 rounded-lg bg-[#25D366]/15 px-3 py-2 text-[13px] font-medium text-[#25D366] transition hover:bg-[#25D366]/25"
                >
                  <MessageCircle className="h-4 w-4" />
                  WhatsApp
                </a>
                <button
                  disabled={pending}
                  onClick={() => run(() => duplicateAppointment(appt.id))}
                  className="inline-flex items-center justify-center gap-1.5 rounded-lg border border-border px-3 py-2 text-[13px] font-medium text-muted-foreground transition hover:text-foreground disabled:opacity-50"
                  title="Reagendar para a semana seguinte no mesmo horário"
                >
                  <Copy className="h-4 w-4" />
                  Repetir
                </button>
                {canOpenComanda ? (
                  <button
                    onClick={() => { setError(null); setView("comanda"); }}
                    className="inline-flex items-center justify-center gap-1.5 rounded-lg border border-border px-3 py-2 text-[13px] font-medium text-muted-foreground transition hover:border-primary/40 hover:text-primary"
                    title="Fechar comanda e registrar pagamento"
                  >
                    <CreditCard className="h-4 w-4" />
                    Fechar comanda
                  </button>
                ) : (
                  <button
                    onClick={() => printReceipt(appt, salonName)}
                    className="inline-flex items-center justify-center gap-1.5 rounded-lg border border-border px-3 py-2 text-[13px] font-medium text-muted-foreground transition hover:text-foreground"
                    title="Imprimir recibo"
                  >
                    <Receipt className="h-4 w-4" />
                    Recibo
                  </button>
                )}
              </div>

              {/* Cancel */}
              <button
                disabled={pending}
                onClick={() => run(() => cancelAppointment(appt.id))}
                className="mt-2 inline-flex w-full items-center justify-center gap-1.5 rounded-lg border border-border px-3 py-2 text-[13px] font-medium text-muted-foreground transition hover:border-danger/50 hover:text-danger disabled:opacity-50"
              >
                <Ban className="h-4 w-4" />
                Cancelar agendamento
              </button>
            </>
          )}
        </div>
      </DialogContent>
    </Dialog>
  );
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
