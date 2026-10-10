"use client";
import { Palette } from "lucide-react";
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
  compactOnPhone = false,
}: {
  value: AgendaColorMode;
  onChange: (mode: AgendaColorMode) => void;
  /** Abaixo de 768px vira um botão de paleta de 44 px; o `<select>` nativo fica por cima, invisível, e abre o seletor do aparelho. */
  compactOnPhone?: boolean;
}) {
  const [ready, setReady] = useState(false);
  useEffect(() => setReady(true), []);
  return (
    <label
      className={`flex min-h-11 items-center gap-2 text-xs${
        compactOnPhone
          ? " max-md:relative max-md:w-11 max-md:justify-center max-md:rounded-xl max-md:border max-md:border-border max-md:bg-card max-md:has-[:focus-visible]:ring-2 max-md:has-[:focus-visible]:ring-ring"
          : ""
      }`}
    >
      {compactOnPhone && <Palette aria-hidden="true" className="h-[18px] w-[18px] text-muted-foreground md:hidden" />}
      <span
        title="Reservas com vários serviços usam a cor do primeiro serviço ou de sua categoria"
        className={compactOnPhone ? "max-md:hidden" : undefined}
      >
        Cores
      </span>
      <select
        className={`min-h-11 max-w-36 rounded-lg border border-border bg-card px-2 text-sm${
          compactOnPhone ? " max-md:absolute max-md:inset-0 max-md:h-full max-md:w-full max-md:max-w-none max-md:cursor-pointer max-md:opacity-0" : ""
        }`}
        aria-label="Colorir agenda por"
        disabled={!ready}
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
