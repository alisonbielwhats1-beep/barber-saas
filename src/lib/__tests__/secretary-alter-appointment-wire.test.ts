import { afterEach, describe, expect, it, vi } from 'vitest';
import Ajv from 'ajv';
import { createServicesAgent, withConversationRouting, validateSelectionV2, validateSelection, selectionTransportSchemaV2, alterationInstruction, ALTERATION_REPLACED_SENTENCE,
  decisionInstructions, discoveryInstructions, alterationInstructions, continuationDraft, continuationRequirements, type SecretarySkill, type SecretaryWireSchema } from '@everflair/salon-secretary';
import { ScriptedServicesModel } from '../../test/scripted-services-model';
import { expandedWire, operationWire, turnWire, suspendedWirePlan } from '../../test/secretary-wire-schema';
import { intent, plan } from '../../test/secretary-capability-plan';
import { compileMatrix, compileRequest, lintRequests, LINT_DIRECTORY, LINT_STATES, STRESS_CONTEXT } from '../../test/secretary-instruction-lint';
import { contractProfileDigest } from '../../../packages/salon-secretary/evaluation/contract-version-profiles';
import { getOperationRequirements } from '../service-contract';

/** P2a (flag SALON_SECRETARY_ALTER_APPOINTMENT, default off): the NEW professional (`target_professional_name`) and the service
 * delta (`service_changes`) of appointment.change. Flag off: wire, prompt and contract version are the historical ones. Flag on:
 * both fields only in the wire family of appointment.change (NEW/ADD/PATCH), a value on any other operation is
 * CAPABILITY_FIELD_MISMATCH (B5 partial rejection), the catalog's prohibition becomes the alteration rule once, and every
 * production-shaped request with every candidate flag on still fits 64000 with an 8192 output. */
afterEach(() => { vi.unstubAllEnvs(); });
const env = (on: boolean) => vi.stubEnv('SALON_SECRETARY_ALTER_APPOINTMENT', on ? 'true' : 'false');
function tool(skill: SecretarySkill | 'discovery' = 'discovery') {
  const agent = createServicesAgent(new ScriptedServicesModel([]), () => {}, skill, true), t = agent.tools[0];
  if (t.type !== 'function') throw Error('tool'); return t.parameters as SecretaryWireSchema;
}
const family = ['appointment.list', 'appointment.read', 'availability.get', 'appointment.change', 'appointment.cancel', 'schedule.block'];
const others = ['appointment.create', 'service.change', 'customer.create', 'stock.movement', 'financial.report', 'customer.message'];
const change = { ...intent('appointment.change'), item_key: 'a', customer_name: 'Luana Prado', target_professional_name: null, service_changes: null };
const select = (op: Record<string, unknown>) => ({ ...plan([op as ReturnType<typeof intent>]), operations: [op] });
const active = { plan_ref: '30000000-0000-4000-8000-000000000001', actions: [{ item_key: 'a', operation: 'appointment.change', status: 'NEEDS_INPUT', depends_on: [] }] };

describe('flag off: the historical contract', () => {
  it('publishes neither field and keeps the prohibition sentence in every decision prompt', async () => {
    env(false);
    await withConversationRouting(async () => {
      const text = JSON.stringify(tool());
      expect(text).not.toContain('target_professional_name'); expect(text).not.toContain('service_changes');
    }, { active_plan: active, suspended_plans: [suspendedWirePlan] });
    for (const components of [false, true]) for (const jit of [false, true]) {
      const prompt = decisionInstructions(components, jit);
      expect(prompt).toContain(ALTERATION_REPLACED_SENTENCE); expect(prompt).not.toContain(alterationInstruction);
    }
    expect(alterationInstructions(discoveryInstructions)).toBe(discoveryInstructions);
    expect(getOperationRequirements('appointment.change').supported_fields).not.toContain('target_professional_name');
  });
  it('a value is refused by the backend guards even if a transport carried it', () => {
    env(false);
    expect(() => validateSelectionV2(selectionTransportSchemaV2.parse(select({ ...change, target_professional_name: 'Yasmin' })))).toThrow('CAPABILITY_FIELD_MISMATCH');
    expect(() => validateSelection(select({ ...change, service_changes: [{ mode: 'INCLUDE', service_name: 'barba' }] }))).toThrow('CAPABILITY_FIELD_MISMATCH');
    expect(() => validateSelectionV2(selectionTransportSchemaV2.parse(select(change)))).not.toThrow();
  });
  it('the contract version is unchanged when the flag is off (explicitly or unset)', () => {
    const v2 = { SALON_SECRETARY_MULTI_ACTION_V2_ENABLED: 'true' };
    const off = contractProfileDigest(v2), explicitOff = contractProfileDigest({ ...v2, SALON_SECRETARY_ALTER_APPOINTMENT: 'false' }), on = contractProfileDigest({ ...v2, SALON_SECRETARY_ALTER_APPOINTMENT: 'true' });
    expect(explicitOff).toEqual(off);
    expect(on.version).not.toBe(off.version); expect(on.parts.templates).not.toBe(off.parts.templates); expect(on.parts.wires).not.toBe(off.parts.wires); expect(on.parts.runtime).not.toBe(off.parts.runtime);
  });
});

describe('flag on: two nullable fields, only in the appointment.change family', () => {
  it('NEW, ADD and PATCH of the change family carry both; no other family does; the isolated adapter never does', async () => {
    env(true);
    await withConversationRouting(async () => {
      const expanded = expandedWire(tool());
      for (const mode of ['NEW', 'ADD']) {
        for (const operation of family) {
          const fields = operationWire(turnWire(expanded, mode), operation);
          expect(fields.target_professional_name.anyOf!.map(value => value.type)).toEqual(['string', 'null']);
          const list = fields.service_changes.anyOf![0];
          expect(list.type).toBe('array'); expect(list.minItems).toBe(1); expect(list.maxItems).toBe(10);
          expect(list.items!.required).toEqual(['mode', 'service_name']); expect(list.items!.properties!.mode.enum).toEqual(['SET', 'INCLUDE', 'REMOVE']);
        }
        for (const operation of others) { const fields = operationWire(turnWire(expanded, mode), operation); expect(fields).not.toHaveProperty('target_professional_name'); expect(fields).not.toHaveProperty('service_changes'); }
      }
      expect(JSON.stringify(turnWire(expanded, 'PATCH'))).toContain('"target_professional_name"');
    }, { active_plan: active, suspended_plans: [suspendedWirePlan] });
    await withConversationRouting(async () => { expect(JSON.stringify(turnWire(expandedWire(tool('scheduling')), 'CURRENT'))).not.toContain('target_professional_name'); });
  });
  it('the live strict wire accepts a change with them and refuses them on a create', async () => {
    env(true);
    await withConversationRouting(async () => {
      const validate = new Ajv({ allErrors: true }).compile(tool()), expanded = expandedWire(tool());
      const fields = operationWire(turnWire(expanded, 'NEW'), 'appointment.change');
      const op = { ...Object.fromEntries(Object.keys(fields).map(key => [key, null])), operation: 'appointment.change', item_key: 'a', customer_name: 'Luana Prado',
        target_professional_name: 'Yasmin', service_changes: [{ mode: 'REMOVE', service_name: 'barba' }, { mode: 'INCLUDE', service_name: 'sobrancelha' }] };
      expect(validate({ turn: { mode: 'NEW', operations: [op] } }), JSON.stringify(validate.errors)).toBe(true);
      expect(validate({ turn: { mode: 'NEW', operations: [{ ...op, service_changes: [{ mode: 'TROCA', service_name: 'barba' }] }] } })).toBe(false);
      expect(validate({ turn: { mode: 'NEW', operations: [{ ...op, service_changes: [] }] } })).toBe(false);
      const create = operationWire(turnWire(expanded, 'NEW'), 'appointment.create');
      const created = { ...Object.fromEntries(Object.keys(create).map(key => [key, null])), operation: 'appointment.create', item_key: 'b', target_professional_name: 'Yasmin' };
      expect(validate({ turn: { mode: 'NEW', operations: [created] } })).toBe(false);
    });
  });
  it('backend guards: only appointment.change; SET is never mixed with a delta; B5 leaves out only the offending operation', () => {
    env(true);
    const ok = (op: Record<string, unknown>) => validateSelectionV2(selectionTransportSchemaV2.parse(select(op)));
    expect(ok({ ...change, target_professional_name: 'Yasmin' }).operations[0]).toMatchObject({ target_professional_name: 'Yasmin' });
    expect(ok({ ...change, service_changes: [{ mode: 'SET', service_name: 'barba' }, { mode: 'SET', service_name: 'pezinho' }] }).operations[0].service_changes).toHaveLength(2);
    expect(() => ok({ ...change, service_changes: [{ mode: 'SET', service_name: 'barba' }, { mode: 'INCLUDE', service_name: 'pezinho' }] })).toThrow('CAPABILITY_FIELD_MISMATCH');
    for (const operation of ['appointment.cancel', 'appointment.list', 'appointment.create', 'schedule.block'])
      expect(() => ok({ ...intent(operation), item_key: 'a', target_professional_name: 'Yasmin' })).toThrow('CAPABILITY_FIELD_MISMATCH');
    const partial = validateSelectionV2(selectionTransportSchemaV2.parse({ ...plan([intent('appointment.change'), intent('appointment.cancel')]),
      operations: [{ ...change, target_professional_name: 'Yasmin' }, { ...intent('appointment.cancel'), item_key: 'b', customer_name: 'Bruna', service_changes: [{ mode: 'REMOVE', service_name: 'barba' }] }] }), { partial: true });
    expect(partial.operations.map(op => op.item_key)).toEqual(['a']);
    expect(partial.rejected).toEqual([expect.objectContaining({ item_key: 'b', code: 'CAPABILITY_FIELD_MISMATCH', dependent: false })]);
  });
  it('the prohibition sentence becomes the alteration rule, exactly once, in every decision prompt and in V1', () => {
    env(true);
    for (const components of [false, true]) for (const jit of [false, true]) {
      const prompt = decisionInstructions(components, jit);
      expect(prompt).not.toContain(ALTERATION_REPLACED_SENTENCE);
      expect(prompt.split(alterationInstruction).length - 1).toBe(1);
    }
    expect(alterationInstructions(discoveryInstructions).split(alterationInstruction).length - 1).toBe(1);
    expect(getOperationRequirements('appointment.change').supported_fields).toEqual(expect.arrayContaining(['target_professional_name', 'service_changes']));
    expect(getOperationRequirements('appointment.create').supported_fields).not.toContain('target_professional_name');
  });
});

describe('instruction lint with the flag on', () => {
  it('no duplicated rule, unpublished name or contradiction in any compiled state (components x JIT)', async () => {
    const flags = [false, true].flatMap(components => [false, true].map(jit => ({ SALON_SECRETARY_TEMPORAL_COMPONENTS: String(components), SALON_SECRETARY_JIT_INSTRUCTIONS: String(jit), SALON_SECRETARY_ALTER_APPOINTMENT: 'true' })));
    const requests = await compileMatrix(LINT_STATES, flags);
    expect(requests.every(request => request.instructions.includes(alterationInstruction))).toBe(true);
    const findings = lintRequests(requests);
    expect(findings, JSON.stringify(findings.slice(0, 8), null, 1)).toEqual([]);
  }, 240_000);
});

describe('request budget with EVERY candidate flag on (production shapes, realistic directory, 10 active + 50 suspended, output 8192)', () => {
  const salon = { professionals: Array.from({ length: 8 }, (_, i) => `Profissional Sintética ${i}`), services: Array.from({ length: 24 }, (_, i) => `Serviço Sintético Completo ${i}`), today: LINT_DIRECTORY.today };
  const activeKeys = STRESS_CONTEXT.active_plan!.actions as { item_key: string }[];
  const candidate = { SALON_SECRETARY_TEMPORAL_COMPONENTS: 'true', SALON_SECRETARY_TEMPORAL_POLARITY: 'true', SALON_SECRETARY_SAME_AS: 'true', SALON_SECRETARY_STRUCTURED_CONTEXT: 'true',
    SALON_SECRETARY_NAME_SUGGESTIONS: 'true', SALON_SECRETARY_CUSTOMER_OVERLAP_GUARD: 'true', SALON_SECRETARY_PERSISTED_STATE: 'true', SALON_SECRETARY_SCHEDULING_OVERLAP_ENABLED: 'true',
    SALON_SECRETARY_DATE_RULES_V2: 'true', SALON_SECRETARY_DAYPART_RULES_V2: 'true', SALON_SECRETARY_DAYPART_BY_HOURS: 'true' };
  const shapes = () => [
    { name: 'stress', state: { name: 'stress', skill: 'discovery' as const, context: STRESS_CONTEXT } },
    { name: 'multi-action continuation', state: { name: 'multi', skill: 'discovery' as const, context: STRESS_CONTEXT, fields: continuationDraft(activeKeys), requirements: continuationRequirements() } },
    { name: 'scheduling adapter answer', state: { name: 'adapter', skill: 'scheduling' as const, context: STRESS_CONTEXT, fields: { operation: 'appointment.change', fields: {}, clarification: { missing_fields: ['time'], requested_field: 'time', previous_response: 'Qual o novo horário?' } },
      requirements: () => getOperationRequirements('appointment.change') } },
    { name: 'first turn', state: { name: 'first', skill: 'discovery' as const } },
  ];
  it.each([true, false])('JIT=%s: the flag costs a bounded number of bytes and every request fits', async jit => {
    const rows: Record<string, unknown>[] = [];
    if (jit) vi.stubEnv('SALON_SECRETARY_JIT_INSTRUCTIONS', 'true');
    const list = shapes(); vi.unstubAllEnvs();
    for (const shape of list) {
      const bytes: Record<string, number> = {};
      for (const [label, alter, examples] of [['off', false, 'off'], ['on', true, 'off'], ['onExamples', true, 'selected']] as const) {
        const request = await compileRequest(shape.state, { ...candidate, SALON_SECRETARY_JIT_INSTRUCTIONS: String(jit), SALON_SECRETARY_ALTER_APPOINTMENT: String(alter), SALON_SECRETARY_EXAMPLES: examples }, salon);
        bytes[label] = request.configuredBytes; bytes[label + 'Sent'] = request.bytes;
        expect(request.instructions.includes(alterationInstruction), `${shape.name} ${label}`).toBe(alter);
      }
      rows.push({ jit, shape: shape.name, off: bytes.off + 8192, on: bytes.on + 8192, cost: bytes.on - bytes.off, marginOn: 64000 - bytes.on - 8192, sentWithExamples: bytes.onExamplesSent + 8192 });
      expect(bytes.on - bytes.off, shape.name).toBeLessThanOrEqual(1400);
      if (jit || shape.name === 'stress' || shape.name === 'first turn') expect(bytes.on + 8192, shape.name).toBeLessThanOrEqual(64000);
      expect(bytes.onExamplesSent + 8192, shape.name).toBeLessThanOrEqual(64000);
    }
    console.info(JSON.stringify({ p2aAlterAppointmentBudget: rows }));
  }, 240_000);
});
