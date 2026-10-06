import { describe, expect, it } from "vitest";
import { compareCandidate, estimatedGpt6LunaCost, gpt6LunaGolden } from "../../../packages/salon-secretary/evaluation/gpt6-luna-candidate";

describe("GPT-6 Luna candidate evaluation plan (offline)", () => {
  it("pins ten backend-reviewed cases across all six Skills and dependent flows", () => {
    expect(gpt6LunaGolden).toHaveLength(10);
    expect(new Set(gpt6LunaGolden.map(c => c.id)).size).toBe(10);
    expect(new Set(gpt6LunaGolden.flatMap(c => c.expected.skills))).toEqual(
      new Set(["services", "customers", "scheduling", "financial", "inventory", "communication"]));
    expect(gpt6LunaGolden.some(c => c.expected.dependencies.length > 0)).toBe(true);
    expect(gpt6LunaGolden.every(c => c.candidate.status === "NOT_RUN" && c.historical.model === "gpt-5.6-luna" && c.message.length > 0)).toBe(true);
  });
  it("compares Skill, operation, fields, dependencies and boundary independently", () => {
    const golden = gpt6LunaGolden.find(c => c.id === "communication-dependent-name")!;
    const base = { caseId: golden.id, modelRequested: "gpt-6-luna", modelReturned: "gpt-6-luna",
      skills: golden.expected.skills, operations: golden.expected.operations, dependencies: golden.expected.dependencies,
      fields: golden.expected.domainFields, boundaryAccepted: true, backendValidated: true, inferenceCount: 1, retries: 0,
      latencyMs: 1000, usage: { inputTokens: 2000, cachedInputTokens: 0, cacheWriteTokens: 0,
        outputTokens: 200, reasoningTokens: 20, totalTokens: 2200 } };
    expect(compareCandidate(base)).toMatchObject({ modelCorrect: true, skillCorrect: true, operationCorrect: true,
      dependencyCorrect: true, fieldExactMatch: true, boundaryAccepted: true, backendValidated: true, noRetries: true });
    expect(compareCandidate({ ...base, dependencies: [] }).dependencyCorrect).toBe(false);
    expect(compareCandidate({ ...base, fields: { ...base.fields, service_name: "invented" } }).fieldExactMatch).toBe(false);
  });
  it("prices uncached, cached, cache-write and output without adding reasoning twice", () => {
    expect(estimatedGpt6LunaCost({ inputTokens: 2000, cachedInputTokens: 1000, cacheWriteTokens: 100,
      outputTokens: 200, reasoningTokens: 50, totalTokens: 2200 })).toBeCloseTo(0.0002125);
    expect(() => estimatedGpt6LunaCost({ inputTokens: 100, cachedInputTokens: 101, cacheWriteTokens: 0,
      outputTokens: 20, reasoningTokens: 0, totalTokens: 120 })).toThrow("GPT6_COST_BASIS_UNSUPPORTED");
  });
});
