import { afterEach, describe, expect, it, vi } from 'vitest';
import { validateSelectionV2, validateAddSelection, createActionPlan, checkReferences, sameAsReference, sameAsWire, sameAsInstructions, sameAsInstructionsV2, sameAsFields,
  withoutReleasedReferences, decisionInstructions, REFERENCES_V2_EDITS, withReferencesRule, type SelectedOperation } from '@everflair/salon-secretary';
import { selfReferenceProven, distributiveReferenceProven, readOrdinal, pickReadRow, referenceLiteralProven, type ReadRow } from '../secretary-same-as';
import { isFirstPersonReference } from '../secretary-first-person';
import { listSchedulingProfessionals } from '../scheduling-catalog';
import { suggestSchedulingProfessionals } from '../entity-suggestions';
import { actionUnits } from '../secretary-action-plan';
import type { Tx } from '../prisma-tenant';

/** P3a (flag SALON_SECRETARY_REFERENCES_V2, default off; the same_as parts also need SALON_SECRETARY_SAME_AS): the validation
 * matrix of the new links (self origin, service, reads as sources, a reschedule's origin as a released slot), the per-operation
 * rejection of an unsupported released slot, the structural literal proofs (self + genitive guard, distributive, closed-class
 * ordinal over the whole read) and the closed first-person class resolved only to the actor's own registration. Offline: no
 * model, no database (fake tenant transactions). Names are synthetic and diverse; no gender is inferred from any of them. */
afterEach(() => { vi.unstubAllEnvs(); });
const sameAs = () => vi.stubEnv('SALON_SECRETARY_SAME_AS', 'true');
const v2 = () => { sameAs(); vi.stubEnv('SALON_SECRETARY_REFERENCES_V2', 'true'); };
const neutral = { target_name: null, name: null, priceCents: null, durationMin: null, phone: null, email: null, requested_fields: [], clear_fields: [] };
const op = (item_key: string, operation: string, extra: Record<string, unknown> = {}) => ({ ...neutral, operation, item_key, depends_on: [], released_slot_of: null, source_scope: null, ...extra });
const ref = (field: string, item_key: string, literal = 'no mesmo horário') => ({ field, item_key, literal });
const selection = (...operations: Record<string, unknown>[]) => ({ disposition: 'SUPPORTED', conversation_response: null, unavailable_capability: null,
  skills: [...new Set(operations.map(item => item.operation === 'customer.message' ? 'communication' : 'scheduling'))],
  independent: !operations.some(item => (item.depends_on as string[] | null)?.length), operations });
const message = (item_key: string) => op(item_key, 'customer.message', { communication: { recipient_name: 'Iolanda', channel: null, message_mode: null, content: null } });

describe('flag off: the historical contract, byte for byte', () => {
  it('same wire item (enum, description), and a service reference does not even decode', () => {
    sameAs();
    const wire = sameAsWire({ type: 'string' }) as { description: string; anyOf: { items?: { properties: { field: { enum: string[] } } } }[] };
    expect(wire.description).toBe(sameAsInstructions);
    expect(wire.anyOf[0].items!.properties.field.enum).toEqual([...sameAsFields]);
    expect(sameAsReference.safeParse({ field: 'service', item_key: 'a', literal: 'mesmo serviço' }).success).toBe(false);
  });
  it('a change naming its own key, a released slot of a reschedule and a read as a source are refused as before', () => {
    sameAs();
    const change = op('teo', 'appointment.change', { customer_name: 'Téo', same_as: [ref('time', 'teo')] });
    expect(() => validateSelectionV2(selection(change))).toThrow('SAME_AS_INVALID');
    const move = op('teo', 'appointment.change', { customer_name: 'Téo' }), create = op('kaio', 'appointment.create', { customer_name: 'Kaio', depends_on: ['teo'], released_slot_of: 'teo' });
    for (const partial of [false, true]) expect(() => validateSelectionV2(selection(move, create), { partial })).toThrow('INVALID_DEPENDENCY_GRAPH');
    const list = op('agenda', 'appointment.list', { professional_name: 'Nara' });
    expect(() => validateSelectionV2(selection(list, op('bloqueio', 'schedule.block', { same_as: [ref('date', 'agenda', 'nesse dia')] })))).toThrow('SAME_AS_INVALID');
  });
  it('prompt and first-person class are inert', () => {
    for (const components of [false, true]) for (const jit of [false, true]) expect(decisionInstructions(components, jit, false)).toBe(decisionInstructions(components, jit, false, false));
    expect(decisionInstructions(false, false)).not.toContain('Profissional em 1ª pessoa');
    expect(isFirstPersonReference('minha')).toBe(false);
  });
});

describe('V2 validation matrix', () => {
  it.each([
    ['a change keeping its own origin clock', 'appointment.change', 'time', true],
    ['a change keeping its own origin day', 'appointment.change', 'date', true],
    ['a change naming its own professional', 'appointment.change', 'professional', false],
    ['a create naming itself', 'appointment.create', 'time', false],
    ['a block naming itself', 'schedule.block', 'date', false],
    ['a cancellation naming itself', 'appointment.cancel', 'customer', false],
  ])('self reference: %s', (_label, operation, field, valid) => {
    v2();
    const self = op('eu_mesmo', operation, { customer_name: 'Yasmin', same_as: [ref(field, 'eu_mesmo')] });
    if (valid) expect(validateSelectionV2(selection(self)).operations[0].same_as).toEqual([ref(field, 'eu_mesmo')]);
    else expect(() => validateSelectionV2(selection(self))).toThrow('SAME_AS_INVALID');
  });
  it.each([
    ['service of a create from a cancellation', 'appointment.create', 'appointment.cancel', 'service', true],
    ['service of a create from a change', 'appointment.create', 'appointment.change', 'service', true],
    ['service of a create from another create', 'appointment.create', 'appointment.create', 'service', true],
    ['service of a change (only a create follows a service)', 'appointment.change', 'appointment.cancel', 'service', false],
    ['service from a block', 'appointment.create', 'schedule.block', 'service', false],
    ['service from a message', 'appointment.create', 'customer.message', 'service', false],
    ['day from a list', 'schedule.block', 'appointment.list', 'date', true],
    ['professional from availability', 'appointment.create', 'availability.get', 'professional', true],
    ['customer from a list (one of its rows)', 'appointment.change', 'appointment.list', 'customer', true],
    ['customer from availability', 'appointment.change', 'availability.get', 'customer', false],
    ['clock from a list', 'appointment.create', 'appointment.list', 'time', false],
  ])('%s', (_label, target, source, field, valid) => {
    v2();
    const from = source === 'customer.message' ? message('fonte') : op('fonte', source, { customer_name: 'Hiroshi' });
    const to = op('alvo', target, { customer_name: 'Maria Eduarda', same_as: [ref(field, 'fonte', 'o mesmo')] });
    if (valid) expect(validateSelectionV2(selection(from, to)).operations[1].same_as).toHaveLength(1);
    else expect(() => validateSelectionV2(selection(from, to))).toThrow('SAME_AS_INVALID');
  });
  it('beside released_slot_of only the service link stays, is checked (never skipped) and names the releaser only', () => {
    v2();
    const cancel = op('saida', 'appointment.cancel', { customer_name: 'Luz' }), other = op('outra', 'appointment.cancel', { customer_name: 'Céu' });
    const create = (refs: unknown[]) => op('entrada', 'appointment.create', { customer_name: 'Nando', depends_on: ['saida'], released_slot_of: 'saida', same_as: refs });
    const kept = validateSelectionV2(selection(cancel, create([ref('time', 'saida', 'no horário dela'), ref('service', 'saida', 'pro mesmo serviço')])));
    expect(kept.operations[1].same_as).toEqual([ref('service', 'saida', 'pro mesmo serviço')]);
    expect(() => validateSelectionV2(selection(cancel, other, create([ref('service', 'outra', 'pro mesmo serviço')])))).toThrow('SAME_AS_INVALID');
    expect(() => validateSelectionV2(selection(cancel, create([ref('service', 'saida', 'mesmo'), ref('service', 'saida', 'igual')])))).toThrow('SAME_AS_INVALID');
    expect(() => validateSelectionV2(selection(cancel, create([ref('service', 'fantasma', 'mesmo')])))).toThrow('SAME_AS_INVALID');
    expect(withoutReleasedReferences({ released_slot_of: 'saida', same_as: [ref('date', 'saida'), ref('service', 'saida', 'mesmo serviço')] })).toEqual({ released_slot_of: 'saida', same_as: [ref('service', 'saida', 'mesmo serviço')] });
    expect(withoutReleasedReferences({ released_slot_of: 'saida', same_as: [ref('date', 'saida')] })).toEqual({ released_slot_of: 'saida' });
  });
  it('checkReferences with the SAME_AS flag off still refuses any reference (V2 alone publishes none)', () => {
    vi.stubEnv('SALON_SECRETARY_REFERENCES_V2', 'true');
    expect(() => checkReferences({ item_key: 'a', operation: 'appointment.change', same_as: [ref('time', 'a') as never] }, new Map())).toThrow('CAPABILITY_FIELD_MISMATCH');
  });
});

describe('D1: the origin of a reschedule is a released slot; an unsupported releaser fails only its operation', () => {
  const move = op('troca', 'appointment.change', { customer_name: 'Kevin', source_scope: 'passa o Kevin pra sexta' });
  const fill = (releaser: string) => op('vaga', 'appointment.create', { customer_name: 'Bia', depends_on: [releaser], released_slot_of: releaser });
  it('strict and partial accept change → create{released_slot_of}; the plan makes two single units, the create after the change', () => {
    v2();
    for (const partial of [false, true]) expect(validateSelectionV2(selection(move, fill('troca')), { partial }).operations[1]).toMatchObject({ released_slot_of: 'troca', depends_on: ['troca'] });
    const plan = createActionPlan(selection(move, fill('troca')));
    expect(actionUnits(plan)).toEqual([{ keys: ['troca'], kind: 'single' }, { keys: ['vaga'], kind: 'single' }]);
    expect(plan.execution_order).toEqual(['troca', 'vaga']);
    expect(plan.confirmation_groups.find(group => group.action_keys.includes('vaga'))!.action_keys).toEqual(['troca', 'vaga']);
    // The cancellation pair stays the atomic batch.
    const cancel = op('troca', 'appointment.cancel', { customer_name: 'Kevin' });
    expect(actionUnits(createActionPlan(selection(cancel, fill('troca'))))[0]).toMatchObject({ keys: ['troca', 'vaga'], kind: 'scheduling-batch' });
  });
  it('partial: a released slot of a block is RELEASED_SLOT_UNSUPPORTED for that operation; its dependent follows it out; the rest stays', () => {
    v2();
    const block = op('pausa', 'schedule.block', { professional_name: 'Jonas' }), after = op('aviso', 'appointment.cancel', { customer_name: 'Duda', depends_on: ['vaga'] });
    const valid = validateSelectionV2(selection(move, fill('pausa'), block, after), { partial: true });
    expect(valid.operations.map(item => item.item_key)).toEqual(['troca', 'pausa']);
    expect(valid.rejected).toMatchObject([{ item_key: 'vaga', code: 'RELEASED_SLOT_UNSUPPORTED', dependent: false }, { item_key: 'aviso', code: 'DEPENDENT_OF_REJECTED', dependent: true }]);
    // Strict mode still throws; with every operation invalid the first failure is thrown, as today.
    expect(() => validateSelectionV2(selection(move, fill('pausa'), block))).toThrow('INVALID_DEPENDENCY_GRAPH');
    const broken = op('pausa', 'schedule.block', { professional_name: 'Jonas', destination_mode: 'SAME_RELEASED_SLOT' });
    expect(() => validateSelectionV2(selection(broken, fill('pausa')), { partial: true })).toThrow('CAPABILITY_FIELD_MISMATCH');
    expect(() => validateSelectionV2(selection(fill('pausa'), broken), { partial: true })).toThrow('RELEASED_SLOT_UNSUPPORTED');
  });
  it('genuine graph defects stay turn-fatal: unknown key, released slot outside depends_on, a cycle beside a bad target', () => {
    v2();
    expect(() => validateSelectionV2(selection(move, op('vaga', 'appointment.create', { depends_on: ['troca'], released_slot_of: 'fantasma' })), { partial: true })).toThrow('INVALID_DEPENDENCY_GRAPH');
    expect(() => validateSelectionV2(selection(move, op('vaga', 'appointment.create', { depends_on: ['troca'], released_slot_of: 'outra' }), op('outra', 'appointment.cancel')), { partial: true })).toThrow('INVALID_DEPENDENCY_GRAPH');
    const cyclic = [op('a', 'appointment.change', { depends_on: ['b'] }), op('b', 'appointment.create', { depends_on: ['a'], released_slot_of: 'a' })];
    expect(() => validateSelectionV2(selection(...cyclic), { partial: true })).toThrow();
  });
  it('ADD: a create in the origin of a reschedule already in the active plan', () => {
    v2();
    const plan = { plan_ref: '40000000-0000-4000-8000-000000000001', actions: [{ item_key: 'troca', operation: 'appointment.change', status: 'READY_FOR_CONFIRMATION', depends_on: [] }] };
    const added = validateAddSelection({ skills: ['scheduling'], independent: false, operations: [fill('troca')] }, plan as never);
    expect(added.operations[0]).toMatchObject({ released_slot_of: 'troca', depends_on: ['troca'] });
    vi.stubEnv('SALON_SECRETARY_REFERENCES_V2', 'false');
    expect(() => validateAddSelection({ skills: ['scheduling'], independent: false, operations: [fill('troca')] }, plan as never)).toThrow('INVALID_DEPENDENCY_GRAPH');
  });
  it('ADD into a pending cancellation: "o mesmo serviço" of that cancellation is kept (other links dropped); off, refused as before', () => {
    v2();
    const plan = { plan_ref: '40000000-0000-4000-8000-000000000002', actions: [{ item_key: 'saida', operation: 'appointment.cancel', status: 'READY_FOR_CONFIRMATION', depends_on: [] }] };
    const add = op('entrada', 'appointment.create', { customer_name: 'Nando', depends_on: ['saida'], released_slot_of: 'saida',
      same_as: [ref('service', 'saida', 'pro mesmo serviço'), ref('time', 'saida', 'no horário dela')] });
    expect(validateAddSelection({ skills: ['scheduling'], independent: false, operations: [add] }, plan as never).operations[0])
      .toMatchObject({ released_slot_of: 'saida', depends_on: ['saida'], same_as: [ref('service', 'saida', 'pro mesmo serviço')] });
    vi.stubEnv('SALON_SECRETARY_REFERENCES_V2', 'false');
    expect(() => validateAddSelection({ skills: ['scheduling'], independent: false, operations: [add] }, plan as never)).toThrow();
  });
});

const tz = 'America/Sao_Paulo', now = new Date('2026-09-28T15:00:00Z');
const within = (text: string, part: string) => { const at = text.indexOf(part); return [at, at + part.length] as const; };
describe('D-SELF-ORIGIN proof: identity marker in the own clause, never negated, never a genitive complement', () => {
  const sentence = 'passa a Lia pra sexta no mesmo horário';
  it('proves the plain self reference', () => {
    v2();
    expect(selfReferenceProven(sentence, 'no mesmo horário', within(sentence, sentence), 'appointment.change', tz, now, 'time')).toBe(true);
  });
  it.each([
    ['a genitive name after the literal', 'passa a Lia pra sexta no mesmo horário da Bia', 'no mesmo horário'],
    ['a possessive pronoun after the literal', 'passa a Lia pra sexta no mesmo horário dela', 'no mesmo horário'],
    ['a genitive inside the literal', 'passa a Lia pra sexta no mesmo horário do Téo', 'no mesmo horário do Téo'],
    ['a negated literal', 'passa a Lia pra sexta, mas não no mesmo horário', 'no mesmo horário'],
    ['"sem ser"', 'passa a Lia pra sexta sem ser no mesmo horário', 'no mesmo horário'],
    ['a literal with its own clock', 'passa a Lia pra sexta às 15h', 'às 15h'],
    ['a literal absent from the message (another turn)', 'passa a Lia pra sexta', 'no mesmo horário'],
  ])('refuses %s', (_label, text, literal) => {
    v2();
    expect(selfReferenceProven(text, literal, within(text, text), 'appointment.change', tz, now, 'time')).toBe(false);
  });
});

const decoded = (item_key: string, operation: string, source_scope: string, extra: Record<string, unknown> = {}) => op(item_key, operation, { source_scope, ...extra }) as unknown as SelectedOperation;
describe('D4 distributive proof: the span the sibling quotes, said once, never contradicted in the own clause', () => {
  const text = 'marca a Lia amanhã às 10h com a Nara e bloqueia a agenda dela das 14 às 15';
  const create = decoded('lia', 'appointment.create', 'marca a Lia amanhã às 10h com a Nara', { customer_name: 'Lia', professional_name: 'Nara', day_offset: 1, time: '10:00',
    temporal_evidence: [{ field: 'date', text: 'amanhã' }, { field: 'time', text: 'às 10h' }] });
  const own = within(text, 'bloqueia a agenda dela das 14 às 15'), sibling = { op: create, clause: within(text, 'marca a Lia amanhã às 10h com a Nara') };
  const clauses = [sibling.clause, own];
  it('a sibling-span literal with no day in the own clause is proven (date and professional)', () => {
    v2();
    expect(distributiveReferenceProven(text, 'amanhã', 'date', own, sibling, clauses, 'schedule.block')).toBe(true);
    expect(distributiveReferenceProven(text, 'com a Nara', 'professional', own, sibling, clauses, 'schedule.block')).toBe(true);
  });
  it('a shared prefix proves it for both actions', () => {
    v2();
    const shared = 'Amanhã: marca a Lia às 10h e bloqueia a Nara das 14 às 15';
    const first = decoded('lia', 'appointment.create', 'marca a Lia às 10h', { customer_name: 'Lia', day_offset: 1, temporal_evidence: [{ field: 'date', text: 'Amanhã' }] });
    const block = within(shared, 'bloqueia a Nara das 14 às 15'), mine = within(shared, 'marca a Lia às 10h');
    expect(distributiveReferenceProven(shared, 'Amanhã', 'date', block, { op: first, clause: mine }, [mine, block], 'schedule.block')).toBe(true);
  });
  it.each([
    ['an own weekday in this clause', 'marca a Lia amanhã às 10h e a Bia sexta às 11h', 'a Bia sexta às 11h'],
    ['a negator in this clause', 'marca a Lia amanhã às 10h e a Bia não, só semana que vem', 'a Bia não, só semana que vem'],
    ['an alterity word in this clause', 'marca a Lia amanhã às 10h e a Bia em outro dia às 11h', 'a Bia em outro dia às 11h'],
  ])('refuses %s', (_label, sentence, clause) => {
    v2();
    const first = decoded('lia', 'appointment.create', 'marca a Lia amanhã às 10h', { customer_name: 'Lia', day_offset: 1, temporal_evidence: [{ field: 'date', text: 'amanhã' }] });
    const mine = within(sentence, 'marca a Lia amanhã às 10h'), theirs = within(sentence, clause);
    expect(distributiveReferenceProven(sentence, 'amanhã', 'date', theirs, { op: first, clause: mine }, [mine, theirs], 'appointment.create')).toBe(false);
  });
  it('"com outra profissional" is never the shared professional; a quote the sibling did not make never proves', () => {
    v2();
    const sentence = 'marca a Lia amanhã com a Nara e a Bia às 11h com outra profissional';
    const first = decoded('lia', 'appointment.create', 'marca a Lia amanhã com a Nara', { customer_name: 'Lia', professional_name: 'Nara', day_offset: 1, temporal_evidence: [{ field: 'date', text: 'amanhã' }] });
    const mine = within(sentence, 'marca a Lia amanhã com a Nara'), theirs = within(sentence, 'a Bia às 11h com outra profissional');
    expect(distributiveReferenceProven(sentence, 'com a Nara', 'professional', theirs, { op: first, clause: mine }, [mine, theirs], 'appointment.create')).toBe(false);
    // Two siblings with different days: a link is valid only to the sibling whose own quote it cites.
    const three = 'marca a Lia amanhã, o Téo sexta e a Bia às 11h';
    const teo = decoded('teo', 'appointment.create', 'o Téo sexta', { customer_name: 'Téo', weekday: 5, temporal_evidence: [{ field: 'date', text: 'sexta' }] });
    const bia = within(three, 'a Bia às 11h'), lia = within(three, 'marca a Lia amanhã'), teoAt = within(three, 'o Téo sexta');
    expect(distributiveReferenceProven(three, 'amanhã', 'date', bia, { op: teo, clause: teoAt }, [lia, teoAt, bia], 'appointment.create')).toBe(false);
    expect(distributiveReferenceProven(three, 'sexta', 'date', bia, { op: teo, clause: teoAt }, [lia, teoAt, bia], 'appointment.create')).toBe(true);
    // A literal from another turn is not in this message.
    expect(distributiveReferenceProven('bloqueia a Nara das 14 às 15', 'amanhã', 'date', [0, 28], { op: first }, [[0, 28]], 'schedule.block')).toBe(false);
  });
  it('without a verified own clause, or for a clock, nothing is distributive', () => {
    v2();
    expect(distributiveReferenceProven(text, 'amanhã', 'date', undefined, sibling, clauses, 'schedule.block')).toBe(false);
    expect(distributiveReferenceProven(text, 'às 10h', 'time', own, sibling, clauses, 'schedule.block')).toBe(false);
  });
});

const row = (index: number, start: string, status = 'CONFIRMED', future = true): ReadRow => ({ appointment_ref: `apt-${index}`, customer_ref: `cli-${index}`, customer_name: ['Jade Moura', 'Kevin Sato', 'Luz Andrade', 'Nando Ribeiro'][index],
  professional_name: 'Nara Quintela', start_local: start, start_at: future ? '2026-10-01T12:00:00Z' : '2026-09-28T12:00:00Z', status });
describe('D2: a closed-class ordinal ranked over the WHOLE read, then refused if not mutable', () => {
  it('closed class; "segundo/segunda" excluded (the weekday); two ordinals are no ordinal', () => {
    expect(readOrdinal('o último cliente dela')).toBe('last');
    expect(readOrdinal('a primeira')).toBe('first');
    expect(readOrdinal('o penúltimo')).toBe('penultimate');
    expect(readOrdinal('a segunda cliente dela')).toBeUndefined();
    expect(readOrdinal('o primeiro e o último')).toBeUndefined();
  });
  it('the last of three rows as shown, whatever order they came in', () => {
    const rows = [row(1, '2026-09-29T11:00'), row(2, '2026-09-29T16:00'), row(0, '2026-09-29T09:00')];
    expect(pickReadRow(rows, 'o último cliente dela', now)).toMatchObject({ kind: 'ROW', row: { appointment_ref: 'apt-2' } });
    expect(pickReadRow(rows, 'a primeira', now)).toMatchObject({ kind: 'ROW', row: { appointment_ref: 'apt-0' } });
  });
  it('the first already started is refused, never replaced by the second', () => {
    const rows = [row(0, '2026-09-28T09:00', 'IN_PROGRESS', false), row(1, '2026-09-28T16:00')];
    // Fixer (review A): "hoje" restates the read's own day (today's read); a day word the read does not have is a card instead.
    expect(pickReadRow(rows, 'o primeiro cliente dela hoje', now, true, [], new Set(['hoje']))).toMatchObject({ kind: 'REFUSED', row: { appointment_ref: 'apt-0' } });
  });
  it('a tie at the position, no ordinal among several rows, or an ordinal that cannot be computed: a card, never a pick', () => {
    expect(pickReadRow([row(0, '2026-09-29T09:00'), row(1, '2026-09-29T16:00'), row(2, '2026-09-29T16:00')], 'o último', now)).toMatchObject({ kind: 'CARD', rows: [{ appointment_ref: 'apt-1' }, { appointment_ref: 'apt-2' }] });
    expect(pickReadRow([row(0, '2026-09-29T09:00'), row(1, '2026-09-29T16:00')], 'a segunda cliente dela', now)).toMatchObject({ kind: 'CARD' });
    expect(pickReadRow([row(0, '2026-09-29T09:00')], 'o penúltimo', now)).toMatchObject({ kind: 'CARD' });
    expect(pickReadRow([row(0, '2026-09-29T09:00')], 'a cliente dela', now)).toMatchObject({ kind: 'ROW', row: { appointment_ref: 'apt-0' } });
    expect(pickReadRow([], 'o último', now)).toEqual({ kind: 'NONE' });
  });
  it('"todos menos o último" and "não o último" are never proven as a reference', () => {
    const text = 'vê a agenda da Nara amanhã e passa todos menos o último pra sexta';
    expect(referenceLiteralProven(text, 'menos o último', within(text, 'passa todos menos o último pra sexta'), 'appointment.change', ['Nara'], tz, now, 'customer')).toBe(false);
    const negated = 'vê a agenda da Nara amanhã e não passa o último dela';
    expect(referenceLiteralProven(negated, 'o último dela', within(negated, 'não passa o último dela'), 'appointment.change', ['Nara'], tz, now, 'customer')).toBe(false);
  });
});

describe('E2: the closed first-person class resolves only to the actor\'s own active registration here', () => {
  it.each(['meu', 'Minha', 'comigo', 'eu', 'mim', 'o meu', 'a minha', 'MEUS', 'minha.'])('accepts %s', value => { v2(); expect(isFirstPersonReference(value)).toBe(true); });
  // FX6 contract migration (owner rule 5, 29/09): "minha agenda" is the owner's own agenda (secretary-fx6-review.test.ts); a first-person
  // word beside any other noun still is not ("minha cliente").
  it.each(['me', 'nosso', 'nossa', 'minha cliente', 'Meire', 'Mateus', 'Romeu', 'Eduardo', 'Eulália', ''])('rejects %s', value => { v2(); expect(isFirstPersonReference(value)).toBe(false); });
  function fakeTx(own: { id: string; user: { name: string } } | null) {
    const findFirst = vi.fn(async () => own), findMany = vi.fn(async () => [{ id: 'pro-romeu', user: { name: 'Romeu Tavares' } }, { id: 'pro-eduardo', user: { name: 'Eduardo Lins' } }]);
    const tx = { $queryRaw: vi.fn(async (q: readonly string[]) => { const sql = q.join(''); return sql.includes('"Membership"') ? [{ role: 'OWNER' }] : sql.includes('FROM "Salon"') ? [{ accessStatus: 'APPROVED' }] : [{ id: 'pro-romeu' }, { id: 'pro-eduardo' }]; }),
      membership: { findFirstOrThrow: vi.fn(async () => ({ role: 'OWNER' })) }, salon: { findUnique: vi.fn(async () => ({ accessStatus: 'APPROVED' })) },
      professional: { findFirst, findMany } } as unknown as Tx;
    return { tx, findFirst, findMany };
  }
  const actor = { salonId: 'salao-a', userId: 'usuario-1' };
  it('"meu" never searches names (Romeu, Eduardo in the team): only salonId + userId + active, with the service filter', async () => {
    v2();
    const { tx, findFirst, findMany } = fakeTx({ id: 'pro-self', user: { name: 'Caio Brito' } });
    expect(await listSchedulingProfessionals(tx, actor, { query: 'meu', service_ref: 'svc-corte' }).catch(error => { throw error; })).toEqual([{ id: 'pro-self', name: 'Caio Brito' }]);
    expect(findMany).not.toHaveBeenCalled();
    expect(findFirst).toHaveBeenCalledWith(expect.objectContaining({ where: expect.objectContaining({ salonId: 'salao-a', userId: 'usuario-1', active: true,
      services: { some: { serviceId: 'svc-corte', service: { salonId: 'salao-a', active: true } } } }) }));
  });
  it('the actor with no active registration in THIS salon: nobody (never another professional)', async () => {
    v2();
    const { tx, findMany } = fakeTx(null);
    expect(await listSchedulingProfessionals(tx, actor, { query: 'eu' })).toEqual([]);
    expect(findMany).not.toHaveBeenCalled();
  });
  it('suggestions never fuzzy-match a pronoun; with the flag off "eu" is an ordinary (substring) name query', async () => {
    v2();
    const { tx, findMany } = fakeTx(null);
    expect(await suggestSchedulingProfessionals(tx, actor, { query: 'meu' })).toEqual({ status: 'NONE' });
    expect(findMany).not.toHaveBeenCalled();
    vi.stubEnv('SALON_SECRETARY_REFERENCES_V2', 'false');
    const off = fakeTx(null);
    await listSchedulingProfessionals(off.tx, actor, { query: 'eu' });
    expect(off.findMany).toHaveBeenCalled();
  });
});

describe('prompt (V2): each rule amends its own sentence once, in every composition', () => {
  it('every target exists (checked replace) and the result states each new rule once', () => {
    v2();
    for (const components of [false, true]) for (const jit of [false, true]) for (const alter of [false, true]) {
      const text = decisionInstructions(components, jit, alter, true);
      for (const [target, replacement] of REFERENCES_V2_EDITS) { expect(text.split(replacement).length - 1).toBe(1); if (!replacement.includes(target)) expect(text).not.toContain(target); }
      expect(text).toBe(withReferencesRule(decisionInstructions(components, jit, alter, false)));
    }
  });
  it('the V2 description names every new link kind once and keeps "literal: só a expressão" (the distributive exception is explicit)', () => {
    for (const phrase of ["'pro mesmo serviço' = service", 'Dito uma vez para várias ações', 'item_key dela mesma', 'Consulta da agenda é fonte', 'literal: só a expressão de referência'])
      expect(sameAsInstructionsV2.split(phrase).length - 1).toBe(1);
  });
});
