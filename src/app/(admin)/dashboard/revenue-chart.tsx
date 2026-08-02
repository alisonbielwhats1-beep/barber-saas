"use client";

import dynamic from "next/dynamic";

/**
 * Wrapper de carregamento sob demanda. A implementação vive em
 * revenue-chart-impl.tsx e traz o recharts (~405KB) junto — mantê-la fora do
 * bundle inicial tira esse peso do First Load do /dashboard.
 *
 * O skeleton ocupa exatamente a altura do gráfico (h-full dentro do h-64 da
 * página) para não empurrar o layout quando o chunk chega.
 */
export const RevenueChart = dynamic(
  () => import("./revenue-chart-impl").then((m) => m.RevenueChart),
  {
    ssr: false,
    loading: () => <div className="h-full w-full animate-shimmer rounded-xl" />,
  },
);
