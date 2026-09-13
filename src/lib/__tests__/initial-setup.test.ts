import { describe, expect, it } from "vitest";
import {
  setupChecks,
  setupEntryHref,
  setupHoursSchema,
  setupReturnHref,
  setupServiceSchema,
  shouldStartSetup,
  type SetupData,
} from "../initial-setup";

export function setupFixture(): SetupData {
  return {
    salon: {
      name: "Espaço de teste",
      slug: "espaco-teste",
      address: null,
      phone: null,
      timezone: "America/Sao_Paulo",
      openMinutes: 540,
      closeMinutes: 1080,
    },
    userId: "owner",
    userName: "Alex",
    services: [],
    professionals: [],
    hours: [],
    hoursConfirmed: false,
    status: "new",
    step: 0,
    hasAppointments: false,
  };
}

describe("configuração inicial", () => {
  it("abre para proprietário novo; respeita adiamento, equipe e operação existente", () => {
    const data = setupFixture();
    expect(shouldStartSetup(data, "OWNER")).toBe(true);
    for (const role of ["MANAGER", "PROFESSIONAL", "RECEPTIONIST"])
      expect(shouldStartSetup(data, role)).toBe(false);
    expect(shouldStartSetup({ ...data, status: "deferred" }, "OWNER")).toBe(
      false,
    );
    expect(shouldStartSetup({ ...data, status: "active" }, "OWNER")).toBe(
      false,
    );
    expect(shouldStartSetup({ ...data, hasAppointments: true }, "OWNER")).toBe(
      false,
    );
  });
  it("exige preço revisado e jornada compatível do mesmo profissional, sem primeira reserva", () => {
    const data = setupFixture();
    data.hoursConfirmed = true;
    data.services = [
      {
        id: "s1",
        name: "Corte",
        priceCents: 0,
        durationMin: 60,
        reviewed: false,
      },
    ];
    data.professionals = [
      {
        id: "p1",
        userId: "owner",
        name: "Alex",
        serviceIds: ["s1"],
        hours: [{ weekday: 1, startMinutes: 540, endMinutes: 570 }],
      },
    ];
    expect(setupChecks(data)).toEqual([true, false, false, false]);
    data.services[0].reviewed = true;
    data.professionals.push({
      id: "p2",
      userId: "other",
      name: "Outra",
      serviceIds: [],
      hours: [{ weekday: 1, startMinutes: 540, endMinutes: 1080 }],
    });
    expect(setupChecks(data)[2]).toBe(false);
    data.professionals[0].hours[0].endMinutes = 600;
    expect(setupChecks(data)).toEqual([true, true, true, false]);
    expect(shouldStartSetup(data, "OWNER")).toBe(false);
    data.status = "completed";
    expect(setupChecks(data)).toEqual([true, true, true, true]);
  });
  it("aceita pausa e meia-noite, rejeita dia vazio, sobreposição e intervalo invertido", () => {
    expect(setupHoursSchema.safeParse([]).success).toBe(false);
    const hours = [
      { weekday: 1, startMinutes: 540, endMinutes: 720 },
      { weekday: 1, startMinutes: 780, endMinutes: 1440 },
    ];
    expect(setupHoursSchema.safeParse(hours).success).toBe(true);
    expect(
      setupHoursSchema.safeParse([
        ...hours,
        { weekday: 1, startMinutes: 700, endMinutes: 800 },
      ]).success,
    ).toBe(false);
    expect(
      setupHoursSchema.safeParse([
        { weekday: 0, startMinutes: 900, endMinutes: 800 },
      ]).success,
    ).toBe(false);
  });
  it("zero exige confirmação explícita", () => {
    const input = {
      name: "Corte",
      durationMin: 30,
      priceCents: 0,
      freeConfirmed: false,
    };
    expect(setupServiceSchema.safeParse(input).success).toBe(false);
    expect(
      setupServiceSchema.safeParse({ ...input, freeConfirmed: true }).success,
    ).toBe(true);
  });
  it("preserva intenção de assinatura sem permitir retorno externo", () => {
    const path = "/assinatura?billingPlan=EQUIPE&cycle=ANNUAL";
    expect(setupReturnHref(path)).toBe(path);
    expect(setupEntryHref(path)).toContain(encodeURIComponent(path));
    for (const value of [
      "//evil.test",
      "https://evil.test",
      "/\\evil.test",
      "/plataforma",
      "/onboarding/configuracao",
    ])
      expect(setupReturnHref(value)).toBe("/dashboard");
  });
});
