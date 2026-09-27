import { writeFileSync } from "node:fs";
import { prepareClosedFinancialPlan } from "./financial-closed-intent-plan";

// Explicit offline freeze. This file has no provider, transport, credential, DB or runtime import.
const plan = prepareClosedFinancialPlan();
const path = "packages/salon-secretary/evaluation/financial-closed-intent-plan.json";
writeFileSync(path, `${JSON.stringify(plan, null, 2)}\n`, "utf8");
console.log(JSON.stringify({ path, cases: plan.caseCount, positives: plan.positiveCount,
  adversarial: plan.adversarialCount, maxHttpCalls: plan.maxHttpCalls,
  datasetHash: plan.datasetHash, payloadsHash: plan.payloadsHash, executed: plan.executed }));
