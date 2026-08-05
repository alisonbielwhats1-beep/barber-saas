import { describe, it, expect, beforeAll, afterAll } from "vitest";
import {
  weekdayOfDateStr,
  brazilInstant,
  brazilWallClock,
  brazilHHMM,
  brazilDateKey,
  startOfBrazilDay,
  endOfBrazilDay,
} from "../br-time";

/**
 * O bug real (produção mostrando horário 3h adiantado) só aparecia com o
 * processo em UTC — a máquina de dev já roda em America/Sao_Paulo, então é
 * exatamente esse cenário (TZ=UTC) que precisa estar coberto aqui, não o
 * ambiente local.
 */
describe("br-time (processo em UTC, como na Vercel)", () => {
  const originalTZ = process.env.TZ;
  beforeAll(() => {
    process.env.TZ = "UTC";
  });
  afterAll(() => {
    process.env.TZ = originalTZ;
  });

  it("weekdayOfDateStr não depende do fuso do processo", () => {
    // 2026-08-06 é quinta-feira
    expect(weekdayOfDateStr("2026-08-06")).toBe(4);
  });

  it("brazilInstant converte HH:MM de Brasília pro instante UTC certo", () => {
    // 10:30 em Brasília (UTC-3) = 13:30 UTC
    expect(brazilInstant("2026-08-06", 10 * 60 + 30).toISOString()).toBe(
      "2026-08-06T13:30:00.000Z",
    );
  });

  it("brazilWallClock/brazilHHMM leem o horário de parede de Brasília", () => {
    const instant = new Date("2026-08-06T13:30:00.000Z");
    expect(brazilWallClock(instant)).toEqual({ hours: 10, minutes: 30 });
    expect(brazilHHMM(instant)).toBe("10:30");
  });

  it("brazilDateKey usa o dia-calendário de Brasília, não o de UTC", () => {
    // 2026-08-06 22:00 BRT = 2026-08-07 01:00 UTC — ainda é dia 06 no Brasil
    const lateNight = new Date("2026-08-07T01:00:00.000Z");
    expect(brazilDateKey(lateNight)).toBe("2026-08-06");
  });

  it("startOfBrazilDay/endOfBrazilDay usam a virada de meia-noite de Brasília", () => {
    const lateNight = new Date("2026-08-07T01:00:00.000Z"); // 06/08 22:00 BRT
    expect(startOfBrazilDay(lateNight).toISOString()).toBe("2026-08-06T03:00:00.000Z");
    expect(endOfBrazilDay(lateNight).toISOString()).toBe("2026-08-07T02:59:59.999Z");
  });
});
