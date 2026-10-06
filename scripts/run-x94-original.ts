import { mkdirSync } from "node:fs";
import { join } from "node:path";
import { PrismaClient } from "@prisma/client";
import { prisma } from "../src/lib/prisma";
import { TARGET_RESULTS, freezeFinal, protectExisting, precheckTarget, targetCases } from "../packages/salon-secretary/evaluation/x94-original-target";
import { assertPhaseAEnvironment, assertPhaseADatabase, snapshotPhaseACase } from "../packages/salon-secretary/evaluation/hard-conversations-phase-a-db";
import { t21Fixture } from "../packages/salon-secretary/evaluation/t21-cases";
import { persistBenchmark } from "../packages/salon-secretary/evaluation/multi-action-benchmark-harness";
import { sealRealBenchmark, executeRealBenchmark } from "../packages/salon-secretary/evaluation/x94-original-real";
async function main() {
  const command = process.argv[2];
  if (process.argv.length !== 3 || !["--seal", "--execute"].includes(command)) throw Error("X94_COMMAND_INVALID");
  mkdirSync(TARGET_RESULTS, { recursive: true });
  assertPhaseAEnvironment();
  if (process.env.SALON_SECRETARY_MULTI_ACTION_V2_ENABLED === "true" || process.env.SALON_SECRETARY_SCHEDULING_OVERLAP_ENABLED === "true") throw Error("X94_FLAGS_ALREADY_ON");
  const admin = new PrismaClient({ datasources: { db: { url: process.env.DIRECT_URL } } });
  try {
    if (command === "--seal") {
      await assertPhaseADatabase(admin, prisma); await precheckTarget(admin, prisma, targetCases[0]);
      freezeFinal(); console.log(JSON.stringify(await sealRealBenchmark(admin, prisma)));
    } else {
      await protectExisting(admin);
      const result = await executeRealBenchmark(admin, prisma);
      await protectExisting(admin);
      const identity = await assertPhaseADatabase(admin, prisma);
      persistBenchmark(join(TARGET_RESULTS, "final-independent-snapshot.json"), { identity,
        snapshot: await snapshotPhaseACase(admin, t21Fixture(targetCases[0])), previous_cases_unchanged: true,
        flags: result.flags_final });
      console.log(JSON.stringify({ status: result.status, stopped: result.stopped, requests: result.requests,
        rows: result.rows.map(r => ({ case: r.case_id, classification: r.classification, score: r.score, ux: r.ux })),
        effects: result.effects, flags_final: result.flags_final }));
      if (result.stopped || result.rows.length !== 1 || !result.rows[0].score.pass) process.exitCode = 1;
    }
  } finally {
    for (const f of ["SALON_SECRETARY_MULTI_ACTION_V2_ENABLED", "SALON_SECRETARY_SCHEDULING_OVERLAP_ENABLED", "SALON_SECRETARY_ALLOW_PAID_CALLS", "SALON_SECRETARY_JEV_ROUTER_ENABLED"]) process.env[f] = "false";
    await admin.$disconnect(); await prisma.$disconnect();
  }
}
main().catch(error => { const message = error instanceof Error ? error.message : "";
  console.error(JSON.stringify({ status: "STOPPED", code: /^[A-Z0-9_:.-]+$/.test(message) ? message : "X94_FAIL_CLOSED" })); process.exitCode = 1; });
