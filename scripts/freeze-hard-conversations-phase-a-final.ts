/** One-time, read-only enrollment of the exact post-i12 local baseline. Never touches business data. */
import { loadEnvConfig } from "@next/env";
import { PrismaClient } from "@prisma/client";
import { writeFileSync } from "node:fs";
import { digest } from "../packages/salon-secretary/evaluation/hard-conversations-durable";
import { captureResumeState } from "../packages/salon-secretary/evaluation/hard-conversations-phase-a-resume";
import { assertFinalHistoricalState, buildFinalPlan, verifyFinalHistory,
  FINAL_BASE, FINAL_PLAN, FINAL_SEAL } from "../packages/salon-secretary/evaluation/hard-conversations-phase-a-final";
import { assertPhaseAEnvironment, assertPhaseADatabase } from "../packages/salon-secretary/evaluation/hard-conversations-phase-a-db";

loadEnvConfig(process.cwd(), true);
async function main() {
  const urls = assertPhaseAEnvironment();
  verifyFinalHistory();
  const admin = new PrismaClient({ datasources: { db: { url: urls.admin.toString() } } });
  const runtime = new PrismaClient({ datasources: { db: { url: urls.runtime.toString() } } });
  try {
    await assertPhaseADatabase(admin, runtime);
    const baseline = await captureResumeState(admin);
    await assertFinalHistoricalState(admin, baseline);
    const baselineText = JSON.stringify(baseline, null, 2) + "\n";
    const baselineHash = digest(baselineText);
    const planText = JSON.stringify(buildFinalPlan(baselineHash), null, 2) + "\n";
    const manifestHash = digest(planText);
    writeFileSync(FINAL_BASE, baselineText, { flag: "wx" });
    writeFileSync(FINAL_PLAN, planText, { flag: "wx" });
    writeFileSync(FINAL_SEAL, JSON.stringify({ manifest_sha256: manifestHash,
      baseline_sha256: baselineHash }, null, 2) + "\n", { flag: "wx" });
    console.log(JSON.stringify({ status: "PHASE_A_FINAL_FROZEN", baseline_sha256: baselineHash,
      manifest_sha256: manifestHash, historical_technical_logs: baseline.total_audit_logs,
      cases: 14, turns: 16, paid_calls: false, network_calls: 0 }));
  } finally { await runtime.$disconnect(); await admin.$disconnect(); }
}
main().catch(error => { console.error(error instanceof Error ? error.message : "PHASE_A_FINAL_FREEZE_FAILED");
  process.exitCode = 1; });
