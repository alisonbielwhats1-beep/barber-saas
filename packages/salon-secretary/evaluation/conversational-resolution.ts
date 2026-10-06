/** Gate 4.0A: pure evaluation primitives. Not exported by the package/runtime.
 * Inputs are trusted backend snapshots, NEVER model-produced references.
 * No result of this module grants execution/confirmation authority.
 */
export type Provenance = "USER_EXPLICIT" | "FAST_PATH" | "LUNA" | "JEV" |
  "DETERMINISTIC_DERIVATION" | "BACKEND_EXACT" | "BACKEND_DETERMINISTIC" |
  "USER_CONFIRMED_APPROXIMATION";
export type ResolutionLevel = "EXACT" | "DETERMINISTIC_BACKEND" |
  "APPROXIMATE_SINGLE_CANDIDATE" | "AMBIGUOUS" | "MISSING_REQUIRED_INPUT" |
  "DOMAIN_CONFLICT" | "UNSUPPORTED";
export type Scope = { tenant: string; actor: string; conversation: string; revision: number };
export type Candidate = { ref: string; label: string; match: "EXACT" | "APPROXIMATE" };
export type CandidateSnapshot = { scope: Scope; expiresAt: number; complete: boolean; candidates: Candidate[] };
export type Resolution = { level: ResolutionLevel; reason: string; resolvedRef?: string; choices?: Candidate[] };
const sameScope = (a: Scope, b: Scope) => a.tenant === b.tenant && a.actor === b.actor &&
  a.conversation === b.conversation && a.revision === b.revision;

// Candidate retrieval/ranking is not implemented here. Existing contains search is
// only candidate generation; count === 1 is not evidence of an exact match.
export function resolveCandidates(scope: Scope, snapshot: CandidateSnapshot, now: number): Resolution {
  if (!sameScope(scope, snapshot.scope) || !Number.isFinite(now) || !Number.isFinite(snapshot.expiresAt) || snapshot.expiresAt <= now)
    return { level: "DOMAIN_CONFLICT", reason: "STALE_OR_FOREIGN_SNAPSHOT" };
  if (!snapshot.complete) return { level: "AMBIGUOUS", reason: "REFINE_TRUNCATED_SEARCH" };
  const candidates = snapshot.candidates;
  if (candidates.some(c => !c.ref || !c.label || !["EXACT", "APPROXIMATE"].includes(c.match)) || new Set(candidates.map(c => c.ref)).size !== candidates.length)
    return { level: "DOMAIN_CONFLICT", reason: "INVALID_CANDIDATE_SNAPSHOT" };
  const exact = candidates.filter(c => c.match === "EXACT");
  if (exact.length === 1) return { level: "EXACT", reason: "UNIQUE_EXACT", resolvedRef: exact[0].ref };
  if (!candidates.length) return { level: "MISSING_REQUIRED_INPUT", reason: "NOT_FOUND" };
  if (exact.length > 1 || candidates.length > 1)
    return { level: "AMBIGUOUS", reason: "ASK_SELECTION", choices: exact.length > 1 ? exact : candidates };
  return { level: "APPROXIMATE_SINGLE_CANDIDATE", reason: "ASK_CONFIRMATION", choices: candidates };
}

export type ClarificationField = { key: string; status: "RESOLVED" | "ASK" | "BACKEND_PENDING" | "BLOCKED"; dependsOn: string[] };
/** Minimal currently actionable frontier of an explicit dependency graph, not an
 * NLP heuristic or an assertion that a global minimum question set was solved. */
export function clarificationFrontier(fields: ClarificationField[]) {
  const byKey = new Map(fields.map(f => [f.key, f]));
  if (byKey.size !== fields.length) throw Error("DUPLICATE_FIELD");
  const seen = new Set<string>(), visiting = new Set<string>();
  const visit = (key: string) => {
    if (visiting.has(key)) throw Error("FIELD_DEPENDENCY_CYCLE");
    if (seen.has(key)) return;
    const f = byKey.get(key); if (!f) throw Error("UNKNOWN_FIELD_DEPENDENCY");
    if (!["RESOLVED", "ASK", "BACKEND_PENDING", "BLOCKED"].includes(f.status)) throw Error("UNKNOWN_FIELD_STATUS");
    visiting.add(key); f.dependsOn.forEach(visit); visiting.delete(key); seen.add(key);
  };
  fields.forEach(f => visit(f.key));
  const ready = (f: ClarificationField) => f.dependsOn.every(k => byKey.get(k)?.status === "RESOLVED");
  return {
    ask: fields.filter(f => f.status === "ASK" && ready(f)).map(f => f.key),
    resolveFirst: fields.filter(f => f.status === "BACKEND_PENDING" && ready(f)).map(f => f.key),
    blocked: fields.filter(f => f.status === "BLOCKED").map(f => f.key),
    // All backend results must be applied and the frontier recomputed before
    // rendering a question. A pending lookup is not missing human input.
  };
}

export type FieldEvidence = { value: string | number | boolean; source: Provenance;
  informedByUser: boolean; extractedBy?: "LUNA" | "FAST_PATH" | "JEV";
  dependsOn: string[]; confirmed: boolean };
/** The caller supplies a scoped UI/clarification answer, never free chat "sim"
 * without a pending question. This confirms entity meaning, NOT an operation. */
export function confirmApproximation(scope: Scope, snapshot: CandidateSnapshot, now: number,
  answer: { questionId: string; currentQuestionId: string; selectedRef: string; sourceField: string }): FieldEvidence {
  const resolution = resolveCandidates(scope, snapshot, now);
  if (!answer.questionId || !answer.sourceField || answer.questionId !== answer.currentQuestionId ||
    resolution.level !== "APPROXIMATE_SINGLE_CANDIDATE" || resolution.choices?.[0].ref !== answer.selectedRef)
    throw Error("CLARIFICATION_CONTEXT_MISMATCH");
  return { value: answer.selectedRef, source: "USER_CONFIRMED_APPROXIMATION", informedByUser: true, dependsOn: [answer.sourceField], confirmed: true };
}
export type OfflineDraft = { scope: Scope; itemKey: string; operation: string;
  status: "ACTIVE" | "PAUSED" | "ABANDONED"; fields: Record<string, FieldEvidence>;
  preview?: { revision: number; fingerprint: string }; pendingQuestion?: string;
  history: { revision: number; reason: string; changedFields: string[] }[] };
/** Adapter must first validate the patch with the EXISTING operation contract.
 * This revision helper consumes that validated patch; it is not an extractor. */
export function reviseDraft(draft: OfflineDraft, scope: Scope, patch: Record<string, FieldEvidence>, reason: "USER_CORRECTION" | "BACKEND_RESOLUTION") {
  if (!sameScope(draft.scope, scope) || draft.status !== "ACTIVE") throw Error("DRAFT_CONTEXT_MISMATCH");
  const changed = Object.keys(patch);
  if (!changed.length) return draft;
  const invalidated = new Set(changed);
  let progress = true;
  while (progress) {
    progress = false;
    for (const [key, field] of Object.entries(draft.fields)) {
      if (!invalidated.has(key) && field.dependsOn.some(d => invalidated.has(d))) {
        invalidated.add(key); progress = true;
      }
    }
  }
  // A correction cannot retain an old derived value in the same patch. Resolve
  // it again against the new revision in a separate backend pass.
  for (const field of Object.values(patch)) if (field.dependsOn.some(d => invalidated.has(d))) throw Error("STALE_DERIVED_PATCH");
  const fields = Object.fromEntries(Object.entries(draft.fields).filter(([key]) => !invalidated.has(key)));
  const revision = scope.revision + 1;
  return { ...draft, scope: { ...scope, revision }, fields: { ...fields, ...patch },
    preview: undefined, pendingQuestion: undefined,
    history: [...draft.history, { revision, reason, changedFields: [...invalidated] }] } satisfies OfflineDraft;
}

export function switchIntent(draft: OfflineDraft, scope: Scope, mode: "EXPLICIT_ABANDON" | "PAUSE") {
  if (!sameScope(draft.scope, scope) || draft.status !== "ACTIVE") throw Error("DRAFT_CONTEXT_MISMATCH");
  const revision = scope.revision + 1;
  return { ...draft, scope: { ...scope, revision }, status: mode === "EXPLICIT_ABANDON" ? "ABANDONED" : "PAUSED",
    preview: undefined, pendingQuestion: undefined,
    history: [...draft.history, { revision, reason: mode, changedFields: [] }] } satisfies OfflineDraft;
}

export type OfflineItem = { itemKey: string; operation: string; independent: boolean; dependsOn: string[];
  state: "NEEDS_INPUT" | "READY" | "FAILED" | "SUCCEEDED" | "UNSUPPORTED" };
/** General graph validation for DESIGN targets only. Does not extend Registry's
 * four-action boundary or its two supported dependent execution patterns. */
export function reviewGraph(items: OfflineItem[]) {
  if (!items.length || items.length > 5) throw Error("ITEM_LIMIT");
  const byKey = new Map(items.map(i => [i.itemKey, i]));
  if (byKey.size !== items.length || items.some(i => !i.itemKey)) throw Error("DUPLICATE_ITEM");
  const visited = new Set<string>(), active = new Set<string>();
  const visit = (key: string) => {
    if (active.has(key)) throw Error("DEPENDENCY_CYCLE");
    if (visited.has(key)) return;
    const item = byKey.get(key); if (!item) throw Error("UNKNOWN_DEPENDENCY");
    if (!["NEEDS_INPUT", "READY", "FAILED", "SUCCEEDED", "UNSUPPORTED"].includes(item.state)) throw Error("UNKNOWN_ITEM_STATE");
    if (item.independent !== (item.dependsOn.length === 0) || new Set(item.dependsOn).size !== item.dependsOn.length) throw Error("INVALID_DEPENDENCY_DECLARATION");
    active.add(key); item.dependsOn.forEach(visit); active.delete(key); visited.add(key);
  };
  items.forEach(i => visit(i.itemKey));
  return items.map(i => ({ itemKey: i.itemKey,
    blocked: i.state !== "READY" || i.dependsOn.some(d => byKey.get(d)?.state !== "SUCCEEDED"),
    operationalExecutionAllowed: false as const }));
}

/** Preview freshness is one prerequisite only; it NEVER authorizes execution. */
export function previewIsCurrent(draft: OfflineDraft, scope: Scope, fingerprint: string) {
  return sameScope(draft.scope, scope) && draft.status === "ACTIVE" && Boolean(fingerprint) &&
    draft.preview?.revision === scope.revision && draft.preview.fingerprint === fingerprint &&
    Object.values(draft.fields).every(f => f.confirmed);
}

export type Observation = { expectedOpportunities: number; successes: number; failures: number };
/** Null for unmeasured/zero denominator, not an invented perfect score. */
export function measuredRate(o: Observation): number | null {
  if (![o.expectedOpportunities, o.successes, o.failures].every(n => Number.isInteger(n) && n >= 0) ||
    o.successes + o.failures !== o.expectedOpportunities) throw Error("INVALID_MEASUREMENT");
  return o.expectedOpportunities ? o.successes / o.expectedOpportunities : null;
}
