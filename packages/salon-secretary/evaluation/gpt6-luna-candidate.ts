import { dataset, validateDataset } from "./dataset";

export const GPT6_LUNA_CANDIDATE_MODEL = "gpt-6-luna" as const;
export const GPT56_LUNA_HISTORICAL_MODEL = "gpt-5.6-luna" as const;

const selections = [
  ["services-create", "src/test/fixtures/secretary-real-outputs.json#gate21-0"],
  ["services-price", "src/test/fixtures/secretary-real-outputs.json#gate21-3"],
  ["customers-create", "src/test/fixtures/secretary-real-outputs.json#gate21-2"],
  ["scheduling-create", "src/test/fixtures/secretary-real-outputs.json#gate22-0"],
  ["scheduling-change", "src/test/fixtures/secretary-real-outputs.json#gate23-0"],
  ["scheduling-batch", "src/test/fixtures/secretary-real-outputs.json#gate24-0"],
  ["financial-revenue", "packages/salon-secretary/evaluation/luna-baselines.json#financial-revenue"],
  ["inventory-low", "docs/SECRETARIA_GATE_2_6.md#real-run"],
  ["communication-exact", "docs/SECRETARIA_GATE_2_7.md#real-run"],
  ["communication-dependent-name", "packages/salon-secretary/evaluation/luna-baselines.json#communication-dependent-name"],
] as const;

/** Frozen messages and backend-reviewed expected values; no new model output is used as ground truth. */
export const gpt6LunaGolden = selections.map(([id, historicalSource]) => {
  const source = validateDataset(dataset).find(item => item.id === id);
  if (!source) throw new Error(`GPT6_GOLDEN_CASE_MISSING:${id}`);
  return {
    id, message: source.input.message, context: source.input.context,
    expected: source.expected, evidence: source.evidence,
    historical: { model: GPT56_LUNA_HISTORICAL_MODEL, source: historicalSource,
      comparability: historicalSource.startsWith("docs/") ? "report_only" as const : "structured_output" as const },
    candidate: { model: GPT6_LUNA_CANDIDATE_MODEL, status: "NOT_RUN" as const },
  };
});

export type CandidateObservation = {
  caseId: string; modelRequested: string; modelReturned: string | null;
  skills: string[]; operations: string[]; dependencies: { from: number; to: number }[];
  fields: Record<string, unknown>; boundaryAccepted: boolean; backendValidated: boolean;
  inferenceCount: number; retries: number; latencyMs: number;
  usage: { inputTokens: number; cachedInputTokens: number; cacheWriteTokens: number; outputTokens: number;
    reasoningTokens: number; totalTokens: number };
};

export function compareCandidate(observation: CandidateObservation) {
  const golden = gpt6LunaGolden.find(c => c.id === observation.caseId);
  if (!golden) throw new Error("GPT6_GOLDEN_CASE_UNKNOWN");
  const same = (a: unknown, b: unknown) => JSON.stringify(a) === JSON.stringify(b);
  return {
    caseId: golden.id, modelCorrect: observation.modelRequested === GPT6_LUNA_CANDIDATE_MODEL && observation.modelReturned === GPT6_LUNA_CANDIDATE_MODEL,
    skillCorrect: same([...observation.skills].sort(), [...golden.expected.skills].sort()),
    operationCorrect: same(observation.operations, golden.expected.operations),
    dependencyCorrect: same(observation.dependencies, golden.expected.dependencies),
    fieldExactMatch: same(observation.fields, golden.expected.domainFields),
    boundaryAccepted: observation.boundaryAccepted, backendValidated: observation.backendValidated,
    noRetries: observation.retries === 0,
  };
}

/** Official Standard, short-context GPT-6 Luna USD per 1M tokens, checked 2026-09-22. */
export const gpt6LunaStandardRates = { input: 0.10, cachedInput: 0.01, cacheWrite: 0.125, output: 0.50 } as const;
export function estimatedGpt6LunaCost(usage: CandidateObservation["usage"]): number {
  const { inputTokens, cachedInputTokens, cacheWriteTokens, outputTokens } = usage;
  if (![inputTokens, cachedInputTokens, cacheWriteTokens, outputTokens].every(v => Number.isSafeInteger(v) && v >= 0) ||
      cachedInputTokens + cacheWriteTokens > inputTokens || inputTokens > 272_000) throw new Error("GPT6_COST_BASIS_UNSUPPORTED");
  const uncached = inputTokens - cachedInputTokens - cacheWriteTokens;
  return (uncached * gpt6LunaStandardRates.input + cachedInputTokens * gpt6LunaStandardRates.cachedInput +
    cacheWriteTokens * gpt6LunaStandardRates.cacheWrite + outputTokens * gpt6LunaStandardRates.output) / 1_000_000;
}
