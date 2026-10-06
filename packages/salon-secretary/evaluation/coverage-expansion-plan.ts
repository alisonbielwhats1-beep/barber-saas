import { createHash } from "node:crypto";
import { assessJevAcceptance, type AcceptanceVerdict } from "./acceptance-policy";
import { choiceSets, type QuestionId } from "./contract";
import { classifyExpansionCase, auditExpansionGolden, operationMatrix, COVERAGE_VERSION } from "./coverage-expansion";
import { expansionDataset, validateExpansionDataset, type ExpansionCase } from "./coverage-expansion-dataset";
import { derivedRequest, type DerivedResult } from "./derived-plan";
import { derivationCatalog, derivationCatalogHash, isAuditedPublication, publishedDecisionCatalog } from "./derivation-catalog";
import { INPUT_USD_PER_MILLION } from "./jev-provider";

const sha = (value: unknown) => createHash("sha256").update(JSON.stringify(value)).digest("hex");
export const waveSkills = { 1: ["financial"], 2: ["inventory"], 3: ["services", "customers"], 4: ["scheduling", "communication"] } as const;
export function adversarialCoverageByIntent() {
  return [...new Set(expansionDataset.filter(c => c.wave === 1 && !c.expected.requiresOpenExtraction && c.category !== "D").map(c => c.expected.decision.metric))].map(metric => ({
    intent: metric as string,
    positivesAndParaphrases: expansionDataset.filter(c => c.wave === 1 && c.expected.decision.metric === metric && !c.expected.requiresOpenExtraction).map(c => c.id),
    periodDifference: metric === "outstanding_receivables" ? ["f21"] : expansionDataset.filter(c => c.expected.decision.metric === metric && c.tag === "PERIOD").map(c => c.id),
    neighbor: metric === "received_revenue" ? ["f01", "f07"] : ["f04"],
    ambiguous: ["f20", "f32"], compound: ["f25", "f26"], outside: ["f27", "f28", "f29"], mutation: ["f30"],
    highConfidenceWrong: "synthetic offline 0.99 wrong-intent trials for each closed input; not a provider observation",
    note: "Shared negatives challenge multiple intents; not counted as independent repeated evaluations",
  })).concat([{ intent: "low_stock", positivesAndParaphrases: ["i01", "i02", "i03"], periodDifference: ["i12"],
    neighbor: ["i04", "i06"], ambiguous: ["i11"], compound: ["i13", "i14"], outside: ["i15", "i16"], mutation: ["i08", "i09", "i10"],
    highConfidenceWrong: "synthetic offline 0.99 balance instead of low_stock", note: "Inventory has no period selector; i12 changes filter, not period" }]);
}
/** Explicit envelope: no transport, env, credential or database. Only payloads are sendable. */
export function prepareCoverageExpansion() {
  if (!isAuditedPublication(publishedDecisionCatalog())) throw Error("CATALOG_DRIFT");
  const cases = validateExpansionDataset().map(c => ({ id: c.id, wave: c.wave, tag: c.tag, message: c.input.message,
    classification: classifyExpansionCase(c), expected: c.expected,
    payloads: { discovery: derivedRequest(c.input, { kind: "discovery" }),
      // Prebuild all authorized branches, never select detail using expected or category.
      detailBySkill: Object.fromEntries(waveSkills[c.wave].map(skill => [skill, derivedRequest(c.input, { kind: "detail", skill })])) },
  }));
  const waves = ([1, 2, 3, 4] as const).map(wave => {
    const entries = cases.filter(c => c.wave === wave), maxHttpCalls = entries.length * 2;
    return { wave, cases: entries, caseCount: entries.length, maxHttpCalls,
      maximumPlanningEstimateUsd: maxHttpCalls * 64_000 * INPUT_USD_PER_MILLION / 1_000_000 };
  });
  return { version: COVERAGE_VERSION, executed: false, transportAvailable: false, retries: 0, acceptancePolicyChanged: false,
    catalog: { version: derivationCatalog.version, hash: derivationCatalogHash(derivationCatalog), publicationHash: derivationCatalog.publicationHash },
    datasetHash: sha(expansionDataset), payloadsHash: sha(cases.map(c => c.payloads)),
    pricing: { inputUsdPerMillion: INPUT_USD_PER_MILLION, outputUsdPerMillion: 0, evidenceDate: "2026-09-22", currentRateVerified: false,
      maxInputTokensPerHttp: 64_000, rule: "Reconfirm official tariff before future real execution; no pricing/network call in preparation" },
    waves, maxHttpCalls: waves.reduce((n, w) => n + w.maxHttpCalls, 0),
    maximumPlanningEstimateUsd: waves.reduce((n, w) => n + w.maximumPlanningEstimateUsd, 0),
    detailRule: "Validated discovery: single + Skill in current wave only; otherwise fallback, no detail. Never route by expected. Max 2 HTTP per case.",
    stopOn: ["UNSAFE_FALSE_POSITIVE", "UNSAFE_SHADOW_CANDIDATE", "STRICT_PROBABILITY_OR_SCHEMA_FAILURE", "CATALOG_OR_PAYLOAD_HASH_DRIFT", "FORBIDDEN_PAYLOAD_DATA", "BUDGET_EXCEEDED", "UNHANDLED_ERROR"],
    waveTransition: "Separate approval; never progress after any unsafe false positive in earlier waves",
    noEffects: ["OpenAI", "Luna fallback", "business tools", "database", "Meta", "runtime routing"],
    matrix: operationMatrix(), goldenAudit: auditExpansionGolden(), adversarialCoverage: adversarialCoverageByIntent() };
}

const rate = (a: number, b: number) => b ? a / b : null;
function distribution(input: number[]) {
  const v = [...input].sort((a, b) => a - b);
  const percentile = (p: number) => {
    if (!v.length) return null;
    const index = (v.length - 1) * p, lower = Math.floor(index);
    return v[lower] + (v[Math.ceil(index)] - v[lower]) * (index - lower);
  };
  return { n: v.length, min: v[0] ?? null, p50: percentile(.5), mean: v.length ? v.reduce((a, b) => a + b, 0) / v.length : null, p95Descriptive: percentile(.95), max: v.at(-1) ?? null };
}

/** Scoring oracle only. Must never enter the payload or authorize an operation. */
export function scoreExpansionVerdict(c: ExpansionCase, result: DerivedResult, verdict: AcceptanceVerdict) {
  const plan = classifyExpansionCase(c), expected = c.expected.decision;
  const linguisticCorrect = result.status === "OK" && !!result.decision && (Object.keys(expected) as QuestionId[]).every(k => result.decision![k] === expected[k]);
  const accepted = verdict.decision === "ACCEPT_JEV";
  const unsafeFalsePositive = accepted && (!linguisticCorrect || !plan.fullBypassPotential);
  // An unchanged policy rejects unregistered inputs. Separately challenge the hypothesis
  // that closed selectors alone would suffice: omitted ranking/filter/compound semantics
  // must count as dangerous even when their coarse projection matches the oracle.
  const shadowClosedCandidate = result.status === "OK" && result.closedCoverage && !result.requiresLuna;
  const unsafeShadowCandidate = shadowClosedCandidate && (!linguisticCorrect || !plan.fullBypassPotential);
  const classification = unsafeFalsePositive ? "UNSAFE_FALSE_POSITIVE" : accepted ? "CORRECT_ACCEPT" :
    plan.evidenceState === "PROVEN" && linguisticCorrect ? "FALSE_FALLBACK" : plan.proposedValue === "OUT_OF_CATALOG" ? "OUT_OF_CATALOG_FALLBACK" : "CORRECT_FALLBACK_UNDER_V1";
  const confidence = (Object.keys(result.answers) as QuestionId[]).flatMap(dimension => {
    const answer = result.answers[dimension];
    if (!answer || result.dimensionSources[dimension] !== "ASKED") return [];
    const sorted = Object.entries(answer.probabilities).sort((a, b) => b[1] - a[1]);
    const runner = sorted.find(([choice]) => choice !== answer.choice);
    return [{ dimension, selectedChoice: answer.choice, probability: answer.probabilities[answer.choice], confidence: answer.confidence,
      runnerUp: runner?.[0] ?? null, runnerUpProbability: runner?.[1] ?? null,
      margin: runner ? sorted[0][1] - sorted[1][1] : null,
      correct: answer.choice === expected[dimension], selectedIsTop1: answer.choice === sorted[0]?.[0] }];
  });
  return { id: c.id, wave: c.wave, intent: expected.metric !== "none" ? expected.metric : expected.inventory !== "none" ? expected.inventory : expected.operation,
    skill: expected.skill, risks: plan.riskClasses, value: plan.proposedValue, evidenceState: plan.evidenceState,
    policyDecision: verdict.decision, reason: verdict.reason, classification, linguisticCorrect, unsafeFalsePositive,
    shadowClosedCandidate, unsafeShadowCandidate,
    predicted: result.decision, expectedClosedProjection: expected, derivations: result.derivations, provenance: result.dimensionSources,
    status: result.status, error: result.error, fallbackReasons: result.fallbackReasons,
    // Intent correctness from the oracle is evidence for calibration, NOT a new ACCEPT.
    potentialBypassCorrect: plan.fullBypassPotential && linguisticCorrect,
    calibrationOnlyCorrectNotAccepted: plan.evidenceState === "CALIBRATION_CANDIDATE" && linguisticCorrect && !accepted,
    fullBypassAccepted: accepted && !unsafeFalsePositive,
    routingOnlyCorrect: plan.routingOnlyPotential && result.answers.skill?.choice === expected.skill &&
      result.decision?.operation === expected.operation && result.decision?.shape === expected.shape,
    confidence, latencyMs: result.latencyMs, httpCalls: result.stages.length,
    http: result.stages.map(s => ({ stage: s.stage, latencyMs: s.result.latencyMs, usage: s.result.usage, estimatedCostUsd: s.result.estimatedCostUsd,
      diagnostic: s.result.invalidResponseDiagnostic ?? null })),
    usage: result.usage, estimatedCostUsd: result.estimatedCostUsd, executable: false };
}

/** Offline-only harness: caller supplies saved/fake results; no provider is invoked here. */
export function summarizeExpansionTrials(trials: readonly { id: string; result: DerivedResult }[]) {
  if (new Set(trials.map(t => t.id)).size !== trials.length) throw Error("DUPLICATE_TRIAL");
  const rows = trials.map(t => {
    const c = expansionDataset.find(c => c.id === t.id);
    if (!c) throw Error("UNKNOWN_CASE");
    return scoreExpansionVerdict(c, t.result, assessJevAcceptance(c.input, t.result));
  });
  const accepted = rows.filter(r => r.policyDecision === "ACCEPT_JEV"), confidence = rows.flatMap(r => r.confidence);
  const breakdown = (key: "skill" | "intent" | "risk") => Object.fromEntries([...new Set(rows.flatMap(r => key === "risk" ? r.risks : [r[key]]))].map(label => {
    const group = rows.filter(r => key === "risk" ? r.risks.includes(label as typeof r.risks[number]) : r[key] === label);
    return [label, { evaluated: group.length, fullBypassAccepted: group.filter(r => r.fullBypassAccepted).length, routingOnlyCorrect: group.filter(r => r.routingOnlyCorrect).length, unsafeFalsePositive: group.filter(r => r.unsafeFalsePositive).length }];
  }));
  return { empiricalOnlyIfRealInputs: true, rows, metrics: {
    evaluated: rows.length, acceptedCoverage: rate(accepted.length, rows.length), fullBypassCoverage: rate(rows.filter(r => r.fullBypassAccepted).length, rows.length),
    routingOnlyCoverage: rate(rows.filter(r => r.routingOnlyCorrect).length, rows.length),
    forcedLunaRate: rate(rows.filter(r => r.evidenceState === "FORCED_LUNA").length, rows.length),
    fallbackRate: rate(rows.length - accepted.length, rows.length), correctAccept: rows.filter(r => r.classification === "CORRECT_ACCEPT").length,
    correctFallback: rows.filter(r => ["CORRECT_FALLBACK_UNDER_V1", "OUT_OF_CATALOG_FALLBACK"].includes(r.classification)).length,
    falseFallback: rows.filter(r => r.classification === "FALSE_FALLBACK").length, unsafeFalsePositive: rows.filter(r => r.unsafeFalsePositive).length,
    unsafeShadowCandidate: rows.filter(r => r.unsafeShadowCandidate).length,
    accuracyAmongAccepted: rate(accepted.filter(r => !r.unsafeFalsePositive).length, accepted.length),
    calibrationOnlyCorrectNotAccepted: rows.filter(r => r.calibrationOnlyCorrectNotAccepted).length,
    bySkill: breakdown("skill"), byRisk: breakdown("risk"), byIntent: breakdown("intent"),
    confidenceDistribution: confidence, confidenceSummary: distribution(confidence.flatMap(c => c.confidence === null ? [] : [c.confidence])),
    marginSummary: distribution(confidence.flatMap(c => c.margin === null ? [] : [c.margin])), latencyMs: distribution(rows.map(r => r.latencyMs)),
    httpCalls: rows.reduce((n, r) => n + r.httpCalls, 0),
    knownCostUsd: rows.reduce((n, r) => n + (r.estimatedCostUsd ?? 0), 0), costMissingCases: rows.filter(r => r.estimatedCostUsd === null).length,
    inputTokensKnown: rows.reduce((n, r) => n + (r.usage.inputTokens ?? 0), 0), outputTokensKnown: rows.reduce((n, r) => n + (r.usage.outputTokens ?? 0), 0),
  }, note: "No candidate promoted. Routing-only still needs Luna. Dataset frequency is not production frequency." };
}

/** Validates question identifiers remain within the unchanged published evaluation contract. */
export function validateExpansionQuestions() {
  const plan = prepareCoverageExpansion();
  for (const wave of plan.waves) for (const c of wave.cases) for (const payload of [c.payloads.discovery, ...Object.values(c.payloads.detailBySkill)]) {
    for (const [id, q] of Object.entries(payload.questions)) {
      if (!(id in choiceSets) || Object.keys(q.criteria).some(v => !(choiceSets[id as QuestionId] as readonly string[]).includes(v))) throw Error("QUESTION_DRIFT");
    }
  }
  return plan;
}
