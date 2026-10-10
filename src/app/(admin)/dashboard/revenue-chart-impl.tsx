"use client";

import {
  ResponsiveContainer,
  AreaChart,
  Area,
  XAxis,
  YAxis,
  Tooltip,
  CartesianGrid,
} from "recharts";
import { format, parseISO } from "date-fns";
import { formatMoney, formatMoneyCompact } from "@/lib/utils";

/** Série principal em lilás (paleta Everflair), grade na cor do contorno. */
export function RevenueChart({ data }: { data: { date: string; cents: number }[] }) {
  const formatted = data.map((d) => ({
    ...d,
    value: d.cents / 100,
    label: format(parseISO(d.date), "dd/MM"),
  }));

  return (
    <ResponsiveContainer width="100%" height="100%">
      <AreaChart data={formatted} margin={{ top: 10, right: 10, left: 0, bottom: 0 }}>
        <defs>
          <linearGradient id="revGrad" x1="0" y1="0" x2="0" y2="1">
            <stop offset="0%" stopColor="hsl(var(--accent))" stopOpacity={0.28} />
            <stop offset="100%" stopColor="hsl(var(--accent))" stopOpacity={0} />
          </linearGradient>
        </defs>
        <CartesianGrid strokeDasharray="3 4" stroke="hsl(var(--border))" vertical={false} />
        <XAxis
          dataKey="label"
          stroke="hsl(var(--muted-foreground))"
          fontSize={12}
          tickLine={false}
          axisLine={false}
          minTickGap={16}
        />
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
          labelStyle={{ color: "hsl(var(--muted-foreground))" }}
          cursor={{ stroke: "hsl(var(--border-strong))" }}
          formatter={(v: number) => [formatMoney(Math.round(v * 100)), "Faturamento"]}
        />
        <Area
          type="linear"
          dataKey="value"
          stroke="hsl(var(--accent))"
          strokeWidth={2}
          fill="url(#revGrad)"
        />
      </AreaChart>
    </ResponsiveContainer>
  );
}
