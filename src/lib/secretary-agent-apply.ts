import { terminalActionStatus, validateSelectionV2, type CapabilitySelection } from "@everflair/salon-secretary";
import type { ServiceActor } from "./service-catalog";
import { withTenant } from "./prisma-tenant";
import { schedulingResolved, type SchedulingFields } from "./scheduling-contract";
import { prepareResolvedScheduling, type AgentResolvedExtras, type SchedulingReferences, type SchedulingState } from "./secretary-scheduling";
import { prepareBatch, type BatchState } from "./secretary-batch";
import { validateBatchPlan } from "./scheduling-batch";
import { createAgentLookupExecutor, agentLookupTelemetry, type AgentPreloadTelemetry } from "./secretary-agent-lookups";
import { AGENT_NOTHING_CHANGED, AGENT_QUESTIONS, agentBasisPrecondition, agentDerivedCheck, agentFactReader, agentGroupBasisPrecheck,
  type AgentActionOutcome, type AgentBasis, type AgentPreparedSlot, type AgentValidation } from "./secretary-agent-validator";
import type { AgentTurnOutcome } from "./secretary-router";
import { agentEnabled, agentMessage, withAgentMessage, type AgentMessageContext } from "../../packages/salon-secretary/src/agent-context";
import type { AgentLoopTelemetry } from "../../packages/salon-secretary/src/agent-loop";

/** Candidate 5, WP5 (flag SALON_SECRETARY_AGENT, default off; docs/c5-spike/11-especificacao-agente.md §1, §4, §5.5, §6): the validated plan
 * becomes the SAME C4 plan, drafts, proposals, cards and confirmation. The plan skeleton (ids, operations and edges only) goes through
 * validateSelectionV2 and createActionPlan like any Luna selection; each action is prepared by the scheduling adapter's own prepare()
 * (prepareResolvedScheduling), the atomic cancel→create pair by the batch adapter, a read that waits for a write as the C4's deferred read.
 * What the owner approves is backend text: proposal previews, cards of backend rows, backend premises, and Luna's notes only under their
 * label once checked by the validator. Nothing here runs with the flag off (the orchestrator only calls it inside the agent's message). */

/** §5.5 labels and notices (pt-BR). */
export const AGENT_NOTE_LABEL = "Nota da Secretária";
export const AGENT_DEPENDENT_NOTICE = "Deixei de fora um pedido que dependia de outro que saiu.";
export const AGENT_PROFESSIONAL_CARD = "Qual profissional? Escolha uma opção real.";
export const AGENT_APPOINTMENT_CARD = "Qual agendamento? Selecione uma opção real.";
/** The C4 adapter's own card questions (the same words, so a held action never repeats one). */
const CARD_QUESTIONS: Readonly<Record<"customer_ref" | "service_ref" | "professional_ref" | "target_professional_ref", string>> = { customer_ref: "Qual cliente? Selecione uma opção real.",
  service_ref: "Qual serviço? Selecione uma opção real.", professional_ref: AGENT_PROFESSIONAL_CARD, target_professional_ref: "Para qual profissional devo passar o atendimento?" };
/** The turn text with a model reply and no proposal nor receipt (CONVERSA, FORA_DO_ESCOPO, the operation question, the safe reply). */
export const agentNothingChanged = (text: string) => text.includes(AGENT_NOTHING_CHANGED) || /nada foi alterado/iu.test(text) ? text : `${text}\n${AGENT_NOTHING_CHANGED}`;

// ---------------------------------------------------------------- the message context (§1, §2.1)
/** The agent's per-message context around one owner message: only with the flag, never nested. `owner`: this turn's owner messages (the thread
 * of an open operation question first). The executor closes over the session's actor. Off (or already inside one): exactly `work()`. */
export function agentMessageScope<T>(actor: ServiceActor, owner: readonly string[], work: () => Promise<T>): Promise<T> {
  if (!agentEnabled() || agentMessage()) return work();
  return withAgentMessage({ owner, executor: createAgentLookupExecutor(actor) }, () => work());
}

// ---------------------------------------------------------------- follow-ups (B2: Phase 1 "no active plan" = no open action)
type PlanLike = { readonly actions: readonly { readonly status: string; readonly operation?: string }[] };
/** A plan with an action still to answer, prepare or confirm (neither DONE nor DISCARDED). */
export const agentPlanOpen = (plan: PlanLike | undefined) => !!plan?.actions.some(action => !terminalActionStatus(action.status));
/** The confirmed actions whose receipt a C4 continuation still builds on: the slot a confirmed cancel freed (appendReleasedSlot) and the origin
 * a confirmed reschedule left (appendReleasedOrigin). The agent's lookups list only active appointments, so it never sees either. */
const RELEASING = new Set(["appointment.cancel", "appointment.change"]);
/** A plan with a confirmed cancel or reschedule: still the C4's active plan (spec §0, B2), even with every action closed. */
export const agentPlanReleased = (plan: PlanLike | undefined) => !!plan?.actions.some(action => action.status === "DONE" && RELEASING.has(action.operation ?? ""));
/** The C4's own limits on this path (sendActionPlanTurn's SUSPENDED_PLAN_LIMIT, sendAutomatic's TURN_LIMIT). */
export const AGENT_FOLLOW_UP_LIMITS = Object.freeze({ suspendedPlans: 5, turns: 20 });
export type AgentFollowUpState = { readonly multiActionV2?: boolean; readonly turns: number; readonly actionPlan?: PlanLike; readonly pendingDiscard?: unknown;
  readonly suspendedPlans?: readonly { readonly actionPlan?: PlanLike }[] };
/** A message on a CLOSED plan (every action DONE or DISCARDED) is a new request the agent may take, unless the plan has a confirmed cancel or
 * reschedule (agentPlanReleased: a continuation may fill what it freed), it answers a card (`operationRef`) or the pending discard question, a
 * suspended plan still has an open action (resuming it is the C4's), the suspended list is full (the C4 would refuse the new plan) or the
 * conversation is at its turn limit. Any other plan state stays with the C4 continuation (Phase 2 in the spec). */
export function agentFollowUpEligible(s: AgentFollowUpState, operationRef?: string) {
  return !!s.multiActionV2 && !operationRef && !s.pendingDiscard && !!s.actionPlan && !agentPlanOpen(s.actionPlan) && !agentPlanReleased(s.actionPlan)
    && !(s.suspendedPlans ?? []).some(saved => agentPlanOpen(saved.actionPlan))
    && (s.suspendedPlans?.length ?? 0) < AGENT_FOLLOW_UP_LIMITS.suspendedPlans && s.turns < AGENT_FOLLOW_UP_LIMITS.turns;
}
/** A validated follow-up that could not tell whose customer a pronoun meant (V-pronoun: no referent in THIS message): the C4 continuation,
 * which still has the closed plan's context, answers it while the message has a call and time left. */
export const agentPronounTopic = (validation: AgentValidation) => validation.ok && validation.actions.some(action => action.codes.includes("AGENT_PRONOUN_TOPIC"));

// ---------------------------------------------------------------- the plan skeleton (§6.2)
export type AgentSkeleton = { selection?: CapabilitySelection; outcomes: ReadonlyMap<string, AgentActionOutcome>; dropped: string[]; notices: string[] };
/** The validated actions as a C4 selection (operations, keys and edges; every value stays in the outcome and reaches prepare() directly). A
 * dropped action leaves with every action that depends on it (its order or its value would stand on nothing). */
export function agentSkeleton(validation: Extract<AgentValidation, { ok: true }>): AgentSkeleton {
  const keys = new Set(validation.actions.map(action => action.key)), dropped = new Set(validation.actions.filter(action => action.status === "DROP").map(action => action.key));
  const direct = new Set(dropped);
  for (let grown = true; grown;) {
    grown = false;
    for (const action of validation.actions) if (!dropped.has(action.key) && [...action.dependsOn, ...action.releasedSlotOf ? [action.releasedSlotOf] : []].some(key => dropped.has(key) || !keys.has(key))) { dropped.add(action.key); grown = true; }
  }
  const kept = validation.actions.filter(action => !dropped.has(action.key));
  const notices = [...validation.notices, ...[...dropped].some(key => !direct.has(key)) ? [AGENT_DEPENDENT_NOTICE] : []];
  if (!kept.length) return { outcomes: new Map(), dropped: [...dropped], notices };
  const selection = validateSelectionV2({ skills: ["scheduling"], independent: !kept.some(action => action.dependsOn.length), operations: kept.map(action => ({
    operation: action.operation, item_key: action.key, depends_on: [...action.dependsOn], released_slot_of: action.releasedSlotOf,
    target_name: null, name: null, priceCents: null, durationMin: null, phone: null, email: null, requested_fields: [], clear_fields: [] })) });
  return { selection, outcomes: new Map(kept.map(action => [action.key, action])), dropped: [...dropped], notices };
}

// ---------------------------------------------------------------- one action (§5 effects → prepare())
/** The registered names beside the refs the validator proved (display and the C4's own echo checks; prepare() keeps using the refs). A
 * delegated professional keeps no name: the owner never said one. */
function withNames(outcome: AgentActionOutcome): SchedulingFields {
  const fields: SchedulingFields = { ...outcome.fields }, delegated = new Set(outcome.basis.flatMap(item => item.type === "DELEGADO" ? [item.field] : []));
  const name = (id: string | undefined) => { const value = id ? outcome.names[id]?.trim() : undefined; return value && value.length >= 2 ? value.slice(0, 200) : undefined; };
  if (fields.customer_ref && !fields.customer_name) fields.customer_name = name(fields.customer_ref);
  if (fields.service_ref && !fields.service_name && !fields.service_names) fields.service_name = name(fields.service_ref);
  if (fields.professional_ref && !fields.professional_name && !delegated.has("profissional")) fields.professional_name = name(fields.professional_ref);
  if (fields.target_professional_ref && !fields.target_professional_name && !delegated.has("novo_profissional")) fields.target_professional_name = name(fields.target_professional_ref);
  for (const key of Object.keys(fields) as (keyof SchedulingFields)[]) if (fields[key] === undefined) delete fields[key];
  return fields;
}
/** A prepared action as a derived value reads it (V13): the accepted proposal of a create, change or block; for a released slot, the ORIGINAL
 * slot of the change or cancellation (its appointment before the move). undefined while that action has no such value yet. */
export function agentPreparedSlot(state: SchedulingState | undefined, released = false): AgentPreparedSlot | undefined {
  const draft = state?.draft;
  if (!state || !draft) return undefined;
  const action = draft.action_snapshot;
  if (released) {
    if (!action) return undefined;
    if (state.operation === "appointment.change") return action.before_start && action.before_end ? { startLocal: action.before_start, endLocal: action.before_end,
      professional_ref: action.before_professional_ref ?? action.professional_ref, professional_name: action.before_professional_name ?? action.professional_name, customer_name: action.customer_name } : undefined;
    return state.operation === "appointment.cancel" ? { startLocal: action.startLocal, endLocal: action.endLocal, professional_ref: action.professional_ref, professional_name: action.professional_name,
      customer_name: action.customer_name } : undefined;
  }
  if (!state.proposal) return undefined;
  const create = draft.snapshot;
  if (state.operation === "appointment.create" && create) return { startLocal: create.startLocal, endLocal: create.endLocal, professional_ref: create.professional_ref,
    professional_name: create.professional_name, customer_name: create.customer_name };
  return action ? { startLocal: action.startLocal, endLocal: action.endLocal, professional_ref: action.professional_ref, professional_name: action.professional_name, customer_name: action.customer_name } : undefined;
}
export type AgentPrepared = { premises: string[]; codes: string[] };
/** One single action through prepare(), with the validator's effects: READY prepares (prepare() may still ask a field, as in the C4); ASK
 * prepares the draft and shows the backend's card or question instead of a proposal; a derived value (V13) is recomputed from the referenced
 * action's prepared slot (`slot`), the model's value must agree, else the field is asked. */
export async function prepareAgentScheduling(actor: ServiceActor, c: SchedulingState, outcome: AgentActionOutcome,
  slot: (key: string, released: boolean) => AgentPreparedSlot | undefined): Promise<AgentPrepared> {
  let fields = withNames(outcome);
  const basis: AgentBasis[] = [...outcome.basis], premises: string[] = [], codes: string[] = [];
  let references: SchedulingReferences | undefined;
  const derived = outcome.derived;
  if (derived) {
    const released = derived.type === "LIBERADO_POR", checked = agentDerivedCheck(derived, key => slot(key, released));
    // A released slot's link is the C4's own (syncReferences follows the move; the executor re-checks the committed agenda): no V23 basis.
    if (checked.status === "OK") { fields = { ...fields, ...checked.fields }; if (!released) basis.push(checked.basis); premises.push(checked.premise); }
    else { for (const key of ["date", "time", "end_date", "end_time"] as const) delete fields[key]; codes.push(checked.status === "WAIT" ? "AGENT_DERIVED_WAIT" : checked.code); }
    // A create in the slot a reschedule of this plan frees: checked with that appointment moved out (the executor re-checks after the move);
    // syncReferences keeps following that move afterwards (the C4's released-origin link).
    if (released && outcome.releasedSlotOf) references = {};
  }
  const card = outcome.card, asked = outcome.status === "ASK";
  const extras: AgentResolvedExtras = { ambiguities: outcome.ambiguities, basis, names: outcome.names, recurrence: outcome.recurrence, ...references ? { references } : {},
    ...outcome.origin?.expected ? { expected: outcome.origin.expected } : {} };
  if (asked && card?.kind === "appointment_ref") extras.appointmentCard = card.items;
  else if (asked && card && (card.kind === "professional_ref" && !fields.professional_name || card.kind === "target_professional_ref")) {
    const kind = card.kind === "professional_ref" ? "professional_ref" as const : "target_professional_ref" as const;
    extras.card = { kind, items: card.items, question: kind === "professional_ref" ? AGENT_PROFESSIONAL_CARD : AGENT_QUESTIONS.AGENT_TARGET_UNSAID ?? AGENT_PROFESSIONAL_CARD };
  }
  // A card of names the owner wrote (customer, service, professional homonyms) is prepare()'s own (its fields carry the owner's words); an
  // action the validator asks about never gets a proposal meanwhile: its question (or that card's) holds it, prepare()'s own question follows.
  if (asked && !extras.card) extras.question = outcome.question?.text ?? (card && card.kind !== "appointment_ref" ? CARD_QUESTIONS[card.kind] : undefined);
  await prepareResolvedScheduling(actor, c, outcome.operation, fields, extras);
  return { premises: [...outcome.premises, ...premises], codes };
}
/** A read that waits for a write of the plan (the C4 deferred read): its resolved fields wait in the adapter and run after the write, at the
 * group's confirmation; the owner is told so now. */
export function agentDeferredRead(c: SchedulingState, outcome: AgentActionOutcome, preview: string) {
  const fields = schedulingResolved.parse(withNames(outcome));
  delete fields.appointment_ref;
  c.operation = outcome.operation; c.fields = fields; c.message = preview; c.interpretation_source = "MODEL";
  if (Object.keys(outcome.names).length) c.resolved_names = { ...c.resolved_names, ...outcome.names };
}
/** The atomic cancel→create pair (the C4 T21 adapter): the cancellation's resolved origin and reason, the create's customer and service; the
 * create inherits the released slot and its professional (the batch never takes a time for it). A question of the validator withdraws the
 * pair's proposal (the owner answers it through the C4 continuation). `adopt`: the committed state when preparation fails. */
export async function prepareAgentBatch(actor: ServiceActor, cancel: AgentActionOutcome, create: AgentActionOutcome, adopt: (state: BatchState) => void): Promise<BatchState> {
  const cancelFields = withNames(cancel), createFields = withNames(create);
  delete cancelFields.appointment_ref;
  for (const key of ["date", "time", "period", "end_time", "end_date", "source_date", "source_time", "appointment_ref"] as const) delete createFields[key];
  const plan = validateBatchPlan({ execution_policy: "all_or_nothing", items: [
    { key: cancel.key, operation: "appointment.cancel", depends_on: [], fields: cancelFields },
    { key: create.key, operation: "appointment.create", depends_on: [cancel.key], released_slot_of: cancel.key, fields: createFields }] });
  const state: BatchState = { operation: "action.batch", plan, message: "", metrics: {}, interpretation_source: "MODEL" };
  try { await prepareBatch(actor, state); } catch (error) { if (state.draft) adopt(state); throw error; }
  const pending = [cancel, create].find(item => item.status === "ASK");
  if (pending) {
    state.proposal = undefined;
    const items = pending.card?.items.map(item => item.name) ?? [];
    state.message = pending.question?.text ?? (items.length ? `${pending.card?.kind === "appointment_ref" ? AGENT_APPOINTMENT_CARD : AGENT_PROFESSIONAL_CARD}\n${items.join("\n")}` : state.message);
  }
  return state;
}

// ---------------------------------------------------------------- the owner's text (§5.5)
/** This turn's notice before the plan: what was left out (dropped, uncovered, over four), then each action's backend premises, then Luna's
 * checked notes under their label. */
export function agentTurnNotice(skeleton: AgentSkeleton, prepared: ReadonlyMap<string, AgentPrepared>): string | undefined {
  const lines = [...skeleton.notices];
  for (const [key, outcome] of skeleton.outcomes) {
    lines.push(...prepared.get(key)?.premises ?? outcome.premises);
    lines.push(...outcome.note.map(note => `${AGENT_NOTE_LABEL}: ${note}`));
  }
  const unique = [...new Set(lines.map(line => line.trim()).filter(Boolean))];
  return unique.length ? unique.join("\n") : undefined;
}

// ---------------------------------------------------------------- the Confirmar (§5.1 V23)
/** V23 (1): every derived basis of a group re-checked against fresh rows, in one tenant transaction, BEFORE its first write. No basis: true
 * without reading. `planValue`: the current prepared slot of an action of the plan (links between actions). */
export async function agentGroupPrecheck(actor: ServiceActor, children: readonly { key: string; basis: readonly AgentBasis[] }[],
  planValue: (key: string) => { startLocal: string; endLocal: string } | undefined): Promise<boolean> {
  if (!children.some(child => child.basis.length)) return true;
  const verdict = await withTenant(actor, async tx => agentGroupBasisPrecheck(await agentFactReader(tx, actor), children, { planValue }));
  return verdict.ok;
}
/** V23 (2): the same check inside the confirm's own transaction (scheduling-actions precondition). */
export const agentConfirmOptions = (actor: ServiceActor, basis: readonly AgentBasis[] | undefined) =>
  basis?.length ? { precondition: agentBasisPrecondition(actor, basis) } : {};

// ---------------------------------------------------------------- telemetry (§6.4)
const QUESTION_FIELDS: Readonly<Record<string, string>> = { operacao: "request", atendimento: "appointment", cliente: "customer", profissional: "professional",
  novo_profissional: "target", servicos: "service", dia: "date", inicio: "time", fim: "end", motivo: "reason" };
export type AgentOutcomeInput = { loop?: AgentLoopTelemetry; path: AgentTurnOutcome["path"]; code: string | null; validation?: AgentValidation; questionField?: string | null;
  premises?: number; locateDisagree?: number; followUp?: boolean };
/** S1 additions, present only when they apply: the effort of each call when they differed (A4), the message's preload (B1,
 * SALON_SECRETARY_AGENT_PRELOAD) and a follow-up on a closed plan (B2); the router's whitelist (secretary-router.ts safeAgent) keeps them. */
export type AgentTurnOutcomeExtra = AgentTurnOutcome & { preload?: AgentPreloadTelemetry; follow_up?: true };
/** Codes and numbers only (never a name, a quote or a text). */
export function agentTurnOutcome(context: AgentMessageContext | undefined, input: AgentOutcomeInput): AgentTurnOutcomeExtra {
  const lookups = context ? agentLookupTelemetry(context) : undefined, loop = input.loop, validation = input.validation?.ok ? input.validation : undefined;
  const actions = validation?.actions ?? [], codes = new Set(actions.flatMap(action => action.codes));
  return { path: input.path, rounds: loop?.calls ?? 0, lookup_calls: loop?.lookup_calls ?? lookups?.calls ?? 0, lookup_kinds: [...new Set(lookups?.kinds ?? [])],
    rows: lookups?.rows ?? 0, output_bytes: lookups?.bytes ?? 0, truncated: lookups?.truncated === true, fallback_code: input.code,
    validator: { accepted: actions.filter(action => action.status === "READY").length, name_fallback: actions.filter(action => action.status !== "DROP" && action.codes.some(code =>
      ["AGENT_REF_UNKNOWN", "AGENT_REF_KIND", "AGENT_REF_STALE", "AGENT_NAME_MISMATCH", "AGENT_TEMPORAL_READING"].includes(code))).length,
      carded: actions.filter(action => action.card).length, asked: actions.filter(action => action.status === "ASK" && !action.card).length,
      dropped: actions.filter(action => action.status === "DROP").length, codes: [...codes] },
    question_field: input.questionField ? QUESTION_FIELDS[input.questionField] ?? "other" : null, premises_backend: input.premises ?? 0,
    premise_note_dropped: codes.has("AGENT_PREMISE_MISMATCH") ? actions.filter(action => action.codes.includes("AGENT_PREMISE_MISMATCH")).length : 0,
    uncovered: codes.has("AGENT_UNCOVERED") ? 1 : 0, actions_left: validation?.notices.some(notice => /de fora: faço até/u.test(notice)) ? 1 : 0,
    locate_disagree: input.locateDisagree ?? actions.filter(action => action.codes.includes("AGENT_APPT_LOCATE")).length, effort: loop?.effort ?? null,
    ...loop && new Set(loop.efforts).size > 1 ? { efforts: [...loop.efforts] } : {},
    ...lookups?.preload ? { preload: lookups.preload } : {}, ...input.followUp ? { follow_up: true as const } : {} };
}
