/** Offline only: emits the exact proposed payloads, never loads .env or sends HTTP. */
import { dataset, validateDataset } from "./dataset";
import { buildJevRequest, INPUT_USD_PER_MILLION } from "./jev-provider";
export const firstRunIds = ["financial-revenue", "scheduling-cancel", "inventory-low", "communication-dependent-name"];
export function prepareFirstRun() {
  const validated = validateDataset(dataset);
  const cases = firstRunIds.map(id => {
    const found = validated.find(c => c.id === id);
    if (!found) throw Error("FIRST_RUN_CASE_MISSING");
    return found;
  });
  return { executed: false, calls: cases.length, retries: 0, timeoutMs: 10_000,
    priceAuditedOn: "2026-09-22", priceSource: "https://docs.typesafe.ai/models",
    // Conservative envelope: full published 64k input budget per request, not a token prediction.
    conservativeEstimatedMaximumUsd: cases.length * 64_000 * INPUT_USD_PER_MILLION / 1_000_000,
    requests: cases.map(c => ({ caseId: c.id, payload: buildJevRequest(c.input), expected: c.expected.decision, expectedLunaFallback: c.expected.requiresOpenExtraction || c.category !== "B" })),
  };
}
