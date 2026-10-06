/** Read-only structural preflight. This script deliberately has no paid execution option. */
import path from "node:path";
import { verifyPhaseA } from "../packages/salon-secretary/evaluation/hard-conversations-phase-a";

if (process.argv.slice(2).join(" ") !== "--dry-run") throw Error("OFFLINE_DRY_RUN_ONLY");
const result = verifyPhaseA(path.resolve(process.cwd()));
process.stdout.write(`${JSON.stringify(result, null, 2)}\n`);
