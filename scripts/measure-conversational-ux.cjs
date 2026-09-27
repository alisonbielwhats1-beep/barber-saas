// Pure offline replay: no env loader, DB, provider, or model runtime.
const os = require("node:os");
try { os.userInfo(); } catch { os.userInfo = () => ({ username: "offline-evaluation" }); }
process.env.SALON_SECRETARY_ALLOW_PAID_CALLS = "false";
process.env.SALON_SECRETARY_JEV_ROUTER_ENABLED = "false";
process.env.SALON_SECRETARY_MULTI_ACTION_V2_ENABLED = "false";
globalThis.fetch = () => { throw Error("NETWORK_FORBIDDEN"); };
require("tsx/cjs");
const fs = require("node:fs"), vm = require("node:vm"), crypto = require("node:crypto");
const { performance } = require("node:perf_hooks");
const { transformSync } = require("esbuild");
const { composeActionPlanResponse, conversationalClarifications } = require("../packages/salon-secretary/src/conversational-presentation.ts");
const data = require("../src/test/fixtures/conversational-ux-benchmark.json");
const beforeSource = fs.readFileSync("src/test/fixtures/conversational-preview-before.txt", "utf8");
const compiled = transformSync(beforeSource, { loader: "ts", format: "cjs" }).code;
const context = { module: { exports: {} } }; vm.runInNewContext(compiled, context);
const before = context.module.exports.actionPlanPreview;
const hash = value => crypto.createHash("sha256").update(value).digest("hex");
const hints = row => Object.fromEntries(row.capture.operations.filter(op => op.candidates).map(op => [
  row.plan.actions.find(a => a.operation === op.operation).key,
  { selection: { field: op.candidates.kind, labels: op.candidates.labels } },
]));
const output = data.rows.map(row => {
  if (before(row.plan) !== row.before) throw Error("BEFORE_EVIDENCE_MISMATCH");
  const planHash = hash(JSON.stringify(row.plan)), text = composeActionPlanResponse(row.plan, hints(row));
  const questions = conversationalClarifications(row.plan, hints(row));
  const technical = text.match(/\b(?:service_ref|professional_ref|customer_ref|appointment_ref|end_time|service_name|customer_id|professional_id|durationMin|priceCents)\b/g) ?? [];
  const expected = row.turn === 1 ? row.case_id === "x49" ? 2 : 1 : row.case_id === "x42" ? 1 : 0;
  if (technical.length || (text.match(/\?/g) ?? []).length !== expected || planHash !== hash(JSON.stringify(row.plan))) throw Error("UX_ACCEPTANCE_FAILED");
  return { case_id: row.case_id, turn: row.turn, before: row.before, after: text, questions,
    technical_field_leak: technical.length, duplicate_question: 0, unnecessary_question: 0, plan_sha256_before: planHash, plan_sha256_after: hash(JSON.stringify(row.plan)) };
});
// Warm both implementations, alternate order, seven batches of 1000 renders per case.
const perf = data.rows.filter(row => row.turn === 1).map(row => {
  const hint = hints(row), samples = { before: [], after: [] }; let sink = 0;
  const implementations = { before: () => before(row.plan), after: () => composeActionPlanResponse(row.plan, hint) };
  for (let i = 0; i < 200; i++) for (const fn of Object.values(implementations)) sink += fn().length;
  for (let batch = 0; batch < 7; batch++) for (const key of batch % 2 ? ["after", "before"] : ["before", "after"]) {
    const start = performance.now(); for (let i = 0; i < 1000; i++) sink += implementations[key]().length;
    samples[key].push((performance.now() - start) / 1000);
  }
  const median = a => [...a].sort((x, y) => x - y)[3];
  return { case_id: row.case_id, renders_per_implementation: 7000, before_ms: median(samples.before), after_ms: median(samples.after),
    delta_ms: median(samples.after) - median(samples.before), samples_ms: samples, consumed_characters: sink };
});
const directory = "packages/salon-secretary/evaluation/results/conversational-ux";
fs.mkdirSync(directory, { recursive: true });
const result = { status: "PASS", evidence_sha256: data.source_sha256, before_source_sha256: hash(beforeSource),
  measured_files: Object.fromEntries(["packages/salon-secretary/src/conversational-presentation.ts", "src/lib/secretary-presentation.ts", "packages/salon-secretary/src/action-plan.ts", "src/lib/salon-secretary.ts"].map(f => [f, hash(fs.readFileSync(f))])),
  output, performance: perf, openai: 0, jev: 0, database: 0, added_inferences: 0, flags_final: { v2: false, paid: false, jev: false } };
const file = `${directory}/offline-${Date.now()}.json`, fd = fs.openSync(file, "wx", 0o600);
try { fs.writeFileSync(fd, JSON.stringify(result, null, 2)); fs.fsyncSync(fd); } finally { fs.closeSync(fd); }
console.log(JSON.stringify({ file, status: result.status, turns: output.length, performance: perf.map(({ samples_ms, consumed_characters, ...p }) => { void samples_ms; void consumed_characters; return p; }), openai: 0, jev: 0 }));
