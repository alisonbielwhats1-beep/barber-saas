import { afterEach, describe, expect, it, vi } from 'vitest';
import { createHash } from 'node:crypto';
import { mkdtempSync, readFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, resolve, sep } from 'node:path';
import * as api from '@everflair/salon-secretary';
import { invalidSourceLiterals, assertSourceLiteralRepair, sourceLiteralRepairRequest } from '../../../packages/salon-secretary/src/source-literal-repair';
import { createRecordedServicesModel } from '../../../packages/salon-secretary/src/recorded-services-model';
import { groundSchedulingTemporal } from '../scheduling-temporal-source';
import { schedulingPatch } from '../scheduling-contract';
import { RouterTrace } from '../secretary-router';
import { schedulingState, sendSchedulingTurn } from '../secretary-scheduling';
import { expandedWire } from '../../test/secretary-wire-schema';
import { call } from '../../test/scripted-services-model';
import original from '../../test/fixtures/secretary-real-wire-golden10-literal.json';
import { FreeUseBudget } from '../../../packages/salon-secretary/evaluation/free-use-budget';

afterEach(() => { vi.unstubAllGlobals(); vi.unstubAllEnvs(); });
const rawOriginal = () => JSON.parse(original.arguments);
// Explicit current-wire adaptation: the new neutral source_scope is required by
// the current contract. Historical bytes and every original temporal leaf stay intact.
const raw = () => { const value = rawOriginal(); for (const operation of value.turn.operations) operation.source_scope = null; return value; };
const fixed = () => {
  const value = raw(), fields = value.turn.operations[0];
  fields.weekday.literal = 'quarta'; fields.time.literal = '16h'; fields.source_weekday.literal = 'terça'; fields.source_time.literal = '13h';
  return value;
};
type Json = ReturnType<typeof raw>;
const config = { SALON_SECRETARY_ALLOW_PAID_CALLS: 'true', SALON_SECRETARY_MODEL: 'gpt-6-luna', SALON_SECRETARY_OPENAI_API_KEY: 'synthetic-offline-not-a-key', SALON_SECRETARY_OPENAI_PROJECT: 'proj_offline' };
async function exercise(frames: unknown[], options: { message?: string; emit?: (event: api.ModelCallUsage) => Promise<void>; failHttp?: number; malformedCall?: number; fields?: object; admit?: (input: unknown, init?: RequestInit) => void; passiveFailure?: boolean; multipleCalls?: number } = {}) {
  const requests: Record<string, unknown>[] = [], events: api.ModelCallUsage[] = [], observed: api.ModelResponse[] = [];
  const originals = frames.map(value => JSON.stringify(value));
  const transport = vi.fn(async (_input: unknown, init?: RequestInit) => {
    const request = JSON.parse(String(init?.body)); requests.push(request);
    options.admit?.(_input, init);
    api.assertSecretaryResponsesPayload(request, 'gpt-6-luna');
    expect(Buffer.byteLength(String(init?.body)) + 8192).toBeLessThanOrEqual(64000);
    if (requests.length === options.failHttp) throw Error('OFFLINE_HTTP_REFUSED');
    const argument = frames[requests.length - 1];
    if (argument === undefined) throw Error('UNEXPECTED_THIRD_HTTP');
    const output = { id: 'fc_' + requests.length, call_id: 'call_' + requests.length, type: 'function_call', name: requests.length === options.malformedCall ? 'unknown_tool' : 'select_capabilities', arguments: JSON.stringify(argument), status: 'completed' };
    return new Response(JSON.stringify({ id: 'resp_' + requests.length, object: 'response', created_at: 0, status: 'completed', model: 'gpt-6-luna',
      output: requests.length === options.multipleCalls ? [output, { ...output, id: output.id + '_extra', call_id: output.call_id + '_extra' }] : [output],
      usage: { input_tokens: 10, input_tokens_details: { cached_tokens: 0, cache_write_tokens: 0 }, output_tokens: 10, total_tokens: 20 } }), { status: 200, headers: { 'content-type': 'application/json' } });
  });
  vi.stubGlobal('fetch', transport);
  const paid = await api.createPaidModel(config);
  const observer: api.Model = { getResponse: async request => { const response = await paid.getResponse(request); observed.push(response); return response; }, async *getStreamedResponse() { throw Error('NO_STREAM'); } };
  const trace = new RouterTrace();
  const passive = api.measureServicesModel(observer, 'gpt-6-luna', async () => { if (options.passiveFailure) throw Error('PASSIVE_OBSERVER_FAILED'); });
  const model = api.instrumentServicesModel(trace.measure(passive, 'gpt-6-luna'), 'gpt-6-luna', async event => { events.push(event); await options.emit?.(event); });
  let result: api.CapabilitySelection | undefined, error: unknown;
  try { result = await api.runServicesTurn(model, options.message ?? original.message, options.fields ?? {}, {}, 'discovery', true); } catch (caught) { error = caught; }
  expect(frames.map(value => JSON.stringify(value))).toEqual(originals);
  for (const [index, response] of observed.entries()) expect((response.output.find(value => value.type === 'function_call') as { arguments: string }).arguments).toBe(originals[index]);
  return { result, error, requests, events, observed, trace: trace.snapshot(), transport };
}
function grounded(selection: api.CapabilitySelection, message = original.message) {
  const item = selection.operations[0];
  const fields = schedulingPatch.parse(Object.fromEntries(Object.entries(item).filter(([key, value]) => key in schedulingPatch.shape && value != null)));
  return groundSchedulingTemporal({}, fields, message, 'America/Sao_Paulo', new Date('2027-04-12T12:00:00Z'), undefined, item.operation, item.temporal_evidence ?? undefined);
}

describe('one constrained literal transport repair through the actual LIVE SDK, offline HTTP only', () => {
  it('replays GF15 semantics on the current wire, then accepts a synthetic literal-only repair before consumption', async () => {
    expect(createHash('sha256').update(original.arguments).digest('hex')).toBe(original.argumentsSha256);
    const run = await exercise([raw(), fixed()]);
    expect(run.error).toBeUndefined(); expect(run.requests).toHaveLength(2);
    expect(grounded(run.result!)).toMatchObject({ fields: { date: '2027-04-14', time: '16:00', source_date: '2027-04-13', source_time: '13:00' }, rejected: [] });
    expect(run.events.map(event => [event.attempt, event.purpose, event.status])).toEqual([[1, 'INTERPRETATION', 'STARTED'], [1, 'INTERPRETATION', 'SUCCEEDED'], [2, 'SOURCE_LITERAL_REPAIR', 'STARTED'], [2, 'SOURCE_LITERAL_REPAIR', 'SUCCEEDED']]);
    expect(run.trace).toMatchObject({ luna_calls: 2, retries: 1, transport_repair_calls: 1 });
    expect(run.trace.usage_luna).toHaveLength(2);
    expect(run.trace.usage_luna.map(event => [event.attempt, event.purpose])).toEqual([[1, 'INTERPRETATION'], [2, 'SOURCE_LITERAL_REPAIR']]);
    const body = JSON.stringify(run.requests[1]);
    expect(body).toContain('original_envelope'); expect(body).not.toContain('previous_response_id'); expect(body).not.toContain('conversation_id');
  });
  it.each([1, 2, 5, 10])('preserves %i actions and request budget across the bounded repair', async count => {
    vi.stubEnv('SALON_SECRETARY_V2_MAX_OUTPUT_TOKENS', '8192');
    const first = raw(), second = fixed();
    first.turn.operations = Array.from({ length: count }, (_, index) => ({ ...first.turn.operations[0], item_key: 'visit_' + index }));
    second.turn.operations = Array.from({ length: count }, (_, index) => ({ ...second.turn.operations[0], item_key: 'visit_' + index }));
    const run = await exercise([first, second]); expect(run.error).toBeUndefined(); expect(run.result!.operations).toHaveLength(count); expect(run.requests).toHaveLength(2);
  });
  it.each([
    ['value', (v: Json) => { v.turn.operations[0].weekday.value = 6; }],
    ['entity', (v: Json) => { v.turn.operations[0].customer_name = 'Outra Pessoa'; }],
    ['operation', (v: Json) => { v.turn.operations[0].operation = 'appointment.cancel'; }],
    ['route', (v: Json) => { v.turn.mode = 'ADD'; }],
    ['key', (v: Json) => { v.turn.operations[0].item_key = 'other'; }],
    ['dependency', (v: Json) => { v.turn.operations[0].depends_on = ['other']; }],
    ['null', (v: Json) => { v.turn.operations[0].reason = 'viagem'; }],
    ['added action', (v: Json) => { v.turn.operations.push({ ...v.turn.operations[0], item_key: 'other' }); }],
    ['removed action', (v: Json) => { v.turn.operations = []; }],
    ['literal still invalid', (v: Json) => { v.turn.operations[0].weekday.literal = 'Wednesday'; }],
    ['literal case changed', (v: Json) => { v.turn.operations[0].weekday.literal = 'Quarta'; }],
  ] as const)('fails closed when repair changes %s, without a third dispatch', async (_label, alter) => {
    const candidate = fixed(); alter(candidate); const run = await exercise([raw(), candidate]);
    expect(run.result).toBeUndefined(); expect(run.error).toBeDefined(); expect(run.requests).toHaveLength(2);
  });
  it('does not permit changing an already valid literal or reordering actions', async () => {
    const first = raw(), candidate = fixed(); first.turn.operations[0].time.literal = '16h'; candidate.turn.operations[0].time.literal = 'às 16h';
    expect((await exercise([first, candidate])).error).toBeDefined();
    const two = raw(), repaired = fixed(); two.turn.operations.push({ ...two.turn.operations[0], item_key: 'second' }); repaired.turn.operations.push({ ...repaired.turn.operations[0], item_key: 'second' }); repaired.turn.operations.reverse();
    expect((await exercise([two, repaired])).error).toBeDefined();
  });
  it('does not borrow evidence from accepted fields or previous messages', async () => {
    const run = await exercise([raw(), fixed()], { message: 'Às 16h.', fields: { previous_response: original.message, source_date: '2027-04-13' } });
    expect(run.result).toBeUndefined(); expect(run.error).toBeDefined(); expect(run.requests).toHaveLength(2);
  });
  it.each([1, 2])('invalid tool on call%i never triggers another attempt or partial consumption', async malformedCall => {
    const run = await exercise([raw(), fixed()], { malformedCall });
    expect(run.error).toBeDefined(); expect(run.result).toBeUndefined(); expect(run.requests).toHaveLength(malformedCall);
  });
  it.each([1, 2])('multiple calls in response%i never permit partial interpretation', async multipleCalls => {
    const run = await exercise([raw(), fixed()], { multipleCalls }); expect(run.error).toBeDefined(); expect(run.result).toBeUndefined(); expect(run.requests).toHaveLength(multipleCalls);
  });
  it('passive observer failures on both calls do not replace provider responses or change the accepted repair', async () => {
    const run = await exercise([raw(), fixed()], { passiveFailure: true }); expect(run.error).toBeUndefined(); expect(run.observed).toHaveLength(2); expect(grounded(run.result!).rejected).toEqual([]);
  });
  it('schema-invalid original does not qualify for repair', async () => {
    const first = raw(); first.turn.operations[0].weekday = 3;
    const run = await exercise([first, fixed()]); expect(run.error).toBeDefined(); expect(run.requests).toHaveLength(1);
  });
  it('unadapted historical GF15 bytes stay rejected by the new required source-scope contract', async () => {
    const run = await exercise([rawOriginal()]); expect(run.error).toBeDefined(); expect(run.requests).toHaveLength(1); expect(run.result).toBeUndefined();
    expect(createHash('sha256').update(original.arguments).digest('hex')).toBe(original.argumentsSha256);
  });
  it.each([1, 2])('HTTP failure%i is fail-closed with no API retry', async failHttp => {
    const run = await exercise([raw(), fixed()], { failHttp }); expect(run.error).toBeDefined(); expect(run.result).toBeUndefined(); expect(run.requests).toHaveLength(failHttp);
    expect(run.events.at(-1)?.status).toBe('FAILED');
  });
  it.each([[1, 'STARTED', 0], [1, 'SUCCEEDED', 1], [2, 'STARTED', 1], [2, 'SUCCEEDED', 2]] as const)('audit failure call%i %s prevents further dispatch/consumption', async (attempt, status, calls) => {
    const run = await exercise([raw(), fixed()], { emit: async event => { if (event.attempt === attempt && event.status === status) throw Error('AUDIT_REFUSED'); } });
    expect(run.error).toBeInstanceOf(Error); expect((run.error as Error).message).toBe('AUDIT_REFUSED'); expect(run.result).toBeUndefined(); expect(run.requests).toHaveLength(calls);
  });
  it.each([1, 2])('durable cost admission allows at most %i HTTP dispatches, charging repair separately', async maxRequests => {
    const parent = resolve(tmpdir()), dir = mkdtempSync(join(parent, 'secretary-repair-offline-budget-')), journal = join(dir, 'admission.jsonl');
    try {
      const budget = new FreeUseBudget(journal, 'synthetic-offline-repair', maxRequests);
      const run = await exercise([raw(), fixed()], { admit: (input, init) => { budget.reserve('offline', 1, input as string, init); } });
      const rows = readFileSync(journal, 'utf8').trim().split('\n').map(value => JSON.parse(value));
      expect(rows).toHaveLength(maxRequests); expect(budget.requests).toBe(maxRequests); expect(rows.every(row => row.status === 'STARTED')).toBe(true);
      expect(run.observed).toHaveLength(maxRequests);
      if (maxRequests === 1) { expect(run.error).toBeDefined(); expect(run.result).toBeUndefined(); }
      else { expect(run.error).toBeUndefined(); expect(rows[0].bodySha256).not.toBe(rows[1].bodySha256); expect(rows[1].previousHash).toBe(rows[0].rowHash); }
    } finally { if (!resolve(dir).startsWith(parent + sep)) throw Error('UNSAFE_TEST_CLEANUP'); rmSync(dir, { recursive: true, force: true }); }
  });
  it('exact proof with wrong weekday is never repaired and is still blocked factually', async () => {
    const first = fixed(); first.turn.operations[0].weekday = { value: 6, literal: 'quarta' };
    const run = await exercise([first]); expect(run.requests).toHaveLength(1); expect(run.trace.retries).toBe(0);
    expect(grounded(run.result!).fields.date).toBeUndefined(); expect(grounded(run.result!).rejected.some(value => value.field === 'date')).toBe(true);
  });
  it('repair cannot cure a factual contradiction even with an exact new literal', async () => {
    const first = raw(), second = fixed(); first.turn.operations[0].weekday.value = 6; second.turn.operations[0].weekday.value = 6;
    const run = await exercise([first, second]); expect(run.requests).toHaveLength(2);
    expect(grounded(run.result!).fields.date).toBeUndefined(); expect(grounded(run.result!).rejected.some(value => value.field === 'date')).toBe(true);
  });
  it('exact but exchanged source/destination literals remain subject to the role guard', async () => {
    const second = fixed(); second.turn.operations[0].weekday.literal = 'terça'; second.turn.operations[0].source_weekday.literal = 'quarta';
    const run = await exercise([raw(), second]); const value = grounded(run.result!);
    expect(value.fields.date).toBeUndefined(); expect(value.fields.source_date).toBeUndefined();
  });
  it('static recorded identity preserves historical output without automatic repair', async () => {
    const first = rawOriginal(), model = createRecordedServicesModel([call('select_capabilities', first)]);
    const result = await api.runServicesTurn(model, original.message, {}, {}, 'discovery', true);
    expect(result.operations[0].temporal_evidence).toContainEqual({ field: 'date', text: 'Wednesday' });
    expect(grounded(result).rejected).toHaveLength(4);
  });
  it.each(['literal', 'schema', 'timeout'] as const)('failed repair %s withdraws an existing proposal while retaining committed fields and revision', async fault => {
    const source: api.Model = { getResponse: vi.fn(), async *getStreamedResponse() { throw Error('NO_STREAM'); } };
    const tool = api.createServicesAgent(source, () => {}, 'scheduling').tools[0]; if (tool.type !== 'function') throw Error('TOOL');
    const fields = { ...Object.fromEntries(Object.keys(expandedWire(tool.parameters).properties!).map(key => [key, null])), operation: 'appointment.change', time: { value: '16:00', literal: '4pm' } };
    const initial = { usage: new api.Usage(), output: call('upsert_action_draft', fields) };
    vi.mocked(source.getResponse).mockResolvedValueOnce(initial);
    if (fault === 'timeout') vi.mocked(source.getResponse).mockRejectedValueOnce(Object.assign(Error('offline'), { name: 'TimeoutError' }));
    else vi.mocked(source.getResponse).mockResolvedValueOnce({ usage: new api.Usage(), output: call('upsert_action_draft', fault === 'schema' ? { ...fields, time: '16:00' } : fields) });
    const state = schedulingState(), accepted = { customer_name: 'Lara', date: '2027-04-14', time: '13:00', source_date: '2027-04-13', source_time: '13:00' };
    Object.assign(state, { operation: 'appointment.change', fields: accepted, draft: { draft_ref: 'original', draft_revision: 4, fields: structuredClone(accepted), status: 'READY', missing_fields: [] }, proposal: { proposal_ref: 'previous', draft_revision: 4 } });
    const before = structuredClone(state.draft), actor = { salonId: 'synthetic', userId: 'owner' }, live = vi.fn();
    await expect(sendSchedulingTurn(actor, state, api.instrumentServicesModel(source, 'offline', async () => {}), 'Muda para 16h.', live)).rejects.toThrow();
    expect(state.proposal).toBeUndefined(); expect(state.fields).toEqual(accepted); expect(state.draft).toEqual(before); expect(live).not.toHaveBeenCalled(); expect(source.getResponse).toHaveBeenCalledTimes(2);
  });
});

describe('request-identity permission does not broaden the normal one-call wrapper', () => {
  const request = () => ({ input: [] } as unknown as api.ModelRequest);
  const model = () => ({ getResponse: vi.fn(async () => ({ output: [], usage: new api.Usage() })), async *getStreamedResponse() { throw Error('NO_STREAM'); } });
  it.each(['copy', 'proxy', 'unrelated'] as const)('%s does not inherit the repair grant', async kind => {
    const first = request(), source = model(), measured = api.instrumentServicesModel(source, 'fake', async () => {});
    await measured.getResponse(first);
    const second = sourceLiteralRepairRequest(first, raw(), invalidSourceLiterals(raw(), original.message), original.message);
    const forged = kind === 'copy' ? { ...second } : kind === 'proxy' ? new Proxy(second, {}) : sourceLiteralRepairRequest(request(), raw(), invalidSourceLiterals(raw(), original.message), original.message);
    await expect(measured.getResponse(forged)).rejects.toThrow('MODEL_CALL_LIMIT'); expect(source.getResponse).toHaveBeenCalledOnce();
  });
  it('permits only one bound repair then rejects repeated or third dispatch', async () => {
    const first = request(), source = model(), measured = api.instrumentServicesModel(source, 'fake', async () => {});
    await measured.getResponse(first);
    const second = sourceLiteralRepairRequest(first, raw(), invalidSourceLiterals(raw(), original.message), original.message);
    await measured.getResponse(second); await expect(measured.getResponse(second)).rejects.toThrow('MODEL_CALL_LIMIT');
    expect(() => sourceLiteralRepairRequest(first, raw(), invalidSourceLiterals(raw(), original.message), original.message)).toThrow('MODEL_CALL_LIMIT');
    expect(() => sourceLiteralRepairRequest(second, raw(), invalidSourceLiterals(raw(), original.message), original.message)).toThrow('MODEL_CALL_LIMIT');
    expect(source.getResponse).toHaveBeenCalledTimes(2);
  });
  it('regular wrapper remains single-call and deep pinning rejects a different field set', async () => {
    const first = request(), source = model(), measured = api.instrumentServicesModel(source, 'fake', async () => {});
    await measured.getResponse(first); await expect(measured.getResponse(request())).rejects.toThrow('MODEL_CALL_LIMIT');
    const candidate = fixed(); delete candidate.turn.operations[0].reason;
    expect(() => assertSourceLiteralRepair(raw(), candidate, invalidSourceLiterals(raw(), original.message), original.message)).toThrow('SOURCE_LITERAL_REPAIR_INVALID');
  });
  it.each(['STARTED', 'SUCCEEDED'] as const)('even a bound grant cannot dispatch after first %s audit failure', async status => {
    const first = request(), source = model(), measured = api.instrumentServicesModel(source, 'fake', async event => { if (event.status === status) throw Error('AUDIT_DOWN'); });
    await expect(measured.getResponse(first)).rejects.toThrow('AUDIT_DOWN');
    const second = sourceLiteralRepairRequest(first, raw(), invalidSourceLiterals(raw(), original.message), original.message);
    await expect(measured.getResponse(second)).rejects.toThrow('MODEL_CALL_LIMIT'); expect(source.getResponse).toHaveBeenCalledTimes(status === 'STARTED' ? 0 : 1);
  });
});
