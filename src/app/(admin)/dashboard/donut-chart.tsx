"use client";

import { ResponsiveContainer, PieChart, Pie, Cell } from "recharts";
import { formatMoney } from "@/lib/utils";

/**
 * Donut de composição (ex.: receita por gênero). Centro mostra o total.
 * Puramente apresentacional — recebe fatias já calculadas no servidor.
 */
export function DonutChart({
  slices,
  centerLabel,
  centerValue,
}: {
  slices: { name: string; value: number; color: string }[];
  centerLabel: string;
  centerValue: string;
}) {
  const total = slices.reduce((s, x) => s + x.value, 0);
  const data = total === 0 ? [{ name: "Sem dados", value: 1, color: "hsl(240 5% 20%)" }] : slices;

  return (
    <div className="relative h-52 w-full">
      <ResponsiveContainer width="100%" height="100%">
        <PieChart>
          <Pie
            data={data}
            dataKey="value"
            innerRadius="66%"
            outerRadius="100%"
            paddingAngle={total === 0 ? 0 : 3}
            stroke="none"
            startAngle={90}
            endAngle={-270}
          >
            {data.map((s, i) => (
              <Cell key={i} fill={s.color} />
            ))}
          </Pie>
        </PieChart>
      </ResponsiveContainer>
      <div className="pointer-events-none absolute inset-0 flex flex-col items-center justify-center">
        <span className="text-[11px] uppercase tracking-widest text-muted-foreground">
          {centerLabel}
        </span>
        <span className="mt-0.5 text-xl font-semibold tracking-tight">{centerValue}</span>
      </div>
    </div>
  );
}

export { formatMoney };
