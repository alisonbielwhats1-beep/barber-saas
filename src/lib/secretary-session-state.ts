import { z } from "zod";

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
