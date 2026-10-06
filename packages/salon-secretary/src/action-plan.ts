import { createHash, randomUUID } from "node:crypto";
import { z } from "zod";
import { dependencyGraph } from "./dependency-graph";
import { composeActionPlanResponse, type PresentationHints } from "./conversational-presentation";
export { conversationalClarifications, discardNotice, discardQuestion, reviewRequiredMessage, rejectedPartsNotice, referenceWaitingNote, referenceConflictNotice, type RejectedPart, type PresentationHints, type ClarificationHint } from "./conversational-presentation";
import { operationSkill, selectionSchemaV2, validateSelectionV2, type CapabilitySelection, type SkillId, type ValidationOptions } from "./skill-registry";
import { hasReferences, preparationGraph, type SameAsReference } from "./same-as";

export type ActionStatus = "READY" | "NEEDS_INPUT" | "BLOCKED_BY_DEPENDENCY" | "DOMAIN_CONFLICT" |
  "READY_FOR_CONFIRMATION" | "UNSUPPORTED" | "FAILED_SAFE" | "DONE" | "DISCARDED";
/** DISCARDED: the owner gave up this action of the plan (never executed). Like DONE it is terminal:
 * outside readiness, confirmation groups and every later edit. */
export const terminalActionStatus = (status: string) => status === "DONE" || status === "DISCARDED";
export type ReviewPolicy = "NORMAL_REVIEW" | "ADVANCED_REVIEW" | "SPLIT_REVIEW";
/** packed: independent components bin-packed up to the maximum (library default, absent = packed).
 * component: one group per weak dependency component; a component is never split. */
export const confirmationGrouping = z.enum(["packed", "component"]);
export type ConfirmationGrouping = z.infer<typeof confirmationGrouping>;
export const reviewConfiguration = z.object({ normalReviewMax: z.number().int().positive(),
  maxActionsPerConfirmationGroup: z.number().int().positive(), grouping: confirmationGrouping.optional() }).strict().refine(
  value => value.normalReviewMax <= value.maxActionsPerConfirmationGroup, "INVALID_REVIEW_POLICY");
export const defaultReviewConfiguration = Object.freeze({ normalReviewMax: 5, maxActionsPerConfirmationGroup: 10 });
export type ReviewConfiguration = z.infer<typeof reviewConfiguration>;
/** Runtime default is per component; SALON_SECRETARY_CONFIRMATION_GROUPING=packed restores packing. */
export const runtimeConfirmationGrouping = (env: Record<string, string | undefined>) =>
  confirmationGrouping.parse(env.SALON_SECRETARY_CONFIRMATION_GROUPING || "component");
export const runtimeReviewConfiguration = (env: Record<string, string | undefined>) =>
  reviewConfiguration.parse({ ...defaultReviewConfiguration, grouping: runtimeConfirmationGrouping(env) });
export function multiActionConfiguration(env: Record<string, string | undefined>) {
  const numeric = (key: string, fallback: number) => env[key] === undefined ? fallback : Number(env[key]);
  return { enabled: env.SALON_SECRETARY_MULTI_ACTION_V2_ENABLED === "true",
    policy: reviewConfiguration.parse({
      normalReviewMax: numeric("SALON_SECRETARY_NORMAL_REVIEW_MAX", defaultReviewConfiguration.normalReviewMax),
      maxActionsPerConfirmationGroup: numeric("SALON_SECRETARY_MAX_ACTIONS_PER_CONFIRMATION_GROUP", defaultReviewConfiguration.maxActionsPerConfirmationGroup),
      grouping: runtimeConfirmationGrouping(env),
    }) };
}
export type SelectedOperation = CapabilitySelection["operations"][number];
export type ActionAssessment = { status: Exclude<ActionStatus, "BLOCKED_BY_DEPENDENCY">;
  pending_temporal_ambiguities?: {field:"source_time"|"time"|"end_time";kind:"CLOCK_DAYPART";expression:string;candidates:[string,string]}[];
  pending_calendar_conflicts?: ({field:"source_date"|"date"|"end_date";kind:"WEEKDAY_DATE_CONFLICT";expression:string;calendar_date:string;stated_weekday:number;actual_weekday:number}|{field:"source_date"|"date"|"end_date";kind:"DATE_CHOICE";expression:string;candidates:[string,string]})[];
  missing_fields: string[]; preview?: string; proposal_token?: string; issue?: string };
export type PlanAction = { key: string; skill: SkillId; operation: SelectedOperation["operation"];
  fields: Omit<SelectedOperation, "operation" | "item_key" | "depends_on" | "released_slot_of">;
  released_slot_of?: string; depends_on: string[]; missing_fields: string[];
  /** C5: data links to other actions (never execution edges). Present only when non-empty. */
  same_as?: SameAsReference[];
  provenance: { intention: "LUNA" | "JEV" | "LEGACY"; assessment: "BACKEND" };
  status: ActionStatus; assessment: ActionAssessment; blocked_by: string[]; mutation: boolean };
export type ConfirmationGroup = { key: string; action_keys: string[]; review: "NORMAL_REVIEW" | "ADVANCED_REVIEW" | "SPECIAL_REVIEW";
  status: "NEEDS_REVIEW" | "READY_FOR_CONFIRMATION" | "SPECIAL_REVIEW" | "DONE"; fingerprint: string };
export type ActionPlan = { version: 2; plan_ref: string; revision: number; actions: PlanAction[];
  dependencies: { from: string; to: string }[]; confirmation_groups: ConfirmationGroup[];
  execution_order: string[]; policy: ReviewConfiguration; review: ReviewPolicy;
  status: "NEEDS_INPUT" | "READY_FOR_CONFIRMATION" | "PARTIAL_FAILURE" | "DONE" | "READY" };
const reads = new Set<SelectedOperation["operation"]>(["financial.report", "product.search", "stock.balance",
  "customer.search", "customer.read", "appointment.list", "appointment.read", "availability.get"]);
export const isMutationOperation = (operation: SelectedOperation["operation"]) => !reads.has(operation);
function canonical(value: unknown): unknown {
  if (Array.isArray(value)) return value.map(canonical);
  if (value && typeof value === "object") return Object.fromEntries(Object.entries(value)
    .filter(([, item]) => item !== undefined).sort(([a], [b]) => a.localeCompare(b)).map(([key, item]) => [key, canonical(item)]));
  return value;
}
const hash = (value: unknown) => createHash("sha256").update(JSON.stringify(canonical(value))).digest("hex");
/** What an approval binds of each member: everything except the derived status/blocked_by. */
const approvedAction = ({ status: _status, blocked_by: _blocked, ...action }: PlanAction) => { void _status; void _blocked; return action; };

/** `references` (C5, ADD): active plan actions this selection's same_as may name. */
export function createActionPlan(input: unknown, policy: ReviewConfiguration = defaultReviewConfiguration, provenance: "LUNA" | "JEV" | "LEGACY" = "LUNA",
  references?: ValidationOptions["references"]): ActionPlan {
  const selection = validateSelectionV2(input, references ? { references } : {});
  const actions: PlanAction[] = selection.operations.map(op => {
    const { operation, item_key, depends_on, released_slot_of, same_as, ...fields } = op;
    return { key: item_key!, skill: operationSkill(operation), operation, fields,
      ...(released_slot_of ? { released_slot_of } : {}), depends_on, ...(same_as?.length ? { same_as } : {}), missing_fields: [],
      provenance: { intention: provenance, assessment: "BACKEND" }, mutation: isMutationOperation(operation),
      status: "READY", assessment: { status: "READY", missing_fields: [] }, blocked_by: [] };
  });
  return refreshActionPlan({ version: 2, plan_ref: randomUUID(), revision: 1, actions, dependencies: [],
    confirmation_groups: [], execution_order: [], policy: reviewConfiguration.parse(policy), review: "NORMAL_REVIEW", status: "READY" });
}
export function actionSelection(action: PlanAction): SelectedOperation {
  return { ...action.fields, operation: action.operation, item_key: action.key,
    depends_on: action.depends_on, released_slot_of: action.released_slot_of ?? null, ...(action.same_as?.length ? { same_as: action.same_as } : {}) };
}

/** Recompute all derived fields. No input from the interpreter can mark an action confirmed. */
export function refreshActionPlan(plan: ActionPlan): ActionPlan {
  // C5: with data links, order and components follow the preparation graph (execution edges plus references): a
  // referenced action is prepared first and linked actions share one confirmation group. Execution still waits only
  // on depends_on (blocked_by, failures). Without references both graphs are the same.
  const graph = hasReferences(plan.actions) ? preparationGraph(plan.actions) : dependencyGraph(plan.actions), byKey = new Map(plan.actions.map(action => [action.key, action]));
  plan.execution_order = graph.order;
  plan.dependencies = plan.actions.flatMap(action => action.depends_on.map(from => ({ from, to: action.key })));
  for (const key of graph.order) {
    const action = byKey.get(key)!;
    if (action.assessment.status === "DISCARDED") { action.missing_fields = []; action.blocked_by = []; action.status = "DISCARDED"; continue; }
    action.missing_fields = [...new Set(action.assessment.missing_fields)];
    action.blocked_by = action.depends_on.filter(parent => byKey.get(parent)!.status !== "DONE");
    const failure = action.depends_on.some(parent => ["FAILED_SAFE", "UNSUPPORTED", "DOMAIN_CONFLICT", "BLOCKED_BY_DEPENDENCY", "DISCARDED"].includes(byKey.get(parent)!.status));
    action.status = action.assessment.status === "DONE" ? "DONE" : failure ? "BLOCKED_BY_DEPENDENCY" :
      action.missing_fields.length ? "NEEDS_INPUT" : action.assessment.status;
  }
  // Discarded actions leave review sizing and every confirmation group (their components shrink).
  const live = plan.actions.filter(action => action.status !== "DISCARDED"), kept = (keys: Iterable<string>) => [...keys].filter(key => byKey.get(key)!.status !== "DISCARDED");
  const size = live.length, { normalReviewMax, maxActionsPerConfirmationGroup: maximum } = plan.policy;
  plan.review = size > maximum ? "SPLIT_REVIEW" : size > normalReviewMax ? "ADVANCED_REVIEW" : "NORMAL_REVIEW";
  const groups: string[][] = [], components = graph.components.map(kept).filter(component => component.length);
  // Per component, an independent action never waits for another's missing field; an
  // oversized component stays one SPECIAL_REVIEW group (atomic pairs are one component).
  if (plan.policy.grouping === "component") groups.push(...components);
  else {
    let current: string[] = [];
    for (const component of components) {
      if (component.length > maximum) {
        if (current.length) groups.push(current);
        groups.push(component); current = []; continue;
      }
      if (current.length + component.length > maximum) { groups.push(current); current = []; }
      current.push(...component);
    }
    if (current.length) groups.push(current);
  }
  plan.confirmation_groups = groups.map((keys, index) => {
    const actions = keys.map(key => byKey.get(key)!);
    const special = keys.length > maximum;
    const done = actions.every(action => action.status === "DONE");
    const ready = actions.every(action => action.status === "DONE" || !action.mutation && action.status === "READY" || action.status === "READY_FOR_CONFIRMATION" &&
      Boolean(action.assessment.proposal_token) && Boolean(action.assessment.preview));
    return { key: `group_${index + 1}`, action_keys: keys,
      review: special ? "SPECIAL_REVIEW" : keys.length > normalReviewMax ? "ADVANCED_REVIEW" : "NORMAL_REVIEW",
      status: done ? "DONE" : special ? "SPECIAL_REVIEW" : ready ? "READY_FOR_CONFIRMATION" : "NEEDS_REVIEW",
      fingerprint: hash({ plan_ref: plan.plan_ref, revision: plan.revision, policy: plan.policy, actions: actions.map(approvedAction) }),
    };
  });
  plan.status = live.every(action => action.status === "DONE") ? "DONE" :
    live.some(action => ["FAILED_SAFE", "DOMAIN_CONFLICT", "UNSUPPORTED"].includes(action.status)) ? "PARTIAL_FAILURE" :
    live.some(action => action.missing_fields.length) ? "NEEDS_INPUT" :
    plan.confirmation_groups.every(group => group.status === "READY_FOR_CONFIRMATION" || group.status === "DONE") ? "READY_FOR_CONFIRMATION" : "READY";
  return plan;
}

export function assessPlanAction(plan: ActionPlan, key: string, assessment: ActionAssessment): ActionPlan {
  const next = structuredClone(plan), action = next.actions.find(item => item.key === key);
  if (!action) throw Error("ACTION_NOT_FOUND");
  // Only trusted backend adapters call this function. No client assessment API is exposed.
  if (action.assessment.status === "DONE" && assessment.status !== "DONE") throw Error("ALREADY_CONFIRMED");
  // A discard is final: no adapter projection may bring the action back to the plan.
  if (action.assessment.status === "DISCARDED" && assessment.status !== "DISCARDED") throw Error("ACTION_DISCARDED");
  if (hash(action.assessment) !== hash(assessment)) next.revision++;
  action.assessment = structuredClone(assessment);
  return refreshActionPlan(next);
}

/** Patch one action's linguistic fields; dependencies and siblings survive. Re-assessment is required. */
export function patchPlanAction(plan: ActionPlan, key: string, fields: unknown): ActionPlan {
  const next = structuredClone(plan), action = next.actions.find(item => item.key === key);
  if (!action) throw Error("ACTION_NOT_FOUND");
  if (action.status === "DONE") throw Error("ALREADY_CONFIRMED");
  if (action.status === "DISCARDED") throw Error("ACTION_DISCARDED");
  const patch = selectionSchemaV2.shape.operations.element.omit({ operation: true, item_key: true,
    depends_on: true, released_slot_of: true, same_as: true }).partial().parse(fields);
  const merged = { ...action.fields, ...Object.fromEntries(Object.entries(patch).filter(([, value]) => value != null)) };
  // Evidence belongs to this turn only. A linguistic patch cannot reuse stale
  // quotations from an earlier message when the next adapter grounds it.
  if (patch.temporal_evidence == null) delete merged.temporal_evidence;
  if (patch.source_scope == null) delete merged.source_scope;
  // Nested financial/inventory/communication patches also preserve fields omitted in a continuation.
  for (const field of ["financial", "inventory", "communication"] as const) {
    if (patch[field] && typeof patch[field] === "object" && !Array.isArray(patch[field]))
      merged[field] = { ...action.fields[field], ...Object.fromEntries(Object.entries(patch[field] as object).filter(([, value]) => value != null)) };
  }
  if(merged.inventory&&patch.inventory?.quantity_evidence==null)delete merged.inventory.quantity_evidence;
  if(merged.inventory&&patch.inventory?.reference==null)delete merged.inventory.reference;
  action.fields = merged;
  const checked = validateSelectionV2({ skills: [...new Set(next.actions.map(item => item.skill))],
    independent: !next.dependencies.length, operations: next.actions.map(actionSelection) });
  const { operation: _operation, item_key: _key, depends_on: _deps, released_slot_of: _released, ...validFields } = checked.operations.find(op => op.item_key === key)!;
  void _operation; void _key; void _deps; void _released;
  action.fields = validFields;
  if (hash(action.fields) === hash(plan.actions.find(item => item.key === key)!.fields)) return plan;
  next.revision++;
  // A referenced action's patch also re-derives the actions that follow its values (C5).
  const graph = hasReferences(next.actions) ? preparationGraph(next.actions) : dependencyGraph(next.actions), dirty = new Set([key]), queue = [key];
  for (let cursor = 0; cursor < queue.length; cursor++) for (const child of graph.children.get(queue[cursor])!)
    if (!dirty.has(child)) { dirty.add(child); queue.push(child); }
  for (const item of next.actions) if (dirty.has(item.key) && !terminalActionStatus(item.status))
    item.assessment = { status: "READY", missing_fields: [] };
  return refreshActionPlan(next);
}

export function minimumClarifications(plan: ActionPlan) {
  return plan.actions.filter(action => !terminalActionStatus(action.status) && action.missing_fields.length)
    .map(action => ({ action_key: action.key, fields: [...action.missing_fields] }));
}
export function actionPlanPreview(plan: ActionPlan, hints: PresentationHints = {}) {
  return composeActionPlanResponse(plan, hints);
}

export const groupConfirmationInput = z.object({ plan_ref: z.string().uuid(), revision: z.number().int().positive(),
  group_key: z.string(), fingerprint: z.string().regex(/^[a-f0-9]{64}$/) }).strict();
export type GroupApproval = z.infer<typeof groupConfirmationInput>;
/** "Confirm everything that is ready": several explicit group approvals, each a normal group token. */
export const readyGroupsConfirmationInput = z.array(groupConfirmationInput).min(1).max(256);

/** Approval identity of a group without the plan revision: plan, policy, members (minus derived
 * status/blocked_by, so including proposal tokens). Unchanged while other groups execute. */
export function confirmationGroupContent(plan: ActionPlan, keys: readonly string[]) {
  const byKey = new Map(plan.actions.map(action => [action.key, action]));
  return hash({ plan_ref: plan.plan_ref, policy: plan.policy, action_keys: [...keys],
    actions: keys.map(key => byKey.has(key) ? approvedAction(byKey.get(key)!) : null) });
}
/** All-or-nothing admission of several approvals against ONE current plan; nothing executes here.
 * Any mismatch (plan, revision, group, fingerprint or a group not READY_FOR_CONFIRMATION) rejects
 * the whole batch. Admitted groups come back in execution order with their content snapshot. */
export function admitConfirmationBatch(plan: ActionPlan, approvals: readonly GroupApproval[]) {
  const current = refreshActionPlan(structuredClone(plan)), rank = new Map(current.execution_order.map((key, index) => [key, index]));
  if (new Set(approvals.map(approval => approval.group_key)).size !== approvals.length) throw Error("CONFIRMATION_BATCH_INVALID");
  return approvals.map(approval => {
    const group = current.confirmation_groups.find(item => item.key === approval.group_key);
    if (approval.plan_ref !== current.plan_ref || approval.revision !== current.revision || !group || group.fingerprint !== approval.fingerprint ||
      group.status !== "READY_FOR_CONFIRMATION") throw Error("CONFIRMATION_STALE");
    return { approval, action_keys: [...group.action_keys], content: confirmationGroupContent(current, group.action_keys),
      order: Math.min(...group.action_keys.map(key => rank.get(key)!)) };
  }).sort((a, b) => a.order - b.order).map(({ order: _order, ...item }) => { void _order; return item; });
}

/** Backend orchestration; callback must reuse authenticated/idempotent domain executors.
 * The caller holds its session lock. No implicit confirmation, retry, or model call. */
export async function executeConfirmationGroup(plan: ActionPlan, input: unknown,
  execute: (action: PlanAction) => Promise<ActionAssessment>) {
  const approval = groupConfirmationInput.parse(input);
  const next = refreshActionPlan(structuredClone(plan));
  const group = next.confirmation_groups.find(item => item.key === approval.group_key);
  if (approval.plan_ref !== next.plan_ref || approval.revision !== next.revision || !group || group.fingerprint !== approval.fingerprint)
    throw Error("CONFIRMATION_STALE");
  if (group.status === "DONE") return next;
  if (group.status !== "READY_FOR_CONFIRMATION") throw Error(group.status === "SPECIAL_REVIEW" ? "SPECIAL_REVIEW_REQUIRED" : "PLAN_NOT_READY");
  const members = new Set(group.action_keys), byKey = new Map(next.actions.map(action => [action.key, action]));
  for (const key of next.execution_order) {
    const action = byKey.get(key)!;
    if (!members.has(key) || terminalActionStatus(action.status)) continue;
    if (action.depends_on.some(parent => byKey.get(parent)!.status !== "DONE")) {
      action.status = "BLOCKED_BY_DEPENDENCY"; continue;
    }
    try {
      const outcome = await execute(structuredClone(action));
      action.assessment = outcome.status === "DONE" ? outcome : { ...outcome, status: "FAILED_SAFE" };
    } catch { action.assessment = { status: "FAILED_SAFE", missing_fields: [], issue: "BACKEND_EXECUTION_FAILED" }; }
    action.status = action.assessment.status;
  }
  // Keep the approved revision for replay. Result hashes/statuses change; no stale approval executes new work.
  return refreshActionPlan(next);
}
