import { describe, expect, it } from "vitest";
import { createActionPlan, patchPlanAction } from "@everflair/salon-secretary";
import { intent, plan } from "../../test/secretary-capability-plan";
import { groundSchedulingTemporal } from "../scheduling-temporal-source";
import type { SchedulingFields } from "../scheduling-contract";

type Evidence = { field: "date" | "time" | "source_date" | "source_time" | "end_date" | "end_time"; text: string }[];
const now = new Date("2026-09-26T12:00:00Z");
const ground = (source: string, fields: SchedulingFields, evidence: Evidence, operation = "appointment.change", previous: SchedulingFields = {}, waitingFor?: string) =>
  groundSchedulingTemporal(previous, fields, source, "America/Sao_Paulo", now, waitingFor, operation, evidence);

describe("temporal evidence binds literal facts to the model's semantic roles", () => {
  it.each([
    ["Para amanhã às 9h, muda o atendimento de hoje às 11h.", "amanhã às 9h", "hoje às 11h"],
    ["A reserva está hoje às 11h; amanhã às 9h é o destino desejado.", "amanhã às 9h", "hoje às 11h"],
    ["amanhã às 9h é quando quero. O horário original é hoje às 11h.", "amanhã às 9h", "hoje às 11h"],
  ])("preserves order-independent source/destination: %s", (source, target, original) => {
    const fields = { source_day_offset: 0, source_time: "11:00", day_offset: 1, time: "09:00" };
    const result = ground(source, fields, [{ field: "date", text: target }, { field: "time", text: target }, { field: "source_date", text: original }, { field: "source_time", text: original }]);
    expect(result.rejected).toEqual([]);
    expect(result.fields).toEqual({ source_date: "2026-09-26", source_time: "11:00", date: "2026-09-27", time: "09:00" });
  });

  it("grounds one action without confusing independent dates and times of sibling actions", () => {
    const source = "Marca um corte amanhã às 10h e bloqueia minha agenda depois de amanhã das 15h até 16h.";
    const result = ground(source, { day_offset: 1, time: "10:00" }, [{ field: "date", text: "amanhã às 10h" }, { field: "time", text: "amanhã às 10h" }], "appointment.create");
    expect(result.rejected).toEqual([]);
    expect(result.fields).toEqual({ date: "2026-09-27", time: "10:00" });
  });

  it("grounds interval end before start without treating the two clocks as contradictory", () => {
    const source = "Até 16h de amanhã fica bloqueado. O começo é às 14h de amanhã.";
    const result = ground(source, { day_offset: 1, time: "14:00", end_date: "2026-09-27", end_time: "16:00" }, [
      { field: "date", text: "às 14h de amanhã" }, { field: "time", text: "às 14h de amanhã" },
      { field: "end_date", text: "Até 16h de amanhã" }, { field: "end_time", text: "Até 16h de amanhã" },
    ], "schedule.block");
    expect(result.rejected).toEqual([]);
  });
});

describe("temporal evidence cannot weaken factual and role guards", () => {
  it.each(["domingo", "segunda", "terça", "quarta", "quinta", "sexta", "sábado"])("rejects wrong weekday even with a literal %s witness", name => {
    const weekday = ["domingo", "segunda", "terça", "quarta", "quinta", "sexta", "sábado"].indexOf(name);
    expect(ground(name, { weekday }, [{ field: "date", text: name }]).rejected).toEqual([]);
    const wrong = ground(name, { weekday: (weekday + 1) % 7 }, [{ field: "date", text: name }]);
    expect(wrong.fields.date).toBeUndefined();
    expect(wrong.rejected).toEqual([expect.objectContaining({ field: "date", code: "SOURCE_TEMPORAL_CONFLICT" })]);
  });

  it.each([
    ["depois de amanhã", { day_offset: 1 }, "date", "amanhã"],
    ["às duas da tarde", { time: "02:00" }, "time", "às duas"],
    ["às dez e meia", { time: "10:00" }, "time", "dez"],
    ["às vinte e uma e quinze", { time: "21:00" }, "time", "vinte e uma"],
    ["domingo 03/10/2026", { date: "2026-09-27" }, "date", "domingo"],
    ["às 11h30", { time: "11:00" }, "time", "11h"],
    ["27/09/2026", { date: "2026-09-28" }, "date", "27/09"],
    ["domingo 03/10/2026", { date: "2026-10-03" }, "date", "domingo 03/10/2026"],
    ["não marque domingo", { weekday: 0 }, "date", "domingo"],
    ["não no domingo, pode segunda", { weekday: 0 }, "date", "domingo"],
  ] as const)("does not accept contradictory or truncated temporal evidence: %s", (source, fields, field, text) => {
    const result = ground(source, fields, [{ field, text }]);
    expect(result.fields[field]).toBeUndefined();
    expect(result.rejected).toContainEqual(expect.objectContaining({ field, code: "SOURCE_TEMPORAL_CONFLICT" }));
  });

  it.each(["sábado", "o atendimento", "Domingo"])("rejects unproven literal witness %s", text => {
    expect(ground("o atendimento domingo", { weekday: 0 }, [{ field: "date", text }]).fields.date).toBeUndefined();
  });

  it("rejects a correct quoted clock attached to the wrong explicit role", () => {
    const source = "Muda de hoje às 11h para amanhã às 9h";
    const result = ground(source, { source_day_offset: 1, source_time: "09:00", day_offset: 0, time: "11:00" }, [
      { field: "source_date", text: "amanhã" }, { field: "source_time", text: "9h" },
      { field: "date", text: "hoje" }, { field: "time", text: "11h" },
    ]);
    expect(result.rejected.map(item => item.field).sort()).toEqual(["date", "source_date", "source_time", "time"]);
  });

  it("accepts literal prepositions without making the owner learn a quote syntax", () => {
    const result = ground("Muda das 11h para amanhã às 9h", { source_time: "11:00", day_offset: 1, time: "09:00" }, [
      { field: "source_time", text: "das 11h" }, { field: "date", text: "para amanhã" }, { field: "time", text: "às 9h" },
    ]);
    expect(result.rejected).toEqual([]);
  });

  it("does not silently broaden source selection when the model omits its explicit clock", () => {
    const result = ground("Muda das 11h para amanhã às 9h", { day_offset: 1, time: "09:00" }, [
      { field: "date", text: "amanhã" }, { field: "time", text: "9h" },
    ]);
    expect(result.rejected).toContainEqual({ field: "source_time", code: "SOURCE_TEMPORAL_CONFLICT", value: "MISSING" });
  });

  it("a short answer cannot retarget the pending source clock to the destination", () => {
    const result = ground("11h", { time: "11:00" }, [{ field: "time", text: "11h" }], "appointment.change", { time: "09:00" }, "source_time");
    expect(result.rejected.map(item => item.field).sort()).toEqual(["source_time", "time"]);
  });

  it("retains independent accepted clocks during an explicit correction", () => {
    const previous = { source_date: "2026-09-26", source_time: "11:00", date: "2026-09-27", time: "09:00", customer_ref: "customer-a" };
    const result = ground("Não, coloca às 10h.", { time: "10:00" }, [{ field: "time", text: "às 10h" }], "appointment.change", previous);
    expect(result.rejected).toEqual([]);
    expect(result.fields).toEqual({ ...previous, time: "10:00" });
  });

  it("requires one evidence entry per provided role and never revives a rejected value", () => {
    const previous = { date: "2026-09-27", time: "09:00", source_time: "11:00", appointment_ref: "appointment-a" };
    const result = ground("às 10h", { time: "10:00" }, [{ field: "time", text: "10h" }, { field: "time", text: "às 10h" }], "appointment.change", previous);
    expect(result.fields).toEqual({ date: "2026-09-27", source_time: "11:00" });
    expect(result.patch.time).toBeUndefined();
    expect(result.rejected).toEqual([{ field: "time", code: "SOURCE_TEMPORAL_CONFLICT", value: "10:00" }]);
  });

  it("keeps relative dates grounded in salon timezone, not UTC", () => {
    const at = new Date("2026-09-27T01:00:00Z");
    const evidence: Evidence = [{ field: "date", text: "hoje" }];
    expect(groundSchedulingTemporal({}, { date: "2026-09-26" }, "hoje", "America/Sao_Paulo", at, undefined, "appointment.create", evidence).rejected).toEqual([]);
    expect(groundSchedulingTemporal({}, { date: "2026-09-27" }, "hoje", "America/Sao_Paulo", at, undefined, "appointment.create", evidence).fields.date).toBeUndefined();
  });
});

it("ActionPlan does not carry quotations from an earlier turn into a new patch", () => {
  const original = createActionPlan(plan([intent("appointment.change", { item_key: "move", customer_name: "Amanda", time: "09:00", temporal_evidence: [{ field: "time", text: "9h" }] })]));
  const changed = patchPlanAction(original, "move", { time: "10:00" });
  expect(changed.actions[0].fields.temporal_evidence).toBeUndefined();
  expect(changed.actions[0].fields).toMatchObject({ customer_name: "Amanda", time: "10:00" });
  const fresh = patchPlanAction(changed, "move", { time: "12:00", temporal_evidence: [{ field: "time", text: "meio-dia" }] });
  expect(fresh.actions[0].fields.temporal_evidence).toEqual([{ field: "time", text: "meio-dia" }]);
});

it.each([undefined,[{field:"time" as const,text:"11h"}]])("rejecting a retargeted reply preserves the independently accepted destination (%j)",evidence=>{
  const previous={date:"2026-09-27",time:"09:00"};
  const result=groundSchedulingTemporal(previous,{time:"11:00"},"11h","America/Sao_Paulo",new Date("2026-09-26T12:00:00Z"),"source_time","appointment.change",evidence);
  expect(result.fields).toEqual(previous);expect(result.patch.time).toBeUndefined();
  expect(result.rejected.map(x=>x.field)).toEqual(expect.arrayContaining(["source_time","time"]));
});
it("rejecting a retargeted date does not remove the accepted destination date",()=>{
  const previous={date:"2026-09-28",time:"09:00"};
  const result=groundSchedulingTemporal(previous,{date:"2026-09-27"},"amanhã","America/Sao_Paulo",new Date("2026-09-26T12:00:00Z"),"source_date","appointment.change");
  expect(result.fields).toEqual(previous);expect(result.patch.date).toBeUndefined();expect(result.fields.source_date).toBeUndefined();
});
