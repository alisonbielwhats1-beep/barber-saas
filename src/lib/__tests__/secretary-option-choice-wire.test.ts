import { afterEach, describe, expect, it, vi } from 'vitest';
import Ajv from 'ajv';
import { createPaidModel, runServicesTurn, withConversationRouting, withSalonDirectory, decodeConversationTurn, SecretaryNewRequest, conversationRoutingInstructions,
  existingOperationsWire, examplesState, eligibleExamples, type Model, type SecretarySkill, type SecretaryWireSchema } from '@everflair/salon-secretary';
import { completeForWire, publishedWire } from '../../../packages/salon-secretary/src/examples/validate';
import { exampleBank, exampleRequirements } from '../../../packages/salon-secretary/src/examples/bank';
import { exampleLine } from '../../../packages/salon-secretary/src/examples/render';
import { invalidSourceLiterals, assertSourceLiteralRepair } from '../../../packages/salon-secretary/src/source-literal-repair';
import { clarificationContext } from '../secretary-clarification';
import { optionId, optionIndex } from '../secretary-options';

/** B4 wire: option ids published per card, a `choice` enum per carded PATCH item, nothing added without a card. */
afterEach(() => { vi.unstubAllGlobals(); vi.unstubAllEnvs(); });
const PLAN = '10000000-0000-4000-8000-000000000001';
const options = (labels: string[]) => labels.map((label, index) => ({ option_id: optionId(index), label }));
const action = (item_key: string, operation: string, candidates?: string[]) => ({ item_key, operation, status: 'NEEDS_INPUT', depends_on: [], fields: { customer_name: 'Pessoa Sintética' },
  clarification: { missing_fields: candidates ? ['selection'] : ['time'], requested_field: candidates ? 'customer_ref' : 'time', previous_response: 'Pergunta sintética', ...(candidates ? { response_fields: ['customer_name'], candidates: options(candidates) } : {}) } });
const carded = { active_plan: { plan_ref: PLAN, actions: [action('a', 'appointment.cancel', ['Amanda Souza · (11) *****-0001', 'Amanda Lima · (11) *****-0002']), action('b', 'appointment.create')] } };
const plain = { active_plan: { plan_ref: PLAN, actions: [action('a', 'appointment.cancel'), action('b', 'appointment.create')] } };
type Schema = SecretaryWireSchema;
const resolve = (schema: Schema, root: Schema): Schema => { let current = schema; while (typeof current.$ref === 'string') current = root.$defs![current.$ref.slice('#/$defs/'.length)]; return current; };
const branch = (wire: Schema, mode: string) => resolve(wire.properties!.turn, wire).anyOf!.map(item => resolve(item, wire)).find(item => resolve(item.properties!.mode, wire).enum![0] === mode)!;
const patchItems = (wire: Schema) => resolve(resolve(branch(wire, 'PATCH').properties!.operations, wire).items!, wire);
const fields = { operation: 'appointment.cancel', customer_name: null };
const turn = (item: Record<string, unknown>) => ({ turn: { mode: 'PATCH', operations: [item] } });

describe('clarification context', () => {
  it('publishes each candidate with its positional option id and label only (never a ref)', () => {
    const context = clarificationContext({ operation: 'appointment.cancel', fields: { customer_name: 'Amanda', customer_ref: 'private-ref' }, waiting_for: 'customer_ref', message: 'Qual Amanda?',
      selection: { field: 'customer_ref', labels: ['Amanda Souza · (11) *****-0001', 'Amanda Lima · (11) *****-0002'] } });
    expect(context.clarification.candidates).toEqual([{ option_id: 'opt_1', label: 'Amanda Souza · (11) *****-0001' }, { option_id: 'opt_2', label: 'Amanda Lima · (11) *****-0002' }]);
    expect(JSON.stringify(context)).not.toContain('private-');
    expect([optionIndex('opt_1'), optionIndex('opt_20'), optionIndex('opt_0'), optionIndex('a1'), optionIndex('opt_100')]).toEqual([0, 19, -1, -1, -1]);
  });
});

describe.each(['legacy', 'components'] as const)('PATCH wire on the %s transport', transport => {
  it('an item with an open card gets its own branch whose choice enumerates only that card; others keep the historical item', () => {
    const wire = publishedWire(carded, transport), items = patchItems(wire).anyOf!.map(item => resolve(item, wire));
    expect(items).toHaveLength(2);
    const [others, card] = items;
    expect(others.required).toEqual(['item_key', 'fields']); expect(resolve(others.properties!.item_key, wire).enum).toEqual(['b']);
    expect(card.required).toEqual(['item_key', 'choice', 'fields']); expect(resolve(card.properties!.item_key, wire).enum).toEqual(['a']);
    const choice = resolve(card.properties!.choice, wire), picked = resolve(choice.anyOf![0], wire);
    expect(resolve(picked.properties!.option_id, wire).enum).toEqual(['opt_1', 'opt_2']); expect(resolve(choice.anyOf![1], wire)).toEqual({ type: 'null' });
    const validate = new Ajv({ allErrors: true }).compile(wire);
    const ok = completeForWire(turn({ item_key: 'a', choice: { option_id: 'opt_2', literal: 'a Lima' }, fields }), wire, wire);
    expect(validate(ok)).toBe(true);
    for (const bad of [turn({ item_key: 'a', choice: { option_id: 'opt_3', literal: 'a terceira' }, fields }), turn({ item_key: 'b', choice: { option_id: 'opt_1', literal: 'a primeira' }, fields: { ...fields, operation: 'appointment.create' } }),
      turn({ item_key: 'a', choice: { option_id: 'opt_1', literal: '' }, fields }), turn({ item_key: 'a', choice: { option_id: 'opt_1', literal: 'x', extra: 1 }, fields })])
      expect(validate(completeForWire(bad, wire, wire))).toBe(false);
    const none = completeForWire(turn({ item_key: 'a', fields }), wire, wire);
    expect(validate(none)).toBe(true); // choice: null = no choice (a refinement or another answer)
  });
  it('without an open card the PATCH item and DISCARD keys are the historical ones (no choice, no bytes added)', () => {
    const wire = publishedWire(plain, transport), items = patchItems(wire);
    expect(items.anyOf).toBeUndefined(); expect(items.required).toEqual(['item_key', 'fields']); expect(items.properties!.choice).toBeUndefined();
    const discard = resolve(branch(wire, 'DISCARD').properties!.item_keys, wire).anyOf!.map(item => resolve(item, wire))[0];
    expect(resolve(discard.items!, wire)).toEqual(resolve(items.properties!.item_key, wire));
    expect(JSON.stringify(wire)).not.toContain('"choice"');
  });
  it('RESUME patches of a suspended plan never publish a choice', () => {
    const wire = publishedWire({ active_plan: plain.active_plan, suspended_plans: [{ plan_ref: '20000000-0000-4000-8000-000000000001', actions: carded.active_plan.actions.map(item => ({ ...item, item_key: item.item_key + '_s' })) }] }, transport);
    const resume = JSON.stringify(branch(wire, 'RESUME'));
    expect(resume).not.toContain('choice');
    expect(existingOperationsWire(carded.active_plan.actions)).toEqual(existingOperationsWire(plain.active_plan.actions));
  });
});

describe('decoding', () => {
  it('a choice rides beside the capability delta through decode and the PATCH route; null or absent means none', async () => {
    await withConversationRouting(async () => {
      const decoded = decodeConversationTurn(turn({ item_key: 'a', choice: { option_id: 'opt_2', literal: 'a Lima' }, fields: { operation: null } }), undefined, 'a Lima') as { new_request: { operations: Record<string, unknown>[] }; new_request_mode: string };
      expect(decoded.new_request_mode).toBe('PATCH');
      expect(decoded.new_request.operations[0]).toMatchObject({ item_key: 'a', operation: 'appointment.cancel', choice: { option_id: 'opt_2', literal: 'a Lima' } });
      // The route re-validates the flat delta (choice kept).
      expect((new SecretaryNewRequest(decoded.new_request, 'PATCH').selection.operations[0] as { choice?: unknown }).choice).toEqual({ option_id: 'opt_2', literal: 'a Lima' });
      for (const item of [{ item_key: 'a', choice: null, fields: { operation: null } }, { item_key: 'a', fields: { operation: null } }]) {
        const operation = (decodeConversationTurn(turn(item), undefined, 'x') as { new_request: { operations: Record<string, unknown>[] } }).new_request.operations[0];
        expect('choice' in operation).toBe(false);
      }
      expect(() => decodeConversationTurn(turn({ item_key: 'a', choice: { option_id: 'a-ref', literal: 'x' }, fields: {} }), undefined, 'x')).toThrow();
    }, carded);
  });
  // Review 2b contract migration: the choice literal is no longer a paid-repair witness (a repair could swap
  // unproven words for any substring while option_id stays). The backend asks again (OPTION_LITERAL_ABSENT).
  it('the choice literal is never a repair witness: absent → no transport repair (asked again by the backend)', () => {
    const raw = (literal: string) => turn({ item_key: 'a', choice: { option_id: 'opt_2', literal }, fields: { operation: null } });
    expect(invalidSourceLiterals(raw('a segunda'), 'A LIMA.')).toEqual([]);
    expect(invalidSourceLiterals(raw('a lima'), 'A LIMA.')).toEqual([]);
    // Even beside a temporal quote that does need a repair, the choice literal is not a repairable leaf.
    const both = turn({ item_key: 'a', choice: { option_id: 'opt_2', literal: 'a segunda' }, fields: { operation: null, time: { value: '16:00', literal: '4pm' } } });
    expect(invalidSourceLiterals(both, 'A LIMA às 16h.')).toEqual([['turn', 'operations', 0, 'fields', 'time', 'literal']]);
    const repaired = structuredClone(both) as unknown as { turn: { operations: { choice: { literal: string }; fields: { time: { literal: string } } }[] } };
    repaired.turn.operations[0].fields.time.literal = 'às 16h'; repaired.turn.operations[0].choice.literal = 'A LIMA';
    expect(() => assertSourceLiteralRepair(both, repaired, invalidSourceLiterals(both, 'A LIMA às 16h.'), 'A LIMA às 16h.')).toThrow('SOURCE_LITERAL_REPAIR_INVALID');
  });
  it('the routing instructions say where a choice goes and no longer ask for a name/date echo to choose', () => {
    expect(conversationRoutingInstructions).toContain('choice={option_id,literal}');
    expect(conversationRoutingInstructions).not.toContain('para a escolha/refinamento');
  });
});


/** Offline SDK request through a fake transport (no network): the body bytes and how the turn ended. */
const salon = { professionals: Array.from({ length: 8 }, (_, i) => `Profissional Sintética ${i}`), services: Array.from({ length: 24 }, (_, i) => `Serviço Sintético Completo ${i}`),
  today: { date: '2026-09-28', weekday: 'segunda-feira', timezone: 'America/Sao_Paulo' } };
async function liveTurn(context: object, answer: unknown, message: string, options: { components?: boolean; directory?: typeof salon; skill?: SecretarySkill | 'discovery' } = {}) {
  vi.stubEnv('SALON_SECRETARY_V2_MAX_OUTPUT_TOKENS', '8192'); vi.stubEnv('SALON_SECRETARY_MULTI_ACTION_V2_ENABLED', 'true'); vi.stubEnv('SALON_SECRETARY_TEMPORAL_COMPONENTS', String(options.components ?? false));
  let bytes = 0;
  const transport = vi.fn(async (_url: unknown, init?: RequestInit) => {
    bytes = Buffer.byteLength(String(init?.body), 'utf8');
    const request = JSON.parse(String(init?.body));
    return new Response(JSON.stringify({ id: 'resp_offline', object: 'response', created_at: 0, status: 'completed', model: 'gpt-6-luna', output: [{ id: 'fc', call_id: 'call', type: 'function_call',
      name: request.tools[0].name, arguments: JSON.stringify(answer), status: 'completed' }], usage: { input_tokens: 10, output_tokens: 10, total_tokens: 20 } }), { status: 200, headers: { 'content-type': 'application/json' } });
  });
  vi.stubGlobal('fetch', transport);
  const model = await createPaidModel({ SALON_SECRETARY_ALLOW_PAID_CALLS: 'true', SALON_SECRETARY_MODEL: 'gpt-6-luna', SALON_SECRETARY_OPENAI_API_KEY: 'synthetic-offline-not-a-key', SALON_SECRETARY_OPENAI_PROJECT: 'proj_offline' });
  const run = () => withConversationRouting(() => (runServicesTurn as (m: Model, msg: string, f: object, r: object, s: SecretarySkill | 'discovery', v2: boolean) => Promise<unknown>)(model, message, {}, {}, options.skill ?? 'discovery', true), context);
  let error: unknown;
  try { await (options.directory ? withSalonDirectory(options.directory, run) : run()); } catch (caught) { error = caught; }
  return { bytes, error, calls: transport.mock.calls.length };
}

describe('live parser: the exact published wire, compiled for the provider answer', () => {
  it.each([false, true])('components=%s: a published option id routes as PATCH with its choice; another id is refused before any use', async components => {
    const wire = publishedWire(carded, components ? 'components' : 'legacy');
    const answer = (option_id: string) => completeForWire(turn({ item_key: 'a', choice: { option_id, literal: 'a Lima' }, fields }), wire, wire);
    const ok = await liveTurn(carded, answer('opt_2'), 'É a Lima.', { components });
    expect(ok.error).toBeInstanceOf(SecretaryNewRequest);
    const routed = ok.error as SecretaryNewRequest;
    expect(routed.mode).toBe('PATCH'); expect((routed.selection.operations[0] as { choice?: unknown }).choice).toEqual({ option_id: 'opt_2', literal: 'a Lima' });
    const bad = await liveTurn(carded, answer('opt_3'), 'É a Lima.', { components });
    expect(bad.error).toBeDefined(); expect(bad.error).not.toBeInstanceOf(SecretaryNewRequest); expect(bad.calls).toBe(1);
  });
});

describe('request budget with open cards', () => {
  const operationsList = ['service.change', 'customer.change', 'appointment.create', 'appointment.change', 'appointment.cancel'];
  const labels = Array.from({ length: 20 }, (_, i) => `Cliente Sintética ${i} · (11) *****-${String(i).padStart(4, '0')}`);
  // 5 open actions, two of them on a full 20-option card; 5 suspended plans of 5 actions each.
  const context = (ids: boolean) => {
    const strip = (item: ReturnType<typeof action>) => {
      const candidates = (item.clarification as { candidates?: { label: string }[] }).candidates;
      return ids || !candidates ? item : { ...item, clarification: { ...item.clarification, candidates: candidates.map(({ label }) => ({ label })) } };
    };
    return { active_plan: { plan_ref: PLAN, actions: operationsList.map((operation, i) => strip({ ...action('item_' + i, operation, [2, 4].includes(i) ? labels : undefined), fields: {} as { customer_name: string } })) },
      suspended_plans: Array.from({ length: 5 }, (_, p) => ({ plan_ref: '20000000-0000-4000-8000-' + String(p + 1).padStart(12, '0'),
        actions: operationsList.map((operation, i) => ({ ...action(`item_${i}_p${p}`, operation), fields: {} })) })) };
  };
  const answer = { turn: { mode: 'CONVERSATION', response: 'Oi!' } };
  it.each([false, true].flatMap(components => (['discovery', 'scheduling'] as const).map(skill => ({ components, skill }))))(
    'components=$components $skill: <= 64000 with output 8192; option ids and choices cost a bounded amount per card', async ({ components, skill }) => {
      const withIds = await liveTurn(context(true), answer, 'A segunda.', { components, skill, directory: salon });
      const labelsOnly = await liveTurn(context(false), answer, 'A segunda.', { components, skill, directory: salon });
      expect(withIds.error).toBeInstanceOf(SecretaryNewRequest); expect(labelsOnly.error).toBeInstanceOf(SecretaryNewRequest);
      const overhead = withIds.bytes - labelsOnly.bytes;
      console.info(JSON.stringify({ optionChoiceBudget: { components, skill, requestBytes: withIds.bytes, inputUpper: withIds.bytes + 8192, labelsOnlyBytes: labelsOnly.bytes, overhead, cards: 2, optionsPerCard: 20 } }));
      expect(withIds.bytes + 8192).toBeLessThanOrEqual(64000);
      expect(overhead).toBeGreaterThan(0); expect(overhead).toBeLessThanOrEqual(2 * (20 * 30 + 700));
    });
});

describe('few-shot examples (flag SALON_SECRETARY_EXAMPLES)', () => {
  it('an open option card makes the choice examples eligible and they render {item_key, choice, fields}; without a card they stay out', () => {
    const withCard = examplesState(carded), without = examplesState(plain);
    expect(withCard.features).toEqual(['selection']); expect(without.features).toBeUndefined();
    const picks = eligibleExamples(withCard).filter(example => exampleRequirements(example).includes('selection'));
    expect(picks.map(example => example.id)).toEqual(expect.arrayContaining(['R024', 'R025', 'R027', 'R028', 'R029', 'R030']));
    expect(eligibleExamples(without).some(example => exampleRequirements(example).includes('selection'))).toBe(false);
    const r025 = exampleBank().examples.find(example => example.id === 'R025')!;
    expect(exampleLine(r025, 'legacy')).toContain("opções: opt_1 ter, 13/04 às 10h | opt_2 ter, 13/04 às 14h | opt_3 ter, 13/04 às 16h30 | MENSAGEM: prefiro esse das 14h → {mode:'PATCH',operations:[{item_key:'a',choice:{option_id:'opt_2',literal:'das 14h'},fields:{}}]}");
    // A daypart candidate (a temporal question) is a selector value, not an option: no ids there.
    expect(exampleLine(exampleBank().examples.find(example => example.id === 'R009')!, 'legacy')).toContain('opções: 03:00 | 15:00 |');
  });
});
