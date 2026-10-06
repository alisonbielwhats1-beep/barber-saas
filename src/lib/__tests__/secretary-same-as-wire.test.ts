import { afterEach, describe, expect, it, vi } from 'vitest';
import Ajv from 'ajv';
import { createServicesAgent, withConversationRouting, sameAsInstructions, sameAsFields, continuationDraft, continuationRequirements,
  type SecretarySkill, type SecretaryWireSchema } from '@everflair/salon-secretary';
import { ScriptedServicesModel } from '../../test/scripted-services-model';
import { expandedWire, operationWire, turnWire, suspendedWirePlan } from '../../test/secretary-wire-schema';
import { compileMatrix, compileRequest, lintRequests, LINT_DIRECTORY, LINT_STATES, STRESS_CONTEXT } from '../../test/secretary-instruction-lint';
import { contractProfileDigest } from '../../../packages/salon-secretary/evaluation/contract-version-profiles';
import { getOperationRequirements } from '../service-contract';

/** C5 same_as wire (flag SALON_SECRETARY_SAME_AS, default off): every NEW/ADD operation that may follow another action's
 * value carries `same_as` = null | [{field, item_key, literal}], its rule stated once in its description. It is never a
 * PATCH/RESUME delta (links are graph data) nor an isolated-adapter field. The flag-on contract pays for these bytes with the
 * emitted-copies compaction (same resolved schema, C4): every production-shaped request is SMALLER than with the flag off.
 * With the flag off the wire, the prompt and the contract version are unchanged. */
afterEach(() => { vi.unstubAllEnvs(); });
const env = (sameAs: boolean, components = false) => { vi.stubEnv('SALON_SECRETARY_SAME_AS', String(sameAs)); vi.stubEnv('SALON_SECRETARY_TEMPORAL_COMPONENTS', String(components)); };
function tool(skill: SecretarySkill | 'discovery' = 'discovery') {
  const agent = createServicesAgent(new ScriptedServicesModel([]), () => {}, skill, true), t = agent.tools[0];
  if (t.type !== 'function') throw Error('tool'); return t.parameters as SecretaryWireSchema;
}
const linked = ['appointment.create', 'appointment.change', 'appointment.cancel', 'schedule.block', 'appointment.list', 'availability.get', 'customer.message'];
const unlinked = ['customer.create', 'service.change', 'stock.movement', 'financial.report', 'product.search'];
/** The resolved wire without any `same_as` property (what the flag adds). */
function withoutSameAs(node: unknown): unknown {
  if (Array.isArray(node)) return node.map(withoutSameAs);
  if (!node || typeof node !== 'object') return node;
  const out: Record<string, unknown> = {};
  for (const [key, value] of Object.entries(node)) {
    if (key === 'properties') out[key] = Object.fromEntries(Object.entries(value as object).filter(([name]) => name !== 'same_as').map(([name, v]) => [name, withoutSameAs(v)]));
    else if (key === 'required' && Array.isArray(value)) out[key] = value.filter(name => name !== 'same_as');
    else out[key] = withoutSameAs(value);
  }
  return out;
}
const active = { plan_ref: '30000000-0000-4000-8000-000000000001', actions: [{ item_key: 'a', operation: 'appointment.cancel', status: 'NEEDS_INPUT', depends_on: [] }] };

describe('flag off: historical wire', () => {
  it('publishes no reference and states no reference rule, in any mode', async () => {
    env(false);
    await withConversationRouting(async () => {
      const wire = tool(), text = JSON.stringify(wire);
      expect(text).not.toContain('"same_as"'); expect(text).not.toContain(sameAsInstructions.slice(0, 40));
      for (const operation of linked) expect(operationWire(expandedWire(wire), operation)).not.toHaveProperty('same_as');
    }, { active_plan: active, suspended_plans: [suspendedWirePlan] });
  });
});

describe('flag on: one strict, nullable reference list per NEW/ADD operation that may follow another value', () => {
  it.each([false, true])('components=%s: after the graph fields, before the values; the same item schema everywhere', async components => {
    env(true, components);
    await withConversationRouting(async () => {
      const expanded = expandedWire(tool());
      for (const mode of ['NEW', 'ADD']) for (const operation of linked) {
        const fields = operationWire(turnWire(expanded, mode), operation), keys = Object.keys(fields);
        expect(keys.indexOf('same_as'), `${mode} ${operation}`).toBe(keys.indexOf('released_slot_of') + 1);
        expect(keys.indexOf('same_as')).toBeLessThan(keys.indexOf('source_scope'));
        const list = fields.same_as;
        expect(list.anyOf!.map(value => value.type)).toEqual(['array', 'null']); expect(list.description).toBe(sameAsInstructions);
        const item = list.anyOf![0].items!;
        expect(item.required).toEqual(['field', 'item_key', 'literal']); expect(item.additionalProperties).toBe(false);
        expect(item.properties!.field.enum).toEqual([...sameAsFields]);
        expect(item.properties!.item_key).toEqual({ type: 'string', pattern: '^[a-z][a-z0-9_]{0,31}$' });
        expect(item.properties!.literal).toEqual({ type: 'string', minLength: 1, maxLength: 600, pattern: '\\S' });
      }
      for (const operation of unlinked) expect(operationWire(expanded, operation)).not.toHaveProperty('same_as');
      // Links are graph data: a PATCH or RESUME delta never carries one.
      expect(JSON.stringify(turnWire(expanded, 'PATCH'))).not.toContain('"same_as"');
      expect(JSON.stringify(turnWire(expanded, 'RESUME'))).not.toContain('"same_as"');
    }, { active_plan: active, suspended_plans: [suspendedWirePlan] });
    // The isolated adapter (CURRENT, no plan) has nothing to reference.
    await withConversationRouting(async () => { expect(JSON.stringify(turnWire(expandedWire(tool('scheduling')), 'CURRENT'))).not.toContain('"same_as"'); });
  });
  it('the live strict wire accepts a reference only with the flag on, and never in a PATCH delta', async () => {
    const op = { operation: 'appointment.create', item_key: 'rosa', depends_on: null, released_slot_of: null, source_scope: null, customer_name: 'Rosa', service_name: null, professional_name: null,
      date: null, day_offset: null, weekday: null, time: { value: '15:00', literal: 'às 15h' }, period: null, source_date: null, source_day_offset: null, source_weekday: null,
      source_time: null, end_time: null, end_date: null, reason: null, destination_mode: null, override_requested: null, override_reason: null };
    const same_as = [{ field: 'date', item_key: 'carla', literal: 'no mesmo dia' }];
    env(true);
    await withConversationRouting(async () => {
      const validate = new Ajv({ allErrors: true }).compile(tool());
      expect(validate({ turn: { mode: 'NEW', operations: [{ ...op, same_as }] } }), JSON.stringify(validate.errors)).toBe(true);
      expect(validate({ turn: { mode: 'ADD', operations: [{ ...op, same_as: [{ field: 'customer', item_key: 'a', literal: 'ela' }] }] } })).toBe(true);
      expect(validate({ turn: { mode: 'NEW', operations: [{ ...op, same_as: null }] } })).toBe(true);
      expect(validate({ turn: { mode: 'NEW', operations: [op] } })).toBe(false);
      expect(validate({ turn: { mode: 'NEW', operations: [{ ...op, same_as: [{ field: 'service', item_key: 'carla', literal: 'x' }] }] } })).toBe(false);
      expect(validate({ turn: { mode: 'NEW', operations: [{ ...op, same_as: [{ field: 'date', item_key: 'Carla', literal: 'x' }] }] } })).toBe(false);
      expect(validate({ turn: { mode: 'PATCH', operations: [{ item_key: 'a', fields: { same_as } }] } })).toBe(false);
    }, { active_plan: active });
    env(false);
    await withConversationRouting(async () => { expect(new Ajv().compile(tool())({ turn: { mode: 'NEW', operations: [{ ...op, same_as }] } })).toBe(false); });
  });
  it.each([false, true])('components=%s: the resolved schema is the flag-off schema plus `same_as` (the compaction changes layout only)', async components => {
    const resolved = async (sameAs: boolean) => { env(sameAs, components); return withConversationRouting(async () => expandedWire(tool()), STRESS_CONTEXT); };
    const off = await resolved(false), on = await resolved(true);
    expect(JSON.stringify(on)).toContain('"same_as"');
    expect(withoutSameAs(on)).toEqual(off);
  });
});

describe('request budget: the flag pays for its bytes (production shapes, realistic directory, 10 active + 50 suspended, output 8192)', () => {
  const salon = { professionals: Array.from({ length: 8 }, (_, i) => `Profissional Sintética ${i}`), services: Array.from({ length: 24 }, (_, i) => `Serviço Sintético Completo ${i}`), today: LINT_DIRECTORY.today };
  const activeKeys = STRESS_CONTEXT.active_plan!.actions as { item_key: string }[];
  const shapes = () => [
    { name: 'stress', state: { name: 'stress', skill: 'discovery' as const, context: STRESS_CONTEXT } },
    { name: 'multi-action continuation', state: { name: 'multi', skill: 'discovery' as const, context: STRESS_CONTEXT, fields: continuationDraft(activeKeys), requirements: continuationRequirements() } },
    { name: 'scheduling adapter answer', state: { name: 'adapter', skill: 'scheduling' as const, context: STRESS_CONTEXT, fields: { operation: 'appointment.change', fields: {}, clarification: { missing_fields: ['time'], requested_field: 'time', previous_response: 'Qual o novo horário?' } },
      requirements: () => getOperationRequirements('appointment.change') } },
  ];
  it.each([false, true])('components=%s: flag on is never larger than flag off; with polarity too, every stress and JIT shape fits 64000', async components => {
    const rows: Record<string, unknown>[] = [];
    for (const jit of [false, true]) {
      // The continuation draft and requirements are built under the JIT flag, as the orchestrator builds them.
      if (jit) vi.stubEnv('SALON_SECRETARY_JIT_INSTRUCTIONS', 'true');
      const list = shapes(); vi.unstubAllEnvs();
      for (const shape of list) {
        const bytes: Record<string, number> = {};
        for (const [label, sameAs, polarity] of [['off', false, false], ['on', true, false], ['polarity', false, true], ['both', true, true]] as const) {
          const flags = { SALON_SECRETARY_TEMPORAL_COMPONENTS: String(components), SALON_SECRETARY_JIT_INSTRUCTIONS: String(jit), SALON_SECRETARY_SAME_AS: String(sameAs), SALON_SECRETARY_TEMPORAL_POLARITY: String(polarity) };
          const request = await compileRequest(shape.state, flags, salon);
          // Request-budget migration (backup: .demo/agenda-core/contract-migration/secretary-same-as-wire.test.before-request-budget.ts):
          // the flag's cost is measured on the request as configured; an over-cap one is now degraded before it is sent.
          bytes[label] = request.configuredBytes;
          // The rule is stated exactly once (inside the field it governs) and only with the flag on.
          const body = JSON.stringify({ i: request.instructions, s: request.system, w: request.wire });
          expect(body.split(JSON.stringify(sameAsInstructions).slice(1, -1)).length - 1, `${shape.name} ${label}`).toBe(sameAs ? 1 : 0);
        }
        rows.push({ components, jit, shape: shape.name, off: bytes.off + 8192, on: bytes.on + 8192, marginOn: 64000 - bytes.on - 8192, paid: bytes.off - bytes.on,
          polarity: bytes.polarity + 8192, both: bytes.both + 8192, marginBoth: 64000 - bytes.both - 8192, costWithPolarity: bytes.both - bytes.polarity });
        expect(bytes.on, shape.name).toBeLessThanOrEqual(bytes.off);
        expect(bytes.both, shape.name).toBeLessThanOrEqual(bytes.off);
        if (jit || shape.name === 'stress') { expect(bytes.on + 8192, shape.name).toBeLessThanOrEqual(64000); expect(bytes.both + 8192, shape.name).toBeLessThanOrEqual(64000); }
      }
    }
    console.info(JSON.stringify({ c5SameAsBudget: rows }));
  }, 180_000);
});

describe('instruction lint and contract version with the flag on', () => {
  it('no duplicated rule, unpublished name or contradiction in any compiled state (components x JIT)', async () => {
    const flags = [false, true].flatMap(components => [false, true].map(jit => ({ SALON_SECRETARY_TEMPORAL_COMPONENTS: String(components), SALON_SECRETARY_JIT_INSTRUCTIONS: String(jit), SALON_SECRETARY_SAME_AS: 'true' })));
    const requests = await compileMatrix(LINT_STATES, flags);
    expect(requests.every(request => JSON.stringify(request.wire).includes('"same_as"'))).toBe(true);
    const findings = lintRequests(requests);
    expect(findings, JSON.stringify(findings.slice(0, 8), null, 1)).toEqual([]);
  }, 180_000);
  it('the flag is a contract input only when on: flag-off profiles keep their recorded version', () => {
    const v2 = { SALON_SECRETARY_MULTI_ACTION_V2_ENABLED: 'true' };
    const off = contractProfileDigest(v2), explicitOff = contractProfileDigest({ ...v2, SALON_SECRETARY_SAME_AS: 'false' }), on = contractProfileDigest({ ...v2, SALON_SECRETARY_SAME_AS: 'true' });
    expect(explicitOff).toEqual(off);
    expect(on.version).not.toBe(off.version); expect(on.parts.wires).not.toBe(off.parts.wires); expect(on.parts.runtime).not.toBe(off.parts.runtime);
    expect(on.parts.templates).toBe(off.parts.templates);
    // With polarity as well, the two flags are distinct contracts.
    const polarity = contractProfileDigest({ ...v2, SALON_SECRETARY_TEMPORAL_POLARITY: 'true' }), both = contractProfileDigest({ ...v2, SALON_SECRETARY_TEMPORAL_POLARITY: 'true', SALON_SECRETARY_SAME_AS: 'true' });
    expect(new Set([off.version, on.version, polarity.version, both.version]).size).toBe(4);
  });
});
