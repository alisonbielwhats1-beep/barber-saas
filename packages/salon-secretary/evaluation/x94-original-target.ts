/** Single authorized REVALIDATION_AFTER_FIX. Prior requests and failures remain immutable. */
import { readFileSync } from "node:fs";
import { join } from "node:path";
import type { PrismaClient } from "@prisma/client";
import { t21Cases, t21Fixture } from "./t21-cases";
import { targetHashes as runtimeHashes, scoreT21 as originalScore, scoreTargetUX } from "./t21-target";
import { digest, readDurable } from "./hard-conversations-durable";
import { persistBenchmark } from "./multi-action-benchmark-harness";
import { snapshotPhaseACase, precheckPhaseACase } from "./hard-conversations-phase-a-db";
import { benchmarkCases, benchmarkFixture } from "./multi-action-benchmark-cases";
export { scoreTargetUX };
export const TARGET_RESULTS = "packages/salon-secretary/evaluation/results/x94-original-reason";
const prior = "packages/salon-secretary/evaluation/results/topic14-final";
const read = (path: string) => JSON.parse(readFileSync(path, "utf8"));
export const targetCases = t21Cases.filter(c => c.id === "x94");
const changes = ["src/lib/secretary-batch.ts", "src/lib/secretary-scheduling.ts", "src/lib/salon-secretary.ts", "src/lib/scheduling-contract.ts", "src/lib/scheduling-batch.ts"];
export function verifyPrior() {
  const closure = read(join(prior, "final-closure.json")), manifest = read(join(prior, "real-manifest.json"));
  for (const [file, hash] of Object.entries(closure.artifacts_sha256))
    if (digest(readFileSync(join(prior, file))) !== hash) throw Error("X94_PRIOR_EVIDENCE_DRIFT");
  for (const [file, hash] of Object.entries(manifest.source_hashes)) {
    const path = changes.includes(file) ? join(TARGET_RESULTS, "before", file.replaceAll("/", "__") + ".txt") : file;
    if (digest(readFileSync(path)) !== hash) throw Error("X94_UNAUTHORIZED_SOURCE_DRIFT");
  }
  if (JSON.stringify(manifest.cases) !== JSON.stringify(targetCases.map(({ outputs: _outputs, ...c }) => { void _outputs; return c; }))) throw Error("X94_EXPECTED_DRIFT");
  const journal = readDurable(join(prior, "real.jsonl"), digest(readFileSync(join(prior, "real-manifest.json"))));
  if (journal.filter(r => r.kind === "BEFORE_NETWORK").length !== 1) throw Error("X94_PRIOR_REQUEST_DRIFT");
  return { prior_result_sha256: digest(readFileSync(join(prior, "real-result-1790311762668.json"))),
    prior_snapshot_sha256: digest(readFileSync(join(prior, "final-independent-snapshot.json"))),
    changes: changes.map(path => ({ path, before: manifest.source_hashes[path], after: digest(readFileSync(path)) })) };
}
export function targetHashes() {
  return { ...runtimeHashes(), ...Object.fromEntries(["x94-original-target.ts", "x94-original-real.ts", "evaluator-text.ts"].map(f => {
    const path = "packages/salon-secretary/evaluation/" + f; return [path, digest(readFileSync(path))];
  })), ...Object.fromEntries(["scripts/run-x94-original.ts", "scripts/run-x94-original.cjs"].map(path => [path, digest(readFileSync(path))])) };
}
export const canStartCompleteCase = (used: number, id: string) => { if (id !== "x94") throw Error("X94_CASE_FORBIDDEN"); return used === 0; };
export async function protectExisting(admin: PrismaClient) {
  verifyPrior();
  const historical = read("packages/salon-secretary/evaluation/results/conversational-ux-real/final-x49/post-battery-snapshot.json");
  for (const c of benchmarkCases.filter(c => ["x41", "x42", "x44", "x46", "x49"].includes(c.id))) {
    if (JSON.stringify(await snapshotPhaseACase(admin, benchmarkFixture(c, "b"))) !== JSON.stringify(historical.cases.find((r: { id: string }) => r.id === c.id).snapshot)) throw Error("X94_HISTORICAL_DRIFT");
  }
  const previous = read("packages/salon-secretary/evaluation/results/t21-extension/real-result-1790309742335.json");
  for (const row of previous.final.filter((r: { id: string }) => r.id !== "x94")) {
    if (JSON.stringify(await snapshotPhaseACase(admin, t21Fixture(t21Cases.find(c => c.id === row.id)!))) !== JSON.stringify(row.snapshot)) throw Error("X94_PRIOR_CASE_DRIFT");
  }
}
export async function precheckTarget(admin: PrismaClient, runtime: PrismaClient, c: typeof targetCases[number]) {
  if (c.id !== "x94") throw Error("X94_CASE_FORBIDDEN");
  await protectExisting(admin);
  const fixture = t21Fixture(c), baseline = read(join(prior, "final-independent-snapshot.json")).snapshot;
  if (JSON.stringify(await snapshotPhaseACase(admin, fixture)) !== JSON.stringify(baseline)) throw Error("X94_BASELINE_DRIFT");
  await precheckPhaseACase(admin, runtime, fixture, { kind: "APPROVED_RESUME_HISTORY", case_id: c.id,
    count: baseline.technical_audits, technical_audit_hash: baseline.technical_audit_hash }, { financialYesterday: true });
  if (await runtime.clientProfile.count({ where: { salonId: fixture.tenant } })) throw Error("X94_NO_CONTEXT_VISIBLE");
}
export function scoreT21(...args: Parameters<typeof originalScore>) {
  const score = originalScore(...args), [c, , view] = args;
  if (view) {
    const fields = view.operations?.find(x => x.state.batch)?.state.batch?.draft?.plan.items.find(x => x.operation === "appointment.create")?.fields;
    const source = fields?.override_reason_source, message = c.messages[0];
    if (!source) score.failures.push("REASON_PROVENANCE_MISSING");
    else if (source.message_sha256 !== digest(message) || message.slice(source.start, source.end) !== source.original_text ||
      fields?.override_reason !== source.original_text) score.safety.push("UNGROUNDED_REASON_ACCEPTED");
  }
  return { ...score, pass: !score.failures.length && !score.safety.length };
}
export function freezeFinal() {
  const history = verifyPrior(), checks = read(join(TARGET_RESULTS, "checks.json"));
  if (!checks.passed) throw Error("X94_OFFLINE_GATE_FAILED");
  persistBenchmark(join(TARGET_RESULTS, "frozen-plan.json"), { kind: "REVALIDATION_AFTER_FIX", history,
    source_hashes: targetHashes(), cases: targetCases.map(({ outputs: _outputs, ...c }) => { void _outputs; return c; }),
    checks_sha256: digest(readFileSync(join(TARGET_RESULTS, "checks.json"))),
    max_requests: 1, max_usd: .013, retries: 0, confirm: false, execute: false, jev: false, store: false, hosted_tools: 0, containers: 0 });
}
export function verifyFrozenTarget() {
  verifyPrior(); const path = join(TARGET_RESULTS, "frozen-plan.json"), frozen = read(path);
  if (JSON.stringify(targetHashes()) !== JSON.stringify(frozen.source_hashes) || frozen.max_requests !== 1 || frozen.max_usd !== .013 ||
    frozen.checks_sha256 !== digest(readFileSync(join(TARGET_RESULTS, "checks.json")))) throw Error("X94_MANIFEST_DRIFT");
  return digest(readFileSync(path));
}
