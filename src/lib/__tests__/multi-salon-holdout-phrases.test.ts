import { afterAll, describe, expect, it, vi } from 'vitest';
vi.setConfig({ testTimeout: 180_000, hookTimeout: 180_000 });
import { createHash } from 'node:crypto';
import { mkdtempSync, readFileSync, readdirSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { foldWords } from '../../../packages/salon-secretary/evaluation/agenda-practice-stats';
import { generateSplit, loadPools, main, phraseKey, phraseSides, retiredPhrasings, sideVariants } from '../../../packages/salon-secretary/evaluation/multi-salon/generate';
import { PHRASES_CONTRACT_VERSION, contractFileText, literalLexicon, loadHoldoutPhrases, phrasesContract, phrasingIssues, repositorySlots }
  from '../../../packages/salon-secretary/evaluation/multi-salon/holdout-phrases';
import { TEMPLATES, type Variant } from '../../../packages/salon-secretary/evaluation/multi-salon/templates';

// Track H (v4): the next holdout's wording comes from a file an isolated author writes OUTSIDE the repository against the
// machine-readable contract. Every fixture below lives in an OS temp folder (outside every checkout) and is removed; no sealed
// or validation file is read or written. Refusals carry codes, slot ids and counts only.
const root = process.cwd(), dir = mkdtempSync(join(tmpdir(), 'multi-salon-phrases-'));
afterAll(() => rmSync(dir, { recursive: true, force: true }));
const contract = phrasesContract(), header = { contract: PHRASES_CONTRACT_VERSION, contractSha256: contract.sha256 };
const sha = (b: Buffer | string) => createHash('sha256').update(b).digest('hex');
const text = (v: Variant) => typeof v === 'string' ? v : v.t;
/** A test-only fixture: a repository phrasing with a novel tail is no repository phrasing (never material for an author). */
const tail = (v: Variant): Variant => { const t = `${text(v).replace(/[.!?]$/, '')}, por gentileza, obrigada desde já`; return typeof v === 'string' ? t : { t, ...(v.mode ? { mode: v.mode } : {}) }; };
const repo = new Map(repositorySlots().map(s => [s.slot, s.list]));
const complete = (): Record<string, Variant[]> => Object.fromEntries(contract.slots.map(s => {
  const seen = new Set<string>(), list = [...repo.get(s.slot)!].sort((a, b) => Number(typeof a !== 'string') - Number(typeof b !== 'string')).map(tail);
  return [s.slot, list.filter(v => { const k = phraseKey(v); if (seen.has(k)) return false; seen.add(k); return true; })];
}));
let files = 0;
const write = (body: unknown, name = `case-${++files}-phrases.json`) => { const f = join(dir, name); writeFileSync(f, JSON.stringify(body)); return f; };
const refusal = (f: () => unknown) => { try { f(); } catch (e) { return { code: (e as Error).message, details: (e as { details?: string[] }).details ?? [] }; } return null; };
/** What the CLI launcher lets through (generate-multi-salon.cjs): a detail is a short code, never a sentence. */
const SAFE_DETAIL = /^[A-Za-z0-9_:+.#-]{1,120}$/;

describe('the phrase contract (machine-readable, written for an isolated author)', () => {
  it('covers every template and reply slot, and every repository phrasing keeps its own slot contract', () => {
    expect(contract.contract).toBe(PHRASES_CONTRACT_VERSION);
    expect(contract.counts).toEqual({ templates: TEMPLATES.length, slots: 71, saySlots: 41, replySlots: 30 });
    expect(contract.slots.map(s => s.slot)).toEqual([...repo.keys()]);
    const lex = literalLexicon();
    for (const s of contract.slots) {
      expect(s.intent.length, s.slot).toBeGreaterThan(20);
      expect(s.modes.length, s.slot).toBeGreaterThan(0);
      for (const [i, v] of repo.get(s.slot)!.entries()) expect(phrasingIssues(s, v, lex), `${s.slot}#${i}`).toEqual([]);
    }
    const slot = (id: string) => contract.slots.find(s => s.slot === id)!;
    // the structure each template is about stays in the contract
    expect(slot('T03:say0').forbidden).toContain('h1'); expect(slot('T04:say0').forbidden).toContain('s1'); expect(slot('T05:say0').forbidden).toContain('p1');
    expect(slot('T21:say0').forbidden).toContain('motivo'); expect(slot('T24:say0').forbidden).toEqual(expect.arrayContaining(['d2', 'h2']));
    expect(slot('T50:say0').forms.c1).toContain('{c1}'); expect(slot('T50:say0').forms.c1).not.toContain('{c1.nome}');
    expect(slot('T50:answer:customer_ref').forms.c1.filter(f => ['{c1}', '{c1.nome}', '{c1.sobrenome}'].includes(f))).toEqual(['{c1.nome}']);
    expect(slot('T53:answer:service_ref').forms.s1).toEqual(['{s1.nome}']);
    expect(slot('T35:say0').verbs).toEqual([]);
    expect(['T15:say0', 'T61:say0', 'T62:say0'].map(id => slot(id).literal?.kind)).toEqual(['correction', 'correction', 'correction']);
    expect([slot('T60:say1').literal?.kind, slot('T06:answer:override_requested').literal?.kind]).toEqual(['withdrawal', 'decline']);
    expect(slot('daypart:time').required).toEqual(['h9']);
  });
  it('copies no repository phrasing: intents are plain English sentences and no phrasing text appears in the file', () => {
    const file = contractFileText(contract);
    let checked = 0;
    for (const list of repo.values()) for (const v of list) {
      const t = text(v).replace(/[⟦⟧]/g, '');
      if (foldWords(t.replace(/\{[^{}]*\}/g, ' ')).length < 2) continue; // a bare placeholder reply ("{s1}") is a form, not wording
      checked++;
      expect(file.includes(t), t.slice(0, 24)).toBe(false);
      expect(file.includes(t.replace(/[.!?]$/, '')), t.slice(0, 24)).toBe(false);
    }
    expect(checked).toBeGreaterThan(100);
    for (const s of contract.slots) expect(/^[\x20-\x7e]+$/.test(s.intent) && !/[{}]/.test(s.intent), s.slot).toBe(true);
  });
  it('is deterministic and self-verifying (sha256 over every other field)', () => {
    const parsed = JSON.parse(contractFileText(contract)) as Record<string, unknown>, { sha256: recorded, ...body } = parsed;
    expect(recorded).toBe(contract.sha256);
    expect(sha(JSON.stringify(body))).toBe(contract.sha256);
    expect(phrasesContract().sha256).toBe(contract.sha256);
  });
  it('fails closed on a new correction template without its literal rule', () => {
    const t15 = TEMPLATES.find(t => t.id === 'T15')!;
    expect(refusal(() => phrasesContract([{ ...t15, id: 'T16' }]))).toEqual({ code: 'MULTI_SALON_CONTRACT_RULE_MISSING', details: ['T16:say0'] });
  });
});

describe('--holdout-phrases refusals (codes, slot ids and counts only)', () => {
  it('refuses a file inside the repository before reading it, the sealed folder, a wrong name and a DEV-only run', async () => {
    await expect(main(['--split', 'holdout', '--check', '--holdout-phrases', join(root, 'next-phrases.json')])).rejects.toThrow('MULTI_SALON_PHRASES_INSIDE_REPO');
    // an existing repository file is refused as well, without being parsed (it is no phrases file)
    expect(() => loadHoldoutPhrases(join(root, 'packages/salon-secretary/evaluation/multi-salon/phrase-sides-v2.json'))).toThrow('MULTI_SALON_PHRASES_INSIDE_REPO');
    expect(() => loadHoldoutPhrases(join(dir, 'secretary-holdout-sealed', 'x-phrases.json'))).toThrow('MULTI_SALON_PHRASES_SEALED_DIR');
    expect(() => loadHoldoutPhrases(write(header, 'holdout-v4.json'))).toThrow('MULTI_SALON_PHRASES_NAME');
    expect(() => loadHoldoutPhrases(join(dir, 'absent-phrases.json'))).toThrow('MULTI_SALON_PHRASES_MISSING');
    await expect(main(['--split', 'dev', '--check', '--holdout-phrases', join(dir, 'absent-phrases.json')])).rejects.toThrow('MULTI_SALON_ARGUMENT');
  });
  it('refuses another contract, another shape and unknown slots', () => {
    expect(refusal(() => loadHoldoutPhrases(write({ ...header, contractSha256: '0'.repeat(64), phrases: complete() }))))
      .toEqual({ code: 'MULTI_SALON_PHRASES_CONTRACT_MISMATCH', details: [] });
    expect(refusal(() => loadHoldoutPhrases(write({ ...header, phrases: complete(), extra: 1 })))?.code).toBe('MULTI_SALON_PHRASES_INVALID');
    expect(refusal(() => loadHoldoutPhrases(write([1, 2])))?.code).toBe('MULTI_SALON_PHRASES_INVALID');
    expect(refusal(() => loadHoldoutPhrases(write({ ...header, phrases: { ...complete(), 'T99:say0': ['x'], 'marca a Ana amanhã': ['y'] } }))))
      .toEqual({ code: 'MULTI_SALON_PHRASES_UNKNOWN_SLOT', details: ['T99:say0', 'malformed:1'] });
  });
  it('refuses an incomplete file, listing template and slot ids only', async () => {
    const all = complete(), f = write({ ...header, phrases: { 'T01:say0': all['T01:say0'] } });
    const r = refusal(() => loadHoldoutPhrases(f))!;
    expect(r.code).toBe('MULTI_SALON_PHRASES_INCOMPLETE');
    expect(r.details).toEqual(expect.arrayContaining(['T03:say0', 'T06:answer:override_requested', 'more:30']));
    expect(r.details.every(d => /^(?:T\d{2}:(?:say\d|answer:[a-z_]+)|daypart:time)(?::(?:typing|voice))?$|^more:\d+$/.test(d))).toBe(true);
    await expect(main(['--split', 'holdout', '--check', '--holdout-phrases', f])).rejects.toThrow('MULTI_SALON_PHRASES_INCOMPLETE');
    // a mode the template allows without a phrasing
    const typingOnly = { ...all, 'T01:say0': all['T01:say0'].map(v => ({ t: text(v), mode: 'typing' as const })), 'daypart:time': all['daypart:time'].map(v => ({ t: text(v), mode: 'voice' as const })) };
    expect(refusal(() => loadHoldoutPhrases(write({ ...header, phrases: typingOnly })))).toEqual({ code: 'MULTI_SALON_PHRASES_INCOMPLETE', details: ['T01:say0:voice', 'daypart:time:typing'] });
  });
  it('refuses a DEV or retired phrasing however it is punctuated: counts only', () => {
    const t01 = TEMPLATES.find(t => t.id === 'T01')!, dev = text(sideVariants(t01, 'say0', t01.says[0], 'dev')[0]);
    const repunctuated = `${dev.split(/(\{[^{}]*\})/).map(p => p.startsWith('{') ? p : p.replace(/[,.:]/g, ' ')).join('').replace(/\s+/g, ' ').trim()}!!`;
    expect(repunctuated).not.toBe(dev);
    expect(phraseSides().get(phraseKey(repunctuated))).toBe('dev');
    const withDev = complete(); withDev['T01:say0'] = [...withDev['T01:say0'], repunctuated];
    const r = refusal(() => loadHoldoutPhrases(write({ ...header, phrases: withDev })))!;
    expect(r).toEqual({ code: 'MULTI_SALON_PHRASES_DUPLICATE', details: ['dev:1', 'retired:0', 'repoHoldout:0'] });
    const retired = retiredPhrasings(), [slot, v] = [...repo].flatMap(([id, list]) => list.filter(x => retired.has(phraseKey(x))).map(x => [id, x] as const))[0];
    const withRetired = complete(); withRetired[slot] = [...withRetired[slot], v];
    expect(refusal(() => loadHoldoutPhrases(write({ ...header, phrases: withRetired })))).toEqual({ code: 'MULTI_SALON_PHRASES_DUPLICATE', details: ['dev:0', 'retired:1', 'repoHoldout:0'] });
  });
  it('refuses contract violations as <slot>#<index>:<code>, never with the text', () => {
    const pools = loadPools(), person = pools.cohort.female[0].name, service = pools.salons.types.find(t => t.id === 'esmalteria')!.services[0].name;
    const bad: Record<string, Variant[]> = {
      'T03:say0': ['{v.marcar} {c1.o} {c1} {d1.na} {h1.as} pra {s1} com {p1.o} {p1}, valeu demais'],
      'T01:say0': ['Agenda {c1.o} {c1} {d1.na} às 10h pra {s1} com {p1.o} {p1}, valeu demais', '{v.marcar} {c9} {d1.na} {h1.as} pra {s1} com {p1.o} {p1}, valeu demais',
        { t: '{v.marcar} {c1.o} {c1} {d1.na} {h1.as} pra {s1} com {p1.o} {p1} valeu', mode: 'fax' as never }],
      'T02:say0': [{ t: '{v.marcar} {c1.o} {c1} {d1.na} {h1.as} pra {s1} com {p1.o} {p1} valeu demais', mode: 'typing' }],
      'T04:say0': [`{v.marcar} {c1.o} {c1} {d1.na} {h1.as} pra ${service} com {p1.o} {p1}, valeu demais`],
      'T04:answer:service_ref': ['Amanhã cedo, {s1}.'],
      'T50:say0': [`{v.marcar} {c1.nome} {d1.na} {h1.as} pra {s1} com {p1.o} {p1}, valeu demais`],
      'T05:answer:professional_ref': [`Com {p1.o} {p1}, a ${person} avisou`],
      'T15:say0': ['{v.remarcar} {c1.o} {c1} {d1.de} {h3.pras} e não {h2.pras}, valeu demais'],
      'T61:say0': ['{v.marcar} {c1.o} {c1} {d1.na} {h1.as} pra {s1} com {p1.o} {p1}⟦, não com {p2.o} {p2}⟧ valeu demais'],
      'T60:say1': ['Pode deixar quieto, valeu demais.'],
      'T06:answer:override_requested': ['Pode ser {h2.as}, valeu demais.'] };
    const phrases = complete(), at: Record<string, number> = {};
    for (const [s, list] of Object.entries(bad)) { at[s] = phrases[s].length; phrases[s] = [...phrases[s], ...list]; }
    const r = refusal(() => loadHoldoutPhrases(write({ ...header, phrases })))!;
    expect(r.code).toBe('MULTI_SALON_PHRASES_CONTRACT');
    const i = (s: string, k = 0) => `${s}#${at[s] + k}`;
    expect(r.details).toEqual(expect.arrayContaining([`${i('T03:say0')}:PLACEHOLDER_FORBIDDEN:h1`, `${i('T01:say0')}:DIGIT`, `${i('T01:say0', 1)}:PLACEHOLDER_UNKNOWN`,
      `${i('T01:say0', 2)}:MODE`, `${i('T02:say0')}:MODE_NOT_ALLOWED`, `${i('T04:say0')}:SERVICE_LITERAL`, `${i('T04:answer:service_ref')}:TEMPORAL_LITERAL`,
      `${i('T50:say0')}:FORM_FORBIDDEN:c1.nome`, `${i('T05:answer:professional_ref')}:NAME_LITERAL`, `${i('T15:say0')}:CORRECTION_ORDER`,
      `${i('T61:say0')}:MARKS_NOT_TYPING`, `${i('T60:say1')}:WITHDRAWAL_MISSING`, `${i('T06:answer:override_requested')}:DECLINE_MISSING`]));
    expect(r.details.every(d => SAFE_DETAIL.test(d))).toBe(true);
    expect(r.details.join(' ')).not.toMatch(/valeu|demais|Agenda|quieto/i);
  });
});

describe('--holdout-phrases happy path', () => {
  it('a tiny fixture file (one template and the daypart reply) is the only wording of the holdout it generates', () => {
    const t01 = TEMPLATES.filter(t => t.id === 'T01'), small = phrasesContract(t01);
    const phrases = { 'T01:say0': ['Reserva pra {c1.o} {c1} um horário {d1.na}, {h1.as}, {s1} com {p1.o} {p1}, por gentileza.',
      { t: '{p1.o} {p1} consegue atender {c1.o} {c1} {d1.na} {h1.as}? Seria {s1}.', mode: 'typing' }, { t: 'reserva {c1.o} {c1} com {p1.o} {p1} {d1.na} {h1.as} seria {s1}', mode: 'voice' }],
      'daypart:time': ['Confirmo: {h9.as}.', 'Exatamente {h9.as}, obrigada.'] };
    const f = write({ contract: PHRASES_CONTRACT_VERSION, contractSha256: small.sha256, phrases });
    const loaded = loadHoldoutPhrases(f, { templates: t01 });
    expect(loaded.record).toMatchObject({ contractSha256: small.sha256, sha256: sha(readFileSync(f)), slots: 2, phrasings: 5, modes: { both: 3, typing: 1, voice: 1 }, overlap: { 'example-bank': 0 } });
    expect(() => loadHoldoutPhrases(f)).toThrow('MULTI_SALON_PHRASES_CONTRACT_MISMATCH'); // the tiny file covers one template only
    const held = generateSplit({ split: 'holdout', seed: 'tiny-phrases', perTemplate: 3, templates: t01, exclude: new Set(), phrases: loaded.map });
    expect(held.scenarios).toHaveLength(3);
    for (const s of held.scenarios) {
      const say = foldWords((s.steps[0] as { say: string }).say).join(' ');
      expect(/reserva|consegue atender/.test(say), s.id).toBe(true);
      for (const r of (s.answers?.time ?? []) as string[]) expect(/confirmo|exatamente/.test(foldWords(r).join(' ')), s.id).toBe(true);
    }
    expect(() => generateSplit({ split: 'dev', seed: 'x', templates: t01, phrases: loaded.map })).toThrow('MULTI_SALON_ARGUMENT');
  });
  it('--check validates a complete file and preflights the holdout in memory, writing nothing; the write mode seals its sha256', async () => {
    const f = write({ ...header, phrases: complete() }), bytes = readFileSync(f), before = readdirSync(dir).sort();
    const log = vi.spyOn(console, 'log').mockImplementation(() => undefined);
    try {
      await main(['--split', 'holdout', '--check', '--holdout-phrases', f]);
      const printed = String(log.mock.calls.at(-1)![0]), r = JSON.parse(printed).results[0];
      expect(r).toMatchObject({ split: 'holdout', status: 'CHECKED', scenarios: TEMPLATES.length, nameOverlap: 0, phrases: { sha256: sha(bytes), contractSha256: contract.sha256, slots: 71 } });
      expect(r.phrases.phrasings).toBeGreaterThan(200);
      expect(printed).not.toMatch(/gentileza|obrigada/);
      expect(readdirSync(dir).sort()).toEqual(before); // nothing written
      const out = join(dir, 'held-v4.json');
      await main(['--split', 'holdout', '--holdout-out', out, '--holdout-seed', 'phrases-test-seed', '--holdout-phrases', f]);
      const seal = JSON.parse(readFileSync(join(dir, 'held-v4.seal.json'), 'utf8')), held = JSON.parse(readFileSync(out, 'utf8')) as { steps: { say?: string }[] }[];
      expect(seal.holdoutPhrases).toMatchObject({ sha256: sha(bytes), contract: PHRASES_CONTRACT_VERSION, contractSha256: contract.sha256 });
      expect(seal.rotation.phrases).toBe('external');
      expect(Object.values(seal.nameCorpora.overlap).every(n => n === 0)).toBe(true);
      expect(Object.keys(seal.nameCorpora.excluded)).toEqual(expect.arrayContaining(['batteries', 'golden-30', 'example-bank', 'multi-salon-dev', 'names-json', 'dev-pools']));
      expect(held).toHaveLength(TEMPLATES.length);
      for (const s of held) for (const step of s.steps) if (step.say) expect(foldWords(step.say)).toContain('gentileza'); // every message comes from the file
    } finally { log.mockRestore(); }
  });
  it('writes the contract outside the repository only, alone, and never replaces a different file', async () => {
    const log = vi.spyOn(console, 'log').mockImplementation(() => undefined);
    try {
      const out = join(dir, 'multi-salon-phrases-contract-v4.json');
      await main(['--phrases-contract-out', out]);
      expect(readFileSync(out, 'utf8')).toBe(contractFileText(contract));
      await main(['--phrases-contract-out', out]);
      expect(JSON.parse(String(log.mock.calls.at(-1)![0]))).toMatchObject({ status: 'CONTRACT_UNCHANGED', sha256: contract.sha256, templates: TEMPLATES.length, slots: 71 });
      const other = join(dir, 'other-phrases-contract.json'); writeFileSync(other, '{}');
      await expect(main(['--phrases-contract-out', other])).rejects.toThrow('MULTI_SALON_CONTRACT_EXISTS');
      await expect(main(['--phrases-contract-out', join(root, 'multi-salon-phrases-contract-v4.json')])).rejects.toThrow('MULTI_SALON_CONTRACT_INSIDE_REPO');
      await expect(main(['--phrases-contract-out', out, '--split', 'holdout'])).rejects.toThrow('MULTI_SALON_ARGUMENT');
    } finally { log.mockRestore(); }
  });
});
