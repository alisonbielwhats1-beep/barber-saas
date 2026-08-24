import { describe, expect, it } from "vitest";
import { formatPeriodLabel } from "@/lib/time";

describe("formatPeriodLabel", () => {
  it("não acrescenta o dia seguinte quando o intervalo é de um único dia", () => {
    const label = formatPeriodLabel(
      new Date("2026-08-23T12:00:00.000Z"),
      new Date("2026-08-23T23:00:00.000Z"),
      "America/Sao_Paulo",
    );

    expect(label).toContain("23");
    expect(label).not.toMatch(/24/);
    expect(label).not.toContain("–");
  });

  it("mantém início e fim visíveis em intervalos maiores", () => {
    const label = formatPeriodLabel(
      new Date("2026-08-01T12:00:00.000Z"),
      new Date("2026-08-23T23:00:00.000Z"),
      "America/Sao_Paulo",
    );

    expect(label).toContain("1");
    expect(label).toContain("23");
    expect(label).toContain("–");
  });
});
