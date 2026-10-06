import { writeFileSync } from "node:fs";
import { buildFinancialSemanticBoundaryAudit } from "./financial-semantic-boundary";

// Explicit offline artifact generation. The module imports no provider, transport, runtime or backend.
const audit = buildFinancialSemanticBoundaryAudit();
const path = "packages/salon-secretary/evaluation/financial-semantic-boundary-audit.json";
writeFileSync(path, `${JSON.stringify(audit, null, 2)}\n`, "utf8");
console.log(JSON.stringify({ path, rows: audit.rows.length, observed: audit.observedCount,
  unexecuted: audit.unexecutedCount, counts: audit.counts, executed: audit.executed }));
