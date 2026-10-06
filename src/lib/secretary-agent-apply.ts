import { terminalActionStatus, validateSelectionV2, type CapabilitySelection } from "@everflair/salon-secretary";
import type { ServiceActor } from "./service-catalog";
import { withTenant } from "./prisma-tenant";
import { schedulingResolved, schedulingServiceRefs, type SchedulingFields } from "./scheduling-contract";
import { prepareResolvedScheduling, type AgentResolvedExtras, type SameAsField, type SchedulingReferences, type SchedulingState } from "./secretary-scheduling";
import { prepareBatch, type BatchState } from "./secretary-batch";
import { validateBatchPlan } from "./scheduling-batch";
import { createAgentLookupExecutor, agentLookupTelemetry, agentCustomerLabel, agentSaidTokens, type AgentPreloadTelemetry } from "./secretary-agent-lookups";
import { AGENT_NOTHING_CHANGED, AGENT_QUESTIONS, agentBasisPrecondition, agentDerivedCheck, agentFactReader, agentGroupBasisPrecheck,
  type AgentActionOutcome, type AgentBasis, type AgentCardKind, type AgentOpenAction, type AgentOpenPlan, type AgentPreparedSlot, type AgentValidation, type AgentValidatorCode } from "./secretary-agent-validator";
import type { AgentTurnOutcome } from "./secretary-router";
import { clauseBounds, entityQuoteDenied, quoteTemporalFacts, temporalAtomSpans } from "./scheduling-temporal-source";
import { literalProofSpans, literalSpans } from "../../packages/salon-secretary/src/literal-match";
import { SUGGESTION_THRESHOLD, foldName, nameTokens, tokenSimilarity } from "./name-search";
import { weekdayOfDateKey } from "./time";
import { AGENT_LIMITS, agentEnabled, agentMessage, agentMicroEnabled, withAgentMessage, type AgentBinding, type AgentLookupExecutor, type AgentMessageContext,
  type AgentOpenScope } from "../../packages/salon-secretary/src/agent-context";
import { AGENT_PLAN_OPERATIONS, type AgentPlanOperation, type AgentQuestionField } from "../../packages/salon-secretary/src/agent-plan";
import { AGENT_OPEN_STATES, type AgentOpenState } from "../../packages/salon-secretary/src/agent-prompt";
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
 * of an open operation question first). The executor closes over the session's actor. Off (or already inside one): exactly `work()`.
 * Phase 2 `open` (read only with the flag): the open agent plan this message continues; its state is rendered once the directory (and the
 * pre-load) bound their refs, as the directory's `plan` (agentOpenExecutor). */
export function agentMessageScope<T>(actor: ServiceActor, owner: readonly string[], work: () => Promise<T>, open?: () => AgentOpenScope | undefined): Promise<T> {
  if (!agentEnabled() || agentMessage()) return work();
  const scope = open?.(), executor = createAgentLookupExecutor(actor);
  return withAgentMessage({ owner, executor: scope ? agentOpenExecutor(executor) : executor, ...scope ? { open: scope } : {} }, () => work());
}
const refusedStates = new WeakSet<AgentMessageContext>();
/** Phase 2: the open plan's state could not be rendered within AGENT_LIMITS.planStateBytes in this message (it stays with the C4). */
export const agentOpenStateRefused = (context: AgentMessageContext | undefined) => !!context && refusedStates.has(context);
/** Phase 2: the executor of a message on an open agent plan. Its directory (refs p#/s#, then the pre-load's) is loaded first; the plan's state is
 * rendered after it, so its refs are the ones the model already reads; a state that does not fit leaves the message to the C4 before any call. */
export function agentOpenExecutor(base: AgentLookupExecutor): AgentLookupExecutor {
  return Object.freeze({
    round: base.round.bind(base),
    async directory(context: AgentMessageContext) {
      const loaded = await base.directory(context);
      if (!loaded.ok || !context.open) return loaded;
      let plan: string | null;
      try { plan = context.open.render(context.binding); } catch { plan = null; }
      if (plan === null) { refusedStates.add(context); return { ok: false, code: "AGENT_UNAVAILABLE" } as const; }
      return { ok: true, directory: { ...loaded.directory, plan } } as const;
    },
  });
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
export type AgentContinuationState = AgentFollowUpState & { readonly agentPlan?: string; readonly actionPlan?: PlanLike & { readonly plan_ref?: string } };
/** Phase 2 (S1b rerun, V11): a message on an OPEN plan the agent built goes through the agent, with the plan's state in its context, unless it
 * answers a card (`operationRef`, deterministic) or the pending discard question, the plan has a confirmed cancel or reschedule (its receipt is
 * the C4's to build on), a suspended plan still has an open action, or the conversation is at its turn limit. A plan the C4 built stays the C4's. */
export function agentContinuationEligible(s: AgentContinuationState, operationRef?: string) {
  return !!s.multiActionV2 && !operationRef && !s.pendingDiscard && !!s.actionPlan && !!s.agentPlan && s.actionPlan.plan_ref === s.agentPlan
    && agentPlanOpen(s.actionPlan) && !agentPlanReleased(s.actionPlan) && !(s.suspendedPlans ?? []).some(saved => agentPlanOpen(saved.actionPlan))
    && s.turns < AGENT_FOLLOW_UP_LIMITS.turns;
}
/** Phase 2: an open action of the plan waits on the C4's half-day question (`pending`: its child's pending_temporal_ambiguities count). Such a plan
 * stays with the C4 continuation: the typed answer is the C4's (daypartAnswer against the readings it holds), while the agent could only prove a
 * day part said alone against a clock of an earlier message and would ask the same question again. */
export function agentHalfDayPending(actions: readonly { key: string; status: string }[], pending: (key: string) => number | undefined) {
  return actions.some(action => !terminalActionStatus(action.status) && !!pending(action.key));
}

// ---------------------------------------------------------------- the open plan (Phase 2 continuation)
/** One action of the open agent plan as the session holds it (plain data the app reads from the action and its child; never sent as is). */
export type AgentOpenSource = {
  key: string; operation: string; status: string; issue?: string; missing: readonly string[]; dependsOn: readonly string[]; releasedSlotOf?: string;
  fields: SchedulingFields; names: Readonly<Record<string, string>>; basis: readonly AgentBasis[];
  card?: { kind: string; items: readonly { id: string; name: string }[] };
  /** A change's or cancellation's current slot (local "YYYY-MM-DDTHH:mm"), and the appointment the locate chose. */
  origin?: string; appointment?: string; durationMin?: number;
};
/** The open plan the fact validator checks a continuation against (contract A7; secretary-agent-validator.ts input `open`): every action that is
 * not discarded, with the values the backend already accepted for it. */
const CARD_KINDS = new Set<string>(["customer_ref", "professional_ref", "target_professional_ref", "service_ref", "appointment_ref"]);
const operationOf = (value: string): AgentPlanOperation | undefined => (AGENT_PLAN_OPERATIONS as readonly string[]).includes(value) ? value as AgentPlanOperation : undefined;
const live = (sources: readonly AgentOpenSource[]) => sources.filter(source => source.status !== "DISCARDED" && operationOf(source.operation));
export function agentOpenPlanFacts(sources: readonly AgentOpenSource[]): AgentOpenPlan {
  return { actions: live(sources).map((source): AgentOpenAction => {
    const services = schedulingServiceRefs(source.fields) ?? (source.fields.service_changes_ref?.filter((id): id is string => !!id));
    return { key: source.key, operation: operationOf(source.operation)!, status: source.status === "DONE" ? "DONE" as const : "OPEN" as const,
      fields: structuredClone(source.fields), names: { ...source.names }, basis: structuredClone([...source.basis]),
      ...source.appointment ? { appointment: source.appointment } : {}, ...source.fields.customer_ref ? { customer: source.fields.customer_ref } : {},
      ...services?.length ? { serviceIds: [...services] } : {}, ...source.durationMin ? { durationMin: source.durationMin } : {},
      ...source.card && CARD_KINDS.has(source.card.kind) ? { card: { kind: source.card.kind as AgentCardKind, items: source.card.items.map(item => item.id) } } : {},
      // Micro P0c (CF09 mechanism): whether this action waits on the owner (anything but ready to confirm or done), so an answer changes only it.
      ...agentMicroEnabled() ? { asked: source.status !== "DONE" && source.status !== "READY_FOR_CONFIRMATION" && source.status !== "READY" } : {} };
  }) };
}
/** The state an action shows the model: confirmed, ready to confirm, waiting for a field, or held/failed (to review). */
export function agentOpenState(source: Pick<AgentOpenSource, "status" | "issue">): AgentOpenState {
  const [ready, missing, done, review] = AGENT_OPEN_STATES;
  return source.status === "DONE" ? done : source.status === "READY_FOR_CONFIRMATION" || source.status === "READY" ? ready
    : source.status === "NEEDS_INPUT" && source.issue !== "REVIEW_REQUIRED" ? missing : review;
}
/** The adapter's missing fields as the plan's field names (the model's vocabulary); anything else is left out. */
function missingField(operation: string, field: string): AgentQuestionField | undefined {
  if (operation === "appointment.cancel" && ["date", "time", "source_date", "source_time"].includes(field)) return "atendimento";
  if (field.startsWith("customer")) return "cliente";
  if (field.startsWith("target_professional")) return "novo_profissional";
  if (field.startsWith("professional")) return "profissional";
  if (field.startsWith("service")) return "servicos";
  return ({ date: "dia", time: "inicio", period: "inicio", end_time: "fim", end_date: "fim", reason: "motivo", appointment_ref: "atendimento", source_date: "atendimento",
    source_time: "atendimento" } as Record<string, AgentQuestionField>)[field];
}
/** Phase 2: the open plan's state for THIS message (agent-prompt.ts agentPlanText), compact JSON: per action its key, operation, state, missing
 * fields, the refs of an open card, the accepted values as refs of this message's binding (p#/s# of the directory; c# bound here with the mask of
 * decision 22: only the registered words the owner wrote in this turn), absolute times and its edges. Never a backend question text, a phone,
 * a price, a reason or a note; a customer the owner did not name now shows as not cited. null: it does not fit AGENT_LIMITS.planStateBytes, or a
 * ref could not be bound (the message stays with the C4). */
export function agentOpenPlanState(sources: readonly AgentOpenSource[], binding: AgentBinding, owner: readonly string[]): string | null {
  const said = agentSaidTokens(owner), customers = new Map<string, string>();
  const customer = (id: string, name: string | undefined) => {
    const known = binding.refOf("c", id);
    const ref = known ?? binding.bind("c", id, { shown: agentCustomerLabel(name ?? "", said) });
    if (!ref) throw Error("AGENT_PLAN_STATE_REF");
    const shown = (binding.entry(ref)?.facts as unknown as { shown?: string } | undefined)?.shown;
    if (shown) customers.set(ref, shown);
    return ref;
  };
  const directory = (kind: "p" | "s", id: string | undefined) => id ? binding.refOf(kind, id) : undefined;
  try {
    const acoes = live(sources).map(source => {
      const f = source.fields, valores: Record<string, unknown> = {};
      if (f.customer_ref) valores.cliente = customer(f.customer_ref, source.names[f.customer_ref]);
      const professional = directory("p", f.professional_ref), target = directory("p", f.target_professional_ref);
      if (professional) valores.profissional = professional;
      if (target) valores.novo_profissional = target;
      const services = (schedulingServiceRefs(f) ?? f.service_changes_ref ?? []).flatMap(id => { const ref = id ? directory("s", id) : undefined; return ref ? [ref] : []; });
      if (services.length) valores.servicos = services;
      if (source.operation !== "appointment.cancel" && f.date && f.time) valores.inicio = `${f.date}T${f.time}`;
      else if (source.operation !== "appointment.cancel" && f.date) valores.dia = f.date;
      if (source.operation === "schedule.block" && f.end_time) valores.fim = `${f.end_date ?? f.date ?? ""}T${f.end_time}`;
      if (source.origin) valores.origem = source.origin;
      const falta = [...new Set(source.missing.flatMap(field => { const name = missingField(source.operation, field); return name ? [name] : []; }))];
      const card = source.card, opcoes = card && !terminalActionStatus(source.status) ? card.items.map(item => card.kind === "customer_ref" ? customer(item.id, item.name)
        : card.kind === "professional_ref" || card.kind === "target_professional_ref" ? directory("p", item.id) : card.kind === "service_ref" ? directory("s", item.id) : undefined) : [];
      return { chave: source.key, operacao: source.operation, estado: agentOpenState(source), ...falta.length ? { falta } : {},
        ...opcoes.length && opcoes.every(Boolean) ? { opcoes } : {}, ...Object.keys(valores).length ? { valores } : {},
        ...source.dependsOn.length ? { depende_de: [...source.dependsOn] } : {}, ...source.releasedSlotOf ? { ocupa_horario_de: source.releasedSlotOf } : {} };
    });
    if (!acoes.length) return null;
    const text = JSON.stringify({ acoes, ...customers.size ? { clientes: [...customers].map(([ref, nome]) => ({ ref, nome })) } : {} });
    return Buffer.byteLength(text, "utf8") <= AGENT_LIMITS.planStateBytes ? text : null;
  } catch { return null; }
}
/** The app's Phase 2 scope of one message: the open plan's keys (done ones apart) and its state, rendered against this message's binding. */
export function agentOpenScope(sources: readonly AgentOpenSource[], owner: readonly string[]): AgentOpenScope {
  const kept = live(sources);
  return { keys: kept.map(source => source.key), done: kept.filter(source => source.status === "DONE").map(source => source.key),
    render: binding => agentOpenPlanState(kept, binding, owner) };
}

// ---------------------------------------------------------------- dismissal (Phase 2; V11: never discard less than the owner said)
/** What the owner's words can name of an open action: its people and services (registered names) and its days and clocks (destination and
 * current slot). */
export type AgentDismissalAction = { key: string; names: readonly string[]; dates: readonly string[]; clocks: readonly string[] };
export type AgentDismissalCode = "AGENT_DISMISSAL_EXCEPTION" | "AGENT_DISMISSAL_ORDINAL" | "AGENT_DISMISSAL_UNMATCHED" | "AGENT_DISMISSAL_DIVERGENT";
export type AgentDismissalScope = { kind: "ALL" } | { kind: "KEYS"; keys: string[] } | { kind: "ASK"; code: AgentDismissalCode };
/** Closed classes (folded): words that keep or exclude part of what is given up, ordinal or contrastive references, and the function words
 * and agenda head nouns that never name a person or a service. */
const KEEP_OR_EXCEPT = /(?<![\p{L}\p{N}])(?:menos|exceto|excecao|salvo|tirando|mantem|mantenha|manter|mantendo|preserva|preserve|fica|ficam|continua|continuam|a nao ser)(?![\p{L}\p{N}])/u;
const ORDINAL = /(?<![\p{L}\p{N}])(?:primeir[oa]s?|segund[oa]s?|terceir[oa]s?|quart[oa]s?|quint[oa]s?|ultim[oa]s?|penultim[oa]s?|outr[oa]s?|\d+\s*[ºª°])(?![\p{L}\p{N}])/u;
const NOT_A_NAME = new Set(["pra", "pro", "pras", "pros", "para", "com", "que", "uma", "umas", "uns", "dos", "das", "nos", "nas", "num", "numa", "por", "pelo", "pela", "pelos",
  "pelas", "sem", "nem", "nao", "sim", "mais", "menos", "tudo", "todo", "toda", "todos", "todas", "isso", "isto", "esse", "essa", "esses", "essas", "este", "esta", "estes",
  "estas", "aquele", "aquela", "aquilo", "disso", "nisso", "daquilo", "desse", "dessa", "deste", "desta", "nesse", "nessa", "neste", "nesta", "ele", "ela", "eles", "elas", "dele", "dela", "deles", "delas", "meu", "minha", "seu", "sua", "tambem", "entao", "mas", "porem",
  "pois", "porque", "quando", "onde", "como", "aqui", "ali", "agora", "ainda", "mesmo", "mesma", "horario", "horarios", "atendimento", "atendimentos", "agendamento",
  "agendamentos", "cliente", "clientes", "marcacao", "marcacoes", "reserva", "reservas", "pedido", "pedidos", "plano", "acao", "acoes", "vez", "hora", "horas"]);
const DAYPARTS: Readonly<Record<string, (minute: number) => boolean>> = { manha: minute => minute < 720, tarde: minute => minute >= 720 && minute < 1080, noite: minute => minute >= 1080 };
const minuteOf = (clock: string) => Number(clock.slice(0, 2)) * 60 + Number(clock.slice(3, 5));
/** The scope of a dismissal from the owner's own words: the dismissal's clause of `message` (`clause`, original offsets; absent on the C4 path:
 * the whole message). M = the open actions whose person, service, day, clock or day part the clause names. No name, day or ordinal: every open
 * action (ALL). Words that name exactly the keys the interpretation gave up (`keys`; null: the whole plan): those (KEYS). ASK (nothing is given
 * up and nothing stays confirmable) on: a keep/exception word anywhere in the message; a denied day or clock, or a negator that is not a bare
 * refusal, in a part of the message outside the clause that names an open action; a part outside the clause that names an open action the
 * keys leave out and that no other request of the plan quotes (`covered`: those quotes' spans; an elliptical "e da X" goes on giving up); a
 * denied day or clock inside the clause; a day, clock or name of the salon (`known`) in the clause that matches no open action; an ordinal
 * without a match; keys that differ from M. Done actions are never in scope. Structural only (closed classes, temporal atoms, registered
 * names); never a list of sentences. */
export function agentDismissalScope(input: { message: string; clause?: readonly [number, number]; keys: readonly string[] | null; actions: readonly AgentDismissalAction[];
  timezone?: string; now: Date; known?: readonly string[]; covered?: readonly (readonly [number, number])[] }): AgentDismissalScope {
  const { message, actions } = input, open = new Set(actions.map(action => action.key)), ask = (code: AgentDismissalCode) => ({ kind: "ASK" as const, code });
  const [from, to] = input.clause ?? [0, message.length];
  // Atoms are found whatever the zone; reading a day or clock needs the salon's (unknown, or a text that cannot be mapped: ask).
  const atoms = temporalAtomSpans(message, input.timezone ?? "UTC", input.now);
  if (!atoms || !input.timezone && atoms.length) return ask("AGENT_DISMISSAL_UNMATCHED");
  const masked = atoms.reduce((text, atom) => `${text.slice(0, atom.start)}${" ".repeat(atom.end - atom.start)}${text.slice(atom.end)}`, message);
  if (KEEP_OR_EXCEPT.test(foldName(masked))) return ask("AGENT_DISMISSAL_EXCEPTION");
  /** What a part [a, b) of the message names: the open actions it matches, and whether it names a day, clock, day part or known name matching none. */
  const mentions = (a: number, b: number) => {
    const matched = new Set<string>();
    let unmatched = false;
    for (const atom of atoms.filter(item => item.start >= a && item.end <= b)) {
      const facts = quoteTemporalFacts(message.slice(atom.start, atom.end), input.timezone!, input.now);
      const hits = actions.filter(action => atom.kind === "date"
        ? action.dates.some(date => facts.dates.includes(date) || facts.days.includes(Number(date.slice(8, 10))) || facts.weekdays.some(day => day.weekday === weekdayOfDateKey(date)))
        : action.clocks.some(clock => facts.clocks.some(said => minuteOf(said) % 720 === minuteOf(clock) % 720)));
      if (!hits.length) unmatched = true;
      for (const hit of hits) matched.add(hit.key);
    }
    for (const word of nameTokens(masked.slice(a, b)).filter(token => [...token].length >= 3 && !NOT_A_NAME.has(token))) {
      const part = Object.hasOwn(DAYPARTS, word) ? DAYPARTS[word] : undefined;
      const names = (list: readonly string[]) => list.some(name => nameTokens(name).some(token => tokenSimilarity(word, token) >= SUGGESTION_THRESHOLD));
      const hits = actions.filter(action => part ? action.clocks.some(clock => part(minuteOf(clock))) : names(action.names));
      if (!hits.length && (part || names(input.known ?? []))) unmatched = true;
      for (const hit of hits) matched.add(hit.key);
    }
    return { matched, unmatched };
  };
  const all = [...open], said = input.keys === null ? null : [...new Set(input.keys)], covered = input.covered ?? [];
  // Outside the clause: a denial that is not a bare refusal, in a part naming an open action, may keep that action (ask); a part naming an open
  // action the keys leave out, that no other request of this plan quotes, may give it up too (ask: never less than the owner said).
  for (const [a, b] of [[0, from], [to, message.length]] as const) for (const [start, end] of punctuationParts(message, a, b)) {
    const denied = atoms.some(atom => atom.negated && atom.start >= start && atom.end <= end) || strayNegator(message.slice(start, end)), named = mentions(start, end).matched;
    if (denied && named.size) return ask("AGENT_DISMISSAL_EXCEPTION");
    if (said !== null && [...named].some(key => !said.includes(key)) && !covered.some(span => span[0] < end && span[1] > start)) return ask("AGENT_DISMISSAL_DIVERGENT");
  }
  if (atoms.some(atom => atom.negated && atom.start >= from && atom.end <= to)) return ask("AGENT_DISMISSAL_EXCEPTION");
  const { matched, unmatched } = mentions(from, to), ordinal = ORDINAL.test(foldName(masked.slice(from, to)));
  if (unmatched) return ask("AGENT_DISMISSAL_UNMATCHED");
  if (said && said.some(key => !open.has(key))) return ask("AGENT_DISMISSAL_DIVERGENT");
  if (!matched.size) return ordinal ? ask("AGENT_DISMISSAL_ORDINAL") : { kind: "ALL" };
  if (said === null) return matched.size === all.length ? { kind: "ALL" } : ask("AGENT_DISMISSAL_DIVERGENT");
  if (said.length !== matched.size || said.some(key => !matched.has(key))) return ask("AGENT_DISMISSAL_DIVERGENT");
  return matched.size === all.length ? { kind: "ALL" } : { kind: "KEYS", keys: all.filter(key => matched.has(key)) };
}
/** The punctuation-bounded parts of message[a, b) (original offsets). */
function punctuationParts(message: string, a: number, b: number): [number, number][] {
  const parts: [number, number][] = [];
  let start = a;
  for (let at = a; at <= b; at++) if (at === b || /[,.;!?()\n]/.test(message[at])) { if (message.slice(start, at).trim()) parts.push([start, at]); start = at + 1; }
  return parts;
}
/** A negator in `text` that is not a bare refusal (alone before punctuation or the end, after interjections and connectives only). */
function strayNegator(text: string): boolean {
  const folded = foldName(text);
  for (const match of folded.matchAll(/(?<![\p{L}\p{N}])(?:nao|nunca|nem|jamais)(?![\p{L}\p{N}])/gu)) {
    const before = folded.slice(0, match.index!).split(/[^\p{L}\p{N}]+/u).filter(Boolean), after = folded.slice(match.index! + match[0].length);
    if (!(/^\s*(?:[,.;!?…\n]|$)/u.test(after) && before.every(word => LEAD_WORDS.has(word)))) return true;
  }
  return false;
}
const DATE_KEY = /^\d{4}-\d{2}-\d{2}$/, CLOCK = /^(?:[01]\d|2[0-3]):[0-5]\d$/;
/** The open actions (never a done one) as a dismissal can name them: registered names of their accepted people and services (and the owner's
 * own words still unresolved), their days and clocks (destination, end and current slot). */
export function agentDismissalActions(sources: readonly AgentOpenSource[]): AgentDismissalAction[] {
  return live(sources).filter(source => !terminalActionStatus(source.status)).map(source => {
    const f = source.fields, ids = [f.customer_ref, f.professional_ref, f.target_professional_ref, f.service_ref, ...f.service_list_ref ?? [], ...f.service_changes_ref ?? []];
    const names = [...ids.flatMap(id => id && source.names[id] ? [source.names[id]] : []), ...[f.customer_name, f.professional_name, f.target_professional_name, f.service_name,
      ...f.service_names ?? [], ...(f.service_changes ?? []).map(item => item.service_name)].filter((name): name is string => !!name)];
    const dates = [f.date, f.source_date, f.end_date, source.origin?.slice(0, 10)].filter((date): date is string => !!date && DATE_KEY.test(date));
    const clocks = [f.time, f.source_time, f.end_time, source.origin?.slice(11, 16)].filter((clock): clock is string => !!clock && CLOCK.test(clock));
    return { key: source.key, names: [...new Set(names)], dates: [...new Set(dates)], clocks: [...new Set(clocks)] };
  });
}
/** Micro P0b: the patched keys of a typed PATCH and the owner's literals of their values (every string of the delta but its structure: the
 * operation, keys, links, the clause quote and a card choice). */
const PATCH_STRUCTURE = new Set(["operation", "item_key", "depends_on", "released_slot_of", "same_as", "source_scope", "choice", "destination_mode", "override_requested"]);
export function agentPatchTargets(operations: readonly object[]): { key: string; literals: string[] }[] {
  const strings = (value: unknown): string[] => typeof value === "string" ? [value] : Array.isArray(value) ? value.flatMap(strings)
    : value && typeof value === "object" ? Object.values(value).flatMap(strings) : [];
  return operations.flatMap(op => { const key = (op as { item_key?: unknown }).item_key;
    return typeof key === "string" ? [{ key, literals: Object.entries(op).flatMap(([name, value]) => PATCH_STRUCTURE.has(name) ? [] : strings(value)) }] : []; });
}
/** Micro P0b (CE02 mechanism, flag SALON_SECRETARY_AGENT_MICRO): the C4 envelope carries one mode per turn (PATCH or DISCARD). A PATCH whose
 * message also speaks of an open action it leaves out may withdraw or change that action too: true, and the turn is held and asked (nothing
 * applies). Outside the patch's own literals (`patches`), the message speaks of a left-out action when (i) a word (≥ 3 letters) is close to a
 * word of its people's or services' names (agentDismissalActions: registered names and the owner's words, professionals included) and to no
 * word of the patched actions' names nor of the patch; (ii) a day or clock atom matches its days or clocks and no patched action's; or (iii) a
 * part outside the patch's clauses that names no patched action holds an ordinal or alterity word or a negator that is not a bare refusal
 * (closed classes). An unreadable message holds. Registered names, temporal atoms and closed classes only; never a list of sentences. */
export function agentPatchLeavesNamed(input: { message: string; sources: readonly AgentOpenSource[]; patches: readonly { key: string; literals: readonly string[] }[];
  timezone?: string; now: Date }): boolean {
  const { message } = input, keys = new Set(input.patches.map(item => item.key)), actions = agentDismissalActions(input.sources);
  const left = actions.filter(action => !keys.has(action.key)), mine = actions.filter(action => keys.has(action.key));
  if (!left.length) return false;
  const literals = input.patches.flatMap(item => item.literals).filter(literal => literal.trim());
  const spans = literals.flatMap(literal => literalProofSpans(message, literal)), free = (a: number, b: number) => !spans.some(span => span[0] < b && a < span[1]);
  const atoms = temporalAtomSpans(message, input.timezone ?? "UTC", input.now);
  if (!atoms || !input.timezone && atoms.length) return true;
  const hit = (atom: (typeof atoms)[number], action: AgentDismissalAction) => {
    const facts = quoteTemporalFacts(message.slice(atom.start, atom.end), input.timezone!, input.now);
    return atom.kind === "date"
      ? action.dates.some(date => facts.dates.includes(date) || facts.days.includes(Number(date.slice(8, 10))) || facts.weekdays.some(day => day.weekday === weekdayOfDateKey(date)))
      : action.clocks.some(clock => facts.clocks.some(said => minuteOf(said) % 720 === minuteOf(clock) % 720));
  };
  if (atoms.some(atom => free(atom.start, atom.end) && left.some(action => hit(atom, action)) && !mine.some(action => hit(atom, action)))) return true;
  const masked = atoms.reduce((text, atom) => `${text.slice(0, atom.start)}${" ".repeat(atom.end - atom.start)}${text.slice(atom.end)}`, message);
  const tokens = (names: readonly string[]) => names.flatMap(name => nameTokens(name)).filter(token => [...token].length >= 3 && !NOT_A_NAME.has(token));
  const close = (word: string, list: readonly string[]) => list.some(token => tokenSimilarity(word, token) >= SUGGESTION_THRESHOLD);
  const patched = tokens(mine.flatMap(action => action.names)), own = [...patched, ...tokens(literals)], others = tokens(left.flatMap(action => action.names));
  const named = (a: number, b: number, list: readonly string[]) => [...masked.slice(a, b).matchAll(/[\p{L}\p{N}][\p{L}\p{M}\p{N}'’-]*/gu)]
    .filter(match => free(a + match.index!, a + match.index! + match[0].length)).flatMap(match => tokens([match[0]])).filter(word => close(word, list) && !close(word, own));
  if (named(0, message.length, others).length) return true;
  const clauses = spans.map(span => { const bounds = clauseBounds(message, span[0], span[1]); return bounds ? [bounds.start, bounds.end] as const : span; }).sort((x, y) => x[0] - y[0]);
  const rest: [number, number][] = [];
  let at = 0;
  for (const [start, end] of clauses) { if (start > at) rest.push([at, start]); at = Math.max(at, end); }
  if (at < message.length) rest.push([at, message.length]);
  return rest.some(([a, b]) => punctuationParts(message, a, b).some(([start, end]) => !tokens([masked.slice(start, end)]).some(word => close(word, patched)) &&
    (ORDINAL.test(foldName(masked.slice(start, end))) || strayNegator(message.slice(start, end)))));
}
export const AGENT_UNCLEAR_TURN_NOTICE = "Não ficou claro o que devo descartar ou mudar nesta mensagem. Nada foi alterado, e as ações deste plano saíram do Confirmar. O que devo fazer com cada uma?";
export const AGENT_MIXED_TURN_NOTICE ="Sua mensagem mexe em mais de um pedido deste plano e não consegui aplicar tudo junto. Nada foi alterado, e as ações deste plano saíram do Confirmar. O que devo fazer com cada uma?";
/** The dismissal's clause of a message (original offsets, from its governing lead): the backend's clause around the model's quote when the quote
 * occurs exactly once; undefined otherwise (the whole message is read: it can only name more and ask more). */
export function agentDismissalClause(message: string, quote: string | undefined): [number, number] | undefined {
  if (!quote) return undefined;
  const found = literalProofSpans(message, quote);
  if (found.length !== 1) return undefined;
  const clause = clauseBounds(message, found[0][0], found[0][1]);
  return clause ? [clause.lead, clause.end] : undefined;
}
/** The parts of a message other requests of the plan quote (agentDismissalScope `covered`): each quote that occurs exactly once (one that does not
 * covers nothing, so the dismissal can only ask more). */
export function agentQuoteSpans(message: string, quotes: readonly string[]): [number, number][] {
  return quotes.flatMap(quote => { const found = quote.trim() ? literalProofSpans(message, quote) : []; return found.length === 1 ? [[found[0][0], found[0][1]] as [number, number]] : []; });
}
/** A negator standing alone (followed by punctuation or the end of the message), with nothing before it in its sentence but interjections and
 * connectives (closed classes): the owner refuses something without saying what. Read only on an open plan, when the model returned neither a
 * dismissal nor a change (the ready proposals then leave the Confirmar). */
const LEAD_WORDS = new Set(["ah", "ahn", "oh", "opa", "ops", "hum", "hmm", "eh", "e", "mas", "olha", "pois", "entao", "ai", "ixi", "puts", "bom", "ta", "certo"]);
export function agentLooseNegator(message: string): boolean {
  const folded = foldName(message);
  for (const match of folded.matchAll(/(?<![\p{L}\p{N}])(?:nao|nunca|nem|jamais)(?![\p{L}\p{N}])\s*(?=[,.;!?…\n]|$)/gu)) {
    const start = match.index!, sentence = folded.slice(0, start).split(/[.;!?\n]/u).at(-1) ?? "";
    if (sentence.split(/[^\p{L}\p{N}]+/u).filter(Boolean).every(word => LEAD_WORDS.has(word))) return true;
  }
  return false;
}
/** Phase 2 notices (pt-BR, backend text). */
export const AGENT_DISMISSAL_ASK_NOTICE = "Não ficou claro de qual pedido você desistiu. Nada foi descartado, e as ações deste plano saíram do Confirmar até você dizer o que devo descartar (ou usar Descartar em cada uma).";
export const AGENT_UNCLEAR_DISMISSAL_NOTICE = "Não ficou claro o que você recusou. As ações que estavam prontas saíram do Confirmar até você revisar.";
export const AGENT_PATCH_DONE_NOTICE = "Uma ação já confirmada não muda por aqui: para alterar o que já foi feito, peça a alteração do agendamento.";
export const AGENT_PATCH_HELD_NOTICE = "Não consegui aplicar o que você pediu numa ação deste plano; ela saiu do Confirmar até você revisar.";
export const AGENT_DISMISSAL_PENDING_NOTICE = "Responda primeiro sobre o descarte acima; o restante desta mensagem não foi aplicado.";
/** A patch of an open action (Phase 2): the same prepare() on the action's own child (its draft and revision go on), with the validator's values
 * (the open values it inherited and what this message changed). A half-day question still open for a field this message did not fill stays; one
 * for a field it filled leaves. */
export async function prepareAgentPatch(actor: ServiceActor, c: SchedulingState, outcome: AgentActionOutcome,
  slot: (key: string, released: boolean) => AgentPreparedSlot | undefined): Promise<AgentPrepared> {
  const filled = new Set(Object.keys(outcome.fields)), asked = new Set(outcome.ambiguities.map(item => item.field));
  const kept = (c.pending_temporal_ambiguities ?? []).filter(item => !filled.has(item.field) && !asked.has(item.field));
  if (kept.length) c.pending_temporal_ambiguities = kept; else delete c.pending_temporal_ambiguities;
  return prepareAgentScheduling(actor, c, { ...outcome, ambiguities: [...kept, ...outcome.ambiguities] }, slot);
}
/** The cancellation of an open plan as an action outcome, for the atomic cancel→create pair a later message asks for (`ocupa_horario_de`): its
 * accepted fields (prepareAgentBatch locates the appointment again, never from a ref) and registered names. */
export function agentOpenCancelOutcome(source: AgentOpenSource): AgentActionOutcome {
  return { key: source.key, operation: "appointment.cancel", status: "READY", fields: structuredClone(source.fields), cleared: [], card: null, question: null, asked: null,
    ambiguities: [], origin: null, derived: null, recurrence: null, dependsOn: [], releasedSlotOf: null, basis: [], premises: [], note: [], notice: null, codes: [],
    names: { ...source.names } };
}
/** New actions of a continuation (keys that are not in the open plan): the dropped ones and their dependents leave; an edge to an open action
 * stays outside the selection (`external`, set on the plan actions after createActionPlan); a key equal to a discarded action's is renamed. */
export type AgentAppendSkeleton = { selection?: CapabilitySelection; outcomes: ReadonlyMap<string, AgentActionOutcome>; external: ReadonlyMap<string, { dependsOn: string[]; releasedSlotOf: string | null }>;
  dropped: string[]; notices: string[] };
export function agentAppendSkeleton(actions: readonly AgentActionOutcome[], open: ReadonlySet<string>, taken: ReadonlySet<string>): AgentAppendSkeleton {
  const rename = new Map<string, string>(), used = new Set([...taken, ...actions.map(action => action.key)]);
  for (const action of actions) if (taken.has(action.key)) {
    let n = 2, key = "";
    do key = `${action.key.slice(0, 28)}_${n++}`; while (used.has(key));
    used.add(key); rename.set(action.key, key);
  }
  const keyOf = (key: string) => rename.get(key) ?? key;
  const renamed = actions.map(action => ({ ...action, key: keyOf(action.key), dependsOn: action.dependsOn.map(dep => open.has(dep) ? dep : keyOf(dep)),
    releasedSlotOf: action.releasedSlotOf === null ? null : open.has(action.releasedSlotOf) ? action.releasedSlotOf : keyOf(action.releasedSlotOf) }));
  const keys = new Set(renamed.map(action => action.key)), dropped = new Set(renamed.filter(action => action.status === "DROP").map(action => action.key)), direct = new Set(dropped);
  for (let grown = true; grown;) {
    grown = false;
    for (const action of renamed) if (!dropped.has(action.key) && [...action.dependsOn, ...action.releasedSlotOf ? [action.releasedSlotOf] : []]
      .some(key => dropped.has(key) || !keys.has(key) && !open.has(key))) { dropped.add(action.key); grown = true; }
  }
  const kept = renamed.filter(action => !dropped.has(action.key));
  const notices = [...[...dropped].some(key => !direct.has(key)) ? [AGENT_DEPENDENT_NOTICE] : []];
  const external = new Map(kept.map(action => [action.key, { dependsOn: action.dependsOn.filter(key => open.has(key)),
    releasedSlotOf: action.releasedSlotOf !== null && open.has(action.releasedSlotOf) ? action.releasedSlotOf : null }]));
  if (!kept.length) return { outcomes: new Map(), external: new Map(), dropped: [...dropped], notices };
  const internal = (action: AgentActionOutcome) => action.dependsOn.filter(key => !open.has(key));
  const selection = validateSelectionV2({ skills: ["scheduling"], independent: !kept.some(action => internal(action).length), operations: kept.map(action => ({
    operation: action.operation, item_key: action.key, depends_on: internal(action),
    released_slot_of: action.releasedSlotOf !== null && !open.has(action.releasedSlotOf) ? action.releasedSlotOf : null,
    target_name: null, name: null, priceCents: null, durationMin: null, phone: null, email: null, requested_fields: [], clear_fields: [] })) });
  return { selection, outcomes: new Map(kept.map(action => [action.key, action])), external, dropped: [...dropped], notices };
}

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
/** Micro P0a (CE10 mechanism, flag SALON_SECRETARY_AGENT_MICRO): a derived fill (a released slot, the gap between bookings, a sequence) never
 * overwrites a field the action already states. A stated value that differs from the derived one (a professional the owner named, by its ref
 * or by the owner's words prepare() still resolves, that is not the slot's; a day, clock or end the derived one does not give) is a mismatch:
 * the derived values never stand and the backend asks (only questions are added). `names`: the registered names of the slots' professionals. */
function derivedConflict(own: SchedulingFields, derived: SchedulingFields, names: readonly string[]): boolean {
  return (Object.keys(derived) as (keyof SchedulingFields)[]).some(key => {
    if (own[key] !== undefined) return JSON.stringify(own[key]) !== JSON.stringify(derived[key]);
    if (key !== "professional_ref" || !own.professional_name) return false;
    const said = nameTokens(own.professional_name).filter(token => [...token].length >= 3 && !NOT_A_NAME.has(token)), slot = new Set(names.flatMap(name => nameTokens(name)));
    return !said.length || said.some(token => !slot.has(token));
  });
}
/** Micro P0a on the C4 path the agent falls back to (salon-secretary releasedOrigin/followReferences): `agentNameInMessage`, the owner wrote a
 * word (≥ 3 letters) of the professional the model gave the create inside that create's own clause (`clause`, original offsets), and no
 * occurrence of it is denied (the C4's entity denial: a negator of its clause, a privative "sem"): stated by the owner, not copied from
 * another action nor refused. `withoutReleasedProfessional`: the released origin without its professional (seeded, waiting or asked), marked
 * `ownProfessional`, so the create keeps the one the owner named and the link seeds and follows only the slot's day and clock. */
export type AgentMicroReferences = SchedulingReferences & { ownProfessional?: true };
export function agentNameInMessage(message: string, name: string, clause: readonly [number, number]): boolean {
  const found = nameTokens(name).filter(token => [...token].length >= 3 && !NOT_A_NAME.has(token)).flatMap(token => literalSpans(message, token));
  return found.some(span => span[0] >= clause[0] && span[1] <= clause[1]) && !found.some(span => entityQuoteDenied(message, span[0], span[1], "appointment.create"));
}
/** `agentOwnProfessional`: the create's own clause is its `source_scope`, found exactly once in the message and meeting no sibling's (also found
 * once); without such a clause nothing is the owner's (the C4's rule stands). */
export function agentOwnProfessional(message: string, op: object, siblings: readonly object[]): boolean {
  const field = (item: object, key: string) => (item as Record<string, unknown>)[key];
  const clauseOf = (item: object): [number, number] | undefined => { const scope = field(item, "source_scope");
    if (typeof scope !== "string" || !scope.trim()) return undefined;
    const at = message.indexOf(scope);
    return at >= 0 && message.indexOf(scope, at + 1) < 0 ? [at, at + scope.length] : undefined; };
  const name = field(op, "professional_name"), clause = clauseOf(op);
  if (typeof name !== "string" || !clause) return false;
  if (siblings.some(item => item !== op && field(item, "item_key") !== field(op, "item_key") && (other => !!other && other[0] < clause[1] && clause[0] < other[1])(clauseOf(item)))) return false;
  return agentNameInMessage(message, name, clause);
}
export function withoutReleasedProfessional<T extends { fields: { professional_ref?: string; professional_name?: string }; state: SchedulingReferences }>(origin: T): T {
  const fields = { ...origin.fields }, seeded = origin.state.seeded ? { ...origin.state.seeded } : undefined;
  delete fields.professional_ref; delete fields.professional_name;
  if (seeded) delete seeded.professional;
  const others = (list: readonly SameAsField[] | undefined) => list?.filter(field => field !== "professional");
  const state: AgentMicroReferences = { ...origin.state, ...seeded ? { seeded } : {}, ...origin.state.waiting ? { waiting: others(origin.state.waiting) } : {},
    ...origin.state.asked ? { asked: others(origin.state.asked) } : {}, ownProfessional: true };
  return { ...origin, fields, state };
}
/** One single action through prepare(), with the validator's effects: READY prepares (prepare() may still ask a field, as in the C4); ASK
 * prepares the draft and shows the backend's card or question instead of a proposal; a derived value (V13) is recomputed from the referenced
 * action's prepared slot (`slot`), the model's value must agree, else the field is asked. */
export async function prepareAgentScheduling(actor: ServiceActor, c: SchedulingState, outcome: AgentActionOutcome,
  slot: (key: string, released: boolean) => AgentPreparedSlot | undefined): Promise<AgentPrepared> {
  let fields = withNames(outcome);
  const basis: AgentBasis[] = [...outcome.basis], premises: string[] = [], codes: string[] = [];
  let references: SchedulingReferences | undefined;
  const derived = outcome.derived, missing: ("date" | "time")[] = [...outcome.temporalMissing ?? []];
  let conflict: AgentValidatorCode | undefined;
  if (derived) {
    const released = derived.type === "LIBERADO_POR";
    let checked = agentDerivedCheck(derived, key => slot(key, released));
    // Micro P0a (flag SALON_SECRETARY_AGENT_MICRO): a value the action states that the derived fill would overwrite is a mismatch (asked).
    if (agentMicroEnabled() && checked.status === "OK" && derivedConflict(fields, checked.fields, derived.keys.flatMap(key => slot(key, released)?.professional_name ?? []))) {
      conflict = derived.type === "SEQUENCIA" ? "AGENT_SEQUENCE_MISMATCH" : derived.type === "ENTRE_ACOES" ? "AGENT_BETWEEN_MISMATCH" : "AGENT_RELEASE_MISMATCH";
      checked = { status: "MISMATCH", code: conflict };
    }
    // A released slot's link is the C4's own (syncReferences follows the move; the executor re-checks the committed agenda): no V23 basis.
    if (checked.status === "OK") { fields = { ...fields, ...checked.fields }; if (!released) basis.push(checked.basis); premises.push(checked.premise); }
    else {
      for (const key of ["date", "time", "end_date", "end_time"] as const) delete fields[key];
      codes.push(checked.status === "WAIT" ? "AGENT_DERIVED_WAIT" : checked.code);
      // Round 2 (settle): a change's derived day and clock that do not stand are asked like F0's (the draft's temporal_missing): with an
      // alteration prepare() would otherwise keep the appointment's slot in their place.
      if (outcome.operation === "appointment.change" && (fields.target_professional_ref || fields.target_professional_name || fields.service_changes?.length))
        for (const key of ["date", "time"] as const) if (!missing.includes(key)) missing.push(key);
    }
    // A create in the slot a reschedule of this plan frees: checked with that appointment moved out (the executor re-checks after the move);
    // syncReferences keeps following that move afterwards (the C4's released-origin link).
    if (released && outcome.releasedSlotOf && !conflict) references = {};
  }
  const card = outcome.card, asked = outcome.status === "ASK";
  // Round 2 (review C2): a change's new day or clock the owner wrote and no field carries is prepare()'s own temporal question (the draft's
  // temporal_missing, with its waiting field), so it outlives a card click or any later preparation and the appointment's own value never fills
  // it; the validator's text for that same question is not said twice.
  const extras: AgentResolvedExtras = { ambiguities: outcome.ambiguities, basis, names: outcome.names, recurrence: outcome.recurrence, ...references ? { references } : {},
    ...outcome.origin?.expected ? { expected: outcome.origin.expected } : {}, ...missing.length ? { missing: [...missing] } : {} };
  const inherited = outcome.question?.code === "AGENT_ORIGIN_INHERITED" && (missing as string[]).includes(outcome.question.field ?? "");
  if (asked && card?.kind === "appointment_ref") extras.appointmentCard = card.items;
  else if (asked && card && (card.kind === "professional_ref" && !fields.professional_name || card.kind === "target_professional_ref")) {
    const kind = card.kind === "professional_ref" ? "professional_ref" as const : "target_professional_ref" as const;
    extras.card = { kind, items: card.items, question: kind === "professional_ref" ? AGENT_PROFESSIONAL_CARD : AGENT_QUESTIONS.AGENT_TARGET_UNSAID ?? AGENT_PROFESSIONAL_CARD };
  }
  // A card of names the owner wrote (customer, service, professional homonyms) is prepare()'s own (its fields carry the owner's words); an
  // action the validator asks about never gets a proposal meanwhile: its question (or that card's) holds it, prepare()'s own question follows.
  if (asked && !extras.card && !inherited) extras.question = outcome.question?.text ?? (card && card.kind !== "appointment_ref" ? CARD_QUESTIONS[card.kind] : undefined);
  // Micro P0a: the mismatch is asked in the validator's words, the derived link dropped (nothing re-derives over the stated value).
  if (conflict && !extras.card && !extras.appointmentCard) extras.question ??= AGENT_QUESTIONS[conflict];
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
/** Phase 2 telemetry of a continuation: the dismissal's scope, patches applied and actions added (counts and closed values only). */
export type AgentContinuationTelemetry = { discard?: AgentDismissalScope["kind"]; patches: number; added: number };
export type AgentOutcomeInput = { loop?: AgentLoopTelemetry; path: AgentTurnOutcome["path"]; code: string | null; validation?: AgentValidation; questionField?: string | null;
  premises?: number; locateDisagree?: number; followUp?: boolean; continuation?: AgentContinuationTelemetry };
/** S1 additions, present only when they apply: the effort of each call when they differed (A4), the message's preload (B1,
 * SALON_SECRETARY_AGENT_PRELOAD) and a follow-up on a closed plan (B2); the router's whitelist (secretary-router.ts safeAgent) keeps them.
 * Phase 2 (`continuation`, `discard`, `patches`, `added`): set here; the router keeps them only once its whitelist names them. */
export type AgentTurnOutcomeExtra = AgentTurnOutcome & { preload?: AgentPreloadTelemetry; follow_up?: true; continuation?: true; discard?: AgentDismissalScope["kind"];
  patches?: number; added?: number };
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
    ...lookups?.preload ? { preload: lookups.preload } : {}, ...input.followUp ? { follow_up: true as const } : {},
    ...input.continuation ? { continuation: true as const, ...input.continuation.discard ? { discard: input.continuation.discard } : {}, patches: input.continuation.patches,
      added: input.continuation.added } : {} };
}
