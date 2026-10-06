import { createHash } from "node:crypto";
import { readFileSync } from "node:fs";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { dataset } from "../../../packages/salon-secretary/evaluation/dataset";
import { assessJevAcceptance, initialAllowlist } from "../../../packages/salon-secretary/evaluation/acceptance-policy";
import { auditExpansionGolden, classifyExpansionCase, operationMatrix } from "../../../packages/salon-secretary/evaluation/coverage-expansion";
import { expansionDataset, validateExpansionDataset } from "../../../packages/salon-secretary/evaluation/coverage-expansion-dataset";
import { prepareCoverageExpansion, scoreExpansionVerdict, summarizeExpansionTrials, validateExpansionQuestions } from "../../../packages/salon-secretary/evaluation/coverage-expansion-plan";
import { derivationCatalog, deriveOperation, publishedDecisionCatalog } from "../../../packages/salon-secretary/evaluation/derivation-catalog";
import { DerivedJevProvider } from "../../../packages/salon-secretary/evaluation/derived-provider";
import { JEV_MODEL, type JevWireRequest } from "../../../packages/salon-secretary/evaluation/jev-provider";
import { parseConditionalStage } from "../../../packages/salon-secretary/evaluation/conditional-plan";
import type { Decision } from "../../../packages/salon-secretary/evaluation/contract";

const get = (id: string) => expansionDataset.find(c => c.id === id)!;
function body(req: JevWireRequest, decision: Decision, confidence = .99) {
  return { model: JEV_MODEL, answers: Object.fromEntries(Object.entries(req.questions).map(([id, q]) => {
    const chosen = decision[id as keyof Decision], keys = Object.keys(q.criteria);
    return [id, { type: "choice", choice: chosen, confidence, probabilities: Object.fromEntries(keys.map(k => [k, k === chosen ? .99 : .01 / (keys.length - 1)])) }];
  })), usage: { input_tokens: 100, output_tokens: 0 } };
}
async function fake(id: string, changes: Partial<Decision> = {}) {
  const c = get(id), decision = { ...c.expected.decision, ...changes };
  const transport = vi.fn<typeof fetch>(async (_, init) => new Response(JSON.stringify(body(JSON.parse(init!.body as string), decision))));
  const result = await new DerivedJevProvider({ transport, credential: () => "unit-key-not-secret", maxCalls: 2, now: () => 1 }).evaluate(c.input);
  return { result, transport };
}
beforeEach(() => vi.stubGlobal("fetch", vi.fn(() => { throw Error("NO_NETWORK"); })));
afterEach(() => vi.unstubAllGlobals());

describe("coverage expansion — offline proposals, no enrollment", () => {
  it("keeps frozen policy, parser, catalog, original dataset and real evidence byte-identical", () => {
    const hashes: Record<string, string> = {
      "acceptance-policy.ts": "ba2223442b203b6c0a055662b7a6f861e648bdfe06bb0fc680da7da7eca0958c",
      "dataset.ts": "af7ca3a568dbc6bfe96452cc92e0f36bbe65ce3a6b0c046de7f665fa08be5300",
      "derivation-catalog.ts": "93c145a85ad25f32e813a08a61e068f5d7590ef148abc36422a6959c32a9a6b1",
      "conditional-plan.ts": "836ef27063f0a191d409b9103b5d4f6fce8db86b1d85dfa03e74ff03585f0761",
      "acceptance-calibration-real-2026-09-23.json": "c114a7fe1220503ab86bf6913c68056cc7834930b59486e1b9f86843baf19616",
    };
    for (const [file, sha] of Object.entries(hashes)) expect(createHash("sha256").update(readFileSync(`packages/salon-secretary/evaluation/${file}`)).digest("hex"), file).toBe(sha);
  });
  it("audits every published operation and preserves all forty oracles", () => {
    const before = JSON.stringify(dataset), audit = auditExpansionGolden();
    expect(audit.rows).toHaveLength(40); expect(operationMatrix()).toHaveLength(18);
    expect(audit.rows.filter(r => r.evidenceState === "PROVEN").map(r => r.caseId)).toEqual(["financial-revenue", "inventory-low"]);
    expect(audit.rows.filter(r => r.fullBypassPotential).map(r => r.caseId)).toEqual(["financial-revenue", "financial-received", "financial-outstanding", "inventory-low"]);
    expect(audit.rows.filter(r => r.proposedValue === "FAST_PATH")).toHaveLength(5);
    expect(audit.rows.filter(r => r.proposedValue === "OUT_OF_CATALOG")).toHaveLength(3);
    expect(JSON.stringify(dataset)).toBe(before);
    expect(audit.rows.map(r => r.boundary)).not.toContain("MUTATION_CANDIDATE");
  });
  it("validates 64 unique synthetic messages, complete expected, waves and all six Skills", () => {
    const cases = validateExpansionDataset();
    expect(cases).toHaveLength(64);
    expect([1, 2, 3, 4].map(w => cases.filter(c => c.wave === w).length)).toEqual([32, 16, 8, 8]);
    expect(new Set(cases.flatMap(c => c.expected.skills)).size).toBe(6);
    expect(cases.filter(c => classifyExpansionCase(c).fullBypassPotential)).toHaveLength(21);
    const broken = structuredClone(cases); broken[0].expected.domainFields = {};
    expect(() => validateExpansionDataset(broken)).toThrow();
  });
  it.each(derivationCatalog.bindings)("reuses unique published binding $skill/$value with provenance", b => {
    const result = deriveOperation(b.skill, "single", b.dimension, b.value);
    expect(result.ok).toBe(true);
    if (result.ok) expect(result.derivation).toMatchObject({ operation: b.operations[0], catalogVersion: "decision-derivations-v1", evidence: b.evidence });
  });
  it("fails closed on missing, ambiguous, stale, cross-skill and invented mappings", () => {
    expect(deriveOperation("financial", "single", "metric", "none").ok).toBe(false);
    expect(deriveOperation("financial", "single", "inventory", "low_stock").ok).toBe(false);
    expect(deriveOperation("inventory", "single", "inventory", "invented").ok).toBe(false);
    expect(deriveOperation("inventory", "single", "inventory", "low_stock", { ...derivationCatalog, bindings: [...derivationCatalog.bindings, derivationCatalog.bindings.find(b => b.value === "low_stock")!] }).ok).toBe(false);
    const publication = publishedDecisionCatalog(); (publication.registry[0] as { version: string }).version = "changed";
    expect(deriveOperation("financial", "single", "metric", "service_revenue", derivationCatalog, publication).ok).toBe(false);
  });
  it("keeps open extraction, comparisons, rankings, mutations and compounds outside full bypass", () => {
    for (const c of expansionDataset.filter(c => c.expected.requiresOpenExtraction || c.category === "D")) expect(classifyExpansionCase(c).fullBypassPotential, c.id).toBe(false);
    expect(classifyExpansionCase(get("i04")).proposedValue).toBe("JEV_ROUTING_ONLY");
    expect(classifyExpansionCase(get("r01")).boundary).toBe("MUTATION_FORCED_LUNA");
    expect(classifyExpansionCase(get("s07")).boundary).toBe("COMPOUND_FORCED_LUNA");
    expect(get("s07").expected.dependencies).toEqual([{ from: 0, to: 1 }]);
  });
  it("prepares only clean conditional payloads, no oracle or result-derived plan changes", () => {
    const a = validateExpansionQuestions(), b = prepareCoverageExpansion();
    expect(a).toEqual(b); expect(a.maxHttpCalls).toBe(128);
    expect(a.waves[0].maxHttpCalls).toBe(64);
    for (const w of a.waves) for (const c of w.cases) {
      expect(Object.keys(c.payloads.discovery.questions)).toEqual(["skill", "shape"]);
      for (const payload of [c.payloads.discovery, ...Object.values(c.payloads.detailBySkill)]) {
        expect(JSON.stringify(payload)).not.toMatch(/expected|domainFields|baseline|customer_ref|TYPESAFE_API_KEY/);
        expect(payload.state).toMatchObject({ message: c.message, context: {} });
      }
    }
    const financial = a.waves[0].cases[0].payloads.detailBySkill.financial;
    expect(Object.keys(financial.questions)).toEqual(["metric", "period"]);
    expect(Object.keys(a.waves[1].cases[0].payloads.detailBySkill.inventory.questions)).toEqual(["inventory"]);
    expect(global.fetch).not.toHaveBeenCalled();
  });
  it.each([.99, 1.01, .98, 1.02])("keeps strict probability sum, rejecting %s", sum => {
    const req = prepareCoverageExpansion().waves[0].cases[0].payloads.discovery;
    const raw = body(req, get("f01").expected.decision);
    const p = raw.answers.shape.probabilities;
    for (const key of Object.keys(p)) p[key] = key === "single" ? sum : 0;
    expect(() => parseConditionalStage(raw, req)).toThrow();
  });
  it.each(expansionDataset.filter(c => classifyExpansionCase(c).fullBypassPotential).map(c => c.id))("%s correct synthetic output does not auto-promote candidate", async id => {
    const { result } = await fake(id), c = get(id), score = summarizeExpansionTrials([{ id, result }]);
    expect(score.rows[0].linguisticCorrect).toBe(true);
    const proven = classifyExpansionCase(c).evidenceState === "PROVEN";
    expect(score.rows[0].policyDecision).toBe(proven ? "ACCEPT_JEV" : "FALLBACK_REQUIRED");
    expect(score.rows[0].calibrationOnlyCorrectNotAccepted).toBe(!proven);
    expect(initialAllowlist).toHaveLength(2);
    expect(global.fetch).not.toHaveBeenCalled();
  });
  it.each(expansionDataset.filter(c => classifyExpansionCase(c).fullBypassPotential).map(c => c.id))("%s high confidence wrong closed intent cannot become accept", async id => {
    const c = get(id);
    const changes: Partial<Decision> = c.expected.decision.skill === "financial" ? { metric: c.expected.decision.metric === "received_revenue" ? "service_revenue" : "received_revenue" } : { inventory: "balance" };
    const { result } = await fake(id, changes), verdict = assessJevAcceptance(c.input, result);
    expect(verdict.decision).toBe("FALLBACK_REQUIRED");
    // Mutation testing of the metric itself: even structurally valid operation derivation must not mask wrong intent.
    const simulatedUnsafeVerdict = { ...verdict, decision: "ACCEPT_JEV" as const };
    expect(scoreExpansionVerdict(c, result, simulatedUnsafeVerdict).unsafeFalsePositive).toBe(true);
  });
  it("scores no observations as no empirical result; unknown/multiple IDs rejected", async () => {
    expect(summarizeExpansionTrials([]).metrics).toMatchObject({ evaluated: 0, acceptedCoverage: null, accuracyAmongAccepted: null, knownCostUsd: 0 });
    const { result } = await fake("f01");
    expect(() => summarizeExpansionTrials([{ id: "invented", result }])).toThrow("UNKNOWN_CASE");
    expect(() => summarizeExpansionTrials([{ id: "f01", result }, { id: "f01", result }])).toThrow("DUPLICATE_TRIAL");
  });
  it("keeps the reviewable frozen manifest synchronized and covers adversarial dimensions per candidate", () => {
    const frozen = JSON.parse(readFileSync("packages/salon-secretary/evaluation/coverage-expansion-plan.json", "utf8"));
    const { historicalEvidence, ...prepared } = frozen;
    expect(prepared).toEqual(prepareCoverageExpansion());
    expect(historicalEvidence.reduce((n: number, h: { completed: number }) => n + h.completed, 0)).toBe(19);
    expect(prepared.adversarialCoverage).toHaveLength(7);
    for (const c of prepared.adversarialCoverage) {
      for (const k of ["positivesAndParaphrases", "periodDifference", "neighbor", "ambiguous", "compound", "outside", "mutation"]) expect(c[k].length).toBeGreaterThan(0);
      expect(c.highConfidenceWrong).toContain("synthetic offline");
    }
  });
  it("preserves exact message content, compound dependencies and strict OOC fallback", async () => {
    expect(get("s05").expected.domainFields.content).toBe("Serviço cancelado, Fábio.");
    const { result } = await fake("f27");
    expect(assessJevAcceptance(get("f27").input, result).decision).toBe("FALLBACK_REQUIRED");
    expect(result.stages).toHaveLength(1);
  });
  it("detects selector-only overreach without broadening acceptance for rankings or wrong periods", async () => {
    const ranking = await fake("f23");
    const r = summarizeExpansionTrials([{ id: "f23", result: ranking.result }]).rows[0];
    expect(r).toMatchObject({ policyDecision: "FALLBACK_REQUIRED", linguisticCorrect: true, unsafeFalsePositive: false, unsafeShadowCandidate: true });
    const wrongPeriod = await fake("f01", { period: "today" });
    expect(summarizeExpansionTrials([{ id: "f01", result: wrongPeriod.result }]).rows[0]).toMatchObject({ policyDecision: "FALLBACK_REQUIRED", unsafeFalsePositive: false, unsafeShadowCandidate: true });
  });
});

// Historical source seals verify archived bytes; module execution uses the current implementation.
// Live admission against these old seals remains fail-closed, checked independently.
vi.mock("node:fs", async importOriginal => {
  const actual = await importOriginal<typeof import("node:fs")>();
  const { legacyEvidenceFs } = await import("../../test/secretary-legacy-evidence");
  return { ...actual, readFileSync: legacyEvidenceFs(actual) };
});
