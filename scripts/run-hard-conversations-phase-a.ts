/** Explicit local-only Phase A entry. Gate 4.0B.2 runs --prepare/--preflight only. */
import { loadEnvConfig } from "@next/env";
import { PrismaClient } from "@prisma/client";
import { mkdirSync, writeFileSync } from "node:fs";
import { resolve } from "node:path";
import { assertPhaseAEnvironment } from "../packages/salon-secretary/evaluation/hard-conversations-phase-a-db";
import { RESUME_SCOPE, readDurable, resumeCursor } from "../packages/salon-secretary/evaluation/hard-conversations-durable";
import { FINAL_CONTINUATION_SCOPE, FINAL_CONTINUATION_IDS } from "../packages/salon-secretary/evaluation/hard-conversations-durable";
import { resumePreflight, verifyResumePlan, RESUME_JOURNAL } from "../packages/salon-secretary/evaluation/hard-conversations-phase-a-resume";
import { finalPreflight, verifyFinalPlan, FINAL_JOURNAL } from "../packages/salon-secretary/evaluation/hard-conversations-phase-a-final";
import { CONTINUATION_SCOPE } from "../packages/salon-secretary/evaluation/hard-conversations-phase-a-continuation";
import { executePhaseA, phaseAContinuationPreflight, phaseAPreflight, preparePhaseAFixtures } from
  "../packages/salon-secretary/evaluation/hard-conversations-phase-a-execution";

loadEnvConfig(process.cwd(), true);

async function main() {
  const command = process.argv[2];
  if (!["--prepare", "--preflight", "--execute", "--revalidate-i01", "--preflight-continuation",
    "--continue-after-i01", "--preflight-resume-i12", "--resume-from-i12",
    "--preflight-final-continuation", "--continue-after-i12"].includes(command) || process.argv.length !== 3)
    throw Error("PHASE_A_COMMAND_REQUIRED");
  const env = assertPhaseAEnvironment();
  const admin = new PrismaClient({ datasources: { db: { url: process.env.DIRECT_URL } } });
  const runtime = new PrismaClient({ datasources: { db: { url: process.env.DATABASE_URL } } });
  try {
    if (command === "--prepare") {
      const result = await preparePhaseAFixtures(admin, runtime);
      console.log(JSON.stringify({ mode: "PREPARE_ONLY", ...result }, null, 2));
    } else if (command === "--preflight") {
      const result = await phaseAPreflight(admin, runtime);
      console.log(JSON.stringify({ mode: "PREFLIGHT_ONLY", identity: result.identity,
        cases: result.case_count, turns: result.turn_count, paid_calls: false, network_calls: 0 }, null, 2));
    } else if (command === "--preflight-continuation") {
      const result = await phaseAContinuationPreflight(admin, runtime);
      console.log(JSON.stringify({ mode: "CONTINUATION_PREFLIGHT_ONLY", status: "PHASE_A_CONTINUATION_PREFLIGHT_OK",
        identity: result.identity, cases: result.case_count, turns: result.turn_count,
        historical_technical_logs: result.historical_technical_logs, paid_calls: false, network_calls: 0 }, null, 2));
    } else if (command === "--preflight-resume-i12") {
      const frozen = verifyResumePlan();
      const rows = readDurable(RESUME_JOURNAL, frozen.binding);
      const pending = resumeCursor(rows);
      const result = await resumePreflight(admin, runtime, rows);
      console.log(JSON.stringify({ status: "PHASE_A_RESUME_PREFLIGHT_OK", cases: result.case_count,
        turns: result.turn_count, pending, historical_technical_logs: result.historical_technical_logs,
        manifest_sha256: frozen.binding, baseline_sha256: frozen.seal.baseline_sha256,
        paid_calls: false, jev_router: false, network_calls: 0 }, null, 2));
    } else if (command === "--preflight-final-continuation") {
      const frozen = verifyFinalPlan();
      const rows = readDurable(FINAL_JOURNAL, frozen.binding);
      const pending = resumeCursor(rows, FINAL_CONTINUATION_IDS, true);
      const result = await finalPreflight(admin, runtime, rows);
      console.log(JSON.stringify({ status: "PHASE_A_FINAL_CONTINUATION_PREFLIGHT_OK", cases: result.case_count,
        turns: result.turn_count, pending, historical_technical_logs: result.historical_technical_logs,
        manifest_sha256: frozen.binding, baseline_sha256: frozen.seal.baseline_sha256,
        paid_calls: false, jev_router: false, network_calls: 0 }, null, 2));
    } else {
      if (command === "--execute" && process.env.PHASE_A_REAL_EXECUTION_APPROVED !== "true")
        throw Error("PHASE_A_REAL_EXECUTION_NOT_APPROVED");
      if (command === "--revalidate-i01" && process.env.PHASE_A_REVALIDATE_I01_APPROVED !== "true")
        throw Error("PHASE_A_REVALIDATION_NOT_APPROVED");
      if (command === "--continue-after-i01" && process.env.PHASE_A_CONTINUATION_I02_I26_APPROVED !== "true")
        throw Error("PHASE_A_CONTINUATION_NOT_APPROVED");
      if (command === "--resume-from-i12" && (process.env.PHASE_A_RESUME_FROM_I12_APPROVED !== "true" ||
        process.env.PHASE_A_REVALIDATE_I12_APPROVED !== "true")) throw Error("PHASE_A_RESUME_NOT_APPROVED");
      if (command === "--continue-after-i12" && process.env.PHASE_A_FINAL_CONTINUATION_APPROVED !== "true")
        throw Error("PHASE_A_FINAL_CONTINUATION_NOT_APPROVED");
      const report = await executePhaseA(admin, runtime,
        command === "--continue-after-i12" ? FINAL_CONTINUATION_SCOPE :
          command === "--resume-from-i12" ? RESUME_SCOPE : command === "--revalidate-i01" ? "REVALIDATE_I01" :
          command === "--continue-after-i01" ? CONTINUATION_SCOPE : "PHASE_A");
      const outputDir = resolve("packages/salon-secretary/evaluation/results");
      mkdirSync(outputDir, { recursive: true });
      const outputName = command === "--continue-after-i12" ? `hard-conversations-phase-a-final-result-${Date.now()}.json` :
        command === "--resume-from-i12" ? `hard-conversations-phase-a-resume-result-${Date.now()}.json` : command === "--revalidate-i01" ? "hard-conversations-revalidate-i01-result.json" :
        command === "--continue-after-i01" ? "hard-conversations-phase-a-continuation-result.json" :
          "hard-conversations-phase-a-result.json";
      writeFileSync(resolve(outputDir, outputName), JSON.stringify(report, null, 2));
      console.log(JSON.stringify({ mode: report.scope, status: report.status, stopped: report.stopped,
        executed_turns: report.executed_turns, requests: report.budget.requests,
        reserved_usd: report.budget.reserved_usd, paid_calls_final: process.env.SALON_SECRETARY_ALLOW_PAID_CALLS,
        router_final: process.env.SALON_SECRETARY_JEV_ROUTER_ENABLED }, null, 2));
    }
  } finally {
    process.env.SALON_SECRETARY_ALLOW_PAID_CALLS = "false";
    process.env.SALON_SECRETARY_JEV_ROUTER_ENABLED = "false";
    await admin.$disconnect();
    await runtime.$disconnect();
  }
  void env; // parsed URLs are never printed
}
main().catch(error => {
  process.env.SALON_SECRETARY_ALLOW_PAID_CALLS = "false";
  process.env.SALON_SECRETARY_JEV_ROUTER_ENABLED = "false";
  const message = error instanceof Error ? error.message : "";
  const code = /^PHASE_A_[A-Z0-9_]+$/.test(message) ? message :
    /P1001|ECONNREFUSED|Can't reach database server/i.test(message) ? "PHASE_A_LOCAL_DATABASE_UNAVAILABLE" : "PHASE_A_FAIL_CLOSED";
  console.error(code);
  process.exitCode = 1;
});
