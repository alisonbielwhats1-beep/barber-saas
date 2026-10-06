import { createHash } from "node:crypto";
import { readFileSync } from "node:fs";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { prepareAcceptanceCalibrationPlan } from "../../../packages/salon-secretary/evaluation/acceptance-calibration-plan";
import { prepareAcceptanceCalibrationContinuation } from "../../../packages/salon-secretary/evaluation/acceptance-calibration-continuation";
import { assessJevAcceptance } from "../../../packages/salon-secretary/evaluation/acceptance-policy";
import { parseConditionalStage } from "../../../packages/salon-secretary/evaluation/conditional-plan";
import { dataset } from "../../../packages/salon-secretary/evaluation/dataset";
import { buildJevRequest, JevDecisionProvider, JEV_MODEL, type JevWireRequest } from "../../../packages/salon-secretary/evaluation/jev-provider";

const case18 = prepareAcceptanceCalibrationPlan().cases[17];
const input = dataset.find(c => c.id === case18.caseId)!.input;
const request = case18.discoveryPayload;
const credential = "synthetic-secret-that-must-never-be-logged";
const valid = (req: JevWireRequest) => ({
  model: JEV_MODEL,
  answers: Object.fromEntries(Object.entries(req.questions).map(([id, q]) => {
    const options = Object.keys(q.criteria), choice = id === "skill" ? "multiple" : "independent";
    return [id, { type: "choice", choice, probabilities: Object.fromEntries(options.map(option => [option, option === choice ? 1 : 0])), confidence: 0.8 }];
  })),
  usage: { input_tokens: 100, output_tokens: 20 },
});
const evaluate = async (raw: unknown, req = request) => {
  const transport = vi.fn<typeof fetch>(async () => new Response(JSON.stringify(raw), { status: 200, headers: { "x-request-id": "jev_synthetic_18", "x-extra": "ignored" } }));
  const result = await new JevDecisionProvider({ transport, credential: () => credential,
    protocol: { build: () => req, parse: value => parseConditionalStage(value, req) } }).evaluate(input);
  return { result, transport };
};

beforeEach(() => vi.stubGlobal("fetch", vi.fn(() => { throw Error("NO_NETWORK"); })));
afterEach(() => vi.unstubAllGlobals());

describe("JEV invalid response observability — evaluation only", () => {
  it("preserves the frozen case-18 message and questions without sending the oracle", () => {
    expect(case18.message).toBe("Quanto faturei ontem e altere a massagem para R$80?");
    expect(Object.keys(request.questions)).toEqual(["skill", "shape"]);
    expect(JSON.stringify(request)).not.toContain('"expected"');
    expect(JSON.stringify(request)).not.toContain(credential);
  });

  it("continues accepting valid transport data, ignoring extra HTTP headers only", async () => {
    const { result, transport } = await evaluate(valid(request));
    expect(result).toMatchObject({ status: "OK", error: null, requestId: "jev_synthetic_18" });
    expect(result.invalidResponseDiagnostic).toBeUndefined();
    expect(result.answers.skill?.choice).toBe("multiple");
    expect(transport).toHaveBeenCalledTimes(1);
    expect(global.fetch).not.toHaveBeenCalled();
  });

  it.each([
    ["missing model", (r: ReturnType<typeof valid>) => { delete (r as Partial<typeof r>).model; return r; }, "MISSING_FIELD", "model"],
    ["wrong type", (r: ReturnType<typeof valid>) => { r.answers.skill.choice = 42 as unknown as string; return r; }, "INVALID_TYPE", "answers.skill.choice"],
    ["unknown choice", (r: ReturnType<typeof valid>) => { r.answers.skill.choice = credential; return r; }, "INVALID_CHOICE", "answers.skill.choice"],
    ["missing answer", (r: ReturnType<typeof valid>) => { delete (r.answers as Partial<typeof r.answers>).shape; return r; }, "QUESTION_COUNT_MISMATCH", "answers.shape"],
    ["bad probability sum", (r: ReturnType<typeof valid>) => { r.answers.skill.probabilities.multiple = 0.5; return r; }, "PROBABILITY_SCHEMA_INVALID", "answers.skill.probabilities"],
    ["unknown probability key", (r: ReturnType<typeof valid>) => { r.answers.skill.probabilities[credential] = 0; return r; }, "PROBABILITY_SCHEMA_INVALID", "answers.skill.probabilities"],
    ["bad confidence", (r: ReturnType<typeof valid>) => { r.answers.skill.confidence = "high" as unknown as number; return r; }, "CONFIDENCE_SCHEMA_INVALID", "answers.skill.confidence"],
    ["partial answer", (r: ReturnType<typeof valid>) => { r.answers = { skill: r.answers.skill }; return r; }, "QUESTION_COUNT_MISMATCH", "answers.shape"],
    ["extra body field", (r: ReturnType<typeof valid>) => Object.assign(r, { [credential]: "PII" }), "UNEXPECTED_FIELD", "$"],
    ["wrong model", (r: ReturnType<typeof valid>) => { r.model = credential as typeof JEV_MODEL; return r; }, "MODEL_MISMATCH", "model"],
    ["bad usage", (r: ReturnType<typeof valid>) => { r.usage.input_tokens = -1; return r; }, "USAGE_SCHEMA_INVALID", "usage.input_tokens"],
    ["incompatible body", () => "not an object", "MALFORMED_PROVIDER_RESPONSE", "$"],
  ] as const)("rejects %s with typed sanitized diagnostics", async (_label, mutate, reason, path) => {
    const { result, transport } = await evaluate(mutate(structuredClone(valid(request))));
    expect(result).toMatchObject({ status: "ERROR", error: "INVALID_RESPONSE", decision: null,
      fallbackReasons: ["INVALID_RESPONSE"], invalidResponseDiagnostic: { reason, path, httpStatus: 200, requestId: "jev_synthetic_18" } });
    expect(assessJevAcceptance(input, result)).toMatchObject({ decision: "FALLBACK_REQUIRED" });
    expect(JSON.stringify(result.invalidResponseDiagnostic)).not.toContain(credential);
    expect(JSON.stringify(result.invalidResponseDiagnostic)).not.toContain("PII");
    if (reason !== "MALFORMED_PROVIDER_RESPONSE")
      expect(result.invalidResponseDiagnostic?.sanitizedInvalidResponse.returnedQuestions).toEqual(expect.arrayContaining(["skill"]));
    expect(transport).toHaveBeenCalledTimes(1);
    expect(global.fetch).not.toHaveBeenCalled();
  });

  it("rejects invalid JSON without retaining the body", async () => {
    const transport = vi.fn<typeof fetch>(async () => new Response("{", { status: 200 }));
    const result = await new JevDecisionProvider({ transport, credential: () => credential,
      protocol: { build: () => request, parse: value => parseConditionalStage(value, request) } }).evaluate(input);
    expect(result).toMatchObject({ error: "INVALID_RESPONSE", fallbackReasons: ["INVALID_RESPONSE"],
      invalidResponseDiagnostic: { reason: "MALFORMED_PROVIDER_RESPONSE", path: "$", httpStatus: 200 } });
    expect(JSON.stringify(result)).not.toContain(credential);
    expect(assessJevAcceptance(input, result).decision).toBe("FALLBACK_REQUIRED");
    expect(transport).toHaveBeenCalledTimes(1);
  });

  it("diagnoses the default flat protocol's semantic conflict without changing its rejection", async () => {
    const flat = buildJevRequest(input);
    const raw = { model: JEV_MODEL, answers: Object.fromEntries(Object.entries(flat.questions).map(([id, q]) => {
      const choice = ({ skill: "financial", operation: "service.create", shape: "single", period: "none", metric: "none",
        inventory: "none", communication: "none" } as Record<string, string>)[id];
      return [id, { type: "choice", choice, probabilities: Object.fromEntries(Object.keys(q.criteria).map(v => [v, v === choice ? 1 : 0])), confidence: 0.8 }];
    })) };
    const transport = vi.fn<typeof fetch>(async () => new Response(JSON.stringify(raw), { status: 200 }));
    const result = await new JevDecisionProvider({ transport, credential: () => credential }).evaluate(input);
    expect(result).toMatchObject({ status: "ERROR", error: "INVALID_RESPONSE", decision: null,
      invalidResponseDiagnostic: { reason: "SEMANTIC_CONFLICT", path: "answers.operation.choice" } });
    expect(assessJevAcceptance(input, result).decision).toBe("FALLBACK_REQUIRED");
    expect(transport).toHaveBeenCalledTimes(1);
  });

  it("preserves the first 17 real results and approved policy/catalog hashes", () => {
    const evidencePath = "packages/salon-secretary/evaluation/acceptance-calibration-real-2026-09-23.json";
    const evidence = readFileSync(evidencePath, "utf8");
    const hash = (path: string) => createHash("sha256").update(readFileSync(path)).digest("hex");
    expect(createHash("sha256").update(evidence).digest("hex")).toBe("c114a7fe1220503ab86bf6913c68056cc7834930b59486e1b9f86843baf19616");
    expect(JSON.parse(evidence)).toMatchObject({ executedEvaluations: 17, executedHttp: 31, stopReason: "INVALID_RESPONSE" });
    expect(hash("packages/salon-secretary/evaluation/acceptance-policy.ts")).toBe("ba2223442b203b6c0a055662b7a6f861e648bdfe06bb0fc680da7da7eca0958c");
    expect(hash("packages/salon-secretary/evaluation/acceptance-calibration-plan.ts")).toBe("e919a7100d1487dc5c93cb96e14ac313c5c6f2c000c433f18e5034678356e70d");
    expect(hash("packages/salon-secretary/evaluation/dataset.ts")).toBe("af7ca3a568dbc6bfe96452cc92e0f36bbe65ce3a6b0c046de7f665fa08be5300");
    expect(hash("packages/salon-secretary/evaluation/derivation-catalog.ts")).toBe("93c145a85ad25f32e813a08a61e068f5d7590ef148abc36422a6959c32a9a6b1");
  });

  it("prepares only cases 18–20 with the original case-18 wire payload and no execution", () => {
    const continuation = prepareAcceptanceCalibrationContinuation();
    const prior = JSON.parse(readFileSync("packages/salon-secretary/evaluation/acceptance-calibration-real-2026-09-23.json", "utf8"));
    expect(continuation).toMatchObject({ executed: false, maxAdditionalEvaluations: 3, maxAdditionalHttp: 6,
      priorCompletedEvaluations: 17, priorAttemptedHttp: 31, zeroRetries: true, requiresSeparateAuthorization: true });
    expect(continuation.cases.map(c => c.sequence)).toEqual([18, 19, 20]);
    expect(continuation.cases[0].discoveryPayload).toEqual(prior.activeCase.rounds[0].request);
    expect(global.fetch).not.toHaveBeenCalled();
  });
});

// Historical source seals verify archived bytes; module execution uses the current implementation.
// Live admission against these old seals remains fail-closed, checked independently.
vi.mock("node:fs", async importOriginal => {
  const actual = await importOriginal<typeof import("node:fs")>();
  const { legacyEvidenceFs } = await import("../../test/secretary-legacy-evidence");
  return { ...actual, readFileSync: legacyEvidenceFs(actual) };
});
