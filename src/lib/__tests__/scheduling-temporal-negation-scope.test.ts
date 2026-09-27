import { describe, expect, it } from "vitest";
import { groundSchedulingTemporal, temporalLiteralNegated } from "../scheduling-temporal-source";
import type { SchedulingFields } from "../scheduling-contract";
import type { SchedulingTemporalEvidence } from "../../../packages/salon-secretary/src/scheduling-skill";

const now = new Date("2026-09-28T12:00:00Z"), tz = "America/Sao_Paulo";
const ground = (operation: string, source: string, raw: SchedulingFields, evidence: SchedulingTemporalEvidence, previous: SchedulingFields = {}) =>
  groundSchedulingTemporal(previous, raw, source, tz, now, undefined, operation, evidence);

describe("a denial scopes only the clause of the literal it governs", () => {
  it.each([
    ["appointment.cancel", "Cancela o João das 14h, ele não vai poder vir", { customer_name: "João", time: "14:00", reason: "ele não vai poder vir" }, [{ field: "time", text: "das 14h" }], { time: "14:00" }],
    ["appointment.cancel", "Cancela o João das 14h que ele não vem mais", { customer_name: "João", time: "14:00" }, [{ field: "time", text: "das 14h" }], { time: "14:00" }],
    ["schedule.block", "Bloqueia a Tatiana das 14h às 18h, ela não vem", { professional_name: "Tatiana", time: "14:00", end_time: "18:00" }, [{ field: "time", text: "das 14h" }, { field: "end_time", text: "às 18h" }], { time: "14:00", end_time: "18:00" }],
    ["appointment.change", "Passa a Amanda para 11h, não 10h", { customer_name: "Amanda", time: "11:00" }, [{ field: "time", text: "para 11h" }], { time: "11:00" }],
    ["appointment.create", "Marca a Amanda amanhã às 10h para Corte Completo, não precisa de encaixe", { customer_name: "Amanda", day_offset: 1, time: "10:00" }, [{ field: "date", text: "amanhã" }, { field: "time", text: "às 10h" }], { date: "2026-09-29", time: "10:00" }],
    ["appointment.create", "Marca a Amanda amanhã às 10h e não precisa encaixar", { customer_name: "Amanda", day_offset: 1, time: "10:00" }, [{ field: "date", text: "amanhã" }, { field: "time", text: "às 10h" }], { date: "2026-09-29", time: "10:00" }],
    ["appointment.create", "Amanhã não dá, marca a Amanda na quinta às 10h", { customer_name: "Amanda", weekday: 4, time: "10:00" }, [{ field: "date", text: "quinta" }, { field: "time", text: "às 10h" }], { date: "2026-10-01", time: "10:00" }],
    ["availability.get", "Qual horário a Tatiana tem amanhã, não quinta?", { professional_name: "Tatiana", day_offset: 1 }, [{ field: "date", text: "amanhã" }], { date: "2026-09-29" }],
  ] as const)("%s keeps a positive literal outside the denied clause: %s", (operation, source, raw, evidence, expected) => {
    const result = ground(operation, source, raw as SchedulingFields, evidence as unknown as SchedulingTemporalEvidence);
    expect(result.rejected).toEqual([]);
    expect(result.fields).toMatchObject(expected);
  });

  it.each([
    ["appointment.create", "Não marca a Amanda amanhã às 10h", { day_offset: 1, time: "10:00" }, [{ field: "date", text: "amanhã" }, { field: "time", text: "às 10h" }], ["date", "time"]],
    ["appointment.cancel", "Não quero que cancele o João das 14h", { time: "14:00" }, [{ field: "time", text: "das 14h" }], ["time"]],
    ["appointment.create", "Amanhã não, marca quinta às 10h", { day_offset: 1, time: "10:00" }, [{ field: "date", text: "Amanhã" }, { field: "time", text: "às 10h" }], ["date"]],
    ["appointment.change", "Passa a Amanda para 11h, não 10h", { time: "10:00" }, [{ field: "time", text: "não 10h" }], ["time"]],
    ["appointment.create", "Às 10h não dá para a Amanda", { time: "10:00" }, [{ field: "time", text: "Às 10h" }], ["time"]],
    ["appointment.create", "Nunca marque a Amanda na quinta às 10h", { weekday: 4, time: "10:00" }, [{ field: "date", text: "quinta" }, { field: "time", text: "às 10h" }], ["date", "time"]],
  ] as const)("%s rejects a literal governed by a denial in its own clause: %s", (operation, source, raw, evidence, rejectedFields) => {
    const result = ground(operation, source, raw as SchedulingFields, evidence as unknown as SchedulingTemporalEvidence);
    expect(result.rejected.map(item => item.field).sort()).toEqual([...rejectedFields].sort());
    for (const field of rejectedFields) expect(result.fields[field as keyof SchedulingFields]).toBeUndefined();
  });

  it("treats a missing or denied literal span as negated (fail-closed)", () => {
    expect(temporalLiteralNegated("marca as 10h", -1, 3)).toBe(true);
    expect(temporalLiteralNegated("marca as 10h", 5, 5)).toBe(true);
    expect(temporalLiteralNegated("marca nao as 10h", 10, 16)).toBe(true);
    expect(temporalLiteralNegated("marca as 10h, nao as 11h", 6, 12)).toBe(false);
  });
});
