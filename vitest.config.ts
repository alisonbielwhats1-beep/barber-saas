import { existsSync } from "fs";
import { configDefaults, defineConfig } from "vitest/config";
import path from "path";

/** Secretary evaluation harnesses that replay local evidence: run results under packages/salon-secretary/evaluation/results
 * and the coordinator files under .demo/agenda-core. Neither is in the repository, so a clean checkout (CI) cannot run them.
 * Each one runs wherever its evidence exists (the evaluation worktree) and is skipped, with a notice, where it does not.
 * Never add a product test here: only harnesses whose evidence is local by design. */
const LOCAL_EVIDENCE: Record<string, string> = {
  "src/lib/__tests__/final-analysis-annotation.test.ts": ".demo/agenda-core/final-analysis.cjs",
  "src/lib/__tests__/hard-conversations-durable.test.ts": "packages/salon-secretary/evaluation/results/hard-conversations-revalidate-i01-result.json",
  "src/lib/__tests__/scheduling-reason-source.test.ts": "packages/salon-secretary/evaluation/results/topic14-final/real-manifest.json",
  "src/lib/__tests__/topic14-evaluator.test.ts": "packages/salon-secretary/evaluation/results/topic14-final/real-manifest.json",
  "src/lib/__tests__/secretary-customer-history.test.ts": "packages/salon-secretary/evaluation/results/topic14-final/real-manifest.json",
  "src/lib/__tests__/secretary-root-helper-history.test.ts": "packages/salon-secretary/evaluation/results/topic14-final/real-manifest.json",
  "src/lib/__tests__/secretary-agent-contamination.test.ts": ".demo/agenda-core/c4-failure-excerpts.md",
  "src/lib/__tests__/secretary-pilot-astar-prompt.test.ts": ".demo/agenda-core/c4-failure-excerpts.md",
  "src/lib/__tests__/secretary-pilot-e2a-prompt.test.ts": ".demo/agenda-core/c4-failure-excerpts.md",
  "src/lib/__tests__/secretary-pilot-e2b-prompt.test.ts": ".demo/agenda-core/c4-failure-excerpts.md",
  "src/lib/__tests__/ultimate-10-continuation.test.ts": "packages/salon-secretary/evaluation/results/ultimate-10.jsonl",
  "src/lib/__tests__/ultimate-10-harness.test.ts": "packages/salon-secretary/evaluation/results/ultimate-10.jsonl",
};
const withoutEvidence = Object.entries(LOCAL_EVIDENCE).filter(([, evidence]) => !existsSync(path.resolve(__dirname, evidence)));
if (withoutEvidence.length) {
  console.warn(`[vitest] ${withoutEvidence.length} Secretary evaluation harnesses skipped: their local evidence is not in this checkout.\n` +
    withoutEvidence.map(([file, evidence]) => `  - ${file} (needs ${evidence})`).join("\n"));
}

export default defineConfig({
  oxc: {
    jsx: {
      runtime: "automatic",
    },
  },
  resolve: {
    alias: { "@": path.resolve(__dirname, "./src") },
  },
  test: {
    include: ["src/**/*.test.{ts,tsx}"],
    exclude: [...configDefaults.exclude, ...withoutEvidence.map(([file]) => file)],
    setupFiles: ["./src/test/setup-dom.ts"],
  },
});
