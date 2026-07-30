import { describe, expect, it } from "vitest";
import {
  availableSlots,
  salonDayRange,
  slotUnavailableReason,
  weekdayForDateKey,
  zonedDateAtMinutes,
} from "../booking-availability";

const timeZone = "America/Sao_Paulo";
const dateKey = "2030-01-10";
const now = new Date("2030-01-09T12:00:00.000Z");

function slot(startMinutes: number, durationMinutes = 30) {
  const startAt = zonedDateAtMinutes(dateKey, startMinutes, timeZone);
  const endAt = new Date(startAt.getTime() + durationMinutes * 60_000);
  return { startAt, endAt };
}

function rules(
  overrides: Partial<Parameters<typeof slotUnavailableReason>[0]> = {},
) {
  return {
    ...slot(9 * 60),
    now,
    timeZone,
    salonOpenMinutes: 8 * 60,
    salonCloseMinutes: 20 * 60,
    workingHours: [{ startMinutes: 9 * 60, endMinutes: 18 * 60 }],
    timeOffs: [],
    appointments: [],
    ...overrides,
  };
}

describe("regras centrais de disponibilidade", () => {
  it("converte o horário civil do salão para o instante UTC correto", () => {
    expect(zonedDateAtMinutes(dateKey, 9 * 60, timeZone).toISOString()).toBe(
      "2030-01-10T12:00:00.000Z",
    );
    expect(weekdayForDateKey(dateKey)).toBe(4);
  });

  it("calcula o dia do salão sem depender do timezone do servidor", () => {
    const range = salonDayRange(dateKey, timeZone);
    expect(range.startAt.toISOString()).toBe("2030-01-10T03:00:00.000Z");
    expect(range.endAt.toISOString()).toBe("2030-01-11T03:00:00.000Z");
  });

  it("rejeita horário passado, fora da jornada e fora da grade", () => {
    expect(
      slotUnavailableReason(
        rules({ now: new Date("2030-01-10T12:01:00.000Z") }),
      ),
    ).toBe("PAST_TIME");
    expect(
      slotUnavailableReason(
        rules({
          ...slot(8 * 60),
          workingHours: [{ startMinutes: 9 * 60, endMinutes: 18 * 60 }],
        }),
      ),
    ).toBe("OUTSIDE_WORKING_HOURS");
    expect(
      slotUnavailableReason(rules({ ...slot(9 * 60 + 7) })),
    ).toBe("INVALID_SLOT");
  });

  it("rejeita folga, conflito e serviço que cruza o fim do dia", () => {
    const candidate = slot(9 * 60);
    expect(
      slotUnavailableReason(
        rules({ timeOffs: [{ ...candidate }] }),
      ),
    ).toBe("PROFESSIONAL_UNAVAILABLE");
    expect(
      slotUnavailableReason(
        rules({ appointments: [{ ...candidate }] }),
      ),
    ).toBe("SLOT_TAKEN");
    expect(
      slotUnavailableReason(
        rules({
          ...slot(23 * 60 + 45, 30),
          salonOpenMinutes: 0,
          salonCloseMinutes: 1_440,
          workingHours: [{ startMinutes: 0, endMinutes: 1_440 }],
        }),
      ),
    ).toBe("INVALID_SLOT");
  });

  it("gera apenas slots integralmente livres e dentro do salão", () => {
    const blocked = slot(9 * 60 + 30);
    expect(
      availableSlots({
        dateKey,
        durationMinutes: 30,
        now,
        timeZone,
        salonOpenMinutes: 9 * 60,
        salonCloseMinutes: 10 * 60 + 30,
        workingHours: [
          { startMinutes: 8 * 60, endMinutes: 10 * 60 + 30 },
        ],
        timeOffs: [blocked],
        appointments: [],
      }),
    ).toEqual(["09:00", "10:00"]);
  });
});
