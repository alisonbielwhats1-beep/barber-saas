"use client";
import { useEffect, useState } from "react";
import { AGENDA_COLOR_MODES, type AgendaColorMode } from "@/lib/agenda-colors";
export function useAgendaColorMode(scope: string) {
  const [mode, setMode] = useState<AgendaColorMode>("service");
  const key = `agenda-colors:v1:${scope}`;
  useEffect(() => {
    try {
      const saved = localStorage.getItem(key);
      setMode(
        AGENDA_COLOR_MODES.some((m) => m.value === saved)
          ? (saved as AgendaColorMode)
          : "service",
      );
    } catch {
      /* Preferência de sessão quando armazenamento estiver bloqueado. */
    }
  }, [key]);
  function select(value: AgendaColorMode) {
    setMode(value);
    try {
      localStorage.setItem(key, value);
    } catch {
      /* Mantém escolha na sessão. */
    }
  }
  return [mode, select] as const;
}
export function AgendaColorSelect({
  value,
  onChange,
}: {
  value: AgendaColorMode;
  onChange: (mode: AgendaColorMode) => void;
}) {
  return (
    <label className="flex min-h-11 items-center gap-2 text-xs">
      <span title="Reservas com vários serviços usam a cor do primeiro serviço ou de sua categoria">
        Cores
      </span>
      <select
        className="min-h-11 max-w-36 rounded-lg border border-border bg-card px-2 text-sm"
        aria-label="Colorir agenda por"
        value={value}
        onChange={(e) => onChange(e.target.value as AgendaColorMode)}
      >
        {AGENDA_COLOR_MODES.map((m) => (
          <option key={m.value} value={m.value}>
            {m.label}
          </option>
        ))}
      </select>
    </label>
  );
}
