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
} from "lucide-react";
import { formatMoney } from "@/lib/utils";
import { format } from "date-fns";
import { ptBR } from "date-fns/locale";
import { updateAppointmentStatus, cancelAppointment, duplicateAppointment } from "./actions";
import { STATUS, nextActions, type ApptStatus } from "./agenda-status";
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

/** Abre uma janela só com o recibo e dispara a impressão (sem lib externa). */
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

  if (!appt) return null;

  const start = new Date(appt.startAt);
  const end = new Date(appt.endAt);
  const cfg = STATUS[appt.status as keyof typeof STATUS] ?? STATUS.CONFIRMED;
  const whenLabel = `${format(start, "d 'de' MMMM 'às' HH:mm", { locale: ptBR })}`;

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

  return (
    <Dialog open={!!appt} onOpenChange={(o) => !o && onClose()}>
      <DialogContent className="max-w-md gap-0 overflow-hidden p-0">
        {/* Faixa da cor do status */}
        <div className="h-1.5 w-full" style={{ background: cfg.color }} />

        <div className="p-5">
          <DialogHeader className="mb-4 flex-row items-center justify-between space-y-0">
            <DialogTitle className="text-lg">{appt.clientName}</DialogTitle>
            <span
              className="rounded-full px-2.5 py-1 text-[11px] font-semibold"
              style={{ background: `${cfg.color}22`, color: cfg.color }}
            >
              {cfg.label}
            </span>
          </DialogHeader>

          <div className="space-y-2.5 text-sm">
            <Row icon={Scissors} label={appt.serviceName} />
            <Row
              icon={Clock}
              label={`${format(start, "HH:mm")} – ${format(end, "HH:mm")} · ${format(start, "EEEE, d MMM", { locale: ptBR })}`}
            />
            <Row icon={User} label={appt.clientPhone ?? "Sem telefone"} />
            <Row icon={StickyNote} label={appt.notes || "Sem observações"} muted={!appt.notes} />
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

          {/* Ações rápidas de status */}
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

          {/* Utilidades: WhatsApp, duplicar, recibo */}
          <div className="mt-3 grid grid-cols-3 gap-2 border-t border-border pt-3">
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
            >
              <Copy className="h-4 w-4" />
              Duplicar
            </button>
            <button
              onClick={() => printReceipt(appt, salonName)}
              className="inline-flex items-center justify-center gap-1.5 rounded-lg border border-border px-3 py-2 text-[13px] font-medium text-muted-foreground transition hover:text-foreground"
            >
              <Receipt className="h-4 w-4" />
              Recibo
            </button>
          </div>

          {/* Cancelar */}
          <button
            disabled={pending}
            onClick={() => run(() => cancelAppointment(appt.id))}
            className="mt-2 inline-flex w-full items-center justify-center gap-1.5 rounded-lg border border-border px-3 py-2 text-[13px] font-medium text-muted-foreground transition hover:border-danger/50 hover:text-danger disabled:opacity-50"
          >
            <Ban className="h-4 w-4" />
            Cancelar agendamento
          </button>
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
