import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { decodeConversationTurn, selectionTransportSchemaV2, validateExistingPlanPatches, validateSelection, validateSelectionV2, withServiceListObserver, withoutRedundantServiceList,
  sameAsInstructionsV2, alterationInstruction, type SelectedOperation } from '@everflair/salon-secretary';
import { intent, plan } from '../../test/secretary-capability-plan';
import { ownLiteralSpan, ownLiteralValue, statedClockComponent, statedDayComponent, statedServiceSpan, withOwnLiteral } from '../secretary-same-as';
import { projectSchedulingOperation } from '../secretary-operation-projection';
import { groundSchedulingTemporalTurn } from '../scheduling-temporal-mode';

/** C4 R-B (Candidate 4, references and normalization). Diverse synthetic names (a spa, a nail studio, a barbershop); no gender is
 * inferred from any name. (1) A one-entry service list beside the same service_name on an operation that takes no list is
 * redundant: dropped with SERVICE_NAMES_REDUNDANT (flag SALON_SECRETARY_MULTI_SERVICE); anything else stays refused. (2) A same_as
 * literal that only states THIS action's own value in its own clause is that value, proven by the ordinary grounding, never the
 * referenced action's (flag SALON_SECRETARY_REFERENCES_V2); a reference that also states a value, a negated or foreign literal, and
 * a time literal that states only a day are asked as before. (3)/(4) The instruction texts carry the move-into-a-cancellation rule
 * and the "put a service on someone's appointment" construction. */
const tz = 'America/Sao_Paulo', now = new Date('2026-09-28T15:00:00Z'), today = '2026-09-28'; // Monday
afterEach(() => { vi.unstubAllEnvs(); });
const within = (message: string, part: string) => { const at = message.indexOf(part); if (at < 0) throw Error('clause'); return [at, at + part.length] as const; };
const scheduling = (operation: string, fields: Record<string, unknown> = {}) => ({ ...intent(operation), item_key: 'b', depends_on: [], released_slot_of: null, source_scope: null,
  customer_name: null, service_name: null, service_names: null, professional_name: null, date: null, day_offset: null, weekday: null, time: null, period: null, source_date: null,
  source_day_offset: null, source_weekday: null, source_time: null, end_time: null, end_date: null, reason: null, temporal_evidence: null, ...fields }) as unknown as SelectedOperation;

describe('(1) a redundant one-entry service list on an operation that takes none (flag SALON_SECRETARY_MULTI_SERVICE)', () => {
  const on = () => vi.stubEnv('SALON_SECRETARY_MULTI_SERVICE', 'true');
  const cancel = (fields: Record<string, unknown>) => ({ ...intent('appointment.cancel'), item_key: 'a', customer_name: 'Iara Tupinambá', reason: 'ela vai viajar', ...fields });
  const one = (op: Record<string, unknown>) => validateSelectionV2(selectionTransportSchemaV2.parse({ ...plan([op as ReturnType<typeof intent>]), operations: [op] }));
  const observed = <T>(task: () => T) => { const codes: string[] = []; const value = withServiceListObserver(code => codes.push(code), task); return { value, codes }; };
  it('a cancel with service_names [x] beside service_name x (case/accents folded) keeps the operation and drops the list, with a code', () => {
    on();
    for (const [name, listed] of [['Ofurô', 'ofuro'], ['massagem relaxante', 'Massagem Relaxante'], ['drenagem', 'drenagem']]) {
      const { value, codes } = observed(() => one(cancel({ service_name: name, service_names: [listed] })));
      expect(value.operations[0]).toMatchObject({ operation: 'appointment.cancel', service_name: name, service_names: null });
      expect(codes).toEqual(['SERVICE_NAMES_REDUNDANT']);
    }
    // The V1 validator and the other operations without a list (change, list, read, block) follow the same rule.
    expect(validateSelection({ ...plan([cancel({}) as ReturnType<typeof intent>]), operations: [cancel({ service_name: 'Ofurô', service_names: ['ofurô'] })] }).operations[0].service_names).toBeNull();
    for (const operation of ['appointment.change', 'appointment.list', 'appointment.read', 'schedule.block'])
      expect(one({ ...intent(operation), item_key: 'a', service_name: 'escova', service_names: ['Escova'] }).operations[0].service_names).toBeNull();
  });
  it('adversarial: any other list stays CAPABILITY_FIELD_MISMATCH (another service, two entries, no service_name), with no code', () => {
    on();
    for (const fields of [{ service_name: 'drenagem', service_names: ['massagem'] }, { service_name: 'drenagem', service_names: ['drenagem', 'drenagem'] },
      { service_name: 'drenagem', service_names: ['drenagem', 'ofurô'] }, { service_name: null, service_names: ['drenagem'] }, { service_name: 'drenagem', service_names: ['drenagem linfática'] }]) {
      const codes: string[] = [];
      expect(() => withServiceListObserver(code => codes.push(code), () => one(cancel(fields))), JSON.stringify(fields)).toThrow('CAPABILITY_FIELD_MISMATCH');
      expect(codes).toEqual([]);
    }
  });
  it('an operation that takes a list keeps it untouched; the released-slot create drops only a redundant one', () => {
    on();
    const { value, codes } = observed(() => one({ ...intent('appointment.create'), item_key: 'a', customer_name: 'Bento Lacerda', service_name: 'gel', service_names: ['gel'] }));
    expect(value.operations[0]).toMatchObject({ service_names: ['gel'] }); expect(codes).toEqual([]);
    const released = (service_names: string[]) => selectionTransportSchemaV2.parse({ skills: ['scheduling'], independent: false, operations: [cancel({ service_name: null }),
      { ...intent('appointment.create'), item_key: 'b', depends_on: ['a'], released_slot_of: 'a', customer_name: 'Bento Lacerda', service_name: 'gel', service_names }] });
    expect(validateSelectionV2(released(['Gel'])).operations[1]).toMatchObject({ service_name: 'gel', service_names: null });
    expect(() => validateSelectionV2(released(['gel', 'pé']))).toThrow('CAPABILITY_FIELD_MISMATCH');
    expect(() => validateSelectionV2(released(['pé']))).toThrow('CAPABILITY_FIELD_MISMATCH');
  });
  it('flag off: unchanged, the list is refused and nothing is emitted', () => {
    vi.stubEnv('SALON_SECRETARY_MULTI_SERVICE', 'false');
    const codes: string[] = [];
    expect(() => withServiceListObserver(code => codes.push(code), () => one(cancel({ service_name: 'drenagem', service_names: ['drenagem'] })))).toThrow('CAPABILITY_FIELD_MISMATCH');
    const op = { operation: 'appointment.cancel', service_name: 'drenagem', service_names: ['drenagem'] };
    expect(withoutRedundantServiceList(op)).toBe(op); expect(codes).toEqual([]);
  });
  it('the decoded turn (partial acceptance) keeps the cancel and emits the code once; a PATCH delta is normalized the same way', () => {
    on();
    const message = 'cancela a massagem da Iara do dia 1, ela vai viajar';
    const turn = { turn: { mode: 'NEW', operations: [{ operation: 'appointment.cancel', item_key: 'a', depends_on: null, released_slot_of: null, same_as: null, source_scope: message,
      customer_name: 'Iara', service_names: ['massagem'], service_name: 'massagem', professional_name: null, date: { value: '2026-10-01', literal: 'dia 1' }, time: null, period: null,
      source_date: null, source_time: null, end_time: null, end_date: null, reason: 'ela vai viajar', target_professional_name: null, service_changes: null }] } };
    const { value, codes } = observed(() => decodeConversationTurn(turn, undefined, message) as { operations: SelectedOperation[]; rejected?: unknown[] });
    expect(value.operations).toHaveLength(1); expect(value.rejected ?? []).toEqual([]);
    expect(value.operations[0]).toMatchObject({ operation: 'appointment.cancel', service_name: 'massagem', service_names: null, reason: 'ela vai viajar' });
    expect(codes).toEqual(['SERVICE_NAMES_REDUNDANT']);
    const active = { plan_ref: '30000000-0000-4000-8000-000000000003', actions: [{ item_key: 'a', operation: 'appointment.cancel', status: 'NEEDS_INPUT', depends_on: [] }] };
    const patched = validateExistingPlanPatches({ operations: [{ item_key: 'a', fields: { service_name: 'Ofurô', service_names: ['ofuro'], reason: 'ela vai viajar' } }] }, active);
    expect(patched.operations[0]).toMatchObject({ service_name: 'Ofurô', service_names: null });
    expect(() => validateExistingPlanPatches({ operations: [{ item_key: 'a', fields: { service_name: 'Ofurô', service_names: ['massagem'] } }] }, active)).toThrow('CAPABILITY_FIELD_MISMATCH');
  });
});

describe('(2) a same_as literal that states this action\'s own value (flag SALON_SECRETARY_REFERENCES_V2)', () => {
  beforeEach(() => { vi.stubEnv('SALON_SECRETARY_SAME_AS', 'true'); vi.stubEnv('SALON_SECRETARY_REFERENCES_V2', 'true'); vi.stubEnv('SALON_SECRETARY_TEMPORAL_COMPONENTS', 'true'); });
  const message = 'marca o Kauã depois de amanhã de manhã às 9 pra barba e a Yara tb depois de amanhã às 11 pra escova';
  const clause = within(message, 'e a Yara tb depois de amanhã às 11 pra escova');
  const yara = (fields: Record<string, unknown> = {}) => scheduling('appointment.create', { customer_name: 'Yara', service_name: 'escova', source_scope: message.slice(...clause),
    temporal_evidence: [{ field: 'time', text: 'às 11', component: { hour: 11, minute: 0, daypart: 'UNSPECIFIED' } }], ...fields });
  it('a day literal inside this action\'s own clause is its own day (RELATIVE_DAY 2 = 30/09), proven by the ordinary grounding', () => {
    const span = ownLiteralSpan(message, 'depois de amanha', clause, 'appointment.create', ['Kauã Ribeiro'], 'date')!;
    expect(message.slice(...span)).toBe('depois de amanhã'); expect(span[0]).toBeGreaterThanOrEqual(clause[0]); // Yara's occurrence, never Kauã's
    expect(statedDayComponent('depois de amanhã', today, 'appointment.create')).toMatchObject({ kind: 'RELATIVE_DAY', offset: 2 });
    const own = ownLiteralValue(yara(), message, span, 'date', message.slice(...clause), tz, now);
    expect(own).toMatchObject({ field: 'date', text: 'depois de amanhã', component: { kind: 'RELATIVE_DAY', offset: 2 } });
    const projected = projectSchedulingOperation(withOwnLiteral(yara(), own!));
    const grounded = groundSchedulingTemporalTurn({}, projected.fields, message.slice(...clause), tz, now, undefined, projected.operation, projected.temporal_evidence);
    expect(grounded.patch).toMatchObject({ date: '2026-09-30', time: '11:00' });
  });
  it('a time literal that states only a day grounds nothing for time; a clock literal is the clock as said', () => {
    expect(statedClockComponent('depois de amanhã', 'appointment.create')).toBeUndefined();
    const span = ownLiteralSpan(message, 'depois de amanhã', clause, 'appointment.create', ['Kauã'], 'time')!;
    expect(ownLiteralValue(yara({ temporal_evidence: null }), message, span, 'time', message.slice(...clause), tz, now)).toBeUndefined();
    expect(statedClockComponent('às 11', 'appointment.create')).toEqual({ hour: 11, minute: 0, daypart: 'UNSPECIFIED' });
    expect(statedClockComponent('às 3 da tarde', 'appointment.create')).toEqual({ hour: 3, minute: 0, daypart: 'TARDE' });
    expect(statedClockComponent('às 10h30', 'appointment.create')).toEqual({ hour: 10, minute: 30, daypart: 'UNSPECIFIED' });
    for (const text of ['das 10 às 11', 'amanhã às 10', 'às 10 ou 11', 'de manhã']) expect(statedClockComponent(text, 'appointment.create'), text).toBeUndefined();
  });
  it('adversarial: a negated, "sem"-denied, foreign, repeated or limit-word literal is never an own value', () => {
    const negated = 'marca o Kauã depois de amanhã às 9 pra barba e a Yara às 11 pra escova, não depois de amanhã';
    expect(ownLiteralSpan(negated, 'depois de amanhã', within(negated, 'e a Yara às 11 pra escova, não depois de amanhã'), 'appointment.create', ['Kauã'], 'date')).toBeUndefined();
    const without = 'marca o Kauã depois de amanhã às 9 pra barba e a Yara sem ser depois de amanhã';
    expect(ownLiteralSpan(without, 'depois de amanhã', within(without, 'e a Yara sem ser depois de amanhã'), 'appointment.create', ['Kauã'], 'date')).toBeUndefined();
    // Only in the sibling's clause (the distributive rule decides that one, never the own-value rule).
    const foreign = 'marca o Kauã depois de amanhã às 9 pra barba e a Yara às 11 pra escova';
    expect(ownLiteralSpan(foreign, 'depois de amanhã', within(foreign, 'e a Yara às 11 pra escova'), 'appointment.create', ['Kauã'], 'date')).toBeUndefined();
    const twice = 'marca o Kauã às 9 e a Yara amanhã às 11, isso, amanhã';
    expect(ownLiteralSpan(twice, 'amanhã', within(twice, 'e a Yara amanhã às 11, isso, amanhã'), 'appointment.create', ['Kauã'], 'date')).toBeUndefined();
    const limit = 'marca o Kauã sexta às 9 e a Yara depois de sexta às 11';
    expect(ownLiteralSpan(limit, 'depois de sexta', within(limit, 'e a Yara depois de sexta às 11'), 'appointment.create', ['Kauã'], 'date')).toBeUndefined();
    // Without a verified clause there is no "own" clause at all.
    expect(ownLiteralSpan(message, 'depois de amanhã', undefined, 'appointment.create', ['Kauã'], 'date')).toBeUndefined();
  });
  it('adversarial: a reference that also states a value (identity word or the referenced subject) stays a reference, asked as before', () => {
    const marked = 'marca o Kauã sexta às 9 e a Yara no mesmo dia, sexta, às 11';
    expect(ownLiteralSpan(marked, 'no mesmo dia, sexta', within(marked, 'e a Yara no mesmo dia, sexta, às 11'), 'appointment.create', ['Kauã'], 'date')).toBeUndefined();
    const subject = 'marca o Kauã sexta às 9 e a Yara no dia do Kauã às 11';
    expect(ownLiteralSpan(subject, 'no dia do Kauã', within(subject, 'e a Yara no dia do Kauã às 11'), 'appointment.create', ['Kauã Ribeiro'], 'date')).toBeUndefined();
    // Persons are never taken from a literal by this rule.
    expect(ownLiteralSpan(message, 'depois de amanhã', clause, 'appointment.create', ['Kauã'], 'professional')).toBeUndefined();
    expect(ownLiteralSpan(message, 'depois de amanhã', clause, 'appointment.create', ['Kauã'], 'customer')).toBeUndefined();
  });
  it('adversarial: a day literal with no single reading, a clock, an alternative or a past qualifier states no day', () => {
    for (const text of ['amanhã às 10', 'dia 2 ou 3', 'sexta passada', 'amanhã ou depois', 'outro dia']) expect(statedDayComponent(text, today, 'appointment.create'), text).toBeUndefined();
    expect(statedDayComponent('sexta', today, 'appointment.create')).toMatchObject({ kind: 'WEEKDAY', weekday: 5, week: 'NEAREST' });
    expect(statedDayComponent('dia 2', today, 'appointment.create')).toMatchObject({ kind: 'DAY_OF_MONTH', day: 2 });
  });
  it('a service literal names exactly one catalog service in the owner\'s own words; two, none or Luna\'s own service: none', () => {
    const catalog = ['Barba', 'Corte masculino', 'Esmaltação em gel', 'Barba completa'];
    const said = 'também pra barba', span = statedServiceSpan(said, catalog)!;
    expect(said.slice(...span)).toBe('barba');
    for (const text of ['também pra corte masculino e barba', 'também pra barba completa', 'também', 'pro mesmo']) expect(statedServiceSpan(text, catalog), text).toBeUndefined();
    const text = 'marca o Téo pra corte na sexta às 10h e o Ícaro no mesmo dia às 11h, também pra barba';
    const own = within(text, 'e o Ícaro no mesmo dia às 11h, também pra barba');
    const at = ownLiteralSpan(text, 'também pra barba', own, 'appointment.create', ['Téo'], 'service')!;
    expect(ownLiteralValue(scheduling('appointment.create'), text, at, 'service', text.slice(...own), tz, now, catalog)).toEqual({ field: 'service', text: 'barba' });
    expect(ownLiteralValue(scheduling('appointment.create', { service_name: 'escova' }), text, at, 'service', text.slice(...own), tz, now, catalog)).toBeUndefined();
    expect(ownLiteralValue(scheduling('appointment.create'), text, at, 'service', text.slice(...own), tz, now, undefined)).toBeUndefined();
    const negated = 'marca o Téo pra corte na sexta às 10h e o Ícaro no mesmo dia às 11h, mas não pra barba';
    expect(ownLiteralSpan(negated, 'não pra barba', within(negated, 'e o Ícaro no mesmo dia às 11h, mas não pra barba'), 'appointment.create', ['Téo'], 'service')).toBeUndefined();
  });
  it('flag off: the rule does not exist (the literal stays refused)', () => {
    vi.stubEnv('SALON_SECRETARY_REFERENCES_V2', 'false');
    expect(ownLiteralSpan(message, 'depois de amanhã', clause, 'appointment.create', ['Kauã'], 'date')).toBeUndefined();
  });
  // Review of R-B: the literal may hold only the value's own words and closed glue (articles, prepositions, "também/tb");
  // an exclusion, a substitution or an offset from the other action is never read as this action's own value.
  const catalog = ['Barba', 'Corte masculino', 'Esmaltação em gel', 'Escova'];
  const exclusions = ['fora a barba', 'tirando a barba', 'com exceção da barba', 'salvo a barba', 'nada de barba', 'excluindo a barba', 'deixando de fora a barba', 'em vez de barba'];
  it('review adversarial: an exclusion or substitution head beside a service is never that service', () => {
    for (const tail of exclusions) {
      const text = `marca o Téo pra corte e barba na sexta às 10h e o Ícaro no mesmo dia às 11h, ${tail}`, own = within(text, `e o Ícaro no mesmo dia às 11h, ${tail}`);
      expect(statedServiceSpan(tail, catalog), tail).toBeUndefined();
      const at = ownLiteralSpan(text, tail, own, 'appointment.create', ['Téo'], 'service');
      expect(at && ownLiteralValue(scheduling('appointment.create'), text, at, 'service', text.slice(...own), tz, now, catalog), tail).toBeFalsy();
    }
    // The glue alone still leaves the service (additive adverbs, articles, prepositions).
    for (const said of ['também pra barba', 'pra barba também', 'tb a barba', 'para a Barba', 'barba'])
      expect(said.slice(...statedServiceSpan(said, catalog)!).toLowerCase(), said).toBe('barba');
  });
  it('review adversarial: an exclusion or substitution head beside a day is never that day', () => {
    const at11 = { temporal_evidence: [{ field: 'time', text: 'às 11', component: { hour: 11, minute: 0, daypart: 'UNSPECIFIED' } }] };
    for (const tail of ['fora sexta', 'tirando sexta', 'tirando a sexta', 'qualquer dia fora sexta', 'em vez de sexta', 'nada de sexta', 'com exceção de sexta', 'salvo sexta']) {
      expect(statedDayComponent(tail, today, 'appointment.create'), tail).toBeUndefined();
      const text = `marca o Kauã na quinta às 10 e a Yara às 11 ${tail}`, part = `e a Yara às 11 ${tail}`, own = within(text, part);
      const at = ownLiteralSpan(text, tail, own, 'appointment.create', ['Kauã'], 'date');
      expect(at && ownLiteralValue(scheduling('appointment.create', { customer_name: 'Yara', source_scope: part, ...at11 }), text, at, 'date', part, tz, now), tail).toBeFalsy();
    }
    for (const said of ['na sexta', 'tb na sexta', 'para sexta também']) expect(statedDayComponent(said, today, 'appointment.create'), said).toMatchObject({ kind: 'WEEKDAY', weekday: 5 });
  });
  it('review adversarial: an offset from the other action is never an absolute clock or day (asked, never valued)', () => {
    for (const text of ['duas horas mais tarde', '2 horas mais tarde', 'uma hora mais tarde', 'dali a duas horas', 'daqui a duas horas', 'duas horas', '2 horas', '2h depois', 'uma hora depois'])
      expect(statedClockComponent(text, 'appointment.create'), text).toBeUndefined();
    for (const text of ['dali a dois dias', '2 dias a mais', 'dois dias', 'dois dias mais tarde', 'dentro de dois dias', 'durante dois dias', 'dois dias depois', 'sexta depois'])
      expect(statedDayComponent(text, today, 'appointment.create'), text).toBeUndefined();
    // Now-anchored counts and written clocks keep their value.
    expect(statedDayComponent('daqui a dois dias', today, 'appointment.create')).toMatchObject({ kind: 'DAYS_FROM_NOW', days: 2 });
    expect(statedDayComponent('em 3 dias', today, 'appointment.create')).toMatchObject({ kind: 'DAYS_FROM_NOW', days: 3 });
    expect(statedClockComponent('11h', 'appointment.create')).toEqual({ hour: 11, minute: 0, daypart: 'UNSPECIFIED' });
    expect(statedClockComponent('às duas', 'appointment.create')).toEqual({ hour: 2, minute: 0, daypart: 'UNSPECIFIED' });
    expect(statedClockComponent('ao meio-dia', 'appointment.create')).toEqual({ hour: 12, minute: 0, daypart: 'UNSPECIFIED' });
    // End to end in the message: the literal is this action's own clause, and still gives nothing.
    for (const [literal, field] of [['duas horas mais tarde', 'time'], ['uma hora mais tarde', 'time'], ['dali a duas horas', 'time'], ['dali a dois dias', 'date'], ['2 dias a mais', 'date']] as const) {
      const text = `marca o Kauã na sexta às 10 e a Yara ${literal}`, part = `e a Yara ${literal}`, own = within(text, part);
      const at = ownLiteralSpan(text, literal, own, 'appointment.create', ['Kauã'], field);
      expect(at && ownLiteralValue(scheduling('appointment.create', { customer_name: 'Yara', source_scope: part }), text, at, field, part, tz, now), literal).toBeFalsy();
    }
  });
});

describe('(3)/(4) instruction texts', () => {
  it('the V2 reference rule states the move of someone who already has an appointment into a cancellation\'s slot (change, same_as date+time), once', () => {
    expect(sameAsInstructionsV2.split('Passar quem já tem horário pro de um cancelamento: appointment.change, same_as date e time nele.').length - 1).toBe(1);
    expect(sameAsInstructionsV2).not.toContain('released_slot_of');
  });
  it('the alteration rule states "put a service on someone\'s appointment" = INCLUDE, never a new appointment, in one short sentence', () => {
    const sentence = alterationInstruction.split('. ').find(part => part.startsWith('Pôr serviço'))!;
    expect(sentence).toBe('Pôr serviço no horário de alguém: INCLUDE, não novo agendamento');
    expect(Buffer.byteLength(sentence)).toBeLessThanOrEqual(70);
  });
});
