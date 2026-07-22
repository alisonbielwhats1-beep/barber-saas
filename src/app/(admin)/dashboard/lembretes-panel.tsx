"use client";

import { useState, useTransition } from "react";
import { MessageCircle, CheckCircle2 } from "lucide-react";
import { format } from "date-fns";
import { ptBR } from "date-fns/locale";
import { markReminderSent } from "@/app/(admin)/agenda/actions";

type Reminder = {
  id: string;
  startAt: string;
  clientName: string;
  clientPhone: string | null;
  serviceName: string;
  proName: string;
  salonName: string;
};

function waLink(phone: string | null, clientName: string, salonName: string, when: string) {
  const digits = (phone ?? "").replace(/\D/g, "");
  const full = digits.length <= 11 ? `55${digits}` : digits;
  const msg = `Olá ${clientName.split(" ")[0]}! Seu horário amanhã em ${salonName}: ${when}. Até lá! 💈`;
  return `https://wa.me/${full}?text=${encodeURIComponent(msg)}`;
}

export function LembretesPanel({
  reminders: initial,
  salonName,
}: {
  reminders: Reminder[];
  salonName: string;
}) {
  const [list, setList] = useState(initial);
  const [pending, startTransition] = useTransition();

  function send(id: string, phone: string | null, name: string, when: string) {
    window.open(waLink(phone, name, salonName, when), "_blank", "noopener");
    startTransition(async () => {
      try {
        await markReminderSent(id);
        setList((prev) => prev.filter((r) => r.id !== id));
      } catch {}
    });
  }

  if (list.length === 0)
    return (
      <div className="flex items-center gap-2 rounded-xl bg-surface-1 px-4 py-3 text-[13px] text-muted-foreground">
        <CheckCircle2 className="h-4 w-4 text-primary" />
        Todos os clientes de amanhã foram lembrados.
      </div>
    );

  return (
    <div className="space-y-1">
      {list.map((r) => {
        const when = format(new Date(r.startAt), "HH:mm", { locale: ptBR });
        return (
          <div
            key={r.id}
            className="flex items-center gap-3 rounded-xl px-2 py-2.5 transition-colors hover:bg-card-hover"
          >
            <span className="w-12 shrink-0 text-[14px] font-semibold tabular-nums text-foreground">
              {when}
            </span>
            <div className="min-w-0 flex-1">
              <p className="truncate text-[13px] font-medium">{r.clientName}</p>
              <p className="truncate text-[12px] text-muted-foreground">
                {r.serviceName} · {r.proName}
              </p>
            </div>
            <button
              disabled={pending}
              onClick={() => send(r.id, r.clientPhone, r.clientName, when)}
              className="inline-flex shrink-0 items-center gap-1.5 rounded-lg bg-[#25D366]/15 px-3 py-1.5 text-[12px] font-medium text-[#25D366] transition hover:bg-[#25D366]/25 disabled:opacity-50"
            >
              <MessageCircle className="h-3.5 w-3.5" />
              Enviar
            </button>
          </div>
        );
      })}
    </div>
  );
}

