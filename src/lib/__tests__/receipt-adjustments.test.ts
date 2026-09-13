import { describe, expect, it } from "vitest";
import {
  defaultReceivedDate,
  receiptDate,
  receiptAdjustmentsSchema,
} from "../receipt-adjustments";
import { predictedReturn } from "../client-return";
import { appointmentColor, categoryColor } from "../agenda-colors";
describe("recebimentos e retorno", () => {
  it("defaults to yesterday in salon timezone including month/year boundaries", () => {
    expect(
      defaultReceivedDate(
        "America/Sao_Paulo",
        new Date("2026-01-01T02:00:00Z"),
      ),
    ).toBe("2025-12-30");
    expect(
      defaultReceivedDate("Asia/Tokyo", new Date("2026-01-01T02:00:00Z")),
    ).toBe("2025-12-31");
  });
  it("rejects invalid/future dates and stores a stable time within the selected date", () => {
    const now = new Date("2026-09-13T10:00:00Z");
    expect(() => receiptDate("2026-09-14", "America/Sao_Paulo", now)).toThrow();
    expect(() => receiptDate("2026-02-30", "America/Sao_Paulo", now)).toThrow();
    expect(
      receiptDate("2026-09-12", "America/Sao_Paulo", now).toISOString(),
    ).toBe("2026-09-12T15:00:00.000Z");
    expect(receiptDate("2026-09-13", "America/Sao_Paulo", now)).toEqual(now);
  });
  it("requires a reason for positive adjustments and permits repeated extras", () => {
    expect(
      receiptAdjustmentsSchema.safeParse({
        surchargeCents: 100,
        adjustmentReason: "",
      }).success,
    ).toBe(false);
    expect(
      receiptAdjustmentsSchema.parse({ extraServiceIds: ["cut", "cut"] })
        .extraServiceIds,
    ).toHaveLength(2);
  });
  it("does not count repeated services on the same visit as a return", () => {
    expect(
      predictedReturn(
        ["2026-08-01", "2026-08-01", "2026-08-21", "2026-09-10"],
        30,
      ),
    ).toMatchObject({ date: "2026-09-30", cadence: 20, fromHistory: true });
    expect(predictedReturn(["2026-09-10", "2026-09-10"], 30)).toMatchObject({
      date: "2026-10-10",
      cadence: 30,
      fromHistory: false,
    });
  });
  it("uses a stable category palette and honors service/status overrides", () => {
    expect(categoryColor(" Cabelo ")).toBe(categoryColor("cabelo"));
    expect(
      appointmentColor("service", {
        professional: "#111111",
        service: "#FF0000",
        status: "#123456",
      }),
    ).toBe("#FF0000");
    expect(
      appointmentColor("status", {
        professional: "#111111",
        status: "#123456",
      }),
    ).toBe("#123456");
  });
});
