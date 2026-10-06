import { createHash } from "node:crypto";
import { readFileSync } from "node:fs";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { financialInterpretation, financialRequirements } from "../../../packages/salon-secretary/src/financial-skill";
import { buildFinancialSemanticBoundaryAudit, financialAuditSources,
  assessFinancialSemanticCoverage, semanticIntentSignature } from "../../../packages/salon-secretary/evaluation/financial-semantic-boundary";

beforeEach(() => vi.stubGlobal("fetch", vi.fn(() => { throw Error("NO_NETWORK_IN_SEMANTIC_AUDIT"); })));
afterEach(() => vi.unstubAllGlobals());
const audit = buildFinancialSemanticBoundaryAudit();
const row = (id: string) => audit.rows.find(c => c.id === id)!;
const closedObserved = (policyAccepted: boolean, unrepresented: Parameters<typeof assessFinancialSemanticCoverage>[0]["unrepresented"] = []) =>
  assessFinancialSemanticCoverage({ semanticClass: "CLOSED_BUT_UNCALIBRATED", providerValid: true, policyAccepted,
    expected: { skill: "financial", shape: "single", metric: "service_revenue", period: "this_month", operation: "financial.report" },
    observed: { skill: "financial", shape: "single", metric: "service_revenue", period: "this_month", operation: "financial.report" },
    unrepresented });

describe("Financial semantic boundary, offline oracle only", () => {
  it("preserves frozen f01–f23 evidence and f24–f32 unexecuted", () => {
    for (const source of Object.values(financialAuditSources))
      expect(createHash("sha256").update(readFileSync(source.path)).digest("hex")).toBe(source.sha256);
    expect(audit).toMatchObject({ executed: false, evaluationOnly: true, observedCount: 23, unexecutedCount: 9 });
    expect(audit.rows).toHaveLength(32);
    expect(audit.rows.slice(23).every(c => c.observed === null)).toBe(true);
    expect(audit.counts).toEqual({ CLOSED_FINANCIAL: 1, CLOSED_BUT_UNCALIBRATED: 17,
      MODIFIER_NOT_REPRESENTED: 4, OPEN_EXTRACTION_REQUIRED: 3, COMPOUND: 2, OUT_OF_CATALOG: 5 });
    expect(JSON.parse(readFileSync("packages/salon-secretary/evaluation/financial-semantic-boundary-audit.json", "utf8"))).toEqual(audit);
  });

  it("leaves the approved parser, provider, Policy and derivation catalog unchanged", () => {
    const approvedHashes = {
      "packages/salon-secretary/evaluation/conditional-plan.ts": "836ef27063f0a191d409b9103b5d4f6fce8db86b1d85dfa03e74ff03585f0761",
      "packages/salon-secretary/evaluation/jev-provider.ts": "44449d30c852e36fe277ef7572d8de7ed0bf86d6e61f7535894303c065024960",
      "packages/salon-secretary/evaluation/acceptance-policy.ts": "ba2223442b203b6c0a055662b7a6f861e648bdfe06bb0fc680da7da7eca0958c",
      "packages/salon-secretary/evaluation/derivation-catalog.ts": "93c145a85ad25f32e813a08a61e068f5d7590ef148abc36422a6959c32a9a6b1",
    };
    for (const [path, expectedHash] of Object.entries(approvedHashes))
      expect(createHash("sha256").update(readFileSync(path)).digest("hex")).toBe(expectedHash);
  });

  it("maps only the published Financial selectors and keeps ranking direction/limit outside the schema", () => {
    expect(financialRequirements()).toMatchObject({ operation: "financial.report", tool: "T09", read_only: true,
      metrics: ["service_revenue", "realized_revenue", "received_revenue", "completed_count", "average_ticket", "outstanding_receivables"],
      periods: ["today", "yesterday", "this_week", "last_week", "this_month", "last_month"],
      group_by: ["professional", "service"] });
    expect(financialInterpretation.safeParse({ metrics: ["service_revenue"], period: "this_month", group_by: "professional" }).success).toBe(true);
    expect(financialInterpretation.safeParse({ metrics: ["service_revenue"], period: "this_month", ranking: "highest" }).success).toBe(false);
    expect(financialInterpretation.safeParse({ metrics: ["service_revenue"], period: "this_month", limit: 1 }).success).toBe(false);
    expect(financialInterpretation.safeParse({ metrics: ["service_revenue"], period: "this_month", professional_name: "Amanda" }).success).toBe(false);
  });

  it("keeps f01 accepted and f02 paraphrase semantically equivalent but uncalibrated", () => {
    expect(row("f01").observed?.coverage?.fullJevBypassObserved).toBe(true);
    expect(row("f02").reviewedSemanticRequirement.signature).toEqual(row("f01").reviewedSemanticRequirement.signature);
    expect(row("f02").observed?.coverage).toMatchObject({ semanticallyClosed: true, fullJevBypassObserved: false });
    expect(row("f02").observed?.policy).toMatchObject({ decision: "FALLBACK_REQUIRED", reason: "UNCALIBRATED_INPUT" });
  });

  it("distinguishes a simple monthly total from professional ranking despite identical metric and period", () => {
    const simple = semanticIntentSignature("service_revenue", "this_month");
    const ranking = semanticIntentSignature("service_revenue", "this_month", { groupBy: "professional", rankingDirection: "highest", topLimit: 1 });
    expect(simple).not.toEqual(ranking);
    expect(closedObserved(true)).toMatchObject({ semanticallyClosed: true, fullJevBypassObserved: true });
    const f23 = row("f23");
    expect(f23.reviewedSemanticRequirement.signature).toEqual(ranking);
    expect(f23.observed?.coverage).toMatchObject({ matchingDimensions: ["skill", "shape", "metric", "period", "operation"],
      missingSemanticDimensions: ["group_by", "ranking_direction", "top_limit"], semanticallyClosed: false, fullJevBypassObserved: false });
    expect(f23.observed?.policy.decision).toBe("FALLBACK_REQUIRED");
  });

  it("keeps service ranking outside the current JEV decision-plan", () => {
    expect(row("f24")).toMatchObject({ semanticClass: "MODIFIER_NOT_REPRESENTED", observed: null,
      reviewedSemanticRequirement: { unrepresented: ["group_by", "ranking_direction", "top_limit"] } });
    expect(row("f24").reviewedSemanticRequirement.signature).toMatchObject({ groupBy: "service", rankingDirection: "highest", topLimit: 1 });
  });

  it("keeps received revenue closed but rejects the invalid f04 provider vector", () => {
    expect(row("f04")).toMatchObject({ semanticClass: "CLOSED_BUT_UNCALIBRATED",
      observed: { providerValid: false, historicalClassification: "INVALID_PROVIDER_RESPONSE",
        coverage: { semanticallyClosed: false, fullJevBypassObserved: false } } });
    expect(row("f05").observed?.coverage).toMatchObject({ semanticallyClosed: true, fullJevBypassObserved: false });
  });

  it("keeps missing Financial period unresolved even when the JEV choice is none", () => {
    expect(row("f19")).toMatchObject({ semanticClass: "OPEN_EXTRACTION_REQUIRED",
      observed: { coverage: { missingCoreDimensions: expect.arrayContaining(["period"]),
        missingSemanticDimensions: ["required_period"], semanticallyClosed: false } } });
  });

  it("preserves current receivables with period none and identifies f07 discovery uncertainty", () => {
    expect(row("f07").reviewedSemanticRequirement.signature?.period).toBe("none");
    expect(row("f07").observed?.coverage).toMatchObject({ semanticallyClosed: false,
      missingCoreDimensions: expect.arrayContaining(["shape", "metric", "period", "operation"]) });
    expect(row("f08").observed?.coverage?.semanticallyClosed).toBe(true);
    expect(row("f21")).toMatchObject({ semanticClass: "OUT_OF_CATALOG",
      reviewedSemanticRequirement: { unrepresented: ["historical_receivables"] } });
  });

  it("requires both comparison periods rather than accepting the single comparison choice", () => {
    expect(row("f22")).toMatchObject({ semanticClass: "MODIFIER_NOT_REPRESENTED",
      reviewedSemanticRequirement: { unrepresented: ["current_period", "compare_period"],
        signature: { comparisonPeriod: "last_week" } },
      observed: { coverage: { semanticallyClosed: false } } });
  });

  it("keeps a Financial + Scheduling compound request outside full bypass", () => {
    expect(row("f26")).toMatchObject({ semanticClass: "COMPOUND", semanticallyPossibleFullBypass: false,
      reviewedSemanticRequirement: { unrepresented: ["other_skill_operation", "open_entity"] } });
    expect(row("f25").semanticClass).toBe("COMPOUND");
    expect(row("f31")).toMatchObject({ semanticClass: "MODIFIER_NOT_REPRESENTED",
      reviewedSemanticRequirement: { unrepresented: ["metric_set"] } });
  });

  it("distinguishes average ticket and completed count despite the Scheduling confusion", () => {
    expect(row("f10").observed?.coverage).toMatchObject({ semanticallyClosed: true, fullJevBypassObserved: false });
    expect(financialRequirements().metrics).toContain("completed_count");
    for (const id of ["f16", "f17", "f18"]) {
      expect(row(id)).toMatchObject({ semanticClass: "CLOSED_BUT_UNCALIBRATED",
        observed: { selectors: { skill: "scheduling" }, coverage: { semanticallyClosed: false, fullJevBypassObserved: false } } });
    }
  });

  it("does not mistake out-of-catalog Financial requests for service revenue", () => {
    for (const id of ["f27", "f28", "f29", "f30"]) {
      expect(row(id)).toMatchObject({ semanticClass: "OUT_OF_CATALOG", semanticallyPossibleFullBypass: false,
        nextHandling: "REJECT_OR_CLARIFY" });
    }
    expect(row("f32")).toMatchObject({ semanticClass: "OPEN_EXTRACTION_REQUIRED",
      reviewedSemanticRequirement: { unrepresented: ["sales_semantics"] } });
  });

  it("never upgrades an unrepresented modifier with high confidence or a hypothetical policy accept", () => {
    const result = closedObserved(true, ["group_by", "ranking_direction", "top_limit"]);
    expect(result).toMatchObject({ semanticallyClosed: false, fullJevBypassObserved: false });
    expect(vi.mocked(fetch)).not.toHaveBeenCalled();
  });
});

// Historical source identity only; current behavioral tests remain active.
vi.mock("node:fs", async importOriginal => {
  const actual = await importOriginal<typeof import("node:fs")>();
  const { legacyEvidenceFs } = await import("../../test/secretary-legacy-evidence");
  return { ...actual, readFileSync: legacyEvidenceFs(actual) };
});
