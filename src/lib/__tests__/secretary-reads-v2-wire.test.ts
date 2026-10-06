import { afterEach, describe, expect, it, vi } from 'vitest';
import { continuationDraft, continuationRequirements, secretaryContractParts, type ConversationRoutingContext } from '@everflair/salon-secretary';
import { compileMatrix, compileRequest, LINT_DIRECTORY, LINT_STATES, STRESS_CONTEXT, type LintState } from '../../test/secretary-instruction-lint';
import { contractProfileDigest } from '../../../packages/salon-secretary/evaluation/contract-version-profiles';
import { getOperationRequirements } from '../service-contract';

/** P3b wire (flag SALON_SECRETARY_READS_V2, default off). The flag changes only what the backend ANSWERS to reads: the tool
 * schema, the instructions and the requirements Luna reads are byte-identical with it off, unset or on (the read operations
 * already publish every field as nullable, and the published requirements are unchanged; the relaxed ones are runtime only).
 * The contract version records it only when on (runtime flags part; wires and templates unchanged). With EVERY candidate flag
 * on, the request sent still fits 64000 - 8192 and the flag adds 0 bytes. Offline. */
afterEach(() => { vi.unstubAllEnvs(); });
const PLAN = '10000000-0000-4000-8000-000000000001';
/** The read states this flag is about: the discovery requirements (as salon-secretary.ts publishes them) and the adapters of a read. */
const READ_STATES: LintState[] = [
  { name: 'discovery-read-requirements', skill: 'discovery', requirements: () => ({ scheduling: { read: getOperationRequirements('appointment.list'), availability: getOperationRequirements('availability.get') } }) },
  { name: 'adapter-availability', skill: 'scheduling', fields: { operation: 'availability.get', fields: { service_name: 'Corte masculino' }, clarification: { missing_fields: ['date'], requested_field: 'date', previous_response: 'Para qual dia?' } },
    requirements: () => getOperationRequirements('availability.get') },
  { name: 'adapter-list', skill: 'scheduling', fields: { operation: 'appointment.list', fields: { customer_name: 'Hiroshi Tanaka' }, clarification: { missing_fields: [], requested_field: null, previous_response: 'Próximo agendamento de Hiroshi Tanaka: qui, 01/10 às 10h — Corte masculino com Caio Brito.' } },
    requirements: () => getOperationRequirements('appointment.list') },
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
  return { operation: 'availability.get', fields: { service_name: service, date: '2026-10-02', period: 'afternoon' } };
}
/** The largest realistic state: 10 active actions (reads among them) + 5 suspended plans of 10, a busy directory. */
function realistic(): ConversationRoutingContext {
  const active = Array.from({ length: 10 }, (_, i) => ({ item_key: 'item_' + i, status: i % 4 === 3 ? 'DONE' : 'NEEDS_INPUT', depends_on: [], ...filled(i),
    clarification: { missing_fields: i % 4 === 3 ? [] : ['time'], requested_field: i % 4 === 3 ? null : 'time', previous_response: i % 4 === 3
      ? `Horários livres para ${services[i % services.length]} em sex, 02/10 à tarde:\nCaio Brito: 13h, 13h30, 14h, 14h30, 15h e há mais\nLia Moraes: 16h\nSem horário livre nesse período: Nara Quintela.\nA consulta não reserva o horário.`
      : `Qual horário para ${people[i % people.length]}?` } }));
  return { active_plan: { plan_ref: PLAN, actions: active }, suspended_plans: Array.from({ length: 5 }, (_, p) => ({ plan_ref: '20000000-0000-4000-8000-' + String(p + 1).padStart(12, '0'),
    actions: Array.from({ length: 10 }, (_, i) => ({ item_key: `saved_${p}_${i}`, status: 'READY_FOR_CONFIRMATION', depends_on: [], ...filled(i + p) })) })) } as ConversationRoutingContext;
}
const every = { SALON_SECRETARY_TEMPORAL_COMPONENTS: 'true', SALON_SECRETARY_TEMPORAL_POLARITY: 'true', SALON_SECRETARY_SAME_AS: 'true', SALON_SECRETARY_STRUCTURED_CONTEXT: 'true',
  SALON_SECRETARY_NAME_SUGGESTIONS: 'true', SALON_SECRETARY_NAME_ALIASES: 'true', SALON_SECRETARY_CUSTOMER_OVERLAP_GUARD: 'true', SALON_SECRETARY_PERSISTED_STATE: 'true',
  SALON_SECRETARY_SCHEDULING_OVERLAP_ENABLED: 'true', SALON_SECRETARY_CONFIRMATION_GROUPING: 'true', SALON_SECRETARY_DATE_RULES_V2: 'true', SALON_SECRETARY_DAYPART_RULES_V2: 'true',
  SALON_SECRETARY_DAYPART_BY_HOURS: 'true', SALON_SECRETARY_JIT_INSTRUCTIONS: 'true', SALON_SECRETARY_EXAMPLES: 'selected',
  SALON_SECRETARY_ALTER_APPOINTMENT: 'true', SALON_SECRETARY_MULTI_SERVICE: 'true', SALON_SECRETARY_EXCEPTION_RULES_V2: 'true', SALON_SECRETARY_COPY_V2: 'true',
  SALON_SECRETARY_REFERENCES_V2: 'true' };
const salon = { professionals: [...pros, ...Array.from({ length: 4 }, (_, i) => `Profissional Extra ${i}`)], services: [...services, 'Pezinho', 'Barba', ...Array.from({ length: 17 }, (_, i) => `Serviço Extra Completo ${i}`)], today: LINT_DIRECTORY.today };
const body = (r: { instructions: string; system: string; draft: string; wire: unknown }) => JSON.stringify({ i: r.instructions, s: r.system, d: r.draft, w: r.wire });

describe('the flag never changes what Luna reads', () => {
  it('off, unset and on compile byte-identical requests in every lint state and read state (components x JIT)', async () => {
    const base = [false, true].flatMap(c => [false, true].map(j => ({ SALON_SECRETARY_TEMPORAL_COMPONENTS: String(c), SALON_SECRETARY_JIT_INSTRUCTIONS: String(j) })));
    const states = [...LINT_STATES, ...READ_STATES];
    const unset = await compileMatrix(states, base), off = await compileMatrix(states, base.map(flags => ({ ...flags, SALON_SECRETARY_READS_V2: 'false' }))),
      on = await compileMatrix(states, base.map(flags => ({ ...flags, SALON_SECRETARY_READS_V2: 'true' })));
    expect(off.map(r => r.bytes)).toEqual(unset.map(r => r.bytes));
    expect(on.map(r => r.bytes)).toEqual(unset.map(r => r.bytes));
    expect(off.map(body)).toEqual(unset.map(body));
    expect(on.map(body)).toEqual(unset.map(body));
    // The published requirements keep the professional and the day (the relaxation is the backend's, at runtime).
    const adapter = on.find(r => r.state === 'adapter-availability')!;
    expect(adapter.system + adapter.draft).toContain('"required_fields":["service_ref","professional_ref","date"]');
  }, 300_000);
  it('the flag is a contract input only when on (runtime flags; wires and templates unchanged)', () => {
    const v2 = { SALON_SECRETARY_MULTI_ACTION_V2_ENABLED: 'true' };
    const off = contractProfileDigest(v2), explicitOff = contractProfileDigest({ ...v2, SALON_SECRETARY_READS_V2: 'false' }), on = contractProfileDigest({ ...v2, SALON_SECRETARY_READS_V2: 'true' });
    expect(explicitOff).toEqual(off);
    expect(on.version).not.toBe(off.version);
    expect(on.parts.runtime).not.toBe(off.parts.runtime);
    expect(on.parts.wires).toBe(off.parts.wires);
    expect(on.parts.templates).toBe(off.parts.templates);
    vi.stubEnv('SALON_SECRETARY_READS_V2', 'true');
    expect(secretaryContractParts().flags).toMatchObject({ readsV2: true });
    vi.stubEnv('SALON_SECRETARY_READS_V2', 'false');
    expect(secretaryContractParts().flags).not.toHaveProperty('readsV2');
  });
});

describe('request budget with EVERY candidate flag on (realistic heavy state, stress, first turn, read adapters)', () => {
  it('what is sent fits 64000 with an 8192 output; the flag costs 0 bytes', async () => {
    vi.stubEnv('SALON_SECRETARY_JIT_INSTRUCTIONS', 'true');
    const context = realistic(), keys = context.active_plan!.actions as { item_key: string }[], stressKeys = STRESS_CONTEXT.active_plan!.actions as { item_key: string }[];
    const cont = continuationDraft(keys), stressCont = continuationDraft(stressKeys), requirements = continuationRequirements();
    vi.unstubAllEnvs();
    const shapes: LintState[] = [
      { name: 'first turn', skill: 'discovery' },
      { name: 'realistic filled', skill: 'discovery', context },
      { name: 'realistic continuation', skill: 'discovery', context, fields: cont, requirements },
      { name: 'realistic adapter answer (availability)', skill: 'scheduling', context, fields: { operation: 'availability.get', fields: { service_name: 'Corte masculino' },
        clarification: { missing_fields: ['date'], requested_field: 'date', previous_response: 'Para qual dia?' } }, requirements: () => getOperationRequirements('availability.get') },
      { name: 'realistic adapter answer (list)', skill: 'scheduling', context, fields: { operation: 'appointment.list', fields: {}, clarification: { missing_fields: ['professional_ref'], requested_field: 'professional_ref',
        previous_response: 'Agenda em sex, 02/10: 63 agendamentos, mais do que listo de uma vez.\nCaio Brito: 16 agendamentos, das 8h às 18h\nLia Moraes: 15 agendamentos, das 9h às 19h\nDe qual profissional ou período você quer a lista?',
        response_fields: ['professional_name'], candidates: [{ option_id: 'opt_1', label: 'Caio Brito · 16' }, { option_id: 'opt_2', label: 'Lia Moraes · 15' }] } }, requirements: () => getOperationRequirements('appointment.list') },
      { name: 'stress', skill: 'discovery', context: STRESS_CONTEXT },
      { name: 'stress continuation', skill: 'discovery', context: STRESS_CONTEXT, fields: stressCont, requirements },
    ];
    const rows: Record<string, unknown>[] = [];
    for (const shape of shapes) {
      const before = await compileRequest(shape, every, salon), after = await compileRequest(shape, { ...every, SALON_SECRETARY_READS_V2: 'true' }, salon);
      rows.push({ shape: shape.name, configuredOff: before.configuredBytes + 8192, configuredOn: after.configuredBytes + 8192, sentOff: before.bytes + 8192, sentOn: after.bytes + 8192,
        marginOn: 64000 - after.bytes - 8192, degradation: after.budget?.steps ?? [] });
      expect(after.bytes + 8192, shape.name).toBeLessThanOrEqual(64000);
      expect(after.budget?.fit ?? true, shape.name).toBe(true);
      expect(after.bytes, shape.name).toBe(before.bytes);
      expect(after.configuredBytes, shape.name).toBe(before.configuredBytes);
      expect(body(after), shape.name).toBe(body(before));
    }
    console.info(JSON.stringify({ p3bReadsBudget: rows }));
  }, 300_000);
});
