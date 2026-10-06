import { afterEach, describe, expect, it, vi } from 'vitest';
import { continuationDraft, continuationRequirements, sameAsInstructions, sameAsInstructionsV2, type ConversationRoutingContext, type SecretaryWireSchema } from '@everflair/salon-secretary';
import { compileMatrix, compileRequest, lintRequests, LINT_DIRECTORY, LINT_STATES, STRESS_CONTEXT } from '../../test/secretary-instruction-lint';
import { contractProfileDigest } from '../../../packages/salon-secretary/evaluation/contract-version-profiles';
import { getOperationRequirements } from '../service-contract';

/** P3a wire (flag SALON_SECRETARY_REFERENCES_V2, default off). Step 0: the same_as schema is ONE $def in every compiled
 * request (one enum, one description for every operation family: the emitted-copies compaction references it; measured
 * before this change it was already one $def, so the step saves 0 B against the compiled wire and ~1 KB only against the
 * expanded one). Off: wire, prompt and contract version are the historical ones. On: the budget with EVERY candidate flag
 * (phase 1-3, SAME_AS, components, polarity, JIT, structured context, name suggestions/aliases, overlap guard, persisted
 * state, EXAMPLES=selected) still sends at most 64000 - 8192 bytes, and the flag's own cost is bounded. Offline. */
afterEach(() => { vi.unstubAllEnvs(); });
const PLAN = '10000000-0000-4000-8000-000000000001';
const people = ['Maria Eduarda Lopes', 'Kevin Sato', 'Hiroshi Tanaka', 'Duda Ramos', 'Jade Moura', 'Téo Nakamura', 'Luz Andrade', 'Yasmin Alves', 'Nando Ribeiro', 'Céu Martins'];
const pros = ['Caio Brito', 'Lia Moraes', 'Nara Quintela', 'Jonas Ferraz'];
const services = ['Corte masculino', 'Esmaltação em gel', 'Design de sobrancelha com henna', 'Extensão de cílios fio a fio', 'Massagem relaxante'];
function filled(index: number) {
  const who = people[index % people.length], pro = pros[index % pros.length], service = services[index % services.length], kind = index % 3;
  if (kind === 0) return { operation: 'appointment.create', fields: { customer_name: who, service_names: [service, 'Pezinho'], professional_name: pro, date: '2026-10-02', time: '10:30' } };
  if (kind === 1) return { operation: 'appointment.change', fields: { customer_name: who, source_date: '2026-10-01', source_time: '14:00', date: '2026-10-05', time: '16:00',
    target_professional_name: pros[(index + 1) % pros.length], service_changes: [{ mode: 'INCLUDE', service_name: 'Pezinho' }] } };
  return { operation: 'appointment.cancel', fields: { customer_name: who, date: '2026-10-03', time: '09:00', reason: 'ela viajou a trabalho e não volta a tempo' } };
}
function realistic(): ConversationRoutingContext {
  const active = Array.from({ length: 10 }, (_, i) => ({ item_key: 'item_' + i, status: 'NEEDS_INPUT', depends_on: [], ...filled(i),
    clarification: { missing_fields: ['time'], requested_field: 'time', previous_response: `Qual horário para ${people[i % people.length]}?` } }));
  return { active_plan: { plan_ref: PLAN, actions: active }, suspended_plans: Array.from({ length: 5 }, (_, p) => ({ plan_ref: '20000000-0000-4000-8000-' + String(p + 1).padStart(12, '0'),
    actions: Array.from({ length: 10 }, (_, i) => ({ item_key: `saved_${p}_${i}`, status: 'READY_FOR_CONFIRMATION', depends_on: [], ...filled(i + p) })) })) } as ConversationRoutingContext;
}
const every = { SALON_SECRETARY_TEMPORAL_COMPONENTS: 'true', SALON_SECRETARY_TEMPORAL_POLARITY: 'true', SALON_SECRETARY_SAME_AS: 'true', SALON_SECRETARY_STRUCTURED_CONTEXT: 'true',
  SALON_SECRETARY_NAME_SUGGESTIONS: 'true', SALON_SECRETARY_NAME_ALIASES: 'true', SALON_SECRETARY_CUSTOMER_OVERLAP_GUARD: 'true', SALON_SECRETARY_PERSISTED_STATE: 'true',
  SALON_SECRETARY_SCHEDULING_OVERLAP_ENABLED: 'true', SALON_SECRETARY_CONFIRMATION_GROUPING: 'true', SALON_SECRETARY_DATE_RULES_V2: 'true', SALON_SECRETARY_DAYPART_RULES_V2: 'true',
  SALON_SECRETARY_DAYPART_BY_HOURS: 'true', SALON_SECRETARY_JIT_INSTRUCTIONS: 'true', SALON_SECRETARY_EXAMPLES: 'selected',
  SALON_SECRETARY_ALTER_APPOINTMENT: 'true', SALON_SECRETARY_MULTI_SERVICE: 'true', SALON_SECRETARY_EXCEPTION_RULES_V2: 'true', SALON_SECRETARY_COPY_V2: 'true' };
const salon = { professionals: [...pros, ...Array.from({ length: 4 }, (_, i) => `Profissional Extra ${i}`)], services: [...services, 'Pezinho', 'Barba', ...Array.from({ length: 17 }, (_, i) => `Serviço Extra Completo ${i}`)], today: LINT_DIRECTORY.today };
/** Where the reference list lives in a compiled wire: its $def names and every inline copy. */
function sameAsLayout(wire: SecretaryWireSchema) {
  const defs = Object.entries(wire.$defs ?? {}).filter(([, value]) => JSON.stringify(value).includes('"item_key"') && JSON.stringify(value).includes('"literal"') && (value as { anyOf?: unknown[] }).anyOf && JSON.stringify(value).includes('"field"')).map(([name]) => name);
  const text = JSON.stringify(wire), refs = defs.flatMap(name => text.split(`"same_as":{"$ref":"#/$defs/${name}"}`).length - 1), inline = text.split('"same_as":{"anyOf"').length - 1;
  return { defs, refs: refs.reduce((a, b) => a + b, 0), inline };
}

describe('flag off: historical wire, prompt and contract', () => {
  it('explicit off equals unset, in every lint state (components x JIT)', async () => {
    const base = [false, true].flatMap(c => [false, true].map(j => ({ SALON_SECRETARY_TEMPORAL_COMPONENTS: String(c), SALON_SECRETARY_JIT_INSTRUCTIONS: String(j), SALON_SECRETARY_SAME_AS: 'true' })));
    const unset = await compileMatrix(LINT_STATES, base), off = await compileMatrix(LINT_STATES, base.map(flags => ({ ...flags, SALON_SECRETARY_REFERENCES_V2: 'false' })));
    expect(off.map(r => r.bytes)).toEqual(unset.map(r => r.bytes));
    expect(off.map(r => JSON.stringify({ i: r.instructions, w: r.wire }))).toEqual(unset.map(r => JSON.stringify({ i: r.instructions, w: r.wire })));
    expect(unset.every(r => JSON.stringify(r.wire).includes(JSON.stringify(sameAsInstructions).slice(1, 40)))).toBe(true);
  }, 240_000);
  it('the flag is a contract input only when on', () => {
    const v2 = { SALON_SECRETARY_MULTI_ACTION_V2_ENABLED: 'true', SALON_SECRETARY_SAME_AS: 'true' };
    const off = contractProfileDigest(v2), explicitOff = contractProfileDigest({ ...v2, SALON_SECRETARY_REFERENCES_V2: 'false' }), on = contractProfileDigest({ ...v2, SALON_SECRETARY_REFERENCES_V2: 'true' });
    expect(explicitOff).toEqual(off);
    expect(on.version).not.toBe(off.version); expect(on.parts.wires).not.toBe(off.parts.wires); expect(on.parts.templates).not.toBe(off.parts.templates); expect(on.parts.runtime).not.toBe(off.parts.runtime);
  });
});

describe('flag on: one $def, stated once, no duplicated rule', () => {
  it('in every lint state the reference list is ONE $def referenced by every family (never inline); its rule once in the body', async () => {
    const flags = [false, true].flatMap(c => [false, true].map(j => ({ SALON_SECRETARY_TEMPORAL_COMPONENTS: String(c), SALON_SECRETARY_JIT_INSTRUCTIONS: String(j), SALON_SECRETARY_SAME_AS: 'true', SALON_SECRETARY_REFERENCES_V2: 'true' })));
    const requests = await compileMatrix(LINT_STATES, flags);
    for (const request of requests) {
      const layout = sameAsLayout(request.wire), body = JSON.stringify({ i: request.instructions, s: request.system, w: request.wire });
      expect(layout.defs, request.state).toHaveLength(1);
      expect(layout.inline, request.state).toBe(0);
      expect(layout.refs, request.state).toBeGreaterThanOrEqual(3);
      expect(body.split(JSON.stringify(sameAsInstructionsV2).slice(1, -1)).length - 1, request.state).toBe(1);
      expect(JSON.stringify(request.wire)).toContain('"enum":["date","time","professional","customer","service"]');
    }
    const findings = lintRequests(requests);
    expect(findings, JSON.stringify(findings.slice(0, 8), null, 1)).toEqual([]);
  }, 240_000);
});

describe('request budget with EVERY candidate flag on (realistic heavy state, stress, first turn)', () => {
  it('what is sent fits 64000 with an 8192 output; the flag costs a bounded number of configured bytes', async () => {
    vi.stubEnv('SALON_SECRETARY_JIT_INSTRUCTIONS', 'true');
    const context = realistic(), keys = context.active_plan!.actions as { item_key: string }[], stressKeys = STRESS_CONTEXT.active_plan!.actions as { item_key: string }[];
    const cont = continuationDraft(keys), stressCont = continuationDraft(stressKeys), requirements = continuationRequirements();
    vi.unstubAllEnvs();
    const shapes = [
      { name: 'first turn', skill: 'discovery' as const },
      { name: 'realistic filled', skill: 'discovery' as const, context },
      { name: 'realistic continuation', skill: 'discovery' as const, context, fields: cont, requirements },
      { name: 'realistic adapter answer (change)', skill: 'scheduling' as const, context, fields: { operation: 'appointment.change', fields: { customer_name: 'Kevin', source_date: '2026-10-01', source_time: '14:00' },
        clarification: { missing_fields: ['time'], requested_field: 'time', previous_response: 'Qual o novo horário?' } }, requirements: () => getOperationRequirements('appointment.change') },
      { name: 'stress', skill: 'discovery' as const, context: STRESS_CONTEXT },
      { name: 'stress continuation', skill: 'discovery' as const, context: STRESS_CONTEXT, fields: stressCont, requirements },
    ];
    const rows: Record<string, unknown>[] = [];
    for (const shape of shapes) {
      const before = await compileRequest(shape, every, salon), after = await compileRequest(shape, { ...every, SALON_SECRETARY_REFERENCES_V2: 'true' }, salon);
      rows.push({ shape: shape.name, configuredOff: before.configuredBytes + 8192, configuredOn: after.configuredBytes + 8192, marginOn: 64000 - after.configuredBytes - 8192,
        sentOff: before.bytes + 8192, sentOn: after.bytes + 8192, degradation: after.budget?.steps ?? [], wireCost: JSON.stringify(after.wire).length - JSON.stringify(before.wire).length,
        promptCost: Buffer.byteLength(after.instructions) - Buffer.byteLength(before.instructions) });
      expect(after.bytes + 8192, shape.name).toBeLessThanOrEqual(64000);
      expect(after.budget?.fit ?? true, shape.name).toBe(true);
      // The flag's own schema and rule text (the rest of a stress delta is the budget-fitted examples block).
      expect(JSON.stringify(after.wire).length - JSON.stringify(before.wire).length, shape.name).toBeLessThanOrEqual(200);
      expect(Buffer.byteLength(after.instructions) - Buffer.byteLength(before.instructions), shape.name).toBeLessThanOrEqual(220);
    }
    console.info(JSON.stringify({ p3aReferencesBudget: rows }));
  }, 300_000);
});
