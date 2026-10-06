import { describe, expect, it } from 'vitest';
import type { AgendaScenario, ScenarioSalon } from '../../../packages/salon-secretary/evaluation/agenda-practice-lib';
import { DEV_BATTERIES, hoursPattern, measureSet, signatureKey, skeletonTokens, templateOf, unitsOf } from '../../../packages/salon-secretary/evaluation/proof-diversity';

// Evaluation-only proof diversity report (Track H): an entity swap of a DEV scenario must read as one (identical masked
// skeleton and signature), a structurally new scenario must not; the report carries codes and counts, never a text or name.
const salon = (type: string, services: [string, number][]): ScenarioSalon => ({ type, services: services.map(([name, durationMin]) => ({ name, durationMin, priceCents: 5000 })),
  hours: [1, 2, 3, 4, 5, 6].map(weekday => ({ weekday, from: '09:00', to: '19:00' })) });
const dev: AgendaScenario = { id: 'X01', title: 'dev', capability: ['create'], salon: salon('barbearia', [['Degradê', 30], ['Barba', 30]]),
  professionals: [{ name: 'Olavo Brandão' }], customers: [{ name: 'Ximena Tavares' }],
  steps: [{ say: 'Marca a Ximena amanhã às 14h pra degradê com o Olavo, por favor.' }, { confirm: true }],
  final: { appointments: [{ customer: 'Ximena Tavares', service: 'Degradê', day: 1, time: '14:00', professional: 'Olavo Brandão' }] } };
// the same sentence with other people, service, day and clock (and other genders): a pure entity swap
const swapped: AgendaScenario = { ...dev, id: 'Y01', salon: salon('esmalteria', [['Esmaltação', 40], ['Spa dos pés', 60]]), professionals: [{ name: 'Jurema Coutinho' }],
  customers: [{ name: 'Anselmo Rios' }], steps: [{ say: 'Marca o Anselmo sexta às 16h pra esmaltação com a Jurema, por favor.' }, { confirm: true }],
  final: { appointments: [{ customer: 'Anselmo Rios', service: 'Esmaltação', day: 'sex', time: '16:00', professional: 'Jurema Coutinho' }] } };
// another structure: two turns, a cancellation and a booking in the released slot, a reference and a correction, a missing reason
const novel: AgendaScenario = { id: 'Z01', title: 'novel', capability: ['cancel', 'create', 'multi-action', 'released-slot', 'correction'],
  salon: { type: 'esmalteria', services: [{ key: 'esm', name: 'Esmaltação', durationMin: 40, priceCents: 5000 }], hours: [{ weekday: 2, from: '10:00', to: '13:00' }, { weekday: 2, from: '14:00', to: '20:00' }] },
  professionals: [{ key: 'p1', name: 'Jurema Coutinho' }], customers: [{ key: 'c1', name: 'Anselmo Rios' }, { key: 'c2', name: 'Luma Ferraz' }],
  appointments: [{ key: 'a1', customer: 'c2', professional: 'p1', service: 'esm', day: 'ter', time: '10:00' }],
  steps: [{ say: 'a luma desistiu de terça, pode tirar ela' }, { say: 'na verdade põe o anselmo no lugar dela, mesmo horário' }, { confirm: true }], answers: { reason: 'ela viajou' },
  final: { appointments: [{ customer: 'Luma Ferraz', service: 'Esmaltação', day: 'ter', time: '10:00', professional: 'Jurema Coutinho', status: 'CANCELLED', reason: 'viajou' },
    { customer: 'Anselmo Rios', service: 'Esmaltação', day: 'ter', time: '10:00', professional: 'Jurema Coutinho' }], mustAsk: ['reason'] } };
const devBattery = [{ id: 'dev', units: unitsOf([dev], 'dev') }];

describe('proof diversity', () => {
  it('masks names, services, days and clocks (and gender agreement) in the ordered skeleton', () => {
    const names = new Set(['ximena', 'olavo', 'anselmo', 'jurema']), services = new Set(['degrade', 'esmaltacao']);
    const a = skeletonTokens('Marca a Ximena amanhã às 14h pra degradê com o Olavo, por favor.', names, services);
    const b = skeletonTokens('Marca o Anselmo sexta às 16h pra esmaltação com a Jurema, por favor.', names, services);
    expect(a).toEqual(b);
    expect(a).toEqual(expect.arrayContaining(['<name>', '<svc>', '<day>', '<num>']));
    expect(skeletonTokens('marca a Ximena dia vinte e oito às dez e meia', names, services).filter(t => t === '<num>')).toHaveLength(2);
  });

  it('an entity-swapped copy scores masked-skeleton identity and signature identity', () => {
    const [s] = unitsOf([swapped], 'set'), [d] = devBattery[0].units;
    expect(signatureKey(s.sig)).toBe(signatureKey(d.sig));
    const r = measureSet('swap', [s], devBattery);
    expect(r.M1_textSimilarity.entitySwap.skeletonIdentical).toBe(1);
    expect(r.M1_textSimilarity.entitySwap.scenariosAllSaysIdentical).toBe(1);
    expect(r.M3_structure.exactInDev).toBe(1);
    expect(r.M5_combinations.combinationAbsentFromDev).toBe(0);
    expect(r.M2_nameOverlap.customers.occurrencesSeenInDev).toBe(0); // names alone do vary
    expect(r.verdict).toMatchObject({ entitySwapOnly: true, d01_wording: 'NOT_VARIED', d07_capabilityCombinations: 'NOT_VARIED', d12_multiTurn: 'NOT_VARIED' });
  });

  it('a structurally new scenario matches neither the skeleton nor the signature nor the combination', () => {
    const units = unitsOf([novel], 'set'), [u] = units;
    expect(u.sig).toMatchObject({ ops: ['cancel', 'create'], actions: 2, mustAsk: ['reason'], answers: ['reason'], trajectory: 'SSC', turns: 2, refs: ['released-slot'], flags: ['correction'] });
    expect(u.combo).toEqual(expect.arrayContaining(['cancel', 'create', 'multi-action', 'missing-reason', 'reference', 'released-slot', 'correction', 'multi-turn']));
    const r = measureSet('novel', units, devBattery);
    expect(r.M1_textSimilarity.entitySwap.skeletonIdentical).toBe(0);
    expect(r.M3_structure).toMatchObject({ exactInDev: 0, nearDev: 0, novel: 1 });
    expect(r.M5_combinations.combinationAbsentFromDev).toBe(1);
    expect(r.verdict).toMatchObject({ entitySwapOnly: false, d07_capabilityCombinations: 'VARIED', d08_actionsCountAndOrder: 'VARIED', d12_multiTurn: 'VARIED' });
    expect(r.M4_context).toMatchObject({ hoursPatternAbsentFromDev: 1, withBreak: 1, busyTargetDay: 0 });
    expect(r.M6_dimensions.d12_multiTurn.multiTurnScenarios).toBe(1);
    expect(r.M6_dimensions.d11_references.saysByKind).toMatchObject({ 'in-place': 1, 'same-time': 1 });
    expect(r.M6_dimensions.d10_negationCorrection.laterTurnNegationOrCorrection).toBe(1);
    expect(hoursPattern(novel.salon!.hours)).toBe('2=10:00-13:00,14:00-20:00');
  });

  it('reports codes and counts only: no text and no name of the set', () => {
    const text = JSON.stringify(measureSet('both', unitsOf([swapped, novel], 'set'), devBattery, { perScenario: true })).toLowerCase();
    for (const word of ['anselmo', 'jurema', 'luma', 'esmalta', 'desistiu', 'viajou', 'lugar', 'marca']) expect(text).not.toContain(word);
  });

  it('the DEV union holds the Candidate 4 DEV and rules batteries (each id once)', () => {
    const ids = DEV_BATTERIES.map(b => b.id);
    expect(ids).toEqual(expect.arrayContaining(['c4dev', 'c4rules', 'golden-30', 'multi-salon-dev']));
    expect(new Set(ids).size).toBe(ids.length);
  });

  it('reads generated template ids', () => {
    expect([templateOf('MH06E1'), templateOf('MD44B1'), templateOf('D01')]).toEqual(['T06', 'T44', null]);
  });
});
