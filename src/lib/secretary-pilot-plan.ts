/** Pilot of the reschedule (flag SALON_SECRETARY_PILOT_RESCHEDULE, default off; docs/c5-spike/12-piloto-remarcacao.md §4): the state of the ONE
 * reschedule action of a conversation and its pure reducer. No reads, no clock, no randomness: ids and values come in already resolved.
 *  - Every field has a provenance; `value` is null exactly when the provenance is "unresolved".
 *  - A question belongs to action a1 and to the field that raised it, at the revision it was asked.
 *  - A change is accepted only when its `baseRevision` is the current revision (compare-and-swap). Every accepted change moves the revision by
 *    one, drops the proposal and the approval it had, closes every question that was open and opens the ones the change brings (status
 *    "pending" with an open question, else "draft").
 *  - An answer fills only its question's field; a question already closed, or asked at another revision, changes nothing.
 *  - A withdrawal ("desistir") leaves the action "withdrawn" with no effect on the agenda; with a correction in the same message, the corrected
 *    draft stands instead (new revision) and the old value is never kept.
 * E1 contract, tests first: the types are final; the functions are pending (PILOT_NOT_IMPLEMENTED). */
export const PILOT_ACTION_ID = "a1" as const;
export const PILOT_FIELDS = ["customer", "appointment", "date", "time", "professional", "service"] as const;
export type PilotFieldName = (typeof PILOT_FIELDS)[number];
export const PILOT_PROVENANCES = ["explicit", "inherited", "derived", "unresolved"] as const;
export type PilotProvenance = (typeof PILOT_PROVENANCES)[number];
export const PILOT_STATUSES = ["draft", "pending", "proposal_ready", "approved", "executing", "done", "withdrawn", "needs_review"] as const;
export type PilotStatus = (typeof PILOT_STATUSES)[number];
/** `value`: the backend's value (a ref, YYYY-MM-DD or HH:mm), never Luna's words; `display`: what the owner reads; `mencao`: the owner's
 * words Luna copied for it, when there were any. */
export type PilotField = { value: string | null; display: string | null; provenance: PilotProvenance; mencao?: string };
/** "scope": the question asked before proposing the possible part of a partly out-of-scope request (§1). */
export const PILOT_QUESTION_FIELDS = [...PILOT_FIELDS, "scope"] as const;
export type PilotQuestionField = (typeof PILOT_QUESTION_FIELDS)[number];
/** Why a question was asked (telemetry, §6: codes only). */
export const PILOT_QUESTION_REASONS = ["CUSTOMER_MISSING", "CUSTOMER_AMBIGUOUS", "CUSTOMER_CONTRADICTORY", "CUSTOMER_NOT_FOUND", "LOOKUP_UNAVAILABLE",
  "APPOINTMENT_NONE", "APPOINTMENT_SEVERAL", "DATE_TWO_READINGS", "DATE_INVALID", "TIME_TWO_READINGS", "TIME_NO_READING", "TIME_MISSING",
  "PROFESSIONAL_AMBIGUOUS", "PROFESSIONAL_CONTRADICTORY", "PROFESSIONAL_NOT_FOUND", "PROFESSIONAL_NOBODY_FREE", "SLOT_UNAVAILABLE",
  "DESTINATION_MISSING", "OUT_OF_SCOPE_PART"] as const;
export type PilotQuestionReason = (typeof PILOT_QUESTION_REASONS)[number];
export type PilotOption = { id: string; label: string };
export type PilotQuestion = { questionId: string; actionId: typeof PILOT_ACTION_ID; field: PilotQuestionField; reason: PilotQuestionReason; options?: PilotOption[];
  revision: number; open: boolean };
/** A question a change opens; the reducer stamps the action, the revision and `open`. */
export type PilotQuestionDraft = Pick<PilotQuestion, "questionId" | "field" | "reason" | "options">;
/** The real agenda proposal (journal refs) prepared for revision `revision` of the plan; `text` is what the owner reads. */
export type PilotProposal = { proposalRef: string; draftRef: string; draftRevision: number; revision: number; text: string };
/** The owner's Confirmar: proposal_ref + draft_revision + the plan revision (§5). */
export type PilotApproval = { proposalRef: string; draftRevision: number; revision: number };
export type PilotAction = { actionId: typeof PILOT_ACTION_ID; status: PilotStatus; fields: Record<PilotFieldName, PilotField>; questions: PilotQuestion[];
  proposal?: PilotProposal; approval?: PilotApproval };
/** One owner message: its frozen received_at (ISO), the revision it started on and the one it left. */
export type PilotTurn = { turnId: string; clientTurnId: string | null; receivedAt: string; baseRevision: number; revision: number; outcome: string };
export type PilotPlan = { planId: string; revision: number; action: PilotAction; turns: PilotTurn[] };

/** A resolved change of one message: the fields it sets and the questions it opens. */
export type PilotPatch = { fields: Partial<Record<PilotFieldName, PilotField>>; questions?: PilotQuestionDraft[] };
/** An answer to an open question; `value` fills that question's field (a "scope" answer carries none). */
export type PilotAnswer = { questionId: string; value?: PilotField };
export const PILOT_REJECTIONS = ["STALE_REVISION", "PLAN_CLOSED", "QUESTION_UNKNOWN", "QUESTION_CLOSED", "QUESTION_STALE", "ANSWER_EMPTY",
  "FIELD_INVALID", "PROPOSAL_MISMATCH"] as const;
export type PilotRejection = (typeof PILOT_REJECTIONS)[number];
/** `changed`: the fields whose content the reduction changed. A rejection returns the plan exactly as it came. */
export type PilotReduction = { ok: true; plan: PilotPlan; changed: PilotFieldName[] } | { ok: false; code: PilotRejection; plan: PilotPlan };
/** Why the backend dropped a proposal or an approval without an owner's change (the agenda moved, the slot was taken at the Confirmar...). */
export const PILOT_INVALIDATIONS = ["SLOT_TAKEN", "AGENDA_CHANGED", "PROPOSAL_EXPIRED", "CONFIRM_FAILED"] as const;
export type PilotInvalidation = (typeof PILOT_INVALIDATIONS)[number];

/** A new plan: revision 0, status "draft", the six fields unresolved, no question, no proposal, no turn. */
export function createPilotPlan(planId: string): PilotPlan {
  void planId;
  throw Error("PILOT_NOT_IMPLEMENTED");
}
/** An owner's change (a new request or an independent correction) on the current revision. PLAN_CLOSED once the action is withdrawn, executing
 * or done; FIELD_INVALID when a field breaks the value/provenance rule. */
export function applyIntent(plan: PilotPlan, patch: PilotPatch, baseRevision: number): PilotReduction {
  void plan; void patch; void baseRevision;
  throw Error("PILOT_NOT_IMPLEMENTED");
}
/** The answer to ONE open question of the current revision: only that question's field changes. */
export function applyAnswer(plan: PilotPlan, answer: PilotAnswer, baseRevision: number): PilotReduction {
  void plan; void answer; void baseRevision;
  throw Error("PILOT_NOT_IMPLEMENTED");
}
/** "desistir": the action is withdrawn; with a correction (fields) in the same message, the corrected draft stands instead. */
export function withdraw(plan: PilotPlan, baseRevision: number, correction?: PilotPatch): PilotReduction {
  void plan; void baseRevision; void correction;
  throw Error("PILOT_NOT_IMPLEMENTED");
}
/** The backend drops the proposal and the approval (revision + 1, status "needs_review"); a done or withdrawn action is returned as it came. */
export function invalidate(plan: PilotPlan, reason: PilotInvalidation): PilotPlan {
  void plan; void reason;
  throw Error("PILOT_NOT_IMPLEMENTED");
}
/** The proposal prepared for the current revision (status "proposal_ready"); one prepared for another revision is STALE_REVISION. */
export function attachProposal(plan: PilotPlan, proposal: PilotProposal): PilotReduction {
  void plan; void proposal;
  throw Error("PILOT_NOT_IMPLEMENTED");
}
/** The owner's Confirmar on the current proposal (compare-and-swap on the revision; PROPOSAL_MISMATCH on any other proposal_ref/draft_revision). */
export function approve(plan: PilotPlan, approval: PilotApproval): PilotReduction {
  void plan; void approval;
  throw Error("PILOT_NOT_IMPLEMENTED");
}
