import { afterEach, describe, expect, it, vi } from 'vitest';
import { validateSelectionV2, validateAddSelection, validateExistingPlanPatches, decodeConversationTurn, withConversationRouting, createActionPlan,
  refreshActionPlan, actionSelection, runtimeReviewConfiguration, type CapabilitySelection } from '@everflair/salon-secretary';

/** C5 validation and plan graph: a same_as reference is a DATA link. It is checked per operation (partial acceptance leaves
 * the operation out), its cycles are a graph error of the whole turn, it orders preparation and joins confirmation groups,
 * and it never becomes an execution dependency. With the flag off a reference is refused. */
afterEach(() => { vi.unstubAllEnvs(); });
const on = () => vi.stubEnv('SALON_SECRETARY_SAME_AS', 'true');
const neutral = { target_name: null, name: null, priceCents: null, durationMin: null, phone: null, email: null, requested_fields: [], clear_fields: [] };
const op = (item_key: string, operation: string, extra: Record<string, unknown> = {}) => ({ ...neutral, operation, item_key, depends_on: [], released_slot_of: null, source_scope: null, ...extra });
const ref = (field: string, item_key: string, literal = 'no mesmo dia') => ({ field, item_key, literal });
const selection = (...operations: Record<string, unknown>[]) => ({ disposition: 'SUPPORTED', conversation_response: null, unavailable_capability: null,
  skills: [...new Set(operations.map(item => item.operation === 'customer.message' ? 'communication' : String(item.operation).startsWith('customer.') ? 'customers' : 'scheduling'))],
  independent: !operations.some(item => (item.depends_on as string[] | null)?.length), operations });
const carla = op('carla', 'appointment.create', { customer_name: 'Carla' });
const rosa = (refs: unknown, extra: Record<string, unknown> = {}) => op('rosa', 'appointment.create', { customer_name: 'Rosa', same_as: refs, ...extra });

describe('validateSelectionV2', () => {
  it('keeps a valid reference on its operation; null or empty is no key at all (historical shape)', () => {
    on();
    const valid = validateSelectionV2(selection(carla, rosa([ref('date', 'carla')])));
    expect(valid.operations.find(item => item.item_key === 'rosa')!.same_as).toEqual([ref('date', 'carla')]);
    expect(valid.independent).toBe(true);
    for (const empty of [null, []]) expect(validateSelectionV2(selection(carla, rosa(empty))).operations.every(item => !('same_as' in item))).toBe(true);
  });
  it('flag off: a reference is a capability field the contract does not publish', () => {
    expect(() => validateSelectionV2(selection(carla, rosa([ref('date', 'carla')])))).toThrow('CAPABILITY_FIELD_MISMATCH');
    const partial = validateSelectionV2(selection(carla, rosa([ref('date', 'carla')])), { partial: true });
    expect(partial.operations.map(item => item.item_key)).toEqual(['carla']);
    expect(partial.rejected).toMatchObject([{ item_key: 'rosa', code: 'CAPABILITY_FIELD_MISMATCH', dependent: false }]);
  });
  it.each([
    ['an unknown key', [ref('date', 'bia')]],
    ['its own key', [ref('date', 'rosa')]],
    ['two references for one field', [ref('date', 'carla'), ref('date', 'carla', 'no mesmo horário')]],
    ['a field the source cannot give (a message has no customer to copy)', [ref('customer', 'aviso')]],
  ])('refuses %s (per operation)', (_label, refs) => {
    on();
    const aviso = op('aviso', 'customer.message', { communication: { recipient_name: 'Carla', channel: null, message_mode: null, content: null } });
    expect(() => validateSelectionV2(selection(carla, aviso, rosa(refs)))).toThrow('SAME_AS_INVALID');
    const partial = validateSelectionV2(selection(carla, aviso, rosa(refs)), { partial: true });
    expect(partial.operations.map(item => item.item_key)).toEqual(['carla', 'aviso']);
    expect(partial.rejected).toMatchObject([{ item_key: 'rosa', code: 'SAME_AS_INVALID' }]);
  });
  it.each([
    ['a cancellation following a date', 'appointment.cancel', 'date'],
    ['a read following a time', 'appointment.list', 'time'],
    ['a message following a professional', 'customer.message', 'professional'],
  ])('refuses %s (the field is not the target operation\'s)', (_label, operation, field) => {
    on();
    const target = op('alvo', operation, operation === 'customer.message' ? { communication: { recipient_name: 'Carla', channel: null, message_mode: null, content: null } } : {});
    expect(() => validateSelectionV2(selection(carla, { ...target, same_as: [ref(field, 'carla')] }))).toThrow('SAME_AS_INVALID');
  });
  it('a reference beside released_slot_of is dropped, never refused: the released slot owns its values (the T21 pair stays whole)', () => {
    on();
    const cancel = op('cancelar', 'appointment.cancel', { customer_name: 'Amanda' });
    const create = op('marcar', 'appointment.create', { customer_name: 'Fábio', depends_on: ['cancelar'], released_slot_of: 'cancelar',
      same_as: [ref('date', 'cancelar', 'no horário dela'), ref('time', 'cancelar', 'no horário dela')] });
    for (const partial of [false, true]) {
      const valid = validateSelectionV2(selection(cancel, create), { partial });
      expect(valid.operations.find(item => item.item_key === 'marcar')).toMatchObject({ released_slot_of: 'cancelar', depends_on: ['cancelar'] });
      expect(valid.operations.every(item => !('same_as' in item))).toBe(true);
      expect(valid.rejected ?? []).toEqual([]);
    }
  });
  it('a reference cycle is a graph error of the whole turn, even under partial acceptance', () => {
    on();
    const a = rosa([ref('date', 'carla')]), b = { ...carla, same_as: [ref('time', 'rosa', 'no mesmo horário')] };
    expect(() => validateSelectionV2(selection(b, a))).toThrow('INVALID_DEPENDENCY_GRAPH');
    expect(() => validateSelectionV2(selection(b, a), { partial: true })).toThrow('INVALID_DEPENDENCY_GRAPH');
  });
  it('partial: an operation referencing a left-out one waits with it (never a dangling link)', () => {
    on();
    const broken = op('carla', 'appointment.create', { customer_name: 'Carla', inventory: { product_name: 'x', mode: null, quantity: null, reason: null, low_stock: null } });
    const partial = validateSelectionV2(selection(broken, rosa([ref('date', 'carla')]), op('bia', 'appointment.create', { customer_name: 'Bia' })), { partial: true });
    expect(partial.operations.map(item => item.item_key)).toEqual(['bia']);
    expect(partial.rejected).toMatchObject([{ item_key: 'carla', code: 'CAPABILITY_FIELD_MISMATCH', dependent: false }, { item_key: 'rosa', code: 'DEPENDENT_OF_REJECTED', dependent: true }]);
  });
  it('the change of V27 may name the cancellation for date, time and (kept) professional', () => {
    on();
    const cancel = op('cancelar_amanda', 'appointment.cancel', { customer_name: 'Amanda' });
    const change = op('passar_fabio', 'appointment.change', { customer_name: 'Fábio', same_as: ['date', 'time', 'professional'].map(field => ref(field, 'cancelar_amanda', 'para o horário dela')) });
    const valid = validateSelectionV2(selection(cancel, change));
    expect(valid.operations[1].same_as).toHaveLength(3);
    expect(valid.operations[1].depends_on).toEqual([]); // no execution edge from validation
  });
});

describe('ADD and PATCH', () => {
  const plan = { plan_ref: '40000000-0000-4000-8000-000000000001', actions: [
    { item_key: 'carla', operation: 'appointment.create', status: 'READY_FOR_CONFIRMATION', depends_on: [] },
    { item_key: 'antiga', operation: 'appointment.create', status: 'DISCARDED', depends_on: [] }] };
  it('ADD may reference an action of the active plan; never a discarded one', () => {
    on();
    const added = validateAddSelection(selection(rosa([ref('date', 'carla')])), plan);
    expect(added.operations[0]).toMatchObject({ item_key: 'rosa', same_as: [ref('date', 'carla')], depends_on: [] });
    expect(() => validateAddSelection(selection(rosa([ref('date', 'antiga')])), plan)).toThrow('SAME_AS_INVALID');
    // Without the plan's context the key is unknown.
    expect(() => validateSelectionV2(selection(rosa([ref('date', 'carla')])))).toThrow('SAME_AS_INVALID');
  });
  it('a PATCH delta never carries (or edits) a link', () => {
    on();
    const patches = (fields: Record<string, unknown>) => ({ operations: [{ item_key: 'carla', choice: null, fields }] });
    expect(() => validateExistingPlanPatches(patches({ same_as: [ref('date', 'antiga')] }), plan)).toThrow();
    expect(() => validateExistingPlanPatches({ operations: [{ item_key: 'carla', same_as: [ref('date', 'antiga')] }] }, plan)).toThrow('CONTINUATION_ACTION_MISMATCH');
    expect(validateExistingPlanPatches(patches({ time: '15:00' }), plan).operations[0]).not.toHaveProperty('same_as');
  });
  it('the decoder keeps a NEW reference through the decision envelope', async () => {
    on();
    const pair = (value: unknown, literal: string) => ({ value, literal });
    const turn = { turn: { mode: 'NEW', operations: [{ ...carla, weekday: pair(4, 'quinta') }, rosa([ref('date', 'carla')], { time: pair('15:00', 'às 15h') })] } };
    const decoded = await withConversationRouting(async () => decodeConversationTurn(turn, undefined, 'Marca a Carla quinta e a Rosa no mesmo dia às 15h')) as { new_request: CapabilitySelection };
    expect(decoded.new_request.operations.find(item => item.item_key === 'rosa')!.same_as).toEqual([ref('date', 'carla')]);
  });
});

describe('ActionPlan: preparation graph (execution edges plus links)', () => {
  // The runtime policy: one confirmation group per (preparation) component.
  const component = runtimeReviewConfiguration({});
  it('a link orders preparation and joins one confirmation group, never an execution dependency', () => {
    on();
    const plan = createActionPlan(selection(rosa([ref('date', 'carla')]), carla, op('bia', 'appointment.create', { customer_name: 'Bia' })), component);
    expect(plan.execution_order.indexOf('carla')).toBeLessThan(plan.execution_order.indexOf('rosa'));
    expect(plan.confirmation_groups.map(group => group.action_keys.sort())).toEqual(expect.arrayContaining([['carla', 'rosa'], ['bia']]));
    expect(plan.dependencies).toEqual([]);
    expect(plan.actions.find(action => action.key === 'rosa')!).toMatchObject({ depends_on: [], blocked_by: [], same_as: [ref('date', 'carla')] });
    expect(actionSelection(plan.actions.find(action => action.key === 'rosa')!).same_as).toEqual([ref('date', 'carla')]);
    // A failed referenced action does not block the dependent's execution (it only stops following).
    const failed = structuredClone(plan); failed.actions.find(action => action.key === 'carla')!.assessment = { status: 'FAILED_SAFE', missing_fields: [] };
    expect(refreshActionPlan(failed).actions.find(action => action.key === 'rosa')!.status).toBe('READY');
  });
  it('without links the plan is the historical one (no same_as key anywhere)', () => {
    const plan = createActionPlan(selection(carla, op('bia', 'appointment.create', { customer_name: 'Bia' })), component);
    expect(JSON.stringify(plan)).not.toContain('same_as');
    expect(plan.confirmation_groups.map(group => group.action_keys)).toEqual([['carla'], ['bia']]);
  });
  it('ADD: a link to an active action is kept on the added action and joins its group once combined', () => {
    on();
    const base = createActionPlan(selection(carla), component);
    const addition = createActionPlan(selection(rosa([ref('date', 'carla')])), base.policy, 'LUNA', base.actions.map(action => ({ item_key: action.key, operation: action.operation, status: action.status })));
    const combined = refreshActionPlan({ ...base, actions: [...base.actions, ...addition.actions] });
    expect(combined.confirmation_groups.map(group => group.action_keys)).toEqual([['carla', 'rosa']]);
    expect(combined.execution_order).toEqual(['carla', 'rosa']);
  });
});

describe('referenceLiteralProven (review): a sibling never proves this action\'s own negated reference', () => {
  const now = new Date('2026-09-28T12:00:00Z'), tz = 'America/Sao_Paulo';
  const message = 'Marca a Carla sexta às 10h, a Rosa no mesmo dia às 11h e o Fábio não no mesmo dia, às 15h';
  const clause = (text: string) => { const at = message.indexOf(text); return [at, at + text.length] as const; };
  it('without a verified clause a repeated literal proves nothing (either occurrence may be the negated one)', async () => {
    const { referenceLiteralProven } = await import('../secretary-same-as');
    expect(referenceLiteralProven(message, 'no mesmo dia', undefined, 'appointment.create', ['Carla'], tz, now)).toBe(false);
    expect(referenceLiteralProven(message, 'no mesmo dia', clause('o Fábio não no mesmo dia, às 15h'), 'appointment.create', ['Carla'], tz, now)).toBe(false);
    expect(referenceLiteralProven(message, 'no mesmo dia', clause('a Rosa no mesmo dia às 11h'), 'appointment.create', ['Carla'], tz, now)).toBe(true);
    expect(referenceLiteralProven('Marca a Carla sexta às 10h e a Rosa no mesmo dia às 11h', 'no mesmo dia', undefined, 'appointment.create', ['Carla'], tz, now)).toBe(true);
    expect(referenceLiteralProven('Marca a Carla sexta às 10h e o Fábio não no mesmo dia', 'no mesmo dia', undefined, 'appointment.create', ['Carla'], tz, now)).toBe(false);
  });
  it('"sem (ser)" denies a reference like a negator', async () => {
    const { referenceLiteralProven } = await import('../secretary-same-as');
    for (const text of ['Cancela a Carla de sexta e marca o Fábio sem ser no horário dela', 'Cancela a Carla de sexta e marca o Fábio sem no horário dela'])
      expect(referenceLiteralProven(text, 'no horário dela', undefined, 'appointment.change', ['Carla'], tz, now), text).toBe(false);
    expect(referenceLiteralProven('Cancela a Carla de sexta e passa o Fábio para o horário dela', 'para o horário dela', undefined, 'appointment.change', ['Carla'], tz, now)).toBe(true);
  });
  it('demonstratives point back like the pronouns ("nesse dia", "naquele horário"); the same denials apply', async () => {
    const { referenceLiteralProven } = await import('../secretary-same-as');
    const said = 'marca a rosa dia primeiro às nove e bloqueia a tatiana nesse dia das duas às quatro';
    expect(referenceLiteralProven(said, 'nesse dia', undefined, 'schedule.block', ['rosa'], tz, now)).toBe(true);
    expect(referenceLiteralProven('Marca a Carla sexta às 10h e o Fábio naquele horário', 'naquele horário', undefined, 'appointment.create', ['Carla'], tz, now)).toBe(true);
    expect(referenceLiteralProven('Marca a Carla sexta às 10h e o Fábio não nesse dia', 'nesse dia', undefined, 'appointment.create', ['Carla'], tz, now)).toBe(false);
    expect(referenceLiteralProven('Marca a Carla sexta às 10h e o Fábio nesse dia 30', 'nesse dia 30', undefined, 'appointment.create', ['Carla'], tz, now)).toBe(false);
    // Folded "está" is a verb, never a reference word.
    expect(referenceLiteralProven('Marca a Carla sexta às 10h e o Fábio quando está livre', 'quando está livre', undefined, 'appointment.create', ['Carla'], tz, now)).toBe(false);
  });
  it('review: a date/time reference is its whole temporal expression; a clipped one, a limit before it or an exclusion is refused', async () => {
    const { referenceLiteralProven } = await import('../secretary-same-as');
    const proven = (message: string, literal: string, field: 'date' | 'time', operation = 'appointment.create') =>
      referenceLiteralProven(message, literal, undefined, operation, ['Carla'], tz, now, field);
    // The owner's own day or clock right beside the reference: never replaced by the copied value (asked).
    expect(proven('Marca a Carla para Escova quinta às 14h e a Rosa para Coloração nesse dia 2 às 15h', 'nesse dia', 'date')).toBe(false);
    expect(proven('Marca a Carla para Escova quinta às 14h e a Rosa nesse dia dois às 15h', 'nesse dia', 'date')).toBe(false);
    expect(proven('Marca a Carla quinta às 14h e a Rosa no mesmo dia, sexta, às 15h', 'no mesmo dia', 'date')).toBe(false);
    expect(proven('Marca a Carla quinta às 14h e a Rosa nessa semana às 15h', 'nessa semana', 'date')).toBe(false);
    expect(proven('Marca a Carla quinta às 14h e a Rosa amanhã naquele horário das 3 da tarde', 'naquele horário', 'time')).toBe(false);
    // Exclusions and limits up to the reference.
    expect(proven('Marca a Carla quinta às 14h e a Rosa qualquer dia menos nesse dia, às 15h', 'nesse dia', 'date')).toBe(false);
    expect(proven('Marca a Carla quinta às 14h e a Rosa depois desse dia às 15h', 'desse dia', 'date')).toBe(false);
    expect(proven('Marca a Carla quinta às 14h e a Rosa exceto no mesmo dia', 'no mesmo dia', 'date')).toBe(false);
    // Kept: the motivating dev case, a clock or a limit AFTER the reference, "no horário dela", "no mesmo dia e horário".
    expect(proven('marca a rosa dia primeiro às nove pra coloração e bloqueia a tatiana nesse dia das duas às quatro da tarde', 'nesse dia', 'date', 'schedule.block')).toBe(true);
    expect(proven('Marca a Carla sexta às 10h e a Rosa no mesmo dia às 11h', 'no mesmo dia', 'date')).toBe(true);
    expect(proven('Marca a Carla sexta às 10h e bloqueia a Tatiana nesse dia até as 16h', 'nesse dia', 'date', 'schedule.block')).toBe(true);
    expect(proven('Cancela a Carla de sexta e passa o Fábio para o horário dela', 'para o horário dela', 'time', 'appointment.change')).toBe(true);
    expect(proven('Cancela a Carla de sexta e passa o Fábio para o horário dela', 'para o horário dela', 'date', 'appointment.change')).toBe(true);
    expect(proven('Marca a Carla sexta às 10h e o Fábio no mesmo dia e horário', 'no mesmo dia e horário', 'date')).toBe(true);
    expect(proven('Marca a Carla sexta às 10h e o Fábio no mesmo dia e horário', 'no mesmo dia e horário', 'time')).toBe(true);
    // Final battery (29/09, assistant holdout H21, now regression): "depois de amanhã" is a relative day, not a limit.
    expect(proven('Marca o Sérgio amanhã às 10h para barba e a Luíza depois de amanhã no mesmo horário para escova.', 'no mesmo horário', 'time')).toBe(true);
    expect(proven('Marca o Sérgio amanhã às 10h e a Luíza dps de amanha no mesmo horario', 'no mesmo horario', 'time')).toBe(true);
    expect(proven('Marca o Sérgio amanhã às 10h e a Luíza depois do mesmo horário', 'do mesmo horário', 'time')).toBe(false);
  });
  it('review: an occurrence differing only in case or accents counts for uniqueness and negation', async () => {
    const { referenceLiteralProven } = await import('../secretary-same-as');
    expect(referenceLiteralProven('Marca a Carla sexta às 10h, a Rosa nesse dia às 11h e o Fábio não Nesse dia, às 15h', 'nesse dia', undefined, 'appointment.create', ['Carla'], tz, now, 'date')).toBe(false);
    expect(referenceLiteralProven('Marca a Carla sexta às 10h, a Rosa no mesmo dia às 11h e o Fábio não No mesmo dia', 'no mesmo dia', undefined, 'appointment.create', ['Carla'], tz, now, 'date')).toBe(false);
  });
});
