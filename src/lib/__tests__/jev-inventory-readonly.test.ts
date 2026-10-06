import { createHash } from "node:crypto";
import { readFileSync } from "node:fs";
import { describe, expect, it, vi } from "vitest";
import { inventoryReadonlyCases, nextInventoryDetail, prepareInventoryReadonlyPlan } from "../../../packages/salon-secretary/evaluation/inventory-readonly-plan";
import { scoreInventoryReadonly, summarizeInventoryReadonly } from "../../../packages/salon-secretary/evaluation/inventory-readonly-evaluation";
import { DerivedJevProvider } from "../../../packages/salon-secretary/evaluation/derived-provider";
import { initialAllowlist } from "../../../packages/salon-secretary/evaluation/acceptance-policy";
import { parseConditionalStage } from "../../../packages/salon-secretary/evaluation/conditional-plan";
import { assertFrozenWavePayload } from "../../../packages/salon-secretary/evaluation/coverage-expansion-wave-harness";
import { JEV_MODEL, type JevWireRequest } from "../../../packages/salon-secretary/evaluation/jev-provider";

const plan = prepareInventoryReadonlyPlan();
const row = (id: string) => plan.cases.find(c => c.id === id)!;
function response(request: JevWireRequest, choices: Record<string, string>) {
  return { model: JEV_MODEL, answers: Object.fromEntries(Object.entries(request.questions).map(([id, question]) => [id,
    { type: "choice", choice: choices[id], probabilities: Object.fromEntries(Object.keys(question.criteria).map(c => [c, c === choices[id] ? 1 : 0])), confidence: 1 as number | undefined }])),
    usage: { input_tokens: 100, output_tokens: 30 } };
}
async function trial(id: string, selections: Record<string, string> = {}, mutate?: (r: ReturnType<typeof response>) => void) {
  const c = row(id), choices = { skill: c.expected.skill, shape: c.expected.shape, inventory: c.expected.inventory, ...selections };
  const transport = vi.fn<typeof fetch>(async (_url, init) => {
    const request = JSON.parse(String(init?.body)) as JevWireRequest;
    const frozen = "inventory" in request.questions ? c.payloads.detail : c.payloads.discovery;
    assertFrozenWavePayload(request, frozen, "synthetic-test-credential");
    const body = response(request, choices);
    if ("inventory" in request.questions && mutate) mutate(body);
    return new Response(JSON.stringify(body), { status: 200 });
  });
  const provider = new DerivedJevProvider({ transport, credential: () => "synthetic-test-credential", maxCalls: 2 });
  const result = await provider.evaluate({ message: c.message, context: {} });
  return { c, result, transport, scored: scoreInventoryReadonly(c, result) };
}

describe("Inventory read-only Wave 2: offline synthetic evaluation, no calibration", () => {
  it("freezes 26 cases, original contracts and predecessor hashes without widening allowlist", () => {
    const bytes = readFileSync("packages/salon-secretary/evaluation/inventory-readonly-plan.json");
    expect(createHash("sha256").update(bytes).digest("hex")).toBe("dcc9bd919ec2ea1a678a7443abc7d35213d9906b63aacf12dc4c924d198cbe0a");
    expect(JSON.parse(bytes.toString())).toEqual(plan);
    expect(plan).toMatchObject({ caseCount: 26, positives: 8, adversarial: 18, executed: false, maxHttpCalls: 52, retries: 0 });
    expect(plan.pricing.maximumPlanningEstimateUsd).toBe(0.139776);
    expect(new Set(inventoryReadonlyCases.map(c => c.message)).size).toBe(26);
    expect(initialAllowlist).toHaveLength(2);
    expect(plan.cases.filter(c => c.evidenceState === "PROVEN").map(c => c.id)).toEqual(["i01"]);
  });
  it("only approved questions and synthetic message/context cross the payload boundary", () => {
    for (const c of plan.cases) {
      expect(Object.keys(c.payloads.discovery.questions)).toEqual(["skill", "shape"]);
      expect(Object.keys(c.payloads.detail.questions)).toEqual(["inventory"]);
      expect(Object.keys(c.payloads.detail.questions.inventory.criteria)).toEqual(["balance", "low_stock", "IN", "OUT", "search", "none", "unclear"]);
      for (const request of Object.values(c.payloads)) {
        expect(() => assertFrozenWavePayload(request, request, "synthetic-test-credential")).not.toThrow();
        expect(JSON.stringify(request)).not.toMatch(/"(?:expected|fields|unresolvedByChoices|operation|product_name|phone|product_ref|salonId)"\s*:/);
      }
    }
  });
  it.each(["financial", "services", "customers", "scheduling", "communication", "out_of_catalog", "multiple", "unclear"])("does not ask Inventory detail for %s", skill => {
    const c = row("i01"), request = c.payloads.discovery;
    expect(nextInventoryDetail(c.message, parseConditionalStage(response(request, { skill, shape: "single" }), request))).toBeNull();
  });
  it.each(["independent", "dependent", "unclear", "out_of_catalog"])("does not ask detail for shape %s", shape => {
    const c = row("i01"), request = c.payloads.discovery;
    expect(nextInventoryDetail(c.message, parseConditionalStage(response(request, { skill: "inventory", shape }), request))).toBeNull();
  });
  it.each(plan.cases.filter(c => c.expected.fullBypassSemanticallyPossible).map(c => c.id))("%s is a full semantic oracle; only existing PROVEN input can be accepted", async id => {
    const { c, result, scored, transport } = await trial(id);
    expect(transport).toHaveBeenCalledTimes(2);
    expect(scored).toMatchObject({ providerValid: true, selectorCorrect: true, derivationCorrect: true, potentialFullBypass: true, disposition: "CONTINUE", executable: false });
    expect(scored.policy.decision).toBe(id === "i01" ? "ACCEPT_JEV" : "FALLBACK_REQUIRED");
    expect(scored.classification).toBe(id === "i01" ? "CORRECT_ACCEPT" : "CORRECT_FALLBACK");
    expect(c.expected.fields).toMatchObject({ relation: "stock <= minStock", includeInactive: true, presentationLimit: 20 });
    expect(result.derivations[0]).toMatchObject({ operation: "product.search", source: { skill: "inventory", dimension: "inventory", value: "low_stock" } });
    expect(result.dimensionSources.operation).toBe("DERIVED");
    expect(result.derivations[0]).not.toHaveProperty("confidence");
    expect(scored.confidence.map(d => d.dimension)).toEqual(["skill", "shape", "inventory"]);
  });
  it.each(["n01", "n02", "n03", "n04", "n05", "n10"])("%s cannot bypass open name, generic-list flow or quantity comparison", async id => {
    const { scored } = await trial(id);
    expect(scored).toMatchObject({ selectorCorrect: true, derivationCorrect: true, potentialFullBypass: false, routingOnlyCorrect: true, disposition: "CONTINUE" });
    expect(scored.policy.decision).toBe("FALLBACK_REQUIRED");
  });
  it.each(["n06", "n07", "n08", "n18"])("%s: correct low_stock projection is semantically incomplete and stops selector-only expansion", async id => {
    const { scored } = await trial(id);
    expect(scored).toMatchObject({ providerValid: true, selectorCorrect: true, potentialFullBypass: false, unsafeFalsePositive: false,
      unsafeSelectorCandidate: true, disposition: "STOP", stopReason: "UNSAFE_SELECTOR_ONLY_CANDIDATE" });
    expect(scored.policy.decision).toBe("FALLBACK_REQUIRED");
    expect(scored.missingSemantics.length).toBeGreaterThan(0);
  });
  it.each(["n11", "n12", "n13"])("%s movement classification never authorizes a mutation", async id => {
    const { result, scored } = await trial(id);
    expect(result.decision?.operation).toBe("stock.movement");
    expect(scored).toMatchObject({ potentialFullBypass: false, classification: "CORRECT_FALLBACK", disposition: "CONTINUE", executable: false });
  });
  it("high-confidence wrong low_stock for 'Dê baixa' stops without accepted mutation", async () => {
    const { scored } = await trial("n13", { inventory: "low_stock" });
    expect(scored).toMatchObject({ selectorCorrect: false, unsafeSelectorCandidate: true, unsafeFalsePositive: false, disposition: "STOP" });
  });
  it("exact zero is not interchangeable with stock <= minStock", async () => {
    expect((await trial("n09")).scored).toMatchObject({ potentialFullBypass: false, disposition: "CONTINUE" });
    expect((await trial("n09", { inventory: "low_stock" })).scored).toMatchObject({ potentialFullBypass: false, unsafeSelectorCandidate: true, disposition: "STOP" });
  });
  it.each(["n14", "n15", "n16", "n17"])("%s short-circuits to fallback after discovery", async id => {
    const { transport, scored } = await trial(id);
    expect(transport).toHaveBeenCalledTimes(1);
    expect(scored.policy.decision).toBe("FALLBACK_REQUIRED");
    expect(scored.potentialFullBypass).toBe(false);
  });
  it.each([.99, 1.01])("KEEP_STRICT sum=%s remains invalid/fallback; known diagnostic continues", async sum => {
    const { result, scored } = await trial("i01", {}, r => { r.answers.inventory.probabilities.low_stock = sum - .1; r.answers.inventory.probabilities.balance = .1; });
    expect(result.error).toBe("INVALID_RESPONSE");
    expect(scored).toMatchObject({ classification: "INVALID_PROVIDER_RESPONSE", providerValid: false, potentialFullBypass: false,
      disposition: "CONTINUE", diagnosticCategory: "invalid_probability_sum" });
    expect(scored.policy.decision).toBe("FALLBACK_REQUIRED");
  });
  it("unknown schema field stops, never repaired", async () => {
    const { scored } = await trial("i01", {}, r => { Object.assign(r, { unknown: true }); });
    expect(scored).toMatchObject({ classification: "INVALID_PROVIDER_RESPONSE", disposition: "STOP", potentialFullBypass: false });
  });
  it("missing confidence fails closed; low confidence remains data without an invented threshold", async () => {
    const absent = await trial("i01", {}, r => { delete r.answers.inventory.confidence; });
    expect(absent.scored.policy.decision).toBe("FALLBACK_REQUIRED");
    expect(absent.scored.potentialFullBypass).toBe(false);
    const low = await trial("i01", {}, r => { r.answers.inventory.confidence = .01; });
    expect(low.scored.confidence.find(c => c.dimension === "inventory")?.confidence).toBe(.01);
  });
  it("catalog drift or unknown diagnostics stop", async () => {
    const t = await trial("i01");
    t.result.fallbackReasons.push("CATALOG_DRIFT");
    expect(scoreInventoryReadonly(t.c, t.result).disposition).toBe("STOP");
    const invalid = await trial("i01", {}, r => { r.answers.inventory.probabilities.low_stock = .99; });
    invalid.result.stages.at(-1)!.result.invalidResponseDiagnostic!.path = "answers.inventory.unrecognized";
    expect(scoreInventoryReadonly(invalid.c, invalid.result).disposition).toBe("STOP");
  });
  it("HTTP error performs no retry and stops", async () => {
    const transport = vi.fn<typeof fetch>(async () => new Response("unavailable", { status: 500 }));
    const result = await new DerivedJevProvider({ transport, credential: () => "synthetic", maxCalls: 2 }).evaluate({ message: row("i01").message, context: {} });
    expect(transport).toHaveBeenCalledTimes(1);
    expect(scoreInventoryReadonly(row("i01"), result)).toMatchObject({ disposition: "STOP", potentialFullBypass: false });
  });
  it("frozen payload guard refuses changed bodies or leaked credential before transport", () => {
    const request = row("i01").payloads.discovery;
    expect(() => assertFrozenWavePayload({ ...request, state: { message: row("i01").message, context: {}, expected: "low_stock" } }, request, "synthetic")).toThrow();
    expect(() => assertFrozenWavePayload(request, request, row("i01").message)).toThrow();
  });
  it("metrics are deterministic, label synthetic evidence and do not invent wire observations", async () => {
    const t = await trial("i02"), trials = [{ case: t.c, result: t.result }];
    expect(summarizeInventoryReadonly(trials)).toEqual(summarizeInventoryReadonly(trials));
    expect(summarizeInventoryReadonly(trials)).toMatchObject({ evidenceKind: "SYNTHETIC", potentialFullBypass: 1,
      providerReliability: { attemptedHttp: 0, validResponseRate: null } });
    expect(summarizeInventoryReadonly([]).acceptanceAccuracy).toBeNull();
    expect(() => summarizeInventoryReadonly([...trials, ...trials])).toThrow("DUPLICATE_TRIAL");
  });
});

// Historical harnesses verify V1 archived bytes; current V2 has separate runtime tests.
vi.mock("node:fs", async importOriginal => {
  const actual = await importOriginal<typeof import("node:fs")>();
  const { legacyEvidenceFs } = await import("../../test/secretary-legacy-evidence");
  return { ...actual, readFileSync: legacyEvidenceFs(actual) };
});
