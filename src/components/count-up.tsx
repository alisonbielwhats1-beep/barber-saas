"use client";

import { useEffect, useState } from "react";
import { formatMoney } from "@/lib/utils";

type Format = "money" | "int" | "percent";

function render(v: number, format: Format, currency: string) {
  if (format === "money") return formatMoney(Math.round(v), currency);
  if (format === "percent") return `${Math.round(v)}%`;
  return Math.round(v).toString();
}

/**
 * Número que "sobe" até o valor final (ease-out, ~700ms) — usado nos KPIs.
 * Respeita prefers-reduced-motion. `value` em cents quando format="money".
 */
export function CountUp({
  value,
  format = "int",
  currency = "BRL",
  durationMs = 700,
}: {
  value: number;
  format?: Format;
  currency?: string;
  durationMs?: number;
}) {
  const [display, setDisplay] = useState(0);

  useEffect(() => {
    if (window.matchMedia("(prefers-reduced-motion: reduce)").matches) {
      setDisplay(value);
      return;
    }
    const t0 = performance.now();
    let raf: number;
    const tick = (t: number) => {
      const p = Math.min(1, (t - t0) / durationMs);
      const eased = 1 - Math.pow(1 - p, 3);
      setDisplay(value * eased);
      if (p < 1) raf = requestAnimationFrame(tick);
    };
    raf = requestAnimationFrame(tick);
    return () => cancelAnimationFrame(raf);
  }, [value, durationMs]);

  return <span>{render(display, format, currency)}</span>;
}
