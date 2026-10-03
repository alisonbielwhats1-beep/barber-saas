import { type ActionPlan, type ActionAssessment, type PlanAction, type CapabilitySelection,
  actionSelection, selectionSchemaV2, schedulingFields, alterationKeys, multiServiceKeys, referencesV2Enabled, cancelReasonOptionalEnabled } from "@everflair/salon-secretary";
import type { SecretaryView } from "./salon-secretary";
import { readDayOptional } from "./scheduling-contract";

export type ActionUnit = { keys: string[]; kind: "single" | "scheduling-batch" | "cancellation-message" | "unsupported"; child?: string };
/** Atomic domain adapters remain intact. Other edges express ordering, never implicit data bindings. */
export function actionUnits(plan: ActionPlan): ActionUnit[] {
  const consumed = new Set<string>(), units: ActionUnit[] = [];
  for (const key of plan.execution_order) {
    if (consumed.has(key)) continue;
    const action = plan.actions.find(item => item.key === key)!;
    const releases = plan.actions.filter(item => item.released_slot_of === key);
    const messages = plan.actions.filter(item => item.operation === "customer.message" && item.depends_on.includes(key));
    // D1 (flag SALON_SECRETARY_REFERENCES_V2): a reschedule and the create in its origin are two single units (the create
    // depends_on the change: same group, sequential, never the atomic batch); the create's own iteration makes it single.
    const origin = referencesV2Enabled() && action.operation === "appointment.change" && releases.length === 1 &&
      releases[0].operation === "appointment.create" && releases[0].depends_on.includes(key);
    if (origin) { units.push({ keys: [key], kind: "single" }); consumed.add(key); }
    else if (releases.length) {
      const keys = [key, ...releases.map(item => item.key)];
      const safe = action.operation === "appointment.cancel" && !action.depends_on.length && releases.length === 1 && releases[0].depends_on.length === 1;
      units.push({ keys, kind: safe ? "scheduling-batch" : "unsupported" });
      keys.forEach(item => consumed.add(item));
    } else if (action.operation === "appointment.cancel" && !action.depends_on.length && messages.length === 1 && messages[0].depends_on.length === 1) {
      const keys = [key, messages[0].key]; units.push({ keys, kind: "cancellation-message" }); keys.forEach(item => consumed.add(item));
    } else { units.push({ keys: [key], kind: "single" }); consumed.add(key); }
  }
  return units;
}
export function unitSelection(plan: ActionPlan, unit: ActionUnit): CapabilitySelection {
  const actions = unit.keys.map(key => plan.actions.find(item => item.key === key)!);
  return { skills: [...new Set(actions.map(action => action.skill))], independent: unit.kind === "single",
    operations: actions.map(action => ({ ...actionSelection(action),
      depends_on: action.depends_on.filter(key => unit.keys.includes(key)) })) };
}
export function viewProposal(view: SecretaryView) {
  return view.proposal ?? view.batch?.proposal ?? view.communication?.proposal ?? view.scheduling?.proposal ?? view.inventory?.proposal ?? view.customer?.proposal;
}
export function deferredReadAssessment(action: PlanAction): ActionAssessment {
  const missing: string[] = [], fields = action.fields as Record<string, unknown>;
  if (action.skill === "financial") {
    const financial = action.fields.financial;
    if (!financial?.period && !(financial?.metrics?.length === 1 && financial.metrics[0] === "outstanding_receivables")) missing.push("period");
  } else if (action.operation === "stock.balance" && !action.fields.inventory?.product_name) missing.push("product_name");
  else if (action.skill === "customers" && !action.fields.target_name) missing.push("target_name");
  else if (action.skill === "scheduling") {
    // P3b (flag SALON_SECRETARY_READS_V2): a read of one customer with no day, clock or period is that customer's next appointments.
    if (fields.date == null && fields.day_offset == null && fields.weekday == null && !readDayOptional(action.operation, fields)) missing.push("date");
    if (action.operation === "availability.get" && !fields.service_name && !fields.service_names) missing.push("service_name");
  }
  return { status: missing.length ? "NEEDS_INPUT" : "READY", missing_fields: missing, preview: deferredReadPreview(action) };
}
/** B7: a read that waits for other actions, said to the owner (never keys or raw fields). */
export const deferredReadPreview = (action: Pick<PlanAction, "depends_on">) =>
  `Esta consulta será feita depois ${action.depends_on.length > 1 ? "das ações anteriores" : "da ação anterior"}; o resultado aparece aqui.`;
export function assessmentFromView(view: SecretaryView, action: PlanAction): ActionAssessment {
  const draft = view.draft ?? view.batch?.draft ?? view.communication?.draft ?? view.scheduling?.draft ?? view.inventory?.draft ?? view.customer?.draft;
  const proposal = viewProposal(view);
  const receipt = view.receipt ?? view.batch?.receipt ?? view.communication?.receipt ?? view.scheduling?.receipt ?? view.inventory?.receipt ?? view.customer?.receipt;
  const preview = view.message;
  if(view.proposal_expired&&!receipt)return {status:"NEEDS_INPUT",missing_fields:[],preview:view.message,issue:"PROPOSAL_EXPIRED"};
  if (receipt || view.financial?.status === "DONE" || view.inventory?.status === "DONE" ||
    !action.mutation && (view.customer?.customer || view.customer?.operation === "customer.search" && view.customer.candidates || view.scheduling?.appointments ||
      view.scheduling?.operation === "availability.get" && view.scheduling.alternatives)) return { status: "DONE", missing_fields: [], preview };
  if (proposal) return { status: "READY_FOR_CONFIRMATION", missing_fields: [], preview,
    proposal_token: `${proposal.proposal_ref}:${proposal.draft_revision}:${proposal.payload_hash}` };
  if (view.communication?.cancel && action.operation === "appointment.cancel") return assessmentFromView({
    sessionId: view.sessionId, cancelled: view.cancelled, message: view.communication.cancel.message, scheduling: view.communication.cancel }, action);
  let missing: string[] = [...(view.financial?.missing_fields ?? draft?.missing_fields ?? [])];
  if (view.batch) {
    missing = missing.filter(field => field.startsWith(`${action.key}.`)).map(field => field.slice(action.key.length + 1));
    const item = view.batch.plan.items.find(item => item.key === action.key)!;
    // The legacy assessor stops at the first missing item. Preserve the other item's explicit omissions too.
    for (const field of item.operation === "appointment.create" ? ["customer_name", "service_name"] as const
      : cancelReasonOptionalEnabled() ? ["customer_name"] as const : ["customer_name", "reason"] as const)
      if (!item.fields[field]) missing.push(field);
  }
  if (view.communication?.cancel && action.operation === "customer.message") {
    missing = ["channel", "message_mode", "content"].filter(field => !view.communication!.fields[field as keyof typeof view.communication.fields]);
  }
  if (view.scheduling?.waiting_for) missing.push(view.scheduling.waiting_for);
  if (view.customer?.candidates || view.candidates || view.communication?.candidates || view.inventory?.candidates?.length || view.scheduling?.candidates) missing.push("selection");
  if (view.inventory && !view.inventory.target && !view.inventory.candidates?.length) missing.push("product_name");
  if (view.communication && !view.communication.target && !view.communication.cancel) missing.push("recipient_name");
  if (view.customer && !view.customer.target && action.operation !== "customer.create" && !missing.length) missing.push("target_name");
  // C5: an action that only waits for another action's value lacks exactly those fields (a stale copy is not usable).
  const references = view.scheduling?.references ?? view.communication?.references;
  if (references?.blocked) missing.push(...(references.waiting ?? []).map(field => field === "professional" ? "professional_ref" : field === "customer" ? view.communication ? "recipient_name" : "customer_ref" : field));
  if (view.batch?.draft?.status === "BLOCKED" || view.scheduling?.alternatives && action.mutation && !missing.length)
    return { status: "DOMAIN_CONFLICT", missing_fields: [], preview, issue: "DOMAIN_CONFLICT" };
  const pending=view.scheduling?.pending_temporal_ambiguities??view.scheduling?.draft?.pending_temporal_ambiguities??view.batch?.plan.items.find(item=>item.key===action.key)?.pending_temporal_ambiguities;
  const calendar=view.scheduling?.pending_calendar_conflicts??view.scheduling?.draft?.pending_calendar_conflicts??view.batch?.plan.items.find(item=>item.key===action.key)?.pending_calendar_conflicts;
  if (pending?.length)missing.push(...pending.map(item=>item.field));
  if (calendar?.length)missing.push(...calendar.map(item=>item.field));
  if (missing.length) return { status: "NEEDS_INPUT", missing_fields: [...new Set(missing)], preview,...(pending?.length?{pending_temporal_ambiguities:pending}:{}),...(calendar?.length?{pending_calendar_conflicts:calendar}:{}) };
  // A sibling in an atomic adapter can be complete while the other is collecting fields.
  if (view.batch || view.communication?.cancel || view.scheduling?.proposal_deferred && view.scheduling.draft?.status === "READY") return { status: "READY", missing_fields: [], preview };
  return { status: "NEEDS_INPUT", missing_fields: ["details"], preview };
}

/** Keep collected linguistic fields in the same plan; domain refs remain in domain drafts only. */
export function collectedActionFields(view: SecretaryView, action: PlanAction) {
  let fields: Record<string, unknown> = {};
  if (view.batch) fields = view.batch.plan.items.find(item => item.key === action.key)?.fields ?? {};
  else if (view.scheduling) fields = view.scheduling.fields;
  else if (view.communication?.cancel && action.operation === "appointment.cancel") fields = view.communication.cancel.fields;
  else if (view.communication) fields = { communication: { ...view.communication.fields, recipient_name: view.communication.query } };
  else if (view.financial) fields = { financial: view.financial.fields };
  else if (view.inventory) fields = { inventory: { ...view.inventory.fields, product_name: view.inventory.query, low_stock: view.inventory.low_stock } };
  else if (view.customer) fields = { ...view.customer.patch, target_name: view.customer.query ?? null,
    requested_fields: view.customer.operation === "customer.read" || view.customer.operation === "customer.search" ? view.customer.read_fields ?? [] : view.customer.requested, clear_fields: (["phone", "email"] as const).filter(key => view.customer!.patch[key] === null) };
  else if (view.service_context) fields = {...view.service_context.fields,target_name:view.service_context.target_name??null};
  else if (view.draft) fields = view.draft.fields;
  const schema = selectionSchemaV2.shape.operations.element.omit({ operation: true, item_key: true, depends_on: true, released_slot_of: true, same_as: true });
  const allowed = new Set(Object.keys(schema.shape));
  // Scheduling adapters expose the complete effective state, not a patch. An
  // absent/rejected value must not reappear from the earlier model selection.
  const authoritative = Boolean(view.batch || view.scheduling || view.communication?.cancel && action.operation === "appointment.cancel");
  // Adapters expose complete effective state. Neutral transport defaults are not
  // historic intention: null customer values represent explicit deletion.
  const neutral = Object.fromEntries(Object.keys(schema.shape).map(key => [key, key === "requested_fields" || key === "clear_fields" ? [] : null]));
  const merged: Record<string, unknown> = { ...neutral, ...Object.fromEntries(Object.entries(fields).filter(([key]) => allowed.has(key))) };
  // Services retain the accepted lookup label, which is absent from draft.fields.
  if (view.draft && !view.service_context && action.operation === "service.change") merged.target_name = action.fields.target_name;
  if (authoritative) for (const key of Object.keys(schedulingFields)) if (fields[key] == null) delete merged[key];
  // P2a: an alteration's words appear only while the action holds them (never a neutral slot; its refs stay in the draft).
  for (const key of alterationKeys) if (fields[key] == null) delete merged[key];
  // P2b: likewise a service list (only while the action holds one; its refs stay in the draft).
  for (const key of multiServiceKeys) if (fields[key] == null) delete merged[key];
  // These decisions are invalidated by the domain adapter on material changes.
  // Do not resurrect cleared consent/reason from an older presentation snapshot.
  if(view.batch||view.scheduling)for(const key of ["destination_mode","override_requested","override_reason"])
    if(!Object.hasOwn(fields,key))delete merged[key];
  for (const [absolute, relative, weekday] of [["date", "day_offset", "weekday"], ["source_date", "source_day_offset", "source_weekday"]]) {
    if (fields[absolute]) { delete merged[relative]; delete merged[weekday]; }
  }
  delete merged.temporal_evidence; // Per-turn validation metadata is never effective ERP state.
  delete merged.temporal_negative_context;
  delete merged.source_scope;
  return schema.parse(merged);
}
