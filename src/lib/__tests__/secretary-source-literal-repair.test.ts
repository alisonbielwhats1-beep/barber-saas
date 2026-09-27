import { afterEach, describe, expect, it, vi } from 'vitest';
import * as api from '@everflair/salon-secretary';
import { invalidSourceLiterals, assertSourceLiteralRepair } from '../../../packages/salon-secretary/src/source-literal-repair';
import { expandedWire, operationWire, turnWire } from '../../test/secretary-wire-schema';
import { groundInventoryQuantity } from '../inventory-quantity';
import { inventorySourceScopes } from '../inventory-source-scope';
import temporal from '../../test/fixtures/secretary-real-wire-golden10-literal.json';

afterEach(() => { vi.unstubAllGlobals(); vi.unstubAllEnvs(); });
const source = 'Entraram cinco unidades de Óleo Aurora.';
const config = { SALON_SECRETARY_ALLOW_PAID_CALLS: 'true', SALON_SECRETARY_MODEL: 'gpt-6-luna', SALON_SECRETARY_OPENAI_API_KEY: 'synthetic-offline-not-a-key', SALON_SECRETARY_OPENAI_PROJECT: 'proj_offline' };
const unused: api.Model = { async getResponse() { throw Error('SHAPE_ONLY'); }, async *getStreamedResponse() { throw Error('NO_STREAM'); } };
const clone = <T>(value: T): T => structuredClone(value);
function schema(skill: 'discovery' | 'inventory' = 'discovery', v2 = true) {
  const tool = api.createServicesAgent(unused, () => {}, skill, v2).tools[0]; if (tool.type !== 'function') throw Error('TOOL'); return expandedWire(tool.parameters);
}
function operation(id: string, fields: Record<string, unknown> = {}): Record<string, unknown> & { operation: string; item_key: string; source_scope: unknown } {
  const shape = operationWire(schema(), id);
  return { ...Object.fromEntries(Object.keys(shape).map(key => [key, null])), operation: id, item_key: 'stock', source_scope: null, depends_on: [], released_slot_of: null, ...fields };
}
const stockFields = (correct = false) => ({ product_name: 'Óleo Aurora', low_stock: null, mode: 'IN',
  quantity: { value: 5, literal: correct ? 'cinco unidades' : 'five units' }, reason: null,
  reference: { kind: 'NAMED', literal: correct ? 'Óleo Aurora' : 'Aurora Oil' } });
const stock = (correct = false) => operation('stock.movement', { source_scope: correct ? source : 'Five units of Aurora Oil arrived.', inventory: stockFields(correct) });
const envelope = (correct = false) => ({ turn: { mode: 'NEW', operations: [stock(correct)] } });
type Envelope = ReturnType<typeof envelope>;
async function sdk(first: unknown, repaired: unknown, message = source, options: { skill?: 'discovery' | 'inventory'; v2?: boolean; context?: api.ConversationRoutingContext } = {}) {
  const frames = [first, repaired].map(value => JSON.stringify(value)), requests: Record<string, unknown>[] = [], events: api.ModelCallUsage[] = [];
  const skill = options.skill ?? 'discovery', v2 = options.v2 ?? true;
  const fetch = vi.fn(async (_input: unknown, init?: RequestInit) => {
    requests.push(JSON.parse(String(init?.body))); const index = requests.length - 1;
    if (index > 1) throw Error('THIRD_CALL_FORBIDDEN');
    api.assertSecretaryResponsesPayload(requests[index], 'gpt-6-luna');
    expect(Buffer.byteLength(String(init?.body)) + 8192).toBeLessThanOrEqual(64000);
    return new Response(JSON.stringify({ id: 'resp_' + index, object: 'response', created_at: 0, status: 'completed', model: 'gpt-6-luna',
      output: [{ id: 'fc_' + index, call_id: 'call_' + index, type: 'function_call', name: skill === 'discovery' ? 'select_capabilities' : 'upsert_action_draft', arguments: frames[index], status: 'completed' }],
      usage: { input_tokens: 10, output_tokens: 10, total_tokens: 20 } }), { status: 200, headers: { 'content-type': 'application/json' } });
  });
  vi.stubGlobal('fetch', fetch);
  const paid = await api.createPaidModel(config), model = api.instrumentServicesModel(paid, 'gpt-6-luna', async event => { events.push(event); });
  let result: api.CapabilitySelection | api.InventoryInterpretation | undefined, error: unknown;
  const run = async () => skill === 'inventory' ? api.runServicesTurn(model, message, {}, {}, 'inventory') : api.runServicesTurn(model, message, {}, {}, 'discovery', v2);
  try { result = await (options.context ? api.withConversationRouting(run, options.context) : run()); } catch (caught) { error = caught; }
  expect([first, repaired].map(value => JSON.stringify(value))).toEqual(frames);
  return { result, error, requests, events };
}
const inventory = (result: api.CapabilitySelection | api.InventoryInterpretation | undefined) => (result as api.CapabilitySelection).operations[0];
const ground = (operation: api.CapabilitySelection['operations'][number], message = source) => groundInventoryQuantity({ source: message,
  quantity: operation.inventory!.quantity!, literal: operation.inventory?.quantity_evidence, product_names: ['Óleo Aurora'],
  reference: operation.inventory?.reference, source_scope: operation.source_scope, reason: operation.inventory?.reason,
  catalog: [{ id: 'oil', name: 'Óleo Aurora' }, { id: 'premium', name: 'Óleo Aurora Premium' }] });

describe('closed role registry shares the same one-repair budget across literal evidence families', () => {
  it('repairs inventory measure, named reference and action scope together while preserving their semantic values', async () => {
    const first = envelope(), second = envelope(true), paths = invalidSourceLiterals(first, source);
    expect(paths).toEqual([['turn', 'operations', 0, 'source_scope'], ['turn', 'operations', 0, 'inventory', 'quantity', 'literal'], ['turn', 'operations', 0, 'inventory', 'reference', 'literal']]);
    const run = await sdk(first, second); expect(run.error).toBeUndefined(); expect(run.requests).toHaveLength(2);
    expect(ground(inventory(run.result))).toMatchObject({ status: 'ACCEPTED', quantity: 5 });
    expect(run.events.map(event => [event.attempt, event.purpose, event.status])).toEqual([[1, 'INTERPRETATION', 'STARTED'], [1, 'INTERPRETATION', 'SUCCEEDED'], [2, 'SOURCE_LITERAL_REPAIR', 'STARTED'], [2, 'SOURCE_LITERAL_REPAIR', 'SUCCEEDED']]);
  });
  it.each([1, 2, 5, 10])('repairs %i independent action scopes without changing cardinality or exceeding the HTTP input cap', async count => {
    vi.stubEnv('SALON_SECRETARY_V2_MAX_OUTPUT_TOKENS', '8192');
    const first = envelope(), second = envelope(true), parts = Array.from({ length: count }, (_, index) => `Registro ${String.fromCharCode(65 + index)}: entraram cinco unidades de Óleo Aurora.`);
    first.turn.operations = parts.map((_, index) => ({ ...stock(), item_key: 'stock_' + index }));
    second.turn.operations = parts.map((source_scope, index) => ({ ...stock(true), item_key: 'stock_' + index, source_scope }));
    const run = await sdk(first, second, parts.join(' ')); expect(run.error).toBeUndefined(); expect(run.requests).toHaveLength(2); expect((run.result as api.CapabilitySelection).operations).toHaveLength(count);
  });
  it('one additional request repairs temporal and inventory evidence in the same envelope', async () => {
    const first = JSON.parse(temporal.arguments), second = clone(first);
    first.turn.operations[0].source_scope = null; second.turn.operations[0].source_scope = null;
    const schedule = second.turn.operations[0]; schedule.weekday.literal = 'quarta'; schedule.time.literal = '16h'; schedule.source_weekday.literal = 'terça'; schedule.source_time.literal = '13h';
    first.turn.operations.push(stock()); second.turn.operations.push(stock(true));
    const run = await sdk(first, second, temporal.message + ' ' + source); expect(run.error).toBeUndefined(); expect(run.requests).toHaveLength(2);
    const operations = (run.result as api.CapabilitySelection).operations;
    expect(operations[0]).toMatchObject({ weekday: 3, source_weekday: 2, time: '16:00', source_time: '13:00' }); expect(operations[1].inventory?.quantity).toBe(5);
  });
  it.each([false, true])('standalone inventory V2=%s uses the same registry, never an alternate numeric parser', async v2 => {
    let first: unknown, second: unknown;
    const build = async () => {
      const wire = schema('inventory', v2), shape = v2 ? turnWire(wire, 'CURRENT').properties!.fields.properties! : wire.properties!;
      const fields = { ...Object.fromEntries(Object.keys(shape).map(key => [key, null])), operation: 'stock.movement', source_scope: 'Five units arrived.', ...stockFields() };
      const repaired = { ...fields, source_scope: source, ...stockFields(true) };
      first = v2 ? { turn: { mode: 'CURRENT', fields } } : fields; second = v2 ? { turn: { mode: 'CURRENT', fields: repaired } } : repaired;
    };
    await (v2 ? api.withConversationRouting(build) : build());
    const run = await sdk(first, second, source, { skill: 'inventory', v2, ...(v2 ? { context: {} } : {}) }); expect(run.error).toBeUndefined(); expect(run.requests).toHaveLength(2);
    expect(run.result).toMatchObject({ quantity: 5, quantity_evidence: 'cinco unidades', reference: { kind: 'NAMED', literal: 'Óleo Aurora' }, source_scope: source });
  });
  it.each(['PATCH', 'RESUME'] as const)('%s repairs only proof leaves inside the selected existing action', async mode => {
    const active = { plan_ref: '10000000-0000-4000-8000-000000000001', actions: [{ item_key: 'stock', operation: 'stock.movement', status: 'NEEDS_INPUT', depends_on: [] }] };
    const context = { active_plan: active, suspended_plans: [active] };
    const fields = (correct: boolean) => ({ operation: 'stock.movement', source_scope: correct ? source : 'Five units arrived.', inventory: stockFields(correct) });
    const input = (correct: boolean) => {
      const operations = [{ item_key: 'stock', fields: fields(correct) }];
      return { turn: mode === 'PATCH' ? { mode, operations } : { mode, plan_ref: active.plan_ref, patches: { operations } } };
    };
    const run = await sdk(input(false), input(true), source, { context });
    expect(run.requests).toHaveLength(2); expect(run.error).toBeInstanceOf(mode === 'PATCH' ? api.SecretaryNewRequest : api.SecretaryResumeRequest);
    const selected = run.error instanceof api.SecretaryNewRequest ? run.error.selection : (run.error as api.SecretaryResumeRequest).patches!;
    expect(selected.operations[0]).toMatchObject({ item_key: 'stock', source_scope: source, inventory: { quantity: 5, quantity_evidence: 'cinco unidades' } });
  });
  it.each([
    ['quantity.value', (op: ReturnType<typeof stock>) => { (op.inventory as ReturnType<typeof stockFields>).quantity.value = 7; }],
    ['product_name', (op: ReturnType<typeof stock>) => { (op.inventory as ReturnType<typeof stockFields>).product_name = 'Outro produto'; }],
    ['reference.kind', (op: ReturnType<typeof stock>) => { (op.inventory as ReturnType<typeof stockFields>).reference = { kind: 'CURRENT_FIELD', literal: null } as unknown as ReturnType<typeof stockFields>['reference']; }],
    ['mode', (op: ReturnType<typeof stock>) => { (op.inventory as ReturnType<typeof stockFields>).mode = 'OUT'; }],
    ['reason', (op: ReturnType<typeof stock>) => { (op.inventory as Record<string, unknown>).reason = 'uso interno'; }],
    ['operation', (op: ReturnType<typeof stock>) => { op.operation = 'stock.balance'; }],
  ] as const)('rejects %s changes outside the originally invalid proof leaves', async (_name, mutate) => {
    const first = envelope(), second = envelope(true); mutate(second.turn.operations[0]);
    const run = await sdk(first, second); expect(run.result).toBeUndefined(); expect(run.error).toBeDefined(); expect(run.requests).toHaveLength(2);
  });
  it('valid scope, valid literal, null reference and CURRENT_FIELD discriminator are never editable', async () => {
    for (const kind of ['scope', 'quantity', 'null', 'current'] as const) {
      const first = envelope(), second = envelope(true), a = first.turn.operations[0], b = second.turn.operations[0];
      const ia = a.inventory as ReturnType<typeof stockFields>, ib = b.inventory as ReturnType<typeof stockFields>;
      if (kind === 'scope') { a.source_scope = source; b.source_scope = source.slice(0, -1); }
      if (kind === 'quantity') { ia.quantity.literal = 'cinco unidades'; ib.quantity.literal = 'cinco'; }
      if (kind === 'null') ia.reference = null as unknown as typeof ia.reference;
      if (kind === 'current') ia.reference = { kind: 'CURRENT_FIELD', literal: null } as unknown as typeof ia.reference;
      const run = await sdk(first, second); expect(run.result).toBeUndefined(); expect(run.error).toBeDefined(); expect(run.requests).toHaveLength(2);
    }
  });
  it('null scopes and quantities are not inferred or filled during another evidence repair', async () => {
    for (const key of ['source_scope', 'quantity'] as const) {
      const first = envelope(), second = envelope(true);
      if (key === 'source_scope') first.turn.operations[0].source_scope = null;
      else (first.turn.operations[0].inventory as Record<string, unknown>).quantity = null;
      const run = await sdk(first, second); expect(run.error).toBeDefined(); expect(run.result).toBeUndefined(); expect(run.requests).toHaveLength(2);
    }
  });
  it('null/current references remain null when only measure and scope proofs need repair', async () => {
    // This negative requires absent factual identity, not merely a CURRENT_FIELD
    // hint without context. The original named source is retained below as a positive.
    const source = 'Entraram cinco unidades.';
    for (const reference of [null, { kind: 'CURRENT_FIELD', literal: null }]) {
      const first = envelope(), second = envelope(true);
      for (const env of [first, second]) (env.turn.operations[0].inventory as Record<string, unknown>).reference = reference;
      second.turn.operations[0].source_scope = source;
      const run = await sdk(first, second, source); expect(run.error).toBeUndefined(); expect(inventory(run.result).inventory?.reference).toEqual(reference); expect(run.requests).toHaveLength(2);
      if (reference) expect(ground(inventory(run.result), source).status).toBe('NEEDS_INPUT');
    }
  });
  it('preserves the original named source and envelopes: a reference hint cannot veto independent factual identity', async () => {
    for (const reference of [null, { kind: 'CURRENT_FIELD', literal: null }]) {
      const first = envelope(), second = envelope(true);
      for (const env of [first, second]) (env.turn.operations[0].inventory as Record<string, unknown>).reference = reference;
      const run = await sdk(first, second); expect(run.error).toBeUndefined();
      expect(inventory(run.result).inventory?.reference).toEqual(reference); expect(run.requests).toHaveLength(2);
      expect(ground(inventory(run.result), source)).toMatchObject({ status: 'ACCEPTED', quantity: 5 });
    }
  });
  it.each([
    ['absent product', 'Entraram cinco unidades.'],
    ['different product', 'Entraram cinco unidades de Shampoo Polar.'],
    ['different variant', 'Entraram cinco unidades de Óleo Aurora Premium.'],
  ])('a repaired proof cannot supply identity for %s, with or without a current-field hint', async (_case, message) => {
    for (const reference of [null, { kind: 'CURRENT_FIELD', literal: null }]) {
      const first = envelope(), second = envelope(true);
      for (const env of [first, second]) (env.turn.operations[0].inventory as Record<string, unknown>).reference = reference;
      second.turn.operations[0].source_scope = message;
      const run = await sdk(first, second, message); expect(run.error).toBeUndefined();
      expect(inventory(run.result).inventory?.reference).toEqual(reference); expect(run.requests).toHaveLength(2);
      expect(ground(inventory(run.result), message)).toMatchObject({ status: 'NEEDS_INPUT', cause: 'PRODUCT_UNPROVEN' });
    }
  });
  it('excludes business strings and arbitrary objects from the registry', async () => {
    const cases = [
      operation('stock.movement', { source_scope: null, inventory: { ...stockFields(true), reason: 'translated cause' } }),
      operation('appointment.cancel', { item_key: 'cancel', customer_name: 'Lara', reason: 'translated reason' }),
      operation('customer.message', { item_key: 'message', communication: { recipient_name: 'Lara', channel: 'WHATSAPP', message_mode: 'EXACT', content: 'translated message' } }),
    ];
    for (const op of cases) {
      const raw = { turn: { mode: 'NEW', operations: [op] } }; expect(invalidSourceLiterals(raw, source)).toEqual([]);
      const run = await sdk(raw, raw); expect(run.error).toBeUndefined(); expect(run.requests).toHaveLength(1);
    }
    expect(invalidSourceLiterals({ communication: { literal: 'missing', content: 'missing' }, reason: { literal: 'missing' }, override_reason: 'missing', product_name: 'missing', extra: { time: { value: '10:00', literal: 'missing' } } }, source)).toEqual([]);
  });
  it('case-mismatched daypart requires repair, while exact current substring preserves the one-call path', async () => {
    const make = (literal: string) => ({ turn: { mode: 'NEW', operations: [operation('appointment.change', { item_key: 'visit', time: { value: '16:00', literal } })] } });
    const repaired = await sdk(make('da tarde'), make('Da tarde'), 'Da tarde.'); expect(repaired.error).toBeUndefined(); expect(repaired.requests).toHaveLength(2);
    const exact = await sdk(make('Da tarde'), make('Da tarde'), 'Da tarde.'); expect(exact.error).toBeUndefined(); expect(exact.requests).toHaveLength(1);
  });
  it('one unsuccessful family aborts the entire mixed envelope, without a third request', async () => {
    const first = envelope(), second = envelope(true); (second.turn.operations[0].inventory as ReturnType<typeof stockFields>).reference.literal = 'Aurora Oil';
    const run = await sdk(first, second); expect(run.error).toBeDefined(); expect(run.result).toBeUndefined(); expect(run.requests).toHaveLength(2);
  });
});

describe('successful transport repair never supersedes factual inventory authority', () => {
  it.each([
    ['variant', 'Entraram 5 unidades de Óleo Aurora Premium.', '5 unidades', 5, null],
    ['factor', 'Entraram 3 caixas com 5 unidades de Óleo Aurora.', '5 unidades', 5, null],
    ['negation', 'Nem 5 unidades de Óleo Aurora para uso interno.', '5 unidades', 5, 'para uso interno'],
    ['wrong count', 'Entraram 7 unidades de Óleo Aurora.', '7 unidades', 5, null],
  ] as const)('exact repaired proofs still block %s', async (_kind, message, literal, value, reason) => {
    const first = envelope(), second = envelope(true);
    for (const env of [first, second]) Object.assign(env.turn.operations[0].inventory as object, { quantity: { value, literal: env === first ? 'translated measure' : literal }, reason });
    second.turn.operations[0].source_scope = message;
    const run = await sdk(first, second, message); expect(run.error).toBeUndefined(); expect(run.requests).toHaveLength(2); expect(ground(inventory(run.result), message).status).toBe('NEEDS_INPUT');
  });
  it('exact overlapping source scopes still fail the backend scope contract', async () => {
    const message = source + ' Mostra o faturamento de ontem.', first = envelope(), second = envelope(true);
    first.turn.operations.push(operation('financial.report', { item_key: 'report', source_scope: 'Show revenue yesterday.', financial: { metrics: ['service_revenue'], period: 'yesterday', compare_period: null, group_by: null } }));
    second.turn.operations.push(operation('financial.report', { item_key: 'report', source_scope: message, financial: { metrics: ['service_revenue'], period: 'yesterday', compare_period: null, group_by: null } }));
    second.turn.operations[0].source_scope = message;
    const run = await sdk(first, second, message); expect(run.error).toBeUndefined(); const actions = (run.result as api.CapabilitySelection).operations;
    expect(inventorySourceScopes(message, { scope: actions[0].source_scope, others: [{ key: 'report', operation: 'financial.report', literal: actions[1].source_scope! }] }).valid).toBe(false);
  });
  it('pinning independently rejects a fabricated proof path into business content', () => {
    const before: Envelope = envelope(), after = envelope(true);
    (after.turn.operations[0].inventory as Record<string, unknown>).reason = 'changed';
    expect(() => assertSourceLiteralRepair(before, after, invalidSourceLiterals(before, source), source)).toThrow('SOURCE_LITERAL_REPAIR_INVALID');
  });
});
