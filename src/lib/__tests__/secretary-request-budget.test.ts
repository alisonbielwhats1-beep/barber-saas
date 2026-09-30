import { afterEach, describe, expect, it, vi } from 'vitest';
import { createPaidModel, runServicesTurn, withConversationRouting, withSalonDirectory, withRequestBudgetObserver, continuationDraft, continuationRequirements, routedTurnRequirements,
  decisionInstructions, fitRequest, isInterpretationFailure, jitContinuationDraft, jitRequirements, requestModelId, secretaryRequestBodyBytes, structuredContextData, trimSuspendedPlans,
  JIT_APPENDIX_HEADER, REQUEST_TOO_LARGE, SECRETARY_OUTPUT_FRAMING, SECRETARY_REQUEST_CAP, type ConversationRoutingContext, type Model, type RequestBudgetTelemetry,
  type RequestDegradation, type SecretarySkill } from '@everflair/salon-secretary';
import { compileRequest, LINT_DIRECTORY, LINT_FLAGS, LINT_STATES, STRESS_CONTEXT } from '../../test/secretary-instruction-lint';
import { clarificationContext } from '../secretary-clarification';
import { getOperationRequirements } from '../service-contract';
import { RouterTrace, type TurnOutcome } from '../secretary-router';
import { turnBaseline, turnOutcome } from '../secretary-turn-outcome';

/** Budget-aware request assembly: exact measurement, the fixed degradation order at its exact byte boundaries, the
 * content of each degraded request, the production shapes that used to exceed the cap, and codes-only telemetry.
 * Offline: every request goes to a fake transport that is never the network. */
afterEach(() => { vi.unstubAllEnvs(); vi.unstubAllGlobals(); });
const LIMIT = SECRETARY_REQUEST_CAP - SECRETARY_OUTPUT_FRAMING; // 55808 request bytes
const salon = { professionals: Array.from({ length: 8 }, (_, i) => `Profissional Sintética ${i}`), services: Array.from({ length: 24 }, (_, i) => `Serviço Sintético Completo ${i}`), today: LINT_DIRECTORY.today };
type Sent = { body?: string; payload?: { instructions: string; input: { content: string }[]; tools: { parameters: unknown }[] }; budget: RequestBudgetTelemetry[]; error?: unknown; calls: number };
/** One request through the real runServicesTurn and SDK serialization; the fake transport answers CONVERSATION. */
async function send(message: string, o: { context?: ConversationRoutingContext; fields?: unknown; requirements?: unknown; skill?: SecretarySkill | 'discovery'; env?: Record<string, string>; directory?: typeof salon } = {}): Promise<Sent> {
  vi.stubEnv('SALON_SECRETARY_V2_MAX_OUTPUT_TOKENS', '8192'); vi.stubEnv('SALON_SECRETARY_MULTI_ACTION_V2_ENABLED', 'true');
  for (const [key, value] of Object.entries({ SALON_SECRETARY_TEMPORAL_COMPONENTS: 'false', SALON_SECRETARY_JIT_INSTRUCTIONS: 'false', SALON_SECRETARY_EXAMPLES: 'off', ...o.env })) vi.stubEnv(key, value);
  const skill = o.skill ?? 'discovery', out: Sent = { budget: [], calls: 0 };
  vi.stubGlobal('fetch', vi.fn(async (_url: unknown, init?: RequestInit) => {
    out.calls++; out.body = String(init?.body);
    return new Response(JSON.stringify({ id: 'resp_offline', object: 'response', created_at: 0, status: 'completed', model: 'gpt-6-luna', output: [{ id: 'fc', call_id: 'call', type: 'function_call',
      name: skill === 'discovery' ? 'select_capabilities' : 'upsert_action_draft', arguments: JSON.stringify({ turn: { mode: 'CONVERSATION', response: 'Oi!' } }), status: 'completed' }],
      usage: { input_tokens: 1, output_tokens: 1, total_tokens: 2 } }), { status: 200, headers: { 'content-type': 'application/json' } });
  }));
  const model = await createPaidModel({ SALON_SECRETARY_ALLOW_PAID_CALLS: 'true', SALON_SECRETARY_MODEL: 'gpt-6-luna', SALON_SECRETARY_OPENAI_API_KEY: 'synthetic-offline-not-a-key', SALON_SECRETARY_OPENAI_PROJECT: 'proj_offline' });
  const fields = typeof o.fields === 'function' ? (o.fields as () => unknown)() : o.fields ?? {}, requirements = typeof o.requirements === 'function' ? (o.requirements as () => unknown)() : o.requirements ?? {};
  const turn = () => (runServicesTurn as (m: Model, msg: string, f: unknown, r: unknown, s: SecretarySkill | 'discovery', v2: boolean) => Promise<unknown>)(model, message, fields, requirements, skill, true);
  const routed = () => o.context ? withConversationRouting(turn, o.context) : turn();
  try { await withRequestBudgetObserver(entry => out.budget.push(entry), () => withSalonDirectory(o.directory ?? salon, routed)); } catch (error) { out.error = error; }
  if (out.body) out.payload = JSON.parse(out.body);
  return out;
}
const size = (sent: Sent) => Buffer.byteLength(sent.body!, 'utf8');
const contextOf = (sent: Sent) => JSON.parse(sent.payload!.input[0].content.split('\n')[0].slice('Contexto da conversa: '.length)) as ConversationRoutingContext;
const activeKeys = STRESS_CONTEXT.active_plan!.actions as { item_key: string }[];
/** The multi-action continuation of the budget tests (10 active + 50 suspended), draft and requirements built for the static prompt. */
const continuation = { context: STRESS_CONTEXT, fields: () => continuationDraft(activeKeys), requirements: () => continuationRequirements() };

describe('pure ladder (fitRequest)', () => {
  const at = (bytes: number) => ({ bytes });
  it('returns the configured request when it fits and never builds a degradation', () => {
    const degradations = vi.fn(() => []);
    expect(fitRequest(at(LIMIT), degradations, r => r.bytes)).toEqual({ request: at(LIMIT), steps: [], bytes: LIMIT, initialBytes: LIMIT });
    expect(degradations).not.toHaveBeenCalled();
  });
  it('applies the steps in the fixed order, each only while still over the cap, skipping the ones that do not apply', () => {
    const built: string[] = [];
    const levels = (sizes: number[]) => () => [
      { steps: ['EXAMPLES_DROPPED'] as RequestDegradation[], build: () => { built.push('1'); return at(sizes[0]); } },
      { steps: [] as RequestDegradation[], build: () => { built.push('skip'); return at(0); } },
      { steps: ['STRUCTURED_CONTEXT', 'JIT_APPENDIX'] as RequestDegradation[], build: () => { built.push('2'); return at(sizes[1]); } },
      { steps: ['SUSPENDED_TRIMMED'] as RequestDegradation[], build: () => { built.push('3'); return at(sizes[2]); } },
    ];
    expect(fitRequest(at(LIMIT + 1), levels([LIMIT, 1, 1]), r => r.bytes)).toMatchObject({ steps: ['EXAMPLES_DROPPED'], bytes: LIMIT, initialBytes: LIMIT + 1 });
    expect(built).toEqual(['1']); built.length = 0;
    expect(fitRequest(at(LIMIT + 9), levels([LIMIT + 1, LIMIT, 1]), r => r.bytes)).toMatchObject({ steps: ['EXAMPLES_DROPPED', 'STRUCTURED_CONTEXT', 'JIT_APPENDIX'], bytes: LIMIT });
    expect(built).toEqual(['1', '2']); built.length = 0;
    expect(fitRequest(at(LIMIT + 9), levels([LIMIT + 3, LIMIT + 2, LIMIT]), r => r.bytes)).toMatchObject({ steps: ['EXAMPLES_DROPPED', 'STRUCTURED_CONTEXT', 'JIT_APPENDIX', 'SUSPENDED_TRIMMED'], bytes: LIMIT });
    const refused = fitRequest(at(LIMIT + 9), levels([LIMIT + 3, LIMIT + 2, LIMIT + 1]), r => r.bytes);
    expect(refused.request).toBeUndefined(); expect(refused).toMatchObject({ steps: ['EXAMPLES_DROPPED', 'STRUCTURED_CONTEXT', 'JIT_APPENDIX', 'SUSPENDED_TRIMMED'], bytes: LIMIT + 1, initialBytes: LIMIT + 9 });
    expect(built).not.toContain('skip');
  });
});

describe('degradation helpers', () => {
  it('the structured conversion of a built prose context equals what the flag publishes, in the same key order', () => {
    const inputs = [
      { operation: 'appointment.change', fields: { customer_name: 'Pessoa' }, missing_fields: ['time'], message: 'Qual o novo horário da Pessoa?' },
      { operation: 'appointment.create', fields: {}, missing_fields: ['date', 'time'], message: 'Para qual dia e horário?' },
      { operation: 'appointment.cancel', fields: {}, message: 'CANCELAR\nPessoa\nqua, 30/09 às 16h' },
      { operation: 'customer.change', fields: {}, missing_fields: ['customer_ref'], message: 'Qual Pessoa?', waiting_for: 'customer_ref', selection: { field: 'customer_ref', labels: ['Pessoa Um', 'Pessoa Dois'] }, repeat_count: 2 },
      { operation: 'appointment.change', fields: {}, message: 'Manhã ou tarde?', waiting_for: 'time', pending_temporal_ambiguities: [{ field: 'time', kind: 'CLOCK_DAYPART', expression: 'as 4', candidates: ['04:00', '16:00'] }] },
      { operation: 'schedule.block', fields: {}, message: 'Terça ou dia 14?', pending_calendar_conflicts: [{ field: 'date', kind: 'WEEKDAY_DATE_CONFLICT', expression: 'terça 14', calendar_date: '2027-04-14', stated_weekday: 2, actual_weekday: 3 }],
        pending_temporal_ambiguities: [{ field: 'time', kind: 'CLOCK_DAYPART', expression: 'as 4', candidates: ['04:00', '16:00'] }] },
    ] as Parameters<typeof clarificationContext>[0][];
    for (const input of inputs) {
      vi.stubEnv('SALON_SECRETARY_STRUCTURED_CONTEXT', 'false'); const prose = clarificationContext(input);
      vi.stubEnv('SALON_SECRETARY_STRUCTURED_CONTEXT', 'true'); const flagged = clarificationContext(input);
      expect(JSON.stringify(structuredContextData(prose))).toBe(JSON.stringify(flagged));
      expect(structuredContextData(flagged)).toBe(flagged); // already structured: unchanged, same object
    }
  });
  it('suspended plans keep only what routing reads; the JIT draft and requirements equal what the JIT flag builds', () => {
    const trimmed = trimSuspendedPlans(STRESS_CONTEXT);
    expect(trimmed.active_plan).toBe(STRESS_CONTEXT.active_plan);
    expect(trimmed.suspended_plans!.map(plan => plan.plan_ref)).toEqual(STRESS_CONTEXT.suspended_plans!.map(plan => plan.plan_ref));
    expect(trimmed.suspended_plans!.flatMap(plan => plan.actions.map(action => Object.keys(action as object)))).toEqual(Array(50).fill(['item_key', 'operation', 'status']));
    const staticDraft = continuationDraft(activeKeys), staticContinuation = continuationRequirements(), staticRouted = routedTurnRequirements();
    vi.stubEnv('SALON_SECRETARY_JIT_INSTRUCTIONS', 'true');
    expect(jitContinuationDraft(staticDraft)).toEqual(continuationDraft(activeKeys));
    expect(jitRequirements(staticContinuation)).toEqual(continuationRequirements()); expect(jitRequirements(staticRouted)).toEqual(routedTurnRequirements());
    const adapter = getOperationRequirements('appointment.change');
    expect(jitRequirements(adapter)).toBe(adapter); expect(jitContinuationDraft({ operation: 'x' })).toEqual({ operation: 'x' });
  });
});

describe('exact measurement', () => {
  it('equals the real SDK body byte for byte in every compiled state and flag set; the model id is read from the provider model', async () => {
    let checked = 0;
    for (const env of LINT_FLAGS) for (const state of LINT_STATES) {
      const request = await compileRequest(state, env, LINT_DIRECTORY);
      expect(secretaryRequestBodyBytes({ modelId: 'gpt-6-luna', instructions: request.instructions, messages: [{ role: 'system', content: request.system }, { role: 'user', content: request.draft },
        { role: 'user', content: 'Pedido sintético offline' }], parameters: request.wire, toolName: state.skill === 'discovery' ? 'select_capabilities' : 'upsert_action_draft',
      toolDescription: 'U03: entrega interpretação explícita ao backend; nunca executa. null omite e preserva.', maxTokens: 8192 }), `${state.name} ${JSON.stringify(env)}`).toBe(request.bytes);
      // Under the cap the request is sent exactly as configured: no step, no telemetry.
      expect(request.budget, state.name).toBeUndefined(); expect(request.configuredBytes).toBe(request.bytes);
      checked++;
    }
    expect(checked).toBe(LINT_FLAGS.length * LINT_STATES.length);
    const model = await createPaidModel({ SALON_SECRETARY_ALLOW_PAID_CALLS: 'true', SALON_SECRETARY_MODEL: 'gpt-6-luna', SALON_SECRETARY_OPENAI_API_KEY: 'synthetic-offline-not-a-key', SALON_SECRETARY_OPENAI_PROJECT: 'proj_offline' });
    expect(requestModelId(model)).toBe('gpt-6-luna');
    expect(requestModelId({} as Model)).toBe('gpt-5.6-luna'); // unknown: the longest allowed id (never under-measures)
  }, 120_000);
});

describe('each step triggers at its exact byte boundary (multi-action continuation, default configuration)', () => {
  it('fits as configured up to 55808 bytes; then structured context + JIT; then trimmed suspended plans; then refused before transport', async () => {
    const probe = await send('x', continuation);
    expect(probe.budget).toHaveLength(1); expect(probe.budget[0]).toMatchObject({ fit: true, steps: ['STRUCTURED_CONTEXT', 'JIT_APPENDIX'] });
    const [l0, l2] = [probe.budget[0].initial_bytes, probe.budget[0].final_bytes];
    expect(l0).toBeGreaterThan(LIMIT); expect(size(probe)).toBe(l2);
    // The message is sent once, as is: every added ASCII byte adds one request byte to every level.
    const padded = (bytes: number) => 'x' + 'y'.repeat(bytes);
    const fitsTo = (level: number, target: number) => padded(target - level);
    // Level 0 never reaches the cap here (it is already over with one byte); the lint states check the no-degradation path.
    const atL2 = await send(fitsTo(l2, LIMIT), continuation);
    expect(atL2.budget[0]).toMatchObject({ fit: true, steps: ['STRUCTURED_CONTEXT', 'JIT_APPENDIX'], final_bytes: LIMIT }); expect(size(atL2)).toBe(LIMIT);
    const overL2 = await send(fitsTo(l2, LIMIT + 1), continuation);
    expect(overL2.budget[0]).toMatchObject({ fit: true, steps: ['STRUCTURED_CONTEXT', 'JIT_APPENDIX', 'SUSPENDED_TRIMMED'] });
    const l3 = overL2.budget[0].final_bytes - (LIMIT + 1 - l2);
    expect(l3).toBeLessThan(l2);
    const atL3 = await send(fitsTo(l3, LIMIT), continuation);
    expect(atL3.budget[0]).toMatchObject({ fit: true, steps: ['STRUCTURED_CONTEXT', 'JIT_APPENDIX', 'SUSPENDED_TRIMMED'], final_bytes: LIMIT }); expect(size(atL3)).toBe(LIMIT);
    const refused = await send(fitsTo(l3, LIMIT + 1), continuation);
    expect(refused.calls).toBe(0); expect(refused.body).toBeUndefined();
    expect((refused.error as Error).message).toBe(REQUEST_TOO_LARGE); expect(isInterpretationFailure(refused.error)).toBe(true);
    expect(refused.budget).toEqual([{ steps: ['STRUCTURED_CONTEXT', 'JIT_APPENDIX', 'SUSPENDED_TRIMMED'], fit: false, initial_bytes: l0 + LIMIT + 1 - l3, final_bytes: LIMIT + 1 }]);
  }, 120_000);
  it('a request exactly at the cap is sent as configured (no step, no telemetry); one byte more starts degrading', async () => {
    const state = { context: STRESS_CONTEXT }; // the stress shape fits as configured
    const probe = await send('x', state);
    expect(probe.budget).toEqual([]);
    const at = await send('x' + 'y'.repeat(LIMIT - size(probe)), state);
    expect(at.budget).toEqual([]); expect(size(at)).toBe(LIMIT);
    const over = await send('x' + 'y'.repeat(LIMIT - size(probe) + 1), state);
    expect(over.budget[0]).toMatchObject({ fit: true, steps: ['STRUCTURED_CONTEXT', 'JIT_APPENDIX'], initial_bytes: LIMIT + 1 });
  }, 60_000);
  it('with examples configured, dropping the block is always the first step', async () => {
    for (const mode of ['selected', 'full']) {
      const sent = await send('x', { ...continuation, env: { SALON_SECRETARY_EXAMPLES: mode } });
      expect(sent.budget[0].steps).toEqual(['EXAMPLES_DROPPED', 'STRUCTURED_CONTEXT', 'JIT_APPENDIX']);
      expect(sent.body).not.toContain('Exemplos de interpretação');
    }
  }, 60_000);
});

describe('what each degraded request carries', () => {
  it('structured + JIT: the JIT prompt, wire and draft of the same state; suspended plans still whole; decoding context unchanged', async () => {
    const degraded = await send('x', continuation);
    vi.unstubAllEnvs(); vi.stubEnv('SALON_SECRETARY_JIT_INSTRUCTIONS', 'true');
    const jitDraft = continuationDraft(activeKeys);
    vi.unstubAllEnvs();
    const flagged = await send('x', { context: STRESS_CONTEXT, fields: jitDraft, requirements: {}, env: { SALON_SECRETARY_JIT_INSTRUCTIONS: 'true' } });
    expect(flagged.budget).toEqual([]); // with the flag, the same state fits as configured
    expect(degraded.payload!.instructions).toBe(decisionInstructions(false, true)); expect(degraded.payload!.instructions).toBe(flagged.payload!.instructions);
    expect(JSON.stringify(degraded.payload!.tools[0].parameters)).toBe(JSON.stringify(flagged.payload!.tools[0].parameters));
    expect(degraded.payload!.input[1].content).toBe(flagged.payload!.input[1].content); // {mode, item_keys}
    const system = degraded.payload!.input[0].content;
    expect(system).toContain(JIT_APPENDIX_HEADER); expect(system).not.toContain('Este é um turno sobre o plano existente');
    const shown = contextOf(degraded);
    const clarifications = [...shown.active_plan!.actions, ...shown.suspended_plans!.flatMap(plan => plan.actions)].map(action => (action as { clarification: { previous_response: string } }).clarification);
    expect(clarifications.every(c => c.previous_response === '')).toBe(true); // nothing asked: the structured sentence is empty
    expect(shown.suspended_plans!.every(plan => plan.actions.every(action => 'fields' in (action as object)))).toBe(true);
  }, 60_000);
  it('trimmed: suspended plans keep plan_ref, item_key, operation and status; the RESUME wire is unchanged', async () => {
    const l2 = await send('x', continuation), trimmed = await send('x' + 'y'.repeat(LIMIT - size(l2) + 1), continuation);
    expect(trimmed.budget[0].steps).toContain('SUSPENDED_TRIMMED');
    const shown = contextOf(trimmed);
    expect(shown.suspended_plans).toEqual(trimSuspendedPlans(STRESS_CONTEXT).suspended_plans);
    expect(JSON.stringify(trimmed.payload!.tools[0].parameters)).toBe(JSON.stringify(l2.payload!.tools[0].parameters));
    expect(JSON.stringify(trimmed.payload!.tools[0].parameters)).toContain(STRESS_CONTEXT.suspended_plans![0].plan_ref);
  }, 60_000);
});

// Production-shaped mixes that exceeded the cap with the default configuration (B7 measurements).
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
const mix = (active: (i: number) => Ask, suspended: (i: number) => Ask): ConversationRoutingContext => ({ active_plan: { plan_ref: PLAN, actions: open.map((_, i) => action(active(i), `item_${i}`)) },
  suspended_plans: Array.from({ length: 5 }, (_, p) => ({ plan_ref: `20000000-0000-4000-8000-${String(p + 1).padStart(12, '0')}`, actions: open.map((_, i) => action(suspended(i), `item_${i}_p${p}`)) })) });

describe('the shapes that used to exceed the cap now fit (or would fail clearly)', () => {
  it.each([false, true])('components=%s: realistic mix, every-question mix and the multi-action continuation, every flag set', async components => {
    const rows: Record<string, unknown>[] = [];
    const mixes = { realistic: () => mix(i => open[i], i => ready(open[i].operation)), everyAsks: () => mix(i => open[i], i => open[i]) };
    for (const jit of [false, true]) for (const structured of [false, true]) {
      const env = { SALON_SECRETARY_TEMPORAL_COMPONENTS: String(components), SALON_SECRETARY_JIT_INSTRUCTIONS: String(jit), SALON_SECRETARY_STRUCTURED_CONTEXT: String(structured) };
      vi.stubEnv('SALON_SECRETARY_STRUCTURED_CONTEXT', String(structured)); vi.stubEnv('SALON_SECRETARY_JIT_INSTRUCTIONS', String(jit));
      const shapes = [
        ...Object.entries(mixes).flatMap(([name, build]) => [{ name: `${name}/stress`, state: { name, skill: 'discovery' as const, context: build() } },
          { name: `${name}/adapter answer`, state: { name, skill: 'scheduling' as const, context: build(), fields: clarificationContext({ operation: 'appointment.change', fields: {}, missing_fields: ['time'], waiting_for: 'time', message: 'Qual o novo horário?' }),
            requirements: () => getOperationRequirements('appointment.change') } }]),
        { name: 'multi-action continuation', state: { name: 'multi', skill: 'discovery' as const, context: STRESS_CONTEXT, fields: continuationDraft(activeKeys), requirements: continuationRequirements() } },
      ];
      vi.unstubAllEnvs();
      for (const shape of shapes) {
        let row: Record<string, unknown>;
        try {
          const request = await compileRequest(shape.state, env, salon);
          row = { configured: request.configuredBytes + 8192, sent: request.bytes + 8192, steps: request.budget?.steps ?? [] };
          expect(request.bytes + 8192, shape.name).toBeLessThanOrEqual(64000);
        } catch (error) {
          // Refused before transport: the only other allowed outcome (never a request over the cap).
          expect((error as Error).message, shape.name).toMatch(/^LINT_REQUEST_TOO_LARGE:/); row = { refused: true };
        }
        rows.push({ components, jit, structured, shape: shape.name, ...row });
      }
    }
    console.info(JSON.stringify({ requestBudgetShapes: rows }));
    // The two families the budget tests held at their measured size (65431/66042 and up to 74220) are now sent under the cap.
    for (const name of ['realistic/stress', 'realistic/adapter answer', 'multi-action continuation'])
      expect(rows.filter(row => row.shape === name).every(row => !row.refused && (row.sent as number) <= 64000), name).toBe(true);
  }, 180_000);
});

describe('telemetry (codes and byte counts only)', () => {
  it('sums a message\'s degraded requests into the turn outcome; the router row keeps closed codes only', () => {
    const trace = new RouterTrace();
    trace.requestBudget({ steps: ['STRUCTURED_CONTEXT', 'JIT_APPENDIX'], fit: true, initial_bytes: 65000, final_bytes: 52000 });
    trace.requestBudget({ steps: ['STRUCTURED_CONTEXT', 'JIT_APPENDIX', 'SUSPENDED_TRIMMED', 'Ana pediu' as never], fit: false, initial_bytes: 80000, final_bytes: 57000 });
    expect(trace.requestTooLarge).toBe(true);
    const session = { id: 'session', skill: 'auto', capability_status: 'CONVERSATION' };
    const { outcome } = turnOutcome(session, turnBaseline(session, () => undefined), trace, { view: { message: 'Oi' } as never }, { salt: () => 'salt', previous: [] });
    expect(outcome.request_budget).toEqual({ requests: 2, rejected: 1, steps: ['STRUCTURED_CONTEXT', 'JIT_APPENDIX', 'SUSPENDED_TRIMMED'], initial_bytes: 80000, final_bytes: 57000 });
    trace.outcome = { ...outcome, request_budget: { ...outcome.request_budget!, steps: ['STRUCTURED_CONTEXT', 'marca a Ana' as never] } } as TurnOutcome;
    expect(trace.snapshot().outcome?.request_budget).toEqual({ requests: 2, rejected: 1, steps: ['STRUCTURED_CONTEXT'], initial_bytes: 80000, final_bytes: 57000 });
    expect(JSON.stringify(trace.snapshot())).not.toMatch(/Ana/);
    const quiet = new RouterTrace();
    expect(turnOutcome(session, turnBaseline(session, () => undefined), quiet, { view: { message: 'Oi' } as never }, { salt: () => 'salt', previous: [] }).outcome).not.toHaveProperty('request_budget');
    expect(quiet.requestTooLarge).toBe(false);
  });
});
