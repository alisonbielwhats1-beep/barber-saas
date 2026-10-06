import { afterEach, describe, expect, it, vi } from 'vitest';
import Ajv from 'ajv';
import { createServicesAgent, withConversationRouting, validateSelectionV2, validateSelection, selectionTransportSchemaV2, multiServiceFields,
  continuationDraft, continuationRequirements, type SecretarySkill, type SecretaryWireSchema } from '@everflair/salon-secretary';
import { ScriptedServicesModel } from '../../test/scripted-services-model';
import { expandedWire, operationWire, turnWire, suspendedWirePlan } from '../../test/secretary-wire-schema';
import { intent, plan } from '../../test/secretary-capability-plan';
import { compileMatrix, compileRequest, lintRequests, LINT_DIRECTORY, LINT_STATES, STRESS_CONTEXT } from '../../test/secretary-instruction-lint';
import { contractProfileDigest } from '../../../packages/salon-secretary/evaluation/contract-version-profiles';
import { getOperationRequirements } from '../service-contract';
import { projectSchedulingOperation } from '../secretary-operation-projection';

/** P2b (flag SALON_SECRETARY_MULTI_SERVICE, default off): `service_names`, the services of ONE appointment.create /
 * availability.get. Flag off: wire, prompt and contract version are the historical ones and a list is refused by the backend
 * guards. Flag on: one nullable list only in the wire families that hold those operations (NEW/ADD, and PATCH only while such
 * an action is open), placed before service_name; a list on any other operation, or on the T21 create in a released slot, is
 * CAPABILITY_FIELD_MISMATCH (B5 partial rejection); every production-shaped request with every candidate flag on still fits
 * 64000 with an 8192 output. */
afterEach(() => { vi.unstubAllEnvs(); });
const env = (on: boolean) => vi.stubEnv('SALON_SECRETARY_MULTI_SERVICE', on ? 'true' : 'false');
function tool(skill: SecretarySkill | 'discovery' = 'discovery') {
  const agent = createServicesAgent(new ScriptedServicesModel([]), () => {}, skill, true), t = agent.tools[0];
  if (t.type !== 'function') throw Error('tool'); return t.parameters as SecretaryWireSchema;
}
const carriers = ['appointment.create', 'availability.get'];
const family = ['appointment.list', 'appointment.read', 'appointment.change', 'appointment.cancel', 'schedule.block'];
const others = ['service.change', 'customer.create', 'stock.movement', 'financial.report', 'customer.message'];
const create = { ...intent('appointment.create'), item_key: 'a', customer_name: 'Kevin Sato' };
const select = (op: Record<string, unknown>) => ({ ...plan([op as ReturnType<typeof intent>]), operations: [op] });
const active = (operation: string) => ({ plan_ref: '30000000-0000-4000-8000-000000000002', actions: [{ item_key: 'a', operation, status: 'NEEDS_INPUT', depends_on: [] }] });

describe('flag off: the historical contract', () => {
  it('publishes no service list in any wire', async () => {
    env(false);
    for (const context of [{ active_plan: active('appointment.create'), suspended_plans: [suspendedWirePlan] }, undefined])
      await withConversationRouting(async () => { expect(JSON.stringify(tool())).not.toContain('service_names'); expect(JSON.stringify(tool('scheduling'))).not.toContain('service_names'); }, context);
    expect(getOperationRequirements('appointment.create').supported_fields).not.toContain('service_names');
  });
  it('a list is refused by the backend guards even if a transport carried it', () => {
    env(false);
    expect(() => validateSelectionV2(selectionTransportSchemaV2.parse(select({ ...create, service_names: ['corte', 'barba'] })))).toThrow('CAPABILITY_FIELD_MISMATCH');
    expect(() => validateSelection(select({ ...create, service_names: ['corte', 'barba'] }))).toThrow('CAPABILITY_FIELD_MISMATCH');
    expect(() => validateSelectionV2(selectionTransportSchemaV2.parse(select(create)))).not.toThrow();
  });
  it('the contract version is unchanged when the flag is off (explicitly or unset); on, every part changes', () => {
    const v2 = { SALON_SECRETARY_MULTI_ACTION_V2_ENABLED: 'true' };
    const off = contractProfileDigest(v2), explicitOff = contractProfileDigest({ ...v2, SALON_SECRETARY_MULTI_SERVICE: 'false' }), on = contractProfileDigest({ ...v2, SALON_SECRETARY_MULTI_SERVICE: 'true' });
    expect(explicitOff).toEqual(off);
    expect(on.version).not.toBe(off.version); expect(on.parts.wires).not.toBe(off.parts.wires); expect(on.parts.runtime).not.toBe(off.parts.runtime);
    expect(on.parts.templates).toBe(off.parts.templates); // no instruction text: the field's own description is the contract
  });
});

describe('flag on: one nullable list, only where create/availability are published', () => {
  it('NEW and ADD of the create family and of the family holding availability.get carry it, before service_name; no other family; the isolated adapter never', async () => {
    env(true);
    await withConversationRouting(async () => {
      const expanded = expandedWire(tool());
      for (const mode of ['NEW', 'ADD']) {
        for (const operation of [...carriers, ...family]) {
          const fields = operationWire(turnWire(expanded, mode), operation), list = fields.service_names.anyOf![0];
          expect(fields.service_names.anyOf!.map(value => value.type)).toEqual(['array', 'null']);
          expect(list).toMatchObject({ type: 'array', minItems: 1, maxItems: 10, items: { type: 'string', minLength: 2, maxLength: 200 } });
          const keys = Object.keys(fields);
          expect(keys.indexOf('service_names')).toBe(keys.indexOf('service_name') - 1);
        }
        for (const operation of others) expect(operationWire(turnWire(expanded, mode), operation)).not.toHaveProperty('service_names');
      }
    }, { active_plan: active('appointment.create'), suspended_plans: [suspendedWirePlan] });
    // PATCH: only while an action of those operations is open.
    await withConversationRouting(async () => { expect(JSON.stringify(turnWire(expandedWire(tool()), 'PATCH'))).toContain('"service_names"'); }, { active_plan: active('availability.get') });
    await withConversationRouting(async () => { expect(JSON.stringify(turnWire(expandedWire(tool()), 'PATCH'))).not.toContain('"service_names"'); }, { active_plan: active('appointment.change') });
    await withConversationRouting(async () => { expect(JSON.stringify(turnWire(expandedWire(tool('scheduling')), 'CURRENT'))).not.toContain('service_names'); });
    expect(multiServiceFields.service_names.description!.length).toBeLessThanOrEqual(130);
  });
  it('the live strict wire accepts a create with a list and refuses an empty list or a list on a change', async () => {
    env(true);
    await withConversationRouting(async () => {
      const validate = new Ajv({ allErrors: true }).compile(tool()), expanded = expandedWire(tool());
      const op = (operation: string, extra: Record<string, unknown>) => ({ ...Object.fromEntries(Object.keys(operationWire(turnWire(expanded, 'NEW'), operation)).map(key => [key, null])), operation, item_key: 'a', ...extra });
      expect(validate({ turn: { mode: 'NEW', operations: [op('appointment.create', { customer_name: 'Kevin Sato', service_names: ['corte', 'barba'] })] } }), JSON.stringify(validate.errors)).toBe(true);
      expect(validate({ turn: { mode: 'NEW', operations: [op('appointment.create', { service_names: [] })] } })).toBe(false);
      expect(validate({ turn: { mode: 'NEW', operations: [op('appointment.create', { service_names: Array.from({ length: 11 }, (_, i) => `serviço ${i}`) })] } })).toBe(false);
      const customer = { ...Object.fromEntries(Object.keys(operationWire(turnWire(expanded, 'NEW'), 'customer.create')).map(key => [key, null])), operation: 'customer.create', item_key: 'b', service_names: ['corte', 'barba'] };
      expect(validate({ turn: { mode: 'NEW', operations: [customer] } })).toBe(false);
    });
  });
  it('backend guards: create/availability only; never on the released-slot create; B5 leaves out only the offending operation', () => {
    env(true);
    const ok = (op: Record<string, unknown>) => validateSelectionV2(selectionTransportSchemaV2.parse(select(op)));
    expect(ok({ ...create, service_names: ['corte', 'barba'] }).operations[0]).toMatchObject({ service_names: ['corte', 'barba'] });
    expect(ok({ ...intent('availability.get'), item_key: 'a', service_names: ['pé', 'mão'] }).operations[0]).toMatchObject({ service_names: ['pé', 'mão'] });
    for (const operation of ['appointment.change', 'appointment.cancel', 'appointment.list', 'appointment.read', 'schedule.block'])
      expect(() => ok({ ...intent(operation), item_key: 'a', service_names: ['corte', 'barba'] })).toThrow('CAPABILITY_FIELD_MISMATCH');
    const released = { skills: ['scheduling'], independent: false, operations: [{ ...intent('appointment.cancel'), item_key: 'a', customer_name: 'Duda Ramos', reason: 'desistiu' },
      { ...intent('appointment.create'), item_key: 'b', depends_on: ['a'], released_slot_of: 'a', customer_name: 'Kevin Sato', service_names: ['corte', 'barba'] }] };
    expect(() => validateSelectionV2(selectionTransportSchemaV2.parse(released))).toThrow('CAPABILITY_FIELD_MISMATCH');
    expect(() => validateSelection(released)).toThrow('CAPABILITY_FIELD_MISMATCH');
    const partial = validateSelectionV2(selectionTransportSchemaV2.parse({ ...plan([intent('appointment.create'), intent('appointment.cancel')]),
      operations: [{ ...create, service_names: ['corte', 'barba'] }, { ...intent('appointment.cancel'), item_key: 'b', customer_name: 'Duda Ramos', service_names: ['corte', 'barba'] }] }), { partial: true });
    expect(partial.operations.map(op => op.item_key)).toEqual(['a']);
    expect(partial.rejected).toEqual([expect.objectContaining({ item_key: 'b', code: 'CAPABILITY_FIELD_MISMATCH', dependent: false })]);
  });
  it('a validated V2 create reaches the scheduling projection with its list intact', () => {
    env(true);
    const selection = validateSelectionV2(selectionTransportSchemaV2.parse(select({ ...create, service_names: ['pé', 'mão'] })));
    expect(projectSchedulingOperation(selection.operations[0]).fields).toEqual({ customer_name: 'Kevin Sato', service_names: ['pé', 'mão'] });
  });
});

describe('instruction lint with the flag on', () => {
  it('no duplicated rule, unpublished name or contradiction in any compiled state (components x JIT)', async () => {
    const flags = [false, true].flatMap(components => [false, true].map(jit => ({ SALON_SECRETARY_TEMPORAL_COMPONENTS: String(components), SALON_SECRETARY_JIT_INSTRUCTIONS: String(jit), SALON_SECRETARY_MULTI_SERVICE: 'true' })));
    const requests = await compileMatrix(LINT_STATES, flags);
    expect(requests.some(request => JSON.stringify(request.wire).includes('service_names'))).toBe(true);
    const findings = lintRequests(requests);
    expect(findings, JSON.stringify(findings.slice(0, 8), null, 1)).toEqual([]);
  }, 240_000);
});

describe('request budget with EVERY candidate flag on (production shapes, realistic directory, 10 active + 50 suspended, output 8192)', () => {
  const salon = { professionals: Array.from({ length: 8 }, (_, i) => `Profissional Sintética ${i}`), services: Array.from({ length: 24 }, (_, i) => `Serviço Sintético Completo ${i}`), today: LINT_DIRECTORY.today };
  const activeKeys = STRESS_CONTEXT.active_plan!.actions as { item_key: string }[];
  const candidate = { SALON_SECRETARY_TEMPORAL_COMPONENTS: 'true', SALON_SECRETARY_TEMPORAL_POLARITY: 'true', SALON_SECRETARY_SAME_AS: 'true', SALON_SECRETARY_STRUCTURED_CONTEXT: 'true',
    SALON_SECRETARY_NAME_SUGGESTIONS: 'true', SALON_SECRETARY_CUSTOMER_OVERLAP_GUARD: 'true', SALON_SECRETARY_PERSISTED_STATE: 'true', SALON_SECRETARY_SCHEDULING_OVERLAP_ENABLED: 'true',
    SALON_SECRETARY_DATE_RULES_V2: 'true', SALON_SECRETARY_DAYPART_RULES_V2: 'true', SALON_SECRETARY_DAYPART_BY_HOURS: 'true', SALON_SECRETARY_ALTER_APPOINTMENT: 'true' };
  const shapes = () => [
    { name: 'stress', state: { name: 'stress', skill: 'discovery' as const, context: STRESS_CONTEXT } },
    { name: 'multi-action continuation', state: { name: 'multi', skill: 'discovery' as const, context: STRESS_CONTEXT, fields: continuationDraft(activeKeys), requirements: continuationRequirements() } },
    { name: 'scheduling adapter answer', state: { name: 'adapter', skill: 'scheduling' as const, context: STRESS_CONTEXT, fields: { operation: 'appointment.create', fields: {}, clarification: { missing_fields: ['time'], requested_field: 'time', previous_response: 'Qual horário?' } },
      requirements: () => getOperationRequirements('appointment.create') } },
    { name: 'first turn', state: { name: 'first', skill: 'discovery' as const } },
  ];
  it.each([true, false])('JIT=%s: the flag costs a bounded number of bytes and every request fits', async jit => {
    const rows: Record<string, unknown>[] = [];
    if (jit) vi.stubEnv('SALON_SECRETARY_JIT_INSTRUCTIONS', 'true');
    const list = shapes(); vi.unstubAllEnvs();
    for (const shape of list) {
      const bytes: Record<string, number> = {};
      for (const [label, multi, examples] of [['off', false, 'off'], ['on', true, 'off'], ['onExamples', true, 'selected']] as const) {
        const request = await compileRequest(shape.state, { ...candidate, SALON_SECRETARY_JIT_INSTRUCTIONS: String(jit), SALON_SECRETARY_MULTI_SERVICE: String(multi), SALON_SECRETARY_EXAMPLES: examples }, salon);
        bytes[label] = request.configuredBytes; bytes[label + 'Sent'] = request.bytes;
        expect(JSON.stringify(request.wire).includes('service_names'), `${shape.name} ${label}`).toBe(multi);
      }
      rows.push({ jit, shape: shape.name, off: bytes.off + 8192, on: bytes.on + 8192, cost: bytes.on - bytes.off, marginOn: 64000 - bytes.on - 8192, sentWithExamples: bytes.onExamplesSent + 8192 });
      expect(bytes.on - bytes.off, shape.name).toBeLessThanOrEqual(900);
      if (jit || shape.name === 'stress' || shape.name === 'first turn') expect(bytes.on + 8192, shape.name).toBeLessThanOrEqual(64000);
      expect(bytes.onExamplesSent + 8192, shape.name).toBeLessThanOrEqual(64000);
    }
    console.info(JSON.stringify({ p2bMultiServiceBudget: rows }));
  }, 240_000);
});
