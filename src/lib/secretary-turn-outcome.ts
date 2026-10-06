import { createHmac } from "node:crypto";
import { conversationalClarifications, type ActionPlan, type PlanAction } from "@everflair/salon-secretary";
import { presentationHints } from "./secretary-presentation";
import { viewProposal, type ActionUnit } from "./secretary-action-plan";
import { outcomeCode, outcomeField, type RouterTrace, type TurnOutcome, type TurnOutcomeKind } from "./secretary-router";
import type { SecretaryView } from "./salon-secretary";

/** Per-message runtime telemetry (rec 3). Everything here is read-only over backend state; nothing
 * returned may carry customer text, names, literals or IDs — only counts, closed field names,
 * whitelisted codes and session-keyed hashes of the questions shown. */
type ReadCarrier = { financial?: { status?: string }; inventory?: { status?: string } };
export type OutcomeSession = ReadCarrier & { id: string; skill: string; capability_status?: string; actionPlan?: ActionPlan;
  actionUnits?: readonly ActionUnit[]; children?: readonly string[] };
/** In-memory baseline of the addressed session before one user message. Never persisted. */
export type TurnBaseline = { planRef?: string; actions: ReadonlyMap<string, string>; reads: ReadonlySet<string>; children: number };
export type QuestionMemory = { salt: () => string; previous: readonly string[] };

const actionState = (action: PlanAction) => JSON.stringify([action.fields, action.status, action.assessment]);
const readDone = (s?: ReadCarrier) => s?.financial?.status === "DONE" || s?.inventory?.status === "DONE";
const present = (value: unknown) => Array.isArray(value) ? value.length > 0 : Boolean(value);
const supplied = (value: unknown) => value != null && !(Array.isArray(value) && !value.length);

export function turnBaseline(s: OutcomeSession, lookup: (id: string) => ReadCarrier | undefined): TurnBaseline {
  return { planRef: s.actionPlan?.plan_ref, actions: new Map(s.actionPlan?.actions.map(action => [action.key, actionState(action)]) ?? []),
    reads: new Set([...(readDone(s) ? [s.id] : []), ...(s.children ?? []).filter(id => readDone(lookup(id)))]), children: s.children?.length ?? 0 };
}

const interpretationOnly = new Set(["operation", "item_key", "depends_on", "released_slot_of", "same_as", "requested_fields", "clear_fields",
  "source_scope", "temporal_evidence", "temporal_negative_context"]);
const nested = new Set(["communication", "financial", "inventory"]);
// An absolute date grounded by the backend supersedes the relative selector Luna used.
const resolvedBy: Record<string, string> = { day_offset: "date", weekday: "date", source_day_offset: "source_date", source_weekday: "source_date" };
/** Names of fields the interpretation supplied (non-null) that the prepared action left empty. */
export function droppedFields(op: object, fields: object) {
  const effective = fields as Record<string, unknown>, dropped: string[] = [];
  for (const [key, value] of Object.entries(op)) {
    if (interpretationOnly.has(key) || key.endsWith("_evidence") || !supplied(value)) continue;
    if (nested.has(key) && typeof value === "object" && !Array.isArray(value)) {
      const inner = effective[key] as Record<string, unknown> | null | undefined;
      for (const [sub, item] of Object.entries(value as Record<string, unknown>))
        if (supplied(item) && !sub.endsWith("_evidence") && !supplied(inner?.[sub])) dropped.push(`${key}.${sub}`);
    } else if (!supplied(effective[key]) && !(resolvedBy[key] && supplied(effective[resolvedBy[key]]))) dropped.push(key);
  }
  return dropped;
}

type Question = { key: string; fields: readonly string[]; text: string };
type Leaf = { state: "DONE" | "READ" | "READY" | "OPEN" | "CLOSED"; question?: Question };
function missingOf(draft: unknown): string[] {
  const list = (draft as { missing_fields?: unknown } | undefined)?.missing_fields;
  return Array.isArray(list) ? list.filter((field): field is string => typeof field === "string") : [];
}
/** Sessions without an ActionPlan: each operation is its own confirmation unit. */
function leaf(ref: string, view: SecretaryView, before: TurnBaseline): Leaf {
  if (view.receipt ?? view.batch?.receipt ?? view.communication?.receipt ?? view.scheduling?.receipt ?? view.inventory?.receipt ?? view.customer?.receipt) return { state: "DONE" };
  if (readDone(view)) return { state: before.reads.has(ref) ? "DONE" : "READ" };
  if (viewProposal(view)) return { state: "READY" };
  if (view.cancelled) return { state: "CLOSED" };
  const fields = [...(view.financial?.missing_fields ?? []),
    ...[view.draft, view.batch?.draft, view.scheduling?.draft, view.customer?.draft, view.inventory?.draft, view.communication?.draft].flatMap(missingOf),
    ...(view.scheduling?.waiting_for ? [view.scheduling.waiting_for] : []),
    ...([view.candidates, view.customer?.candidates, view.communication?.candidates, view.inventory?.candidates, view.scheduling?.candidates].some(present) ? ["selection"] : [])]
    // Batch drafts prefix fields with the item key; only the field name is kept.
    .map(field => field.split(".").at(-1)!);
  return { state: "OPEN", question: { key: ref, fields: [...new Set(fields)], text: view.message } };
}

/** A thrown message whose content reached an interpreter (Luna, JEV or a deterministic fast path) was lost;
 * otherwise it was rejected before any interpretation (gate, limit, lock, infrastructure). */
export const reachedInterpretation = (trace: RouterTrace) => trace.lunaUsage.length > 0 || trace.jevCalled || trace.path === "FAST_PATH" || trace.lunaOperations > 0;
/** Classifies one outer user message after it returned (`view`) or threw (`error`). */
export function turnOutcome(s: OutcomeSession, before: TurnBaseline, trace: RouterTrace, result: { view: SecretaryView } | { error: unknown },
  memory: QuestionMemory): { outcome: TurnOutcome; fingerprints: string[] } {
  const view = "view" in result ? result.view : undefined;
  // A thrown turn is read from memory, never through view(): projection can mutate the plan (expiry).
  const plan = view ? view.action_plan : s.actionPlan;
  const changed = plan ? plan.actions.filter(action => plan.plan_ref !== before.planRef || before.actions.get(action.key) !== actionState(action)) : [];
  let kind: TurnOutcomeKind, questions: Question[] = [], groupsReady = 0, groupsTotal = 0;
  if (plan) {
    groupsTotal = plan.confirmation_groups.length;
    groupsReady = plan.confirmation_groups.filter(group => group.status === "READY_FOR_CONFIRMATION").length;
  }
  if (!view) {
    // LOST_TURN: the message reached an interpreter (Luna, JEV or a deterministic fast path) and its
    // content was discarded. ERROR: rejected before any interpretation (gate, limit, lock, infrastructure).
    kind = reachedInterpretation(trace) ? "LOST_TURN" : "ERROR";
  } else if (s.capability_status === "CONVERSATION" || s.capability_status === "UNSUPPORTED") kind = s.capability_status === "CONVERSATION" ? "CONVERSATION" : "UNSUPPORTED";
  else if (s.capability_status === "AMBIGUOUS") { kind = "QUESTION"; questions = [{ key: "", fields: ["request"], text: view.message }]; }
  else if (plan) {
    const hints = presentationHints(plan, s.actionUnits ?? [], view.operations ?? []);
    questions = conversationalClarifications(plan, hints).map(q => ({ key: q.action_key, fields: q.fields, text: q.question }));
    kind = questions.length ? "QUESTION" : groupsReady ? "PROPOSAL_READY" :
      changed.some(action => !action.mutation && action.status === "DONE") ? "READ_RESULT" :
      plan.actions.every(action => action.status === "DONE" || action.status === "DISCARDED") ? "DONE" :
      plan.actions.every(action => ["DONE", "UNSUPPORTED", "DISCARDED"].includes(action.status)) ? "UNSUPPORTED" : "ERROR";
  } else {
    const leaves = s.skill === "auto" ? (view.operations ?? []).map(operation => leaf(operation.operation_ref, operation.state, before)) : [leaf(s.id, view, before)];
    const open = leaves.filter(item => item.state !== "CLOSED");
    questions = open.flatMap(item => item.question ? [item.question] : []);
    groupsTotal = open.length; groupsReady = open.filter(item => item.state === "READY").length;
    kind = questions.length ? "QUESTION" : groupsReady ? "PROPOSAL_READY" : open.some(item => item.state === "READ") ? "READ_RESULT" :
      open.length ? "DONE" : "UNSUPPORTED";
  }
  // A discard is this turn's outcome even when questions of the remaining plan are still shown.
  if (view && trace.discardedActions > 0) kind = "DISCARDED";
  // B5: nothing of an unreadable answer was applied and the reply asked to rephrase: like a lost turn it
  // shows no new question (the caller keeps the last question actually shown as the repeat baseline).
  if (view && trace.unreadTurn) { kind = "NOT_UNDERSTOOD"; questions = []; }
  const fingerprints = questions.length ? [...new Set(questions.map(q =>
    createHmac("sha256", memory.salt()).update(`${q.key}|${q.fields.join(",")}|${q.text}`).digest("hex")))] : [];
  const planActions = plan ? changed.length : s.skill === "auto" ? Math.max(0, (s.children?.length ?? 0) - before.children) : 0;
  // Loop = a question shown again on a turn that moved nothing. A multi-action plan re-lists every open action's
  // question; after the owner answers one of them, the siblings' unchanged questions are still open, not loops.
  const repeated = planActions > 0 ? 0 : fingerprints.filter(f => memory.previous.includes(f)).length;
  const failedCodes = [...trace.failedCodes, ...changed.flatMap(action => action.status !== "DONE" && action.status !== "DISCARDED" && action.assessment.issue ? [action.assessment.issue] : [])];
  return { fingerprints, outcome: { kind, groups_ready: groupsReady, groups_total: groupsTotal,
    open_question_fields: [...new Set(questions.flatMap(q => q.fields).map(outcomeField))],
    question_fingerprints: fingerprints, repeated_question_count: repeated,
    divergence: { luna_operations: trace.lunaOperations, plan_actions: planActions, dropped_fields: [...trace.droppedFields], failed_codes: [...new Set(failedCodes)] },
    repairs: trace.literalRepairCalls, error_code: view ? null : outcomeCode((result as { error: unknown }).error),
    ...(trace.temporalShadow.length ? { temporal_shadow: trace.temporalShadow.map(entry => ({ ...entry })) } : {}),
    ...examplesOutcome(trace),
    ...(trace.nameChecks.length ? { name_checks: trace.nameChecks.map(entry => ({ ...entry })) } : {}),
    ...(trace.nameResolutions.length ? { name_resolution: trace.nameResolutions.map(entry => ({ ...entry })) } : {}),
    ...(trace.discardedActions ? { discarded_actions: trace.discardedActions } : {}),
    ...(trace.rejectedOperations ? { rejected_operations: trace.rejectedOperations } : {}),
    ...budgetOutcome(trace) } };
}
/** Request budget: requests of this message that did not fit as configured (absent when every request fit). */
function budgetOutcome(trace: RouterTrace): Pick<TurnOutcome, "request_budget"> {
  const seen = trace.budgetSeen;
  if (!seen.length) return {};
  return { request_budget: { requests: seen.length, rejected: seen.filter(entry => !entry.fit).length, steps: [...new Set(seen.flatMap(entry => entry.steps))],
    initial_bytes: Math.max(...seen.map(entry => entry.initial_bytes)), final_bytes: Math.max(...seen.map(entry => entry.final_bytes)) } };
}
/** C2: few-shot blocks of this message's interpretation requests, summed (absent when the flag is off). */
function examplesOutcome(trace: RouterTrace): Pick<TurnOutcome, "examples_mode" | "examples_requests" | "examples_count" | "examples_bytes" | "examples_eligible" | "examples_ids"> {
  const seen = trace.examplesSeen;
  if (!seen.length) return {};
  return { examples_mode: seen[0].mode, examples_requests: seen.length, examples_count: seen.reduce((n, e) => n + e.count, 0),
    examples_bytes: seen.reduce((n, e) => n + e.bytes, 0), examples_eligible: Math.max(...seen.map(e => e.eligible)), examples_ids: [...new Set(seen.flatMap(e => e.ids))].slice(0, 16) };
}
