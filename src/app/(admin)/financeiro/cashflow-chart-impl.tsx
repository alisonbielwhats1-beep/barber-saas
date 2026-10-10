"use client";

import {
  ResponsiveContainer,
  ComposedChart,
  Bar,
  Line,
  XAxis,
  YAxis,
  Tooltip,
  CartesianGrid,
} from "recharts";
import { format, parseISO } from "date-fns";
import { formatMoney, formatMoneyCompact } from "@/lib/utils";

/** Cores da paleta: entradas em verde, saídas em vermelho, saldo tracejado na cor do texto. */
const CASHFLOW_COLORS = {
  inflow: "hsl(var(--success))",
  outflow: "hsl(var(--danger))",
  net: "hsl(var(--foreground))",
} as const;

export function CashflowChart({
  data,
}: {
  data: { date: string; inflow: number; outflow: number; net: number }[];
}) {
  const chart = data.map((d) => ({
    label: format(parseISO(d.date), "dd/MM"),
    Entradas: d.inflow / 100,
    Saídas: d.outflow / 100,
    Saldo: d.net / 100,
  }));

  return (
    <ResponsiveContainer width="100%" height="100%">
      <ComposedChart data={chart} margin={{ top: 10, right: 8, left: 0, bottom: 0 }}>
        <CartesianGrid strokeDasharray="3 4" stroke="hsl(var(--border))" vertical={false} />
        <XAxis dataKey="label" stroke="hsl(var(--muted-foreground))" fontSize={12} tickLine={false} axisLine={false} minTickGap={16} />
        <YAxis
          stroke="hsl(var(--muted-foreground))"
          fontSize={12}
          tickLine={false}
          axisLine={false}
          width={76}
          tickFormatter={(v: number) => formatMoneyCompact(Math.round(v * 100))}
        />
        <Tooltip
          contentStyle={{
            background: "hsl(var(--elevated))",
            border: "1px solid hsl(var(--border-strong))",
            borderRadius: 10,
            fontSize: 12,
            color: "hsl(var(--foreground))",
          }}
          cursor={{ fill: "hsl(var(--muted) / 0.6)" }}
          formatter={(v: number) => formatMoney(Math.round(v * 100))}
          labelStyle={{ color: "hsl(var(--muted-foreground))" }}
        />
        <Bar dataKey="Entradas" fill={CASHFLOW_COLORS.inflow} radius={[2, 2, 0, 0]} maxBarSize={14} />
        <Bar dataKey="Saídas" fill={CASHFLOW_COLORS.outflow} radius={[2, 2, 0, 0]} maxBarSize={14} />
        <Line type="linear" dataKey="Saldo" stroke={CASHFLOW_COLORS.net} strokeWidth={1.8} strokeDasharray="6 5" dot={false} />
      </ComposedChart>
    </ResponsiveContainer>
  );
}
