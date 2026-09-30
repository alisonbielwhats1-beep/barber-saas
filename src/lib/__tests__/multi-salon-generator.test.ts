import { beforeAll, describe, expect, it, vi } from 'vitest';
// Deterministic generation of 80+ scenarios is CPU-bound; under full-suite parallel load it exceeds the 5 s default.
vi.setConfig({ testTimeout: 120_000, hookTimeout: 120_000 });
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { AUDIT_DAYS, auditBattery } from '../../../packages/salon-secretary/evaluation/agenda-practice-battery';
import { buildScenarioFixture, renderTemplate, runDayPreflight, validateScenarios, type AgendaScenario } from '../../../packages/salon-secretary/evaluation/agenda-practice-lib';
import { foldNoise } from '../../../packages/salon-secretary/evaluation/agenda-practice-noise';
import { DEFAULT_DEV_SEED, DEV_FILE, DEV_MANIFEST, PHRASE_NEAR, SPLIT_TYPES, generateSplit, instanceIssues, loadPools, lookupIssues, main, phraseKey, phraseSides, phraseSplitDiagnostics, phraseTokens,
  scenarioFileText, seenServiceNames, sidePools, sideVariants, spokenClock, templateIssues, type ScenarioMeta } from '../../../packages/salon-secretary/evaluation/multi-salon/generate';
import { applyNoise, noiseSeed, scenarioNoiseContext } from '../../../packages/salon-secretary/evaluation/agenda-practice-noise';
import { jaccard } from '../../../packages/salon-secretary/evaluation/agenda-practice-stats';
import { applyStyle, styleViolations, type StyleChoice } from '../../../packages/salon-secretary/evaluation/multi-salon/style';
import { TEMPLATES, type Variant } from '../../../packages/salon-secretary/evaluation/multi-salon/templates';

// Multi-salon generator (evaluation only): the Secretária serves many salons, so scenarios are generated from salon-agnostic
// templates over sampled salons, names and styles, with a dev/holdout split by salon type (and by every pool). The holdout
// generated here uses a test seed: the sealed holdout's seed never appears in the repository.
const HOLDOUT_TEST_SEED = 'unit-test-holdout-seed';
const TOKEN = /\{\{d:([^{}|]+)\|([a-z]+)\}\}/g;
const texts = (s: AgendaScenario) => [...s.steps.flatMap(x => 'say' in x ? [x.say] : []), ...Object.values(s.answers ?? {}).flatMap(v => Array.isArray(v) ? v : typeof v === 'string' ? [v] : [])];
const fold = (v: string) => foldNoise(v);
const words = (v: string) => fold(v).split(/[^\p{L}\p{N}]+/u).filter(Boolean);
let dev: { scenarios: AgendaScenario[]; meta: ScenarioMeta[] }, held: { scenarios: AgendaScenario[]; meta: ScenarioMeta[] };
// v3 migration (backup: .demo/agenda-core/contract-migration/multi-salon-generator.test.before-multi-salon-v3.ts): the dev split
// excludes the names its manifest recorded (bank, dev batteries, base fixture); an in-memory holdout waives the phrase rotation
// (the v2 holdout phrasings are retired, multi-salon-v3.test.ts pins the gate) to keep testing the other holdout properties.
const DEV_EXCLUDE = new Set((JSON.parse(readFileSync(join(process.cwd(), DEV_MANIFEST), 'utf8')) as { devExcludedTokens: string[] }).devExcludedTokens);
const WAIVED = { rotation: 'waived-for-tests' } as const;
beforeAll(() => {
  dev = generateSplit({ split: 'dev', seed: DEFAULT_DEV_SEED, exclude: DEV_EXCLUDE });
  held = generateSplit({ split: 'holdout', seed: HOLDOUT_TEST_SEED, exclude: new Set(['amanda', 'carla']), ...WAIVED });
}, 180_000);

describe('multi-salon templates (written for this generator)', () => {
  it('has 30-40 templates covering every operation, multi-action, voice, homonyms, nicknames, word names and reasons', () => {
    expect(TEMPLATES.length).toBeGreaterThanOrEqual(30);
    expect(TEMPLATES.length).toBeLessThanOrEqual(40);
    expect(new Set(TEMPLATES.map(t => t.id)).size).toBe(TEMPLATES.length);
    const ops = new Set(TEMPLATES.flatMap(t => t.ops)), tags = new Set(TEMPLATES.flatMap(t => t.tags)), specials = new Set(TEMPLATES.map(t => t.special));
    for (const op of ['create', 'reschedule', 'cancel', 'block', 'read']) expect(ops.has(op as never), op).toBe(true);
    for (const tag of ['multi-action', 'homonym', 'nickname', 'word-name', 'service-ambiguous', 'negation', 'correction', 'conflict', 'ask-reason', 'ask-time']) expect(tags.has(tag), tag).toBe(true);
    for (const s of ['customer-homonym', 'pro-homonym', 'nickname', 'shared-word', 'word-temporal', 'word-service', 'word-name', 'honorific', 'one-eligible']) expect(specials.has(s as never), s).toBe(true);
    expect(TEMPLATES.some(t => t.modes.length === 1 && t.modes[0] === 'voice')).toBe(true);
    expect(TEMPLATES.filter(t => t.ops.length > 1 || t.tags.includes('multi-action')).length).toBeGreaterThanOrEqual(5);
    // Entity questions are graded by the transcript: never an auto-pick among several matches.
    for (const t of TEMPLATES.filter(x => x.tags.some(tag => ['homonym', 'nickname', 'service-ambiguous'].includes(tag)))) expect(t.final.mustAsk?.length, t.id).toBeGreaterThan(0);
    // A cancellation is graded with its literal reason core.
    for (const t of TEMPLATES) for (const a of t.final.appointments ?? []) if (a.status === 'CANCELLED') expect(a.reason, t.id).toBe('{motivo.core}');
  });

  it('gives every message and answer at least two phrasings, and each split at least one in every mode it allows', () => {
    for (const t of TEMPLATES) {
      const slots: [string, readonly Variant[]][] = [...t.says.map((v, i) => [`say${i}`, v] as [string, Variant[]]), ...Object.entries(t.answers ?? {}).map(([f, v]) => [`answer:${f}`, v] as [string, Variant[]])];
      for (const [slot, variants] of slots) {
        expect(variants.length, `${t.id}:${slot}`).toBeGreaterThanOrEqual(2);
        for (const side of ['dev', 'holdout'] as const) expect(t.modes.some(m => sideVariants(t, slot, variants, side, m).length > 0), `${t.id}:${slot}:${side}`).toBe(true);
        const d = sideVariants(t, slot, variants, 'dev'), h = sideVariants(t, slot, variants, 'holdout');
        expect(d.filter(v => h.includes(v)), `${t.id}:${slot}`).toEqual([]); // no phrasing is shared by the two splits
      }
    }
  });

  it('places each phrasing on one side only, across all templates', () => {
    const bySide = (side: 'dev' | 'holdout') => new Set(TEMPLATES.flatMap(t => [...t.says, ...Object.values(t.answers ?? {})].flatMap(v => sideVariants(t, '', v, side).map(phraseKey))));
    const d = bySide('dev'), h = bySide('holdout');
    expect([...d].filter(k => h.has(k))).toEqual([]);
    expect(d.size).toBeGreaterThan(60); expect(h.size).toBeGreaterThan(60);
  });

  it('asks for the service when the owner never says it (T04): a write without that question is an invented service', () => {
    expect(TEMPLATES.find(t => t.id === 'T04')!.final.mustAsk).toEqual(['service_ref', 'selection']);
  });

  it('never gives two variants of one message the same reading once their unprotected punctuation is gone (templateIssues)', () => {
    expect(TEMPLATES.flatMap(templateIssues)).toEqual([]);
    // The former T15: a contrast ("pras X, não pras Y" = X) and a self-correction ("pras Y... não, pras X" = X) both read
    // "pras _ não pras _" once dictation or noise drops the marks, with opposite values.
    const t15 = TEMPLATES.find(t => t.id === 'T15')!;
    expect(templateIssues({ ...t15, says: [['{v.remarcar} {c1.o} {c1} {d1.de} {h2.pras}, não {h3.pras}.', '{v.remarcar} {c1.o} {c1} {d1.de} {h3.pras}... não, {h2.pras}.']] }))
      .toEqual(['T15:say0:VARIANT_CONFLICT']);
    expect(templateIssues({ ...t15, says: [['{v.remarcar} {c1.o} {c1} {d1.de} {h2.pras}⟦, não {h3.pras}⟧.', '{v.remarcar} {c1.o} {c1} {d1.de} {h3.pras}, quer dizer, {h2.pras}.']] }))
      .toEqual(['T15:say0:PROTECTED_SPAN_NOT_TYPING']);
    // Correction templates: negation-only forms are typing-only with their marks protected; every other form says "e não" or "quer dizer".
    for (const id of ['T15', 'T61', 'T62']) for (const v of TEMPLATES.find(t => t.id === id)!.says[0]) {
      if (typeof v === 'string') expect(/ e não |quer dizer/.test(v), `${id}: ${v}`).toBe(true);
      else expect(v.mode === 'typing' && /⟦(?:\.\.\. não,|, não) [^⟧]+⟧/.test(v.t), `${id}: ${v.t}`).toBe(true);
    }
  });

  it('never splits a phrasing that reads the same once names, days, clocks, punctuation and word order are neutral', () => {
    const sides = phraseSides(), all = TEMPLATES.flatMap(t => [...t.says, ...Object.values(t.answers ?? {})].flat()).map(v => ({ key: phraseKey(v), tokens: phraseTokens(v) }));
    for (const a of all) for (const b of all) if (jaccard(a.tokens, b.tokens) === 1) expect(sides.get(a.key), a.key).toBe(sides.get(b.key));
    // Reported pairs: T52 (holdout) and T55 (dev) differed by word order only; T01's first two by word order and commas.
    const say = (id: string, i: number) => TEMPLATES.find(t => t.id === id)!.says[0][i];
    expect(phraseKey(say('T52', 1))).toBe(phraseKey(say('T55', 1)));
    expect(phraseKey(say('T01', 0))).toBe(phraseKey(say('T01', 1)));
    const d = phraseSplitDiagnostics();
    expect(d.holdoutIdenticalToDev).toBe(0);
    expect(d.dev + d.holdout).toBe(d.phrasings);
    expect(d.nearThreshold).toBe(PHRASE_NEAR);
    expect(d.holdoutNearDev).toBeLessThan(d.holdout / 2); // near phrasings left across sides are counted (manifest, seal), not hidden
  });

  it('uses only known placeholders', () => {
    const KNOWN = /^(?:(?:c[123]|c1h|p[12]|p1h)(?:\.(?:nome|sobrenome|o|do|pro|ele|dele))?|s[123](?:\.nome)?|d[123](?:\.(?:na|pra|de|spec))?|h[1-4](?:\.(?:as|das|pras|hhmm))?|motivo(?:\.(?:M|core))?|bmotivo|v\.(?:marcar|remarcar|cancelar|bloquear))$/;
    for (const t of TEMPLATES) {
      const all = JSON.stringify([t.says, t.answers ?? {}, t.final, t.steps]);
      for (const [, name] of all.matchAll(/\{([^{}"]+)\}/g)) expect(KNOWN.test(name), `${t.id}:{${name}}`).toBe(true);
    }
  });
});

describe('multi-salon generation', () => {
  it('is deterministic: an instance depends only on (seed, template, type, instance)', () => {
    const subset = TEMPLATES.filter(t => ['T01', 'T13', 'T24', 'T43', 'T52', 'T60'].includes(t.id));
    const a = generateSplit({ split: 'dev', seed: DEFAULT_DEV_SEED, templates: subset, exclude: DEV_EXCLUDE }), b = generateSplit({ split: 'dev', seed: DEFAULT_DEV_SEED, templates: subset, exclude: DEV_EXCLUDE });
    expect(scenarioFileText(a.scenarios)).toBe(scenarioFileText(b.scenarios));
    for (const s of a.scenarios) expect(s, s.id).toEqual(dev.scenarios.find(x => x.id === s.id));
    const other = generateSplit({ split: 'dev', seed: 'another-seed', templates: subset, exclude: DEV_EXCLUDE });
    expect(scenarioFileText(other.scenarios)).not.toBe(scenarioFileText(a.scenarios));
    const heldAgain = generateSplit({ split: 'holdout', seed: HOLDOUT_TEST_SEED, exclude: new Set(['amanda', 'carla']), templates: TEMPLATES, ...WAIVED });
    expect(scenarioFileText(heldAgain.scenarios)).toBe(scenarioFileText(held.scenarios));
  }, 120_000);

  it('the committed dev file is exactly the default-seed regeneration', () => {
    expect(readFileSync(join(process.cwd(), DEV_FILE), 'utf8').replace(/\r\n/g, '\n')).toBe(scenarioFileText(dev.scenarios));
  });

  it('splits by salon type: no instance of a holdout type in dev, disjoint ids, names, phrasings and pools', () => {
    expect(dev.scenarios).toHaveLength(TEMPLATES.length * SPLIT_TYPES.dev.length);
    expect(held.scenarios).toHaveLength(TEMPLATES.length);
    expect(new Set(dev.scenarios.map(s => s.salon!.type))).toEqual(new Set(SPLIT_TYPES.dev));
    expect(new Set(held.scenarios.map(s => s.salon!.type))).toEqual(new Set(SPLIT_TYPES.holdout));
    for (const type of SPLIT_TYPES.holdout) expect(held.meta.filter(m => m.type === type).length).toBeGreaterThanOrEqual(10);
    expect(new Set(held.meta.map(m => m.template)).size).toBe(TEMPLATES.length);
    expect(dev.scenarios.every(s => /^MD\d{2}[BSNT]\d$/.test(s.id)) && held.scenarios.every(s => /^MH\d{2}[ECP]\d$/.test(s.id))).toBe(true);
    const people = (list: AgendaScenario[]) => new Set(list.flatMap(s => [...(s.customers ?? []), ...(s.professionals ?? [])].map(p => fold(p.name))));
    const devPeople = people(dev.scenarios), heldPeople = people(held.scenarios);
    expect([...heldPeople].filter(n => devPeople.has(n))).toEqual([]);
    expect([...heldPeople].some(n => ['amanda', 'carla'].includes(n.split(' ')[0]))).toBe(false); // excluded (seen) names never reach the holdout
    const devTexts = new Set(dev.scenarios.flatMap(texts)); expect(held.scenarios.flatMap(texts).filter(t => devTexts.has(t))).toEqual([]);
    const pools = loadPools(), d = sidePools(pools, 'dev'), h = sidePools(pools, 'holdout');
    const inter = <T,>(a: T[], b: T[]) => a.filter(x => b.includes(x));
    expect(inter(d.persons.map(p => p.name), h.persons.map(p => p.name))).toEqual([]);
    expect(inter(d.surnames.map(p => p.name), h.surnames.map(p => p.name))).toEqual([]);
    expect(inter(d.nicknames.map(p => p.nickname), h.nicknames.map(p => p.nickname))).toEqual([]);
    for (const k of Object.keys(d.verbs) as (keyof typeof d.verbs)[]) { expect(inter(d.verbs[k], h.verbs[k])).toEqual([]); expect(d.verbs[k].length && h.verbs[k].length).toBeTruthy(); }
    d.styles.groups.forEach((g, i) => expect(inter(g.markers.map(m => m.text), h.styles.groups[i].markers.map(m => m.text))).toEqual([]));
    expect(inter(d.reasons.map(r => r.text), h.reasons.map(r => r.text))).toEqual([]);
  });

  it('never leaves an unresolved placeholder; every day template renders on every audit day', () => {
    for (const s of [...dev.scenarios, ...held.scenarios]) {
      const all = [...texts(s), ...s.steps.flatMap(x => 'select' in x ? [x.select] : [])];
      for (const t of all) {
        expect(t.replace(TOKEN, ''), s.id).not.toMatch(/[{}]/);
        for (const day of AUDIT_DAYS) expect(() => renderTemplate(t, day)).not.toThrow();
      }
      expect(JSON.stringify(s.final)).not.toMatch(/[{}]\w/);
    }
  });

  it('keeps message and oracle consistent: every new row, cancellation and block is said in the texts', () => {
    // v3: a spoken clock may carry its half of the day ("duas da madrugada"); the twelve style (tag time-twelve only) writes
    // 13-19h as its 12-hour hour ("às 3" = 15h, "3h30" = 15h30).
    const clockForms = (hhmm: string, twelve = false) => {
      const h = Number(hhmm.slice(0, 2)), m = Number(hhmm.slice(3)), mm = hhmm.slice(3), forms = [spokenClock(h * 60 + m), spokenClock(h * 60 + m, true)];
      if (m) forms.push(`${h}h${mm}`, `${h}:${mm}`); else forms.push(`${h}h`, `${h}:00`, `${h} horas`, `às ${h}`, `das ${h}`, `pras ${h}`, `para as ${h}`);
      const t = h - 12;
      if (twelve && h >= 13 && h <= 19) { if (m) forms.push(`${t}h${mm}`); else forms.push(`${t}h`, `às ${t}`, `das ${t}`, `pras ${t}`, `para as ${t}`); }
      return forms.map(fold);
    };
    const dayForms = (s: AgendaScenario, day: string | number) => typeof day === 'number' ? [day === 1 ? 'amanha' : 'depois de amanha']
      : [`{{d:${day}|`, ...[['dom', 'domingo'], ['seg', 'segunda'], ['ter', 'terca'], ['qua', 'quarta'], ['qui', 'quinta'], ['sex', 'sexta'], ['sab', 'sabado']].filter(([k]) => k === day).map(([, w]) => w)];
    const has = (hay: string, needle: string) => new RegExp(`(?<![\\p{L}\\p{N}])${needle.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}(?![\\p{L}\\p{N}])`, 'u').test(hay) || (needle.startsWith('{{') && hay.includes(needle));
    for (const s of [...dev.scenarios, ...held.scenarios]) {
      if (s.final?.unchanged) continue;
      const all = texts(s).map(fold), joined = all.join(' \n '), seeded = new Set((s.appointments ?? []).map(a => {
        const c = s.customers!.find(x => x.key === a.customer)!.name, p = s.professionals!.find(x => x.key === a.professional)!.name, v = s.salon!.services.find(x => x.key === a.service)!.name;
        return `${c}|${v}|${a.day}|${a.time}|${p}`;
      }));
      for (const a of s.final!.appointments ?? []) {
        const row = `${a.customer}|${a.service}|${a.day}|${a.time}|${a.professional}`, untouched = seeded.has(row) && a.status !== 'CANCELLED';
        // what the owner may leave implicit: a released slot ("no lugar dela") or the kept day/time/professional of a moved booking
        const released = (s.final!.appointments ?? []).some(x => x !== a && x.status === 'CANCELLED' && x.day === a.day && x.time === a.time && x.professional === a.professional);
        const own = [...seeded].map(r => r.split('|')).filter(r => r[0] === a.customer);
        if (untouched) continue;
        const customerWords = words(a.customer).filter(w => w.length >= 3);
        expect(customerWords.some(w => has(joined, w)), `${s.id} customer ${a.customer}`).toBe(true);
        if (a.status === 'CANCELLED') {
          const core = fold(a.reason as string), reasons = (s.answers?.reason as string[] | undefined) ?? [];
          expect(all.some(t => t.includes(core)) && (reasons.length === 0 || reasons.every(r => fold(r).includes(core))), `${s.id} reason`).toBe(true);
          continue;
        }
        if (!released && !own.some(r => r[4] === a.professional)) expect(words(a.professional!).filter(w => w.length >= 3).some(w => has(joined, w)), `${s.id} professional ${a.professional}`).toBe(true);
        if (!released && !own.some(r => r[2] === String(a.day) && r[3] === a.time)) expect(clockForms(a.time, s.capability.includes('time-twelve')).some(f => has(joined, f)), `${s.id} time ${a.time}`).toBe(true);
        expect(dayForms(s, a.day).some(f => has(joined, fold(f))), `${s.id} day ${a.day}`).toBe(true);
        const svc = fold(a.service);
        expect(has(joined, svc) || has(joined, svc.split(' ')[0]) || (s.appointments ?? []).some(x => s.salon!.services.find(v => v.key === x.service)!.name === a.service), `${s.id} service ${a.service}`).toBe(true);
      }
      for (const b of s.final!.blocks ?? []) {
        expect(words(b.professional).some(w => w.length >= 3 && has(joined, w)), `${s.id} block professional`).toBe(true);
        const tw = s.capability.includes('time-twelve');
        expect(clockForms(b.from, tw).some(f => has(joined, f)) && clockForms(b.to, tw).some(f => has(joined, f)), `${s.id} block ${b.from}-${b.to}`).toBe(true);
        expect(dayForms(s, b.day).some(f => has(joined, fold(f))), `${s.id} block day`).toBe(true);
      }
      if (s.final!.mustAsk?.includes('customer_ref')) expect(s.answers?.customer_ref, s.id).toBeTruthy();
    }
  });

  it('every instance passes validation, the static battery audit on every run day and the noise invariant', () => {
    expect(() => validateScenarios([...dev.scenarios, ...held.scenarios])).not.toThrow();
    expect(auditBattery(dev.scenarios, { days: AUDIT_DAYS }).issues).toEqual([]);
    expect(auditBattery(held.scenarios, { days: AUDIT_DAYS }).issues).toEqual([]);
    for (const s of [...dev.scenarios.slice(0, 20), ...held.scenarios.slice(0, 10)]) expect(instanceIssues(s), s.id).toEqual([]);
    for (const s of [...dev.scenarios, ...held.scenarios]) for (const day of AUDIT_DAYS) expect(runDayPreflight([s], day)[0].action, `${s.id}@${day}`).toBe('RUN');
  }, 120_000);

  it('every name said finds exactly its entity unless the template is about that ambiguity (no unscripted question)', () => {
    for (const s of [...dev.scenarios, ...held.scenarios]) expect(lookupIssues(s), s.id).toEqual([]);
    const mk = (say: string, extra: Partial<AgendaScenario> = {}): AgendaScenario => ({ id: 'X1', title: 't', capability: ['create'], steps: [{ say }, { confirm: true }],
      salon: { services: [{ name: 'Pé', durationMin: 45, priceCents: 1 }, { name: 'Pé e mão', durationMin: 80, priceCents: 1 }], hours: [] },
      customers: [{ name: 'Ana Lima' }, { name: 'Bia Limaverde' }], professionals: [{ name: 'Cida Reis' }], ...extra });
    expect(lookupIssues(mk('Marca a Ana na terça às 10h pra pé com a Cida.'))).toEqual(['X1:SERVICE_LOOKUP_AMBIGUOUS']); // "pé" also finds "Pé e mão"
    expect(lookupIssues(mk('Marca a Ana na terça às 10h pra pé e mão com a Cida.'))).toEqual([]);
    expect(lookupIssues(mk('Marca a Ana na terça às 10h pra pé com a Cida.', { final: { mustAsk: ['service_ref'] } }))).toEqual([]);
    expect(lookupIssues(mk('Marca a Ana na terça às 10h com a Cida.', { final: { mustAsk: ['service_ref'] }, answers: { service_ref: ['Pé'] } }))).toEqual(['X1:SERVICE_LOOKUP_AMBIGUOUS']);
    expect(lookupIssues(mk('Marca a Ana pra pé e mão.', { steps: [{ say: 'Marca a Ana pra pé e mão.' }, { select: 'Lima' }, { confirm: true }] }))).toEqual(['X1:SELECT_AMBIGUOUS']);
  });

  it('grades a nickname by what the runtime search finds: none or several ask, exactly this customer resolves without a question', () => {
    const t52 = TEMPLATES.filter(t => t.id === 'T52'), pools = loadPools(), nicknames = [...pools.names.nicknames, ...pools.cohort.nicknames].map(n => fold(n.nickname));
    const list = [...dev.scenarios, ...held.scenarios].filter(s => s.id.slice(2, 4) === '52').concat(generateSplit({ split: 'dev', seed: 'nickname-test', perType: 3, templates: t52 }).scenarios,
      generateSplit({ split: 'holdout', seed: 'nickname-test', perTemplate: 3, templates: t52, ...WAIVED }).scenarios);
    const kinds = new Set<string>();
    for (const s of list) {
      const said = words((s.steps[0] as { say: string }).say), nick = nicknames.filter(n => said.includes(n));
      expect(nick, s.id).toHaveLength(1);
      const seeded = new Set((s.appointments ?? []).map(a => s.customers!.find(c => c.key === a.customer)!.name)), c1 = s.final!.appointments!.find(a => !seeded.has(a.customer))!.customer;
      const hits = s.customers!.filter(c => fold(c.name).includes(nick[0])).map(c => c.name), kind = s.capability.find(c => c.startsWith('nickname-'))!;
      kinds.add(kind);
      expect(kind, s.id).toBe(hits.length === 0 ? 'nickname-unmatched' : hits.length > 1 ? 'nickname-ambiguous' : 'nickname-unique');
      if (kind === 'nickname-unique') { expect(hits, s.id).toEqual([c1]); expect(s.final!.mustAsk, s.id).toBeUndefined(); }
      else expect(s.final!.mustAsk, s.id).toEqual(['customer_ref', 'selection']);
      expect(s.steps.some(x => 'select' in x), s.id).toBe(kind === 'nickname-ambiguous');
    }
    expect(kinds.size).toBeGreaterThanOrEqual(2);
  }, 120_000);

  it('keeps the marks of a correction or a contrast through noise; dictation says "e não" or "quer dizer"', () => {
    const sel = TEMPLATES.filter(t => ['T15', 'T61', 'T62'].includes(t.id)), day = '2026-09-28';
    const list = [...generateSplit({ split: 'dev', seed: 'correction-test', perType: 3, templates: sel }).scenarios, ...generateSplit({ split: 'holdout', seed: 'correction-test', perTemplate: 3, templates: sel, ...WAIVED }).scenarios];
    let protectedSeen = 0;
    for (const s of list) {
      const say = (s.steps[0] as { say: string }).say, plain = fold(say);
      if (!s.noNoise) { expect(/ e nao |quer dizer/.test(plain), s.id).toBe(true); continue; }
      protectedSeen++;
      expect(s.capability, s.id).toContain('mode-typing');
      const ctx = scenarioNoiseContext(s, day), region = renderTemplate(s.noNoise[0], day);
      for (let k = 1; k <= 8; k++) expect(applyNoise(renderTemplate(say, day), 'heavy', noiseSeed(s.id, k, 'say:1'), ctx).text, `${s.id}#${k}`).toContain(region);
    }
    expect(protectedSeen).toBeGreaterThan(0);
  }, 120_000);

  it('tags holdout instances by whether a dev catalog or the example bank already showed their services', () => {
    const pools = loadPools(), seen = seenServiceNames(pools);
    const holdoutNames = new Set(pools.salons.types.filter(t => (SPLIT_TYPES.holdout as readonly string[]).includes(t.id)).flatMap(t => t.services.map(s => fold(s.name))));
    expect([...seen].every(n => holdoutNames.has(n))).toBe(true);
    const tagged = generateSplit({ split: 'holdout', seed: HOLDOUT_TEST_SEED, exclude: new Set(['amanda', 'carla']), seenServices: seen, templates: TEMPLATES.filter(t => ['T01', 'T02', 'T07'].includes(t.id)), ...WAIVED });
    for (const s of tagged.scenarios) expect(s.capability.filter(c => c === 'service-seen' || c === 'service-unseen'), s.id).toHaveLength(1);
    for (const s of [...dev.scenarios, ...held.scenarios]) expect(s.capability.some(c => c === 'service-seen' || c === 'service-unseen'), s.id).toBe(false);
  }, 60_000);

  it('spreads salons, modes, styles and name groups', () => {
    for (const meta of [dev.meta, held.meta]) {
      expect(new Set(meta.map(m => m.mode))).toEqual(new Set(['typing', 'voice']));
      expect(new Set(meta.map(m => m.region)).size).toBeGreaterThanOrEqual(4);
      expect(new Set(meta.map(m => m.register)).size).toBeGreaterThanOrEqual(4);
      expect(new Set(meta.map(m => m.nameGroup)).size).toBeGreaterThanOrEqual(4);
      expect(new Set(meta.map(m => m.dateForm)).size).toBeGreaterThanOrEqual(5);
      expect(meta.reduce((n, m) => n + m.markers, 0)).toBeGreaterThan(meta.length / 2);
      expect(meta.filter(m => m.styleDropped > 0).length).toBeLessThanOrEqual(Math.ceil(meta.length / 10));
    }
    expect(new Set(dev.meta.map(m => m.hours)).size).toBeGreaterThanOrEqual(3);
    expect(held.scenarios.some(s => { const w = s.salon!.hours; return w.some((x, i) => i > 0 && w[i - 1].weekday === x.weekday); })).toBe(true); // lunch breaks
  });
});

describe('multi-salon style layer', () => {
  const styles = loadPools().styles, group = (id: string) => styles.groups.find(g => g.id === id)!;
  const run = (text: string, choice: Partial<StyleChoice>, turn: 'first' | 'say' | 'answer' = 'say', seed = 1) => {
    let x = seed; const rand = () => { x = (x * 16807) % 2147483647; return x / 2147483647; };
    return applyStyle(text, styles, { turn, choice: { region: null, register: null, frame: null, ...choice }, rand, voice: false, names: ['Kelly Moraes', 'Kelly', 'Joana Prado', 'Joana'], p: 1 });
  };
  it('inserts markers without touching names, clocks, days, negations or day templates', () => {
    for (let seed = 1; seed < 60; seed++) for (const id of ['nordeste', 'mineiro', 'gaucho', 'carioca', 'paulista', 'norte', 'formal', 'informal', 'whatsapp', 'audio', 'emoji']) {
      const text = 'Passa a Kelly de terça, dia {{d:ter|d}}, pras 15h, não pras 16h, e marca a Joana às 10h.';
      const r = run(text, { region: group(id).kind === 'region' ? group(id) : null, register: group(id).kind === 'register' ? group(id) : null }, 'say', seed);
      expect(r.violations, `${id}:${seed}`).toEqual([]);
      expect(r.text).toContain('{{d:ter|d}}');
      expect(r.text).toMatch(/não pras 16h/);
      expect(styleViolations(text, r.text, styles, ['Kelly', 'Joana'])).toEqual([]);
    }
  });
  it('rewrites a leading command into a frame and keeps the rest verbatim', () => {
    const frame = styles.frames.find(f => f.id === 'poderia')!;
    expect(run('Cancela a Kelly de terça, ela vai viajar.', { frame }, 'first').text).toBe('Poderia cancelar a Kelly de terça, ela vai viajar?');
    expect(run('Marca amanhã às 10h.', { frame }, 'first').text).toBe('Marca amanhã às 10h.'); // noun homograph without article/name: untouched
  });
  it('flags every meaning change', () => {
    expect(styleViolations('Marca a Kelly às 10h.', 'Não marca a Kelly às 10h.', styles, ['Kelly'])).toContain('FACTS');
    expect(styleViolations('Marca a Kelly às 10h.', 'Marca a Joana às 10h.', styles, ['Kelly', 'Joana'])).toContain('NAME');
    expect(styleViolations('Marca a Kelly às 10h.', 'Marca a Kelly às 11h.', styles, ['Kelly'])).toContain('FACTS');
    expect(styleViolations('Marca a Kelly às 10h.', 'Marca a Kelly às 10h, beleza', styles, ['Kelly'])).toEqual(expect.arrayContaining(['EXCLUDED', 'WORD_ADDED']));
    expect(styleViolations('Não marca a Kelly.', 'Não, oxe, marca a Kelly.', styles, ['Kelly'])).toContain('NEG_SCOPE');
    expect(styleViolations('Marca {{d:ter|d}}.', 'Marca {{d:qua|d}}.', styles, [])).toContain('DAY_TEMPLATE');
    expect(styleViolations('Marca a Kelly às 10h.', 'Oxe, marca a Kelly às 10h, visse', styles, ['Kelly'])).toEqual([]);
  });
  it('never styles right after a negation', () => {
    for (let seed = 1; seed < 80; seed++) {
      const r = run('Não, esquece.', { region: group('nordeste'), register: group('informal') }, 'say', seed);
      expect(r.text.startsWith('Não, esquece') || /^[^,]+, não, esquece/i.test(r.text), r.text).toBe(true);
    }
  });
});

describe('harness: scenario-level salon (additive)', () => {
  const salonScenario = (patch: Partial<AgendaScenario> = {}): AgendaScenario => ({ id: 'S1', title: 't', capability: ['create'], steps: [{ say: 'x' }, { confirm: true }],
    salon: { type: 'test', services: [{ key: 'unha', name: 'Mão', durationMin: 40, priceCents: 3000 }, { name: 'Pé', durationMin: 45, priceCents: 3500 }],
      hours: [{ weekday: 1, from: '09:00', to: '12:00' }, { weekday: 1, from: '13:00', to: '18:00' }, { weekday: 0, from: '14:00', to: '20:00' }] },
    professionals: [{ key: 'ana', name: 'Ana Lima', services: ['unha', 'Pé'] }, { name: 'Bia Reis', services: ['Pé'], weekdays: [1] }],
    customers: [{ key: 'cli', name: 'Kelly Moraes' }], ...patch });
  it('builds only the salon: its catalog, team, customers and weekly windows', () => {
    const { fixture, hours } = buildScenarioFixture(salonScenario(), '2026-09-28');
    expect(fixture.customers.map(c => c.name)).toEqual(['Kelly Moraes']);
    expect(fixture.professionals.map(p => p.name)).toEqual(['Ana Lima', 'Bia Reis']);
    expect(fixture.services.map(s => [s.key, s.name, s.professionalKeys])).toEqual([['unha', 'Mão', ['ana']], ['pe', 'Pé', ['ana', 'bia_reis']]]);
    expect([fixture.openWeekdays, fixture.openMinutes, fixture.closeMinutes]).toEqual([[0, 1], 540, 1200]);
    expect(hours).toEqual([{ key: 'ana', windows: [{ weekday: 0, startMinutes: 840, endMinutes: 1200 }, { weekday: 1, startMinutes: 540, endMinutes: 720 }, { weekday: 1, startMinutes: 780, endMinutes: 1080 }] },
      { key: 'bia_reis', windows: [{ weekday: 1, startMinutes: 540, endMinutes: 720 }, { weekday: 1, startMinutes: 780, endMinutes: 1080 }] }]);
  });
  it('validates the salon block', () => {
    const bad = (patch: Partial<AgendaScenario>) => () => validateScenarios([salonScenario(patch)]);
    expect(() => validateScenarios([salonScenario()])).not.toThrow();
    expect(bad({ openWeekdays: [1] })).toThrow('SALON_OPEN_WEEKDAYS');
    expect(bad({ salon: { services: [{ name: 'Mão', durationMin: 40, priceCents: 1 }], hours: [{ weekday: 1, from: '09:00', to: '12:00' }, { weekday: 1, from: '11:00', to: '13:00' }] } })).toThrow('SALON_HOURS_OVERLAP');
    expect(bad({ salon: { services: [{ name: 'Mão', durationMin: 0, priceCents: 1 }], hours: [{ weekday: 1, from: '09:00', to: '12:00' }] } })).toThrow('SALON_SERVICE');
    expect(bad({ salon: { services: [{ name: 'Mão', durationMin: 30, priceCents: 1 }], hours: [{ weekday: 7, from: '09:00', to: '12:00' }] } })).toThrow('SALON_HOURS');
    expect(bad({ professionals: [{ name: 'Ana Lima', services: ['unha'] }] })).toThrow('SALON_SERVICE_UNSTAFFED');
    expect(bad({ professionals: [{ name: 'Ana Lima', from: '10:00' }] })).toThrow('PROFESSIONAL_HOURS');
    expect(bad({ professionals: [{ name: 'Ana Lima', weekdays: [3] }] })).toThrow('PROFESSIONAL_WEEKDAYS');
    expect(bad({ professionals: [{ name: 'Ana Lima', services: ['Corte Completo'] }] })).toThrow('PROFESSIONAL_SERVICES'); // base services do not exist in a salon
  });
  it('runs on the salon weekdays and audits bookings inside one window (never across a break)', () => {
    const final = (time: string) => salonScenario({ appointments: [], final: { appointments: [{ customer: 'Kelly Moraes', service: 'Mão', day: 'seg', time, professional: 'Ana Lima' }] } });
    expect(runDayPreflight([final('09:00')], '2026-09-26')[0].action).toBe('RUN'); // a Saturday run day, Monday booking
    expect(runDayPreflight([{ ...final('09:00'), final: { appointments: [{ customer: 'Kelly Moraes', service: 'Mão', day: 'ter', time: '09:00', professional: 'Ana Lima' }] } }], '2026-09-26')[0].action).toBe('SKIP');
    expect(runDayPreflight([{ ...final('15:00'), final: { appointments: [{ customer: 'Kelly Moraes', service: 'Mão', day: 'dom', time: '15:00', professional: 'Ana Lima' }] } }], '2026-09-26')[0].action).toBe('RUN');
    const audit = (time: string) => auditBattery([final(time)], { days: ['2026-09-28'] }).issues;
    expect(audit('09:00')).toEqual([]);
    expect(audit('11:40')).toEqual(['S1:FINAL_HOURS']); // 11:40-12:20 crosses the lunch break
    expect(audit('12:10')).toEqual(['S1:FINAL_HOURS']);
  });
});

describe('multi-salon CLI', () => {
  it('refuses a holdout path inside the repository before generating anything', async () => {
    await expect(main(['--split', 'holdout', '--holdout-out', join(process.cwd(), 'tmp-holdout.json')])).rejects.toThrow('MULTI_SALON_HOLDOUT_INSIDE_REPO');
    await expect(main(['--split', 'nope'])).rejects.toThrow('MULTI_SALON_ARGUMENT');
  });
});
