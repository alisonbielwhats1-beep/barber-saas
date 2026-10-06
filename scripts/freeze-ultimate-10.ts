/** Offline-only freeze. Exclusive creation prevents accidental replacement of an approved manifest. */
import { createHash } from "node:crypto";
import { writeFileSync } from "node:fs";
import path from "node:path";
import { auditUltimate10Plan, buildUltimate10Plan, ULTIMATE10_PLAN } from "../packages/salon-secretary/evaluation/ultimate-10";

const root = process.cwd();
const audit = auditUltimate10Plan(root);
if (process.argv.includes("--freeze")) {
  const bytes = JSON.stringify(buildUltimate10Plan(root), null, 2) + "\n";
  const sha256 = createHash("sha256").update(bytes).digest("hex");
  writeFileSync(path.join(root, ULTIMATE10_PLAN), bytes, { flag: "wx" });
  writeFileSync(path.join(root, ULTIMATE10_PLAN + ".sha256"), sha256 + "\n", { flag: "wx" });
  process.stdout.write(JSON.stringify({ ...audit, sha256, frozen: true }) + "\n");
} else {
  process.stdout.write(JSON.stringify({ ...audit, frozen: false }) + "\n");
}
