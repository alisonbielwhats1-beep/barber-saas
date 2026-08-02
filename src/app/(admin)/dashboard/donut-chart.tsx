"use client";

import dynamic from "next/dynamic";

/**
 * Donut de composição (ex.: receita por gênero). Centro mostra o total.
 * Puramente apresentacional — recebe fatias já calculadas no servidor.
 *
 * O anel (que traz o recharts junto, ~405KB) é carregado sob demanda; o valor
 * central é renderizado de imediato, porque é a informação que importa — some
 * o gráfico por um instante, nunca o número.
 */
const DonutPie = dynamic(() => import("./donut-pie"), {
  ssr: false,
  loading: () => null,
});

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
      <DonutPie data={data} paddingAngle={total === 0 ? 0 : 3} />
      <div className="pointer-events-none absolute inset-0 flex flex-col items-center justify-center">
        <span className="text-[11px] uppercase tracking-widest text-muted-foreground">
          {centerLabel}
        </span>
        <span className="mt-0.5 text-xl font-semibold tracking-tight">{centerValue}</span>
      </div>
    </div>
  );
}
