"use client";

import { ResponsiveContainer, PieChart, Pie, Cell } from "recharts";
import { formatMoney } from "@/lib/utils";

/**
 * Só o anel do donut. Vive separado de donut-chart.tsx porque o `recharts`
 * pesa ~405KB e não pode entrar no First Load do /dashboard e do /financeiro —
 * aqui ele fica num chunk próprio, carregado sob demanda.
 */
export default function DonutPie({
  data,
  paddingAngle,
  empty = false,
}: {
  /** Valores em centavos, como em `formatMoney`. */
  data: { name: string; value: number; color: string }[];
  paddingAngle: number;
  /** Anel de "sem dados": a fatia única é só desenho, não um valor a anunciar. */
  empty?: boolean;
}) {
  return (
    <ResponsiveContainer width="100%" height="100%">
      <PieChart>
        <Pie
          data={data}
          dataKey="value"
          innerRadius="66%"
          outerRadius="100%"
          paddingAngle={paddingAngle}
          stroke="none"
          startAngle={90}
          endAngle={-270}
        >
          {data.map((s, i) => (
            <Cell key={i} fill={s.color} role="img" aria-label={empty ? s.name : `${s.name}: ${formatMoney(s.value)}`} />
          ))}
        </Pie>
      </PieChart>
    </ResponsiveContainer>
  );
}
