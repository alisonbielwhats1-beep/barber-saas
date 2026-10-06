import { afterEach, describe, expect, it, vi } from 'vitest';
import type { ConversationRoutingContext } from '@everflair/salon-secretary';
import { compileRequest, LINT_DIRECTORY } from '../../test/secretary-instruction-lint';
import { clarificationContext } from '../secretary-clarification';
import { getOperationRequirements } from '../service-contract';

/** B7 budget of SALON_SECRETARY_STRUCTURED_CONTEXT (default off). The flag adds no wire field and no instruction text: it
 * only changes the clarification DATA (a question code plus a short stable sentence instead of the screen prose). Measured
 * on production-shaped requests (realistic directory 8+24, 10 active + 50 suspended actions, output 8192) built through
 * the real clarificationContext, flag off vs on. Run with --reporter=verbose to see the b7StructuredBudget rows. */
afterEach(() => vi.unstubAllEnvs());
const salon = { professionals: Array.from({ length: 8 }, (_, i) => `Profissional Sintética ${i}`), services: Array.from({ length: 24 }, (_, i) => `Serviço Sintético Completo ${i}`), today: LINT_DIRECTORY.today };
const PLAN = '10000000-0000-4000-8000-000000000001';
type Ask = { operation: string; missing?: string[]; message: string; selection?: { field: string; labels: string[] } };
/** What the backend asks per operation in a real open plan (screen wording with resolved names). */
const open: Ask[] = [
  { operation: 'service.create', missing: ['durationMin'], message: 'Pode informar duração em minutos de Corte Degradê Premium?' },
  { operation: 'service.change', missing: ['priceCents'], message: 'Pode informar preço de Massagem Relaxante?' },
  { operation: 'customer.create', missing: ['phone'], message: 'Pode informar telefone de Marina Albuquerque?' },
  { operation: 'customer.change', missing: ['customer_ref'], message: 'Qual Amanda você quis dizer?\n• Amanda Souza · (11) *****-0001\n• Amanda Lima · (11) *****-0002',
    selection: { field: 'customer_ref', labels: ['Amanda Souza · (11) *****-0001', 'Amanda Lima · (11) *****-0002'] } },
  { operation: 'appointment.create', missing: ['time'], message: 'Qual horário você quer para Fábio Santos amanhã?' },
  { operation: 'appointment.change', missing: ['date', 'time'], message: 'Para qual dia e horário devo passar Juliana Ribeiro?' },
  { operation: 'appointment.cancel', missing: ['reason'], message: 'Qual o motivo do cancelamento?' },
  { operation: 'stock.movement', missing: ['quantity'], message: 'Quantas unidades de Óleo Aurora devo registrar?' },
  { operation: 'financial.report', missing: ['period'], message: 'Qual período você quer consultar?' },
  { operation: 'customer.message', missing: ['content'], message: 'Qual texto devo usar na mensagem? Envie entre aspas ou peça uma sugestão.' },
];
/** A prepared action (nothing asked): its preview is what the flag-off context repeats. */
const ready = (operation: string): Ask => ({ operation, message: 'REMARCAR AGENDAMENTO\nFábio Santos\nCorte\nTatiana Rocha\nANTES: qua, 30/09 às 16h–17h\nDEPOIS: qui, 01/10 às 10h–11h\nPreço mantido: R$ 80,00\nLista de espera: ninguém.' });
/** The shortest real questions: the flag's worst case (its code and sentence can outweigh a very short question). */
const shortest = (operation: string): Ask => ({ operation, missing: ['customer_ref'], message: 'Para qual cliente?' });
const synthetic = (operation: string): Ask => ({ operation, message: 'Questão sintética' });
const action = (ask: Ask, key: string) => ({ item_key: key, status: ask.missing ? 'NEEDS_INPUT' : 'READY_FOR_CONFIRMATION', depends_on: [],
  ...clarificationContext({ operation: ask.operation, fields: {}, missing_fields: ask.missing, message: ask.message, ...(ask.selection ? { waiting_for: ask.selection.field, selection: ask.selection } : {}) }) });
function context(active: (i: number) => Ask, suspended: (i: number) => Ask): ConversationRoutingContext {
  return { active_plan: { plan_ref: PLAN, actions: open.map((_, i) => action(active(i), `item_${i}`)) },
    suspended_plans: Array.from({ length: 5 }, (_, p) => ({ plan_ref: `20000000-0000-4000-8000-${String(p + 1).padStart(12, '0')}`, actions: open.map((_, i) => action(suspended(i), `item_${i}_p${p}`)) })) };
}
const mixes: Record<string, () => ConversationRoutingContext> = {
  'budget-test shape (nothing asked)': () => context(i => synthetic(open[i].operation), i => synthetic(open[i].operation)),
  'realistic (active asks, suspended prepared)': () => context(i => open[i], i => ready(open[i].operation)),
  'every action asks its real question': () => context(i => open[i], i => open[i]),
  'worst case (every action asks the shortest question)': () => context(i => shortest(open[i].operation), i => shortest(open[i].operation)),
};
const adapter = () => clarificationContext({ operation: 'appointment.change', fields: {}, missing_fields: ['time'], waiting_for: 'time', message: 'Qual o novo horário?' });
/** Measured request + output bytes of the realistic mix in the default configuration (JIT and structured context off). */
// 04/10/2026 (backup: .demo/agenda-core/contract-migration/secretary-structured-context-wire.test.before-professional-schedule-rule.ts):
// +11 bytes in every shape ("ou jornada": a professional's schedule is professional_management; Golden GF30). The production
// candidate (JIT + structured context) still fits 64000 below.
const DEFAULT_REALISTIC_CEILING: Record<string, number> = { 'false/stress': 72982, 'false/adapter answer': 73674, 'true/stress': 73592, 'true/adapter answer': 74231 };

describe('structured clarification context: request budget, flag off vs on', () => {
  it.each([false, true])('components=%s: smaller in every real mix and in the budget-test shape (which fits 64000 with JIT); bounded when every question is shorter than its code', async components => {
    const rows: Record<string, unknown>[] = [];
    for (const jit of [false, true]) for (const [mix, build] of Object.entries(mixes)) for (const shape of ['stress', 'adapter answer']) {
      const bytes: Record<string, number> = {};
      for (const on of [false, true]) {
        vi.stubEnv('SALON_SECRETARY_STRUCTURED_CONTEXT', String(on)); vi.stubEnv('SALON_SECRETARY_JIT_INSTRUCTIONS', String(jit));
        const state = shape === 'stress' ? { name: 'stress', skill: 'discovery' as const, context: build() }
          : { name: 'adapter', skill: 'scheduling' as const, context: build(), fields: adapter(), requirements: () => getOperationRequirements('appointment.change') };
        // Request-budget migration (backup: .demo/agenda-core/contract-migration/secretary-structured-context-wire.test.before-request-budget.ts):
        // the flag's effect is measured on the request as configured; an over-cap one is now degraded before it is sent
        // (secretary-request-budget.test.ts checks what is sent).
        bytes[String(on)] = (await compileRequest(state, { SALON_SECRETARY_TEMPORAL_COMPONENTS: String(components), SALON_SECRETARY_JIT_INSTRUCTIONS: String(jit), SALON_SECRETARY_STRUCTURED_CONTEXT: String(on) }, salon)).configuredBytes;
      }
      vi.unstubAllEnvs();
      const row = { components, jit, mix, shape, off: bytes.false + 8192, on: bytes.true + 8192, delta: bytes.true - bytes.false, marginOn: 64000 - bytes.true - 8192 };
      rows.push(row);
      if (!mix.startsWith('worst')) expect(row.delta, `${mix} / ${shape} / jit=${jit}`).toBeLessThan(0);
      if (mix.startsWith('budget-test') && jit) expect(row.on, `${mix} / ${shape}`).toBeLessThanOrEqual(64000);
      // Review gates on the realistic mix (active actions ask, suspended ones are prepared): with JIT and structured context
      // (the production candidate) it fits 64000; the default configuration is over the cap and is held at its measured
      // size (ratchet: any growth fails) until the coordinator decides the default-path reduction.
      if (mix.startsWith('realistic') && jit) expect(row.on, `${mix} / ${shape} / JIT + structured`).toBeLessThanOrEqual(64000);
      if (mix.startsWith('realistic') && !jit) expect(row.off, `${mix} / ${shape} / default (known over the cap: ratchet)`).toBeLessThanOrEqual(DEFAULT_REALISTIC_CEILING[`${components}/${shape}`]);
      // Worst case: at most the code and the short sentence per action (60 plan actions + the adapter's own).
      if (mix.startsWith('worst')) expect(row.delta).toBeLessThanOrEqual(61 * 30);
    }
    console.info(JSON.stringify({ b7StructuredBudget: rows }));
  }, 180_000);
  it('the flag adds no wire field and no instruction text: only the context data changes', async () => {
    const state = { name: 'stress', skill: 'discovery' as const, context: mixes['realistic (active asks, suspended prepared)']() };
    const off = await compileRequest(state, { SALON_SECRETARY_STRUCTURED_CONTEXT: 'false' }, salon);
    const on = await compileRequest(state, { SALON_SECRETARY_STRUCTURED_CONTEXT: 'true' }, salon);
    expect(JSON.stringify(on.wire)).toBe(JSON.stringify(off.wire));
    expect(on.instructions).toBe(off.instructions);
    expect(on.system.replace(/Contexto da conversa: .*\n/, '')).toBe(off.system.replace(/Contexto da conversa: .*\n/, ''));
  }, 60_000);
});
