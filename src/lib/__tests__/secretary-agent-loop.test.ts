import { afterEach, describe, expect, it, vi } from 'vitest';
import { assertSecretaryResponsesPayload, type Model, type ModelRequest } from '@everflair/salon-secretary';
import { AGENT_DEPENDENCY_FLAGS, AGENT_LIMITS, messageCallBudget, withAgentMessage, type AgentMessageContext } from '../../../packages/salon-secretary/src/agent-context';
import { AGENT_LOOP_LIMITS, AGENT_SAFE_REPLY, agentFallbackRoute, agentRequestBody, agentRequestBodyBytes, agentRoundRequest, runAgentTurn,
  type AgentLoopOutcome } from '../../../packages/salon-secretary/src/agent-loop';
import { AGENT_FRAMING, AGENT_PROMPT } from '../../../packages/salon-secretary/src/agent-prompt';
import { AGENT_TOOL_NAMES, agentLookupError } from '../../../packages/salon-secretary/src/agent-tools';
import { agentItemKinds, agentSdkModel, createAgentFakeModel, createFakeAgentExecutor, fakeCall, fakeCommentary, fakePlanCall, fakeReasoning, httpCall, httpCommentary,
  httpReasoning, readPlan, responsesJson, talkPlan, FAKE_DIRECTORY, type AgentFakeModel, type AgentFakeRound, type FakeExecutorOptions } from '../../test/secretary-agent-fake-model';

/** C5 agent loop (flag SALON_SECRETARY_AGENT, default off; docs/c5-spike/11-especificacao-agente.md §3, §8.1 "Laço"). Offline: a
 * scripted multi-call fake model (every request checked by the cost guard's SDK-boundary function), a fake lookup executor, and for
 * the wire the real SDK Responses model behind the {agent:true} guarded fetch over a stubbed global fetch. No network, database or
 * real model. Synthetic salon and messages only. */
const MODEL = 'gpt-6-luna', OWNER = ['Mensagem sintética do laço, sem pedido real.'];
const INCLUDE = ['reasoning.encrypted_content'];
function enable(extra: Record<string, string | undefined> = {}) {
  vi.stubEnv('SALON_SECRETARY_AGENT', 'true');
  for (const flag of AGENT_DEPENDENCY_FLAGS) vi.stubEnv(flag, 'true');
  vi.stubEnv('SALON_SECRETARY_AGENT_EFFORT', undefined);
  for (const [name, value] of Object.entries(extra)) vi.stubEnv(name, value);
}
afterEach(() => { vi.unstubAllEnvs(); vi.unstubAllGlobals(); vi.useRealTimers(); });

const agenda = (callId: string, data = '2031-05-06') => fakeCall('consultar_agenda', { data, profissional: null, de: null, ate: null }, callId);
const catalog = (callId: string) => fakeCall('catalogo_servicos', { servicos: ['s1'] }, callId);
const shift = (callId: string) => fakeCall('jornada_profissional', { profissional: 'p2', data: null }, callId);
type Run = { outcome: AgentLoopOutcome; fake: AgentFakeModel; executor: ReturnType<typeof createFakeAgentExecutor>; context: AgentMessageContext; inside: { allows1: boolean; allows2: boolean } };
type RunOptions = { readonly owner?: readonly string[]; readonly executor?: FakeExecutorOptions; readonly noExecutor?: boolean; readonly wrap?: (fake: AgentFakeModel) => Model; readonly budgetMs?: number };
async function run(rounds: AgentFakeRound[], options: RunOptions = {}): Promise<Run> {
  const fake = createAgentFakeModel(rounds), executor = createFakeAgentExecutor(options.executor);
  let context!: AgentMessageContext;
  const inside = { allows1: false, allows2: false };
  const outcome = await withAgentMessage({ owner: options.owner ?? OWNER, executor: options.noExecutor ? undefined : executor, budgetMs: options.budgetMs }, async current => {
    context = current;
    const result = await runAgentTurn(options.wrap?.(fake) ?? fake, { modelId: MODEL });
    // What the C4's bounded model reads before its first call and before its repair (§3.8).
    inside.allows1 = messageCallBudget()!.allows(1); inside.allows2 = messageCallBudget()!.allows(2);
    return result;
  });
  return { outcome, fake, executor, context, inside };
}
const kinds = (request: ModelRequest) => agentItemKinds(request.input);
const inputOf = (request: ModelRequest) => request.input as unknown as Record<string, unknown>[];
const planCalls = (request: ModelRequest) => inputOf(request).filter(item => item.type === 'function_call' && item.name === 'propor_plano');
const BLOCK_1 = ['reasoning', 'commentary', 'function_call', 'function_call', 'function_call_result', 'function_call_result'] as const;

describe('agent loop: 1, 2 and 3 calls (§3.2)', () => {
  it('a plan alone in round 1 ends the message with one call; nothing is executed', async () => {
    enable();
    const { outcome, fake, executor, context } = await run([{ output: [fakeReasoning('rs1'), fakePlanCall(talkPlan(), 'k1')],
      expect: { tool_choice: 'required', parallel: true, items_after_messages: [], include: INCLUDE, effort: 'medium', max_output: AGENT_LIMITS.maxOutputTokens } }]);
    expect(fake.mismatches).toEqual([]);
    expect(outcome).toMatchObject({ kind: 'PLAN', plan: { resultado: 'CONVERSA' }, telemetry: { path: 'AGENT', calls: 1, lookup_rounds: 0, forced: null, fallback_code: null, effort: 'medium' } });
    expect(context.calls.used()).toBe(1); expect(executor.rounds).toEqual([]);
    expect(fake.requests[0].systemInstructions).toBe(AGENT_PROMPT);
    expect(fake.requests[0].tools.map(tool => (tool as { name: string }).name)).toEqual([...AGENT_TOOL_NAMES]);
  });
  it('lookups then the plan: round 2 carries round 1 unchanged and in order, then one output per call, paired by call id', async () => {
    enable();
    const first = [fakeReasoning('rs1'), fakeCommentary('m1', 'Olhando a agenda do dia.'), agenda('c1'), catalog('c2')];
    const { outcome, fake, executor } = await run([
      { output: first, expect: { tool_choice: 'required', parallel: true, items_after_messages: [] } },
      { output: [fakeReasoning('rs2'), fakePlanCall(readPlan(), 'c3')], expect: { tool_choice: 'required', parallel: true, items_after_messages: [...BLOCK_1], include: INCLUDE, max_output: 8192 } },
    ]);
    expect(fake.mismatches).toEqual([]);
    expect(outcome).toMatchObject({ kind: 'PLAN', plan: { resultado: 'PLANO', acoes: [{ chave: 'leitura' }] }, telemetry: { calls: 2, lookup_rounds: 1, lookup_calls: 2, commentary: 1 } });
    expect(executor.rounds.map(round => round.calls.map(call => [call.name, call.callId]))).toEqual([[['consultar_agenda', 'c1'], ['catalogo_servicos', 'c2']]]);
    const second = inputOf(fake.requests[1]), at = second.length - 6;
    expect(second.slice(at, at + 4)).toEqual(first);
    expect(second.slice(at + 4).map(item => [item.type, item.callId, item.name, item.status])).toEqual([['function_call_result', 'c1', 'consultar_agenda', 'completed'],
      ['function_call_result', 'c2', 'catalogo_servicos', 'completed']]);
    expect(second.slice(at + 4).map(item => item.output)).toEqual([JSON.stringify({ consulta: 'consultar_agenda', rodada: 1 }), JSON.stringify({ consulta: 'catalogo_servicos', rodada: 1 })]);
    // The commentary goes back to the model, never to the owner.
    expect(JSON.stringify(outcome)).not.toContain('Olhando a agenda');
    expect(fake.requests.flatMap(planCalls)).toEqual([]);
  });
  it('two lookup rounds, then the 3rd call is forced into propor_plano without parallel calls; 8192 output tokens in every round', async () => {
    enable();
    const { outcome, fake, executor } = await run([
      { output: [fakeReasoning('rs1'), agenda('c1')] },
      { output: [fakeReasoning('rs2'), shift('c2'), catalog('c3')], expect: { tool_choice: 'required', parallel: true, items_after_messages: ['reasoning', 'function_call', 'function_call_result'] } },
      { output: [fakeReasoning('rs3'), fakePlanCall(talkPlan(), 'c4')], expect: { tool_choice: 'propor_plano', parallel: false,
        items_after_messages: ['reasoning', 'function_call', 'function_call_result', 'reasoning', 'function_call', 'function_call', 'function_call_result', 'function_call_result'] } },
    ]);
    expect(fake.mismatches).toEqual([]);
    expect(outcome).toMatchObject({ kind: 'PLAN', telemetry: { calls: 3, lookup_rounds: 2, lookup_calls: 3, forced: 'ROUND' } });
    expect(fake.requests.map(request => request.modelSettings.maxTokens)).toEqual([8192, 8192, 8192]);
    expect(fake.requests.map(request => request.modelSettings.reasoning)).toEqual([{ effort: 'medium' }, { effort: 'medium' }, { effort: 'medium' }]);
    expect(fake.requests.map(request => (request.modelSettings.providerData as { include: unknown }).include)).toEqual([INCLUDE, INCLUDE, INCLUDE]);
    expect(executor.rounds.map(round => round.calls.length)).toEqual([1, 2]);
    expect(fake.requests.flatMap(planCalls)).toEqual([]);
  });
  it('the effort is one value per message, the same in every round (SALON_SECRETARY_AGENT_EFFORT=high)', async () => {
    enable({ SALON_SECRETARY_AGENT_EFFORT: 'high' });
    const { outcome, fake } = await run([{ output: [agenda('c1')], expect: { effort: 'high' } }, { output: [fakePlanCall(talkPlan(), 'c2')], expect: { effort: 'high' } }]);
    expect(fake.mismatches).toEqual([]); expect(outcome).toMatchObject({ kind: 'PLAN', telemetry: { effort: 'high' } });
  });
  it('a lookup in the forced 3rd round is AGENT_PROTOCOL: no 4th call, the counter is spent and the owner gets the safe reply', async () => {
    enable();
    const { outcome, fake, context, inside } = await run([{ output: [agenda('c1')] }, { output: [catalog('c2')] }, { output: [shift('c3')] }]);
    expect(outcome).toMatchObject({ kind: 'SAFE_REPLY', reply: AGENT_SAFE_REPLY, code: 'AGENT_PROTOCOL', telemetry: { path: 'AGENT', calls: 3, protocol: 'FORCED_LOOKUP' } });
    expect(fake.requests).toHaveLength(3);
    expect(inside).toEqual({ allows1: false, allows2: false });
    expect(() => context.calls.take()).toThrow('MODEL_CALL_LIMIT');
    expect(agentFallbackRoute(context)).toEqual({ kind: 'SAFE_REPLY' });
    expect(messageCallBudget()).toBeUndefined();
  });
});

describe('agent loop: protocol failures of a round (§3.2) — nothing of the round is executed', () => {
  const five = ['c1', 'c2', 'c3', 'c4', 'c5'].map(id => agenda(id));
  it.each([
    ['MIXED', [fakePlanCall(talkPlan(), 'c1'), agenda('c2')]],
    ['TOO_MANY_LOOKUPS', five],
    ['UNKNOWN_TOOL', [fakeCall('marcar_direto', {}, 'c1')]],
    ['FINAL_ANSWER', [fakeCommentary('m1', 'Pronto.', 'final_answer'), fakePlanCall(talkPlan(), 'c1')]],
    ['FINAL_ANSWER', [fakeCommentary('m1', 'Sem fase.', null), fakePlanCall(talkPlan(), 'c1')]],
    ['NO_CALL', [fakeReasoning('rs1'), fakeCommentary('m1', 'Só texto.')]],
    ['COMMENTARY', [fakeCommentary('m1', 'Um.'), fakeCommentary('m2', 'Dois.'), agenda('c1')]],
    ['COMMENTARY', [fakeCommentary('m1', '9'.repeat(AGENT_LIMITS.commentaryBytes + 1)), agenda('c1')]],
    ['REASONING', [fakeReasoning('rs1', null), agenda('c1')]],
    ['ARGUMENTS', [fakeCall('consultar_agenda', { data: 'amanhã', profissional: null, de: null, ate: null }, 'c1')]],
    ['ARGUMENTS', [fakeCall('buscar_cliente', '{"nome":', 'c1')]],
    ['CALL_ID', [agenda('c1'), catalog('c1')]],
    ['PLAN_COUNT', [fakePlanCall(talkPlan(), 'c1'), fakePlanCall(talkPlan(), 'c2')]],
  ] as const)('%s → AGENT_PROTOCOL after one call; the C4 answers with its repair', async (detail, output) => {
    enable();
    const { outcome, executor, fake } = await run([{ output: [...output] }]);
    expect(outcome).toMatchObject({ kind: 'C4', repair: true, code: 'AGENT_PROTOCOL', telemetry: { path: 'C4_FALLBACK', calls: 1, protocol: detail } });
    expect(executor.rounds).toEqual([]); expect(fake.requests).toHaveLength(1);
  });
  it('a status other than completed (returned) and an incomplete response (thrown like the SDK) are AGENT_PROTOCOL; transport is AGENT_TRANSPORT', async () => {
    enable();
    expect((await run([{ output: [fakePlanCall(talkPlan(), 'c1')], providerStatus: 'in_progress' }])).outcome).toMatchObject({ code: 'AGENT_PROTOCOL', telemetry: { protocol: 'STATUS' } });
    expect((await run([{ output: [fakePlanCall(talkPlan(), 'c1')], status: 'incomplete' }])).outcome).toMatchObject({ kind: 'C4', repair: true, code: 'AGENT_PROTOCOL' });
    expect((await run([{ output: [], fail: 'TRANSPORT' }])).outcome).toMatchObject({ kind: 'C4', repair: true, code: 'AGENT_TRANSPORT', telemetry: { calls: 1 } });
  });
  it('a plan outside the §4 rules is AGENT_SCHEMA (codes and paths only, never the model text)', async () => {
    enable();
    const empty = { resultado: 'PLANO', resposta: null, acoes: [], acoes_fora: 0, pergunta: null };
    const { outcome } = await run([{ output: [fakePlanCall(empty, 'c1')] }]);
    expect(outcome).toMatchObject({ kind: 'C4', repair: true, code: 'AGENT_SCHEMA', telemetry: { schema: ['PLAN_EMPTY'] } });
    const leaked = await run([{ output: [fakePlanCall({ ...talkPlan(), extra: 'texto do modelo' }, 'c1')] }]);
    expect(leaked.outcome).toMatchObject({ code: 'AGENT_SCHEMA' }); expect(JSON.stringify(leaked.outcome)).not.toContain('texto do modelo');
  });
});

describe('agent loop: budget of calls and time, fallback to the C4 (§3.5, §3.8)', () => {
  it.each([
    ['flag off', {}, 'AGENT_DISABLED', (): void => { vi.stubEnv('SALON_SECRETARY_AGENT', undefined); }],
    ['a dependency off', {}, 'AGENT_FLAGS_INCOMPLETE', (): void => { vi.stubEnv(AGENT_DEPENDENCY_FLAGS[4], 'false'); }],
    ['an effort outside medium/high', {}, 'AGENT_EFFORT_INVALID', (): void => { vi.stubEnv('SALON_SECRETARY_AGENT_EFFORT', 'low'); }],
    ['a truncated directory', { executor: { directory: 'AGENT_DIRECTORY_TRUNCATED' } }, 'AGENT_DIRECTORY_TRUNCATED', (): void => {}],
    ['an unreachable directory', { executor: { directory: 'AGENT_UNAVAILABLE' } }, 'AGENT_UNAVAILABLE', (): void => {}],
    ['no executor', { noExecutor: true }, 'AGENT_UNAVAILABLE', (): void => {}],
    ['a first round over the byte cap', { owner: ['7'.repeat(60_000)] }, 'AGENT_BUDGET', (): void => {}],
  ] as const)('%s: the whole C4 (C4_SKIPPED, repair allowed), no agent call', async (_name, options, code, tweak) => {
    enable(); tweak();
    const { outcome, fake, inside } = await run([{ output: [fakePlanCall(talkPlan(), 'c1')] }], options);
    expect(outcome).toMatchObject({ kind: 'C4', repair: true, code, telemetry: { path: 'C4_SKIPPED', calls: 0 } });
    expect(fake.requests).toEqual([]); expect(inside).toEqual({ allows1: true, allows2: true });
  });
  it('a failure after 1 call: the C4 with its repair (2 calls left); after 2 calls: the C4 without repair (1 left)', async () => {
    enable();
    const one = await run([{ output: [], fail: 'TRANSPORT' }]);
    expect(one.outcome).toMatchObject({ kind: 'C4', repair: true, telemetry: { calls: 1 } }); expect(one.inside).toEqual({ allows1: true, allows2: true });
    const two = await run([{ output: [agenda('c1')] }, { output: [], fail: 'TRANSPORT' }]);
    expect(two.outcome).toMatchObject({ kind: 'C4', repair: false, code: 'AGENT_TRANSPORT', telemetry: { path: 'C4_FALLBACK', calls: 2 } });
    expect(two.inside).toEqual({ allows1: true, allows2: false });
  });
  it('two INDISPONIVEL in the message abort the agent; one does not; an executor that throws is AGENT_UNAVAILABLE', async () => {
    enable();
    const down = agentLookupError('INDISPONIVEL');
    expect((await run([{ output: [agenda('c1'), catalog('c2')] }], { executor: { answer: () => down } })).outcome).toMatchObject({ kind: 'C4', repair: true, code: 'AGENT_UNAVAILABLE' });
    const once = await run([{ output: [agenda('c1'), catalog('c2')] }, { output: [fakePlanCall(talkPlan(), 'c3')] }], { executor: { answer: call => call.name === 'consultar_agenda' ? down : '{}' } });
    expect(once.outcome.kind).toBe('PLAN');
    expect((await run([{ output: [agenda('c1')] }], { executor: { throws: true } })).outcome).toMatchObject({ code: 'AGENT_UNAVAILABLE', telemetry: { calls: 1 } });
  });
  it('fake clock: a call that never answers ends at its 15 s limit, and a C4 waiting on the message signal never passes 45 s in total', async () => {
    enable(); vi.useFakeTimers({ now: 0 });
    const fake = createAgentFakeModel([{ output: [], fail: 'HANG' }]), executor = createFakeAgentExecutor();
    const pending = withAgentMessage({ owner: OWNER, executor }, async context => {
      const outcome = await runAgentTurn(fake, { modelId: MODEL }), agentMs = Date.now();
      // Stand-in for the C4 fallback: it receives the message signal (runServicesTurn's signal, §3.5) and nothing else bounds it here.
      const c4Ms = await new Promise<number>(resolve => context.signal.addEventListener('abort', () => resolve(Date.now()), { once: true }));
      return { outcome, agentMs, c4Ms, reason: (context.signal.reason as Error).message };
    });
    await vi.advanceTimersByTimeAsync(AGENT_LIMITS.messageMs);
    const result = await pending;
    expect(result.outcome).toMatchObject({ kind: 'C4', repair: true, code: 'AGENT_DEADLINE', telemetry: { calls: 1 } });
    expect(result.agentMs).toBe(AGENT_LIMITS.lookupCallMs); expect(result.c4Ms).toBe(AGENT_LIMITS.messageMs); expect(result.reason).toBe('AGENT_MESSAGE_DEADLINE');
  });
  it('fake clock: without time for one more lookup round the plan is forced now, within min(25 s, remaining − 2 s)', async () => {
    enable(); vi.useFakeTimers({ now: 0 });
    const fake = createAgentFakeModel([{ output: [agenda('c1')], waitMs: 5_000 }, { output: [fakePlanCall(talkPlan(), 'c2')], expect: { tool_choice: 'propor_plano', parallel: false } }]);
    const pending = withAgentMessage({ owner: OWNER, executor: createFakeAgentExecutor(), budgetMs: 30_000 }, () => runAgentTurn(fake, { modelId: MODEL }));
    await vi.advanceTimersByTimeAsync(30_000);
    expect(await pending).toMatchObject({ kind: 'PLAN', telemetry: { calls: 2, forced: 'TIME' } });
    expect(fake.mismatches).toEqual([]);
  });
  it('under 15 s left after a failure: the safe reply, no C4 call', async () => {
    enable();
    const { outcome, fake } = await run([{ output: [], status: 'incomplete', expect: { tool_choice: 'propor_plano' } }], { budgetMs: 14_000 });
    expect(outcome).toMatchObject({ kind: 'SAFE_REPLY', reply: AGENT_SAFE_REPLY, code: 'AGENT_PROTOCOL', telemetry: { calls: 1, forced: 'TIME' } });
    expect(fake.mismatches).toEqual([]);
  });
});

describe('agent loop: byte budget and ordered degradation (§3.7)', () => {
  const ROOM = AGENT_LIMITS.requestCap - AGENT_LIMITS.outputFraming;
  // Exact body of round 1 with an empty owner message; digits are one byte each and never escaped.
  const base = () => agentRequestBodyBytes(agentRoundRequest({ directory: FAKE_DIRECTORY, owner: [''], effort: 'medium' }, [], false), MODEL);
  const owner = (bytes: number) => ['7'.repeat(bytes - base())];
  const four = () => [fakeReasoning('rs1'), agenda('c1'), catalog('c2'), shift('c3'), agenda('c4', '2031-05-07')];
  it('measures the body exactly: the forced round 1 body is the non-forced one plus the tool_choice difference', () => {
    enable();
    const request = agentRoundRequest({ directory: FAKE_DIRECTORY, owner: OWNER, effort: 'medium' }, [], false);
    expect(agentRequestBodyBytes(request, MODEL)).toBe(Buffer.byteLength(JSON.stringify(agentRequestBody(request, MODEL))));
    const forced = agentRoundRequest({ directory: FAKE_DIRECTORY, owner: OWNER, effort: 'medium' }, [], true);
    expect(agentRequestBodyBytes(forced, MODEL) - agentRequestBodyBytes(request, MODEL))
      .toBe(Buffer.byteLength(JSON.stringify({ type: 'function', name: 'propor_plano' })) - Buffer.byteLength('"required"') + Buffer.byteLength('false') - Buffer.byteLength('true'));
  });
  it('no room for one more lookup round after round 1: the plan is forced in round 1 (BYTES)', async () => {
    enable();
    const { outcome, fake } = await run([{ output: [fakePlanCall(talkPlan(), 'c1')], expect: { tool_choice: 'propor_plano', parallel: false } }], { owner: owner(ROOM - 8_000) });
    expect(fake.mismatches).toEqual([]); expect(outcome).toMatchObject({ kind: 'PLAN', telemetry: { calls: 1, forced: 'BYTES' } });
  });
  it('outputs that might not fit are rendered compact from the start (step 1); a short message is never compacted', async () => {
    enable();
    const tight = await run([{ output: four() }, { output: [fakePlanCall(talkPlan(), 'c5')], expect: { tool_choice: 'propor_plano' } }],
      { owner: owner(ROOM - AGENT_LOOP_LIMITS.lookupRoomBytes - 200) });
    expect(tight.fake.mismatches).toEqual([]);
    expect(tight.executor.rounds.map(round => round.compact)).toEqual([true]);
    expect(tight.outcome).toMatchObject({ kind: 'PLAN', telemetry: { compacted: true, forced: 'BYTES', calls: 2 } });
    const roomy = await run([{ output: four() }, { output: [fakePlanCall(talkPlan(), 'c5')] }]);
    expect(roomy.executor.rounds.map(round => round.compact)).toEqual([false]); expect(roomy.outcome).toMatchObject({ telemetry: { compacted: false, forced: null } });
  });
  it('outputs that still do not fit are answered FORA_DO_LIMITE and the plan is forced (step 2)', async () => {
    enable();
    const quoted = '"'.repeat(3_000);
    const { outcome, fake } = await run([{ output: four() }, { output: [fakePlanCall(talkPlan(), 'c5')], expect: { tool_choice: 'propor_plano', parallel: false } }],
      { owner: owner(ROOM - AGENT_LOOP_LIMITS.lookupRoomBytes - 200), executor: { answer: () => quoted } });
    expect(fake.mismatches).toEqual([]);
    expect(outcome).toMatchObject({ kind: 'PLAN', telemetry: { limited: true, forced: 'LIMITED', calls: 2 } });
    const outputs = inputOf(fake.requests[1]).filter(item => item.type === 'function_call_result').map(item => item.output);
    expect(outputs).toEqual(Array(4).fill(agentLookupError('FORA_DO_LIMITE')));
    expect(fake.requests.every(request => agentRequestBodyBytes(request, MODEL) + AGENT_LIMITS.outputFraming <= AGENT_LIMITS.requestCap)).toBe(true);
  });
});

describe('agent loop: the real SDK wire behind the {agent:true} guarded fetch (§3.3, §3.7)', () => {
  it('sends exactly the measured body: reasoning → commentary → calls → outputs, paired; include and effort; never the plan', async () => {
    enable();
    const bodies: string[] = [], answers = [
      [httpReasoning('rs_1'), httpCommentary('msg_1', 'Conferindo a agenda.'), httpCall('consultar_agenda', { data: '2031-05-06', profissional: 'p1', de: null, ate: null }, 'call_a'),
        httpCall('catalogo_servicos', { servicos: ['s2'] }, 'call_b')],
      [httpReasoning('rs_2'), httpCall('propor_plano', talkPlan(), 'call_c')],
    ];
    vi.stubGlobal('fetch', vi.fn(async (_url: unknown, init?: RequestInit) => {
      const index = bodies.push(String(init?.body)) - 1;
      if (index >= answers.length) throw Error('UNEXPECTED_CALL');
      return responsesJson(index, answers[index]);
    }));
    const sdk = await agentSdkModel(), requests: ModelRequest[] = [];
    const recorder: Model = { getResponse: request => { requests.push(request); return sdk.getResponse(request); }, getStreamedResponse: request => sdk.getStreamedResponse(request) };
    const { outcome, executor } = await run([], { wrap: () => recorder });
    expect(outcome).toMatchObject({ kind: 'PLAN', telemetry: { calls: 2, lookup_calls: 2, commentary: 1 } });
    expect(bodies).toHaveLength(2);
    const payloads = bodies.map(body => JSON.parse(body) as Record<string, unknown> & { input: Record<string, unknown>[] });
    bodies.forEach((body, index) => {
      expect(Buffer.byteLength(body, 'utf8')).toBe(agentRequestBodyBytes(requests[index], MODEL));
      expect(payloads[index]).toEqual(JSON.parse(JSON.stringify(agentRequestBody(requests[index], MODEL))));
      expect(() => assertSecretaryResponsesPayload(payloads[index], MODEL, { agent: true })).not.toThrow();
      expect(() => assertSecretaryResponsesPayload(payloads[index], MODEL)).toThrow('SECRETARY_OPENAI_COST_GUARD');
    });
    for (const payload of payloads) expect(payload).toMatchObject({ model: MODEL, instructions: AGENT_PROMPT, include: INCLUDE, reasoning: { effort: 'medium' }, max_output_tokens: 8192,
      store: false, stream: false, tool_choice: 'required', parallel_tool_calls: true });
    expect(payloads[0].input[0]).toMatchObject({ role: 'system', content: [{ type: 'input_text', text: AGENT_FRAMING, prompt_cache_breakpoint: { mode: 'explicit' } }, { type: 'input_text' }] });
    expect(payloads[0].input[1]).toEqual({ role: 'user', content: OWNER[0] });
    const blockItems = payloads[1].input.slice(2);
    expect(blockItems.map(item => item.type)).toEqual(['reasoning', 'message', 'function_call', 'function_call', 'function_call_output', 'function_call_output']);
    expect(blockItems[0]).toEqual({ id: 'rs_1', type: 'reasoning', summary: [], encrypted_content: 'cifrado-rs_1' });
    expect(blockItems[1]).toMatchObject({ type: 'message', role: 'assistant', phase: 'commentary' });
    expect(blockItems.slice(2, 4).map(item => item.call_id)).toEqual(['call_a', 'call_b']); expect(blockItems.slice(4).map(item => item.call_id)).toEqual(['call_a', 'call_b']);
    expect(blockItems.slice(4).map(item => item.output)).toEqual([JSON.stringify({ consulta: 'consultar_agenda', rodada: 1 }), JSON.stringify({ consulta: 'catalogo_servicos', rodada: 1 })]);
    expect(payloads.flatMap(payload => payload.input).filter(item => item.name === 'propor_plano')).toEqual([]);
    expect(executor.rounds).toHaveLength(1);
    expect(requests.map(kinds)).toEqual([[], [...BLOCK_1]]);
  });
});
