"use client";
import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { respondOffer } from "./offer-actions";
export function OfferButtons({ slug, id }: { slug: string; id: string }) {
  const [pending, transition] = useTransition();
  const [message, setMessage] = useState("");
  const router = useRouter();
  function respond(accept: boolean) {
    transition(async () => {
      try {
        const result = await respondOffer(slug, id, accept);
        setMessage(
          result && "error" in result
            ? result.error!
            : accept
              ? "Reserva confirmada. Consulte Minhas reservas."
              : "Oferta recusada. Você continua na fila para outros horários.",
        );
        router.refresh();
      } catch (e) {
        setMessage(
          e instanceof Error ? e.message : "Não foi possível responder.",
        );
      }
    });
  }
  return (
    <div className="mt-3">
      <div className="flex gap-2">
        <button
          disabled={pending}
          onClick={() => respond(true)}
          className="min-h-11 rounded-lg bg-primary px-4 text-sm font-semibold text-primary-foreground"
        >
          Aceitar e reservar
        </button>
        <button
          disabled={pending}
          onClick={() => respond(false)}
          className="min-h-11 rounded-lg border border-border px-4 text-sm"
        >
          Recusar vaga
        </button>
      </div>
      <p role="status" className="mt-2 text-sm">
        {message}
      </p>
    </div>
  );
}
