import { createHash } from "node:crypto";
import { existsSync, readFileSync, writeFileSync } from "node:fs";
import { prepareInventoryReadonlyPlan } from "./inventory-readonly-plan";

// Offline preparation only; never overwrites a different frozen artifact.
const path = "packages/salon-secretary/evaluation/inventory-readonly-plan.json";
const plan = prepareInventoryReadonlyPlan(), text = `${JSON.stringify(plan, null, 2)}\n`;
if (existsSync(path) && readFileSync(path, "utf8") !== text) throw Error("FROZEN_INVENTORY_PLAN_DIFFERS");
if (!existsSync(path)) writeFileSync(path, text, { encoding: "utf8", flag: "wx" });
console.log(JSON.stringify({ path, sha256: createHash("sha256").update(text).digest("hex"),
  cases: plan.caseCount, positives: plan.positives, adversarial: plan.adversarial, maxHttp: plan.maxHttpCalls,
  ceilingUsd: plan.pricing.maximumPlanningEstimateUsd, maxBytes: plan.payloadBytesMaximum, executed: false }));
