"use client";

import { useState, useTransition } from "react";
import { MessageCircle, CheckCircle2 } from "lucide-react";
import { ptBR } from "date-fns/locale";
import { formatInTimeZone } from "date-fns-tz";
import { markReminderSent } from "@/app/(admin)/agenda/actions";
import { Button } from "@/components/ui/button";
import { cn } from "@/lib/utils";

type Reminder = {
  id: string;
  startAt: string;
  clientName: string;
  clientPhone: string | null;
  serviceName: string;
  proName: string;
  salonName: string;
};

/** No celular a lista mostra os 4 primeiros e um botão para ver o restante. */
const MOBILE_VISIBLE = 4;

function waLink(phone: string | null, clientName: string, salonName: string, when: string) {
  const digits = (phone ?? "").replace(/\D/g, "");
  const full = digits.length <= 11 ? `55${digits}` : digits;
  const msg = `Olá ${clientName.split(" ")[0]}! Seu horário amanhã em ${salonName}: ${when}. Até lá! 💈`;
  return `https://wa.me/${full}?text=${encodeURIComponent(msg)}`;
}

export function LembretesPanel({
  reminders: initial,
  salonName,
  timezone,
}: {
  reminders: Reminder[];
  salonName: string;
  timezone: string;
}) {
  const [list, setList] = useState(initial);
  const [pending, startTransition] = useTransition();
  const [opened, setOpened] = useState<string[]>([]);
  const [error, setError] = useState("");
  const [showAll, setShowAll] = useState(false);

  function send(id: string, phone: string | null, name: string, when: string) {
    window.open(waLink(phone, name, salonName, when), "_blank", "noopener");
    setOpened(previous => [...previous, id]);
  }
  function confirmSent(id: string) {
    startTransition(async () => {
      try {
        await markReminderSent(id);
        setList((prev) => prev.filter((r) => r.id !== id));
      } catch { setError("Não foi possível registrar o envio. Tente novamente."); }
    });
  }

  if (list.length === 0)
    return (
      <div className="flex min-h-11 items-center gap-2 rounded-xl border border-border px-3.5 py-2.5 text-sm text-muted-foreground">
        <CheckCircle2 aria-hidden="true" className="h-4 w-4 shrink-0 text-success" />
        Nenhum lembrete pendente nesta lista.
      </div>
    );

  // Computador: duas colunas que se preenchem de cima para baixo.
  const half = Math.ceil(list.length / 2);
  const hidden = list.length - MOBILE_VISIBLE;
  return (
    <div className="flex flex-col gap-2">
      {error && <p role="alert" className="text-sm text-danger">{error}</p>}
      <ul className="md:grid md:grid-flow-col md:grid-cols-2 md:gap-x-6" style={{ gridTemplateRows: `repeat(${half}, auto)` }}>
        {list.map((r, i) => {
          const when = formatInTimeZone(new Date(r.startAt), timezone, "HH:mm", { locale: ptBR });
          return (
            <li
              key={r.id}
              className={cn(
                "flex flex-wrap items-center gap-x-3 gap-y-2 py-2 md:min-h-14",
                i > 0 && "border-t border-border",
                i % half === 0 && "md:border-t-0",
                i >= MOBILE_VISIBLE && !showAll && "max-md:hidden",
              )}
            >
              <span className="w-12 shrink-0 text-sm font-semibold tabular-nums">
                {when}
              </span>
              <div className="min-w-0 flex-[1_1_120px]">
                <p className="break-words text-sm font-medium leading-snug">{r.clientName}</p>
                <p className="break-words text-xs leading-snug text-muted-foreground">
                  {r.serviceName} · {r.proName}
                </p>
              </div>
              {opened.includes(r.id) && <Button type="button" variant="outline" size="sm" disabled={pending} onClick={() => confirmSent(r.id)} className="max-md:order-last max-md:w-full">Confirmar envio manual</Button>}
              <Button
                type="button"
                variant="outline"
                size="sm"
                disabled={pending}
                onClick={() => send(r.id, r.clientPhone, r.clientName, when)}
                aria-label={`Abrir WhatsApp para ${r.clientName}`}
                className="shrink-0 max-md:w-11 max-md:px-0"
              >
                <MessageCircle aria-hidden="true" className="h-4 w-4" />
                <span className="max-md:hidden">Abrir WhatsApp</span>
              </Button>
            </li>
          );
        })}
      </ul>
      {hidden > 0 && (
        <Button type="button" variant="ghost" aria-expanded={showAll} onClick={() => setShowAll(value => !value)} className="w-full md:hidden">
          {showAll ? "Mostrar menos" : `Mostrar os outros ${hidden}`}
        </Button>
      )}
    </div>
  );
}
