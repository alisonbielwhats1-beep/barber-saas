import { describe, expect, it } from "vitest";
import {
  AppointmentError,
  assertOperationalStatusTime,
  assertStatusTransition,
  checkClientChangePolicy,
} from "../appointment-domain";

const now = new Date("2026-08-06T12:00:00.000Z");

describe("regras de domínio do agendamento", () => {
  it("permite cancelamento exatamente no limite configurado", () => {
    expect(
      checkClientChangePolicy({
        status: "CONFIRMED",
        startAt: new Date("2026-08-06T14:00:00.000Z"),
        cancelPolicyHours: 2,
        now,
      }),
    ).toEqual({ allowed: true });
  });

  it("bloqueia cancelamento tardio, iniciado e encerrado com códigos distintos", () => {
    expect(
      checkClientChangePolicy({
        status: "CONFIRMED",
        startAt: new Date("2026-08-06T13:59:59.999Z"),
        cancelPolicyHours: 2,
        now,
      }),
    ).toEqual({ allowed: false, code: "TOO_LATE" });
    expect(
      checkClientChangePolicy({
        status: "CONFIRMED",
        startAt: now,
        cancelPolicyHours: 0,
        now,
      }),
    ).toEqual({ allowed: false, code: "ALREADY_STARTED" });
    expect(
      checkClientChangePolicy({
        status: "IN_PROGRESS",
        startAt: new Date("2026-08-10T12:00:00.000Z"),
        cancelPolicyHours: 0,
        now,
      }),
    ).toEqual({ allowed: false, code: "ALREADY_STARTED" });
    expect(
      checkClientChangePolicy({
        status: "CANCELLED",
        startAt: new Date("2026-08-10T12:00:00.000Z"),
        cancelPolicyHours: 0,
        now,
      }),
    ).toEqual({ allowed: false, code: "ALREADY_CLOSED" });
  });

  it("aceita transições operacionais e rejeita reabertura de encerrados", () => {
    expect(() => assertStatusTransition("CONFIRMED", "IN_PROGRESS")).not.toThrow();
    expect(() => assertStatusTransition("IN_PROGRESS", "COMPLETED")).not.toThrow();
    expect(() => assertStatusTransition("COMPLETED", "CONFIRMED")).toThrow(
      AppointmentError,
    );
  });

  it.each(["IN_PROGRESS", "COMPLETED", "NO_SHOW"] as const)(
    "bloqueia %s antes do início contratado",
    (status) => {
      expect(() => assertOperationalStatusTime(
        status,
        new Date("2026-08-06T12:00:00.001Z"),
        now,
      )).toThrowError(expect.objectContaining({ code: "NOT_STARTED_YET" }));
    },
  );

  it("permite a operação exatamente no horário de início", () => {
    expect(() => assertOperationalStatusTime("IN_PROGRESS", now, now)).not.toThrow();
    expect(() => assertOperationalStatusTime("COMPLETED", now, now)).not.toThrow();
  });
});
