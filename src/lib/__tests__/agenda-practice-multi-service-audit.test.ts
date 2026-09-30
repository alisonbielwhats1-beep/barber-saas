import { describe, expect, it } from 'vitest';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { AUDIT_DAYS, auditBattery } from '../../../packages/salon-secretary/evaluation/agenda-practice-battery';
import { MULTI_SERVICE_SEED_VERSION, appointmentServiceKeys, buildScenarioFixture, scenarioFixture, validateScenarios, type AgendaScenario, type ScenarioAppointment }
  from '../../../packages/salon-secretary/evaluation/agenda-practice-lib';
import { fixtureSchema } from '../../../packages/salon-secretary/evaluation/free-use-contract';
import { unitsOf } from '../../../packages/salon-secretary/evaluation/proof-diversity';

// Offline, static: a practice scenario may seed a PRE-EXISTING appointment with several services (`services`, in order).
const MONDAY = '2026-09-28';
const HOURS = [2, 3, 4, 5, 6].flatMap(weekday => [{ weekday, from: '09:00', to: '12:00' }, { weekday, from: '13:00', to: '18:00' }]); // lunch break
const multi: ScenarioAppointment = { key: 'ben_qua', customer: 'benedito', professional: 'iara', services: ['limpeza', 'sobrancelha'], day: 'qua', time: '10:00' };
/** "Remove one service from an appointment that has two", with a genuine two-service seed (no catalog combo service). */
const scenario = (patch: Partial<AgendaScenario> = {}): AgendaScenario => ({ id: 'M01', title: 'Tirar um serviço de um atendimento com dois',
  capability: ['alter-remove-service', 'alter', 'change-service'],
  salon: { type: 'estética', services: [{ key: 'limpeza', name: 'Limpeza de Pele', durationMin: 60, priceCents: 12000 }, { key: 'sobrancelha', name: 'Design de Sobrancelha', durationMin: 30, priceCents: 4500 },
    { key: 'massagem', name: 'Massagem Relaxante', durationMin: 50, priceCents: 9000 }, { key: 'drenagem', name: 'Drenagem Linfática', durationMin: 40, priceCents: 7000 }], hours: HOURS },
  professionals: [{ key: 'iara', name: 'Iara Nakamura', services: ['Limpeza de Pele', 'Design de Sobrancelha', 'Drenagem Linfática'] },
    { key: 'otavio', name: 'Otávio Lemos', services: ['Massagem Relaxante', 'Drenagem Linfática'] }],
  customers: [{ key: 'benedito', name: 'Benedito Arruda' }, { key: 'zuleica', name: 'Zuleica Paixão' }],
  appointments: [multi],
  steps: [{ say: 'tira a sobrancelha do benedito de quarta, fica so a limpeza' }, { confirm: true }],
  final: { appointments: [{ customer: 'Benedito Arruda', service: 'Limpeza de Pele', day: 'qua', time: '10:00', end: '11:00', professional: 'Iara Nakamura' }] }, ...patch });
const withSeed = (a: Partial<ScenarioAppointment>, patch: Partial<AgendaScenario> = {}) => scenario({ appointments: [{ ...multi, ...a } as ScenarioAppointment], ...patch });
const issues = (s: AgendaScenario, days: string[] = [MONDAY]) => auditBattery([s], { days, verbose: true }).issues;
const seedIssues = (s: AgendaScenario, days?: string[]) => issues(s, days).filter(i => /:SEED_/.test(i));

describe('agenda practice: multi-service seed, static audit rules', () => {
  it('a genuine two-service seed passes the audit on every weekday and calendar boundary', () => {
    expect(issues(scenario(), AUDIT_DAYS)).toEqual([]);
    expect(MULTI_SERVICE_SEED_VERSION).toBe(1);
  });
  it('the initial projection is the product\'s: names joined by "+" in order, end = the summed durations', () => {
    // A final equal to the seeded row verbatim is "passes without change": the audit's initial state renders exactly this line.
    const verbatim = (service: string, end: string) => issues(scenario({ final: { appointments: [{ customer: 'Benedito Arruda', service, day: 'qua', time: '10:00', end, professional: 'Iara Nakamura' }] } }));
    expect(verbatim('Limpeza de Pele+Design de Sobrancelha', '11:30')).toContain('M01:ORACLE_PASSES_WITHOUT_CHANGE');
    expect(verbatim('Design de Sobrancelha+Limpeza de Pele', '11:30')).not.toContain('M01:ORACLE_PASSES_WITHOUT_CHANGE'); // the order is part of it
    expect(verbatim('Limpeza de Pele+Design de Sobrancelha', '11:00')).toContain('M01:FINAL_END:11:00');
  });
  it('flags unknown keys, a repeated service and a service the professional does not offer', () => {
    expect(seedIssues(withSeed({ services: ['limpeza', 'peeling'] }))).toEqual(['M01:SEED_SERVICE_UNKNOWN:ben_qua/peeling']);
    expect(seedIssues(withSeed({ services: ['limpeza', 'limpeza'] }))).toEqual(['M01:SEED_SERVICE_DUPLICATE:ben_qua']);
    expect(seedIssues(withSeed({ professional: 'otavio', services: ['massagem', 'sobrancelha'] }))).toEqual(['M01:SEED_ELIGIBILITY:ben_qua/sobrancelha']);
    expect(seedIssues(withSeed({ customer: 'ninguem' }))).toEqual(['M01:SEED_RELATION:ben_qua']);
    expect(seedIssues(withSeed({ day: 0 }), ['2026-09-29'])).toEqual(['M01:SEED_NOT_FUTURE:ben_qua']); // today, a Tuesday (open)
  });
  it('the SUMMED duration must fit one window of the professional/salon (never across a break or past closing)', () => {
    // 11:00 + 60 min alone fits the 09-12 window; with the 30 min eyebrow it ends 12:30, inside the lunch break.
    expect(seedIssues(scenario({ appointments: [{ key: 'solo', customer: 'benedito', professional: 'iara', service: 'limpeza', day: 'qua', time: '11:00' }] }))).toEqual([]);
    expect(seedIssues(withSeed({ time: '11:00' }))).toEqual(['M01:SEED_HOURS:ben_qua']);
    expect(seedIssues(withSeed({ time: '17:00' }))).toEqual(['M01:SEED_HOURS:ben_qua']);
    expect(seedIssues(withSeed({ time: '16:30' }))).toEqual([]);
    // Base fixture: a professional's own from/to and working weekdays bound the seed too.
    const base: AgendaScenario = { id: 'M02', title: 'Seed na agenda de manhã', capability: ['read'], professionals: [{ key: 'quiteria', name: 'Quitéria Salgado', services: ['corte', 'escova'], weekdays: [2, 3, 4], from: '09:00', to: '12:00' }],
      customers: [{ key: 'ulisses', name: 'Ulisses Brandão' }], appointments: [{ key: 'u1', customer: 'ulisses', professional: 'quiteria', services: ['corte', 'escova'], day: 'qua', time: '10:00' }],
      steps: [{ say: 'como ta a agenda da quiteria na quarta', expect: 'READ_DONE' }], final: { unchanged: true } };
    const at = (a: Partial<ScenarioAppointment>) => seedIssues({ ...base, appointments: [{ ...base.appointments![0], ...a } as ScenarioAppointment] });
    expect(at({})).toEqual([]); // 10:00 → 11:45
    expect(at({ time: '10:30' })).toEqual(['M02:SEED_HOURS:u1']); // 12:15 > her 12:00
    expect(at({ day: 'sex' })).toEqual(['M02:SEED_HOURS:u1']); // she does not work on Fridays
  });
  it('the SUMMED duration must not overlap another seeded booking of the same professional', () => {
    const zuleica = (professional: string, time: string, service = 'sobrancelha'): ScenarioAppointment => ({ key: 'zu_qua', customer: 'zuleica', professional, service, day: 'qua', time });
    // 10:00 → 11:30: an 11:00 booking of the same professional overlaps it (the first service alone would end at 11:00).
    expect(seedIssues(scenario({ appointments: [zuleica('iara', '11:00'), multi] }))).toEqual(['M01:SEED_OVERLAP:ben_qua']);
    expect(seedIssues(scenario({ appointments: [multi, zuleica('iara', '11:00')] }))).toEqual(['M01:SEED_OVERLAP:zu_qua']);
    expect(seedIssues(scenario({ appointments: [zuleica('iara', '11:30'), multi] }))).toEqual([]); // back to back
    expect(seedIssues(scenario({ appointments: [zuleica('otavio', '10:00', 'drenagem'), multi] }))).toEqual([]);
    expect(seedIssues(scenario({ appointments: [{ ...zuleica('iara', '14:00'), key: 'ben_qua' }, multi] }))).toEqual(['M01:SEED_KEY_DUPLICATE:ben_qua']);
  });
  it('rejects a malformed list before any audit: 2..4 keys, exclusive with `service`', () => {
    for (const bad of [{ services: ['limpeza'] }, { services: ['limpeza', 'sobrancelha', 'massagem', 'drenagem', 'peeling'] }, { services: [] }, { services: ['limpeza', ''] },
      { services: 'limpeza' }, { services: ['limpeza', 'sobrancelha'], service: 'limpeza' }, { services: null }] as unknown as Partial<ScenarioAppointment>[])
      expect(() => auditBattery([withSeed(bad)], { days: [MONDAY] }), JSON.stringify(bad)).toThrow('AGENDA_SCENARIO_INVALID:M01:APPOINTMENT_SERVICES');
    expect(() => validateScenarios([withSeed({ services: ['limpeza', 'sobrancelha', 'massagem', 'drenagem'] })])).not.toThrow();
  });
});

describe('agenda practice: multi-service seed is additive', () => {
  it('stays out of the FreeUseFixture and is handed to the seeder; a fixture-only caller fails closed', () => {
    const { fixture, hours, multiService } = buildScenarioFixture(scenario(), MONDAY);
    expect(fixtureSchema.safeParse(fixture).success).toBe(true);
    expect(fixture.appointments).toEqual([]);
    expect(hours.map(h => h.key)).toEqual(['iara', 'otavio']);
    expect(multiService).toEqual([{ key: 'ben_qua', customerKey: 'benedito', professionalKey: 'iara', serviceKeys: ['limpeza', 'sobrancelha'], startAt: '2026-09-30T13:00:00.000Z', status: 'CONFIRMED' }]);
    expect(() => scenarioFixture(scenario(), MONDAY)).toThrow('AGENDA_MULTI_SERVICE_SEED_REQUIRED');
    expect(appointmentServiceKeys(multi)).toEqual(['limpeza', 'sobrancelha']);
    expect(appointmentServiceKeys({ key: 'k', customer: 'c', professional: 'p', service: 'corte', day: 1, time: '10:00' })).toEqual(['corte']);
  });
  it('no existing battery uses it: their fixtures carry no multi-service seed', () => {
    const E = 'packages/salon-secretary/evaluation';
    for (const file of ['agenda-practice-scenarios.json', 'agenda-practice-scenarios-r2.json', 'agenda-practice-scenarios-r3.json', 'agenda-practice-variations.json',
      'agenda-practice-natural.json', 'agenda-practice-c4dev.json', 'multi-salon/generated-dev.json']) {
      const raw = JSON.parse(readFileSync(join(E, file), 'utf8')), list = validateScenarios(Array.isArray(raw) ? raw : raw.scenarios);
      for (const s of list) for (const day of [MONDAY, '2026-10-03']) expect(buildScenarioFixture(s, day).multiService, `${file} ${s.id}`).toEqual([]);
    }
  });
  it('the proof-diversity signature reads the seeded services (a removal is now a real service-remove)', () => {
    const [unit] = unitsOf([scenario()], 'test');
    expect(unit.services).toEqual(['design de sobrancelha', 'limpeza de pele']);
    expect(unit.sig.ops).toEqual(['service-remove']);
  });
});
