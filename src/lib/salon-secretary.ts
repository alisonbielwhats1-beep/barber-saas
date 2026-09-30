import { firstTemporalAmbiguity, temporalAmbiguityQuestion } from "./scheduling-temporal-ambiguity";
import { firstCalendarConflict, calendarConflictQuestion } from "./scheduling-calendar-conflict";
import { prepareDeferredReadFields } from "./secretary-deferred-read";
import { proposalHasExpired, expiredProposalMessage } from "./secretary-proposal-lifetime";
import { sameAcceptedQuery } from "./secretary-entity-context";
import { SecretaryRouteRequest, SecretaryNewRequest, SecretaryResumeRequest, SecretaryDiscardRequest, withConversationRouting, withSalonDirectory, refreshActionPlan, withExamplesObserver,
  terminalActionStatus, discardNotice, discardQuestion, reviewRequiredMessage, operationChoice, type OptionChoice, isInterpretationFailure, markInterpretationFailure, rejectedPartsNotice, type RejectedPart,
  continuationDraft, continuationRequirements, routedTurnRequirements, secretaryContractVersion, sameAsEnabled, referenceWaitingNote, referenceConflictNotice,
  referencesV2Enabled, type PlanAction, type SameAsReference, type SameAsField } from "@everflair/salon-secretary";
import { referencedValues, referenceKey, referenceLiteralProven, ownValue, withoutOwn, seededFields, referencesKey, referenceGone, nameAgrees, selfReferenceProven, selfHolder, distributiveReferenceProven,
  referenceSetOutcome, seededListFields, serviceListKey, ownLiteralSpan, ownLiteralValue, withOwnLiteral, type OwnLiteral, pronounReferent, betweenBookingsSpan, betweenBookingsGap,
  type BookedSlot } from "./secretary-same-as";
import { literalOverrideConsent } from "./scheduling-conflict-contract";
import { communicationState, applyCommunicationInterpretation, sendCommunicationTurn, selectCommunication, communicationChannelFastPath, startCancellationMessage, reseedCommunication, type CommunicationState } from "./secretary-communication";
import { assertCommunicationAccess, confirmCustomerMessage, dispatchLocalMessage, communicationMetrics } from "./communication-actions";
import { FakeCommunicationProvider } from "./communication-provider";
import { inventoryState, applyInventoryInterpretation, sendInventoryTurn, selectInventory, inventoryQuantityFastPath, persistInventoryMetrics, type InventoryState } from "./secretary-inventory";
import type { InventoryQuantityWitness } from "./inventory-quantity";
import type { InventoryOperationScope } from "./inventory-source-scope";
import { assertInventoryAccess } from "./inventory-catalog";
import { confirmStockMovement } from "./inventory-actions";
import { assertFinancialAccess, financialState, applyFinancialInterpretation, sendFinancialTurn, persistFinancialMetrics, type FinancialState, type FinancialPeriodReferences } from "./secretary-financial";
import { startBatch, startReleasedSlotBatch, prepareBatch, sendBatchTurn, selectBatch, persistBatchMetrics, groundBatchPatch, type BatchState } from "./secretary-batch";
import { projectSchedulingOperation } from "./secretary-operation-projection";
import { actionScopedSource, foreignClauses } from "./secretary-sibling-scope";
import { withTemporalTurnDrafts, type TemporalTurnDraft } from './secretary-temporal-turn';
import { confirmActionBatch } from "./scheduling-batch";
import { schedulingPatch } from "./scheduling-contract";
import { schedulingTimezone, secretaryDirectory, getSchedulingAppointment, listSchedulingProfessionals } from "./scheduling-catalog";
import { quoteTemporalFacts, temporalQuoteDenied } from "./scheduling-temporal-source";
import { schedulingActionSnapshot } from "./scheduling-mutations";
import { performance } from "node:perf_hooks";
import { schedulingState, schedulingSourceTimeReply, applySchedulingInterpretation, sendSchedulingTurn, selectScheduling, persistSchedulingMetrics, schedulingChoiceAgrees, reseedScheduling, type SchedulingState, type SchedulingReferences } from "./secretary-scheduling";
import { confirmAppointmentCreate } from "./scheduling-actions";
import type { SchedulingInterpretation } from "@everflair/salon-secretary";
import { assertCustomerAccess } from "./customer-catalog";
import { customerState, sendCustomerTurn, applyCustomerInterpretation, selectCustomer, type CustomerState } from "./secretary-customers";
import { confirmCustomerChange } from "./customer-actions";
import { randomUUID } from "node:crypto";
import { z } from "zod";
import { runServicesTurn, instrumentServicesModel, loadSkills, operationSkill, withRequestBudgetObserver, withServiceListObserver, requestTooLargeMessage, REQUEST_TOO_LARGE, type ServicePatch, type CustomerInterpretation, type Model } from "@everflair/salon-secretary";
import { assertServiceWriter, findCatalogServices, type ServiceActor } from "./service-catalog";
import { getOperationRequirements } from "./service-contract";
import { upsertActionDraft, proposeServiceCreate, proposeServiceChange, confirmServiceCreate, confirmServiceInput } from "./service-create-mvp";
import type { ServiceMvpFields } from "./service-contract";
import { withTenant } from "./prisma-tenant";
import { usageRecorder } from "./salon-secretary-usage";
import { normalizeSecretaryServiceName } from "./secretary-service-name";
import { secretaryFastPath } from "./secretary-fast-path";
import { AsyncLocalStorage } from "node:async_hooks";
import { RouterTrace, tryJevInterpretation, outcomeCode, type RouterOptions } from "./secretary-router";
import { createActionPlan, assessPlanAction, executeConfirmationGroup,
  runtimeReviewConfiguration, type ActionPlan, type ReviewConfiguration, type CapabilitySelection,
  groupConfirmationInput, readyGroupsConfirmationInput, admitConfirmationBatch, confirmationGroupContent,
  validateSelectionV2, actionSelection, markSecretaryTiming, type ActionAssessment, type SelectedOperation } from "@everflair/salon-secretary";
import { actionUnits, unitSelection, assessmentFromView, deferredReadAssessment, collectedActionFields, viewProposal, type ActionUnit } from "./secretary-action-plan";
import { secretaryPlanMessage, planConversationContext, presentationHints, planOptions } from "./secretary-presentation";
import { optionIndex, slotOptions, splitChoiceDelta, nameEchoAgrees, deltaHasContent, appointmentEchoRoles, writesOptionName, choiceVerdict, type PublishedOption, type SecretaryOption } from "./secretary-options";
import { literalProofSpans } from "../../packages/salon-secretary/src/literal-match";
import { clarificationContext } from "./secretary-clarification";
import { unsupportedTurnNotice, recurrenceOperation, recurrenceFromTurn, RECURRENCE_CARD, type RecurrenceState } from "./secretary-recurrence";
import { recurrenceGuardEnabled } from "../../packages/salon-secretary/src/recurrence-guard";
import { turnBaseline, turnOutcome, droppedFields, reachedInterpretation, type TurnBaseline } from "./secretary-turn-outcome";
import { actionMark, agendaFallbackNotice, clarificationAttempt, clarificationsView, planQuestions, recordClarifications,
  type ClarificationHistory, type SecretaryClarification } from "./secretary-clarification-history";
import { formatClock, formatLocal } from "./secretary-datetime-format";
import { withTemporalShadowObserver } from "./scheduling-temporal-mode";
import { withNameObserver, salonDirectoryNames } from "./entity-suggestions";
import { backendPresentationDigest } from "./secretary-presentation-contract";
import { secretaryCopyV2Enabled, secretaryErrorMessage } from "./secretary-error-copy";
import { CONVERSATION_STATE_SCHEMA, decodeConversationState, encodeConversationState, type ConversationEventKind, type ConversationEventPayload,
  type ConversationRecord, type LoadedConversation, type SecretarySessionStore } from "./secretary-session-store";
import { parseStoredAggregate, STORED_AGGREGATE_SCHEMA, type StoredSession } from "./secretary-session-state";

type Draft = Awaited<ReturnType<typeof upsertActionDraft>>;
type Proposal = Awaited<ReturnType<typeof proposeServiceCreate>>;
type Receipt = Awaited<ReturnType<typeof confirmServiceCreate>>;
type Candidates = Awaited<ReturnType<typeof findCatalogServices>>;
type CapabilityStatus = "SUPPORTED" | "NEEDS_INPUT" | "AMBIGUOUS" | "UNSUPPORTED" | "BLOCKED" | "CONVERSATION";
type SuspendedPlan = Pick<Session, "actionPlan" | "actionUnits" | "children" | "loaded" | "groupReceipts">;
type Session = { suspendedPlans?: SuspendedPlan[]; conversationNotice?: string; groupReceipts?: Set<string>; actionPlan?: ActionPlan; actionUnits?: ActionUnit[]; planOwner?: string; multiActionV2?: boolean; inheritedInterpretation?: boolean; communication?: CommunicationState; inventory?: InventoryState; financial?: FinancialState; batch?: BatchState; scheduling?: SchedulingState; children?: string[]; loaded?: { skill_id: string; version: string; manual_hash: string }[]; skill: "services" | "customers" | "scheduling" | "financial" | "inventory" | "communication" | "auto"; customer?: CustomerState; id: string; actor: ServiceActor; expires: number; busy: boolean; turns: number;
  operation?: "service.create" | "service.change"; notice?: string; capability_status?: CapabilityStatus;
  acceptedServiceQuery?: string; proposalExpired?: boolean; deferredFinancialReferences?:FinancialPeriodReferences;
  pending?: { query?: string; patch: Partial<ServiceMvpFields>; candidates: Candidates };
  /** Router telemetry only: keyed hashes of the previous turn's questions (bounded) and their per-session key. */
  questionFingerprints?: string[]; telemetrySalt?: string;
  /** B4: the option cards published to Luna for THIS turn (plan-bound; cleared when the turn ends). */
  optionBinding?: { plan_ref: string; options: Record<string, PublishedOption[]> };
  /** B5: what this reply must say before the plan (parts left out), or instead of it (`alone`: an unreadable
   * answer). One reply only: cleared when the next call on the session starts, so it never outlives its turn. */
  turnNotice?: { text: string; alone?: boolean };
  /** B3 (review 2b): a discard the backend asked about (it would also close linked actions). Published once to
   * the next routing context; a DISCARD answer within these keys then discards exactly this set. */
  pendingDiscard?: { plan_ref: string; keys: string[]; question: string };
  /** B6: per open question of the active plan, its fingerprint and the user turns in a row it was asked.
   * Updated once per user message (never in view()); in memory only. */
  clarificationHistory?: ClarificationHistory;
  /** B7: when the session started (activity extends `expires`, never past 2 h from here); the salon's local date from
   * the last directory read (the screen's year reference); the codes of the last recorded message (owner feedback). */
  created?: number; today?: string; lastOutcome?: { codes: string[]; contract_version?: string };
  draft?: Draft; proposal?: Proposal; receipt?: Receipt; cancelled: boolean };
/** B7 session lifetime: each successful call extends an open conversation to now + 20 min, capped at 2 h from its start.
 * In memory only: a restart or another worker still fails closed. */
const SESSION_IDLE_MS = 20 * 60_000, SESSION_MAX_MS = 2 * 60 * 60_000;
/** Review (B7 × journal): a journal draft expires 30 min after its creation (kept across revisions), so activity never
 * extends a conversation to within this margin of its earliest open draft's expiry. A later call is SESSION_NOT_FOUND,
 * never an EXPIRED preparation that fails the plan's open actions. */
export const DRAFT_EXPIRY_MARGIN_MS = 5 * 60_000;
/** The expiry after activity at `now`: now + 20 min, never past `created` + 2 h nor `draftCap` (the earliest open draft's
 * expiry minus the margin), never shorter than `current`. */
export const slidingSessionExpiry = (now: number, created: number, current: number, draftCap = Infinity) =>
  Math.max(current, Math.min(now + SESSION_IDLE_MS, created + SESSION_MAX_MS, draftCap));
/** Cancelled conversations do not count toward SESSION_LIMIT; the oldest beyond this many per user are forgotten. */
const CANCELLED_KEPT_PER_USER = 10;
/** Outcome of one "confirm everything that is ready" call: group keys only, no business text. */
export type ConfirmationBatchReport = { executed: string[]; replayed: string[];
  not_executed: { group_key: string; code: "GROUP_CHANGED" | "PROPOSAL_EXPIRED" }[] };
/** `options` (B4): time-slot alternatives of a child view, positional ids for selectOption (labels only). */
/** `turn_notice` (B5): this reply's notice (left-out parts / unreadable answer), also inside `message`;
 * a screen that shows its own text for a ready plan must still show it. `turn_notice_alone`: the reply IS that
 * notice (an answer that could not be read): the screen shows `message` only, never its own "ready" text. */
/** `clarifications` (B6): the plan's open questions with how many turns in a row each was asked; from the second,
 * the options the backend already has; from the third, the agenda form (ids/dates only) and one extra sentence. */
/** `today` (B7): the salon's local date (YYYY-MM-DD) the server last read; the screen's reference year for dates. */
export type SecretaryView = { today?: string; clarifications?: SecretaryClarification[]; turn_notice?: string; turn_notice_alone?: true; options?: SecretaryOption[]; confirmation_batch?: ConfirmationBatchReport; retired_plan?: ActionPlan; proposal_expired?: boolean; service_context?: { fields: Partial<ServiceMvpFields>; target_name?: string }; suspended_plans?: { plan_ref: string; label: string }[]; capability_status?: CapabilityStatus; execution_warnings?: string[]; action_plan?: ActionPlan; communication?: CommunicationState; inventory?: InventoryState; financial?: FinancialState; batch?: BatchState; scheduling?: SchedulingState; operations?: { operation_ref: string; action_keys?: string[]; state: SecretaryView }[]; loaded?: Session["loaded"]; skill?: "services" | "customers" | "scheduling" | "financial" | "inventory" | "communication" | "auto"; customer?: CustomerState; sessionId: string; message: string; draft?: Draft; proposal?: Proposal; receipt?: Receipt; cancelled: boolean; candidates?: Candidates };
const turnInput = z.object({ sessionId: z.string().uuid(), message: z.string().trim().min(1).max(1000), operation_ref: z.string().uuid().optional() }).strict();
/** `linked` (review 2b): the linked actions the screen named and the owner accepted to discard with this one. */
const discardInput = z.object({ plan_ref: z.string().uuid(), action_key: z.string().regex(/^[a-z][a-z0-9_]{0,31}$/),
  linked: z.array(z.string().regex(/^[a-z][a-z0-9_]{0,31}$/)).min(1).max(64).optional() }).strict();
/** B5: reply to a plan turn whose interpretation could not be read; the plan is kept as it was. */
export const unreadAnswerNotice = "Não entendi essa parte; o pedido foi preservado. Pode repetir de outro jeito?";
/** ERR-COPY (flag SALON_SECRETARY_COPY_V2): a new request Luna could not map to any capability (AMBIGUOUS). */
export const ambiguousRequestMessage = "Não entendi com segurança o que fazer. Nada foi alterado. Pode repetir de outro jeito?";
/** B4 slot click: the child operation, the positional option and (plan) the revision the screen showed. */
const optionInput = z.object({ operation_ref: z.string().uuid(), option_id: z.string().regex(/^opt_[1-9]\d?$/), revision: z.number().int().min(0).optional() }).strict();

/** An open action with no missing field that still waits for a new proposal: expired, or held for review (review 2b). */
const awaitsProposal = (action: ActionPlan["actions"][number]) => action.assessment.issue === "PROPOSAL_EXPIRED" || action.assessment.issue === "REVIEW_REQUIRED";
/** These witnesses come only from the current validated selection, never plan history. */
function inventoryWitnesses(operations:readonly SelectedOperation[]):InventoryQuantityWitness[]{
  return operations.flatMap(op=>op.operation==="stock.movement"&&op.inventory?.quantity!=null&&op.inventory.quantity_evidence&&op.inventory.product_name?
    [{quantity:op.inventory.quantity,literal:op.inventory.quantity_evidence,product_name:op.inventory.product_name,
      source_scope:op.source_scope,reference:op.inventory.reference,reason:op.inventory.reason}]:[]);
}
function inventoryScopes(operations:readonly SelectedOperation[],own:SelectedOperation):InventoryOperationScope[]{
  return operations.flatMap((op,index)=>op.source_scope&&!(op===own||op.item_key!=null&&op.item_key===own.item_key)?
    [{key:op.item_key??`operation${index}`,operation:op.operation,literal:op.source_scope}]:[]);
}
/** Local, single-process MVP only. Restart/another worker fails closed, never reconstructs client history. */
export class SalonSecretary {
  private sessions = new Map<string, Session>();
  private executionWarnings = new WeakMap<Session, string[]>();
  /** Replay of an exact "confirm all" request returns its recorded outcome (keys include plan_ref). */
  private batchReceipts = new WeakMap<Session, Map<string, ConfirmationBatchReport>>();
  private readonly routerTrace = new AsyncLocalStorage<RouterTrace>();
  private readonly planContext = new AsyncLocalStorage<string>();
  /** D1: the persisted conversation a top-level call is working on (nested calls reuse it) and the sessions it created. */
  private readonly attached = new AsyncLocalStorage<{ root: string; created: Set<string> }>();
  /** `sessionStore` (D1): read on every call; undefined (the default) keeps the in-memory Map as the only store. */
  constructor(private readonly modelFactory: () => Promise<Model>, private readonly modelId: () => string = () => process.env.SALON_SECRETARY_MODEL ?? "unconfigured", private readonly communicationProvider = new FakeCommunicationProvider(), private readonly routerOptions: RouterOptions = {}, private readonly multiActionOptions: { enabled?: () => boolean; policy?: () => ReviewConfiguration } = {},
    private readonly sessionStore: () => SecretarySessionStore | undefined = () => undefined) {}

  /** D1: the durable store for a TOP-LEVEL call (never inside another call or a plan's preparation). */
  private topLevelStore() {
    return this.attached.getStore() || this.planContext.getStore() ? undefined : this.sessionStore();
  }
  /** D1: one top-level call on a persisted conversation. Without a store this is exactly `run()` (same promise, no extra
   * step). With one: lease + load (SESSION_BUSY / SESSION_NOT_FOUND), strict parse, rehydrate, run in memory (a model call
   * never holds a DB transaction), then save with compare-and-swap even when the call threw (the in-memory contract keeps
   * a failed call's state changes too) and forget the process copy. A lost swap is CONCURRENT_UPDATE: the domain journal
   * keeps effects idempotent, and the next call starts from the saved state. */
  private persisted<T>(actor: ServiceActor, id: string, kind: ConversationEventKind | undefined, run: () => Promise<T>): Promise<T> {
    const store = this.topLevelStore();
    return store ? this.persistedCall(store, actor, id, kind, run) : run();
  }
  private async persistedCall<T>(store: SecretarySessionStore, actor: ServiceActor, id: string, kind: ConversationEventKind | undefined, run: () => Promise<T>): Promise<T> {
    const loaded = await store.load(actor, id, kind === "TURN_STARTED" ? { event: { kind } } : {});
    const members = await this.rehydrate(store, actor, loaded);
    const context = { root: loaded.id, created: new Set<string>() };
    return this.attached.run(context, async () => {
      let result: T | undefined, failure: unknown, threw = false;
      try { result = await run(); } catch (error) { threw = true; failure = error; }
      try {
        const root = this.sessions.get(loaded.id);
        if (root) await store.save(actor, loaded.id, this.conversationRecord(root), loaded.version,
          kind ? { kind: kind === "TURN_STARTED" ? "TURN_OUTCOME" : kind, payload: this.eventPayload(root, kind, threw ? failure : undefined, threw) } : undefined);
      } catch (error) { if (!threw) { threw = true; failure = error; } }
      finally { this.evict(loaded.id, [...members, ...context.created]); }
      if (threw) throw failure;
      return result as T;
    });
  }
  /** Strict parse, then the stored sessions become this process's working copy (the actor is always the caller's). An
   * unreadable aggregate fails closed (SESSION_NOT_FOUND): a corrupt one is removed; another schema is left untouched. */
  private async rehydrate(store: SecretarySessionStore, actor: ServiceActor, loaded: LoadedConversation) {
    const release = () => store.save(actor, loaded.id, { state: loaded.state, status: loaded.status, expiresAt: loaded.expiresAt }, loaded.version).catch(() => undefined);
    if (loaded.stateSchema !== CONVERSATION_STATE_SCHEMA) { await release(); throw Error("SESSION_NOT_FOUND"); }
    let stored: ReturnType<typeof parseStoredAggregate>;
    try { stored = parseStoredAggregate(decodeConversationState(loaded.state)); if (stored.root !== loaded.id) throw Error("SESSION_STATE_INVALID"); }
    catch { await store.remove(actor, loaded.id).catch(release); throw Error("SESSION_NOT_FOUND"); }
    this.evict(loaded.id);
    for (const record of stored.sessions as StoredSession[])
      this.sessions.set(record.id, { ...record, actor: { salonId: actor.salonId, userId: actor.userId }, busy: false } as unknown as Session);
    for (const [owner, warnings] of stored.warnings ?? []) this.executionWarnings.set(this.sessions.get(owner)!, [...warnings]);
    for (const [owner, entries] of stored.batchReceipts ?? []) this.batchReceipts.set(this.sessions.get(owner)!, new Map(entries as unknown as [string, ConfirmationBatchReport][]));
    return (stored.sessions as StoredSession[]).map(record => record.id);
  }
  /** Every session a conversation owns: its children, its suspended plans' children and units, and any session whose
   * planOwner is in the aggregate (a replaced unit's child). Same actor only. */
  private aggregateOf(root: Session) {
    const found = new Map<string, Session>([[root.id, root]]), queue = [root];
    const add = (id?: string) => {
      const s = id && !found.has(id) ? this.sessions.get(id) : undefined;
      if (s && s.actor.salonId === root.actor.salonId && s.actor.userId === root.actor.userId) { found.set(s.id, s); queue.push(s); }
    };
    for (let grown = true; grown;) {
      while (queue.length) {
        const s = queue.shift()!;
        s.children?.forEach(add); s.actionUnits?.forEach(unit => add(unit.child));
        for (const saved of s.suspendedPlans ?? []) { saved.children?.forEach(add); saved.actionUnits?.forEach(unit => add(unit.child)); }
      }
      const before = found.size;
      for (const [id, s] of this.sessions) if (s.planOwner && found.has(s.planOwner)) add(id);
      grown = found.size > before;
    }
    return [...found.values()];
  }
  /** The exact state text of a conversation (never the actor, the busy flag or a turn's option binding). */
  private conversationRecord(root: Session): ConversationRecord {
    const members = this.aggregateOf(root);
    const strip = ({ actor: _actor, busy: _busy, optionBinding: _binding, ...rest }: Session) => { void _actor; void _busy; void _binding; return rest; };
    const warnings = members.flatMap(s => { const list = this.executionWarnings.get(s); return list?.length ? [[s.id, [...list]] as [string, string[]]] : []; });
    const batch = members.flatMap(s => { const map = this.batchReceipts.get(s); return map?.size ? [[s.id, [...map]] as [string, [string, ConfirmationBatchReport][]]] : []; });
    const state = encodeConversationState({ schema: STORED_AGGREGATE_SCHEMA, root: root.id, sessions: members.map(strip),
      ...(warnings.length ? { warnings } : {}), ...(batch.length ? { batchReceipts: batch } : {}) });
    return { state, status: root.cancelled ? "CANCELLED" : "OPEN", expiresAt: root.expires };
  }
  /** Codes only: never names, messages or ids. */
  private eventPayload(root: Session, kind: ConversationEventKind, failure: unknown, threw: boolean): ConversationEventPayload {
    const code = failure instanceof Error && /^[A-Z][A-Z0-9_]{1,79}$/.test(failure.message) ? failure.message : "UNCLASSIFIED_ERROR";
    return { ok: !threw, ...(threw ? { code } : {}), ...(kind === "TURN_STARTED" && root.lastOutcome ? { outcome: [...root.lastOutcome.codes] } : {}),
      ...(root.actionPlan ? { revision: root.actionPlan.revision, actions: root.actionPlan.actions.length } : {}) };
  }
  /** The process keeps no copy of a persisted conversation between calls. */
  private evict(rootId: string, extra: Iterable<string> = []) {
    const root = this.sessions.get(rootId);
    for (const id of new Set([...(root ? this.aggregateOf(root).map(s => s.id) : []), ...extra, rootId])) this.sessions.delete(id);
  }
  /** D1: the actor's latest open conversation, reattached after a reload or on another worker: null without a durable store
   * or when it is not an 'auto' conversation. Authorization and the lease apply as to any call; nothing is sent, selected
   * or confirmed. */
  async current(actor: ServiceActor): Promise<SecretaryView | null> {
    const store = this.sessionStore();
    if (!store) return null;
    const [latest] = await store.listOpen(actor);
    if (!latest) return null;
    return this.persisted(actor, latest.id, undefined, () => this.exclusive(actor, latest.id, async s => s.skill === "auto" && !s.planOwner && !s.cancelled ? this.view(s) : null));
  }
  /** D1 owner feedback with a durable store: the codes saved with the conversation (read without a lease), codes only. */
  async storedFeedbackContext(actor: ServiceActor, sessionId: string) {
    const store = this.sessionStore();
    if (!store) return undefined;
    try {
      const loaded = await store.load(actor, sessionId, { lease: false });
      const stored = parseStoredAggregate(decodeConversationState(loaded.state));
      const root = (stored.sessions as StoredSession[]).find(record => record.id === loaded.id);
      return root?.lastOutcome && !root.planOwner ? { codes: [...root.lastOutcome.codes], contract_version: root.lastOutcome.contract_version ?? null } : undefined;
    } catch { return undefined; }
  }

  private async measuredModel() {
    const model = await this.modelFactory();
    return this.routerTrace.getStore()?.measure(model, this.modelId()) ?? model;
  }
  private tryJev(s: Session, message: string) {
    const trace = this.routerTrace.getStore()!;
    return tryJevInterpretation(message, s.turns === 0 && !s.inheritedInterpretation && !s.loaded && !s.children?.length && !s.draft && !s.proposal && !s.pending,
      s.skill, this.routerOptions, trace);
  }

  private async authorize(actor: ServiceActor, skill: "services" | "customers" | "scheduling" | "financial" | "inventory" | "communication" | "auto" = "services") {
    await withTenant(actor, (tx) => skill === "communication" ? assertCommunicationAccess(tx, actor) : skill === "inventory" ? assertInventoryAccess(tx, actor) : skill === "financial" ? assertFinancialAccess(tx, actor).then(()=>undefined) : skill !== "services" ? assertCustomerAccess(tx, actor) : assertServiceWriter(tx, actor).then(() => undefined));
  }
  async start(actor: ServiceActor, skill: "services" | "customers" | "scheduling" | "financial" | "inventory" | "communication" | "auto" = "services"): Promise<SecretaryView> {
    z.enum(["services", "customers", "scheduling", "financial", "inventory", "communication", "auto"]).parse(skill);
    await this.authorize(actor, skill);
    const store = this.topLevelStore();
    for (const [id, s] of this.sessions) if (!s.busy && s.expires <= Date.now()) this.sessions.delete(id);
    if (!this.planContext.getStore()) this.forgetCancelled(actor);
    // B7: a cancelled conversation ("Nova conversa") no longer holds a slot.
    const open = [...this.sessions.values()].filter(s => !s.planOwner && !s.cancelled);
    if (!this.planContext.getStore() && (open.length >= 200 || open.filter(s => s.actor.userId === actor.userId).length >= 10))
      throw new Error("SESSION_LIMIT");
    // D1: with a durable store the per-user limit counts the user's open conversations everywhere (a query).
    if (store && (await store.listOpen(actor)).length >= 10) throw new Error("SESSION_LIMIT");
    const now = Date.now();
    const session: Session = { skill, planOwner: this.planContext.getStore(), multiActionV2: this.multiActionOptions.enabled?.() === true, ...(skill === "communication" ? {communication: communicationState()} : {}), ...(skill === "inventory" ? { inventory: inventoryState() } : {}), ...(skill === "financial" ? { financial: financialState() } : {}), ...(skill === "scheduling" ? { scheduling: schedulingState() } : {}), ...(skill === "customers" ? { customer: customerState() } : {}), id: randomUUID(), actor: { ...actor }, expires: now + SESSION_IDLE_MS,
      created: now, busy: false, turns: 0, cancelled: false };
    this.sessions.set(session.id, session);
    this.attached.getStore()?.created.add(session.id);
    if (!store) return this.view(session);
    // D1: a top-level conversation is a row from its first moment; the process keeps no copy between calls.
    try { const view = this.view(session); await store.create(actor, session.id, this.conversationRecord(session)); return view; }
    finally { this.evict(session.id); }
  }
  private get(actor: ServiceActor, id: string) {
    const s = this.sessions.get(z.string().uuid().parse(id));
    if (!s || s.actor.salonId !== actor.salonId || s.actor.userId !== actor.userId || s.expires <= Date.now())
      throw new Error("SESSION_NOT_FOUND");
    return s;
  }
  private async exclusive<T>(actor: ServiceActor, id: string, fn: (s: Session) => Promise<T>): Promise<T> {
    const s = this.get(actor, id);
    if (s.planOwner && this.planContext.getStore() !== s.planOwner) throw Error("CONFIRMATION_GROUP_REQUIRED");
    await this.authorize(actor, s.skill);
    // Revalidate before redisplaying a previously authorized financial result in a compound session.
    if(s.skill==="auto"&&s.children?.some(childId=>this.get(actor,childId).financial))await this.authorize(actor,"financial");
    if(s.skill==="auto"&&s.children?.some(childId=>this.get(actor,childId).inventory))await this.authorize(actor,"inventory");
    if (s.actionPlan) for (const skill of new Set(s.actionPlan.actions.map(action => action.skill))) await this.authorize(actor, skill);
    if (s.busy) throw new Error("SESSION_BUSY");
    s.busy = true; s.turnNotice = undefined;
    try { const result = await fn(s); this.touch(s); return result; } finally { s.busy = false; }
  }
  /** B7: activity keeps an open conversation alive (now + 20 min, never past 2 h from its start); its child sessions
   * (current and suspended plans) follow. A cancelled or child session is never extended on its own. */
  private touch(s: Session) {
    if (s.planOwner || s.cancelled) return;
    const draft = this.openDraftExpiry(s);
    const expires = slidingSessionExpiry(Date.now(), s.created ?? s.expires - SESSION_IDLE_MS, s.expires, draft === undefined ? Infinity : draft - DRAFT_EXPIRY_MARGIN_MS);
    if (!(expires > s.expires)) return;
    s.expires = expires;
    for (const id of this.childIds(s)) {
      const child = this.sessions.get(id);
      if (child && child.actor.salonId === s.actor.salonId && child.actor.userId === s.actor.userId) child.expires = expires;
    }
  }
  private childIds(s: Session) {
    return new Set([...(s.children ?? []), ...(s.suspendedPlans ?? []).flatMap(saved => saved.children ?? [])]);
  }
  /** Review: the earliest expiry among drafts this conversation may still prepare or confirm: its own adapters and those of
   * its child sessions (current and suspended plans), except children whose actions are all DONE or DISCARDED and
   * carriers that already hold a receipt. */
  private openDraftExpiry(s: Session): number | undefined {
    const units = [s, ...(s.suspendedPlans ?? [])].flatMap(plan => (plan.actionUnits ?? []).map(unit => ({ unit, plan: plan.actionPlan })));
    const closed = (id: string) => units.some(({ unit, plan }) => unit.child === id && unit.keys.every(key => terminalActionStatus(plan?.actions.find(action => action.key === key)?.status ?? "")));
    let earliest: number | undefined;
    for (const session of [s, ...[...this.childIds(s)].filter(id => !closed(id)).map(id => this.sessions.get(id))]) {
      if (!session) continue;
      const settled = Boolean(session.communication?.receipt);
      for (const carrier of [session, session.scheduling, session.communication, settled ? undefined : session.communication?.cancel, session.customer, session.inventory, session.batch] as ({ draft?: { expires_at?: string }; receipt?: unknown } | undefined)[]) {
        const at = carrier && !carrier.receipt ? Date.parse(carrier.draft?.expires_at ?? "") : NaN;
        if (Number.isFinite(at)) earliest = Math.min(earliest ?? at, at);
      }
    }
    return earliest;
  }
  /** B7: cancelled conversations are kept (a late call still says SESSION_CLOSED) but bounded per user: the oldest
   * beyond CANCELLED_KEPT_PER_USER leave memory with their child sessions. */
  private forgetCancelled(actor: ServiceActor) {
    const cancelled = [...this.sessions.values()].filter(s => !s.planOwner && s.cancelled && !s.busy && s.actor.salonId === actor.salonId && s.actor.userId === actor.userId)
      .sort((a, b) => (a.created ?? 0) - (b.created ?? 0));
    for (const s of cancelled.slice(0, Math.max(0, cancelled.length - CANCELLED_KEPT_PER_USER))) {
      const owned = this.childIds(s);
      for (const [id, other] of this.sessions) if (other.planOwner === s.id || owned.has(id) && !other.busy) this.sessions.delete(id);
      this.sessions.delete(s.id);
    }
  }
  /** B7 owner feedback: the codes this server recorded for the session's latest message (never text), if it still has it. */
  feedbackContext(actor: ServiceActor, sessionId: string) {
    const s = this.sessions.get(sessionId);
    if (!s || s.planOwner || s.actor.salonId !== actor.salonId || s.actor.userId !== actor.userId || !s.lastOutcome) return undefined;
    return { codes: [...s.lastOutcome.codes], contract_version: s.lastOutcome.contract_version ?? null };
  }
  private view(s: Session): SecretaryView {
    this.expireProposal(s);
    const raw = this.projectView(s);
    const result = s.proposalExpired ? {...raw,proposal_expired:true,message:expiredProposalMessage} : raw;
    const warnings = this.executionWarnings.get(s);
    return warnings?.length ? { ...result, execution_warnings: [...warnings] } : result;
  }
  private proposalCarriers(s:Session) {
    return [s,s.customer,s.scheduling,s.inventory,s.batch,s.communication,s.communication?.cancel].filter(Boolean) as {proposal?:{expires_at?:string};receipt?:unknown;message?:string}[];
  }
  private withdrawProposals(s: Session) {
    for (const carrier of this.proposalCarriers(s)) if (!carrier.receipt) {
      // An adapter may already have removed the proposal before throwing. Its
      // former confirmation prose must be withdrawn at the same boundary too.
      if (typeof carrier.message === "string") carrier.message = "Não consegui preparar esta alteração. Os dados aceitos foram preservados. Envie a correção novamente.";
      carrier.proposal = undefined;
    }
  }
  /** An aborted turn cannot turn the previous proposal into a fresh approval.
   * Keep accepted drafts and committed effects; readiness must be prepared again. */
  private async preparePlanSafely<T>(parent: Session, prepare: () => Promise<T>, operationRef?: string): Promise<T> {
    const originalPlanRef = parent.actionPlan?.plan_ref;
    try {
      const result = await prepare();
      // C5: every link follows its referenced action's accepted value after this turn (before the slot check).
      const followed = await this.syncReferences(parent.actor, parent);
      return (this.markIntraPlanConflicts(parent) || followed ? this.view(parent) : result) as T;
    }
    catch (error) {
      if (parent.actionPlan) {
        const affected = parent.actionUnits?.filter(unit =>
          (!operationRef || parent.actionPlan!.plan_ref !== originalPlanRef || unit.child === operationRef) &&
          unit.keys.some(key => !terminalActionStatus(parent.actionPlan!.actions.find(action => action.key === key)?.status ?? ""))) ?? [];
        if (affected.length) {
          parent.actionPlan.revision++;
          parent.conversationNotice = undefined; parent.capability_status = undefined;
          // Withdraw every carrier before projecting any one adapter's fields.
          for (const unit of affected) {
            const child = unit.child ? this.sessions.get(unit.child) : undefined;
            if (child) this.withdrawProposals(child);
          }
          for (const unit of affected) this.failActionUnit(parent, unit, error);
        }
      }
      throw error;
    }
  }
  /** Each proposal checks availability against the committed agenda only. Two
   * actions of the same request can therefore claim the same professional's time
   * ("Marca a Amanda e a Carla às 10h"). A block of the same request is the owner's
   * explicit constraint: it keeps its proposal and an overlapping appointment becomes
   * the question, whatever the operation order. Between two appointments (or two
   * blocks) the later one in execution order asks. The atomic cancel→create pair
   * claims its created slot. Released slots are not modelled here: no proposal is
   * ever validated against another proposal's release. */
  private markIntraPlanConflicts(parent: Session) {
    const plan = parent.actionPlan;
    if (!plan) return false;
    type Claim = { key: string; unit: ActionUnit; child: Session; block: boolean; professional: string; name: string; start: string; end: string; customer?: string };
    const claims: Claim[] = [];
    for (const key of plan.execution_order) {
      const action = plan.actions.find(item => item.key === key)!;
      if (action.status !== "READY_FOR_CONFIRMATION" || !["appointment.create", "appointment.change", "schedule.block"].includes(action.operation)) continue;
      const unit = parent.actionUnits?.find(item => item.keys.includes(key));
      const child = unit?.child && (unit.kind === "single" || unit.kind === "scheduling-batch") ? this.sessions.get(unit.child) : undefined;
      const draft = child?.scheduling?.draft;
      const snap = unit?.kind === "scheduling-batch" ? action.operation === "appointment.create" ? child?.batch?.draft?.snapshot?.create : undefined
        : action.operation === "appointment.create" ? draft?.snapshot : draft?.action_snapshot;
      if (!unit || !child || !snap?.professional_ref) continue;
      claims.push({ key, unit, child, block: action.operation === "schedule.block", professional: snap.professional_ref, name: snap.professional_name ?? "o profissional",
        start: snap.startLocal, end: snap.endLocal, customer: "customer_name" in snap && snap.customer_name ? snap.customer_name : undefined });
    }
    const clock = (local: string) => formatClock(local.slice(11, 16));
    const span = (claim: Claim) => claim.start.slice(0, 10) === claim.end.slice(0, 10) ? `das ${clock(claim.start)} às ${clock(claim.end)}` : `de ${formatLocal(claim.start)} até ${formatLocal(claim.end)}`;
    const taken: Claim[] = [];
    let changed = false;
    // Blocks first (the explicit constraint), then appointments; execution order inside each kind.
    for (const claim of [...claims.filter(item => item.block), ...claims.filter(item => !item.block)]) {
      const clash = taken.find(item => item.professional === claim.professional && item.start < claim.end && claim.start < item.end);
      if (!clash) { taken.push(claim); continue; }
      const cause = clash.block ? `a agenda de ${clash.name} estará bloqueada ${span(clash)} neste mesmo pedido.`
        : `${clash.name} já estará com ${clash.customer ?? "outro atendimento"} ${span(clash)} neste mesmo pedido.`;
      const question = `Esse horário está indisponível: ${cause} Qual outro horário você prefere?`;
      this.withdrawProposals(claim.child);
      if (claim.child.scheduling) {
        claim.child.scheduling.waiting_for = "time";
        claim.child.scheduling.message = question;
        this.syncActionUnit(parent.actor, parent, claim.unit);
      } else if (claim.child.batch) {
        // The pair keeps its journaled draft; only its single proposal is withdrawn.
        claim.child.batch.message = question;
        this.syncActionUnit(parent.actor, parent, claim.unit);
        parent.actionPlan = assessPlanAction(parent.actionPlan!, claim.key, { status: "NEEDS_INPUT", missing_fields: ["time"], preview: question, issue: "EXPLICIT_INPUT_REQUIRED" });
      }
      changed = true;
    }
    return changed;
  }
  private hasExpiredProposal(s:Session) {
    return this.proposalCarriers(s).some(carrier=>!carrier.receipt&&proposalHasExpired(carrier.proposal));
  }
  private expireProposal(s:Session) {
    const carriers=this.proposalCarriers(s);
    const expired=this.hasExpiredProposal(s);
    if(expired){
      for(const carrier of carriers)if(!carrier.receipt)carrier.proposal=undefined;
      s.proposalExpired=true;
    }else if(carriers.some(carrier=>carrier.proposal&&!carrier.receipt))s.proposalExpired=false;
  }
  /** The domain receipt/audit has already committed. Optional timing/projection writes
   * must never turn that success into FAILED_SAFE or trigger another business effect. */
  private async recordAfterCommit(s: Session, record: () => Promise<unknown>) {
    try { await record(); }
    catch { this.executionWarnings.set(s, ["POST_COMMIT_TELEMETRY_UNAVAILABLE"]); }
  }
  private effectiveCapabilityStatus(s: Session, operations: NonNullable<SecretaryView["operations"]> = []): CapabilityStatus | undefined {
    if (s.capability_status) return s.capability_status;
    const plan = s.actionPlan;
    if (!plan) return undefined;
    // Group readiness is backend-derived. A failed independent group must not
    // turn an otherwise confirmable group into a global conversation block.
    if (plan.confirmation_groups.some(group => group.status === "READY_FOR_CONFIRMATION")) return "SUPPORTED";
    if (plan.actions.some(action => ["FAILED_SAFE", "DOMAIN_CONFLICT", "BLOCKED_BY_DEPENDENCY", "UNSUPPORTED"].includes(action.status))) return "BLOCKED";
    // Use the same backend-owned selection frontier as the actual question.
    // Multiple real candidates are a choice, not a missing user-supplied value.
    const hints = presentationHints(plan, s.actionUnits ?? [], operations);
    if (plan.actions.some(action => action.status === "NEEDS_INPUT" && (hints[action.key]?.selection?.labels.length ?? 0) > 1)) return "AMBIGUOUS";
    if (plan.actions.some(action => action.missing_fields.length || awaitsProposal(action))) return "NEEDS_INPUT";
    return "SUPPORTED";
  }
  private projectView(s: Session): SecretaryView {
    if (s.skill === "auto") {
      // Read-only UI correlation; the frontend must not infer an action's receipt by position.
      const operations = s.children?.map(id=>({ operation_ref: id, action_keys: s.actionUnits?.find(unit => unit.child === id)?.keys, state: this.view(this.get(s.actor,id)) }));
      if(s.actionPlan)for(const operation of operations??[])if(operation.state.proposal_expired)for(const key of operation.action_keys??[]){
        const action=s.actionPlan.actions.find(item=>item.key===key)!;
        if(!terminalActionStatus(action.status)&&!(action.status==="FAILED_SAFE"&&action.assessment.issue==="PROPOSAL_EXPIRED"))s.actionPlan=assessPlanAction(s.actionPlan,key,{status:"NEEDS_INPUT",missing_fields:[],
          preview:expiredProposalMessage,issue:"PROPOSAL_EXPIRED"});
      }
      // B5: this reply's notice precedes the plan (unless the reply already is that notice).
      const body = s.actionPlan && !s.cancelled ? s.conversationNotice ?? secretaryPlanMessage(s.actionPlan, s.actionUnits ?? [], operations ?? []) : undefined;
      // B6: read-only over the history recorded per user message; the extra sentence only from the third time.
      const clarifications = s.actionPlan && !s.cancelled ? clarificationsView(s.actionPlan, s.actionUnits ?? [], operations ?? [], s.clarificationHistory) : [];
      const fallback = clarifications.some(item => item.fallback) ? `\n\n${agendaFallbackNotice}` : "";
      return structuredClone({ sessionId: s.id, skill: "auto", cancelled: s.cancelled, loaded: s.loaded, ...(s.today ? { today: s.today } : {}), action_plan: s.actionPlan, capability_status: this.effectiveCapabilityStatus(s, operations),
        suspended_plans: s.suspendedPlans?.map(saved => ({plan_ref:saved.actionPlan!.plan_ref,label:saved.actionPlan!.actions.map(action => action.operation).join(", ")})),
        ...(s.turnNotice && !s.cancelled ? { turn_notice: s.turnNotice.text, ...(s.turnNotice.alone ? { turn_notice_alone: true as const } : {}) } : {}), ...(clarifications.length ? { clarifications } : {}),
        message: s.actionPlan ? (s.cancelled ? "Conversa encerrada. Confirmações anteriores preservadas." : (s.turnNotice?.alone ? s.turnNotice.text : s.turnNotice ? `${s.turnNotice.text}\n\n${body}` : body!) + fallback) : s.notice ?? (s.children?.length ? "Confira cada operação abaixo. Cada confirmação executa somente sua proposta." : "Posso ajudar com serviços, clientes, agenda, estoque e consultas financeiras. O que deseja?"), operations });
    }
    if (s.communication) return structuredClone({sessionId:s.id,skill:s.skill,cancelled:s.cancelled,communication:s.communication,message:s.cancelled?"Operação cancelada.":s.communication.message});
    if (s.inventory) return structuredClone({sessionId:s.id,skill:s.skill,cancelled:s.cancelled,inventory:s.inventory,message:s.cancelled?"Conversa encerrada.":s.inventory.message});
    if (s.financial) return structuredClone({sessionId:s.id,skill:s.skill,cancelled:s.cancelled,financial:s.financial,message:s.financial.message});
    if (s.batch) return structuredClone({sessionId:s.id,skill:s.skill,cancelled:s.cancelled,batch:s.batch,message:s.cancelled?"Batch cancelado; nenhuma ação foi executada.":s.batch.message});
    if (s.scheduling) { const options = s.cancelled ? [] : slotOptions(s.scheduling).map(({ option_id, label }) => ({ option_id, label }));
      return structuredClone({sessionId:s.id,skill:s.skill,cancelled:s.cancelled,scheduling:s.scheduling,message:s.cancelled?"Conversa encerrada.":s.scheduling.message,...(options.length?{options}:{})}); }
    if (s.customer) return structuredClone({ sessionId: s.id, skill: s.skill, cancelled: s.cancelled, customer: s.customer,
      message: s.cancelled ? "Conversa encerrada. Nenhuma operação foi confirmada por esta conversa." : s.customer.message });
    let message = "Posso preparar o cadastro ou a alteração de um serviço. Informe o serviço e os dados que deseja.";
    if (s.draft?.status === "NEEDS_INPUT") {
      const labels = { name: "nome", durationMin: "duração em minutos", priceCents: "preço em reais" };
      message = `Informe ${s.draft.missing_fields.map(f => labels[f]).join(" e ")}.`;
      if (s.draft.missing_fields.length === 1 && s.draft.missing_fields[0] === "durationMin") message = "Qual será a duração?";
    } else if (s.draft) message = "Dados completos. A proposta ainda precisa ser preparada; envie uma mensagem para continuar.";
    if (s.proposal) message = `${s.proposal.change ? "Vou alterar" : "Vou cadastrar"}:\n${s.proposal.preview}\nUse Confirmar para executar esta proposta.`;
    if (s.notice) message = s.notice;
    if (s.receipt) message = `Serviço ${s.operation === "service.change" ? "alterado" : "cadastrado"}: ${s.receipt.service.name}. Referência: ${s.receipt.service.id}.`;
    if (s.cancelled) message = "Conversa encerrada. Nenhuma operação foi confirmada por esta conversa.";
    // Model prose is not rendered as a receipt. All claims/questions are grounded in real backend results.
    return structuredClone({ sessionId: s.id, message, draft: s.draft, proposal: s.proposal, receipt: s.receipt, cancelled: s.cancelled,
      service_context:{fields:s.draft?.fields??s.pending?.patch??{},target_name:s.acceptedServiceQuery??s.pending?.query},
      ...(s.pending?.candidates.length ? { candidates: s.pending.candidates } : {}) });
  }
  private async prepare(actor: ServiceActor, s: Session, patch: Partial<ServiceMvpFields>, serviceRef?: string) {
    s.draft = await withTenant(actor, tx => upsertActionDraft(tx, actor, {
      ...(s.draft ? { draft_ref: s.draft.draft_ref, expected_revision: s.draft.draft_revision } : {}),
      ...(serviceRef ? { service_ref: serviceRef } : {}), patch,
    }));
    if(serviceRef && s.pending?.query) s.acceptedServiceQuery=s.pending.query;
    s.pending = undefined; s.notice = undefined;
    if (s.draft.status === "READY") s.proposal = await withTenant(actor, tx =>
      (s.draft!.change ? proposeServiceChange : proposeServiceCreate)(tx, actor, { draft_ref: s.draft!.draft_ref, draft_revision: s.draft!.draft_revision }));
  }
  async selectService(actor: ServiceActor, sessionId: string, serviceRef: string) {
    return this.persisted(actor, sessionId, "SELECTION", () => this.exclusive(actor, sessionId, async s => {
      if (s.cancelled || s.receipt || !s.pending?.query || !s.pending.candidates.some(c => c.id === serviceRef)) throw new Error("SELECTION_INVALID");
      const candidates = await withTenant(actor, tx => findCatalogServices(tx, actor, s.pending!.query!));
      if (!candidates.some(c => c.id === serviceRef)) throw new Error("SELECTION_INVALID");
      await this.prepare(actor, s, s.pending.patch, serviceRef);
      return this.view(s);
    }));
  }
  async send(actor: ServiceActor, input: unknown): Promise<SecretaryView> {
    // Automatic parent -> draft continuation is one message/trace, not a second billable event.
    if (this.routerTrace.getStore()) return this.sendMessage(actor, input);
    const parsed = turnInput.parse(input);
    return this.persisted(actor, parsed.sessionId, "TURN_STARTED", () => this.sendTurn(actor, parsed));
  }
  private async sendTurn(actor: ServiceActor, parsed: z.infer<typeof turnInput>): Promise<SecretaryView> {
    const owned = this.get(actor, parsed.sessionId); // Do not persist telemetry against another tenant's session.
    const trace = new RouterTrace();
    let baseline: TurnBaseline | undefined;
    try { baseline = turnBaseline(owned, id => this.sessions.get(id)); } catch { /* Outcome telemetry is optional. */ }
    return this.routerTrace.run(trace, async () => {
      let view: SecretaryView | undefined, threw = false, failure: unknown;
      // C1 shadow agreement rows, C2 few-shot blocks, C3 name checks and request-budget degradations join this message's trace (codes only).
      try { view = await withExamplesObserver(entry => trace.examples(entry), () => withTemporalShadowObserver(entries => trace.shadow(entries),
        () => withNameObserver(entry => trace.names(entry), () => withRequestBudgetObserver(entry => trace.requestBudget(entry),
          () => withServiceListObserver(code => trace.failed(code), () => this.sendMessage(actor, parsed)))))); return view; }
      catch (error) { threw = true; failure = error; throw error; }
      finally {
        this.recordTurnOutcome(owned, trace, baseline, threw ? { error: failure } : view ? { view } : undefined);
        // Telemetry availability must not break the existing Luna/backend path. No raw errors logged.
        try { await withTenant(actor, tx => tx.auditLog.create({ data: {
          salonId: actor.salonId, userId: actor.userId, actorName: "Secretária — router",
          entityType: "SECRETARY_ROUTER", entityId: parsed.sessionId, action: trace.path, metadata: trace.snapshot(),
        } })); } catch { /* Existing model usage recorder still retains its mandatory audit semantics. */ }
      }
    });
  }
  /** Codes-only turn outcome inside the same router row. Best-effort: never changes or fails the turn.
   * Only the outer message reaches here (nested continuations short-circuit send), so nothing double counts. */
  private recordTurnOutcome(s: Session, trace: RouterTrace, baseline: TurnBaseline | undefined, result: { view: SecretaryView } | { error: unknown } | undefined) {
    try {
      if (!baseline || !result) return;
      const { outcome, fingerprints } = turnOutcome(s, baseline, trace, result,
        { salt: () => s.telemetrySalt ??= randomUUID(), previous: s.questionFingerprints ?? [] });
      // C6 (rec 19): the model contract this message ran under (a hash; absent only if it cannot be computed). A request the
      // budget rewrote (or refused) to fit the cap names its steps, so batteries and replays tell it from the configured one.
      let contract: string | undefined;
      try { contract = secretaryContractVersion({ modelId: this.modelId(), presentation: backendPresentationDigest(), requestBudget: outcome.request_budget?.steps }); } catch { contract = undefined; }
      trace.outcome = contract ? { ...outcome, contract_version: contract } : outcome;
      // B7 owner feedback: the latest message's codes (kind, divergence and error codes; never text) and contract.
      const codes = [outcome.kind, ...outcome.divergence.failed_codes, ...(outcome.error_code ? [outcome.error_code] : [])].filter(code => /^[A-Z][A-Z0-9_]{1,79}$/.test(code));
      s.lastOutcome = { codes: [...new Set(codes)].slice(0, 32), ...(contract ? { contract_version: contract } : {}) };
      // A lost (or not understood) turn showed no new question; the next one is compared with the last question actually shown.
      if ("view" in result && outcome.kind !== "NOT_UNDERSTOOD") s.questionFingerprints = fingerprints.slice(0, 16);
    } catch { trace.outcome = null; }
  }
  /** B6: records, once per user message of an 'auto' session, which question each open action of the active plan
   * shows and for how many messages in a row. A question shown again counts once more when the message was an attempt
   * at it: it changed that action, or it changed nothing at all (a lost or unreadable answer too). A message about
   * another action keeps the count; casual talk or an unsupported request is no attempt; `operationRef` addresses one
   * action. Best-effort: never changes or fails the turn. Returns whether the reply must be projected again. */
  private trackClarifications(s: Session, before: { planRef: string; actions: ReadonlyMap<string, string> } | undefined,
    operations: SecretaryView["operations"], operationRef?: string, lost = false) {
    try {
      const plan = s.actionPlan;
      if (!plan || s.cancelled) { s.clarificationHistory = undefined; return false; }
      // A thrown message is read without the parent's view(): projecting it could still move the plan (expiry).
      const views = operations ?? (s.children ?? []).flatMap(id => { const child = this.sessions.get(id);
        return child ? [{ operation_ref: id, action_keys: s.actionUnits?.find(unit => unit.child === id)?.keys, state: this.projectView(child) }] : []; });
      const same = before?.planRef === plan.plan_ref;
      // A proposal expiring meanwhile is the clock, not an effect of this message.
      const changed = new Set(plan.actions.filter(action => (!same || before!.actions.get(action.key) !== actionMark(action)) && action.assessment.issue !== "PROPOSAL_EXPIRED").map(action => action.key));
      const attempted = lost || !["CONVERSATION", "UNSUPPORTED"].includes(s.capability_status ?? "");
      const addressed = operationRef ? new Set(s.actionUnits?.find(unit => unit.child === operationRef)?.keys ?? []) : undefined;
      const questions = planQuestions(plan, s.actionUnits ?? [], views);
      s.clarificationHistory = recordClarifications(s.clarificationHistory, plan.plan_ref, questions,
        key => attempted && (!addressed || addressed.has(key)) && (lost || changed.has(key) || !changed.size));
      return questions.length > 0;
    } catch { return false; }
  }
  /** B6 Luna context: turns in a row each open question of the active plan was asked (clarification.repeat_count). */
  private questionAttempt(s: Session) {
    const planRef = s.actionPlan?.plan_ref ?? "", history = s.clarificationHistory;
    return (question: { action_key: string; fields: readonly string[]; question: string }) => clarificationAttempt(history, planRef, question);
  }
  /** Divergence telemetry: field names the interpretation supplied that the prepared action left empty. */
  private traceDroppedFields(parent: Session, operations: readonly SelectedOperation[]) {
    try {
      const trace = this.routerTrace.getStore();
      if (trace) for (const op of operations) {
        const action = parent.actionPlan?.actions.find(item => item.key === op.item_key);
        if (action) trace.dropped(droppedFields(op, action.fields));
      }
    } catch { /* Observation only. */ }
  }
  private async sendMessage(actor: ServiceActor, input: unknown): Promise<SecretaryView> {
    const messageStarted=performance.now();
    const { sessionId, message, operation_ref } = turnInput.parse(input);
    return this.exclusive(actor, sessionId, async s => {
      const contexts:TemporalTurnDraft[]=[];
      const ids=new Set([s.id,...s.children??[],...(s.suspendedPlans??[]).flatMap(saved=>saved.children??[])]);
      for(const id of ids){
        const child=this.sessions.get(id);
        if(!child||child.actor.salonId!==actor.salonId||child.actor.userId!==actor.userId||child.expires<=Date.now())continue;
        const single=child.scheduling;
        if(single?.draft)contexts.push({...single.draft,scope_valid:JSON.stringify(single.fields)===JSON.stringify(single.draft.fields)});
        const batch=child.batch;
        if(batch?.draft)for(const item of batch.draft.plan.items)contexts.push({...batch.draft,fields:item.fields,item_key:item.key,scope_valid:JSON.stringify(batch.plan)===JSON.stringify(batch.draft.plan)});
      }
      return withTemporalTurnDrafts(contexts,async()=>{
      this.expireProposal(s);
      if (s.cancelled || s.communication?.receipt || s.inventory?.status === "DONE" || s.inventory?.receipt || s.financial?.status === "DONE" || s.receipt || s.customer?.receipt || s.scheduling?.receipt || s.batch?.receipt) throw new Error("SESSION_CLOSED");
      // Staff/service names help Luna tell roles apart. Unavailable directory is simply omitted.
      if (s.skill === "auto") { const directory = await withTenant(actor, tx => secretaryDirectory(tx, actor)).catch(() => undefined);
        if (directory?.today?.date && /^\d{4}-\d{2}-\d{2}$/.test(directory.today.date)) s.today = directory.today.date;
        const before = s.actionPlan ? { planRef: s.actionPlan.plan_ref, actions: new Map(s.actionPlan.actions.map(action => [action.key, actionMark(action)])) } : undefined;
        try {
          const view = await withSalonDirectory(directory, () => this.preparePlanSafely(s, () => this.sendAutomatic(actor, s, message, operation_ref, messageStarted), operation_ref));
          // B6: once per user message, after preparation; the reply is projected again with the new counts.
          return this.trackClarifications(s, before, view.operations, operation_ref) ? this.view(s) : view;
        } catch (error) {
          // A lost message counts too: the question it left open was asked once more.
          const trace = this.routerTrace.getStore();
          if (trace && reachedInterpretation(trace)) this.trackClarifications(s, before, undefined, operation_ref, true);
          throw error;
        } }
      if (operation_ref) throw new Error("OPERATION_NOT_IN_SESSION");
      if (s.turns >= 20) throw new Error("TURN_LIMIT");
      if(s.batch){
        s.turns++;
        await sendBatchTurn(actor,s.batch,message,async()=>instrumentServicesModel(await this.measuredModel(),this.modelId(),usageRecorder(actor,sessionId,randomUUID(),this.modelId())),()=>this.get(actor,sessionId));
        await persistBatchMetrics(actor,sessionId,s.batch);return this.view(s);
      }
      if(s.communication){
        const c=s.communication,t=performance.now(),fast=communicationChannelFastPath(c,message),parsing=performance.now()-t;s.turns++;
        try {
          if(fast){this.routerTrace.getStore()!.fastPath();c.metrics={parsing};c.interpretation_source="DETERMINISTIC_FAST_PATH";await applyCommunicationInterpretation(actor,c,fast,message);}
          else {c.interpretation_source="MODEL";await sendCommunicationTurn(actor,c,async()=>instrumentServicesModel(await this.measuredModel(),this.modelId(),usageRecorder(actor,sessionId,randomUUID(),this.modelId())),message,()=>this.get(actor,sessionId));}
          c.metrics.message_total=performance.now()-messageStarted;await communicationMetrics(actor,sessionId,c.metrics,c.interpretation_source);return this.view(s);
        }catch(error){c.proposal=undefined;throw error;}
      }
      if(s.inventory){
        const c=s.inventory,t=performance.now(),fast=inventoryQuantityFastPath(c,message),parsing=performance.now()-t;
        try {
          if(fast){s.turns++;this.routerTrace.getStore()!.fastPath();c.metrics={parsing};c.interpretation_source="DETERMINISTIC_FAST_PATH";await applyInventoryInterpretation(actor,c,fast,message);}
          else {
            const selected = await this.tryJev(s,message); s.turns++;
            this.get(actor,sessionId);
            if(selected) await applyInventoryInterpretation(actor,c,{...selected.operations[0].inventory,source_scope:selected.operations[0].source_scope,operation:selected.operations[0].operation as "product.search"},message);
            else {const measured=instrumentServicesModel(await this.measuredModel(),this.modelId(),usageRecorder(actor,sessionId,randomUUID(),this.modelId()));await sendInventoryTurn(actor,c,measured,message,()=>this.get(actor,sessionId));}
          }
          c.metrics.message_total=performance.now()-messageStarted;await persistInventoryMetrics(actor,sessionId,c);return this.view(s);
        } catch(error){c.proposal=undefined;throw error;}
      }
      const parsingStart=performance.now();
      const waiting=s.scheduling&&!s.scheduling.candidates&&!s.scheduling.proposal?s.scheduling.waiting_for:
        !s.customer&&!s.pending&&!s.proposal&&s.draft?.missing_fields.length===1?s.draft.missing_fields[0]:undefined;
      const fast=schedulingSourceTimeReply(waiting,message)??secretaryFastPath(waiting,message),parsingMs=performance.now()-parsingStart;
      if(fast){
        this.routerTrace.getStore()!.fastPath();
        s.turns++;
        if(s.scheduling){
          s.scheduling.metrics={parsing:parsingMs};s.scheduling.interpretation_source="DETERMINISTIC_FAST_PATH";
          try{await applySchedulingInterpretation(actor,s.scheduling,fast as SchedulingInterpretation,message);await persistSchedulingMetrics(actor,sessionId,s.scheduling);return this.view(s);}
          catch(error){s.scheduling.proposal=undefined;throw error;}
        }
        if("durationMin" in fast){
          const view=await this.applyServiceInterpretation(actor,s,fast);
          await withTenant(actor,tx=>tx.auditLog.create({data:{salonId:actor.salonId,userId:actor.userId,actorName:"Secretária — latência",entityType:"SECRETARY_LATENCY",entityId:sessionId,action:"FAST_PATH",metadata:{interpretation_source:"DETERMINISTIC_FAST_PATH",model_avoided:true,model_requests:0,model_cost:0,durations_ms:{parsing:parsingMs,message:performance.now()-parsingStart}}}}));
          return view;
        }
      }
      if (s.financial) {
        const selected = await this.tryJev(s,message);
        if (selected) {
          this.get(actor,sessionId); s.turns++;
          await applyFinancialInterpretation(actor,s.financial,selected.operations[0].financial ?? {});
          s.financial.metrics.message_total=performance.now()-messageStarted;
          await persistFinancialMetrics(actor,sessionId,s.financial); return this.view(s);
        }
      }
      const model = await this.measuredModel(); // Paid gate precedes any model call or draft mutation.
      s.turns++;
      if (s.financial) {
        const measured=instrumentServicesModel(model,this.modelId(),usageRecorder(actor,sessionId,randomUUID(),this.modelId()));
        await sendFinancialTurn(actor,s.financial,measured,message,()=>this.get(actor,sessionId));
        s.financial.metrics.message_total=performance.now()-messageStarted;
        await persistFinancialMetrics(actor,sessionId,s.financial);return this.view(s);
      }
      if (s.scheduling) {
        const measured=instrumentServicesModel(model,this.modelId(),usageRecorder(actor,sessionId,randomUUID(),this.modelId()));
        try { await sendSchedulingTurn(actor,s.scheduling,measured,message,()=>this.get(actor,sessionId)); await persistSchedulingMetrics(actor,sessionId,s.scheduling); return this.view(s); } catch(error) { s.scheduling.proposal=undefined;throw error; }
      }
      if (s.customer) {
        const measured = instrumentServicesModel(model, this.modelId(), usageRecorder(actor, sessionId, randomUUID(), this.modelId()));
        try { await sendCustomerTurn(actor, s.customer, measured, message, () => this.get(actor, sessionId)); return this.view(s); }
        catch (error) { if (error instanceof SecretaryRouteRequest) throw error; s.customer.proposal = undefined; if (error instanceof Error && error.message === "CUSTOMER_CHANGED") { s.cancelled = true; throw error; }
          // The historical code stays; an unreadable answer keeps its B5 tag (an active plan survives it).
          const failure = new Error("SECRETARY_TURN_FAILED"); throw isInterpretationFailure(error) ? markInterpretationFailure(failure) : failure; }
      }
      const previousProposal = s.proposal;
      // Any new message withdraws the displayed proposal until the current draft is proposed again.
      s.proposal = undefined;
      try {
        // U02 is deterministic and revalidated before inference. Only fields/requirements reach the model.
        const requirements = await withTenant(actor, async tx => {
          const salon = await assertServiceWriter(tx, actor);
          if (salon.currency !== "BRL") throw new Error("CURRENCY_NOT_SUPPORTED");
          return { create: getOperationRequirements(), change: getOperationRequirements("service.change") };
        });
        const modelId = this.modelId();
        const measured = instrumentServicesModel(model, modelId, usageRecorder(actor, sessionId, randomUUID(), modelId));
        const interpretation = await runServicesTurn(measured, message,
          {...clarificationContext({operation:s.operation,fields:s.draft?.fields??s.pending?.patch??{},missing_fields:s.draft?.missing_fields,message:this.view(s).message}),target_name:s.acceptedServiceQuery??s.pending?.query}, requirements);
        return await this.applyServiceInterpretation(actor, s, interpretation, previousProposal);
      } catch (error) {
        if (error instanceof SecretaryRouteRequest) throw error;
        s.proposal = undefined;
        // Committed draft patches survive failures; no model/raw provider error or success prose leaks.
        const failure = new Error("SECRETARY_TURN_FAILED"); throw isInterpretationFailure(error) ? markInterpretationFailure(failure) : failure;
      }
      });
    });
  }
  private async applyServiceInterpretation(actor: ServiceActor, s: Session, interpretation: ServicePatch, previousProposal?: Proposal) {
        const { operation = s.operation ?? "service.create", target_name, ...explicitPatch } = interpretation;
        if (s.operation && operation !== s.operation) throw new Error("OPERATION_MISMATCH");
        if (operation === "service.create" && target_name) throw new Error("OPERATION_MISMATCH");
        s.operation = operation;
        const patch = { ...s.pending?.patch, ...explicitPatch };
        this.get(actor, s.id); // Fail closed if session expired while awaiting the provider.
        if (patch.name !== undefined) patch.name = normalizeSecretaryServiceName(patch.name);
        if (operation === "service.change" && !s.draft) {
          const query = target_name ?? s.pending?.query;
          if (!query || !Object.keys(patch).length) {
            s.pending = { query, patch, candidates: [] };
            s.notice = "Informe o nome atual do serviço e o que deseja alterar.";
            return this.view(s);
          }
          const candidates = await withTenant(actor, tx => findCatalogServices(tx, actor, query));
          s.pending = { query, patch, candidates: candidates.length <= 20 ? candidates : [] };
          if (candidates.length !== 1) {
            s.notice = candidates.length === 0 ? "Não encontrei esse serviço neste salão. Informe outro nome."
              : candidates.length > 20 ? "Muitos serviços encontrados. Informe um nome mais específico." : "Encontrei mais de um serviço. Selecione qual deseja alterar.";
            return this.view(s);
          }
          await this.prepare(actor, s, patch, candidates[0].id);
          return this.view(s);
        }
        if (operation === "service.change" && target_name && !sameAcceptedQuery(target_name,s.acceptedServiceQuery)) throw new Error("TARGET_ALREADY_SELECTED");
        if (Object.keys(patch).length) {
          await this.prepare(actor, s, patch);
        } else {
          if (!s.draft) throw new Error("NO_EXPLICIT_FIELDS");
          if(s.proposalExpired)await this.prepare(actor,s,s.draft.change?.patch??s.draft.fields);
          else s.proposal = previousProposal;
          return this.view(s); // No explicit fields: no U03/T17 write, never execute a typed "sim".
        }
        return this.view(s);
  }
  private async recordAutomaticState(actor: ServiceActor, parent: Session) {
    const operations=(parent.children ?? []).map(id=>{const c=this.get(actor,id);const draft=c.communication?.draft ?? c.inventory?.draft ?? c.draft ?? c.customer?.draft ?? c.scheduling?.draft ?? c.batch?.draft;const proposal=c.communication?.proposal ?? c.inventory?.proposal ?? c.proposal ?? c.customer?.proposal ?? c.scheduling?.proposal ?? c.batch?.proposal;
      return {operation_ref:id,skill_id:c.skill,operation:c.communication?.operation ?? c.inventory?.operation ?? c.financial?.operation ?? c.operation ?? c.customer?.operation ?? c.scheduling?.operation ?? c.batch?.operation ?? null,draft_ref:draft?.draft_ref ?? null,proposal_ref:proposal?.proposal_ref ?? null};});
    await withTenant(actor,tx=>tx.auditLog.create({data:{salonId:actor.salonId,userId:actor.userId,actorName:"Secretária — operações",entityType:"SECRETARY_OPERATION_PLAN",entityId:parent.id,action:"OPERATIONS_PREPARED",metadata:{session_id:parent.id,operations,...(parent.actionPlan ? {action_plan:JSON.parse(JSON.stringify(parent.actionPlan))} : {})}}}));
  }
  private child(actor: ServiceActor, parent: Session, id: string) {
    if (!parent.children?.includes(id) || parent.cancelled) throw new Error("OPERATION_NOT_IN_SESSION");
    return this.get(actor,id);
  }
  private async sendAutomatic(actor: ServiceActor, parent: Session, message: string, operationRef?: string, messageStarted=performance.now()) {
    if (parent.actionPlan) return this.sendActionPlanTurn(actor, parent, message, operationRef);
    if (parent.children?.length) {
      const open = parent.children.map(id=>this.get(actor,id)).filter(s=>!s.cancelled && !s.communication?.receipt && s.inventory?.status!=="DONE" && !s.inventory?.receipt && s.financial?.status!=="DONE" && !s.receipt && !s.customer?.receipt && !s.scheduling?.receipt && !s.batch?.receipt);
      if (!open.length) { parent.notice = "Operações concluídas. Inicie uma nova conversa para outro pedido."; return this.view(parent); }
      const id = operationRef ?? (open.length === 1 ? open[0].id : undefined);
      if (!id) { parent.notice = "Escolha a operação à qual deseja responder. Nenhuma inferência foi feita."; return this.view(parent); }
      this.child(actor,parent,id);
      await this.send(actor,{sessionId:id,message}); await this.recordAutomaticState(actor,parent); parent.notice = undefined; return this.view(parent);
    }
    if (operationRef) throw new Error("OPERATION_NOT_IN_SESSION");
    if (parent.turns >= 20) throw new Error("TURN_LIMIT");
    const interpretationStart=performance.now();
    let selection = await this.tryJev(parent,message);
    if (!selection) {
      const model = await this.measuredModel();
      parent.turns++;
      const modelId = this.modelId();
      const measured = instrumentServicesModel(model,modelId,usageRecorder(actor,parent.id,randomUUID(),modelId));
      try {
        selection = await runServicesTurn(measured,message,{}, { services: { create: getOperationRequirements(), change: getOperationRequirements("service.change") },
        scheduling: {batch:getOperationRequirements("action.batch"),create:getOperationRequirements("appointment.create"),read:getOperationRequirements("appointment.list"),availability:getOperationRequirements("availability.get")}, customers: { create: getOperationRequirements("customer.create"), change: getOperationRequirements("customer.change") } },"discovery", parent.multiActionV2);
      } catch (error) {
        // ERR-COPY (flag): an answer to a NEW request that could not be read (nothing prepared: no plan, no draft) is this
        // turn's own honest reply; transport, budget, permission, session and persistence errors still throw.
        if (!secretaryCopyV2Enabled() || !isInterpretationFailure(error)) throw error;
        return this.unreadRequest(parent, error);
      }
    } else parent.turns++;
    const interpretationMs=performance.now()-interpretationStart;
    this.routerTrace.getStore()!.interpretationMs=interpretationMs;
    this.get(actor,parent.id);
    if (!selection.operations.length) {
      parent.capability_status=selection.disposition === "CONVERSATION" ? "CONVERSATION" : selection.disposition === "UNSUPPORTED" ? "UNSUPPORTED" : "AMBIGUOUS";
      parent.notice=selection.disposition === "CONVERSATION" ? selection.conversation_response! : parent.capability_status === "UNSUPPORTED" ? unsupportedTurnNotice(selection.unavailable_capability,message) :
        // ERR-COPY (flag): a request not understood says that nothing was changed (the capability menu stays for the start view).
        secretaryCopyV2Enabled() ? ambiguousRequestMessage : "Qual pedido deseja fazer? Posso ajudar com serviços, clientes, agenda, estoque e consultas financeiras.";
      return this.view(parent);
    }
    parent.capability_status=undefined;

    // Entire plan authorized before loading or preparing any draft. Selection never grants access.
    for (const id of selection.skills) await this.authorize(actor,id);
    const loaded = loadSkills({ skill_ids: selection.skills });
    parent.loaded = loaded.manuals.map(({skill_id,version,manual_hash})=>({skill_id,version,manual_hash}));
    await withTenant(actor,tx=>tx.auditLog.create({ data: { salonId: actor.salonId,userId:actor.userId,actorName:"Secretária — capacidades",
      entityType:"SECRETARY_SKILL_LOAD",entityId:parent.id,action:"SKILLS_LOADED",metadata:{session_id:parent.id,skills:parent.loaded!,capabilities:loaded.capabilities} } }));
    this.noteRejected(parent, selection, message, false);
    if (parent.multiActionV2) return this.startActionPlan(actor, parent, selection, message);
    this.routerTrace.getStore()?.interpreted(selection.operations.length);
    if(!selection.independent && selection.skills.includes("communication")){
      const started=await this.start(actor,"communication"),child=this.get(actor,started.sessionId);child.expires=parent.expires;parent.children=[child.id];
      const c=await startCancellationMessage(actor,selection,message,state=>{child.communication=state;});c.metrics.interpretation=interpretationMs;child.communication=c;
      c.metrics.message_total=performance.now()-messageStarted;await communicationMetrics(actor,child.id,c.metrics,"MODEL");await this.recordAutomaticState(actor,parent);return this.view(parent);
    }
    if(!selection.independent){
      if(selection.skills.length!==1||selection.skills[0]!=="scheduling"||selection.operations.length!==2||selection.operations.some(o=>!o.item_key||!o.depends_on)){
        parent.notice="Este padrão de operações dependentes não é suportado. Nenhuma ação foi preparada.";return this.view(parent);
      }
      const t=performance.now();
      const started=await this.start(actor,"scheduling"),child=this.get(actor,started.sessionId);
      child.scheduling=undefined;child.expires=parent.expires;parent.children=[child.id];
      const batch=await startBatch(actor,selection,message,state=>{child.batch=state;});
      batch.metrics.interpretation=interpretationMs;batch.metrics.message=performance.now()-t+interpretationMs;child.batch=batch;
      parent.notice="Confira o plano dependente. Uma confirmação aplica todas as ações, ou nenhuma.";
      await persistBatchMetrics(actor,child.id,batch);await this.recordAutomaticState(actor,parent);return this.view(parent);
    }
    const children: string[] = [];
    try {
      for (const op of selection.operations) {
        const skill = operationSkill(op.operation);
        const started = await this.start(actor,skill); const child = this.get(actor,started.sessionId); child.expires = parent.expires; child.inheritedInterpretation = true; children.push(child.id);
        const patch = Object.fromEntries(Object.entries(op).filter(([k,v])=>v!==null&&!["item_key","depends_on","released_slot_of","source_scope"].includes(k)));
        if(skill === "communication") {
          child.communication!.metrics.interpretation=interpretationMs;
          await applyCommunicationInterpretation(actor,child.communication!,op.communication??{},message);
          child.communication!.metrics.message_total=performance.now()-messageStarted;await communicationMetrics(actor,child.id,child.communication!.metrics,"MODEL");
        } else if(skill === "inventory") {
          child.inventory!.metrics.interpretation=interpretationMs;
          await applyInventoryInterpretation(actor,child.inventory!,{...op.inventory,source_scope:op.source_scope,operation:op.operation as "product.search"|"stock.balance"|"stock.movement"},message,inventoryWitnesses(selection.operations),inventoryScopes(selection.operations,op));
          child.inventory!.metrics.message_total=performance.now()-messageStarted;await persistInventoryMetrics(actor,child.id,child.inventory!);
        } else if(skill === "financial") {
          child.financial!.metrics.interpretation=interpretationMs;
          await applyFinancialInterpretation(actor,child.financial!,op.financial??{});

        } else if(skill === "scheduling") {
          const {operation,fields,temporal_evidence,temporal_negative_context}=projectSchedulingOperation(op);
          child.scheduling!.metrics.interpretation=interpretationMs;
          await applySchedulingInterpretation(actor,child.scheduling!,{operation,...fields,...(temporal_evidence?{temporal_evidence}:{}),...(temporal_negative_context?{temporal_negative_context}:{})},message);
          await persistSchedulingMetrics(actor,child.id,child.scheduling!);
        } else if (skill === "services") {
          const { requested_fields: _requested, clear_fields: _clear, ...service } = patch;
          void _requested; void _clear;
          await this.applyServiceInterpretation(actor,child,service as ServicePatch);
        } else {
          await applyCustomerInterpretation(actor,child.customer!,patch as CustomerInterpretation);
        }
      }
      parent.children = children; await this.recordAutomaticState(actor,parent); parent.notice = undefined;
      for(const id of children){const child=this.get(actor,id);if(child.financial){child.financial.metrics.message_total=performance.now()-messageStarted;await persistFinancialMetrics(actor,id,child.financial);}}
    } catch (error) {
      // Draft records may exist, but no partial proposals remain executable after preparation failure.
      for (const id of children) { const child=this.get(actor,id); child.cancelled=true; child.proposal=undefined; if(child.communication)child.communication.proposal=undefined;if(child.inventory)child.inventory.proposal=undefined;if(child.customer)child.customer.proposal=undefined;if(child.scheduling)child.scheduling.proposal=undefined; }
      parent.cancelled=true; throw error;
    }
    return this.view(parent);
  }
  private async applyPlanOperation(actor: ServiceActor, child: Session, op: SelectedOperation, message: string, validatedDeferred=false,quantityWitnesses?:readonly InventoryQuantityWitness[],operationScopes?:readonly InventoryOperationScope[],siblings?:readonly SelectedOperation[]) {
    const patch = Object.fromEntries(Object.entries(op).filter(([key, value]) => value != null &&
      !["item_key", "depends_on", "released_slot_of", "requested_fields", "clear_fields", "source_scope"].includes(key)));
    if (child.communication) await applyCommunicationInterpretation(actor, child.communication, op.communication ?? {}, message);
    else if (child.inventory) await applyInventoryInterpretation(actor, child.inventory, { ...op.inventory, source_scope:op.source_scope,operation: op.operation as "product.search" | "stock.balance" | "stock.movement" },message,quantityWitnesses,operationScopes);
    else if (child.financial) await applyFinancialInterpretation(actor, child.financial, op.financial ?? {},new Date(),validatedDeferred?child.deferredFinancialReferences:undefined);
    else if (child.scheduling) {
      const {operation,fields,temporal_evidence,temporal_negative_context}=projectSchedulingOperation(op);
      // Compound requests ground each action against its own verified clause (or, without one, the sibling-masked message).
      const source=validatedDeferred?undefined:actionScopedSource(message,op,siblings),compound=!!siblings?.some(item=>item.item_key!==op.item_key);
      // B5: an unproven service name is asked on its own; the rest of this action's patch still applies.
      const divergence=await applySchedulingInterpretation(actor,child.scheduling,{operation,...fields,...(temporal_evidence?{temporal_evidence}:{}),...(temporal_negative_context?{temporal_negative_context}:{})},source?.text,{scoped:source?.scoped,...(source?{names:message}:{}),askUnprovenService:true,
        // C4 (flag SALON_SECRETARY_DATE_RULES_V2): a request with this one action owns its whole message; an unverified clause of a
        // compound request is its sibling-masked view, where the other actions' clauses and quotes are theirs.
        single:!compound,references:op.same_as?.map(ref=>ref.literal),...(source&&!source.scoped&&compound?{unverified:foreignClauses(message,op,siblings!)}:{})});
      this.routerTrace.getStore()?.failed(...divergence);
    }
    else if (child.customer) await applyCustomerInterpretation(actor, child.customer, { ...patch, requested_fields: op.requested_fields, clear_fields: op.clear_fields } as CustomerInterpretation);
    else await this.applyServiceInterpretation(actor, child, patch as ServicePatch);
  }

  /** The atomic pair is scoped against every operation of the request; divergence is codes only. */
  private batchScope(selection: CapabilitySelection) {
    return { siblings: selection.operations, divergence: (codes: string[]) => this.routerTrace.getStore()?.failed(...codes) };
  }
  private syncActionUnit(actor: ServiceActor, parent: Session, unit: ActionUnit) {
    if (!unit.child) return;
    const view = this.view(this.get(actor, unit.child));
    for (const key of unit.keys) {
      const action = parent.actionPlan!.actions.find(item => item.key === key)!;
      action.fields = collectedActionFields(view, action);
      parent.actionPlan = assessPlanAction(parent.actionPlan!, key, assessmentFromView(view, action));
    }
  }
  private failActionUnit(parent: Session, unit: ActionUnit, error: unknown) {
    // A later proposal/telemetry failure cannot roll presentation back to the
    // original Luna intention after the adapter accepted a new effective state.
    const keys = unit.keys.filter(key => !terminalActionStatus(parent.actionPlan!.actions.find(action => action.key === key)!.status));
    if (!keys.length) return;
    // This cleanup also runs when the session expires during preparation. The
    // child is an internal, already-authorized association, not a client lookup.
    const child = unit.child ? this.sessions.get(unit.child) : undefined;
    if(child){
      this.withdrawProposals(child);
      try {
        const view=this.view(child);
        for(const key of keys){const action=parent.actionPlan!.actions.find(item=>item.key===key)!;action.fields=collectedActionFields(view,action);}
      } catch {
        // A broken projection must not preserve confirmation readiness. The
        // authoritative child draft remains intact for recovery and diagnosis.
      }
    }
    const code = error instanceof Error ? error.message : "";
    const conflict = ["SLOT_CONFLICT", "RESOURCE_UNAVAILABLE", "PRO_SERVICE_MISMATCH", "SCHEDULE_CHANGED", "SERVICE_CHANGED", "DEPENDENCY_RECIPIENT_MISMATCH"].includes(code);
    const unsupported = ["UNSUPPORTED_BATCH", "UNSUPPORTED_DEPENDENCY_ADAPTER"].includes(code);
    const clarify = code === "MESSAGE_CONTENT_REVIEW_REQUIRED" ? ["content"] : code === "AMBIGUOUS_DATE" ? ["date"] : [];
    const assessment: ActionAssessment = { status: clarify.length ? "NEEDS_INPUT" : unsupported ? "UNSUPPORTED" : conflict ? "DOMAIN_CONFLICT" : "FAILED_SAFE",
      missing_fields: clarify, issue: clarify.length ? "EXPLICIT_INPUT_REQUIRED" : unsupported ? "UNSUPPORTED_DEPENDENCY_ADAPTER" : conflict ? "DOMAIN_CONFLICT" : "BACKEND_PREPARATION_FAILED" };
    this.routerTrace.getStore()?.failed(outcomeCode(error), assessment.issue); // Whitelisted codes only; no-op outside a message.
    for (const key of keys) parent.actionPlan = assessPlanAction(parent.actionPlan!, key, assessment);
  }
  private async startActionPlan(actor: ServiceActor, parent: Session, selection: CapabilitySelection, message: string) {
    // NEW may prepare a candidate before it is published as the active plan.
    return this.preparePlanSafely(parent, () => this.prepareActionPlan(actor, parent, selection, message));
  }
  private async prepareActionPlan(actor: ServiceActor, parent: Session, selection: CapabilitySelection, message: string) {
    // Without an explicit policy: one confirmation group per independent component (env may restore packing).
    parent.actionPlan = createActionPlan(selection, this.multiActionOptions.policy?.() ?? runtimeReviewConfiguration(process.env),
      this.routerTrace.getStore()?.path === "JEV_ACCEPTED" ? "JEV" : "LUNA");
    parent.actionUnits = actionUnits(parent.actionPlan); parent.children = [];
    this.routerTrace.getStore()?.interpreted(selection.operations.length);
    markSecretaryTiming("T3");
    const order = this.preparationOrder(parent);
    await this.planContext.run(parent.id, async () => {
      for (const unit of order) {
        try {
          if (unit.kind === "unsupported") throw Error("UNSUPPORTED_DEPENDENCY_ADAPTER");
          const chosen = unitSelection(parent.actionPlan!, unit), action = parent.actionPlan!.actions.find(item => item.key === unit.keys[0])!;
          const skill = unit.kind === "cancellation-message" ? "communication" : action.skill;
          const started = await this.start(actor, skill), child = this.get(actor, started.sessionId);
          child.expires = parent.expires; child.inheritedInterpretation = true;
          unit.child = child.id; parent.children!.push(child.id);
          // Dependent reads must observe the state after their predecessors, not a speculative result.
          if (!action.mutation && action.depends_on.length) { await this.preparePlanRead(actor,parent,action,action.fields,message,true); continue; }
          if (unit.kind === "scheduling-batch") { child.scheduling = undefined; child.batch = await startBatch(actor, chosen,message,state=>{child.batch=state;},this.batchScope(selection)); }
          else if (unit.kind === "cancellation-message") child.communication = await startCancellationMessage(actor, chosen, message,state=>{child.communication=state;});
          else await this.applyPlanOperation(actor, child, await this.prepareReferences(actor, parent, unit, child, chosen.operations[0], message, selection.operations), message,false,inventoryWitnesses(selection.operations),inventoryScopes(selection.operations,chosen.operations[0]),selection.operations);
          this.syncActionUnit(actor, parent, unit);
          this.traceDroppedFields(parent, chosen.operations);
          this.checkPlanMessageRecipient(actor, parent, unit);
        } catch (error) { if (error instanceof SecretaryRouteRequest) throw error; this.failActionUnit(parent, unit, error); }
      }
      // The operations keep the plan's own order whatever the preparation order was.
      if (order !== parent.actionUnits) parent.children = parent.actionUnits!.flatMap(unit => unit.child ? [unit.child] : []);
    });
    markSecretaryTiming("T4");
    await this.recordAutomaticState(actor, parent);
    return this.view(parent);
  }
  /** C4 R-B2 (owner rule 8, V2): a single block said "between" something (its clause holds the preposition "entre"), with no link of its
   * own and referenced by no other action, is prepared after the other units, so the appointments it may lie between are already
   * prepared (betweenBookings). Nothing else changes: the plan, its execution order, groups and operations keep their order. */
  private preparationOrder(parent: Session): ActionUnit[] {
    const units = parent.actionUnits!, plan = parent.actionPlan!;
    if (!referencesV2Enabled()) return units;
    const late = units.filter(unit => {
      const action = plan.actions.find(item => item.key === unit.keys[0])!, scope = unitSelection(plan, unit).operations[0]?.source_scope;
      return unit.kind === "single" && action.operation === "schedule.block" && !action.same_as?.length && typeof scope === "string" && /(?<![\p{L}\p{N}])entre(?![\p{L}\p{N}])/iu.test(scope) &&
        !plan.actions.some(other => other.depends_on.includes(action.key) || other.same_as?.some(ref => ref.item_key === action.key));
    });
    return late.length ? [...units.filter(unit => !late.includes(unit)), ...late] : units;
  }

  /** Additional same-client check for a message branching from an atomic cancel/create adapter. */
  private checkPlanMessageRecipient(actor: ServiceActor, parent: Session, unit: ActionUnit, requireResolved = false) {
    if (unit.kind !== "single" || !unit.child) return;
    const action = parent.actionPlan!.actions.find(item => item.key === unit.keys[0])!;
    if (action.operation !== "customer.message") return;
    const child = this.get(actor, unit.child);
    for (const key of action.depends_on) {
      const dependency = parent.actionPlan!.actions.find(item => item.key === key)!;
      if (dependency.operation !== "appointment.cancel") continue;
      const source = parent.actionUnits!.find(item => item.keys.includes(key));
      const state = source?.child ? this.get(actor, source.child) : undefined;
      const customer = state?.batch?.draft?.snapshot?.cancel.customer_ref ?? state?.scheduling?.draft?.action_snapshot?.customer_ref;
      // An incomplete atomic batch has no final snapshot yet. Preparation is not execution.
      // Its group is unconfirmable; confirmation always requires the resolved snapshot.
      if (!customer && !requireResolved && state?.batch && state.batch.draft?.status !== "READY") continue;
      if (!customer || !child.communication?.target) throw Error("UNSUPPORTED_DEPENDENCY_ADAPTER");
      if (customer !== child.communication.target) throw Error("DEPENDENCY_RECIPIENT_MISMATCH");
    }
  }

  /** C5: the carrier of an action's accepted state: its unit's single adapter, the cancellation inside a cancel→message
   * unit, or the atomic cancel→create batch. */
  private referenceCarrier(s: Session, key: string) {
    const unit = s.actionUnits?.find(item => item.keys.includes(key)), child = unit?.child ? this.sessions.get(unit.child) : undefined;
    const action = s.actionPlan!.actions.find(item => item.key === key)!;
    return { scheduling: child?.scheduling ?? (action.operation === "appointment.cancel" ? child?.communication?.cancel : undefined), batch: child?.batch };
  }
  /** C5: the links an action keeps (a plan change: the revision moves, order and groups follow the preparation graph). */
  private setReferences(s: Session, key: string, kept: readonly SameAsReference[]) {
    if (JSON.stringify(s.actionPlan!.actions.find(item => item.key === key)!.same_as ?? []) === JSON.stringify(kept)) return;
    const plan = structuredClone(s.actionPlan!), action = plan.actions.find(item => item.key === key)!;
    if (kept.length) action.same_as = [...kept]; else delete action.same_as;
    plan.revision++; s.actionPlan = refreshActionPlan(plan);
  }
  /** C5 ("cancela a Amanda e passa o Fábio para o horário dela"): a move into the slot a pending cancellation of the plan
   * releases executes only after that cancellation (an execution edge derived from the reference; the group executor then
   * runs it second, blocks it if the cancellation fails, and the executor re-checks the slot on the committed agenda).
   * Refused, and then nothing is projected, when the edge would close a cycle. */
  private releaseAfter(s: Session, key: string, cancel: string) {
    if (s.actionPlan!.actions.find(item => item.key === key)!.depends_on.includes(cancel)) return true;
    const plan = structuredClone(s.actionPlan!);
    plan.actions.find(item => item.key === key)!.depends_on.push(cancel); plan.revision++;
    try { s.actionPlan = refreshActionPlan(plan); return true; } catch { return false; }
  }
  /** D1 (flag SALON_SECRETARY_REFERENCES_V2, review D1-CHANGE-RELEASER): the slot a reschedule of this plan frees is that move's
   * ORIGIN (its appointment's slot and professional before the move; a confirmed move: its receipt). The create is a separate
   * action after the change (depends_on; one group, sequential, never atomic): its proposal is checked with that appointment
   * projected out, and its executor re-checks the committed agenda after the move. Refused up front (asked, nothing proposed)
   * when the move needs the customer's acceptance (the slot stays taken until then) and when the appointment has a waiting
   * list: the domain gives the freed slot to the waiting list automatically, so the owner is told and asked (C21: never a
   * silent promotion against the request, never a proposal that would fail). Unknown origin: the create waits. Codes only. */
  private async releasedOrigin(actor: ServiceActor, s: Session, action: PlanAction, releaser: PlanAction): Promise<{ fields: SchedulingState["fields"]; state: SchedulingReferences; code: string }> {
    const c = this.referenceCarrier(s, releaser.key).scheduling, snap = releaser.status === "DONE" ? c?.receipt?.action_snapshot : c?.draft?.action_snapshot;
    const who = snap?.customer_name ?? "o cliente";
    if (!snap?.before_start || !c?.draft?.fields.appointment_ref && releaser.status !== "DONE") {
      if (referenceGone(releaser.status)) return { fields: {}, state: { asked: ["date", "time", "professional"] }, code: "RELEASED_ORIGIN_GONE" };
      return { fields: {}, state: { waiting: ["date", "time", "professional"], note: referenceWaitingNote(action, [{ fields: ["date", "time"], referenced: releaser }]) }, code: "RELEASED_ORIGIN_WAITING" };
    }
    const date = snap.before_start.slice(0, 10), time = snap.before_start.slice(11, 16);
    const professional = { ref: snap.before_professional_ref ?? snap.professional_ref, name: snap.before_professional_name ?? snap.professional_name };
    const asked: SameAsField[] = ["date", "time"];
    if (snap.requires_acceptance) return { fields: {}, state: { asked, notice: `O horário de ${who} (${formatLocal(snap.before_start)}) só fica livre depois que o cliente aceitar a remarcação. Não preparei o novo agendamento nesse horário.` }, code: "RELEASED_ORIGIN_ACCEPTANCE" };
    if (releaser.status !== "DONE" && snap.waiting_count > 0) return { fields: {}, state: { asked, notice: `Ao remarcar ${who}, o horário liberado (${formatLocal(snap.before_start)}) vai automaticamente para a lista de espera (${snap.waiting_count} pessoa(s)). Não preparei o novo agendamento nesse horário.` }, code: "RELEASED_ORIGIN_WAITLIST" };
    return { fields: { date, time, professional_ref: professional.ref, professional_name: professional.name },
      state: { seeded: { date, time, professional: professional.ref }, ...(releaser.status !== "DONE" && snap.appointment_ref ? { released: snap.appointment_ref,
        release: { professional_ref: snap.professional_ref, start: snap.startLocal, end: snap.endLocal } } : {}) }, code: releaser.status === "DONE" ? "RELEASED_ORIGIN_DONE" : "RELEASED_ORIGIN_SEEDED" };
  }
  /** C4 R-B2 (owner rule 8, V2): a block with no clock of its own whose clause says "between" the two appointments this request defined
   * before it (creates or moves; betweenBookingsSpan): its day, start (the first one's end), end (the second one's start) and professional
   * come from their ACCEPTED proposals, never from Luna's values. Only when both are prepared with one professional on one day, the block's
   * own day and professional (if said) agree, and the first ends strictly before the second starts; otherwise undefined (the block's times
   * are asked, as before). The two appointments are not changed by it and keep their own groups. */
  private async betweenBookings(actor: ServiceActor, s: Session, op: SelectedOperation, message: string, siblings: readonly SelectedOperation[]): Promise<SchedulingState["fields"] | undefined> {
    const projected = projectSchedulingOperation(op), own = projected.fields as Record<string, unknown>;
    if (own.time !== undefined || own.end_time !== undefined || (projected.temporal_evidence ?? []).some(entry => entry.field === "time" || entry.field === "end_time")) return;
    const quoted = (item: SelectedOperation) => { const at = item.source_scope ? message.indexOf(item.source_scope) : -1;
      return at < 0 || message.indexOf(item.source_scope!, at + 1) >= 0 ? undefined : [at, at + item.source_scope!.length] as const; };
    const clause = quoted(op), booked = siblings.filter(item => item.item_key !== op.item_key && (item.operation === "appointment.create" || item.operation === "appointment.change"));
    if (!clause || booked.length !== 2) return;
    const start = clause[0];
    if (booked.some(item => { const span = quoted(item); return !span || span[1] > start; })) return;
    const timezone = await withTenant(actor, tx => schedulingTimezone(tx, actor)), now = new Date();
    const names = booked.map(item => (item as { customer_name?: string | null }).customer_name ?? "") as [string, string];
    if (!betweenBookingsSpan(message, clause, op.operation, names, timezone, now)) return;
    const slots: BookedSlot[] = [];
    for (const item of booked) {
      const planned = s.actionPlan!.actions.find(entry => entry.key === item.item_key);
      const draft = planned && !referenceGone(planned.status) ? this.referenceCarrier(s, planned.key).scheduling?.draft : undefined;
      const snap = item.operation === "appointment.create" ? draft?.snapshot : draft?.action_snapshot;
      if (!snap?.startLocal || !snap.endLocal || !snap.professional_ref) return;
      slots.push({ startLocal: snap.startLocal, endLocal: snap.endLocal, professional_ref: snap.professional_ref, professional_name: snap.professional_name });
    }
    const gap = betweenBookingsGap(slots as [BookedSlot, BookedSlot]);
    if (!gap) return;
    const day = ownValue(op, "date", actionScopedSource(message, op, siblings).text, timezone, now), pro = (op as { professional_name?: string | null }).professional_name;
    if (day.stated && day.value !== gap.date || typeof pro === "string" && pro.trim() && !nameAgrees(pro, gap.professional.name)) return;
    // FX6 (review, rule 8, safety): only a FREE interval is seeded: a committed appointment of that professional inside it (the block
    // snapshot's own `affected` rows) leaves the block's times to the owner (asked), never a block over it.
    const seeded = { date: gap.date, time: gap.time, end_time: gap.end_time, professional_ref: gap.professional.ref };
    const busy = await withTenant(actor, tx => schedulingActionSnapshot(tx, actor, "schedule.block", seeded)).then(snap => snap.affected.length > 0, () => true);
    if (busy) { this.routerTrace.getStore()?.failed("BETWEEN_BOOKINGS_BUSY"); return; }
    return { date: gap.date, time: gap.time, end_time: gap.end_time, professional_ref: gap.professional.ref, professional_name: gap.professional.name };
  }
  /** C5: before a dependent action's first preparation (its referenced actions are prepared before it), each reference is
   * resolved. Proven and pointing to a KNOWN accepted value: that value is seeded as the draft's previous state (never Luna's
   * raw value; grounding then verifies only new evidence) and the link is kept. Proven but still unknown: the field waits,
   * linked (never asked, never guessed). Unproven, contradicted by Luna's own value, or its action can no longer give it: the
   * field is asked (Luna's contradicting value removed) and the link dropped; Luna's own value where the referenced one is
   * unknown stands, unlinked. Returns the operation to apply. Codes only reach telemetry. */
  private async prepareReferences(actor: ServiceActor, s: Session, unit: ActionUnit, child: Session, op: SelectedOperation, message: string, siblings: readonly SelectedOperation[]) {
    const action = s.actionPlan!.actions.find(item => item.key === unit.keys[0])!;
    const v2 = referencesV2Enabled();
    // D1 (V2): a new appointment in the slot a reschedule of this plan frees takes that move's ORIGIN (never its destination).
    const releaser = v2 && action.operation === "appointment.create" && action.released_slot_of && unit.kind === "single" && child.scheduling
      ? s.actionPlan!.actions.find(item => item.key === action.released_slot_of && item.operation === "appointment.change") : undefined;
    const origin = releaser ? await this.releasedOrigin(actor, s, action, releaser) : undefined;
    if (origin && (op as { destination_mode?: unknown }).destination_mode !== "ALTERNATIVE_SLOT")
      // The released slot owns its day, clock and professional (as for a cancellation's slot): Luna's own copies never stand.
      op = { ...withoutOwn(op, ["date", "time", "professional"]), ...((op as { destination_mode?: unknown }).destination_mode === "SAME_RELEASED_SLOT" ? { destination_mode: null } : {}) } as SelectedOperation;
    if (origin) { child.scheduling = { ...schedulingState(), operation: "appointment.create", fields: origin.fields, references: origin.state }; this.routerTrace.getStore()?.failed(origin.code); }
    // C4 R-B2 (V2): the slot a move frees needs no encaixe; a consent the owner did not write is dropped (never granted, never a failure).
    if (origin && (op as { override_requested?: unknown }).override_requested === true && !literalOverrideConsent(message)) {
      op = { ...op, override_requested: null, override_reason: null } as SelectedOperation; this.routerTrace.getStore()?.failed("RELEASED_OVERRIDE_UNGROUNDED");
    }
    // C4 R-B2 (owner rule 7, V2): a bare pronoun after a move and a new appointment in the slot it frees is the moved customer; one the
    // request's structure does not settle is asked (Luna's pick removed), never picked.
    const referent = v2 && unit.kind === "single" && child.scheduling && !action.same_as?.some(ref => ref.field === "customer") ? pronounReferent(message, op, siblings) : undefined;
    if (referent?.kind === "TOPIC") { op = { ...op, customer_name: referent.customer } as SelectedOperation; this.routerTrace.getStore()?.failed("PRONOUN_TOPIC"); }
    else if (referent && (op as { customer_name?: unknown }).customer_name) { op = withoutOwn(op, ["customer"]); this.routerTrace.getStore()?.failed("PRONOUN_AMBIGUOUS"); }
    // C4 R-B2 (owner rule 8, V2): a block "between" the two appointments this request just defined covers only the free interval.
    const between = v2 && action.operation === "schedule.block" && unit.kind === "single" && child.scheduling && !action.same_as?.length ? await this.betweenBookings(actor, s, op, message, siblings) : undefined;
    if (between) { child.scheduling = { ...schedulingState(), operation: "schedule.block", fields: between }; op = withoutOwn(op, ["date", "professional"]); this.routerTrace.getStore()?.failed("BETWEEN_BOOKINGS_SEEDED"); }
    if (!action.same_as?.length) return op;
    // An atomic unit binds its own slot and people (cancel→create, cancel→message): there a link only groups.
    if (unit.kind !== "single" || !sameAsEnabled() || !child.scheduling && !child.communication) { this.setReferences(s, action.key, []); return op; }
    const timezone = await withTenant(actor, tx => schedulingTimezone(tx, actor)), now = new Date();
    const scope = actionScopedSource(message, op, siblings), at = scope.scoped && op.source_scope ? message.indexOf(op.source_scope) : -1;
    const clause = at >= 0 ? [at, at + op.source_scope!.length] as const : undefined;
    const state: SchedulingReferences = { ...origin?.state }, fields: SchedulingState["fields"] = { ...origin?.fields }, kept: SameAsReference[] = [], strip: SameAsField[] = [], conflicts: SameAsField[] = [], codes: string[] = [];
    const waits = new Map<string, SameAsField[]>(), owned: OwnLiteral[] = [];
    let recipient: { ref: string; name: string } | undefined, recurrence: RecurrenceState | undefined;
    // D4 (V2): the verified clause of every operation of this envelope (a value said once may sit in a sibling's clause).
    const clauseOf = (item: SelectedOperation) => { const scoped = actionScopedSource(message, item, siblings), start = scoped.scoped && item.source_scope ? message.indexOf(item.source_scope) : -1;
      return start >= 0 ? [start, start + item.source_scope!.length] as const : undefined; };
    const clauses = v2 ? siblings.flatMap(item => { const found = clauseOf(item); return found ? [found] : []; }) : [];
    for (const ref of action.same_as) {
      // A change keeps its professional: that reference adds nothing (the preview shows the professional).
      if (action.operation === "appointment.change" && ref.field === "professional") { codes.push("SAME_AS_PROFESSIONAL_KEPT"); continue; }
      // D-SELF-ORIGIN (V2): the change's own origin day/clock, seeded once its appointment is located (secretary-scheduling).
      if (v2 && ref.item_key === action.key) {
        const own = ownValue(op, ref.field, scope.text, timezone, now);
        if (!selfReferenceProven(message, ref.literal, clause, action.operation, timezone, now, ref.field, own.stated, selfHolder(s.actionPlan!.actions, action, op))) { codes.push("SAME_AS_LITERAL_UNPROVEN"); if (!own.stated) (state.asked ??= []).push(ref.field); continue; }
        (state.origin ??= []).push(ref.field as "date" | "time"); kept.push(ref); codes.push("SAME_AS_SELF_ORIGIN"); continue;
      }
      const referenced = s.actionPlan!.actions.find(item => item.key === ref.item_key)!;
      const values = await referencedValues(actor, referenced, this.referenceCarrier(s, referenced.key), v2 ? ref : undefined), key = referenceKey(ref.field, values);
      const named = referenced.fields as { customer_name?: string | null; professional_name?: string | null };
      const subjects = [named.customer_name, named.professional_name, referenced.fields.communication?.recipient_name, values.customer?.name, values.professional?.name]
        .filter((name): name is string => typeof name === "string");
      const own = ownValue(op, ref.field, scope.text, timezone, now), ask = () => { if (!own.stated) (state.asked ??= []).push(ref.field); };
      const sibling = v2 ? siblings.find(item => item.item_key === ref.item_key && item.item_key !== action.key) : undefined;
      const proven = referenceLiteralProven(message, ref.literal, clause, action.operation, subjects, timezone, now, ref.field, own.stated);
      // Review A: a professional said in this action's own region (a word of the salon's team) is never the sibling's.
      const team = !proven && sibling && ref.field === "professional" ? await withTenant(actor, tx => listSchedulingProfessionals(tx, actor, {})).then(rows => rows.map(row => row.name), () => undefined) : [];
      const distributive = !proven && !!sibling && team !== undefined && distributiveReferenceProven(message, ref.literal, ref.field, clause, { op: sibling, clause: clauseOf(sibling) }, clauses, action.operation, team);
      if (!proven && !distributive) {
        // C4 R-B (V2): a literal that only states THIS action's own value in its own clause is that value (proven by the ordinary
        // grounding), never the referenced one; every other refusal is asked as before.
        const span = v2 && !own.stated ? ownLiteralSpan(message, ref.literal, clause, action.operation, subjects, ref.field) : undefined;
        const mine = span && ownLiteralValue(op, message, span, ref.field, scope.text, timezone, now,
          ref.field === "service" ? await withTenant(actor, tx => salonDirectoryNames(tx, actor, "service")).catch(() => undefined) : undefined);
        if (mine) { owned.push(mine); codes.push("SAME_AS_OWN_LITERAL"); continue; }
        codes.push("SAME_AS_LITERAL_UNPROVEN"); ask(); continue;
      }
      if (distributive) codes.push("SAME_AS_DISTRIBUTIVE");
      // D3 (V2): the owner's own service naming exactly one of several referenced services settles it.
      if (ref.field === "service" && values.services?.length && own.value !== undefined) {
        const named = values.services.filter(item => nameAgrees(own.value!, item.name));
        if (named.length === 1) { (state.seeded ??= {}).service = named[0].ref; Object.assign(fields, seededFields("service", { service: named[0] })); strip.push("service"); kept.push(ref); codes.push("SAME_AS_AGREED"); continue; }
      }
      // D2/D3 (V2): a set of values (a read's rows without one named mutable row; several services): a card, the refusal of the
      // named row, asked, or (P2b) the whole service list; the same resolver follows the link later (followReferences).
      const set = v2 ? referenceSetOutcome(action, ref.field, values) : undefined;
      if (set) {
        codes.push(set.code);
        // Luna's own different service beside "o mesmo serviço" contradicts it: asked (the card, or the list's field), never chosen.
        if (own.stated) { strip.push(ref.field); if (ref.field === "service") { codes.push("SAME_AS_CONFLICT"); conflicts.push("service"); } }
        if (set.list) { if (own.stated) (state.asked ??= []).push("service"); else { (state.seeded ??= {}).service = set.list.key; Object.assign(fields, seededListFields(set.list)); kept.push(ref); } continue; }
        if (set.card) state.card = set.card;
        if (set.notice) state.notice = set.notice;
        if (set.asked) (state.asked ??= []).push(set.asked);
        continue;
      }
      if (key !== undefined) {
        const who = ref.field === "professional" ? values.professional : ref.field === "customer" ? values.customer : ref.field === "service" ? values.service : undefined;
        const agrees = own.value === undefined || (who ? nameAgrees(own.value, who.name) : own.value === key);
        if (!agrees) { codes.push("SAME_AS_CONFLICT"); strip.push(ref.field); conflicts.push(ref.field); (state.asked ??= []).push(ref.field); continue; }
        // Her own value that could not be read would only be refused again, and her (agreeing) name would re-resolve the
        // person: the backend value stands alone.
        if (own.stated && (own.value === undefined || ref.field === "professional" || ref.field === "customer" || ref.field === "service")) strip.push(ref.field);
        (state.seeded ??= {})[ref.field] = key;
        if (child.communication) recipient = values.customer; else Object.assign(fields, seededFields(ref.field, values));
        if (ref.field === "date") recurrence ??= this.inheritedRecurrence(s, referenced, action);
        kept.push(ref); codes.push(own.stated ? "SAME_AS_AGREED" : "SAME_AS_SEEDED");
        if (ref.field === "time" && action.operation === "appointment.change" && referenced.operation === "appointment.cancel" && referenced.status !== "DONE" && values.appointment &&
          this.releaseAfter(s, action.key, referenced.key)) { state.released = values.appointment; codes.push("SAME_AS_RELEASED_SLOT"); }
        continue;
      }
      if (referenceGone(referenced.status)) { codes.push("SAME_AS_GONE"); ask(); continue; }
      // The owner's own words for this field (verified by the adapter) stand; the unknown reference is not kept.
      if (own.stated) { codes.push("SAME_AS_OWN_VALUE"); continue; }
      (state.waiting ??= []).push(ref.field); kept.push(ref); codes.push("SAME_AS_WAITING");
      waits.set(referenced.key, [...waits.get(referenced.key) ?? [], ref.field]);
    }
    this.setReferences(s, action.key, kept);
    if (waits.size) state.note = referenceWaitingNote(action, [...waits].map(([key, list]) => ({ fields: list, referenced: s.actionPlan!.actions.find(item => item.key === key)! })));
    if (conflicts.length) state.notice = referenceConflictNotice(conflicts);
    for (const [name, value] of Object.entries(fields)) if (value === undefined) delete fields[name as keyof typeof fields];
    if (kept.length || state.asked?.length || state.card || state.notice || origin) {
      if (child.scheduling) child.scheduling = { ...schedulingState(), operation: action.operation as SchedulingState["operation"], fields, references: state, ...(recurrence ? { recurrence } : {}) };
      else { const c = child.communication!; c.references = state; if (recipient) { c.target = recipient.ref; c.query = recipient.name; } }
    }
    this.routerTrace.getStore()?.failed(...codes);
    return owned.reduce(withOwnLiteral, strip.length ? withoutOwn(op, strip) : op);
  }
  /** Review B (P3c, flag SALON_SECRETARY_RECURRENCE_GUARD): a day copied from an action whose own words stated a recurrence
   * carries it to the linked action as ASKED (its own "só a primeira?" card; a yes given on the source is never inherited). */
  private inheritedRecurrence(s: Session, referenced: PlanAction, target: PlanAction): RecurrenceState | undefined {
    if (!recurrenceGuardEnabled() || !recurrenceOperation(target.operation)) return undefined;
    const source = this.referenceCarrier(s, referenced.key).scheduling?.recurrence;
    return source ? { expression: source.expression, status: "ASKED" } : undefined;
  }
  /** C5: after every plan turn each kept link follows its referenced action's CURRENT accepted value: a new or changed value
   * is seeded again (the dependent's proposal is withdrawn and prepared again, no model call), a retracted one makes the
   * field wait (a stale copy is not usable), an action that can no longer give a missing value releases the link (the
   * field is asked), and a value the owner changed on the dependent itself ends the link. A failure fails only that action. */
  private async syncReferences(actor: ServiceActor, s: Session) {
    if (!s.actionPlan) return false;
    // D1 (V2): a create in the slot a pending reschedule of this plan frees follows that move too (a link without same_as).
    const frees = (action: PlanAction) => referencesV2Enabled() && action.operation === "appointment.create" && !!action.released_slot_of &&
      s.actionPlan!.actions.some(item => item.key === action.released_slot_of && item.operation === "appointment.change");
    if (!(sameAsEnabled() && s.actionPlan.actions.some(action => action.same_as?.length)) && !s.actionPlan.actions.some(frees)) return false;
    let changed = false;
    for (const key of [...s.actionPlan.execution_order]) {
      const action = s.actionPlan.actions.find(item => item.key === key)!;
      const unit = s.actionUnits?.find(item => item.keys.includes(key)), child = unit?.child ? this.sessions.get(unit.child) : undefined;
      if (!(sameAsEnabled() && action.same_as?.length) && !frees(action) || terminalActionStatus(action.status) || unit?.kind !== "single" || !child || !(child.scheduling ?? child.communication)?.references) continue;
      try { if (await this.followReferences(actor, s, unit, action, child)) changed = true; }
      catch (error) { if (error instanceof SecretaryRouteRequest) throw error; this.failActionUnit(s, unit, error); changed = true; }
    }
    return changed;
  }
  private async followReferences(actor: ServiceActor, s: Session, unit: ActionUnit, action: PlanAction, child: Session) {
    const scheduling = child.scheduling, message = child.communication, refs = (scheduling ?? message)!.references ?? {};
    // P2b (review B): a seeded service list is compared by its refs in order.
    const listed = (f: SchedulingState["fields"]) => f.service_list_ref?.length && f.service_list_ref.every(Boolean) ? serviceListKey(f.service_list_ref as string[]) : undefined;
    const current = (field: SameAsField) => !scheduling ? message!.target : field === "date" || field === "time" ? scheduling.fields[field] :
      field === "service" ? listed(scheduling.fields) ?? scheduling.fields.service_ref : scheduling.fields[field === "professional" ? "professional_ref" : "customer_ref"];
    const v2 = referencesV2Enabled();
    // D1 (V2): the released origin's own part of the link state (day, clock, professional) is re-derived below, never carried.
    const releaser = v2 && scheduling && action.operation === "appointment.create" && action.released_slot_of ? s.actionPlan!.actions.find(item => item.key === action.released_slot_of && item.operation === "appointment.change") : undefined;
    const originOwned = (field: SameAsField) => !!releaser && (field === "date" || field === "time" || field === "professional");
    const next: SchedulingReferences = { ...(refs.asked?.filter(field => !originOwned(field)).length ? { asked: refs.asked.filter(field => !originOwned(field)) } : {}), ...(refs.notice ? { notice: refs.notice } : {}),
      // V2: a change's own origin link (self), a card or a refusal of a reference stay until the owner answers them.
      ...(refs.origin?.length ? { origin: [...refs.origin] } : {}), ...(refs.card ? { card: refs.card } : {}) };
    for (const field of refs.origin ?? []) if (refs.seeded?.[field] !== undefined) (next.seeded ??= {})[field] = refs.seeded![field]!;
    const fields: SchedulingState["fields"] = {}, kept: SameAsReference[] = [], codes: string[] = [], waits = new Map<string, SameAsField[]>();
    if (releaser) {
      // The owner's own day or clock for this create (after a refusal, or over the seeded origin) ends the released link.
      // A seeded professional that is gone (not eligible: asked) or replaced by the owner's choice ends it too.
      const said = (["date", "time"] as const).some(field => refs.seeded?.[field] !== undefined ? scheduling!.fields[field] !== refs.seeded![field] : !!refs.asked?.includes(field) && scheduling!.fields[field] !== undefined) ||
        refs.seeded?.professional !== undefined && scheduling!.fields.professional_ref !== refs.seeded.professional;
      if (said) codes.push("RELEASED_ORIGIN_OVERRIDDEN");
      else {
        const origin = await this.releasedOrigin(actor, s, action, releaser);
        Object.assign(next, { ...origin.state, ...(origin.state.asked || next.asked ? { asked: [...new Set([...next.asked ?? [], ...origin.state.asked ?? []])] } : {}), seeded: { ...next.seeded, ...origin.state.seeded } });
        if (!Object.keys(next.seeded!).length) delete next.seeded;
        if (["date", "time"].some(field => origin.fields[field as "date"] !== undefined && origin.fields[field as "date"] !== scheduling!.fields[field as "date"]) || origin.fields.professional_ref && origin.fields.professional_ref !== scheduling!.fields.professional_ref)
          Object.assign(fields, origin.fields);
        if (referencesKey({ ...refs, blocked: undefined }) !== referencesKey(next)) codes.push(origin.code);
      }
    }
    let recipient: { ref: string; name: string } | undefined, recurrence: RecurrenceState | undefined;
    for (const ref of action.same_as ?? []) {
      // D-SELF-ORIGIN (V2): the origin link is kept; the adapter seeds it from the located appointment (secretary-scheduling).
      if (v2 && ref.item_key === action.key) { if (refs.origin?.includes(ref.field as "date")) kept.push(ref); continue; }
      const seeded = refs.seeded?.[ref.field], value = current(ref.field), waiting = refs.waiting?.includes(ref.field) ?? false;
      // The owner changed the field itself (directly, or the adapter on the owner's words): the link is over.
      const overridden = seeded === undefined ? value !== undefined || !scheduling && message!.query !== undefined
        : value !== seeded && (ref.field === "date" || ref.field === "time" || value !== undefined);
      if (overridden) { codes.push("SAME_AS_OVERRIDDEN"); continue; }
      const referenced = s.actionPlan!.actions.find(item => item.key === ref.item_key)!;
      const values = await referencedValues(actor, referenced, this.referenceCarrier(s, referenced.key), v2 ? ref : undefined);
      // Review A (V2): a set that became known after the first preparation gets the same outcome as there (a card, the refusal of
      // the named row, asked, or the service list), never an endless wait nor a generic "gone".
      const set = v2 && scheduling ? referenceSetOutcome(action, ref.field, values) : undefined;
      if (set && !set.list) {
        codes.push(set.code);
        if (set.card) next.card = set.card;
        if (set.notice) next.notice = set.notice;
        if (set.asked && value === undefined) (next.asked ??= []).push(set.asked);
        continue;
      }
      const key = set?.list ? set.list.key : referenceKey(ref.field, values);
      if (key !== undefined) {
        (next.seeded ??= {})[ref.field] = key; kept.push(ref);
        if (key !== seeded || waiting) {
          if (scheduling) Object.assign(fields, set?.list ? seededListFields(set.list) : seededFields(ref.field, values)); else recipient = values.customer;
          if (ref.field === "date") recurrence ??= this.inheritedRecurrence(s, referenced, action);
          codes.push("SAME_AS_REDERIVED", ...set?.list ? [set.code] : []);
        }
        if (ref.field === "time" && action.operation === "appointment.change" && referenced.operation === "appointment.cancel" && referenced.status !== "DONE" && values.appointment &&
          this.releaseAfter(s, action.key, referenced.key)) next.released = values.appointment;
        continue;
      }
      if (referenceGone(referenced.status)) { codes.push("SAME_AS_GONE"); if (value === undefined) (next.asked ??= []).push(ref.field); continue; }
      // Not known (yet, or any more): the field waits, linked; a copy of a retracted value is kept but not usable.
      if (seeded !== undefined) (next.seeded ??= {})[ref.field] = seeded;
      (next.waiting ??= []).push(ref.field); kept.push(ref);
      if (!waiting) codes.push("SAME_AS_WAITING");
      waits.set(referenced.key, [...waits.get(referenced.key) ?? [], ref.field]);
    }
    if (waits.size) next.note = referenceWaitingNote(action, [...waits].map(([key, list]) => ({ fields: list, referenced: s.actionPlan!.actions.find(item => item.key === key)! })));
    const relinked = JSON.stringify(kept) !== JSON.stringify(action.same_as ?? []);
    const moved = Object.keys(fields).length > 0 || recipient !== undefined || referencesKey(next) !== referencesKey(refs);
    if (!relinked && !moved) return false;
    if (relinked) this.setReferences(s, action.key, kept);
    if (scheduling && recurrence) scheduling.recurrence = recurrence;
    if (moved) { if (scheduling) await reseedScheduling(actor, scheduling, fields, next); else await reseedCommunication(actor, message!, recipient, next); }
    this.syncActionUnit(actor, s, unit);
    this.routerTrace.getStore()?.failed(...codes);
    return true;
  }

  private savePlan(parent: Session): SuspendedPlan {
    return { actionPlan: parent.actionPlan, actionUnits: parent.actionUnits, children: parent.children,
      loaded: parent.loaded, groupReceipts: parent.groupReceipts };
  }
  async resumePlan(actor: ServiceActor, sessionId: string, planRef: string) {
    return this.persisted(actor, sessionId, "RESUME", () => this.exclusive(actor, sessionId, parent => this.preparePlanSafely(parent, async () => {
      await this.activatePreservedPlan(actor,parent,planRef);
      await this.recordAutomaticState(actor,parent);return this.view(parent);
    })));
  }
  private async activatePreservedPlan(actor:ServiceActor,parent:Session,planRef:string){
      if (parent.cancelled) throw Error("SESSION_CLOSED");
      if (this.multiActionOptions.enabled?.() !== true) throw Error("MULTI_ACTION_V2_DISABLED");
      const saved = parent.suspendedPlans?.find(item => item.actionPlan?.plan_ref === planRef);
      if (!saved?.actionPlan) throw Error("PLAN_NOT_IN_SESSION");
      for (const skill of new Set(saved.actionPlan.actions.map(action => action.skill))) await this.authorize(actor, skill);
      // Validate every child before changing the active plan; retain the original TTL.
      for (const id of saved.children ?? []) this.get(actor, id);
      const current = this.savePlan(parent);
      if (current.actionPlan) current.actionPlan.revision++;
      parent.suspendedPlans = parent.suspendedPlans!.filter(item => item !== saved);
      if (current.actionPlan) parent.suspendedPlans.push(current);
      Object.assign(parent, saved);
      parent.actionPlan!.revision++;
      parent.conversationNotice = undefined; parent.capability_status = undefined;
      parent.actionPlan=refreshActionPlan(parent.actionPlan!);
  }
  /** A later turn may ask to fill the slot released by a cancellation already in
   * this plan ("Coloca o Fábio no lugar"). Luna names the cancellation it refers
   * to; the backend owns the slot. A pending cancellation becomes the atomic
   * cancel→create pair; a confirmed one already freed the slot, so the creation
   * starts from the backend's cancellation receipt. */
  private async appendReleasedSlot(actor:ServiceActor,parent:Session,op:SelectedOperation,message:string){
    const existing=parent.actionPlan!,cancelAction=existing.actions.find(action=>action.key===op.released_slot_of)!;
    const cancelUnit=parent.actionUnits!.find(unit=>unit.keys.includes(cancelAction.key));
    const cancelChild=cancelUnit?.child?this.get(actor,cancelUnit.child):undefined;
    await this.authorize(actor,"scheduling");
    // Validate the linguistic fields exactly like any other added operation.
    // D3 (V2): an "o mesmo serviço" link names the cancellation (an active-plan key): it travels with the atomic pair only.
    const {same_as:links,...unlinked}=op as SelectedOperation&{same_as?:SameAsReference[]};
    const neutral={...(referencesV2Enabled()?unlinked:op),depends_on:[],released_slot_of:null,...((op as Record<string,unknown>).destination_mode==="SAME_RELEASED_SLOT"?{destination_mode:null}:{})} as SelectedOperation;
    const [added]=createActionPlan({skills:["scheduling"],independent:true,operations:[neutral]},existing.policy,"LUNA").actions;
    const done=cancelAction.status==="DONE";
    const released=done?cancelChild?.scheduling?.receipt?.action_snapshot??(cancelChild?.batch?.receipt?cancelChild.batch.draft?.snapshot?.cancel:undefined):undefined;
    const pairable=!done&&cancelUnit?.kind==="single"&&!!cancelChild?.scheduling&&!cancelChild.scheduling.receipt;
    // An unsupported shape never fails the existing plan: the new appointment is
    // added on its own and the backend asks for its day/time.
    const linked=done?released?.kind==="appointment.cancel":pairable;
    if(linked)added.depends_on=[cancelAction.key];
    if(linked&&!done)added.released_slot_of=cancelAction.key;
    const combined=refreshActionPlan({...existing,revision:existing.revision+1,actions:[...existing.actions,added]});
    const started=await this.start(actor,"scheduling"),child=this.get(actor,started.sessionId);
    child.expires=parent.expires;child.inheritedInterpretation=true;
    const next:Session={...parent,actionPlan:combined,actionUnits:[...parent.actionUnits!],children:[...parent.children!,child.id],groupReceipts:new Set(parent.groupReceipts)};
    let unit:ActionUnit;
    if(done||!linked){
      unit={keys:[added.key],kind:"single",child:child.id};next.actionUnits!.push(unit);
      // Backend-owned slot: date/time/professional of the cancelled appointment.
      // Luna's own fields (customer, service, or an explicit new time) are applied on top.
      child.scheduling={...schedulingState(),operation:"appointment.create",fields:linked&&released?{date:released.startLocal.slice(0,10),time:released.startLocal.slice(11,16),professional_name:released.professional_name}:{}};
      await this.planContext.run(parent.id,async()=>{try{await this.applyPlanOperation(actor,child,neutral,message);this.syncActionUnit(actor,next,unit);this.traceDroppedFields(next,[neutral]);}catch(error){this.failActionUnit(next,unit,error);}});
    }else{
      const cancelState=cancelChild!.scheduling!,accepted=cancelState.draft;
      unit={keys:[cancelAction.key,added.key],kind:"scheduling-batch",child:child.id};
      next.actionUnits=next.actionUnits!.filter(item=>item!==cancelUnit);next.actionUnits.push(unit);
      next.children=next.children!.filter(id=>id!==cancelChild!.id);
      this.withdrawProposals(cancelChild!);cancelChild!.cancelled=true;
      child.scheduling=undefined;
      await this.planContext.run(parent.id,async()=>{try{
        child.batch=await startReleasedSlotBatch(actor,{key:cancelAction.key,fields:accepted?.fields??cancelState.fields,source_missing:cancelState.source_missing??accepted?.source_missing},
          {...actionSelection({...added,released_slot_of:cancelAction.key}),...(referencesV2Enabled()&&links?.length?{same_as:links}:{})},message,state=>{child.batch=state;});
        this.syncActionUnit(actor,next,unit);this.traceDroppedFields(next,[neutral]);
      }catch(error){this.failActionUnit(next,unit,error);}});
    }
    Object.assign(parent,this.savePlan(next));await this.recordAutomaticState(actor,parent);return this.view(parent);
  }
  /** D1 (V2): a later turn asks for a new appointment in the slot a reschedule of this plan frees. A single action after the
   * change (depends_on), seeded from the move's origin by prepareReferences (releasedOrigin); never the atomic batch. */
  private async appendReleasedOrigin(actor:ServiceActor,parent:Session,op:SelectedOperation,change:PlanAction,message:string){
    const existing=parent.actionPlan!;
    await this.authorize(actor,"scheduling");
    // Validate the linguistic fields exactly like any other added operation (its graph fields are the backend's).
    const {same_as:_links,...unlinked}=op as SelectedOperation&{same_as?:unknown};void _links;
    const neutral={...unlinked,depends_on:[],released_slot_of:null} as SelectedOperation;
    const [added]=createActionPlan({skills:["scheduling"],independent:true,operations:[neutral]},existing.policy,"LUNA").actions;
    added.depends_on=[change.key];added.released_slot_of=change.key;
    const combined=refreshActionPlan({...existing,revision:existing.revision+1,actions:[...existing.actions,added]});
    const started=await this.start(actor,"scheduling"),child=this.get(actor,started.sessionId);
    child.expires=parent.expires;child.inheritedInterpretation=true;
    const unit:ActionUnit={keys:[added.key],kind:"single",child:child.id};
    const next:Session={...parent,actionPlan:combined,actionUnits:[...parent.actionUnits!,unit],children:[...parent.children!,child.id],groupReceipts:new Set(parent.groupReceipts)};
    await this.planContext.run(parent.id,async()=>{try{
      await this.applyPlanOperation(actor,child,await this.prepareReferences(actor,next,unit,child,neutral,message,[neutral]),message);
      this.syncActionUnit(actor,next,unit);this.traceDroppedFields(next,[neutral]);
    }catch(error){this.failActionUnit(next,unit,error);}});
    Object.assign(parent,this.savePlan(next));await this.recordAutomaticState(actor,parent);return this.view(parent);
  }
  private async appendActionPlan(actor:ServiceActor,parent:Session,selection:CapabilitySelection,message:string){
    const existing=parent.actionPlan!,keys=new Set(existing.actions.map(action=>action.key));
    this.routerTrace.getStore()?.interpreted(selection.operations.length);
    if(selection.operations.some(op=>keys.has(op.item_key!)))throw Error("APPEND_ACTION_EXISTS");
    const only=selection.operations.length===1?selection.operations[0]:undefined;
    const released=only?.released_slot_of?existing.actions.find(action=>action.key===only.released_slot_of):undefined;
    // A discarded cancellation releases no slot: pairing with it would revive it.
    if(released?.status==="DISCARDED")throw Error("INVALID_DEPENDENCY_GRAPH");
    if(only?.operation==="appointment.create"&&only.released_slot_of&&keys.has(only.released_slot_of)&&
      JSON.stringify(only.depends_on)===JSON.stringify([only.released_slot_of])&&
      released!.operation==="appointment.cancel")
      return this.appendReleasedSlot(actor,parent,only,message);
    // D1 (V2): the origin of a reschedule of the plan (pending, or confirmed: its receipt) for a new appointment.
    if(referencesV2Enabled()&&only?.operation==="appointment.create"&&only.released_slot_of&&keys.has(only.released_slot_of)&&
      JSON.stringify(only.depends_on)===JSON.stringify([only.released_slot_of])&&released!.operation==="appointment.change")
      return this.appendReleasedOrigin(actor,parent,only,released!,message);
    for(const skill of selection.skills)await this.authorize(actor,skill);
    // C5: a same_as reference of the addition may name an action of the active plan.
    const addition=createActionPlan(selection,existing.policy,"LUNA",existing.actions.map(action=>({item_key:action.key,operation:action.operation,status:action.status})));
    const combined=refreshActionPlan({...existing,revision:existing.revision+1,actions:[...existing.actions,...addition.actions]});
    const addedUnits=actionUnits(addition);
    const next:Session={...parent,actionPlan:combined,actionUnits:[...parent.actionUnits!,...addedUnits],children:[...parent.children!],groupReceipts:new Set(parent.groupReceipts)};
    const loaded=loadSkills({skill_ids:[...new Set(combined.actions.map(action=>action.skill))]});
    next.loaded=loaded.manuals.map(({skill_id,version,manual_hash})=>({skill_id,version,manual_hash}));
    await this.planContext.run(parent.id,async()=>{for(const unit of addedUnits){try{
      if(unit.kind==="unsupported")throw Error("UNSUPPORTED_DEPENDENCY_ADAPTER");
      const chosen=unitSelection(next.actionPlan!,unit),action=next.actionPlan!.actions.find(item=>item.key===unit.keys[0])!;
      const started=await this.start(actor,unit.kind==="cancellation-message"?"communication":action.skill),child=this.get(actor,started.sessionId);
      child.expires=parent.expires;child.inheritedInterpretation=true;unit.child=child.id;next.children!.push(child.id);
      if(!action.mutation&&action.depends_on.length){await this.preparePlanRead(actor,next,action,action.fields,message,true);continue;}
      if(unit.kind==="scheduling-batch"){child.scheduling=undefined;child.batch=await startBatch(actor,chosen,message,state=>{child.batch=state;},this.batchScope(selection));}
      else if(unit.kind==="cancellation-message")child.communication=await startCancellationMessage(actor,chosen,message,state=>{child.communication=state;});
      else await this.applyPlanOperation(actor,child,await this.prepareReferences(actor,next,unit,child,chosen.operations[0],message,selection.operations),message,false,inventoryWitnesses(selection.operations),inventoryScopes(selection.operations,chosen.operations[0]),selection.operations);
      this.syncActionUnit(actor,next,unit);this.traceDroppedFields(next,chosen.operations);this.checkPlanMessageRecipient(actor,next,unit);
    }catch(error){this.failActionUnit(next,unit,error);}}});
    Object.assign(parent,this.savePlan(next));await this.recordAutomaticState(actor,parent);return this.view(parent);
  }
  private async sendActionPlanTurn(actor: ServiceActor, parent: Session, message: string, operationRef?: string) {
    // A discarded unit's child is closed: answering it is not a way back into the plan.
    if (operationRef && !parent.actionUnits?.some(unit => unit.child === operationRef && !this.discardedUnit(parent, unit))) throw Error("OPERATION_NOT_IN_SESSION");
    parent.conversationNotice = undefined; parent.capability_status = undefined;
    this.view(parent); // Expiry is a backend state transition before routing snapshots.
    const before = this.savePlan(parent);
    // Review 2b: a discard asked last turn is published once, so a "sim" can name every key it covers (DISCARD of
    // those keys). A DISCARD of fewer keys is asked again: a reply like "não, deixa" never discards the linked set.
    const asked = parent.pendingDiscard?.plan_ref === before.actionPlan!.plan_ref && parent.pendingDiscard.keys.every(key =>
      !terminalActionStatus(before.actionPlan!.actions.find(action => action.key === key)?.status ?? "DONE")) ? parent.pendingDiscard : undefined;
    parent.pendingDiscard = undefined;
    const children = (parent.children ?? []).map(id => this.get(actor, id));
    const snapshots = children.map(child => structuredClone(child));
    const operationsOf=(saved:SuspendedPlan)=>(saved.children??[]).map(id=>({operation_ref:id,state:this.view(this.get(actor,id))}));
    const contextFor=(saved:SuspendedPlan)=>planConversationContext(saved.actionPlan!,saved.actionUnits??[],operationsOf(saved));
    // B6: only the active plan's questions are being asked (a suspended plan asks nothing).
    const routingContext={active_plan:{...planConversationContext(before.actionPlan!,before.actionUnits??[],operationsOf(before),this.questionAttempt(parent)),
      ...(asked?{pending_discard:{item_keys:asked.keys,question:asked.question}}:{})},suspended_plans:(parent.suspendedPlans??[]).map(contextFor)};
    // B4: what an option id of THIS turn means (active plan only, same cards as the published context).
    parent.optionBinding={plan_ref:before.actionPlan!.plan_ref,options:planOptions(before.actionPlan!,before.actionUnits??[],operationsOf(before))};
    // The one unit this answer was routed to (a card answered, or the only pending/editable unit), if any.
    let addressed: ActionUnit | undefined;
    try { return await withConversationRouting(() => this.continueActionPlanTurn(actor, parent, message, operationRef, unit => { addressed = unit; }),routingContext); }
    catch (error) {
      const unread = isInterpretationFailure(error);
      if (!unread && !(error instanceof SecretaryRouteRequest)) throw error;
      this.get(actor, parent.id);
      // Routing happened before any adapter accepted a patch. Restore only the
      // in-memory proposal/fields withdrawn in preparation for interpretation.
      children.forEach((child, index) => { const turns = child.turns; Object.assign(child, snapshots[index]); child.turns = Math.max(turns, child.turns); });
      parent.actionPlan!.revision++; // A topic change also invalidates approvals for an unselected/complete plan.
      if (!unread && error instanceof SecretaryDiscardRequest && operationRef) {
        // An answer to one card discards that card's unit only (null = that unit); another card's key is not this answer.
        const own = parent.actionUnits!.find(unit => unit.child === operationRef)!.keys;
        if (error.itemKeys?.some(key => !own.includes(key))) return this.keepPlanAfterUnreadAnswer(actor, parent, Error("DISCARD_ACTION_MISMATCH"), addressed);
        return this.discardPlanActions(actor, parent, error.itemKeys ?? own);
      }
      if (unread) return this.keepPlanAfterUnreadAnswer(actor, parent, error, addressed);
      if (error instanceof SecretaryDiscardRequest) return this.discardPlanActions(actor, parent, error.itemKeys);
      if (!(error instanceof SecretaryNewRequest) && !(error instanceof SecretaryResumeRequest)) throw Error("CONVERSATION_ROUTE_CONFLICT");
      if(error instanceof SecretaryResumeRequest){
        await this.activatePreservedPlan(actor,parent,error.planRef);
        if(error.patches?.operations.length){
          this.noteRejected(parent,error.patches,message,true);
          await this.applyExistingPlanPatches(actor,parent,parent.actionUnits??[],error.patches,message);
        }
        await this.recordAutomaticState(actor,parent);return this.view(parent);
      }
      const selection = error.selection;
      if (!selection.operations.length) {
        parent.capability_status = selection.disposition === "CONVERSATION" ? "CONVERSATION" : selection.disposition === "UNSUPPORTED" ? "UNSUPPORTED" : "AMBIGUOUS";
        parent.conversationNotice = selection.disposition === "CONVERSATION" ? selection.conversation_response! : selection.disposition === "UNSUPPORTED" ? unsupportedTurnNotice(selection.unavailable_capability,message)
          : "Não identifiquei uma alteração ou um novo pedido. O pedido anterior foi preservado. O que deseja fazer?";
        return this.view(parent);
      }
      this.noteRejected(parent, selection, message, error.mode === "PATCH");
      if(error.mode==="PATCH") return this.applyExistingPlanPatches(actor,parent,parent.actionUnits??[],selection,message);
      if(error.mode==="ADD") return this.appendActionPlan(actor,parent,selection,message);
      // A plan left with only completed/discarded actions is retired, never kept for resumption.
      const retired = this.retirable(before.actionPlan);
      if (!retired && (parent.suspendedPlans?.length ?? 0) >= 5) throw Error("SUSPENDED_PLAN_LIMIT");
      for (const skill of selection.skills) await this.authorize(actor, skill);
      const loaded = loadSkills({skill_ids:selection.skills});
      const next: Session = {...parent, actionPlan:undefined, actionUnits:undefined, children:undefined, groupReceipts:undefined,
        loaded:loaded.manuals.map(({skill_id,version,manual_hash})=>({skill_id,version,manual_hash}))};
      await this.startActionPlan(actor, next, selection, message);
      if (!retired) parent.suspendedPlans = [...(parent.suspendedPlans ?? []), before];
      Object.assign(parent, this.savePlan(next));
      return this.view(parent);
    }
    finally { parent.optionBinding = undefined; }
  }
  private async continueActionPlanTurn(actor: ServiceActor, parent: Session, message: string, operationRef?: string, onUnit?: (unit: ActionUnit) => void) {
    markSecretaryTiming("T3"); // A deterministic continuation already has a decomposed plan.
    if (this.multiActionOptions.enabled?.() !== true) throw Error("MULTI_ACTION_V2_DISABLED");
    const pending = parent.actionUnits!.filter(unit => unit.child && unit.keys.some(key =>
      (parent.actionPlan!.actions.find(item => item.key === key)!.missing_fields.length || awaitsProposal(parent.actionPlan!.actions.find(item=>item.key===key)!))));
    const open=parent.actionUnits!.filter(unit=>unit.child&&unit.keys.some(key=>!terminalActionStatus(parent.actionPlan!.actions.find(action=>action.key===key)!.status)));
    // Multiple ready actions are still editable. Let Luna choose the existing key.
    // A single missing action retains the short-answer adapter compatibility path.
    if (!operationRef && (pending.length>1 || pending.length===0 && open.length>1)) return this.continueMultipleActions(actor,parent,open,message);
    // A complete proposal can still be corrected. With a single open unit its
    // target is unambiguous; ignoring that turn left the old approval executable.
    const editable = parent.actionUnits!.filter(item => item.child && item.keys.some(key => {
      const action = parent.actionPlan!.actions.find(candidate => candidate.key === key)!;
      return action.mutation && action.status === "READY_FOR_CONFIRMATION";
    }));
    const unit = operationRef ? parent.actionUnits!.find(item => item.child === operationRef) : pending.length === 1 ? pending[0] :
      pending.length === 0 && editable.length === 1 ? editable[0] : undefined;
    if (!unit?.child) {
      // Preview carries the minimal per-action questions and preserves every completed sibling.
      if (operationRef) throw Error("OPERATION_NOT_IN_SESSION");
      if (parent.turns >= 20) throw Error("TURN_LIMIT");
      parent.turns++;
      const model = instrumentServicesModel(await this.measuredModel(), this.modelId(), usageRecorder(actor, parent.id, randomUUID(), this.modelId()));
      const selection = await runServicesTurn(model, message, {}, routedTurnRequirements(), "discovery", true);
      throw new SecretaryNewRequest(selection);
    }
    onUnit?.(unit);
    parent.actionPlan!.revision++; // Any attempted correction invalidates the old group approval, even if parsing fails.
    // Telemetry: one delta addressed to this unit's adapter, unless the turn is rerouted to a new/resumed plan.
    const addressed = () => this.routerTrace.getStore()?.interpreted(1);
    await this.planContext.run(parent.id, async () => {
      try {
        const action = parent.actionPlan!.actions.find(item => item.key === unit.keys[0])!;
        if (!action.mutation && action.depends_on.length) {
          await this.patchDeferredRead(actor, parent, action.key, message);
          addressed(); return;
        }
        await this.send(actor, { sessionId: unit.child, message });
        addressed();
        this.syncActionUnit(actor, parent, unit);
        this.checkPlanMessageRecipient(actor, parent, unit);
      } catch (error) {
        // B5: an answer that could not be read changed nothing: the plan keeps this action (sendActionPlanTurn).
        if (error instanceof SecretaryRouteRequest || isInterpretationFailure(error)) throw error;
        addressed(); this.failActionUnit(parent, unit, error);
      }
    });
    markSecretaryTiming("T4");
    await this.recordAutomaticState(actor, parent);
    return this.view(parent);
  }

  /** One interpretation maps a combined answer to existing incomplete actions. No new plan/keys. */
  private async continueMultipleActions(actor: ServiceActor, parent: Session, pending: ActionUnit[], message: string) {
    if (parent.turns >= 20) throw Error("TURN_LIMIT");
    parent.actionPlan=refreshActionPlan({...parent.actionPlan!,revision:parent.actionPlan!.revision+1});
    const eligible = parent.actionPlan!.actions.filter(action => !terminalActionStatus(action.status) &&
      pending.some(unit => unit.keys.includes(action.key)));
    const model = instrumentServicesModel(await this.measuredModel(), this.modelId(), usageRecorder(actor, parent.id, randomUUID(), this.modelId()));
    parent.turns++;
    // C6: with JIT the routing context already publishes these actions in full; the draft names their keys only.
    const selection = await runServicesTurn(model, message, continuationDraft(
      planConversationContext(parent.actionPlan!,parent.actionUnits??[],(parent.children??[]).map(id=>({operation_ref:id,state:this.view(this.get(actor,id))})),this.questionAttempt(parent)).actions.filter(action=>eligible.some(item=>item.key===action.item_key))),
      continuationRequirements(), "discovery", true);
    this.noteRejected(parent, selection, message, true);
    return this.applyExistingPlanPatches(actor,parent,pending,selection,message);
  }
  private async applyExistingPlanPatches(actor:ServiceActor,parent:Session,pending:ActionUnit[],selection:CapabilitySelection,message:string){
    this.get(actor,parent.id);
    this.routerTrace.getStore()?.interpreted(selection.operations.length);
    const eligible=parent.actionPlan!.actions.filter(action=>!terminalActionStatus(action.status) && pending.some(unit=>unit.keys.includes(action.key)));
    // Every target is checked before changing a draft; completed actions are immutable.
    for (const op of selection.operations) if (!eligible.some(action => action.key === op.item_key && action.operation === op.operation) || op.depends_on.length || op.released_slot_of)
      throw Error("CONTINUATION_ACTION_MISMATCH");
    // Review 2b: a correction of an existing action that was left out (B5) was not applied: that action is held for review.
    const held = (selection.rejected ?? []).flatMap(item => item.item_key && parent.actionPlan!.actions.some(action => action.key === item.item_key) ? [item.item_key] : []);
    if (!selection.operations.length) {
      this.holdForReview(parent, held);
      parent.capability_status=selection.disposition==="CONVERSATION"?"CONVERSATION":selection.disposition==="UNSUPPORTED"?"UNSUPPORTED":"AMBIGUOUS";
      parent.conversationNotice=selection.disposition==="CONVERSATION"?selection.conversation_response!:selection.disposition==="UNSUPPORTED"?unsupportedTurnNotice(selection.unavailable_capability,message):"Qual ação deseja ajustar? O pedido continua preservado.";
      return this.view(parent);
    }
    parent.actionPlan!.revision++;
    // B4: an option choice rides beside the capability delta; every adapter only ever sees the delta.
    const choices = new Map(selection.operations.flatMap(op => { const choice = operationChoice(op); return choice ? [[op.item_key!, choice] as const] : []; }));
    const operations = selection.operations.map(op => { const { choice: _choice, ...delta } = op as SelectedOperation & { choice?: unknown }; void _choice; return delta as SelectedOperation; });
    const asked: string[] = [];
    await this.planContext.run(parent.id, async () => {
      const touched = new Set<ActionUnit>();
      for (let op of operations) {
        const unit = pending.find(item => item.keys.includes(op.item_key!))!;
        const child = this.get(actor, unit.child!);
        try {
          const choice = choices.get(op.item_key!);
          if (choice) {
            const rest = await this.applyOptionChoice(actor, parent, unit, child, op, choice, message, operations);
            if (!rest) { asked.push(op.item_key!); continue; }
            this.syncActionUnit(actor, parent, unit); touched.add(unit);
            if (!deltaHasContent(rest as unknown as Record<string, unknown>)) continue;
            op = rest; // What the owner said besides the choice (e.g. the new time) applies after it.
          }
          if (!parent.actionPlan!.actions.find(action=>action.key===op.item_key)!.mutation && parent.actionPlan!.actions.find(action=>action.key===op.item_key)!.depends_on.length) {
            const action=parent.actionPlan!.actions.find(action=>action.key===op.item_key)!;
            const {operation:_o,item_key:_k,depends_on:_d,released_slot_of:_r,...patch}=op;void _o;void _k;void _d;void _r;
            await this.preparePlanRead(actor,parent,action,patch,message);
            continue; // Deferred reads have no executed child state to project yet.
          } else if (child.batch) {
            const fields = schedulingPatch.parse(Object.fromEntries(Object.entries(op).filter(([key, value]) => key in schedulingPatch.shape && value != null)));
            const timezone = await withTenant(actor, tx => schedulingTimezone(tx, actor));
            const changed = groundBatchPatch(child.batch.plan, op.item_key!, fields, message, timezone, op.temporal_evidence ?? undefined, child.batch.draft,(op as {temporal_negative_context?:unknown}).temporal_negative_context);
            if (op.temporal_evidence?.some(entry => entry.conflict)) this.routerTrace.getStore()?.failed("TEMPORAL_SELECTOR_CONFLICT");
            await prepareBatch(actor, child.batch, changed);
          } else await this.applyPlanOperation(actor, child, op, message,false,inventoryWitnesses(operations),inventoryScopes(operations,op),operations);
          this.syncActionUnit(actor, parent, unit); touched.add(unit); this.traceDroppedFields(parent, [op]);
        } catch (error) { if (error instanceof SecretaryRouteRequest) throw error; this.failActionUnit(parent, unit, error); }
      }
      for (const unit of touched) this.checkPlanMessageRecipient(actor, parent, unit);
    });
    this.holdForReview(parent, held);
    if (asked.length) {
      // The card (if still open) asks again with its current options; nothing of that item changed.
      const views = (parent.children ?? []).map(id => ({ operation_ref: id, state: this.view(this.get(actor, id)) }));
      parent.conversationNotice = `Não consegui aplicar essa escolha com segurança; nada foi alterado nesse item.\n\n${secretaryPlanMessage(parent.actionPlan!, parent.actionUnits ?? [], views)}`;
    }
    markSecretaryTiming("T4");
    await this.recordAutomaticState(actor, parent);
    return this.view(parent);
  }
  /** B4: an option Luna chose by id. It resolves only through the card published THIS turn (same plan,
   * same action, and the card still offering that very ref at that position); its literal must be the
   * owner's own, undenied words and must single out that option on the card (choiceVerdict: names, phone
   * ending, position, and for appointments the day/clock it states against fresh coordinates); every echoed
   * name/day/clock must agree with the option too. The adapter's own select path then re-queries the tenant
   * (SELECTION_INVALID for a stale ref). Any doubt asks again: returns undefined, never throws for staleness
   * and never auto-picks. Otherwise returns the delta left to apply. */
  private async applyOptionChoice(actor: ServiceActor, parent: Session, unit: ActionUnit, child: Session, op: SelectedOperation, choice: OptionChoice, message: string,
    siblings: readonly SelectedOperation[]): Promise<SelectedOperation | undefined> {
    const trace = this.routerTrace.getStore(), key = op.item_key!, action = parent.actionPlan!.actions.find(item => item.key === key)!;
    const published = parent.optionBinding?.plan_ref === parent.actionPlan!.plan_ref ? parent.optionBinding.options[key]?.find(option => option.option_id === choice.option_id) : undefined;
    const current = planOptions(parent.actionPlan!, [unit], [{ operation_ref: unit.child!, state: this.view(child) }])[key]?.[optionIndex(choice.option_id)];
    if (!published || !current || current.ref !== published.ref || current.field !== published.field) { trace?.failed("OPTION_STALE"); return; }
    const spans = literalProofSpans(message, choice.literal);
    if (!spans.length) { trace?.failed("OPTION_LITERAL_ABSENT"); return; }
    // Never a negation turned into a pick ("essa não"): the owner's words must not be denied in their own clause.
    if (spans.some(([start, end]) => temporalQuoteDenied(message, start, end, "appointment.change"))) { trace?.failed("OPTION_LITERAL_NEGATED"); return; }
    // Review B (P3c): a typed yes to "só a primeira?" in a turn whose own words state the recurrence again ("pode ser, mas lembra
    // que é toda sexta") is not a yes to one occurrence: asked again (the owner's click stays unaffected).
    const held = child.scheduling?.fields;
    if (published.field === RECURRENCE_CARD && recurrenceFromTurn(undefined, action.operation, actionScopedSource(message, op, siblings).text,
      [held?.service_name, ...held?.service_names ?? [], held?.customer_name, held?.professional_name]).stated) { trace?.failed("OPTION_RECURRENCE_RESTATED"); return; }
    const scheduling = child.scheduling ?? (action.operation === "appointment.cancel" ? child.communication?.cancel : undefined);
    const batchItem = child.batch?.plan.items.find(item => item.key === key), batchPick = child.batch?.draft?.candidates;
    const card = parent.optionBinding!.options[key]!, appointment = published.field === "appointment_ref";
    // D1: an alias card (a learned name's proposal plus its refusal) is click-only. It lists one of possibly several
    // entities the typed name matches, so no literal can single out an option on it.
    if (scheduling?.candidates?.source === "alias") { trace?.failed("OPTION_CLICK_REQUIRED"); return; }
    // A C3 suggestion/confirmation card keeps its rule: resolved by a click or by the owner writing the name.
    const suggested = Boolean(scheduling?.candidates?.source || batchPick?.item_key === key && batchPick.source || child.customer?.suggested);
    if (suggested && !writesOptionName(choice.literal, published, card)) { trace?.failed("OPTION_NAME_REQUIRED"); return; }
    // Every card: the literal itself must point at this option and at no other (a temporal claim needs literal proof).
    const coordinates = appointment ? await withTenant(actor, tx => Promise.all(card.map(option => getSchedulingAppointment(tx, actor, option.ref)
      .then(row => ({ day: row.start_local.slice(0, 10), clock: row.start_local.slice(11, 16) }), () => undefined)))) : undefined;
    if (coordinates && !coordinates[optionIndex(choice.option_id)]) { trace?.failed("OPTION_SELECTION_INVALID"); return; } // Gone meanwhile: stale, asked again.
    const facts = appointment ? quoteTemporalFacts(choice.literal, await withTenant(actor, tx => schedulingTimezone(tx, actor)), new Date()) : undefined;
    const verdict = choiceVerdict(choice.literal, published, card, coordinates, facts);
    if (verdict !== "OK") { trace?.failed(verdict); return; }
    const { echo, echoEvidence, rest } = splitChoiceDelta(op as unknown as Record<string, unknown>, published, action.operation);
    const fields = (scheduling?.fields ?? batchItem?.fields ?? action.fields) as Record<string, unknown>;
    const temporal = appointment ? new Set<string>(appointmentEchoRoles(action.operation).keys) : new Set<string>();
    const agrees = Object.entries(echo).every(([path, value]) => temporal.has(path) || nameEchoAgrees(path, value, published, fields)) &&
      (!appointment || await schedulingChoiceAgrees(actor, { fields: fields as SchedulingState["fields"], operation: action.operation, waiting_for: scheduling?.waiting_for, draft: scheduling?.draft },
        published.ref, Object.fromEntries(Object.entries(echo).filter(([path]) => temporal.has(path))), echoEvidence, batchItem ? message : actionScopedSource(message, op, siblings).text));
    if (!agrees) { trace?.failed("OPTION_ECHO_MISMATCH"); return; }
    try { await this.selectChild(actor, child, published.ref); }
    catch (error) { if (error instanceof Error && error.message === "SELECTION_INVALID") { trace?.failed("OPTION_SELECTION_INVALID"); return; } throw error; }
    return rest as unknown as SelectedOperation;
  }

  private async preparePlanRead(actor:ServiceActor,parent:Session,action:ActionPlan["actions"][number],patch:Record<string,unknown>,message:string,initial=false) {
    if(action.mutation||!action.depends_on.length)throw Error("DEFERRED_READ_REQUIRED");
    const unit=parent.actionUnits!.find(item=>item.keys.includes(action.key))!,child=this.get(actor,unit.child!);
    const priorMissing=initial?[]:action.missing_fields;
    const neutralFields=Object.fromEntries(Object.entries(action.fields).map(([key,value])=>[key,Array.isArray(value)?[]:null])) as unknown as typeof action.fields;
    const residual=initial?undefined:firstTemporalAmbiguity(action.assessment.pending_temporal_ambiguities);
    const calendar=initial?undefined:firstCalendarConflict(action.assessment.pending_calendar_conflicts);
    const grounded=await prepareDeferredReadFields(actor,initial?{...action,fields:neutralFields}:action,patch,message,calendar?.field??residual?.field??(priorMissing.length===1?priorMissing[0]:undefined),new Date(),initial?undefined:{draft_ref:parent.actionPlan!.plan_ref,draft_revision:parent.actionPlan!.revision,expires_at:new Date(parent.expires).toISOString(),pending_temporal_ambiguities:action.assessment.pending_temporal_ambiguities,pending_calendar_conflicts:action.assessment.pending_calendar_conflicts});
    if(calendar&&grounded.rejected.length&&JSON.stringify(grounded.pending_calendar_conflicts)===JSON.stringify(action.assessment.pending_calendar_conflicts))return;
    if(residual&&grounded.rejected.some(item=>!grounded.pending_temporal_ambiguities.some(pending=>pending.field===item.field)))return;
    action.fields=grounded.fields;
    delete action.fields.source_scope;
    if(action.fields.inventory)delete action.fields.inventory.reference;
    const base=deferredReadAssessment(action);
    const temporalFields=["date","source_date","end_date","time","source_time","end_time"];
    const suppliedTemporal=(field:string)=>[field,...(field==="date"?["day_offset","weekday"]:field==="source_date"?["source_day_offset","source_weekday"]:[])].some(key=>patch[key]!=null);
    const missing=[...new Set([...base.missing_fields,...grounded.missing,...priorMissing.filter(field=>temporalFields.includes(field)&&(!suppliedTemporal(field)||(action.fields as Record<string,unknown>)[field]==null))])];
    const nextResidual=firstTemporalAmbiguity(grounded.pending_temporal_ambiguities);
    const nextCalendar=firstCalendarConflict(grounded.pending_calendar_conflicts);
    const assessment:ActionAssessment={...base,status:missing.length?"NEEDS_INPUT":"READY",missing_fields:missing,...(grounded.pending_temporal_ambiguities.length?{pending_temporal_ambiguities:grounded.pending_temporal_ambiguities,preview:temporalAmbiguityQuestion(nextResidual!)}:{}),...(grounded.pending_calendar_conflicts.length?{pending_calendar_conflicts:grounded.pending_calendar_conflicts,preview:calendarConflictQuestion(nextCalendar!)}:{})};
    if(child.scheduling){
      child.scheduling.operation=action.operation as SchedulingInterpretation["operation"];
      child.scheduling.fields=schedulingPatch.parse(Object.fromEntries(Object.entries(action.fields).filter(([key,value])=>key in schedulingPatch.shape&&value!=null)));
      child.scheduling.pending_temporal_ambiguities=grounded.pending_temporal_ambiguities;
      child.scheduling.pending_calendar_conflicts=grounded.pending_calendar_conflicts;
      child.scheduling.waiting_for=nextCalendar?.field??nextResidual?.field??(missing.length===1?missing[0] as SchedulingState["waiting_for"]:undefined);
      child.scheduling.message=assessment.preview??"";
    }else if(child.financial){
      child.financial.fields=action.fields.financial??{};child.financial.missing_fields=missing;child.financial.message=assessment.preview??"";
      const financialPatch=patch.financial as Record<string,unknown>|null|undefined;
      if(financialPatch && (financialPatch.period!=null||financialPatch.compare_period!=null)){
        const salon=await withTenant(actor,tx=>assertFinancialAccess(tx,actor));
        const references=child.deferredFinancialReferences;
        if(references&&references.timezone!==salon.timezone)throw Error("FINANCIAL_CONTEXT_CHANGED");
        child.deferredFinancialReferences={...references,timezone:salon.timezone,
          ...(financialPatch.period!=null?{period:new Date().toISOString()}:{}),
          ...(financialPatch.compare_period!=null?{compare_period:new Date().toISOString()}:{})};
      }
    }else if(child.inventory){child.inventory.query=action.fields.inventory?.product_name??undefined;child.inventory.low_stock=action.fields.inventory?.low_stock??undefined;}
    else if(child.customer){child.customer.query=action.fields.target_name??undefined;child.customer.operation=action.operation as CustomerInterpretation["operation"];}
    parent.actionPlan=assessPlanAction(parent.actionPlan!,action.key,assessment);
  }

  private async patchDeferredRead(actor: ServiceActor, parent: Session, key: string, message: string) {
    const action = parent.actionPlan!.actions.find(item => item.key === key)!;
    if (parent.turns >= 20) throw Error("TURN_LIMIT");
    parent.turns++;
    const model = instrumentServicesModel(await this.measuredModel(), this.modelId(), usageRecorder(actor, parent.id, randomUUID(), this.modelId()));
    let fields: Record<string, unknown>;
    const context=clarificationContext({operation:action.operation,fields:action.fields,missing_fields:action.missing_fields,pending_temporal_ambiguities:action.assessment.pending_temporal_ambiguities,pending_calendar_conflicts:action.assessment.pending_calendar_conflicts,message:this.view(parent).message});
    if (action.skill === "financial") fields = { financial: await runServicesTurn(model, message, {...context,fields:action.fields.financial}, { operation: action.operation }, "financial") };
    else if (action.skill === "inventory") {
      const { operation, ...patch } = await runServicesTurn(model, message, {...context,fields:action.fields.inventory}, { operation: action.operation }, "inventory");
      if (operation && operation !== action.operation) throw Error("OPERATION_MISMATCH");
      fields = { inventory: patch };
    } else if (action.skill === "customers") {
      const { operation, ...patch } = await runServicesTurn(model, message, context, { operation: action.operation }, "customers");
      if (operation && operation !== action.operation) throw Error("OPERATION_MISMATCH");
      fields = patch;
    } else {
      const { operation, ...patch } = await runServicesTurn(model, message, context, { operation: action.operation }, "scheduling");
      if (operation && operation !== action.operation) throw Error("OPERATION_MISMATCH");
      fields = patch;
    }
    this.get(actor, parent.id);
    const op = { ...actionSelection(action), ...fields, depends_on: [], released_slot_of: null };
    const valid = validateSelectionV2({ skills: [action.skill], independent: true, operations: [op] }).operations[0];
    await this.preparePlanRead(actor,parent,action,Object.fromEntries(Object.keys(fields).map(key=>[key,valid[key as keyof typeof valid]])),message);
  }

  /** Class API for controlled backend validation. No Front/Meta endpoint is introduced in this gate. */
  async confirmActionPlanGroup(actor: ServiceActor, sessionId: string, input: unknown): Promise<SecretaryView> {
    return this.persisted(actor, sessionId, "CONFIRMATION", () => this.exclusive(actor, sessionId, async parent => {
      if (!parent.actionPlan || parent.cancelled || this.multiActionOptions.enabled?.() !== true) throw Error("MULTI_ACTION_V2_DISABLED");
      const approval = groupConfirmationInput.parse(input);
      if (approval.plan_ref !== parent.actionPlan.plan_ref) throw Error("CONFIRMATION_STALE");
      if (parent.groupReceipts?.has(JSON.stringify(approval))) return this.view(parent);
      if (approval.revision !== parent.actionPlan.revision) throw Error("CONFIRMATION_STALE");
      if (["UNSUPPORTED","AMBIGUOUS","CONVERSATION"].includes(parent.capability_status??"")) throw Error("PLAN_NOT_READY");
      // A first late click still receives the historical failed-safe result. Validate
      // the exact group token first and reject the whole group before any executor.
      // If a prior view already invalidated it, the revision check above stays stale.
      const group=parent.actionPlan.confirmation_groups.find(item=>item.key===approval.group_key);
      const expired=parent.actionUnits?.some(unit=>unit.child&&unit.keys.some(key=>group?.action_keys.includes(key))&&this.hasExpiredProposal(this.get(actor,unit.child)));
      if(expired){
        parent.actionPlan=await executeConfirmationGroup(parent.actionPlan,input,async()=>({status:"FAILED_SAFE",missing_fields:[],issue:"PROPOSAL_EXPIRED",preview:expiredProposalMessage}));
        await this.recordAutomaticState(actor,parent);
        return this.view(parent);
      }
      this.view(parent);
      parent.actionPlan = await this.planContext.run(parent.id, () => executeConfirmationGroup(parent.actionPlan!, input, this.groupExecutor(actor, parent)));
      (parent.groupReceipts ??= new Set()).add(JSON.stringify(approval));
      await this.recordAfterCommit(parent, () => this.recordAutomaticState(actor, parent));
      return this.view(parent);
    }));
  }
  /** One approved group: each unit's child is confirmed once, through its current proposal, by the
   * authenticated idempotent domain confirm. Shared by the single-group and ready-groups paths. */
  private groupExecutor(actor: ServiceActor, parent: Session) {
    const executed = new Set<string>();
    return async (action: ActionPlan["actions"][number]) => {
      const unit = parent.actionUnits!.find(item => item.keys.includes(action.key))!;
      if (!unit.child) throw Error("UNSUPPORTED_DEPENDENCY_ADAPTER");
      const child = this.get(actor, unit.child);
      if (!executed.has(unit.child)) {
        this.checkPlanMessageRecipient(actor, parent, unit, true);
        if (!action.mutation) await this.applyPlanOperation(actor, child, unitSelection(parent.actionPlan!, unit).operations[0], "",true);
        else {
          const proposal = viewProposal(this.view(child));
          if (!proposal) throw Error("PROPOSAL_MISMATCH");
          await this.confirm(actor, child.id, { proposal_ref: proposal.proposal_ref, draft_revision: proposal.draft_revision });
        }
        executed.add(unit.child);
      }
      return assessmentFromView(this.view(child), action);
    };
  }
  /** Units of these actions whose live child proposal differs from the token the plan (and so the
   * approval) carries. Such a unit is re-assessed from its child and never executed in this call. */
  private changedProposalUnits(actor: ServiceActor, parent: Session, keys: readonly string[]) {
    const plan = parent.actionPlan!;
    return (parent.actionUnits ?? []).filter(unit => unit.keys.some(key => keys.includes(key))).filter(unit => {
      const writes = unit.keys.map(key => plan.actions.find(action => action.key === key)!).filter(action => action.mutation && action.status !== "DONE");
      if (!writes.length) return false;
      if (!unit.child) return true;
      const proposal = viewProposal(this.view(this.get(actor, unit.child)));
      const token = proposal ? `${proposal.proposal_ref}:${proposal.draft_revision}:${proposal.payload_hash}` : undefined;
      return writes.some(action => !token || action.assessment.proposal_token !== token);
    });
  }

  /** "Confirmar tudo que está pronto": several explicit group approvals in one authenticated call.
   * Every approval is validated against the CURRENT plan before anything runs; one mismatch rejects
   * the whole request (CONFIRMATION_STALE) with nothing executed. Admitted groups then run in execution
   * order; a later group runs only while its members, proposal tokens and live proposals are exactly
   * what was approved, otherwise it is reported and left for a new approval. An expired proposal fails
   * only its own group. Receipted approvals and exact replays return the recorded outcome. */
  async confirmReadyGroups(actor: ServiceActor, sessionId: string, input: unknown): Promise<SecretaryView> {
    return this.persisted(actor, sessionId, "CONFIRMATION", () => this.exclusive(actor, sessionId, async parent => {
      if (!parent.actionPlan || parent.cancelled || this.multiActionOptions.enabled?.() !== true) throw Error("MULTI_ACTION_V2_DISABLED");
      const parsed = readyGroupsConfirmationInput.safeParse(input);
      if (!parsed.success) throw Error("CONFIRMATION_BATCH_INVALID");
      const approvals = parsed.data, plan = parent.actionPlan;
      if (approvals.some(approval => approval.plan_ref !== plan.plan_ref)) throw Error("CONFIRMATION_STALE");
      const replayKey = JSON.stringify(approvals), recorded = this.batchReceipts.get(parent)?.get(replayKey);
      if (recorded) return { ...this.view(parent), confirmation_batch: structuredClone(recorded) };
      const receipted = (approval: typeof approvals[number]) => parent.groupReceipts?.has(JSON.stringify(approval)) ?? false;
      const report: ConfirmationBatchReport = { executed: [], replayed: approvals.filter(receipted).map(approval => approval.group_key), not_executed: [] };
      const pending = approvals.filter(approval => !receipted(approval));
      if (!pending.length) return { ...this.view(parent), confirmation_batch: report };
      if (["UNSUPPORTED","AMBIGUOUS","CONVERSATION"].includes(parent.capability_status??"")) throw Error("PLAN_NOT_READY");
      // No view() before admission: projecting another group's expiry must not stale this approval.
      const admitted = admitConfirmationBatch(plan, pending);
      await this.planContext.run(parent.id, async () => {
        for (const item of admitted) {
          const current = parent.actionPlan!, same = (keys: readonly string[]) => keys.length === item.action_keys.length && keys.every(key => item.action_keys.includes(key));
          const group = current.confirmation_groups.find(candidate => same(candidate.action_keys));
          const changed = () => report.not_executed.push({ group_key: item.approval.group_key, code: "GROUP_CHANGED" });
          if (!group || group.status !== "READY_FOR_CONFIRMATION" || confirmationGroupContent(current, group.action_keys) !== item.content) { changed(); continue; }
          const approval = { plan_ref: current.plan_ref, revision: current.revision, group_key: group.key, fingerprint: group.fingerprint };
          if (parent.actionUnits?.some(unit => unit.child && unit.keys.some(key => group.action_keys.includes(key)) && this.hasExpiredProposal(this.get(actor, unit.child)))) {
            parent.actionPlan = await executeConfirmationGroup(current, approval, async () => ({ status: "FAILED_SAFE", missing_fields: [], issue: "PROPOSAL_EXPIRED", preview: expiredProposalMessage }));
            report.not_executed.push({ group_key: item.approval.group_key, code: "PROPOSAL_EXPIRED" }); continue;
          }
          const stale = this.changedProposalUnits(actor, parent, group.action_keys);
          if (stale.length) { for (const unit of stale) this.syncActionUnit(actor, parent, unit); changed(); continue; }
          parent.actionPlan = await executeConfirmationGroup(current, approval, this.groupExecutor(actor, parent));
          (parent.groupReceipts ??= new Set()).add(JSON.stringify(item.approval));
          report.executed.push(item.approval.group_key);
        }
      });
      const receipts = this.batchReceipts.get(parent) ?? new Map<string, ConfirmationBatchReport>();
      this.batchReceipts.set(parent, receipts.set(replayKey, structuredClone(report)));
      await this.recordAfterCommit(parent, () => this.recordAutomaticState(actor, parent));
      return { ...this.view(parent), confirmation_batch: report };
    }));
  }

  async selectAutomatic(actor: ServiceActor, sessionId: string, operationRef: string, ref: string) {
    return this.persisted(actor, sessionId, "SELECTION", () => this.exclusive(actor,sessionId,parent=>this.preparePlanSafely(parent,()=>this.planContext.run(parent.actionPlan ? parent.id : "", async () => {
      if (parent.actionPlan && this.multiActionOptions.enabled?.() !== true) throw Error("MULTI_ACTION_V2_DISABLED");
      if (parent.actionPlan) parent.actionPlan.revision++;
      const child=this.child(actor,parent,operationRef);
      // D1 aliases: the owner's own click is the only selection an alias may be learned from.
      await this.selectChild(actor,child,ref,{ clicked: true });
      if (parent.actionPlan) { const unit = parent.actionUnits!.find(item => item.child === child.id)!; this.syncActionUnit(actor, parent, unit); this.checkPlanMessageRecipient(actor, parent, unit); }
      parent.conversationNotice=undefined;parent.capability_status=undefined;
      await this.recordAutomaticState(actor,parent); return this.view(parent);
    }),operationRef)));
  }
  /** One adapter selection by backend ref (a click, or an option id already bound by the backend).
   * Every adapter re-queries the tenant and refuses a ref its fresh card lacks (SELECTION_INVALID). */
  private async selectChild(actor: ServiceActor, child: Session, ref: string, origin: { clicked?: boolean } = {}) {
    if(child.communication){if(child.cancelled)throw Error("SESSION_CLOSED");await selectCommunication(actor,child.communication,ref,origin);}
    else if(child.inventory){if(child.cancelled)throw Error("SESSION_CLOSED");await selectInventory(actor,child.inventory,ref);}
    else if(child.batch) await selectBatch(actor,child.batch,ref);
    else if(child.scheduling) await selectScheduling(actor,child.scheduling,ref,origin);
    else if(child.skill === "customers") await this.selectCustomer(actor,child.id,ref); else await this.selectService(actor,child.id,ref);
  }
  /** B4 slot click: applies one time-slot alternative the backend offered (view `options`) as the
   * deterministic short answer {time} — the fast-path parser and grounding, no model call — and prepares
   * the proposal again. The option is positional over the CURRENT alternatives and, in a plan, bound to
   * the revision the screen showed; anything stale is OPTION_UNAVAILABLE. Never confirms or overrides. */
  async selectOption(actor: ServiceActor, sessionId: string, input: unknown) {
    const { operation_ref, option_id, revision } = optionInput.parse(input);
    return this.persisted(actor, sessionId, "SELECTION", () => this.exclusive(actor,sessionId,parent=>{
      // A stale click is refused before anything changes (it never fails the action).
      if (parent.actionPlan && this.multiActionOptions.enabled?.() !== true) throw Error("MULTI_ACTION_V2_DISABLED");
      const child=this.child(actor,parent,operation_ref);
      const unit=parent.actionPlan?parent.actionUnits!.find(item=>item.child===child.id):undefined;
      if (parent.actionPlan && (!unit || this.discardedUnit(parent, unit))) throw Error("OPERATION_NOT_IN_SESSION");
      const slot = child.cancelled || child.scheduling?.receipt ? undefined : slotOptions(child.scheduling)[optionIndex(option_id)];
      if (!slot || parent.actionPlan && revision !== undefined && revision !== parent.actionPlan.revision) throw Error("OPTION_UNAVAILABLE");
      const clock = slot.startLocal.slice(11, 16), answer = secretaryFastPath("time", clock);
      if (!answer || !("time" in answer)) throw Error("OPTION_UNAVAILABLE");
      return this.preparePlanSafely(parent,()=>this.planContext.run(parent.actionPlan ? parent.id : "", async () => {
        if (parent.actionPlan) parent.actionPlan.revision++;
        const c = child.scheduling!;
        c.metrics = {}; c.interpretation_source = "DETERMINISTIC_FAST_PATH";
        await applySchedulingInterpretation(actor, c, answer as SchedulingInterpretation, clock);
        await persistSchedulingMetrics(actor, child.id, c);
        if (unit) { this.syncActionUnit(actor, parent, unit); this.checkPlanMessageRecipient(actor, parent, unit); }
        parent.conversationNotice=undefined;parent.capability_status=undefined;
        await this.recordAutomaticState(actor,parent); return this.view(parent);
      }),operation_ref);
    }));
  }
  async confirmAutomatic(actor: ServiceActor, sessionId: string, operationRef: string, input: unknown) {
    return this.persisted(actor, sessionId, "CONFIRMATION", () => this.exclusive(actor,sessionId,async parent=>{
      if (parent.actionPlan) throw Error("CONFIRMATION_GROUP_REQUIRED");
      const child=this.child(actor,parent,operationRef);
      await this.confirm(actor,child.id,input); return this.view(parent);
    }));
  }
  /** Owner withdraws one operation. In a plan this is the DISCARD path (never FAILED_SAFE): its
   * whole unit and dependents leave the plan and the other groups stay confirmable. */
  async cancelAutomaticOperation(actor: ServiceActor, sessionId: string, operationRef: string) {
    return this.persisted(actor, sessionId, "DISCARD", () => this.exclusive(actor,sessionId,async parent=>{
      const child=this.child(actor,parent,operationRef);
      if (parent.actionPlan) return this.discardPlanActions(actor, parent, parent.actionUnits!.find(item => item.child === child.id)!.keys);
      await this.planContext.run("", () => this.cancel(actor,child.id));
      return this.view(parent);
    }));
  }
  /** "Descartar esta ação": one action of the CURRENT plan (plan_ref bound, so a stale screen can
   * never discard a same-named key of another plan). Nothing is confirmed or executed. */
  async discardAction(actor: ServiceActor, sessionId: string, input: unknown) {
    const { plan_ref, action_key, linked } = discardInput.parse(input);
    return this.persisted(actor, sessionId, "DISCARD", () => this.exclusive(actor, sessionId, async parent => {
      if (parent.cancelled) throw Error("SESSION_CLOSED");
      if (!parent.actionPlan || parent.actionPlan.plan_ref !== plan_ref) throw Error("PLAN_NOT_IN_SESSION");
      parent.pendingDiscard = undefined;
      // `linked`: the screen named these linked actions and the owner accepted them; any other set is asked first.
      return this.discardPlanActions(actor, parent, [action_key], linked && [action_key, ...linked]);
    }));
  }
  /** B5: parts of this message the interpretation left out are said before the plan and asked again, never
   * dropped silently. `existing`: left-out corrections target actions of the current plan. Codes only reach
   * telemetry; the owner's own words (its clause, verified in the message) only reach this reply. */
  /** UX-COPY (flag SALON_SECRETARY_COPY_V2): the B7 hints of the active plan for text shown on screen only (each subject as
   * registered once resolved; an unresolved homonym keeps the owner's words). Never Luna's context. Best effort: a child that
   * cannot be read, or the flag off, leaves the owner's words (no hints). */
  private screenHints(parent: Session): ReturnType<typeof presentationHints> {
    if (!secretaryCopyV2Enabled() || !parent.actionPlan) return {};
    try {
      const views = (parent.children ?? []).flatMap(id => { const child = this.sessions.get(id); return child ? [{ operation_ref: id, state: this.view(child) }] : []; });
      return presentationHints(parent.actionPlan, parent.actionUnits ?? [], views);
    } catch { return {}; }
  }
  private noteRejected(parent: Session, selection: CapabilitySelection, message: string, existing: boolean) {
    const rejected = selection.rejected ?? [];
    if (!rejected.length) return;
    this.routerTrace.getStore()?.rejected(rejected.map(item => item.code));
    const parts: RejectedPart[] = rejected.map(item => {
      const spans = item.source_scope ? literalProofSpans(message, item.source_scope) : [];
      const action = existing && item.item_key ? parent.actionPlan?.actions.find(entry => entry.key === item.item_key) : undefined;
      return { dependent: item.dependent, ...(spans.length === 1 ? { quote: message.slice(spans[0][0], spans[0][1]) } : {}), ...(action ? { action } : {}),
        operation: item.operation, subject: item.subject };
    });
    const text = rejectedPartsNotice(parts, parts.some(part => part.action) ? this.screenHints(parent) : {});
    parent.turnNotice = text ? { text } : undefined;
  }
  /** ERR-COPY (flag SALON_SECRETARY_COPY_V2): a new request whose interpretation could not be read, before anything was prepared.
   * The reply is the refusal's own pt-BR copy (codes only; never exception or model text), the capability status is AMBIGUOUS so
   * nothing is confirmable, and the turn is NOT_UNDERSTOOD with its code. A request refused for its size asks to split it. */
  private unreadRequest(parent: Session, error: unknown) {
    const code = outcomeCode(error), tooLarge = code === REQUEST_TOO_LARGE || this.routerTrace.getStore()?.requestTooLarge === true;
    parent.notice = tooLarge ? requestTooLargeMessage : secretaryErrorMessage(code).text; parent.capability_status = "AMBIGUOUS";
    this.routerTrace.getStore()?.unread(code);
    return this.view(parent);
  }
  /** B5: the model's answer to a plan turn could not be read (its validation, decoding or literal repair).
   * Nothing was applied: the plan is kept (the children were restored), no action becomes FAILED_SAFE, and the
   * revision moved, so earlier approvals are stale. Review 2b: the one unit the answer was addressed to (a card
   * answered, or the only pending/editable unit) is held for review, so a change the owner asked for and the
   * backend could not read is never re-offered as a fresh approval; other units keep their proposals. */
  private async keepPlanAfterUnreadAnswer(actor: ServiceActor, parent: Session, error: unknown, addressed?: ActionUnit) {
    if (addressed) this.holdForReview(parent, addressed.keys);
    parent.actionPlan = refreshActionPlan(parent.actionPlan!);
    // A request refused for its size (request budget) was never sent: ask to split it instead of "not understood".
    const tooLarge = outcomeCode(error) === REQUEST_TOO_LARGE || this.routerTrace.getStore()?.requestTooLarge === true;
    parent.turnNotice = { text: tooLarge ? requestTooLargeMessage : unreadAnswerNotice, alone: true }; parent.conversationNotice = undefined; parent.capability_status = undefined;
    this.routerTrace.getStore()?.unread(outcomeCode(error));
    await this.recordAutomaticState(actor, parent);
    return this.view(parent);
  }
  /** Review 2b: an action whose requested change was not applied (a left-out correction, or an unread answer
   * addressed to it) is never re-offered by a fresh approval: its unit's live proposal is withdrawn and its open
   * actions wait (REVIEW_REQUIRED) until the owner restates the change or keeps it. Accepted drafts stay and
   * nothing executes. A unit with no live proposal keeps its own question. */
  private holdForReview(parent: Session, keys: readonly string[]) {
    const open = (key: string) => !terminalActionStatus(parent.actionPlan?.actions.find(action => action.key === key)?.status ?? "DONE");
    for (const unit of parent.actionUnits ?? []) {
      if (!unit.keys.some(key => keys.includes(key) && open(key))) continue;
      const child = unit.child ? this.sessions.get(unit.child) : undefined;
      if (!child || !this.proposalCarriers(child).some(carrier => carrier.proposal && !carrier.receipt)) continue;
      this.withdrawProposals(child);
      for (const key of unit.keys) if (open(key))
        parent.actionPlan = assessPlanAction(parent.actionPlan!, key, { status: "NEEDS_INPUT", missing_fields: [], issue: "REVIEW_REQUIRED", preview: reviewRequiredMessage });
    }
  }
  private discardedUnit(parent: Session, unit: ActionUnit) {
    return unit.keys.every(key => parent.actionPlan?.actions.find(action => action.key === key)?.status === "DISCARDED");
  }
  /** Only completed/discarded actions left, at least one discarded: nothing to resume or confirm. */
  private retirable(plan?: ActionPlan) {
    return Boolean(plan && plan.actions.every(action => terminalActionStatus(action.status)) && plan.actions.some(action => action.status === "DISCARDED"));
  }
  /** DISCARD: gives up actions of the active plan under the session lock. Requested keys close over
   * their atomic unit (released-slot batch, cancel→message) and every dependent, all reported. DONE is
   * immutable (ALREADY_CONFIRMED). Proposals are withdrawn through the children's own cancel path and
   * the revision moves, so earlier approvals go stale. A plan left with only DONE/DISCARDED actions
   * is retired (never suspended) so the next request starts clean. Nothing executes here.
   * Review 2b: when that closure reaches actions the owner did not name, nothing is discarded: the backend asks
   * first (discardQuestion), unless `confirmed` (the set a screen showed and the owner accepted) covers it all. */
  private async discardPlanActions(actor: ServiceActor, parent: Session, keys: readonly string[] | null, confirmed?: readonly string[]) {
    const plan = parent.actionPlan;
    if (!plan) throw Error("PLAN_NOT_IN_SESSION");
    const byKey = new Map(plan.actions.map(action => [action.key, action]));
    for (const key of keys ?? []) {
      if (!byKey.has(key)) throw Error("DISCARD_ACTION_MISMATCH");
      if (byKey.get(key)!.status === "DONE") throw Error("ALREADY_CONFIRMED");
    }
    const requested = (keys ?? plan.actions.map(action => action.key)).filter(key => !terminalActionStatus(byKey.get(key)!.status));
    if (!requested.length) return this.view(parent); // Already discarded: nothing changes.
    const targets = new Set(requested);
    for (let grown = true; grown;) {
      grown = false;
      const add = (key: string) => { if (!targets.has(key) && !terminalActionStatus(byKey.get(key)!.status)) { targets.add(key); grown = true; } };
      for (const unit of parent.actionUnits ?? []) if (unit.keys.some(key => targets.has(key))) unit.keys.forEach(add);
      for (const action of plan.actions) if (action.depends_on.some(key => targets.has(key))) add(action.key);
    }
    const units = (parent.actionUnits ?? []).filter(unit => unit.keys.some(key => targets.has(key)));
    const children = units.flatMap(unit => { const child = unit.child ? this.sessions.get(unit.child) : undefined; return child ? [child] : []; });
    // Checked before any change: a committed effect is never withdrawn or relabelled.
    if (children.some(child => this.proposalCarriers(child).some(carrier => carrier.receipt))) throw Error("ALREADY_CONFIRMED");
    const linked = plan.actions.filter(action => targets.has(action.key) && !requested.includes(action.key));
    // UX-COPY (flag): the screen names each subject as registered; computed before any child session is cancelled.
    const hints = this.screenHints(parent);
    if (linked.length && ![...targets].every(key => confirmed?.includes(key))) {
      const question = discardQuestion(plan.actions.filter(action => requested.includes(action.key)), linked);
      parent.pendingDiscard = { plan_ref: plan.plan_ref, keys: plan.actions.filter(action => targets.has(action.key)).map(action => action.key), question };
      parent.actionPlan = refreshActionPlan(plan); parent.capability_status = undefined;
      const views = (parent.children ?? []).map(id => ({ operation_ref: id, state: this.view(this.get(actor, id)) }));
      // The question kept for Luna (pendingDiscard) keeps the owner's words (B7); only the screen names the registered subjects.
      const shown = Object.keys(hints).length ? discardQuestion(plan.actions.filter(action => requested.includes(action.key)), linked, hints) : question;
      parent.conversationNotice = `${shown}\n\n${secretaryPlanMessage(plan, parent.actionUnits ?? [], views)}`;
      await this.recordAutomaticState(actor, parent);
      return this.view(parent);
    }
    plan.revision++;
    await this.planContext.run(parent.id, async () => { for (const child of children) if (!child.cancelled) await this.cancel(actor, child.id); });
    for (const key of plan.execution_order) if (targets.has(key))
      parent.actionPlan = assessPlanAction(parent.actionPlan!, key, { status: "DISCARDED", missing_fields: [], issue: "DISCARDED_BY_USER" });
    const closed = new Set(units.flatMap(unit => unit.child ? [unit.child] : []));
    parent.children = parent.children?.filter(id => !closed.has(id));
    parent.capability_status = undefined; parent.conversationNotice = undefined;
    const discarded = parent.actionPlan!.actions.filter(action => targets.has(action.key));
    const notice = discardNotice(discarded.filter(action => requested.includes(action.key)), discarded.filter(action => !requested.includes(action.key)), hints);
    this.routerTrace.getStore()?.discard(targets.size);
    await this.recordAutomaticState(actor, parent);
    if (this.retirable(parent.actionPlan)) {
      const final = parent.actionPlan!;
      Object.assign(parent, { actionPlan: undefined, actionUnits: undefined, children: undefined, groupReceipts: undefined, loaded: undefined });
      parent.notice = notice;
      // Display only, in this reply: the final statuses of the retired plan (never stored or confirmable).
      return { ...this.view(parent), retired_plan: structuredClone(final) };
    }
    // C5: a link to a discarded action is released (its field is asked when it had no value yet).
    await this.syncReferences(actor, parent);
    const operations = (parent.children ?? []).map(id => ({ operation_ref: id, state: this.view(this.get(actor, id)) }));
    // What remains is presented as usual, after the notice (its questions stay visible).
    parent.conversationNotice = `${notice}\n\n${secretaryPlanMessage(parent.actionPlan!, parent.actionUnits ?? [], operations)}`;
    return this.view(parent);
  }
  async selectCustomer(actor: ServiceActor, sessionId: string, ref: string) {
    return this.persisted(actor, sessionId, "SELECTION", () => this.exclusive(actor, sessionId, async s => {
      if (s.cancelled || !s.customer || s.customer.receipt) throw new Error("SELECTION_INVALID");
      await selectCustomer(actor, s.customer, ref); return this.view(s);
    }));
  }
  async confirm(actor: ServiceActor, sessionId: string, input: unknown): Promise<SecretaryView> {
    return this.persisted(actor, sessionId, "CONFIRMATION", () => this.confirmSession(actor, sessionId, input));
  }
  private async confirmSession(actor: ServiceActor, sessionId: string, input: unknown): Promise<SecretaryView> {
    if(this.get(actor,sessionId).financial)throw Error("FINANCIAL_READ_ONLY");
    const parsed = confirmServiceInput.parse(input);
    return this.exclusive(actor, sessionId, async s => {
      if(s.communication){
        const c=s.communication;if(s.cancelled||!c.proposal||c.proposal.proposal_ref!==parsed.proposal_ref||c.proposal.draft_revision!==parsed.draft_revision)throw Error("PROPOSAL_MISMATCH");
        const t=performance.now();
        c.receipt=await withTenant(actor,tx=>confirmCustomerMessage(tx,actor,parsed));c.metrics.confirmation_commit=performance.now()-t;
        // The business/outbox transaction is committed before even the fake provider runs.
        try {c.delivery=await dispatchLocalMessage(actor,c.receipt.message_ref,this.communicationProvider);Object.assign(c.metrics,c.delivery.metrics);}
        catch {c.message="Intenção registrada. Não foi possível consultar o resultado do despacho local; nenhuma entrega externa foi afirmada.";return this.view(s);}
        c.message=`${c.receipt.business_outcome==="CANCELLED"?"Agendamento cancelado. ":""}${c.delivery.status==="FAILED"?"Comunicação fake falhou; ação de negócio preservada.":"Mensagem simulada localmente; nenhum envio externo."} Recibo: ${c.receipt.receipt_ref}.`;
        await this.recordAfterCommit(s, () => communicationMetrics(actor,s.id,c.metrics,c.interpretation_source));return this.view(s);
      }
      if(s.inventory){
        const c=s.inventory;if(s.cancelled||!c.proposal||c.proposal.proposal_ref!==parsed.proposal_ref||c.proposal.draft_revision!==parsed.draft_revision)throw Error("PROPOSAL_MISMATCH");
        const t=performance.now();
        try{c.receipt=await withTenant(actor,tx=>confirmStockMovement(tx,actor,parsed));c.metrics.confirmation_commit=performance.now()-t;c.status="DONE";c.message=`Estoque movimentado. Saldo real: ${c.receipt.stock} un. Recibo: ${c.receipt.receipt_ref}.`;await this.recordAfterCommit(s, () => persistInventoryMetrics(actor,s.id,c));return this.view(s);}
        catch(error){c.proposal=undefined;throw error;}
      }
      if(s.batch){
        const c=s.batch;if(s.cancelled||!c.proposal||c.proposal.proposal_ref!==parsed.proposal_ref||c.proposal.draft_revision!==parsed.draft_revision)throw Error("PROPOSAL_MISMATCH");
        const t=performance.now();
        try{c.receipt=await withTenant(actor,tx=>confirmActionBatch(tx,actor,parsed));c.metrics.confirmation_commit=performance.now()-t;
          c.message="Alterações executadas na mesma transação. Recibo: "+c.receipt.receipt_ref;await this.recordAfterCommit(s, () => persistBatchMetrics(actor,s.id,c));return this.view(s);
        }catch(error){c.proposal=undefined;throw error;}
      }
      if(s.scheduling){
        const c=s.scheduling;if(s.cancelled||!c.proposal||c.proposal.proposal_ref!==parsed.proposal_ref||c.proposal.draft_revision!==parsed.draft_revision)throw Error("PROPOSAL_MISMATCH");
        const started=performance.now();
        try{c.receipt=await withTenant(actor,tx=>confirmAppointmentCreate(tx,actor,parsed));c.metrics.confirmation=performance.now()-started;
          const label=c.receipt.outcome==="PENDING_ACCEPTANCE"?"Horário remarcado, aguardando aceite do cliente":c.receipt.outcome==="RESCHEDULED"?"Agendamento remarcado":c.receipt.outcome==="CANCELLED"?"Agendamento cancelado":c.receipt.outcome==="BLOCKED"?"Agenda bloqueada":"Agendamento confirmado";
          c.message=`${label}. Referência: ${c.receipt.appointment_ref??c.receipt.block_ref}.`;await this.recordAfterCommit(s, () => persistSchedulingMetrics(actor,s.id,c));}
        catch(error){c.proposal=undefined;throw error;}return this.view(s);
      }
      if (s.customer) {
        const c = s.customer;
        if (s.cancelled || !c.proposal || c.proposal.proposal_ref !== parsed.proposal_ref || c.proposal.draft_revision !== parsed.draft_revision) throw new Error("PROPOSAL_MISMATCH");
        try { c.receipt = await withTenant(actor, tx=>confirmCustomerChange(tx,actor,parsed)); }
        catch (error) { if (error instanceof Error && ["CUSTOMER_CHANGED", "DUPLICATE_CANDIDATE"].includes(error.message)) { c.proposal = undefined; s.cancelled = true; } throw error; }
        c.message = `Cliente ${c.operation === "customer.create" ? "cadastrado" : "alterado"}: ${c.receipt.customer.name}. Referência: ${c.receipt.customer.id}.`;
        return this.view(s);
      }
      if (s.cancelled || !s.proposal || s.proposal.proposal_ref !== parsed.proposal_ref ||
          s.proposal.draft_revision !== parsed.draft_revision) throw new Error("PROPOSAL_MISMATCH");
      try { s.receipt = await withTenant(actor, tx => confirmServiceCreate(tx, actor, parsed)); }
      catch (error) {
        if (error instanceof Error && error.message === "SERVICE_CHANGED") {
          s.proposal = undefined; s.cancelled = true;
        }
        throw error;
      }
      return this.view(s);
    });
  }
  async cancel(actor: ServiceActor, sessionId: string): Promise<SecretaryView> {
    return this.persisted(actor, sessionId, "CANCEL", () => this.exclusive(actor, sessionId, async s => {
      if (s.skill === "auto") {
        for (const id of s.children ?? []) { const c=this.get(actor,id); if(!c.communication?.receipt && !c.inventory?.receipt && !c.receipt && !c.customer?.receipt && !c.scheduling?.receipt && !c.batch?.receipt && !c.cancelled) await this.planContext.run(s.actionPlan ? s.id : "", () => this.cancel(actor,id)); }
        s.cancelled=true; s.notice="Conversa encerrada. Confirmações já concluídas permanecem registradas."; return this.view(s);
      }
      if (s.communication?.receipt || s.inventory?.receipt || s.receipt || s.customer?.receipt || s.scheduling?.receipt || s.batch?.receipt) throw new Error("ALREADY_CONFIRMED");
      if (s.communication) s.communication.proposal=undefined;
      if (s.inventory) s.inventory.proposal = undefined;
      s.cancelled = true; s.proposal = undefined; if (s.customer) s.customer.proposal = undefined;
      if (s.scheduling) s.scheduling.proposal = undefined;
      if (s.batch) s.batch.proposal = undefined;
      return this.view(s);
    }));
  }
}
