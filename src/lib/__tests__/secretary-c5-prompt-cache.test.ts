import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { assertSecretaryResponsesPayload, cachedSystemContent, createPaidModel, createServicesAgent, jitRules, promptCacheEnabled, runServicesTurn, secretaryContractParts, secretaryContractVersion,
  secretaryRequestBodyBytes, withConversationRouting, withExamplesObserver, withRequestBudgetObserver, withSalonDirectory, EXAMPLES_HEADER, JIT_APPENDIX_HEADER, PROMPT_CACHE_FRAMING,
  SECRETARY_CONTRACT_ENV, SECRETARY_OUTPUT_FRAMING, SECRETARY_REQUEST_CAP, type ConversationRoutingContext, type ExamplesTelemetry, type Model, type ModelRequest, type PromptCachePart,
  type RequestBudgetTelemetry, type SalonDirectory, type SecretaryMessageContent, type SecretarySkill } from '@everflair/salon-secretary';
import { CONTRACT_PROFILES, CONTRACT_VERSION_FILE, contractProfileDigest, contractVersionDrift, liveContractVersionFile, type ContractVersionFile } from '../../../packages/salon-secretary/evaluation/contract-version-profiles';
import { compileRequest, LINT_FLAGS, LINT_STATES, type LintState } from '../../test/secretary-instruction-lint';
import { expandedWire, operationWire } from '../../test/secretary-wire-schema';

/** C5 (flag SALON_SECRETARY_PROMPT_CACHE, default off; docs/c5-spike/01-wire-e-cache.md §4, variante A): the system input opens with
 * its constant data-framing sentence carrying an explicit prompt_cache_breakpoint, so instructions + tool + that sentence are one
 * prefix shared by every salon and turn. Through the real runServicesTurn, SDK serialization and guarded fetch with a fake transport
 * that is never the network; no model, no DB. Off: byte-identical bodies, behaviour and contract. Salons of several types; diverse
 * synthetic names (no gender inferred from a name). */
afterEach(() => { vi.unstubAllEnvs(); vi.unstubAllGlobals(); });
const F = PROMPT_CACHE_FRAMING, FLAG = 'SALON_SECRETARY_PROMPT_CACHE', LIMIT = SECRETARY_REQUEST_CAP - SECRETARY_OUTPUT_FRAMING;
const FIRST: PromptCachePart = { type: 'input_text', text: F, prompt_cache_breakpoint: { mode: 'explicit' } };
const TOOL_DESCRIPTION = 'U03: entrega interpretação explícita ao backend; nunca executa. null omite e preserva.';
const config = { SALON_SECRETARY_ALLOW_PAID_CALLS: 'true', SALON_SECRETARY_MODEL: 'gpt-6-luna', SALON_SECRETARY_OPENAI_API_KEY: 'synthetic-offline-not-a-key', SALON_SECRETARY_OPENAI_PROJECT: 'proj_offline' };
const salons = {
  esmalteria: { professionals: ['Nayara Quispe', 'Baltazar Ikeda'], services: ['Esmaltação em Gel', 'Spa dos Pés'], today: { date: '2027-03-09', weekday: 'terça-feira', timezone: 'America/Sao_Paulo' } },
  spa: { professionals: ['Oluwaseun Prado', 'Iolanda Tupã', 'Wen Carvalho'], services: ['Massagem Relaxante 60 min', 'Drenagem Linfática'], today: { date: '2027-03-12', weekday: 'sexta-feira', timezone: 'America/Manaus' } },
  barbearia: { professionals: ['Kenji Albuquerque', 'Dandara Moreira'], services: ['Barba Terapia', 'Corte Navalhado', 'Pigmentação de Barba'], today: { date: '2027-03-13', weekday: 'sábado', timezone: 'America/Recife' } },
} satisfies Record<string, SalonDirectory>;
type State = Pick<LintState, 'skill' | 'context' | 'fields' | 'requirements'>;
type Payload = Record<string, unknown> & { instructions: string; input: { role: string; content: string | PromptCachePart[] }[]; tools: { name: string; description: string; parameters: unknown }[]; max_output_tokens: number };
type Sent = { bodies: string[]; payloads: Payload[]; budget: RequestBudgetTelemetry[]; examples: ExamplesTelemetry[]; result?: unknown; error?: unknown };
const lint = (name: string) => LINT_STATES.find(state => state.name === name)!;
const bytes = (body: string) => Buffer.byteLength(body, 'utf8');
const breakpoints = (body: string) => body.split('"prompt_cache_breakpoint"').length - 1;
const conversation = { turn: { mode: 'CONVERSATION', response: 'Oi!' } };
/** One turn through the real runServicesTurn, SDK and guarded fetch; the fake transport answers `answers` in order. The flag is unset
 * unless `env` sets it. */
async function send(state: State, message: string, env: Record<string, string | undefined> = {}, directory: SalonDirectory = salons.esmalteria, answers: unknown[] = [conversation]): Promise<Sent> {
  const flags: Record<string, string | undefined> = { SALON_SECRETARY_V2_MAX_OUTPUT_TOKENS: '8192', SALON_SECRETARY_MULTI_ACTION_V2_ENABLED: 'true', SALON_SECRETARY_TEMPORAL_COMPONENTS: 'false',
    SALON_SECRETARY_JIT_INSTRUCTIONS: 'false', SALON_SECRETARY_EXAMPLES: 'off', [FLAG]: undefined, ...env };
  for (const [key, value] of Object.entries(flags)) vi.stubEnv(key, value);
  const out: Sent = { bodies: [], payloads: [], budget: [], examples: [] }, name = state.skill === 'discovery' ? 'select_capabilities' : 'upsert_action_draft';
  vi.stubGlobal('fetch', vi.fn(async (_url: unknown, init?: RequestInit) => {
    const index = out.bodies.push(String(init?.body)) - 1;
    if (index >= answers.length) throw Error('UNEXPECTED_CALL');
    return new Response(JSON.stringify({ id: 'resp_' + index, object: 'response', created_at: 0, status: 'completed', model: 'gpt-6-luna', output: [{ id: 'fc_' + index, call_id: 'call_' + index,
      type: 'function_call', name, arguments: JSON.stringify(answers[index]), status: 'completed' }], usage: { input_tokens: 1, output_tokens: 1, total_tokens: 2 } }), { status: 200, headers: { 'content-type': 'application/json' } });
  }));
  const model = await createPaidModel(config);
  const fields = typeof state.fields === 'function' ? (state.fields as () => unknown)() : state.fields ?? {}, requirements = typeof state.requirements === 'function' ? (state.requirements as () => unknown)() : state.requirements ?? {};
  const turn = () => (runServicesTurn as (m: Model, msg: string, f: unknown, r: unknown, s: SecretarySkill | 'discovery', v2: boolean) => Promise<unknown>)(model, message, fields, requirements, state.skill, true);
  const routed = () => state.context ? withConversationRouting(turn, state.context) : turn();
  try { out.result = await withExamplesObserver(entry => out.examples.push(entry), () => withRequestBudgetObserver(entry => out.budget.push(entry), () => withSalonDirectory(directory, routed))); } catch (error) { out.error = error; }
  out.payloads = out.bodies.map(body => JSON.parse(body) as Payload);
  return out;
}
/** What the turn returned or threw (the flag never changes it). */
const outcome = (sent: Sent) => JSON.stringify({ result: sent.result ?? null, error: sent.error ? [(sent.error as Error).name, (sent.error as Error).message, (sent.error as { selection?: unknown }).selection ?? null] : null });
/** The body with its system content replaced (every other byte as sent). */
const withSystem = (payload: Payload, content: string | PromptCachePart[]) => JSON.stringify({ ...payload, input: [{ ...payload.input[0], content }, ...payload.input.slice(1)] });
const measured = (payload: Payload, system: SecretaryMessageContent) => secretaryRequestBodyBytes({ modelId: 'gpt-6-luna', instructions: payload.instructions,
  messages: [{ role: 'system', content: system }, ...payload.input.slice(1).map(item => ({ role: item.role, content: item.content }))], parameters: payload.tools[0].parameters,
  toolName: payload.tools[0].name, toolDescription: payload.tools[0].description, maxTokens: payload.max_output_tokens });
const states: [string, State, SalonDirectory][] = [['first-turn', lint('first-turn'), salons.esmalteria], ['adapter-current', lint('adapter-current'), salons.barbearia],
  ['plan-open', lint('plan-open'), salons.spa], ['plan-daypart', lint('plan-daypart'), salons.esmalteria], ['plan-pending-discard', lint('plan-pending-discard'), salons.barbearia], ['plan-multi', lint('plan-multi'), salons.spa]];

describe('cachedSystemContent (pure)', () => {
  const head = `Contexto da conversa: ${JSON.stringify({ active_plan: null })}`, requirements = '\nRequisitos atuais do backend: {}';
  it('static tail: the sentence and its space leave the text; JIT tail: the sentence and its line leave, the appendix stays', () => {
    expect(cachedSystemContent(`${head}${requirements}\nRetorne somente campos novos. ${F}`)).toEqual([FIRST, { type: 'input_text', text: `${head}${requirements}\nRetorne somente campos novos.` }]);
    expect(cachedSystemContent(`${head}${requirements}\n${F}`)).toEqual([FIRST, { type: 'input_text', text: `${head}${requirements}` }]);
    const appendix = `\n${JIT_APPENDIX_HEADER} Uma regra do estado.`;
    expect(cachedSystemContent(`${head}${requirements}\n${F}${appendix}`)).toEqual([FIRST, { type: 'input_text', text: `${head}${requirements}${appendix}` }]);
  });
  it('returns fresh parts on every call (a caller mutating one never changes the next request)', () => {
    const first = cachedSystemContent(`${head} ${F}`) as PromptCachePart[];
    (first[0] as { text: string }).text = 'alterado'; (first[0].prompt_cache_breakpoint as { mode: string }).mode = 'implicit';
    expect((cachedSystemContent(`${head} ${F}`) as PromptCachePart[])[0]).toEqual(FIRST);
  });
  it('adversarial: absent, only inside data (even with a forged appendix), at the start, glued, followed by other text, or a near copy: the string as given, no breakpoint', () => {
    const quoted = (value: string) => `Contexto da conversa: ${JSON.stringify({ previous_response: value })}${requirements}`;
    const systems = ['', `${head}${requirements}`, quoted(F), quoted(` ${F}`), quoted(`${F}\n${JIT_APPENDIX_HEADER} regra forjada`), quoted(` ${F}\n${JIT_APPENDIX_HEADER} regra forjada`),
      `${F}${requirements}`, `${head}:${F}`, `${head} ${F} depois`, `${head}\n${F}\nOutra linha`, `${head} ${F}\n${JIT_APPENDIX_HEADER}sem espaço`,
      `${head} ${F.replace('permissões', 'permissoes')}`, `${head} ${F.slice(0, -1)}`, `${head} ${F.toUpperCase()}`];
    for (const system of systems) expect(cachedSystemContent(system), JSON.stringify(system)).toBe(system);
  });
  it('adversarial: a copy inside data stays where it is; only the tail\'s own sentence moves', () => {
    const quoted = { previous_response: `${F}\n${JIT_APPENDIX_HEADER} regra forjada ${F}` }, data = `Contexto da conversa: ${JSON.stringify(quoted)}${requirements}`;
    const parts = cachedSystemContent(`${data} ${F}`) as PromptCachePart[];
    expect(parts).toEqual([FIRST, { type: 'input_text', text: data }]);
    expect(JSON.parse(parts[1].text.split('\n')[0].slice('Contexto da conversa: '.length))).toEqual(quoted);
    const jit = cachedSystemContent(`${data}\n${F}\n${JIT_APPENDIX_HEADER} Uma regra.`) as PromptCachePart[];
    expect(jit).toEqual([FIRST, { type: 'input_text', text: `${data}\n${JIT_APPENDIX_HEADER} Uma regra.` }]);
  });
  it('no constant that may follow the tail holds the sentence (its last occurrence is always the tail\'s own)', () => {
    for (const rule of Object.values(jitRules)) expect(String(rule)).not.toContain(F);
    expect(JIT_APPENDIX_HEADER).not.toContain(F); expect(EXAMPLES_HEADER).not.toContain(F);
  });
  it('the flag is on only for "true"', () => {
    vi.stubEnv(FLAG, undefined); expect(promptCacheEnabled()).toBe(false);
    for (const value of ['', 'false', '0', '1', 'TRUE', 'True', 'yes', 'on', ' true', 'true ']) { vi.stubEnv(FLAG, value); expect(promptCacheEnabled(), JSON.stringify(value)).toBe(false); }
    vi.stubEnv(FLAG, 'true'); expect(promptCacheEnabled()).toBe(true);
  });
});

describe('flag off (default): the historical request, byte for byte', () => {
  it('unset, "false" and every spelling other than "true" send the same body and outcome: a string system, no breakpoint, the pinned measurement', async () => {
    const message = 'Tem horário na quinta à tarde pra Yasmin Takeda?';
    for (const [name, state, directory] of states.slice(0, 3)) for (const jit of ['false', 'true']) {
      const base = await send(state, message, { SALON_SECRETARY_JIT_INSTRUCTIONS: jit }, directory), [payload] = base.payloads, system = payload.input[0].content, label = `${name} jit=${jit}`;
      expect(typeof system, label).toBe('string'); expect(system as string, label).toContain(F); expect(breakpoints(base.bodies[0]), label).toBe(0);
      expect(measured(payload, system), label).toBe(bytes(base.bodies[0])); // secretary-request-budget.test.ts pins this against the real body
      for (const value of ['false', '1', 'TRUE', 'yes', ' true']) {
        const other = await send(state, message, { SALON_SECRETARY_JIT_INSTRUCTIONS: jit, [FLAG]: value }, directory);
        expect(other.bodies, `${label} ${JSON.stringify(value)}`).toEqual(base.bodies); expect(outcome(other), `${label} ${JSON.stringify(value)}`).toBe(outcome(base));
      }
    }
  }, 180_000);
  it('the contract: every recorded profile keeps its version, and the profiles never inherit the flag', () => {
    expect(SECRETARY_CONTRACT_ENV).toContain(FLAG);
    for (const [name, env] of Object.entries(CONTRACT_PROFILES)) expect(contractProfileDigest({ ...env, [FLAG]: 'false' }), name).toEqual(contractProfileDigest(env));
    vi.stubEnv(FLAG, undefined); vi.stubEnv('SALON_SECRETARY_MULTI_ACTION_V2_ENABLED', 'true');
    const parts = secretaryContractParts({ modelId: 'gpt-6-luna' });
    expect(parts.flags).not.toHaveProperty('promptCache'); expect(parts.templates).not.toHaveProperty('promptCache');
    const recorded = JSON.parse(readFileSync(join(process.cwd(), CONTRACT_VERSION_FILE), 'utf8')) as ContractVersionFile, live = liveContractVersionFile();
    vi.stubEnv(FLAG, 'true');
    expect(liveContractVersionFile()).toEqual(live); expect(contractVersionDrift(recorded)).toEqual(contractVersionDrift(recorded, live));
  });
});

describe('flag on: one explicit breakpoint on the constant first part', () => {
  it('exactly one breakpoint, on the framing sentence; every other byte is the historical body; measured exactly; same outcome; the cost guard accepts it', async () => {
    const message = 'Encaixa a Priya Nakamura sábado às 9h, por favor';
    for (const [name, state, directory] of states) for (const components of ['false', 'true']) for (const jit of ['false', 'true']) {
      const env = { SALON_SECRETARY_TEMPORAL_COMPONENTS: components, SALON_SECRETARY_JIT_INSTRUCTIONS: jit }, label = `${name} components=${components} jit=${jit}`;
      const off = await send(state, message, env, directory), on = await send(state, message, { ...env, [FLAG]: 'true' }, directory);
      const [before] = off.payloads, [after] = on.payloads, parts = after.input[0].content as PromptCachePart[];
      expect(breakpoints(on.bodies[0]), label).toBe(1);
      expect(parts, label).toEqual(cachedSystemContent(before.input[0].content as string));
      expect(parts[0], label).toEqual(FIRST); expect(Object.keys(parts[1]), label).toEqual(['type', 'text']); expect(parts[1].text, label).not.toContain(F);
      // The SDK forwards the system content as given (typed string, cast in index.ts): same item keys, the parts unchanged.
      expect(Object.keys(after.input[0]), label).toEqual(Object.keys(before.input[0]));
      expect(withSystem(after, before.input[0].content), label).toBe(off.bodies[0]);
      expect(measured(before, parts), label).toBe(bytes(on.bodies[0]));
      const delta = bytes(on.bodies[0]) - bytes(off.bodies[0]);
      expect(delta, label).toBe(bytes(JSON.stringify(parts)) - bytes(JSON.stringify(before.input[0].content))); expect(delta, label).toBeLessThanOrEqual(128);
      expect(() => assertSecretaryResponsesPayload(after, 'gpt-6-luna'), label).not.toThrow();
      expect(Object.keys(after).filter(key => key.startsWith('prompt_cache')), label).toEqual([]);
      expect(outcome(on), label).toBe(outcome(off)); expect(on.budget, label).toEqual(off.budget);
    }
  }, 300_000);
  it('the cached prefix (instructions, tool, first part) is the same across salons, messages and states, and holds no salon data', async () => {
    const turns = [[salons.esmalteria, 'Marca esmaltação em gel pra Thaís Nogueira amanhã às 14h'], [salons.spa, 'Tem drenagem livre sexta de manhã com Wen Carvalho?'],
      [salons.barbearia, 'Cancela a barba terapia do Eduardo Sato de hoje']] as const;
    const sent: Payload[] = [];
    for (const [directory, message] of turns) sent.push((await send(lint('first-turn'), message, { [FLAG]: 'true' }, directory)).payloads[0]);
    sent.forEach((payload, index) => {
      const [head, rest] = payload.input[0].content as PromptCachePart[], salon = turns[index][0];
      expect(payload.instructions).toBe(sent[0].instructions); expect(JSON.stringify(payload.tools)).toBe(JSON.stringify(sent[0].tools)); expect(head).toEqual(FIRST);
      for (const name of [...salon.professionals, ...salon.services]) { expect(head.text).not.toContain(name); expect(rest.text).toContain(name); }
    });
    for (const [state, extra] of [[lint('plan-open'), {}], [lint('plan-pending-discard'), { SALON_SECRETARY_JIT_INSTRUCTIONS: 'true' }], [lint('adapter-current'), { SALON_SECRETARY_TEMPORAL_COMPONENTS: 'true' }],
      [lint('plan-calendar'), { SALON_SECRETARY_TEMPORAL_COMPONENTS: 'true', SALON_SECRETARY_JIT_INSTRUCTIONS: 'true' }]] as const)
      expect(((await send(state, 'Pode ser às 16h', { [FLAG]: 'true', ...extra }, salons.spa)).payloads[0].input[0].content as PromptCachePart[])[0]).toEqual(FIRST);
  }, 120_000);
  it('the budget measures the real body: exactly at the cap it is sent as configured, one byte more degrades, and the degraded request keeps the layout', async () => {
    const env = { [FLAG]: 'true' }, state = lint('plan-open');
    const probe = await send(state, 'x', env);
    expect(probe.budget).toEqual([]);
    const at = await send(state, 'x' + 'y'.repeat(LIMIT - bytes(probe.bodies[0])), env);
    expect(at.budget).toEqual([]); expect(bytes(at.bodies[0])).toBe(LIMIT); expect(breakpoints(at.bodies[0])).toBe(1);
    const over = await send(state, 'x' + 'y'.repeat(LIMIT - bytes(probe.bodies[0]) + 1), env);
    expect(over.budget).toHaveLength(1); expect(over.budget[0]).toMatchObject({ fit: true, initial_bytes: LIMIT + 1 }); expect(over.budget[0].steps).toContain('JIT_APPENDIX');
    expect(over.budget[0].final_bytes).toBe(bytes(over.bodies[0]));
    const parts = over.payloads[0].input[0].content as PromptCachePart[];
    expect(parts[0]).toEqual(FIRST); expect(parts[1].text).toContain(JIT_APPENDIX_HEADER); expect(breakpoints(over.bodies[0])).toBe(1);
  }, 120_000);
  it('with examples the block rides after the first part (selected) or in the instructions (full); the same entries are chosen with the flag on or off', async () => {
    const message = 'Marca pra amanhã às 15h uma esmaltação em gel pra Sofía Ramírez';
    for (const mode of ['selected', 'full']) {
      const env = { SALON_SECRETARY_EXAMPLES: mode }, off = await send(lint('first-turn'), message, env), on = await send(lint('first-turn'), message, { ...env, [FLAG]: 'true' });
      expect(on.examples, mode).toEqual(off.examples); expect(on.examples[0]?.count, mode).toBeGreaterThan(0);
      const [payload] = on.payloads, parts = payload.input[0].content as PromptCachePart[];
      expect(parts[0], mode).toEqual(FIRST); expect(breakpoints(on.bodies[0]), mode).toBe(1);
      expect(mode === 'selected' ? parts[1].text : payload.instructions, mode).toContain(EXAMPLES_HEADER);
      expect(withSystem(payload, off.payloads[0].input[0].content), mode).toBe(off.bodies[0]);
      expect(bytes(on.bodies[0]) + SECRETARY_OUTPUT_FRAMING, mode).toBeLessThanOrEqual(SECRETARY_REQUEST_CAP);
    }
  }, 120_000);
  it('every compiled lint state and flag set: the list body is measured exactly and fits the cap, also with every candidate flag on', async () => {
    const candidates = { SALON_SECRETARY_TEMPORAL_COMPONENTS: 'true', SALON_SECRETARY_JIT_INSTRUCTIONS: 'true', SALON_SECRETARY_TEMPORAL_POLARITY: 'true', SALON_SECRETARY_SAME_AS: 'true',
      SALON_SECRETARY_REFERENCES_V2: 'true', SALON_SECRETARY_ALTER_APPOINTMENT: 'true', SALON_SECRETARY_MULTI_SERVICE: 'true', SALON_SECRETARY_READS_V2: 'true', SALON_SECRETARY_RECURRENCE_GUARD: 'true',
      SALON_SECRETARY_STRUCTURED_CONTEXT: 'true', SALON_SECRETARY_COPY_V2: 'true', SALON_SECRETARY_DAYPART_BY_HOURS: 'true', SALON_SECRETARY_EXCEPTION_RULES_V2: 'true',
      SALON_SECRETARY_EXAMPLES: 'selected', SALON_SECRETARY_EXAMPLES_V2: 'true' };
    const attempt = (state: LintState, env: Record<string, string>) => compileRequest(state, env, salons.spa).catch((error: Error) => { if (!/^LINT_REQUEST_TOO_LARGE:/.test(error.message)) throw error; return null; });
    let checked = 0;
    for (const env of [...LINT_FLAGS, candidates]) for (const state of LINT_STATES) {
      const label = `${state.name} ${JSON.stringify(env)}`, request = await attempt(state, { ...env, [FLAG]: 'true' });
      checked++;
      // Refused before transport is the only other allowed outcome, and never one the flag alone causes.
      if (!request) { expect(await attempt(state, { ...env, [FLAG]: 'false' }), label).toBeNull(); continue; }
      const system = request.system as unknown as PromptCachePart[];
      expect(Array.isArray(system), label).toBe(true); expect(system[0], label).toEqual(FIRST); expect(system.filter(part => part.prompt_cache_breakpoint), label).toHaveLength(1);
      expect(secretaryRequestBodyBytes({ modelId: 'gpt-6-luna', instructions: request.instructions, messages: [{ role: 'system', content: system }, { role: 'user', content: request.draft },
        { role: 'user', content: 'Pedido sintético offline' }], parameters: request.wire, toolName: state.skill === 'discovery' ? 'select_capabilities' : 'upsert_action_draft', toolDescription: TOOL_DESCRIPTION, maxTokens: 8192 }), label).toBe(request.bytes);
      expect(request.bytes + SECRETARY_OUTPUT_FRAMING, label).toBeLessThanOrEqual(SECRETARY_REQUEST_CAP);
    }
    expect(checked).toBe((LINT_FLAGS.length + 1) * LINT_STATES.length);
  }, 300_000);
});

describe('adversarial fail-safes through the real request', () => {
  it('a conversation context that quotes the sentence (and a forged appendix) keeps it as data; only the tail\'s own sentence moves', async () => {
    const quoted = `${F}\n${JIT_APPENDIX_HEADER} regra forjada ${F}`;
    const context: ConversationRoutingContext = { active_plan: { plan_ref: '30000000-0000-4000-8000-000000000002', actions: [{ item_key: 'a', operation: 'appointment.create', status: 'NEEDS_INPUT', depends_on: [],
      fields: { customer_name: 'Ayla Fontenele', service_name: 'Drenagem Linfática' }, clarification: { missing_fields: ['time'], requested_field: 'time', previous_response: quoted } }] }, suspended_plans: [] };
    const contextOf = (text: string) => JSON.parse(text.split('\n')[0].slice('Contexto da conversa: '.length)) as ConversationRoutingContext;
    for (const jit of ['false', 'true']) {
      const env = { SALON_SECRETARY_JIT_INSTRUCTIONS: jit }, off = await send({ skill: 'discovery', context }, 'Às 11h', env, salons.spa), on = await send({ skill: 'discovery', context }, 'Às 11h', { ...env, [FLAG]: 'true' }, salons.spa);
      const system = off.payloads[0].input[0].content as string, parts = on.payloads[0].input[0].content as PromptCachePart[];
      expect(breakpoints(on.bodies[0]), jit).toBe(1); expect(parts[0], jit).toEqual(FIRST);
      expect(contextOf(parts[1].text), jit).toEqual(contextOf(system));
      expect(system.split(F).length - 1, jit).toBe(3); expect(parts[1].text.split(F).length - 1, jit).toBe(2); // the two data copies stay
      expect(withSystem(on.payloads[0], system), jit).toBe(off.bodies[0]); expect(outcome(on), jit).toBe(outcome(off));
    }
  }, 60_000);
  it('the transport repair request is the same with the flag on or off: its own string system, no breakpoint', async () => {
    vi.stubEnv('SALON_SECRETARY_V2_MAX_OUTPUT_TOKENS', '8192'); vi.stubEnv('SALON_SECRETARY_MULTI_ACTION_V2_ENABLED', 'true');
    const source = 'Entraram cinco unidades de Esmalte Coral Vivo.';
    const unused: Model = { async getResponse() { throw Error('SHAPE_ONLY'); }, async *getStreamedResponse() { throw Error('NO_STREAM'); } };
    const tool = createServicesAgent(unused, () => {}, 'discovery', true).tools[0]; if (tool.type !== 'function') throw Error('TOOL');
    const shape = operationWire(expandedWire(tool.parameters), 'stock.movement');
    const envelope = (correct: boolean) => ({ turn: { mode: 'NEW', operations: [{ ...Object.fromEntries(Object.keys(shape).map(key => [key, null])), operation: 'stock.movement', item_key: 'stock', depends_on: [],
      released_slot_of: null, source_scope: correct ? source : 'Five units of Coral Polish arrived.', inventory: { product_name: 'Esmalte Coral Vivo', low_stock: null, mode: 'IN',
        quantity: { value: 5, literal: correct ? 'cinco unidades' : 'five units' }, reason: null, reference: { kind: 'NAMED', literal: correct ? 'Esmalte Coral Vivo' : 'Coral Polish' } } }] } });
    const answers = [envelope(false), envelope(true)];
    const off = await send({ skill: 'discovery' }, source, {}, salons.esmalteria, answers), on = await send({ skill: 'discovery' }, source, { [FLAG]: 'true' }, salons.esmalteria, answers);
    expect(off.bodies).toHaveLength(2); expect(on.bodies).toHaveLength(2);
    expect(on.bodies[1]).toBe(off.bodies[1]); expect(breakpoints(on.bodies[1])).toBe(0); expect(typeof on.payloads[1].input[0].content).toBe('string');
    expect(breakpoints(on.bodies[0])).toBe(1); expect(outcome(on)).toBe(outcome(off));
  }, 60_000);
  it('the cost guard is unchanged: it accepts the parts and still refuses every prompt cache option, another part type and an extra item key', async () => {
    const sent = await send(lint('first-turn'), 'Tem horário hoje à noite com Kenji Albuquerque?', { [FLAG]: 'true' }, salons.barbearia), [payload] = sent.payloads;
    expect(breakpoints(sent.bodies[0])).toBe(1); expect(() => assertSecretaryResponsesPayload(payload, 'gpt-6-luna')).not.toThrow();
    for (const [key, value] of [['prompt_cache_options', { mode: 'explicit' }], ['prompt_cache_key', 'salao'], ['prompt_cache_retention', '24h']] as const)
      expect(() => assertSecretaryResponsesPayload({ ...payload, [key]: value }, 'gpt-6-luna'), key).toThrow(`UNEXPECTED_FIELD:${key}`);
    const parts = payload.input[0].content as PromptCachePart[];
    expect(() => assertSecretaryResponsesPayload(JSON.parse(withSystem(payload, [{ type: 'input_image', image_url: 'https://example.invalid/x.png' } as unknown as PromptCachePart, parts[1]])), 'gpt-6-luna')).toThrow('INPUT_CONTENT');
    expect(() => assertSecretaryResponsesPayload({ ...payload, input: [{ ...payload.input[0], prompt_cache_breakpoint: { mode: 'explicit' } }, ...payload.input.slice(1)] }, 'gpt-6-luna')).toThrow('INPUT_ITEM');
  }, 60_000);
  it('the SDK request passes the model-request guard with the cache options unset and the parts in the system item', async () => {
    const seen: ModelRequest[] = [];
    const model: Model = { async getResponse(request) { seen.push(request); throw Error('CAPTURED'); }, async *getStreamedResponse() { throw Error('NO_STREAM'); } };
    vi.stubEnv('SALON_SECRETARY_V2_MAX_OUTPUT_TOKENS', '8192'); vi.stubEnv('SALON_SECRETARY_MULTI_ACTION_V2_ENABLED', 'true'); vi.stubEnv(FLAG, 'true');
    const error = await withSalonDirectory(salons.spa, () => (runServicesTurn as (m: Model, msg: string, f: unknown, r: unknown, s: 'discovery', v2: boolean) => Promise<unknown>)(model, 'Quem está livre sábado?', {}, {}, 'discovery', true)).catch((caught: Error) => caught);
    // The guard runs before the model is called: a captured request is one it accepted.
    expect(String((error as Error)?.message)).not.toMatch(/COST_GUARD/); expect(seen).toHaveLength(1);
    expect(seen[0].modelSettings.promptCacheOptions).toBeUndefined(); expect(seen[0].modelSettings.promptCacheRetention).toBeUndefined();
    const system = (seen[0].input as { role: string; content: unknown }[])[0];
    expect(system.role).toBe('system'); expect((system.content as PromptCachePart[])[0]).toEqual(FIRST);
  });
});

describe('contract with the flag on', () => {
  it('names the flag and the cached layout; the wires are unchanged; the version is memoized per environment', () => {
    const v2 = { SALON_SECRETARY_MULTI_ACTION_V2_ENABLED: 'true' };
    const extras: Record<string, string>[] = [{}, { SALON_SECRETARY_JIT_INSTRUCTIONS: 'true' }, { SALON_SECRETARY_TEMPORAL_COMPONENTS: 'true' }];
    for (const extra of extras) {
      const off = contractProfileDigest({ ...v2, ...extra }), on = contractProfileDigest({ ...v2, ...extra, [FLAG]: 'true' }), label = JSON.stringify(extra);
      expect(on.version, label).not.toBe(off.version); expect(on.parts.wires, label).toBe(off.parts.wires);
      expect(on.parts.templates, label).not.toBe(off.parts.templates); expect(on.parts.runtime, label).not.toBe(off.parts.runtime);
    }
    for (const jit of ['false', 'true']) {
      vi.stubEnv('SALON_SECRETARY_MULTI_ACTION_V2_ENABLED', 'true'); vi.stubEnv('SALON_SECRETARY_JIT_INSTRUCTIONS', jit); vi.stubEnv(FLAG, 'true');
      const parts = secretaryContractParts({ modelId: 'gpt-6-luna' }), layout = parts.templates.promptCache!.layout as PromptCachePart[];
      expect(parts.flags, jit).toMatchObject({ promptCache: true }); expect(parts.templates.promptCache!.framing, jit).toBe(F);
      expect(layout, jit).toEqual(cachedSystemContent(parts.templates.system)); expect(layout[0], jit).toEqual(FIRST); expect(layout[1].text, jit).not.toContain(F);
      const version = secretaryContractVersion({ modelId: 'gpt-6-luna' });
      vi.stubEnv(FLAG, 'false'); expect(secretaryContractVersion({ modelId: 'gpt-6-luna' }), jit).not.toBe(version);
    }
  });
});
