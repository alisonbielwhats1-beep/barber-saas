import { firstTemporalAmbiguity, temporalAmbiguityQuestion } from "./scheduling-temporal-ambiguity";
import { firstCalendarConflict, calendarConflictQuestion } from "./scheduling-calendar-conflict";
import { prepareDeferredReadFields } from "./secretary-deferred-read";
import { proposalHasExpired, expiredProposalMessage } from "./secretary-proposal-lifetime";
import { sameAcceptedQuery } from "./secretary-entity-context";
import { SecretaryNewRequest, SecretaryResumeRequest, withConversationRouting, withSalonDirectory, refreshActionPlan } from "@everflair/salon-secretary";
import { communicationState, applyCommunicationInterpretation, sendCommunicationTurn, selectCommunication, communicationChannelFastPath, startCancellationMessage, type CommunicationState } from "./secretary-communication";
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
import { siblingScopedMessage } from "./secretary-sibling-scope";
import { withTemporalTurnDrafts, type TemporalTurnDraft } from './secretary-temporal-turn';
import { confirmActionBatch } from "./scheduling-batch";
import { schedulingPatch } from "./scheduling-contract";
import { schedulingTimezone, secretaryDirectory } from "./scheduling-catalog";
import { performance } from "node:perf_hooks";
import { schedulingState, schedulingSourceTimeReply, applySchedulingInterpretation, sendSchedulingTurn, selectScheduling, persistSchedulingMetrics, type SchedulingState } from "./secretary-scheduling";
import { confirmAppointmentCreate } from "./scheduling-actions";
import type { SchedulingInterpretation } from "@everflair/salon-secretary";
import { assertCustomerAccess } from "./customer-catalog";
import { customerState, sendCustomerTurn, applyCustomerInterpretation, selectCustomer, type CustomerState } from "./secretary-customers";
import { confirmCustomerChange } from "./customer-actions";
import { randomUUID } from "node:crypto";
import { z } from "zod";
import { runServicesTurn, instrumentServicesModel, loadSkills, operationSkill, type ServicePatch, type CustomerInterpretation, type Model } from "@everflair/salon-secretary";
import { assertServiceWriter, findCatalogServices, type ServiceActor } from "./service-catalog";
import { getOperationRequirements } from "./service-contract";
import { upsertActionDraft, proposeServiceCreate, proposeServiceChange, confirmServiceCreate, confirmServiceInput } from "./service-create-mvp";
import type { ServiceMvpFields } from "./service-contract";
import { withTenant } from "./prisma-tenant";
import { usageRecorder } from "./salon-secretary-usage";
import { normalizeSecretaryServiceName } from "./secretary-service-name";
import { secretaryFastPath } from "./secretary-fast-path";
import { AsyncLocalStorage } from "node:async_hooks";
import { RouterTrace, tryJevInterpretation, type RouterOptions } from "./secretary-router";
import { createActionPlan, assessPlanAction, executeConfirmationGroup,
  defaultReviewConfiguration, type ActionPlan, type ReviewConfiguration, type CapabilitySelection,
  groupConfirmationInput, validateSelectionV2, actionSelection, markSecretaryTiming, type ActionAssessment, type SelectedOperation } from "@everflair/salon-secretary";
import { actionUnits, unitSelection, assessmentFromView, deferredReadAssessment, collectedActionFields, viewProposal, type ActionUnit } from "./secretary-action-plan";
import { secretaryPlanMessage, planConversationContext, presentationHints } from "./secretary-presentation";
import { clarificationContext } from "./secretary-clarification";
import { unavailableCapabilityMessage } from "./secretary-capability-status";

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
  draft?: Draft; proposal?: Proposal; receipt?: Receipt; cancelled: boolean };
export type SecretaryView = { proposal_expired?: boolean; service_context?: { fields: Partial<ServiceMvpFields>; target_name?: string }; suspended_plans?: { plan_ref: string; label: string }[]; capability_status?: CapabilityStatus; execution_warnings?: string[]; action_plan?: ActionPlan; communication?: CommunicationState; inventory?: InventoryState; financial?: FinancialState; batch?: BatchState; scheduling?: SchedulingState; operations?: { operation_ref: string; action_keys?: string[]; state: SecretaryView }[]; loaded?: Session["loaded"]; skill?: "services" | "customers" | "scheduling" | "financial" | "inventory" | "communication" | "auto"; customer?: CustomerState; sessionId: string; message: string; draft?: Draft; proposal?: Proposal; receipt?: Receipt; cancelled: boolean; candidates?: Candidates };
const turnInput = z.object({ sessionId: z.string().uuid(), message: z.string().trim().min(1).max(1000), operation_ref: z.string().uuid().optional() }).strict();

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
  private readonly routerTrace = new AsyncLocalStorage<RouterTrace>();
  private readonly planContext = new AsyncLocalStorage<string>();
  constructor(private readonly modelFactory: () => Promise<Model>, private readonly modelId: () => string = () => process.env.SALON_SECRETARY_MODEL ?? "unconfigured", private readonly communicationProvider = new FakeCommunicationProvider(), private readonly routerOptions: RouterOptions = {}, private readonly multiActionOptions: { enabled?: () => boolean; policy?: () => ReviewConfiguration } = {}) {}

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
    for (const [id, s] of this.sessions) if (!s.busy && s.expires <= Date.now()) this.sessions.delete(id);
    if (!this.planContext.getStore() && ([...this.sessions.values()].filter(s => !s.planOwner).length >= 200 || [...this.sessions.values()].filter(s => !s.planOwner && s.actor.userId === actor.userId).length >= 10))
      throw new Error("SESSION_LIMIT");
    const session: Session = { skill, planOwner: this.planContext.getStore(), multiActionV2: this.multiActionOptions.enabled?.() === true, ...(skill === "communication" ? {communication: communicationState()} : {}), ...(skill === "inventory" ? { inventory: inventoryState() } : {}), ...(skill === "financial" ? { financial: financialState() } : {}), ...(skill === "scheduling" ? { scheduling: schedulingState() } : {}), ...(skill === "customers" ? { customer: customerState() } : {}), id: randomUUID(), actor: { ...actor }, expires: Date.now() + 20 * 60_000,
      busy: false, turns: 0, cancelled: false };
    this.sessions.set(session.id, session);
    return this.view(session);
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
    s.busy = true;
    try { return await fn(s); } finally { s.busy = false; }
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
    try { const result = await prepare(); return (this.markIntraPlanConflicts(parent) ? this.view(parent) : result) as T; }
    catch (error) {
      if (parent.actionPlan) {
        const affected = parent.actionUnits?.filter(unit =>
          (!operationRef || parent.actionPlan!.plan_ref !== originalPlanRef || unit.child === operationRef) &&
          unit.keys.some(key => parent.actionPlan!.actions.find(action => action.key === key)?.status !== "DONE")) ?? [];
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
   * ("Marca a Amanda e a Carla às 10h"). The later one (execution order) becomes
   * a question instead of a confirmable card; the earlier keeps its proposal. */
  private markIntraPlanConflicts(parent: Session) {
    const plan = parent.actionPlan;
    if (!plan) return false;
    const clock = (local: string) => local.slice(11, 16).replace(":00", "h").replace(":", "h");
    const taken: { professional: string; start: string; end: string; label: string }[] = [];
    let changed = false;
    for (const key of plan.execution_order) {
      const action = parent.actionPlan!.actions.find(item => item.key === key)!;
      if (action.status !== "READY_FOR_CONFIRMATION" || !["appointment.create", "appointment.change", "schedule.block"].includes(action.operation)) continue;
      const unit = parent.actionUnits?.find(item => item.keys.includes(key));
      const child = unit?.kind === "single" && unit.child ? this.sessions.get(unit.child) : undefined;
      const state = child?.scheduling, draft = state?.draft;
      const snap = action.operation === "appointment.create" ? draft?.snapshot : draft?.action_snapshot;
      if (!child || !state || !snap?.professional_ref) continue;
      const slot = { professional: snap.professional_ref, start: snap.startLocal, end: snap.endLocal,
        label: `${"customer_name" in snap && snap.customer_name ? snap.customer_name : "outro item"} das ${clock(snap.startLocal)} às ${clock(snap.endLocal)}` };
      const clash = taken.find(item => item.professional === slot.professional && item.start < slot.end && slot.start < item.end);
      if (!clash) { taken.push(slot); continue; }
      this.withdrawProposals(child);
      state.waiting_for = "time";
      state.message = `Esse horário está indisponível: ${snap.professional_name ?? "o profissional"} já estará com ${clash.label} neste mesmo pedido. Qual outro horário você prefere?`;
      this.syncActionUnit(parent.actor, parent, unit!);
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
    if (plan.actions.some(action => action.missing_fields.length || action.assessment.issue === "PROPOSAL_EXPIRED")) return "NEEDS_INPUT";
    return "SUPPORTED";
  }
  private projectView(s: Session): SecretaryView {
    if (s.skill === "auto") {
      // Read-only UI correlation; the frontend must not infer an action's receipt by position.
      const operations = s.children?.map(id=>({ operation_ref: id, action_keys: s.actionUnits?.find(unit => unit.child === id)?.keys, state: this.view(this.get(s.actor,id)) }));
      if(s.actionPlan)for(const operation of operations??[])if(operation.state.proposal_expired)for(const key of operation.action_keys??[]){
        const action=s.actionPlan.actions.find(item=>item.key===key)!;
        if(action.status!=="DONE"&&!(action.status==="FAILED_SAFE"&&action.assessment.issue==="PROPOSAL_EXPIRED"))s.actionPlan=assessPlanAction(s.actionPlan,key,{status:"NEEDS_INPUT",missing_fields:[],
          preview:expiredProposalMessage,issue:"PROPOSAL_EXPIRED"});
      }
      return structuredClone({ sessionId: s.id, skill: "auto", cancelled: s.cancelled, loaded: s.loaded, action_plan: s.actionPlan, capability_status: this.effectiveCapabilityStatus(s, operations),
        suspended_plans: s.suspendedPlans?.map(saved => ({plan_ref:saved.actionPlan!.plan_ref,label:saved.actionPlan!.actions.map(action => action.operation).join(", ")})),
        message: s.actionPlan ? (s.cancelled ? "Conversa encerrada. Confirmações anteriores preservadas." : s.conversationNotice ?? secretaryPlanMessage(s.actionPlan, s.actionUnits ?? [], operations ?? [])) : s.notice ?? (s.children?.length ? "Confira cada operação abaixo. Cada confirmação executa somente sua proposta." : "Posso ajudar com serviços, clientes, agenda, estoque e consultas financeiras. O que deseja?"), operations });
    }
    if (s.communication) return structuredClone({sessionId:s.id,skill:s.skill,cancelled:s.cancelled,communication:s.communication,message:s.cancelled?"Operação cancelada.":s.communication.message});
    if (s.inventory) return structuredClone({sessionId:s.id,skill:s.skill,cancelled:s.cancelled,inventory:s.inventory,message:s.cancelled?"Conversa encerrada.":s.inventory.message});
    if (s.financial) return structuredClone({sessionId:s.id,skill:s.skill,cancelled:s.cancelled,financial:s.financial,message:s.financial.message});
    if (s.batch) return structuredClone({sessionId:s.id,skill:s.skill,cancelled:s.cancelled,batch:s.batch,message:s.cancelled?"Batch cancelado; nenhuma ação foi executada.":s.batch.message});
    if (s.scheduling) return structuredClone({sessionId:s.id,skill:s.skill,cancelled:s.cancelled,scheduling:s.scheduling,message:s.cancelled?"Conversa encerrada.":s.scheduling.message});
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
    return this.exclusive(actor, sessionId, async s => {
      if (s.cancelled || s.receipt || !s.pending?.query || !s.pending.candidates.some(c => c.id === serviceRef)) throw new Error("SELECTION_INVALID");
      const candidates = await withTenant(actor, tx => findCatalogServices(tx, actor, s.pending!.query!));
      if (!candidates.some(c => c.id === serviceRef)) throw new Error("SELECTION_INVALID");
      await this.prepare(actor, s, s.pending.patch, serviceRef);
      return this.view(s);
    });
  }
  async send(actor: ServiceActor, input: unknown): Promise<SecretaryView> {
    // Automatic parent -> draft continuation is one message/trace, not a second billable event.
    if (this.routerTrace.getStore()) return this.sendMessage(actor, input);
    const parsed = turnInput.parse(input);
    this.get(actor, parsed.sessionId); // Do not persist telemetry against another tenant's session.
    const trace = new RouterTrace();
    return this.routerTrace.run(trace, async () => {
      try { return await this.sendMessage(actor, parsed); }
      finally {
        // Telemetry availability must not break the existing Luna/backend path. No raw errors logged.
        try { await withTenant(actor, tx => tx.auditLog.create({ data: {
          salonId: actor.salonId, userId: actor.userId, actorName: "Secretária — router",
          entityType: "SECRETARY_ROUTER", entityId: parsed.sessionId, action: trace.path, metadata: trace.snapshot(),
        } })); } catch { /* Existing model usage recorder still retains its mandatory audit semantics. */ }
      }
    });
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
        return withSalonDirectory(directory, () => this.preparePlanSafely(s, () => this.sendAutomatic(actor, s, message, operation_ref, messageStarted), operation_ref)); }
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
        catch (error) { if (error instanceof SecretaryNewRequest || error instanceof SecretaryResumeRequest) throw error; s.customer.proposal = undefined; if (error instanceof Error && error.message === "CUSTOMER_CHANGED") { s.cancelled = true; throw error; } throw new Error("SECRETARY_TURN_FAILED"); }
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
        if (error instanceof SecretaryNewRequest || error instanceof SecretaryResumeRequest) throw error;
        s.proposal = undefined;
        // Committed draft patches survive failures; no model/raw provider error or success prose leaks.
        throw new Error("SECRETARY_TURN_FAILED");
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
      selection = await runServicesTurn(measured,message,{}, { services: { create: getOperationRequirements(), change: getOperationRequirements("service.change") },
      scheduling: {batch:getOperationRequirements("action.batch"),create:getOperationRequirements("appointment.create"),read:getOperationRequirements("appointment.list"),availability:getOperationRequirements("availability.get")}, customers: { create: getOperationRequirements("customer.create"), change: getOperationRequirements("customer.change") } },"discovery", parent.multiActionV2);
    } else parent.turns++;
    const interpretationMs=performance.now()-interpretationStart;
    this.routerTrace.getStore()!.interpretationMs=interpretationMs;
    this.get(actor,parent.id);
    if (!selection.operations.length) {
      parent.capability_status=selection.disposition === "CONVERSATION" ? "CONVERSATION" : selection.disposition === "UNSUPPORTED" ? "UNSUPPORTED" : "AMBIGUOUS";
      parent.notice=selection.disposition === "CONVERSATION" ? selection.conversation_response! : parent.capability_status === "UNSUPPORTED" ? unavailableCapabilityMessage(selection.unavailable_capability) : "Qual pedido deseja fazer? Posso ajudar com serviços, clientes, agenda, estoque e consultas financeiras.";
      return this.view(parent);
    }
    parent.capability_status=undefined;

    // Entire plan authorized before loading or preparing any draft. Selection never grants access.
    for (const id of selection.skills) await this.authorize(actor,id);
    const loaded = loadSkills({ skill_ids: selection.skills });
    parent.loaded = loaded.manuals.map(({skill_id,version,manual_hash})=>({skill_id,version,manual_hash}));
    await withTenant(actor,tx=>tx.auditLog.create({ data: { salonId: actor.salonId,userId:actor.userId,actorName:"Secretária — capacidades",
      entityType:"SECRETARY_SKILL_LOAD",entityId:parent.id,action:"SKILLS_LOADED",metadata:{session_id:parent.id,skills:parent.loaded!,capabilities:loaded.capabilities} } }));
    if (parent.multiActionV2) return this.startActionPlan(actor, parent, selection, message);
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
      await applySchedulingInterpretation(actor,child.scheduling,{operation,...fields,...(temporal_evidence?{temporal_evidence}:{}),...(temporal_negative_context?{temporal_negative_context}:{})},validatedDeferred?undefined:siblingScopedMessage(message,op,siblings));
    }
    else if (child.customer) await applyCustomerInterpretation(actor, child.customer, { ...patch, requested_fields: op.requested_fields, clear_fields: op.clear_fields } as CustomerInterpretation);
    else await this.applyServiceInterpretation(actor, child, patch as ServicePatch);
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
    const keys = unit.keys.filter(key => parent.actionPlan!.actions.find(action => action.key === key)!.status !== "DONE");
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
    for (const key of keys) parent.actionPlan = assessPlanAction(parent.actionPlan!, key, assessment);
  }
  private async startActionPlan(actor: ServiceActor, parent: Session, selection: CapabilitySelection, message: string) {
    // NEW may prepare a candidate before it is published as the active plan.
    return this.preparePlanSafely(parent, () => this.prepareActionPlan(actor, parent, selection, message));
  }
  private async prepareActionPlan(actor: ServiceActor, parent: Session, selection: CapabilitySelection, message: string) {
    parent.actionPlan = createActionPlan(selection, this.multiActionOptions.policy?.() ?? defaultReviewConfiguration,
      this.routerTrace.getStore()?.path === "JEV_ACCEPTED" ? "JEV" : "LUNA");
    parent.actionUnits = actionUnits(parent.actionPlan); parent.children = [];
    markSecretaryTiming("T3");
    await this.planContext.run(parent.id, async () => {
      for (const unit of parent.actionUnits!) {
        try {
          if (unit.kind === "unsupported") throw Error("UNSUPPORTED_DEPENDENCY_ADAPTER");
          const chosen = unitSelection(parent.actionPlan!, unit), action = parent.actionPlan!.actions.find(item => item.key === unit.keys[0])!;
          const skill = unit.kind === "cancellation-message" ? "communication" : action.skill;
          const started = await this.start(actor, skill), child = this.get(actor, started.sessionId);
          child.expires = parent.expires; child.inheritedInterpretation = true;
          unit.child = child.id; parent.children!.push(child.id);
          // Dependent reads must observe the state after their predecessors, not a speculative result.
          if (!action.mutation && action.depends_on.length) { await this.preparePlanRead(actor,parent,action,action.fields,message,true); continue; }
          if (unit.kind === "scheduling-batch") { child.scheduling = undefined; child.batch = await startBatch(actor, chosen,message,state=>{child.batch=state;}); }
          else if (unit.kind === "cancellation-message") child.communication = await startCancellationMessage(actor, chosen, message,state=>{child.communication=state;});
          else await this.applyPlanOperation(actor, child, chosen.operations[0], message,false,inventoryWitnesses(selection.operations),inventoryScopes(selection.operations,chosen.operations[0]),selection.operations);
          this.syncActionUnit(actor, parent, unit);
          this.checkPlanMessageRecipient(actor, parent, unit);
        } catch (error) { if (error instanceof SecretaryNewRequest || error instanceof SecretaryResumeRequest) throw error; this.failActionUnit(parent, unit, error); }
      }
    });
    markSecretaryTiming("T4");
    await this.recordAutomaticState(actor, parent);
    return this.view(parent);
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

  private savePlan(parent: Session): SuspendedPlan {
    return { actionPlan: parent.actionPlan, actionUnits: parent.actionUnits, children: parent.children,
      loaded: parent.loaded, groupReceipts: parent.groupReceipts };
  }
  async resumePlan(actor: ServiceActor, sessionId: string, planRef: string) {
    return this.exclusive(actor, sessionId, parent => this.preparePlanSafely(parent, async () => {
      await this.activatePreservedPlan(actor,parent,planRef);
      await this.recordAutomaticState(actor,parent);return this.view(parent);
    }));
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
    const neutral={...op,depends_on:[],released_slot_of:null,...((op as Record<string,unknown>).destination_mode==="SAME_RELEASED_SLOT"?{destination_mode:null}:{})} as SelectedOperation;
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
      await this.planContext.run(parent.id,async()=>{try{await this.applyPlanOperation(actor,child,neutral,message);this.syncActionUnit(actor,next,unit);}catch(error){this.failActionUnit(next,unit,error);}});
    }else{
      const cancelState=cancelChild!.scheduling!,accepted=cancelState.draft;
      unit={keys:[cancelAction.key,added.key],kind:"scheduling-batch",child:child.id};
      next.actionUnits=next.actionUnits!.filter(item=>item!==cancelUnit);next.actionUnits.push(unit);
      next.children=next.children!.filter(id=>id!==cancelChild!.id);
      this.withdrawProposals(cancelChild!);cancelChild!.cancelled=true;
      child.scheduling=undefined;
      await this.planContext.run(parent.id,async()=>{try{
        child.batch=await startReleasedSlotBatch(actor,{key:cancelAction.key,fields:accepted?.fields??cancelState.fields,source_missing:cancelState.source_missing??accepted?.source_missing},
          actionSelection({...added,released_slot_of:cancelAction.key}),message,state=>{child.batch=state;});
        this.syncActionUnit(actor,next,unit);
      }catch(error){this.failActionUnit(next,unit,error);}});
    }
    Object.assign(parent,this.savePlan(next));await this.recordAutomaticState(actor,parent);return this.view(parent);
  }
  private async appendActionPlan(actor:ServiceActor,parent:Session,selection:CapabilitySelection,message:string){
    const existing=parent.actionPlan!,keys=new Set(existing.actions.map(action=>action.key));
    if(selection.operations.some(op=>keys.has(op.item_key!)))throw Error("APPEND_ACTION_EXISTS");
    const only=selection.operations.length===1?selection.operations[0]:undefined;
    if(only?.operation==="appointment.create"&&only.released_slot_of&&keys.has(only.released_slot_of)&&
      JSON.stringify(only.depends_on)===JSON.stringify([only.released_slot_of])&&
      existing.actions.find(action=>action.key===only.released_slot_of)!.operation==="appointment.cancel")
      return this.appendReleasedSlot(actor,parent,only,message);
    for(const skill of selection.skills)await this.authorize(actor,skill);
    const addition=createActionPlan(selection,existing.policy,"LUNA");
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
      if(unit.kind==="scheduling-batch"){child.scheduling=undefined;child.batch=await startBatch(actor,chosen,message,state=>{child.batch=state;});}
      else if(unit.kind==="cancellation-message")child.communication=await startCancellationMessage(actor,chosen,message,state=>{child.communication=state;});
      else await this.applyPlanOperation(actor,child,chosen.operations[0],message,false,inventoryWitnesses(selection.operations),inventoryScopes(selection.operations,chosen.operations[0]),selection.operations);
      this.syncActionUnit(actor,next,unit);this.checkPlanMessageRecipient(actor,next,unit);
    }catch(error){this.failActionUnit(next,unit,error);}}});
    Object.assign(parent,this.savePlan(next));await this.recordAutomaticState(actor,parent);return this.view(parent);
  }
  private async sendActionPlanTurn(actor: ServiceActor, parent: Session, message: string, operationRef?: string) {
    if (operationRef && !parent.actionUnits?.some(unit => unit.child === operationRef)) throw Error("OPERATION_NOT_IN_SESSION");
    parent.conversationNotice = undefined; parent.capability_status = undefined;
    this.view(parent); // Expiry is a backend state transition before routing snapshots.
    const before = this.savePlan(parent);
    const children = (parent.children ?? []).map(id => this.get(actor, id));
    const snapshots = children.map(child => structuredClone(child));
    const contextFor=(saved:SuspendedPlan)=>planConversationContext(saved.actionPlan!,saved.actionUnits??[],(saved.children??[]).map(id=>({operation_ref:id,state:this.view(this.get(actor,id))})));
    const routingContext={active_plan:contextFor(before),suspended_plans:(parent.suspendedPlans??[]).map(contextFor)};
    try { return await withConversationRouting(() => this.continueActionPlanTurn(actor, parent, message, operationRef),routingContext); }
    catch (error) {
      if (!(error instanceof SecretaryNewRequest) && !(error instanceof SecretaryResumeRequest)) throw error;
      this.get(actor, parent.id);
      // Routing happened before any adapter accepted a patch. Restore only the
      // in-memory proposal/fields withdrawn in preparation for interpretation.
      children.forEach((child, index) => { const turns = child.turns; Object.assign(child, snapshots[index]); child.turns = Math.max(turns, child.turns); });
      parent.actionPlan!.revision++; // A topic change also invalidates approvals for an unselected/complete plan.
      if(error instanceof SecretaryResumeRequest){
        await this.activatePreservedPlan(actor,parent,error.planRef);
        if(error.patches?.operations.length) await this.applyExistingPlanPatches(actor,parent,parent.actionUnits??[],error.patches,message);
        await this.recordAutomaticState(actor,parent);return this.view(parent);
      }
      const selection = error.selection;
      if (!selection.operations.length) {
        parent.capability_status = selection.disposition === "CONVERSATION" ? "CONVERSATION" : selection.disposition === "UNSUPPORTED" ? "UNSUPPORTED" : "AMBIGUOUS";
        parent.conversationNotice = selection.disposition === "CONVERSATION" ? selection.conversation_response! : selection.disposition === "UNSUPPORTED" ? unavailableCapabilityMessage(selection.unavailable_capability)
          : "Não identifiquei uma alteração ou um novo pedido. O pedido anterior foi preservado. O que deseja fazer?";
        return this.view(parent);
      }
      if(error.mode==="PATCH") return this.applyExistingPlanPatches(actor,parent,parent.actionUnits??[],selection,message);
      if(error.mode==="ADD") return this.appendActionPlan(actor,parent,selection,message);
      if ((parent.suspendedPlans?.length ?? 0) >= 5) throw Error("SUSPENDED_PLAN_LIMIT");
      for (const skill of selection.skills) await this.authorize(actor, skill);
      const loaded = loadSkills({skill_ids:selection.skills});
      const next: Session = {...parent, actionPlan:undefined, actionUnits:undefined, children:undefined, groupReceipts:undefined,
        loaded:loaded.manuals.map(({skill_id,version,manual_hash})=>({skill_id,version,manual_hash}))};
      await this.startActionPlan(actor, next, selection, message);
      parent.suspendedPlans = [...(parent.suspendedPlans ?? []), before];
      Object.assign(parent, this.savePlan(next));
      return this.view(parent);
    }
  }
  private async continueActionPlanTurn(actor: ServiceActor, parent: Session, message: string, operationRef?: string) {
    markSecretaryTiming("T3"); // A deterministic continuation already has a decomposed plan.
    if (this.multiActionOptions.enabled?.() !== true) throw Error("MULTI_ACTION_V2_DISABLED");
    const pending = parent.actionUnits!.filter(unit => unit.child && unit.keys.some(key =>
      (parent.actionPlan!.actions.find(item => item.key === key)!.missing_fields.length || parent.actionPlan!.actions.find(item=>item.key===key)!.assessment.issue==="PROPOSAL_EXPIRED")));
    const open=parent.actionUnits!.filter(unit=>unit.child&&unit.keys.some(key=>parent.actionPlan!.actions.find(action=>action.key===key)!.status!=="DONE"));
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
      const selection = await runServicesTurn(model, message, {}, { instruction: "Interprete o turno no contexto dos planos. Pode ser um novo pedido, conversa casual ou retomada. Não execute nada." }, "discovery", true);
      throw new SecretaryNewRequest(selection);
    }
    parent.actionPlan!.revision++; // Any attempted correction invalidates the old group approval, even if parsing fails.
    await this.planContext.run(parent.id, async () => {
      try {
        const action = parent.actionPlan!.actions.find(item => item.key === unit.keys[0])!;
        if (!action.mutation && action.depends_on.length) {
          await this.patchDeferredRead(actor, parent, action.key, message);
          return;
        }
        await this.send(actor, { sessionId: unit.child, message });
        this.syncActionUnit(actor, parent, unit);
        this.checkPlanMessageRecipient(actor, parent, unit);
      } catch (error) { if (error instanceof SecretaryNewRequest || error instanceof SecretaryResumeRequest) throw error; this.failActionUnit(parent, unit, error); }
    });
    markSecretaryTiming("T4");
    await this.recordAutomaticState(actor, parent);
    return this.view(parent);
  }

  /** One interpretation maps a combined answer to existing incomplete actions. No new plan/keys. */
  private async continueMultipleActions(actor: ServiceActor, parent: Session, pending: ActionUnit[], message: string) {
    if (parent.turns >= 20) throw Error("TURN_LIMIT");
    parent.actionPlan=refreshActionPlan({...parent.actionPlan!,revision:parent.actionPlan!.revision+1});
    const eligible = parent.actionPlan!.actions.filter(action => action.status!=="DONE" &&
      pending.some(unit => unit.keys.includes(action.key)));
    const model = instrumentServicesModel(await this.measuredModel(), this.modelId(), usageRecorder(actor, parent.id, randomUUID(), this.modelId()));
    parent.turns++;
    const selection = await runServicesTurn(model, message, { mode: "CONTINUE_EXISTING_PLAN",
      actions:planConversationContext(parent.actionPlan!,parent.actionUnits??[],(parent.children??[]).map(id=>({operation_ref:id,state:this.view(this.get(actor,id))}))).actions.filter(action=>eligible.some(item=>item.key===action.item_key)) }, {
      instruction: "Este é um turno sobre o plano existente: pode responder a uma pergunta ou corrigir uma ação já preparada. Para continuação/correção retorne APENAS os deltas explícitos às ações acima, usando seus mesmos item_key e preservando a operação. Não repita campos anteriores. O backend preserva o grafo de dependências. Escolha a decisão e o payload correspondentes conforme o schema do turno, inclusive para novo pedido, adição de ações, retomada ou conversa casual. Se o alvo for ambíguo, indique ambiguidade sem fabricar ação ou selecionar um alvo.",
    }, "discovery", true);
    return this.applyExistingPlanPatches(actor,parent,pending,selection,message);
  }
  private async applyExistingPlanPatches(actor:ServiceActor,parent:Session,pending:ActionUnit[],selection:CapabilitySelection,message:string){
    this.get(actor,parent.id);
    const eligible=parent.actionPlan!.actions.filter(action=>action.status!=="DONE" && pending.some(unit=>unit.keys.includes(action.key)));
    // Every target is checked before changing a draft; completed actions are immutable.
    for (const op of selection.operations) if (!eligible.some(action => action.key === op.item_key && action.operation === op.operation) || op.depends_on.length || op.released_slot_of)
      throw Error("CONTINUATION_ACTION_MISMATCH");
    if (!selection.operations.length) {
      parent.capability_status=selection.disposition==="CONVERSATION"?"CONVERSATION":selection.disposition==="UNSUPPORTED"?"UNSUPPORTED":"AMBIGUOUS";
      parent.conversationNotice=selection.disposition==="CONVERSATION"?selection.conversation_response!:selection.disposition==="UNSUPPORTED"?unavailableCapabilityMessage(selection.unavailable_capability):"Qual ação deseja ajustar? O pedido continua preservado.";
      return this.view(parent);
    }
    parent.actionPlan!.revision++;
    await this.planContext.run(parent.id, async () => {
      const touched = new Set<ActionUnit>();
      for (const op of selection.operations) {
        const unit = pending.find(item => item.keys.includes(op.item_key!))!;
        const child = this.get(actor, unit.child!);
        try {
          if (!parent.actionPlan!.actions.find(action=>action.key===op.item_key)!.mutation && parent.actionPlan!.actions.find(action=>action.key===op.item_key)!.depends_on.length) {
            const action=parent.actionPlan!.actions.find(action=>action.key===op.item_key)!;
            const {operation:_o,item_key:_k,depends_on:_d,released_slot_of:_r,...patch}=op;void _o;void _k;void _d;void _r;
            await this.preparePlanRead(actor,parent,action,patch,message);
            continue; // Deferred reads have no executed child state to project yet.
          } else if (child.batch) {
            const fields = schedulingPatch.parse(Object.fromEntries(Object.entries(op).filter(([key, value]) => key in schedulingPatch.shape && value != null)));
            const timezone = await withTenant(actor, tx => schedulingTimezone(tx, actor));
            const changed = groundBatchPatch(child.batch.plan, op.item_key!, fields, message, timezone, op.temporal_evidence ?? undefined, child.batch.draft,(op as {temporal_negative_context?:unknown}).temporal_negative_context);
            await prepareBatch(actor, child.batch, changed);
          } else await this.applyPlanOperation(actor, child, op, message,false,inventoryWitnesses(selection.operations),inventoryScopes(selection.operations,op),selection.operations);
          this.syncActionUnit(actor, parent, unit); touched.add(unit);
        } catch (error) { if (error instanceof SecretaryNewRequest || error instanceof SecretaryResumeRequest) throw error; this.failActionUnit(parent, unit, error); }
      }
      for (const unit of touched) this.checkPlanMessageRecipient(actor, parent, unit);
    });
    markSecretaryTiming("T4");
    await this.recordAutomaticState(actor, parent);
    return this.view(parent);
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
    return this.exclusive(actor, sessionId, async parent => {
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
      const executed = new Set<string>();
      parent.actionPlan = await this.planContext.run(parent.id, () => executeConfirmationGroup(parent.actionPlan!, input, async action => {
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
      }));
      (parent.groupReceipts ??= new Set()).add(JSON.stringify(approval));
      await this.recordAfterCommit(parent, () => this.recordAutomaticState(actor, parent));
      return this.view(parent);
    });
  }

  async selectAutomatic(actor: ServiceActor, sessionId: string, operationRef: string, ref: string) {
    return this.exclusive(actor,sessionId,parent=>this.preparePlanSafely(parent,()=>this.planContext.run(parent.actionPlan ? parent.id : "", async () => {
      if (parent.actionPlan && this.multiActionOptions.enabled?.() !== true) throw Error("MULTI_ACTION_V2_DISABLED");
      if (parent.actionPlan) parent.actionPlan.revision++;
      const child=this.child(actor,parent,operationRef);
      if(child.communication){if(child.cancelled)throw Error("SESSION_CLOSED");await selectCommunication(actor,child.communication,ref);}
      else if(child.inventory){if(child.cancelled)throw Error("SESSION_CLOSED");await selectInventory(actor,child.inventory,ref);}
      else if(child.batch) await selectBatch(actor,child.batch,ref);
      else if(child.scheduling) await selectScheduling(actor,child.scheduling,ref);
      else if(child.skill === "customers") await this.selectCustomer(actor,child.id,ref); else await this.selectService(actor,child.id,ref);
      if (parent.actionPlan) { const unit = parent.actionUnits!.find(item => item.child === child.id)!; this.syncActionUnit(actor, parent, unit); this.checkPlanMessageRecipient(actor, parent, unit); }
      parent.conversationNotice=undefined;parent.capability_status=undefined;
      await this.recordAutomaticState(actor,parent); return this.view(parent);
    }),operationRef));
  }
  async confirmAutomatic(actor: ServiceActor, sessionId: string, operationRef: string, input: unknown) {
    return this.exclusive(actor,sessionId,async parent=>{
      if (parent.actionPlan) throw Error("CONFIRMATION_GROUP_REQUIRED");
      const child=this.child(actor,parent,operationRef);
      await this.confirm(actor,child.id,input); return this.view(parent);
    });
  }
  async cancelAutomaticOperation(actor: ServiceActor, sessionId: string, operationRef: string) {
    return this.exclusive(actor,sessionId,async parent=>{
      const child=this.child(actor,parent,operationRef);
      await this.planContext.run(parent.actionPlan ? parent.id : "", () => this.cancel(actor,child.id));
      if (parent.actionPlan) this.failActionUnit(parent, parent.actionUnits!.find(item => item.child === child.id)!, Error("ACTION_CANCELLED"));
      return this.view(parent);
    });
  }
  async selectCustomer(actor: ServiceActor, sessionId: string, ref: string) {
    return this.exclusive(actor, sessionId, async s => {
      if (s.cancelled || !s.customer || s.customer.receipt) throw new Error("SELECTION_INVALID");
      await selectCustomer(actor, s.customer, ref); return this.view(s);
    });
  }
  async confirm(actor: ServiceActor, sessionId: string, input: unknown): Promise<SecretaryView> {
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
    return this.exclusive(actor, sessionId, async s => {
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
    });
  }
}
