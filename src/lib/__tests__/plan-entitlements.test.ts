import { describe, expect, it } from "vitest";
import {
  PlanLimitError,
  assertMonthlyAppointmentCapacity,
  assertPlanFeature,
  assertProfessionalCapacity,
  canUsePlanFeature,
  getPlanEntitlement,
} from "../plan-entitlements";

describe("limites comerciais dos planos", () => {
  it("mantém os limites do Grátis pequenos, mas utilizáveis", () => {
    expect(getPlanEntitlement("FREE")).toMatchObject({
      maxProfessionals: 1,
      monthlyAppointments: 30,
    });
    expect(canUsePlanFeature("FREE", "MARKETING")).toBe(false);
    expect(canUsePlanFeature("PRO", "MARKETING")).toBe(true);
  });

  it("considera convites pendentes para não vender mais agendas que o plano", () => {
    expect(() =>
      assertProfessionalCapacity({
        plan: "FREE",
        activeProfessionals: 1,
      }),
    ).toThrow(PlanLimitError);

    expect(() =>
      assertProfessionalCapacity({
        plan: "PRO",
        activeProfessionals: 2,
        pendingProfessionalInvites: 1,
      }),
    ).toThrow("até 3");

    expect(() =>
      assertProfessionalCapacity({
        plan: "PRO",
        activeProfessionals: 2,
        pendingProfessionalInvites: 0,
      }),
    ).not.toThrow();
  });

  it("bloqueia a cota mensal no limite exato e libera planos pagos", () => {
    expect(() =>
      assertMonthlyAppointmentCapacity({ plan: "FREE", appointmentsThisMonth: 30 }),
    ).toThrow("30 agendamentos");
    expect(() =>
      assertMonthlyAppointmentCapacity({ plan: "FREE", appointmentsThisMonth: 29 }),
    ).not.toThrow();
    expect(() =>
      assertMonthlyAppointmentCapacity({ plan: "PRO", appointmentsThisMonth: 10_000 }),
    ).not.toThrow();
  });

  it("bloqueia recurso avançado com mensagem de upgrade", () => {
    expect(() => assertPlanFeature("FREE", "PACKAGES")).toThrow(
      "plano Fundador",
    );
    expect(() => assertPlanFeature("STARTER", "PACKAGES")).not.toThrow();
  });
});
