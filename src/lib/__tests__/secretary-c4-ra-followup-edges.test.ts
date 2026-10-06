import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { decodeConversationTurn, withConversationRouting, withServiceListObserver, withoutSatisfiedEdges, SecretaryNewRequest, alterationFields, assertAlterationScope,
  type CapabilitySelection, type ConversationRoutingContext } from '@everflair/salon-secretary';
import { availableExampleFeatures, eligibleExamples, examplesState } from '../../../packages/salon-secretary/src/examples/select';

/** C4 R-A round 2 (DEV D07/D04). (1) Flag SALON_SECRETARY_REFERENCES_V2: an edge of a NEW/ADD operation to an action the published
 * active plan already executed (DONE) is satisfied, so it is dropped before validation (DEPENDENCY_ALREADY_DONE) and the follow-up
 * alteration of a just-confirmed appointment is prepared; an edge to an open, discarded or unknown action, the released slot and
 * the envelope's own keys are unchanged. Fixer migration (backup .demo/agenda-core/contract-migration/secretary-c4-ra-followup-edges
 * .test.before-alive-edges.ts): only an executed create or change is satisfied, and only while the plan holds no live cancellation. (2) The service_changes description states the backend guard (a complete new list is SET
 * only) in the same bytes; the guard itself is unchanged. (3) With SALON_SECRETARY_ALTER_APPOINTMENT the two bank entries that
 * teach "trocar a profissional" as UNSUPPORTED are not served (flag off: served as before). A nail studio, a barbershop and a
 * spa; diverse synthetic names; no gender is inferred from any name. */
const C4 = ['SALON_SECRETARY_TEMPORAL_COMPONENTS', 'SALON_SECRETARY_TEMPORAL_POLARITY', 'SALON_SECRETARY_SAME_AS', 'SALON_SECRETARY_JIT_INSTRUCTIONS',
  'SALON_SECRETARY_ALTER_APPOINTMENT', 'SALON_SECRETARY_MULTI_SERVICE', 'SALON_SECRETARY_REFERENCES_V2', 'SALON_SECRETARY_MULTI_ACTION_V2_ENABLED'];
beforeEach(() => { for (const flag of C4) vi.stubEnv(flag, 'true'); });
afterEach(() => { vi.unstubAllEnvs(); });

const PLAN = '40000000-0000-4000-8000-000000000004';
type Action = { item_key: string; operation: string; status: string };
const planOf = (...actions: Action[]): ConversationRoutingContext => ({ active_plan: { plan_ref: PLAN, actions: actions.map(action => ({ ...action, depends_on: [], fields: {} })) } });
const created = (status = 'DONE'): Action => ({ item_key: 'a', operation: 'appointment.create', status });
/** The recorded shape of a C4 appointment.change (every published field present, nulls where not said). */
const change = (fields: Record<string, unknown> = {}) => ({ operation: 'appointment.change', item_key: 'b', depends_on: null, released_slot_of: null, same_as: null, source_scope: null,
  customer_name: 'Ingrid', service_names: null, service_name: null, professional_name: null, components: null, date: null, time: null, period: null, source_date: null,
  source_time: null, end_time: null, end_date: null, excluded: null, reason: null, target_professional_name: null, service_changes: [{ mode: 'REMOVE', service_name: 'esmaltação' }], ...fields });
const create = (fields: Record<string, unknown> = {}) => ({ operation: 'appointment.create', item_key: 'c', depends_on: null, released_slot_of: null, same_as: null, source_scope: null,
  destination_mode: null, override_requested: null, override_reason: null, customer_name: 'Tomás', service_names: null, service_name: 'barba', professional_name: null,
  components: null, date: null, time: null, period: null, source_date: null, source_time: null, end_time: null, end_date: null, excluded: null, reason: null, ...fields });
const message = 'tira a esmaltação da Ingrid, ela só vai fazer a mão';
type Routed = { new_request: CapabilitySelection; new_request_mode: string };
async function decode(mode: string, operations: unknown[], context: ConversationRoutingContext) {
  const codes: string[] = [];
  const value = await withConversationRouting(async () => withServiceListObserver(code => codes.push(code), () => decodeConversationTurn({ turn: { mode, operations } }, undefined, message) as Routed), context);
  return { value, codes };
}
const rejects = async (mode: string, operations: unknown[], context: ConversationRoutingContext, code: string, normalized: string[] = []) => {
  const codes: string[] = [];
  await expect(withConversationRouting(async () => withServiceListObserver(code => codes.push(code), () => decodeConversationTurn({ turn: { mode, operations } }, undefined, message)), context)).rejects.toThrow(code);
  expect(codes).toEqual(normalized);
};

describe('(1) an edge to an action the active plan already executed is satisfied (flag SALON_SECRETARY_REFERENCES_V2)', () => {
  it('ADD right after a confirmed create: the alteration is kept with its delta, the satisfied edge dropped (one code), and the router re-validation accepts it', async () => {
    const context = planOf(created());
    const { value, codes } = await decode('ADD', [change({ depends_on: ['a'] })], context);
    expect(value.new_request_mode).toBe('ADD');
    expect(value.new_request.independent).toBe(true);
    expect(value.new_request.operations).toEqual([expect.objectContaining({ operation: 'appointment.change', item_key: 'b', depends_on: [], customer_name: 'Ingrid',
      service_changes: [{ mode: 'REMOVE', service_name: 'esmaltação' }] })]);
    expect(codes).toEqual(['DEPENDENCY_ALREADY_DONE']);
    // index.ts builds the route from the decoded selection (validateAddSelection again): no external edge is left.
    const routed = await withConversationRouting(async () => new SecretaryNewRequest(value.new_request, 'ADD'), context);
    expect(routed.selection.operations[0]).toMatchObject({ item_key: 'b', depends_on: [] });
  });
  it('the same edge on NEW (a new plan after a confirmed one), on an executed create or change, with the other delta modes', async () => {
    for (const [operation, changes] of [['appointment.create', [{ mode: 'INCLUDE', service_name: 'spa dos pés' }]], ['appointment.change', [{ mode: 'SET', service_name: 'mão' }, { mode: 'SET', service_name: 'pé' }]]] as const) {
      const context = planOf({ item_key: 'a', operation, status: 'DONE' });
      for (const mode of ['NEW', 'ADD']) {
        const { value, codes } = await decode(mode, [change({ depends_on: ['a'], service_changes: changes })], context);
        expect(value.new_request.operations[0], `${operation} ${mode}`).toMatchObject({ item_key: 'b', depends_on: [], service_changes: changes });
        expect(codes).toEqual(['DEPENDENCY_ALREADY_DONE']);
      }
    }
  });
  it('several operations: only the satisfied edges go; an edge between the envelope\'s own operations stays (and so does the order)', async () => {
    const context = planOf(created(), { item_key: 'x', operation: 'appointment.change', status: 'DONE' });
    const { value, codes } = await decode('ADD', [change({ depends_on: ['a'] }), create({ item_key: 'c', depends_on: ['b', 'x'], customer_name: 'Tomás' })], context);
    expect(value.new_request.operations.map(op => [op.item_key, op.depends_on])).toEqual([['b', []], ['c', ['b']]]);
    expect(value.new_request.independent).toBe(false);
    expect(codes).toEqual(['DEPENDENCY_ALREADY_DONE', 'DEPENDENCY_ALREADY_DONE']);
  });
  it('an envelope key equal to a DONE key of the plan is the envelope\'s own operation: its edge is kept (NEW)', async () => {
    const { value, codes } = await decode('NEW', [create({ item_key: 'a', customer_name: 'Tomás' }), change({ depends_on: ['a'] })], planOf(created()));
    expect(value.new_request.operations.map(op => [op.item_key, op.depends_on])).toEqual([['a', []], ['b', ['a']]]);
    expect(codes).toEqual([]);
  });
  it('the released slot of a confirmed cancel keeps its edge (the D1 pair), with no code', async () => {
    const context = planOf({ item_key: 'a', operation: 'appointment.cancel', status: 'DONE' });
    const { value, codes } = await decode('ADD', [create({ item_key: 'b', depends_on: ['a'], released_slot_of: 'a', destination_mode: 'SAME_RELEASED_SLOT' })], context);
    expect(value.new_request.operations[0]).toMatchObject({ item_key: 'b', depends_on: ['a'], released_slot_of: 'a' });
    expect(codes).toEqual([]);
  });
  it('adversarial: an edge to an open (pending or asking), discarded or unknown action is still INVALID_DEPENDENCY_GRAPH, with no code', async () => {
    for (const status of ['READY_FOR_CONFIRMATION', 'NEEDS_INPUT', 'DISCARDED'])
      for (const mode of ['ADD', 'NEW']) await rejects(mode, [change({ depends_on: ['a'] })], planOf(created(status)), 'INVALID_DEPENDENCY_GRAPH');
    await rejects('ADD', [change({ depends_on: ['z'] })], planOf(created()), 'INVALID_DEPENDENCY_GRAPH');
    // A satisfied edge beside an open one: the satisfied one is dropped (its code), the open one still refuses the turn.
    await rejects('ADD', [change({ depends_on: ['a', 'p'] })], planOf(created(), { item_key: 'p', operation: 'appointment.change', status: 'READY_FOR_CONFIRMATION' }), 'INVALID_DEPENDENCY_GRAPH',
      ['DEPENDENCY_ALREADY_DONE']);
  });
  it('adversarial (fixer): an edge to an executed cancellation, block or read is never dropped (the follow-up speaks of an appointment that is gone)', async () => {
    for (const operation of ['appointment.cancel', 'schedule.block', 'appointment.list'])
      for (const mode of ['ADD', 'NEW']) await rejects(mode, [change({ depends_on: ['a'] })], planOf({ item_key: 'a', operation, status: 'DONE' }), 'INVALID_DEPENDENCY_GRAPH');
  });
  it('adversarial (fixer): while the plan holds a cancellation (done or open) an executed create or change may be the appointment it ended: the edge is kept', async () => {
    for (const status of ['DONE', 'READY_FOR_CONFIRMATION', 'NEEDS_INPUT'])
      for (const mode of ['ADD', 'NEW']) await rejects(mode, [change({ depends_on: ['a'] })], planOf(created(), { item_key: 'k', operation: 'appointment.cancel', status }), 'INVALID_DEPENDENCY_GRAPH');
    // A discarded cancellation ended nothing: the executed create's edge is satisfied again.
    const { value, codes } = await decode('ADD', [change({ depends_on: ['a'] })], planOf(created(), { item_key: 'k', operation: 'appointment.cancel', status: 'DISCARDED' }));
    expect(value.new_request.operations[0]).toMatchObject({ item_key: 'b', depends_on: [] });
    expect(codes).toEqual(['DEPENDENCY_ALREADY_DONE']);
  });
  it('adversarial: the dropped edge never carries data: the alteration still names its own customer and delta (nothing copied from the executed action)', async () => {
    const { value } = await decode('ADD', [change({ depends_on: ['a'], customer_name: null })], planOf(created()));
    expect(value.new_request.operations[0]).toMatchObject({ customer_name: null, service_changes: [{ mode: 'REMOVE', service_name: 'esmaltação' }] });
    expect(value.new_request.operations[0]).not.toHaveProperty('same_as');
  });
  it('flag off: unchanged (the edge refuses the turn; the helper returns the operations as sent)', async () => {
    vi.stubEnv('SALON_SECRETARY_REFERENCES_V2', 'false');
    await rejects('ADD', [change({ depends_on: ['a'] })], planOf(created()), 'INVALID_DEPENDENCY_GRAPH');
    const ops = [change({ depends_on: ['a'] })];
    expect(withoutSatisfiedEdges(ops, planOf(created()).active_plan)).toEqual(ops);
    vi.stubEnv('SALON_SECRETARY_REFERENCES_V2', 'true');
    expect(withoutSatisfiedEdges(ops, undefined)).toEqual(ops);
  });
});

describe('(2) the service_changes description states the guard in the same bytes; the guard is unchanged', () => {
  it('94 bytes, the complete list is SET only, the swap rule kept', () => {
    const text = alterationFields.service_changes.description!;
    expect(Buffer.byteLength(text)).toBe(Buffer.byteLength('SET=lista nova completa; INCLUDE acrescenta; REMOVE tira; trocar X por Y=REMOVE X e INCLUDE Y.'));
    expect(text).toContain('só SET'); expect(text).toContain('trocar X por Y=REMOVE X e INCLUDE Y');
  });
  it('adversarial: SET mixed with INCLUDE or REMOVE is still refused; SET alone and a pure delta are accepted', () => {
    const op = (service_changes: unknown) => ({ operation: 'appointment.change', service_changes });
    for (const mixed of [[{ mode: 'SET', service_name: 'pé' }, { mode: 'INCLUDE', service_name: 'mão' }], [{ mode: 'REMOVE', service_name: 'pé' }, { mode: 'SET', service_name: 'mão' }]])
      expect(() => assertAlterationScope(op(mixed))).toThrow('CAPABILITY_FIELD_MISMATCH');
    expect(() => assertAlterationScope(op([{ mode: 'SET', service_name: 'pé' }, { mode: 'SET', service_name: 'mão' }]))).not.toThrow();
    expect(() => assertAlterationScope(op([{ mode: 'REMOVE', service_name: 'pé' }, { mode: 'INCLUDE', service_name: 'mão' }]))).not.toThrow();
  });
});

describe('(3) examples that teach a professional swap as UNSUPPORTED are not served with SALON_SECRETARY_ALTER_APPOINTMENT', () => {
  const ids = () => eligibleExamples(examplesState(undefined), availableExampleFeatures()).map(example => example.id);
  it('flag on: neither is eligible; flag off: both are, as before', () => {
    expect(ids()).not.toContain('S036'); expect(ids()).not.toContain('R055');
    vi.stubEnv('SALON_SECRETARY_ALTER_APPOINTMENT', 'false');
    expect(ids()).toEqual(expect.arrayContaining(['S036', 'R055']));
  });
  it('no served example answers UNSUPPORTED while the flag publishes the alteration (only the entries excluded above taught it)', () => {
    const served = eligibleExamples(examplesState(undefined), availableExampleFeatures());
    expect(served.filter(example => example.expected.mode === 'UNSUPPORTED' && /profissional/.test(example.expected.secretary_should) && /troca/.test(example.message))).toEqual([]);
  });
});
