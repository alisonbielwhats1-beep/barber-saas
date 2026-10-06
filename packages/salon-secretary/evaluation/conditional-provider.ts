import { JevDecisionProvider } from "./jev-provider";
import { composeConditional, conditionalRequest, conditionalResult, parseConditionalStage, routeDiscovery, type ConditionalResult, type Stage } from "./conditional-plan";
import type { EvaluationInput } from "./contract";

/** Isolated evaluation coordinator, not a production router. Default HTTP budget is ZERO. */
export class ConditionalJevProvider {
  private calls = 0;
  constructor(private readonly options: { transport: typeof fetch; credential: () => string | undefined; maxCalls?: number; now?: () => number }) {
    if (!Number.isInteger(options.maxCalls ?? 0) || (options.maxCalls ?? 0) < 0 || (options.maxCalls ?? 0) > 50) throw Error("INVALID_CALL_BUDGET");
  }
  get httpCalls() { return this.calls; }
  async evaluate(input: EvaluationInput): Promise<ConditionalResult> {
    const result = conditionalResult(), now = this.options.now ?? (() => performance.now()), start = now();
    try {
      // Existing draft flow/fast-path has priority; this experiment must not classify it anew.
      if (input.context.waiting_for) { result.status = "NO_MATCH"; result.fallbackReasons = ["USE_EXISTING_DRAFT_FLOW"]; return result; }
      const stage = async (s: Stage) => {
        if (this.calls >= (this.options.maxCalls ?? 0)) throw Error("CALL_BUDGET_EXHAUSTED");
        const request = conditionalRequest(input, s);
        const provider = new JevDecisionProvider({ transport: async (url, init) => { this.calls++; return this.options.transport(url, init); }, credential: this.options.credential, now,
          protocol: { build: () => request, parse: raw => parseConditionalStage(raw, request) } });
        const r = await provider.evaluate(input);
        result.stages.push({ stage: s, request, result: r });
        Object.assign(result.answers, r.answers);
        for (const id of Object.keys(r.answers) as (keyof typeof result.dimensionSources)[]) result.dimensionSources[id] = "ASKED";
        result.modelRequested = r.modelRequested; result.modelReturned = r.modelReturned;
        if (r.status === "ERROR") { result.error = r.error; result.fallbackReasons.push(...r.fallbackReasons); }
        return r;
      };
      const discovery = await stage({ kind: "discovery" });
      if (discovery.status === "ERROR") return result;
      const route = routeDiscovery(discovery);
      if (route.kind === "stop") { result.status = "NO_MATCH"; result.requiresLuna = route.reason !== "OUT_OF_CATALOG"; result.fallbackReasons = [...new Set([...discovery.fallbackReasons, route.reason])]; return result; }
      const detail = await stage({ kind: "detail", skill: route.skill });
      if (detail.status === "ERROR") return result;
      const composed = composeConditional(route.skill, discovery, detail);
      result.decision = composed.decision; result.dependencies = [];
      result.closedCoverage = composed.closedCoverage; result.requiresLuna = !composed.closedCoverage;
      result.fallbackReasons = [...composed.reasons, "NO_ACCEPTANCE_POLICY"];
      for (const id of composed.notApplicable) result.dimensionSources[id] = "NOT_APPLICABLE";
      result.status = "OK";
    } catch (e) {
      if (e instanceof Error && e.message === "CALL_BUDGET_EXHAUSTED") { result.status = "NO_MATCH"; result.fallbackReasons.push("CALL_BUDGET_EXHAUSTED"); }
      else { result.status = "ERROR"; result.error = "INVALID_RESPONSE"; result.fallbackReasons.push("INVALID_RESPONSE"); }
    } finally {
      result.latencyMs = now() - start;
      if (result.stages.length) {
        for (const key of ["inputTokens", "outputTokens"] as const) {
          const values = result.stages.map(s => s.result.usage[key]);
          result.usage[key] = values.every(x => x !== null) ? values.reduce<number>((sum, x) => sum + (x ?? 0), 0) : null;
        }
        const costs = result.stages.map(s => s.result.estimatedCostUsd);
        result.estimatedCostUsd = costs.every(x => x !== null) ? costs.reduce<number>((sum, x) => sum + (x ?? 0), 0) : null;
      }
    }
    return result;
  }
}
