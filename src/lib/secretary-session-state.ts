import { z } from "zod";
import { pilotFieldValid, PILOT_ACTION_ID, PILOT_FIELDS, PILOT_INVALIDATIONS, PILOT_OPTIONS_MAX, PILOT_QUESTION_FIELDS, PILOT_QUESTION_ID, PILOT_QUESTION_REASONS,
  PILOT_STATUSES } from "./secretary-pilot-plan";
import { pilotDestinoShape, pilotOrigemShape } from "../../packages/salon-secretary/src/pilot-reschedule-contract";

/** D1: the strict shape of one persisted Secretary aggregate (a top-level conversation and every session it owns: plan
 * children, suspended plans' children, legacy children). Validated on every load before anything is rehydrated; an unknown
 * key, a wrong type or a foreign owner fails closed (the orchestrator answers SESSION_NOT_FOUND). Adapter states, plans and
 * journal rows are checked as plain objects (they are the orchestrator's own values, written only by it under RLS); the
 * decoded objects themselves are used, so their key order, which the orchestrator compares through JSON.stringify, stays.
 * Never persisted: the actor (always the authenticated caller's), `busy` (per process) and the per-turn option binding. */
export const STORED_AGGREGATE_SCHEMA = 1;
const uuid = z.string().uuid();
const code = z.string().regex(/^[A-Z][A-Z0-9_]{1,79}$/);
const object = z.record(z.string(), z.unknown());
const receipts = z.instanceof(Set).refine(set => [...set].every(item => typeof item === "string"));
const loaded = z.array(z.object({ skill_id: z.string(), version: z.string(), manual_hash: z.string() }).strict());
const suspended = z.object({ actionPlan: object.optional(), actionUnits: z.array(object).optional(), children: z.array(uuid).optional(),
  loaded: loaded.optional(), groupReceipts: receipts.optional() }).strict();
/** Pilot of the reschedule (flag SALON_SECRETARY_PILOT_RESCHEDULE; secretary-pilot.ts PilotSessionState): its plan and pending operators as plain
 * objects (the orchestrator's own values), the replies kept per client turn id, the owner's messages that brought origin hints, the texts of the
 * open questions and the latest turn; bounded. Read whatever the flag says now (a conversation saved with it on still loads with it off). */
const pilotTurn = z.object({ turnId: uuid, clientTurnId: uuid.nullable(), receivedAt: z.string().max(40) }).strict();
// Review L7: the plan and the pending operators are checked as strictly as they are written (the reducer's own field rule; the contract's own
// shapes for the operators). Review M3: every bound here holds what the orchestrator writes (question texts list at most 8 options plus a
// count; an out-of-scope mention is at most 120 code points, so 480 UTF-16 units), and a state that breaks one is never saved (persistedCall).
const revision = z.number().int().min(0);
const pilotQuestionId = z.string().regex(PILOT_QUESTION_ID);
const pilotField = z.unknown().refine(pilotFieldValid);
const pilotRefs = z.object({ proposalRef: z.string().min(1).max(200), draftRevision: z.number().int().min(1), revision }).strict();
const pilotPlan = z.object({
  planId: uuid, revision,
  action: z.object({
    actionId: z.literal(PILOT_ACTION_ID), status: z.enum(PILOT_STATUSES),
    fields: z.object(Object.fromEntries(PILOT_FIELDS.map(name => [name, pilotField])) as Record<(typeof PILOT_FIELDS)[number], typeof pilotField>).strict(),
    questions: z.array(z.object({ questionId: pilotQuestionId, actionId: z.literal(PILOT_ACTION_ID), field: z.enum(PILOT_QUESTION_FIELDS), reason: z.enum(PILOT_QUESTION_REASONS),
      options: z.array(z.object({ id: z.string().min(1).max(200), label: z.string().max(400) }).strict()).max(PILOT_OPTIONS_MAX).optional(), revision, open: z.boolean() }).strict())
      .max(64).refine(questions => new Set(questions.map(question => question.questionId)).size === questions.length),
    proposal: pilotRefs.extend({ draftRef: z.string().min(1).max(200), text: z.string().max(20_000) }).strict().optional(),
    approval: pilotRefs.optional(),
    invalidation: z.object({ reason: z.enum(PILOT_INVALIDATIONS), revision }).strict().optional(),
  }).strict(),
  turns: z.array(z.object({ turnId: uuid, clientTurnId: uuid.nullable(), receivedAt: z.string().max(40), baseRevision: revision, revision, outcome: z.string().max(80) }).strict()).max(40),
}).strict();
// Review P1: whether each origin hint was proved against the message that brought it; review S2: the received_at of the turn that said each day.
const pilotProven = z.object({ dia: z.boolean().optional(), hora: z.boolean().optional(), profissional_mencao: z.boolean().optional(), servico_mencao: z.boolean().optional(),
  posicao: z.boolean().optional() }).strict();
const pilotPending = z.object({ origem: z.unknown().refine(value => pilotOrigemShape.safeParse(value).success),
  destino: z.unknown().refine(value => pilotDestinoShape.safeParse(value).success), proven: pilotProven.optional(),
  anchors: z.object({ origem: z.string().max(40).optional(), destino: z.string().max(40).optional() }).strict().optional() }).strict();
const pilotState = z.object({
  plan: pilotPlan.optional(), pending: pilotPending.optional(),
  replies: z.array(z.object({ clientTurnId: uuid, turnId: uuid, message: z.string().max(20_000), view: object }).strict()).max(32),
  // `sources`: no longer written (review P1: each hint is proved on arrival); kept so a conversation saved before still loads.
  sources: z.array(z.string().max(1000)).max(8).optional(), outOfScope: z.array(z.string().max(480)).max(6).optional(),
  asked: z.array(z.object({ questionId: pilotQuestionId, text: z.string().max(4000) }).strict()).max(8).optional(),
  notes: z.array(z.string().max(1000)).max(8).optional(), turn: pilotTurn.optional(), questionFloor: z.number().int().min(0).max(999).optional(),
  actionPlanRef: uuid.optional(), actionPlanFor: uuid.optional(), published: z.number().int().min(0).optional(),
}).strict();
export const storedSession = z.object({
  id: uuid,
  skill: z.enum(["services", "customers", "scheduling", "financial", "inventory", "communication", "auto"]),
  expires: z.number().finite(),
  turns: z.number().int().min(0),
  cancelled: z.boolean(),
  created: z.number().finite().optional(),
  // "" is how a call outside any plan context reads the plan owner (treated as absent, like undefined).
  planOwner: z.union([uuid, z.literal("")]).optional(),
  multiActionV2: z.boolean().optional(),
  inheritedInterpretation: z.boolean().optional(),
  children: z.array(uuid).optional(),
  suspendedPlans: z.array(suspended).max(16).optional(),
  groupReceipts: receipts.optional(),
  actionPlan: object.optional(),
  actionUnits: z.array(object).optional(),
  loaded: loaded.optional(),
  conversationNotice: z.string().optional(),
  notice: z.string().optional(),
  capability_status: z.enum(["SUPPORTED", "NEEDS_INPUT", "AMBIGUOUS", "UNSUPPORTED", "BLOCKED", "CONVERSATION"]).optional(),
  operation: z.enum(["service.create", "service.change"]).optional(),
  acceptedServiceQuery: z.string().optional(),
  proposalExpired: z.boolean().optional(),
  deferredFinancialReferences: object.optional(),
  pending: object.optional(),
  questionFingerprints: z.array(z.string()).max(64).optional(),
  telemetrySalt: z.string().optional(),
  turnNotice: z.object({ text: z.string(), alone: z.boolean().optional() }).strict().optional(),
  pendingDiscard: z.object({ plan_ref: uuid, keys: z.array(z.string()), question: z.string() }).strict().optional(),
  clarificationHistory: object.optional(),
  today: z.string().optional(),
  lastOutcome: z.object({ codes: z.array(code).max(32), contract_version: z.string().optional() }).strict().optional(),
  // C5 agent (docs/c5-spike/11-especificacao-agente.md §6.2; written only with SALON_SECRETARY_AGENT, read whatever the flag says now, so a
  // conversation saved with the flag on still loads with it off): the agent's open "qual operação?" question with the owner's messages of
  // that thread (at most 2 exchanges), and the plan_ref of the active plan the agent built (the "Confirmar tudo" review dialog).
  agentPending: z.object({ question: z.string().max(200), thread: z.array(z.string().max(2000)).max(2), turns: z.number().int().min(0).max(2) }).strict().optional(),
  agentPlan: uuid.optional(),
  pilot: pilotState.optional(),
  communication: object.optional(), inventory: object.optional(), financial: object.optional(), batch: object.optional(),
  scheduling: object.optional(), customer: object.optional(),
  draft: object.optional(), proposal: object.optional(), receipt: object.optional(),
}).strict();
/** Per-session extras kept outside the Session objects: post-commit warnings and the recorded "confirm all" outcomes. */
const aggregate = z.object({
  schema: z.literal(STORED_AGGREGATE_SCHEMA),
  root: uuid,
  sessions: z.array(z.unknown()).min(1).max(512),
  warnings: z.array(z.tuple([uuid, z.array(code).max(16)])).optional(),
  batchReceipts: z.array(z.tuple([uuid, z.array(z.tuple([z.string().max(8192), object])).max(64)])).optional(),
}).strict();
export type StoredSession = z.infer<typeof storedSession>;
export type StoredAggregate = { schema: typeof STORED_AGGREGATE_SCHEMA; root: string; sessions: Record<string, unknown>[];
  warnings?: [string, string[]][]; batchReceipts?: [string, [string, Record<string, unknown>][]][] };

/** Validates a decoded aggregate and returns the decoded objects unchanged (never zod's re-built copies). The root is a
 * top-level conversation; every other session is owned by it (or is a legacy child listed by it); ids are unique. */
export function parseStoredAggregate(value: unknown): StoredAggregate {
  const parsed = aggregate.safeParse(value);
  if (!parsed.success) throw Error("SESSION_STATE_INVALID");
  const stored = value as StoredAggregate, ids = new Set<string>();
  for (const session of stored.sessions) {
    if (!storedSession.safeParse(session).success) throw Error("SESSION_STATE_INVALID");
    const { id, planOwner } = session as StoredSession;
    if (ids.has(id) || (planOwner && planOwner !== stored.root) || (id === stored.root && planOwner)) throw Error("SESSION_STATE_INVALID");
    ids.add(id);
  }
  if (!ids.has(stored.root) || [...stored.warnings ?? [], ...stored.batchReceipts ?? []].some(([id]) => !ids.has(id))) throw Error("SESSION_STATE_INVALID");
  return stored;
}
