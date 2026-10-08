"use client";

import { useEffect, useState } from "react";

/** Minutos desde a meia-noite no fuso do estabelecimento. */
export function minutesInTimeZone(date: Date, timeZone: string) {
  try {
    const parts = new Intl.DateTimeFormat("en-GB", { timeZone, hour: "2-digit", minute: "2-digit", hourCycle: "h23" })
      .formatToParts(date);
    const hour = Number(parts.find((part) => part.type === "hour")?.value ?? NaN);
    const minute = Number(parts.find((part) => part.type === "minute")?.value ?? NaN);
    return Number.isFinite(hour) && Number.isFinite(minute) ? hour * 60 + minute : null;
  } catch {
    return null;
  }
}

/**
 * Aberto/fechado agora pelo horário padrão do estabelecimento. Calculado no
 * aparelho do cliente para não depender do relógio nem do cache do servidor;
 * antes de montar, nada é exibido para não divergir do HTML inicial.
 */
export function OpenNowBadge({ openMinutes, closeMinutes, timeZone }: {
  openMinutes: number;
  closeMinutes: number;
  timeZone: string;
}) {
  const [open, setOpen] = useState<boolean | null>(null);

  useEffect(() => {
    const update = () => {
      const now = minutesInTimeZone(new Date(), timeZone);
      setOpen(now === null ? null : now >= openMinutes && now < closeMinutes);
    };
    update();
    const timer = window.setInterval(update, 60_000);
    return () => window.clearInterval(timer);
  }, [openMinutes, closeMinutes, timeZone]);

  if (open === null) return null;
  return <span className="client-open-badge" data-open={open}>{open ? "Aberto agora" : "Fechado agora"}</span>;
}
