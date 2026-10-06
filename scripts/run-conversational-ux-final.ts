import { PrismaClient } from "@prisma/client";
import { mkdirSync } from "node:fs";
import { prisma } from "../src/lib/prisma";
import { assertPhaseAEnvironment } from "../packages/salon-secretary/evaluation/hard-conversations-phase-a-db";
import { TARGET_RESULTS, verifyFrozenTarget } from "../packages/salon-secretary/evaluation/conversational-ux-final-target";
import { sealRealBenchmark, executeRealBenchmark } from "../packages/salon-secretary/evaluation/conversational-ux-final-real";
async function main() {
  if (process.argv.length !== 3 || !["--seal", "--execute", "--resume"].includes(process.argv[2])) throw Error("TARGET_COMMAND_INVALID");
  assertPhaseAEnvironment(); verifyFrozenTarget();
  const admin = new PrismaClient({ datasources: { db: { url: process.env.DIRECT_URL } } });
  try {
    mkdirSync(TARGET_RESULTS, { recursive: true });
    if (process.argv[2] === "--seal") console.log(JSON.stringify(await sealRealBenchmark(admin, prisma)));
    else {
      const report = await executeRealBenchmark(admin, prisma, process.argv[2] === "--resume");
      console.log(JSON.stringify({ status: report.status, stopped: report.stopped, turns: report.rows.length,
        requests: report.requests, effects: report.effects, flags_final: report.flags_final }));
      process.exitCode = report.stopped ? 1 : 0;
    }
  } finally {
    process.env.SALON_SECRETARY_MULTI_ACTION_V2_ENABLED = "false";
    process.env.SALON_SECRETARY_ALLOW_PAID_CALLS = "false";
    process.env.SALON_SECRETARY_JEV_ROUTER_ENABLED = "false";
    await admin.$disconnect(); await prisma.$disconnect();
  }
}
main().catch(error => {
  process.env.SALON_SECRETARY_MULTI_ACTION_V2_ENABLED = "false";
  process.env.SALON_SECRETARY_ALLOW_PAID_CALLS = "false"; process.env.SALON_SECRETARY_JEV_ROUTER_ENABLED = "false";
  console.error(JSON.stringify({ status: "STOPPED", code: /^[A-Z0-9_:.-]+$/.test(error.message ?? "") ? error.message : "TARGET_FAIL_CLOSED" }));
  process.exitCode = 1;
});
