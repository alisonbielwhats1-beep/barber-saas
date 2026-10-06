import { afterEach, describe, expect, it } from 'vitest';
import { mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { basename, dirname, join } from 'node:path';
import { tmpdir } from 'node:os';
import {
  AGENDA_STAGES, AGENT_CALLS_PER_MESSAGE, AGENT_FALLBACK_CAP, AGENT_PATHS, AGENT_RULE_CODES, ESTIMATE_BODY_BYTES, EVALUATOR_FILES, agendaStage, agentArm, agentArmSummary, agentAttemptTurns,
  agentCallRecord, agentTurnOf, agentUsageByRound, assertAgentArm, buildPasskReport, digest, evaluatorVersion, expectedCalls, formatAgentArm, formatPasskTable, headroomEstimate, passkArm,
  readScenarioIds, requestVersion, reservationMicroUsd, reserve, runEstimateMs, scenarioBudgetMs, selectScenarioIds, spendByRound, type AgendaScenario, type AgentTurnOutcome, type DbState,
  type TranscriptRow,
} from '../../../packages/salon-secretary/evaluation/agenda-practice-lib';
import { armDifferences, formatPairedComparison, generalizationGap } from '../../../packages/salon-secretary/evaluation/agenda-practice-stats';
import { AGENT_DEPENDENCY_FLAGS, AGENT_LIMITS, agentEnabled } from '../../../packages/salon-secretary/src/agent-context';
import { agentRequestBody, agentRoundRequest } from '../../../packages/salon-secretary/src/agent-loop';
import { AGENT_VALIDATOR_CODES } from '../secretary-agent-validator';
import { FAKE_DIRECTORY } from '../../test/secretary-agent-fake-model';
import { FREE_USE_AGENT_ALARM_CALLS_PER_MESSAGE, freeUseAgentArm, freeUseRequestsPerTurn } from '../../../packages/salon-secretary/evaluation/free-use-runner';
import { FREE_USE_PRICING_SHA256, FREE_USE_RELIABILITY_MISSION, FreeUseBudget } from '../../../packages/salon-secretary/evaluation/free-use-budget';

// C5 WP6 (docs/c5-spike/11-especificacao-agente.md §6.2-§6.4, §8.5, §9.4, §10): the evaluation side of the agent arm. Offline only:
// temporary files, synthetic salons and texts; no database, no network, no model.
const DAY = '2031-05-06';
const temps: string[] = [];
const tempDir = () => { const dir = mkdtempSync(join(tmpdir(), 'agenda-agent-arm-')); temps.push(dir); return dir; };
afterEach(() => { for (const dir of temps.splice(0)) rmSync(dir, { recursive: true, force: true }); });
const allDependencies = () => Object.fromEntries(AGENT_DEPENDENCY_FLAGS.map(name => [name, 'true'])) as Record<string, string>;
const initial: DbState = { appointments: [], blocks: [] };
const written: DbState = { appointments: ['Iolanda Brandão | Escova Modelada | 2031-05-07 10:00→10:45 | Ximena Guedes | CONFIRMED'], blocks: [] };
const c4Payload = () => ({ model: 'gpt-6-luna', instructions: 'instruções sintéticas', input: [{ role: 'user', content: 'mensagem sintética' }],
  tools: [{ type: 'function', name: 'upsert_action_draft', parameters: { type: 'object' }, strict: true }], tool_choice: { type: 'function', name: 'upsert_action_draft' },
  parallel_tool_calls: false, max_output_tokens: 8192, store: false, stream: false, include: [] });
const agentPayload = () => agentRequestBody(agentRoundRequest({ directory: FAKE_DIRECTORY, owner: ['mensagem sintética do dono'], effort: 'medium' }, [], false), 'gpt-6-luna');
const outcome = (path: string, extra: AgentTurnOutcome = {}): TranscriptRow['router'] => ({ outcome: { agent: { path, lookup_calls: 1, fallback_code: path === 'AGENT' ? null : 'AGENT_PROTOCOL', ...extra } } });
/** A run folder whose attempts carry the given turns (final oracle: nothing changes, so `ok` decides the DB of the last row). */
function writeRun(dir: string, attempts: Record<string, { ok: boolean; turns: Partial<TranscriptRow>[] }[]>, report: Record<string, unknown> = {}) {
  const K = Math.max(...Object.values(attempts).map(list => list.length));
  for (const [id, list] of Object.entries(attempts)) list.forEach(({ ok, turns }, i) => {
    const scenario: AgendaScenario = { id, title: id, capability: ['agenda'], steps: turns.map(() => ({ say: 'mensagem sintética' })), final: { unchanged: true } };
    mkdirSync(join(dir, `k${i + 1}`), { recursive: true });
    writeFileSync(join(dir, `k${i + 1}`, `${id}.json`), JSON.stringify({ scenario, today: DAY, attempt: i + 1, complete: true, initial,
      transcript: turns.map((t, n) => ({ step: n + 1, action: 'say', pending: [], view: { message: 'ok' }, db: ok || n < turns.length - 1 ? initial : written, ...t })) }));
  });
  writeFileSync(join(dir, 'report.json'), JSON.stringify({ run: basename(dir), status: 'COMPLETE', repeat: K, scenarios: Object.keys(attempts).length, ids: Object.keys(attempts), reservedUsd: 0, ...report }));
  return dir;
}

describe('agenda practice, C5 agent arm: stage, flag and expected calls', () => {
  it('the paired stage owns its journal and a USD 60 reservation cap', () => {
    expect(agendaStage('c5-agent-20261001')).toEqual({ name: 'c5-agent-20261001', journal: 'c5-agent-20261001-stage-budget.jsonl', capMicroUsd: 60_000_000 });
    expect(new Set(Object.values(AGENDA_STAGES).map(s => s.journal)).size).toBe(Object.keys(AGENDA_STAGES).length);
  });
  it('the arm is the product flag itself, with its dependencies and effort checked before anything runs', () => {
    expect(AGENT_CALLS_PER_MESSAGE).toBe(AGENT_LIMITS.callsPerMessage); expect(AGENT_CALLS_PER_MESSAGE).toBe(3);
    expect([agentArm({ SALON_SECRETARY_AGENT: 'true' }), agentArm({ SALON_SECRETARY_AGENT: 'TRUE' }), agentArm({ SALON_SECRETARY_AGENT: 'false' }), agentArm({})]).toEqual([true, false, false, false]);
    const saved = process.env.SALON_SECRETARY_AGENT;
    try {
      for (const value of ['true', 'false', undefined]) {
        if (value === undefined) delete process.env.SALON_SECRETARY_AGENT; else process.env.SALON_SECRETARY_AGENT = value;
        expect(agentArm(process.env)).toBe(agentEnabled());
      }
    } finally { if (saved === undefined) delete process.env.SALON_SECRETARY_AGENT; else process.env.SALON_SECRETARY_AGENT = saved; }
    expect(() => assertAgentArm({ ...allDependencies(), SALON_SECRETARY_AGENT: 'true' })).not.toThrow();
    expect(() => assertAgentArm({ ...allDependencies(), SALON_SECRETARY_AGENT_EFFORT: 'high' })).not.toThrow();
    const [first, ...rest] = AGENT_DEPENDENCY_FLAGS;
    try { assertAgentArm({ ...allDependencies(), [first]: 'false' }); expect.unreachable(); }
    catch (e) { expect((e as Error).message).toBe('AGENDA_AGENT_FLAGS_INCOMPLETE'); expect((e as { details: unknown }).details).toEqual({ missing: [first] }); }
    expect(() => assertAgentArm(Object.fromEntries(rest.map(name => [name, 'true'])))).toThrow('AGENDA_AGENT_FLAGS_INCOMPLETE');
    expect(() => assertAgentArm({ ...allDependencies(), SALON_SECRETARY_AGENT_EFFORT: 'low' })).toThrow('AGENDA_AGENT_EFFORT');
    // S1 arm: a per-call effort the loop would refuse on every message (a paid run silently measuring the C4) is refused before anything.
    expect(() => assertAgentArm({ ...allDependencies(), SALON_SECRETARY_AGENT_EFFORT_ROUNDS: 'high,medium,medium' })).not.toThrow();
    for (const value of ['high', 'high,medium', 'high,low,medium', 'high, medium,medium', ''])
      expect(() => assertAgentArm({ ...allDependencies(), SALON_SECRETARY_AGENT_EFFORT_ROUNDS: value }), JSON.stringify(value)).toThrow('AGENDA_AGENT_EFFORT');
  });
  it('an agent arm reserves 3 calls per say and per scripted answer; the C4 arm keeps the historical 2 per say + 1 per answer', () => {
    const s: AgendaScenario = { id: 'Q1', title: 'q', capability: ['agenda'], steps: [{ say: 'um' }, { confirm: true }, { say: 'dois' }],
      answers: { time: ['às 10h', 'dez horas'], date: { queue: ['amanhã', 'depois de amanhã'] } } };
    expect(expectedCalls(s)).toEqual({ says: 2, answers: 3, calls: 7 });
    expect(expectedCalls(s, { agent: false })).toEqual({ says: 2, answers: 3, calls: 7 });
    expect(expectedCalls(s, { agent: true })).toEqual({ says: 2, answers: 3, calls: 15 });
    const c4 = headroomEstimate({ scenarios: [s], repeat: 2, spentMicroUsd: 0, capMicroUsd: 60_000_000 });
    const agent = headroomEstimate({ scenarios: [s], repeat: 2, spentMicroUsd: 0, capMicroUsd: 60_000_000, agent: true });
    expect([c4.callsPerPass, c4.maxRequests, agent.callsPerPass, agent.maxRequests]).toEqual([7, 14, 15, 30]);
    expect(agent.requiredMicroUsd).toBe(30 * reservationMicroUsd(ESTIMATE_BODY_BYTES, 8192));
    expect(scenarioBudgetMs(s, 1_000, true)).toBe(15 * 1_000 + 60_000); expect(scenarioBudgetMs(s, 1_000)).toBe(7 * 1_000 + 60_000);
    expect(runEstimateMs([s], 1, true)).toBeGreaterThan(runEstimateMs([s], 1));
  });
});

describe('agenda practice, C5 agent arm: wire, request version and what each call records', () => {
  it('a one-tool request keeps its historical version; every one of the agent tools is part of it', () => {
    const one = c4Payload();
    expect(requestVersion(one)).toBe(digest(one.instructions + JSON.stringify({ type: 'object' }) + 'gpt-6-luna'));
    const body = agentPayload() as { instructions?: unknown; tools: { name?: unknown; parameters?: unknown }[]; model?: unknown };
    expect(body.tools.length).toBe(6);
    const changed = { ...body, tools: body.tools.map((t, i) => i === 5 ? { ...t, parameters: { type: 'object', description: 'outra' } } : t) };
    expect(requestVersion(body)).toBe(requestVersion(structuredClone(body)));
    expect(requestVersion(changed)).not.toBe(requestVersion(body));
    expect(requestVersion(body)).not.toBe(digest(String(body.instructions) + JSON.stringify(body.tools[0].parameters) + String(body.model)));
  });
  it('the stage journal admits the agent wire only when the runner says the arm is the agent; the C4 wire either way', () => {
    const dir = tempDir(), file = join(dir, 'c5-agent-20261001-stage-budget.jsonl'), body = JSON.stringify(agentPayload()), c4 = JSON.stringify(c4Payload());
    expect(() => reserve(file, 'run-a', 'S1#k1', 1, body, 'c5-agent-20261001')).toThrow(/SECRETARY_OPENAI_COST_GUARD/);
    expect(() => reserve(file, 'run-a', 'S1#k1', 1, body, 'c5-agent-20261001', { agent: false })).toThrow(/SECRETARY_OPENAI_COST_GUARD/);
    const row = reserve(file, 'run-a', 'S1#k1', 1, body, 'c5-agent-20261001', { agent: true });
    expect(row).toMatchObject({ stage: 'c5-agent-20261001', maxOutputTokens: 8192, reservedMicroUsd: reservationMicroUsd(Buffer.byteLength(body), 8192) });
    expect(reserve(file, 'run-a', 'S1#k1', 2, c4, 'c5-agent-20261001', { agent: true })).toMatchObject({ step: 2 });
    expect(reserve(file, 'run-a', 'S1#k1', 3, c4, 'c5-agent-20261001')).toMatchObject({ step: 3 });
    expect(readFileSync(file, 'utf8').split('\n').filter(Boolean)).toHaveLength(3);
  });
  it('the free-use mission budget (Golden runner) admits the agent wire only when the runner passes its arm; refusals write nothing', () => {
    const dir = tempDir(), body = JSON.stringify(agentPayload()), url = 'https://api.openai.com/v1/responses', init = { method: 'POST', body };
    const budget = new FreeUseBudget(join(dir, 'agent-arm-mission.jsonl'), 'agent-arm-binding', 3, 8192, FREE_USE_PRICING_SHA256, FREE_USE_RELIABILITY_MISSION);
    expect(() => budget.reserve('S1#k1', 1, url, init)).toThrow(/SECRETARY_OPENAI_COST_GUARD/);
    expect(() => budget.reserve('S1#k1', 1, url, init, { agent: false })).toThrow(/SECRETARY_OPENAI_COST_GUARD/);
    expect(budget.requests).toBe(0);
    expect(budget.reserve('S1#k1', 1, url, init, { agent: true })).toMatchObject({ attempt: 1, reservedMicroUsd: reservationMicroUsd(Buffer.byteLength(body), 8192) });
    expect(budget.reserve('S1#k1', 1, url, { method: 'POST', body: JSON.stringify(c4Payload()) }, { agent: true })).toMatchObject({ attempt: 2 });
    expect(budget.requests).toBe(2);
  });
  it('an agent call records the calls, item kinds, sizes and the sha256 of the reasoning and of every tool output, never their text', () => {
    const secret = 'cifrado-opaco-sintetico-123', note = 'comentário interno sintético', output = JSON.stringify({ aviso: 'dados', livres: ['10:00'] });
    const payload = { tools: [{ name: 'consultar_agenda' }, { name: 'propor_plano' }], tool_choice: 'required', input: [{ role: 'system', content: 'x' }, { type: 'reasoning', id: 'rs0', encrypted_content: 'antigo' },
      { type: 'function_call', call_id: 'c1', name: 'consultar_agenda', arguments: '{}' }, { type: 'function_call_output', call_id: 'c1', output }] };
    const response = { status: 'completed', output: [{ type: 'reasoning', id: 'rs1', summary: [], encrypted_content: secret },
      { type: 'message', role: 'assistant', phase: 'commentary', content: [{ type: 'output_text', text: note }] },
      { type: 'function_call', call_id: 'c2', name: 'horarios_livres', arguments: '{"data":"2031-05-07"}' }, { type: 'function_call', call_id: 'c3', name: 'buscar_cliente', arguments: '{"nome":"Olívia"}' }] };
    const record = agentCallRecord(2, '2031-05-06T15:00:00.000Z', 'v-agent', payload, response);
    expect(record).toEqual({ n: 2, at: '2031-05-06T15:00:00.000Z', version: 'v-agent', status: 'completed', kind: 'AGENT', forced: false,
      items: ['reasoning', 'message:commentary', 'function_call', 'function_call'], sizes: [secret.length, note.length, 0, 0], reasoning: [digest(secret)],
      calls: [{ call_id: 'c2', name: 'horarios_livres', arguments: '{"data":"2031-05-07"}' }, { call_id: 'c3', name: 'buscar_cliente', arguments: '{"nome":"Olívia"}' }],
      outputs: [{ call_id: 'c1', sha256: digest(output) }] });
    expect(JSON.stringify(record)).not.toContain(secret); expect(JSON.stringify(record)).not.toContain(note); expect(JSON.stringify(record)).not.toContain('"livres"'); expect(JSON.stringify(record)).not.toContain('10:00');
    const forced = agentCallRecord(3, 'x', 'v', { ...payload, tool_choice: { type: 'function', name: 'propor_plano' } }, { status: 'incomplete', output: [] }, 200);
    expect(forced).toMatchObject({ kind: 'AGENT', forced: true, status: 'incomplete', items: [], calls: [] });
    expect(agentCallRecord(1, 'x', 'v-c4', c4Payload(), { output: [{ type: 'function_call', arguments: '{"turn":{}}' }] })).toEqual({ n: 1, at: 'x', version: 'v-c4', kind: 'C4', arguments: '{"turn":{}}' });
    expect(agentCallRecord(1, 'x', 'v', payload, undefined, 503)).toMatchObject({ kind: 'AGENT', http: 503, items: [], outputs: [{ call_id: 'c1' }] });
  });
  it('usage per call position and the program ledger spend per round and per owner message', () => {
    const rounds = agentUsageByRound([
      { round: 1, record: { kind: 'AGENT' }, input: 1000, cached: 200, output: 100, latencyMs: 900 }, { round: 2, record: { kind: 'AGENT' }, input: 3000, cached: 900, output: 400, latencyMs: 2100 },
      { round: 1, record: { kind: 'AGENT' }, input: 1100, cached: 0, output: 120, latencyMs: 1100 }, { round: 2, record: { kind: 'C4' }, input: 9000, cached: 0, output: 300, latencyMs: 3000 }]);
    expect(Object.keys(rounds)).toEqual(['c4:r2', 'r1', 'r2']);
    expect(rounds.r1).toMatchObject({ calls: 2, input: 2100, cached: 200, output: 220, latencyMs: { p50: 900, p90: 1100 } });
    expect(rounds['c4:r2']).toMatchObject({ calls: 1, input: 9000 });
    const reserved = (id: string, run: string, item: string, worst = 1_000) => ({ kind: 'RESERVE', id, run, item, worstCaseMicroUsd: worst });
    const settle = (id: string, charged: number) => ({ kind: 'SETTLE', id, chargedMicroUsd: charged });
    const spend = spendByRound([reserved('a', 'practice:r', 'S1#k1:s1:r1'), settle('a', 100), reserved('b', 'practice:r', 'S1#k1:s1:r2'), settle('b', 300),
      reserved('c', 'practice:r', 'S1#k1:s2:r1'), settle('c', 50), reserved('d', 'practice:r', 'S1#k1:s2:r2', 2_000), reserved('e', 'practice:other', 'S9#k1:s1:r1'), settle('e', 999),
      reserved('f', 'practice:r', 'legacy-item'), settle('f', 7), 'not a row', null], 'practice:r');
    expect(spend.rounds).toEqual({ r1: { calls: 2, microUsd: 150, open: 0 }, r2: { calls: 2, microUsd: 2_300, open: 1 }, other: { calls: 1, microUsd: 7, open: 0 } });
    expect(spend.messages).toBe(2); expect(spend.perMessageMicroUsd).toEqual({ mean: 1_225, p50: 400, p90: 2_050 });
  });
});

describe('agenda practice, C5: evaluator version and the arm profile', () => {
  it('the evaluator version is stable, ignores line endings and changes with any evaluator file', () => {
    const root = tempDir();
    for (const file of EVALUATOR_FILES) { mkdirSync(dirname(join(root, file)), { recursive: true }); writeFileSync(join(root, file), `conteúdo ${file}\nlinha dois\n`); }
    const v1 = evaluatorVersion(root);
    expect(v1).toMatch(/^agenda-evaluator-[0-9a-f]{16}$/); expect(evaluatorVersion(root)).toBe(v1);
    writeFileSync(join(root, EVALUATOR_FILES[1]), `conteúdo ${EVALUATOR_FILES[1]}\r\nlinha dois\r\n`); expect(evaluatorVersion(root)).toBe(v1);
    writeFileSync(join(root, EVALUATOR_FILES[1]), `conteúdo alterado\n`); const v2 = evaluatorVersion(root); expect(v2).not.toBe(v1);
    rmSync(join(root, EVALUATOR_FILES[0])); expect(evaluatorVersion(root)).not.toBe(v2);
    expect(evaluatorVersion()).toMatch(/^agenda-evaluator-[0-9a-f]{16}$/); // this checkout's own
  });
  it('arms graded by different evaluator versions are CONFOUNDED; runs before the stamp keep their profile', () => {
    const root = tempDir(), va = 'agenda-evaluator-aaaaaaaaaaaaaaaa', vb = 'agenda-evaluator-bbbbbbbbbbbbbbbb';
    const a = buildPasskReport(writeRun(join(root, 'a'), { Q1: [{ ok: true, turns: [{}] }] }, { evaluatorVersion: va }));
    const b = buildPasskReport(writeRun(join(root, 'b'), { Q1: [{ ok: false, turns: [{}] }] }, { evaluatorVersion: vb }));
    const same = buildPasskReport(writeRun(join(root, 'c'), { Q2: [{ ok: true, turns: [{}] }] }, { evaluatorVersion: va }));
    const legacy = buildPasskReport(writeRun(join(root, 'd'), { Q3: [{ ok: true, turns: [{}] }] }));
    const odd = buildPasskReport(writeRun(join(root, 'e'), { Q4: [{ ok: true, turns: [{}] }] }, { evaluatorVersion: 'texto livre com espaços' }));
    expect([a.evaluatorVersion, legacy.evaluatorVersion, odd.evaluatorVersion]).toEqual([va, null, null]);
    expect(formatPasskTable(a)).toContain(`EVALUATOR ${va}`); expect(formatPasskTable(legacy)).not.toContain('EVALUATOR');
    expect(passkArm([a]).profile?.evaluator).toEqual([va]); expect(passkArm([legacy]).profile).not.toHaveProperty('evaluator');
    expect(passkArm([a, same]).profile?.mixed).toEqual([]);
    expect(passkArm([a, legacy]).profile).toMatchObject({ mixed: ['evaluator version'], evaluator: ['?', va] });
    expect(armDifferences(passkArm([a]).profile, passkArm([b]).profile)).toEqual({ treatment: [], conditions: [`evaluator version ${va}≠${vb}`], days: false });
    expect(armDifferences(passkArm([a]).profile, passkArm([same]).profile)).toEqual({ treatment: [], conditions: [], days: false });
    expect(armDifferences(passkArm([legacy]).profile, passkArm([odd]).profile)).toEqual({ treatment: [], conditions: [], days: false });
    expect(formatPairedComparison([passkArm([a], 'c4'), passkArm([b], 'agente')])).toContain(`WARN CONFOUNDED agente: evaluator version ${va}≠${vb}`);
    expect(generalizationGap(passkArm([a]), passkArm([b])).confounded).toEqual([`evaluator version ${va}≠${vb}`]);
  });
});

describe('agenda practice, C5 agent arm: the per-path report', () => {
  it('counts eligible messages by path, calls per message, the fallback share against 15% and pass/SAFETY per attempt path', () => {
    const root = tempDir(), tokens = { input: 2_000, cached: 500, output: 300 };
    const r = buildPasskReport(writeRun(join(root, 'agent'), {
      A1: [{ ok: true, turns: [{ calls: 1, latencyMs: 4_000, tokens, router: outcome('AGENT', { validator: { accepted: 2, name_fallback: 1, codes: ['AGENT_TEMPORAL_READING'] } }) }, { calls: 0 }] }],
      A2: [{ ok: true, turns: [{ calls: 3, latencyMs: 12_000, tokens, router: outcome('AGENT', { lookup_calls: 3, validator: { asked: 1, codes: ['AGENT_KEEP_UNPROVEN', 'AGENT_KEEP_UNPROVEN'] } }) }] }],
      A3: [{ ok: false, turns: [{ calls: 2, latencyMs: 9_000, router: outcome('C4_FALLBACK') }, { calls: 1, router: outcome('AGENT', { validator: { codes: ['AGENT_ANCHOR_ROLE', 'texto livre'] } }) }] }],
      A4: [{ ok: true, turns: [{ calls: 1, router: outcome('C4_SKIPPED', { fallback_code: 'AGENT_DIRECTORY_TRUNCATED' }) }] }],
      A5: [{ ok: true, turns: [{ calls: 1, router: { outcome: { agent: { path: 'OUTRO' } } } as TranscriptRow['router'] }] }],
    }));
    const a = r.agent!;
    expect(a).toMatchObject({ eligibleTurns: 5, fallbackShare: 0.4, fallbackCap: AGENT_FALLBACK_CAP, overFallbackCap: true, meanCallsPerMessage: 1.6 });
    expect(a.paths.AGENT).toMatchObject({ turns: 3, calls: { 1: 2, 3: 1 }, meanCalls: 1.667, lookupsPerTurn: 1.667, latencyMs: { p50: 4_000, p90: 12_000 } });
    expect(a.paths.C4_FALLBACK).toMatchObject({ turns: 1, calls: { 2: 1 } }); expect(a.paths.C4_SKIPPED).toMatchObject({ turns: 1 });
    expect(a.fallbackCodes).toEqual({ AGENT_PROTOCOL: 1, AGENT_DIRECTORY_TRUNCATED: 1 });
    expect(a.attempts).toEqual({ AGENT: { attempts: 2, passed: 2, safety: 0, pass1: 1 }, C4: { attempts: 2, passed: 1, safety: 1, pass1: 0.5 }, NONE: { attempts: 1, passed: 1, safety: 0, pass1: 1 } });
    expect(a.validator).toMatchObject({ accepted: 2, name_fallback: 1, asked: 1, codes: { AGENT_TEMPORAL_READING: 1, AGENT_KEEP_UNPROVEN: 1, AGENT_ANCHOR_ROLE: 1 },
      rules: { V9: { turns: 1, rate: 0.2 }, V11: { turns: 1, rate: 0.2 }, V12: { turns: 1, rate: 0.2 } } });
    expect(a.byCapability).toEqual({ agenda: { turns: 5, meanCalls: 1.6 } });
    const table = formatPasskTable(r);
    expect(table).toContain('AGENT eligible=5 fallback=0.400 (cap 0.15 OVER) calls/message=1.600'); expect(table).toContain('path C4_FALLBACK');
    expect(formatAgentArm(a).join('\n')).not.toMatch(/texto livre|mensagem/);
  });
  it('a C4 run (no agent outcome in any turn) keeps its report shape', () => {
    const root = tempDir(), r = buildPasskReport(writeRun(join(root, 'c4'), { B1: [{ ok: true, turns: [{ calls: 2 }] }] }));
    expect(r).not.toHaveProperty('agent'); expect(formatPasskTable(r)).not.toContain('AGENT eligible');
    expect(agentArmSummary([agentAttemptTurns({ ok: true, safety: [] }, ['x'], [{ step: 1 }])])).toMatchObject({ eligibleTurns: 0, fallbackShare: null, overFallbackCap: false, meanCallsPerMessage: null });
    expect(agentTurnOf({ router: { outcome: { agent: { path: 'AGENT' } } } })?.path).toBe('AGENT');
    expect(agentTurnOf({ router: { outcome: { agent: { path: 'C4' } } } })).toBeUndefined(); expect(agentTurnOf({ router: null })).toBeUndefined();
    expect(AGENT_PATHS).toEqual(['AGENT', 'C4_FALLBACK', 'C4_SKIPPED']);
  });
  it('the V9/V11/V12 codes are codes of the validator', () => {
    for (const codes of Object.values(AGENT_RULE_CODES)) for (const code of codes) expect(AGENT_VALIDATOR_CODES as readonly string[]).toContain(code);
  });
});

describe('Golden runner, C5 agent arm', () => {
  it('admits 3 requests per turn only when the prepared flags say agent; the calls-per-message alarm is 1.5', () => {
    expect([freeUseAgentArm({ SALON_SECRETARY_AGENT: 'true' }), freeUseAgentArm({ SALON_SECRETARY_AGENT: 'false' }), freeUseAgentArm({})]).toEqual([true, false, false]);
    expect([freeUseRequestsPerTurn(true), freeUseRequestsPerTurn(false)]).toEqual([3, 2]);
    expect(FREE_USE_AGENT_ALARM_CALLS_PER_MESSAGE).toBe(1.5);
  });
});

describe('agenda practice, C5: ids file', () => {
  it('reads a JSON list or one id per line, refuses anything else and selects in the files\' order', () => {
    const dir = tempDir(), json = join(dir, 'ids.json'), lines = join(dir, 'ids.txt'), bad = join(dir, 'bad.txt');
    writeFileSync(json, '["B2","A1"]'); writeFileSync(lines, '\uFEFF# estratos afetados\nB2\r\nA1  # comentário\n\n');
    expect(readScenarioIds(json)).toEqual(['B2', 'A1']); expect(readScenarioIds(lines)).toEqual(['B2', 'A1']);
    for (const text of ['["A1","A1"]', '["1abc"]', '[]', '{"ids":["A1"]}', 'A1\numa frase qualquer', '']) { writeFileSync(bad, text); expect(() => readScenarioIds(bad)).toThrow('AGENDA_IDS_FILE'); }
    expect(() => readScenarioIds(join(dir, 'ausente.txt'))).toThrow('AGENDA_IDS_FILE');
    const all = [{ id: 'A1' }, { id: 'B2' }, { id: 'C3' }];
    expect(selectScenarioIds(all, ['B2', 'A1']).map(s => s.id)).toEqual(['A1', 'B2']);
    try { selectScenarioIds(all, ['A1', 'Z9', 'Y8']); expect.unreachable(); }
    catch (e) { expect((e as Error).message).toBe('AGENDA_UNKNOWN_SCENARIO'); expect((e as { details: unknown }).details).toEqual({ unknown: 2 }); }
  });
});
