import { z } from "zod";
import type { Model } from "@everflair/salon-secretary";
import type { ServiceActor } from "./service-catalog";
import type { PilotApproval, PilotField, PilotFieldName, PilotPlan, PilotProposal, PilotQuestion, PilotStatus } from "./secretary-pilot-plan";
import type { PilotClock, PilotReader } from "./secretary-pilot-resolver";
import type { PilotDestination, PilotOrigin } from "../../packages/salon-secretary/src/pilot-reschedule-contract";

/** Pilot of the reschedule (flag SALON_SECRETARY_PILOT_RESCHEDULE, default off; docs/c5-spike/12-piloto-remarcacao.md; owner decisions 25-31).
 * With the flag on, the pilot answers EVERY top-level message of the session (SalonSecretary.send): no agent loop, no agent validator, no C4
 * fallback; the environment, role and tenant gates stay as they are. Off, everything is exactly as before. One message: received_at frozen and
 * kept in its turn; one Luna call (interpretar_remarcacao, ≤ 15 s) and at most one format repair, ≤ 45 s in all; the contract decoded
 * (pilot-reschedule-contract.ts); the resolver over real records (secretary-pilot-resolver.ts); the reducer (secretary-pilot-plan.ts); once every
 * field is resolved, the proposal by the real agenda preparation of a change that KEEPS the resolved appointment (behind the flag
 * prepareResolvedScheduling keeps the pilot's appointment_ref instead of locating again); the Confirmar as it exists (the view's action_plan
 * group: proposal_ref + draft_revision + the plan revision, lock and fresh snapshot, journal receipt, idempotent), with the receipt of a
 * proposal_ref consulted before any expiry rule. A repeated clientTurnId returns the stored reply with no Luna call and no new revision.
 * Telemetry: codes only (turn, plan/revision, question, proposal_ref, receipt, provenance per field, latency, cost, why each question).
 * E1 contract, tests first: signatures only (PILOT_NOT_IMPLEMENTED). */
export const pilotRescheduleEnabled = () => process.env.SALON_SECRETARY_PILOT_RESCHEDULE === "true";
export const PILOT_LIMITS = Object.freeze({ callMs: 15_000, messageMs: 45_000, modelCalls: 2 });
/** §5: Luna failed (time out, or an invalid format after the repair); what was already resolved is kept. */
export const PILOT_SAFE_REPLY = "Não consegui entender com segurança; nada foi alterado.";
/** §5, decision 31: every proposal says the customer keeps the normal notification. */
export const PILOT_CUSTOMER_NOTICE = "O cliente será avisado da remarcação.";
/** §1: the clear answer to a request wholly out of the pilot's scope (nothing happens). */
export const PILOT_OUT_OF_SCOPE_REPLY = "Por enquanto, por aqui eu só remarco um atendimento que já está marcado: dia, horário ou profissional. Esse pedido ficou de fora e nada foi alterado.";
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
 * a later turn's operator replaces the one of its own slot. `replies`: the stored reply of each clientTurnId. */
export type PilotSessionState = { plan?: PilotPlan; pending?: { origem: PilotOrigin; destino: PilotDestination };
  replies: { clientTurnId: string; turnId: string; message: string; view: PilotView }[] };
/** The resolved change the real agenda preparation receives: refs and the local day and clock (the appointment is never located again). */
export type PilotResolvedChange = { appointmentRef: string; customerRef: string; date: string; time: string; professionalRef: string; serviceRef: string;
  derived: PilotFieldName[] };
export type PilotPreparation = { ok: true; proposal: PilotProposal }
  | { ok: false; code: "SLOT_UNAVAILABLE" | "OUTSIDE_HOURS" | "SERVICE_NOT_PERFORMED" | "NO_CHANGE" | "PREPARATION_FAILED"; text: string };
export type PilotReceipt = { proposalRef: string; appointmentRef: string; outcome: "RESCHEDULED" | "PENDING_ACCEPTANCE"; duplicate: boolean };
/** What SalonSecretary lends the pilot for one call, inside its lease, authorization and tenant scope. */
export interface PilotHost {
  readonly actor: ServiceActor;
  readonly state: PilotSessionState;
  /** The measured, usage-instrumented model of this message. */
  model(): Promise<Model>;
  reader(): PilotReader;
  /** received_at frozen at the start of the turn, and the salon's timezone. */
  clock(): Promise<PilotClock>;
  /** The real agenda preparation (conflict, hours, the service performed, duration, price) of a change that keeps its appointment. */
  prepare(change: PilotResolvedChange): Promise<PilotPreparation>;
  /** The journal receipt of a proposal_ref already written, if any. */
  receipt(proposalRef: string): Promise<PilotReceipt | undefined>;
  /** The existing Confirmar of one proposal (lock, fresh snapshot, journal receipt; idempotent). */
  confirm(approval: PilotApproval): Promise<PilotReceipt>;
}
export type PilotReply = { text: string; view: PilotView };

/** One owner message on the pilot path (a repeated clientTurnId returns the stored reply). */
export async function handlePilotMessage(host: PilotHost, input: PilotTurnInput): Promise<PilotReply> {
  void host; void input;
  throw Error("PILOT_NOT_IMPLEMENTED");
}
/** The proposal of a fully resolved plan through host.prepare (a rule violated: no proposal, the question of another slot, resolved fields kept). */
export async function preparePilotProposal(host: PilotHost, plan: PilotPlan): Promise<PilotPlan> {
  void host; void plan;
  throw Error("PILOT_NOT_IMPLEMENTED");
}
/** The owner's Confirmar: the receipt of the proposal_ref first, then the revision, expiry and the real confirmation. */
export async function confirmPilotProposal(host: PilotHost, approval: PilotApproval): Promise<PilotReply> {
  void host; void approval;
  throw Error("PILOT_NOT_IMPLEMENTED");
}
