import { describe, expect, it } from "vitest";
import {
  changeNoticeCopy,
  changeNoticeWhen,
  CLIENT_CHANGE_TEMPLATES,
  isClientChangeTemplate,
} from "../client-change-notice-copy";

const tz = "America/Sao_Paulo";
// 2026-10-10 17:30 UTC = sábado 14:30 em São Paulo.
const sabado = new Date("2026-10-10T17:30:00.000Z");
const domingo = new Date("2026-10-11T12:00:00.000Z");

describe("aviso ao cliente quando o estabelecimento muda ou cancela", () => {
  it("só cancelamento e remarcação feitos pelo estabelecimento disparam aviso", () => {
    expect([...CLIENT_CHANGE_TEMPLATES]).toEqual(["appointment.cancelled", "appointment.rescheduled"]);
    expect(isClientChangeTemplate("appointment.cancelled")).toBe(true);
    expect(isClientChangeTemplate("appointment.reschedule_accepted")).toBe(false);
    expect(isClientChangeTemplate("appointment.reschedule_requested")).toBe(false);
    expect(isClientChangeTemplate("appointment.created")).toBe(false);
  });

  it("mostra dia e hora no fuso do estabelecimento", () => {
    expect(changeNoticeWhen(sabado, tz)).toBe("sábado, 10/10, às 14:30");
    expect(changeNoticeWhen(sabado, "America/Manaus")).toBe("sábado, 10/10, às 13:30");
  });

  it("cancelamento diz o horário cancelado e o que fazer", () => {
    const copy = changeNoticeCopy({
      template: "appointment.cancelled",
      salonName: "Studio Martinelli",
      timezone: tz,
      startAt: sabado,
    });
    expect(copy.title).toBe("Seu horário foi cancelado");
    expect(copy.body).toBe(
      "Studio Martinelli cancelou seu horário de sábado, 10/10, às 14:30. Toque para ver suas reservas.",
    );
  });

  it("remarcação diz o horário antigo e o novo", () => {
    const copy = changeNoticeCopy({
      template: "appointment.rescheduled",
      salonName: "Studio Martinelli",
      timezone: tz,
      startAt: domingo,
      previousStartAt: sabado,
    });
    expect(copy.title).toBe("Seu horário foi alterado");
    expect(copy.body).toBe(
      "Studio Martinelli mudou seu horário de sábado, 10/10, às 14:30 para domingo, 11/10, às 09:00. Toque para conferir.",
    );
  });

  it("remarcação sem horário anterior ainda informa o novo", () => {
    const copy = changeNoticeCopy({
      template: "appointment.rescheduled",
      salonName: "Studio",
      timezone: tz,
      startAt: domingo,
    });
    expect(copy.body).toBe("Studio mudou seu horário para domingo, 11/10, às 09:00. Toque para conferir.");
  });
});
