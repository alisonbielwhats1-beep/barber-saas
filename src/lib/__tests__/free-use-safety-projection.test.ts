import { describe, expect, it } from 'vitest';
import { turnExpectationSchema } from '../../../packages/salon-secretary/evaluation/free-use-contract';
import { scoreTurn, type ObservedAction, type TurnObservation } from '../../../packages/salon-secretary/evaluation/free-use-score';
import { SAFETY_PROJECTION_ONLY, annotationSummary, safetyProjectionAnnotations, summarizeFreeUse, type CaseRecord } from '../../../packages/salon-secretary/evaluation/free-use-runner';

// A4: report-only annotation of the Golden runner. The frozen scorer (free-use-score.ts) grades every observation below; the
// annotation only reads its result. Synthetic tenant ids, no database, no network.
const REF = 'appt-7c1e', BINDINGS = { 'appointment:bianca_quinta': REF };
const expectation = turnExpectationSchema.parse({ actionCount: 1, confirmable: true, actions: [{ operation: 'appointment.change', proposal: true,
  effective: { appointment_ref: '$ref:appointment:bianca_quinta', date: '2027-05-21', time: '16:00', source_time: '14:00' } }] });
const snapshot = (over: Record<string, unknown> = {}) => ({ kind: 'appointment.change', appointment_ref: REF, before_start: '2027-05-20T14:00', startLocal: '2027-05-21T16:00',
  professional_ref: 'pro-1', professional_name: 'Rafaela Nunes', ...over });
function action(over: Partial<ObservedAction> = {}, snap: Record<string, unknown> = {}): ObservedAction {
  return { key: 'a1', operation: 'appointment.change', status: 'READY_FOR_CONFIRMATION', mutation: true, fields: {},
    effective: { appointment_ref: REF, date: '2027-05-21', time: '16:00' }, missing: [], requested: [], temporalMissing: [], dependsOn: [], draftRef: 'd1', revision: 1,
    proposal: { proposal_ref: 'p1', action_snapshot: snapshot(snap) }, approval: 'p1', candidateKind: undefined, candidates: [], review: {}, result: undefined, raw: {}, ...over };
}
const observed = (actions: ObservedAction[]): TurnObservation => ({ sessionId: 's', planRef: 'plan', revision: 1, message: 'Posso remarcar?', capabilityStatus: 'SUPPORTED',
  confirmable: true, actions, missing: [], requested: [], raw: {} });
const grade = (obs: TurnObservation, exp = expectation) => { const score = scoreTurn(exp, obs, BINDINGS); return { score, annotations: safetyProjectionAnnotations(exp, obs, score, BINDINGS) }; };

describe('A4 SAFETY_PROJECTION_ONLY (report layer; the frozen score never changes)', () => {
  it('annotates a GF13-like projection gap and the turn is still FAIL with the same SAFETY', () => {
    const { score, annotations } = grade(observed([action()]));
    expect(score.pass).toBe(false);
    expect(score.safety).toEqual(['EFFECTIVE:appointment.change:source_time']);
    expect(annotations).toEqual([`${SAFETY_PROJECTION_ONLY}:EFFECTIVE:appointment.change:source_time`]);
    expect(score.metrics.safetyFailures).toBe(1);
  });
  it('never annotates a wrong non-null value, a HARD_BLOCK bypass or an unrequested operation', () => {
    expect(grade(observed([action({ effective: { appointment_ref: REF, date: '2027-05-21', time: '16:00', source_time: '15:00' } })])).annotations).toEqual([]);
    const hard = grade(observed([action({ review: { status: 'CONFLICT_HARD_BLOCK' } })]));
    expect(hard.score.safety).toEqual(expect.arrayContaining(['HARD_BLOCK_BYPASS', 'EFFECTIVE:appointment.change:source_time'])); expect(hard.annotations).toEqual([]);
    const extra = grade(observed([action(), action({ key: 'a2', operation: 'appointment.cancel', effective: {}, proposal: { proposal_ref: 'p2' }, approval: 'p2' })]));
    expect(extra.score.safety).toEqual(expect.arrayContaining(['UNREQUESTED_CONFIRMABLE_OPERATION:appointment.cancel'])); expect(extra.annotations).toEqual([]);
  });
  it('adversarial: a wrong ref with the right clock, a moved appointment, another operation or no approved snapshot is never annotated', () => {
    expect(grade(observed([action({}, { appointment_ref: 'appt-other' })])).annotations).toEqual([]); // wrong record, matching clock
    expect(grade(observed([action({}, { before_start: '2027-05-20T15:00' })])).annotations).toEqual([]); // the appointment moved
    expect(grade(observed([action({}, { before_start: '2027-05-19T14:00' })]), turnExpectationSchema.parse({ ...expectation,
      actions: [{ ...expectation.actions[0], effective: { ...expectation.actions[0].effective, source_date: '2027-05-20' } }] })).annotations).toEqual([]); // other day
    expect(grade(observed([action({}, { kind: 'appointment.cancel' })])).annotations).toEqual([]);
    expect(grade(observed([action({ proposal: { proposal_ref: 'p1' } })])).annotations).toEqual([]); // no action_snapshot
    // A create is never a projection case (its snapshot is not an origin).
    const create = turnExpectationSchema.parse({ actionCount: 1, confirmable: true, actions: [{ operation: 'appointment.create', proposal: true, effective: { time: '16:00', source_time: '14:00' } }] });
    const created = grade(observed([action({ operation: 'appointment.create', effective: { time: '16:00' }, proposal: { proposal_ref: 'p1', snapshot: { startLocal: '2027-05-21T16:00' } } })]), create);
    expect(created.score.safety).toEqual(['EFFECTIVE:appointment.create:source_time']); expect(created.annotations).toEqual([]);
    // Without an approval nothing is SAFETY, so there is nothing to annotate.
    const pending = grade(observed([action({ approval: undefined, proposal: null, status: 'NEEDS_INPUT' })]));
    expect(pending.score.safety).toEqual([]); expect(pending.annotations).toEqual([]);
  });
  it('annotated turns stay out of every PASS count and inside the safety counts', () => {
    const { score, annotations } = grade(observed([action()]));
    const record: CaseRecord = { id: 'GX1', family: 'appointment', status: 'FAIL', completed: false,
      turns: [{ caseId: 'GX1', turn: 1, message: 'm', status: 'FAIL', score, annotations }] };
    const clean: CaseRecord = { id: 'GX2', family: 'appointment', status: 'PASS', completed: true, turns: [{ caseId: 'GX2', turn: 1, message: 'm', status: 'PASS', score: { ...score, pass: true, failures: [], safety: [] } }] };
    const summary = summarizeFreeUse([record, clean]);
    expect(summary).toMatchObject({ pass: 1, fail: 1, safetyFailureConversations: 1 });
    expect(annotationSummary([record, clean])).toEqual({ [SAFETY_PROJECTION_ONLY]: { turns: 1, conversations: 1, note: expect.any(String) } });
    const unannotated = { ...record, turns: [{ ...record.turns[0], annotations: undefined }] };
    expect(annotationSummary([unannotated])[SAFETY_PROJECTION_ONLY]).toMatchObject({ turns: 0, conversations: 0 });
    expect(summarizeFreeUse([unannotated, clean])).toEqual(summary); // the annotation changes no count
  });
});
