import { afterEach, describe, expect, it, vi } from 'vitest';
import { spawn, spawnSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import { copyFileSync, existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, unlinkSync, writeFileSync } from 'node:fs';
import { join, relative, resolve } from 'node:path';
import { tmpdir, userInfo } from 'node:os';
import {
  PROGRAM_CAP_HISTORY, PROGRAM_SPEND_WALLETS, PROGRAM_REAL_CAP_MICRO_USD, PROGRAM_REAL_CAP_USD, PROGRAM_SPEND_ANCHOR_FILE, PROGRAM_SPEND_BASENAME, PROGRAM_SPEND_FILE, assertProgramHeadroom, formatProgramSpend, guardPaidFetch,
  programSpendEstimator, programSpendLabel, programSpendLedgerPath, programSpendTotals, readProgramLedger, reserveProgramSpend, responsesEstimator, responsesUsageMicroUsd, settleProgramSpend,
  worstCaseMicroUsd, type PaidEstimator,
} from '../../../packages/salon-secretary/evaluation/program-spend';
import { reservationMicroUsd } from '../../../packages/salon-secretary/evaluation/agenda-practice-lib';
import { FreeUseBudget, digest } from '../../../packages/salon-secretary/evaluation/free-use-budget';

// Offline only: temporary ledgers and fake fetch functions; the network and the real program ledger are never touched.
const url = 'https://api.openai.com/v1/responses';
// Instructions sized like a real Luna request, so the synthetic usage below (20 000 input tokens) respects the sealed bound.
const payload = (maxOutput = 8192, extra = '') => JSON.stringify({ model: 'gpt-6-luna', instructions: 'synthetic instructions ' + 'x'.repeat(12_000) + extra, input: [{ role: 'user', content: 'synthetic message' }],
  tools: [{ type: 'function', name: 'upsert_action_draft', parameters: { type: 'object' }, strict: true }], tool_choice: { type: 'function', name: 'upsert_action_draft' },
  parallel_tool_calls: false, max_output_tokens: maxOutput, store: false, stream: false, include: [] });
const wire = (body = payload()) => ({ method: 'POST', body });
const usageResponse = (usage: unknown, status = 200) => new Response(JSON.stringify({ id: 'resp_synthetic', output: [{ type: 'function_call', arguments: '{}' }], usage }), { status, headers: { 'content-type': 'application/json' } });
const lunaUsage = { input_tokens: 20_000, input_tokens_details: { cached_tokens: 5_000 }, output_tokens: 700, output_tokens_details: { reasoning_tokens: 300 } };
const directories: string[] = [];
const ledgerIn = () => { const directory = mkdtempSync(join(tmpdir(), 'program-spend-')); directories.push(directory); return join(directory, PROGRAM_SPEND_BASENAME); };
const lines = (file: string) => existsSync(file) ? readFileSync(file, 'utf8').split('\n').filter(Boolean).map(line => JSON.parse(line)) : [];
const fileState = (file: string) => existsSync(file) ? createHash('sha256').update(readFileSync(file)).digest('hex') : 'ABSENT';
/** A declared-bound estimator (as a transcription path would bring): lets a test move the ledger total in one call. */
const fixed = (micro: number): PaidEstimator => ({ name: 'test-fixed', actual: () => null,
  worstCase: () => ({ estimator: 'test-fixed', model: 'synthetic', bodyBytes: 1, maxOutputTokens: 1, worstCaseMicroUsd: micro, pricingSha256: 'synthetic' }) });
async function spend(ledger: string, micro: number, run = 'seed') {
  await guardPaidFetch('transcribe', async () => new Response('unavailable', { status: 503 }), { ledger, run, estimator: fixed(micro) })('https://example.invalid/synthetic', { method: 'POST', body: 'x' });
}
const rehash = (row: Record<string, unknown>) => { const { rowHash: _old, ...body } = row; void _old; return { ...body, rowHash: digest(JSON.stringify(body)) }; };
const writeRows = (file: string, rows: unknown[]) => writeFileSync(file, rows.map(row => JSON.stringify(row) + '\n').join(''));
afterEach(() => { vi.unstubAllEnvs(); for (const directory of directories.splice(0)) rmSync(directory, { recursive: true, force: true }); });

describe('program real-spend cap: constants and pricing', () => {
  it('fixes one ledger and a USD 16.00 cap (the last entry of a fixed, increasing history), with the same worst-case formula as the stage and mission journals', () => {
    expect(PROGRAM_REAL_CAP_USD).toBe(16); expect(PROGRAM_REAL_CAP_MICRO_USD).toBe(16_000_000);
    // Owner decisions: US$ 2.50 on 27/09/2026, raised in chat to US$ 3.50 on 28/09/2026, to US$ 6.00 on 29/09/2026 (Candidate 4), to US$ 8.00
    // on 29/09/2026 (+US$ 2, Candidate 4 proof) and to US$ 15.00 on 29/09/2026 (Candidate 4 proof headroom). Fixed in code, frozen.
    expect(PROGRAM_CAP_HISTORY).toEqual([{ microUsd: 2_500_000, approved: '2026-09-27', note: 'initial' }, { microUsd: 3_500_000, approved: '2026-09-28', note: 'owner raise in chat' },
      { microUsd: 6_000_000, approved: '2026-09-29', note: 'owner raise in chat (Candidate 4)' },
      { microUsd: 8_000_000, approved: '2026-09-29', note: 'owner raise in chat (+US$2, Candidate 4 proof)' },
      { microUsd: 15_000_000, approved: '2026-09-29', note: 'owner raise in chat (US$15, Candidate 4 proof headroom)' },
      // 04/10/2026 (in chat): +US$ 1 to certify GPT-6 Luna as the plan B reserve.
      { microUsd: 16_000_000, approved: '2026-10-04', note: 'owner raise in chat (+US$1, certify GPT-6 Luna as the plan B reserve)' }]);
    expect(Object.isFrozen(PROGRAM_CAP_HISTORY)).toBe(true); expect(PROGRAM_CAP_HISTORY.every(entry => Object.isFrozen(entry))).toBe(true);
    // One ledger per machine account, outside every checkout and worktree (not in the gitignored results/ folder).
    expect(PROGRAM_SPEND_FILE).toBe('~/.everflair-secretary/program-spend-20260927.jsonl');
    expect(programSpendLedgerPath()).toBe(join(userInfo().homedir, '.everflair-secretary', PROGRAM_SPEND_BASENAME));
    expect(relative(process.cwd(), programSpendLedgerPath())).toMatch(/^\.\.|^[A-Za-z]:/);
    expect(PROGRAM_SPEND_ANCHOR_FILE).toBe('packages/salon-secretary/evaluation/program-spend-anchor.json');
    for (const [bytes, out] of [[1, 1], [30_000, 1200], [40_000, 8192], [55_808, 8192]]) expect(worstCaseMicroUsd(bytes, out)).toBe(reservationMicroUsd(bytes, out));
    const body = payload(), directory = mkdtempSync(join(tmpdir(), 'program-spend-')); directories.push(directory);
    const reserved = new FreeUseBudget(join(directory, 'mission.jsonl'), 'binding', 1).reserve('case', 1, url, wire(body)).reservedMicroUsd;
    expect(responsesEstimator.worstCase(url, wire(body)).worstCaseMicroUsd).toBe(reserved);
    expect(reserved).toBe(worstCaseMicroUsd(Buffer.byteLength(body), 8192));
  });
  it('prices actual usage conservatively: cached input at the full input rate (no cache-read price sealed), uncached at the cache-write rate', () => {
    expect(responsesUsageMicroUsd({ input: 20_000, cached: 5_000, output: 700, reasoning: 300 })).toBe(Math.ceil(15_000 * 0.125 + 5_000 * 0.10 + 700 * 0.5));
    expect(responsesUsageMicroUsd({ input: 1_000, cached: 1_000, output: 0, reasoning: 0 })).toBe(100);
    // Reasoning is part of output_tokens; a provider reporting it above output is charged for both.
    expect(responsesUsageMicroUsd({ input: 0, cached: 0, output: 100, reasoning: 400 })).toBe(250);
    expect(responsesEstimator.actual({ usage: lunaUsage })).toEqual({ usage: { input: 20_000, cached: 5_000, output: 700, reasoning: 300 }, chargedMicroUsd: 2_725 });
    for (const usage of [undefined, {}, { input_tokens: 10 }, { input_tokens: 10, output_tokens: -1 }, { input_tokens: 10, output_tokens: 1, input_tokens_details: { cached_tokens: 11 } },
      { input_tokens: 1.5, output_tokens: 1 }, { input_tokens: '10', output_tokens: 1 }]) expect(responsesEstimator.actual({ usage })).toBeNull();
  });
  it('fails closed on a wire it cannot bound and on invalid sources, labels, estimators or ledger names', async () => {
    const ledger = ledgerIn(), network = vi.fn(async () => usageResponse(lunaUsage));
    const paid = guardPaidFetch('practice', network, { ledger, run: 'practice:unit' });
    for (const [input, init] of [['https://api.openai.com/v1/other', wire()], [url, { method: 'GET', body: payload() }], [url, { method: 'POST' }], [url, { method: 'POST', body: 'not json' }],
      [url, wire(payload(8193))], [url, wire(payload(8192).replace('gpt-6-luna', 'gpt-other'))], [url, wire(payload(8192, 'x'.repeat(56_000)))]] as const)
      await expect(paid(input, init as RequestInit)).rejects.toThrow('PROGRAM_SPEND_WIRE');
    expect(network).not.toHaveBeenCalled(); expect(existsSync(ledger)).toBe(false);
    expect(() => guardPaidFetch('other' as never, network, { ledger, run: 'x' })).toThrow('PROGRAM_SPEND_SOURCE');
    expect(() => guardPaidFetch('golden', network, { ledger, run: 'bad label with spaces' })).toThrow('PROGRAM_SPEND_LABEL');
    expect(() => guardPaidFetch('golden', network, { ledger: join(ledger, '..', 'other.jsonl'), run: 'x' })).toThrow('PROGRAM_SPEND_CONFIG');
    expect(() => guardPaidFetch('transcribe', network, { ledger, run: 'x', estimator: { ...fixed(1), name: 'responses' } })).toThrow('PROGRAM_SPEND_ESTIMATOR');
    expect(programSpendLabel('golden:suite with spaces/../x')).toBe('golden:suite_with_spaces_.._x'); expect(programSpendLabel('#x')).toBe('x#x');
  });
  it('never charges nor locks the real repository ledger from a unit test', async () => {
    const real = programSpendLedgerPath(), before = fileState(real), network = vi.fn(async () => usageResponse(lunaUsage));
    const anchor = resolve(PROGRAM_SPEND_ANCHOR_FILE), anchorBefore = fileState(anchor);
    await expect(guardPaidFetch('practice', network, { run: 'practice:unit' })(url, wire())).rejects.toThrow('PROGRAM_SPEND_TEST_LEDGER');
    await expect(assertProgramHeadroom(url, wire(), { ledger: real })).rejects.toThrow('PROGRAM_SPEND_TEST_LEDGER');
    expect(network).not.toHaveBeenCalled(); expect(fileState(real)).toBe(before); expect(existsSync(real + '.lock')).toBe(false);
    expect(fileState(anchor)).toBe(anchorBefore);
  });
});

describe('program real-spend cap: admission before transport', () => {
  it('admits a call that exactly fits and blocks the next one before transport, leaving the ledger untouched', async () => {
    const ledger = ledgerIn(), body = payload(), worst = worstCaseMicroUsd(Buffer.byteLength(body), 8192);
    await spend(ledger, PROGRAM_REAL_CAP_MICRO_USD - worst);
    const network = vi.fn(async () => usageResponse(lunaUsage)), paid = guardPaidFetch('practice', network, { ledger, run: 'practice:unit', item: 'A01#k1:s1' });
    expect(await assertProgramHeadroom(url, wire(body), { ledger })).toEqual({ spentMicroUsd: PROGRAM_REAL_CAP_MICRO_USD - worst, worstCaseMicroUsd: worst, remainingMicroUsd: worst });
    await paid(url, wire(body));
    expect(network).toHaveBeenCalledTimes(1);
    const before = fileState(ledger);
    await expect(paid(url, wire(body))).rejects.toThrow('PROGRAM_SPEND_CAP');
    await expect(assertProgramHeadroom(url, wire(body), { ledger })).rejects.toThrow('PROGRAM_SPEND_CAP');
    expect(network).toHaveBeenCalledTimes(1); expect(fileState(ledger)).toBe(before); expect(existsSync(ledger + '.lock')).toBe(false);
    const totals = programSpendTotals(ledger);
    expect(totals).toMatchObject({ spentMicroUsd: PROGRAM_REAL_CAP_MICRO_USD - worst + 2_725, remainingMicroUsd: worst - 2_725, calls: 2, open: 0 });
    expect(totals.remainingMicroUsd).toBeLessThan(worst);
  });
  it('counts an in-flight or crashed reservation at its worst case until it is settled', async () => {
    const ledger = ledgerIn(), estimate = responsesEstimator.worstCase(url, wire());
    const reservation = await reserveProgramSpend(ledger, 'golden', 'golden:unit', 'GF01#k1:t1', estimate);
    expect(programSpendTotals(ledger)).toMatchObject({ spentMicroUsd: estimate.worstCaseMicroUsd, open: 1, calls: 1 });
    await settleProgramSpend(ledger, reservation, { outcome: 'USAGE', httpStatus: 200, usage: { input: 1_000, cached: 0, output: 10, reasoning: 0 }, chargedMicroUsd: 130 });
    expect(programSpendTotals(ledger)).toMatchObject({ spentMicroUsd: 130, open: 0 });
    await expect(settleProgramSpend(ledger, reservation, { outcome: 'FAILED', httpStatus: null })).rejects.toThrow('PROGRAM_SPEND_SETTLE');
    // A charge that does not match the sealed pricing is refused before it is written.
    const second = await reserveProgramSpend(ledger, 'golden', 'golden:unit', 'GF01#k1:t2', estimate);
    await expect(settleProgramSpend(ledger, second, { outcome: 'USAGE', httpStatus: 200, usage: { input: 1_000, cached: 0, output: 10, reasoning: 0 }, chargedMicroUsd: 1 })).rejects.toThrow('PROGRAM_SPEND_JOURNAL');
    expect(readProgramLedger(ledger)).toHaveLength(3);
  });
});

describe('program real-spend cap: settlement after the response', () => {
  it('appends the actual cost from usage and keeps the response readable by the caller', async () => {
    const ledger = ledgerIn(), body = payload(), network = vi.fn(async () => usageResponse(lunaUsage));
    const response = await guardPaidFetch('practice', network, { ledger, run: 'practice:2026-09-27T12-00-00-000Z-unit', item: 'A01#k1:s1' })(url, wire(body));
    expect((await response.json()).output[0].type).toBe('function_call');
    const [reserve, settle] = lines(ledger);
    expect(reserve).toMatchObject({ ledger: 'program-spend-20260927', kind: 'RESERVE', seq: 0, source: 'practice', run: 'practice:2026-09-27T12-00-00-000Z-unit', item: 'A01#k1:s1',
      estimator: 'responses', model: 'gpt-6-luna', bodyBytes: Buffer.byteLength(body), maxOutputTokens: 8192, worstCaseMicroUsd: worstCaseMicroUsd(Buffer.byteLength(body), 8192),
      capMicroUsd: 16_000_000, spentBeforeMicroUsd: 0, previousHash: 'GENESIS' });
    expect(settle).toMatchObject({ kind: 'SETTLE', seq: 1, id: reserve.id, outcome: 'USAGE', httpStatus: 200, usage: { input: 20_000, cached: 5_000, output: 700, reasoning: 300 },
      chargedMicroUsd: 2_725, previousHash: reserve.rowHash });
    expect(readFileSync(ledger, 'utf8')).not.toMatch(/synthetic message|synthetic instructions|function_call/);
    const totals = programSpendTotals(ledger);
    expect(totals).toMatchObject({ spentMicroUsd: 2_725, spentUsd: 0.002725, remainingMicroUsd: 15_997_275, calls: 1, open: 0, worstCaseCharged: 0 });
    expect(totals.bySource).toMatchObject({ practice: { calls: 1, spentMicroUsd: 2_725 }, golden: { calls: 0, spentMicroUsd: 0 }, transcribe: { calls: 0, spentMicroUsd: 0 } });
    expect(totals.byRun['practice:2026-09-27T12-00-00-000Z-unit']).toMatchObject({ source: 'practice', calls: 1, spentMicroUsd: 2_725 });
  });
  it('charges the full worst case when transport fails, the HTTP status is an error or usage is missing/invalid', async () => {
    const ledger = ledgerIn(), body = payload(1200), worst = worstCaseMicroUsd(Buffer.byteLength(body), 1200);
    const outcomes: [string, () => Promise<Response>][] = [
      ['thrown', async () => { throw Error('SYNTHETIC_NETWORK_DOWN'); }],
      ['http500', async () => usageResponse(lunaUsage, 500)],
      ['nousage', async () => new Response(JSON.stringify({ id: 'resp_synthetic', output: [] }), { status: 200 })],
      ['badusage', async () => usageResponse({ input_tokens: 10, output_tokens: 1, input_tokens_details: { cached_tokens: 99 } })],
      ['notjson', async () => new Response('<html>', { status: 200 })],
    ];
    for (const [item, network] of outcomes) {
      const call = guardPaidFetch('golden', network, { ledger, run: 'golden:unit', item })(url, wire(body));
      if (item === 'thrown') await expect(call).rejects.toThrow('SYNTHETIC_NETWORK_DOWN'); else await call;
    }
    const settles = lines(ledger).filter(row => row.kind === 'SETTLE');
    expect(settles.map(row => [row.outcome, row.httpStatus, row.usage, row.chargedMicroUsd])).toEqual([
      ['FAILED', null, null, worst], ['FAILED', 500, null, worst], ['NO_USAGE', 200, null, worst], ['NO_USAGE', 200, null, worst], ['NO_USAGE', 200, null, worst]]);
    expect(programSpendTotals(ledger)).toMatchObject({ spentMicroUsd: 5 * worst, calls: 5, open: 0, worstCaseCharged: 5 });
  });
});

describe('program real-spend cap: hash-chained, append-only ledger', () => {
  it('rejects any edited, re-hashed, reordered, truncated, foreign or partial row, and blocks admission on a corrupt ledger', async () => {
    const ledger = ledgerIn(), network = vi.fn(async () => usageResponse(lunaUsage));
    const paid = guardPaidFetch('golden', network, { ledger, run: 'golden:unit' });
    await paid(url, wire()); await spend(ledger, 10_000, 'practice-seed'); await paid(url, wire());
    const rows = lines(ledger), good = readFileSync(ledger, 'utf8');
    expect(readProgramLedger(ledger)).toHaveLength(6);
    const corrupt = (mutate: (list: Record<string, unknown>[]) => unknown[] | string) => {
      const next = mutate(rows.map(row => ({ ...row })));
      if (typeof next === 'string') writeFileSync(ledger, next); else writeRows(ledger, next);
      expect(() => readProgramLedger(ledger)).toThrow('PROGRAM_SPEND_JOURNAL');
      writeFileSync(ledger, good);
    };
    corrupt(list => { list[1].chargedMicroUsd = 1; return list; });                                  // edited, hash no longer matches
    corrupt(list => { list[1] = rehash({ ...list[1], chargedMicroUsd: 1 }); return list; });            // re-hashed: next previousHash breaks
    corrupt(list => { list[5] = rehash({ ...list[5], chargedMicroUsd: 1 }); return list; });            // re-hashed tail: usage re-pricing mismatch
    corrupt(list => { list[3] = rehash({ ...list[3], chargedMicroUsd: 1 }); return list; });            // re-hashed tail of a failed call: must be worst case
    corrupt(list => [list[0], list[2], list[1], ...list.slice(3)]);                                     // reordered
    corrupt(list => [...list.slice(0, 2), ...list.slice(4)]);                                           // a call removed (refund)
    corrupt(list => [...list, rehash({ ...list[5], seq: 6, previousHash: list[5].rowHash })]);          // duplicate settle
    corrupt(list => [...list, rehash({ ...list[4], seq: 6, id: '00000000-0000-4000-8000-000000000000', previousHash: list[5].rowHash })]); // wrong spentBefore
    corrupt(list => [...list, rehash({ ...list[4], seq: 6, ledger: 'program-spend-20260928', previousHash: list[5].rowHash })]);       // foreign ledger
    corrupt(list => [...list, rehash({ ...list[4], seq: 6, extra: 'x', previousHash: list[5].rowHash })]);                              // unknown field
    corrupt(() => good + good.split('\n')[0].slice(0, 40));                                             // half-written row
    corrupt(() => good.replace('\n', '\n\n'));                                                          // blank line
    corrupt(() => 'not json\n');
    // A reserve that would put the ledger above the cap can never be valid, even re-hashed.
    corrupt(list => [...list, rehash({ ...list[2], seq: 6, id: '00000000-0000-4000-8000-000000000001', spentBeforeMicroUsd: programSpendTotals(ledger).spentMicroUsd,
      worstCaseMicroUsd: PROGRAM_REAL_CAP_MICRO_USD, previousHash: list[5].rowHash })]);
    expect(readFileSync(ledger, 'utf8')).toBe(good); expect(readProgramLedger(ledger)).toHaveLength(6);
    writeFileSync(ledger, good.slice(0, -1));
    network.mockClear();
    await expect(paid(url, wire())).rejects.toThrow('PROGRAM_SPEND_JOURNAL');
    await expect(assertProgramHeadroom(url, wire(), { ledger })).rejects.toThrow('PROGRAM_SPEND_JOURNAL');
    expect(() => programSpendTotals(ledger)).toThrow('PROGRAM_SPEND_JOURNAL'); expect(network).not.toHaveBeenCalled();
  });
  it('reports totals per source and per run label, including the Portuguese text report', async () => {
    const ledger = ledgerIn();
    await guardPaidFetch('practice', async () => usageResponse(lunaUsage), { ledger, run: 'practice:run-a', item: 'A01#k1:s1' })(url, wire());
    await guardPaidFetch('golden', async () => usageResponse(lunaUsage), { ledger, run: 'golden:golden-free-use-30:abc', item: 'GF01#k1:t1' })(url, wire());
    await spend(ledger, 5_000, 'transcribe:voice-unit');
    const totals = programSpendTotals(ledger);
    expect(totals).toMatchObject({ calls: 3, spentMicroUsd: 2 * 2_725 + 5_000, remainingUsd: (PROGRAM_REAL_CAP_MICRO_USD - 2 * 2_725 - 5_000) / 1e6, worstCaseCharged: 1 });
    expect(Object.fromEntries(Object.entries(totals.bySource).map(([k, v]) => [k, v.spentMicroUsd]))).toEqual({ practice: 2_725, golden: 2_725, transcribe: 5_000 });
    expect(Object.keys(totals.byRun)).toEqual(['practice:run-a', 'golden:golden-free-use-30:abc', 'transcribe:voice-unit']);
    const text = formatProgramSpend(totals);
    expect(text).toContain('US$ 0.010450 de US$ 16.000000 | restante US$ 15.989550');
    expect(text).toContain('Histórico do teto: US$ 2.500000 em 2026-09-27 (initial); US$ 3.500000 em 2026-09-28 (owner raise in chat); US$ 6.000000 em 2026-09-29 (owner raise in chat (Candidate 4)); ' +
      'US$ 8.000000 em 2026-09-29 (owner raise in chat (+US$2, Candidate 4 proof)); US$ 15.000000 em 2026-09-29 (owner raise in chat (US$15, Candidate 4 proof headroom)); ' +
      'US$ 16.000000 em 2026-10-04 (owner raise in chat (+US$1, certify GPT-6 Luna as the plan B reserve))');
    for (const part of ['Por origem:', 'practice', 'golden', 'transcribe', 'Por execução:', 'golden:golden-free-use-30:abc [golden]']) expect(text).toContain(part);
  });
  // Wallets migration (04/10/2026, backup: .demo/agenda-core/contract-migration/program-spend.test.before-wallets.ts): the report
  // prints one section per wallet (OpenAI, OpenRouter); every real ledger and anchor stays untouched by a unit test.
  it('the report CLI prints the fixed ledgers read-only (one per wallet) and takes no path argument', () => {
    const cli = 'packages/salon-secretary/evaluation/program-spend-report.cjs';
    const reals = (['openai', 'openrouter'] as const).map(wallet => programSpendLedgerPath(wallet)), before = reals.map(fileState);
    const anchors = [resolve(PROGRAM_SPEND_ANCHOR_FILE), resolve(PROGRAM_SPEND_WALLETS.openrouter.anchorFile)], anchorsBefore = anchors.map(fileState);
    const json = spawnSync(process.execPath, [cli, '--json'], { encoding: 'utf8', timeout: 60_000 });
    if (json.status === 0) expect(JSON.parse(json.stdout)).toMatchObject({ openai: { ledger: 'program-spend-20260927', wallet: 'openai', capUsd: 16, capHistory: PROGRAM_CAP_HISTORY, hardStop: null },
      openrouter: { ledger: 'program-spend-openrouter-20261004', wallet: 'openrouter', capUsd: 1.4, hardStop: null } });
    else expect(json.stderr + json.stdout).toMatch(/PROGRAM_SPEND_JOURNAL|"hardStop": "PROGRAM_SPEND_/); // reported, never repaired
    expect(spawnSync(process.execPath, [cli, 'C:/elsewhere/program-spend-20260927.jsonl'], { encoding: 'utf8', timeout: 60_000 }).status).toBe(2);
    expect(reals.map(fileState)).toEqual(before); for (const real of reals) expect(existsSync(real + '.lock')).toBe(false);
    expect(anchors.map(fileState)).toEqual(anchorsBefore); // a unit test never moves a real anchor
  }, 60_000);
});

describe('program real-spend cap: exclusive lock', () => {
  it('waits for a held lock, then fails closed before transport; proceeds once the lock is released', async () => {
    const ledger = ledgerIn(), network = vi.fn(async () => usageResponse(lunaUsage)), paid = guardPaidFetch('practice', network, { ledger, run: 'practice:unit' });
    writeFileSync(ledger + '.lock', '');
    await expect(paid(url, wire())).rejects.toThrow('PROGRAM_SPEND_LOCKED');
    expect(network).not.toHaveBeenCalled(); expect(existsSync(ledger)).toBe(false);
    setTimeout(() => rmSync(ledger + '.lock'), 150);
    await paid(url, wire());
    expect(network).toHaveBeenCalledTimes(1); expect(readProgramLedger(ledger)).toHaveLength(2); expect(existsSync(ledger + '.lock')).toBe(false);
  }, 20_000);
  it('admits exactly up to the cap under concurrent calls in one process', async () => {
    const ledger = ledgerIn(), network = vi.fn(async () => new Response('unavailable', { status: 503 }));
    const paid = guardPaidFetch('transcribe', network, { ledger, run: 'transcribe:concurrent', estimator: fixed(500_000) }); // 32 x US$ 0.50 = the US$ 16 cap exactly
    const results = await Promise.allSettled(Array.from({ length: 40 }, () => paid('https://example.invalid/synthetic', { method: 'POST', body: 'x' })));
    expect(results.filter(r => r.status === 'fulfilled')).toHaveLength(32);
    expect(new Set(results.filter((r): r is PromiseRejectedResult => r.status === 'rejected').map(r => (r.reason as Error).message))).toEqual(new Set(['PROGRAM_SPEND_CAP']));
    expect(network).toHaveBeenCalledTimes(32);
    expect(programSpendTotals(ledger)).toMatchObject({ spentMicroUsd: PROGRAM_REAL_CAP_MICRO_USD, remainingMicroUsd: 0, calls: 32, open: 0 });
  }, 30_000);
  it('keeps one valid chain and never exceeds the cap with two processes racing on the same ledger', async () => {
    const ledger = ledgerIn(), script = join(ledger, '..', 'racer.cjs'), modulePath = resolve('packages/salon-secretary/evaluation/program-spend.ts');
    // The child stands in for a vitest worker (temporary ledger, test estimator): VITEST in its environment alone is not enough.
    writeFileSync(script, `'use strict';
Object.defineProperty(globalThis, '__vitest_worker__', { value: {}, configurable: true });
const m = require(process.argv[2]);
const estimator = { name: 'test-fixed', actual: () => null, worstCase: () => ({ estimator: 'test-fixed', model: 'synthetic', bodyBytes: 1, maxOutputTokens: 1, worstCaseMicroUsd: 500000, pricingSha256: 'synthetic' }) };
(async () => {
  const paid = m.guardPaidFetch('transcribe', async () => new Response('unavailable', { status: 503 }), { ledger: process.argv[3], run: 'transcribe:race', item: process.argv[4], estimator });
  let admitted = 0, code = null;
  for (let i = 0; i < 40 && !code; i++) { try { await paid('https://example.invalid/synthetic', { method: 'POST', body: 'x' }); admitted++; } catch (e) { code = e.message; } }
  process.stdout.write(JSON.stringify({ admitted, code }));
})();
`);
    const race = (name: string) => new Promise<{ admitted: number; code: string }>((done, fail) => {
      const child = spawn(process.execPath, ['--require', 'tsx/cjs', script, modulePath, ledger, name], { cwd: process.cwd(), stdio: ['ignore', 'pipe', 'pipe'] });
      let out = '', err = ''; child.stdout.on('data', d => { out += d; }); child.stderr.on('data', d => { err += d; });
      child.on('error', fail); child.on('close', status => status === 0 ? done(JSON.parse(out)) : fail(Error(`racer ${name} exited ${status}: ${err.slice(0, 400)}`)));
    });
    const [a, b] = await Promise.all([race('p1'), race('p2')]);
    expect(a.admitted + b.admitted).toBe(32); expect([a.code, b.code]).toEqual(['PROGRAM_SPEND_CAP', 'PROGRAM_SPEND_CAP']);
    const rows = readProgramLedger(ledger);
    expect(rows).toHaveLength(64); expect(rows.map(row => row.seq)).toEqual(rows.map((_, index) => index));
    expect(rows.filter(row => row.kind === 'RESERVE').map(row => (row as { item: string }).item).sort()).toEqual([...Array(a.admitted).fill('p1'), ...Array(b.admitted).fill('p2')]);
    expect(programSpendTotals(ledger)).toMatchObject({ spentMicroUsd: PROGRAM_REAL_CAP_MICRO_USD, calls: 32, open: 0 }); expect(existsSync(ledger + '.lock')).toBe(false);
  }, 90_000);
});

describe('program real-spend cap: one ledger per machine account, externally anchored', () => {
  const anchorOf = (ledger: string) => join(ledger, '..', 'program-spend-20260927.anchor.json');
  it('refuses any other ledger path outside unit tests (no fresh ledger through an option)', async () => {
    const ledger = ledgerIn(), network = vi.fn(async () => usageResponse(lunaUsage));
    vi.stubEnv('VITEST', '');
    expect(() => guardPaidFetch('practice', network, { ledger, run: 'practice:unit' })).toThrow('PROGRAM_SPEND_CONFIG');
    await expect(assertProgramHeadroom(url, wire(), { ledger })).rejects.toThrow('PROGRAM_SPEND_CONFIG');
    await expect(reserveProgramSpend(ledger, 'practice', 'practice:unit', 'x', responsesEstimator.worstCase(url, wire()))).rejects.toThrow('PROGRAM_SPEND_CONFIG');
    expect(() => programSpendTotals(ledger)).toThrow('PROGRAM_SPEND_CONFIG');
    expect(network).not.toHaveBeenCalled(); expect(existsSync(ledger)).toBe(false);
  });
  it('pins genesis and last row in the anchor: a deleted, truncated or replaced ledger fails closed instead of reading as zero', async () => {
    const ledger = ledgerIn(), anchor = anchorOf(ledger), network = vi.fn(async () => usageResponse(lunaUsage));
    const paid = guardPaidFetch('golden', network, { ledger, run: 'golden:unit' });
    await paid(url, wire()); await spend(ledger, 8_000); await paid(url, wire());
    const rows = lines(ledger), good = readFileSync(ledger, 'utf8'), pinned = JSON.parse(readFileSync(anchor, 'utf8'));
    expect(pinned).toEqual({ ledger: 'program-spend-20260927', genesisId: rows[0].id, genesisHash: rows[0].rowHash, seq: 5, rowHash: rows[5].rowHash });
    const blocked = async () => {
      expect(() => readProgramLedger(ledger)).toThrow('PROGRAM_SPEND_JOURNAL'); expect(() => programSpendTotals(ledger)).toThrow('PROGRAM_SPEND_JOURNAL');
      await expect(paid(url, wire())).rejects.toThrow('PROGRAM_SPEND_JOURNAL'); await expect(assertProgramHeadroom(url, wire(), { ledger })).rejects.toThrow('PROGRAM_SPEND_JOURNAL');
    };
    network.mockClear();
    unlinkSync(ledger); await blocked();                                                    // deleted ledger: never a fresh cap
    writeRows(ledger, rows.slice(0, 4)); await blocked();                                   // last RESERVE+SETTLE pair dropped (still a valid chain)
    const other = ledgerIn(); await spend(other, 1_000); writeFileSync(ledger, readFileSync(other)); await blocked(); // another genesis
    expect(network).not.toHaveBeenCalled(); expect(JSON.parse(readFileSync(anchor, 'utf8'))).toEqual(pinned);
    writeFileSync(ledger, good); expect(readProgramLedger(ledger)).toHaveLength(6);
    for (const broken of ['not json', JSON.stringify({ ...pinned, seq: -1 }), JSON.stringify({ ...pinned, extra: 1 })]) {
      writeFileSync(anchor, broken); expect(() => readProgramLedger(ledger)).toThrow('PROGRAM_SPEND_JOURNAL');
    }
    writeFileSync(anchor, JSON.stringify({ ...pinned, seq: 1, rowHash: rows[1].rowHash }));   // a lagging anchor is valid and only moves forward
    expect(programSpendTotals(ledger).rows).toBe(6);
    await paid(url, wire());
    expect(JSON.parse(readFileSync(anchor, 'utf8'))).toMatchObject({ genesisId: rows[0].id, seq: 7 });
  });
  // 29/09: a sealed run aborted when Windows held the anchor for more than the old 200 ms retry budget, although the
  // charge had already reached the ledger. The anchor is a floor: a move that cannot land is deferred, never a failure.
  it('an anchor move blocked by a sharing error is retried with backoff and, if it never lands, deferred (the ledger stays valid)', async () => {
    const { advanceProgramAnchorForTest, RENAME_RETRY_ATTEMPTS, renameRetryPause } = await import('../../../packages/salon-secretary/evaluation/program-spend');
    expect(Array.from({ length: RENAME_RETRY_ATTEMPTS - 1 }, (_, i) => renameRetryPause(i + 1)).reduce((a, b) => a + b, 0)).toBeGreaterThanOrEqual(5_000);
    const ledger = ledgerIn(), anchor = anchorOf(ledger);
    await spend(ledger, 1_000);
    const pinned = readFileSync(anchor, 'utf8');
    await spend(ledger, 1_000);
    writeFileSync(anchor, pinned); // lagging again
    const sharing = (code: string) => Object.assign(Error(code), { code });
    const stderr = vi.spyOn(process.stderr, 'write').mockImplementation(() => true);
    try {
      // A non-transient failure is deferred at once: no throw, anchor unchanged (lagging), no temporary file left.
      advanceProgramAnchorForTest(ledger, () => { throw sharing('ENOSPC'); });
      expect(readFileSync(anchor, 'utf8')).toBe(pinned);
      expect(existsSync(`${anchor}.${process.pid}.tmp`)).toBe(false);
      expect(stderr).toHaveBeenCalledWith('PROGRAM_SPEND_ANCHOR_DEFERRED\n');
      expect(readProgramLedger(ledger)).toHaveLength(4);
      // A transient sharing error lands after the backoff.
      let calls = 0;
      advanceProgramAnchorForTest(ledger, (from, to) => { if (++calls < 3) throw sharing('EPERM'); copyFileSync(from, to); unlinkSync(from); });
      expect(calls).toBe(3);
      expect(JSON.parse(readFileSync(anchor, 'utf8'))).toMatchObject({ seq: 3 });
    } finally { stderr.mockRestore(); }
  });
  it('the real ledger needs the checkout anchor: without it every read fails closed, so deleting ledger and anchor never starts a fresh cap', () => {
    // Read-only children (no lock, no row, no anchor move) run from a synthetic checkout root that ships the module marker.
    const real = programSpendLedgerPath(), before = fileState(real), realAnchor = resolve(PROGRAM_SPEND_ANCHOR_FILE), anchorBefore = fileState(realAnchor);
    const root = mkdtempSync(join(tmpdir(), 'program-spend-checkout-')); directories.push(root);
    mkdirSync(join(root, 'packages', 'salon-secretary', 'evaluation'), { recursive: true });
    writeFileSync(join(root, 'packages', 'salon-secretary', 'evaluation', 'program-spend.ts'), '// checkout marker\n');
    const script = join(root, 'reader.cjs'), modulePath = resolve('packages/salon-secretary/evaluation/program-spend.ts');
    writeFileSync(script, `'use strict';
process.chdir(process.argv[3]);
const m = require(process.argv[2]);
const run = f => { for (let attempt = 1; ; attempt++) { try { return f(); } catch (e) { if (e.message !== 'PROGRAM_SPEND_JOURNAL' || attempt >= 3) return e.message; Atomics.wait(new Int32Array(new SharedArrayBuffer(4)), 0, 0, 200); } } };
process.stdout.write(JSON.stringify({ read: run(() => m.readProgramLedger(m.programSpendLedgerPath()).length), totals: run(() => m.programSpendTotals(m.programSpendLedgerPath()).rows) }));
`);
    const read = () => {
      const child = spawnSync(process.execPath, ['--require', 'tsx/cjs', script, modulePath, root], { cwd: process.cwd(), encoding: 'utf8', timeout: 60_000 });
      expect(child.status, child.stderr.slice(0, 400)).toBe(0); return JSON.parse(child.stdout);
    };
    expect(read()).toEqual({ read: 'PROGRAM_SPEND_JOURNAL', totals: 'PROGRAM_SPEND_JOURNAL' });                // no anchor: fail closed, never zero
    if (existsSync(real) && existsSync(realAnchor)) {                                                          // control: the same child reads once the anchor is there
      copyFileSync(realAnchor, join(root, PROGRAM_SPEND_ANCHOR_FILE));
      const { read: rows, totals } = read();
      expect(typeof rows).toBe('number'); expect(rows).toBeGreaterThan(0); expect(totals).toBeGreaterThanOrEqual(rows); // a running battery may append
    }
    expect(fileState(real)).toBe(before); expect(existsSync(real + '.lock')).toBe(false); expect(fileState(realAnchor)).toBe(anchorBefore);
  }, 120_000);
});

describe('program real-spend cap: sealed Luna wire and sealed bound', () => {
  it('bounds only the text-only Luna wire: server state, priority tier, hosted tools, media, background and reasoning fail closed', async () => {
    const ledger = ledgerIn(), network = vi.fn(async () => usageResponse(lunaUsage)), paid = guardPaidFetch('practice', network, { ledger, run: 'practice:unit' });
    const base = JSON.parse(payload());
    for (const change of [{ service_tier: 'priority' }, { previous_response_id: 'resp_synthetic', store: true }, { store: true }, { background: true }, { reasoning: { effort: 'high' } },
      { tools: [{ type: 'web_search' }] }, { tools: [...base.tools, { type: 'function', name: 'select_capabilities', parameters: { type: 'object' } }] },
      { input: [{ role: 'user', content: [{ type: 'input_image', image_url: 'https://example.invalid/x.png' }] }] }, { input: [{ type: 'item_reference', id: 'msg_synthetic' }] },
      { model: 'gpt-5.6-luna' }]) {
      await expect(paid(url, wire(JSON.stringify({ ...base, ...change }))), JSON.stringify(change)).rejects.toThrow('PROGRAM_SPEND_WIRE');
      await expect(assertProgramHeadroom(url, wire(JSON.stringify({ ...base, ...change })), { ledger })).rejects.toThrow('PROGRAM_SPEND_WIRE');
    }
    expect(network).not.toHaveBeenCalled(); expect(existsSync(ledger)).toBe(false);
  });
  it('a usage beyond the sealed bound is charged in full, stops the run and blocks every later admission (hard stop)', async () => {
    const ledger = ledgerIn(), body = payload(1200), bytes = Buffer.byteLength(body);
    const huge = { input_tokens: 129_000_000, input_tokens_details: { cached_tokens: 0 }, output_tokens: 10, output_tokens_details: { reasoning_tokens: 0 } };
    const network = vi.fn(async () => usageResponse(huge)), paid = guardPaidFetch('golden', network, { ledger, run: 'golden:unit' });
    await expect(paid(url, wire(body))).rejects.toThrow('PROGRAM_SPEND_BOUND');
    const settle = lines(ledger)[1];
    expect(settle).toMatchObject({ kind: 'SETTLE', outcome: 'USAGE', chargedMicroUsd: responsesUsageMicroUsd({ input: 129_000_000, cached: 0, output: 10, reasoning: 0 }) });
    const totals = programSpendTotals(ledger);
    expect(totals).toMatchObject({ hardStop: 'PROGRAM_SPEND_BOUND', boundBreaches: 1, overCap: true, calls: 1, open: 0 });
    expect(totals.spentMicroUsd).toBeGreaterThan(PROGRAM_REAL_CAP_MICRO_USD); expect(totals.remainingMicroUsd).toBeLessThan(0);
    expect(formatProgramSpend(totals)).toMatch(/^PARADA OBRIGATÓRIA \(PROGRAM_SPEND_BOUND\): 1 chamada\(s\) custaram acima do pior caso selado e o gasto passou do teto/);
    network.mockClear(); const before = fileState(ledger);
    await expect(paid(url, wire())).rejects.toThrow('PROGRAM_SPEND_BOUND');
    await expect(assertProgramHeadroom(url, wire(), { ledger })).rejects.toThrow('PROGRAM_SPEND_BOUND');
    await expect(spend(ledger, 1)).rejects.toThrow('PROGRAM_SPEND_BOUND');
    expect(network).not.toHaveBeenCalled(); expect(fileState(ledger)).toBe(before);
    // A reserve after the breach can never be valid, even re-hashed into the chain.
    const rows = lines(ledger);
    writeRows(ledger, [...rows, rehash({ ...rows[0], seq: 2, id: '00000000-0000-4000-8000-000000000002', spentBeforeMicroUsd: totals.spentMicroUsd, previousHash: rows[1].rowHash })]);
    expect(() => readProgramLedger(ledger)).toThrow('PROGRAM_SPEND_JOURNAL');
    // Output above max_output_tokens is beyond the bound too, even when the ledger stays under the cap.
    const second = ledgerIn();
    const tooLong = guardPaidFetch('practice', async () => usageResponse({ input_tokens: bytes, output_tokens: 1201, output_tokens_details: { reasoning_tokens: 0 } }), { ledger: second, run: 'practice:unit' });
    await expect(tooLong(url, wire(body))).rejects.toThrow('PROGRAM_SPEND_BOUND');
    expect(programSpendTotals(second)).toMatchObject({ hardStop: 'PROGRAM_SPEND_BOUND', overCap: false, boundBreaches: 1 });
    // At the bound exactly: admitted, no breach.
    const third = ledgerIn();
    await guardPaidFetch('practice', async () => usageResponse({ input_tokens: bytes + 8192, output_tokens: 1200, output_tokens_details: { reasoning_tokens: 1200 } }), { ledger: third, run: 'practice:unit' })(url, wire(body));
    expect(programSpendTotals(third)).toMatchObject({ hardStop: null, boundBreaches: 0, calls: 1 });
  });
});

describe('program real-spend cap: sealed estimator allowlist', () => {
  it('knows only the sealed Luna estimator outside unit tests; unknown names are refused before any row', async () => {
    const sealed = programSpendEstimator('responses');
    expect(sealed).toMatchObject({ name: 'responses', models: ['gpt-6-luna'], minWorstCaseMicroUsd: worstCaseMicroUsd(1, 1) });
    expect(programSpendEstimator('whisper')).toBeNull(); expect(programSpendEstimator('test-fixed')).toBe('TEST');
    const ledger = ledgerIn(), network = vi.fn(async () => new Response('{}', { status: 200 }));
    // The probe that made the ledger blind: a caller-declared 1 µUSD bound settled at zero.
    const whisper: PaidEstimator = { name: 'whisper', worstCase: () => ({ estimator: 'whisper', model: 'whisper-1', bodyBytes: 1, maxOutputTokens: 0, worstCaseMicroUsd: 1, pricingSha256: 'x' }),
      actual: () => ({ usage: { seconds: 3600 }, chargedMicroUsd: 0 }) };
    expect(() => guardPaidFetch('transcribe', network, { ledger, run: 'transcribe:unit', estimator: whisper })).toThrow('PROGRAM_SPEND_ESTIMATOR');
    await expect(assertProgramHeadroom(url, wire(), { ledger, estimator: whisper })).rejects.toThrow('PROGRAM_SPEND_ESTIMATOR');
    await expect(reserveProgramSpend(ledger, 'transcribe', 'transcribe:unit', 'x', whisper.worstCase(url))).rejects.toThrow('PROGRAM_SPEND_ESTIMATOR');
    expect(network).not.toHaveBeenCalled(); expect(existsSync(ledger)).toBe(false);
    vi.stubEnv('VITEST', '');
    expect(programSpendEstimator('test-fixed')).toBeNull(); expect(programSpendEstimator('responses')).toBe(sealed);
    expect(() => guardPaidFetch('transcribe', network, { ledger: programSpendLedgerPath(), run: 'transcribe:unit', estimator: fixed(1) })).toThrow('PROGRAM_SPEND_ESTIMATOR');
  });
  it('a unit-test estimator is always charged at its declared worst case, and rows of unknown estimators or usage refunds never validate', async () => {
    const ledger = ledgerIn();
    const refunding: PaidEstimator = { ...fixed(40_000), actual: () => ({ usage: { seconds: 3600 }, chargedMicroUsd: 0 }) };
    await guardPaidFetch('transcribe', async () => new Response('{}', { status: 200 }), { ledger, run: 'transcribe:unit', estimator: refunding })('https://example.invalid/synthetic', { method: 'POST', body: 'x' });
    expect(lines(ledger)[1]).toMatchObject({ outcome: 'NO_USAGE', usage: null, chargedMicroUsd: 40_000 });
    expect(programSpendTotals(ledger)).toMatchObject({ spentMicroUsd: 40_000, worstCaseCharged: 1 });
    const rows = lines(ledger), good = readFileSync(ledger, 'utf8'), anchor = join(ledger, '..', 'program-spend-20260927.anchor.json');
    const check = (list: unknown[]) => { writeRows(ledger, list); rmSync(anchor, { force: true }); expect(() => readProgramLedger(ledger)).toThrow('PROGRAM_SPEND_JOURNAL'); writeFileSync(ledger, good); };
    const whisperReserve = rehash({ ...rows[0], estimator: 'whisper' });
    check([whisperReserve, rehash({ ...rows[1], previousHash: whisperReserve.rowHash })]);
    check([rows[0], rehash({ ...rows[1], outcome: 'USAGE', usage: { seconds: 3600 }, chargedMicroUsd: 0 })]);
    // A sealed reserve whose declared worst case is not the one its pricing derives is refused.
    const estimate = responsesEstimator.worstCase(url, wire());
    await expect(reserveProgramSpend(ledgerIn(), 'practice', 'practice:unit', 'x', { ...estimate, worstCaseMicroUsd: estimate.worstCaseMicroUsd - 1 })).rejects.toThrow('PROGRAM_SPEND_JOURNAL');
    await expect(reserveProgramSpend(ledgerIn(), 'practice', 'practice:unit', 'x', { ...estimate, model: 'gpt-5.6-luna' })).rejects.toThrow('PROGRAM_SPEND_JOURNAL');
  });
});

describe('program real-spend cap: auditable, monotonic cap history', () => {
  const anchorOf = (ledger: string) => join(ledger, '..', 'program-spend-20260927.anchor.json');
  /** Rewrites a chain from GENESIS (seq, previousHash, rowHash) with the given RESERVE caps, in order; drops the unit-test anchor. */
  const withCaps = (ledger: string, rows: Record<string, unknown>[], caps: unknown[]) => {
    let prior = 'GENESIS', reserve = 0;
    const next = rows.map((row, seq) => {
      const out = rehash({ ...row, seq, previousHash: prior, ...(row.kind === 'RESERVE' ? { capMicroUsd: caps[reserve++] } : {}) });
      prior = out.rowHash as string; return out;
    });
    expect(reserve).toBe(caps.length);
    writeRows(ledger, next); rmSync(anchorOf(ledger), { force: true });
  };
  const reserveCaps = (ledger: string) => lines(ledger).filter(row => row.kind === 'RESERVE').map(row => row.capMicroUsd);
  it('keeps validating rows recorded under the US$ 2.50, US$ 3.50, US$ 6.00, US$ 8.00 and US$ 15.00 caps, while every new admission records and uses US$ 16.00', async () => {
    const ledger = ledgerIn();
    await spend(ledger, 1_000_000, 'old-a'); await spend(ledger, 1_400_000, 'old-b'); await spend(ledger, 1_000_000, 'mid-a'); await spend(ledger, 1_000_000, 'c4-a');
    await spend(ledger, 3_000_000, 'c4-b'); await spend(ledger, 2_000_000, 'proof-a');
    const rows = lines(ledger);
    // The real ledger: RESERVEs of 27/09 at 2.5M, then at 3.5M after the 28/09 raise, then at 6M after the first 29/09 raise, then at 8M after the second,
    // then at 15M after the third (until the 04/10 raise to 16M).
    withCaps(ledger, rows, [2_500_000, 2_500_000, 3_500_000, 6_000_000, 8_000_000, 15_000_000]);
    expect(readProgramLedger(ledger)).toHaveLength(12); expect(reserveCaps(ledger)).toEqual([2_500_000, 2_500_000, 3_500_000, 6_000_000, 8_000_000, 15_000_000]);
    expect(programSpendTotals(ledger)).toMatchObject({ capMicroUsd: 16_000_000, capUsd: 16, spentMicroUsd: 9_400_000, remainingMicroUsd: 6_600_000, hardStop: null, overCap: false });
    // Above every old cap, within the new one: admitted, recorded at 16M, spentBefore unchanged by the migration.
    await spend(ledger, 6_000_000, 'new-a');
    const chained = lines(ledger);
    expect(chained[12]).toMatchObject({ kind: 'RESERVE', seq: 12, capMicroUsd: 16_000_000, spentBeforeMicroUsd: 9_400_000, worstCaseMicroUsd: 6_000_000, previousHash: chained[11].rowHash });
    expect(readProgramLedger(ledger)).toHaveLength(14); expect(reserveCaps(ledger)).toEqual([2_500_000, 2_500_000, 3_500_000, 6_000_000, 8_000_000, 15_000_000, 16_000_000]);
    const estimate = responsesEstimator.worstCase(url, wire());
    expect(await assertProgramHeadroom(url, wire(), { ledger })).toEqual({ spentMicroUsd: 15_400_000, worstCaseMicroUsd: estimate.worstCaseMicroUsd, remainingMicroUsd: 600_000 });
    const before = fileState(ledger);
    await expect(spend(ledger, 600_001, 'new-b')).rejects.toThrow('PROGRAM_SPEND_CAP');                // the new cap is still a hard cap
    expect(fileState(ledger)).toBe(before);
    await spend(ledger, 600_000, 'new-b');
    expect(programSpendTotals(ledger)).toMatchObject({ spentMicroUsd: PROGRAM_REAL_CAP_MICRO_USD, remainingMicroUsd: 0, hardStop: null });
    await expect(reserveProgramSpend(ledger, 'transcribe', 'transcribe:unit', 'x', fixed(1).worstCase('x'))).rejects.toThrow('PROGRAM_SPEND_CAP');
    expect(reserveCaps(ledger)).toEqual([2_500_000, 2_500_000, 3_500_000, 6_000_000, 8_000_000, 15_000_000, 16_000_000, 16_000_000]);
  });
  it('refuses a RESERVE whose recorded cap is not a value of the history, even re-hashed into the chain', async () => {
    const ledger = ledgerIn();
    await spend(ledger, 10_000); await spend(ledger, 20_000);
    const rows = lines(ledger), good = readFileSync(ledger, 'utf8');
    for (const [first, second] of [[2_500_000, 2_500_000], [2_500_000, 3_500_000], [3_500_000, 3_500_000], [2_500_000, 6_000_000], [3_500_000, 6_000_000], [6_000_000, 6_000_000],
      [2_500_000, 8_000_000], [3_500_000, 8_000_000], [6_000_000, 8_000_000], [8_000_000, 8_000_000],
      [2_500_000, 15_000_000], [3_500_000, 15_000_000], [6_000_000, 15_000_000], [8_000_000, 15_000_000], [15_000_000, 15_000_000],
      [2_500_000, 16_000_000], [3_500_000, 16_000_000], [6_000_000, 16_000_000], [8_000_000, 16_000_000], [15_000_000, 16_000_000], [16_000_000, 16_000_000]]) {
      withCaps(ledger, rows, [first, second]); expect(readProgramLedger(ledger)).toHaveLength(4);
    }
    for (const cap of [0, 1, 2_000_000, 2_499_999, 2_500_001, 3_000_000, 3_500_001, 4_500_000, 5_999_999, 6_000_001, 7_000_000, 7_999_999, 8_000_001, 10_000_000, 14_999_999,
      15_000_001, 15_999_999, 16_000_001, 1e12, -2_500_000, 2.5, 3.5, 6, 8, 15, 16, '3500000', '6000000', '8000000', '15000000', '16000000', null]) {
      for (const caps of [[cap, 3_500_000], [cap, 6_000_000], [cap, 8_000_000], [cap, 15_000_000], [cap, 16_000_000], [2_500_000, cap]]) {
        withCaps(ledger, rows, caps); expect(() => readProgramLedger(ledger), JSON.stringify(caps)).toThrow('PROGRAM_SPEND_JOURNAL');
        expect(() => programSpendTotals(ledger)).toThrow('PROGRAM_SPEND_JOURNAL');
      }
    }
    writeFileSync(ledger, good); expect(readProgramLedger(ledger)).toHaveLength(4);
  });
  it('refuses a cap that decreases along the chain, even when the spend would fit the lower cap', async () => {
    const ledger = ledgerIn();
    await spend(ledger, 10_000); await spend(ledger, 20_000); await spend(ledger, 30_000);
    const rows = lines(ledger);
    withCaps(ledger, rows, [2_500_000, 3_500_000, 3_500_000]); expect(readProgramLedger(ledger)).toHaveLength(6);
    withCaps(ledger, rows, [2_500_000, 3_500_000, 6_000_000]); expect(readProgramLedger(ledger)).toHaveLength(6);
    withCaps(ledger, rows, [3_500_000, 6_000_000, 8_000_000]); expect(readProgramLedger(ledger)).toHaveLength(6);
    withCaps(ledger, rows, [6_000_000, 8_000_000, 15_000_000]); expect(readProgramLedger(ledger)).toHaveLength(6);
    withCaps(ledger, rows, [8_000_000, 15_000_000, 16_000_000]); expect(readProgramLedger(ledger)).toHaveLength(6);
    for (const caps of [[3_500_000, 2_500_000, 2_500_000], [3_500_000, 3_500_000, 2_500_000], [2_500_000, 3_500_000, 2_500_000],
      [6_000_000, 3_500_000, 3_500_000], [2_500_000, 6_000_000, 3_500_000], [6_000_000, 6_000_000, 2_500_000],
      [8_000_000, 6_000_000, 6_000_000], [2_500_000, 8_000_000, 6_000_000], [8_000_000, 8_000_000, 3_500_000],
      [15_000_000, 8_000_000, 8_000_000], [2_500_000, 15_000_000, 8_000_000], [15_000_000, 15_000_000, 6_000_000],
      [16_000_000, 15_000_000, 15_000_000], [2_500_000, 16_000_000, 15_000_000], [16_000_000, 16_000_000, 8_000_000]]) {
      withCaps(ledger, rows, caps); expect(() => readProgramLedger(ledger), JSON.stringify(caps)).toThrow('PROGRAM_SPEND_JOURNAL');
    }
    // An old-cap row appended after the raise can never be valid, and admission is refused on the corrupt chain.
    withCaps(ledger, rows, [2_500_000, 2_500_000, 3_500_000]);
    const valid = lines(ledger), last = valid[5];
    writeRows(ledger, [...valid, rehash({ ...valid[4], seq: 6, id: '00000000-0000-4000-8000-000000000003', capMicroUsd: 2_500_000, spentBeforeMicroUsd: 60_000, previousHash: last.rowHash })]);
    expect(() => readProgramLedger(ledger)).toThrow('PROGRAM_SPEND_JOURNAL');
    await expect(spend(ledger, 1)).rejects.toThrow('PROGRAM_SPEND_JOURNAL');
    writeRows(ledger, [...valid, rehash({ ...valid[4], seq: 6, id: '00000000-0000-4000-8000-000000000003', capMicroUsd: 3_500_000, spentBeforeMicroUsd: 60_000, previousHash: last.rowHash })]);
    expect(readProgramLedger(ledger)).toHaveLength(7);
    // The same after the raise to 6M: a 3.5M row appended after a 6M row never validates.
    withCaps(ledger, rows, [2_500_000, 3_500_000, 6_000_000]);
    const raised = lines(ledger), tail = raised[5];
    writeRows(ledger, [...raised, rehash({ ...raised[4], seq: 6, id: '00000000-0000-4000-8000-000000000004', capMicroUsd: 3_500_000, spentBeforeMicroUsd: 60_000, previousHash: tail.rowHash })]);
    expect(() => readProgramLedger(ledger)).toThrow('PROGRAM_SPEND_JOURNAL');
    await expect(spend(ledger, 1)).rejects.toThrow('PROGRAM_SPEND_JOURNAL');
    writeRows(ledger, [...raised, rehash({ ...raised[4], seq: 6, id: '00000000-0000-4000-8000-000000000004', capMicroUsd: 6_000_000, spentBeforeMicroUsd: 60_000, previousHash: tail.rowHash })]);
    expect(readProgramLedger(ledger)).toHaveLength(7);
    // The same after the raise to 8M: a 6M row appended after an 8M row never validates.
    withCaps(ledger, rows, [3_500_000, 6_000_000, 8_000_000]);
    const top = lines(ledger), last8 = top[5];
    writeRows(ledger, [...top, rehash({ ...top[4], seq: 6, id: '00000000-0000-4000-8000-000000000005', capMicroUsd: 6_000_000, spentBeforeMicroUsd: 60_000, previousHash: last8.rowHash })]);
    expect(() => readProgramLedger(ledger)).toThrow('PROGRAM_SPEND_JOURNAL');
    await expect(spend(ledger, 1)).rejects.toThrow('PROGRAM_SPEND_JOURNAL');
    writeRows(ledger, [...top, rehash({ ...top[4], seq: 6, id: '00000000-0000-4000-8000-000000000005', capMicroUsd: 8_000_000, spentBeforeMicroUsd: 60_000, previousHash: last8.rowHash })]);
    expect(readProgramLedger(ledger)).toHaveLength(7);
    // The same after the raise to 15M: an 8M row appended after a 15M row never validates.
    withCaps(ledger, rows, [6_000_000, 8_000_000, 15_000_000]);
    const peak = lines(ledger), last15 = peak[5];
    writeRows(ledger, [...peak, rehash({ ...peak[4], seq: 6, id: '00000000-0000-4000-8000-000000000006', capMicroUsd: 8_000_000, spentBeforeMicroUsd: 60_000, previousHash: last15.rowHash })]);
    expect(() => readProgramLedger(ledger)).toThrow('PROGRAM_SPEND_JOURNAL');
    await expect(spend(ledger, 1)).rejects.toThrow('PROGRAM_SPEND_JOURNAL');
    writeRows(ledger, [...peak, rehash({ ...peak[4], seq: 6, id: '00000000-0000-4000-8000-000000000006', capMicroUsd: 15_000_000, spentBeforeMicroUsd: 60_000, previousHash: last15.rowHash })]);
    expect(readProgramLedger(ledger)).toHaveLength(7);
    // The same after the raise to 16M: a 15M row appended after a 16M row never validates.
    withCaps(ledger, rows, [8_000_000, 15_000_000, 16_000_000]);
    const latest = lines(ledger), last16 = latest[5];
    writeRows(ledger, [...latest, rehash({ ...latest[4], seq: 6, id: '00000000-0000-4000-8000-000000000007', capMicroUsd: 15_000_000, spentBeforeMicroUsd: 60_000, previousHash: last16.rowHash })]);
    expect(() => readProgramLedger(ledger)).toThrow('PROGRAM_SPEND_JOURNAL');
    await expect(spend(ledger, 1)).rejects.toThrow('PROGRAM_SPEND_JOURNAL');
    writeRows(ledger, [...latest, rehash({ ...latest[4], seq: 6, id: '00000000-0000-4000-8000-000000000007', capMicroUsd: 16_000_000, spentBeforeMicroUsd: 60_000, previousHash: last16.rowHash })]);
    expect(readProgramLedger(ledger)).toHaveLength(7);
  });
  it('checks each RESERVE against its own recorded cap: a row whose admission exceeded that cap never validates', async () => {
    const ledger = ledgerIn();
    await spend(ledger, 2_000_000); await spend(ledger, 1_000_000);                             // 3.0M in total: fits 3.5M, 6M, 8M, 15M and 16M only
    const rows = lines(ledger);
    expect(reserveCaps(ledger)).toEqual([16_000_000, 16_000_000]); expect(readProgramLedger(ledger)).toHaveLength(4);
    withCaps(ledger, rows, [2_500_000, 3_500_000]); expect(readProgramLedger(ledger)).toHaveLength(4);
    withCaps(ledger, rows, [2_500_000, 2_500_000]); expect(() => readProgramLedger(ledger)).toThrow('PROGRAM_SPEND_JOURNAL'); // 2.0M + 1.0M > 2.5M
    await expect(spend(ledger, 1)).rejects.toThrow('PROGRAM_SPEND_JOURNAL');
    // A row recorded at 3.5M is checked against 3.5M, not against the latest cap: exactly at it is valid, one µUSD above never validates.
    const mid = ledgerIn();
    await spend(mid, 2_000_000); await spend(mid, 1_500_000);                                   // 3.5M in total
    const midRows = lines(mid), over = midRows.map((row, index) => index === 2 ? { ...row, worstCaseMicroUsd: 1_500_001 } : index === 3 ? { ...row, chargedMicroUsd: 1_500_001 } : row);
    withCaps(mid, midRows, [2_500_000, 3_500_000]); expect(readProgramLedger(mid)).toHaveLength(4);
    withCaps(mid, over, [2_500_000, 6_000_000]); expect(readProgramLedger(mid)).toHaveLength(4);
    withCaps(mid, over, [2_500_000, 8_000_000]); expect(readProgramLedger(mid)).toHaveLength(4);
    withCaps(mid, over, [2_500_000, 15_000_000]); expect(readProgramLedger(mid)).toHaveLength(4);
    withCaps(mid, over, [2_500_000, 16_000_000]); expect(readProgramLedger(mid)).toHaveLength(4);
    for (const caps of [[2_500_000, 3_500_000], [3_500_000, 3_500_000]]) {                     // 2.0M + 1.500001M > 3.5M
      withCaps(mid, over, caps); expect(() => readProgramLedger(mid), JSON.stringify(caps)).toThrow('PROGRAM_SPEND_JOURNAL');
    }
    await expect(spend(mid, 1)).rejects.toThrow('PROGRAM_SPEND_JOURNAL');
    // A row recorded at 6M is checked against 6M, not against a later 8M, 15M or 16M cap: exactly at it is valid, one µUSD above never validates.
    const high = ledgerIn();
    await spend(high, 4_000_000); await spend(high, 2_000_000);                                 // 6.0M in total
    const highRows = lines(high), above = highRows.map((row, index) => index === 2 ? { ...row, worstCaseMicroUsd: 2_000_001 } : index === 3 ? { ...row, chargedMicroUsd: 2_000_001 } : row);
    withCaps(high, highRows, [6_000_000, 6_000_000]); expect(readProgramLedger(high)).toHaveLength(4);
    withCaps(high, above, [6_000_000, 8_000_000]); expect(readProgramLedger(high)).toHaveLength(4);
    withCaps(high, above, [6_000_000, 15_000_000]); expect(readProgramLedger(high)).toHaveLength(4);
    withCaps(high, above, [6_000_000, 16_000_000]); expect(readProgramLedger(high)).toHaveLength(4);
    withCaps(high, above, [6_000_000, 6_000_000]); expect(() => readProgramLedger(high)).toThrow('PROGRAM_SPEND_JOURNAL'); // 4.0M + 2.000001M > 6M
    await expect(spend(high, 1)).rejects.toThrow('PROGRAM_SPEND_JOURNAL');
    // A row recorded at 8M is checked against 8M, not against a later 15M or 16M cap: exactly at it is valid, one µUSD above never validates.
    const top = ledgerIn();
    await spend(top, 5_000_000); await spend(top, 3_000_000);                                   // 8.0M in total
    const topRows = lines(top), beyond = topRows.map((row, index) => index === 2 ? { ...row, worstCaseMicroUsd: 3_000_001 } : index === 3 ? { ...row, chargedMicroUsd: 3_000_001 } : row);
    withCaps(top, topRows, [8_000_000, 8_000_000]); expect(readProgramLedger(top)).toHaveLength(4);
    withCaps(top, beyond, [8_000_000, 15_000_000]); expect(readProgramLedger(top)).toHaveLength(4);
    withCaps(top, beyond, [8_000_000, 16_000_000]); expect(readProgramLedger(top)).toHaveLength(4);
    for (const caps of [[6_000_000, 8_000_000], [8_000_000, 8_000_000]]) {                     // 5.0M + 3.000001M > 8M
      withCaps(top, beyond, caps); expect(() => readProgramLedger(top), JSON.stringify(caps)).toThrow('PROGRAM_SPEND_JOURNAL');
    }
    await expect(spend(top, 1)).rejects.toThrow('PROGRAM_SPEND_JOURNAL');
    // A row recorded at 15M is checked against 15M, not against the latest 16M cap: exactly at it is valid, one µUSD above never validates.
    const peak = ledgerIn();
    await spend(peak, 10_000_000); await spend(peak, 5_000_000);                                // 15.0M in total
    const peakRows = lines(peak), past = peakRows.map((row, index) => index === 2 ? { ...row, worstCaseMicroUsd: 5_000_001 } : index === 3 ? { ...row, chargedMicroUsd: 5_000_001 } : row);
    withCaps(peak, peakRows, [15_000_000, 15_000_000]); expect(readProgramLedger(peak)).toHaveLength(4);
    withCaps(peak, past, [15_000_000, 16_000_000]); expect(readProgramLedger(peak)).toHaveLength(4);
    withCaps(peak, past, [15_000_000, 15_000_000]); expect(() => readProgramLedger(peak)).toThrow('PROGRAM_SPEND_JOURNAL'); // 10.0M + 5.000001M > 15M
    await expect(spend(peak, 1)).rejects.toThrow('PROGRAM_SPEND_JOURNAL');
    // Exactly at its own cap is valid.
    const exact = ledgerIn();
    await spend(exact, 2_000_000); await spend(exact, 500_000);
    withCaps(exact, lines(exact), [2_500_000, 2_500_000]); expect(readProgramLedger(exact)).toHaveLength(4);
    withCaps(exact, lines(exact).map((row, index) => index === 2 ? { ...row, worstCaseMicroUsd: 500_001 } : index === 3 ? { ...row, chargedMicroUsd: 500_001 } : row), [2_500_000, 2_500_000]);
    expect(() => readProgramLedger(exact)).toThrow('PROGRAM_SPEND_JOURNAL');
  });
});
