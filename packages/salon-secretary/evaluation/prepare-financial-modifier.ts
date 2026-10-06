import { createHash } from "node:crypto";
import { existsSync, readFileSync, writeFileSync } from "node:fs";
import { prepareModifierPlan } from "./financial-modifier-plan";

// Offline only. Refuse to replace a different frozen plan.
const path = "packages/salon-secretary/evaluation/financial-modifier-plan.json";
const plan = prepareModifierPlan(), text = `${JSON.stringify(plan, null, 2)}\n`;
if (existsSync(path) && readFileSync(path, "utf8") !== text) throw Error("EXISTING_FROZEN_PLAN_DIFFERS");
if (!existsSync(path)) writeFileSync(path, text, { encoding: "utf8", flag: "wx" });
console.log(JSON.stringify({ path, hash: createHash("sha256").update(text).digest("hex"),
  counts: plan.counts, maxHttpCalls: plan.maxHttpCalls, payloadComparison: plan.payloadComparison,
  estimatedPlanningCeilingUsd: plan.pricing.maximumPlanningEstimateUsd, executed: false }));
