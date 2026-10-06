import { describe, expect, it } from "vitest";
import { groundSchedulingTemporal } from "../scheduling-temporal-source";
import type { SchedulingFields } from "../scheduling-contract";

// Sunday 2026-09-27, 12:00 in São Paulo: amanhã = 2026-09-28, sexta = 2026-10-02.
const now = new Date("2026-09-27T15:00:00Z"), tz = "America/Sao_Paulo";
type Evidence = { field: "date" | "time" | "source_date" | "source_time" | "end_date" | "end_time"; text: string }[];
const block = (source: string, fields: SchedulingFields, evidence: Evidence) =>
  groundSchedulingTemporal({}, fields, source, tz, now, undefined, "schedule.block", evidence);

describe("schedule.block with the day written AFTER its interval ('das 10 às 11 do dia 28')", () => {
  it("proves the block day from the trailing date and does not demand an end date", () => {
    const result = block("feche a agenda do profissional Rodrigo das 10 às 11 do dia 28", { date: "2026-09-28", time: "10:00", end_time: "11:00" },
      [{ field: "date", text: "dia 28" }, { field: "time", text: "das 10" }, { field: "end_time", text: "às 11" }]);
    expect(result.rejected).toEqual([]);
    expect(result.fields).toEqual({ date: "2026-09-28", time: "10:00", end_time: "11:00" });
  });
  it("accepts the short literals a real Luna sent ('10', '11', 'dia 29')", () => {
    const result = block("feche a agenda do profissional Rodrigo das 10 às 11 do dia 29", { date: "2026-09-29", time: "10:00", end_time: "11:00" },
      [{ field: "date", text: "dia 29" }, { field: "time", text: "10" }, { field: "end_time", text: "11" }]);
    expect(result.rejected).toEqual([]);
    expect(result.fields).toEqual({ date: "2026-09-29", time: "10:00", end_time: "11:00" });
  });
  it.each([
    ["relative day", "feche a agenda do Rodrigo das 10 às 11 de amanhã", { day_offset: 1, time: "10:00", end_time: "11:00" },
      [{ field: "date", text: "amanhã" }, { field: "time", text: "das 10" }, { field: "end_time", text: "às 11" }], { date: "2026-09-28", time: "10:00", end_time: "11:00" }],
    ["weekday with 'h' clocks", "fecha a agenda do Rodrigo das 14h às 18h de sexta", { weekday: 5, time: "14:00", end_time: "18:00" },
      [{ field: "date", text: "sexta" }, { field: "time", text: "das 14h" }, { field: "end_time", text: "às 18h" }], { date: "2026-10-02", time: "14:00", end_time: "18:00" }],
    ["caps without accents", "FECHE A AGENDA DO RODRIGO DAS 10 AS 11 DO DIA 28", { date: "2026-09-28", time: "10:00", end_time: "11:00" },
      [{ field: "date", text: "dia 28" }, { field: "time", text: "das 10" }, { field: "end_time", text: "às 11" }], { date: "2026-09-28", time: "10:00", end_time: "11:00" }],
    ["reason after the date", "trava a agenda da Tatiana das 9 às 12 do dia 28 porque ela vai ao médico", { date: "2026-09-28", time: "09:00", end_time: "12:00" },
      [{ field: "date", text: "do dia 28" }, { field: "time", text: "das 9" }, { field: "end_time", text: "às 12" }], { date: "2026-09-28", time: "09:00", end_time: "12:00" }],
  ] as const)("%s", (_label, source, fields, evidence, expected) => {
    const result = block(source, fields as SchedulingFields, evidence as unknown as Evidence);
    expect(result.rejected).toEqual([]);
    expect(result.fields).toEqual(expected);
  });
  it("still re-parses the trailing date: a wrong day is rejected, never corrected", () => {
    const result = block("feche a agenda do profissional Rodrigo das 10 às 11 do dia 28", { date: "2026-09-29", time: "10:00", end_time: "11:00" },
      [{ field: "date", text: "dia 28" }, { field: "time", text: "das 10" }, { field: "end_time", text: "às 11" }]);
    expect(result.fields.date).toBeUndefined();
    expect(result.rejected).toEqual([expect.objectContaining({ code: "SOURCE_TEMPORAL_CONFLICT", field: "date" })]);
  });
  it("a trailing date the model did not send is still asked as the block day", () => {
    const result = block("feche a agenda do profissional Rodrigo das 10 às 11 do dia 28", { time: "10:00", end_time: "11:00" },
      [{ field: "time", text: "das 10" }, { field: "end_time", text: "às 11" }]);
    expect(result.fields.date).toBeUndefined();
    expect(result.rejected).toEqual([expect.objectContaining({ field: "date", value: "MISSING" })]);
    expect(result.rejected.map(item => item.field)).not.toContain("end_date");
  });
  it("an end date equal to the start day, quoted from the same trailing atom, is still one day", () => {
    const result = block("feche a agenda do profissional Rodrigo das 10 às 11 do dia 28", { date: "2026-09-28", end_date: "2026-09-28", time: "10:00", end_time: "11:00" },
      [{ field: "date", text: "dia 28" }, { field: "end_date", text: "dia 28" }, { field: "time", text: "das 10" }, { field: "end_time", text: "às 11" }]);
    expect(result.rejected).toEqual([]);
    expect(result.fields).toEqual({ date: "2026-09-28", end_date: "2026-09-28", time: "10:00", end_time: "11:00" });
  });
  it("a different end date is never inferred from the single trailing atom", () => {
    const result = block("feche a agenda do profissional Rodrigo das 10 às 11 do dia 28", { date: "2026-09-27", end_date: "2026-09-28", time: "10:00", end_time: "11:00" },
      [{ field: "date", text: "dia 28" }, { field: "end_date", text: "dia 28" }, { field: "time", text: "das 10" }, { field: "end_time", text: "às 11" }]);
    expect(result.fields.date).toBeUndefined();
  });
  it("a date before the interval keeps working", () => {
    const result = block("feche a agenda do Rodrigo amanhã das 10 às 11", { day_offset: 1, time: "10:00", end_time: "11:00" },
      [{ field: "date", text: "amanhã" }, { field: "time", text: "das 10" }, { field: "end_time", text: "às 11" }]);
    expect(result.rejected).toEqual([]);
    expect(result.fields).toEqual({ date: "2026-09-28", time: "10:00", end_time: "11:00" });
  });
  it("a real multi-day block (start day in the start clause) still requires end_date", () => {
    const result = block("Bloqueia o Rodrigo de sexta às 18h até segunda às 9h", { weekday: 5, time: "18:00", end_time: "09:00" },
      [{ field: "date", text: "sexta" }, { field: "time", text: "às 18h" }, { field: "end_time", text: "às 9h" }]);
    expect(result.fields.end_date).toBeUndefined();
    expect(result.rejected).toEqual(expect.arrayContaining([expect.objectContaining({ field: "end_date", value: "MISSING" })]));
  });
  it.each([
    ["a following sibling clause", "Fecha a agenda do Rodrigo das 10 às 11 e cancela a Amanda de amanhã."],
    ["a reason after the block", "Fecha a agenda do Rodrigo das 10 às 11 porque ele vai ao médico amanhã."],
    ["a clause after a comma", "Fecha a agenda do Rodrigo das 10 às 11, a Amanda viaja amanhã."],
  ])("SAFETY: a date in %s is not the block day", (_label, source) => {
    const result = block(source, { day_offset: 1, time: "10:00", end_time: "11:00" },
      [{ field: "date", text: "amanhã" }, { field: "time", text: "das 10" }, { field: "end_time", text: "às 11" }]);
    expect(result.fields.date).toBeUndefined();
    expect(result.rejected).toEqual(expect.arrayContaining([expect.objectContaining({ code: "SOURCE_TEMPORAL_CONFLICT", field: "date" })]));
    expect(result.fields).toMatchObject({ time: "10:00", end_time: "11:00" });
  });
  it("two dates after the interval are not one block day", () => {
    const result = block("bloqueia o Rodrigo das 10 às 11 de sexta até segunda", { weekday: 5, time: "10:00", end_time: "11:00" },
      [{ field: "date", text: "sexta" }, { field: "time", text: "das 10" }, { field: "end_time", text: "às 11" }]);
    expect(result.fields.date).toBeUndefined();
  });
});
