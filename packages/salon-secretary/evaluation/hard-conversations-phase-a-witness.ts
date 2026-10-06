/** Evaluation-only, sanitized witness for the exact Responses body after SDK serialization. */
import { RESUME_SCOPE, RESUME_IDS, FINAL_CONTINUATION_SCOPE, FINAL_CONTINUATION_IDS } from "./hard-conversations-durable";
import { InferenceBudget, validateFutureWire } from "./hard-conversations-runner";
import { CONTINUATION_SCOPE, CONTINUATION_MAX_USD, CONTINUATION_TURNS } from "./hard-conversations-phase-a-continuation";
import type { WireEvidence } from "./hard-conversations-observation-bridge";

type BeforeNetwork = (request: { url: string; method: string; body: string }) => void;

export type SanitizedWireRecord = WireEvidence & {
  endpoint: "/v1/responses"; method: "POST"; stream: false; parallel_tool_calls: false;
  include_count: 0; input_items: number; request_bytes: number; input_upper_bound: number;
  reserved_usd: number; case_id: string; turn_index: number;
};

const secretPattern = /sk-(?:proj-)?[A-Za-z0-9_-]{10,}|Bearer\s+[A-Za-z0-9_-]+|postgres(?:ql)?:\/\/|\b\d{10,13}\b|\b[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}\b|[A-Z0-9._%+-]+@[A-Z0-9.-]+\.[A-Z]{2,}/i;

export class PhaseAWireWitness {
  readonly budget: InferenceBudget;
  readonly records: SanitizedWireRecord[] = [];
  private expected: { caseId: string; turnIndex: number; functionName: "select_capabilities" | "upsert_action_draft";
    prohibitedValues: readonly string[] } | null = null;

  constructor(private readonly scope: "PHASE_A" | "REVALIDATE_I01" | typeof CONTINUATION_SCOPE | typeof RESUME_SCOPE | typeof FINAL_CONTINUATION_SCOPE | "ULTIMATE_10" = "PHASE_A") {
    this.budget = scope === "ULTIMATE_10" ? new InferenceBudget(11, .0946, .0086) :
      scope === FINAL_CONTINUATION_SCOPE ? new InferenceBudget(16, .1376, .0086) :
      scope === RESUME_SCOPE ? new InferenceBudget(17, .1462, .0086) : scope === "REVALIDATE_I01" ? new InferenceBudget(1, .0086, .0086) :
      scope === CONTINUATION_SCOPE ? new InferenceBudget(CONTINUATION_TURNS, CONTINUATION_MAX_USD, .0086) :
        new InferenceBudget(28, .2408, .0086);
  }

  expectTurn(caseId: string, turnIndex: number, functionName: "select_capabilities" | "upsert_action_draft",
    prohibitedValues: readonly string[]) {
    if (this.expected || !/^[iadtmxu]\d{2}$/.test(caseId) || !Number.isSafeInteger(turnIndex) || turnIndex < 1)
      throw Error("WIRE_WITNESS_STATE");
    if (this.scope !== "ULTIMATE_10" && caseId.startsWith("u"))
      throw Error("WIRE_LEGACY_SCOPE_FORBIDDEN");
    if (this.scope === "ULTIMATE_10" && (!/^u(0[1-9]|10)$/.test(caseId) ||
      (turnIndex !== 1 && !(caseId === "u06" && turnIndex === 2))))
      throw Error("WIRE_ULTIMATE_SCOPE_FORBIDDEN");
    if (this.scope === RESUME_SCOPE && (!(RESUME_IDS as readonly string[]).includes(caseId) ||
      (turnIndex !== 1 && !(turnIndex === 2 && ["t07", "t08"].includes(caseId)))))
      throw Error("WIRE_RESUME_SCOPE_FORBIDDEN");
    if (this.scope === FINAL_CONTINUATION_SCOPE && (!FINAL_CONTINUATION_IDS.includes(caseId) ||
      (turnIndex !== 1 && !(turnIndex === 2 && ["t07", "t08"].includes(caseId)))))
      throw Error("WIRE_FINAL_SCOPE_FORBIDDEN");
    this.expected = { caseId, turnIndex, functionName, prohibitedValues };
  }

  clearTurn() { this.expected = null; }

  readonly beforeNetwork: BeforeNetwork = ({ url, method, body }) => {
    const expected = this.expected;
    if (!expected || url !== "https://api.openai.com/v1/responses" || method !== "POST" ||
      secretPattern.test(body) || expected.prohibitedValues.filter(Boolean).some(value => body.includes(value)))
      throw Error("WIRE_WITNESS_REJECTED");
    if (this.scope === RESUME_SCOPE && !(RESUME_IDS as readonly string[]).includes(expected.caseId))
      throw Error("WIRE_RESUME_CASE_FORBIDDEN");
    if (this.scope === FINAL_CONTINUATION_SCOPE && !FINAL_CONTINUATION_IDS.includes(expected.caseId))
      throw Error("WIRE_FINAL_CASE_FORBIDDEN");
    if (this.scope === "ULTIMATE_10" && !/^u(0[1-9]|10)$/.test(expected.caseId))
      throw Error("WIRE_ULTIMATE_CASE_FORBIDDEN");
    if (this.scope === CONTINUATION_SCOPE && expected.caseId === "i01")
      throw Error("WIRE_CONTINUATION_I01_FORBIDDEN");
    if (this.records.some(row => row.case_id === expected.caseId && row.turn_index === expected.turnIndex))
      throw Error("WIRE_TURN_LIMIT");
    const validated = validateFutureWire(body, this.budget, expected.prohibitedValues);
    if (validated.function_tools.length !== 1 || validated.function_tools[0] !== expected.functionName)
      throw Error("WIRE_WITNESS_TOOL_MISMATCH");
    const payload = JSON.parse(body) as { input: unknown[] };
    this.records.push({ case_id: expected.caseId, turn_index: expected.turnIndex,
      endpoint: "/v1/responses", method: "POST", model: "gpt-6-luna", store: false, stream: false,
      parallel_tool_calls: false, include_count: 0, input_items: payload.input.length,
      request_bytes: Buffer.byteLength(body, "utf8"), input_upper_bound: validated.input_upper_bound,
      reserved_usd: validated.reserved_usd, function_tools: validated.function_tools,
      hosted_tools: 0, containers: 0, retries: 0 });
  };

  lastFor(caseId: string, turnIndex: number): WireEvidence | null {
    const row = this.records.findLast(record => record.case_id === caseId && record.turn_index === turnIndex);
    return row ? { model: row.model, store: row.store, function_tools: row.function_tools,
      hosted_tools: row.hosted_tools, containers: row.containers, retries: row.retries } : null;
  }
}
