import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { modelCallUsage, type Model, type ModelRequest } from '@everflair/salon-secretary';
import { instrumentAgentModel, type AgentModelCallUsage } from '../../../packages/salon-secretary/src/usage';
import { AGENT_DEPENDENCY_FLAGS, withAgentMessage } from '../../../packages/salon-secretary/src/agent-context';
import { runAgentTurn, type AgentLoopOutcome } from '../../../packages/salon-secretary/src/agent-loop';
import { usageRecorder } from '../salon-secretary-usage';
import { agentSdkModel, createAgentFakeModel, createFakeAgentExecutor, fakeCall, fakePlanCall, fakeReasoning, httpCall, httpReasoning, responsesJson, talkPlan,
  type AgentFakeModel, type AgentFakeRound } from '../../test/secretary-agent-fake-model';

/** C5 agent usage accounting (flag SALON_SECRETARY_AGENT, default off; docs/c5-spike/11-especificacao-agente.md §6.2, §6.4, §8.1 "Uso").
 * One message = one run of up to three calls, attempts 1→2→3 with the purposes AGENT_LOOKUP / AGENT_PLAN, recorded by the same
 * durable recorder as the C4 (the C4's pairs unchanged); an incomplete response is recorded with the tokens it was billed. Offline:
 * the audit log is a mock, the model a script or the real SDK over a stubbed fetch. */
const mock = vi.hoisted(() => ({ create: vi.fn() }));
vi.mock('../prisma-tenant', () => ({ withTenant: (_actor: unknown, callback: (tx: object) => unknown) => callback({ auditLog: { create: mock.create } }) }));
const MODEL = 'gpt-6-luna', OWNER = ['Mensagem sintética de uso.'];
const actor = { salonId: 'tenant-agente-uso', userId: 'dono-agente-uso' }, sessionId = '30000000-0000-4000-8000-000000000003', runId = '40000000-0000-4000-8000-000000000004';
type Status = Parameters<typeof modelCallUsage>[1];
const agent = (attempt: 1 | 2 | 3, purpose: 'AGENT_LOOKUP' | 'AGENT_PLAN', status: Status) => ({ ...modelCallUsage(MODEL, status), attempt, purpose });
const first = (status: Status) => modelCallUsage(MODEL, status);
const repair = (status: Status) => ({ ...first(status), attempt: 2 as const, purpose: 'SOURCE_LITERAL_REPAIR' as const });
const rows = () => mock.create.mock.calls.map(([value]) => value.data as { id: string; entityId: string; metadata: Record<string, unknown> });
beforeEach(() => { mock.create.mockReset(); mock.create.mockResolvedValue({}); });
afterEach(() => { vi.unstubAllEnvs(); vi.unstubAllGlobals(); });
function enable() { vi.stubEnv('SALON_SECRETARY_AGENT', 'true'); for (const flag of AGENT_DEPENDENCY_FLAGS) vi.stubEnv(flag, 'true'); }

describe('durable recorder: agent attempts 1→2→3', () => {
  it('records the three calls of one message in order, with separate call ids and the common run', async () => {
    const record = usageRecorder(actor, sessionId, runId, MODEL);
    for (const event of [agent(1, 'AGENT_LOOKUP', 'STARTED'), agent(1, 'AGENT_LOOKUP', 'SUCCEEDED'), agent(2, 'AGENT_LOOKUP', 'STARTED'), agent(2, 'AGENT_LOOKUP', 'SUCCEEDED'),
      agent(3, 'AGENT_PLAN', 'STARTED'), agent(3, 'AGENT_PLAN', 'SUCCEEDED')]) await record(event);
    const written = rows();
    expect(written.map(row => [row.metadata.attempt, row.metadata.purpose, row.metadata.status])).toEqual([[1, 'AGENT_LOOKUP', 'STARTED'], [1, 'AGENT_LOOKUP', 'SUCCEEDED'],
      [2, 'AGENT_LOOKUP', 'STARTED'], [2, 'AGENT_LOOKUP', 'SUCCEEDED'], [3, 'AGENT_PLAN', 'STARTED'], [3, 'AGENT_PLAN', 'SUCCEEDED']]);
    expect(new Set(written.map(row => row.entityId)).size).toBe(3); expect(new Set(written.map(row => row.id)).size).toBe(6);
    expect(written.every(row => row.metadata.run_id === runId && row.metadata.session_id === sessionId && row.metadata.schema_version === 2)).toBe(true);
  });
  it('a plan may come in any of the three calls (forced earlier by time or bytes)', async () => {
    for (const events of [[agent(1, 'AGENT_PLAN', 'STARTED'), agent(1, 'AGENT_PLAN', 'SUCCEEDED')],
      [agent(1, 'AGENT_LOOKUP', 'STARTED'), agent(1, 'AGENT_LOOKUP', 'SUCCEEDED'), agent(2, 'AGENT_PLAN', 'STARTED'), agent(2, 'AGENT_PLAN', 'FAILED')]]) {
      const record = usageRecorder(actor, sessionId, runId, MODEL);
      for (const event of events) await record(event);
    }
    expect(mock.create).toHaveBeenCalledTimes(6);
  });
  it('refuses a 3rd attempt of the wrong purpose, a 4th attempt, and anything out of order, before persistence', async () => {
    const record = usageRecorder(actor, sessionId, runId, MODEL);
    await expect(record(agent(2, 'AGENT_LOOKUP', 'STARTED'))).rejects.toThrow('USAGE_ATTEMPT_INVALID');
    for (const event of [agent(1, 'AGENT_LOOKUP', 'STARTED'), agent(1, 'AGENT_LOOKUP', 'SUCCEEDED'), agent(2, 'AGENT_LOOKUP', 'STARTED'), agent(2, 'AGENT_LOOKUP', 'SUCCEEDED')]) await record(event);
    await expect(record(agent(3, 'AGENT_LOOKUP', 'STARTED'))).rejects.toThrow('USAGE_ATTEMPT_INVALID');
    await expect(record({ ...agent(3, 'AGENT_PLAN', 'STARTED'), attempt: 4 } as never)).rejects.toThrow();
    await expect(record(agent(3, 'AGENT_PLAN', 'SUCCEEDED'))).rejects.toThrow('USAGE_ATTEMPT_INVALID');
    await record(agent(3, 'AGENT_PLAN', 'STARTED'));
    await expect(record(agent(3, 'AGENT_LOOKUP', 'SUCCEEDED'))).rejects.toThrow('USAGE_ATTEMPT_INVALID');
    expect(mock.create).toHaveBeenCalledTimes(5);
  });
  it('no attempt after a failed one or after the plan; the C4 and agent families never mix in one run', async () => {
    const failed = usageRecorder(actor, sessionId, runId, MODEL);
    await failed(agent(1, 'AGENT_LOOKUP', 'STARTED')); await failed(agent(1, 'AGENT_LOOKUP', 'TIMEOUT'));
    await expect(failed(agent(2, 'AGENT_PLAN', 'STARTED'))).rejects.toThrow('USAGE_ATTEMPT_INVALID');
    const planned = usageRecorder(actor, sessionId, runId, MODEL);
    await planned(agent(1, 'AGENT_PLAN', 'STARTED')); await planned(agent(1, 'AGENT_PLAN', 'SUCCEEDED'));
    await expect(planned(agent(2, 'AGENT_PLAN', 'STARTED'))).rejects.toThrow('USAGE_ATTEMPT_INVALID');
    const c4 = usageRecorder(actor, sessionId, runId, MODEL);
    await c4(first('STARTED')); await c4(first('SUCCEEDED'));
    await expect(c4(agent(2, 'AGENT_LOOKUP', 'STARTED'))).rejects.toThrow('USAGE_ATTEMPT_INVALID');
    const lookup = usageRecorder(actor, sessionId, runId, MODEL);
    await lookup(agent(1, 'AGENT_LOOKUP', 'STARTED')); await lookup(agent(1, 'AGENT_LOOKUP', 'SUCCEEDED'));
    await expect(lookup(repair('STARTED'))).rejects.toThrow('USAGE_ATTEMPT_INVALID');
    expect(mock.create).toHaveBeenCalledTimes(8);
  });
  it('the C4 lines stay valid exactly as before (1 INTERPRETATION, 2 SOURCE_LITERAL_REPAIR; no 3rd C4 attempt)', async () => {
    const record = usageRecorder(actor, sessionId, runId, MODEL);
    for (const event of [first('STARTED'), first('SUCCEEDED'), repair('STARTED'), repair('SUCCEEDED')]) await record(event);
    expect(rows().map(row => [row.metadata.attempt, row.metadata.purpose, row.metadata.schema_version])).toEqual([[1, 'INTERPRETATION', 2], [1, 'INTERPRETATION', 2],
      [2, 'SOURCE_LITERAL_REPAIR', 2], [2, 'SOURCE_LITERAL_REPAIR', 2]]);
    await expect(record({ ...repair('STARTED'), attempt: 3 as never })).rejects.toThrow('USAGE_ATTEMPT_INVALID');
    await expect(usageRecorder(actor, sessionId, runId, MODEL)({ ...first('STARTED'), purpose: 'SOURCE_LITERAL_REPAIR' })).rejects.toThrow('USAGE_ATTEMPT_INVALID');
  });
});

describe('instrumentAgentModel: one event pair per agent call of the loop', () => {
  const USAGE = { input_tokens: 700, input_tokens_details: { cached_tokens: 500, cache_write_tokens: 0 }, output_tokens: 90, output_tokens_details: { reasoning_tokens: 60 }, total_tokens: 790 };
  async function measured(rounds: AgentFakeRound[], source?: Model): Promise<{ outcome: AgentLoopOutcome; events: AgentModelCallUsage[]; fake: AgentFakeModel; model: Model }> {
    const fake = createAgentFakeModel(rounds, USAGE), events: AgentModelCallUsage[] = [], record = usageRecorder(actor, sessionId, runId, MODEL);
    const model = instrumentAgentModel(source ?? fake, MODEL, async event => { events.push(event); await record(event); });
    const outcome = await withAgentMessage({ owner: OWNER, executor: createFakeAgentExecutor() }, () => runAgentTurn(model, { modelId: MODEL }));
    return { outcome, events, fake, model };
  }
  const lookup = (callId: string) => fakeCall('jornada_profissional', { profissional: 'p1', data: null }, callId);
  it('three calls: 1 AGENT_LOOKUP → 2 AGENT_LOOKUP → 3 AGENT_PLAN, STARTED before dispatch, tokens from the response, persisted by the durable recorder', async () => {
    enable();
    const { outcome, events, fake, model } = await measured([{ output: [fakeReasoning('rs1'), lookup('c1')] }, { output: [lookup('c2')] }, { output: [fakePlanCall(talkPlan(), 'c3')] }]);
    expect(outcome.kind).toBe('PLAN');
    expect(events.map(event => [event.attempt, event.purpose, event.status])).toEqual([[1, 'AGENT_LOOKUP', 'STARTED'], [1, 'AGENT_LOOKUP', 'SUCCEEDED'],
      [2, 'AGENT_LOOKUP', 'STARTED'], [2, 'AGENT_LOOKUP', 'SUCCEEDED'], [3, 'AGENT_PLAN', 'STARTED'], [3, 'AGENT_PLAN', 'SUCCEEDED']]);
    expect(events.filter(event => event.status === 'SUCCEEDED').map(event => [event.input_tokens, event.cached_input_tokens, event.output_tokens, event.usage_status]))
      .toEqual(Array(3).fill([700, 500, 90, 'AVAILABLE']));
    expect(mock.create).toHaveBeenCalledTimes(6);
    // A 4th call (the 3rd request again) and a request the loop did not build are refused before any event or dispatch.
    await expect(model.getResponse(fake.requests[2])).rejects.toThrow('MODEL_CALL_LIMIT');
    await expect(model.getResponse({ ...fake.requests[0] } as ModelRequest)).rejects.toThrow('MODEL_CALL_LIMIT');
    expect(events).toHaveLength(6); expect(fake.requests).toHaveLength(3);
  });
  it('a failed call is recorded FAILED and closes the run: the loop falls back and no 2nd attempt exists', async () => {
    enable();
    const { outcome, events } = await measured([{ output: [], fail: 'TRANSPORT' }]);
    expect(outcome).toMatchObject({ kind: 'C4', repair: true, code: 'AGENT_TRANSPORT' });
    expect(events.map(event => [event.attempt, event.purpose, event.status])).toEqual([[1, 'AGENT_LOOKUP', 'STARTED'], [1, 'AGENT_LOOKUP', 'FAILED']]);
  });
  it('an incomplete response (the SDK throws) is recorded FAILED with the tokens the body reported, read by the {agent:true} guarded fetch', async () => {
    enable();
    const bodies: string[] = [], billed = { input_tokens: 1_200, input_tokens_details: { cached_tokens: 0 }, output_tokens: 8_192, output_tokens_details: { reasoning_tokens: 8_000 }, total_tokens: 9_392 };
    vi.stubGlobal('fetch', vi.fn(async (_url: unknown, init?: RequestInit) => {
      const index = bodies.push(String(init?.body)) - 1;
      return index === 0 ? responsesJson(0, [httpReasoning('rs_1'), httpCall('consultar_agenda', { data: '2031-05-06', profissional: null, de: null, ate: null }, 'call_a')], { status: 'incomplete', usage: billed })
        : responsesJson(index, [httpCall('propor_plano', talkPlan(), 'call_b')]);
    }));
    const { outcome, events } = await measured([], await agentSdkModel());
    expect(outcome).toMatchObject({ kind: 'C4', repair: true, code: 'AGENT_PROTOCOL', telemetry: { calls: 1, protocol: 'STATUS' } });
    expect(bodies).toHaveLength(1);
    expect(events.map(event => [event.attempt, event.status, event.input_tokens, event.output_tokens, event.reasoning_tokens, event.usage_status]))
      .toEqual([[1, 'STARTED', null, null, null, 'UNKNOWN'], [1, 'FAILED', 1_200, 8_192, 8_000, 'AVAILABLE']]);
    expect(mock.create).toHaveBeenCalledTimes(2);
  });
});
