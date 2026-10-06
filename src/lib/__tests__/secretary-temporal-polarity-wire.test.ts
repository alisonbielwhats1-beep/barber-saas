import { afterEach, describe, expect, it, vi } from 'vitest';
import Ajv from 'ajv';
import { createServicesAgent, withConversationRouting, temporalExclusionInstructions, exclusionFields, continuationDraft, continuationRequirements,
  compactSecretaryWire, type SecretarySkill, type SecretaryWireSchema } from '@everflair/salon-secretary';
import { ScriptedServicesModel } from '../../test/scripted-services-model';
import { expandedWire, operationWire, turnWire, suspendedWirePlan } from '../../test/secretary-wire-schema';
import { compileMatrix, compileRequest, lintRequests, LINT_DIRECTORY, LINT_STATES, STRESS_CONTEXT } from '../../test/secretary-instruction-lint';
import { contractProfileDigest } from '../../../packages/salon-secretary/evaluation/contract-version-profiles';
import { getOperationRequirements } from '../service-contract';

/** C4 polarity wire (flag SALON_SECRETARY_TEMPORAL_POLARITY, default off): every scheduling operation may carry
 * `excluded` = null | [{field, value, literal}], the rule stated once in its description. The flag-on contract pays
 * for these bytes with the emitted-copies compaction (same resolved schema): every production-shaped request is
 * SMALLER with the flag on than off. With the flag off the wire, prompt and contract version are unchanged. */
afterEach(() => { vi.unstubAllEnvs(); });
const env = (polarity: boolean, components = false) => { vi.stubEnv('SALON_SECRETARY_TEMPORAL_POLARITY', String(polarity)); vi.stubEnv('SALON_SECRETARY_TEMPORAL_COMPONENTS', String(components)); };
function tool(skill: SecretarySkill | 'discovery' = 'discovery') {
  const agent = createServicesAgent(new ScriptedServicesModel([]), () => {}, skill, true), t = agent.tools[0];
  if (t.type !== 'function') throw Error('tool'); return t.parameters as SecretaryWireSchema;
}
const schedulingOps = ['appointment.create', 'appointment.change', 'appointment.cancel', 'schedule.block', 'availability.get', 'appointment.list'];
/** The resolved wire without any `excluded` property (what the flag adds). */
function withoutExcluded(node: unknown): unknown {
  if (Array.isArray(node)) return node.map(withoutExcluded);
  if (!node || typeof node !== 'object') return node;
  const out: Record<string, unknown> = {};
  for (const [key, value] of Object.entries(node)) {
    if (key === 'properties') out[key] = Object.fromEntries(Object.entries(value as object).filter(([name]) => name !== 'excluded').map(([name, v]) => [name, withoutExcluded(v)]));
    else if (key === 'required' && Array.isArray(value)) out[key] = value.filter(name => name !== 'excluded');
    else out[key] = withoutExcluded(value);
  }
  return out;
}

describe('flag off: historical wire', () => {
  it('publishes no exclusion and states no exclusion rule', async () => {
    env(false);
    await withConversationRouting(async () => {
      const wire = tool();
      expect(JSON.stringify(wire)).not.toContain('"excluded"'); expect(JSON.stringify(wire)).not.toContain(temporalExclusionInstructions);
      for (const operation of schedulingOps) expect(operationWire(expandedWire(wire), operation)).not.toHaveProperty('excluded');
    }, { suspended_plans: [suspendedWirePlan] });
  });
  it('the historical compaction is the default (no emitted-copies count)', () => {
    const shared = { type: 'object', properties: { a: { type: 'string', description: 'x'.repeat(80) } }, required: ['a'], additionalProperties: false };
    const root = { type: 'object', properties: { p: shared, q: shared, r: shared }, required: ['p', 'q', 'r'], additionalProperties: false };
    expect(compactSecretaryWire(root)).toEqual(compactSecretaryWire(root, false));
    // The historical count also extracts the child that only lives inside the shared definition; the emitted count inlines it.
    expect(Object.keys(compactSecretaryWire(root).$defs!)).toHaveLength(2); expect(Object.keys(compactSecretaryWire(root, true).$defs!)).toHaveLength(1);
    expect(expandedWire(compactSecretaryWire(root, true))).toEqual(expandedWire(compactSecretaryWire(root)));
  });
});

describe('flag on: one strict, nullable exclusion list per scheduling operation', () => {
  it.each([false, true])('components=%s: every mode publishes it after the affirmed selectors, with the role value shape', async components => {
    env(true, components);
    await withConversationRouting(async () => {
      const expanded = expandedWire(tool()), mode = (name: string) => turnWire(expanded, name);
      const branches = [mode('NEW'), mode('RESUME').properties!.patches.anyOf!.find(value => value.properties)!];
      for (const branch of branches) for (const operation of branch === branches[0] ? schedulingOps : ['appointment.change']) {
        const fields = operationWire(branch, operation), keys = Object.keys(fields);
        expect(keys.indexOf('excluded')).toBe(keys.indexOf('end_date') + 1); expect(keys.indexOf('excluded')).toBeLessThan(keys.indexOf('reason'));
        const list = fields.excluded;
        expect(list.anyOf!.map(value => value.type)).toEqual(['array', 'null']); expect(list.description).toBe(temporalExclusionInstructions);
        const item = list.anyOf![0].items!;
        expect(item.required).toEqual(['field', 'value', 'literal']); expect(item.additionalProperties).toBe(false);
        expect(item.properties!.field.enum).toEqual([...exclusionFields]);
        expect(item.properties!.literal).toEqual({ type: 'string', minLength: 1, maxLength: 600, pattern: '\\S' });
        if (!components) expect(item.properties!.value).toEqual({ type: 'string' });
        else {
          const container = fields.components.anyOf!.find(value => value.type === 'object')!.properties!;
          expect(item.properties!.value.anyOf).toEqual([container.date.anyOf![0].properties!.value, container.time.anyOf![0].properties!.value]);
        }
      }
      for (const operation of ['customer.create', 'service.change']) expect(operationWire(expanded, operation)).not.toHaveProperty('excluded');
    }, { suspended_plans: [suspendedWirePlan] });
    // The isolated adapter (CURRENT) publishes it too.
    await withConversationRouting(async () => { expect(turnWire(expandedWire(tool('scheduling')), 'CURRENT').properties!.fields.properties).toHaveProperty('excluded'); });
  });
  it('the live strict wire accepts an exclusion only with the flag on', async () => {
    const op = { operation: 'appointment.change', item_key: 'a', depends_on: null, released_slot_of: null, source_scope: null, customer_name: 'Amanda', service_name: null, professional_name: null,
      date: null, day_offset: null, weekday: null, time: { value: '11:00', literal: 'para 11h' }, period: null, source_date: null, source_day_offset: null, source_weekday: null,
      source_time: null, end_time: null, end_date: null, reason: null };
    const excluded = [{ field: 'time', value: '10:00', literal: 'não 10h' }];
    env(true);
    await withConversationRouting(async () => {
      const validate = new Ajv({ allErrors: true }).compile(tool());
      expect(validate({ turn: { mode: 'NEW', operations: [{ ...op, excluded }] } }), JSON.stringify(validate.errors)).toBe(true);
      expect(validate({ turn: { mode: 'NEW', operations: [{ ...op, excluded: null }] } })).toBe(true);
      expect(validate({ turn: { mode: 'NEW', operations: [op] } })).toBe(false);
      expect(validate({ turn: { mode: 'NEW', operations: [{ ...op, excluded: [{ field: 'end_date', value: '2026-09-29', literal: 'x' }] }] } })).toBe(false);
    });
    env(false);
    await withConversationRouting(async () => { expect(new Ajv().compile(tool())({ turn: { mode: 'NEW', operations: [{ ...op, excluded }] } })).toBe(false); });
  });
  it.each([false, true])('components=%s: the resolved schema is the flag-off schema plus `excluded` (the compaction changes layout only)', async components => {
    const resolved = async (polarity: boolean) => { env(polarity, components); return withConversationRouting(async () => expandedWire(tool()), STRESS_CONTEXT); };
    const off = await resolved(false), on = await resolved(true);
    expect(JSON.stringify(on)).toContain('"excluded"');
    expect(withoutExcluded(on)).toEqual(off);
  });
});

describe('request budget: the flag pays for its bytes (production shapes, realistic directory, 10 active + 50 suspended, output 8192)', () => {
  const salon = { professionals: Array.from({ length: 8 }, (_, i) => `Profissional Sintética ${i}`), services: Array.from({ length: 24 }, (_, i) => `Serviço Sintético Completo ${i}`), today: LINT_DIRECTORY.today };
  const active = STRESS_CONTEXT.active_plan!.actions as { item_key: string }[];
  const shapes = () => [
    { name: 'stress', state: { name: 'stress', skill: 'discovery' as const, context: STRESS_CONTEXT } },
    { name: 'multi-action continuation', state: { name: 'multi', skill: 'discovery' as const, context: STRESS_CONTEXT, fields: continuationDraft(active), requirements: continuationRequirements() } },
    { name: 'scheduling adapter answer', state: { name: 'adapter', skill: 'scheduling' as const, context: STRESS_CONTEXT, fields: { operation: 'appointment.change', fields: {}, clarification: { missing_fields: ['time'], requested_field: 'time', previous_response: 'Qual o novo horário?' } },
      requirements: () => getOperationRequirements('appointment.change') } },
  ];
  it.each([false, true])('components=%s: flag on is never larger than flag off; stress and every JIT shape fit 64000', async components => {
    const rows: Record<string, unknown>[] = [];
    for (const jit of [false, true]) {
      // The continuation draft and requirements are built under the JIT flag, as the orchestrator builds them.
      if (jit) vi.stubEnv('SALON_SECRETARY_JIT_INSTRUCTIONS', 'true');
      const list = shapes(); vi.unstubAllEnvs();
      for (const shape of list) {
      const bytes: Record<string, number> = {};
      for (const polarity of [false, true]) {
        const flags = { SALON_SECRETARY_TEMPORAL_COMPONENTS: String(components), SALON_SECRETARY_JIT_INSTRUCTIONS: String(jit), SALON_SECRETARY_TEMPORAL_POLARITY: String(polarity) };
        const request = await compileRequest(shape.state, flags, salon);
        // Request-budget migration (backup: .demo/agenda-core/contract-migration/secretary-temporal-polarity-wire.test.before-request-budget.ts):
        // the flag's cost is measured on the request as configured; an over-cap one is now degraded before it is sent.
        bytes[String(polarity)] = request.configuredBytes;
        // The rule is stated exactly once (inside the field it governs) and only with the flag on.
        const body = JSON.stringify({ i: request.instructions, s: request.system, w: request.wire });
        expect(body.split(JSON.stringify(temporalExclusionInstructions).slice(1, -1)).length - 1, shape.name).toBe(polarity ? 1 : 0);
      }
      rows.push({ components, jit, shape: shape.name, off: bytes.false + 8192, on: bytes.true + 8192, marginOn: 64000 - bytes.true - 8192, paid: bytes.false - bytes.true });
      expect(bytes.true, shape.name).toBeLessThanOrEqual(bytes.false);
      if (jit || shape.name === 'stress') expect(bytes.true + 8192, shape.name).toBeLessThanOrEqual(64000);
      }
    }
    console.info(JSON.stringify({ c4PolarityBudget: rows }));
  }, 120_000);
});

describe('instruction lint and contract version with the flag on', () => {
  it('no duplicated rule, unpublished name or contradiction in any compiled state (components x JIT)', async () => {
    const flags = [false, true].flatMap(components => [false, true].map(jit => ({ SALON_SECRETARY_TEMPORAL_COMPONENTS: String(components), SALON_SECRETARY_JIT_INSTRUCTIONS: String(jit), SALON_SECRETARY_TEMPORAL_POLARITY: 'true' })));
    const requests = await compileMatrix(LINT_STATES, flags);
    expect(requests.every(request => JSON.stringify(request.wire).includes('"excluded"'))).toBe(true);
    const findings = lintRequests(requests);
    expect(findings, JSON.stringify(findings.slice(0, 8), null, 1)).toEqual([]);
  }, 120_000);
  it('the flag is a contract input only when on: flag-off profiles keep their recorded version', () => {
    const v2 = { SALON_SECRETARY_MULTI_ACTION_V2_ENABLED: 'true' };
    const off = contractProfileDigest(v2), explicitOff = contractProfileDigest({ ...v2, SALON_SECRETARY_TEMPORAL_POLARITY: 'false' }), on = contractProfileDigest({ ...v2, SALON_SECRETARY_TEMPORAL_POLARITY: 'true' });
    expect(explicitOff).toEqual(off);
    expect(on.version).not.toBe(off.version); expect(on.parts.wires).not.toBe(off.parts.wires); expect(on.parts.runtime).not.toBe(off.parts.runtime);
    expect(on.parts.templates).toBe(off.parts.templates);
  });
});
