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
import { formatMoney } from "@/lib/utils";

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
      <ComposedChart data={chart} margin={{ top: 10, right: 8, left: -8, bottom: 0 }}>
        <CartesianGrid strokeDasharray="3 3" stroke="hsl(var(--border))" vertical={false} />
        <XAxis dataKey="label" stroke="hsl(var(--muted-foreground))" fontSize={11} tickLine={false} axisLine={false} />
        <YAxis stroke="hsl(var(--muted-foreground))" fontSize={11} tickLine={false} axisLine={false} width={48} />
        <Tooltip
          contentStyle={{
            background: "hsl(var(--elevated))",
            border: "1px solid hsl(var(--border))",
            borderRadius: 12,
            fontSize: 12,
          }}
          formatter={(v: number) => formatMoney(Math.round(v * 100))}
          labelStyle={{ color: "hsl(var(--muted-foreground))" }}
        />
        <Bar dataKey="Entradas" fill="#2ECC8B" radius={[3, 3, 0, 0]} maxBarSize={14} />
        <Bar dataKey="Saídas" fill="#EF4444" radius={[3, 3, 0, 0]} maxBarSize={14} />
        <Line type="monotone" dataKey="Saldo" stroke="#3B9EFF" strokeWidth={2} dot={false} />
      </ComposedChart>
    </ResponsiveContainer>
  );
}
