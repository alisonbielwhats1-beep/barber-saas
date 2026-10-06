import type { EvaluationInput } from "./contract";
import { JevDecisionProvider } from "./jev-provider";
import { parseConditionalStage, routeDiscovery, type Stage } from "./conditional-plan";
import { derivationCatalog, derivationCatalogHash, isAuditedPublication, publishedDecisionCatalog, type DerivationCatalog, type Publication } from "./derivation-catalog";
import { composeDerived, derivedRequest, derivedResult, type DerivedResult } from "./derived-plan";

/** Evaluation only. Catalog compatibility is checked before any network; default budget is zero. */
export class DerivedJevProvider {
  private calls = 0;
  constructor(private readonly options: { transport: typeof fetch; credential: () => string | undefined; maxCalls?: number; now?: () => number;
    catalog?: DerivationCatalog; publication?: () => Publication }) {
    if (!Number.isInteger(options.maxCalls ?? 0) || (options.maxCalls ?? 0) < 0 || (options.maxCalls ?? 0) > 50) throw Error("INVALID_CALL_BUDGET");
  }
  get httpCalls() { return this.calls; }
  async evaluate(input: EvaluationInput): Promise<DerivedResult> {
    const result = derivedResult(), now = this.options.now ?? (() => performance.now()), start = now();
    try {
      if (input.context.waiting_for) { result.status = "NO_MATCH"; result.fallbackReasons = ["USE_EXISTING_DRAFT_FLOW"]; return result; }
      const catalog = this.options.catalog ?? derivationCatalog, publication = (this.options.publication ?? publishedDecisionCatalog)();
      if (!isAuditedPublication(publication) || derivationCatalogHash(catalog) !== derivationCatalogHash(derivationCatalog)) {
        result.status = "NO_MATCH"; result.fallbackReasons = ["CATALOG_DRIFT"]; return result;
      }
      const stage = async (s: Stage) => {
        if (this.calls >= (this.options.maxCalls ?? 0)) throw Error("CALL_BUDGET_EXHAUSTED");
        const request = derivedRequest(input, s);
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
      const composed = composeDerived(route.skill, discovery, detail, catalog, publication);
      if (!composed.ok) { result.status = "NO_MATCH"; result.fallbackReasons = [...detail.fallbackReasons, composed.reason]; return result; }
      result.decision = composed.decision; result.dependencies = []; result.derivations = composed.derivations;
      for (const d of composed.derivations) result.dimensionSources[d.dimension] = "DERIVED";
      for (const id of composed.notApplicable) result.dimensionSources[id] = "NOT_APPLICABLE";
      result.closedCoverage = composed.closedCoverage; result.requiresLuna = !composed.closedCoverage;
      result.fallbackReasons = [...composed.reasons, "NO_ACCEPTANCE_POLICY"]; result.status = "OK";
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
