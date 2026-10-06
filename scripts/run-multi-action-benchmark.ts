import { PrismaClient } from "@prisma/client";
import { mkdirSync } from "node:fs";
import { BENCHMARK_RESULTS, prepareBenchmark, controlledValidation, persistBenchmark } from "../packages/salon-secretary/evaluation/multi-action-benchmark-harness";
import { assertPhaseAEnvironment } from "../packages/salon-secretary/evaluation/hard-conversations-phase-a-db";
import { prisma } from "../src/lib/prisma";
import { sealRealBenchmark, executeRealBenchmark } from "../packages/salon-secretary/evaluation/multi-action-benchmark-real";

async function main() {
  if (process.argv.length !== 3 || !["--prepare-a", "--prepare-b", "--validate-a", "--validate-timing", "--seal-real", "--execute-real", "--resume-real"].includes(process.argv[2])) throw Error("BENCHMARK_COMMAND_INVALID");
  assertPhaseAEnvironment();
  const admin = new PrismaClient({ datasources: { db: { url: process.env.DIRECT_URL } } });
  try {
    mkdirSync(BENCHMARK_RESULTS, { recursive: true });
    if (["--prepare-a", "--prepare-b"].includes(process.argv[2])) {
      const phase = process.argv[2] === "--prepare-a" ? "a" : "b";
      const prepared = await prepareBenchmark(admin, prisma, phase);
      persistBenchmark(`${BENCHMARK_RESULTS}/phase-${phase}-preparation-${Date.now()}.json`, prepared);
      console.log(JSON.stringify({ mode: `PREPARE_${phase.toUpperCase()}`, ...prepared }));
    } else if (process.argv[2] === "--seal-real") {
      console.log(JSON.stringify(await sealRealBenchmark(admin, prisma)));
    } else if (["--execute-real", "--resume-real"].includes(process.argv[2])) {
      const report = await executeRealBenchmark(admin, prisma, process.argv[2] === "--resume-real");
      console.log(JSON.stringify({ status: report.status, stopped: report.stopped, turns: report.rows.length, requests: report.requests,
        reserved_usd: report.reserved_usd, effects: report.effects, flags_final: report.flags_final }));
      process.exitCode = report.stopped ? 1 : 0;
    } else {
      const report = await controlledValidation(admin, prisma, process.argv[2] === "--validate-timing");
      console.log(JSON.stringify({ status: report.status, stopped: report.stopped, turns: report.records.length, effects: report.effects, flags_final: report.flags_final }));
      process.exitCode = report.status === "PASS" ? 0 : 1;
    }
  } finally {
    process.env.SALON_SECRETARY_MULTI_ACTION_V2_ENABLED = "false";
    process.env.SALON_SECRETARY_ALLOW_PAID_CALLS = "false"; process.env.SALON_SECRETARY_JEV_ROUTER_ENABLED = "false";
    await admin.$disconnect(); await prisma.$disconnect();
  }
}
main().catch(error => {
  const message = String(error.message ?? "");
  console.error(JSON.stringify({ error: /^BENCHMARK_|^PHASE_A_[A-Z_]+$/.test(message) ? message : "BENCHMARK_FAIL_CLOSED",
    exception: error.name, code: /^[A-Z0-9_]+$/.test(error.code ?? "") ? error.code : null,
    unknown_argument: message.match(/Unknown argument `([A-Za-z_]+)`/)?.[1] ?? null,
    missing_argument: message.match(/Argument `([A-Za-z_]+)` is missing/)?.[1] ?? null,
    sqlstate: message.match(/SqlState\(([A-Z0-9]+)\)/)?.[1] ?? null,
    permission: message.match(/permission denied for (?:table|schema|sequence|column) [A-Za-z0-9_]+/)?.[0] ?? null,
    rls: message.match(/new row violates row-level security policy for table [A-Za-z0-9_\\"]+/)?.[0] ?? null,
    meta_keys: error.meta ? Object.keys(error.meta) : [] })); process.exitCode = 1;
});
