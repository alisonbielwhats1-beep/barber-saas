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
  size = "md",
}: {
  slices: { name: string; value: number; color: string }[];
  centerLabel: string;
  centerValue: string;
  size?: "sm" | "md";
}) {
  const total = slices.reduce((s, x) => s + x.value, 0);
  const data = total === 0 ? [{ name: "Sem dados", value: 1, color: "hsl(var(--border))" }] : slices;

  return (
    <div className={`relative mx-auto w-full ${size === "sm" ? "h-36 max-w-36" : "h-44 max-w-44"}`}>
      <DonutPie data={data} paddingAngle={total === 0 ? 0 : 2} empty={total === 0} />
      <div className="pointer-events-none absolute inset-0 flex flex-col items-center justify-center">
        <span className="text-xs text-muted-foreground">{centerLabel}</span>
        <span className="whitespace-nowrap text-base font-semibold tabular-nums">{centerValue}</span>
      </div>
    </div>
  );
}
