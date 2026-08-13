import { describe, expect, it } from "vitest";
import { canOpenAppointmentCheckout } from "../../app/(admin)/agenda/agenda-status";

const now = new Date("2026-08-13T15:00:00.000Z");

describe("disponibilidade da comanda", () => {
  it("não permite pré-pagamento antes do início", () => {
    expect(canOpenAppointmentCheckout({
      status: "CONFIRMED",
      hasPayment: false,
      startAt: new Date("2026-08-13T15:00:00.001Z"),
      now,
    })).toBe(false);
  });

  it("permite receber um atendimento concluído sem pagamento", () => {
    expect(canOpenAppointmentCheckout({
      status: "COMPLETED",
      hasPayment: false,
      startAt: new Date("2026-08-13T14:00:00.000Z"),
      now,
    })).toBe(true);
  });

  it("não reabre comanda já paga ou encerrada sem recebimento", () => {
    expect(canOpenAppointmentCheckout({
      status: "COMPLETED",
      hasPayment: true,
      startAt: new Date("2026-08-13T14:00:00.000Z"),
      now,
    })).toBe(false);
    expect(canOpenAppointmentCheckout({
      status: "CANCELLED",
      hasPayment: false,
      startAt: new Date("2026-08-13T14:00:00.000Z"),
      now,
    })).toBe(false);
  });
});
