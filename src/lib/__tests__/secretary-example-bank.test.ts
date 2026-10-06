import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { withConversationRouting, decodeConversationTurn } from '@everflair/salon-secretary';
import { exampleBank, exampleRequirements, EXAMPLE_CLOCK_DATE, type BankExample } from '../../../packages/salon-secretary/src/examples/bank';
import { fillExample, type ExampleFills } from '../../../packages/salon-secretary/src/examples/fill';
import { compactNotation, derivedScopes, exampleLine, renderExampleTurn, sharedIntervalLiteral } from '../../../packages/salon-secretary/src/examples/render';
import { bankFilesConsistent, evaluationCorpus, exampleRoutingContext, publishedWire, tokenJaccard, validateExampleBank, wireTurn, CONTAMINATION_THRESHOLD }
  from '../../../packages/salon-secretary/src/examples/validate';
import { projectSchedulingOperation } from '../secretary-operation-projection';
import { groundSchedulingTemporalTurn } from '../scheduling-temporal-mode';
import { temporalQuoteDenied } from '../scheduling-temporal-source';
import { actionScopedSource } from '../secretary-sibling-scope';
import { literalSpans } from '../../../packages/salon-secretary/src/literal-match';
import { addCalendarDays, weekdayOfDateKey } from '../time';

/** C2 example bank: loader, validation gate (wire, literals, safety lint, anti-contamination) and a
 * backend cross-check that no example teaches a value the grounding would read differently. */
afterEach(() => { vi.unstubAllEnvs(); });
const raw = JSON.parse(readFileSync(join(process.cwd(), 'packages/salon-secretary/src/examples/bank.json'), 'utf8')) as BankExample[];
// G1 migration (backup: .demo/agenda-core/contract-migration/secretary-example-bank.test.before-g1.ts): the bank carries
// name/service placeholders now; the entries these tests pin are filled with the names they had, so every expectation
// below and every mutation template is byte-identical to before.
const FORMER: Record<string, ExampleFills> = {
  S001: { people: { cliente: { given: 'julia' }, profissional: { given: 'tati', nickname: 'tati' } }, services: { servico: 'escova' } },
  M001: { people: { cliente: { given: 'bia', nickname: 'bia' }, cliente2: { given: 'renan' } }, services: { servico: 'corte' } },
  R062: { people: { cliente: { given: 'Lara' }, profissional: { given: 'Juca' } }, services: {} },
};
const byId = (id: string) => { const entry = structuredClone(raw.find(example => example.id === id)!); return FORMER[id] ? fillExample(entry, FORMER[id]) : entry; };

describe('bank files and loader', () => {
  it('bank.json is exactly the concatenation of the S, M and R parts and every entry loads', () => {
    expect(bankFilesConsistent()).toBe(true);
    const bank = exampleBank();
    expect(bank.invalid).toEqual([]);
    expect(bank.examples.map(e => e.id)).toEqual(raw.map(e => e.id));
    expect(new Set(raw.map(e => e.id)).size).toBe(raw.length);
    expect(bank.sha256).toMatch(/^[0-9a-f]{64}$/);
  });
});

describe('validation gate', () => {
  it('every bank entry passes every filter on the legacy and the components wire', () => {
    const report = validateExampleBank(raw);
    console.info(JSON.stringify({ exampleBankGate: { entries: report.entries, valid: report.valid, rendered: report.rendered, skipped: report.skipped } }));
    expect(report.issues).toEqual([]);
    expect(report.valid).toBe(raw.length);
    expect(report.rendered.legacy).toBeGreaterThan(100); expect(report.rendered.components).toBeGreaterThan(report.rendered.legacy);
  }, 60_000);
  // One deliberately bad entry per filter, derived from a good one.
  const good = () => byId('S001'); // "poe a julia na escova amanha 10h com a tati" (C7: rewritten off the dev batteries' frame)
  const codes = (entry: unknown, corpus: { source: string; text: string }[] = []) => validateExampleBank([entry], { corpus }).issues.map(issue => issue.code);
  it('accepts the unmodified base entry', () => { expect(codes(good())).toEqual([]); });
  it.each<[string, (e: BankExample) => unknown, string]>([
    ['format: unknown key', e => ({ ...e, extra: 1 }), 'FORMAT'],
    ['wire: field the operation does not publish', e => { (e.expected.operations[0] as Record<string, unknown>).target_name = { value: 'julia', literal: 'julia' }; return e; }, 'WIRE_SCHEMA'],
    ['wire: unpublished operation', e => { e.expected.operations[0].operation = 'appointment.delete'; return e; }, 'OPERATION_UNPUBLISHED'],
    ['decode: dependency on an unknown key', e => { e.expected.operations[0].depends_on = ['z']; return e; }, 'DECODE'],
    ['literal absent from the message', e => { e.expected.operations[0].service_name = { value: 'luzes', literal: 'luzes' }; return e; }, 'LITERAL_ABSENT'],
    ['literal repeated in the message', e => ({ ...e, message: e.message + ' e depois escova de novo' }), 'LITERAL_REPEATED'],
    ['homonym/typo auto-picked (name not as said)', e => { e.expected.operations[0].customer_name = { value: 'Júlia Martins', literal: 'julia' }; return e; }, 'NAME_NOT_AS_SAID'],
    ['time invented from a word without a clock', e => ({ ...e, message: 'marca a julia amanha cedo pra escova com a tati',
      expected: { ...e.expected, operations: [{ ...e.expected.operations[0], time: { components: { hour: 8, minute: 0, daypart: 'MANHA' }, legacy: '08:00', literal: 'cedo' } }] } }), 'TIME_WITHOUT_CLOCK'],
    ['cancellation reason paraphrased', e => ({ ...e, message: 'cancela a julia amanha pq ela nao pode', expected: { ...e.expected, operations: [{ item_key: 'a', operation: 'appointment.cancel',
      customer_name: e.expected.operations[0].customer_name, date: e.expected.operations[0].date, reason: { value: 'cliente indisponível', literal: 'ela nao pode' } }] } }), 'REASON_NOT_LITERAL'],
    ['negation turned into an affirmative operation', e => ({ ...e, message: 'nao marca a julia amanha as 10 pra escova com a tati' }), 'NEGATION_AFFIRMED'],
    ['internal id as a value', e => ({ ...e, message: 'marca 0f8fad5b-d9cb-469f-a165-70867728950e amanha as 10 pra escova com a tati',
      expected: { ...e.expected, operations: [{ ...e.expected.operations[0], customer_name: { value: '0f8fad5b-d9cb-469f-a165-70867728950e', literal: '0f8fad5b-d9cb-469f-a165-70867728950e' } }] } }), 'ID_LIKE_VALUE'],
    ['feature used but not declared', e => { e.expected.operations[0].time!.legacy = null; return e; }, 'REQUIRES_UNDECLARED'],
    ['conversation without a reply', e => ({ ...e, expected: { mode: 'CONVERSATION', operations: [], secretary_should: 'x' } }), 'CONVERSATION_RESPONSE_MISSING'],
    ['compound request whose clauses cannot be told apart', e => ({ ...e, expected: { ...e.expected, operations: [e.expected.operations[0], { item_key: 'b', operation: 'appointment.list' }] } }), 'SCOPE_UNDERIVABLE'],
  ])('rejects %s', (_label, mutate, code) => { expect(codes(mutate(good()))).toContain(code); });
  it('rejects a quantity literal that would need a paid repair (inventory proofs are exact)', () => {
    const entry = byId('R048'); // "chegou 2 pacote de algodao"
    entry.expected.operations[0].inventory!.quantity!.literal = '2 PACOTE';
    expect(codes(entry)).toContain('LITERAL_REPAIR_NEEDED');
  });
  it('rejects contamination with an evaluation message (token Jaccard >= 0.6), reporting only ids and scores', () => {
    const issues = validateExampleBank([good()], { corpus: [{ source: 'battery.json#X01', text: 'poe a julia na escova amanha 10h com a tati hoje' }] }).issues;
    expect(issues).toEqual([{ id: 'S001', code: 'CONTAMINATION', detail: expect.stringMatching(/^battery\.json#X01 jaccard=0\.9\d$/) }]);
    expect(JSON.stringify(issues)).not.toContain('julia');
    expect(tokenJaccard('Marcá a Júlia', 'marca a julia')).toBe(1);
    expect(tokenJaccard('a b c d e', 'a b c x y')).toBeLessThan(CONTAMINATION_THRESHOLD);
  });
  it('reads the dev batteries and the Golden 30 messages for the anti-contamination check', () => {
    const corpus = evaluationCorpus();
    const sources = new Set(corpus.map(item => item.source.split('#')[0]));
    for (const file of ['agenda-practice-natural.json', 'agenda-practice-variations.json', 'agenda-practice-scenarios.json', 'SECRETARY_GOLDEN_FREE_USE_30.md']) expect(sources).toContain(file);
    expect(corpus.length).toBeGreaterThan(150);
    expect(corpus.every(item => !item.text.includes('{{'))).toBe(true);
  });
});

describe('rendering into the active live wire', () => {
  it('legacy wire: selectors {value,literal}, no components; components wire: typed container, no computed selectors', () => {
    const s001 = byId('S001');
    expect(renderExampleTurn(s001, 'legacy')).toEqual({ mode: 'NEW', operations: [{ operation: 'appointment.create', item_key: 'a', customer_name: 'julia', service_name: 'escova', professional_name: 'tati',
      day_offset: { value: 1, literal: 'amanha' }, time: { value: '10:00', literal: '10h' } }] });
    expect(renderExampleTurn(s001, 'components')).toEqual({ mode: 'NEW', operations: [{ operation: 'appointment.create', item_key: 'a', customer_name: 'julia', service_name: 'escova', professional_name: 'tati',
      components: { date: { value: { kind: 'RELATIVE_DAY', offset: 1 }, literal: 'amanha' }, time: { value: { hour: 10, minute: 0, daypart: 'UNSPECIFIED' }, literal: '10h' } } }] });
    expect(exampleLine(s001, 'legacy')).toBe("- MENSAGEM: poe a julia na escova amanha 10h com a tati → {mode:'NEW',operations:[{operation:'appointment.create',item_key:'a',customer_name:'julia',service_name:'escova',professional_name:'tati',day_offset:{value:1,literal:'amanha'},time:{value:'10:00',literal:'10h'}}]}");
  });
  it('an interval gives time and end_time the same whole literal on the components wire (the daypart said once qualifies both)', () => {
    const s067 = byId('S067'); // "... quarta das 2 as 4 da tarde ..."
    const turn = renderExampleTurn(s067, 'components') as { operations: { components: Record<string, { literal: string }> }[] };
    expect(turn.operations[0].components.time.literal).toBe('das 2 as 4 da tarde');
    expect(turn.operations[0].components.end_time.literal).toBe('das 2 as 4 da tarde');
    expect((renderExampleTurn(s067, 'legacy') as { operations: Record<string, { literal: string }>[] }).operations[0].time.literal).toBe('2');
    expect(sharedIntervalLiteral('bloqueia das 10 as 11 do dia 28', '10', '11')).toBe('das 10 as 11');
    expect(sharedIntervalLiteral('10h marca e 11h cancela', '10h', '11h')).toBeUndefined();
  });
  it('a compound request carries one exact, unique clause per operation (source_scope)', () => {
    const m001 = byId('M001');
    expect(derivedScopes(m001)).toEqual(['remarca a bia de amanha 10h pra quinta as 3 da tarde', 'cancela o corte do renan de sexta pq ele viajou']);
    expect(compactNotation({ a: null, b: [], c: "it's", d: [1, null], e: { f: undefined } })).toBe("{c:'it\\'s',d:[1],e:{}}");
  });
  it('answers to a published daypart candidate keep the legacy selector on both wires', () => {
    const r009 = byId('R009');
    for (const wire of ['legacy', 'components'] as const)
      expect(renderExampleTurn(r009, wire)).toEqual({ mode: 'PATCH', operations: [{ item_key: 'a', fields: { time: { value: '15:00', literal: 'da tarde' } } }] });
  });
  it('several open questions are shown to the model; the short reply patches only its field', () => {
    const r062 = byId('R062');
    expect(exampleLine(r062, 'legacy')).toBe("- PENDENTE: a appointment.cancel falta reason (Qual o motivo do cancelamento da Lara?); b schedule.block falta end_time (Até que horas fica o bloqueio do Juca na quinta?) | MENSAGEM: adoeceu → {mode:'PATCH',operations:[{item_key:'a',fields:{reason:'adoeceu'}}]}");
  });
});

/** The real backend grounding over every rendered example: a CONTRADICTION (the backend accepts a
 * different day/clock than the example teaches) fails; a conservative backend question is reported. */
describe('backend cross-check (grounding of the rendered examples)', () => {
  const tz = 'America/Sao_Paulo', now = new Date(`${EXAMPLE_CLOCK_DATE}T12:00:00Z`);
  const nearest = (weekday: number) => addCalendarDays(EXAMPLE_CLOCK_DATE, (weekday - weekdayOfDateKey(EXAMPLE_CLOCK_DATE) + 7) % 7 || 7);
  const expected = (legacy: unknown) => legacy === null ? null : typeof legacy === 'string' ? legacy : 'day_offset' in (legacy as object) ? addCalendarDays(EXAMPLE_CLOCK_DATE, (legacy as { day_offset: number }).day_offset)
    : 'weekday' in (legacy as object) ? nearest((legacy as { weekday: number }).weekday) : (legacy as { date: string }).date;
  const scheduling = new Set(['appointment.create', 'appointment.change', 'appointment.cancel', 'schedule.block', 'appointment.list', 'appointment.read', 'availability.get']);
  it.each(['legacy', 'components'] as const)('%s wire: no contradiction; questions only where the backend is conservative', async wire => {
    vi.stubEnv('SALON_SECRETARY_TEMPORAL_COMPONENTS', wire === 'components' ? 'true' : 'false');
    const contradictions: string[] = [], asks: string[] = [];let checked = 0;
    for (const example of exampleBank().examples) {
      if (exampleRequirements(example).some(feature => !(feature === 'components' && wire === 'components')) || !['NEW', 'ADD', 'PATCH'].includes(example.expected.mode)) continue;
      const context = exampleRoutingContext(example), full = wireTurn(example, wire, publishedWire(context, wire));
      const decoded = (context ? await withConversationRouting(async () => decodeConversationTurn(full, undefined, example.message), context) : decodeConversationTurn(full, undefined, example.message)) as
        { new_request?: { operations: Record<string, unknown>[] }; operations?: Record<string, unknown>[] };
      const operations = (decoded.new_request ?? decoded).operations!;
      const state = example.state, waiting = 'requested_field' in state ? state.requested_field : undefined, candidates = 'candidates' in state ? state.candidates ?? [] : [];
      const daypart = waiting && candidates.length && candidates.every(c => /^\d\d:\d\d$/.test(c)) ? { pending_temporal_ambiguities: [{ field: waiting as 'time', kind: 'CLOCK_DAYPART' as const, expression: 'x',
        candidates: candidates as [string, string] }], draft_ref: 'draft', draft_revision: 1, expires_at: '2099-01-01T00:00:00.000Z' } : undefined;
      for (const [index, op] of operations.entries()) {
        if (!scheduling.has(String(op.operation))) continue;
        const projected = projectSchedulingOperation(op), bankOp = example.expected.operations[index];
        const source = operations.length > 1 ? actionScopedSource(example.message, op as never, operations as never).text : example.message;
        const grounded = groundSchedulingTemporalTurn({}, projected.fields, source, tz, now, waiting, projected.operation, projected.temporal_evidence, daypart);
        for (const role of ['date', 'source_date', 'end_date', 'time', 'source_time', 'end_time'] as const) {
          const said = bankOp[role];if (!said) continue;
          checked++;
          const want = expected(said.legacy), got = (grounded.fields as Record<string, unknown>)[role];
          if (got === want) continue;
          if (got !== undefined && want !== null && !grounded.rejected.some(item => item.field === role)) contradictions.push(`${example.id}.${bankOp.item_key}.${role}`);
          else if (want !== null) asks.push(`${example.id}.${role}`);
        }
      }
    }
    console.info(JSON.stringify({ exampleBankBackendCheck: wire, rolesChecked: checked, backendAsks: asks }));
    expect(contradictions).toEqual([]);
    expect(checked).toBeGreaterThan(150);
  }, 60_000);
  it('the backend never denies a temporal quote of a rendered mutation example, except a negator quoted inside its reason', () => {
    const denied: string[] = [];
    for (const example of exampleBank().examples) {
      if (exampleRequirements(example).some(feature => feature !== 'components')) continue;
      const reasons = example.expected.operations.flatMap(op => op.reason ? literalSpans(example.message, op.reason.literal) : []);
      for (const op of example.expected.operations) for (const role of ['date', 'source_date', 'end_date', 'time', 'source_time', 'end_time'] as const) {
        const said = op[role];if (!said || !['appointment.create', 'appointment.change', 'appointment.cancel', 'schedule.block'].includes(op.operation)) continue;
        for (const [start, end] of literalSpans(example.message, said.literal)) if (temporalQuoteDenied(example.message, start, end, op.operation) &&
          !reasons.some(([a, b]) => /\b(?:nao|não|nunca|jamais|nem)\b/i.test(example.message.slice(a, b)))) denied.push(`${example.id}.${role}`);
      }
    }
    expect(denied).toEqual([]);
  });
});
