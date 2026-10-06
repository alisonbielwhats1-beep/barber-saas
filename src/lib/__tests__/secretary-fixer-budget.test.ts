import { describe, expect, it, vi } from 'vitest';
import { continuationDraft, continuationRequirements, type ConversationRoutingContext } from '@everflair/salon-secretary';
import { compileRequest, LINT_DIRECTORY, STRESS_CONTEXT, type CompiledRequest } from '../../test/secretary-instruction-lint';
import { clarificationContext } from '../secretary-clarification';
import { getOperationRequirements } from '../service-contract';

/** Fixer (adversarial review B, finding 2): the production-shaped "realistic mix" of secretary-request-budget.test.ts (10 open
 * actions, 5 suspended plans × 10 prepared actions, realistic directory 8 + 24 names, output 8192) with EVERY candidate flag on,
 * against the Candidate 3 flag set. Pins: what is sent always fits the cap and degrades only by the designed steps; the
 * non-degradable growth of Candidate 4 over Candidate 3 stays within what it is today (a new wire/prompt byte must be paid for). */
const salon = { professionals: Array.from({ length: 8 }, (_, i) => `Profissional Sintética ${i}`), services: Array.from({ length: 24 }, (_, i) => `Serviço Sintético Completo ${i}`), today: LINT_DIRECTORY.today };
const PLAN = '10000000-0000-4000-8000-000000000001';
type Ask = { operation: string; missing?: string[]; message: string; selection?: { field: string; labels: string[] } };
const open: Ask[] = [
  { operation: 'service.create', missing: ['durationMin'], message: 'Pode informar duração em minutos de Corte Degradê Premium?' },
  { operation: 'service.change', missing: ['priceCents'], message: 'Pode informar preço de Massagem Relaxante?' },
  { operation: 'customer.create', missing: ['phone'], message: 'Pode informar telefone de Marina Albuquerque?' },
  { operation: 'customer.change', missing: ['customer_ref'], message: 'Qual Pessoa você quis dizer?\n• Pessoa Um · (11) *****-0001\n• Pessoa Dois · (11) *****-0002',
    selection: { field: 'customer_ref', labels: ['Pessoa Um · (11) *****-0001', 'Pessoa Dois · (11) *****-0002'] } },
  { operation: 'appointment.create', missing: ['time'], message: 'Qual horário você quer para Pessoa Sintética amanhã?' },
  { operation: 'appointment.change', missing: ['date', 'time'], message: 'Para qual dia e horário devo passar Pessoa Sintética?' },
  { operation: 'appointment.cancel', missing: ['reason'], message: 'Qual o motivo do cancelamento?' },
  { operation: 'stock.movement', missing: ['quantity'], message: 'Quantas unidades de Óleo Aurora devo registrar?' },
  { operation: 'financial.report', missing: ['period'], message: 'Qual período você quer consultar?' },
  { operation: 'customer.message', missing: ['content'], message: 'Qual texto devo usar na mensagem? Envie entre aspas ou peça uma sugestão.' },
];
const ready = (operation: string): Ask => ({ operation, message: 'REMARCAR AGENDAMENTO\nPessoa Sintética\nCorte\nProfissional Sintética\nANTES: qua, 30/09 às 16h–17h\nDEPOIS: qui, 01/10 às 10h–11h\nPreço mantido: R$ 80,00\nLista de espera: ninguém.' });
const action = (ask: Ask, key: string) => ({ item_key: key, status: ask.missing ? 'NEEDS_INPUT' : 'READY_FOR_CONFIRMATION', depends_on: [],
  ...clarificationContext({ operation: ask.operation, fields: {}, missing_fields: ask.missing, message: ask.message, ...(ask.selection ? { waiting_for: ask.selection.field, selection: ask.selection } : {}) }) });
const realistic = (): ConversationRoutingContext => ({ active_plan: { plan_ref: PLAN, actions: open.map((ask, i) => action(ask, `item_${i}`)) },
  suspended_plans: Array.from({ length: 5 }, (_, p) => ({ plan_ref: `20000000-0000-4000-8000-${String(p + 1).padStart(12, '0')}`, actions: open.map((ask, i) => action(ready(ask.operation), `item_${i}_p${p}`)) })) });
const C3 = { SALON_SECRETARY_TEMPORAL_COMPONENTS: 'true', SALON_SECRETARY_TEMPORAL_POLARITY: 'true', SALON_SECRETARY_SAME_AS: 'true', SALON_SECRETARY_JIT_INSTRUCTIONS: 'true',
  SALON_SECRETARY_STRUCTURED_CONTEXT: 'true', SALON_SECRETARY_NAME_SUGGESTIONS: 'true', SALON_SECRETARY_CUSTOMER_OVERLAP_GUARD: 'true', SALON_SECRETARY_PERSISTED_STATE: 'true',
  SALON_SECRETARY_EXAMPLES: 'selected', SALON_SECRETARY_SCHEDULING_OVERLAP_ENABLED: 'true' };
const EVERY = { ...C3, SALON_SECRETARY_NAME_ALIASES: 'true', SALON_SECRETARY_CONFIRMATION_GROUPING: 'true', SALON_SECRETARY_DATE_RULES_V2: 'true', SALON_SECRETARY_DAYPART_RULES_V2: 'true',
  SALON_SECRETARY_DAYPART_BY_HOURS: 'true', SALON_SECRETARY_ALTER_APPOINTMENT: 'true', SALON_SECRETARY_MULTI_SERVICE: 'true', SALON_SECRETARY_EXCEPTION_RULES_V2: 'true', SALON_SECRETARY_COPY_V2: 'true',
  SALON_SECRETARY_REFERENCES_V2: 'true', SALON_SECRETARY_READS_V2: 'true', SALON_SECRETARY_RECURRENCE_GUARD: 'true', SALON_SECRETARY_EXAMPLES_V2: 'true' };
const sentence = 'Então: a Maria Eduarda Lopes não vem na quinta às quatorze, passa ela pra sexta no mesmo horário com a Nara e acrescenta a sobrancelha com henna; a Jade Moura quer gel e pezinho no sábado de manhã; ';
const messages = [['synthetic', 'Pedido sintético offline'], ['300-char', sentence.repeat(3).slice(0, 300)]] as const;

describe('review B: the realistic mix with every candidate flag on', () => {
  it('fits the cap, degrades only by the designed steps, and the Candidate 4 growth is pinned', async () => {
    vi.stubEnv('SALON_SECRETARY_STRUCTURED_CONTEXT', 'true'); vi.stubEnv('SALON_SECRETARY_JIT_INSTRUCTIONS', 'true');
    const adapter = clarificationContext({ operation: 'appointment.change', fields: {}, missing_fields: ['time'], waiting_for: 'time', message: 'Qual o novo horário?' });
    const shapes = [
      { name: 'realistic/stress', state: { name: 'realistic', skill: 'discovery' as const, context: realistic() } },
      { name: 'realistic/adapter answer', state: { name: 'realistic', skill: 'scheduling' as const, context: realistic(), fields: adapter, requirements: () => getOperationRequirements('appointment.change') } },
      { name: 'multi-action continuation', state: { name: 'multi', skill: 'discovery' as const, context: STRESS_CONTEXT, fields: continuationDraft((STRESS_CONTEXT.active_plan!.actions as { item_key: string }[])), requirements: continuationRequirements() } },
    ];
    vi.unstubAllEnvs();
    const rows: Record<string, unknown>[] = [], measured = new Map<string, CompiledRequest>();
    for (const [label, env] of [['candidate3', C3], ['every', EVERY], ['candidate3-noex', { ...C3, SALON_SECRETARY_EXAMPLES: 'off' }], ['every-noex', { ...EVERY, SALON_SECRETARY_EXAMPLES: 'off' }]] as const)
      for (const shape of shapes) for (const [text, message] of messages) {
        const request = await compileRequest(shape.state, env, salon, message);
        measured.set(`${label}|${shape.name}|${text}`, request);
        rows.push({ env: label, shape: shape.name, message: text, configured: request.configuredBytes + 8192, sent: request.bytes + 8192, margin: 64000 - request.bytes - 8192, steps: request.budget?.steps ?? [] });
        expect(request.bytes + 8192, `${label} ${shape.name} ${text}`).toBeLessThanOrEqual(64000);
        for (const step of request.budget?.steps ?? []) expect(['EXAMPLES_DROPPED', 'SUSPENDED_TRIMMED', 'STRUCTURED_CONTEXT'], `${label} ${shape.name} ${text}`).toContain(step);
      }
    console.info(JSON.stringify({ fixerRealisticBudget: rows }));
    const at = (key: string) => measured.get(key)!;
    // Every flag on: the realistic mix with a short message and the multi-action continuation fit as configured.
    expect(at('every|realistic/stress|synthetic').budget?.steps ?? []).toEqual([]);
    expect(at('every|multi-action continuation|300-char').budget?.steps ?? []).toEqual([]);
    // Non-degradable growth of Candidate 4 over Candidate 3 (examples off): today 1800 B; the fixer's compaction took 98 B off.
    const growth = at('every-noex|realistic/stress|synthetic').configuredBytes - at('candidate3-noex|realistic/stress|synthetic').configuredBytes;
    expect(growth).toBeLessThanOrEqual(1800);
    expect(growth).toBeGreaterThan(0);
  }, 600_000);
});
