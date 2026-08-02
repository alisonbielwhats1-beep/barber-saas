"use client";

import dynamic from "next/dynamic";

/**
 * Mesma estratégia do revenue-chart: a implementação (e o recharts junto)
 * sai do bundle inicial do /financeiro e desce só quando o gráfico aparece.
 */
export const CashflowChart = dynamic(
  () => import("./cashflow-chart-impl").then((m) => m.CashflowChart),
  {
    ssr: false,
    loading: () => <div className="h-full w-full animate-shimmer rounded-xl" />,
  },
);
