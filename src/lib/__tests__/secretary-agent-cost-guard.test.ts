import { afterEach, describe, expect, it, vi } from 'vitest';
import { mkdtempSync, readFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { assertSecretaryModelRequest, assertSecretaryResponsesPayload, secretaryGuardedFetch, type ModelRequest } from '@everflair/salon-secretary';
import { AGENT_REASONING_INCLUDE, assertSecretaryAgentModelRequest, observeSecretaryResponseUsage, type SecretaryResponseUsage } from '../../../packages/salon-secretary/src/openai-cost-guard';
import { agentRequestBody, agentRoundRequest, type AgentRoundBlock } from '../../../packages/salon-secretary/src/agent-loop';
import { AGENT_LIMITS } from '../../../packages/salon-secretary/src/agent-context';
import { PROGRAM_SPEND_BASENAME, guardPaidFetch, responsesEstimator, worstCaseMicroUsd } from '../../../packages/salon-secretary/evaluation/program-spend';
import { FAKE_DIRECTORY, fakeCall, fakeCommentary, fakeReasoning } from '../../test/secretary-agent-fake-model';

/** C5 agent cost guard (flag SALON_SECRETARY_AGENT, default off; docs/c5-spike/11-especificacao-agente.md §6.3, §8.1 "Trava"). The
 * agent's format is admitted only with an explicit {agent:true}, at the SDK boundary (assertSecretaryAgentModelRequest) and at the
 * HTTP boundary (assertSecretaryResponsesPayload / secretaryGuardedFetch / the program ledger's estimator); the C4 formats are checked
 * exactly as before. HTTP payloads here are the SDK's own serialization of the loop's requests. Offline: fake fetch, temporary ledger. */
const MODEL = 'gpt-6-luna', URL = 'https://api.openai.com/v1/responses';
type Payload = Record<string, unknown> & { input: Record<string, unknown>[]; tools: Record<string, unknown>[] };
const INPUT = { directory: FAKE_DIRECTORY, owner: ['Mensagem sintética da trava de custo.'], effort: 'medium' as const };
const lookup = (callId: string) => fakeCall('consultar_agenda', { data: '2031-05-06', profissional: null, de: null, ate: null }, callId);
const answered = (n: number): AgentRoundBlock => ({ items: [fakeReasoning(`rs${n}`), fakeCommentary(`m${n}`, 'Nota curta.'), lookup(`c${n}`)],
  results: [{ type: 'function_call_result', callId: `c${n}`, name: 'consultar_agenda', status: 'completed', output: '{"total":0}' }] });
/** The loop's request of a call: `round − 1` answered lookup rounds; the 3rd call is forced. */
const sdk = (round: 1 | 2 | 3, forced = round === 3): ModelRequest => agentRoundRequest(INPUT, Array.from({ length: round - 1 }, (_, index) => answered(index + 1)), forced);
/** Its HTTP body, as the SDK serializes it. */
const http = (round: 1 | 2 | 3, forced = round === 3): Payload => JSON.parse(JSON.stringify(agentRequestBody(sdk(round, forced), MODEL))) as Payload;
const refuses = (payload: unknown) => expect(() => assertSecretaryResponsesPayload(payload, MODEL, { agent: true })).toThrow('SECRETARY_OPENAI_COST_GUARD');
const legacy = () => ({ model: MODEL, instructions: 'synthetic', input: [{ role: 'user', content: 'synthetic' }],
  tools: [{ type: 'function', name: 'select_capabilities', description: 'local', parameters: { type: 'object' }, strict: true }], tool_choice: { type: 'function', name: 'select_capabilities' },
  parallel_tool_calls: false, max_output_tokens: 1200, store: false, stream: false, include: [] });
const directories: string[] = [];
afterEach(() => { vi.unstubAllGlobals(); for (const directory of directories.splice(0)) rmSync(directory, { recursive: true, force: true }); });

describe('agent cost guard: formats admitted with {agent:true} (§6.3)', () => {
  it('SDK boundary: every exact round shape of the loop passes', () => {
    for (const [round, forced] of [[1, false], [1, true], [2, false], [2, true], [3, true]] as const)
      expect(() => assertSecretaryAgentModelRequest(sdk(round, forced), { round, forced }), `${round}/${forced}`).not.toThrow();
  });
  it('HTTP boundary: each serialized round passes with {agent:true}; include [] and effort high also pass', () => {
    for (const [round, forced] of [[1, false], [1, true], [2, false], [2, true], [3, true]] as const) {
      const payload = http(round, forced);
      expect(payload.include).toEqual([AGENT_REASONING_INCLUDE]); expect(payload.reasoning).toEqual({ effort: 'medium' });
      expect(() => assertSecretaryResponsesPayload(payload, MODEL, { agent: true }), `${round}/${forced}`).not.toThrow();
    }
    expect(() => assertSecretaryResponsesPayload({ ...http(1), include: [] }, MODEL, { agent: true })).not.toThrow();
    expect(() => assertSecretaryResponsesPayload({ ...http(2), reasoning: { effort: 'high' } }, MODEL, { agent: true })).not.toThrow();
  });
  it('without {agent:true} every agent format is refused, at both boundaries, as any unknown format was', () => {
    for (const round of [1, 2, 3] as const) expect(() => assertSecretaryResponsesPayload(http(round), MODEL)).toThrow('SECRETARY_OPENAI_COST_GUARD');
    expect(() => assertSecretaryModelRequest(sdk(1), 'select_capabilities')).toThrow('SECRETARY_OPENAI_COST_GUARD');
    expect(() => assertSecretaryResponsesPayload(http(1), MODEL, {})).toThrow('SECRETARY_OPENAI_COST_GUARD');
  });
  it('the C4 formats are unchanged: the legacy wire passes with and without the option; the legacy wire with a reasoning key does not', () => {
    expect(() => assertSecretaryResponsesPayload(legacy(), MODEL)).not.toThrow();
    expect(() => assertSecretaryResponsesPayload(legacy(), MODEL, { agent: true })).not.toThrow();
    refuses({ ...legacy(), reasoning: { effort: 'medium' } });
    refuses({ ...legacy(), include: [AGENT_REASONING_INCLUDE] });
  });
});

describe('agent cost guard: HTTP refusals (§8.1)', () => {
  const block = (payload: Payload) => payload.input.slice(2);
  it.each<[string, () => unknown]>([
    ['7 tools', () => { const p = http(1); return { ...p, tools: [...p.tools, p.tools[0]] }; }],
    ['another digest', () => { const p = http(1); return { ...p, tools: [{ ...p.tools[0], description: 'outra descrição' }, ...p.tools.slice(1)] }; }],
    ['tool_choice auto', () => ({ ...http(1), tool_choice: 'auto' })],
    ['required without parallel calls', () => ({ ...http(1), parallel_tool_calls: false })],
    ['forced with parallel calls', () => ({ ...http(1, true), parallel_tool_calls: true })],
    ['forced into another tool', () => ({ ...http(1, true), tool_choice: { type: 'function', name: 'consultar_agenda' } })],
    ['another include', () => ({ ...http(1), include: ['file_search_call.results'] })],
    ['two includes', () => ({ ...http(1), include: [AGENT_REASONING_INCLUDE, AGENT_REASONING_INCLUDE] })],
    ['reasoning with an extra key', () => ({ ...http(1), reasoning: { effort: 'medium', summary: 'auto' } })],
    ['an effort outside medium/high', () => ({ ...http(1), reasoning: { effort: 'low' } })],
    ['no reasoning', () => { const { reasoning: _dropped, ...rest } = http(1); void _dropped; return rest; }],
    ['a 3rd lookup round (two rounds answered, not forced)', () => ({ ...http(3), tool_choice: 'required', parallel_tool_calls: true })],
    ['three rounds answered', () => { const p = http(3); return { ...p, input: [...p.input, ...block(http(2))] }; }],
    ['an output without its call', () => { const p = http(2); return { ...p, input: [...p.input, { type: 'function_call_output', call_id: 'solto', output: '{}', status: 'completed' }] }; }],
    ['outputs out of order', () => { const p = http(2); const items = block(p); return { ...p, input: [...p.input.slice(0, 2), ...items.slice(0, -1), { ...items.at(-1)!, call_id: 'outro' }] }; }],
    ['an output over 3 KB', () => { const p = http(2); return { ...p, input: p.input.map(item => item.type === 'function_call_output' ? { ...item, output: '8'.repeat(AGENT_LIMITS.lookupOutputBytes + 1) } : item) }; }],
    ['arguments over 4 KB', () => { const p = http(2); return { ...p, input: p.input.map(item => item.type === 'function_call' ? { ...item, arguments: '8'.repeat(AGENT_LIMITS.argumentsBytes + 1) } : item) }; }],
    ['max_output_tokens above 8192', () => ({ ...http(1), max_output_tokens: 8193 })],
    ['max_output_tokens 0', () => ({ ...http(1), max_output_tokens: 0 })],
    ['a commentary outside a round block', () => { const p = http(1); return { ...p, input: [...p.input, { type: 'message', role: 'assistant', status: 'completed', phase: 'commentary', content: [{ type: 'output_text', text: 'x', annotations: [] }] }] }; }],
    ['a commentary over 1 KB', () => { const p = http(2); return { ...p, input: p.input.map(item => item.type === 'message' && item.role === 'assistant'
      ? { ...item, content: [{ type: 'output_text', text: '8'.repeat(AGENT_LIMITS.commentaryBytes + 1), annotations: [] }] } : item) }; }],
    ['a final_answer message in a block', () => { const p = http(2); return { ...p, input: p.input.map(item => item.type === 'message' && item.role === 'assistant' ? { ...item, phase: 'final_answer' } : item) }; }],
    ['propor_plano in the input', () => { const p = http(2); return { ...p, input: p.input.map(item => item.type === 'function_call' ? { ...item, name: 'propor_plano' } : item) }; }],
    ['a reasoning item without encrypted content', () => { const p = http(2); return { ...p, input: p.input.map(item => item.type === 'reasoning' ? { ...item, encrypted_content: undefined } : item) }; }],
    ['a message after the rounds', () => { const p = http(2); return { ...p, input: [...p.input, { role: 'user', content: 'depois' }] }; }],
    ['previous_response_id', () => ({ ...http(2), previous_response_id: 'resp_hosted' })],
    ['conversation', () => ({ ...http(1), conversation: 'conv_hosted' })],
    ['store true', () => ({ ...http(1), store: true })],
    ['stream true', () => ({ ...http(1), stream: true })],
    ['another model', () => ({ ...http(1), model: 'gpt-5.6-luna' })],
    ['a content part with an extra key', () => { const p = http(1); return { ...p, input: [{ ...p.input[0], content: [{ type: 'input_text', text: 'x', cache_control: { type: 'ephemeral' } }] }, ...p.input.slice(1)] }; }],
    ['a breakpoint of another mode', () => { const p = http(1); return { ...p, input: [{ ...p.input[0], content: [{ type: 'input_text', text: 'x', prompt_cache_breakpoint: { mode: 'auto' } }] }, ...p.input.slice(1)] }; }],
    ['5 breakpoints', () => { const p = http(1); return { ...p, input: [{ ...p.input[0], content: Array.from({ length: 5 }, () => ({ type: 'input_text', text: 'x', prompt_cache_breakpoint: { mode: 'explicit' } })) }, ...p.input.slice(1)] }; }],
    ['a message item with an extra key', () => { const p = http(1); return { ...p, input: [{ ...p.input[0], name: 'x' }, ...p.input.slice(1)] }; }],
  ])('%s', (_name, build) => refuses(build()));
});

describe('agent cost guard: SDK refusals (§8.1)', () => {
  const settings = (change: Record<string, unknown>, request = sdk(1)): ModelRequest => ({ ...request, modelSettings: { ...request.modelSettings, ...change } as ModelRequest['modelSettings'] });
  it.each<[string, () => ModelRequest, { round: 1 | 2 | 3; forced: boolean }?]>([
    ['7 tools', () => { const r = sdk(1); return { ...r, tools: [...r.tools, r.tools[0]] }; }],
    ['tools out of order', () => { const r = sdk(1); return { ...r, tools: [r.tools[1], r.tools[0], ...r.tools.slice(2)] }; }],
    ['another digest', () => { const r = sdk(1); return { ...r, tools: [{ ...r.tools[0], description: 'outra descrição' } as ModelRequest['tools'][number], ...r.tools.slice(1)] }; }],
    ['tool_choice auto', () => settings({ toolChoice: 'auto' })],
    ['required without parallel calls', () => settings({ parallelToolCalls: false })],
    ['forced with parallel calls', () => settings({ parallelToolCalls: true }, sdk(1, true)), { round: 1, forced: true }],
    ['another include', () => settings({ providerData: { include: ['file_search_call.results'] } })],
    ['providerData with an extra key', () => settings({ providerData: { include: [AGENT_REASONING_INCLUDE], extra_body: { tools: [] } } })],
    ['reasoning with an extra key', () => settings({ reasoning: { effort: 'medium', summary: 'auto' } })],
    ['store true', () => settings({ store: true })],
    ['prompt cache retention', () => settings({ promptCacheRetention: '24h' })],
    ['context management', () => settings({ contextManagement: [{ type: 'compaction' }] })],
    ['maxTokens above 8192', () => settings({ maxTokens: 8193 })],
    ['previousResponseId', () => ({ ...sdk(1), previousResponseId: 'resp_hosted' })],
    ['conversationId', () => ({ ...sdk(1), conversationId: 'conv_hosted' })],
    ['handoffs', () => ({ ...sdk(1), handoffs: [{}] } as unknown as ModelRequest)],
    ['tracing on', () => ({ ...sdk(1), tracing: true })],
    ['the 3rd call not forced', () => sdk(3, false), { round: 3, forced: false }],
    ['answered rounds that do not match the call', () => sdk(1), { round: 2, forced: false }],
    ['propor_plano sent back', () => { const r = sdk(2); return { ...r, input: (r.input as unknown as Record<string, unknown>[]).map(item => item.type === 'function_call' ? { ...item, name: 'propor_plano' } : item) as unknown as ModelRequest['input'] }; }, { round: 2, forced: false }],
  ])('%s', (_name, build, shape = { round: 1, forced: false }) => expect(() => assertSecretaryAgentModelRequest(build(), shape)).toThrow('SECRETARY_OPENAI_COST_GUARD'));
});

describe('agent guarded fetch and program ledger ({agent} explicit)', () => {
  const init = (payload: unknown): RequestInit => ({ method: 'POST', body: JSON.stringify(payload) });
  const body = (usage: unknown, status = 'completed') => new Response(JSON.stringify({ id: 'resp_x', status, output: [], usage }), { status: 200, headers: { 'content-type': 'application/json' } });
  it('the C4 guarded fetch refuses the agent body before the network; with {agent:true} it goes through and the very response comes back', async () => {
    const response = body({ input_tokens: 1, output_tokens: 1, total_tokens: 2 }), network = vi.fn(async () => response);
    vi.stubGlobal('fetch', network);
    await expect(secretaryGuardedFetch(MODEL)(URL, init(http(2)))).rejects.toThrow('SECRETARY_OPENAI_COST_GUARD');
    expect(network).not.toHaveBeenCalled();
    expect(await secretaryGuardedFetch(MODEL, { agent: true })(URL, init(http(2)))).toBe(response);
    expect(await secretaryGuardedFetch(MODEL, { agent: true })(URL, init(legacy()))).toBe(response);
    expect(network).toHaveBeenCalledTimes(2);
  });
  it('an observed agent call gets the token counts of the body (numbers only, also for an incomplete response); a C4 call never reads the body', async () => {
    const seen: SecretaryResponseUsage[] = [];
    vi.stubGlobal('fetch', vi.fn(async () => body({ input_tokens: 900, input_tokens_details: { cached_tokens: 300, cache_write_tokens: 'x' }, output_tokens: 8192,
      output_tokens_details: { reasoning_tokens: 8000 }, total_tokens: 9092, note: 'texto' }, 'incomplete')));
    const response = await observeSecretaryResponseUsage(usage => { seen.push(usage); }, () => secretaryGuardedFetch(MODEL, { agent: true })(URL, init(http(1))));
    expect(seen).toEqual([{ input_tokens: 900, output_tokens: 8192, total_tokens: 9092, input_tokens_details: { cached_tokens: 300, cache_write_tokens: null },
      output_tokens_details: { reasoning_tokens: 8000 } }]);
    expect(await response.json()).toMatchObject({ status: 'incomplete' });
    await observeSecretaryResponseUsage(usage => { seen.push(usage); }, () => secretaryGuardedFetch(MODEL)(URL, init(legacy())));
    await secretaryGuardedFetch(MODEL, { agent: true })(URL, init(http(1)));
    expect(seen).toHaveLength(1);
  });
  it('the program estimator admits the agent wire only when the runner passes {agent:true}, with the same worst-case formula', () => {
    const request = init(http(3)), bytes = Buffer.byteLength(String(request.body), 'utf8');
    expect(() => responsesEstimator.worstCase(URL, request)).toThrow('PROGRAM_SPEND_WIRE');
    expect(responsesEstimator.worstCase(URL, request, { agent: true })).toMatchObject({ estimator: 'responses', model: MODEL, bodyBytes: bytes, maxOutputTokens: 8192,
      worstCaseMicroUsd: worstCaseMicroUsd(bytes, 8192) });
    expect(responsesEstimator.worstCase(URL, init(legacy()), { agent: true }).maxOutputTokens).toBe(1200);
  });
  it('guardPaidFetch reserves and settles an agent call with {agent:true}; without it the call is refused before the ledger and the network', async () => {
    const directory = mkdtempSync(join(tmpdir(), 'agent-spend-')); directories.push(directory);
    const ledger = join(directory, PROGRAM_SPEND_BASENAME), network = vi.fn(async () => body({ input_tokens: 500, output_tokens: 40, total_tokens: 540 }));
    await expect(guardPaidFetch('practice', network, { ledger, run: 'practice:agent' })(URL, init(http(2)))).rejects.toThrow('PROGRAM_SPEND_WIRE');
    expect(network).not.toHaveBeenCalled();
    const response = await guardPaidFetch('practice', network, { ledger, run: 'practice:agent', item: 'A1:s1:r2', agent: true })(URL, init(http(2)));
    expect(response.status).toBe(200); expect(network).toHaveBeenCalledTimes(1);
    const rows = readFileSync(ledger, 'utf8').split('\n').filter(Boolean).map(line => JSON.parse(line) as Record<string, unknown>);
    expect(rows.map(row => [row.kind, row.item ?? null, row.outcome ?? null])).toEqual([['RESERVE', 'A1:s1:r2', null], ['SETTLE', null, 'USAGE']]);
  });
});
