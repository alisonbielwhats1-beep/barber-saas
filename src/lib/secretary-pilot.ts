import { randomUUID } from "node:crypto";
import { performance } from "node:perf_hooks";
import { z } from "zod";
import type { Model } from "@everflair/salon-secretary";
import type { ServiceActor } from "./service-catalog";
import { applyAnswer, applyIntent, approve, attachProposal, completeExecution, createPilotPlan, invalidate, lastQuestionNumber, nextQuestionId, openQuestions,
  pilotPlanClosed, startExecution, withdraw, PILOT_FIELDS, PILOT_OPTIONS_MAX, type PilotApproval, type PilotField, type PilotFieldName, type PilotOption,
  type PilotPlan, type PilotProposal, type PilotQuestion, type PilotQuestionDraft, type PilotQuestionField, type PilotQuestionReason, type PilotReduction,
  type PilotStatus } from "./secretary-pilot-plan";
import { pilotClockReadings, pilotIdentityOf, pilotNowLocal, pilotToday, resolveAppointment, resolveCustomer, resolveProfessional, resolveTargetDate, resolveTargetTime,
  type PilotAppointmentRow, type PilotClock, type PilotIdentity, type PilotPerson, type PilotReader, type PilotServiceRow } from "./secretary-pilot-resolver";
import type { PilotDestination, PilotInterpretation, PilotOrigin } from "../../packages/salon-secretary/src/pilot-reschedule-contract";
import { runPilotInterpretation, PILOT_CALL_LIMITS, PILOT_OPEN_LABELS, type PilotOpenContext, type PilotRequestContext } from "../../packages/salon-secretary/src/pilot-reschedule-prompt";
import { formatClock, formatDay, formatLocal, formatLocalRange } from "./secretary-datetime-format";
import { nameTokens } from "./name-search";

/** Pilot of the reschedule (flag SALON_SECRETARY_PILOT_RESCHEDULE, default off; docs/c5-spike/12-piloto-remarcacao.md; owner decisions 25-31).
 * With the flag on, the pilot answers EVERY top-level message of the session (SalonSecretary.send): no agent loop, no agent validator, no C4
 * fallback; the environment, role and tenant gates stay as they are. Off, everything is exactly as before. One message: received_at frozen and
 * kept in its turn; one Luna call (interpretar_remarcacao, ≤ 15 s) and at most one format repair, ≤ 45 s in all; the contract decoded
 * (pilot-reschedule-contract.ts); the resolver over real records (secretary-pilot-resolver.ts); the reducer (secretary-pilot-plan.ts); once every
 * field is resolved, the proposal by the real agenda preparation of a change that KEEPS the resolved appointment (behind the flag
 * prepareResolvedScheduling keeps the pilot's appointment_ref instead of locating again); the Confirmar as it exists (the view's action_plan
 * group: proposal_ref + draft_revision + the plan revision, lock and fresh snapshot, journal receipt, idempotent), with the receipt of a
 * proposal_ref consulted before any expiry rule (and again after a failed Confirmar). A repeated clientTurnId returns the stored reply with no
 * Luna call and no new revision. Telemetry: codes only (turn, plan/revision, question, proposal_ref, receipt, provenance per field, latency,
 * calls, why each question, why a proposal was dropped). After Luna nothing here reads the owner's Portuguese again: mentions are matched
 * against real records by the resolver, and the message itself only feeds the resolver's narrow provenance check of origin hints. */
export const pilotRescheduleEnabled = () => process.env.SALON_SECRETARY_PILOT_RESCHEDULE === "true";
/** §1 and decision 28 (review L11: one source, the request module's). */
export const PILOT_LIMITS = PILOT_CALL_LIMITS;
/** §5: Luna failed (time out, or an invalid format after the repair); what was already resolved is kept. */
export const PILOT_SAFE_REPLY = "Não consegui entender com segurança; nada foi alterado.";
/** §5, decision 31: every proposal says the customer keeps the normal notification. */
export const PILOT_CUSTOMER_NOTICE = "O cliente será avisado da remarcação.";
/** §1: the clear answer to a request wholly out of the pilot's scope (nothing happens). */
export const PILOT_OUT_OF_SCOPE_REPLY = "Por enquanto, por aqui eu só remarco um atendimento que já está marcado: dia, horário ou profissional. Esse pedido ficou de fora e nada foi alterado.";
/** A message with no request in it (greeting, thanks…) and no open plan. */
export const PILOT_CONVERSATION_REPLY = "Por aqui eu remarco um atendimento que já está marcado: me diga de quem é e para qual dia, horário ou profissional devo passar.";
/** The withdrawal of the open draft (nothing on the agenda changes). */
export const PILOT_WITHDRAWN_REPLY = "Combinado: retirei essa remarcação e nada foi alterado na agenda.";
/** A withdrawal or an answer with no open draft. */
export const PILOT_NOTHING_OPEN_REPLY = "Não há remarcação em andamento; nada foi alterado.";
/** The real agenda preparation failed for a reason that is not a rule of the agenda (nothing proposed, the resolved fields kept). */
export const PILOT_PREPARATION_FAILED = "Não consegui preparar a remarcação agora; nada foi alterado. Pode mandar o pedido de novo?";
/** The Confirmar could not write (the agenda changed after the proposal): nothing written, checked again below. */
export const PILOT_CONFIRM_FAILED = "A agenda mudou depois da proposta e nada foi gravado. Conferi de novo:";
/** Review M11/L10: the agenda does not move this appointment on this path (a dependent's, or one with products): nothing proposed. */
export const PILOT_RELATION_NOT_SUPPORTED = "Esse atendimento tem dependente ou produtos vinculados e não pode ser remarcado por aqui; nada foi alterado. Qual outro atendimento devo remarcar?";
/** Review L10: the agenda's violation codes that are the professional's (or the salon's) hours, not a taken slot. */
export const PILOT_HOURS_VIOLATIONS: ReadonlySet<string> = new Set(["OUTSIDE_WORKING_HOURS", "AFTER_WORKING_HOURS", "WORKING_HOURS_BREAK", "SALON_CLOSED"]);
/** The Confirmar came after the proposal's validity: nothing written, prepared again below (a new Confirmar is needed). */
export const PILOT_PROPOSAL_EXPIRED = "A proposta tinha expirado e nada foi gravado. Preparei de novo:";
/** The salon's team or catalog could not be read before Luna (review L9): nothing is interpreted and nothing changes. */
export const PILOT_DIRECTORY_UNAVAILABLE = "Não consegui consultar os dados do salão agora; nada foi alterado. Pode repetir em instantes?";
/** An identity question answered without a name (review M12): a yes is never inferred; the name, or a tap on the option, is asked. */
export const PILOT_NAME_REQUIRED = "Para eu ter certeza, escreva o nome como está no cadastro ou toque na opção.";
/** The open draft, when nothing in it is asked or ready (review L8: never an empty reply). */
export const PILOT_OPEN_DRAFT = "O pedido de remarcação segue em aberto e nada foi gravado. Diga o que deseja mudar.";
/** The message input with the flag on: the existing one plus the client's turn id (027's clientTurnId). */
export const pilotTurnInput = z.object({ sessionId: z.string().uuid(), message: z.string().trim().min(1).max(1000), operation_ref: z.string().uuid().optional(),
  clientTurnId: z.string().uuid().optional() }).strict();
export type PilotTurnInput = z.infer<typeof pilotTurnInput>;
/** SecretaryView.pilot. `status`/`fields` are null before a plan exists (conversation, a request wholly out of scope); `questions`: the open ones;
 * `proposal`: the journal refs of the ready proposal; `turn.replayed`: the stored reply of a repeated clientTurnId. */
export type PilotView = {
  planId: string | null; revision: number; status: PilotStatus | null; fields: Record<PilotFieldName, PilotField> | null;
  questions: Pick<PilotQuestion, "questionId" | "field" | "reason" | "options">[];
  proposal: Pick<PilotProposal, "proposalRef" | "draftRevision" | "revision"> | null;
  turn: { turnId: string; clientTurnId: string | null; receivedAt: string; replayed: boolean };
};
/** What the session keeps for the pilot (in memory, and in the persisted aggregate when the store is on). `pending`: Luna's typed operators of
 * the open action not resolved yet (a weekday's second reading needs the original day, so "sexta" waits for the customer and the appointment);
 * a later turn's operator replaces the one of its own slot. `replies`: the stored reply of each clientTurnId. `sources`: the owner's messages of
 * the open plan that brought origin hints (the narrow provenance check reads them, nothing else). `outOfScope`: the parts of the open request
 * the pilot does not do, until the owner answers the scope question. `asked`: the text of each open question (what a stale answer repeats).
 * `turn`: the latest turn. `questionFloor`: the largest question number of the session's earlier plans (ids never restart). `actionPlanRef`/
 * `actionPlanFor`/`published`: the ActionPlan (SalonSecretary) this plan publishes through, the plan it was made for and the plan revision it
 * last showed. */
export type PilotSessionState = { plan?: PilotPlan; pending?: { origem: PilotOrigin; destino: PilotDestination };
  replies: { clientTurnId: string; turnId: string; message: string; view: PilotView }[];
  sources?: string[]; outOfScope?: string[]; asked?: { questionId: string; text: string }[]; notes?: string[];
  turn?: { turnId: string; clientTurnId: string | null; receivedAt: string }; questionFloor?: number;
  actionPlanRef?: string; actionPlanFor?: string; published?: number };
/** The resolved change the real agenda preparation receives: refs and the local day and clock (the appointment is never located again).
 * `keepsProfessional`: the professional is the appointment's own (no new professional is sent); `notes`: the derived assumptions it shows;
 * `today`: the salon's local day of received_at (the year the texts are written against). */
export type PilotResolvedChange = { appointmentRef: string; customerRef: string; date: string; time: string; professionalRef: string; serviceRef: string;
  derived: PilotFieldName[]; keepsProfessional: boolean; notes: string[]; today?: string };
export type PilotPreparation = { ok: true; proposal: PilotProposal }
  | { ok: false; code: "SLOT_UNAVAILABLE" | "OUTSIDE_HOURS" | "SERVICE_NOT_PERFORMED" | "NO_CHANGE" | "RELATION_NOT_SUPPORTED" | "PREPARATION_FAILED"; text: string; alternatives?: string[] };
export type PilotReceipt = { proposalRef: string; appointmentRef: string; outcome: "RESCHEDULED" | "PENDING_ACCEPTANCE"; duplicate: boolean };
/** What SalonSecretary lends the pilot for one call, inside its lease, authorization and tenant scope. */
export interface PilotHost {
  readonly actor: ServiceActor;
  readonly state: PilotSessionState;
  /** The model id (the request is measured against the size cap with it). */
  readonly modelId: string;
  /** The measured, usage-instrumented model of this message. */
  model(): Promise<Model>;
  reader(): PilotReader;
  /** received_at frozen at the start of the turn, and the salon's timezone. */
  clock(): Promise<PilotClock>;
  /** The real agenda preparation (conflict, hours, the service performed, duration, price) of a change that keeps its appointment. */
  prepare(change: PilotResolvedChange): Promise<PilotPreparation>;
  /** The journal receipt of a proposal_ref already written, if any. */
  receipt(proposalRef: string): Promise<PilotReceipt | undefined>;
  /** A receipt found outside the Confirmar's own success (a lost reply, a failure after the commit): the agenda side is marked written with it. */
  settle(receipt: PilotReceipt): Promise<void>;
  /** The existing Confirmar of one proposal (lock, fresh snapshot, journal receipt; idempotent). */
  confirm(approval: PilotApproval): Promise<PilotReceipt>;
}
/** `code`: the turn's outcome (telemetry, codes only); `telemetry`: codes and numbers of the turn. */
export type PilotReply = { text: string; view: PilotView; code?: string; telemetry?: Record<string, unknown> };

// ---------------------------------------------------------------- presentation (pt-BR, neutral about the customer's gender)
const list = (items: readonly string[]) => items.length < 2 ? items.join("") : `${items.slice(0, -1).join(", ")} e ${items.at(-1)}`;
/** Review M3: what a question lists is bounded; the rest is counted ("e mais N"), never written out. */
const SHOWN_OPTIONS = 8;
const listed = (items: readonly string[], separator = "; ") => items.length <= SHOWN_OPTIONS ? items.join(separator)
  : `${items.slice(0, SHOWN_OPTIONS).join(separator)}${separator}e mais ${items.length - SHOWN_OPTIONS}`;
const quoted = (text: string) => `“${text}”`;
const brl = (cents: number) => (cents / 100).toLocaleString("pt-BR", { style: "currency", currency: "BRL" });
const minutesBetween = (start: string, end: string) => Math.round((Date.parse(`${end.slice(0, 16)}:00Z`) - Date.parse(`${start.slice(0, 16)}:00Z`)) / 60_000);
/** One appointment as the owner reads it (no customer name: it is always the customer's own). `reference`: the year of received_at. */
export const pilotAppointmentLabel = (row: Pick<PilotAppointmentRow, "startLocal" | "serviceName" | "professionalName">, reference?: string) =>
  `${formatLocal(row.startLocal, reference)} — ${row.serviceName} com ${row.professionalName}`;
/** The proposal's facts, from the agenda's own snapshot of the change (the C4 action snapshot). */
export type PilotSnapshotFacts = { customer_name?: string; services: readonly { name: string }[]; professional_name: string; before_professional_name?: string;
  before_start?: string; before_end?: string; startLocal: string; endLocal: string; priceCents?: number; requires_acceptance: boolean };
/** §5: identity, service and professional, ANTES and DEPOIS, duration and price unchanged, the derived assumptions and the customer notice. */
export function pilotProposalText(snapshot: PilotSnapshotFacts, notes: readonly string[], reference?: string): string {
  const before = snapshot.before_start && snapshot.before_end ? formatLocalRange(snapshot.before_start, snapshot.before_end, reference) : "";
  const professional = snapshot.before_professional_name && snapshot.before_professional_name !== snapshot.professional_name
    ? `${snapshot.before_professional_name} → ${snapshot.professional_name}` : snapshot.professional_name;
  return [
    "REMARCAÇÃO",
    `Cliente: ${snapshot.customer_name ?? ""}`,
    `Serviço: ${list(snapshot.services.map(service => service.name))}`,
    `Profissional: ${professional}`,
    `ANTES: ${before}`,
    `DEPOIS: ${formatLocalRange(snapshot.startLocal, snapshot.endLocal, reference)}`,
    `Duração mantida: ${minutesBetween(snapshot.startLocal, snapshot.endLocal)} min. Preço mantido: ${brl(snapshot.priceCents ?? 0)}.`,
    ...notes,
    PILOT_CUSTOMER_NOTICE,
    ...(snapshot.requires_acceptance ? ["O novo horário fica aguardando o aceite do cliente."] : []),
    "Use Confirmar para gravar.",
  ].join("\n");
}
/** The ActionPlan field names of the runner and the screen for each question of the pilot. */
export const PILOT_MISSING_FIELDS: Record<PilotQuestionField, string> = { customer: "customer_ref", appointment: "appointment_ref", date: "date", time: "time",
  professional: "target_professional_ref", service: "service_ref", scope: "scope" };
const turnOf = (turn: { turnId: string; clientTurnId: string | null; receivedAt: string } | undefined, replayed: boolean) =>
  ({ turnId: turn?.turnId ?? "", clientTurnId: turn?.clientTurnId ?? null, receivedAt: turn?.receivedAt ?? "", replayed });
/** The view of the pilot's state (the open questions only; the proposal's journal refs; the latest turn). */
export function pilotView(state: PilotSessionState): PilotView {
  const plan = state.plan, proposal = plan?.action.proposal;
  return { planId: plan?.planId ?? null, revision: plan?.revision ?? 0, status: plan?.action.status ?? null, fields: plan ? structuredClone(plan.action.fields) : null,
    questions: openQuestions(plan).map(({ questionId, field, reason, options }) => ({ questionId, field, reason, ...(options ? { options: structuredClone(options) } : {}) })),
    proposal: proposal ? { proposalRef: proposal.proposalRef, draftRevision: proposal.draftRevision, revision: proposal.revision } : null,
    turn: turnOf(state.turn, false) };
}
/** Review L1 (§4): a repeated clientTurnId gets its stored reply exactly as recorded (text and view), marked replayed. */
export function pilotReplay(state: PilotSessionState, clientTurnId: string | undefined): { text: string; view: PilotView } | undefined {
  const stored = clientTurnId ? state.replies.find(reply => reply.clientTurnId === clientTurnId) : undefined;
  return stored ? { text: stored.message, view: { ...structuredClone(stored.view), turn: turnOf(stored.view.turn, true) } } : undefined;
}
/** What the open plan says now: its open questions, else its ready proposal, else that the draft stays open. */
export function pilotStateText(state: PilotSessionState): string {
  const plan = state.plan;
  if (!plan || pilotPlanClosed(plan)) return "";
  const asked = openQuestions(plan).map(question => state.asked?.find(item => item.questionId === question.questionId)?.text).filter((text): text is string => !!text);
  if (asked.length) return asked.join("\n");
  return plan.action.status === "proposal_ready" && plan.action.proposal ? plan.action.proposal.text : PILOT_OPEN_DRAFT;
}
const joined = (...parts: readonly string[]) => parts.filter(Boolean).join("\n\n");

// ---------------------------------------------------------------- one owner message
/** `baseRevision` (review L8): the revision the turn started on; the turn's first reduction compares against it (compare-and-swap). */
type Ctx = { host: PilotHost; state: PilotSessionState; reader: PilotReader; clock: PilotClock; message: string; catalog: readonly PilotServiceRow[]; baseRevision: number; reference: string;
  /** Review M4: this message brought an origin hint different from the pending one (only then is a bound appointment located again). */
  originChanged?: boolean };
type Outcome = { text: string; code: string };
/** What the resolution of the open plan's fields gives: every field (resolved or not), at most one question with its text, the appointment row
 * and the notes of the derived values. */
type Resolution = { fields: Record<PilotFieldName, PilotField>; question?: PilotQuestionDraft; text?: string; appointment?: PilotAppointmentRow; notes: string[] };
const UNRESOLVED = (mencao?: string): PilotField => ({ value: null, display: null, provenance: "unresolved", ...(mencao ? { mencao } : {}) });
const EMPTY_ORIGIN: PilotOrigin = { dia: null, hora: null, profissional_mencao: null, servico_mencao: null, posicao: null };
const EMPTY_DESTINATION: PilotDestination = { dia: null, hora: null, profissional: { modo: null, mencao: null } };
/** An interpretation that says nothing (the base of an owner's tap on an option). */
const SILENT: PilotInterpretation = { tipo: "resposta", resposta_a: null, desistir: false, aceita_parcial: null, cliente: { mencao: null }, origem: EMPTY_ORIGIN,
  destino: EMPTY_DESTINATION, fora_do_escopo: [] };
const hasOrigin = (origem: PilotOrigin) => Object.values(origem).some(value => value !== null);
const hasCorrection = (I: PilotInterpretation) => !!I.cliente.mencao || hasOrigin(I.origem) || !!I.destino.dia || !!I.destino.hora || !!I.destino.profissional.modo || !!I.destino.profissional.mencao;
/** The five resolved records a change is about (the service always follows the appointment). */
const RECORDS: readonly PilotFieldName[] = ["customer", "appointment", "date", "time", "professional"];
const floorOf = (ctx: Ctx) => ctx.state.questionFloor ?? 0;

/** One owner message on the pilot path (a repeated clientTurnId returns the stored reply). */
export async function handlePilotMessage(host: PilotHost, input: PilotTurnInput): Promise<PilotReply> {
  const state = host.state, replay = pilotReplay(state, input.clientTurnId);
  if (replay) return { ...replay, code: "REPLAYED" };
  const startedAt = performance.now(), clock = await host.clock(), reader = host.reader();
  const turn = { turnId: randomUUID(), clientTurnId: input.clientTurnId ?? null, receivedAt: clock.receivedAt.toISOString() };
  const baseRevision = state.plan?.revision ?? 0, today = pilotToday(clock);
  let interpreted: Awaited<ReturnType<typeof runPilotInterpretation>> | undefined, outcome: Outcome;
  let team: readonly { name: string }[] | undefined, catalog: readonly PilotServiceRow[] | undefined;
  try { [team, catalog] = await Promise.all([reader.team(), reader.catalog()]); } catch { team = undefined; catalog = undefined; }
  if (!team || !catalog) outcome = { text: joined(PILOT_DIRECTORY_UNAVAILABLE, pilotStateText(state)), code: "PILOT_DIRECTORY_UNAVAILABLE" };
  else {
    const context: PilotRequestContext = { today: { date: today, weekday: new Date(`${today}T12:00:00Z`).toLocaleDateString("pt-BR", { weekday: "long", timeZone: "UTC" }), timezone: clock.timezone },
      team: [...new Set(team.map(row => row.name).filter(Boolean))].slice(0, 40), services: [...new Set(catalog.map(row => row.name))].slice(0, 80),
      ...(state.plan && !pilotPlanClosed(state.plan) ? { open: pilotOpenContext(state) } : {}) };
    interpreted = await runPilotInterpretation(await host.model(), { context, message: input.message, modelId: host.modelId, startedAt });
    const ctx: Ctx = { host, state, reader, clock, message: input.message, catalog, baseRevision, reference: today };
    outcome = interpreted.ok ? await applyInterpretation(ctx, interpreted.interpretation) : { text: joined(PILOT_SAFE_REPLY, pilotStateText(state)), code: interpreted.code };
  }
  if (state.plan) state.plan = { ...state.plan, turns: [...state.plan.turns, { ...turn, baseRevision, revision: state.plan.revision, outcome: outcome.code }].slice(-40) };
  state.turn = turn;
  const view = pilotView(state);
  if (input.clientTurnId) state.replies = [...state.replies, { clientTurnId: input.clientTurnId, turnId: turn.turnId, message: outcome.text, view }].slice(-20);
  return { text: outcome.text, view, code: outcome.code, telemetry: pilotTelemetry(state, { turn_id: turn.turnId, base_revision: baseRevision, latency_ms: Math.round(performance.now() - startedAt),
    model_calls: interpreted?.telemetry.calls ?? 0, repaired: interpreted?.telemetry.repaired ?? false, ...(interpreted && !interpreted.ok ? { schema: interpreted.telemetry.schema } : {}),
    request_bytes: interpreted?.telemetry.request_bytes ?? [] }) };
}
/** §6: codes and numbers of the plan after a call (never a name or the owner's words). */
export function pilotTelemetry(state: PilotSessionState, extra: Record<string, unknown> = {}): Record<string, unknown> {
  const plan = state.plan, fields = plan?.action.fields, question = openQuestions(plan)[0];
  return { ...extra, plan_id: plan?.planId ?? null, revision: plan?.revision ?? 0, status: plan?.action.status ?? null,
    ...(question ? { question: { id: question.questionId, field: question.field, reason: question.reason } } : {}),
    proposal_ref: plan?.action.proposal?.proposalRef ?? null, ...(plan?.action.invalidation ? { invalidation: plan.action.invalidation.reason } : {}),
    provenance: fields ? Object.fromEntries(PILOT_FIELDS.map(name => [name, fields[name].provenance])) : null };
}
/** The open plan as Luna sees it: field states with the owner's own words for the customer (never the registered name), and the pending
 * question with options for a day, a clock, an appointment or a professional (review M12; never a customer's name: decision 22). */
export function pilotOpenContext(state: PilotSessionState): PilotOpenContext {
  const plan = state.plan!, f = plan.action.fields, question = openQuestions(plan)[0], L = PILOT_OPEN_LABELS;
  const said = (field: PilotField) => field.provenance === "unresolved" ? L.notDefined : `${field.display ?? field.value}${field.provenance === "inherited" ? ` (${L.kept})` : ""}`;
  const lines = [`${L.customer}: ${f.customer.mencao ? quoted(f.customer.mencao) : L.notSaid} (${f.customer.provenance === "unresolved" ? L.recordOpen : L.recordDefined})`,
    `${L.appointment}: ${f.appointment.provenance === "unresolved" ? L.notLocated : f.appointment.display}`, `${L.date}: ${said(f.date)}`, `${L.time}: ${said(f.time)}`,
    `${L.professional}: ${said(f.professional)}`, ...(plan.action.status === "proposal_ready" ? [L.ready] : [])];
  // The labels only (the contract has no slot for an id: the owner's words pointing at one are copied; a tap answers by id, selectPilotOption).
  const shown = question && question.field !== "customer" && question.field !== "scope" ? question.options?.slice(0, SHOWN_OPTIONS).map(option => option.label) : undefined;
  const fieldName: Record<PilotQuestionField, string> = L.fields;
  return { lines, ...(question ? { question: { questionId: question.questionId, field: fieldName[question.field], reason: question.reason, ...(shown?.length ? { options: shown } : {}) } } : {}) };
}

async function applyInterpretation(ctx: Ctx, I: PilotInterpretation): Promise<Outcome> {
  const { state } = ctx, open = state.plan && !pilotPlanClosed(state.plan) ? state.plan : undefined;
  if (I.desistir) return withdrawal(ctx, I, open);
  if (I.resposta_a !== null) return answer(ctx, I, open);
  if (I.tipo === "fora_do_escopo") return { text: joined(PILOT_OUT_OF_SCOPE_REPLY, await currentText(ctx, open)), code: "OUT_OF_SCOPE" };
  if (I.tipo === "conversa") return { text: open ? await currentText(ctx, open) || PILOT_CONVERSATION_REPLY : PILOT_CONVERSATION_REPLY, code: "CONVERSATION" };
  return request(ctx, I, open);
}
/** What an open plan shows when the message changed nothing in it; a plan whose proposal lost its validity meanwhile is prepared again. */
async function currentText(ctx: Ctx, open: PilotPlan | undefined): Promise<string> {
  if (!open) return "";
  if (open.action.status === "needs_review" && !openQuestions(open).length && PILOT_FIELDS.every(name => open.action.fields[name].provenance !== "unresolved"))
    return (await finish(ctx, undefined)).text;
  return pilotStateText(ctx.state);
}
/** A later turn's operator replaces the one of its own slot; the message that brought origin hints feeds the provenance check. */
function mergeOperators(ctx: Ctx, I: PilotInterpretation) {
  const pending = ctx.state.pending ?? { origem: { ...EMPTY_ORIGIN }, destino: structuredClone(EMPTY_DESTINATION) };
  const origem = { ...pending.origem }, destino = structuredClone(pending.destino);
  for (const key of Object.keys(EMPTY_ORIGIN) as (keyof PilotOrigin)[]) if (I.origem[key] !== null) {
    if (JSON.stringify(I.origem[key]) !== JSON.stringify(pending.origem[key])) ctx.originChanged = true;
    (origem as Record<string, unknown>)[key] = structuredClone(I.origem[key]);
  }
  if (I.destino.dia) destino.dia = structuredClone(I.destino.dia);
  if (I.destino.hora) destino.hora = structuredClone(I.destino.hora);
  if (I.destino.profissional.modo || I.destino.profissional.mencao) destino.profissional = { ...I.destino.profissional };
  ctx.state.pending = { origem, destino };
  if (hasOrigin(I.origem)) ctx.state.sources = [...(ctx.state.sources ?? []), ctx.message].slice(-8);
}
/** A new plan for a new request (the previous one, if any, is closed): its question numbers continue the session's. */
function newPlan(ctx: Ctx): PilotPlan {
  const { state } = ctx;
  state.questionFloor = Math.max(state.questionFloor ?? 0, lastQuestionNumber(state.plan));
  state.pending = undefined; state.sources = []; state.outOfScope = []; state.asked = []; state.notes = [];
  return createPilotPlan(randomUUID());
}
/** A new request or an independent correction ("remarcar", "misto", or an answer to no question). C2: an out-of-scope part is asked about
 * before the possible part is proposed, whatever the kind Luna gave the message. */
async function request(ctx: Ctx, I: PilotInterpretation, open: PilotPlan | undefined): Promise<Outcome> {
  const { state } = ctx, plan = open ?? newPlan(ctx), base = open ? ctx.baseRevision : plan.revision;
  mergeOperators(ctx, I);
  const resolution = await resolveFields(ctx, plan, I);
  if (I.fora_do_escopo.length) state.outOfScope = I.fora_do_escopo.map(item => item.mencao);
  return change(ctx, plan, resolution, state.outOfScope?.length ? scopeQuestion(ctx, plan, state.outOfScope) : undefined, "CHANGED",
    (current, patch) => applyIntent(current, patch, current === plan ? base : current.revision));
}
/** §1: the question asked before proposing the possible part of a partly out-of-scope request (answered by `aceita_parcial`). */
function scopeQuestion(ctx: Ctx, plan: PilotPlan, parts: readonly string[]) {
  return { draft: { questionId: nextQuestionId(plan, floorOf(ctx)), field: "scope" as const, reason: "OUT_OF_SCOPE_PART" as const },
    text: `Uma parte do pedido eu ainda não faço por aqui (${listed(parts.map(quoted))}): ela ficou de fora e nada foi feito. Quer que eu prepare só a remarcação?` };
}
/** The resolved fields become one change of the plan (its question, or the scope question first); then the proposal when nothing is asked. */
async function change(ctx: Ctx, plan: PilotPlan, resolution: Resolution, scope: { draft: PilotQuestionDraft; text: string } | undefined, code: string,
  reduce: (plan: PilotPlan, patch: { fields: Resolution["fields"]; questions: PilotQuestionDraft[] }) => PilotReduction = (current, patch) => applyIntent(current, patch, current.revision)): Promise<Outcome> {
  const question = scope?.draft ?? resolution.question, text = scope?.text ?? resolution.text;
  const reduced = reduce(plan, { fields: resolution.fields, questions: question ? [question] : [] });
  if (!reduced.ok) return { text: joined(PILOT_SAFE_REPLY, pilotStateText(ctx.state)), code: `PLAN_${reduced.code}` };
  ctx.state.plan = reduced.plan; ctx.state.notes = resolution.notes;
  ctx.state.asked = question && text ? [{ questionId: question.questionId, text }] : [];
  if (reduced.plan.action.status === "withdrawn") return { text: PILOT_WITHDRAWN_REPLY, code: "WITHDRAWN" };
  if (question) return { text: text ?? "", code: `ASKED_${question.reason}` };
  return finish(ctx, resolution, code);
}
/** Every field resolved and nothing asked: a destination equal to the appointment itself is asked; otherwise the real agenda's proposal. */
async function finish(ctx: Ctx, resolution: Resolution | undefined, code = "PROPOSED"): Promise<Outcome> {
  const { state } = ctx, plan = state.plan!, f = plan.action.fields;
  const row = resolution?.appointment;
  if (row && f.date.value === row.startLocal.slice(0, 10) && f.time.value === row.startLocal.slice(11, 16) && f.professional.value === row.professionalId)
    return noChange(ctx, plan, pilotAppointmentLabel(row, ctx.reference));
  const prepared = await preparePilotProposal(ctx.host, plan, state.notes ?? [], { floor: floorOf(ctx), today: ctx.reference, appointment: f.appointment.display ?? "" });
  state.plan = prepared.plan;
  if (prepared.text) state.asked = openQuestions(prepared.plan).map(question => ({ questionId: question.questionId, text: prepared.text! }));
  return prepared.plan.action.status === "proposal_ready" ? { text: prepared.plan.action.proposal!.text, code }
    : { text: prepared.text ?? PILOT_PREPARATION_FAILED, code: prepared.code ?? "PREPARATION_FAILED" };
}
/** The destination is the appointment's own slot and professional: nothing to change, the destination is asked. */
function noChange(ctx: Ctx, plan: PilotPlan, label: string): Outcome {
  const draft = { questionId: nextQuestionId(plan, floorOf(ctx)), field: "date" as const, reason: "DESTINATION_MISSING" as const };
  const text = `Esse já é o horário do atendimento (${label}). Para qual dia, horário ou profissional devo passar?`;
  const reduced = applyIntent(plan, { fields: { date: UNRESOLVED(), time: UNRESOLVED() }, questions: [draft] }, plan.revision);
  if (reduced.ok) { ctx.state.plan = reduced.plan; ctx.state.asked = [{ questionId: draft.questionId, text }]; }
  return { text, code: "ASKED_DESTINATION_MISSING" };
}
/** An answer: only to an open question of the current revision; anything else changes nothing and the open question is asked again. M1: the
 * scope question takes only `aceita_parcial` (true: the possible part goes on; false: the draft is withdrawn; null: asked again; never a yes
 * inferred). M12: an identity question answered without a name is asked again with what is needed, never re-resolved in a loop. */
async function answer(ctx: Ctx, I: PilotInterpretation, open: PilotPlan | undefined): Promise<Outcome> {
  if (!open) return { text: joined(PILOT_NOTHING_OPEN_REPLY, ctx.state.plan?.action.status === "done" ? "" : PILOT_CONVERSATION_REPLY), code: "ANSWER_NO_PLAN" };
  const question = open.action.questions.find(item => item.questionId === I.resposta_a);
  if (!question || !question.open || question.revision !== open.revision)
    return { text: pilotStateText(ctx.state) || await currentText(ctx, open), code: !question ? "QUESTION_UNKNOWN" : !question.open ? "QUESTION_CLOSED" : "QUESTION_STALE" };
  if (question.field === "scope") {
    if (I.aceita_parcial === false) {
      const reduced = withdraw(open, ctx.baseRevision);
      if (!reduced.ok) return { text: joined(PILOT_SAFE_REPLY, pilotStateText(ctx.state)), code: `PLAN_${reduced.code}` };
      ctx.state.plan = reduced.plan; ctx.state.asked = []; ctx.state.outOfScope = [];
      return { text: PILOT_WITHDRAWN_REPLY, code: "SCOPE_DECLINED" };
    }
    if (I.aceita_parcial !== true) return { text: pilotStateText(ctx.state), code: "SCOPE_UNANSWERED" };
  } else if (question.field === "customer" && !I.cliente.mencao || question.field === "professional" && !I.destino.profissional.mencao && !I.destino.profissional.modo)
    return { text: joined(PILOT_NAME_REQUIRED, pilotStateText(ctx.state)), code: "ANSWER_WITHOUT_NAME" };
  mergeOperators(ctx, I);
  return answerWith(ctx, open, question, I);
}
/** The answer applied: only its question's field, through the reducer (compare-and-swap on the turn's revision); what the backend derives from
 * it (the appointment, the day…) is the change that follows. */
async function answerWith(ctx: Ctx, open: PilotPlan, question: PilotQuestion, I: PilotInterpretation, value?: PilotField): Promise<Outcome> {
  let plan = open;
  if (question.field === "scope") {
    ctx.state.outOfScope = [];
    const reduced = applyAnswer(plan, { questionId: question.questionId }, ctx.baseRevision);
    if (!reduced.ok) return { text: joined(PILOT_SAFE_REPLY, pilotStateText(ctx.state)), code: `PLAN_${reduced.code}` };
    plan = reduced.plan;
  } else if (value) {
    const reduced = applyAnswer(plan, { questionId: question.questionId, value }, ctx.baseRevision);
    if (!reduced.ok) return { text: joined(PILOT_SAFE_REPLY, pilotStateText(ctx.state)), code: `PLAN_${reduced.code}` };
    plan = reduced.plan;
  }
  const resolution = await resolveFields(ctx, plan, I, question);
  if (question.field !== "scope" && !value) {
    const resolved = resolution.fields[question.field];
    if (resolved.provenance !== "unresolved") {
      const reduced = applyAnswer(plan, { questionId: question.questionId, value: resolved }, ctx.baseRevision);
      if (!reduced.ok) return { text: joined(PILOT_SAFE_REPLY, pilotStateText(ctx.state)), code: `PLAN_${reduced.code}` };
      plan = reduced.plan;
    }
  }
  if (I.fora_do_escopo.length) ctx.state.outOfScope = I.fora_do_escopo.map(item => item.mencao);
  return change(ctx, plan, resolution, ctx.state.outOfScope?.length ? scopeQuestion(ctx, plan, ctx.state.outOfScope) : undefined, "ANSWERED");
}
/** "desistir": the draft is withdrawn; with a correction in the same message, the corrected draft stands instead (the old value is never kept).
 * C1: a correction is a resolved record that really differs from the open draft (customer, appointment, day, clock, professional), or a question
 * other than the one already open; the open request said again with "desistir" is the plain withdrawal. */
async function withdrawal(ctx: Ctx, I: PilotInterpretation, open: PilotPlan | undefined): Promise<Outcome> {
  if (!open) return { text: PILOT_NOTHING_OPEN_REPLY, code: "WITHDRAW_NOTHING" };
  const plain = (): Outcome => {
    const reduced = withdraw(open, ctx.baseRevision);
    if (!reduced.ok) return { text: joined(PILOT_SAFE_REPLY, pilotStateText(ctx.state)), code: `PLAN_${reduced.code}` };
    ctx.state.plan = reduced.plan; ctx.state.asked = []; ctx.state.outOfScope = [];
    return { text: PILOT_WITHDRAWN_REPLY, code: "WITHDRAWN" };
  };
  if (!hasCorrection(I)) return plain();
  const before = { pending: structuredClone(ctx.state.pending), sources: ctx.state.sources ? [...ctx.state.sources] : undefined };
  mergeOperators(ctx, I);
  const resolution = await resolveFields(ctx, open, I);
  const asked = openQuestions(open), q = resolution.question;
  const corrected = RECORDS.some(name => resolution.fields[name].value !== open.action.fields[name].value) ||
    !!q && !asked.some(item => item.field === q.field && item.reason === q.reason);
  if (!corrected) { ctx.state.pending = before.pending; ctx.state.sources = before.sources; return plain(); }
  ctx.state.outOfScope = [];
  return change(ctx, open, resolution, undefined, "CORRECTED", (plan, patch) => withdraw(plan, plan === open ? ctx.baseRevision : plan.revision, patch));
}
/** Review M12: the owner's tap on an option of the open question (its id, which the backend published): the answer is that real record, day or
 * clock, applied exactly as a typed answer would be (only that field; the rest follows). The day or clock replaces the pending operator of its
 * slot, so the next resolution keeps the choice. */
export async function selectPilotOption(host: PilotHost, optionId: string): Promise<PilotReply> {
  const state = host.state, open = state.plan && !pilotPlanClosed(state.plan) ? state.plan : undefined;
  const question = openQuestions(open).find(item => item.options?.some(option => option.id === optionId));
  const option = question?.options?.find(item => item.id === optionId);
  if (!open || !question || !option || question.revision !== open.revision) throw Error("SELECTION_INVALID");
  const clock = await host.clock(), today = pilotToday(clock);
  const ctx: Ctx = { host, state, reader: host.reader(), clock, message: "", catalog: [], baseRevision: open.revision, reference: today };
  let value: PilotField | undefined;
  const pending = state.pending ?? { origem: { ...EMPTY_ORIGIN }, destino: structuredClone(EMPTY_DESTINATION) };
  if (question.field === "customer" || question.field === "appointment") value = { value: option.id, display: option.label, provenance: "explicit" };
  else if (question.field === "date" && /^\d{4}-\d{2}-\d{2}$/.test(option.id))
    state.pending = { ...pending, destino: { ...pending.destino, dia: { tipo: "data", dia: Number(option.id.slice(8, 10)), mes: Number(option.id.slice(5, 7)), mencao: option.label } } };
  else if (question.field === "time" && /^\d{2}:\d{2}$/.test(option.id)) {
    const hour = Number(option.id.slice(0, 2));
    state.pending = { ...pending, destino: { ...pending.destino, hora: { tipo: "relogio", hora: hour, minuto: Number(option.id.slice(3, 5)), periodo: hour < 12 ? "manha" : null, mencao: option.label } } };
  } else if (question.field === "professional") state.pending = { ...pending, destino: { ...pending.destino, profissional: { modo: "nomeado", mencao: option.label } } };
  else throw Error("SELECTION_INVALID");
  const outcome = await answerWith(ctx, open, question, SILENT, value);
  return { text: outcome.text, view: pilotView(state), code: `SELECTED_${outcome.code}`, telemetry: pilotTelemetry(state, { selected: question.field }) };
}

// ---------------------------------------------------------------- the resolution of the open plan's fields (dependency order, one question)
const identityName = (identity: PilotIdentity) => identity.state === "exact" || identity.state === "partial" ? identity.name : undefined;
/** Whether every folded name token of a mention is a token of a bound record's registered name (the same person or professional said again). */
const pilotMentionHolds = (mention: string, name: string | null) => {
  const tokens = nameTokens(mention), own = new Set(nameTokens(name ?? ""));
  return tokens.length > 0 && tokens.every(token => own.has(token));
};
const personOptions = (rows: readonly PilotPerson[]): PilotOption[] => rows.slice(0, PILOT_OPTIONS_MAX).map(row => ({ id: row.id, label: row.name }));
const names = (rows: readonly PilotPerson[]) => listed(rows.map(row => row.name), ", ");
function customerQuestion(identity: PilotIdentity | undefined): { reason: PilotQuestionReason; text: string; options?: PilotOption[] } {
  if (!identity) return { reason: "CUSTOMER_MISSING", text: "De quem é o atendimento que devo remarcar?" };
  switch (identity.state) {
    case "ambiguous": return { reason: "CUSTOMER_AMBIGUOUS", options: personOptions(identity.options),
      text: `Encontrei mais de um cadastro para ${quoted(identity.mencao)}: ${names(identity.options)}. Qual deles?` };
    case "contradictory": return { reason: "CUSTOMER_CONTRADICTORY", options: personOptions([identity.candidate]),
      text: `Encontrei ${identity.candidate.name}, mas você escreveu ${identity.mencao}. É a mesma pessoa? Se for, escreva o nome como está no cadastro ou toque nele; se não, diga o nome de quem é.` };
    case "not_found": return { reason: "CUSTOMER_NOT_FOUND", ...(identity.suggestions.length ? { options: personOptions(identity.suggestions) } : {}),
      text: `Não encontrei ${quoted(identity.mencao)} entre os clientes do salão.${identity.suggestions.length ? ` Seria ${names(identity.suggestions)}? Se for, escreva o nome assim ou toque nele.` : " Qual é o nome no cadastro?"}` };
    default: return { reason: "LOOKUP_UNAVAILABLE", text: "Não consegui consultar os cadastros agora; nada foi alterado. Pode repetir em instantes?" };
  }
}
function professionalQuestion(identity: PilotIdentity): { reason: PilotQuestionReason; text: string; options?: PilotOption[] } {
  switch (identity.state) {
    case "ambiguous": return { reason: "PROFESSIONAL_AMBIGUOUS", options: personOptions(identity.options),
      text: `Há mais de uma pessoa da equipe para ${quoted(identity.mencao)}: ${names(identity.options)}. Quem vai atender?` };
    case "contradictory": return { reason: "PROFESSIONAL_CONTRADICTORY", options: personOptions([identity.candidate]),
      text: `Encontrei ${identity.candidate.name} na equipe, mas você escreveu ${identity.mencao}. É a mesma pessoa? Se for, escreva o nome como está no cadastro ou toque nele.` };
    case "not_found": return { reason: "PROFESSIONAL_NOT_FOUND", ...(identity.suggestions.length ? { options: personOptions(identity.suggestions) } : {}),
      text: `Não encontrei ${quoted(identity.mencao)} na equipe.${identity.suggestions.length ? ` Seria ${names(identity.suggestions)}?` : " Quem vai atender?"}` };
    default: return { reason: "LOOKUP_UNAVAILABLE", text: "Não consegui consultar a equipe agora; nada foi alterado. Pode repetir em instantes?" };
  }
}
/** The destination clock already known without the day's hours (coordinator decision 4: a weekday said on that very weekday may also be today). */
function knownClock(hora: PilotDestination["hora"], origin: { time: string }): string | null {
  if (!hora) return null;
  if (hora.tipo === "relogio") { const readings = pilotClockReadings(hora); return readings.length === 1 ? readings[0] : null; }
  if (hora.tipo === "mesmo_da_origem") return origin.time;
  if (hora.tipo === "origem_mais_minutos") {
    const minutes = Number(origin.time.slice(0, 2)) * 60 + Number(origin.time.slice(3, 5)) + hora.minutos;
    return minutes >= 0 && minutes < 1440 ? `${String(Math.floor(minutes / 60)).padStart(2, "0")}:${String(minutes % 60).padStart(2, "0")}` : null;
  }
  return null;
}
/** Resolves the plan's fields in dependency order (customer → appointment → day → professional → clock → "qualquer"), stopping at the first
 * one that needs the owner: that one question is asked and what depends on it waits unresolved. `answering`: the question this message answers
 * (an identity answer is first matched among that question's own options). */
async function resolveFields(ctx: Ctx, plan: PilotPlan, I: PilotInterpretation, answering?: PilotQuestion): Promise<Resolution> {
  const { state, reader, clock, reference } = ctx, F = plan.action.fields, notes: string[] = [];
  let pending = state.pending ?? { origem: EMPTY_ORIGIN, destino: EMPTY_DESTINATION };
  const out = Object.fromEntries(PILOT_FIELDS.map(name => [name, structuredClone(F[name])])) as Record<PilotFieldName, PilotField>;
  const wait = (...fields: PilotFieldName[]) => { for (const name of fields) out[name] = UNRESOLVED(out[name].mencao); };
  const ask = (field: PilotQuestionField, reason: PilotQuestionReason, text: string, options?: PilotOption[], appointment?: PilotAppointmentRow): Resolution =>
    ({ fields: out, question: { questionId: nextQuestionId(plan, floorOf(ctx)), field, reason, ...(options?.length ? { options: options.slice(0, PILOT_OPTIONS_MAX) } : {}) }, text, notes,
      ...(appointment ? { appointment } : {}) });
  const unavailable = (field: PilotQuestionField, what: string) => ask(field, "LOOKUP_UNAVAILABLE", `Não consegui consultar ${what} agora; nada foi alterado. Pode repetir em instantes?`);
  // 1. The customer: the mention of this message, else the one still unresolved; an identity answer first among its question's options. A mention
  // whose every token is in the record already bound (the same person said again, e.g. echoed from the plan) keeps that record.
  const mention = I.cliente.mencao ?? (F.customer.provenance === "unresolved" ? F.customer.mencao ?? null : null);
  const sameBound = !!I.cliente.mencao && F.customer.provenance !== "unresolved" && pilotMentionHolds(I.cliente.mencao, F.customer.display);
  if (mention && !sameBound && (I.cliente.mencao || F.customer.provenance === "unresolved")) {
    let identity: PilotIdentity | undefined;
    if (answering?.field === "customer" && answering.options?.length) {
      const among = pilotIdentityOf(answering.options.map(option => ({ id: option.id, name: option.label })), mention);
      if (among.state === "exact" || among.state === "partial") identity = among;
    }
    identity ??= await resolveCustomer(reader, mention);
    const name = identityName(identity);
    if (!name) { out.customer = UNRESOLVED(mention); wait("appointment", "date", "time", "professional", "service"); const q = customerQuestion(identity); return ask("customer", q.reason, q.text, q.options); }
    out.customer = { value: (identity as { id: string }).id, display: name, provenance: "explicit", mencao: mention };
  } else if (F.customer.provenance === "unresolved") {
    wait("appointment", "date", "time", "professional", "service"); const q = customerQuestion(undefined); return ask("customer", q.reason, q.text);
  }
  const customerId = out.customer.value!, customerName = out.customer.display ?? "";
  const customerChanged = customerId !== F.customer.value;
  // Review M4 (related): another customer than the one bound before: the origin hints said about the previous one leave with it.
  if (customerChanged && F.customer.value) {
    const origem = { ...EMPTY_ORIGIN };
    for (const key of Object.keys(EMPTY_ORIGIN) as (keyof PilotOrigin)[]) if (I.origem[key] !== null) (origem as Record<string, unknown>)[key] = structuredClone(I.origem[key]);
    pending = { origem, destino: pending.destino }; state.pending = pending; state.sources = hasOrigin(I.origem) ? [ctx.message] : [];
  }
  // 2. The appointment, located once. Review M4: one bound before stays bound while the customer and the origin hints stay; if it is no longer a
  // future PENDING/CONFIRMED appointment of the customer, the owner is asked (never another one located in silence).
  let row: PilotAppointmentRow | undefined;
  const label = (item: PilotAppointmentRow) => pilotAppointmentLabel(item, reference);
  const dependents = (count?: number) => count ? " Atendimentos de dependentes não são remarcados por aqui." : "";
  if (!customerChanged && !ctx.originChanged && F.appointment.value) {
    let rows: readonly PilotAppointmentRow[];
    try { rows = await reader.appointmentsOf(customerId, pilotNowLocal(clock)); } catch { wait("appointment", "date", "time", "professional", "service"); return unavailable("appointment", "a agenda"); }
    const now = pilotNowLocal(clock), future = rows.filter(item => (item.status === "PENDING" || item.status === "CONFIRMED") && item.startLocal.slice(0, 16) > now && !item.dependentName)
      .sort((a, b) => a.startLocal.localeCompare(b.startLocal));
    row = future.find(item => item.id === F.appointment.value);
    if (!row) {
      wait("appointment", "date", "time", "professional", "service");
      const options = future.map(item => ({ id: item.id, label: label(item) }));
      return ask("appointment", "APPOINTMENT_CHANGED", `O atendimento de ${F.appointment.display ?? "antes"} não está mais marcado como estava (foi alterado ou cancelado).${
        options.length ? ` Os próximos de ${customerName} são: ${listed(options.map(option => option.label))}. Qual deles?` : ` ${customerName} não tem outro atendimento futuro marcado.`}`, options);
    }
  } else {
    const located = await resolveAppointment(reader, { customerId, origem: pending.origem, message: (state.sources ?? []).join("\n") }, clock);
    if (located.state === "unavailable") { wait("appointment", "date", "time", "professional", "service"); return unavailable("appointment", "a agenda"); }
    if (located.state !== "one") {
      wait("appointment", "date", "time", "professional", "service");
      const rows = located.state === "none" ? located.upcoming : located.options, options = rows.map(item => ({ id: item.id, label: label(item) }));
      if (located.state === "several") return ask("appointment", "APPOINTMENT_SEVERAL", `${customerName} tem ${rows.length} atendimentos marcados: ${listed(options.map(option => option.label))}. Qual deles?${dependents(located.skippedDependents)}`, options);
      return ask("appointment", "APPOINTMENT_NONE", rows.length ? `Não encontrei atendimento de ${customerName} com essas indicações. Os próximos são: ${listed(options.map(option => option.label))}. Qual deles?${dependents(located.skippedDependents)}`
        : `${customerName} não tem atendimento futuro marcado; por aqui eu só remarco atendimentos que ainda vão acontecer.${dependents(located.skippedDependents)}`, options);
    }
    row = located.appointment;
  }
  if (row.id !== F.appointment.value) {
    // Review M5: another appointment than the one bound before: its day, clock and professional are read again from it (never kept stale).
    wait("date", "time", "professional");
    out.appointment = { value: row.id, display: label(row), provenance: "derived" };
  }
  if (out.appointment.provenance === "derived") notes.push(`Considerei o atendimento de ${formatLocal(row.startLocal, reference)}.`);
  out.service = { value: row.serviceId, display: row.serviceName, provenance: "inherited" };
  const origin = { date: row.startLocal.slice(0, 10), time: row.startLocal.slice(11, 16) }, current = { id: row.professionalId, name: row.professionalName };
  // 3. The new day (decision 27: a weekday read two ways is asked; decision 4: said on that very weekday, today too while the clock is ahead).
  const day = resolveTargetDate(pending.destino.dia, origin, clock, { time: knownClock(pending.destino.hora, origin) });
  if (day.state === "ask") { wait("date", "time"); return ask("date", "DATE_TWO_READINGS", `${quoted(day.mencao)} pode ser ${list(day.options.map(date => formatDay(date, reference)))}. Qual dia?`,
    day.options.map(date => ({ id: date, label: formatDay(date, reference) })), row); }
  if (day.state === "invalid") { wait("date", "time"); return ask("date", "DATE_INVALID", day.reason === "DATE_PAST" ? `${quoted(day.mencao)} já passou. Para qual dia?`
    : `${quoted(day.mencao)} não é uma data que exista. Para qual dia?`, undefined, row); }
  out.date = { value: day.date, display: formatDay(day.date, reference), provenance: day.provenance, ...(day.mencao ? { mencao: day.mencao } : {}) };
  if (day.provenance === "derived") notes.push(`Considerei ${formatDay(day.date, reference)} (${quoted(day.mencao ?? "")}).`);
  // 4. Who attends (a named one before the clock: decision 18 reads that professional's hours).
  const said = pending.destino.profissional, mode = said.modo ?? (said.mencao ? "nomeado" : null);
  if (!pending.destino.dia && !pending.destino.hora && (mode === null || mode === "manter")) {
    wait("date", "time");
    return ask("date", "DESTINATION_MISSING", `Para qual dia, horário ou profissional devo passar o atendimento de ${label(row)}?`, undefined, row);
  }
  const context = { current, appointmentId: row.id, serviceId: row.serviceId, durationMin: row.durationMin };
  const conflictQuestion = (who: Extract<Awaited<ReturnType<typeof resolveProfessional>>, { state: "conflict" }>) => {
    wait("professional", "time");
    return ask("professional", "PROFESSIONAL_CONTRADICTORY", who.mode === "manter" ? `Você pediu para manter ${current.name}, mas citou ${who.named.name}. Quem vai atender?`
      : `Você pediu quem estiver livre, mas citou ${who.named.name}. Quem vai atender?`, personOptions(who.mode === "manter" ? [current, who.named] : [who.named]), row);
  };
  if (mode === "nomeado" && said.mencao && F.professional.provenance === "explicit" && pilotMentionHolds(said.mencao, F.professional.display)) out.professional = structuredClone(F.professional);
  else if (mode !== "qualquer") {
    const who = await resolveProfessional(reader, said, { ...context, slot: null });
    if (who.state === "kept") out.professional = { value: who.id, display: who.name, provenance: "inherited" };
    else if (who.state === "exact" || who.state === "partial") out.professional = { value: who.id, display: who.name, provenance: "explicit", mencao: who.mencao };
    else if (who.state === "conflict") return conflictQuestion(who);
    else if ("mencao" in who) { wait("professional", "time"); const q = professionalQuestion(who); return ask("professional", q.reason, q.text, q.options, row); }
  }
  // 5. The new clock (decision 18 for a bare hour; decision 2: a new day without a clock is asked).
  const professionalId = mode === "qualquer" ? null : out.professional.value;
  const clockOf = await resolveTargetTime(reader, pending.destino.hora, { origin, date: day.date, professionalId });
  if (clockOf.state === "ask") {
    wait("time");
    if (clockOf.reason === "TWO_READINGS") return ask("time", "TIME_TWO_READINGS", `${quoted(clockOf.mencao ?? "")} pode ser ${list(clockOf.options.map(formatClock))} em ${formatDay(day.date, reference)}. Qual horário?`,
      clockOf.options.map(time => ({ id: time, label: formatClock(time) })), row);
    return ask("time", "TIME_MISSING", `Qual horário em ${formatDay(day.date, reference)}?`, undefined, row);
  }
  if (clockOf.state === "none") { wait("time"); return ask("time", "TIME_NO_READING", `${list(clockOf.readings.map(formatClock))} ficam fora do expediente${professionalId ? ` de ${out.professional.display}` : ""} em ${formatDay(day.date, reference)}. Qual horário?`, undefined, row); }
  out.time = { value: clockOf.time, display: formatClock(clockOf.time), provenance: clockOf.provenance, ...(clockOf.mencao ? { mencao: clockOf.mencao } : {}) };
  if (clockOf.provenance === "derived" && pending.destino.hora?.tipo === "relogio") {
    const other = pilotClockReadings(pending.destino.hora).filter(time => time !== clockOf.time);
    notes.push(`Considerei ${formatClock(clockOf.time)}: ${list(other.map(formatClock))} fica fora do expediente.`);
  } else if (clockOf.provenance === "derived") notes.push(`Considerei ${formatClock(clockOf.time)} (${quoted(clockOf.mencao ?? "")}).`);
  // 6. "qualquer" (decision 15): who performs the service and is free for its whole duration, the fewest appointments that day.
  if (mode === "qualquer") {
    const who = await resolveProfessional(reader, said, { ...context, slot: { date: day.date, time: clockOf.time } });
    if (who.state === "chosen") {
      out.professional = { value: who.id, display: who.name, provenance: "derived", ...(said.mencao ? { mencao: said.mencao } : {}) };
      notes.push(`Escolhi ${who.name}: faz o serviço, está livre nesse horário e tem menos atendimentos no dia.`);
    } else if (who.state === "conflict") return conflictQuestion(who);
    else if (who.state === "nobody_free") {
      wait("professional");
      return ask("time", "PROFESSIONAL_NOBODY_FREE", `Ninguém que faz ${row.serviceName} está livre em ${formatLocal(`${day.date}T${clockOf.time}`, reference)}. Qual outro horário?`, undefined, row);
    } else { wait("professional"); return unavailable("professional", "a equipe"); }
  }
  return { fields: out, appointment: row, notes };
}

// ---------------------------------------------------------------- proposal and Confirmar
/** The proposal of a fully resolved plan through host.prepare (a rule violated: no proposal, the question of another slot, resolved fields kept).
 * `options.floor`: the session's question floor; `options.today`: the year the texts use; `options.appointment`: the appointment's label. */
export async function preparePilotProposal(host: PilotHost, plan: PilotPlan, notes: readonly string[] = [], options: { floor?: number; today?: string; appointment?: string } = {}):
  Promise<{ plan: PilotPlan; text?: string; code?: string }> {
  const f = plan.action.fields;
  if (PILOT_FIELDS.some(name => f[name].provenance === "unresolved") || openQuestions(plan).length) return { plan };
  const change: PilotResolvedChange = { appointmentRef: f.appointment.value!, customerRef: f.customer.value!, date: f.date.value!, time: f.time.value!,
    professionalRef: f.professional.value!, serviceRef: f.service.value!, derived: PILOT_FIELDS.filter(name => f[name].provenance === "derived"),
    keepsProfessional: f.professional.provenance === "inherited", notes: [...notes], ...(options.today ? { today: options.today } : {}) };
  const prepared = await host.prepare(change);
  if (prepared.ok) {
    const attached = attachProposal(plan, { ...prepared.proposal, revision: plan.revision });
    return attached.ok ? { plan: attached.plan } : { plan, text: PILOT_PREPARATION_FAILED, code: "PREPARATION_FAILED" };
  }
  if (prepared.code === "PREPARATION_FAILED") return { plan, text: prepared.text, code: "PREPARATION_FAILED" };
  if (prepared.code === "RELATION_NOT_SUPPORTED") {
    // Review M11: another appointment is asked; this one, its day, clock and professional leave the plan.
    const draft: PilotQuestionDraft = { questionId: nextQuestionId(plan, options.floor), field: "appointment", reason: "APPOINTMENT_NOT_SUPPORTED" };
    const reduced = applyIntent(plan, { fields: { appointment: UNRESOLVED(), date: UNRESOLVED(), time: UNRESOLVED(), professional: UNRESOLVED(), service: UNRESOLVED() }, questions: [draft] }, plan.revision);
    return { plan: reduced.ok ? reduced.plan : plan, text: prepared.text, code: "ASKED_APPOINTMENT_NOT_SUPPORTED" };
  }
  // Review L10: the agenda's own reason; no change at all is the destination asked again.
  const draft: PilotQuestionDraft = prepared.code === "NO_CHANGE" ? { questionId: nextQuestionId(plan, options.floor), field: "date", reason: "DESTINATION_MISSING" }
    : { questionId: nextQuestionId(plan, options.floor), field: prepared.code === "SERVICE_NOT_PERFORMED" ? "professional" : "time",
      reason: prepared.code === "OUTSIDE_HOURS" ? "OUTSIDE_HOURS" : "SLOT_UNAVAILABLE",
      ...(prepared.alternatives?.length ? { options: prepared.alternatives.slice(0, PILOT_OPTIONS_MAX).map(time => ({ id: time, label: formatClock(time) })) } : {}) };
  const text = prepared.code === "NO_CHANGE" ? `Esse já é o horário do atendimento${options.appointment ? ` (${options.appointment})` : ""}. Para qual dia, horário ou profissional devo passar?` : prepared.text;
  const reduced = applyIntent(plan, prepared.code === "NO_CHANGE" ? { fields: { date: UNRESOLVED(), time: UNRESOLVED() }, questions: [draft] } : { fields: {}, questions: [draft] }, plan.revision);
  return { plan: reduced.ok ? reduced.plan : plan, text, code: `ASKED_${draft.reason}` };
}
/** The owner's Confirmar: the receipt of the proposal_ref first, then the revision, expiry and the real confirmation; after a failure, the receipt
 * again (review M2: a failure after the commit is a write, never "nothing written"). */
export async function confirmPilotProposal(host: PilotHost, approval: PilotApproval): Promise<PilotReply> {
  const state = host.state, plan = state.plan;
  if (!plan) throw Error("PLAN_NOT_IN_SESSION");
  const clock = await host.clock(), reference = pilotToday(clock);
  const doneText = (receipt: PilotReceipt) => {
    const f = state.plan!.action.fields;
    return [`Remarcação gravada: ${f.customer.display ?? ""} — ${f.service.display ?? ""} com ${f.professional.display ?? ""}, ${formatLocal(`${f.date.value}T${f.time.value}`, reference)}.`,
      PILOT_CUSTOMER_NOTICE, ...(receipt.outcome === "PENDING_ACCEPTANCE" ? ["O novo horário fica aguardando o aceite do cliente."] : [])].join("\n");
  };
  const reply = (text: string, code: string): PilotReply => ({ text, view: pilotView(state), code, telemetry: pilotTelemetry(state, { proposal_confirmed: approval.proposalRef || null }) });
  const settled = async (found: PilotReceipt, code: string) => {
    await host.settle(found);
    const current = state.plan!, approved = approve(current, approval);
    state.plan = completeExecution(approved.ok ? startExecution(approved.plan) : current.action.approval ? current : { ...current, action: { ...current.action, status: "approved", approval } });
    state.asked = [];
    return reply(doneText(found), code);
  };
  // §5: a Confirmar repeated after its reply was lost finds the journal receipt of its proposal_ref before any expiry or failure rule. Review L2:
  // only the receipt of the plan's OWN proposal settles the plan; another one is reported and the plan is left as it was.
  const found = approval.proposalRef ? await host.receipt(approval.proposalRef) : undefined;
  if (found) {
    if (plan.action.proposal?.proposalRef === found.proposalRef) return settled(found, "CONFIRMED_BY_RECEIPT");
    return reply(joined("Essa confirmação já tinha sido gravada antes; nada mais foi alterado.", pilotStateText(state)), "RECEIPT_OTHER_PROPOSAL");
  }
  const approved = approve(plan, approval);
  if (!approved.ok) throw Error(approved.code === "PLAN_CLOSED" && plan.action.status === "done" ? "ALREADY_CONFIRMED" : "CONFIRMATION_STALE");
  state.plan = startExecution(approved.plan);
  try {
    const receipt = await host.confirm(approval);
    state.plan = completeExecution(state.plan);
    state.asked = [];
    return reply(doneText(receipt), "CONFIRMED");
  } catch (error) {
    const late = await host.receipt(approval.proposalRef).catch(() => undefined);
    if (late && late.proposalRef === approval.proposalRef) return settled(late, "CONFIRMED_AFTER_FAILURE");
    const expired = error instanceof Error && error.message === "PROPOSAL_EXPIRED";
    state.plan = invalidate(state.plan, expired ? "PROPOSAL_EXPIRED" : "CONFIRM_FAILED");
    // Checked again through the real agenda: a fresh proposal (a new Confirmar) or the question of another slot; nothing was written.
    const again = await preparePilotProposal(host, state.plan, state.notes ?? [], { floor: state.questionFloor, today: reference, appointment: state.plan.action.fields.appointment.display ?? "" });
    state.plan = again.plan;
    if (again.text) state.asked = openQuestions(again.plan).map(question => ({ questionId: question.questionId, text: again.text! }));
    const now = again.plan.action.status === "proposal_ready" ? again.plan.action.proposal!.text : again.text ?? PILOT_PREPARATION_FAILED;
    return reply(`${expired ? PILOT_PROPOSAL_EXPIRED : PILOT_CONFIRM_FAILED}\n\n${now}`, expired ? "CONFIRM_EXPIRED" : "CONFIRM_FAILED");
  }
}
