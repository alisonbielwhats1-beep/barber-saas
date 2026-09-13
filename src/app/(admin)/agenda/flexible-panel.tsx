"use client";
import { useState, useTransition } from "react";
import {
  listFlexibleRequests,
  offerFlexibleRequest,
  withdrawFlexibleOffer,
  quoteFlexibleRequest,
} from "./flexible-actions";
import { minutesToHHMM, formatMoney } from "@/lib/utils";
export function FlexibleQueuePanel() {
  const [items, setItems] = useState<
    Awaited<ReturnType<typeof listFlexibleRequests>>
  >([]);
  const [pending, transition] = useTransition();
  const [message, setMessage] = useState("");
  const run = (fn: () => Promise<unknown>) =>
    transition(async () => {
      setMessage("");
      try {
        await fn();
        setItems(await listFlexibleRequests());
      } catch (e) {
        setMessage(
          e instanceof Error ? e.message : "Não foi possível atualizar.",
        );
      }
    });
  return (
    <details
      className="mb-3 rounded-xl border border-border bg-card p-3"
      onToggle={(e) => {
        if (e.currentTarget.open) run(async () => {});
      }}
    >
      <summary className="min-h-11 cursor-pointer text-sm font-semibold">
        Pedidos de encaixe por período
      </summary>
      <p className="text-xs text-muted-foreground">
        Ordem de chegada entre pedidos compatíveis. O horário, o recurso físico
        e o preço são conferidos novamente ao confirmar.
      </p>
      <ul className="divide-y divide-border">
        {items.map((i, index) => (
          <li key={i.id} className="space-y-2 py-3">
            <p className="text-sm font-semibold">
              {index + 1}. {i.client.name} · {i.professional.user.name}
            </p>
            <p className="text-xs">
              {i.services.map((s) => s.service.name).join(" + ")} · Catálogo:{" "}
              {formatMoney(
                i.services.reduce((n, s) => n + s.service.priceCents, 0),
              )}
            </p>
            <p className="text-xs text-muted-foreground">
              {i.fromDate} — {i.toDate}, das {minutesToHHMM(i.startMinutes)} até{" "}
              {minutesToHHMM(i.endMinutes)}
            </p>
            <form
              className="flex flex-wrap items-end gap-2"
              onSubmit={(e) => {
                e.preventDefault();
                const form = new FormData(e.currentTarget);
                const time = String(form.get("start"));
                const minutes = Number(form.get("minutes"));
                run(async () => {
                  const quote = await quoteFlexibleRequest(i.id, time);
                  if (
                    !window.confirm(
                      `Oferecer um horário para ${i.client.name} em ${time.replace("T", " ")} por ${formatMoney(quote.priceCents)}?`,
                    )
                  )
                    return;
                  await offerFlexibleRequest(
                    i.id,
                    time,
                    quote.priceCents,
                    minutes,
                  );
                  setMessage(
                    "Oferta enviada ao aplicativo do cliente. A reserva depende do aceite.",
                  );
                });
              }}
            >
              <label className="text-xs">
                Horário do encaixe
                <input
                  required
                  name="start"
                  type="datetime-local"
                  min={`${i.fromDate}T${minutesToHHMM(i.startMinutes)}`}
                  max={`${i.toDate}T23:59`}
                  className="mt-1 block min-h-11 rounded-lg border border-border bg-background px-2 text-sm"
                />
              </label>
              <label className="text-xs">
                Prazo de aceite
                <select
                  name="minutes"
                  defaultValue="15"
                  className="block min-h-11 rounded-lg border border-border bg-background px-2"
                >
                  <option value="5">5 minutos</option>
                  <option value="15">15 minutos</option>
                  <option value="30">30 minutos</option>
                  <option value="60">60 minutos</option>
                </select>
              </label>
              <button
                disabled={pending || i.offers.length > 0}
                className="min-h-11 rounded-lg bg-[var(--action-positive)] px-3 text-sm text-white"
              >
                Oferecer vaga
              </button>
            </form>
            {i.offers.map((offer) => (
              <div key={offer.id} className="flex items-center gap-3 text-sm">
                <span>
                  Aguardando aceite · até{" "}
                  {new Date(offer.expiresAt).toLocaleTimeString("pt-BR", {
                    hour: "2-digit",
                    minute: "2-digit",
                  })}
                </span>
                <button
                  disabled={pending}
                  className="min-h-11 underline"
                  onClick={() =>
                    run(async () => {
                      await withdrawFlexibleOffer(offer.id);
                    })
                  }
                >
                  Retirar oferta
                </button>
              </div>
            ))}
          </li>
        ))}
      </ul>
      {!items.length && (
        <p className="py-3 text-xs text-muted-foreground">
          Nenhum pedido ativo no período.
        </p>
      )}
      <p role="status" className="text-sm">
        {message}
      </p>
    </details>
  );
}
