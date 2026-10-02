import { randomUUID } from "node:crypto";
import { performance } from "node:perf_hooks";
import { z } from "zod";
import type { Model } from "@everflair/salon-secretary";
import type { ServiceActor } from "./service-catalog";
import { applyAnswer, applyIntent, approve, attachProposal, completeExecution, createPilotPlan, invalidate, lastQuestionNumber, nextQuestionId, openQuestions,
  pilotPlanClosed, startExecution, withdraw, PILOT_FIELDS, PILOT_OPTIONS_MAX, type PilotApproval, type PilotField, type PilotFieldName, type PilotOption,
  type PilotPlan, type PilotProposal, type PilotQuestion, type PilotQuestionDraft, type PilotQuestionField, type PilotQuestionReason, type PilotReduction,
  type PilotStatus } from "./secretary-pilot-plan";
import { pilotCitedDays, pilotClockReadings, pilotClockShiftReadings, pilotDataReadings, pilotDayShiftReadings, pilotExclusionMentions, pilotIdentityOf, pilotMentionIn, pilotNowLocal,
  pilotServicesOf, pilotToday, pilotWeekdayNumber, resolveAppointment, resolveClockDay, resolveCustomer, resolveProfessional, resolveTargetDate, resolveTargetTime, type PilotAppointmentRow,
  type PilotClock, type PilotDateResolution, type PilotDayShiftReading, type PilotHint, type PilotIdentity, type PilotPerson, type PilotProfessionalSaid, type PilotReader,
  type PilotServiceRow } from "./secretary-pilot-resolver";
import { PILOT_CONTRACT_LIMITS, type PilotDayAnchor, type PilotDestination, type PilotInterpretation, type PilotOrigin, type PilotTempoDia, type PilotTempoHora,
  type PilotTimeAnchor } from "../../packages/salon-secretary/src/pilot-reschedule-contract";
import { pilotCatalogNames, runPilotInterpretation, PILOT_CALL_LIMITS, PILOT_OPEN_LABELS, type PilotOpenContext, type PilotRequestContext } from "../../packages/salon-secretary/src/pilot-reschedule-prompt";
import { formatClock, formatDay, formatLocal, formatLocalRange } from "./secretary-datetime-format";
import { nameTokens } from "./name-search";
import { addCalendarDays, weekdayOfDateKey } from "./time";

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
/** §11.4: the request with the whole context (every service and team name, the open plan, the message) does not fit what one call may carry, or the
 * salon's team or catalog is past the reader's bound: nothing is cut in silence and nothing is interpreted; said as a matter of size. */
export const PILOT_TOO_LARGE_REPLY = "Esta mensagem, junto com os serviços e a equipe do salão, passou do tamanho que consigo ler com segurança; nada foi alterado. Tente uma mensagem mais curta; se continuar, o catálogo ou a equipe do salão é grande demais para este caminho.";
/** §11.4: the reader's refusals of a team or catalog past its bound (codes of the safe failure, PILOT_TOO_LARGE_REPLY). */
const PILOT_DIRECTORY_TOO_LARGE: ReadonlySet<string> = new Set(["PILOT_TEAM_TOO_LARGE", "PILOT_CATALOG_TOO_LARGE"]);
/** An identity question answered without a name (review M12): a yes is never inferred; the name, or a tap on the option, is asked. */
export const PILOT_NAME_REQUIRED = "Para eu ter certeza, escreva o nome como está no cadastro ou toque na opção.";
/** §11.10: an answer to a question whose options are every choice there is (the readings of a day, the members tied) that does not name exactly one of
 * them: asked again, nothing changes (never an option picked for the owner). */
export const PILOT_OPTION_REQUIRED = "Para eu ter certeza, aponte uma das opções (pelo dia, pelo horário ou pelo nome) ou toque nela; nada foi alterado.";
/** §11.10: an answer to the question of who must NOT attend that does not say who (a name given as who attends included): asked again, nothing changes;
 * it never becomes who attends. */
export const PILOT_EXCLUSION_REQUIRED = "Para eu ter certeza, escreva como está no cadastro o nome de quem não deve atender; nada foi alterado.";
/** The open draft, when nothing in it is asked or ready (review L8: never an empty reply). */
export const PILOT_OPEN_DRAFT = "O pedido de remarcação segue em aberto e nada foi gravado. Diga o que deseja mudar.";
/** Review E1: the plan's own proposal turned out to be written already (a reply or a save lost after the commit): said, never "nada foi alterado". */
export const PILOT_ALREADY_WRITTEN_NOTE = "Essa remarcação já estava gravada antes desta mensagem; nada mais foi alterado. Para mudar de novo, mande o pedido de novo.";
/** Review E1: the journal could not be read, so whether the proposal was written is unknown: nothing is withdrawn or prepared again. */
export const PILOT_RECEIPT_UNVERIFIED = "Não consegui conferir agora se a remarcação proposta já foi gravada; nada mais foi alterado. Pode repetir em instantes?";
/** Review E1: the Confirmar failed and its receipt could not be read: the proposal stays as it was (a new Confirmar looks for the receipt first). */
export const PILOT_CONFIRM_UNVERIFIED = "Não consegui conferir se a remarcação foi gravada. Nada foi refeito; toque em Confirmar de novo para conferir.";
/** Review E1: the agenda says this change's draft was already confirmed (an earlier proposal of this conversation): this change is not made. */
export const PILOT_ALREADY_WRITTEN = "A remarcação deste atendimento proposta antes nesta conversa já estava gravada; esta nova mudança não foi feita e nada mais foi alterado. Se ainda quiser mudar, mande o pedido de novo.";
/** Review E3: a repeated clientTurnId whose stored reply no longer matches the plan (a later message changed it): the current state, never the old text. */
export const PILOT_REPLAY_SUPERSEDED = "Essa mensagem já tinha sido atendida e o pedido mudou depois dela; nada foi feito de novo. Como está agora:";
/** The plan is done (a replayed reply after the Confirmar). */
export const PILOT_DONE_STATE = "Essa remarcação já foi gravada.";
/** E2-A: a conversation saved under the E1 contract (its pending operators can no longer be read) whose plan was still open: the plan is withdrawn
 * on the next message or tap (after its receipt), nothing on the agenda changes and the owner is asked to send the request again. */
export const PILOT_STATE_RESET = "A Secretária foi atualizada e o pedido de remarcação que estava em aberto foi encerrado; nada foi alterado na agenda. Mande o pedido de novo, por favor.";
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
 * a later turn's operator replaces the one of its own slot. `replies`: the stored reply of each clientTurnId. `outOfScope`: the parts of the open
 * request the pilot does not do, until the owner answers the scope question. `asked`: the text of each open question (what a stale answer repeats).
 * `turn`: the latest turn. `questionFloor`: the largest question number of the session's earlier plans (ids never restart). `actionPlanRef`/
 * `actionPlanFor`/`published`: the ActionPlan (SalonSecretary) this plan publishes through, the plan it was made for and the plan revision it
 * last showed. `reset` (E2-A): set by the loader when it dropped E1-contract pending operators (secretary-session-state.ts); the next message
 * or tap withdraws the plan if it is still open (PILOT_STATE_RESET). */
export type PilotSessionState = { plan?: PilotPlan; pending?: PilotPending;
  replies: { clientTurnId: string; turnId: string; message: string; view: PilotView }[];
  outOfScope?: string[]; asked?: { questionId: string; text: string }[]; notes?: string[];
  turn?: { turnId: string; clientTurnId: string | null; receivedAt: string }; questionFloor?: number;
  actionPlanRef?: string; actionPlanFor?: string; published?: number; reset?: true };
/** Luna's typed operators of the open action not resolved yet. Review P1: `proven`, whether each origin hint's mention was in the very message that
 * brought it (proved once, on arrival: the narrow provenance check never reads another turn's words). Review S2: `anchors`, the received_at (ISO)
 * of the turn that said the origin day and the destination day (their "today": a later turn never reads them against its own day). E2-B §11.1:
 * `anchors.hora`, the received_at of the turn that said the destination clock (the anchor "agora" of a clock offset is that turn's now). §11.3
 * (PRINCIPLE-1) as amended by §11.4: `clockDay`, the destination day is the one a clock offset counted from now settled (no day said): it stays when
 * the clock changes later (a clock, the appointment's own, one to define, an offset from the appointment's clock); only a new clock counted from now
 * says its own day again. §11.4: `clockAfterDay`, the destination clock was said in a later message than the destination day (a clock counted from
 * now that lands on another day then makes the earlier day incompatible: asked, DATE_CLOCK_CONFLICT). Round 2 (§11.10): `exclusion`, the owner's words of
 * the exclusion the open EXCLUSION question clarifies, bound to that question's id (its own state: the question that chooses who attends keeps its
 * options); only that question's answer reads it, and only to replace those words. §11.11: `held`, the exclusions said earlier in this plan that the
 * pending professional value does not carry itself (a who-attends option bound or named, "outro" kept beside words "qualquer" gives a role of their own,
 * words of "outro" said in another turn): a later delegation applies them, so none is ever erased. `choices`, every choice of the open question that
 * chooses who attends when its options were cut at PILOT_OPTIONS_MAX (bound to that question's id): an answer binds against all of them. */
export type PilotPending = { origem: PilotOrigin; destino: PilotPendingDestination; proven?: Partial<Record<keyof PilotOrigin, boolean>>;
  anchors?: { origem?: string; destino?: string; hora?: string }; clockDay?: true; clockAfterDay?: true; exclusion?: { questionId: string; mencao: string };
  held?: PilotHeldExclusions; choices?: { questionId: string; options: PilotOption[] } };
/** §11.11: exclusions held aside, each with its role: `excluidos`, names given as who must not attend (typed: asked when they name no member); `words`,
 * the words beside "outro" (an exclusion when they name a member, the mode's own words when they name none: M9); `outro`, the current professional. */
export type PilotHeldExclusions = { outro?: true; excluidos?: string[]; words?: string[] };
/** §11.4: the pending destination; its professional may come from a state saved before the exclusion list (upgraded on load; the type admits no
 * `excluidos`, read as none). */
export type PilotPendingDestination = Omit<PilotDestination, "profissional"> & { profissional: PilotProfessionalSaid };
/** The resolved change the real agenda preparation receives: refs and the local day and clock (the appointment is never located again).
 * `keepsProfessional`: the professional is the appointment's own (no new professional is sent); `notes`: the derived assumptions it shows;
 * `today`: the salon's local day of received_at (the year the texts are written against). */
export type PilotResolvedChange = { appointmentRef: string; customerRef: string; date: string; time: string; professionalRef: string; serviceRef: string;
  derived: PilotFieldName[]; keepsProfessional: boolean; notes: string[]; today?: string };
export type PilotReceipt = { proposalRef: string; appointmentRef: string; outcome: "RESCHEDULED" | "PENDING_ACCEPTANCE"; duplicate: boolean };
/** Review E1: ALREADY_WRITTEN, the change's draft was confirmed already (an earlier proposal of this plan, written behind the session), with that
 * write's receipt when the journal gave it. */
export type PilotPreparation = { ok: true; proposal: PilotProposal }
  | { ok: false; code: "SLOT_UNAVAILABLE" | "OUTSIDE_HOURS" | "SERVICE_NOT_PERFORMED" | "NO_CHANGE" | "RELATION_NOT_SUPPORTED" | "PREPARATION_FAILED"; text: string; alternatives?: string[] }
  | { ok: false; code: "ALREADY_WRITTEN"; text: string; receipt?: PilotReceipt };
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
  /** Whether the ready proposal lost its validity in the agenda (consulted only after its receipt, review E1). Absent: never expires here. */
  expired?(): boolean;
}
/** `code`: the turn's outcome (telemetry, codes only); `telemetry`: codes and numbers of the turn; `expiry`: the plan's telemetry at the moment a
 * proposal that lost its validity was dropped by this turn (codes only). */
export type PilotReply = { text: string; view: PilotView; code?: string; telemetry?: Record<string, unknown>; expiry?: Record<string, unknown> };

// ---------------------------------------------------------------- presentation (pt-BR, neutral about the customer's gender)
const list = (items: readonly string[]) => items.length < 2 ? items.join("") : `${items.slice(0, -1).join(", ")} e ${items.at(-1)}`;
/** Review M3: what a question lists is bounded; the rest is counted ("e mais N"), never written out. */
const SHOWN_OPTIONS = 8;
const listed = (items: readonly string[], separator = "; ") => items.length <= SHOWN_OPTIONS ? items.join(separator)
  : `${items.slice(0, SHOWN_OPTIONS).join(separator)}${separator}e mais ${items.length - SHOWN_OPTIONS}`;
const quoted = (text: string) => `“${text}”`;
const brl = (cents: number) => (cents / 100).toLocaleString("pt-BR", { style: "currency", currency: "BRL" });
const minutesBetween = (start: string, end: string) => Math.round((Date.parse(`${end.slice(0, 16)}:00Z`) - Date.parse(`${start.slice(0, 16)}:00Z`)) / 60_000);
/** Review S9: what a label or a question carries of a record's name is bounded (UTF-16 units, as the saved bounds count): the rest becomes "…", so
 * a state with a long catalog or team name is always saved. */
export const PILOT_TEXT_BOUNDS = Object.freeze({ name: 120, service: 160, asked: 4000 });
export const pilotClip = (text: string, max: number) => {
  if (text.length <= max) return text;
  let out = "";
  for (const point of text) { if (out.length + point.length > max - 1) break; out += point; }
  return `${out}…`;
};
const person = (name: string) => pilotClip(name, PILOT_TEXT_BOUNDS.name);
/** One appointment as the owner reads it (no customer name: it is always the customer's own). `reference`: the year of received_at. */
export const pilotAppointmentLabel = (row: Pick<PilotAppointmentRow, "startLocal" | "serviceName" | "professionalName">, reference?: string) =>
  `${formatLocal(row.startLocal, reference)} — ${pilotClip(row.serviceName, PILOT_TEXT_BOUNDS.service)} com ${person(row.professionalName)}`;
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
/** §11.11 (R2-RUNNER-1): the field a question publishes is a fact of its role: the question that clarifies who must NOT attend publishes its own code, never
 * the one of the questions that choose who attends (no answer meant for one can be delivered to the other). */
export const PILOT_EXCLUSION_MISSING_FIELD = "excluded_professional";
export const pilotMissingField = (question: Pick<PilotQuestion, "field" | "reason">) =>
  question.reason === "EXCLUSION_NOT_FOUND" || question.reason === "EXCLUSION_CONTRADICTORY" ? PILOT_EXCLUSION_MISSING_FIELD : PILOT_MISSING_FIELDS[question.field];
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
/** Review L1 (§4): a repeated clientTurnId gets its stored reply exactly as recorded (text and view), marked replayed. Review E3: only while the
 * plan is still the one that reply showed (same plan, revision and status), so the reply is never paired with the controls of a later proposal;
 * otherwise the current state (its text and view) under PILOT_REPLAY_SUPERSEDED, marked replayed and `superseded`. Nothing is done again. */
export function pilotReplay(state: PilotSessionState, clientTurnId: string | undefined): { text: string; view: PilotView; superseded?: true } | undefined {
  const stored = clientTurnId ? state.replies.find(reply => reply.clientTurnId === clientTurnId) : undefined;
  if (!stored) return undefined;
  const live = pilotView(state), turn = turnOf(stored.view.turn, true);
  if (live.planId === stored.view.planId && live.revision === stored.view.revision && live.status === stored.view.status) return { text: stored.message, view: { ...structuredClone(stored.view), turn } };
  const plan = state.plan, now = !plan ? "" : plan.action.status === "done" ? PILOT_DONE_STATE : plan.action.status === "withdrawn" ? PILOT_WITHDRAWN_REPLY : pilotStateText(state) || PILOT_OPEN_DRAFT;
  return { text: joined(PILOT_REPLAY_SUPERSEDED, now), view: { ...live, turn }, superseded: true };
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
/** `catalog`: the salon's services read for the turn's request (a tap reads none: the resolver reads them when a service hint needs them). */
type Ctx = { host: PilotHost; state: PilotSessionState; reader: PilotReader; clock: PilotClock; message: string; catalog?: readonly PilotServiceRow[]; baseRevision: number; reference: string;
  /** Review M4/P2: this message brought an origin hint, proved in it, whose typed value differs from the pending one (only then is a bound
   * appointment located again; other words for the same value, or a hint absent from the message, never unbind it). */
  originChanged?: boolean;
  /** Review P3/P6: the scope question was opened by this message (its out-of-scope part is then said by that question). */
  scopeAsked?: boolean;
  /** §11.3 (PRINCIPLE-2): this message (a text answer or a tap) answers the day question of a clock offset counted from two anchors: the day the owner
   * picks settles which anchor(s) the clock counts from (those whose own day it is), never a clock no anchor gives on that day. */
  clockDayAnswer?: boolean;
  /** §11.4: this message (a text answer or a tap) answers the DATE_CLOCK_CONFLICT question: now's own day keeps the clock counted from now; the day
   * said before keeps the clock's other anchors (a fact of the question, never of the owner's words). */
  conflictAnswer?: boolean };
type Outcome = { text: string; code: string };
/** What the resolution of the open plan's fields gives: every field (resolved or not), at most one question with its text, the appointment row
 * and the notes of the derived values. */
type Resolution = { fields: Record<PilotFieldName, PilotField>; question?: PilotQuestionDraft; text?: string; appointment?: PilotAppointmentRow; notes: string[] };
const UNRESOLVED = (mencao?: string): PilotField => ({ value: null, display: null, provenance: "unresolved", ...(mencao ? { mencao } : {}) });
const EMPTY_ORIGIN: PilotOrigin = { dia: null, hora: null, profissional_mencao: null, servico: null, posicao: null };
const EMPTY_DESTINATION: PilotDestination = { dia: null, hora: null, profissional: { modo: null, mencao: null, excluidos: [] } };
/** The pending flags carried when the pending operators are rebuilt (PRINCIPLE-1's clockDay; §11.4's clockAfterDay; §11.11: the exclusions held aside,
 * never dropped with the origin hints). */
const pendingFlags = (pending: PilotPending) => ({ ...(pending.clockDay ? { clockDay: true as const } : {}), ...(pending.clockAfterDay ? { clockAfterDay: true as const } : {}),
  ...(pending.held ? { held: structuredClone(pending.held) } : {}) });
/** An interpretation that says nothing (the base of an owner's tap on an option). */
const SILENT: PilotInterpretation = { tipo: "resposta", resposta_a: null, desistir: false, aceita_parcial: null, cliente: { mencao: null }, origem: EMPTY_ORIGIN,
  destino: EMPTY_DESTINATION, observacoes: [], fora_do_escopo: [] };
const ORIGIN_KEYS = Object.keys(EMPTY_ORIGIN) as (keyof PilotOrigin)[];
/** The resolver's hint of each origin slot. */
const HINT_OF: Record<keyof PilotOrigin, PilotHint> = { dia: "dia", hora: "hora", profissional_mencao: "profissional", servico: "servico", posicao: "posicao" };
/** The owner's words Luna copied for an origin hint. */
const originMention = (key: keyof PilotOrigin, value: PilotOrigin[keyof PilotOrigin]) => value === null ? null : typeof value === "string" ? value : value.mencao;
/** An operator's typed value (every `mencao` aside, a cited date's included; the anchors as a set): other words for the same value are the same operator. */
const typed = (operator: unknown) => JSON.stringify(operator ?? null, (key, value) => key === "mencao" ? undefined : key === "ancoras" && Array.isArray(value) ? [...value].sort() : value);
/** Whether two name mentions are the same words once normalized (the resolver's own folding of mentions; never the owner's grammar). */
const sameNameWords = (a: string | null, b: string | null) => {
  const x = [...new Set(nameTokens(a ?? ""))].sort(), y = [...new Set(nameTokens(b ?? ""))].sort();
  return x.length === y.length && x.every((token, index) => token === y[index]);
};
const professionalMode = (said: PilotProfessionalSaid) => said.modo ?? (said.mencao ? "nomeado" : "manter");
/** §11.4: an exclusion list as a set of normalized names (the resolver's own folding of mentions; other words for the same names are the same list). */
const exclusionKey = (list: readonly string[] | undefined) => [...new Set((list ?? []).map(item => [...new Set(nameTokens(item))].sort().join(" ")))].sort().join("|");
/** §11.2: the modes where the owner delegates who attends (the code applies decision 15). */
const delegatedMode = (mode: string | null) => mode === "qualquer" || mode === "outro";
/** §11.10: the question that clarifies who must NOT attend (its own reasons; never a question that chooses who attends). */
const EXCLUSION_REASONS: ReadonlySet<string> = new Set<PilotQuestionReason>(["EXCLUSION_NOT_FOUND", "EXCLUSION_CONTRADICTORY"]);
/** §11.10: the date questions whose options are every day the owner may mean (an answer binds only by naming exactly one of them). */
const DAY_CHOICE_REASONS: ReadonlySet<string> = new Set<PilotQuestionReason>(["DATE_TWO_READINGS", "ANCHOR_TWO_READINGS", "DATE_CLOCK_CONFLICT"]);
/** §11.10: names said again are the same name (the resolver's own folding of mentions): a list where each name appears once, in the order first said. */
const unionNames = (...lists: readonly (readonly string[])[]) => lists.flat().reduce<string[]>((out, name) => out.some(other => sameNameWords(other, name)) ? out : [...out, name], []);
/** §11.11: everything a professional value and the exclusions held aside leave out, each with its role: `typed` (excluidos: asked when they name no
 * member), `words` (beside "outro": the mode's own words when they name nobody, M9), `current` ("outro": the current professional). Only a delegated value
 * applies them; under another value they are only kept (a later delegation applies them again). */
type PilotExclusions = { typed: string[]; words: string[]; current: boolean };
function exclusionsOf(value: PilotProfessionalSaid, held: PilotHeldExclusions | undefined): PilotExclusions {
  return { typed: unionNames(held?.excluidos ?? [], delegatedMode(value.modo) && Array.isArray(value.excluidos) ? value.excluidos : []),
    words: unionNames(held?.words ?? [], value.modo === "outro" && value.mencao ? [value.mencao] : []), current: !!held?.outro || value.modo === "outro" };
}
const heldOf = (kept: PilotExclusions): PilotHeldExclusions | undefined => kept.typed.length || kept.words.length || kept.current
  ? { ...(kept.current ? { outro: true as const } : {}), ...(kept.typed.length ? { excluidos: kept.typed } : {}), ...(kept.words.length ? { words: kept.words } : {}) } : undefined;
/** The pending professional value and the exclusions held aside. */
type PilotProfessionalState = { value: PilotProfessionalSaid; held?: PilotHeldExclusions };
/** §11.11: a delegation that keeps every exclusion said before (`all`), the new names (`added`), whether the current professional is out (`current`) and the
 * words beside "qualquer" (`asked`, M9: who might attend, asked when they name a member) or beside "outro" (`own`). "outro" is the mode while no words of
 * "qualquer" need their role; with them, the mode stays "qualquer" and "outro" is held aside (the current professional still out). More exclusions than
 * the contract carries is a safe failure of the turn (never one dropped). */
function delegation(all: PilotExclusions, added: readonly string[], current: boolean, asked: string | null, own: string | null): PilotProfessionalState {
  const excluidos = unionNames(all.typed, added), outro = current && !asked, mencao = outro ? own : asked;
  const words = all.words.filter(word => !(outro && mencao && sameNameWords(word, mencao)));
  if (excluidos.length > PILOT_CONTRACT_LIMITS.exclusions || words.length > PILOT_CONTRACT_LIMITS.exclusions) throw Error("PILOT_EXCLUSIONS_FULL");
  return { value: { modo: outro ? "outro" : "qualquer", mencao, excluidos }, held: heldOf({ typed: [], words, current: current && !outro }) };
}
/** §11.10 as completed by §11.11 (an answer or a correction never erases an exclusion): a delegated value said over the pending one keeps every exclusion
 * said before in this plan, whatever the pending value is (the list grows, never shrinks), and "outro" (itself an exclusion: the current professional's);
 * a value that is not delegated (who attends said, or keep the current one) becomes the value, as the owner said it, and every earlier exclusion is held
 * aside for a later delegation. Each mention keeps its role: names typed as excluded stay typed; words beside "outro" stay its words (never turned into a
 * name that is asked); words beside "qualquer" (M9) stay until the owner says the mode again with others. Typed values only. */
function mergedProfessional(before: PilotProfessionalSaid, said: PilotProfessionalSaid, held: PilotHeldExclusions | undefined): PilotProfessionalState {
  const all = exclusionsOf(before, held);
  if (!delegatedMode(said.modo)) return { value: structuredClone(said), held: heldOf(all) };
  const asked = said.modo === "qualquer" ? said.mencao ?? (before.modo === "qualquer" ? before.mencao : null) : null;
  const own = said.modo === "outro" && said.mencao ? said.mencao : before.modo === "outro" ? before.mencao : null;
  return delegation(all, said.excluidos ?? [], said.modo === "outro" || all.current, asked, own);
}
/** Review S2: a day or clock operator is read against the received_at of the turn that said it (`at`), else this turn's. */
const anchoredAt = (at: string | undefined, clock: PilotClock): PilotClock => at && Number.isFinite(Date.parse(at)) ? { receivedAt: new Date(at), timezone: clock.timezone } : clock;
/** §11.10 (R1-TEMPORAL-5): whether a day operator's readings depend on the day of the turn that says it (today, or a reference read from today), so the
 * same operator said in a later turn on another local day reads other days. A fact of the typed operator. */
const countsFromToday = (dia: PilotTempoDia) => dia.tipo === "data" || dia.tipo === "dia_semana" || dia.tipo === "mes_relativo"
  || (dia.tipo === "deslocamento" && (dia.ancoras.includes("hoje") || dia.ancoras.includes("data_citada")));
/** §11.10 (R1-TEMPORAL-5): the same typed day or clock said again in this turn reads otherwise when it counts from today (another local day since the turn
 * that said it) or from now (another local minute): it is a change, read from this turn (never the earlier turn's reading kept in silence). */
const rereadsDay = (ctx: Ctx, dia: PilotTempoDia, pending: PilotPending) => countsFromToday(dia) && pilotToday(ctx.clock) !== pilotToday(anchoredAt(pending.anchors?.destino, ctx.clock));
const rereadsClock = (ctx: Ctx, hora: PilotTempoHora, pending: PilotPending) => hora.tipo === "deslocamento" && hora.ancoras.includes("agora")
  && pilotNowLocal(ctx.clock) !== pilotNowLocal(anchoredAt(pending.anchors?.hora, ctx.clock));
const floorOf = (ctx: Ctx) => ctx.state.questionFloor ?? 0;
const turnAt = (ctx: Ctx) => ctx.clock.receivedAt.toISOString();
/** Review P3/P6: an out-of-scope part the message named and no question of this turn asked about is said, never dropped in silence. */
const outOfScopeNotice = (parts: readonly string[]) => `Uma parte do pedido eu ainda não faço por aqui (${listed(parts.map(quoted))}): ela ficou de fora e nada foi feito.`;

/** One owner message on the pilot path (a repeated clientTurnId returns the stored reply). */
export async function handlePilotMessage(host: PilotHost, input: PilotTurnInput): Promise<PilotReply> {
  const state = host.state, replay = pilotReplay(state, input.clientTurnId);
  if (replay) return { text: replay.text, view: replay.view, code: replay.superseded ? "REPLAYED_SUPERSEDED" : "REPLAYED" };
  const startedAt = performance.now(), clock = await host.clock(), reader = host.reader();
  const turn = { turnId: randomUUID(), clientTurnId: input.clientTurnId ?? null, receivedAt: clock.receivedAt.toISOString() };
  const today = pilotToday(clock);
  let interpreted: Awaited<ReturnType<typeof runPilotInterpretation>> | undefined, outcome: Outcome | undefined, expiry: Record<string, unknown> | undefined;
  // Review E1: the receipt of the plan's own proposal first (a Confirmar whose reply or save was lost after the commit): a write already made is
  // reported and settled, never withdrawn, prepared again nor called "nada foi alterado"; an unreadable journal changes nothing.
  const receipted = await pilotReceiptFirst(host);
  if (receipted?.state === "settled") outcome = { text: joined(pilotDoneText(state, receipted.receipt, today), PILOT_ALREADY_WRITTEN_NOTE), code: "CONFIRMED_BY_RECEIPT" };
  else if (receipted?.state === "unverified") outcome = { text: PILOT_RECEIPT_UNVERIFIED, code: "RECEIPT_UNVERIFIED" };
  // E2-A: a plan saved under the E1 contract, still open, is withdrawn here (after its receipt), never resolved again without its operators.
  else if (state.reset) outcome = pilotLegacyReset(state);
  if (!outcome && state.plan?.action.status === "proposal_ready" && host.expired?.()) {
    // Only then the expiry rule: a ready proposal that lost its validity is no longer the plan's (prepared again when the turn shows the plan).
    state.plan = invalidate(state.plan, "PROPOSAL_EXPIRED");
    expiry = pilotTelemetry(state);
  }
  // Review S8: the revision the turn started on (after the backend's own expiry) belongs to the plan it started on: a turn that opens a new plan
  // is recorded on it from 0, never from the closed plan's revision.
  const baseRevision = state.plan?.revision ?? 0, startPlan = state.plan?.planId;
  let team: readonly { name: string }[] | undefined, catalog: readonly PilotServiceRow[] | undefined, catalogNames: ReturnType<typeof pilotCatalogNames> | undefined;
  let teamNames: string[] | undefined, refused: string | undefined;
  if (!outcome) try { [team, catalog] = await Promise.all([reader.team(), reader.catalog()]); }
  catch (error) { team = undefined; catalog = undefined; refused = error instanceof Error && PILOT_DIRECTORY_TOO_LARGE.has(error.message) ? error.message : undefined; }
  if (outcome) { /* settled, unverified or reset above: no interpretation */ }
  // §11.4: a team or catalog past the reader's bound is a safe failure of size (never its first rows in silence).
  else if (refused) outcome = { text: joined(PILOT_TOO_LARGE_REPLY, pilotStateText(state)), code: refused };
  else if (!team || !catalog) outcome = { text: joined(PILOT_DIRECTORY_UNAVAILABLE, pilotStateText(state)), code: "PILOT_DIRECTORY_UNAVAILABLE" };
  else {
    // E2-A review CATALOG-1 as amended by §11.4: EVERY catalog name and EVERY team name the reader returned (a service hint can only name what Luna
    // saw); a request that cannot carry them all is never sent (PILOT_BUDGET, runPilotInterpretation), never cut.
    catalogNames = pilotCatalogNames(catalog.map(row => row.name));
    teamNames = [...new Set(team.map(row => row.name).filter(Boolean))];
    const context: PilotRequestContext = { today: { date: today, weekday: new Date(`${today}T12:00:00Z`).toLocaleDateString("pt-BR", { weekday: "long", timeZone: "UTC" }), timezone: clock.timezone },
      team: teamNames, services: catalogNames.names,
      ...(state.plan && !pilotPlanClosed(state.plan) ? { open: pilotOpenContext(state) } : {}) };
    interpreted = await runPilotInterpretation(await host.model(), { context, message: input.message, modelId: host.modelId, startedAt });
    const ctx: Ctx = { host, state, reader, clock, message: input.message, catalog, baseRevision, reference: today };
    outcome = interpreted.ok ? await applyInterpretation(ctx, interpreted.interpretation)
      : { text: joined(interpreted.code === "PILOT_BUDGET" ? PILOT_TOO_LARGE_REPLY : PILOT_SAFE_REPLY, pilotStateText(state)), code: interpreted.code };
  }
  const base = state.plan && state.plan.planId === startPlan ? baseRevision : 0;
  if (state.plan) state.plan = { ...state.plan, turns: [...state.plan.turns, { ...turn, baseRevision: base, revision: state.plan.revision, outcome: outcome.code }].slice(-40) };
  state.turn = turn;
  const view = pilotView(state);
  if (input.clientTurnId) state.replies = [...state.replies, { clientTurnId: input.clientTurnId, turnId: turn.turnId, message: outcome.text, view }].slice(-20);
  return { text: outcome.text, view, code: outcome.code, ...(expiry ? { expiry } : {}), telemetry: pilotTelemetry(state, { turn_id: turn.turnId, base_revision: base,
    latency_ms: Math.round(performance.now() - startedAt), model_calls: interpreted?.telemetry.calls ?? 0, repaired: interpreted?.telemetry.repaired ?? false,
    ...(interpreted && !interpreted.ok ? { schema: interpreted.telemetry.schema } : {}), request_bytes: interpreted?.telemetry.request_bytes ?? [],
    // E2-A §10.1: observacoes are never read; only how many there were is recorded (never their words).
    ...(interpreted?.ok ? { observacoes: interpreted.interpretation.observacoes.length } : {}),
    ...(catalogNames ? { catalog_names: { sent: catalogNames.names.length, total: catalogNames.total } } : {}), ...(teamNames ? { team_names: teamNames.length } : {}) }) };
}
/** E2-A: the loader's mark of dropped E1 operators, consumed once. An open plan is withdrawn (no agenda effect) and the owner is told to send the
 * request again; a closed or absent plan only loses the mark (the message is then handled as usual). */
function pilotLegacyReset(state: PilotSessionState): Outcome | undefined {
  const plan = state.plan;
  if (!plan || pilotPlanClosed(plan)) { delete state.reset; return undefined; }
  const reduced = withdraw(plan, plan.revision);
  if (!reduced.ok) return { text: PILOT_SAFE_REPLY, code: `PLAN_${reduced.code}` };
  delete state.reset;
  state.plan = reduced.plan; state.pending = undefined; state.asked = []; state.outOfScope = []; state.notes = [];
  return { text: PILOT_STATE_RESET, code: "PILOT_STATE_RESET" };
}
/** Review E1: the journal receipt of the plan's OWN proposal_ref, read before anything drops, withdraws or prepares that proposal again. settled:
 * the agenda has it (the plan is done, the host's agenda side marked written); unverified: the journal could not be read (nothing changes);
 * undefined: no proposal, or nothing written for it. */
export async function pilotReceiptFirst(host: PilotHost): Promise<{ state: "settled"; receipt: PilotReceipt } | { state: "unverified" } | undefined> {
  const state = host.state, plan = state.plan, proposal = plan?.action.proposal;
  if (!plan || !proposal || plan.action.status === "done" || plan.action.status === "withdrawn") return undefined;
  let found: PilotReceipt | undefined;
  try { found = await host.receipt(proposal.proposalRef); } catch { return { state: "unverified" }; }
  if (!found || found.proposalRef !== proposal.proposalRef) return undefined;
  await host.settle(found);
  settleDone(state, plan.action.approval ?? { proposalRef: proposal.proposalRef, draftRevision: proposal.draftRevision, revision: plan.revision });
  return { state: "settled", receipt: found };
}
/** The plan done with the approval the write carried (its own, or the one the receipt proves). */
function settleDone(state: PilotSessionState, approval: PilotApproval) {
  const current = state.plan!, approved = approve(current, approval);
  state.plan = completeExecution(approved.ok ? startExecution(approved.plan) : current.action.approval ? current : { ...current, action: { ...current.action, status: "approved", approval } });
  state.asked = [];
}
/** What the owner reads of a write: the plan's identity, service, professional and new slot, the customer notice and the acceptance, if any. */
export function pilotDoneText(state: PilotSessionState, receipt: PilotReceipt, reference?: string) {
  const f = state.plan!.action.fields;
  return [`Remarcação gravada: ${f.customer.display ?? ""} — ${f.service.display ?? ""} com ${f.professional.display ?? ""}, ${formatLocal(`${f.date.value}T${f.time.value}`, reference)}.`,
    PILOT_CUSTOMER_NOTICE, ...(receipt.outcome === "PENDING_ACCEPTANCE" ? ["O novo horário fica aguardando o aceite do cliente."] : [])].join("\n");
}
/** §6: codes and numbers of the plan after a call (never a name or the owner's words). */
export function pilotTelemetry(state: PilotSessionState, extra: Record<string, unknown> = {}): Record<string, unknown> {
  const plan = state.plan, fields = plan?.action.fields, question = openQuestions(plan)[0];
  return { ...extra, plan_id: plan?.planId ?? null, revision: plan?.revision ?? 0, status: plan?.action.status ?? null,
    ...(question ? { question: { id: question.questionId, field: question.field, reason: question.reason } } : {}),
    proposal_ref: plan?.action.proposal?.proposalRef ?? null, ...(plan?.action.invalidation ? { invalidation: plan.action.invalidation.reason } : {}),
    provenance: fields ? Object.fromEntries(PILOT_FIELDS.map(name => [name, fields[name].provenance])) : null };
}
/** §11.10: how many exclusions the open plan's professional line names (the rest counted, "e mais N"; the code keeps every one of them anyway). */
const SHOWN_EXCLUSIONS = 3;
/** The open plan as Luna sees it: field states with the owner's own words for the customer (never the registered name), and the pending
 * question with options for a day, a clock, an appointment or a professional (review M12; never a customer's name: decision 22). Round 2 (§11.10):
 * what the owner said and has no value yet is shown with his own words beside its field: the pending day or clock of the field a question with no
 * options asks (an operation still without its anchor, a day left open; a question with options shows them instead) and, on the professional line still
 * without a value, the pending delegation (its mode and who must not attend); the question that clarifies an exclusion is named as such (never as a
 * question of who attends). */
export function pilotOpenContext(state: PilotSessionState): PilotOpenContext {
  const plan = state.plan!, f = plan.action.fields, question = openQuestions(plan)[0], L = PILOT_OPEN_LABELS, pending = state.pending;
  const said = (field: PilotField) => field.provenance === "unresolved" ? L.notDefined : `${field.display ?? field.value}${field.provenance === "inherited" ? ` (${L.kept})` : ""}`;
  const words = (name: "date" | "time") => {
    const operator = name === "date" ? pending?.destino.dia : pending?.destino.hora;
    return f[name].provenance === "unresolved" && question?.field === name && !question.options?.length && operator ? ` (${quoted(operator.mencao)})` : "";
  };
  const delegation = pending && f.professional.provenance === "unresolved" && delegatedMode(professionalMode(pending.destino.profissional)) ? pending.destino.profissional : undefined;
  // §11.11: what the delegation leaves out, the exclusions held aside included (its mode is "outro" while the current professional is out).
  const out = delegation ? exclusionsOf(delegation, pending?.held) : undefined, excluded = out ? unionNames(out.typed, out.words) : [];
  const without = excluded.length ? `; ${L.without}: ${excluded.slice(0, SHOWN_EXCLUSIONS).map(quoted).join(", ")}${excluded.length > SHOWN_EXCLUSIONS ? ` e mais ${excluded.length - SHOWN_EXCLUSIONS}` : ""}` : "";
  const lines = [`${L.customer}: ${f.customer.mencao ? quoted(f.customer.mencao) : L.notSaid} (${f.customer.provenance === "unresolved" ? L.recordOpen : L.recordDefined})`,
    `${L.appointment}: ${f.appointment.provenance === "unresolved" ? L.notLocated : f.appointment.display}`, `${L.date}: ${said(f.date)}${words("date")}`, `${L.time}: ${said(f.time)}${words("time")}`,
    `${L.professional}: ${said(f.professional)}${delegation ? ` (${L.mode} ${out?.current ? "outro" : delegation.modo}${without})` : ""}`, ...(plan.action.status === "proposal_ready" ? [L.ready] : [])];
  // The labels only (the contract has no slot for an id: the owner's words pointing at one are copied; a tap answers by id, selectPilotOption).
  // §11.4 as amended by §11.10: the choices left out of what Luna sees are counted from the question's real number of choices ("e mais N").
  const shown = question && question.field !== "customer" && question.field !== "scope" ? question.options?.slice(0, SHOWN_OPTIONS).map(option => option.label) : undefined;
  const omitted = shown?.length ? (question?.total ?? question?.options?.length ?? 0) - shown.length : 0;
  const fieldName: Record<PilotQuestionField, string> = L.fields;
  return { lines, ...(question ? { question: { questionId: question.questionId, field: EXCLUSION_REASONS.has(question.reason) ? L.excluding : fieldName[question.field], reason: question.reason,
    ...(shown?.length ? { options: shown } : {}), ...(omitted > 0 ? { omitted } : {}) } } : {}) };
}

async function applyInterpretation(ctx: Ctx, I: PilotInterpretation): Promise<Outcome> {
  let outcome: Outcome;
  // §11.10: more exclusions than the contract carries can never be kept whole: the turn fails safely (nothing merged), never one dropped.
  try { outcome = await routed(ctx, I); }
  catch (error) { if (error instanceof Error && error.message === "PILOT_EXCLUSIONS_FULL") return { text: joined(PILOT_SAFE_REPLY, pilotStateText(ctx.state)), code: "EXCLUSIONS_FULL" }; throw error; }
  // Review P3/P6: whatever path answered, an out-of-scope part this message named is said (by the scope question, or here), never dropped.
  if (I.fora_do_escopo.length && !ctx.scopeAsked && outcome.code !== "OUT_OF_SCOPE") return { ...outcome, text: joined(outcome.text, outOfScopeNotice(I.fora_do_escopo.map(item => item.pedido))) };
  return outcome;
}
async function routed(ctx: Ctx, I: PilotInterpretation): Promise<Outcome> {
  const { state } = ctx, open = state.plan && !pilotPlanClosed(state.plan) ? state.plan : undefined;
  if (I.desistir) return withdrawal(ctx, I, open);
  if (I.resposta_a !== null) return answer(ctx, I, open);
  // Review P6: a conversation that still names an out-of-scope request gets the clear out-of-scope answer (the field Luna gave is honoured).
  if (I.tipo === "fora_do_escopo" || I.tipo === "conversa" && I.fora_do_escopo.length) return { text: joined(PILOT_OUT_OF_SCOPE_REPLY, await currentText(ctx, open)), code: "OUT_OF_SCOPE" };
  if (I.tipo === "conversa") return { text: open ? await currentText(ctx, open) || PILOT_CONVERSATION_REPLY : PILOT_CONVERSATION_REPLY, code: "CONVERSATION" };
  return request(ctx, I, open);
}
/** Reviews S1/S5: whether THIS message brings anything new to the open plan, read from its own typed operators only (never from a re-resolution,
 * where the agenda and the clock move by themselves): an origin hint proved in this message whose typed value differs from the pending one; a
 * destination day or clock whose typed value differs; another professional mode, or a professional name other than the bound or pending one; a
 * customer mention that is not the bound customer. Other words for the same value are the same value. §11.11: `rereads` (a request only, never a
 * withdrawal): the same operator counted from today or now said in another local day or minute is a change (R1-TEMPORAL-5); a "desistir" with the open
 * request said again is decided by typed differences only (review S1: the plain withdrawal). */
function messageChanges(ctx: Ctx, I: PilotInterpretation, open: PilotPlan, rereads = true): boolean {
  const pending = ctx.state.pending ?? { origem: EMPTY_ORIGIN, destino: EMPTY_DESTINATION }, F = open.action.fields;
  if (I.cliente.mencao && !(F.customer.provenance !== "unresolved" ? pilotMentionHolds(I.cliente.mencao, F.customer.display) : sameNameWords(I.cliente.mencao, F.customer.mencao ?? null))) return true;
  for (const key of ORIGIN_KEYS) {
    const value = I.origem[key];
    if (value !== null && pilotMentionIn(ctx.message, originMention(key, value)) && typed(value) !== typed(pending.origem[key])) return true;
  }
  // §11.10 (R1-TEMPORAL-5): the same typed operator counted from today or now, said in a later turn whose day or minute differs, reads otherwise: a change.
  if (I.destino.dia && (typed(I.destino.dia) !== typed(pending.destino.dia) || rereads && rereadsDay(ctx, I.destino.dia, pending))) return true;
  if (I.destino.hora && (typed(I.destino.hora) !== typed(pending.destino.hora) || rereads && rereadsClock(ctx, I.destino.hora, pending))) return true;
  const said = I.destino.profissional, before = pending.destino.profissional;
  if (!said.modo && !said.mencao && !said.excluidos.length) return false;
  // §11.10/§11.11: what the professional becomes once merged (a delegation said again keeps every exclusion, held ones too): only that, compared with the
  // pending one, is a change.
  const merged = mergedProfessional(before, said, pending.held), after = merged.value;
  if (professionalMode(after) !== professionalMode(before)) return true;
  // §11.4: another exclusion list (as sets of normalized names; the current professional's too) is a change.
  const now = exclusionsOf(after, merged.held), was = exclusionsOf(before, pending.held);
  if (exclusionKey([...now.typed, ...now.words]) !== exclusionKey([...was.typed, ...was.words]) || now.current !== was.current) return true;
  if (professionalMode(after) === "nomeado") return !(F.professional.provenance === "explicit" && pilotMentionHolds(after.mencao ?? "", F.professional.display)) && !sameNameWords(after.mencao, before.mencao);
  return !!after.mencao && !sameNameWords(after.mencao, before.mencao);
}
/** What an open plan shows when the message changed nothing in it; a plan whose proposal lost its validity meanwhile is prepared again. */
async function currentText(ctx: Ctx, open: PilotPlan | undefined): Promise<string> {
  if (!open) return "";
  if (open.action.status === "needs_review" && !openQuestions(open).length && PILOT_FIELDS.every(name => open.action.fields[name].provenance !== "unresolved"))
    return (await finish(ctx, undefined)).text;
  return pilotStateText(ctx.state);
}
/** A later turn's operator replaces the one of its own slot. Review P1: each origin hint is proved once, against the message that brought it
 * (never against another turn's words); an unproved hint never replaces a proved one of its slot. Review P2: only a proved hint whose typed value
 * differs moves the bound appointment (other words for the same value never do). Review S2: each day operator keeps the received_at of the turn
 * that said it. §11.10: a delegation said over a pending one keeps its exclusions (mergedProfessional); `professional`, the value an answer bound
 * (an option, an exclusion clarified) in place of the message's own, with the exclusions it holds aside (§11.11). */
function mergeOperators(ctx: Ctx, I: PilotInterpretation, professional?: PilotProfessionalState) {
  const pending = ctx.state.pending ?? { origem: { ...EMPTY_ORIGIN }, destino: structuredClone(EMPTY_DESTINATION) };
  const origem = { ...pending.origem }, destino = structuredClone(pending.destino), proven = { ...(pending.proven ?? {}) }, anchors = { ...(pending.anchors ?? {}) };
  let clockDay = pending.clockDay === true, clockAfterDay = pending.clockAfterDay === true, held = pending.held ? structuredClone(pending.held) : undefined;
  for (const key of ORIGIN_KEYS) {
    const value = I.origem[key];
    if (value === null) continue;
    const proof = pilotMentionIn(ctx.message, originMention(key, value));
    if (!proof && proven[key] && origem[key] !== null) continue;
    if (proof && typed(value) !== typed(origem[key])) ctx.originChanged = true;
    (origem as Record<string, unknown>)[key] = structuredClone(value); proven[key] = proof;
    if (key === "dia") anchors.origem = turnAt(ctx);
  }
  if (I.destino.dia) { destino.dia = structuredClone(I.destino.dia); anchors.destino = turnAt(ctx); clockDay = false; clockAfterDay = false; }
  if (I.destino.hora) {
    destino.hora = structuredClone(I.destino.hora); anchors.hora = turnAt(ctx);
    // §11.3 (PRINCIPLE-1) as amended by §11.4: a day a clock offset settled stays when the clock changes later, however (a clock, the same clock, a
    // clock to define, an offset from the appointment's clock): a resolved day is never erased by a clock. Only a new clock counted from now (anchor
    // agora) says its own day again (its anchors are computed afresh, never pasted on the old one's day).
    if (clockDay && !I.destino.dia && I.destino.hora.tipo === "deslocamento" && I.destino.hora.ancoras.includes("agora")) { destino.dia = null; delete anchors.destino; clockDay = false; }
    // §11.4: a clock said in a later message than the day (a typed fact of the order of the messages, never of their words).
    else if (!I.destino.dia && destino.dia) clockAfterDay = true;
  }
  const merged = professional ?? (I.destino.profissional.modo || I.destino.profissional.mencao || I.destino.profissional.excluidos.length
    ? mergedProfessional(destino.profissional, I.destino.profissional, held) : undefined);
  if (merged) { destino.profissional = structuredClone(merged.value); held = merged.held ? structuredClone(merged.held) : undefined; }
  ctx.state.pending = { origem, destino, proven, anchors, ...(clockDay ? { clockDay: true as const } : {}), ...(clockAfterDay ? { clockAfterDay: true as const } : {}),
    ...(held ? { held } : {}) };
}
/** §11.3 (PRINCIPLE-2): whether a question is the day question of a clock offset counted from two anchors (no day pending; resolveClockDay asked it).
 * A typed fact of the plan's own state, never of the owner's words. */
const clockDayQuestion = (pending: PilotPending | undefined, question: PilotQuestion) => question.field === "date" && question.reason === "ANCHOR_TWO_READINGS"
  && !!pending && !pending.destino.dia && pending.destino.hora?.tipo === "deslocamento" && pending.destino.hora.ancoras.length > 1;
/** A new plan for a new request (the previous one, if any, is closed): its question numbers continue the session's. */
function newPlan(ctx: Ctx): PilotPlan {
  const { state } = ctx;
  state.questionFloor = Math.max(state.questionFloor ?? 0, lastQuestionNumber(state.plan));
  state.pending = undefined; state.outOfScope = []; state.asked = []; state.notes = [];
  return createPilotPlan(randomUUID());
}
/** A new request or an independent correction ("remarcar", "misto", or an answer to no question). C2: an out-of-scope part is asked about
 * before the possible part is proposed, whatever the kind Luna gave the message. Review S5: on an open plan, a message that brings nothing new
 * (the request said again, an "ok") is no change at all: same revision, same proposal, nothing prepared again. */
async function request(ctx: Ctx, I: PilotInterpretation, open: PilotPlan | undefined): Promise<Outcome> {
  if (open && !I.fora_do_escopo.length && !messageChanges(ctx, I, open)) return { text: await currentText(ctx, open) || PILOT_OPEN_DRAFT, code: "UNCHANGED" };
  const { state } = ctx, plan = open ?? newPlan(ctx), base = open ? ctx.baseRevision : plan.revision;
  mergeOperators(ctx, I);
  const resolution = await resolveFields(ctx, plan, I);
  if (I.fora_do_escopo.length) state.outOfScope = I.fora_do_escopo.map(item => item.pedido);
  return change(ctx, plan, resolution, state.outOfScope?.length ? scopeQuestion(ctx, plan, state.outOfScope) : undefined, "CHANGED",
    (current, patch) => applyIntent(current, patch, current === plan ? base : current.revision));
}
/** §1: the question asked before proposing the possible part of a partly out-of-scope request (answered by `aceita_parcial`). */
function scopeQuestion(ctx: Ctx, plan: PilotPlan, parts: readonly string[]) {
  return { draft: { questionId: nextQuestionId(plan, floorOf(ctx)), field: "scope" as const, reason: "OUT_OF_SCOPE_PART" as const },
    text: `${outOfScopeNotice(parts)} Quer que eu prepare só a remarcação?` };
}
/** The resolved fields become one change of the plan (its question, or the scope question first); then the proposal when nothing is asked. */
async function change(ctx: Ctx, plan: PilotPlan, resolution: Resolution, scope: { draft: PilotQuestionDraft; text: string } | undefined, code: string,
  reduce: (plan: PilotPlan, patch: { fields: Resolution["fields"]; questions: PilotQuestionDraft[] }) => PilotReduction = (current, patch) => applyIntent(current, patch, current.revision)): Promise<Outcome> {
  const question = scope?.draft ?? resolution.question, text = scope?.text ?? resolution.text;
  const reduced = reduce(plan, { fields: resolution.fields, questions: question ? [question] : [] });
  if (!reduced.ok) return { text: joined(PILOT_SAFE_REPLY, pilotStateText(ctx.state)), code: `PLAN_${reduced.code}` };
  ctx.state.plan = reduced.plan; ctx.state.notes = resolution.notes;
  if (scope && reduced.plan.action.status !== "withdrawn") ctx.scopeAsked = true;
  ctx.state.asked = question && text ? [{ questionId: question.questionId, text: pilotClip(text, PILOT_TEXT_BOUNDS.asked) }] : [];
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
  if (prepared.text) state.asked = openQuestions(prepared.plan).map(question => ({ questionId: question.questionId, text: pilotClip(prepared.text!, PILOT_TEXT_BOUNDS.asked) }));
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
 * inferred). M12: an identity question answered without a name is asked again with what is needed, never re-resolved in a loop.
 * E2-B round 2 (§11.10, the owner's central rule): an answer is bound to the question, the action, the pending field and the revision that asked it.
 * It changes only that field, never erases what was resolved (the day, its anchor, the exclusions, the provenance), and is never taken by another
 * question. Which answer a question takes is a fact of the question (its field and reason), never of the owner's words:
 *  - a question whose options are every choice there is (the readings of a day; the members tied after decision 15) binds only an answer that names
 *    exactly one option (calendar facts of the typed day; the folded name among the options' names), applied as the owner's tap on it; anything else
 *    is asked again with nothing changed (an exclusion added while choosing narrows the delegation instead, and decision 15 decides again);
 *  - the question that clarifies who must NOT attend takes only a delegated value with names: they replace the words it asked about, every other
 *    exclusion stays, and "outro" stays; a name given as who attends is asked again (it never becomes who attends);
 *  - a question of who attends takes a name, first among its own options. */
async function answer(ctx: Ctx, I: PilotInterpretation, open: PilotPlan | undefined): Promise<Outcome> {
  if (!open) return { text: joined(PILOT_NOTHING_OPEN_REPLY, ctx.state.plan?.action.status === "done" ? "" : PILOT_CONVERSATION_REPLY), code: "ANSWER_NO_PLAN" };
  const question = open.action.questions.find(item => item.questionId === I.resposta_a);
  if (!question || !question.open || question.revision !== open.revision)
    return { text: pilotStateText(ctx.state) || await currentText(ctx, open), code: !question ? "QUESTION_UNKNOWN" : !question.open ? "QUESTION_CLOSED" : "QUESTION_STALE" };
  const again = (note: string, code: string): Outcome => ({ text: joined(note, pilotStateText(ctx.state)), code });
  if (question.field === "scope") {
    if (I.aceita_parcial === false) {
      const reduced = withdraw(open, ctx.baseRevision);
      if (!reduced.ok) return { text: joined(PILOT_SAFE_REPLY, pilotStateText(ctx.state)), code: `PLAN_${reduced.code}` };
      ctx.state.plan = reduced.plan; ctx.state.asked = []; ctx.state.outOfScope = [];
      return { text: PILOT_WITHDRAWN_REPLY, code: "SCOPE_DECLINED" };
    }
    if (I.aceita_parcial !== true) return { text: pilotStateText(ctx.state), code: "SCOPE_UNANSWERED" };
  } else if (question.field === "customer" && !I.cliente.mencao) return again(PILOT_NAME_REQUIRED, "ANSWER_WITHOUT_NAME");
  else if (question.field === "professional") return professionalAnswer(ctx, open, question, I, again);
  else if (question.field === "date" && DAY_CHOICE_REASONS.has(question.reason) && question.options?.length) {
    // §11.10: a day question with the readings as options binds only a day naming exactly one of them (never a day it did not offer, never one picked
    // for an answer with no day); the clock or the professional said with it are their own corrections.
    const named = I.destino.dia ? daysNamed(I.destino.dia, question.options, await boundOrigin(ctx, open), pilotToday(ctx.clock)) : [];
    if (named.length !== 1) return again(PILOT_OPTION_REQUIRED, "ANSWER_NOT_AN_OPTION");
    return chooseOption(ctx, open, question, named[0], I);
  }
  mergeOperators(ctx, I);
  return answerWith(ctx, open, question, I);
}
/** §11.11: every choice of a question that chooses who attends: all of them when its options were cut at PILOT_OPTIONS_MAX (kept bound to its id, and
 * only while they hold every option it shows), else its options. */
function choicesOf(pending: PilotPending | undefined, question: PilotQuestion): PilotOption[] {
  const all = pending?.choices?.questionId === question.questionId ? pending.choices.options : undefined;
  return all && (question.options ?? []).every(option => all.some(item => item.id === option.id)) ? all : question.options ?? [];
}
/** §11.10 as completed by §11.11: the answer to a professional question, by the question's role (a fact of the question: its reasons and its options).
 *  - CLARIFY AN EXCLUSION (EXCLUSION_*, its own state pending.exclusion): only a delegated value with a name the plan did not exclude yet; those names
 *    replace only the words it asked about. The mode and the words beside "qualquer" stay as they were (an "outro" in the answer excludes the current
 *    professional too); every other exclusion stays. Anything else (no new name, a name already excluded, who attends) is asked again, nothing changed.
 *  - CHOOSE WHO ATTENDS among offered options (the tie, an ambiguous or contradictory name, a conflict, suggestions): a name binds only when it names exactly
 *    one of the question's choices (every one of them, never only the options kept), applied as the tap on it. A delegation with no name binds nothing: it
 *    is asked again unless it adds an exclusion (which narrows the delegation; decision 15 decides again). The tie's choices are every choice there is,
 *    so a name that is none of them is asked again; another question takes a name of nobody offered as who attends, resolved on the team.
 *  - A question of who attends with no options takes any value of the field. */
async function professionalAnswer(ctx: Ctx, open: PilotPlan, question: PilotQuestion, I: PilotInterpretation, again: (note: string, code: string) => Outcome): Promise<Outcome> {
  const said = I.destino.profissional, pending = ctx.state.pending, before = pending?.destino.profissional ?? EMPTY_DESTINATION.profissional;
  const silent = !said.modo && !said.mencao && !said.excluidos.length;
  if (EXCLUSION_REASONS.has(question.reason)) {
    const asked = pending?.exclusion?.questionId === question.questionId ? pending.exclusion.mencao : undefined;
    const other = (name: string) => !asked || !sameNameWords(name, asked);
    // The words asked about leave every place they were held (typed, beside "outro", held aside); what the plan still excludes is known.
    const kept: PilotProfessionalSaid = { ...before, mencao: before.modo === "outro" && before.mencao && !other(before.mencao) ? null : before.mencao,
      ...(Array.isArray(before.excluidos) ? { excluidos: before.excluidos.filter(other) } : {}) };
    const held = pending?.held && heldOf({ typed: (pending.held.excluidos ?? []).filter(other), words: (pending.held.words ?? []).filter(other), current: !!pending.held.outro });
    const all = exclusionsOf(kept, held), known = [...all.typed, ...all.words];
    const names = delegatedMode(said.modo) ? pilotExclusionMentions(said).filter(name => other(name) && !known.some(item => sameNameWords(item, name))) : [];
    if (!names.length) return again(PILOT_EXCLUSION_REQUIRED, "ANSWER_NOT_EXCLUSION");
    const clarified = delegation(all, names, all.current || said.modo === "outro", kept.modo === "qualquer" ? kept.mencao : null, kept.modo === "outro" ? kept.mencao : null);
    mergeOperators(ctx, { ...I, destino: { ...I.destino, profissional: EMPTY_DESTINATION.profissional } }, clarified);
    return answerWith(ctx, open, question, I);
  }
  const choices = choicesOf(pending, question), name = professionalMode(said) === "nomeado" ? said.mencao : null;
  if (name && choices.length) {
    const among = pilotIdentityOf(choices.map(option => ({ id: option.id, name: option.label })), name);
    const option = among.state === "exact" || among.state === "partial" ? choices.find(item => item.id === among.id) : undefined;
    if (option) return chooseOption(ctx, open, question, option, I);
  }
  if (silent) return again(PILOT_NAME_REQUIRED, "ANSWER_WITHOUT_NAME");
  if (choices.length) {
    const known = exclusionsOf(before, pending?.held), excluded = [...known.typed, ...known.words];
    const added = delegatedMode(said.modo) ? pilotExclusionMentions(said).filter(item => !excluded.some(other => sameNameWords(other, item))) : [];
    if (delegatedMode(said.modo) ? !added.length : question.reason === "PROFESSIONAL_TIE") return again(PILOT_OPTION_REQUIRED, "ANSWER_NOT_AN_OPTION");
  }
  mergeOperators(ctx, I);
  return answerWith(ctx, open, question, I);
}
/** §11.10: the offered days a typed day names, by calendar facts of the operator only (never the owner's words): a day number (its month, if said); a
 * weekday ("este" only the first from today on, "proximo" never today); a day of a relative month; the appointment's own day; an offset's readings. */
function daysNamed(dia: PilotTempoDia, options: readonly PilotOption[], origin: { date: string; time: string } | undefined, today: string): PilotOption[] {
  const names = (date: string): boolean => {
    switch (dia.tipo) {
      case "data": return Number(date.slice(8, 10)) === dia.dia && (dia.mes === null || Number(date.slice(5, 7)) === dia.mes);
      case "mes_relativo": return pilotCitedDays({ tipo: "mes_relativo", dia: dia.dia, meses: dia.meses, mencao: dia.mencao }, { date: "" }, today).includes(date);
      case "dia_semana": {
        const weekday = pilotWeekdayNumber(dia.dia_semana);
        if (weekday === undefined || weekdayOfDateKey(date) !== weekday) return false;
        if (dia.qualificador === "este") return date === addCalendarDays(today, (weekday - weekdayOfDateKey(today) + 7) % 7);
        return dia.qualificador !== "proximo" || date !== today;
      }
      case "mesmo_da_origem": return !!origin && date === origin.date;
      case "deslocamento": return pilotDayShiftReadings(dia, origin ?? { date: "" }, today).some(reading => reading.date === date);
      default: return false;
    }
  };
  return options.filter(option => /^\d{4}-\d{2}-\d{2}$/.test(option.id) && names(option.id));
}
/** The bound appointment's own day and clock (a day answer may count from it), read again from the agenda; undefined when it cannot be read. */
async function boundOrigin(ctx: Ctx, plan: PilotPlan): Promise<{ date: string; time: string } | undefined> {
  const F = plan.action.fields;
  if (!F.customer.value || !F.appointment.value) return undefined;
  try {
    const row = (await ctx.reader.appointmentsOf(F.customer.value, pilotNowLocal(ctx.clock))).find(item => item.id === F.appointment.value);
    return row ? { date: row.startLocal.slice(0, 10), time: row.startLocal.slice(11, 16) } : undefined;
  } catch { return undefined; }
}
const dayNumber = (date: string) => Date.UTC(Number(date.slice(0, 4)), Number(date.slice(5, 7)) - 1, Number(date.slice(8, 10))) / 86_400_000;
const monthsFrom = (today: string, date: string) => (Number(date.slice(0, 4)) - Number(today.slice(0, 4))) * 12 + Number(date.slice(5, 7)) - Number(today.slice(5, 7));
/** §11.10 (R1-TIME-3) as amended by §11.11 (R2-TIME-1): an offered day bound by a tap or by an answer naming it is that exact day, always within the
 * contract's own bounds (a state that is saved): a day of a month up to 12 months from the turn that bound it (one reading; never the nearest occurrence of
 * a day and month); further ahead, an offset of at most a year from the appointment's own day when it is that near, else from a day of a month at most 12
 * months ahead (each a single reading of that exact day). A day none of them can carry is asked again (the day left open), never another day. */
function exactDay(date: string, today: string, label: string, origin?: { date: string }): PilotTempoDia {
  const mencao = pilotClip(label, PILOT_CONTRACT_LIMITS.mention), months = monthsFrom(today, date), bound = PILOT_CONTRACT_LIMITS.days;
  if (months >= 0 && months <= 12) return { tipo: "mes_relativo", dia: Number(date.slice(8, 10)), meses: months, mencao };
  if (origin && /^\d{4}-\d{2}-\d{2}$/.test(origin.date) && Math.abs(dayNumber(date) - dayNumber(origin.date)) <= bound)
    return { tipo: "deslocamento", quantidade: dayNumber(date) - dayNumber(origin.date), unidade: "dias", ancoras: ["origem"], data_citada: null, mencao };
  const base = addCalendarDays(date, -bound), meses = monthsFrom(today, base);
  if (months > 12 && base >= today && meses <= 12)
    return { tipo: "deslocamento", quantidade: bound, unidade: "dias", ancoras: ["data_citada"], data_citada: { tipo: "mes_relativo", dia: Number(base.slice(8, 10)), meses, mencao }, mencao };
  return { tipo: "a_definir", mencao };
}
/** §11.10: an offered option the answer names exactly (or the owner's tap on it) is that option: its field is set from it (a day as that exact day, said
 * now; a clock as that clock; a person as that record), never searched again; what else the message says is merged as its own correction. */
async function chooseOption(ctx: Ctx, open: PilotPlan, question: PilotQuestion, option: PilotOption, I: PilotInterpretation): Promise<Outcome> {
  let value: PilotField | undefined, professional: PilotProfessionalState | undefined, destino = I.destino;
  if (question.field === "customer" || question.field === "appointment") value = { value: option.id, display: option.label, provenance: "explicit" };
  else if (question.field === "date") {
    // §11.3 (PRINCIPLE-2) / §11.6: the chosen day of a clock's day question or of the DATE_CLOCK_CONFLICT question settles the clock's anchor too
    // (facts of the question, read before the merge).
    ctx.clockDayAnswer = clockDayQuestion(ctx.state.pending, question);
    ctx.conflictAnswer = question.reason === "DATE_CLOCK_CONFLICT";
    const today = pilotToday(ctx.clock);
    destino = { ...destino, dia: exactDay(option.id, today, option.label, monthsFrom(today, option.id) > 12 ? await boundOrigin(ctx, open) : undefined) };
  } else if (question.field === "time") {
    const hour = Number(option.id.slice(0, 2));
    destino = { ...destino, hora: { tipo: "relogio", hora: hour, minuto: Number(option.id.slice(3, 5)), periodo: hour < 12 ? "manha" : null, mencao: pilotClip(option.label, PILOT_CONTRACT_LIMITS.mention) } };
  } else if (question.field === "professional") {
    // §11.11: the member bound is who attends; every exclusion the delegation had (and "outro") is held aside, never erased.
    const pending = ctx.state.pending;
    professional = mergedProfessional(pending?.destino.profissional ?? EMPTY_DESTINATION.profissional, { modo: "nomeado", mencao: option.label, excluidos: [] }, pending?.held);
    value = { value: option.id, display: option.label, provenance: "explicit", mencao: option.label };
  }
  const bound: PilotInterpretation = { ...I, destino };
  mergeOperators(ctx, bound, professional);
  return answerWith(ctx, open, question, bound, value);
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
  // Review P6: the owner's yes to the scope question stands; parts this answer names again are said (applyInterpretation), never re-asked.
  if (I.fora_do_escopo.length && question.field !== "scope") ctx.state.outOfScope = I.fora_do_escopo.map(item => item.pedido);
  return change(ctx, plan, resolution, ctx.state.outOfScope?.length ? scopeQuestion(ctx, plan, ctx.state.outOfScope) : undefined, "ANSWERED");
}
/** "desistir": the draft is withdrawn; with a correction in the same message, the corrected draft stands instead (the old value is never kept).
 * Review S1 (C1): a correction is what THIS message itself changes (messageChanges: its own typed operators or a customer other than the bound
 * one), never a difference the agenda or the clock produced since; the open request said again with "desistir" is the plain withdrawal. Reviews
 * P3/S3: an out-of-scope part of the corrected draft is asked about before the possible part (decision 26), as in any request. */
async function withdrawal(ctx: Ctx, I: PilotInterpretation, open: PilotPlan | undefined): Promise<Outcome> {
  if (!open) return { text: PILOT_NOTHING_OPEN_REPLY, code: "WITHDRAW_NOTHING" };
  const plain = (): Outcome => {
    const reduced = withdraw(open, ctx.baseRevision);
    if (!reduced.ok) return { text: joined(PILOT_SAFE_REPLY, pilotStateText(ctx.state)), code: `PLAN_${reduced.code}` };
    ctx.state.plan = reduced.plan; ctx.state.asked = []; ctx.state.outOfScope = [];
    return { text: PILOT_WITHDRAWN_REPLY, code: "WITHDRAWN" };
  };
  // §11.11 (R2-TEMPORAL-2): typed differences only; the same operator said in another minute or day is the open request said again (plain withdrawal).
  if (!messageChanges(ctx, I, open, false)) return plain();
  mergeOperators(ctx, I);
  const resolution = await resolveFields(ctx, open, I);
  if (I.fora_do_escopo.length) ctx.state.outOfScope = I.fora_do_escopo.map(item => item.pedido);
  return change(ctx, open, resolution, ctx.state.outOfScope?.length ? scopeQuestion(ctx, open, ctx.state.outOfScope) : undefined, "CORRECTED",
    (plan, patch) => withdraw(plan, plan === open ? ctx.baseRevision : plan.revision, patch));
}
/** Review M12: the owner's tap on an option of the open question (its id, which the backend published): the answer is that real record, day or
 * clock, applied exactly as a typed answer would be (only that field; the rest follows). The day or clock replaces the pending operator of its
 * slot, so the next resolution keeps the choice. Review S4: a tap names its question ("<questionId>/<option id>", the view's own ids) and is
 * taken only while that question is open at the current revision; a bare option id only while the plan has asked no other question (no card of a
 * closed question of this plan can carry it). Review S6: a professional is bound by the tapped record, never searched again by its name. */
export function pilotTappedOption(state: PilotSessionState, ref: string): { question: PilotQuestion; option: PilotOption } | undefined {
  const open = state.plan && !pilotPlanClosed(state.plan) ? state.plan : undefined;
  if (!open || typeof ref !== "string") return undefined;
  const bound = /^(q[1-9][0-9]{0,2})\/(.+)$/.exec(ref), optionId = bound ? bound[2] : ref;
  const question = bound ? openQuestions(open).find(item => item.questionId === bound[1]) : open.action.questions.length === 1 ? openQuestions(open)[0] : undefined;
  const option = question?.options?.find(item => item.id === optionId);
  return question && option && question.revision === open.revision ? { question, option } : undefined;
}
/** The tap reference of an option as the view publishes it (its question and its id). */
export const pilotOptionRef = (questionId: string, optionId: string) => `${questionId}/${optionId}`;
export async function selectPilotOption(host: PilotHost, ref: string): Promise<PilotReply> {
  const state = host.state, tapped = pilotTappedOption(state, ref);
  if (!tapped) throw Error("SELECTION_INVALID");
  const { question, option } = tapped, open = state.plan!;
  // E2-A: a plan saved under the E1 contract is never resolved again without its operators (an open question means no ready proposal: no receipt).
  const reset = state.reset ? pilotLegacyReset(state) : undefined;
  if (reset) return { text: reset.text, view: pilotView(state), code: reset.code, telemetry: pilotTelemetry(state, { selected: question.field }) };
  const clock = await host.clock(), today = pilotToday(clock);
  const ctx: Ctx = { host, state, reader: host.reader(), clock, message: "", baseRevision: open.revision, reference: today };
  // §11.10: the tap is the option, applied exactly as an answer naming it (chooseOption): a tapped day is that exact day, said now (after any clock:
  // neither the day a clock settled nor a clock said after the day any more), and settles a clock's anchor on its question; a professional is that record.
  const valid = question.field === "customer" || question.field === "appointment" || question.field === "professional"
    || question.field === "date" && /^\d{4}-\d{2}-\d{2}$/.test(option.id) || question.field === "time" && /^\d{2}:\d{2}$/.test(option.id);
  if (!valid) throw Error("SELECTION_INVALID");
  if (!state.pending) state.pending = { origem: { ...EMPTY_ORIGIN }, destino: structuredClone(EMPTY_DESTINATION) };
  const outcome = await chooseOption(ctx, open, question, option, SILENT);
  return { text: outcome.text, view: pilotView(state), code: `SELECTED_${outcome.code}`, telemetry: pilotTelemetry(state, { selected: question.field }) };
}

// ---------------------------------------------------------------- the resolution of the open plan's fields (dependency order, one question)
const identityName = (identity: PilotIdentity) => identity.state === "exact" || identity.state === "partial" ? identity.name : undefined;
/** Whether every folded name token of a mention is a token of a bound record's registered name (the same person or professional said again). */
const pilotMentionHolds = (mention: string, name: string | null) => {
  const tokens = nameTokens(mention), own = new Set(nameTokens(name ?? ""));
  return tokens.length > 0 && tokens.every(token => own.has(token));
};
/** §11.10: every record as an option; ask() keeps PILOT_OPTIONS_MAX of them and records the real number of choices. */
const personOptions = (rows: readonly PilotPerson[]): PilotOption[] => rows.map(row => ({ id: row.id, label: person(row.name) }));
const names = (rows: readonly PilotPerson[]) => listed(rows.map(row => person(row.name)), ", ");
function customerQuestion(identity: PilotIdentity | undefined): { reason: PilotQuestionReason; text: string; options?: PilotOption[] } {
  if (!identity) return { reason: "CUSTOMER_MISSING", text: "De quem é o atendimento que devo remarcar?" };
  switch (identity.state) {
    case "ambiguous": return { reason: "CUSTOMER_AMBIGUOUS", options: personOptions(identity.options),
      text: `Encontrei mais de um cadastro para ${quoted(identity.mencao)}: ${names(identity.options)}. Qual deles?` };
    case "contradictory": return { reason: "CUSTOMER_CONTRADICTORY", options: personOptions([identity.candidate]),
      text: `Encontrei ${person(identity.candidate.name)}, mas você escreveu ${identity.mencao}. É a mesma pessoa? Se for, escreva o nome como está no cadastro ou toque nele; se não, diga o nome de quem é.` };
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
      text: `Encontrei ${person(identity.candidate.name)} na equipe, mas você escreveu ${identity.mencao}. É a mesma pessoa? Se for, escreva o nome como está no cadastro ou toque nele.` };
    case "not_found": return { reason: "PROFESSIONAL_NOT_FOUND", ...(identity.suggestions.length ? { options: personOptions(identity.suggestions) } : {}),
      text: `Não encontrei ${quoted(identity.mencao)} na equipe.${identity.suggestions.length ? ` Seria ${names(identity.suggestions)}?` : " Quem vai atender?"}` };
    default: return { reason: "LOOKUP_UNAVAILABLE", text: "Não consegui consultar a equipe agora; nada foi alterado. Pode repetir em instantes?" };
  }
}
/** The destination clock already known without the day's hours (coordinator decision 4: a weekday said on that very weekday may also be today).
 * §11.1: an offset only when every anchor is the appointment's own clock (a clock counted from now belongs to now's day only). */
function knownClock(hora: PilotDestination["hora"], origin: { time: string }): string | null {
  if (!hora) return null;
  if (hora.tipo === "relogio") { const readings = pilotClockReadings(hora); return readings.length === 1 ? readings[0] : null; }
  if (hora.tipo === "mesmo_da_origem") return origin.time;
  if (hora.tipo === "deslocamento" && hora.ancoras.length && hora.ancoras.every(anchor => anchor === "origem")) return pilotClockShiftReadings(hora, { origin: { date: "", time: origin.time }, date: "" })[0]?.time ?? null;
  return null;
}
/** The pending anchors kept when the origin hints are replaced: the destination's (day and clock) stay; the origin day's is this turn's, if it said one. */
const destinationAnchors = (pending: PilotPending, origem: string | undefined): NonNullable<PilotPending["anchors"]> =>
  ({ ...(origem ? { origem } : {}), ...(pending.anchors?.destino ? { destino: pending.anchors.destino } : {}), ...(pending.anchors?.hora ? { hora: pending.anchors.hora } : {}) });
/** §11.1: how an option of an anchor question is shown: the value, then which anchor(s) give it (the owner sees why there are two). */
const DAY_ANCHOR_LABEL: Record<PilotDayAnchor, string> = { origem: "contando do dia do atendimento", hoje: "contando de hoje", data_citada: "contando da data citada" };
const TIME_ANCHOR_LABEL: Record<PilotTimeAnchor, string> = { origem: "contando do horário do atendimento", agora: "contando de agora" };
const anchorLabel = (value: string, anchors: readonly string[]) => anchors.length ? `${value} (${anchors.join(" ou ")})` : value;
/** §11.3: how a day reading is named (its anchor; a cited reference by the day it counts from, so two readings of one reference are told apart). */
const dayReadingLabel = (reading: PilotDayShiftReading, reference: string) =>
  reading.anchor === "data_citada" && reading.base ? `contando de ${formatDay(reading.base, reference)}` : DAY_ANCHOR_LABEL[reading.anchor];
const capitalized = (text: string) => text.charAt(0).toUpperCase() + text.slice(1);
/** The readings of an anchor question, as alternatives ("A ou B"). */
const either = (items: readonly string[]) => items.length < 2 ? items.join("") : `${items.slice(0, -1).join(", ")} ou ${items.at(-1)}`;
/** Resolves the plan's fields in dependency order (customer → appointment → day → professional → clock → "qualquer"/"outro"), stopping at the first
 * one that needs the owner: that one question is asked and what depends on it waits unresolved. `answering`: the question this message answers
 * (an identity answer is first matched among that question's own options). */
async function resolveFields(ctx: Ctx, plan: PilotPlan, I: PilotInterpretation, answering?: PilotQuestion): Promise<Resolution> {
  const { state, reader, clock, reference } = ctx, F = plan.action.fields, notes: string[] = [];
  // §11.10: the words an EXCLUSION question asked about belong to that question only (read by its answer before this resolution): a new one sets them again.
  // §11.11: so do every choice of a question that chooses who attends.
  if (state.pending?.exclusion || state.pending?.choices) { const { exclusion: _asked, choices: _choices, ...rest } = state.pending; void _asked; void _choices; state.pending = rest; }
  let pending: PilotPending = state.pending ?? { origem: EMPTY_ORIGIN, destino: EMPTY_DESTINATION };
  // Review S2: a day operator is read against the received_at of the turn that said it (this turn's clock only says what has passed since).
  const anchored = (at: string | undefined): PilotClock => anchoredAt(at, clock);
  const out = Object.fromEntries(PILOT_FIELDS.map(name => [name, structuredClone(F[name])])) as Record<PilotFieldName, PilotField>;
  const wait = (...fields: PilotFieldName[]) => { for (const name of fields) out[name] = UNRESOLVED(out[name].mencao); };
  // §11.10 (R1-PAYLOAD-2): a question keeps PILOT_OPTIONS_MAX options and records how many choices there really were (what Luna is told is left out).
  // §11.11 (R2-PROFESSIONAL-4): a question that chooses who attends keeps EVERY choice bound to its id when they were cut, so an answer binds against all.
  const ask = (field: PilotQuestionField, reason: PilotQuestionReason, text: string, options?: PilotOption[], appointment?: PilotAppointmentRow): Resolution => {
    const questionId = nextQuestionId(plan, floorOf(ctx));
    if (field === "professional" && options && options.length > PILOT_OPTIONS_MAX)
      state.pending = { ...(state.pending ?? pending), choices: { questionId, options: options.map(option => ({ id: option.id, label: option.label })) } };
    return { fields: out, question: { questionId, field, reason, ...(options?.length ? { options: options.slice(0, PILOT_OPTIONS_MAX) } : {}),
      ...(options && options.length > PILOT_OPTIONS_MAX ? { total: options.length } : {}) }, text, notes, ...(appointment ? { appointment } : {}) };
  };
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
  const customerId = out.customer.value!, customerName = person(out.customer.display ?? "");
  const customerChanged = customerId !== F.customer.value;
  // Review M4 (related): another customer than the one bound before: the origin hints said about the previous one leave with it (this message's
  // own hints stay, each proved against this message only: review P1).
  if (customerChanged && F.customer.value) {
    const origem = { ...EMPTY_ORIGIN }, proven: PilotPending["proven"] = {};
    for (const key of ORIGIN_KEYS) {
      const value = I.origem[key];
      if (value === null) continue;
      (origem as Record<string, unknown>)[key] = structuredClone(value); proven[key] = pilotMentionIn(ctx.message, originMention(key, value));
    }
    pending = { origem, destino: pending.destino, proven, anchors: destinationAnchors(pending, I.origem.dia ? turnAt(ctx) : undefined), ...pendingFlags(pending) };
    state.pending = pending;
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
    // E2-A review FLOW-1: a text answer to an appointment question with options is resolved among THAT question's options, by the answer's own
    // origin hints (each proved against this message). They replace the pending ones, so the hints that made the question (a contradiction, a
    // stale day or clock) are never applied again. An answer with no proven hint never picks an option (a yes is never inferred): asked again.
    // A question whose options were cut at PILOT_OPTIONS_MAX does not restrict the answer (her other appointments stay reachable by its hints).
    const answered = answering?.field === "appointment" && !!answering.options?.length && !customerChanged;
    const among = answered && answering!.options!.length < PILOT_OPTIONS_MAX ? answering!.options!.map(option => option.id) : undefined;
    if (answered) {
      const origem = { ...EMPTY_ORIGIN }, own: PilotPending["proven"] = {};
      for (const key of ORIGIN_KEYS) {
        const value = I.origem[key];
        if (value === null) continue;
        (origem as Record<string, unknown>)[key] = structuredClone(value); own[key] = pilotMentionIn(ctx.message, originMention(key, value));
      }
      pending = { origem, destino: pending.destino, proven: own, anchors: destinationAnchors(pending, I.origem.dia ? turnAt(ctx) : undefined), ...pendingFlags(pending) };
      state.pending = pending;
    }
    // Review P1: each hint chooses only if it was proved against the message that brought it (never against another turn's words).
    const proven = Object.fromEntries(ORIGIN_KEYS.map(key => [HINT_OF[key], pending.proven?.[key] === true])) as Record<PilotHint, boolean>;
    const located = await resolveAppointment(reader, { customerId, origem: pending.origem, proven, anchor: anchored(pending.anchors?.origem),
      ...(ctx.catalog ? { catalog: ctx.catalog } : {}), ...(among ? { among } : {}) }, clock);
    if (located.state === "unavailable") { wait("appointment", "date", "time", "professional", "service"); return unavailable("appointment", "a agenda"); }
    // Review P2: the appointment bound before (the owner's own tap or answer) stays bound while it is still among what the hints leave.
    const kept = !customerChanged && F.appointment.value && located.state === "several" ? located.options.find(item => item.id === F.appointment.value) : undefined;
    if (kept) row = kept;
    else if (answered && answering && located.state !== "none" && !located.used.length) {
      wait("appointment", "date", "time", "professional", "service");
      const options = (located.state === "one" ? [located.appointment] : located.options).map(item => ({ id: item.id, label: label(item) }));
      return ask("appointment", answering.reason, `Para eu ter certeza de qual atendimento de ${customerName} remarcar, diga o dia ou o horário dele, ou toque na opção: ${listed(options.map(option => option.label))}.`, options);
    }
    else if (located.state !== "one") {
      wait("appointment", "date", "time", "professional", "service");
      const rows = located.state === "none" ? located.upcoming : located.options, options = rows.map(item => ({ id: item.id, label: label(item) }));
      if (located.state === "several") return ask("appointment", "APPOINTMENT_SEVERAL", `${customerName} tem ${rows.length} atendimentos marcados: ${listed(options.map(option => option.label))}. Qual deles?${dependents(located.skippedDependents)}`, options);
      return ask("appointment", "APPOINTMENT_NONE", rows.length ? `Não encontrei atendimento de ${customerName} com essas indicações. Os próximos são: ${listed(options.map(option => option.label))}. Qual deles?${dependents(located.skippedDependents)}`
        : `${customerName} não tem atendimento futuro marcado; por aqui eu só remarco atendimentos que ainda vão acontecer.${dependents(located.skippedDependents)}`, options);
    } else row = located.appointment;
  }
  if (row.id !== F.appointment.value) {
    // Review M5: another appointment than the one bound before: its day, clock and professional are read again from it (never kept stale).
    wait("date", "time", "professional");
    out.appointment = { value: row.id, display: label(row), provenance: "derived" };
  }
  if (out.appointment.provenance === "derived") notes.push(`Considerei o atendimento de ${formatLocal(row.startLocal, reference)}.`);
  out.service = { value: row.serviceId, display: row.serviceName, provenance: "inherited" };
  const origin = { date: row.startLocal.slice(0, 10), time: row.startLocal.slice(11, 16) }, current = { id: row.professionalId, name: row.professionalName };
  // §11.7 GAP 2.c as completed by §11.10 (R1-PROFESSIONAL-4): while a delegated mode waits for the day too, the professional is unresolved in every
  // question about the day (never the current one shown as kept against the delegation).
  const delegatedSlot = delegatedMode(professionalMode(pending.destino.profissional));
  const waitSlot = () => wait("date", "time", ...(delegatedSlot ? ["professional" as const] : []));
  // 3. The new day (decision 27: a weekday read two ways is asked; decision 4: said on that very weekday, today too while the clock is ahead). E2-B
  // §11.1: an offset is read for each anchor Luna listed, each against the received_at of the turn that said it (its day's or its clock's), and
  // different readings are asked; with no day said, a clock offset counted from now says the day (encoded ambiguity B).
  const dayClock = anchored(pending.anchors?.destino), hourClock = anchored(pending.anchors?.hora);
  const implied = pending.destino.dia ? undefined : resolveClockDay(pending.destino.hora, origin, hourClock, clock);
  // §11.10 (R1-TEMPORAL-6) as completed by §11.11 (R2-TEMPORAL-1): a message that says no day (an answer to any question, a tap on another field, a
  // correction of the clock or of who attends) keeps the day the plan already resolved and showed: only the field it answers or corrects changes, and
  // what the clock or the professional now is never reopens that day. Facts only: this message brought no day operator; the pending day operator is the
  // one that gave the plan's day (a new clock counted from now drops it in mergeOperators; another appointment unresolves the day above); the day has not
  // passed (a day already past is read again, and asked).
  const resolvedDay = !I.destino.dia && !!pending.destino.dia && out.date.provenance !== "unresolved" && !!out.date.value && out.date.value >= pilotToday(clock) ? out.date : undefined;
  const day: PilotDateResolution = resolvedDay ? { state: "one", date: resolvedDay.value!, provenance: resolvedDay.provenance as "explicit" | "inherited" | "derived", ...(resolvedDay.mencao ? { mencao: resolvedDay.mencao } : {}) }
    : implied ?? resolveTargetDate(pending.destino.dia, origin, dayClock, { time: knownClock(pending.destino.hora, origin) }, clock);
  /** The own day of each clock anchor, a fact: agora, the local day of the turn that said it; origem, the appointment's. */
  const anchorDay = (anchor: PilotTimeAnchor) => anchor === "agora" ? pilotToday(hourClock) : origin.date;
  // §11.4: a day left open (or dropped) and an offset with no anchor are asked: never the old day, never a day counted from an anchor nobody said.
  // §11.10 (R1-TIME-2): the question asks for the final day itself (never for an anchor, which no field could carry next to the operation).
  if (day.state === "ask" && (day.reason === "TO_DEFINE" || day.reason === "ANCHOR_MISSING")) {
    waitSlot();
    return ask("date", day.reason === "TO_DEFINE" ? "DATE_MISSING" : "ANCHOR_MISSING", day.reason === "TO_DEFINE" ? `Para qual dia devo passar o atendimento de ${label(row)}?`
      : `Para ${quoted(day.mencao)}, qual é o dia final do atendimento de ${label(row)}?`, undefined, row);
  }
  if (day.state === "ask") {
    waitSlot();
    const dia = pending.destino.dia, hora = pending.destino.hora;
    // Which anchor(s) give each day (the typed anchors only; shown beside the day, never used to choose; §11.3: a cited reference by its own day).
    const sources = (date: string): string[] => day.reason !== "ANCHOR_TWO_READINGS" ? []
      : dia?.tipo === "deslocamento" ? [...new Set(pilotDayShiftReadings(dia, origin, pilotToday(dayClock)).filter(reading => reading.date === date).map(reading => dayReadingLabel(reading, reference)))]
      : hora?.tipo === "deslocamento" ? hora.ancoras.filter(anchor => anchorDay(anchor) === date).map(anchor => anchor === "agora" ? TIME_ANCHOR_LABEL.agora : "no dia do atendimento") : [];
    const options = day.options.map(date => ({ id: date, label: anchorLabel(formatDay(date, reference), sources(date)) }));
    return ask("date", day.reason === "ANCHOR_TWO_READINGS" ? "ANCHOR_TWO_READINGS" : "DATE_TWO_READINGS", `${quoted(day.mencao)} pode ser ${(day.reason === "ANCHOR_TWO_READINGS" ? either : list)(options.map(option => option.label))}. Qual dia?`, options, row);
  }
  if (day.state === "invalid") { waitSlot(); return ask("date", "DATE_INVALID", day.reason === "DATE_PAST" ? `${quoted(day.mencao)} já passou. Para qual dia?`
    : `${quoted(day.mencao)} não é uma data que exista. Para qual dia?`, undefined, row); }
  const shift = pending.destino.hora;
  // §11.4 (a later correction incompatible with the earlier day; requirement 3, ONE question): a clock counted from now, said in a later message than
  // the destination day, gives a clock of its own day only; when that day is not the destination day, the earlier day is asked, with the day the
  // later clock gives offered (its clock shown) beside the day said before. Facts only: the order of the messages, the typed anchors, received_at.
  if (!implied && !ctx.conflictAnswer && pending.clockAfterDay && shift?.tipo === "deslocamento" && shift.ancoras.includes("agora")) {
    const own = pilotToday(hourClock), now = pilotToday(clock);
    const reading = own !== day.date && own >= now ? pilotClockShiftReadings({ ...shift, ancoras: ["agora"] }, { origin, date: own, clock: hourClock, current: clock })[0] : undefined;
    if (reading?.time) {
      waitSlot();
      const options = [{ id: own, label: `${formatDay(own, reference)} às ${formatClock(reading.time)} (${TIME_ANCHOR_LABEL.agora})` },
        { id: day.date, label: `${formatDay(day.date, reference)} (o dia pedido antes)` }].sort((a, b) => a.id.localeCompare(b.id));
      return ask("date", "DATE_CLOCK_CONFLICT", `${quoted(shift.mencao)}, ${TIME_ANCHOR_LABEL.agora}, dá ${formatClock(reading.time)} de ${formatDay(own, reference)}, mas o dia pedido antes é ${
        formatDay(day.date, reference)}. Qual dia: ${either(options.map(option => option.label))}?`, options, row);
    }
  }
  // §11.3 (PRINCIPLE-1): a day the clock offset's anchor agora settled (no day said; also the day a TIME_INVALID question then names) is kept in the
  // plan as "today" of the turn that said the clock, so a later clock-only change or answer stays on it (never the appointment's day in silence).
  if (implied?.state === "one" && implied.date !== origin.date && shift?.tipo === "deslocamento") {
    const kept: PilotTempoDia = { tipo: "deslocamento", quantidade: 0, unidade: "dias", ancoras: ["hoje"], data_citada: null, mencao: shift.mencao };
    pending = { ...pending, destino: { ...pending.destino, dia: kept }, anchors: { ...pending.anchors, destino: pending.anchors?.hora ?? turnAt(ctx) }, clockDay: true };
    state.pending = pending;
  }
  // §11.3 (PRINCIPLE-2): the owner's answer (text or tap) to the day question of a clock offset with two anchors keeps the anchor(s) whose own day
  // it is (the day question's own facts), so the clock is never asked again nor read from an anchor on a day that is not its own.
  if (!implied && ctx.clockDayAnswer && shift?.tipo === "deslocamento") {
    const kept = shift.ancoras.filter(anchor => anchorDay(anchor) === day.date);
    if (kept.length && kept.length < shift.ancoras.length) { pending = { ...pending, destino: { ...pending.destino, hora: { ...shift, ancoras: kept } } }; state.pending = pending; }
  }
  // §11.4: the answer to the DATE_CLOCK_CONFLICT question settles the clock's anchor too: now's own day keeps "agora"; the day said before keeps the
  // other anchor(s) (with none, the clock counted from now stays and its question follows: it gives no clock on that day).
  if (!implied && ctx.conflictAnswer && shift?.tipo === "deslocamento" && shift.ancoras.length > 1 && shift.ancoras.includes("agora")) {
    const kept: PilotTimeAnchor[] = day.date === pilotToday(hourClock) ? ["agora"] : shift.ancoras.filter(anchor => anchor !== "agora");
    pending = { ...pending, destino: { ...pending.destino, hora: { ...shift, ancoras: kept } } }; state.pending = pending;
  }
  ctx.clockDayAnswer = false; ctx.conflictAnswer = false;
  out.date = { value: day.date, display: formatDay(day.date, reference), provenance: day.provenance, ...(day.mencao ? { mencao: day.mencao } : {}) };
  if (day.provenance === "derived") {
    // §11.3 (PROPOSAL-6, PRINCIPLE-4): the derived day with the anchor that gave it, and any reading left out because it already passed.
    const dia = pending.destino.dia, fromNow = !!implied || pending.clockDay === true;
    // §11.4: a "data" whose literal reading was left out (already passed) names it, like a cited reference does (never moved in silence).
    if (!fromNow && dia?.tipo === "data") {
      const passed = pilotDataReadings(dia, pilotToday(dayClock)).filter(date => date !== day.date && (date < pilotToday(dayClock) || date < pilotToday(clock)));
      // §11.10 (R1-TEMPORAL-7) as completed by §11.11: every month from the turn's up to the day used that lacks the day number is named too (never moved
      // past a month in silence; calendar facts only).
      const said = pilotToday(dayClock), lacks: string[] = [];
      for (let step = 0, year = Number(said.slice(0, 4)), month = Number(said.slice(5, 7)); dia.mes === null && step < 24; step++, month = month % 12 + 1, year += month === 1 ? 1 : 0) {
        if (`${year}-${String(month).padStart(2, "0")}` >= day.date.slice(0, 7)) break;
        if (new Date(Date.UTC(year, month - 1, dia.dia)).getUTCMonth() !== month - 1) lacks.push(`${String(dia.dia).padStart(2, "0")}/${String(month).padStart(2, "0")} não existe`);
      }
      const left = [...(passed.length ? [`${list(passed.map(date => formatDay(date, reference)))} já passou`] : []), ...lacks];
      notes.push(`Considerei ${formatDay(day.date, reference)} (${quoted(day.mencao ?? "")})${left.length ? `: ${left.join("; ")}` : ""}.`);
    } else {
      const readings = !fromNow && dia?.tipo === "deslocamento" ? pilotDayShiftReadings(dia, origin, pilotToday(dayClock)) : [];
      const used = fromNow ? [TIME_ANCHOR_LABEL.agora] : [...new Set(readings.filter(reading => reading.date === day.date).map(reading => dayReadingLabel(reading, reference)))];
      const gone = readings.filter(reading => !!reading.date && reading.date !== day.date && (reading.date < pilotToday(dayClock) || reading.date < pilotToday(clock)));
      notes.push([`Considerei ${formatDay(day.date, reference)} (${[quoted(day.mencao ?? ""), ...(used.length ? [list(used)] : [])].join(", ")}).`,
        ...gone.map(reading => `${capitalized(dayReadingLabel(reading, reference))} seria ${formatDay(reading.date!, reference)}, que já passou.`)].join(" "));
    }
  }
  // 4. Who attends (a named one before the clock: decision 18 reads that professional's hours).
  const said = pending.destino.profissional, mode = said.modo ?? (said.mencao ? "nomeado" : null), delegated = delegatedMode(mode);
  if (!pending.destino.dia && !pending.destino.hora && (mode === null || mode === "manter")) {
    waitSlot();
    return ask("date", "DESTINATION_MISSING", `Para qual dia, horário ou profissional devo passar o atendimento de ${label(row)}?`, undefined, row);
  }
  // §11.11 (R2-PROFESSIONAL-4): who attends must perform every service the appointment holds (exact ids); a delegation applies the exclusions held aside.
  const context = { current, appointmentId: row.id, serviceId: row.serviceId, serviceIds: pilotServicesOf(row), durationMin: row.durationMin, held: pending.held };
  // §11.3 (PRINCIPLE-3): "outro" never reaches a conflict (the name in its mencao is who must not attend, left out by the resolver).
  const conflictQuestion = (who: Extract<Awaited<ReturnType<typeof resolveProfessional>>, { state: "conflict" }>) => {
    wait("professional", "time");
    return ask("professional", "PROFESSIONAL_CONTRADICTORY", who.mode === "manter" ? `Você pediu para manter ${person(current.name)}, mas citou ${person(who.named.name)}. Quem vai atender?`
      : `Você pediu quem estiver livre, mas citou ${person(who.named.name)}. Quem vai atender?`, personOptions(who.mode === "manter" ? [current, who.named] : [who.named]), row);
  };
  if (mode === "nomeado" && said.mencao && F.professional.provenance === "explicit" && pilotMentionHolds(said.mencao, F.professional.display)) out.professional = structuredClone(F.professional);
  else if (!delegated) {
    const who = await resolveProfessional(reader, said, { ...context, slot: null });
    if (who.state === "kept") out.professional = { value: who.id, display: who.name, provenance: "inherited" };
    else if (who.state === "exact" || who.state === "partial") out.professional = { value: who.id, display: who.name, provenance: "explicit", mencao: who.mencao };
    else if (who.state === "conflict") return conflictQuestion(who);
    else if ("mencao" in who) { wait("professional", "time"); const q = professionalQuestion(who); return ask("professional", q.reason, q.text, q.options, row); }
  }
  // §11.4 (GAP 2.c): a delegated mode waits for the slot: until then the professional is unresolved (never the current one shown as kept against it).
  if (delegated) wait("professional");
  // 5. The new clock (decision 18 for a bare hour; decision 2: a new day without a clock is asked; §11.1: an offset read once per listed anchor,
  // "agora" being the received_at of the turn that said it; two different clocks asked; none left on that day asked).
  const professionalId = delegated ? null : out.professional.value;
  const clockContext = { origin, date: day.date, professionalId, clock: hourClock, current: clock };
  const clockOf = await resolveTargetTime(reader, pending.destino.hora, clockContext);
  if (clockOf.state === "ask") {
    wait("time");
    if (clockOf.reason === "TWO_READINGS") return ask("time", "TIME_TWO_READINGS", `${quoted(clockOf.mencao ?? "")} pode ser ${list(clockOf.options.map(formatClock))} em ${formatDay(day.date, reference)}. Qual horário?`,
      clockOf.options.map(time => ({ id: time, label: formatClock(time) })), row);
    if (clockOf.reason === "ANCHOR_TWO_READINGS") {
      const hora = pending.destino.hora, readings = hora?.tipo === "deslocamento" ? pilotClockShiftReadings(hora, clockContext) : [];
      const options = clockOf.options.map(time => ({ id: time, label: anchorLabel(formatClock(time), readings.filter(reading => reading.time === time).map(reading => TIME_ANCHOR_LABEL[reading.anchor])) }));
      return ask("time", "ANCHOR_TWO_READINGS", `${quoted(clockOf.mencao ?? "")} pode ser ${either(options.map(option => option.label))} em ${formatDay(day.date, reference)}. Qual horário?`, options, row);
    }
    // §11.4: a clock offset with no anchor the owner said: the clock is asked (the day already resolved stays), never computed. §11.10 (R1-TIME-2): the
    // final clock itself is asked (never an anchor, which no field could carry for a clock the owner cites).
    if (clockOf.reason === "ANCHOR_MISSING") return ask("time", "ANCHOR_MISSING", `Para ${quoted(clockOf.mencao ?? "")}, qual é o horário final em ${formatDay(day.date, reference)}?`, undefined, row);
    return ask("time", "TIME_MISSING", `Qual horário em ${formatDay(day.date, reference)}?`, undefined, row);
  }
  if (clockOf.state === "invalid") { wait("time"); return ask("time", "TIME_INVALID", `${quoted(clockOf.mencao)} não dá um horário que ainda esteja por vir em ${formatDay(day.date, reference)}. Qual horário?`, undefined, row); }
  if (clockOf.state === "none") { wait("time"); return ask("time", "TIME_NO_READING", `${list(clockOf.readings.map(formatClock))} ficam fora do expediente${professionalId ? ` de ${person(out.professional.display ?? "")}` : ""} em ${formatDay(day.date, reference)}. Qual horário?`, undefined, row); }
  // §11.3 (PRINCIPLE-1, P4): a destination clock already past on its day is asked, never proposed (a fact of this turn's received_at).
  if (`${day.date}T${clockOf.time}` <= pilotNowLocal(clock)) { wait("time"); return ask("time", "TIME_INVALID", `${formatClock(clockOf.time)} em ${formatDay(day.date, reference)} já passou. Qual horário?`, undefined, row); }
  out.time = { value: clockOf.time, display: formatClock(clockOf.time), provenance: clockOf.provenance, ...(clockOf.mencao ? { mencao: clockOf.mencao } : {}) };
  const clockShift = pending.destino.hora;
  if (clockOf.provenance === "derived" && clockShift?.tipo === "relogio") {
    const other = pilotClockReadings(clockShift).filter(time => time !== clockOf.time);
    notes.push(`Considerei ${formatClock(clockOf.time)}: ${list(other.map(formatClock))} fica fora do expediente.`);
  } else if (clockOf.provenance === "derived" && clockShift?.tipo === "deslocamento") {
    // §11.3 (PROPOSAL-6, PRINCIPLE-4): the anchor that gave the clock, and a reading left out because it leaves the day or already passed. With no
    // day said (or the day the clock settled), each anchor is read on its own day; otherwise on the destination day.
    const own = !pending.destino.dia || (pending.clockDay === true && clockShift.ancoras.includes("agora"));
    const readings = clockShift.ancoras.flatMap(anchor => pilotClockShiftReadings({ ...clockShift, ancoras: [anchor] }, { ...clockContext, ...(own ? { date: anchorDay(anchor) } : {}) }));
    const used = readings.filter(reading => reading.time === clockOf.time && (!own || anchorDay(reading.anchor) === day.date)).map(reading => TIME_ANCHOR_LABEL[reading.anchor]);
    const gone = readings.filter(reading => reading.dropped?.reason === "LEAVES_DAY" || reading.dropped?.reason === "NOT_AHEAD");
    notes.push([`Considerei ${formatClock(clockOf.time)} (${[quoted(clockOf.mencao ?? ""), ...(used.length ? [list(used)] : [])].join(", ")}).`,
      ...gone.map(reading => `${capitalized(TIME_ANCHOR_LABEL[reading.anchor])} ${reading.dropped?.reason === "LEAVES_DAY" ? "sairia do dia" : `seria ${formatClock(reading.dropped!.time!)}, que já passou`}.`)].join(" "));
  } else if (clockOf.provenance === "derived") notes.push(`Considerei ${formatClock(clockOf.time)} (${quoted(clockOf.mencao ?? "")}).`);
  // 6. "qualquer" or "outro" (decision 15 as amended by §11.2): who performs the service and is free for its whole duration, the fewest appointments
  // that day; the current professional leaves for "outro" or at the origin's own day and clock (a fact), the excluded members always (§11.4); a tie
  // on the fewest is asked with the tied members (§11.4: never the name order).
  if (delegated) {
    const who = await resolveProfessional(reader, said, { ...context, slot: { date: day.date, time: clockOf.time }, origin });
    const without = mode === "outro" || !!pending.held?.outro || (day.date === origin.date && clockOf.time === origin.time);
    const when = formatLocal(`${day.date}T${clockOf.time}`, reference), service = pilotClip(row.serviceName, PILOT_TEXT_BOUNDS.service);
    if (who.state === "chosen") {
      out.professional = { value: who.id, display: who.name, provenance: "derived", ...(said.mencao ? { mencao: said.mencao } : {}) };
      notes.push(`Escolhi ${person(who.name)}: faz o serviço, está livre nesse horário e ninguém livre tem menos atendimentos no dia.`);
    } else if (who.state === "tie") {
      wait("professional");
      // §11.10 (R1-PAYLOAD-2): the tied are listed like any other options (8 named, the rest counted).
      const tied = who.options.map(item => person(item.name));
      return ask("professional", "PROFESSIONAL_TIE", `${tied.length <= SHOWN_OPTIONS ? list(tied) : listed(tied, ", ")} fazem ${service}, estão livres em ${when} e têm o mesmo número de atendimentos nesse dia. Quem vai atender?`,
        personOptions(who.options), row);
    } else if ("excluding" in who) {
      // §11.4: an exclusion that names no member for sure is asked with the owner's words (no option: a tap would make that person the one who attends).
      // §11.10: with reasons of its own (never those of a question of who attends) and its own state: the words it asks about, bound to its id.
      wait("professional");
      const asked = ask("professional", who.state === "contradictory" ? "EXCLUSION_CONTRADICTORY" : "EXCLUSION_NOT_FOUND", who.state === "contradictory"
        ? `Encontrei ${person(who.candidate.name)} na equipe, mas você escreveu ${quoted(who.mencao)} para quem não deve atender. Quem não deve atender? Escreva o nome como está no cadastro.`
        : `Não encontrei ${quoted(who.mencao)} na equipe para deixar de fora${who.suggestions.length ? ` (seria ${names(who.suggestions)}?)` : ""}. Quem não deve atender?`, undefined, row);
      state.pending = { ...pending, exclusion: { questionId: asked.question!.questionId, mencao: who.mencao } };
      return asked;
    } else if (who.state === "conflict") return conflictQuestion(who);
    else if (who.state === "nobody_free") {
      wait("professional");
      // §11.3 (PRINCIPLE-3): who was left out is said by name (the current one, and the member(s) "outro" named).
      // §11.4: the resolver lists every member an exclusion named (the current one too, when named); each said once.
      const leftOut = [...new Map([...(without ? [current] : []), ...(who.excluded ?? [])].map(item => [item.id, item])).values()].map(item => person(item.name));
      return ask("time", "PROFESSIONAL_NOBODY_FREE", `${leftOut.length ? `Sem contar ${list(leftOut)}, ninguém` : "Ninguém"} que faz ${service} está livre em ${when}. Qual outro horário?`, undefined, row);
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
  if (prepared.code === "ALREADY_WRITTEN") {
    // Review E1: an earlier proposal of this plan was written behind the session (its draft is confirmed): that write is settled on the agenda
    // side and said; this change is not made and the plan is closed (the next request opens a new one), never "nada foi alterado".
    if (prepared.receipt) await host.settle(prepared.receipt);
    const reduced = withdraw(plan, plan.revision);
    return { plan: reduced.ok ? reduced.plan : plan, text: prepared.text, code: "ALREADY_WRITTEN" };
  }
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
      ...(prepared.alternatives?.length ? { options: prepared.alternatives.slice(0, PILOT_OPTIONS_MAX).map(time => ({ id: time, label: formatClock(time) })) } : {}),
      ...((prepared.alternatives?.length ?? 0) > PILOT_OPTIONS_MAX ? { total: prepared.alternatives!.length } : {}) };
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
  const doneText = (receipt: PilotReceipt) => pilotDoneText(state, receipt, reference);
  const reply = (text: string, code: string): PilotReply => ({ text, view: pilotView(state), code, telemetry: pilotTelemetry(state, { proposal_confirmed: approval.proposalRef || null }) });
  const settled = async (found: PilotReceipt, code: string) => {
    await host.settle(found);
    settleDone(state, approval);
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
    let late: PilotReceipt | undefined;
    // Review E1: a receipt that cannot be read is not "nothing written": the plan stays as it was before the approval (the next Confirmar looks for
    // the receipt first) and the owner is told it could not be checked.
    try { late = await host.receipt(approval.proposalRef); } catch { state.plan = plan; return reply(PILOT_CONFIRM_UNVERIFIED, "CONFIRM_UNVERIFIED"); }
    if (late && late.proposalRef === approval.proposalRef) return settled(late, "CONFIRMED_AFTER_FAILURE");
    const expired = error instanceof Error && error.message === "PROPOSAL_EXPIRED";
    state.plan = invalidate(state.plan, expired ? "PROPOSAL_EXPIRED" : "CONFIRM_FAILED");
    // Checked again through the real agenda: a fresh proposal (a new Confirmar) or the question of another slot; nothing was written.
    const again = await preparePilotProposal(host, state.plan, state.notes ?? [], { floor: state.questionFloor, today: reference, appointment: state.plan.action.fields.appointment.display ?? "" });
    state.plan = again.plan;
    if (again.code === "ALREADY_WRITTEN") return reply(again.text ?? PILOT_ALREADY_WRITTEN, "ALREADY_WRITTEN");
    if (again.text) state.asked = openQuestions(again.plan).map(question => ({ questionId: question.questionId, text: pilotClip(again.text!, PILOT_TEXT_BOUNDS.asked) }));
    const now = again.plan.action.status === "proposal_ready" ? again.plan.action.proposal!.text : again.text ?? PILOT_PREPARATION_FAILED;
    return reply(`${expired ? PILOT_PROPOSAL_EXPIRED : PILOT_CONFIRM_FAILED}\n\n${now}`, expired ? "CONFIRM_EXPIRED" : "CONFIRM_FAILED");
  }
}
