import { readFileSync } from "node:fs";
import type { PrismaClient } from "@prisma/client";
import { digest } from "./hard-conversations-durable";
import { benchmarkCases, benchmarkFixture, type BenchmarkCase } from "./multi-action-benchmark-cases";
import { sourceHashes, type scoreBenchmark } from "./multi-action-benchmark-harness";
import { precheckPhaseACase, snapshotPhaseACase } from "./hard-conversations-phase-a-db";
import type { SecretaryView } from "../../../src/lib/salon-secretary";
import type { TurnCapture } from "./hard-conversations-observation-bridge";
import plan from "./conversational-ux-microbattery-plan.json";
import evidence from "../../../src/test/fixtures/conversational-ux-benchmark.json";

export const TARGET_RESULTS = "packages/salon-secretary/evaluation/results/conversational-ux-real";
const historyPath = "packages/salon-secretary/evaluation/results/multi-action-benchmark/real-result-1790294537166.json";
const oldManifest = "packages/salon-secretary/evaluation/results/multi-action-benchmark/real-manifest.json";
const planPath = "packages/salon-secretary/evaluation/conversational-ux-microbattery-plan.json";
export const targetCases = benchmarkCases.filter(c => plan.case_ids.includes(c.id));
export function targetHashes() {
  return { ...sourceHashes(), ...Object.fromEntries([
    ...Object.keys(plan.source_hashes), planPath, "src/test/fixtures/conversational-ux-benchmark.json",
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
    targetCases.length !== 5 || plan.max_inferences !== 10 || plan.max_turns !== 10 || plan.store !== false)
    throw Error("TARGET_MANIFEST_DRIFT");
  for (const [f, hash] of Object.entries(plan.source_hashes)) if (digest(readFileSync(f)) !== hash) throw Error("TARGET_COMPOSER_DRIFT");
  const old = JSON.parse(readFileSync(oldManifest, "utf8"));
  for (const [f, hash] of Object.entries(old.source_hashes)) {
    if (f in plan.source_hashes) continue;
    if (digest(readFileSync(f)) !== hash) throw Error("TARGET_FROZEN_RUNTIME_DRIFT");
  }
  if (digest(readFileSync(historyPath)) !== evidence.source_sha256) throw Error("TARGET_HISTORY_DRIFT");
  for (const c of targetCases) {
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
  return digest(readFileSync(planPath));
}
export async function precheckTarget(admin: PrismaClient, runtime: PrismaClient, c: BenchmarkCase) {
  const history = JSON.parse(readFileSync(historyPath, "utf8"));
  const baseline = history.final.find((x: { id: string }) => x.id === c.id).snapshot;
  const fixture = benchmarkFixture(c, "b");
  // Retain the exact historical fixtures, including their already-observed technical audit trail.
  // No reseeding, clearing drafts or accepting a new/unmatched audit baseline.
  await precheckPhaseACase(admin, runtime, fixture, { kind: "APPROVED_RESUME_HISTORY", case_id: c.id,
    count: baseline.technical_audits, technical_audit_hash: baseline.technical_audit_hash }, { financialYesterday: true });
  if (JSON.stringify(await snapshotPhaseACase(admin, fixture)) !== JSON.stringify(baseline)) throw Error("TARGET_SNAPSHOT_DRIFT");
}
export function scoreTargetUX(id: string, turn: number, view: SecretaryView | null, capture: TurnCapture,
  structural: ReturnType<typeof scoreBenchmark>) {
  const metrics = { TECHNICAL_FIELD_LEAK: 0, DUPLICATE_QUESTION: 0, UNNECESSARY_QUESTION: 0, MISSING_REQUIRED_QUESTION: 0,
    WRONG_ENTITY_AUTO_SELECTED: 0, INVENTED_REQUIRED_FIELD: 0, DRAFT_CONTINUITY_FAILURE: 0, DEPENDENCY_FAILURE: 0 };
  const failures: string[] = [], safety: string[] = [];
  if (!view) return { metrics: null, failures, safety, assessed: false };
  const text = view.message;
  metrics.TECHNICAL_FIELD_LEAK = (text.match(/\b(?:\w+_(?:ref|id|name|time)|service_name|end_time|selection|durationMin|priceCents|NEEDS_INPUT|READY_FOR_CONFIRMATION)\b/g) ?? []).length;
  const questions = text.match(/[^?\n]+\?/g) ?? [];
  const expected = turn === 2 && id !== "x42" ? [] : id === "x41" ? ["time"] : id === "x44" ? ["service", "time"] : id === "x49" ? ["service", "end"] : ["service"];
  const counts: Record<string, number> = {};
  for (const q of questions) {
    const concepts = [ ...( /serviço/i.test(q) ? ["service"] : [] ),
      ...(/Até que horas|horário final/i.test(q) ? ["end"] : /horário/i.test(q) ? ["time"] : []),
      ...(/profissional/i.test(q) ? ["professional"] : []) ];
    if (!concepts.length) metrics.UNNECESSARY_QUESTION++;
    for (const concept of concepts) { counts[concept] = (counts[concept] ?? 0) + 1; if (!expected.includes(concept)) metrics.UNNECESSARY_QUESTION++; }
  }
  metrics.DUPLICATE_QUESTION = Object.values(counts).reduce((sum, n) => sum + Math.max(0, n - 1), 0);
  metrics.MISSING_REQUIRED_QUESTION = expected.filter(key => !counts[key]).length;
  const frozen = plan.cases.find(c => c.case_id === id)!.turns.find(t => t.turn === turn)!;
  if (questions.length !== frozen.expected_question_count) failures.push("QUESTION_COUNT");
  const historical = evidence.rows.find(r => r.case_id === id && r.turn === turn)!;
  for (const action of view.action_plan?.actions ?? []) {
    if (action.provenance.intention !== "LUNA" || action.provenance.assessment !== "BACKEND") failures.push("PROVENANCE_CHANGED");
  }
  for (const old of historical.capture.operations) {
    const actual = capture.operations.find(a => a.operation === old.operation);
    if (!actual) continue;
    for (const [key, value] of Object.entries(old.fields)) if (key.endsWith("_ref") && value && actual.fields[key] && actual.fields[key] !== value) {
      metrics.WRONG_ENTITY_AUTO_SELECTED++; safety.push(`WRONG_ENTITY_AUTO_SELECTED:${old.operation}.${key}`);
    }
  }
  metrics.WRONG_ENTITY_AUTO_SELECTED += structural.safety.filter(s => s.includes("WRONG_ENTITY")).length;
  metrics.INVENTED_REQUIRED_FIELD = structural.safety.filter(s => s.includes("INVENTED_REQUIRED_FIELD")).length;
  metrics.DRAFT_CONTINUITY_FAILURE = structural.failures.filter(s => /DRAFT_CONTINUITY|PLAN_CONTINUITY/.test(s)).length;
  metrics.DEPENDENCY_FAILURE = structural.failures.filter(s => /DEPENDENCY|GRAPH_CONTINUITY/.test(s)).length;
  for (const [key, value] of Object.entries(metrics)) if (value) failures.push(`${key}:${value}`);
  return { metrics, failures, safety, assessed: true };
}
