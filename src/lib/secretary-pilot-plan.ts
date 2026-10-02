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
 * Every function returns a new plan; the plan it receives is never mutated (a rejection returns it exactly as it came). */
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
  "DESTINATION_MISSING", "OUT_OF_SCOPE_PART",
  // Review M4: the appointment bound earlier is no longer a candidate (cancelled or moved elsewhere): asked, never re-located in silence.
  // Review L10: the agenda's own refusal of the clock by the professional's hours (not a taken slot).
  // Review M11: the agenda does not move this appointment here (a dependent's, or one with products).
  "APPOINTMENT_CHANGED", "OUTSIDE_HOURS", "APPOINTMENT_NOT_SUPPORTED",
  // E2-B §11.1: an offset whose anchors give two different days or clocks (bound to the date or the time, both readings offered); a clock offset
  // with no reading left on the destination day (it leaves the day, is not ahead of now, or counts from now on another day).
  "ANCHOR_TWO_READINGS", "TIME_INVALID"] as const;
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
/** `invalidation` (review L10): why the backend last dropped the proposal (codes only), until the next accepted change. */
export type PilotAction = { actionId: typeof PILOT_ACTION_ID; status: PilotStatus; fields: Record<PilotFieldName, PilotField>; questions: PilotQuestion[];
  proposal?: PilotProposal; approval?: PilotApproval; invalidation?: { reason: PilotInvalidation; revision: number } };
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

/** The plan's own question ids: q1..q999 (the contract's `resposta_a` pattern). */
export const PILOT_QUESTION_ID = /^q[1-9][0-9]{0,2}$/;
/** Bound of a question's options kept in the plan (the owner reads the first ones; review M3). */
export const PILOT_OPTIONS_MAX = 20;
const UNRESOLVED = (): PilotField => ({ value: null, display: null, provenance: "unresolved" });
/** Statuses that take no change of the owner (withdrawn: nothing to change; executing/done: the agenda already has it or is getting it). */
const CLOSED = new Set<PilotStatus>(["withdrawn", "executing", "done"]);
const rejected = (code: PilotRejection, plan: PilotPlan): PilotReduction => ({ ok: false, code, plan });
const record = (value: unknown): value is Record<string, unknown> => typeof value === "object" && value !== null && !Array.isArray(value);
const text = (value: unknown): value is string => typeof value === "string" && value.length > 0;
/** The value/provenance rule of one field (closed keys; a provenance of the list; value null exactly when unresolved, and then no display). */
export function pilotFieldValid(field: unknown): field is PilotField {
  if (!record(field) || Object.keys(field).some(key => !["value", "display", "provenance", "mencao"].includes(key))) return false;
  if (!(PILOT_PROVENANCES as readonly unknown[]).includes(field.provenance)) return false;
  if (field.value !== null && !text(field.value)) return false;
  if (field.display !== null && typeof field.display !== "string") return false;
  if (field.mencao !== undefined && typeof field.mencao !== "string") return false;
  if (field.provenance === "unresolved" && field.display !== null) return false; // review L8: nothing is shown for a value that does not exist
  return (field.value === null) === (field.provenance === "unresolved");
}
const sameField = (a: PilotField, b: PilotField) => a.value === b.value && a.display === b.display && a.provenance === b.provenance && a.mencao === b.mencao;
const changedFields = (before: Record<PilotFieldName, PilotField>, after: Record<PilotFieldName, PilotField>) => PILOT_FIELDS.filter(name => !sameField(before[name], after[name]));
const copyField = (field: PilotField): PilotField => ({ value: field.value, display: field.display, provenance: field.provenance, ...(field.mencao !== undefined ? { mencao: field.mencao } : {}) });
/** The patch's fields over the current ones (copies), or undefined when one breaks the rule or names no field of the plan. */
function patchedFields(plan: PilotPlan, fields: PilotPatch["fields"]): Record<PilotFieldName, PilotField> | undefined {
  if (!record(fields)) return undefined;
  const next = Object.fromEntries(PILOT_FIELDS.map(name => [name, copyField(plan.action.fields[name])])) as Record<PilotFieldName, PilotField>;
  for (const [name, field] of Object.entries(fields)) {
    if (!(PILOT_FIELDS as readonly string[]).includes(name) || !pilotFieldValid(field)) return undefined;
    next[name as PilotFieldName] = copyField(field);
  }
  return next;
}
/** The questions a change opens: known field and reason, a fresh id, options as given (bounded). Undefined when one is not valid. */
function openedQuestions(plan: PilotPlan, drafts: readonly PilotQuestionDraft[] | undefined, revision: number): PilotQuestion[] | undefined {
  const taken = new Set(plan.action.questions.map(question => question.questionId)), out: PilotQuestion[] = [];
  for (const draft of drafts ?? []) {
    if (!record(draft) || typeof draft.questionId !== "string" || !PILOT_QUESTION_ID.test(draft.questionId) || taken.has(draft.questionId)) return undefined;
    if (!(PILOT_QUESTION_FIELDS as readonly string[]).includes(draft.field) || !(PILOT_QUESTION_REASONS as readonly string[]).includes(draft.reason)) return undefined;
    if (draft.options !== undefined && (!Array.isArray(draft.options) || draft.options.length > PILOT_OPTIONS_MAX ||
      draft.options.some(option => !record(option) || !text(option.id) || typeof option.label !== "string"))) return undefined;
    taken.add(draft.questionId);
    out.push({ questionId: draft.questionId, actionId: PILOT_ACTION_ID, field: draft.field, reason: draft.reason,
      ...(draft.options ? { options: draft.options.map(option => ({ id: option.id, label: option.label })) } : {}), revision, open: true });
  }
  return out;
}
/** A question leaves the open set without the values it offered (review L8: a closed question keeps no old value). */
const close = (question: PilotQuestion) => { question.open = false; delete question.options; };
/** An accepted change of the owner: revision + 1, the proposal, the approval and the last invalidation dropped, every open question closed (or,
 * `keep`, re-stamped at the new revision and left open), the change's own opened. */
function acceptedChange(plan: PilotPlan, fields: Record<PilotFieldName, PilotField>, opened: PilotQuestion[], status?: PilotStatus, keep: (question: PilotQuestion) => boolean = () => false): PilotReduction {
  const next = structuredClone(plan);
  next.revision = plan.revision + 1;
  next.action.fields = fields;
  for (const question of next.action.questions) if (question.open) { if (keep(question)) question.revision = next.revision; else close(question); }
  next.action.questions.push(...opened.map(question => ({ ...question, revision: next.revision })));
  delete next.action.proposal; delete next.action.approval; delete next.action.invalidation;
  next.action.status = status ?? (next.action.questions.some(question => question.open) ? "pending" : "draft");
  return { ok: true, plan: next, changed: changedFields(plan.action.fields, fields) };
}

/** A new plan: revision 0, status "draft", the six fields unresolved, no question, no proposal, no turn. */
export function createPilotPlan(planId: string): PilotPlan {
  return { planId, revision: 0, turns: [], action: { actionId: PILOT_ACTION_ID, status: "draft", questions: [],
    fields: Object.fromEntries(PILOT_FIELDS.map(name => [name, UNRESOLVED()])) as Record<PilotFieldName, PilotField> } };
}
/** An owner's change (a new request or an independent correction) on the current revision. PLAN_CLOSED once the action is withdrawn, executing
 * or done; FIELD_INVALID when a field breaks the value/provenance rule. */
export function applyIntent(plan: PilotPlan, patch: PilotPatch, baseRevision: number): PilotReduction {
  if (baseRevision !== plan.revision) return rejected("STALE_REVISION", plan);
  if (CLOSED.has(plan.action.status)) return rejected("PLAN_CLOSED", plan);
  const fields = patchedFields(plan, patch?.fields), opened = openedQuestions(plan, patch?.questions, plan.revision + 1);
  if (!fields || !opened) return rejected("FIELD_INVALID", plan);
  return acceptedChange(plan, fields, opened);
}
/** The answer to ONE open question of the current revision: only that question's field changes and only that question closes (any other open
 * question stays open at the new revision). */
export function applyAnswer(plan: PilotPlan, answer: PilotAnswer, baseRevision: number): PilotReduction {
  if (baseRevision !== plan.revision) return rejected("STALE_REVISION", plan);
  if (CLOSED.has(plan.action.status)) return rejected("PLAN_CLOSED", plan);
  const question = plan.action.questions.find(item => item.questionId === answer?.questionId);
  if (!question) return rejected("QUESTION_UNKNOWN", plan);
  if (!question.open) return rejected("QUESTION_CLOSED", plan);
  if (question.revision !== plan.revision) return rejected("QUESTION_STALE", plan);
  const others = (item: PilotQuestion) => item.questionId !== question.questionId;
  if (question.field === "scope") return acceptedChange(plan, patchedFields(plan, {})!, [], undefined, others);
  if (answer.value === undefined) return rejected("ANSWER_EMPTY", plan);
  const fields = patchedFields(plan, { [question.field]: answer.value });
  return fields ? acceptedChange(plan, fields, [], undefined, others) : rejected("FIELD_INVALID", plan);
}
/** Whether a question a correction would open is the very one already open (same field, reason and options): asking it again is not a change. */
const sameQuestion = (a: Pick<PilotQuestion, "field" | "reason" | "options">, b: Pick<PilotQuestion, "field" | "reason" | "options">) =>
  a.field === b.field && a.reason === b.reason && JSON.stringify((a.options ?? []).map(option => option.id)) === JSON.stringify((b.options ?? []).map(option => option.id));
/** "desistir": the action is withdrawn; with a correction in the same message, the corrected draft stands instead. Review C1: a correction is
 * a field whose content really changes, or a question other than the one already open; anything else (the open request said again) is the
 * plain withdrawal. */
export function withdraw(plan: PilotPlan, baseRevision: number, correction?: PilotPatch): PilotReduction {
  if (baseRevision !== plan.revision) return rejected("STALE_REVISION", plan);
  if (CLOSED.has(plan.action.status)) return rejected("PLAN_CLOSED", plan);
  if (correction) {
    const fields = patchedFields(plan, correction.fields), opened = openedQuestions(plan, correction.questions, plan.revision + 1);
    if (!fields || !opened) return rejected("FIELD_INVALID", plan);
    const open = plan.action.questions.filter(question => question.open);
    if (changedFields(plan.action.fields, fields).length || opened.some(question => !open.some(other => sameQuestion(question, other)))) return acceptedChange(plan, fields, opened);
  }
  return acceptedChange(plan, patchedFields(plan, {})!, [], "withdrawn");
}
/** The backend drops the proposal and the approval (revision + 1, status "needs_review", the reason kept until the next change); a done or
 * withdrawn action is returned as it came. */
export function invalidate(plan: PilotPlan, reason: PilotInvalidation): PilotPlan {
  if (plan.action.status === "done" || plan.action.status === "withdrawn") return plan;
  const next = structuredClone(plan);
  next.revision = plan.revision + 1;
  for (const question of next.action.questions) if (question.open) close(question);
  delete next.action.proposal; delete next.action.approval;
  next.action.status = "needs_review";
  next.action.invalidation = { reason, revision: next.revision };
  return next;
}
/** The proposal prepared for the current revision (status "proposal_ready"); one prepared for another revision is STALE_REVISION. Only a plan
 * with every field resolved and no question open takes a proposal, with real journal refs (FIELD_INVALID); an approved one keeps its approval and a
 * ready one its proposal of this revision (PROPOSAL_MISMATCH: never swapped at the same revision). */
export function attachProposal(plan: PilotPlan, proposal: PilotProposal): PilotReduction {
  if (CLOSED.has(plan.action.status)) return rejected("PLAN_CLOSED", plan);
  if (!record(proposal) || proposal.revision !== plan.revision) return rejected("STALE_REVISION", plan);
  if (!text(proposal.proposalRef) || !text(proposal.draftRef) || !Number.isInteger(proposal.draftRevision) || proposal.draftRevision < 1 || typeof proposal.text !== "string")
    return rejected("FIELD_INVALID", plan);
  if (plan.action.status === "approved") return rejected("PROPOSAL_MISMATCH", plan);
  const current = plan.action.proposal;
  if (current && current.revision === plan.revision) {
    if (current.proposalRef === proposal.proposalRef && current.draftRevision === proposal.draftRevision) return { ok: true, plan, changed: [] };
    return rejected("PROPOSAL_MISMATCH", plan);
  }
  if (PILOT_FIELDS.some(name => plan.action.fields[name].provenance === "unresolved") || plan.action.questions.some(question => question.open)) return rejected("FIELD_INVALID", plan);
  const next = structuredClone(plan);
  next.action.proposal = { proposalRef: proposal.proposalRef, draftRef: proposal.draftRef, draftRevision: proposal.draftRevision, revision: proposal.revision, text: proposal.text };
  delete next.action.approval; delete next.action.invalidation;
  next.action.status = "proposal_ready";
  return { ok: true, plan: next, changed: [] };
}
/** The owner's Confirmar on the current proposal (compare-and-swap on the revision; PROPOSAL_MISMATCH on any other proposal_ref/draft_revision). */
export function approve(plan: PilotPlan, approval: PilotApproval): PilotReduction {
  if (!record(approval) || approval.revision !== plan.revision) return rejected("STALE_REVISION", plan);
  if (CLOSED.has(plan.action.status)) return rejected("PLAN_CLOSED", plan);
  const proposal = plan.action.proposal;
  if (!proposal || !["proposal_ready", "approved"].includes(plan.action.status) || proposal.revision !== plan.revision ||
    proposal.proposalRef !== approval.proposalRef || proposal.draftRevision !== approval.draftRevision) return rejected("PROPOSAL_MISMATCH", plan);
  const next = structuredClone(plan);
  next.action.approval = { proposalRef: approval.proposalRef, draftRevision: approval.draftRevision, revision: approval.revision };
  next.action.status = "approved";
  return { ok: true, plan: next, changed: [] };
}
/** The approved proposal goes to the agenda's Confirmar ("executing"), then is written ("done"); the revision does not move (the approval it
 * carries is the one being executed). Only an approved plan (with its approval) moves; any other plan is returned as it came. */
export function startExecution(plan: PilotPlan): PilotPlan {
  if (plan.action.status !== "approved" || !plan.action.approval) return plan;
  const next = structuredClone(plan); next.action.status = "executing"; return next;
}
export function completeExecution(plan: PilotPlan): PilotPlan {
  if ((plan.action.status !== "executing" && plan.action.status !== "approved") || !plan.action.approval) return plan;
  const next = structuredClone(plan); next.action.status = "done";
  for (const question of next.action.questions) if (question.open) close(question);
  return next;
}
/** The next question id: one more than the largest used in this plan and, `floor`, in the session before it (ids never restart per plan). */
export function nextQuestionId(plan: PilotPlan, floor = 0): string {
  const used = plan.action.questions.map(question => Number(question.questionId.slice(1))).filter(Number.isFinite);
  return `q${Math.min(999, Math.max(floor, ...used, 0) + 1)}`;
}
/** The largest question number a plan used (the session's floor for the next plan). */
export const lastQuestionNumber = (plan: PilotPlan | undefined) => Math.max(0, ...(plan?.action.questions ?? []).map(question => Number(question.questionId.slice(1))).filter(Number.isFinite));
/** The open questions of the plan (the ones of its current revision). */
export const openQuestions = (plan: PilotPlan | undefined) => plan?.action.questions.filter(question => question.open) ?? [];
/** Whether the action takes no more owner changes (withdrawn, executing, done). */
export const pilotPlanClosed = (plan: PilotPlan | undefined) => !!plan && CLOSED.has(plan.action.status);
