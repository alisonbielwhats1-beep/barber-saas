"use client";

import { useState, useTransition } from "react";
import { Check, Loader2, MessageCircle } from "lucide-react";
import { markReminderSent } from "@/app/(admin)/agenda/actions";
import { buildAppointmentWhatsAppLink } from "@/lib/whatsapp";
import { Button } from "@/components/ui/button";
import { cn } from "@/lib/utils";

export function WhatsAppReminderButton({
  appointmentId,
  phone,
  clientName,
  salonName,
  when,
  serviceName,
  professionalName,
}: {
  appointmentId: string;
  phone: string | null;
  clientName: string;
  salonName: string;
  when: string;
  serviceName: string;
  professionalName: string;
}) {
  const [sent, setSent] = useState(false);
  const [opened, setOpened] = useState(false);
  const [pending, startTransition] = useTransition();
  const link = buildAppointmentWhatsAppLink({
    phone,
    clientName,
    salonName,
    when,
    serviceName,
    professionalName,
  });

  function send() {
    if (!link) return;
    window.open(link, "_blank", "noopener,noreferrer");
    setOpened(true);
  }

  function confirmSent() {
    startTransition(async () => {
      try {
        await markReminderSent(appointmentId);
        setSent(true);
      } catch {
        // A abertura do WhatsApp já aconteceu; o botão permanece disponível.
      }
    });
  }

  return (
    <div className="mt-auto flex flex-wrap items-center justify-end gap-2">
    {opened && !sent && <Button type="button" variant="outline" size="sm" disabled={pending} onClick={confirmSent}>Confirmar envio manual</Button>}
    <button
      type="button"
      disabled={!link || pending}
      onClick={send}
      title={!link ? "Cliente sem telefone cadastrado" : "Enviar lembrete pelo WhatsApp"}
      aria-label={link
        ? `Enviar lembrete pelo WhatsApp para ${clientName}`
        : `${clientName} está sem telefone cadastrado`}
      className={cn(
        "grid h-11 w-11 place-items-center rounded-[10px] border border-border-strong transition-colors hover:bg-card-hover focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring disabled:cursor-not-allowed disabled:opacity-40 lg:h-9 lg:w-9 lg:rounded-[9px]",
        sent ? "text-success" : "text-foreground",
      )}
    >
      {pending ? <Loader2 aria-hidden="true" className="h-4 w-4 animate-spin" /> : sent ? <Check aria-hidden="true" className="h-4 w-4" /> : <MessageCircle aria-hidden="true" className="h-4 w-4" />}
    </button>
    </div>
  );
}
