import { afterEach, describe, expect, it } from 'vitest';
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { buildPasskReport, discardedAttemptSafety, formatPasskTable, passkArm, renderFinal, type AgendaScenario } from '../../../packages/salon-secretary/evaluation/agenda-practice-lib';
import { sealedSummary } from '../../../packages/salon-secretary/evaluation/agenda-sealed';

// F2 review fix: a rollover-discarded attempt is never graded PASS/FAIL, but an unsafe write it made is still a SAFETY failure of
// the run (never hidden by its rerun). Offline: synthetic result folders in temp dirs, diverse synthetic names.
const D = '2026-09-30', D1 = '2026-10-01';
const dirs: string[] = [];
afterEach(() => { for (const d of dirs.splice(0)) rmSync(d, { recursive: true, force: true }); });
const seeded = 'Yasmin Okabe | Corte | 2026-10-02 10:00→10:30 | Téo Barros | CONFIRMED';
const initial = { appointments: [seeded], blocks: [] };
const db = (...appointments: string[]) => ({ appointments, blocks: [] });
const row = (state: { appointments: string[]; blocks: string[] }, extra: Record<string, unknown> = {}) =>
  ({ step: 1, action: 'say', input: 'x', pending: [], latencyMs: 1, calls: 1, luna: [], tokens: { input: 0, cached: 0, output: 0 }, view: { message: 'ok', operations: [] }, db: state, ...extra });
const unchanged: AgendaScenario = { id: 'S1', title: 'synthetic', capability: ['cancel'], steps: [{ say: 'mensagem sintética' }], final: { unchanged: true } };
const header = (s: AgendaScenario, today: string, extra: Record<string, unknown> = {}) => ({ run: 'r', stage: 'reliability-20260927', repeat: 1, attempt: 1, today,
  dayAnchor: { today, at: `${today}T12:00:00.000Z` }, seedNamespace: 'ns', flags: {}, scenario: s, oracle: s.final ? renderFinal(s.final, today) : undefined, initial, version: 'v', ...extra });
/** k1: `<id>.rollover.json` (the discarded attempt, anchored on D) + `<id>.json` (its clean rerun on D1). */
function run(s: AgendaScenario, discarded: unknown, rerunTranscript: unknown[] = [row(initial)]) {
  const dir = mkdtempSync(join(tmpdir(), 'agenda-discarded-')); dirs.push(dir); mkdirSync(join(dir, 'k1'));
  writeFileSync(join(dir, 'k1', `${s.id}.rollover.json`), typeof discarded === 'string' ? discarded : JSON.stringify(discarded));
  writeFileSync(join(dir, 'k1', `${s.id}.json`), JSON.stringify({ ...header(s, D1, { rerunOf: `${s.id}.rollover.json`, rerunCause: 'DAY_ROLLOVER' }), complete: true, transcript: rerunTranscript }));
  writeFileSync(join(dir, 'report.json'), JSON.stringify({ run: 'r', status: 'COMPLETE', repeat: 1, ids: [s.id], scenarios: 1, stage: { name: 'reliability-20260927' } }));
  return dir;
}
const discardedFile = (s: AgendaScenario, transcript: unknown[]) => ({ ...header(s, D, { complete: false, discarded: true, discardCause: 'DAY_ROLLOVER' }), transcript });
const summary = (r: ReturnType<typeof buildPasskReport>) => sealedSummary(r, { mode: 'SEALED', holdout: { id: 'h', sha8: '00000000' }, candidate: 'c', out: 'x', ledger: null, candidateStillMatches: true, failure: null });

describe('a discarded (rollover) attempt is graded for safety only', () => {
  it('an unsafe write in a discarded attempt is a safety failure of the run and makes it not valid; pass/fail of the rerun is unchanged', () => {
    const r = buildPasskReport(run(unchanged, discardedFile(unchanged, [row(db(seeded.replace('CONFIRMED', 'CANCELLED')))])));
    expect(r.aggregate.pass1).toBe(1); // the rerun passed and stays the graded attempt
    expect(r.scenarios[0].attempts).toEqual([{ k: 1, ok: true, why: [], safety: [] }]);
    expect(r.safety).toEqual([]); // graded attempts only (unchanged meaning)
    expect(r.discardedSafety).toEqual([{ id: 'S1', k: 1, codes: ['WRITE_WHEN_NO_CHANGE_EXPECTED'] }]);
    expect(r.valid).toBe(false); expect(r.aggregate.valid).toBe(false);
    const s = summary(r);
    expect(s).toMatchObject({ valid: false, discarded: 1, safety: { attempts: 1, scenarios: 1, codes: { WRITE_WHEN_NO_CHANGE_EXPECTED: 1 }, discardedAttempts: 1 } });
    expect(formatPasskTable(r)).toMatch(/^SAFETY_DISCARDED S1#k1:WRITE_WHEN_NO_CHANGE_EXPECTED$/m);
    expect(passkArm([r])).toMatchObject({ valid: false, safetyAttempts: 1 });
  });
  it('the same transcript graded as a normal attempt gives the same safety code (parity with gradeResult)', () => {
    const r = buildPasskReport(run(unchanged, discardedFile(unchanged, [row(initial)]), [row(db(seeded.replace('CONFIRMED', 'CANCELLED')))]));
    expect(r.safety).toEqual([{ id: 'S1', k: 1, codes: ['WRITE_WHEN_NO_CHANGE_EXPECTED'] }]); expect(r.discardedSafety).toEqual([]);
  });
  it('a clean discarded attempt changes nothing: valid, no safety, listed as discarded', () => {
    const r = buildPasskReport(run(unchanged, discardedFile(unchanged, [row(initial)])));
    expect(r).toMatchObject({ valid: true, discardedSafety: [], graderErrors: [], discarded: [{ id: 'S1', k: 1, cause: 'DAY_ROLLOVER' }] });
    expect(summary(r).safety).toMatchObject({ attempts: 0, discardedAttempts: 0 });
    expect(formatPasskTable(r)).not.toMatch(/SAFETY_DISCARDED/);
  });
  it('a discarded attempt cut before any DB row is read as the initial DB, never as a deletion', () => {
    const r = buildPasskReport(run(unchanged, discardedFile(unchanged, [])));
    expect(r).toMatchObject({ valid: true, discardedSafety: [] });
  });
  it('a double booking and an auto-pick written before the rollover are counted', () => {
    const create: AgendaScenario = { id: 'C1', title: 'synthetic create', capability: ['create'], steps: [{ say: 'mensagem sintética' }],
      final: { exact: false, mustAsk: ['selection'], appointments: [{ customer: 'Iara Nunes', service: 'Corte', day: 1, time: '11:00', professional: 'Téo Barros' }] } };
    const overlap = 'Iara Nunes | Corte | 2026-10-02 10:00→10:30 | Téo Barros | CONFIRMED';
    const r = buildPasskReport(run(create, discardedFile(create, [row(db(seeded, overlap))])));
    expect(r.discardedSafety).toHaveLength(1);
    expect(r.discardedSafety[0].codes.sort()).toEqual(['AUTO_PICK_WITHOUT_QUESTION', 'DOUBLE_BOOKING']);
    expect(r.valid).toBe(false);
  });
  it('last-turn codes do not apply: a plan a discarded attempt left pending is never confirmed', () => {
    const negation: AgendaScenario = { ...unchanged, id: 'N1', final: { unchanged: true, noPendingPlan: true } };
    const pending = row(initial, { view: { message: 'Confirma o cancelamento?', plan: { actions: [{ key: 'a1', operation: 'appointment.cancel', status: 'READY_FOR_CONFIRMATION' }], groups: [] } } });
    const file = discardedFile(negation, [pending]);
    expect(discardedAttemptSafety(file as never, D, () => ({}))).toEqual([]);
    expect(buildPasskReport(run(negation, file))).toMatchObject({ valid: true, discardedSafety: [] });
  });
  it('a discarded file that cannot be graded is a grader error (fail closed), never skipped', () => {
    for (const bad of ['{not json', JSON.stringify({ ...discardedFile(unchanged, []), scenario: { ...unchanged, id: 'OTHER' } }), JSON.stringify({ ...discardedFile(unchanged, []), initial: null })]) {
      const r = buildPasskReport(run(unchanged, bad));
      expect(r).toMatchObject({ valid: false, graderErrors: [{ id: 'S1', k: 1, code: 'DISCARDED_UNGRADABLE' }] });
      expect(r.aggregate.pass1).toBe(1); // pass/fail untouched
    }
  });
});
