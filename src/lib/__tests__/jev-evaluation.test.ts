import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { readFileSync, existsSync, readdirSync } from "node:fs";
import { join } from "node:path";
import { choiceSets, emptyResult, type Decision, type EvaluationInput, type QuestionId } from "../../../packages/salon-secretary/evaluation/contract";
import { JevDecisionProvider, JEV_ENDPOINT, JEV_MODEL, buildJevRequest, createJevEvaluationProvider, parseJevResponse } from "../../../packages/salon-secretary/evaluation/jev-provider";
import { dataset, validateDataset } from "../../../packages/salon-secretary/evaluation/dataset";
import { inputFingerprint, percentile, replayFastPath, runEvaluation, scoreCase, summarize, type ArchiveEntry } from "../../../packages/salon-secretary/evaluation/harness";
import { prepareFirstRun } from "../../../packages/salon-secretary/evaluation/prepare";
import { secretaryFastPath } from "../secretary-fast-path";
import { inventoryQuantityFastPath, inventoryState, type InventoryState } from "../secretary-inventory";
import { communicationChannelFastPath, communicationState, type CommunicationState } from "../secretary-communication";

const financial = dataset.find(c => c.id === "financial-revenue")!;
const fakeCredential = () => "unit-test-only-not-a-real-key";
function responseFor(d: Decision = financial.expected.decision) {
  return { model: JEV_MODEL, answers: Object.fromEntries((Object.keys(choiceSets) as QuestionId[]).map(id => [id, { type: "choice", choice: d[id], confidence: 1, probabilities: Object.fromEntries(choiceSets[id].map(value => [value, value === d[id] ? 1 : 0])) }])), usage: { input_tokens: 1000, output_tokens: 100 } };
}
function transport(body: unknown = responseFor()) { return vi.fn<typeof fetch>().mockResolvedValue(new Response(JSON.stringify(body), { headers: { "x-request-id": "fake-request" } })); }
const parser = (input: EvaluationInput) => {
  if (input.context.waiting_for === "quantity") {
    const state: InventoryState = { ...inventoryState(), operation: "stock.movement", fields: { mode: input.context.inventory_mode }, draft: { operation: "stock.movement", draft_ref: "synthetic", draft_revision: 1, expires_at: "", fields: { mode: input.context.inventory_mode }, status: "NEEDS_INPUT", missing_fields: ["quantity"], product: { id: "synthetic", name: "Synthetic", stock: 12, minStock: 3, active: true, unit: "un", revision: "r" } } };
    return inventoryQuantityFastPath(state, input.message);
  }
  if (input.context.waiting_for === "channel") {
    const state = { ...communicationState(), draft: { missing_fields: ["channel"] } } as CommunicationState;
    return communicationChannelFastPath(state, input.message);
  }
  return secretaryFastPath(input.context.waiting_for, input.message);
};
beforeEach(() => vi.stubGlobal("fetch", vi.fn(() => { throw Error("NO_EXTERNAL_NETWORK"); })));
afterEach(() => { vi.unstubAllGlobals(); vi.useRealTimers(); });

describe("isolated JEV official HTTP adapter — mocks only", () => {
  it("missing key never dispatches, zero is not invented usage/cost", async () => {
    const send = transport(), p = new JevDecisionProvider({ credential: () => undefined, transport: send });
    expect(await p.evaluate(financial.input)).toMatchObject({ status: "ERROR", error: "MISSING_KEY", usage: { inputTokens: null }, estimatedCostUsd: null });
    expect(send).not.toHaveBeenCalled();
  });
  it("present key goes only into Authorization, official endpoint, no ambient fetch/effects", async () => {
    const send = transport(), p = new JevDecisionProvider({ credential: fakeCredential, transport: send });
    const r = await p.evaluate(financial.input);
    expect(r).toMatchObject({ status: "OK", decision: financial.expected.decision, executable: false, estimatedCostUsd: 0.000042, actualCostUsd: null });
    expect(send).toHaveBeenCalledTimes(1); expect(send.mock.calls[0][0]).toBe(JEV_ENDPOINT);
    const init = send.mock.calls[0][1]!;
    expect(new Headers(init.headers).get("Authorization")).toBe(`Bearer ${fakeCredential()}`);
    expect(init.redirect).toBe("error"); expect(init.body).not.toContain(fakeCredential());
    expect(JSON.stringify(r)).not.toContain(fakeCredential()); expect(JSON.stringify(p)).not.toContain(fakeCredential());
    expect(global.fetch).not.toHaveBeenCalled();
  });
  it.each([null, [], {}, { model: "other", answers: {} }, { ...responseFor(), secret: "unexpected" }])("rejects malformed/unexpected shape", async body => {
    const r = await new JevDecisionProvider({ credential: fakeCredential, transport: transport(body) }).evaluate(financial.input);
    expect(r).toMatchObject({ status: "ERROR", error: "INVALID_RESPONSE", estimatedCostUsd: null });
  });
  it("invalid JSON and echoed credentials never escape", async () => {
    const send = vi.fn<typeof fetch>().mockResolvedValue(new Response(fakeCredential()));
    const r = await new JevDecisionProvider({ credential: fakeCredential, transport: send }).evaluate(financial.input);
    expect(r.error).toBe("INVALID_RESPONSE"); expect(JSON.stringify(r)).not.toContain(fakeCredential());
  });
  it.each([401, 403, 429, 529, 500])("HTTP %s makes one attempt and sanitizes failure", async status => {
    const send = vi.fn<typeof fetch>().mockResolvedValue(new Response(fakeCredential(), { status }));
    const r = await new JevDecisionProvider({ credential: fakeCredential, transport: send }).evaluate(financial.input);
    expect(send).toHaveBeenCalledTimes(1); expect(r.error).toBe(status === 401 || status === 403 ? "AUTH" : status === 429 ? "RATE_LIMIT" : "HTTP");
    expect(JSON.stringify(r)).not.toContain(fakeCredential()); expect(r.estimatedCostUsd).toBeNull();
  });
  it("transport failure containing sensitive input is replaced with constant error", async () => {
    const send = vi.fn<typeof fetch>().mockRejectedValue(Error(fakeCredential()));
    expect(await new JevDecisionProvider({ credential: fakeCredential, transport: send }).evaluate(financial.input)).toMatchObject({ error: "NETWORK", estimatedCostUsd: null });
  });
  it("deadline aborts without retry even when transport ignores AbortSignal", async () => {
    vi.useFakeTimers(); const send = vi.fn<typeof fetch>(() => new Promise(() => {}));
    const pending = new JevDecisionProvider({ credential: fakeCredential, transport: send, timeoutMs: 10 }).evaluate(financial.input);
    await vi.advanceTimersByTimeAsync(11); const r = await pending;
    expect(r.error).toBe("TIMEOUT"); expect(r.estimatedCostUsd).toBeNull(); expect(send).toHaveBeenCalledTimes(1);
    expect(send.mock.calls[0][1]?.signal?.aborted).toBe(true);
  });
  it("deadline includes slow response body", async () => {
    vi.useFakeTimers(); const res = new Response("{}"); res.json = () => new Promise(() => {});
    const send = vi.fn<typeof fetch>().mockResolvedValue(res);
    const pending = new JevDecisionProvider({ credential: fakeCredential, transport: send, timeoutMs: 10 }).evaluate(financial.input);
    await vi.advanceTimersByTimeAsync(11); expect((await pending).error).toBe("TIMEOUT");
  });
  it("missing confidence remains null and requests fallback, never invents it from top probability", () => {
    const raw = responseFor(); delete (raw.answers.skill as { confidence?: number }).confidence;
    const r = parseJevResponse(raw); expect(r.answers.skill?.confidence).toBeNull(); expect(r.fallbackReasons).toContain("MISSING_CONFIDENCE:skill");
  });
  it("missing usage stays unknown; null confidence is an unexpected schema", () => {
    const raw = responseFor(); delete (raw as { usage?: unknown }).usage;
    expect(parseJevResponse(raw).estimatedCostUsd).toBeNull();
    (raw.answers.skill as { confidence: unknown }).confidence = null;
    expect(() => parseJevResponse(raw)).toThrow();
  });
  it("rejects unknown labels, invented refs, missing/extra questions, inconsistent probabilities and semantic mismatch", () => {
    const bad = [
      (x: ReturnType<typeof responseFor>) => { (x.answers.skill as { choice: string }).choice = "admin"; },
      (x: ReturnType<typeof responseFor>) => { x.answers.skill.probabilities.financial = 0.4; },
      (x: ReturnType<typeof responseFor>) => { x.answers.skill.choice = "services"; },
      (x: ReturnType<typeof responseFor>) => { delete (x.answers as Record<string, unknown>).skill; },
      (x: ReturnType<typeof responseFor>) => { (x.answers as Record<string, unknown>).customer_ref = "fake"; },
    ];
    for (const change of bad) { const x = responseFor(); change(x); expect(() => parseJevResponse(x)).toThrow(); }
    expect(() => parseJevResponse(responseFor({ ...financial.expected.decision, skill: "services" }))).toThrow();
  });
  it.each(["Telefone +55 (21) 99999-1234", "api_key=abc", "Bearer: abc", "x@local.test", "https://unknown.test", "customer_ref=anything"])("blocks unnecessary sensitive input %s", async message => {
    const send = transport(); const r = await new JevDecisionProvider({ credential: fakeCredential, transport: send }).evaluate({ message, context: {} });
    expect(r.error).toBe("INVALID_INPUT"); expect(send).not.toHaveBeenCalled();
  });
  it("strict input rejects domain IDs/financial records and expected; exact key cannot enter state", async () => {
    expect(() => buildJevRequest({ ...financial.input, expected: financial.expected } as EvaluationInput)).toThrow();
    expect(() => buildJevRequest({ message: "oi", context: { salonId: "s" } } as unknown as EvaluationInput)).toThrow();
    const send = transport(); expect((await new JevDecisionProvider({ credential: fakeCredential, transport: send }).evaluate({ message: fakeCredential(), context: {} })).error).toBe("INVALID_INPUT"); expect(send).not.toHaveBeenCalled();
  });
  it("factory needs explicit authorization and ONLY TYPESAFE_API_KEY; never starts a request", async () => {
    const send = transport(); expect(() => createJevEvaluationProvider({}, { allowNetwork: false }, send)).toThrow("NETWORK_DISABLED");
    expect(() => createJevEvaluationProvider({ SALON_SECRETARY_ALLOW_PAID_CALLS: "true" }, { allowNetwork: true }, send)).toThrow("OPENAI_MUST_REMAIN_DISABLED");
    const p = createJevEvaluationProvider({ SALON_SECRETARY_ALLOW_PAID_CALLS: "false", OPENAI_API_KEY: fakeCredential() }, { allowNetwork: true }, send);
    expect((await p.evaluate(financial.input)).error).toBe("MISSING_KEY"); expect(send).not.toHaveBeenCalled();
  });
});

describe("predeclared dataset / offline harness / existing fast-path", () => {
  it("40 complete cases, unique IDs, valid sources and all published skills represented", () => {
    const cases = validateDataset(dataset); expect(cases).toHaveLength(40);
    expect(Object.fromEntries(["A", "B", "C", "D"].map(k => [k, cases.filter(c => c.category === k).length]))).toEqual({ A: 5, B: 14, C: 18, D: 3 });
    expect(new Set(cases.flatMap(c => c.expected.skills)).size).toBe(6);
    for (const c of cases) for (const e of c.evidence) {
      expect(existsSync(e.path), e.path).toBe(true);
      if (e.kind === "domain_test") expect(readFileSync(e.path, "utf8"), `${e.path}#${e.anchor}`).toContain(e.anchor);
      if (e.kind === "real_output") {
        const goldens = JSON.parse(readFileSync(e.path, "utf8")) as { id?: string; caseId?: string }[];
        expect(goldens.some(g => (g.id ?? g.caseId) === e.anchor)).toBe(true);
      }
    }
  });
  it.each(dataset.map(c => [c.id, c] as const))("request for %s does not leak expected/evidence/domainFields", (_, c) => {
    const request = buildJevRequest(c.input); expect(Object.keys(request.state)).toEqual(["message", "context"]);
    expect(JSON.stringify(request)).not.toContain("domainFields"); expect(request).not.toHaveProperty("expected");
  });
  it("rejects incomplete expected, invalid category, duplicate ID and invalid/cyclic dependency", () => {
    const c = structuredClone(financial);
    expect(() => validateDataset([{ ...c, category: "Z" }])).toThrow();
    expect(() => validateDataset([{ ...c, expected: { ...c.expected, domainFields: {} } }])).toThrow();
    expect(() => validateDataset([c, c])).toThrow();
    const batch = structuredClone(dataset.find(x => x.id === "scheduling-batch")!);
    batch.expected.dependencies = [{ from: 0, to: 8 }]; expect(() => validateDataset([batch])).toThrow();
    batch.expected.dependencies = [{ from: 0, to: 1 }, { from: 1, to: 0 }]; expect(() => validateDataset([batch])).toThrow("DEPENDENCY_CYCLE");
  });
  it("existing production parsers handle five A cases with zero models; ambiguous language falls through", () => {
    for (const c of dataset.filter(c => c.category === "A")) {
      let clock = 0; const r = replayFastPath(c.input, parser, () => ++clock);
      expect(r.fastPathPatch).toEqual(c.expected.fastPathPatch); expect(r.latencyMs).toBe(1); expect(r.estimatedCostUsd).toBe(0);
    }
    expect(replayFastPath({ message: "depois do almoço", context: { operation: "appointment.change", waiting_for: "time" } }, parser).status).toBe("NO_MATCH");
    expect(global.fetch).not.toHaveBeenCalled();
  });
  it("harness mock is deterministic, bounded, passes no oracle and does not call Luna", async () => {
    const evaluate = vi.fn(async (input: EvaluationInput) => { expect(Object.keys(input)).toEqual(["message", "context"]); const r = parseJevResponse(responseFor()); r.latencyMs = 12; return r; });
    const options = { jev: { evaluate }, maxCalls: 1, now: () => 0 };
    expect(await runEvaluation([financial], options)).toEqual(await runEvaluation([financial], options));
    expect(evaluate).toHaveBeenCalledTimes(2);
    const never = vi.fn(); await runEvaluation([financial], { jev: { evaluate: never } }); expect(never).not.toHaveBeenCalled();
    expect(global.fetch).not.toHaveBeenCalled();
  });
  it("stops immediately at provider error, never retries or advances to another paid case", async () => {
    const evaluate = vi.fn(async () => ({ ...emptyResult("JEV"), error: "AUTH" as const }));
    const r = await runEvaluation(dataset, { jev: { evaluate }, maxCalls: 4 }); expect(r.calls).toBe(1); expect(evaluate).toHaveBeenCalledTimes(1);
  });
  it("rejects fractional, negative and unbounded call budgets before consulting provider", async () => {
    const evaluate = vi.fn();
    for (const maxCalls of [1.5, -1, Infinity, NaN, 51]) await expect(runEvaluation([financial], { jev: { evaluate }, maxCalls })).rejects.toThrow("INVALID_CALL_BUDGET");
    expect(evaluate).not.toHaveBeenCalled();
  });
  it("confidence alone never enables acceptance; unsafe mutant prediction is counted if an experimental policy accepts", () => {
    const correct = parseJevResponse(responseFor()); expect(scoreCase(financial, correct).needsFallback).toBe(true);
    const wrong = parseJevResponse(responseFor({ ...financial.expected.decision, skill: "services", operation: "service.change", period: "none", metric: "none" }));
    const row = scoreCase(financial, wrong, () => true); expect(row.unsafeFalsePositive).toBe(true);
    expect(summarize([row]).unsafeFalsePositiveRateAmongAccepted).toBe(1);
    expect(scoreCase(dataset.find(c => c.id === "scheduling-cancel")!, parseJevResponse(responseFor(dataset.find(c => c.id === "scheduling-cancel")!.expected.decision)), () => true).needsFallback).toBe(true);
  });
  it("metrics do not invent missing cost; percentiles are nearest-rank and not fabricated on empty sets", () => {
    expect(percentile([], 0.95)).toBeNull(); expect(percentile([4, 1, 3, 2], 0.5)).toBe(2); expect(percentile([4, 1, 3, 2], 0.95)).toBe(4);
    const r = emptyResult("JEV"); r.error = "TIMEOUT"; r.latencyMs = 10000;
    const metrics = summarize([scoreCase(financial, r)]); expect(metrics.costPerRequestUsd).toBeNull(); expect(metrics.latencyP95Ms).toBe(10000); expect(metrics.successfulLatencyP50Ms).toBeNull(); expect(metrics.unsafeFalsePositiveRateAmongAccepted).toBeNull();
  });
  it("archive requires matching message/context fingerprint; decision-only historical latency is not a paired benchmark", async () => {
    const archive: ArchiveEntry = { caseId: financial.id, inputFingerprint: inputFingerprint(financial.input), source: "synthetic test archive", comparability: "decision_only", result: { ...parseJevResponse(responseFor()), provider: "LUNA_ARCHIVE" } };
    const r = await runEvaluation([financial], { archives: [archive] }); expect(r.luna.rows).toHaveLength(1); expect(r.luna.performanceComparableCaseIds).toEqual([]);
    expect((await runEvaluation([financial], { archives: [{ ...archive, inputFingerprint: "different" }] })).skippedArchive).toEqual([financial.id]);
  });
  it("first run is four exact payloads, offline and no key loading", () => {
    const p = prepareFirstRun(); expect(p.calls).toBe(4); expect(p.executed).toBe(false); expect(p.requests.map(r => r.caseId)).toContain("communication-dependent-name"); expect(global.fetch).not.toHaveBeenCalled();
    expect(JSON.parse(readFileSync("packages/salon-secretary/evaluation/first-run.json", "utf8"))).toEqual(p);
  });
  it("six archived real successes replay from sanitized historical outputs, never execute models", async () => {
    const archives = JSON.parse(readFileSync("packages/salon-secretary/evaluation/luna-baselines.json", "utf8")) as ArchiveEntry[];
    const r = await runEvaluation(dataset, { archives });
    expect(r.calls).toBe(0); expect(r.luna.rows).toHaveLength(6); expect(r.skippedArchive).toEqual([]);
    for (const row of r.luna.rows) expect(row.match).toMatchObject({ skill: true, operation: true, decision: true, dependencies: true });
    expect(r.luna.performanceComparableCaseIds).toEqual([]); expect(global.fetch).not.toHaveBeenCalled();
  });
  it("only Router V1 imports audited pure primitives; no evaluation runners/datasets enter runtime", () => {
    function files(dir: string): string[] { return readdirSync(dir, { withFileTypes: true }).flatMap(e => e.isDirectory() ? files(join(dir, e.name)) : /\.[jt]sx?$/.test(e.name) ? [join(dir, e.name)] : []); }
    for (const f of [...files("src"), ...files("packages/salon-secretary/src")].filter(f => !f.includes("__tests__"))) {
      const source=readFileSync(f,"utf8");
      if(f.replaceAll("\\","/")==="src/lib/secretary-router.ts") {
        const imports=[...source.matchAll(/from\s*["'][^"']*salon-secretary\/evaluation\/([^"']+)/g)].map(m=>m[1]);
        expect(imports.sort()).toEqual(["acceptance-policy","derivation-catalog","derived-plan","derived-provider","jev-provider"]);
      } else expect(source).not.toMatch(/(?:from|import\s*\()\s*["'][^"']*salon-secretary\/evaluation/);
    }
    expect(JSON.parse(readFileSync("packages/salon-secretary/package.json", "utf8")).exports).toEqual({ ".": "./src/index.ts" });
    const adapter = readFileSync("packages/salon-secretary/evaluation/jev-provider.ts", "utf8");
    expect(adapter).not.toMatch(/from\s*["'][^"']*(?:prisma|salon-secretary\/src|actions|openai)/);
  });
});
