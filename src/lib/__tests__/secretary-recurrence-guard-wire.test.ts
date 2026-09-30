import { afterEach, describe, expect, it, vi } from 'vitest';
import { continuationDraft, continuationRequirements, secretaryContractParts, type ConversationRoutingContext } from '@everflair/salon-secretary';
import { compileMatrix, compileRequest, LINT_DIRECTORY, LINT_STATES, STRESS_CONTEXT, type LintState } from '../../test/secretary-instruction-lint';
import { contractProfileDigest } from '../../../packages/salon-secretary/evaluation/contract-version-profiles';
import { getOperationRequirements } from '../service-contract';

/** P3c wire (flag SALON_SECRETARY_RECURRENCE_GUARD, default off). The guard reads the owner's own words in the backend: the tool
 * schema, the instructions, the requirements and the draft Luna reads are byte-identical with it off, unset or on (examples off).
 * The contract version records it only when on (runtime flags part). With EVERY candidate flag on (EXAMPLES=selected, whose
 * bank now serves the Candidate 4 examples behind their own flags), the request sent still fits 64000 - 8192. Offline. */
afterEach(() => { vi.unstubAllEnvs(); });
const PLAN = '10000000-0000-4000-8000-000000000001';
/** The adapter state the flag is about: a create holding the one-option recurrence card. */
const RECURRENCE_STATES: LintState[] = [
  { name: 'adapter-recurrence-card', skill: 'scheduling', fields: { operation: 'appointment.create', fields: { customer_name: 'Hiroshi Tanaka', service_name: 'Corte masculino', date: '2026-10-02', time: '18:00' },
    clarification: { missing_fields: ['recurrence_ref'], requested_field: 'recurrence_ref', previous_response: 'Ainda não marco horários recorrentes pelo chat (“toda sexta”). Marco só a primeira (sex, 02/10 às 18h)? Nada foi preparado para as outras datas.',
      candidates: [{ option_id: 'opt_1', label: 'Só a primeira: sex, 02/10 às 18h' }] } }, requirements: () => getOperationRequirements('appointment.create') },
];
const people = ['Maria Eduarda Lopes', 'Kevin Sato', 'Hiroshi Tanaka', 'Duda Ramos', 'Jade Moura', 'Téo Nakamura', 'Luz Andrade', 'Yasmin Alves', 'Nando Ribeiro', 'Céu Martins'];
const pros = ['Caio Brito', 'Lia Moraes', 'Nara Quintela', 'Jonas Ferraz'];
const services = ['Corte masculino', 'Esmaltação em gel', 'Design de sobrancelha com henna', 'Extensão de cílios fio a fio', 'Massagem relaxante'];
function filled(index: number) {
  const who = people[index % people.length], pro = pros[index % pros.length], service = services[index % services.length], kind = index % 4;
  if (kind === 0) return { operation: 'appointment.create', fields: { customer_name: who, service_names: [service, 'Pezinho'], professional_name: pro, date: '2026-10-02', time: '10:30' } };
  if (kind === 1) return { operation: 'appointment.change', fields: { customer_name: who, source_date: '2026-10-01', source_time: '14:00', date: '2026-10-05', time: '16:00',
    target_professional_name: pros[(index + 1) % pros.length], service_changes: [{ mode: 'INCLUDE', service_name: 'Pezinho' }] } };
  if (kind === 2) return { operation: 'appointment.cancel', fields: { customer_name: who, date: '2026-10-03', time: '09:00', reason: 'ela viajou a trabalho e não volta a tempo' } };
  return { operation: 'schedule.block', fields: { professional_name: pro, date: '2026-10-02', time: '12:00', end_time: '13:00', reason: 'almoço' } };
}
/** The largest realistic state: 10 active actions (recurrence cards among them) + 5 suspended plans of 10, a busy directory. */
function realistic(): ConversationRoutingContext {
  const card = (i: number) => ({ missing_fields: ['recurrence_ref'], requested_field: 'recurrence_ref',
    previous_response: `Ainda não marco horários recorrentes pelo chat (“toda sexta”). Marco só a primeira (sex, 02/10 às 10h30)? Nada foi preparado para as outras datas.`,
    candidates: [{ option_id: 'opt_1', label: `Só a primeira: sex, 02/10 às 10h${i}` }] });
  const active = Array.from({ length: 10 }, (_, i) => ({ item_key: 'item_' + i, status: 'NEEDS_INPUT', depends_on: [], ...filled(i),
    clarification: i % 4 === 0 ? card(i) : { missing_fields: ['time'], requested_field: 'time', previous_response: `Qual horário para ${people[i % people.length]}?` } }));
  return { active_plan: { plan_ref: PLAN, actions: active }, suspended_plans: Array.from({ length: 5 }, (_, p) => ({ plan_ref: '20000000-0000-4000-8000-' + String(p + 1).padStart(12, '0'),
    actions: Array.from({ length: 10 }, (_, i) => ({ item_key: `saved_${p}_${i}`, status: 'READY_FOR_CONFIRMATION', depends_on: [], ...filled(i + p) })) })) } as ConversationRoutingContext;
}
const every = { SALON_SECRETARY_TEMPORAL_COMPONENTS: 'true', SALON_SECRETARY_TEMPORAL_POLARITY: 'true', SALON_SECRETARY_SAME_AS: 'true', SALON_SECRETARY_STRUCTURED_CONTEXT: 'true',
  SALON_SECRETARY_NAME_SUGGESTIONS: 'true', SALON_SECRETARY_NAME_ALIASES: 'true', SALON_SECRETARY_CUSTOMER_OVERLAP_GUARD: 'true', SALON_SECRETARY_PERSISTED_STATE: 'true',
  SALON_SECRETARY_SCHEDULING_OVERLAP_ENABLED: 'true', SALON_SECRETARY_CONFIRMATION_GROUPING: 'true', SALON_SECRETARY_DATE_RULES_V2: 'true', SALON_SECRETARY_DAYPART_RULES_V2: 'true',
  SALON_SECRETARY_DAYPART_BY_HOURS: 'true', SALON_SECRETARY_JIT_INSTRUCTIONS: 'true', SALON_SECRETARY_EXAMPLES: 'selected',
  SALON_SECRETARY_ALTER_APPOINTMENT: 'true', SALON_SECRETARY_MULTI_SERVICE: 'true', SALON_SECRETARY_EXCEPTION_RULES_V2: 'true', SALON_SECRETARY_COPY_V2: 'true',
  SALON_SECRETARY_REFERENCES_V2: 'true', SALON_SECRETARY_READS_V2: 'true' };
const salon = { professionals: [...pros, ...Array.from({ length: 4 }, (_, i) => `Profissional Extra ${i}`)], services: [...services, 'Pezinho', 'Barba', ...Array.from({ length: 17 }, (_, i) => `Serviço Extra Completo ${i}`)], today: LINT_DIRECTORY.today };
const body = (r: { instructions: string; system: string; draft: string; wire: unknown }) => JSON.stringify({ i: r.instructions, s: r.system, d: r.draft, w: r.wire });

describe('the flag never changes what Luna reads (examples off)', () => {
  it('off, unset and on compile byte-identical requests in every lint state and the recurrence-card state (components x JIT)', async () => {
    const base = [false, true].flatMap(c => [false, true].map(j => ({ SALON_SECRETARY_TEMPORAL_COMPONENTS: String(c), SALON_SECRETARY_JIT_INSTRUCTIONS: String(j) })));
    const states = [...LINT_STATES, ...RECURRENCE_STATES];
    const unset = await compileMatrix(states, base), off = await compileMatrix(states, base.map(flags => ({ ...flags, SALON_SECRETARY_RECURRENCE_GUARD: 'false' }))),
      on = await compileMatrix(states, base.map(flags => ({ ...flags, SALON_SECRETARY_RECURRENCE_GUARD: 'true' })));
    expect(off.map(r => r.bytes)).toEqual(unset.map(r => r.bytes));
    expect(on.map(r => r.bytes)).toEqual(unset.map(r => r.bytes));
    expect(off.map(body)).toEqual(unset.map(body));
    expect(on.map(body)).toEqual(unset.map(body));
  }, 300_000);
  it('the flag is a contract input only when on (runtime flags; wires and templates unchanged)', () => {
    const v2 = { SALON_SECRETARY_MULTI_ACTION_V2_ENABLED: 'true' };
    const off = contractProfileDigest(v2), explicitOff = contractProfileDigest({ ...v2, SALON_SECRETARY_RECURRENCE_GUARD: 'false' }), on = contractProfileDigest({ ...v2, SALON_SECRETARY_RECURRENCE_GUARD: 'true' });
    expect(explicitOff).toEqual(off);
    expect(on.version).not.toBe(off.version);
    expect(on.parts.runtime).not.toBe(off.parts.runtime);
    expect(on.parts.wires).toBe(off.parts.wires);
    expect(on.parts.templates).toBe(off.parts.templates);
    vi.stubEnv('SALON_SECRETARY_RECURRENCE_GUARD', 'true');
    expect(secretaryContractParts().flags).toMatchObject({ recurrenceGuard: true });
    vi.stubEnv('SALON_SECRETARY_RECURRENCE_GUARD', 'false');
    expect(secretaryContractParts().flags).not.toHaveProperty('recurrenceGuard');
  });
});

describe('request budget with EVERY candidate flag on (realistic heavy state, stress, first turn, recurrence card)', () => {
  it('what is sent fits 64000 with an 8192 output (examples are budget-fitted; the guard itself adds no wire or prompt byte)', async () => {
    vi.stubEnv('SALON_SECRETARY_JIT_INSTRUCTIONS', 'true');
    const context = realistic(), keys = context.active_plan!.actions as { item_key: string }[], stressKeys = STRESS_CONTEXT.active_plan!.actions as { item_key: string }[];
    const cont = continuationDraft(keys), stressCont = continuationDraft(stressKeys), requirements = continuationRequirements();
    vi.unstubAllEnvs();
    const shapes: LintState[] = [
      { name: 'first turn', skill: 'discovery' },
      { name: 'realistic filled', skill: 'discovery', context },
      { name: 'realistic continuation', skill: 'discovery', context, fields: cont, requirements },
      { name: 'realistic adapter answer (recurrence card)', skill: 'scheduling', context, fields: RECURRENCE_STATES[0].fields, requirements: () => getOperationRequirements('appointment.create') },
      { name: 'stress', skill: 'discovery', context: STRESS_CONTEXT },
      { name: 'stress continuation', skill: 'discovery', context: STRESS_CONTEXT, fields: stressCont, requirements },
    ];
    const messages = ['Pedido sintético offline', 'marca o hiroshi toda sexta as 18h pra corte com a nara e passa a jade de quinta pra sexta no mesmo horario'];
    const rows: Record<string, unknown>[] = [];
    for (const shape of shapes) for (const message of messages) {
      const before = await compileRequest(shape, every, salon, message), after = await compileRequest(shape, { ...every, SALON_SECRETARY_RECURRENCE_GUARD: 'true' }, salon, message);
      rows.push({ shape: shape.name, message: message === messages[0] ? 'synthetic' : 'recurrence+self-origin', configuredOff: before.configuredBytes + 8192, configuredOn: after.configuredBytes + 8192,
        sentOff: before.bytes + 8192, sentOn: after.bytes + 8192, marginOn: 64000 - after.bytes - 8192, degradation: after.budget?.steps ?? [],
        wireCost: JSON.stringify(after.wire).length - JSON.stringify(before.wire).length, promptCost: Buffer.byteLength(after.instructions) - Buffer.byteLength(before.instructions) });
      expect(after.bytes + 8192, shape.name).toBeLessThanOrEqual(64000);
      expect(before.bytes + 8192, shape.name).toBeLessThanOrEqual(64000);
      expect(after.budget?.fit ?? true, shape.name).toBe(true);
      // The flag's own cost: no schema byte, no instruction byte (only the budget-fitted examples block may differ).
      expect(JSON.stringify(after.wire), shape.name).toBe(JSON.stringify(before.wire));
      expect(after.instructions, shape.name).toBe(before.instructions);
    }
    console.info(JSON.stringify({ p3cRecurrenceBudget: rows }));
  }, 300_000);
});
