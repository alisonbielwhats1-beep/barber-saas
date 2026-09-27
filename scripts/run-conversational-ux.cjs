const os = require("node:os");
try { os.userInfo(); } catch { os.userInfo = () => ({ username: "offline-evaluation" }); }
require("@next/env").loadEnvConfig(process.cwd(), true);
require("tsx/cjs");
// Observe the actual synchronous compositor without changing any frozen runtime source.
const { performance } = require("node:perf_hooks");
const timing = require("../packages/salon-secretary/evaluation/conversational-ux-timing.ts");
const modulePath = require.resolve("../src/lib/secretary-presentation.ts");
const presentation = require(modulePath);
const original = presentation.secretaryPlanMessage;
require.cache[modulePath].exports = new Proxy(presentation, { get(target, property) {
  if (property !== "secretaryPlanMessage") return Reflect.get(target, property);
  return (...args) => { const start = performance.now(); try { return original(...args); }
    finally { timing.recordComposer(performance.now() - start); } };
} });
const probe = require("../src/test/fixtures/conversational-ux-benchmark.json").rows.find(r => r.case_id === "x46" && r.turn === 1);
const before = JSON.stringify(probe.plan);
if (require(modulePath).secretaryPlanMessage(probe.plan, [], []) !== original(probe.plan, [], []) ||
    timing.composerMeasurement().calls !== 1 || JSON.stringify(probe.plan) !== before)
  throw Error("TARGET_COMPOSER_OBSERVER_FAILED");
require("./run-conversational-ux.ts");
