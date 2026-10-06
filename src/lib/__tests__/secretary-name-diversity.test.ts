import { beforeAll, describe, expect, it, vi } from 'vitest';
vi.setConfig({ testTimeout: 120_000, hookTimeout: 120_000 });
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import type { AgendaScenario } from '../../../packages/salon-secretary/evaluation/agenda-practice-lib';
import { foldWords } from '../../../packages/salon-secretary/evaluation/agenda-practice-stats';
import { TARGET_MAX_SHARE, concentration, firstName, lookAlike, nameCorpora, nameDiversityReport, nameLexicon, overlap, scenarioMentions }
  from '../../../packages/salon-secretary/evaluation/name-diversity';
import { DEV_FILE, loadPools } from '../../../packages/salon-secretary/evaluation/multi-salon/generate';

// Offline name/entity diversity report (Candidate 4, backlog section 1): names and counts only, never a sentence.
const counts = (o: Record<string, number>) => new Map(Object.entries(o).map(([name, n]) => [foldWords(name).join(' '), { name, n }]));
const lex = nameLexicon(loadPools());
let report: ReturnType<typeof nameDiversityReport>;
beforeAll(() => { report = nameDiversityReport(); }, 120_000);

describe('name diversity metrics', () => {
  it('concentration: top-5/top-10 share, normalized entropy, distinct per 100 and the 3% target', () => {
    const c = concentration(counts({ Lia: 5, Téo: 3, Céu: 2 }));
    expect(c).toMatchObject({ occurrences: 10, distinct: 3, top5Share: 1, top10Share: 1, distinctPer100: 30, maxShare: 0.5 });
    expect(c.normalizedEntropy).toBeCloseTo(1.0297 / Math.log(3), 3);
    expect(c.aboveTarget.map(x => x.name)).toEqual(['Lia', 'Téo', 'Céu']);
    const even = concentration(counts(Object.fromEntries(Array.from({ length: 40 }, (_, i) => [`Nome${String.fromCharCode(97 + (i % 26))}${String.fromCharCode(97 + Math.floor(i / 26))}`, 1]))));
    expect([even.normalizedEntropy, even.maxShare, even.aboveTarget.length, even.top10Share]).toEqual([1, 0.025, 0, 0.25]);
    expect(TARGET_MAX_SHARE).toBe(0.03);
  });
  it('overlap: Jaccard of the name sets and the share of each corpus\'s occurrences the other shows', () => {
    expect(overlap(counts({ Ana: 3, Bia: 1 }), counts({ Bia: 2, Jade: 2 }))).toEqual({ jaccard: 0.3333, common: 1, aInB: 0.25, bInA: 0.5 });
    expect(overlap(counts({ Ana: 1 }), counts({ Jade: 1 }))).toMatchObject({ jaccard: 0, aInB: 0, bInA: 0 });
  });
  it('look-alike pairs and compound first names', () => {
    for (const [a, b] of [['Ana', 'Anna'], ['Ana', 'Ana Paula'], ['Luiz', 'Luís'], ['Rafael', 'Rafaela'], ['Gabriel', 'Gabriela'], ['Taís', 'Thaís'], ['Daniela', 'Daniele']])
      expect(lookAlike(a, b), `${a}/${b}`).toBe(true);
    for (const [a, b] of [['Ana', 'Bia'], ['Jade', 'Céu'], ['Amanda', 'Fernanda'], ['Ana', 'Ana']]) expect(lookAlike(a, b), `${a}/${b}`).toBe(false);
    expect(firstName('Maria Eduarda Lima', lex)).toBe('Maria Eduarda');
    expect(firstName('Maria das Graças Silva', lex)).toBe('Maria das Graças');
    expect(firstName('Anna Toledo', lex)).toBe('Anna');
  });
  it('counts a person once per scenario when the owner\'s texts mention the first name or a nickname; a silent person is not counted', () => {
    const s: AgendaScenario = { id: 'D1', title: 't', capability: ['create'], salon: { services: [{ name: 'Corte social', durationMin: 30, priceCents: 1 }], hours: [{ weekday: 1, from: '09:00', to: '18:00' }] },
      customers: [{ name: 'Thaís Rangel' }, { name: 'Berenice Dutra' }, { name: 'Gilda Abreu' }], professionals: [{ name: 'Heleno Cardim' }],
      steps: [{ say: 'Marca a Thaís com o Heleno na segunda, e a Nice também com o Heleno.' }, { confirm: true }], answers: { time: ['Às 10h, Thaís.'] } };
    expect(scenarioMentions(s, lex).sort()).toEqual(['Heleno', 'Nice', 'Thaís']);
  });
});

describe('the repository report (names and counts only)', () => {
  it('covers the bank, DEV V/N, practices A/B/C, the multi-salon DEV split, the Golden 30 and the base fixtures', () => {
    const ids = report.corpora.map(c => c.id);
    for (const id of ['bank-filled', 'bank-fill-list', 'battery-variations', 'battery-natural', 'battery-scenarios', 'battery-scenarios-r2', 'battery-scenarios-r3', 'multi-salon-dev', 'golden-30', 'base-fixtures'])
      expect(ids, id).toContain(id);
    expect(report.corpora.filter(c => c.historical).map(c => c.id).sort()).toEqual(['base-fixtures', 'golden-30']);
    expect(report.checks.aboveMaxShare.map(x => x.corpus)).not.toContain('golden-30');
    expect(report.corpora.every(c => c.occurrences > 0)).toBe(true);
  });
  it('the generated DEV split meets the targets: no name above 3%, zero overlap with the bank, every category covered', () => {
    const ms = report.corpora.find(c => c.id === 'multi-salon-dev')!;
    expect(ms.maxShare).toBeLessThanOrEqual(TARGET_MAX_SHARE);
    expect(report.checks.bankDev.find(x => x.corpus === 'multi-salon-dev')).toMatchObject({ jaccard: 0, common: 0, bankInCorpus: 0, corpusInBank: 0 });
    for (const k of ['compound', 'short', 'foreign', 'nickname', 'word'] as const) expect(ms.categories[k].distinct, k).toBeGreaterThan(0);
    expect(ms.categories.lookAlikePairs.pairs).toBeGreaterThan(0);
  });
  it('prints no sentence: every name it reports is a person name of the corpora, every other string is short', () => {
    const { corpora } = nameCorpora(), known = new Set(corpora.flatMap(c => [...c.counts.keys()]));
    const names = report.corpora.flatMap(c => [...c.top10.map(x => x.name), ...c.aboveTarget.map(x => x.name), ...c.categories.lookAlikePairs.examples.flat()]);
    expect(names.filter(n => !known.has(foldWords(n).join(' ')))).toEqual([]);
    const strings = (v: unknown): string[] => typeof v === 'string' ? [v] : Array.isArray(v) ? v.flatMap(strings) : v && typeof v === 'object' ? Object.entries(v).flatMap(([k, x]) => [k, ...strings(x)]) : [];
    const all = strings(report);
    expect(all.filter(s => s.split(/\s+/).length > 6)).toEqual([]);
    // and none of them is (part of) an owner message of the DEV split
    const sentences = (JSON.parse(readFileSync(join(process.cwd(), DEV_FILE), 'utf8')) as AgendaScenario[]).flatMap(s => s.steps.flatMap(x => 'say' in x ? [x.say] : []));
    expect(all.filter(s => s.split(/\s+/).length >= 3 && sentences.some(t => t.includes(s)))).toEqual([]);
  });
});
