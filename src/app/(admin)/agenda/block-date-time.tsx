"use client";
import { useState } from "react";

export function BlockDateTime({ label, value, onChange, className }: {
  label: string; value: string; onChange: (value: string) => void; className: string;
}) {
  const suffix = label === "Início" ? "início" : "fim";
  const [typing, setTyping] = useState(false);
  return <div className="grid grid-cols-2 gap-3">
    <label className="min-w-0 text-sm">Data de {suffix}<input required type="date" value={value.slice(0, 10)} onChange={e => onChange(`${e.target.value}T${value.slice(11)}`)} className={`${className} min-w-0`} /></label>
    <div className="min-w-0"><label className="text-sm">Hora de {suffix}<input required type={typing ? "text" : "time"} step={60} inputMode={typing ? "numeric" : undefined} placeholder="HH:mm" pattern="([01][0-9]|2[0-3]):[0-5][0-9]" maxLength={5} value={value.slice(11)} onChange={e => {
      if (!typing) { onChange(`${value.slice(0, 10)}T${e.target.value}`); return; }
      const digits = e.target.value.replace(/\D/g, "").slice(0, 4);
      const time = digits.length > 2 ? `${digits.slice(0, 2)}:${digits.slice(2)}` : digits;
      onChange(`${value.slice(0, 10)}T${time}`);
    }} className={className} /></label><button type="button" className="min-h-11 text-xs text-muted-foreground underline" onClick={() => setTyping(!typing)}>{typing ? `Usar seletor de ${suffix}` : `Digitar hora de ${suffix}`}</button></div>
  </div>;
}

