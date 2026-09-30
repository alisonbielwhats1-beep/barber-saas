import { afterEach, describe, expect, it, vi } from 'vitest';
import { continuationDraft, continuationRequirements, type ConversationRoutingContext } from '@everflair/salon-secretary';
import { compileRequest, LINT_DIRECTORY } from '../../test/secretary-instruction-lint';
import { getOperationRequirements } from '../service-contract';

/** Review B (P2 fixer, medium): the request budget with EVERY candidate flag on over a REALISTIC heavy state — filled fields on
 * every action (not the empty-field stress context): 10 active actions asking + 5 suspended plans x 10 ready actions, a realistic
 * directory, structured context, JIT and EXAMPLES=selected. Offline: a fake transport, no model, no network.
 * The configured request of such a state is above the cap (phase-1 flags alone leave ~0.4 KB): the request budget degrades it
 * (examples dropped first, then suspended plans trimmed) and what is SENT always fits 64000 with an 8192 output. This test pins
 * that guarantee, and bounds what P2a+P2b+P2c add to the configured request so later growth is visible. */
afterEach(() => { vi.unstubAllEnvs(); });
const PLAN = '10000000-0000-4000-8000-000000000001';
const people = ['Maria Eduarda Lopes', 'Kevin Sato', 'Hiroshi Tanaka', 'Duda Ramos', 'Jade Moura', 'Téo Nakamura', 'Luz Andrade', 'Yasmin Alves', 'Nando Ribeiro', 'Céu Martins'];
const pros = ['Caio Brito', 'Lia Moraes', 'Nara Quintela', 'Jonas Ferraz'];
const services = ['Corte masculino', 'Esmaltação em gel', 'Design de sobrancelha com henna', 'Extensão de cílios fio a fio', 'Massagem relaxante'];
/** Filled fields as the plan shows them to Luna: create, change (with the A3 origin, P2a alteration) and cancel, round robin. */
function filled(index: number, alter: boolean, multi: boolean) {
  const who = people[index % people.length], pro = pros[index % pros.length], service = services[index % services.length];
  const kind = index % 3;
  if (kind === 0) return { operation: 'appointment.create', fields: { customer_name: who, ...(multi ? { service_names: [service, 'Pezinho'] } : { service_name: service }), professional_name: pro, date: '2026-10-02', time: '10:30' } };
  if (kind === 1) return { operation: 'appointment.change', fields: { customer_name: who, source_date: '2026-10-01', source_time: '14:00', date: '2026-10-05', time: '16:00',
    ...(alter ? { target_professional_name: pros[(index + 1) % pros.length], service_changes: [{ mode: 'INCLUDE', service_name: 'Pezinho' }] } : {}) } };
  return { operation: 'appointment.cancel', fields: { customer_name: who, date: '2026-10-03', time: '09:00', reason: 'ela viajou a trabalho e não volta a tempo' } };
}
function realistic(alter: boolean, multi: boolean): ConversationRoutingContext {
  const active = Array.from({ length: 10 }, (_, i) => ({ item_key: 'item_' + i, status: 'NEEDS_INPUT', depends_on: [], ...filled(i, alter, multi),
    clarification: { missing_fields: ['time'], requested_field: 'time', previous_response: `Qual horário para ${people[i % people.length]}?` } }));
  return { active_plan: { plan_ref: PLAN, actions: active },
    suspended_plans: Array.from({ length: 5 }, (_, p) => ({ plan_ref: '20000000-0000-4000-8000-' + String(p + 1).padStart(12, '0'),
      actions: Array.from({ length: 10 }, (_, i) => ({ item_key: `saved_${p}_${i}`, status: 'READY_FOR_CONFIRMATION', depends_on: [], ...filled(i + p, alter, multi) })) })) } as ConversationRoutingContext;
}
const candidate = { SALON_SECRETARY_TEMPORAL_COMPONENTS: 'true', SALON_SECRETARY_TEMPORAL_POLARITY: 'true', SALON_SECRETARY_SAME_AS: 'true', SALON_SECRETARY_STRUCTURED_CONTEXT: 'true',
  SALON_SECRETARY_NAME_SUGGESTIONS: 'true', SALON_SECRETARY_NAME_ALIASES: 'true', SALON_SECRETARY_CUSTOMER_OVERLAP_GUARD: 'true', SALON_SECRETARY_PERSISTED_STATE: 'true',
  SALON_SECRETARY_SCHEDULING_OVERLAP_ENABLED: 'true', SALON_SECRETARY_CONFIRMATION_GROUPING: 'true', SALON_SECRETARY_DATE_RULES_V2: 'true', SALON_SECRETARY_DAYPART_RULES_V2: 'true',
  SALON_SECRETARY_DAYPART_BY_HOURS: 'true', SALON_SECRETARY_JIT_INSTRUCTIONS: 'true', SALON_SECRETARY_EXAMPLES: 'selected' };
const p2 = { SALON_SECRETARY_ALTER_APPOINTMENT: 'true', SALON_SECRETARY_MULTI_SERVICE: 'true', SALON_SECRETARY_EXCEPTION_RULES_V2: 'true', SALON_SECRETARY_COPY_V2: 'true' };
const salon = { professionals: [...pros, ...Array.from({ length: 4 }, (_, i) => `Profissional Extra ${i}`)], services: [...services, 'Pezinho', 'Barba', ...Array.from({ length: 17 }, (_, i) => `Serviço Extra Completo ${i}`)], today: LINT_DIRECTORY.today };
const shapes = (alter: boolean, multi: boolean) => {
  const context = realistic(alter, multi), keys = (context.active_plan!.actions as { item_key: string }[]);
  return [
    { name: 'realistic filled', state: { name: 'filled', skill: 'discovery' as const, context } },
    { name: 'realistic continuation', state: { name: 'continuation', skill: 'discovery' as const, context, fields: continuationDraft(keys), requirements: continuationRequirements() } },
    { name: 'realistic adapter answer (change)', state: { name: 'adapter', skill: 'scheduling' as const, context,
      fields: { operation: 'appointment.change', fields: { customer_name: 'Kevin', source_date: '2026-10-01', source_time: '14:00' }, clarification: { missing_fields: ['time'], requested_field: 'time', previous_response: 'Qual o novo horário?' } },
      requirements: () => getOperationRequirements('appointment.change') } },
  ];
};

describe('review B: realistic heavy state, every candidate flag on (JIT, structured context, EXAMPLES=selected)', () => {
  it('what is sent always fits 64000 with an 8192 output; the P2 wire adds a bounded number of configured bytes', async () => {
    const rows: Record<string, unknown>[] = [];
    const off = shapes(false, false), on = shapes(true, true);
    for (const [index, shape] of on.entries()) {
      const before = await compileRequest(off[index].state, candidate, salon), schema = await compileRequest(off[index].state, { ...candidate, ...p2 }, salon), after = await compileRequest(shape.state, { ...candidate, ...p2 }, salon);
      rows.push({ shape: shape.name, configuredWithoutP2: before.configuredBytes + 8192, p2Wire: schema.configuredBytes - before.configuredBytes, configured: after.configuredBytes + 8192,
        p2Cost: after.configuredBytes - before.configuredBytes, sent: after.bytes + 8192, degradation: after.budget?.steps ?? [] });
      console.info(JSON.stringify(rows.at(-1)));
      expect(after.bytes + 8192, shape.name).toBeLessThanOrEqual(64000);
      expect(before.bytes + 8192, shape.name).toBeLessThanOrEqual(64000);
      // The P2 schemas (-compacted) and rule text over the same data: 435-1,535 B measured (JIT on), within the two per-flag
      // bounds of the P2a/P2b wire tests (900 B each). The rest of p2Cost is the owner's own alteration and list values on 60 actions,
      // which the budget degrades like any other data (examples first, then structured context, then the suspended plans).
      expect(schema.configuredBytes - before.configuredBytes, shape.name).toBeLessThanOrEqual(1800);
      expect(after.budget?.fit ?? true, shape.name).toBe(true);
    }
    console.info(JSON.stringify({ p2FixerRealisticBudget: rows }));
  }, 240_000);
});
