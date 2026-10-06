import { AsyncLocalStorage } from "node:async_hooks";
import type { AgentLookupCall } from "./agent-tools";

/** C5 agent (flag SALON_SECRETARY_AGENT, default off; docs/c5-spike/11-especificacao-agente.md §1-§3, §6.2, §6.5): the per-message
 * context of the agent path. `withAgentMessage` (installed by the app in sendMessage, only with the flag) holds the refs of THIS
 * message and what they bind to, the call counter (3 per owner message, consulted before every call, the C4 fallback included)
 * and the single 45 s signal that also reaches the C4. The binding lives only here: it is never a Session field and refuses to be
 * serialized. The tenant/actor never enter this package: the app injects a LookupExecutor that closes over them. Off: nothing
 * here runs (no existing module imports it) and the C4 is byte-identical. */
export const agentEnabled = () => process.env.SALON_SECRETARY_AGENT === "true";
/** Micro-candidate P0+P2 (flag SALON_SECRETARY_AGENT_MICRO, default off; docs/SECRETARY_AGENT_EVAL_PROTOCOL.md Adendo 7): only the exact value
 * "true" turns it on; off, every path it guards is byte-identical. */
export const agentMicroEnabled = () => process.env.SALON_SECRETARY_AGENT_MICRO === "true";
export const AGENT_EFFORTS = ["medium", "high"] as const;
export type AgentEffort = (typeof AGENT_EFFORTS)[number];
/** SALON_SECRETARY_AGENT_EFFORT, one value per message for every round (default medium); anything else fails closed. */
export function agentEffort(env: Readonly<Record<string, string | undefined>> = process.env): AgentEffort {
  const value = env.SALON_SECRETARY_AGENT_EFFORT ?? "medium";
  if (!(AGENT_EFFORTS as readonly string[]).includes(value)) throw Error("INVALID_AGENT_EFFORT");
  return value as AgentEffort;
}
/** The effort of the 1st, 2nd and 3rd call of a message. */
export type AgentRoundEfforts = readonly [AgentEffort, AgentEffort, AgentEffort];
/** S1 fix A4 (owner decision 19, effort decided by measurement): SALON_SECRETARY_AGENT_EFFORT_ROUNDS = "e1,e2,e3", one effort of
 * AGENT_EFFORTS per call of the message. Unset: SALON_SECRETARY_AGENT_EFFORT in every round (the historical behaviour). The message
 * effort is checked first either way; another count, a space, an empty or unknown value fails closed (AGENT_EFFORT_INVALID). */
export function agentRoundEfforts(env: Readonly<Record<string, string | undefined>> = process.env): AgentRoundEfforts {
  const base = agentEffort(env), value = env.SALON_SECRETARY_AGENT_EFFORT_ROUNDS;
  if (value === undefined) return Object.freeze([base, base, base] as const);
  const parts = value.split(",");
  if (parts.length !== 3 || parts.some(part => !(AGENT_EFFORTS as readonly string[]).includes(part))) throw Error("INVALID_AGENT_EFFORT");
  return Object.freeze(parts as unknown as AgentRoundEfforts);
}
export const agentRoundEffort = (round: 1 | 2 | 3, env: Readonly<Record<string, string | undefined>> = process.env): AgentEffort => agentRoundEfforts(env)[round - 1];
/** S1 fix A5 (owner decision 13, hybrid context; adopted only by A/B): SALON_SECRETARY_AGENT_PRELOAD, default off. On, the app's
 * executor may pre-load what the owner's own words cite (AgentDirectory.preload) and the prompt sends it as a third system part. */
export const agentPreloadEnabled = () => process.env.SALON_SECRETARY_AGENT_PRELOAD === "true";
/** §6.5: the agent relies on these guards and resolvers; any one off → the agent does not run (AGENT_FLAGS_INCOMPLETE) and the
 * C4 answers. The spec's "NAME_TOKENS" is the whole-name switch SALON_SECRETARY_WHOLE_NAME_MATCH (src/lib/secretary-name-tokens.ts). */
export const AGENT_DEPENDENCY_FLAGS = ["SALON_SECRETARY_MULTI_ACTION_V2_ENABLED", "SALON_SECRETARY_NAME_SUGGESTIONS", "SALON_SECRETARY_WHOLE_NAME_MATCH",
  "SALON_SECRETARY_COMBO_GUARD", "SALON_SECRETARY_BLOCK_OVERLAP_GUARD", "SALON_SECRETARY_CUSTOMER_OVERLAP_GUARD", "SALON_SECRETARY_DATE_RULES_V2",
  "SALON_SECRETARY_REFERENCES_V2", "SALON_SECRETARY_MULTI_SERVICE", "SALON_SECRETARY_ALTER_APPOINTMENT", "SALON_SECRETARY_READS_V2", "SALON_SECRETARY_RECURRENCE_GUARD"] as const;
export const agentMissingDependencies = (env: Readonly<Record<string, string | undefined>> = process.env) => AGENT_DEPENDENCY_FLAGS.filter(name => env[name] !== "true");
export const agentDependenciesSatisfied = (env: Readonly<Record<string, string | undefined>> = process.env) => agentMissingDependencies(env).length === 0;
/** Telemetry path of a message (§6.4). */
export type AgentPath = "AGENT" | "C4_FALLBACK" | "C4_SKIPPED";
/** §2.1, §3: every number of the loop, the executor and the guard in one place. */
export const AGENT_LIMITS = Object.freeze({
  callsPerMessage: 3, lookupRounds: 2, messageMs: 45_000, fallbackMinMs: 15_000, lookupCallMs: 15_000, planCallMs: 25_000, planCallMarginMs: 2_000,
  dbRoundMs: 3_000, dbMaxWaitMs: 1_000, dbTimeoutMs: 3_500, unavailablePerMessage: 2,
  lookupsPerRound: 4, lookupsPerMessage: 6, lookupOutputBytes: 3 * 1024, roundOutputBytes: 9 * 1024, argumentsBytes: 4 * 1024, commentaryBytes: 1024,
  maxOutputTokens: 8192, requestCap: 64_000, outputFraming: 8192,
  directoryProfessionals: 40, directoryServices: 80, customersShown: 5, upcomingPerCustomer: 3, professionalsShown: 6, freeTimesShown: 6, agendaRows: 50, refsPerKind: 99,
  preloadBytes: 6 * 1024, preloadItems: 5, planStateBytes: 3 * 1024,
});

/** Opaque refs of one message: p professional, s service, c customer, a appointment, f free interval; 1..99 per kind. */
export const AGENT_REF_KINDS = ["p", "s", "c", "a", "f"] as const;
export type AgentRefKind = (typeof AGENT_REF_KINDS)[number];
export type AgentRef<K extends AgentRefKind = AgentRefKind> = `${K}${number}`;
export function agentRefKind(ref: string): AgentRefKind | null {
  const match = /^([pscaf])[1-9][0-9]?$/.exec(ref);
  return match ? match[1] as AgentRefKind : null;
}
/** What the model was shown for a ref (server-side only; the validator re-reads the tenant anyway, §5 V3). Times are salon-local
 * "YYYY-MM-DDTHH:mm"; ids are database ids and never reach the model. */
export type AgentRefFacts = {
  p: { readonly name: string };
  s: { readonly name: string; readonly durationMin: number };
  c: { readonly shown: string };
  a: { readonly start: string; readonly end: string; readonly professionalId: string; readonly customerId: string; readonly serviceIds: readonly string[]; readonly status: "PENDING" | "CONFIRMED" };
  f: { readonly professionalId: string; readonly start: string; readonly end: string };
};
export type AgentBindingEntry<K extends AgentRefKind = AgentRefKind> = { readonly ref: AgentRef<K>; readonly kind: K; readonly id: string; readonly facts: AgentRefFacts[K] };
export type AgentBinding = {
  /** The ref of (kind, id): sequential per kind in order of first appearance; the same id keeps its ref (facts: the latest shown).
   * null when the kind has no ref left (the executor then reports `truncado`, never a silent subset). */
  bind<K extends AgentRefKind>(kind: K, id: string, facts: AgentRefFacts[K]): AgentRef<K> | null;
  refOf(kind: AgentRefKind, id: string): AgentRef | undefined;
  /** The entry of a ref of THIS message with the expected kind (a ref of another kind or message: undefined). */
  resolve<K extends AgentRefKind>(ref: string, kind: K): AgentBindingEntry<K> | undefined;
  entry(ref: string): AgentBindingEntry | undefined;
  entries(kind?: AgentRefKind): AgentBindingEntry[];
  readonly size: number;
  toJSON(): never;
};
export function createAgentBinding(limit: number = AGENT_LIMITS.refsPerKind): AgentBinding {
  const byRef = new Map<string, AgentBindingEntry>(), byId = new Map<string, string>(), next: Record<AgentRefKind, number> = { p: 0, s: 0, c: 0, a: 0, f: 0 };
  const idKey = (kind: AgentRefKind, id: string) => `${kind}\u0000${id}`;
  return Object.freeze({
    bind<K extends AgentRefKind>(kind: K, id: string, facts: AgentRefFacts[K]): AgentRef<K> | null {
      if (!AGENT_REF_KINDS.includes(kind) || typeof id !== "string" || !id) throw Error("AGENT_BINDING_INPUT");
      const known = byId.get(idKey(kind, id));
      if (known) { byRef.set(known, { ref: known as AgentRef<K>, kind, id, facts }); return known as AgentRef<K>; }
      if (next[kind] >= limit) return null;
      const ref = `${kind}${++next[kind]}` as AgentRef<K>;
      byRef.set(ref, { ref, kind, id, facts }); byId.set(idKey(kind, id), ref);
      return ref;
    },
    refOf: (kind: AgentRefKind, id: string) => byId.get(idKey(kind, id)) as AgentRef | undefined,
    resolve<K extends AgentRefKind>(ref: string, kind: K): AgentBindingEntry<K> | undefined {
      const entry = byRef.get(ref);
      return entry && entry.kind === kind ? entry as AgentBindingEntry<K> : undefined;
    },
    entry: (ref: string) => byRef.get(ref),
    entries: (kind?: AgentRefKind) => [...byRef.values()].filter(entry => !kind || entry.kind === kind),
    get size() { return byRef.size; },
    toJSON(): never { throw Error("AGENT_BINDING_NOT_SERIALIZABLE"); },
  });
}
/** §3.8: calls of one owner message (agent rounds, C4 fallback and its repair). `allows` is consulted before every call and `take`
 * counts it; a call past the limit is MODEL_CALL_LIMIT (the message of the C4's own guard). */
export type AgentCallBudget = { readonly limit: number; used(): number; remaining(): number; allows(count?: number): boolean; take(): void };
export function createAgentCallBudget(limit: number = AGENT_LIMITS.callsPerMessage): AgentCallBudget {
  let used = 0;
  return Object.freeze({ limit, used: () => used, remaining: () => limit - used, allows: (count = 1) => used + count <= limit,
    take() { if (used >= limit) throw Error("MODEL_CALL_LIMIT"); used++; } });
}

/** §2.1 pre-loaded context of a message: professionals and services with their refs (ids stay in the binding), in stable order
 * by folded name, homonyms kept apart ("Nome (1)", "Nome (2)"); today and the salon's timezone. */
export type AgentDirectory = {
  readonly today: { readonly date: string; readonly weekday: string; readonly timezone: string };
  readonly professionals: readonly { readonly ref: AgentRef<"p">; readonly nome: string }[];
  readonly services: readonly { readonly ref: AgentRef<"s">; readonly nome: string; readonly duracao_min: number }[];
  /** S1 fix A5 (flag SALON_SECRETARY_AGENT_PRELOAD): what the executor already read for the days, names and services the owner's
   * words of this turn cite, rendered and masked exactly as lookup outputs (refs bound only for what it delivers): compact JSON, an
   * array of 1..5 {consulta, argumentos, resultado}, at most 6 KB. The prompt sends it whole as a third system part or drops it
   * whole (agent-prompt.ts agentPreloadText); it never counts as a lookup round and never causes a fallback. */
  readonly preload?: string;
  /** Phase 2 (a message on an open agent plan): the plan's state as the app rendered it for THIS message (compact JSON object, refs of this
   * message's binding, at most 3 KB; agent-prompt.ts agentPlanText). Absent on every other message. */
  readonly plan?: string;
};
/** Phase 2: the open agent plan a message continues (set by the app only with the flag, on an eligible open plan). `keys`: its actions that are
 * not discarded (a plan action with one of these keys is that action's patch); `done`: those already confirmed; `render`: the plan's state with
 * refs bound in this message's binding (null when it cannot be rendered within AGENT_LIMITS.planStateBytes). */
export type AgentOpenScope = { readonly keys: readonly string[]; readonly done?: readonly string[]; render(binding: AgentBinding): string | null };
/** More than 40 professionals or 80 services: the agent does not run on this message (the C4 answers). */
export type AgentDirectoryResult = { readonly ok: true; readonly directory: AgentDirectory } | { readonly ok: false; readonly code: "AGENT_DIRECTORY_TRUNCATED" | "AGENT_UNAVAILABLE" };
/** Injected by the app (src/lib/secretary-agent-lookups.ts), closing over the session actor: the model never names a tenant, an
 * actor or an id. Read-only; every read of a round in ONE tenant transaction, in sequence. */
export type AgentLookupExecutor = {
  directory(context: AgentMessageContext): Promise<AgentDirectoryResult>;
  /** One JSON output per call, in the calls' order (errors as `{"erro":"<CÓDIGO>"}`, never an exception text). */
  round(calls: readonly AgentLookupCall[], context: AgentMessageContext): Promise<readonly string[]>;
};
export type AgentMessageContext = {
  /** The owner's messages of this turn (masking by token and every quote proof read only these, never tool text). */
  readonly owner: readonly string[];
  readonly binding: AgentBinding;
  readonly calls: AgentCallBudget;
  /** Aborts at the message deadline (or with the caller's signal). */
  readonly signal: AbortSignal;
  readonly deadline: number;
  readonly now: () => number;
  remainingMs(): number;
  readonly executor: AgentLookupExecutor | undefined;
  /** Phase 2: the open agent plan this message continues (absent: a new request, Phase 1). */
  readonly open?: AgentOpenScope;
  toJSON(): never;
};
export type AgentMessageOptions = { readonly owner: readonly string[]; readonly executor?: AgentLookupExecutor; readonly signal?: AbortSignal; readonly now?: () => number; readonly budgetMs?: number;
  readonly open?: AgentOpenScope };
const message = new AsyncLocalStorage<AgentMessageContext>();
const deadlineReason = () => new DOMException("AGENT_MESSAGE_DEADLINE", "TimeoutError");
/** One owner message on the agent path. Not reentrant (a nested call is a wiring error). The timer uses the global setTimeout,
 * so fake timers drive it in tests; it is always cleared. */
export async function withAgentMessage<T>(options: AgentMessageOptions, work: (context: AgentMessageContext) => Promise<T>): Promise<T> {
  if (message.getStore()) throw Error("AGENT_MESSAGE_NESTED");
  const now = options.now ?? Date.now, budget = options.budgetMs ?? AGENT_LIMITS.messageMs;
  if (!Number.isFinite(budget) || budget <= 0 || budget > AGENT_LIMITS.messageMs) throw Error("AGENT_MESSAGE_BUDGET");
  const controller = new AbortController(), deadline = now() + budget, timer = setTimeout(() => controller.abort(deadlineReason()), budget);
  const signal = options.signal ? AbortSignal.any([options.signal, controller.signal]) : controller.signal;
  const open = options.open, scope: AgentOpenScope | undefined = open && Object.freeze({ keys: Object.freeze([...open.keys]), done: Object.freeze([...open.done ?? []]),
    render: (binding: AgentBinding) => open.render(binding) });
  const context: AgentMessageContext = Object.freeze({ owner: Object.freeze([...options.owner]), binding: createAgentBinding(), calls: createAgentCallBudget(), signal, deadline, now,
    remainingMs: () => Math.max(0, deadline - now()), executor: options.executor, ...scope ? { open: scope } : {}, toJSON(): never { throw Error("AGENT_MESSAGE_NOT_SERIALIZABLE"); } });
  try { return await message.run(context, () => work(context)); } finally { clearTimeout(timer); }
}
export const agentMessage = () => message.getStore();
/** The counter of the current message (undefined outside the agent path: the C4's bounded model keeps its historical guard). */
export const messageCallBudget = () => message.getStore()?.calls;
/** The signal of one call: the message signal and at most `limitMs` (never past the message deadline). `dispose` clears the timer. */
export function agentCallSignal(limitMs: number, context: AgentMessageContext | undefined = message.getStore()): { signal: AbortSignal; ms: number; dispose(): void } {
  if (!context) throw Error("AGENT_MESSAGE_MISSING");
  const ms = Math.max(0, Math.min(limitMs, context.remainingMs())), controller = new AbortController();
  const timer = setTimeout(() => controller.abort(new DOMException("AGENT_CALL_DEADLINE", "TimeoutError")), ms);
  return { signal: AbortSignal.any([context.signal, controller.signal]), ms, dispose: () => clearTimeout(timer) };
}

/** §2.1 masking by token (owner decision 22): a customer shows only the whole tokens of the registered name the owner wrote in
 * this turn (≥ 3 letters, outside every temporal atom; decided by the app's `said`), the others as one mask per run; no token said
 * → AGENT_UNSAID_CUSTOMER. A phone never appears, except the mark + 2 last digits that separate two identical displays. */
export const AGENT_NAME_MASK = "…";
export const AGENT_UNSAID_CUSTOMER = "cliente não citado";
export const AGENT_PHONE_MARK = "···";
export const AGENT_NAME_TOKEN_MIN = 3;
export const AGENT_NAME_MAX_CHARS = 60;
export type AgentCustomerView = { readonly ref: AgentRef<"c">; readonly nome: string };
/** §2.1 sanitization of a database name (person or service): NFC, only letters, digits, space, apostrophe, hyphen and dot (label
 * separators, controls and line breaks become spaces), spaces collapsed, at most 60 characters. */
export function sanitizeAgentName(value: string): string {
  const cleaned = value.normalize("NFC").replace(/\p{M}/gu, "").replace(/[^\p{L}\p{Nd} '’\-.]/gu, " ").replace(/\s+/g, " ").trim();
  return [...cleaned].slice(0, AGENT_NAME_MAX_CHARS).join("").trim();
}
export function maskAgentName(name: string, said: (token: string) => boolean): string {
  const out: string[] = [];
  for (const token of sanitizeAgentName(name).split(" ").filter(Boolean)) {
    if (said(token)) out.push(token); else if (out.at(-1) !== AGENT_NAME_MASK) out.push(AGENT_NAME_MASK);
  }
  return out.some(token => token !== AGENT_NAME_MASK) ? out.join(" ") : AGENT_UNSAID_CUSTOMER;
}
/** The suffix that separates two customers shown with the same text (empty without 2 digits). */
export const agentPhoneSuffix = (phone: string | null | undefined) => { const digits = (phone ?? "").replace(/\D/g, ""); return digits.length >= 2 ? AGENT_PHONE_MARK + digits.slice(-2) : ""; };
