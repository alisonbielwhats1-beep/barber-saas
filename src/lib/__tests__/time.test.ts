import { afterAll, beforeAll, describe, expect, it } from "vitest";
import {
  InvalidTimeZoneError,
  InvalidWallClockError,
  addCalendarDays,
  dateRangeInTimeZone,
  hhmmInTimeZone,
  isDateKey,
  localDateTimeToUtc,
  toLocalDateTime,
} from "../time";

describe("política central de timezone", () => {
  const originalTZ = process.env.TZ;

  beforeAll(() => {
    process.env.TZ = "UTC";
  });

  afterAll(() => {
    process.env.TZ = originalTZ;
  });

  it("mantém 10:00 em São Paulo em toda leitura, mesmo salvando 13:00Z", () => {
    const stored = localDateTimeToUtc(
      "2026-08-06T10:00",
      "America/Sao_Paulo",
    );

    expect(stored.toISOString()).toBe("2026-08-06T13:00:00.000Z");
    expect(toLocalDateTime(stored, "America/Sao_Paulo")).toBe(
      "2026-08-06T10:00",
    );
    expect(hhmmInTimeZone(stored, "America/Sao_Paulo")).toBe("10:00");
  });

  it("usa o fuso configurado por estabelecimento, não um offset fixo", () => {
    expect(
      localDateTimeToUtc("2026-07-10T10:00", "America/New_York").toISOString(),
    ).toBe("2026-07-10T14:00:00.000Z");
    expect(
      localDateTimeToUtc("2026-07-10T10:00", "America/Manaus").toISOString(),
    ).toBe("2026-07-10T14:00:00.000Z");
  });

  it("rejeita horário inexistente ou ambíguo em mudança de DST", () => {
    expect(() =>
      localDateTimeToUtc("2026-03-08T02:30", "America/New_York"),
    ).toThrow(InvalidWallClockError);
    expect(() =>
      localDateTimeToUtc("2026-11-01T01:30", "America/New_York"),
    ).toThrow(InvalidWallClockError);
  });

  it("calcula intervalos de calendário [início, fim) inclusive em dia de 23h", () => {
    const range = dateRangeInTimeZone(
      "2026-03-08",
      "2026-03-08",
      "America/New_York",
    );

    expect(range.from.toISOString()).toBe("2026-03-08T05:00:00.000Z");
    expect(range.to.toISOString()).toBe("2026-03-09T04:00:00.000Z");
    expect(range.to.getTime() - range.from.getTime()).toBe(23 * 60 * 60 * 1_000);
  });

  it("valida datas de calendário sem depender do fuso do processo", () => {
    expect(isDateKey("2028-02-29")).toBe(true);
    expect(isDateKey("2027-02-29")).toBe(false);
    expect(addCalendarDays("2026-12-31", 1)).toBe("2027-01-01");
  });

  it("falha fechado para timezone IANA ausente ou inválido", () => {
    expect(() => localDateTimeToUtc("2026-08-06T10:00", "")).toThrow(
      InvalidTimeZoneError,
    );
    expect(() =>
      localDateTimeToUtc("2026-08-06T10:00", "America/Nowhere"),
    ).toThrow(InvalidTimeZoneError);
  });
});
