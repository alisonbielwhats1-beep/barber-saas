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
    <button
      type="button"
      disabled={!link || pending}
      onClick={send}
      title={!link ? "Cliente sem telefone cadastrado" : "Enviar lembrete pelo WhatsApp"}
      aria-label={link
        ? `Enviar lembrete pelo WhatsApp para ${clientName}`
        : `${clientName} está sem telefone cadastrado`}
      className={`absolute bottom-3 right-3 grid h-9 w-9 place-items-center rounded-lg transition disabled:cursor-not-allowed disabled:opacity-40 ${
        sent
          ? "bg-[#25D366]/25 text-[#25D366]"
          : "bg-[#25D366]/15 text-[#25D366] hover:bg-[#25D366]/25"
      }`}
    >
      {pending ? <Loader2 className="h-4 w-4 animate-spin" /> : sent ? <Check className="h-4 w-4" /> : <MessageCircle className="h-4 w-4" />}
    </button>
  );
}
