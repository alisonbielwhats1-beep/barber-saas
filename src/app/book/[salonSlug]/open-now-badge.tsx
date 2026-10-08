"use client";

import { useEffect, useState } from "react";
import { wallClockMinutesInTimeZone, weekdayInTimeZone } from "@/lib/time";
import type { WeeklyHours } from "@/lib/team-schedule";

/**
 * Aberto agora: dentro do horário do estabelecimento e com alguém da equipe
 * em expediente neste dia e minuto (folgas e pausas contam como fechado). Sem
 * expediente cadastrado, vale só o horário do estabelecimento.
 */
export function isOpenAt(
  instant: Date,
  { openMinutes, closeMinutes, timeZone, weeklyHours }: {
    openMinutes: number;
    closeMinutes: number;
    timeZone: string;
    weeklyHours: WeeklyHours[];
  },
): boolean | null {
  try {
    const now = wallClockMinutesInTimeZone(instant, timeZone);
    if (now < openMinutes || now >= closeMinutes) return false;
    if (weeklyHours.length === 0) return true;
    const weekday = weekdayInTimeZone(instant, timeZone);
    return weeklyHours.some((row) => row.weekday === weekday && now >= row.startMinutes && now < row.endMinutes);
  } catch {
    return null;
  }
}

/** Calculado no aparelho do cliente; antes de montar, nada aparece (sem divergir do HTML inicial). */
export function OpenNowBadge(props: {
  openMinutes: number;
  closeMinutes: number;
  timeZone: string;
  weeklyHours: WeeklyHours[];
}) {
  const [open, setOpen] = useState<boolean | null>(null);
  const { openMinutes, closeMinutes, timeZone, weeklyHours } = props;

  useEffect(() => {
    const update = () => setOpen(isOpenAt(new Date(), { openMinutes, closeMinutes, timeZone, weeklyHours }));
    update();
    const timer = window.setInterval(update, 60_000);
    return () => window.clearInterval(timer);
  }, [openMinutes, closeMinutes, timeZone, weeklyHours]);

  if (open === null) return null;
  return <span className="client-open-badge" data-open={open}>{open ? "Aberto agora" : "Fechado agora"}</span>;
}
