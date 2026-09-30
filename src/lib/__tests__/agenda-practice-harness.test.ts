import { describe, expect, it } from 'vitest';
import { existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import {
  AGENDA_STAGES, AnswerBook, DEFAULT_AGENDA_STAGE, EFFECT_TABLES, ESTIMATE_BODY_BYTES, LEGACY_AGENDA_STAGE, LEGACY_SEED_WEEKDAYS, addDaysSaoPaulo, agendaStage, askedFields,
  assertHeadroom, buildPasskReport, buildScenarioFixture, changedEffects, classifyTurns, codesOnly, compareFinal, dayOffset, digest, expectedCalls, fixtureEntityId, formatPasskTable,
  gradeResult, gradeTranscript, headroomEstimate, legacyOracle, legacyScore, lunaDivergence, namesEntity, passHatK, pendingPlan, pickVariant, prng, readStage, reasonMatches,
  renderFinal, renderTemplate, replyClocks,
  requestVersion, reservationMicroUsd, reserve, runDayPreflight, scenarioFixture, secretaryFlagSnapshot, stageJournalPath, stageTotals, todayInSaoPaulo, validateScenarios,
  weekdaySaoPaulo, type AgendaScenario, type AgendaStageName, type DbState, type TranscriptRow,
} from '../../../packages/salon-secretary/evaluation/agenda-practice-lib';

const SUNDAY = '2026-09-27', SATURDAY = '2026-10-03';
const evaluation = 'packages/salon-secretary/evaluation';
const legacyFiles = ['agenda-practice-scenarios.json', 'agenda-practice-scenarios-r2.json', 'agenda-practice-scenarios-r3.json'];
const legacyScenarios = () => legacyFiles.flatMap(f => JSON.parse(readFileSync(join(evaluation, f), 'utf8')) as AgendaScenario[]);
const payload = (maxOutput = 8192) => JSON.stringify({ model: 'gpt-6-luna', instructions: 'synthetic instructions', input: [{ role: 'user', content: 'synthetic message' }],
  tools: [{ type: 'function', name: 'upsert_action_draft', parameters: { type: 'object' }, strict: true }], tool_choice: { type: 'function', name: 'upsert_action_draft' },
  parallel_tool_calls: false, max_output_tokens: maxOutput, store: false, stream: false, include: [] });
const tempDir = () => mkdtempSync(join(tmpdir(), 'agenda-harness-'));
function seedJournal(file: string, stage: AgendaStageName, reservedMicroUsd: number) {
  const body = { stage, id: '00000000-0000-4000-8000-000000000000', run: 'seed', scenario: 'X', step: 1, bodyBytes: 1, maxOutputTokens: 1, reservedMicroUsd, previousHash: 'GENESIS' };
  writeFileSync(file, JSON.stringify({ ...body, rowHash: digest(JSON.stringify(body)) }) + '\n');
}
const appt = (who: string, svc: string, date: string, time: string, end: string, pro: string, status = 'CONFIRMED') => `${who} | ${svc} | ${date} ${time}→${end} | ${pro} | ${status}`;
const block = (pro: string, date: string, from: string, to: string, reason = '') => `${pro} | ${date} ${from}→${date} ${to} | ${reason}`;

describe('agenda practice harness: run-day templating (America/Sao_Paulo, Intl)', () => {
  it('renders day tokens from the stored today, including month, year and leap boundaries', () => {
    expect(renderTemplate('dia {{d:+1|dd}}', SUNDAY)).toBe('dia 28');
    expect(renderTemplate('{{d:+2|ddmm}} e {{d:+2|ddmmyyyy}}', SUNDAY)).toBe('29/09 e 29/09/2026');
    expect(renderTemplate('na {{d:+3|weekday}} ({{d:+3|weekdayfull}})', SUNDAY)).toBe('na quarta (quarta-feira)');
    expect(renderTemplate('{{d:+1|iso}}', SUNDAY)).toBe('2026-09-28');
    expect(renderTemplate('{{d:+3|ddmm}} {{d:+4|d}}', '2026-09-30')).toBe('03/10 4');
    expect(renderTemplate('{{d:+1|ddmmyyyy}}', '2026-12-31')).toBe('01/01/2027');
    expect(renderTemplate('{{d:-1|iso}}', '2027-01-01')).toBe('2026-12-31');
    expect(renderTemplate('{{d:+1|ddmm}} {{d:+2|ddmm}}', '2028-02-28')).toBe('29/02 01/03');
    expect(renderTemplate('{{d:+1|ddmm}}', '2027-02-28')).toBe('01/03');
    expect(renderTemplate('sem token', SUNDAY)).toBe('sem token');
  });
  it('resolves weekday specs to the next occurrence (1..7 days ahead) like the legacy oracle', () => {
    expect(dayOffset('sex', SUNDAY)).toBe(5);
    expect(dayOffset('sexta', SUNDAY)).toBe(5);
    expect(dayOffset('seg', SUNDAY)).toBe(1);
    expect(dayOffset('dom', SUNDAY)).toBe(7);
    expect(dayOffset('sábado', SUNDAY)).toBe(6);
    expect(dayOffset('terça-feira', SUNDAY)).toBe(2);
    expect(dayOffset('sex+7', SUNDAY)).toBe(12);
    expect(dayOffset('sex', '2026-10-02')).toBe(7);
    expect(dayOffset('+2', SUNDAY)).toBe(2);
    expect(dayOffset(-3, SUNDAY)).toBe(-3);
    expect(renderTemplate('{{d:sex|ddmm}}', SUNDAY)).toBe('02/10');
    expect(weekdaySaoPaulo(SUNDAY)).toBe(0);
    expect(addDaysSaoPaulo(SUNDAY, 5)).toBe('2026-10-02');
  });
  it("resolves '<weekday>@semana-que-vem' to that weekday of the next Monday-Sunday week (the runtime's NEXT_WEEK)", () => {
    const MONDAY = '2026-09-28', TUESDAY = '2026-09-29', WEDNESDAY = '2026-09-30';
    expect(dayOffset('ter@semana-que-vem', MONDAY)).toBe(8); // not tomorrow
    expect(dayOffset('ter@semana-que-vem', TUESDAY)).toBe(7);
    expect(dayOffset('ter@semana-que-vem', WEDNESDAY)).toBe(6);
    expect(dayOffset('ter@semana-que-vem', SATURDAY)).toBe(3);
    expect(dayOffset('ter@semana-que-vem', SUNDAY)).toBe(2); // the week starting tomorrow
    expect(dayOffset('terça-feira @ semana-que-vem', MONDAY)).toBe(8);
    expect(dayOffset('seg@semana-que-vem', SUNDAY)).toBe(1);
    expect(dayOffset('seg@semana-que-vem', MONDAY)).toBe(7);
    expect(dayOffset('dom@semana-que-vem', MONDAY)).toBe(13);
    expect(dayOffset('dom@semana-que-vem', SUNDAY)).toBe(7);
    expect(renderTemplate('{{d:ter@semana-que-vem|ddmm}}', MONDAY)).toBe('06/10');
    expect(renderTemplate('{{d:qua@semana-que-vem|iso}}', '2026-12-30')).toBe('2027-01-06');
    expect(() => dayOffset('xyz@semana-que-vem', MONDAY)).toThrow('AGENDA_DAY_SPEC');
    expect(() => dayOffset('ter@semana', MONDAY)).toThrow('AGENDA_DAY_SPEC');
    expect(() => dayOffset('ter@semana-que-vem+1', MONDAY)).toThrow('AGENDA_DAY_SPEC');
  });
  it('fails loudly on unknown tokens, formats and impossible dates', () => {
    expect(() => renderTemplate('{{d:+1|yy}}', SUNDAY)).toThrow('AGENDA_TEMPLATE_FORMAT');
    expect(() => renderTemplate('{{x:+1|dd}}', SUNDAY)).toThrow('AGENDA_TEMPLATE');
    expect(() => renderTemplate('{{d:amanha|dd}}', SUNDAY)).toThrow('AGENDA_DAY_SPEC');
    expect(() => addDaysSaoPaulo('2026-02-30', 1)).toThrow('AGENDA_DATE');
    expect(() => dayOffset(1.5, SUNDAY)).toThrow('AGENDA_DAY_SPEC');
  });
  it('computes today in Sao Paulo, not UTC (the legacy toISOString day shift after 21:00)', () => {
    expect(todayInSaoPaulo(new Date('2026-09-28T02:30:00Z'))).toBe('2026-09-27');
    expect(todayInSaoPaulo(new Date('2026-09-28T03:00:00Z'))).toBe('2026-09-28');
    expect(todayInSaoPaulo(new Date('2027-01-01T02:59:59Z'))).toBe('2026-12-31');
  });
});

describe('agenda practice harness: exact final-state oracle', () => {
  const initial: DbState = { appointments: [appt('Fábio Santos', 'Barba', '2026-09-28', '16:00', '16:30', 'Ricardo Alves'), appt('Carla Mendes', 'Escova', '2026-10-02', '11:00', '11:45', 'Tatiana Rocha')], blocks: [] };
  const final = renderFinal({ appointments: [
    { customer: 'Fábio Santos', service: 'Barba', day: 1, time: '17:00', professional: 'Ricardo Alves' },
    { customer: 'Carla Mendes', service: 'Escova', day: 'sex', time: '11:00', status: 'CANCELLED' },
  ], blocks: [{ professional: 'Rodrigo Lima', day: '+1', from: '10:00', to: '11:00' }] }, SUNDAY);
  const good: DbState = { appointments: [appt('Fábio Santos', 'Barba', '2026-09-28', '17:00', '17:30', 'Ricardo Alves'), appt('Carla Mendes', 'Escova', '2026-10-02', '11:00', '11:45', 'Tatiana Rocha', 'CANCELLED')],
    blocks: [block('Rodrigo Lima', '2026-09-28', '10:00', '11:00', 'curso')] };
  it('passes only on the exact multiset, in any order', () => {
    expect(final.appointments[1]).toMatchObject({ date: '2026-10-02', status: 'CANCELLED' });
    expect(compareFinal(final, good, initial)).toEqual({ ok: true, why: [], safety: [] });
    expect(compareFinal(final, { appointments: [...good.appointments].reverse(), blocks: good.blocks }, initial).ok).toBe(true);
  });
  it('fails a duplicate create, an old slot left CONFIRMED and an extra block, flagging SAFETY', () => {
    const duplicate = compareFinal(final, { ...good, appointments: [...good.appointments, good.appointments[0]] }, initial);
    expect(duplicate.ok).toBe(false); expect(duplicate.why.join()).toContain('EXTRA'); expect(duplicate.safety).toContain('EXTRA_APPOINTMENT');
    const oldSlot = compareFinal(final, { ...good, appointments: [initial.appointments[0], good.appointments[0], good.appointments[1]] }, initial);
    expect(oldSlot.ok).toBe(false); expect(oldSlot.why.some(w => w.startsWith('EXTRA Fábio Santos | Barba | 2026-09-28 16:00'))).toBe(true);
    const extraBlock = compareFinal(final, { ...good, blocks: [...good.blocks, block('Tatiana Rocha', '2026-09-28', '10:00', '11:00')] }, initial);
    expect(extraBlock.ok).toBe(false); expect(extraBlock.safety).toContain('EXTRA_BLOCK');
    const missing = compareFinal(final, { ...good, blocks: [] }, initial);
    expect(missing.ok).toBe(false); expect(missing.why[0]).toMatch(/^MISSING_BLOCK Rodrigo Lima \| 2026-09-28 10:00→2026-09-28 11:00/);
  });
  it('flags writes when no change is expected and on seeded rows the expectation keeps verbatim', () => {
    const unchanged = renderFinal({ unchanged: true }, SUNDAY);
    expect(compareFinal(unchanged, initial, initial).ok).toBe(true);
    const written = compareFinal(unchanged, { ...initial, blocks: [block('Tatiana Rocha', '2026-09-28', '10:00', '11:00')] }, initial);
    expect(written).toMatchObject({ ok: false, safety: ['WRITE_WHEN_NO_CHANGE_EXPECTED'] });
    const listedAsInitial = renderFinal({ appointments: [{ customer: 'Fábio Santos', service: 'Barba', day: 1, time: '16:00' }, { customer: 'Carla Mendes', service: 'Escova', day: 5, time: '11:00' }] }, SUNDAY);
    expect(compareFinal(listedAsInitial, initial, initial).ok).toBe(true);
    const cancelled = compareFinal(listedAsInitial, { ...initial, appointments: [initial.appointments[0], initial.appointments[1].replace('CONFIRMED', 'CANCELLED')] }, initial);
    // Migrated (grader review): the cancelled row was written by the run and matches no expectation.
    expect(cancelled.ok).toBe(false); expect(cancelled.safety).toEqual(['WRITE_WHEN_NO_CHANGE_EXPECTED', 'UNTOUCHED_ROW_CHANGED', 'UNEXPECTED_WRITE']);
  });
  it('matches wildcard expectations without stealing rows (bipartite matching) and supports subset mode', () => {
    const rows: DbState = { appointments: [appt('Ana', 'Escova', '2026-09-28', '10:00', '10:45', 'Tatiana Rocha'), appt('Ana', 'Escova', '2026-09-28', '10:00', '10:45', 'Ricardo Alves')], blocks: [] };
    const wildcardFirst = renderFinal({ appointments: [{ customer: 'Ana', service: 'Escova', day: 1, time: '10:00' }, { customer: 'Ana', service: 'Escova', day: 1, time: '10:00', professional: 'Tatiana Rocha' }] }, SUNDAY);
    expect(compareFinal(wildcardFirst, rows, { appointments: [], blocks: [] }).ok).toBe(true);
    const subset = renderFinal({ exact: false, appointments: [{ customer: 'Ana', service: 'Escova', day: 1, time: '10:00', professional: 'Ricardo Alves' }] }, SUNDAY);
    expect(compareFinal(subset, rows, { appointments: [], blocks: [] }).ok).toBe(true);
    expect(compareFinal({ ...subset, exact: true }, rows, { appointments: [], blocks: [] }).ok).toBe(false);
  });
});

describe('agenda practice harness: legacy E map bridge (map read, never edited)', () => {
  it('renders the frozen map from the stored run day, never the check-time clock', () => {
    const { E, sha256 } = legacyOracle(SUNDAY);
    expect(sha256).toMatch(/^[a-f0-9]{64}$/);
    expect(Object.keys(E)).toHaveLength(40);
    expect(E.A01.has![0][0]).toBe('Amanda Souza | Corte Completo | 2026-09-28 11:00→');
    expect(E.A08.blocks![0]).toBe('Tatiana Rocha | 2026-10-02 17:00→2026-10-02 19:00');
    expect(E.C06.has![0][0]).toContain('2026-10-01 14:00');
    expect(legacyOracle('2026-10-01').E.A08.has![0][0]).toContain('2026-10-02 15:00');
  });
  it('keeps the legacy scoring rules (substring has, block prefix, none)', () => {
    const { E } = legacyOracle(SUNDAY), empty: DbState = { appointments: [], blocks: [] };
    expect(legacyScore(E.A01, empty, { appointments: [appt('Amanda Souza', 'Corte Completo', '2026-09-28', '11:00', '12:00', 'Tatiana Rocha')], blocks: [] }).ok).toBe(true);
    expect(legacyScore(E.A10, empty, { appointments: [], blocks: [block('Tatiana Rocha', '2026-09-28', '10:00', '11:00')] })).toMatchObject({ ok: false, safety: ['WRITE_WHEN_NO_CHANGE_EXPECTED'] });
    expect(legacyScore(undefined, empty, empty).why).toEqual(['NO_ORACLE']);
  });
});

describe('agenda practice harness: pass^k estimator and PRNG', () => {
  it('computes C(c,k)/C(n,k)', () => {
    expect(passHatK(5, 5, 5)).toBe(1);
    expect(passHatK(4, 5, 1)).toBeCloseTo(0.8);
    expect(passHatK(4, 5, 2)).toBeCloseTo(0.6);
    expect(passHatK(3, 8, 2)).toBeCloseTo(3 / 28);
    expect(passHatK(2, 8, 3)).toBe(0);
    expect(passHatK(0, 4, 1)).toBe(0);
    expect(passHatK(3, 3, 4)).toBeNull();
    expect(passHatK(6, 5, 1)).toBeNull();
  });
  it('is deterministic per seed and samples phrasing by (scenario, attempt, field, use)', () => {
    const a = prng('V01#k1'), b = prng('V01#k1'), c = prng('V01#k2');
    const seqA = [a(), a(), a()], seqB = [b(), b(), b()], seqC = [c(), c(), c()];
    expect(seqA).toEqual(seqB); expect(seqA).not.toEqual(seqC); expect(seqA.every(x => x >= 0 && x < 1)).toBe(true);
    const variants = ['Às 11h.', '11h', 'onze horas', 'pode ser 11h'];
    expect(pickVariant(variants, 'x')).toBe(pickVariant(variants, 'x'));
    expect(new Set(Array.from({ length: 40 }, (_, i) => pickVariant(variants, 'V01#k' + i))).size).toBeGreaterThan(1);
    const answers = { time: variants, reason: { queue: ['Viagem.', ['Doença.', 'Ela está doente.']] }, date: 'Dia {{d:+1|dd}}.' };
    const run = (seed: string) => { const book = new AnswerBook(answers, seed, SUNDAY); return [book.next(['reason']), book.next(['time', 'reason']), book.next(['reason', 'time']), book.next(['date']), book.next(['reason', 'time', 'date'])]; };
    const first = run('V01#k1');
    expect(first).toEqual(run('V01#k1'));
    expect(first.map(x => x?.field)).toEqual(['reason', 'time', 'reason', 'date', undefined]);
    expect(first[0]?.text).toBe('Viagem.'); expect(['Doença.', 'Ela está doente.']).toContain(first[2]?.text); expect(first[3]?.text).toBe('Dia 28.');
    const legacy = new AnswerBook({ time: 'Às 17h.', constructor: 'x' }, 'C09#k1', SUNDAY);
    expect(legacy.next(['toString', 'time'])).toEqual({ field: 'time', text: 'Às 17h.', use: 1 });
    expect(legacy.next(['time'])).toBeUndefined();
  });
});

describe('agenda practice harness: stage journals', () => {
  it('selects stages only from the fixed allowlist, each with its own journal and cap', () => {
    expect(DEFAULT_AGENDA_STAGE).toBe('reliability-20260927');
    expect(agendaStage()).toEqual({ name: 'reliability-20260927', journal: 'reliability-stage-budget.jsonl', capMicroUsd: 15_000_000 });
    expect(agendaStage(LEGACY_AGENDA_STAGE)).toEqual({ name: 'agenda-core-20260927', journal: 'stage-budget.jsonl', capMicroUsd: 7_000_000 });
    expect(() => agendaStage('reliability-20260928')).toThrow('AGENDA_STAGE_UNKNOWN');
    expect(() => agendaStage('toString')).toThrow('AGENDA_STAGE_UNKNOWN');
    // Migrated (oracle audit 28/09): the allowlist gained the final-battery stage; the two existing stages are unchanged.
    // Migrated (Candidate 4, 29/09): two more stages with their own journals; the three existing stages are unchanged.
    expect(Object.keys(AGENDA_STAGES)).toEqual(['agenda-core-20260927', 'reliability-20260927', 'final-20260929', 'c4-dev-20260929', 'c4-proof-20260930']);
    expect(agendaStage('c4-dev-20260929')).toEqual({ name: 'c4-dev-20260929', journal: 'c4-dev-20260929-stage-budget.jsonl', capMicroUsd: 15_000_000 });
    expect(agendaStage('c4-proof-20260930')).toEqual({ name: 'c4-proof-20260930', journal: 'c4-proof-20260930-stage-budget.jsonl', capMicroUsd: 40_000_000 });
    expect(agendaStage('final-20260929')).toEqual({ name: 'final-20260929', journal: 'final-20260929-stage-budget.jsonl', capMicroUsd: 40_000_000 });
    expect(() => agendaStage('final-20260928')).toThrow('AGENDA_STAGE_UNKNOWN');
    expect(new Set(Object.values(AGENDA_STAGES).map(s => s.journal)).size).toBe(5); // each stage owns its journal
  });
  it('the final-battery stage has its own journal and a USD 40 reservation cap, with no cross-stage rows', () => {
    const dir = tempDir();
    try {
      const final = stageJournalPath(dir, 'final-20260929'), reliability = stageJournalPath(dir, 'reliability-20260927');
      expect(final).toBe(join(dir, 'final-20260929-stage-budget.jsonl'));
      const row = reserve(final, 'run1', 'H01#k1', 1, payload(), 'final-20260929');
      expect(row).toMatchObject({ stage: 'final-20260929', previousHash: 'GENESIS' });
      expect(stageTotals(final, 'final-20260929')).toMatchObject({ requests: 1, reservedMicroUsd: row.reservedMicroUsd, capUsd: 40 });
      expect(existsSync(reliability)).toBe(false);
      expect(() => reserve(final, 'run1', 'V01', 2, payload(), 'reliability-20260927')).toThrow('AGENDA_STAGE_JOURNAL');
      expect(() => reserve(reliability, 'run1', 'V01', 2, payload(), 'final-20260929')).toThrow('AGENDA_STAGE_JOURNAL');
      seedJournal(final, 'final-20260929', 39_995_000);
      expect(() => reserve(final, 'run', 'H01', 1, payload(), 'final-20260929')).toThrow('AGENDA_STAGE_CAP');
      seedJournal(final, 'final-20260929', 15_000_001); // above the reliability cap, within its own
      expect(reserve(final, 'run', 'H01', 1, payload(), 'final-20260929').stage).toBe('final-20260929');
      seedJournal(final, 'final-20260929', 40_000_001);
      expect(() => stageTotals(final, 'final-20260929')).toThrow('AGENDA_STAGE_JOURNAL');
    } finally { rmSync(dir, { recursive: true, force: true }); }
  });
  it('reserves before transport into the selected journal, hash-chained, without cross-stage rows or refunds', () => {
    const dir = tempDir();
    try {
      const reliability = stageJournalPath(dir, 'reliability-20260927'), legacy = stageJournalPath(dir, LEGACY_AGENDA_STAGE);
      const row = reserve(reliability, 'run1', 'V01#k1', 1, payload(), 'reliability-20260927');
      expect(row).toMatchObject({ stage: 'reliability-20260927', scenario: 'V01#k1', previousHash: 'GENESIS', reservedMicroUsd: reservationMicroUsd(Buffer.byteLength(payload()), 8192) });
      const second = reserve(reliability, 'run1', 'V01#k2', 2, payload(), 'reliability-20260927');
      expect(second.previousHash).toBe(row.rowHash);
      expect(stageTotals(reliability, 'reliability-20260927')).toMatchObject({ requests: 2, reservedMicroUsd: row.reservedMicroUsd * 2, capUsd: 15 });
      expect(existsSync(legacy)).toBe(false);
      expect(() => readStage(reliability, LEGACY_AGENDA_STAGE)).toThrow('AGENDA_STAGE_JOURNAL');
      expect(() => reserve(reliability, 'run1', 'V01', 1, payload(), LEGACY_AGENDA_STAGE)).toThrow('AGENDA_STAGE_JOURNAL');
      expect(() => reserve(join(dir, 'other.jsonl'), 'run1', 'V01', 1, payload(), 'reliability-20260927')).toThrow('AGENDA_STAGE_JOURNAL');
      const legacyRow = reserve(legacy, 'run1', 'A01', 1, payload());
      expect(legacyRow.stage).toBe('agenda-core-20260927');
      const lines = readFileSync(reliability, 'utf8').split('\n').filter(Boolean);
      writeFileSync(reliability, lines[0].replace('"step":1', '"step":9') + '\n' + lines[1] + '\n');
      expect(() => stageTotals(reliability, 'reliability-20260927')).toThrow('AGENDA_STAGE_JOURNAL');
      expect(readFileSync(legacy, 'utf8')).not.toContain('synthetic message');
    } finally { rmSync(dir, { recursive: true, force: true }); }
  });
  it('enforces each cap separately and refuses while a lock exists (after the bounded wait: AGENDA_STAGE_LOCKED, never a raw errno)', () => {
    const dir = tempDir();
    try {
      const reliability = stageJournalPath(dir, 'reliability-20260927'), legacy = stageJournalPath(dir, LEGACY_AGENDA_STAGE);
      seedJournal(reliability, 'reliability-20260927', 14_995_000);
      expect(() => reserve(reliability, 'run', 'V01', 1, payload(), 'reliability-20260927')).toThrow('AGENDA_STAGE_CAP');
      seedJournal(legacy, LEGACY_AGENDA_STAGE, 6_995_000);
      expect(() => reserve(legacy, 'run', 'A01', 1, payload())).toThrow('AGENDA_STAGE_CAP');
      seedJournal(reliability, 'reliability-20260927', 7_000_000);
      expect(reserve(reliability, 'run', 'V01', 1, payload(), 'reliability-20260927').stage).toBe('reliability-20260927');
      seedJournal(legacy, LEGACY_AGENDA_STAGE, 7_000_001);
      expect(() => stageTotals(legacy)).toThrow('AGENDA_STAGE_JOURNAL');
      const before = readFileSync(reliability, 'utf8');
      writeFileSync(reliability + '.lock', '');
      // Contract migration (F1, 29/09): the lock is waited on with a deadline (default ~5 s; shortened here), then refused.
      expect(() => reserve(reliability, 'run', 'V01', 2, payload(), 'reliability-20260927', { lockWaitMs: 150 })).toThrow('AGENDA_STAGE_LOCKED');
      expect(readFileSync(reliability, 'utf8')).toBe(before);
      rmSync(reliability + '.lock');
      expect(() => reserve(reliability, 'run', 'V01', 2, JSON.stringify({ ...JSON.parse(payload()), store: true }), 'reliability-20260927')).toThrow('SECRETARY_OPENAI_COST_GUARD');
      expect(() => reserve(reliability, 'run', 'V01', 2, JSON.stringify({ ...JSON.parse(payload()), instructions: 'x'.repeat(60_000) }), 'reliability-20260927')).toThrow('AGENDA_INPUT_CAP');
      expect(readFileSync(reliability, 'utf8')).toBe(before);
    } finally { rmSync(dir, { recursive: true, force: true }); }
  });
});

describe('agenda practice harness: headroom preflight', () => {
  const scenario: AgendaScenario = { id: 'V01', title: 't', capability: ['reschedule'], steps: [{ say: 'a' }, { confirm: 'all' }, { say: 'b' }, { confirm: true }],
    answers: { time: ['11h', 'onze'], reason: { queue: ['x', 'y'] } } };
  it('estimates K x (2 per say + answers) x per-call reservation of the journal formula', () => {
    expect(expectedCalls(scenario)).toEqual({ says: 2, answers: 3, calls: 7 });
    const perCall = reservationMicroUsd(ESTIMATE_BODY_BYTES, 8192);
    expect(perCall).toBe(Math.ceil((ESTIMATE_BODY_BYTES + 8192) * 0.125 + 8192 * 0.5));
    const e = headroomEstimate({ scenarios: [scenario, { ...scenario, id: 'V02' }], repeat: 3, spentMicroUsd: 1_000_000, capMicroUsd: 15_000_000 });
    expect(e).toMatchObject({ callsPerPass: 14, calls: 42, maxRequests: 42, perCallMicroUsd: perCall, requiredMicroUsd: 42 * perCall, remainingMicroUsd: 14_000_000, ok: true, maxRequestsBelowEstimate: false });
    expect(() => assertHeadroom(e)).not.toThrow();
  });
  it('scales --max-requests by K and aborts with AGENDA_STAGE_HEADROOM when the stage cannot hold the run', () => {
    const scaled = headroomEstimate({ scenarios: [scenario], repeat: 4, perPassMaxRequests: 5, spentMicroUsd: 0, capMicroUsd: 15_000_000 });
    expect(scaled).toMatchObject({ maxRequestsPerPass: 5, maxRequests: 20, calls: 28, maxRequestsBelowEstimate: true });
    const tight = headroomEstimate({ scenarios: [scenario], repeat: 8, spentMicroUsd: 14_500_000, capMicroUsd: 15_000_000 });
    expect(tight.ok).toBe(false);
    expect(() => assertHeadroom(tight)).toThrow('AGENDA_STAGE_HEADROOM');
    const legacy = legacyScenarios();
    const battery = headroomEstimate({ scenarios: legacy, repeat: 5, spentMicroUsd: 0, capMicroUsd: AGENDA_STAGES['reliability-20260927'].capMicroUsd });
    expect(battery.ok).toBe(true);
    expect(battery.requiredMicroUsd).toBeLessThan(15_000_000);
  });
});

describe('agenda practice harness: run-day preflight and scenario format', () => {
  const v: AgendaScenario = { id: 'V01', title: 'Remarcar, cancelar e bloquear', capability: ['multi-action'],
    professionals: [{ name: 'Rodrigo Lima', services: ['Corte Completo', 'barba'], weekdays: [1, 2, 3, 4, 5], from: '10:00' }],
    customers: [{ name: 'Fabio Santos' }, { name: 'Fábio Lima' }, { name: 'Fabio Lima', phone: '11987650077' }],
    appointments: [{ key: 'fabio_d1', customer: 'fabio', professional: 'rodrigo_lima', service: 'corte', day: '+1', time: '09:00' }],
    steps: [{ say: 'Bloqueia o Rodrigo dia {{d:+1|dd}} das 10 às 11.' }, { confirm: 'all' }],
    final: { blocks: [{ professional: 'Rodrigo Lima', day: '+1', from: '10:00', to: '11:00' }] } };
  it('keeps legacy A/B/C files valid and their fixture identical to the previous builder', () => {
    const all = validateScenarios(legacyScenarios());
    expect(all).toHaveLength(40);
    const previous = (s: AgendaScenario, today: string) => ({ ...BASE_REF, customers: [...BASE_REF.customers, ...(s.customers ?? [])],
      appointments: (s.appointments ?? []).map(a => ({ key: a.key, customerKey: a.customer, professionalKey: a.professional, serviceKey: a.service,
        startAt: new Date(`${addDaysSaoPaulo(today, a.day as number)}T${a.time}:00-03:00`).toISOString(), status: 'CONFIRMED' })) });
    for (const s of all) expect(JSON.parse(JSON.stringify(scenarioFixture(s, SUNDAY)))).toEqual(JSON.parse(JSON.stringify(previous(s, SUNDAY))));
    expect(buildScenarioFixture(all[0], SUNDAY).hours).toEqual([]);
  });
  it('merges professionals, derives unique customer keys (homonyms, accents) and weekday-relative days', () => {
    const { fixture, hours } = buildScenarioFixture(v, SUNDAY);
    expect(fixture.professionals.map(p => p.key)).toEqual(['tatiana', 'ricardo', 'rodrigo_lima']);
    expect(fixture.services.filter(s => s.professionalKeys.includes('rodrigo_lima')).map(s => s.key)).toEqual(['corte', 'barba']);
    expect(fixture.customers.slice(5).map(c => [c.key, c.name])).toEqual([['fabio_santos', 'Fabio Santos'], ['fabio_lima', 'Fábio Lima'], ['fabio_lima_2', 'Fabio Lima']]);
    expect(hours).toEqual([{ key: 'rodrigo_lima', weekdays: [1, 2, 3, 4, 5], fromMinutes: 600 }]);
    expect(fixture.appointments[0].startAt).toBe('2026-09-28T12:00:00.000Z');
    expect(scenarioFixture({ ...v, appointments: [{ ...v.appointments![0], day: 'sex' }] }, SUNDAY).appointments[0].startAt).toBe('2026-10-02T12:00:00.000Z');
    expect(scenarioFixture({ ...v, openWeekdays: [0, 1, 2, 3, 4, 5, 6] }, SUNDAY).openWeekdays).toEqual([0, 1, 2, 3, 4, 5, 6]);
  });
  it('rejects malformed extensions', () => {
    const bad = (patch: Partial<AgendaScenario>) => () => validateScenarios([{ ...v, ...patch }]);
    expect(bad({ professionals: [{ name: 'Tatiana Rocha' }] })).toThrow('AGENDA_SCENARIO_INVALID:V01:PROFESSIONAL');
    expect(bad({ professionals: [{ name: 'X', services: ['Manicure'] }] })).toThrow('PROFESSIONAL_SERVICES');
    expect(bad({ steps: [{ confirm: 'first' } as never] })).toThrow('STEP');
    expect(bad({ steps: [{ choose: 0 }] })).toThrow('STEP');
    expect(bad({ final: { appointments: [{ customer: 'A', service: 'B', day: 1, time: '10:00', status: 'DONE' }] } })).toThrow('FINAL_APPOINTMENT');
    expect(bad({ final: { unchanged: true, blocks: [] } })).toThrow('FINAL_UNCHANGED');
    expect(bad({ answers: { time: [] } })).toThrow('ANSWER:time');
    expect(bad({ customers: [{ key: 'amanda', name: 'Amanda 2' }] })).toThrow('CUSTOMER_KEY');
    expect(() => validateScenarios([v, v])).toThrow('DUPLICATE_ID');
    expect(validateScenarios([{ ...v, steps: [{ choose: 2, action: 'b' }, { note: 'n' }, { select: 'Lima' }] }])).toHaveLength(1);
  });
  it('skips scenarios whose expectations land on a closed day unless they expect the closure or open that weekday', () => {
    const run = (s: AgendaScenario, today: string) => runDayPreflight([s], today)[0];
    expect(run(v, SUNDAY)).toMatchObject({ action: 'RUN', closed: [] });
    const saturday = run(v, SATURDAY);
    expect(saturday.action).toBe('SKIP');
    expect(saturday.closed.map(c => c.source)).toEqual(expect.arrayContaining(['appointment:fabio_d1', 'template', 'final:block']));
    expect(run({ ...v, expectsClosure: true }, SATURDAY).action).toBe('RUN');
    expect(run({ ...v, openWeekdays: [0, 1, 2, 3, 4, 5, 6] }, SATURDAY)).toMatchObject({ action: 'SKIP', closed: [expect.objectContaining({ source: 'final:block', professional: 'Rodrigo Lima' })] });
    expect(run({ ...v, openWeekdays: [0, 1, 2, 3, 4, 5, 6], professionals: [{ name: 'Rodrigo Lima' }] }, SATURDAY).action).toBe('RUN');
    expect(run({ ...v, final: undefined, steps: [{ say: 'dia {{d:+6|dd}}' }], appointments: [], days: [] }, SUNDAY).action).toBe('RUN');
    expect(run({ ...v, final: undefined, steps: [{ say: 'dia {{d:+7|dd}}' }], appointments: [], days: [] }, SUNDAY).action).toBe('SKIP');
    expect(run({ ...v, final: undefined, steps: [{ say: 'x' }], appointments: [], days: ['dom'] }, SUNDAY).action).toBe('SKIP');
    const legacy = legacyScenarios().find(s => s.id === 'A01')!;
    expect(runDayPreflight([legacy], SATURDAY, legacyOracle(SATURDAY).E)[0]).toMatchObject({ action: 'SKIP', closed: [expect.objectContaining({ source: 'legacy-oracle', date: '2026-10-04' })] });
    expect(runDayPreflight([legacy], SUNDAY, legacyOracle(SUNDAY).E)[0].action).toBe('RUN');
  });
  it('skips legacy scenarios whose frozen oracle cannot hold on the run day (C09 off Sunday, C06 on Thursday)', () => {
    const legacy = legacyScenarios(), c09 = legacy.find(s => s.id === 'C09')!, c06 = legacy.find(s => s.id === 'C06')!;
    const pre = (s: AgendaScenario, today: string) => runDayPreflight([s], today, legacyOracle(today).E)[0];
    expect(pre(c09, SUNDAY)).toMatchObject({ action: 'RUN', closed: [], invalid: [] });
    expect(pre(c09, '2026-09-28')).toMatchObject({ action: 'SKIP', closed: [], invalid: [{ date: '2026-10-03', source: 'legacy-seed-weekday:carla_fri', reason: 'ORACLE_INVALID_FOR_DAY' }] });
    expect(pre(c09, '2026-10-01').action).toBe('SKIP');
    expect(pre(c06, '2026-09-30')).toMatchObject({ action: 'RUN', invalid: [] });
    expect(pre(c06, '2026-10-01')).toMatchObject({ action: 'SKIP', closed: [], invalid: [{ date: '2026-10-01', source: 'legacy-oracle', reason: 'ORACLE_INVALID_FOR_DAY' }] });
    expect(LEGACY_SEED_WEEKDAYS.C09).toEqual({ carla_fri: 5 });
    expect(runDayPreflight([c09], '2026-09-28')[0].invalid).toEqual([]); // the table applies only with the legacy map
    expect(runDayPreflight([{ ...v, final: { blocks: [{ professional: 'Rodrigo Lima', day: 0, from: '10:00', to: '11:00' }] } }], SUNDAY)[0])
      .toMatchObject({ action: 'SKIP', invalid: [{ date: SUNDAY, source: 'final:block' }] });
  });
  it('validates step expectations and transcript oracles', () => {
    const check = (steps: AgendaScenario['steps'], final?: AgendaScenario['final']) => () => validateScenarios([{ ...v, steps, ...(final ? { final } : {}) }]);
    expect(check([{ say: 'a', expect: 'READY' }, { confirm: 'all', expectError: 'NOTHING_TO_CONFIRM' }, { choose: 1, optional: true }, { select: 'x', optional: true }, { choose: 2, action: 'b', optional: true }])).not.toThrow();
    expect(check([{ say: 'a', expect: 'DONE' as never }])).toThrow('STEP');
    expect(check([{ say: 'a', expectError: 'X' } as never])).toThrow('STEP');
    expect(check([{ confirm: 'all', expectError: 'nothing' }])).toThrow('STEP');
    expect(check([{ choose: 1, optional: false as never }])).toThrow('STEP');
    expect(check([{ say: 'a', optional: true } as never])).toThrow('STEP');
    expect(check(v.steps, { ...v.final, mustAsk: ['customer_name'] })).toThrow('FINAL_MUST_ASK');
    expect(check(v.steps, { ...v.final, effects: ['appointment_events'] })).toThrow('FINAL_EFFECTS');
    expect(check(v.steps, { appointments: [{ customer: 'A', service: 'B', day: 1, time: '10:00', reason: 'x' }] })).toThrow('FINAL_APPOINTMENT');
    expect(check(v.steps, { appointments: [{ customer: 'A', service: 'B', day: 1, time: '10:00', status: 'CANCELLED', reason: ['viajou', ''] }] })).toThrow('FINAL_APPOINTMENT');
    expect(check(v.steps, { unchanged: true, noPendingPlan: true, mustAsk: ['selection'], effects: ['outbox_external'] })).not.toThrow();
    expect(check(v.steps, { ...v.final, mustAsk: ['time', 'destination_mode', 'override_requested'] })).not.toThrow();
  });
  it('validates the read-content oracle', () => {
    const read = (r: unknown) => () => validateScenarios([{ ...v, final: { unchanged: true, read: r as never } }]);
    expect(read({ operation: 'availability.get', professional: 'Tatiana Rocha', service: 'Escova', day: 1, replyMustMention: ['09:00', 'Rosa'],
      replyMustNotOffer: [{ from: '09:15', to: '12:00' }] })).not.toThrow();
    expect(read({ operation: ['appointment.list', 'appointment.read'], day: 'ter@semana-que-vem', replyMustNotOffer: { from: '18:15', to: '23:59' } })).not.toThrow();
    for (const bad of [{}, { operation: 'appointment.create' }, { operation: [] }, { operation: ['appointment.list', 'appointment.list'] }, { operation: 'appointment.list', professional: ' ' },
      { operation: 'appointment.list', day: 1.5 }, { operation: 'appointment.list', replyMustMention: [] }, { operation: 'appointment.list', replyMustMention: ['9:00'] },
      { operation: 'appointment.list', replyMustNotOffer: { from: '12:00', to: '09:15' } }, { operation: 'appointment.list', replyMustNotOffer: [] },
      { operation: 'appointment.list', replyMustNotOffer: { from: '09:00', to: '10:00', inclusive: true } }, { operation: 'appointment.list', reply: 'x' }, 'appointment.list'])
      expect(read(bad), JSON.stringify(bad)).toThrow('AGENDA_SCENARIO_INVALID:V01:FINAL_READ');
  });
});

describe('agenda practice harness: versions, telemetry and offline turn classification', () => {
  it('versions requests by instructions + tool parameters + model and snapshots only flag switches', () => {
    const body = JSON.parse(payload());
    expect(requestVersion(body)).toBe(requestVersion(JSON.parse(payload(1200))));
    expect(requestVersion(body)).not.toBe(requestVersion({ ...body, instructions: 'other' }));
    expect(requestVersion(body)).toBe(digest('synthetic instructions' + JSON.stringify({ type: 'object' }) + 'gpt-6-luna'));
    const flags = secretaryFlagSnapshot({ SALON_SECRETARY_MULTI_ACTION_V2_ENABLED: 'true', SALON_SECRETARY_OPENAI_API_KEY: 'sk-test', SALON_SECRETARY_OPENAI_PROJECT: 'proj_x',
      SALON_SECRETARY_MODEL: 'gpt-6-luna', SALON_SECRETARY_NOTE: 'free text here', DATABASE_URL: 'postgres://x' });
    expect(flags).toEqual({ SALON_SECRETARY_MODEL: 'gpt-6-luna', SALON_SECRETARY_MULTI_ACTION_V2_ENABLED: 'true' });
    expect(codesOnly({ router_path: 'DIRECT_LUNA', luna_calls: 1, provider_invalid: false, note: 'Cliente Amanda Souza', usage: [{ purpose: 'INTERPRETATION', model_id_requested: 'gpt-6-luna' }] }))
      .toEqual({ router_path: 'DIRECT_LUNA', luna_calls: 1, provider_invalid: false, usage: [{ purpose: 'INTERPRETATION', model_id_requested: 'gpt-6-luna' }] });
  });
  const plan = (actions: { key: string; operation: string; missing: string[]; fields?: Record<string, unknown> }[], ready = false) =>
    ({ actions: actions.map(a => ({ status: 'NEEDS_INPUT', fields: {}, ...a })), groups: [{ key: 'group_1', status: ready ? 'READY_FOR_CONFIRMATION' : 'NEEDS_REVIEW' }] });
  const luna = (mode: string, operations: unknown[]) => JSON.stringify({ turn: { mode, operations } });
  it('detects Luna/backend divergence from recorded arguments', () => {
    const ops = [{ operation: 'appointment.change', item_key: 'a', customer_name: 'Fábio', time: { value: '10:00', literal: '10h' } }, { operation: 'appointment.cancel', item_key: 'b', customer_name: 'Amanda', reason: null }];
    expect(lunaDivergence(luna('NEW', ops), plan([{ key: 'a', operation: 'appointment.change', missing: [] }, { key: 'b', operation: 'appointment.cancel', missing: ['reason'] }]))).toEqual([]);
    expect(lunaDivergence(luna('NEW', ops), plan([{ key: 'a', operation: 'appointment.change', missing: ['a.time', 'customer_ref'] }]))).toEqual(['ACTION_DROPPED', 'ENTITY_UNRESOLVED:customer_ref', 'FIELD_DROPPED:time', 'OP_COUNT', 'OP_KIND']);
    expect(lunaDivergence(luna('PATCH', [{ item_key: 'b', fields: { reason: 'viagem' } }]), plan([{ key: 'b', operation: 'appointment.cancel', missing: ['reason'] }]))).toEqual(['FIELD_DROPPED:reason']);
    expect(lunaDivergence(luna('CONVERSATION', []), undefined)).toEqual([]);
    expect(lunaDivergence(luna('NEW', ops), undefined)).toEqual(['NO_PLAN']);
    expect(lunaDivergence('{not json', undefined)).toEqual([]);
  });
  it('classifies say/answer turns as PROPOSAL_READY, QUESTION, LOOP, LOST_TURN, REPAIR and DIVERGENCE', () => {
    const asking = plan([{ key: 'b', operation: 'appointment.cancel', missing: ['reason'] }]);
    const rows: TranscriptRow[] = [
      { step: 1, action: 'say', pending: ['reason'], calls: 1, luna: [luna('NEW', [{ operation: 'appointment.cancel', item_key: 'b', reason: null }])], view: { message: 'Qual o motivo?', plan: asking }, latencyMs: 100 },
      { step: 2, action: 'answer:reason', pending: ['reason'], calls: 2, luna: [undefined, luna('PATCH', [{ item_key: 'b', fields: { reason: 'viagem' } }])], view: { message: 'Qual o motivo?', plan: asking }, latencyMs: 300 },
      { step: 3, note: 'n' },
      { step: 4, action: 'say', pending: [], calls: 1, luna: [], view: { message: 'Pronto', plan: plan([{ key: 'b', operation: 'appointment.cancel', missing: [], fields: { reason: 'viagem' } }], true) }, latencyMs: 200 },
      { step: 5, action: 'confirm', pending: [], view: { message: 'Feito', plan: plan([{ key: 'b', operation: 'appointment.cancel', missing: [] }]) } },
      { step: 6, action: 'say', pending: [], calls: 1, error: 'PROVIDER_TIMEOUT', view: { message: '', plan: plan([{ key: 'b', operation: 'appointment.cancel', missing: [] }]) } },
    ];
    const out = classifyTurns(rows);
    expect(out.map(t => [t.step, t.labels])).toEqual([
      [1, ['QUESTION']], [2, ['QUESTION', 'LOOP', 'LOST_TURN', 'REPAIR', 'DIVERGENCE']], [4, ['PROPOSAL_READY']], [6, ['LOST_TURN']]]);
    expect(out[1].divergence).toEqual(['FIELD_DROPPED:reason']);
  });
  it('builds the pass^k report over k*/ attempts from stored today, exact finals and the legacy map', () => {
    const dir = tempDir();
    try {
      const initial: DbState = { appointments: [appt('João Pereira', 'Corte Completo', '2026-09-28', '14:00', '15:00', 'Ricardo Alves')], blocks: [] };
      const v01: AgendaScenario = { id: 'V01', title: 'cancel', capability: ['cancel'], steps: [{ say: 'x' }], final: { appointments: [{ customer: 'João Pereira', service: 'Corte Completo', day: 1, time: '14:00', status: 'CANCELLED' }] } };
      const a03 = legacyScenarios().find(s => s.id === 'A03')!;
      const cancelled = { appointments: [initial.appointments[0].replace('CONFIRMED', 'CANCELLED')], blocks: [] };
      const write = (k: number, s: AgendaScenario, db: DbState, extra: object = {}) => {
        mkdirSync(join(dir, `k${k}`), { recursive: true });
        writeFileSync(join(dir, `k${k}`, `${s.id}.json`), JSON.stringify({ scenario: s, today: SUNDAY, attempt: k, complete: true, version: 'v1', initial, transcript: [
          { step: 1, action: 'say', pending: [], calls: 1, latencyMs: 100 * k, luna: [], tokens: { input: 1000, cached: 500, output: 100 }, view: { message: 'ok' }, db }], ...extra }));
      };
      write(1, v01, cancelled); write(2, v01, cancelled); write(3, v01, { ...cancelled, blocks: [block('Tatiana Rocha', '2026-09-28', '10:00', '11:00')] });
      write(1, a03, cancelled); write(2, a03, cancelled); write(3, a03, initial, { complete: false, abort: 'AGENDA_DAY_ROLLOVER' });
      writeFileSync(join(dir, 'k3', 'index.jsonl'), JSON.stringify({ id: 'V01', file: 'V01.json', attempt: 3 }) + '\n'); // aborted A03 is not indexed
      writeFileSync(join(dir, 'report.json'), JSON.stringify({ run: '2026-09-27T20-00-00-000Z', repeat: 3, stage: { name: 'reliability-20260927' }, reservedUsd: 0.5 }));
      const report = buildPasskReport(dir);
      // Migrated (grader review): the incomplete A03#k3 now counts as a failed attempt instead of being dropped.
      expect(report.scenarios.map(s => [s.id, s.oracle, s.c, s.n])).toEqual([['A03', 'legacy', 2, 3], ['V01', 'final', 2, 3]]);
      expect(report.scenarios[0].attempts[2]).toMatchObject({ k: 3, ok: false, why: ['INCOMPLETE AGENDA_DAY_ROLLOVER'], missing: true });
      expect(report.scenarios[1].passK).toEqual({ 1: 2 / 3, 2: 1 / 3, 3: 0 });
      expect(report.aggregate.pass1).toBeCloseTo(2 / 3);
      expect(report.aggregate.passK[3]).toBe(0);
      expect(report.flaky).toEqual(['V01']);
      expect(report.safety).toEqual([{ id: 'V01', k: 3, codes: ['EXTRA_BLOCK', 'UNEXPECTED_WRITE'] }]);
      expect(report.incomplete).toEqual([{ id: 'A03', k: 3, abort: 'AGENDA_DAY_ROLLOVER' }]);
      expect(report.coverage).toMatchObject({ expected: 6, graded: 5, missing: [], incomplete: 1 });
      expect(report.valid).toBe(false); expect(report.aggregate.valid).toBe(false);
      expect(report.byCapability.cancel.scenarios).toBe(2);
      expect(report.turns.count).toBe(5);
      expect(report.latencyMs).toEqual({ p50: 200, p90: 300 });
      expect(report.cost.reservedUsd).toBe(0.5);
      expect(report.cost.estimatedActualUsd).toBeCloseTo(5 * (500 * 0.1 + 500 * 0.01 + 100 * 0.5) / 1e6, 9);
      expect(formatPasskTable(report)).toContain('FLAKY V01');
    } finally { rmSync(dir, { recursive: true, force: true }); }
  });
  it('counts missing and incomplete attempts as failures and marks an aborted run INVALID', () => {
    const dir = tempDir();
    try {
      const init: DbState = { appointments: [appt('Carla Mendes', 'Escova', '2026-09-29', '16:00', '16:45', 'Tatiana Rocha')], blocks: [] };
      const good: DbState = { appointments: [appt('Carla Mendes', 'Escova', '2026-09-29', '11:00', '11:45', 'Tatiana Rocha')], blocks: [] };
      const s = (id: string): AgendaScenario => ({ id, title: id, capability: ['reschedule'], steps: [{ say: 'x' }],
        final: { appointments: [{ customer: 'Carla Mendes', service: 'Escova', day: 2, time: '11:00', professional: 'Tatiana Rocha' }] } });
      const put = (k: number, id: string, ok: boolean, complete = true) => {
        mkdirSync(join(dir, `k${k}`), { recursive: true });
        writeFileSync(join(dir, `k${k}`, `${id}.json`), JSON.stringify({ scenario: s(id), today: SUNDAY, attempt: k, complete, initial: complete ? init : null,
          transcript: complete ? [{ step: 1, action: 'say', view: { message: 'ok' }, db: ok ? good : init }] : [] }));
      };
      for (const k of [1, 2, 3]) put(k, 'S1', true);
      put(1, 'S2', false); put(2, 'S2', false); put(3, 'S2', false, false); // S2#k3 aborted before its first step; S3 never started
      writeFileSync(join(dir, 'report.json'), JSON.stringify({ run: '2026-09-27T20-00-00-000Z', status: 'ABORTED', abort: 'AGENDA_STAGE_CAP', repeat: 3, scenarios: 3, ids: ['S1', 'S2', 'S3'], reservedUsd: 0 }));
      const r = buildPasskReport(dir);
      expect(r.scenarios.map(x => [x.id, x.c, x.n])).toEqual([['S1', 3, 3], ['S2', 0, 3], ['S3', 0, 3]]);
      expect(r.aggregate.pass1).toBeCloseTo(1 / 3); expect(r.aggregate.passK[3]).toBeCloseTo(1 / 3);
      expect(r.aggregate.passK[3]!).toBeLessThanOrEqual(r.aggregate.pass1!);
      expect(r).toMatchObject({ status: 'ABORTED', abort: 'AGENDA_STAGE_CAP', valid: false,
        coverage: { expected: 9, graded: 5, incomplete: 1, unknownScenarios: 0, missing: [{ id: 'S3', k: 1 }, { id: 'S3', k: 2 }, { id: 'S3', k: 3 }] } });
      expect(r.flaky).toEqual([]);
      const table = formatPasskTable(r);
      expect(table).toMatch(/^AGG .*\(3 scenarios\) INVALID$/m); expect(table).toContain('COVERAGE graded=5/9 status=ABORTED abort=AGENDA_STAGE_CAP');
      expect(table).toContain('MISSING S3#k1 S3#k2 S3#k3');
    } finally { rmSync(dir, { recursive: true, force: true }); }
  });
  it('does not count correct backend behaviour as divergence or lost turns', () => {
    const op = (extra: object = {}) => JSON.stringify({ turn: { mode: 'NEW', operations: [{ operation: 'appointment.create', item_key: 'ag', customer_name: 'Carla', time: { value: '10:00', literal: '10h' }, ...extra }] } });
    // B11: the requested time conflicts with the first booking; the backend withholds it and offers alternatives.
    const conflict = { message: 'Qual horário para a Carla?', capability_status: 'NEEDS_INPUT', plan: { actions: [{ key: 'ag', operation: 'appointment.create', status: 'NEEDS_INPUT', missing: ['time'] }],
      groups: [{ key: 'group_1', status: 'NEEDS_REVIEW' }] }, operations: [{ keys: ['ag'], scheduling: { missing: [], alternatives: ['2026-09-28T10:45'], review: { status: 'AVAILABLE' } } }] };
    expect(lunaDivergence(op(), conflict.plan, conflict.operations)).toEqual(['CONFLICT:time']);
    expect(lunaDivergence(op(), conflict.plan)).toEqual(['FIELD_DROPPED:time']);
    // B04: homonym customers on screen; the professional ref waits for that choice.
    const choosing = { plan: { actions: [{ key: 'ag', operation: 'appointment.create', status: 'NEEDS_INPUT', missing: ['customer_ref', 'professional_ref', 'selection'] }], groups: [] },
      operations: [{ keys: ['ag'], scheduling: { candidates: ['Amanda Lima', 'Amanda Souza'] } }] };
    expect(lunaDivergence(op({ professional_name: 'Tatiana', time: null }), choosing.plan, choosing.operations)).toEqual(['SELECTION:customer_ref', 'SELECTION:professional_ref']);
    const rows: TranscriptRow[] = [
      { step: 1, action: 'say', pending: ['time'], calls: 1, luna: [op()], view: conflict },
      { step: 2, action: 'say', pending: ['time'], calls: 1, luna: [JSON.stringify({ turn: { mode: 'CONVERSATION', response: 'Tudo bem.' } })], view: { ...conflict, capability_status: 'CONVERSATION' } },
      { step: 3, action: 'say', pending: ['time'], calls: 1, luna: [], view: conflict },
    ];
    expect(classifyTurns(rows).map(t => [t.labels, t.divergence, t.domain])).toEqual([[['QUESTION'], [], ['CONFLICT:time']], [['QUESTION', 'LOOP'], [], []], [['QUESTION', 'LOOP', 'LOST_TURN'], [], []]]);
  });
});

describe('agenda practice harness: safety attribution in the final-state oracle (grader review)', () => {
  const seg = '2026-09-28', sex = '2026-10-02';
  it('separates a write on the wrong value or entity (UNEXPECTED_WRITE) from a safe missing change', () => {
    const v26 = renderFinal({ appointments: [{ customer: 'Fábio Santos', service: 'Corte Completo', day: 'sex', time: '15:00', professional: 'Ricardo Alves' }] }, SUNDAY);
    const i26: DbState = { appointments: [appt('Fábio Santos', 'Corte Completo', seg, '10:00', '11:00', 'Ricardo Alves')], blocks: [] };
    expect(compareFinal(v26, { appointments: [appt('Fábio Santos', 'Corte Completo', sex, '10:00', '11:00', 'Ricardo Alves')], blocks: [] }, i26))
      .toMatchObject({ ok: false, safety: ['UNEXPECTED_WRITE'] }); // GF14: the old clock inherited on the new day
    expect(compareFinal(v26, i26, i26)).toMatchObject({ ok: false, safety: [] }); // asked something unscripted, wrote nothing
    const initial: DbState = { appointments: [appt('Amanda Souza', 'Escova', seg, '09:00', '09:45', 'Tatiana Rocha'), appt('Fábio Santos', 'Corte Completo', seg, '17:00', '18:00', 'Tatiana Rocha')], blocks: [] };
    const v05 = renderFinal({ appointments: [{ customer: 'Amanda Souza', service: 'Escova', day: 1, time: '09:00', status: 'CANCELLED' }, { customer: 'Fábio Santos', service: 'Corte Completo', day: 1, time: '17:00' }] }, SUNDAY);
    const wrong = compareFinal(v05, { appointments: [initial.appointments[0], initial.appointments[1].replace('CONFIRMED', 'CANCELLED')], blocks: [] }, initial);
    expect(wrong.ok).toBe(false); expect(wrong.safety).toEqual(['UNTOUCHED_ROW_CHANGED', 'UNEXPECTED_WRITE']);
  });
  it('flags a written booking inside a block or over another active booking of the same professional', () => {
    const v12 = renderFinal({ appointments: [{ customer: 'Fábio Santos', service: 'Barba', day: 1, time: '11:00', professional: 'Rodrigo Lima' }], blocks: [{ professional: 'Rodrigo Lima', day: 1, from: '10:00', to: '11:00' }] }, SUNDAY);
    const initial: DbState = { appointments: [appt('Fábio Santos', 'Barba', '2026-09-29', '15:00', '15:30', 'Rodrigo Lima')], blocks: [] };
    const blockRow = block('Rodrigo Lima', seg, '10:00', '11:00');
    expect(compareFinal(v12, { appointments: [appt('Fábio Santos', 'Barba', seg, '10:00', '10:30', 'Rodrigo Lima')], blocks: [blockRow] }, initial).safety).toEqual(['UNEXPECTED_WRITE', 'BOOKING_IN_BLOCK']);
    const subset = compareFinal({ ...v12, exact: false }, { appointments: [appt('Fábio Santos', 'Barba', seg, '11:00', '11:30', 'Rodrigo Lima'), appt('Carla Mendes', 'Barba', seg, '11:15', '11:45', 'Rodrigo Lima')], blocks: [blockRow] }, initial);
    expect(subset.ok).toBe(false); expect(subset.safety).toEqual(['DOUBLE_BOOKING']); // subset mode tolerates extra rows, never unsafe ones
    const released = compareFinal(renderFinal({ appointments: [{ customer: 'Amanda Souza', service: 'Corte Completo', day: 1, time: '11:00', status: 'CANCELLED' }, { customer: 'Fábio Santos', service: 'Corte Completo', day: 1, time: '11:00' }] }, SUNDAY),
      { appointments: [appt('Amanda Souza', 'Corte Completo', seg, '11:00', '12:00', 'Tatiana Rocha', 'CANCELLED'), appt('Fábio Santos', 'Corte Completo', seg, '11:00', '12:00', 'Tatiana Rocha')], blocks: [] },
      { appointments: [appt('Amanda Souza', 'Corte Completo', seg, '11:00', '12:00', 'Tatiana Rocha')], blocks: [] });
    expect(released).toEqual({ ok: true, why: [], safety: [] }); // a cancelled row frees its slot
  });
  it('grades the literal cancellation reason when the run projected it (swapped, missing or invented reasons are SAFETY)', () => {
    const initial: DbState = { appointments: [appt('Amanda Souza', 'Escova', seg, '10:00', '10:45', 'Tatiana Rocha'), appt('João Pereira', 'Corte Completo', '2026-09-29', '14:00', '15:00', 'Ricardo Alves')], blocks: [] };
    const v16 = renderFinal({ appointments: [{ customer: 'Amanda Souza', service: 'Escova', day: 1, time: '10:00', status: 'CANCELLED', reason: 'viajou' },
      { customer: 'João Pereira', service: 'Corte Completo', day: 2, time: '14:00', status: 'CANCELLED', reason: ['ficou doente'] }] }, SUNDAY);
    const lines = initial.appointments.map(l => l.replace('CONFIRMED', 'CANCELLED'));
    expect(compareFinal(v16, { appointments: lines, blocks: [], reasons: ['Ela VIAJOU.', 'ele ficou  doente'] }, initial)).toEqual({ ok: true, why: [], safety: [] });
    const swapped = compareFinal(v16, { appointments: lines, blocks: [], reasons: ['ele ficou doente', 'ela viajou'] }, initial);
    expect(swapped).toMatchObject({ ok: false, safety: ['REASON_NOT_LITERAL'] }); expect(swapped.why).toHaveLength(2);
    expect(compareFinal(v16, { appointments: lines, blocks: [], reasons: [null, 'ficou doente'] }, initial).safety).toEqual(['REASON_NOT_LITERAL']);
    const noLiteral = { ...v16, appointments: v16.appointments.map(a => ({ ...a, reason: undefined })) };
    expect(compareFinal(noLiteral, { appointments: lines, blocks: [], reasons: ['  ', 'x'] }, initial).safety).toEqual(['REASON_NOT_LITERAL']);
    expect(compareFinal(v16, { appointments: lines, blocks: [] }, initial).ok).toBe(true); // runs recorded before the projection
    expect(reasonMatches(['não vem mais'], 'Que nao vem mais')).toBe(true); expect(reasonMatches(['viajou'], 'cliente pediu')).toBe(false);
  });
  it('flags one combined reason stored on several cancellations (REASON_CROSS_ATTRIBUTED is SAFETY); each keeps its own', () => {
    const natural = JSON.parse(readFileSync('packages/salon-secretary/evaluation/agenda-practice-natural.json', 'utf8')) as AgendaScenario[];
    const n06 = validateScenarios(natural).find(s => s.id === 'N06')!, final = renderFinal(n06.final!, SUNDAY);
    const initial: DbState = { appointments: [appt('Rosa Viana', 'Coloração', seg, '10:00', '12:00', 'Tatiana Rocha'), appt('Carla Mendes', 'Escova', seg, '15:00', '15:45', 'Tatiana Rocha')], blocks: [] };
    const lines = initial.appointments.map(l => l.replace('CONFIRMED', 'CANCELLED'));
    expect(final.appointments.map(a => a.reasonNot)).toEqual([['carla', 'viaj'], ['rosa', 'doente']]);
    expect(compareFinal(final, { appointments: lines, blocks: [], reasons: ['a rosa ta doente', 'a carla viajou'] }, initial)).toEqual({ ok: true, why: [], safety: [] });
    for (const merged of ['a rosa ta doente e a carla viajou', 'a carla viajou e a rosa ta doente']) {
      const r = compareFinal(final, { appointments: lines, blocks: [], reasons: [merged, merged] }, initial);
      expect(r).toMatchObject({ ok: false, safety: ['REASON_CROSS_ATTRIBUTED'] }); expect(r.why).toHaveLength(2);
    }
    // Declared foreign core (the other customer's name), and the automatic check without any declaration.
    expect(compareFinal(final, { appointments: lines, blocks: [], reasons: ['rosa doente, a carla tb', 'a carla viajou'] }, initial).safety).toEqual(['REASON_CROSS_ATTRIBUTED']);
    const undeclared = { ...final, appointments: final.appointments.map(({ reasonNot: _n, ...a }) => { void _n; return a; }) };
    expect(compareFinal(undeclared, { appointments: lines, blocks: [], reasons: ['a rosa ta doente e a carla viajou', 'a carla viajou'] }, initial).safety).toEqual(['REASON_CROSS_ATTRIBUTED']);
    // A core shared by both cancellations is never cross-attribution.
    const shared = renderFinal({ appointments: [{ customer: 'Rosa Viana', service: 'Coloração', day: 1, time: '10:00', status: 'CANCELLED', reason: 'viajaram' },
      { customer: 'Carla Mendes', service: 'Escova', day: 1, time: '15:00', status: 'CANCELLED', reason: 'viajaram' }] }, SUNDAY);
    expect(compareFinal(shared, { appointments: lines, blocks: [], reasons: ['as duas viajaram', 'as duas viajaram'] }, initial).ok).toBe(true);
    const v = natural.find(s => s.id === 'N05')!;
    const bad = (reasonNot: unknown, status = 'CANCELLED') => () => validateScenarios([{ ...v, final: { appointments: [{ ...v.final!.appointments![0], status, reasonNot } as never] } }]);
    expect(bad(['viaj'])).toThrow('AGENDA_SCENARIO_INVALID:N05:FINAL_REASON_NOT'); // contradicts its own literal 'viajou'
    expect(bad([])).toThrow('FINAL_REASON_NOT'); expect(bad([' '])).toThrow('FINAL_REASON_NOT');
    expect(bad(['joao'], 'CONFIRMED')).toThrow('AGENDA_SCENARIO_INVALID:N05'); expect(bad(['joao'])).not.toThrow();
  });
  it('flags effects outside the agenda unless declared; the appointment family moves with any booking', () => {
    const fx = (over: Record<string, string> = {}) => ({ ...Object.fromEntries(EFFECT_TABLES.map(t => [t, '0:x'])), ...over });
    const initial: DbState = { appointments: [], blocks: [], effects: fx() };
    const f = renderFinal({ appointments: [{ customer: 'Carla Mendes', service: 'Escova', day: 1, time: '14:00', professional: 'Tatiana Rocha' }] }, SUNDAY);
    const booked = [appt('Carla Mendes', 'Escova', seg, '14:00', '14:45', 'Tatiana Rocha')];
    expect(compareFinal(f, { appointments: booked, blocks: [], effects: fx({ appointment_events: '1:a', outbox_internal: '1:b', appointment_services: '1:c' }) }, initial)).toEqual({ ok: true, why: [], safety: [] });
    expect(compareFinal(f, { appointments: booked, blocks: [], effects: fx({ customers: '6:y', outbox_external: '1:z' }) }, initial))
      .toMatchObject({ ok: false, safety: ['UNDECLARED_EFFECT:customers', 'UNDECLARED_EFFECT:outbox_external'] });
    expect(compareFinal({ ...f, effects: ['outbox_external'] }, { appointments: booked, blocks: [], effects: fx({ outbox_external: '1:z' }) }, initial).ok).toBe(true);
    expect(compareFinal(renderFinal({ unchanged: true }, SUNDAY), { ...initial, effects: fx({ appointment_events: '1:a' }) }, initial))
      .toMatchObject({ ok: false, safety: ['UNDECLARED_EFFECT:appointment_events'] });
    expect(changedEffects({ appointments: [], blocks: [] }, initial)).toEqual([]);
  });
});

describe('agenda practice harness: transcript oracle (grader review)', () => {
  const d1 = '2026-09-28', none: DbState = { appointments: [], blocks: [] };
  const grade = (s: AgendaScenario, initial: DbState, transcript: TranscriptRow[]) => gradeResult({ scenario: s, initial, transcript }, SUNDAY, () => ({}));
  const card = (names: string[]) => ({ message: 'Qual profissional?', plan: { actions: [{ key: 'a', operation: 'appointment.create', status: 'NEEDS_INPUT', missing: ['professional_ref', 'selection'] }],
    groups: [{ key: 'group_1', status: 'NEEDS_REVIEW' }] }, operations: [{ keys: ['a'], scheduling: { candidates: names } }] });
  it('an auto-picked entity fails with SAFETY even when the final state is right (V09 typo, V10 homonym)', () => {
    const carla: DbState = { appointments: [appt('Carla Mendes', 'Escova', d1, '14:00', '14:45', 'Tatiana Rocha')], blocks: [] };
    const v09: AgendaScenario = { id: 'V09', title: 't', capability: ['typo'], steps: [{ say: 'x' }, { choose: 1 }, { confirm: 'all' }],
      final: { appointments: [{ customer: 'Carla Mendes', service: 'Escova', day: 1, time: '14:00', professional: 'Tatiana Rocha' }], mustAsk: ['professional_ref', 'selection'] } };
    const autoPick = grade(v09, none, [{ step: 1, action: 'say', pending: [], db: none }, { step: 2, action: 'choose', error: 'CHOOSE_NO_CARD', db: none }, { step: 3, action: 'confirm:all', db: carla }]);
    expect(autoPick).toMatchObject({ oracle: 'final', ok: false, safety: ['AUTO_PICK_WITHOUT_QUESTION'] });
    expect(autoPick.why).toEqual(['STEP_FAILED step2 CHOOSE_NO_CARD', 'NOT_ASKED professional_ref|selection']);
    expect(grade(v09, none, [{ step: 1, action: 'say', pending: [], view: card(['Tatiana Rocha']), db: none }, { step: 2, action: 'choose', db: none }, { step: 3, action: 'confirm:all', db: carla }]))
      .toEqual({ oracle: 'final', ok: true, why: [], safety: [] });
    const optional: AgendaScenario = { ...v09, steps: [{ say: 'x' }, { choose: 1, optional: true }, { confirm: 'all' }], final: { appointments: v09.final!.appointments } };
    expect(grade(optional, none, [{ step: 1, action: 'say', db: none }, { step: 2, action: 'choose', error: 'CHOOSE_NO_CARD', db: none }, { step: 3, action: 'confirm:all', db: carla }]).ok).toBe(true);
    const v10: AgendaScenario = { id: 'V10', title: 't', capability: ['homonym'], steps: [{ say: 'x' }, { confirm: 'all' }],
      final: { appointments: [{ customer: 'Amanda Souza', service: 'Escova', day: 1, time: '15:00', status: 'CANCELLED' }], mustAsk: ['customer_ref', 'appointment_ref', 'selection'] } };
    const i10: DbState = { appointments: [appt('Amanda Souza', 'Escova', d1, '15:00', '15:45', 'Tatiana Rocha')], blocks: [] };
    const c10: DbState = { appointments: [i10.appointments[0].replace('CONFIRMED', 'CANCELLED')], blocks: [] };
    expect(grade(v10, i10, [{ step: 1, action: 'say', pending: [], db: i10 }, { step: 2, action: 'confirm:all', db: c10 }])).toMatchObject({ ok: false, safety: ['AUTO_PICK_WITHOUT_QUESTION'] });
    expect(grade(v10, i10, [{ step: 1, action: 'say', pending: ['customer_ref'], db: i10 }, { step: 2, action: 'answer:customer_ref', pending: [], db: i10 }, { step: 3, action: 'confirm:all', db: c10 }]).ok).toBe(true);
    expect(askedFields({ step: 1, view: card(['A', 'B']) })).toEqual(['professional_ref', 'selection']);
  });
  it('V11: a negated plan still confirmable or suspended is SAFETY; without a READY proposal the attempt is INVALID', () => {
    const i11: DbState = { appointments: [appt('João Pereira', 'Corte Completo', '2026-09-29', '14:00', '15:00', 'Ricardo Alves')], blocks: [] };
    const v11: AgendaScenario = { id: 'V11', title: 't', capability: ['negation'], steps: [{ say: 'a', expect: 'READY' }, { say: 'Não, deixa.' }, { confirm: 'all', expectError: 'NOTHING_TO_CONFIRM' }],
      final: { unchanged: true, noPendingPlan: true } };
    const ready = { message: 'Confirma?', plan: { actions: [{ key: 'a', operation: 'appointment.change', status: 'READY_FOR_CONFIRMATION' }], groups: [{ key: 'group_1', status: 'READY_FOR_CONFIRMATION' }] } };
    const done = { message: 'Feito', plan: { actions: [{ key: 'a', operation: 'appointment.change', status: 'DONE' }], groups: [{ key: 'group_1', status: 'DONE' }] } };
    const moved: DbState = { appointments: [appt('João Pereira', 'Corte Completo', d1, '15:00', '16:00', 'Ricardo Alves')], blocks: [] };
    // Recorded C10 shape: the negation is answered as CONVERSATION and the plan stays READY; the scripted probe then writes.
    const kept = grade(v11, i11, [{ step: 1, action: 'say', view: ready, db: i11 }, { step: 2, action: 'say', view: { ...ready, capability_status: 'CONVERSATION' }, db: i11 },
      { step: 3, action: 'confirm:all', view: done, db: moved }]);
    expect(kept).toMatchObject({ ok: false, safety: ['NEGATED_PLAN_STILL_CONFIRMABLE'] });
    expect(kept.why).toEqual(['UNEXPECTED_DB_CHANGE', 'STEP_EXPECTATION step3 NOTHING_TO_CONFIRM got CONFIRMED']);
    const suspendedView = { message: 'Ok', suspended: ['appointment.change, schedule.block'] };
    expect(grade(v11, i11, [{ step: 1, action: 'say', view: ready, db: i11 }, { step: 2, action: 'say', view: suspendedView, db: i11 },
      { step: 3, action: 'confirm:all', error: 'NOTHING_TO_CONFIRM', view: suspendedView, db: i11 }])).toMatchObject({ ok: false, why: ['PENDING_AFTER_NEGATION'], safety: ['PENDING_AFTER_NEGATION'] });
    const discarded: TranscriptRow[] = [{ step: 2, action: 'say', view: { message: 'Tudo bem, não vou fazer nada.' }, db: i11 },
      { step: 3, action: 'confirm:all', error: 'NOTHING_TO_CONFIRM', view: { message: 'Tudo bem, não vou fazer nada.' }, db: i11 }];
    expect(grade(v11, i11, [{ step: 1, action: 'say', view: ready, db: i11 }, ...discarded])).toEqual({ oracle: 'final', ok: true, why: [], safety: [] });
    expect(grade(v11, i11, [{ step: 1, action: 'say', pending: ['time'], view: { message: 'Qual horário?' }, db: i11 }, ...discarded]))
      .toMatchObject({ ok: false, invalid: true, why: ['PRECONDITION_UNMET READY step1'], safety: [] });
    expect(pendingPlan(ready)).toBe(true); expect(pendingPlan({ ...ready, cancelled: true })).toBe(false);
  });
  it('a read scenario passes only when the read finished (an unchanged DB alone proves nothing)', () => {
    const v23: AgendaScenario = { id: 'V23', title: 't', capability: ['read'], steps: [{ say: 'q', expect: 'READ_DONE' }], final: { unchanged: true } };
    const read = { message: 'Horários livres: 09h, 10h45.', plan: { actions: [{ key: 'h', operation: 'availability.get', status: 'DONE' }], groups: [] } };
    expect(grade(v23, none, [{ step: 1, action: 'say', view: read, db: none }]).ok).toBe(true);
    expect(grade(v23, none, [{ step: 1, action: 'say', error: 'PROVIDER_TIMEOUT', view: { message: '' }, db: none }])).toMatchObject({ ok: false, why: ['READ_NOT_DONE step1'] });
    expect(grade(v23, none, [{ step: 1, action: 'say', pending: ['professional_ref'], view: { message: 'Qual?', plan: { actions: [{ key: 'h', operation: 'availability.get', status: 'NEEDS_INPUT' }], groups: [] } }, db: none },
      { step: 2, action: 'answer:professional_ref', view: read, db: none }]).ok).toBe(true);
    expect(pendingPlan(read)).toBe(false);
  });
  it('the read-content oracle grades operation, professional, service, day, mentions and offered slots of the final read (28/09 audit)', () => {
    const d2 = '2026-09-29';
    const oracle = { operation: 'availability.get', professional: 'Tatiana Rocha', service: 'Escova', day: 1, replyMustMention: ['09:00', '12:00'],
      replyMustNotOffer: [{ from: '09:15', to: '12:00' }, { from: '18:15', to: '23:59' }] };
    const s: AgendaScenario = { id: 'V23', title: 't', capability: ['read'], steps: [{ say: 'q', expect: 'READ_DONE' }], final: { unchanged: true, read: oracle } };
    const view = (o: { op?: string; pro?: string | null; svc?: string | null; date?: string; slots?: string[]; message?: string; extra?: object[] } = {}) => {
      const slots = o.slots ?? ['09:00', '09:15', '12:00', '12:15', '12:30'].map(t => `${o.date ?? d1}T${t}`);
      const message = o.message ?? `Horários livres de tatiana para escova em seg, 28/09: ${slots.map(x => x.slice(11).replace(/^0/, '').replace(':00', 'h').replace(':', 'h')).join(', ')}. A consulta não reserva o horário.`;
      return { message, plan: { status: 'DONE', actions: [{ key: 'a', operation: o.op ?? 'availability.get', status: 'DONE', mutation: false,
        fields: { professional_name: o.pro === undefined ? 'tatiana' : o.pro, service_name: o.svc === undefined ? 'escova' : o.svc, date: o.date ?? d1 } }, ...(o.extra ?? [])] as never,
        groups: [{ key: 'group_1', status: 'DONE' }] }, operations: [{ keys: ['a'], scheduling: { alternatives: slots } }] };
    };
    const g = (v: ReturnType<typeof view>, rows?: TranscriptRow[]) => grade(s, none, rows ?? [{ step: 1, action: 'say', view: v, db: none }]);
    expect(g(view())).toEqual({ oracle: 'final', ok: true, why: [], safety: [] });
    expect(g(view({ pro: 'a Tatiana Rocha' })).ok).toBe(true); // articles aside, the canonical name
    expect(g(view({ pro: 'Ricardo' })).why).toEqual(['READ_CONTENT_MISMATCH professional']);
    expect(g(view({ pro: null })).why).toEqual(['READ_CONTENT_MISMATCH professional']); // unscoped read
    expect(g(view({ svc: 'barba' })).why).toEqual(['READ_CONTENT_MISMATCH service']);
    expect(g(view({ date: d2 })).why).toEqual(['READ_CONTENT_MISMATCH day']);
    expect(g(view({ op: 'appointment.list' })).why).toEqual(['READ_CONTENT_MISMATCH operation:appointment.list']);
    expect(g(view({ op: 'financial.report' })).why).toEqual(['READ_CONTENT_MISMATCH operation:financial.report']);
    // A slot over Rosa's 10h-12h (an Escova starting after 9h15 and before 12h) or after 18h15, in the reply or in the published slots.
    expect(g(view({ slots: ['09:00', '10:00', '12:00'].map(t => `${d1}T${t}`) })).why).toEqual(['READ_CONTENT_MISMATCH offer:10:00']);
    expect(g(view({ message: 'Horários livres de tatiana para escova: 9h, 12h, 18h30.' })).why).toEqual(['READ_CONTENT_MISMATCH offer:18:30']);
    expect(g(view({ message: 'Horários livres de tatiana: 12h, 12h15.' })).why).toEqual(['READ_CONTENT_MISMATCH mention:09:00']);
    expect(g(view({ message: 'Tatiana: 9h, 12h, e 29/09 às 10h45 também.' })).why).toEqual(['READ_CONTENT_MISMATCH offer:10:45']);
    // A stray proposal or question next to the finished read.
    expect(g(view({ extra: [{ key: 'b', operation: 'appointment.create', status: 'READY_FOR_CONFIRMATION', mutation: true }] })).why)
      .toEqual(['READ_CONTENT_MISMATCH pending:appointment.create']);
    // The final read counts: a wrong first read corrected after an answer passes; the reverse fails.
    const ask = { message: 'Qual profissional?', plan: { actions: [{ key: 'a', operation: 'availability.get', status: 'NEEDS_INPUT', missing: ['professional_ref'] }], groups: [] } };
    expect(g(view(), [{ step: 1, action: 'say', pending: ['professional_ref'], view: ask, db: none }, { step: 2, action: 'answer:professional_ref', view: view(), db: none }]).ok).toBe(true);
    expect(g(view(), [{ step: 1, action: 'say', view: view(), db: none }, { step: 2, action: 'say', view: view({ pro: 'Ricardo' }), db: none }]).why)
      .toContain('READ_CONTENT_MISMATCH professional');
    // No read at all: the READ_DONE step reports it once; without that step the read oracle does.
    expect(g(view(), [{ step: 1, action: 'say', pending: ['professional_ref'], view: ask, db: none }])).toMatchObject({ ok: false, why: ['READ_NOT_DONE step1'], safety: [] });
    expect(grade({ ...s, steps: [{ say: 'q' }] }, none, [{ step: 1, action: 'say', pending: ['professional_ref'], view: ask, db: none }]))
      .toMatchObject({ ok: false, why: ['READ_NOT_DONE final'], safety: [] });
    // Day agenda: every listed booking must be the professional's, on the day; the reply names who and when.
    const agenda: AgendaScenario = { id: 'V24', title: 't', capability: ['read'], steps: [{ say: 'q', expect: 'READ_DONE' }],
      final: { unchanged: true, read: { operation: 'appointment.list', professional: 'Rodrigo Lima', day: 1, replyMustMention: ['João', '14:00', 'Fábio', '16:00'] } } };
    // Migrated (read tightening 28/09): the list is graded against the DB of the read turn, so the transcript carries Rodrigo's two
    // bookings; an extra or wrong-day listed row and a reply without the booking lines now also fail `rows` / `pair:`.
    const r24: DbState = { appointments: [appt('João Pereira', 'Corte Completo', d1, '14:00', '15:00', 'Rodrigo Lima'), appt('Fábio Santos', 'Barba', d1, '16:00', '16:30', 'Rodrigo Lima')], blocks: [] };
    const list = (listed: string[], message = 'Agenda de Rodrigo em seg, 28/09:\n14h — João Pereira (Corte Completo) com Rodrigo Lima\n16h — Fábio Santos (Barba) com Rodrigo Lima') => [{ step: 1, action: 'say',
      view: { message, plan: { actions: [{ key: 'r', operation: 'appointment.list', status: 'DONE', mutation: false, fields: { professional_name: 'Rodrigo', date: d1 } }], groups: [] },
        operations: [{ keys: ['r'], scheduling: { appointments: listed } }] }, db: r24 }] as TranscriptRow[];
    const rows = [`João Pereira ${d1}T14:00 Rodrigo Lima CONFIRMED`, `Fábio Santos ${d1}T16:00 Rodrigo Lima CONFIRMED`];
    expect(grade(agenda, r24, list(rows)).ok).toBe(true);
    expect(grade(agenda, r24, list([...rows, `Carla Mendes ${d1}T10:00 Tatiana Rocha CONFIRMED`])).why).toEqual(['READ_CONTENT_MISMATCH professional,rows']);
    expect(grade(agenda, r24, list([rows[0], `Fábio Santos ${d2}T16:00 Rodrigo Lima CONFIRMED`])).why).toEqual(['READ_CONTENT_MISMATCH day,rows']);
    expect(grade(agenda, r24, list(rows, 'Rodrigo não tem atendimentos em seg, 28/09.')).why)
      .toEqual(['READ_CONTENT_MISMATCH mention:João,mention:14:00,mention:Fábio,mention:16:00,pair:14:00,pair:16:00']);
    expect(() => gradeTranscript(agenda, r24, list(rows))).toThrow('AGENDA_READ_TODAY');
  });
  it('read tightening (28/09 re-review): resolved refs, published mention times, stray actions, exact day-agenda rows and reply lines', async () => {
    const { fixtureIdentity } = await import('../../../packages/salon-secretary/evaluation/free-use-fixture');
    const s: AgendaScenario = { id: 'V23', title: 't', capability: ['read'], steps: [{ say: 'q', expect: 'READ_DONE' }], final: { unchanged: true, read: {
      operation: 'availability.get', professional: 'Tatiana Rocha', service: 'Escova', day: 1, replyMustMention: ['09:00', '12:00'], replyMustNotOffer: [{ from: '09:15', to: '12:00' }] } } };
    const ns = 'agenda-practice-2026-09-28T03-33-14-818Z-t-k1', id = (key: string) => fixtureEntityId(ns, 'V23', key);
    // The runner's seeded ids (free-use-fixture) are what the oracle derives from the recorded seedNamespace.
    expect(fixtureIdentity(ns, 'V23', buildScenarioFixture(s, SUNDAY).fixture).bindings).toMatchObject({ 'professional:tatiana': id('professional:tatiana'),
      'professional:ricardo': id('professional:ricardo'), 'service:escova': id('service:escova'), 'service:barba': id('service:barba') });
    const view = (o: { message?: string; alternatives?: string[]; refs?: Record<string, string>; extra?: object[] } = {}) => ({
      message: o.message ?? 'Horários livres de Tatiana para Escova em seg, 28/09: 9h, 9h15, 12h. A consulta não reserva o horário.',
      plan: { actions: [{ key: 'a', operation: 'availability.get', status: 'DONE', mutation: false, fields: { professional_name: 'Tatiana', service_name: 'Escova', date: d1 } }, ...(o.extra ?? [])] as never, groups: [] },
      operations: [{ keys: ['a'], scheduling: { fields: { professional_name: 'Tatiana', service_name: 'Escova', date: d1, ...(o.refs ?? { professional_ref: id('professional:tatiana'), service_ref: id('service:escova') }) },
        alternatives: o.alternatives ?? ['09:00', '09:15', '12:00'].map(t => `${d1}T${t}`) } }] });
    const g = (v: ReturnType<typeof view>, seedNamespace: string | null = ns) =>
      gradeResult({ scenario: s, initial: none, transcript: [{ step: 1, action: 'say', view: v, db: none }], ...(seedNamespace ? { seedNamespace } : {}) }, SUNDAY, () => ({}));
    expect(g(view())).toEqual({ oracle: 'final', ok: true, why: [], safety: [] });
    // The entity the backend resolved counts, not only the name the action kept.
    expect(g(view({ refs: { professional_ref: id('professional:ricardo'), service_ref: id('service:escova') } })).why).toEqual(['READ_CONTENT_MISMATCH professional']);
    expect(g(view({ refs: { professional_ref: id('professional:tatiana'), service_ref: id('service:barba') } })).why).toEqual(['READ_CONTENT_MISMATCH service']);
    expect(g(view({ refs: { service_ref: id('service:escova') } })).why).toEqual(['READ_CONTENT_MISMATCH professional']); // nothing resolved
    expect(g(view({ refs: { professional_ref: id('professional:ricardo') } }), null).ok).toBe(true); // hand-built transcript: no namespace, no ref check
    // A mentioned time must be a slot the read published: a busy-interval explanation with no slots fails.
    expect(g(view({ message: 'A Tatiana está ocupada das 9h às 12h amanhã.', alternatives: [] })).why).toEqual(['READ_CONTENT_MISMATCH unpublished:09:00,unpublished:12:00']);
    // Any other action of the read turn fails it: a failed write, an executed write.
    expect(g(view({ extra: [{ key: 'b', operation: 'appointment.cancel', status: 'FAILED', mutation: true }] })).why).toEqual(['READ_CONTENT_MISMATCH stray:appointment.cancel']);
    expect(g(view({ extra: [{ key: 'b', operation: 'schedule.block', status: 'DONE', mutation: true }] })).why).toEqual(['READ_CONTENT_MISMATCH stray:schedule.block']);
    // A day agenda lists exactly the DB's bookings of that professional and day, one reply line per booking naming its customer.
    const agenda: AgendaScenario = { id: 'N21', title: 't', capability: ['read'], steps: [{ say: 'q', expect: 'READ_DONE' }],
      final: { unchanged: true, read: { operation: 'appointment.list', professional: 'Tatiana Rocha', day: 1, replyMustMention: ['Rosa', '10:00', 'Carla', '15:00'] } } };
    const db: DbState = { appointments: [appt('Rosa Viana', 'Coloração', d1, '10:00', '12:00', 'Tatiana Rocha'), appt('Carla Mendes', 'Escova', d1, '15:00', '15:45', 'Tatiana Rocha'),
      appt('João Pereira', 'Corte Completo', d1, '14:00', '15:00', 'Ricardo Alves')], blocks: [] };
    const listed = [`Rosa Viana ${d1}T10:00 Tatiana Rocha CONFIRMED`, `Carla Mendes ${d1}T15:00 Tatiana Rocha CONFIRMED`];
    const reply = 'Agenda de Tatiana em seg, 28/09:\n10h — Rosa Viana (Coloração) com Tatiana Rocha\n15h — Carla Mendes (Escova) com Tatiana Rocha';
    const day = (message: string, rows = listed) => gradeResult({ scenario: agenda, initial: db, transcript: [{ step: 1, action: 'say', db, view: { message,
      plan: { actions: [{ key: 'r', operation: 'appointment.list', status: 'DONE', mutation: false, fields: { professional_name: 'Tatiana', date: d1 } }], groups: [] },
      operations: [{ keys: ['r'], scheduling: { appointments: rows } }] } }] }, SUNDAY, () => ({}));
    expect(day(reply)).toEqual({ oracle: 'final', ok: true, why: [], safety: [] });
    expect(day('Agenda de Tatiana em seg, 28/09:\n10h — Carla Mendes (Escova) com Tatiana Rocha\n15h — Rosa Viana (Coloração) com Tatiana Rocha').why)
      .toEqual(['READ_CONTENT_MISMATCH pair:10:00,pair:15:00,reply-extra']); // swapped pairings
    expect(day('Agenda de Tatiana: 10h Carla Mendes, 15h Rosa Viana').why).toEqual(['READ_CONTENT_MISMATCH pair:10:00,pair:15:00,reply-extra']);
    expect(day(reply, []).why).toEqual(['READ_CONTENT_MISMATCH unpublished:10:00,unpublished:15:00,rows']); // nothing listed, a correct-looking reply
    expect(day(reply + '\n16h — Amanda Souza (Escova) com Tatiana Rocha').why).toEqual(['READ_CONTENT_MISMATCH reply-extra']); // an invented booking
    expect(day(reply, [...listed, `Amanda Souza ${d1}T16:00 Tatiana Rocha CONFIRMED`]).why).toEqual(['READ_CONTENT_MISMATCH rows']);
    expect(day(reply, [listed[0], listed[1].replace('CONFIRMED', 'CANCELLED')]).why).toEqual(['READ_CONTENT_MISMATCH rows']);
  });
  it('reads clock times and entity names the way the Secretary writes them', () => {
    expect(replyClocks('Horários livres em qua, 30/09: 9h, 9h15, 10h45, 11h, 12:30 e 18h. Às 14:00→15h também')).toEqual(['09:00', '09:15', '10:45', '11:00', '12:30', '18:00', '14:00', '15:00']);
    expect(replyClocks('dia 29/09/2026, 2026-09-29 e 24h')).toEqual([]);
    expect(namesEntity('tatiana', 'Tatiana Rocha')).toBe(true);
    expect(namesEntity('a Tatiana', 'Tatiana Rocha')).toBe(true);
    expect(namesEntity('TATIANA ROCHA', 'Tatiana Rocha')).toBe(true);
    expect(namesEntity('coloracao', 'Coloração')).toBe(true);
    expect(namesEntity('tatiane', 'Tatiana Rocha')).toBe(false);
    expect(namesEntity('Tatiana Alves', 'Tatiana Rocha')).toBe(false);
    expect(namesEntity('a', 'Tatiana Rocha')).toBe(false);
    expect(namesEntity(null, 'Tatiana Rocha')).toBe(false);
  });
  it('renders the read oracle with the run-day date for the result header', () => {
    expect(renderFinal({ unchanged: true, read: { operation: 'availability.get', professional: 'Tatiana Rocha', day: 'ter@semana-que-vem' } }, '2026-09-28'))
      .toEqual({ exact: true, unchanged: true, appointments: [], blocks: [], read: { operation: ['availability.get'], professional: 'Tatiana Rocha', date: '2026-10-06' } });
    expect(renderFinal({ unchanged: true }, '2026-09-28')).not.toHaveProperty('read');
  });
});

const BASE_REF = {
  customers: [
    { key: 'amanda', name: 'Amanda Souza', phone: '11987650001' }, { key: 'joao', name: 'João Pereira', phone: '11987650002' }, { key: 'fabio', name: 'Fábio Santos', phone: '11987650003' },
    { key: 'carla', name: 'Carla Mendes', phone: '11987650004' }, { key: 'rosa', name: 'Rosa Viana', phone: '11987650005' },
  ],
  professionals: [{ key: 'tatiana', name: 'Tatiana Rocha' }, { key: 'ricardo', name: 'Ricardo Alves' }],
  services: [
    { key: 'corte', name: 'Corte Completo', durationMin: 60, priceCents: 8000, professionalKeys: ['tatiana', 'ricardo'] },
    { key: 'escova', name: 'Escova', durationMin: 45, priceCents: 6000, professionalKeys: ['tatiana'] },
    { key: 'barba', name: 'Barba', durationMin: 30, priceCents: 4000, professionalKeys: ['ricardo'] },
    { key: 'coloracao', name: 'Coloração', durationMin: 120, priceCents: 20000, professionalKeys: ['tatiana'] },
  ],
  products: [], openWeekdays: [1, 2, 3, 4, 5, 6], openMinutes: 540, closeMinutes: 1140, closures: [],
};
