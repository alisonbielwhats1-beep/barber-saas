import { readFileSync } from "node:fs";
import type { PrismaClient } from "@prisma/client";
import { digest } from "./hard-conversations-durable";
import { benchmarkCases, benchmarkFixture, type BenchmarkCase } from "./multi-action-benchmark-cases";
import { sourceHashes } from "./multi-action-benchmark-harness";
import { precheckPhaseACase, snapshotPhaseACase } from "./hard-conversations-phase-a-db";


import plan from "./conversational-ux-microbattery-plan.json";
import evidence from "../../../src/test/fixtures/conversational-ux-benchmark.json";

import healing from "./conversational-ux-final-plan.json";
import { readDurable, checkpoint } from "./hard-conversations-durable";
export { scoreTargetUX } from "./conversational-ux-target";
const PREDECESSOR = "packages/salon-secretary/evaluation/results/conversational-ux-real";
export const TARGET_RESULTS = PREDECESSOR + "/final-x49";
const historyPath = "packages/salon-secretary/evaluation/results/multi-action-benchmark/real-result-1790294537166.json";
const oldManifest = "packages/salon-secretary/evaluation/results/multi-action-benchmark/real-manifest.json";
const planPath = "packages/salon-secretary/evaluation/conversational-ux-microbattery-plan.json";
const originalCases = benchmarkCases.filter(c => plan.case_ids.includes(c.id));
export const targetCases = originalCases.filter(c => healing.case_ids.includes(c.id));
export function canStartCompleteCase(newRequests: number, caseId: string) {
  const c = targetCases.find(item => item.id === caseId);
  if (!c || !Number.isSafeInteger(newRequests) || newRequests < 0 || newRequests > healing.max_new_requests)
    throw Error("SELF_HEALING_CASE_BUDGET");
  return healing.previous_requests + newRequests + c.messages.length <= healing.max_combined_requests;
}
export function targetHashes() {
  return { ...sourceHashes(), ...Object.fromEntries([
    ...Object.keys(plan.source_hashes), planPath, "packages/salon-secretary/evaluation/conversational-ux-final-plan.json", "packages/salon-secretary/evaluation/conversational-ux-final-target.ts", "src/test/fixtures/conversational-ux-benchmark.json",
    "packages/salon-secretary/evaluation/conversational-ux-target.ts",
    "packages/salon-secretary/evaluation/conversational-ux-timing.ts",
    "packages/salon-secretary/evaluation/multi-action-benchmark-real.ts",
    "packages/salon-secretary/evaluation/hard-conversations-phase-a-db.ts",
    "packages/salon-secretary/evaluation/hard-conversations-durable.ts",
    "packages/salon-secretary/evaluation/hard-conversations-observation-bridge.ts",
    "prisma/schema.prisma",
  ].map(f => [f, digest(readFileSync(f))])) };
}
export function verifyFrozenTarget() {
  if (JSON.stringify(plan.case_ids) !== JSON.stringify(["x41", "x42", "x44", "x46", "x49"]) ||
    originalCases.length !== 5 || plan.max_inferences !== 10 || plan.max_turns !== 10 || plan.store !== false)
    throw Error("TARGET_MANIFEST_DRIFT");
  for (const [f, hash] of Object.entries(plan.source_hashes)) {
    if (f === healing.timezone_delta.file) {
      if (hash !== healing.timezone_delta.before || digest(readFileSync(f)) !== healing.timezone_delta.after) throw Error("FINAL_TIMEZONE_DELTA");
    } else if (digest(readFileSync(f)) !== hash) throw Error("TARGET_COMPOSER_DRIFT");
  }
  const old = JSON.parse(readFileSync(oldManifest, "utf8"));
  for (const [f, hash] of Object.entries(old.source_hashes)) {
    if (f in plan.source_hashes) continue;
    if (f === healing.source_delta.file) {
      if (hash !== healing.source_delta.before || digest(readFileSync(f)) !== healing.source_delta.after) throw Error("SELF_HEALING_UNAPPROVED_DELTA");
    } else if (digest(readFileSync(f)) !== hash) throw Error("TARGET_FROZEN_RUNTIME_DRIFT");
  }
  if (digest(readFileSync(historyPath)) !== evidence.source_sha256) throw Error("TARGET_HISTORY_DRIFT");
  for (const c of originalCases) {
    const frozen = plan.cases.find(x => x.case_id === c.id)!;
    if (JSON.stringify(frozen.turns.map(t => t.message)) !== JSON.stringify(c.messages) ||
      frozen.turns.some(t => t.expected_action_count !== c.actions ||
        JSON.stringify([...t.expected_operations].sort()) !== JSON.stringify(c.expected.operations.map(o => o.operation).sort())))
      throw Error("TARGET_ORACLE_DRIFT");
    const oldCase = old.cases.find((x: { id: string }) => x.id === c.id);
    const { outputs: _outputs, ...withoutScript } = c; void _outputs;
    if (JSON.stringify(oldCase) !== JSON.stringify(withoutScript)) throw Error("TARGET_EXPECTED_DRIFT");
    const prior = old.snapshots.find((x: { id: string }) => x.id === c.id);
    if (prior.fixture_hash !== digest(JSON.stringify(benchmarkFixture(c, "b")))) throw Error("TARGET_FIXTURE_DRIFT");
  }
  const checks = JSON.parse(readFileSync("packages/salon-secretary/evaluation/results/conversational-ux/checks-final.json", "utf8"));
  if (checks.tests_passed !== 2431 || checks.checks.some((x: { exit_code: number }) => x.exit_code !== 0)) throw Error("TARGET_OFFLINE_GATE_FAILED");
  if (JSON.stringify(healing.case_ids) !== JSON.stringify(["x49"]) || healing.max_new_requests !== 2 || healing.previous_requests !== 9 || healing.max_combined_requests !== 11 || healing.max_new_usd !== .026 || healing.max_combined_usd !== .156) throw Error("SELF_HEALING_SCOPE");
  for (const [file, expected] of [["real-manifest.json", healing.predecessor.manifest], ["real.jsonl", healing.predecessor.journal], ["real-result-1790301918950.json", healing.predecessor.result]])
    if (digest(readFileSync(PREDECESSOR + "/" + file)) !== expected) throw Error("SELF_HEALING_PREDECESSOR_DRIFT");
  const journal = readDurable(PREDECESSOR + "/real.jsonl", healing.predecessor.manifest);
  if (journal.filter(r => r.kind === "BEFORE_NETWORK").length !== 5 || checkpoint(journal, "x41") !== "CASE_COMPLETED" || checkpoint(journal, "x42") !== "CASE_COMPLETED" || checkpoint(journal, "x44") !== "MODEL_COMPLETED" || checkpoint(journal, "x46") !== "NOT_STARTED" || checkpoint(journal, "x49") !== "NOT_STARTED") throw Error("SELF_HEALING_CHECKPOINT");
  for (const [file, hash] of [["real-manifest.json", healing.second_predecessor.manifest], ["real.jsonl", healing.second_predecessor.journal], ["post-battery-snapshot.json", healing.second_predecessor.snapshot]])
    if (digest(readFileSync(PREDECESSOR + "/self-healing/" + file)) !== hash) throw Error("FINAL_PREDECESSOR_DRIFT");
  const second = readDurable(PREDECESSOR + "/self-healing/real.jsonl", healing.second_predecessor.manifest);
  if (second.filter(r => r.kind === "BEFORE_NETWORK").length !== 4 || checkpoint(second, "x44") !== "CASE_COMPLETED" || checkpoint(second, "x46") !== "CASE_COMPLETED" || checkpoint(second, "x49") !== "NOT_STARTED") throw Error("FINAL_CHECKPOINT");
  const previous = JSON.parse(readFileSync(PREDECESSOR + "/self-healing/post-battery-snapshot.json", "utf8"));
  if (JSON.stringify(healing.baseline) !== JSON.stringify(previous.cases.map((c: { id: string; snapshot: unknown }) => ({ id: c.id, snapshot: c.snapshot })))) throw Error("FINAL_BASELINE_DRIFT");
  return digest(readFileSync("packages/salon-secretary/evaluation/conversational-ux-final-plan.json"));
}
export async function precheckTarget(admin: PrismaClient, runtime: PrismaClient, c: BenchmarkCase) {
  if (!healing.case_ids.includes(c.id)) throw Error("SELF_HEALING_CASE_FORBIDDEN");
  for (const prior of originalCases) {
    const frozen = healing.baseline.find(row => row.id === prior.id)!.snapshot;
    if (JSON.stringify(await snapshotPhaseACase(admin, benchmarkFixture(prior, "b"))) !== JSON.stringify(frozen))
      throw Error("FINAL_BASELINE_DRIFT");
  }
  const baseline = healing.baseline.find(x => x.id === c.id)!.snapshot;
  const fixture = benchmarkFixture(c, "b");
  // Retain the exact historical fixtures, including their already-observed technical audit trail.
  // Exactly bind the additional technical audits from the preserved failed attempt; no reset.
  await precheckPhaseACase(admin, runtime, fixture, { kind: "APPROVED_RESUME_HISTORY", case_id: c.id,
    count: baseline.technical_audits, technical_audit_hash: baseline.technical_audit_hash }, { financialYesterday: true });
  if (JSON.stringify(await snapshotPhaseACase(admin, fixture)) !== JSON.stringify(baseline)) throw Error("TARGET_SNAPSHOT_DRIFT");
}
