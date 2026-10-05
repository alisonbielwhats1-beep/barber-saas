// @vitest-environment jsdom

import { cleanup, render, screen } from "@testing-library/react";
import type { ReactNode } from "react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { CashflowChart } from "../financeiro/cashflow-chart-impl";
import DonutPie from "./donut-pie";
import { RevenueChart } from "./revenue-chart-impl";

// Os gráficos reais dependem de medidas de layout que o jsdom não tem. Estes
// dublês só guardam as propriedades de formatação e repassam os filhos.
const captured = vi.hoisted(() => ({
  yAxis: undefined as undefined | { tickFormatter: (value: number) => string },
  tooltip: undefined as undefined | { formatter: (value: number) => unknown },
}));
vi.mock("recharts", () => {
  const Box = ({ children }: { children?: ReactNode }) => <div>{children}</div>;
  return {
    ResponsiveContainer: Box,
    AreaChart: Box,
    ComposedChart: Box,
    PieChart: Box,
    Pie: Box,
    Area: () => null,
    Bar: () => null,
    Line: () => null,
    XAxis: () => null,
    CartesianGrid: () => null,
    YAxis: (props: { tickFormatter: (value: number) => string }) => {
      captured.yAxis = props;
      return null;
    },
    Tooltip: (props: { formatter: (value: number) => unknown }) => {
      captured.tooltip = props;
      return null;
    },
    Cell: (props: Record<string, unknown>) => <i role={props.role as string} aria-label={props["aria-label"] as string} />,
  };
});

const plain = (value: unknown) => String(value).replace(/ /g, " ");

beforeEach(() => {
  captured.yAxis = undefined;
  captured.tooltip = undefined;
});
afterEach(cleanup);

describe("gráficos em pt-BR", () => {
  it("faturamento: tooltip em reais com milhar e vírgula, eixo abreviado", () => {
    render(<RevenueChart data={[{ date: "2026-10-01", cents: 123456 }]} />);
    const [label, series] = captured.tooltip!.formatter(1234.56) as [string, string];
    expect(plain(label)).toBe("R$ 1.234,56");
    expect(series).toBe("Faturamento");
    expect(plain(captured.yAxis!.tickFormatter(1500))).toBe("R$ 1,5 mil");
  });

  it("fluxo de caixa: eixo com unidade e abreviado, tooltip em reais", () => {
    render(<CashflowChart data={[{ date: "2026-10-01", inflow: 150000, outflow: 50000, net: 100000 }]} />);
    expect(plain(captured.yAxis!.tickFormatter(1500))).toBe("R$ 1,5 mil");
    expect(plain(captured.tooltip!.formatter(1234.56))).toBe("R$ 1.234,56");
  });

  it("donut: o rótulo de acessibilidade anuncia o valor formatado, não centavos crus", () => {
    render(
      <DonutPie
        paddingAngle={3}
        data={[
          { name: "Masculino", value: 123450, color: "#000" },
          { name: "Feminino", value: 5000, color: "#111" },
        ]}
      />,
    );
    expect(plain(screen.getByRole("img", { name: /Masculino/ }).getAttribute("aria-label"))).toBe("Masculino: R$ 1.234,50");
    expect(plain(screen.getByRole("img", { name: /Feminino/ }).getAttribute("aria-label"))).toBe("Feminino: R$ 50,00");
  });

  it("donut sem dados: anuncia só 'Sem dados', sem inventar R$ 0,01", () => {
    render(<DonutPie paddingAngle={0} empty data={[{ name: "Sem dados", value: 1, color: "hsl(var(--border))" }]} />);
    expect(screen.getByRole("img").getAttribute("aria-label")).toBe("Sem dados");
  });
});
