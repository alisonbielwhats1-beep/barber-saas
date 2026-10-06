import { describe, expect, it } from "vitest";
import { createHash } from "node:crypto";
import { readFileSync } from "node:fs";
import { decodeTemporalEvidencePayload, type SchedulingTemporalEvidence } from "../../../packages/salon-secretary/src/scheduling-skill";
import { groundSchedulingTemporal } from "../scheduling-temporal-source";
import type { SchedulingFields } from "../scheduling-contract";
import fixture from "../../test/fixtures/secretary-temporal-consumed-holdout-v2.json";

const now = new Date("2028-06-12T12:00:00.000Z");
describe("consumed holdout V2 raw temporal captures, development replay only", () => {
  it("preserves exact captured arguments and source fixture", () => {
    const bytes = readFileSync("src/test/fixtures/secretary-temporal-consumed-holdout-v2.json");
    expect(createHash("sha256").update(bytes).digest("hex")).toBe("23f04c6566149fe13757d847c6e27a40428c307387807efa58d14c56806ff7a1");
  });
  it.each([
    ["V216", { date: "2028-06-13", time: "09:45", override_requested: false }],
    ["V217", { date: "2028-06-18", time: "12:00", destination_mode: "ALTERNATIVE_SLOT" }],
    ["V218", { date: "2028-06-15", time: "12:30" }],
    ["V221", { date: "2028-06-14", time: "13:00", end_time: "18:00" }],
  ])("retains independently correct fields from %s", (caseId, expected) => {
    const row = fixture.cases.find(row => row.caseId === caseId)!;
    const capture = row.captures.at(-1)!;
    const call = capture.output.find(output => output.type === "function_call")!;
    const decoded = decodeTemporalEvidencePayload(JSON.parse(call.arguments!), true) as {
      turn: { operations: ({ operation?: string; fields?: Record<string, unknown> } & Record<string, unknown>)[] }
    };
    const operation = decoded.turn.operations[0];
    const fields = operation.fields ?? operation;
    const { temporal_evidence, ...rest } = fields;
    const raw = Object.fromEntries(Object.entries(rest).filter(([key, value]) => value != null && !["operation", "item_key", "source_scope", "depends_on", "released_slot_of"].includes(key))) as SchedulingFields;
    const previous: SchedulingFields = caseId === "V217" ? { date: "2028-06-17", time: "12:00" } : {};
    const result = groundSchedulingTemporal(previous, raw, row.source, "America/Sao_Paulo", now,
      caseId === "V217" ? "destination_mode" : undefined,
      caseId === "V221" ? "availability.get" : "appointment.create", temporal_evidence as SchedulingTemporalEvidence);
    expect(result.rejected).toEqual([]);
    expect(result.fields).toMatchObject(expected);
  });
});
