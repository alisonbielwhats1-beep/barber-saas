import { existsSync, writeFileSync } from "node:fs";
import { prepareWave1Continuation } from "./coverage-expansion-wave1-continuation";

const output = "packages/salon-secretary/evaluation/coverage-expansion-wave1-continuation.json";
if (existsSync(output)) throw Error("CONTINUATION_ALREADY_PREPARED");
const plan = prepareWave1Continuation();
writeFileSync(output, `${JSON.stringify(plan, null, 2)}\n`, "utf8");
console.log(JSON.stringify({ prepared: true, first: plan.remainingCases[0].id,
  last: plan.remainingCases.at(-1)?.id, evaluations: plan.remainingEvaluations,
  maximumAdditionalHttp: plan.maximumAdditionalHttp, maximumAdditionalCostUsd: plan.maximumAdditionalCostUsd,
  executed: plan.executed }));
