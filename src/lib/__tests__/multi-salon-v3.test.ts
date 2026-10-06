import { beforeAll, describe, expect, it, vi } from 'vitest';
vi.setConfig({ testTimeout: 120_000, hookTimeout: 120_000 });
import { createHash } from 'node:crypto';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { auditBattery } from '../../../packages/salon-secretary/evaluation/agenda-practice-battery';
import { appointmentServiceKeys, buildScenarioFixture, dayDate, gradeResult, renderFinal, validateScenarios, type AgendaScenario, type DbState, type TranscriptRow }
  from '../../../packages/salon-secretary/evaluation/agenda-practice-lib';
import { foldWords, nameTokens, scenarioNames } from '../../../packages/salon-secretary/evaluation/agenda-practice-stats';
import { CONFLICT_ANSWER_FIELDS, COHORT_FILE, DEV_FILE, DEV_MANIFEST, GENERATOR_VERSION, PHRASE_SIDES_FILE, POOL_DIR, SPLIT_TYPES, TWELVE_STYLE, TWELVE_STYLE_SPLITS,
  conflictAnswerIssues, generateSplit, holdoutRotationGaps, loadPools, main, mustAskAnswerIssues, phraseKey, phraseSides, phraseSplitDiagnostics, retiredPhrasings, seenNameTokens,
  sidePools, sideVariants, spokenClock, writtenReadings, type ScenarioMeta } from '../../../packages/salon-secretary/evaluation/multi-salon/generate';
import { DAYPART_ANSWERS, TEMPLATES, type Variant } from '../../../packages/salon-secretary/evaluation/multi-salon/templates';
import { exampleFillNames } from '../../../packages/salon-secretary/src/examples/fill';

// Multi-salon generator v3 (Candidate 4: M0-MEASURE + F5-T06-ORACLE). Evaluation only: no database, no network, no model.
// The committed DEV split and its manifest are read as written (multi-salon-generator.test.ts pins that they are the exact
// regeneration); in-memory holdouts use a test seed and never touch a sealed file.
const root = process.cwd();
const dev = JSON.parse(readFileSync(join(root, DEV_FILE), 'utf8')) as AgendaScenario[];
const manifest = JSON.parse(readFileSync(join(root, DEV_MANIFEST), 'utf8')) as { generator: string; devExcludedTokens: string[]; scenarios: ScenarioMeta[]; twelveStyleSplits: string[] };
const meta = new Map(manifest.scenarios.map(m => [m.id, m]));
const byId = (id: string) => dev.find(s => s.id === id)!;
const fold = (s: string) => foldWords(s).join(' ');
const texts = (s: AgendaScenario) => [...s.steps.flatMap(x => 'say' in x ? [x.say] : []), ...Object.values(s.answers ?? {}).flatMap(v => Array.isArray(v) ? v : typeof v === 'string' ? [v] : [])];
const minutes = (hhmm: string) => Number(hhmm.slice(0, 2)) * 60 + Number(hhmm.slice(3));
const hhmm = (m: number) => `${String(Math.floor(m / 60)).padStart(2, '0')}:${String(m % 60).padStart(2, '0')}`;
const TODAY = '2026-09-27';
const WEEKDAY = ['dom', 'seg', 'ter', 'qua', 'qui', 'sex', 'sab'];
/** Windows of a scenario's professional (its own `hours`, else the salon's) on the weekday of a day spec. */
const proWindows = (s: AgendaScenario, pro: string, day: string | number) => {
  const p = s.professionals!.find(x => x.name === pro)!, wd = typeof day === 'number' ? new Date(`${dayDate(day, TODAY)}T12:00:00Z`).getUTCDay() : WEEKDAY.indexOf(day);
  return (p.hours ?? s.salon!.hours).filter(w => w.weekday === wd).map(w => ({ from: minutes(w.from), to: minutes(w.to) }));
};
const cohort = JSON.parse(readFileSync(join(root, POOL_DIR, COHORT_FILE), 'utf8'));
const v1 = JSON.parse(readFileSync(join(root, POOL_DIR, 'names.json'), 'utf8'));
const GROUPS = ['female', 'male', 'unisex', 'compound', 'foreignOrigin', 'wordNames'] as const;
const peopleOf = (n: typeof v1) => GROUPS.flatMap(g => (n[g] as { name: string; tags: string[]; variants?: string[]; relatesTo?: string[]; meaning?: string }[]).map(p => ({ ...p, group: g })));

describe('multi-salon v3: versioning (old results are never regraded)', () => {
  it('bumps the generator version, and the committed DEV split and manifest are v3', () => {
    expect(GENERATOR_VERSION).toBe('multi-salon-generator-v3');
    expect(manifest.generator).toBe(GENERATOR_VERSION);
    expect(SPLIT_TYPES.dev).toEqual(['barbearia', 'salao-de-beleza', 'estudio-noturno', 'trancas-e-afro']);
    expect(SPLIT_TYPES.holdout).toEqual(['esmalteria', 'sobrancelha-e-cilios', 'estetica-spa']);
    expect(dev).toHaveLength(TEMPLATES.length * SPLIT_TYPES.dev.length);
    expect(new Set(dev.map(s => s.salon!.type))).toEqual(new Set(SPLIT_TYPES.dev));
  });
});

describe('names-v3 cohort (backlog section 1)', () => {
  const people = peopleOf(cohort), v1Tokens = new Set([...peopleOf(v1).flatMap(p => [p.name, ...(p.variants ?? [])]), ...v1.nicknames.flatMap((n: { nickname: string; formal: string[] }) => [n.nickname, ...n.formal]),
    ...v1.surnames.map((s: { name: string }) => s.name)].flatMap(foldWords));
  it('is large, diverse and holds no digit', () => {
    const strings = (v: unknown): string[] => typeof v === 'string' ? [v] : Array.isArray(v) ? v.flatMap(strings) : v && typeof v === 'object' ? Object.entries(v).flatMap(([k, x]) => [k, ...strings(x)]) : [];
    expect(strings(cohort).filter(s => /\p{N}/u.test(s))).toEqual([]);
    expect(cohort.female.length).toBeGreaterThanOrEqual(80); expect(cohort.male.length).toBeGreaterThanOrEqual(80);
    expect(cohort.compound.length).toBeGreaterThanOrEqual(20); expect(cohort.foreignOrigin.length).toBeGreaterThanOrEqual(40);
    expect(cohort.wordNames.length).toBeGreaterThanOrEqual(20); expect(cohort.nicknames.length).toBeGreaterThanOrEqual(25); expect(cohort.surnames.length).toBeGreaterThanOrEqual(100);
    for (const g of ['f', 'm']) { expect(cohort.compound.filter((p: { tags: string[] }) => p.tags.includes(g)).length, g).toBeGreaterThanOrEqual(10);
      expect(cohort.foreignOrigin.filter((p: { tags: string[] }) => p.tags.includes(g)).length, g).toBeGreaterThanOrEqual(15); }
    // the backlog's categories: short names, word names (Céu, Jade), look-alike pairs and ambiguous nicknames
    expect(people.filter(p => p.group !== 'compound' && fold(p.name).length <= 3).length).toBeGreaterThanOrEqual(6);
    for (const w of ['Céu', 'Jade']) expect(cohort.wordNames.some((p: { name: string }) => p.name === w), w).toBe(true);
    for (const [a, b] of [['Anna', 'Ana'], ['Taís', 'Thaís'], ['Daniele', 'Daniela'], ['Micael', 'Micaela'], ['Samir', 'Samira']])
      expect([a, b].every(n => [...people, ...peopleOf(v1)].some(p => p.name === n)), `${a}/${b}`).toBe(true);
    expect(cohort.nicknames.filter((n: { tags: string[] }) => n.tags.includes('ambiguous')).length).toBeGreaterThanOrEqual(8);
  });
  it('is new: no single name, variant, nickname or surname shares a folded token with names.json, compounds are new combinations, and no token is seen', () => {
    const seen = new Set([...seenNameTokens(), 'lara', 'nina', 'celia', 'bruno', 'leal', 'matos', 'prado', 'costa', 'marina']);
    for (const p of people) {
      if (p.group !== 'compound') expect(foldWords(p.name).filter(w => v1Tokens.has(w)), p.name).toEqual([]);
      else expect(peopleOf(v1).some(x => fold(x.name) === fold(p.name)), p.name).toBe(false);
      expect(foldWords(p.name).filter(w => seen.has(w)), p.name).toEqual([]);
    }
    for (const n of cohort.nicknames) expect(foldWords(n.nickname).filter((w: string) => v1Tokens.has(w) || seen.has(w)), n.nickname).toEqual([]);
    for (const s of cohort.surnames) expect(foldWords(s.name).filter((w: string) => v1Tokens.has(w) || seen.has(w)), s.name).toEqual([]);
    const dup = (xs: string[]) => xs.filter((x, i) => xs.findIndex(y => fold(y) === fold(x)) !== i);
    expect(dup(people.map(p => p.name))).toEqual([]); expect(dup(cohort.surnames.map((s: { name: string }) => s.name))).toEqual([]);
  });
  it('keeps the pool rules: one gender tag, derived accent, nickname referents, collision words named and checked', () => {
    const tags = new Set(Object.keys(cohort.tagDefinitions)), names = new Set(people.map(p => fold(p.name)));
    const hasMark = (s: string) => /\p{M}/u.test(s.normalize('NFD'));
    for (const p of people) {
      expect(p.tags.filter(t => !tags.has(t)), p.name).toEqual([]);
      expect(p.tags.filter(t => ['f', 'm', 'u'].includes(t)), p.name).toHaveLength(1);
      expect(p.tags.includes('accent'), p.name).toBe(hasMark(p.name));
      expect(p.name.includes(' '), p.name).toBe(p.group === 'compound');
      if (p.tags.some(t => ['temporal', 'near-temporal', 'weekday-like', 'number-like', 'service-like'].includes(t))) expect(p.relatesTo?.length, p.name).toBeGreaterThan(0);
    }
    for (const w of cohort.wordNames) expect(Boolean(w.meaning) && w.relatesTo.length > 0, w.name).toBe(true);
    for (const n of cohort.nicknames) {
      expect(n.formal.every((f: string) => names.has(fold(f))), n.nickname).toBe(true);
      expect(n.tags.includes('ambiguous'), n.nickname).toBe(n.formal.length > 1);
    }
    // every special template has cohort material (the rotated holdout draws people from the cohort only)
    for (const tag of ['service-like', 'near-temporal', 'weekday-like', 'number-like']) expect(people.some(p => p.tags.includes(tag)), tag).toBe(true);
  });
  it('never reaches the few-shot fill list (examples/names.json), and the default v1 split used by example-names and ft-export is unchanged', () => {
    const cohortTokens = new Set([...people.map(p => p.name), ...cohort.nicknames.map((n: { nickname: string }) => n.nickname), ...cohort.surnames.map((s: { name: string }) => s.name)]
      .filter(n => !n.includes(' ')).flatMap(foldWords));
    expect(exampleFillNames().people.flatMap(foldWords).filter(w => cohortTokens.has(w))).toEqual([]);
    const pools = loadPools(), v1dev = sidePools(pools, 'dev'), v1held = sidePools(pools, 'holdout');
    expect(v1dev.generation).toBe('v1');
    expect([...v1dev.persons, ...v1held.persons].some(p => people.some(c => c.name === p.name))).toBe(false);
  });
});

describe('rotation: the next holdout uses new names and new phrasings only', () => {
  const pools = loadPools(), dv = sidePools(pools, 'dev', new Set(), { v3: true }), hv = sidePools(pools, 'holdout', new Set(), { v3: true, retire: true });
  it('holdout people, nicknames and surnames come from the cohort holdout half only; the halves are disjoint', () => {
    const cohortNames = new Set(peopleOf(cohort).map(p => p.name)), v1Names = new Set(peopleOf(v1).map(p => p.name));
    expect(hv.persons.length).toBeGreaterThan(80);
    expect(hv.persons.every(p => cohortNames.has(p.name))).toBe(true);
    expect(hv.surnames.every(s => cohort.surnames.some((x: { name: string }) => x.name === s.name))).toBe(true);
    expect(hv.nicknames.every(n => cohort.nicknames.some((x: { nickname: string }) => x.nickname === n.nickname))).toBe(true);
    expect(dv.persons.some(p => v1Names.has(p.name)) && dv.persons.some(p => cohortNames.has(p.name))).toBe(true);
    const inter = <T,>(a: T[], b: T[]) => a.filter(x => b.includes(x));
    expect(inter(dv.persons.map(p => p.name), hv.persons.map(p => p.name))).toEqual([]);
    expect(inter(dv.surnames.map(p => p.name), hv.surnames.map(p => p.name))).toEqual([]);
    expect(inter(dv.nicknames.map(p => p.nickname), hv.nicknames.map(p => p.nickname))).toEqual([]);
    expect(hv.retire).toBe(true); expect(dv.retire).toBe(false);
  });
  it('pins every recorded v2 phrasing (hashes only) and retires the v2 holdout phrasings and the new ones near them', () => {
    const recorded = (JSON.parse(readFileSync(join(root, POOL_DIR, PHRASE_SIDES_FILE), 'utf8')) as { sides: Record<string, string> }).sides;
    const variants = [...TEMPLATES.flatMap(t => [...t.says, ...Object.values(t.answers ?? {})]).flat(), ...DAYPART_ANSWERS];
    const text = (v: Variant) => typeof v === 'string' ? v : v.t, sha = (v: Variant) => createHash('sha256').update(text(v)).digest('hex');
    // no v2 phrasing was edited in place (an edit would silently un-retire it): every recorded hash is a current variant text
    const current = new Set(variants.map(sha));
    expect(Object.keys(recorded).filter(h => !current.has(h))).toEqual([]);
    const sides = phraseSides(), retired = retiredPhrasings();
    for (const v of variants) {
      const s = recorded[sha(v)];
      if (s) expect(sides.get(phraseKey(v)), text(v).slice(0, 20)).toBe(s);
      if (s === 'holdout') expect(retired.has(phraseKey(v))).toBe(true);
    }
    for (const t of TEMPLATES) for (const list of [...t.says, ...Object.values(t.answers ?? {})])
      expect(sideVariants(t, '', list, 'holdout', undefined, true).filter(v => retired.has(phraseKey(v)))).toEqual([]);
    const d = phraseSplitDiagnostics();
    expect(d.retired).toBeGreaterThanOrEqual(Object.values(recorded).filter(s => s === 'holdout').length > 0 ? 1 : 0);
    expect(d.holdoutIdenticalToDev).toBe(0);
  });
  it('fails closed: a holdout is never generated (in memory or by the CLI, --check included) while the phrase pool is not rotated', async () => {
    expect(holdoutRotationGaps().length).toBeGreaterThan(0);
    expect(() => generateSplit({ split: 'holdout', seed: 'rotation-test', exclude: new Set() })).toThrow('MULTI_SALON_HOLDOUT_NOT_ROTATED');
    await expect(main(['--split', 'holdout', '--check'])).rejects.toThrow('MULTI_SALON_HOLDOUT_NOT_ROTATED');
  });
  it('the DEV split shares no name with the example bank, the dev batteries or the base fixture (manifest record and live check)', () => {
    const devTokens = nameTokens(dev.flatMap(scenarioNames)), seen = seenNameTokens();
    expect([...devTokens].filter(w => seen.has(w))).toEqual([]);
    expect(new Set(manifest.devExcludedTokens)).toEqual(new Set([...seen]));
  });
});

describe('DEV hour profiles, the twelve style and the half-of-day oracle (backlog section 0)', () => {
  const metas = manifest.scenarios;
  it('covers night studio, day and night, lunch break and a morning-only main professional', () => {
    const hours = new Set(metas.map(m => m.hours));
    for (const h of ['noturno', 'madrugada-fim-de-semana', 'vinte-e-quatro-horas', 'com-almoco', 'manha-profissional']) expect(hours.has(h), h).toBe(true);
    expect(metas.filter(m => m.proWindow).length).toBeGreaterThanOrEqual(10);
    expect(dev.some(s => s.salon!.hours.some((w, i, all) => i > 0 && all[i - 1].weekday === w.weekday))).toBe(true); // a break or a night
    for (const s of dev.filter(x => meta.get(x.id)!.proWindow)) {
      const own = s.professionals!.filter(p => p.hours);
      expect(own, s.id).toHaveLength(1);
      expect(own[0].hours!.every(w => w.from >= '07:00' && w.to <= '12:00'), s.id).toBe(true);
    }
    // registers audio and greetings are kept
    for (const r of ['audio', 'greetings']) expect(metas.some(m => m.register === r), r).toBe(true);
  });
  it('the twelve style exists only in the DEV split and only rewrites 13-19h', () => {
    expect(TWELVE_STYLE_SPLITS).toEqual(['dev']); expect(manifest.twelveStyleSplits).toEqual(['dev']);
    const twelve = dev.filter(s => s.capability.includes(`time-${TWELVE_STYLE}`));
    expect(twelve.length).toBeGreaterThanOrEqual(20);
    let rewritten = 0;
    for (const s of twelve) for (const a of s.final?.appointments ?? []) {
      const h = Number(a.time.slice(0, 2)), all = fold(texts(s).join(' \n '));
      if (h >= 13 && h <= 19 && a.time.endsWith(':00') && new RegExp(`(?:as|das|pras|para as) ${h - 12}(?![0-9h])`).test(all)) rewritten++;
      if (h >= 8 && h <= 11 && a.time.endsWith(':00') && all.includes(` ${h}h`)) expect(new RegExp(`(?:as|das|pras) ${h}(?![0-9h])`).test(all), `${s.id} ${a.time}`).toBe(false);
    }
    expect(rewritten).toBeGreaterThan(0);
    expect(writtenReadings(15 * 60, 'typing', TWELVE_STYLE)).toEqual([180, 900]);
    expect(writtenReadings(15 * 60, 'typing', 'h')).toBeNull();
    expect(writtenReadings(10 * 60, 'typing', TWELVE_STYLE)).toBeNull();
    expect(writtenReadings(2 * 60, 'typing', 'h')).toEqual([120, 840]);
    expect(writtenReadings(7 * 60, 'voice', 'words')).toEqual([420, 1140]);
    expect(writtenReadings(15 * 60, 'voice', 'words')).toBeNull(); // "três da tarde"
    expect([spokenClock(120, true), spokenClock(450, true), spokenClock(60), spokenClock(900, true)]).toEqual(['duas da madrugada', 'sete e meia da manhã', 'uma hora', 'três da tarde']);
  });
  it('never "A or a question": a booked clock with both readings open is asked or written unambiguously; the night studio resolves 02h', () => {
    let night = 0, single = 0;
    const plainly = (s: AgendaScenario, m: number) => {
      const h = Math.floor(m / 60), all = fold(texts(s).join(' \n '));
      // (folded text: "4:45" reads "4 45")
      return h >= 13 ? new RegExp(`(?<![0-9])${h}(?:h| [0-9]{2}| horas)`).test(all) || all.includes(fold(spokenClock(m)))
        : new RegExp(`(?<![0-9])${h}(?:h[0-9]{0,2}| [0-9]{2}| horas)? da (?:madrugada|manha)`).test(all) || all.includes(fold(spokenClock(m, true)));
    };
    for (const s of dev) {
      const seeded = new Set((s.appointments ?? []).map(a => a.time + '|' + a.day)), mt = meta.get(s.id)!;
      for (const a of (s.final?.appointments ?? []).filter(x => !x.status && !seeded.has(x.time + '|' + x.day))) {
        const m = minutes(a.time), pair = writtenReadings(m, mt.mode, mt.timeStyle);
        if (!pair) continue;
        const other = pair[0] === m ? pair[1] : pair[0], ws = proWindows(s, a.professional!, a.day);
        expect(ws.some(w => w.from <= m && m < w.to), `${s.id} own`).toBe(true);
        if (ws.some(w => w.from <= other && other < w.to)) { // both open: the question is scripted, or the text leaves no doubt
          expect(s.capability.includes('daypart-ask') && s.final!.mustAsk!.includes('time') || plainly(s, m), `${s.id} ${a.time}`).toBe(true);
          continue;
        }
        if (!s.capability.includes('daypart-single')) continue;
        single++;
        if (m < 360 && ['noturno', 'madrugada-fim-de-semana'].includes(mt.hours)) {
          night++;
          expect(s.capability.includes('daypart-ask'), s.id).toBe(false); // no half-of-day question added
          // the shortcut writes the afternoon reading: never the oracle
          const f = renderFinal(s.final!, TODAY), wrong = f.appointments.map(x => x.time === a.time && x.customer === a.customer ? { ...x, time: hhmm(other) } : x);
          expect(JSON.stringify(wrong)).not.toBe(JSON.stringify(f.appointments));
        }
      }
    }
    expect(single).toBeGreaterThan(10);
    expect(night).toBeGreaterThan(0);
  });
  it('the main professional\'s own hours decide (a morning-only professional at 7h is 07:00 even though the salon opens at 19:00)', () => {
    const cases = dev.filter(s => meta.get(s.id)!.proWindow && s.capability.includes('daypart-single'));
    expect(cases.length).toBeGreaterThan(0);
    let decided = 0;
    for (const s of cases) for (const a of (s.final?.appointments ?? []).filter(x => !x.status && x.time.startsWith('07'))) {
      const p = s.professionals!.find(x => x.name === a.professional)!;
      if (!p.hours) continue;
      decided++;
      const late = minutes(a.time) + 720;
      expect(s.salon!.hours.some(w => minutes(w.from) <= late && late < minutes(w.to)), s.id).toBe(true); // open for the salon
      expect(p.hours.some(w => minutes(w.from) <= late && late < minutes(w.to)), s.id).toBe(false); // closed for her
    }
    expect(decided).toBeGreaterThan(0);
  });
  it('two open readings must be asked (day-and-night salon), with scripted unambiguous replies; never next to an entity question', () => {
    const asks = dev.filter(s => s.capability.includes('daypart-ask'));
    expect(asks.length).toBeGreaterThan(0);
    for (const s of asks) {
      expect(s.final!.mustAsk, s.id).toEqual(['time']);
      const replies = s.answers!.time as string[];
      expect(replies.length, s.id).toBeGreaterThan(0);
      for (const r of replies) expect(/\b(1[3-9]|2[0-3])h|madrugada|manh[aã]/i.test(r), `${s.id}: ${r}`).toBe(true);
    }
    // any-of oracles are never widened: no daypart question joins an entity or another scripted time question
    for (const s of dev) if ((s.final?.mustAsk ?? []).length > 1) expect(s.capability.includes('daypart-ask'), s.id).toBe(false);
  });
  it('the day-and-night fixture fails a resolution made without the question; the scripted question passes', () => {
    const s = dev.find(x => x.capability.includes('daypart-ask') && (x.final!.appointments ?? []).length > 0 && x.steps.length === 2)!;
    const { initial, final } = dbStates(s);
    const grade = (rows: TranscriptRow[]) => gradeResult({ scenario: s, initial, transcript: rows }, TODAY, () => ({}));
    expect(grade([{ step: 1, action: 'say', pending: [], db: initial }, { step: 2, action: 'confirm', db: final }])).toMatchObject({ ok: false, safety: ['AUTO_PICK_WITHOUT_QUESTION'] });
    expect(grade([{ step: 1, action: 'say', pending: ['time'], db: initial }, { step: 2, action: 'answer:time', pending: [], db: initial }, { step: 3, action: 'confirm', db: final }]).ok).toBe(true);
  });
  it('refuses "A or a question": every mustAsk field has scripted replies in every DEV instance', () => {
    expect(dev.flatMap(mustAskAnswerIssues)).toEqual([]);
    expect(dev.flatMap(conflictAnswerIssues)).toEqual([]);
  });
});

/** Initial and expected DB lines of a scenario on TODAY (the runner's line format). A multi-service seed (`services`) is one
 * row: the names joined by '+' in order, end = the summed durations (the runner's tenantState projection). */
function dbStates(s: AgendaScenario) {
  const svc = (name: string) => s.salon!.services.find(x => x.name === name || x.key === name)!;
  const line = (c: string, service: string | string[], date: string, time: string, pro: string, status = 'CONFIRMED') => {
    const svcs = [service].flat().map(svc);
    return `${c} | ${svcs.map(x => x.name).join('+')} | ${date} ${time}→${hhmm(minutes(time) + svcs.reduce((n, x) => n + x.durationMin, 0))} | ${pro} | ${status}`;
  };
  const initial: DbState = { appointments: (s.appointments ?? []).map(a => line(s.customers!.find(c => c.key === a.customer)!.name, appointmentServiceKeys(a), dayDate(a.day, TODAY), a.time,
    s.professionals!.find(p => p.key === a.professional)!.name)), blocks: [] };
  const f = renderFinal(s.final!, TODAY);
  const final: DbState = { appointments: f.appointments.map(a => line(a.customer, a.service, a.date, a.time, a.professional!, a.status)), blocks: [] };
  return { initial, final, line, rendered: f };
}

describe('dbStates after MULTI_SERVICE_SEED_VERSION (ScenarioAppointment.service is absent on a `services` seed)', () => {
  it('every generated DEV seed is single-service and renders byte-identically to the pre-multi-service line', () => {
    const seeds = dev.flatMap(s => s.appointments ?? []);
    expect(seeds.length).toBeGreaterThan(0);
    expect(seeds.filter(a => a.services !== undefined || typeof a.service !== 'string')).toEqual([]);
    for (const s of dev) expect(dbStates(s).initial.appointments, s.id).toEqual((s.appointments ?? []).map(a => {
      const v = s.salon!.services.find(x => x.name === a.service || x.key === a.service)!;
      return `${s.customers!.find(c => c.key === a.customer)!.name} | ${v.name} | ${dayDate(a.day, TODAY)} ${a.time}→${hhmm(minutes(a.time) + v.durationMin)} | ${s.professionals!.find(p => p.key === a.professional)!.name} | CONFIRMED`;
    }));
  });
  it('a genuine two-service seed is one row, names joined by "+" in order, end = the summed durations (the runner\'s line)', () => {
    const hours = [2, 3, 4, 5, 6].flatMap(weekday => [{ weekday, from: '09:00', to: '12:00' }, { weekday, from: '13:00', to: '18:00' }]);
    const sc = (services: string[]): AgendaScenario => ({ id: 'M01', title: 'Tirar um serviço de um atendimento com dois', capability: ['alter-remove-service', 'alter', 'change-service'],
      salon: { type: 'estética', services: [{ key: 'limpeza', name: 'Limpeza de Pele', durationMin: 60, priceCents: 12000 }, { key: 'sobrancelha', name: 'Design de Sobrancelha', durationMin: 30, priceCents: 4500 },
        { key: 'drenagem', name: 'Drenagem Linfática', durationMin: 40, priceCents: 7000 }], hours },
      professionals: [{ key: 'iara', name: 'Iara Nakamura', services: ['Limpeza de Pele', 'Design de Sobrancelha', 'Drenagem Linfática'] }],
      customers: [{ key: 'benedito', name: 'Benedito Arruda' }, { key: 'zuleica', name: 'Zuleica Paixão' }],
      appointments: [{ key: 'ben_qua', customer: 'benedito', professional: 'iara', services, day: 'qua', time: '10:00' },
        { key: 'zu_qua', customer: 'zuleica', professional: 'iara', service: 'drenagem', day: 'qua', time: '14:00' }],
      steps: [{ say: 'tira a sobrancelha do benedito de quarta, fica so a limpeza' }, { confirm: true }],
      final: { appointments: [{ customer: 'Benedito Arruda', service: 'Limpeza de Pele', day: 'qua', time: '10:00', end: '11:00', professional: 'Iara Nakamura' },
        { customer: 'Zuleica Paixão', service: 'Drenagem Linfática', day: 'qua', time: '14:00', end: '14:40', professional: 'Iara Nakamura' }] } });
    expect(auditBattery([sc(['limpeza', 'sobrancelha'])], { days: [TODAY], verbose: true }).issues).toEqual([]);
    // The seeded line equals the one agenda-practice-multi-service-seed.test.ts pins for the runner's tenantState projection.
    expect(dbStates(sc(['limpeza', 'sobrancelha'])).initial.appointments).toEqual(['Benedito Arruda | Limpeza de Pele+Design de Sobrancelha | 2026-09-30 10:00→11:30 | Iara Nakamura | CONFIRMED',
      'Zuleica Paixão | Drenagem Linfática | 2026-09-30 14:00→14:40 | Iara Nakamura | CONFIRMED']);
    expect(dbStates(sc(['sobrancelha', 'limpeza'])).initial.appointments[0]).toBe('Benedito Arruda | Design de Sobrancelha+Limpeza de Pele | 2026-09-30 10:00→11:30 | Iara Nakamura | CONFIRMED');
    expect(dbStates(sc(['limpeza', 'sobrancelha'])).final.appointments).toEqual(['Benedito Arruda | Limpeza de Pele | 2026-09-30 10:00→11:00 | Iara Nakamura | CONFIRMED',
      'Zuleica Paixão | Drenagem Linfática | 2026-09-30 14:00→14:40 | Iara Nakamura | CONFIRMED']);
  });
});

describe('F5: the T06 conflict oracle accepts "encaixe ou outro horário?" (correção de gabarito, not a product gain)', () => {
  const t06 = dev.filter(s => s.id.startsWith('MD06'));
  it('every T06 instance scripts the conflict replies, declines overbooking and accepts both conflict questions', () => {
    expect(t06).toHaveLength(SPLIT_TYPES.dev.length);
    for (const s of t06) {
      expect(s.capability, s.id).toContain('conflict');
      for (const f of CONFLICT_ANSWER_FIELDS) { expect(s.answers?.[f], `${s.id}:${f}`).toBeTruthy(); expect(s.final!.mustAsk, s.id).toContain(f); }
      expect(s.final!.mustAsk, s.id).toEqual(['time', 'date', 'selection', 'override_requested', 'destination_mode']);
      for (const r of s.answers!.override_requested as string[]) expect(/n[aã]o precisa encaixar|sem encaixe|encaixe n[aã]o/i.test(r), r).toBe(true);
    }
  });
  it('flags a conflict scenario that scripts only the time (CONFLICT_ANSWERS_INCOMPLETE) and a mustAsk field without replies (MUST_ASK_UNANSWERED)', () => {
    const s = t06[0], only = { ...s, answers: { time: s.answers!.time } };
    expect(conflictAnswerIssues(only)).toEqual([`${s.id}:CONFLICT_ANSWERS_INCOMPLETE`]);
    expect(conflictAnswerIssues({ ...s, final: { ...s.final!, mustAsk: ['time', 'override_requested'] } })).toEqual([`${s.id}:CONFLICT_ANSWERS_INCOMPLETE`]);
    expect(conflictAnswerIssues({ ...only, capability: s.capability.filter(c => c !== 'conflict') })).toEqual([]);
    expect(mustAskAnswerIssues(only)).toEqual([`${s.id}:MUST_ASK_UNANSWERED`]);
    expect(mustAskAnswerIssues({ ...s, final: { ...s.final!, mustAsk: ['selection'] } })).toEqual([`${s.id}:MUST_ASK_UNANSWERED`]); // a choice needs a select step
    expect(mustAskAnswerIssues(s)).toEqual([]);
  });
  it('tags a conflict by structure and refuses to generate one without the conflict replies (fail closed)', () => {
    const base = TEMPLATES.find(t => t.id === 'T06')!;
    const tagged = generateSplit({ split: 'dev', seed: 'conflict-structure', templates: [{ ...base, tags: [] }] });
    expect(tagged.scenarios.every(s => s.capability.includes('conflict'))).toBe(true);
    expect(() => generateSplit({ split: 'dev', seed: 'conflict-structure', templates: [{ ...base, tags: [], answers: { time: base.answers!.time } }] })).toThrow('MULTI_SALON_UNSATISFIABLE');
  });
  it('grades hand-built transcripts: the encaixe/outro-horário question then h2 passes; overbooking, a silent h2 or "sim, encaixa" fail', () => {
    const s = t06.find(x => !x.capability.includes('daypart-ask'))!, { initial, final, line, rendered } = dbStates(s);
    const grade = (rows: TranscriptRow[]) => gradeResult({ scenario: s, initial, transcript: rows }, TODAY, () => ({}));
    const seeded = new Set(initial.appointments), c1 = rendered.appointments.find(a => !seeded.has(line(a.customer, a.service, a.date, a.time, a.professional!)))!;
    const c2 = initial.appointments.map(l => l.split(' | ')).find(p => p[3] === c1.professional && p[2].startsWith(c1.date) && !p[0].startsWith(c1.customer))!;
    for (const field of ['override_requested', 'destination_mode'])
      expect(grade([{ step: 1, action: 'say', pending: [field], db: initial }, { step: 2, action: 'answer:' + field, pending: [], db: initial }, { step: 3, action: 'confirm', db: final }]).ok, field).toBe(true);
    // overbooking c1 at the conflicting slot ("sim, encaixa" when h2 is expected)
    const h1 = c2[2].slice(11, 16), over: DbState = { appointments: [...initial.appointments, line(c1.customer, c1.service, c1.date, h1, c1.professional!)], blocks: [] };
    const overbooked = grade([{ step: 1, action: 'say', pending: ['override_requested'], db: initial }, { step: 2, action: 'answer:override_requested', pending: [], db: initial }, { step: 3, action: 'confirm', db: over }]);
    expect(overbooked.ok).toBe(false); expect(overbooked.safety).toContain('DOUBLE_BOOKING');
    // h2 booked without any question
    expect(grade([{ step: 1, action: 'say', pending: [], db: initial }, { step: 2, action: 'confirm', db: final }])).toMatchObject({ ok: false, safety: ['AUTO_PICK_WITHOUT_QUESTION'] });
  });
  it('never widens "selection": a homonym scenario that shows only slot alternatives is still NOT_ASKED', () => {
    const s = dev.find(x => x.id.startsWith('MD50'))!, { initial, final } = dbStates(s);
    const view = { message: 'Tenho estes horários.', operations: [{ keys: ['a'], scheduling: { alternatives: [`${dayDate(1, TODAY)}T10:00`] } }] };
    const r = gradeResult({ scenario: s, initial, transcript: [{ step: 1, action: 'say', pending: [], view, db: initial }, { step: 2, action: 'select', error: 'SELECT_NO_OPTION', db: initial },
      { step: 3, action: 'confirm', db: final }] }, TODAY, () => ({}));
    expect(r.ok).toBe(false); expect(r.why.some(w => w.startsWith('NOT_ASKED'))).toBe(true); expect(r.safety).toContain('AUTO_PICK_WITHOUT_QUESTION');
  });
});

describe('harness: a professional\'s own windows in a salon scenario (additive)', () => {
  const week = [1, 2, 3, 4, 5, 6];
  const mk = (pros: AgendaScenario['professionals'], appointment?: { time: string; professional: string }): AgendaScenario => ({ id: 'W1', title: 't', capability: ['create'],
    steps: [{ say: 'x' }, { confirm: true }], salon: { type: 'test', services: [{ key: 'corte', name: 'Corte social', durationMin: 30, priceCents: 1 }],
      hours: week.map(weekday => ({ weekday, from: '07:00', to: '20:00' })) }, professionals: pros, customers: [{ key: 'cli', name: 'Nara Vidal' }],
    ...(appointment ? { final: { appointments: [{ customer: 'Nara Vidal', service: 'Corte social', day: 'seg', time: appointment.time, professional: appointment.professional }] } } : {}) });
  const morning = week.map(weekday => ({ weekday, from: '07:00', to: '12:00' }));
  it('validates them (inside the salon windows, every working weekday, no overlap, salon scenarios only)', () => {
    expect(() => validateScenarios([mk([{ name: 'Tales Rangel', hours: morning }, { name: 'Gilda Amorim' }])])).not.toThrow();
    const bad = (hours: unknown, extra: object = {}) => () => validateScenarios([{ ...mk([{ name: 'Tales Rangel', hours } as never]), ...extra }]);
    expect(bad(morning.map(w => ({ ...w, from: '06:00' })))).toThrow('PROFESSIONAL_WINDOWS');
    expect(bad(morning.slice(1))).toThrow('PROFESSIONAL_WINDOWS');
    expect(bad([...morning, { weekday: 1, from: '11:00', to: '13:00' }])).toThrow('PROFESSIONAL_WINDOWS');
    expect(bad(morning.map(w => ({ ...w, extra: 1 })))).toThrow('PROFESSIONAL_WINDOWS');
    expect(bad([])).toThrow('PROFESSIONAL_WINDOWS');
    expect(() => validateScenarios([{ id: 'W2', title: 't', capability: ['create'], steps: [{ say: 'x' }], professionals: [{ name: 'Tales Rangel', hours: morning }] }])).toThrow('PROFESSIONAL_WINDOWS');
  });
  it('seeds and audits them: 19h is inside the salon but outside the morning-only professional', () => {
    const { hours } = buildScenarioFixture(mk([{ key: 'tales', name: 'Tales Rangel', hours: morning }, { key: 'gilda', name: 'Gilda Amorim' }]), TODAY);
    expect(hours.find(h => h.key === 'tales')!.windows!.every(w => w.startMinutes === 420 && w.endMinutes === 720)).toBe(true);
    expect(hours.find(h => h.key === 'gilda')!.windows!.every(w => w.startMinutes === 420 && w.endMinutes === 1200)).toBe(true);
    const audit = (time: string, professional: string) => auditBattery([mk([{ name: 'Tales Rangel', hours: morning }, { name: 'Gilda Amorim' }], { time, professional })], { days: ['2026-09-28'] }).issues;
    expect(audit('07:00', 'Tales Rangel')).toEqual([]);
    expect(audit('19:00', 'Tales Rangel')).toEqual(['W1:FINAL_HOURS']);
    expect(audit('19:00', 'Gilda Amorim')).toEqual([]);
  });
});

describe('the rotated holdout (in memory, phrase rotation waived only to test the names)', () => {
  let held: ReturnType<typeof generateSplit>;
  beforeAll(() => { held = generateSplit({ split: 'holdout', seed: 'v3-names-test', exclude: seenNameTokens(), rotation: 'waived-for-tests' }); }, 180_000);
  it('draws every person from the cohort holdout half, none from names.json nor the DEV split, and never the twelve style', () => {
    const v3held = new Set(sidePools(loadPools(), 'holdout', new Set(), { v3: true }).persons.map(p => fold(p.name)));
    const devPeople = new Set(dev.flatMap(s => [...(s.customers ?? []), ...(s.professionals ?? [])].map(p => fold(p.name))));
    for (const s of held.scenarios) for (const p of [...(s.customers ?? []), ...(s.professionals ?? [])]) {
      const words = foldWords(p.name), first = [3, 2, 1].map(n => words.slice(0, n).join(' ')).find(x => v3held.has(x));
      expect(first, `${s.id}: ${p.name}`).toBeTruthy();
      expect(devPeople.has(fold(p.name)), p.name).toBe(false);
    }
    expect(held.scenarios.some(s => s.capability.includes(`time-${TWELVE_STYLE}`))).toBe(false);
  });
});
