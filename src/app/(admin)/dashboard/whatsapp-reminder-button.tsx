"use client";

import { useState, useTransition } from "react";
import { Check, Loader2, MessageCircle } from "lucide-react";
import { markReminderSent } from "@/app/(admin)/agenda/actions";
import { buildAppointmentWhatsAppLink } from "@/lib/whatsapp";

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
    <div className="absolute bottom-2 right-2 flex items-center gap-2">
    {opened && !sent && <button type="button" disabled={pending} onClick={confirmSent} className="min-h-11 rounded-lg border border-border px-2 text-xs">Confirmar envio manual</button>}
    <button
      type="button"
      disabled={!link || pending}
      onClick={send}
      title={!link ? "Cliente sem telefone cadastrado" : "Enviar lembrete pelo WhatsApp"}
      aria-label={link
        ? `Enviar lembrete pelo WhatsApp para ${clientName}`
        : `${clientName} está sem telefone cadastrado`}
      className={`grid h-11 w-11 place-items-center rounded-lg transition disabled:cursor-not-allowed disabled:opacity-40 ${
        sent
          ? "bg-primary/20 text-primary"
          : "bg-primary/10 text-primary hover:bg-primary/15"
      }`}
    >
      {pending ? <Loader2 className="h-4 w-4 animate-spin" /> : sent ? <Check className="h-4 w-4" /> : <MessageCircle className="h-4 w-4" />}
    </button>
    </div>
  );
}

