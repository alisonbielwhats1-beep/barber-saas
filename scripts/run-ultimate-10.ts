/** Local-only Ultimate 10 entry. Paid commands always require separate process-scoped approval. */
import { loadEnvConfig } from "@next/env";
import { PrismaClient } from "@prisma/client";
import { closeSync, fsyncSync, mkdirSync, openSync, writeSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { assertPhaseAEnvironment } from "../packages/salon-secretary/evaluation/hard-conversations-phase-a-db";
import { continueUltimate10U02U10, executeUltimate10, revalidateUltimate10U01 } from "../packages/salon-secretary/evaluation/ultimate-10-execution";
import { prepareUltimate10, ultimate10ContinuationPreflight, ultimate10Preflight,
  ultimate10U01RevalidationPreflight } from "../packages/salon-secretary/evaluation/ultimate-10-harness";
import { ultimate10CliExitCode } from "../packages/salon-secretary/evaluation/ultimate-10-post-http";

loadEnvConfig(process.cwd(), true);

async function main() {
  const command = process.argv[2];
  if (!["--prepare", "--preflight", "--execute", "--resume", "--preflight-revalidate-u01",
    "--revalidate-u01", "--preflight-continue-u02-u10", "--continue-u02-u10"].includes(command ?? "") ||
    process.argv.length !== 3)
    throw Error("ULTIMATE10_COMMAND_REQUIRED");
  assertPhaseAEnvironment(); // No paid flag can be active at CLI entry.
  if ((command === "--execute" || command === "--resume" || command === "--revalidate-u01" ||
    command === "--continue-u02-u10") &&
    process.env.ULTIMATE10_REAL_EXECUTION_APPROVED !== "true") throw Error("ULTIMATE10_EXECUTION_NOT_AUTHORIZED");
  if (command === "--revalidate-u01" && process.env.ULTIMATE10_REVALIDATE_U01_APPROVED !== "true")
    throw Error("ULTIMATE10_U01_REVALIDATION_NOT_AUTHORIZED");
  if (command === "--continue-u02-u10" && process.env.ULTIMATE10_CONTINUATION_U02_U10_APPROVED !== "true")
    throw Error("ULTIMATE10_CONTINUATION_NOT_AUTHORIZED");
  const admin = new PrismaClient({ datasources: { db: { url: process.env.DIRECT_URL } } });
  const runtime = new PrismaClient({ datasources: { db: { url: process.env.DATABASE_URL } } });
  try {
    if (command === "--prepare") {
      const prepared = await prepareUltimate10(admin, runtime);
      console.log(JSON.stringify({ mode: "PREPARE_ONLY", ...prepared }, null, 2));
    } else if (command === "--preflight") {
      const preflight = await ultimate10Preflight(admin, runtime);
      console.log(JSON.stringify({ mode: "PREFLIGHT_ONLY", ...preflight }, null, 2));
    } else if (command === "--preflight-revalidate-u01") {
      const preflight = await ultimate10U01RevalidationPreflight(admin, runtime);
      console.log(JSON.stringify({ mode: "REVALIDATION_U01_PREFLIGHT_ONLY", ...preflight }, null, 2));
    } else if (command === "--preflight-continue-u02-u10") {
      const preflight = await ultimate10ContinuationPreflight(admin, runtime);
      const safe = { ...preflight, baseline: undefined, prior: undefined };
      console.log(JSON.stringify({ mode: "CONTINUATION_U02_U10_PREFLIGHT_ONLY", ...safe }, null, 2));
    } else {
      const report = command === "--revalidate-u01" ? await revalidateUltimate10U01(admin, runtime) :
        command === "--continue-u02-u10" ? await continueUltimate10U02U10(admin, runtime) :
          await executeUltimate10(admin, runtime, command === "--resume");
      const basename = command === "--revalidate-u01" ? "ultimate-10-revalidation-u01-result" :
        command === "--continue-u02-u10" ? "ultimate-10-continuation-u02-u10-result" : "ultimate-10-result";
      const file = resolve("packages/salon-secretary/evaluation/results", `${basename}-${Date.now()}.json`);
      mkdirSync(dirname(file), { recursive: true });
      const fd = openSync(file, "wx", 0o600);
      try { writeSync(fd, JSON.stringify(report, null, 2)); fsyncSync(fd); } finally { closeSync(fd); }
      console.log(JSON.stringify({ mode: command, status: report.status, stopped: report.stopped,
        executed_turns: report.executed_turns, requests: report.budget.requests,
        reserved_usd: report.budget.reserved_usd, report: file,
        paid_calls_final: process.env.SALON_SECRETARY_ALLOW_PAID_CALLS,
        router_final: process.env.SALON_SECRETARY_JEV_ROUTER_ENABLED }, null, 2));
      process.exitCode = ultimate10CliExitCode(report.status);
    }
  } finally {
    process.env.SALON_SECRETARY_ALLOW_PAID_CALLS = "false";
    process.env.SALON_SECRETARY_JEV_ROUTER_ENABLED = "false";
    await admin.$disconnect();
    await runtime.$disconnect();
  }
}
main().catch(error => {
  process.env.SALON_SECRETARY_ALLOW_PAID_CALLS = "false";
  process.env.SALON_SECRETARY_JEV_ROUTER_ENABLED = "false";
  const message = error instanceof Error ? error.message : "";
  const code = /^(?:ULTIMATE10|PHASE_A)_[A-Z0-9_]+$/.test(message) ? message :
    /P1001|ECONNREFUSED|Can't reach database server/i.test(message) ? "ULTIMATE10_LOCAL_DATABASE_UNAVAILABLE" :
      "ULTIMATE10_FAIL_CLOSED";
  console.error(code);
  process.exitCode = 1;
});
