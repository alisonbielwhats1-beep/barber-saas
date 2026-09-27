import { createHash, randomUUID } from "node:crypto";
import { z } from "zod";
import { dependencyGraph } from "./dependency-graph";
import { composeActionPlanResponse, type PresentationHints } from "./conversational-presentation";
export { conversationalClarifications, type PresentationHints, type ClarificationHint } from "./conversational-presentation";
import { operationSkill, selectionSchemaV2, validateSelectionV2, type CapabilitySelection, type SkillId } from "./skill-registry";

export type ActionStatus = "READY" | "NEEDS_INPUT" | "BLOCKED_BY_DEPENDENCY" | "DOMAIN_CONFLICT" |
  "READY_FOR_CONFIRMATION" | "UNSUPPORTED" | "FAILED_SAFE" | "DONE";
export type ReviewPolicy = "NORMAL_REVIEW" | "ADVANCED_REVIEW" | "SPLIT_REVIEW";
export const reviewConfiguration = z.object({ normalReviewMax: z.number().int().positive(),
  maxActionsPerConfirmationGroup: z.number().int().positive() }).strict().refine(
  value => value.normalReviewMax <= value.maxActionsPerConfirmationGroup, "INVALID_REVIEW_POLICY");
export const defaultReviewConfiguration = Object.freeze({ normalReviewMax: 5, maxActionsPerConfirmationGroup: 10 });
export type ReviewConfiguration = z.infer<typeof reviewConfiguration>;
export function multiActionConfiguration(env: Record<string, string | undefined>) {
  const numeric = (key: string, fallback: number) => env[key] === undefined ? fallback : Number(env[key]);
  return { enabled: env.SALON_SECRETARY_MULTI_ACTION_V2_ENABLED === "true",
    policy: reviewConfiguration.parse({
      normalReviewMax: numeric("SALON_SECRETARY_NORMAL_REVIEW_MAX", defaultReviewConfiguration.normalReviewMax),
      maxActionsPerConfirmationGroup: numeric("SALON_SECRETARY_MAX_ACTIONS_PER_CONFIRMATION_GROUP", defaultReviewConfiguration.maxActionsPerConfirmationGroup),
    }) };
}
export type SelectedOperation = CapabilitySelection["operations"][number];
export type ActionAssessment = { status: Exclude<ActionStatus, "BLOCKED_BY_DEPENDENCY">;
  pending_temporal_ambiguities?: {field:"source_time"|"time"|"end_time";kind:"CLOCK_DAYPART";expression:string;candidates:[string,string]}[];
  pending_calendar_conflicts?: {field:"source_date"|"date"|"end_date";kind:"WEEKDAY_DATE_CONFLICT";expression:string;calendar_date:string;stated_weekday:number;actual_weekday:number}[];
  missing_fields: string[]; preview?: string; proposal_token?: string; issue?: string };
export type PlanAction = { key: string; skill: SkillId; operation: SelectedOperation["operation"];
  fields: Omit<SelectedOperation, "operation" | "item_key" | "depends_on" | "released_slot_of">;
  released_slot_of?: string; depends_on: string[]; missing_fields: string[];
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

export function createActionPlan(input: unknown, policy: ReviewConfiguration = defaultReviewConfiguration, provenance: "LUNA" | "JEV" | "LEGACY" = "LUNA"): ActionPlan {
  const selection = validateSelectionV2(input);
  const actions: PlanAction[] = selection.operations.map(op => {
    const { operation, item_key, depends_on, released_slot_of, ...fields } = op;
    return { key: item_key!, skill: operationSkill(operation), operation, fields,
      ...(released_slot_of ? { released_slot_of } : {}), depends_on, missing_fields: [],
      provenance: { intention: provenance, assessment: "BACKEND" }, mutation: isMutationOperation(operation),
      status: "READY", assessment: { status: "READY", missing_fields: [] }, blocked_by: [] };
  });
  return refreshActionPlan({ version: 2, plan_ref: randomUUID(), revision: 1, actions, dependencies: [],
    confirmation_groups: [], execution_order: [], policy: reviewConfiguration.parse(policy), review: "NORMAL_REVIEW", status: "READY" });
}
export function actionSelection(action: PlanAction): SelectedOperation {
  return { ...action.fields, operation: action.operation, item_key: action.key,
    depends_on: action.depends_on, released_slot_of: action.released_slot_of ?? null };
}

/** Recompute all derived fields. No input from the interpreter can mark an action confirmed. */
export function refreshActionPlan(plan: ActionPlan): ActionPlan {
  const graph = dependencyGraph(plan.actions), byKey = new Map(plan.actions.map(action => [action.key, action]));
  plan.execution_order = graph.order;
  plan.dependencies = plan.actions.flatMap(action => action.depends_on.map(from => ({ from, to: action.key })));
  for (const key of graph.order) {
    const action = byKey.get(key)!;
    action.missing_fields = [...new Set(action.assessment.missing_fields)];
    action.blocked_by = action.depends_on.filter(parent => byKey.get(parent)!.status !== "DONE");
    const failure = action.depends_on.some(parent => ["FAILED_SAFE", "UNSUPPORTED", "DOMAIN_CONFLICT", "BLOCKED_BY_DEPENDENCY"].includes(byKey.get(parent)!.status));
    action.status = action.assessment.status === "DONE" ? "DONE" : failure ? "BLOCKED_BY_DEPENDENCY" :
      action.missing_fields.length ? "NEEDS_INPUT" : action.assessment.status;
  }
  const size = plan.actions.length, { normalReviewMax, maxActionsPerConfirmationGroup: maximum } = plan.policy;
  plan.review = size > maximum ? "SPLIT_REVIEW" : size > normalReviewMax ? "ADVANCED_REVIEW" : "NORMAL_REVIEW";
  const groups: string[][] = [];
  let current: string[] = [];
  for (const component of graph.components) {
    if (component.length > maximum) {
      if (current.length) groups.push(current);
      groups.push(component); current = []; continue;
    }
    if (current.length + component.length > maximum) { groups.push(current); current = []; }
    current.push(...component);
  }
  if (current.length) groups.push(current);
  plan.confirmation_groups = groups.map((keys, index) => {
    const actions = keys.map(key => byKey.get(key)!);
    const special = keys.length > maximum;
    const done = actions.every(action => action.status === "DONE");
    const ready = actions.every(action => action.status === "DONE" || !action.mutation && action.status === "READY" || action.status === "READY_FOR_CONFIRMATION" &&
      Boolean(action.assessment.proposal_token) && Boolean(action.assessment.preview));
    return { key: `group_${index + 1}`, action_keys: keys,
      review: special ? "SPECIAL_REVIEW" : keys.length > normalReviewMax ? "ADVANCED_REVIEW" : "NORMAL_REVIEW",
      status: done ? "DONE" : special ? "SPECIAL_REVIEW" : ready ? "READY_FOR_CONFIRMATION" : "NEEDS_REVIEW",
      fingerprint: hash({ plan_ref: plan.plan_ref, revision: plan.revision, policy: plan.policy,
        actions: actions.map(({ status: _status, blocked_by: _blocked, ...action }) => { void _status; void _blocked; return action; }) }),
    };
  });
  plan.status = plan.actions.every(action => action.status === "DONE") ? "DONE" :
    plan.actions.some(action => ["FAILED_SAFE", "DOMAIN_CONFLICT", "UNSUPPORTED"].includes(action.status)) ? "PARTIAL_FAILURE" :
    plan.actions.some(action => action.missing_fields.length) ? "NEEDS_INPUT" :
    plan.confirmation_groups.every(group => group.status === "READY_FOR_CONFIRMATION" || group.status === "DONE") ? "READY_FOR_CONFIRMATION" : "READY";
  return plan;
}

export function assessPlanAction(plan: ActionPlan, key: string, assessment: ActionAssessment): ActionPlan {
  const next = structuredClone(plan), action = next.actions.find(item => item.key === key);
  if (!action) throw Error("ACTION_NOT_FOUND");
  // Only trusted backend adapters call this function. No client assessment API is exposed.
  if (action.assessment.status === "DONE" && assessment.status !== "DONE") throw Error("ALREADY_CONFIRMED");
  if (hash(action.assessment) !== hash(assessment)) next.revision++;
  action.assessment = structuredClone(assessment);
  return refreshActionPlan(next);
}

/** Patch one action's linguistic fields; dependencies and siblings survive. Re-assessment is required. */
export function patchPlanAction(plan: ActionPlan, key: string, fields: unknown): ActionPlan {
  const next = structuredClone(plan), action = next.actions.find(item => item.key === key);
  if (!action) throw Error("ACTION_NOT_FOUND");
  if (action.status === "DONE") throw Error("ALREADY_CONFIRMED");
  const patch = selectionSchemaV2.shape.operations.element.omit({ operation: true, item_key: true,
    depends_on: true, released_slot_of: true }).partial().parse(fields);
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
  const graph = dependencyGraph(next.actions), dirty = new Set([key]), queue = [key];
  for (let cursor = 0; cursor < queue.length; cursor++) for (const child of graph.children.get(queue[cursor])!)
    if (!dirty.has(child)) { dirty.add(child); queue.push(child); }
  for (const item of next.actions) if (dirty.has(item.key) && item.status !== "DONE")
    item.assessment = { status: "READY", missing_fields: [] };
  return refreshActionPlan(next);
}

export function minimumClarifications(plan: ActionPlan) {
  return plan.actions.filter(action => action.status !== "DONE" && action.missing_fields.length)
    .map(action => ({ action_key: action.key, fields: [...action.missing_fields] }));
}
export function actionPlanPreview(plan: ActionPlan, hints: PresentationHints = {}) {
  return composeActionPlanResponse(plan, hints);
}

export const groupConfirmationInput = z.object({ plan_ref: z.string().uuid(), revision: z.number().int().positive(),
  group_key: z.string(), fingerprint: z.string().regex(/^[a-f0-9]{64}$/) }).strict();

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
    if (!members.has(key) || action.status === "DONE") continue;
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
