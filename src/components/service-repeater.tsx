"use client";
import { formatMoney } from "@/lib/utils";

export function ServiceRepeater({
  ids,
  services,
  onChange,
}: {
  ids: string[];
  services: {
    id: string;
    name: string;
    durationMin: number;
    priceCents: number;
  }[];
  onChange: (ids: string[]) => void;
}) {
  if (!ids.length) return null;
  const selected = ids.map((id) => services.find((s) => s.id === id));
  return (
    <div className="my-3 space-y-2 rounded-xl border border-border p-3">
      <p className="text-sm font-semibold">Serviços nesta reserva</p>
      {selected.map((service, index) => (
        <div
          key={`${ids[index]}-${index}`}
          className="flex flex-wrap items-center justify-between gap-2 border-b border-border pb-2 text-sm last:border-0"
        >
          <span>
            {index + 1}. {service?.name ?? "Serviço do histórico"}
          </span>
          <span className="flex gap-2">
            <button
              type="button"
              disabled={!service || ids.length >= 10}
              className="min-h-11 rounded-lg border border-border px-3 disabled:opacity-40"
              onClick={() => {
                const next = [...ids];
                next.splice(index + 1, 0, ids[index]!);
                onChange(next);
              }}
            >
              Repetir serviço
            </button>
            <button
              type="button"
              className="min-h-11 px-3 text-muted-foreground"
              aria-label={`Remover serviço ${index + 1}`}
              onClick={() => onChange(ids.filter((_, i) => i !== index))}
            >
              Remover
            </button>
          </span>
        </div>
      ))}
      <p className="text-xs text-muted-foreground">
        {ids.length} serviço(s) ·{" "}
        {selected.reduce((sum, s) => sum + (s?.durationMin ?? 0), 0)} min ·{" "}
        {formatMoney(
          selected.reduce((sum, s) => sum + (s?.priceCents ?? 0), 0),
        )}
        . Valores serão conferidos para a data escolhida.
      </p>
      <p className="text-xs text-muted-foreground">
        Os serviços são consecutivos com o mesmo profissional. Para
        acompanhantes, informe os nomes nas observações.
      </p>
    </div>
  );
}
