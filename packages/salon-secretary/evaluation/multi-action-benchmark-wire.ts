import { InferenceBudget, validateFutureWire } from "./hard-conversations-runner";
import { validateSelectionV2 } from "../src/skill-registry";
import type { WireEvidence } from "./hard-conversations-observation-bridge";

/** Same strict transport validator; a separate resource budget does not alter old manifests. */
export class BenchmarkBudget extends InferenceBudget {
  override reserve(inputUpperBound: number, outputCap: number) {
    if (!Number.isSafeInteger(inputUpperBound) || inputUpperBound < 0 || inputUpperBound > 64000 ||
      outputCap !== 8192 || this.calls >= this.maxCalls || this.reservedUsd + this.perCallUsd > this.maxUsd + 1e-12)
      throw Error("BENCHMARK_BUDGET_EXCEEDED");
    this.calls++; this.reservedUsd = Number((this.reservedUsd + this.perCallUsd).toFixed(8));
  }
}
export class BenchmarkWireWitness {
  readonly budget: BenchmarkBudget;
  readonly records: (WireEvidence & { case_id: string; turn: number; request_bytes: number; output_cap: number; reserved_usd: number })[] = [];
  constructor(maxRequests: number) { this.budget = new BenchmarkBudget(maxRequests, maxRequests * .013, .013); }
  beforeNetwork(caseId: string, turn: number, input: RequestInfo | URL, init?: RequestInit) {
    const url = input instanceof Request ? input.url : String(input);
    if (url !== "https://api.openai.com/v1/responses" || init?.method !== "POST" || typeof init.body !== "string" ||
      this.records.some(r => r.case_id === caseId && r.turn === turn)) throw Error("BENCHMARK_WIRE_INVALID");
    const validated = validateFutureWire(init.body, this.budget, []);
    const row = { case_id: caseId, turn, model: "gpt-6-luna", store: false, hosted_tools: 0, containers: 0, retries: 0,
      function_tools: validated.function_tools, request_bytes: Buffer.byteLength(init.body), output_cap: 8192, reserved_usd: validated.reserved_usd };
    this.records.push(row); return row;
  }
}
export function selectionDiagnostic(body: unknown) {
  try { validateSelectionV2(body); return { valid: true, issues: [] }; }
  catch (error) {
    const e = error as { issues?: { code: string; path: (string | number)[] }[]; message?: string };
    return { valid: false, issues: e.issues?.map(i => ({ code: i.code, path: i.path.map(p => typeof p === "number" ? p : /^[a-z_]+$/.test(p) ? p : "[unknown]") })) ??
      [{ code: /^[A-Z_]+$/.test(e.message ?? "") ? e.message! : "SELECTION_VALIDATION_FAILED", path: [] }] };
  }
}
