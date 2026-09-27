import { afterEach, expect, it, vi } from 'vitest';
import Ajv from 'ajv';
import { writeFileSync } from 'node:fs';
import * as api from '@everflair/salon-secretary';
import { expandedWire, operationWire, turnWire } from '../../test/secretary-wire-schema';
afterEach(() => { vi.unstubAllGlobals(); vi.unstubAllEnvs(); });
const stressActions = ['service.create', 'service.change', 'customer.create', 'customer.change', 'appointment.create', 'appointment.change', 'appointment.cancel', 'stock.movement', 'financial.report', 'customer.message'].map((operation, i) => ({ item_key: 'item_' + i, operation, status: 'NEEDS_INPUT', depends_on: [], fields: {}, clarification: { missing_fields: [], requested_field: null, previous_response: 'Questão sintética' } }));
const context = { active_plan: { plan_ref: '10000000-0000-4000-8000-000000000001', actions: stressActions }, suspended_plans: Array.from({ length: 5 }, (_, i) => ({ plan_ref: '20000000-0000-4000-8000-' + String(i + 1).padStart(12, '0'), actions: stressActions.map(action => ({ ...action, item_key: action.item_key + '_p' + i })) })) };
const source = 'O novo horário é 16h.';
it.each(['scheduling', 'scheduling-batch'] as const)('both %s requests remain under admission cap with 10 active and 50 suspended actions', async skill => {
  vi.stubEnv('SALON_SECRETARY_V2_MAX_OUTPUT_TOKENS', '8192'); vi.stubEnv('SALON_SECRETARY_MULTI_ACTION_V2_ENABLED', 'true');
  const originalContext = JSON.stringify(context), requests: Record<string, unknown>[] = [], upper: number[] = [];
  await api.withConversationRouting(async () => {
    const stub: api.Model = { async getResponse() { throw Error('SHAPE_ONLY'); }, async *getStreamedResponse() { throw Error('NO_STREAM'); } };
    const tool = api.createServicesAgent(stub, () => {}, skill, true).tools[0]; if (tool.type !== 'function') throw Error('TOOL');
    const fields = Object.fromEntries(Object.keys(operationWire(turnWire(expandedWire(tool.parameters), 'PATCH'), 'appointment.change')).filter(key => key !== 'item_key').map(key => [key, null]));
    const envelope = (literal: string) => ({ turn: { mode: 'PATCH', operations: [{ item_key: 'item_5', fields: { ...fields, operation: 'appointment.change', time: { value: '16:00', literal } } }] } });
    const fetch = vi.fn(async (_input: unknown, init?: RequestInit) => {
      const request = JSON.parse(String(init?.body)); requests.push(request); upper.push(Buffer.byteLength(String(init?.body)) + 8192);
      api.assertSecretaryResponsesPayload(request, 'gpt-6-luna');
      const raw = envelope(requests.length === 1 ? '4pm' : '16h'); expect(new Ajv().compile(request.tools[0].parameters)(raw)).toBe(true);
      // Active admission remains fail-closed; record the measurement before it rejects.
      writeFileSync('.demo/source-repair-budget-' + skill + '.json', JSON.stringify({ skill, upper, cap: 64000, providerNetworkCalls: 0 }, null, 2));
      if (upper.at(-1)! > 64000) throw Error('FREE_USE_INPUT_CAP');
      return new Response(JSON.stringify({ id: 'resp_' + requests.length, object: 'response', created_at: 0, status: 'completed', model: 'gpt-6-luna', output: [{ id: 'fc_' + requests.length, call_id: 'call_' + requests.length, type: 'function_call', name: 'upsert_action_draft', arguments: JSON.stringify(raw), status: 'completed' }], usage: { input_tokens: 20, output_tokens: 10, total_tokens: 30 } }), { status: 200, headers: { 'content-type': 'application/json' } });
    });
    vi.stubGlobal('fetch', fetch);
    const model = await api.createPaidModel({ SALON_SECRETARY_ALLOW_PAID_CALLS: 'true', SALON_SECRETARY_MODEL: 'gpt-6-luna', SALON_SECRETARY_OPENAI_API_KEY: 'synthetic-offline', SALON_SECRETARY_OPENAI_PROJECT: 'proj_offline' });
    await expect((api.runServicesTurn as (model: api.Model, message: string, fields: object, requirements: object, skill: api.SecretarySkill, v2: boolean) => Promise<unknown>)(model, source, {}, {}, skill, true)).rejects.toBeInstanceOf(api.SecretaryNewRequest);
    expect(requests).toHaveLength(2); expect(upper.every(value => value <= 64000)).toBe(true);
    expect(JSON.stringify(requests[0].input)).toContain('suspended_plans'); expect(JSON.stringify(context)).toBe(originalContext);
    expect(JSON.stringify(requests[1].input)).not.toContain('suspended_plans'); expect(JSON.stringify(requests[1].input)).not.toContain('Campos atuais do rascunho');
    expect(JSON.stringify(requests[1].input)).toContain('original_envelope'); expect(JSON.stringify(requests[1].input)).toContain(source);
    expect(requests[1].tools).toEqual(requests[0].tools); expect(requests[1].instructions).toBe(requests[0].instructions);
  }, context);
});
