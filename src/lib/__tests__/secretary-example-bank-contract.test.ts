import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { withConversationRouting, decodeConversationTurn } from '@everflair/salon-secretary';
import { bankExample, exampleBank, exampleRequirements, EXAMPLE_CLOCK_DATE, type BankExample } from '../../../packages/salon-secretary/src/examples/bank';
import { CANONICAL_FILL_SEED, exampleFills, examplePlaceholders, fillExample } from '../../../packages/salon-secretary/src/examples/fill';
import { servedFeatures } from '../../../packages/salon-secretary/src/examples/render';
import { eligibleExamples, examplesState, availableExampleFeatures, EXAMPLE_FEATURE_FLAGS } from '../../../packages/salon-secretary/src/examples/select';
import { bankFilesConsistent, exampleRoutingContext, featureEnv, publishedWire, validateCandidateWire, wireTurn, CANDIDATE_ENV } from '../../../packages/salon-secretary/src/examples/validate';
import { projectSchedulingOperation } from '../secretary-operation-projection';
import { groundSchedulingTemporalTurn } from '../scheduling-temporal-mode';
import { actionScopedSource } from '../secretary-sibling-scope';
import { distributiveReferenceProven, referenceLiteralProven, selfReferenceProven } from '../secretary-same-as';
import { addCalendarDays, weekdayOfDateKey } from '../time';

/** P3c BANK-CONTRACT. Every example of bank*.json, filled and rendered to the CANDIDATE wire (components) with its `requires`
 * flags on — and again with every candidate flag on — passes decodeConversationTurn strictly (validateSelectionV2 /
 * validateAddSelection / validateExistingPlanPatches, no partial acceptance), and the backend cross-check the historical test
 * skips for flag-gated entries: the grounding never reads a different day/clock, every exclusion is proven, and every same_as
 * literal is proven by the backend's own rule (reference, self-origin, distributive or released-slot service). Flag-off serving
 * is unchanged: no Candidate 4 entry is eligible while its flag is off. Offline, codes and ids only. */
afterEach(() => { vi.unstubAllEnvs(); });
const raw = JSON.parse(readFileSync(join(process.cwd(), 'packages/salon-secretary/src/examples/bank.json'), 'utf8')) as BankExample[];
const P3C_FEATURES = ['references_v2', 'alter', 'multi_service', 'reads_v2', 'recurrence_guard', 'daypart_by_hours', 'exception_rules_v2'] as const;
/** The Candidate 4 structures and the entries that teach them (P3c). */
const NEW_ENTRIES: Record<string, string[]> = {
  'alter: target professional': ['S086'], 'alter: service include (pezinho add-on)': ['S087'], 'alter: service remove': ['S088'], 'alter: service set': ['S089'],
  'multi-service create': ['S090'], 'multi-service answer (faz X também)': ['R068'], 'distributive shared day': ['M058'], "'no mesmo horário' self-origin": ['S091'],
  "'mesmo serviço'": ['M059'], "'meu horário'": ['S092'], 'slot freed by a reschedule': ['M060'], 'next appointment without date': ['S093'], 'salon-wide list': ['S094'],
  'availability without professional': ['S095'], 'recurrence guard': ['S096', 'S097', 'R069'], 'contradictory encaixe under HARD_BLOCK': ['R070'], "'às 2' by salon hours": ['S098'],
};
const newIds = Object.values(NEW_ENTRIES).flat();
const filled = (example: BankExample) => examplePlaceholders(example).length ? fillExample(example, exampleFills(example, CANONICAL_FILL_SEED)!) : example;
const stub = (env: Record<string, string>) => { for (const [key, value] of Object.entries(env)) vi.stubEnv(key, value); };

describe('bank files', () => {
  it('bank.json is the concatenation of the parts; every entry loads; the new structures are present', () => {
    expect(bankFilesConsistent()).toBe(true);
    expect(exampleBank().invalid).toEqual([]);
    expect(raw.map(e => e.id)).toEqual(expect.arrayContaining(newIds));
    for (const id of newIds) expect(bankExample.parse(raw.find(e => e.id === id)).requires?.some(f => (P3C_FEATURES as readonly string[]).includes(f)), id).toBe(true);
  });
});

describe('strict decode on the candidate wire', () => {
  it('every entry decodes strictly with its requires flags on, and with every candidate flag on (unless it excludes one)', () => {
    const report = validateCandidateWire(raw);
    const subset = (feature: string) => raw.filter(e => exampleRequirements(bankExample.parse(e)).includes(feature as never)).length;
    console.info(JSON.stringify({ exampleBankContract: { entries: report.entries, checked: report.checked, excluded: report.excluded,
      same_as: subset('same_as'), polarity: subset('polarity'), ...Object.fromEntries(P3C_FEATURES.map(feature => [feature, subset(feature)])) } }));
    expect(report.issues).toEqual([]);
    expect(report.checked.requires).toBe(raw.length);
    expect(report.checked.every).toBe(raw.length - report.excluded);
    for (const feature of ['same_as', 'polarity', ...P3C_FEATURES]) expect(subset(feature), feature).toBeGreaterThan(0);
  }, 300_000);
  it('M025 (same_as to a read) is refused without REFERENCES_V2 and gated behind it; it decodes with the flag (D2 landed)', () => {
    const m025 = filled(bankExample.parse(raw.find(e => e.id === 'M025')));
    expect(exampleRequirements(m025)).toEqual(expect.arrayContaining(['same_as', 'references_v2']));
    const onlySameAs = featureEnv(['same_as']), context = exampleRoutingContext(m025), features = servedFeatures('components', exampleRequirements(m025));
    stub(onlySameAs);
    const full = wireTurn(m025, 'components', publishedWire(context, 'components', onlySameAs), features);
    expect(() => decodeConversationTurn(structuredClone(full), undefined, m025.message, { strict: true })).toThrow('SAME_AS_INVALID');
    vi.stubEnv('SALON_SECRETARY_REFERENCES_V2', 'true');
    expect(() => decodeConversationTurn(structuredClone(full), undefined, m025.message, { strict: true })).not.toThrow();
    expect(eligibleExamples(examplesState(undefined), new Set(['components', 'same_as'])).map(e => e.id)).not.toContain('M025');
    expect(eligibleExamples(examplesState(undefined), new Set(['components', 'same_as', 'references_v2'])).map(e => e.id)).toContain('M025');
  });
});

/** The real backend grounding of every rendered mutation/read example (flag-gated ones included). */
describe('backend cross-check on the candidate wire', () => {
  const tz = 'America/Sao_Paulo', now = new Date(`${EXAMPLE_CLOCK_DATE}T12:00:00Z`);
  const nearest = (weekday: number) => addCalendarDays(EXAMPLE_CLOCK_DATE, (weekday - weekdayOfDateKey(EXAMPLE_CLOCK_DATE) + 7) % 7 || 7);
  const expected = (legacy: unknown) => legacy === null ? null : typeof legacy === 'string' ? legacy : 'day_offset' in (legacy as object) ? addCalendarDays(EXAMPLE_CLOCK_DATE, (legacy as { day_offset: number }).day_offset)
    : 'weekday' in (legacy as object) ? nearest((legacy as { weekday: number }).weekday) : (legacy as { date: string }).date;
  const scheduling = new Set(['appointment.create', 'appointment.change', 'appointment.cancel', 'schedule.block', 'appointment.list', 'appointment.read', 'availability.get']);
  type Op = Record<string, unknown> & { item_key: string; operation: string; source_scope?: string | null; released_slot_of?: string | null; same_as?: { field: string; item_key: string; literal: string }[] | null };
  it.each(['requires', 'every'] as const)('%s flags: no contradiction, every exclusion proven, every same_as literal proven', async name => {
    const contradictions: string[] = [], asks: string[] = [], unproven: string[] = [];let checked = 0, exclusions = 0, references = 0;
    for (const entry of exampleBank().examples) {
      if (!['NEW', 'ADD', 'PATCH'].includes(entry.expected.mode) || name === 'every' && entry.excludes?.length) continue;
      const example = filled(entry), requirements = exampleRequirements(entry), env = name === 'every' ? { ...CANDIDATE_ENV } : featureEnv(requirements);
      stub(env);
      const context = exampleRoutingContext(example), full = wireTurn(example, 'components', publishedWire(context, 'components', env), servedFeatures('components', requirements));
      const decoded = (context ? await withConversationRouting(async () => decodeConversationTurn(full, undefined, example.message), context) : decodeConversationTurn(full, undefined, example.message)) as
        { new_request?: { operations: Op[] }; operations?: Op[] };
      // B4: an option choice rides beside the delta; the adapters only ever see the delta (as salon-secretary strips it).
      const operations = (decoded.new_request ?? decoded).operations!.map(({ choice: _choice, ...delta }) => { void _choice; return delta as Op; }), message = example.message;
      const state = example.state, waiting = 'requested_field' in state ? state.requested_field : undefined, candidates = 'candidates' in state ? state.candidates ?? [] : [];
      const daypart = waiting && candidates.length && candidates.every(c => /^\d\d:\d\d$/.test(c)) ? { pending_temporal_ambiguities: [{ field: waiting as 'time', kind: 'CLOCK_DAYPART' as const, expression: 'x',
        candidates: candidates as [string, string] }], draft_ref: 'draft', draft_revision: 1, expires_at: '2099-01-01T00:00:00.000Z' } : undefined;
      const clauseOf = (item: Op) => { const scoped = actionScopedSource(message, item as never, operations as never), at = scoped.scoped && item.source_scope ? message.indexOf(item.source_scope) : -1;
        return at >= 0 ? [at, at + item.source_scope!.length] as const : undefined; };
      const clauses = operations.flatMap(item => { const found = clauseOf(item); return found ? [found] : []; });
      for (const [index, op] of operations.entries()) {
        const bankOp = example.expected.operations[index];
        if (scheduling.has(String(op.operation))) {
          const projected = projectSchedulingOperation(op as never);
          const source = operations.length > 1 ? actionScopedSource(message, op as never, operations as never).text : message;
          const grounded = groundSchedulingTemporalTurn({}, projected.fields, source, tz, now, waiting, projected.operation, projected.temporal_evidence, daypart);
          for (const role of ['date', 'source_date', 'end_date', 'time', 'source_time', 'end_time'] as const) {
            const said = bankOp[role];if (!said) continue;
            checked++;
            const want = expected(said.legacy), got = (grounded.fields as Record<string, unknown>)[role];
            if (got === want) continue;
            if (got !== undefined && want !== null && !grounded.rejected.some(item => item.field === role)) contradictions.push(`${entry.id}.${bankOp.item_key}.${role}`);
            else if (want !== null) asks.push(`${entry.id}.${role}`);
          }
          for (const item of bankOp.excluded ?? []) { exclusions++; if (!grounded.exclusions?.verified.some(proof => proof.field === item.field)) unproven.push(`${entry.id}.excluded.${item.field}`); }
        }
        for (const ref of op.same_as ?? []) {
          if (op.operation === 'appointment.change' && ref.field === 'professional' || op.released_slot_of && ref.field !== 'service') continue;
          references++;
          const clause = clauseOf(op), sibling = operations.find(item => item.item_key === ref.item_key && item.item_key !== op.item_key);
          const subjects = sibling ? [sibling.customer_name, sibling.professional_name].filter((value): value is string => typeof value === 'string') : [];
          const proven = ref.item_key === op.item_key ? selfReferenceProven(message, ref.literal, clause, op.operation, tz, now, ref.field as never)
            : op.released_slot_of ? referenceLiteralProven(message, ref.literal, clause, 'appointment.create', [], tz, now, 'service')
            : referenceLiteralProven(message, ref.literal, clause, op.operation, subjects, tz, now, ref.field as never) ||
              !!sibling && distributiveReferenceProven(message, ref.literal, ref.field as never, clause, { op: sibling as never, clause: clauseOf(sibling) }, clauses, op.operation);
          if (!proven) unproven.push(`${entry.id}.${op.item_key}.same_as.${ref.field}`);
        }
      }
      vi.unstubAllEnvs();
    }
    console.info(JSON.stringify({ exampleBankContractGrounding: name, rolesChecked: checked, exclusions, references, backendAsks: asks }));
    expect(contradictions).toEqual([]);
    expect(unproven).toEqual([]);
    expect(checked).toBeGreaterThan(200); expect(exclusions).toBeGreaterThan(5); expect(references).toBeGreaterThan(10);
  }, 300_000);
});

describe('serving: flag-off unchanged, each Candidate 4 entry only behind its own flag', () => {
  const states = () => [examplesState(undefined),
    examplesState({ active_plan: { actions: [{ item_key: 'a', operation: 'appointment.create', status: 'NEEDS_INPUT', clarification: { missing_fields: ['time'], requested_field: 'time', candidates: [{ option_id: 'opt_1', label: 'x' }] } }] } }),
    examplesState({ active_plan: { actions: [{ item_key: 'a', operation: 'appointment.create', status: 'READY_FOR_CONFIRMATION', clarification: {} }] } })];
  it('flags off (and the historical components-only set): no new entry, no entry needing a Candidate 4 feature, none excluded by one', () => {
    for (const available of [availableExampleFeatures({}), new Set(['discard', 'components'] as const)])
      for (const state of states()) {
        const eligible = eligibleExamples(state, available);
        expect(eligible.some(e => newIds.includes(e.id))).toBe(false);
        // C4 R-A round 2 (contract migration): a flag-off entry may step aside only for a Candidate 4 feature (off here, so it is served as before).
        expect(eligible.some(e => exampleRequirements(e).some(f => (P3C_FEATURES as readonly string[]).includes(f)) || (e.excludes ?? []).some(f => !(P3C_FEATURES as readonly string[]).includes(f)))).toBe(false);
      }
  });
  it('availability follows each flag; R041 steps aside for its multi-service form; each new entry is served with its flags on', () => {
    expect([...availableExampleFeatures({})]).toEqual(['discard']);
    // Fixer (review B): same_as/polarity entries also need SALON_SECRETARY_EXAMPLES_V2 (Candidate 3 runs their flags with examples on).
    for (const [feature, flag] of Object.entries(EXAMPLE_FEATURE_FLAGS)) expect(availableExampleFeatures({ [flag!]: 'true', SALON_SECRETARY_EXAMPLES_V2: 'true' }).has(feature as never), feature).toBe(true);
    for (const feature of ['same_as', 'polarity'] as const) expect(availableExampleFeatures({ [EXAMPLE_FEATURE_FLAGS[feature]!]: 'true' }).has(feature), `${feature} without EXAMPLES_V2`).toBe(false);
    const answer = examplesState({ active_plan: { actions: [{ item_key: 'a', operation: 'appointment.create', status: 'NEEDS_INPUT', clarification: { missing_fields: ['time'], requested_field: 'time' } }] } });
    const base = new Set(['discard', 'components', 'same_as', 'polarity'] as const);
    expect(eligibleExamples(answer, base).map(e => e.id)).toContain('R041');
    const multi = eligibleExamples(answer, new Set([...base, 'multi_service'] as const)).map(e => e.id);
    expect(multi).not.toContain('R041'); expect(multi).toContain('R068');
    // C4 R-A round 2: the historical "trocar a profissional = UNSUPPORTED" entries step aside for the alteration's own entry (S086).
    const fresh = examplesState(undefined), historical = eligibleExamples(fresh, base).map(e => e.id), altered = eligibleExamples(fresh, new Set([...base, 'alter'] as const)).map(e => e.id);
    expect(historical).toEqual(expect.arrayContaining(['S036', 'R055'])); expect(historical).not.toContain('S086');
    expect(altered).not.toContain('S036'); expect(altered).not.toContain('R055'); expect(altered).toContain('S086');
    for (const id of newIds) {
      const entry = exampleBank().examples.find(e => e.id === id)!, needs = new Set([...exampleRequirements(entry), 'discard', 'components']);
      const state = entry.state.kind === 'NEW' ? examplesState(undefined) : examplesState({ active_plan: { actions: [{ item_key: 'a', operation: 'appointment.create', status: 'NEEDS_INPUT',
        clarification: { missing_fields: ['x'], requested_field: 'x' } }] } });
      const features = new Set([...needs].filter(f => f !== 'selection')) as Set<never>, withState = { ...state, features: needs.has('selection') ? ['selection' as const] : [] };
      expect(eligibleExamples(withState, features).map(e => e.id), id).toContain(id);
      const without = [...needs].find(f => (P3C_FEATURES as readonly string[]).includes(f))!;
      expect(eligibleExamples(withState, new Set([...features].filter(f => f !== without)) as Set<never>).map(e => e.id), `${id} without ${without}`).not.toContain(id);
    }
  });
});
