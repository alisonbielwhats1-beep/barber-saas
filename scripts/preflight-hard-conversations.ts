/** Offline CLI. --real is deliberately rejected, even with a paid flag in the parent. */
import { writeFileSync } from "node:fs";
import path from "node:path";
import { runOfflineConversations, structuralPort } from "../packages/salon-secretary/evaluation/hard-conversations-runner";

async function main() {
  process.env.SALON_SECRETARY_ALLOW_PAID_CALLS = "false";
  process.env.SALON_SECRETARY_JEV_ROUTER_ENABLED = "false";
  if (process.argv.slice(2).some(a => a !== "--dry-run")) throw Error("ONLY_OFFLINE_DRY_RUN_ALLOWED");
  const result = await runOfflineConversations(process.cwd(), structuralPort);
  const output = "packages/salon-secretary/evaluation/hard-conversations-runner-preflight.json";
  writeFileSync(path.resolve(output), JSON.stringify(result, null, 2) + "\n");
  console.log(JSON.stringify({ report: output, manifest_sha256: result.audit.manifest_sha256,
    cases: result.audit.cases_validated, turns: result.records.length, counts: result.audit.counts,
    stopped: result.stopped, real_execution_ready: result.audit.real_execution_ready,
    calls: result.calls, paid: process.env.SALON_SECRETARY_ALLOW_PAID_CALLS, router: process.env.SALON_SECRETARY_JEV_ROUTER_ENABLED }));
  if (result.stopped || result.records.length !== 77) process.exitCode = 1;
}
main().catch(() => { console.error("PREFLIGHT_FAILED_NO_REAL_CALLS"); process.exitCode = 1; }).finally(() => {
  process.env.SALON_SECRETARY_ALLOW_PAID_CALLS = "false";
  process.env.SALON_SECRETARY_JEV_ROUTER_ENABLED = "false";
});
