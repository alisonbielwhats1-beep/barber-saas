import { beforeAll, describe, expect, it, vi } from 'vitest';
vi.setConfig({ testTimeout: 120_000, hookTimeout: 120_000 });
import { foldWords } from '../../../packages/salon-secretary/evaluation/agenda-practice-stats';
import { TARGET_MAX_SHARE, concentration, firstTokenConcentration, nameCorpora, nameDiversityReport, summaryLines } from '../../../packages/salon-secretary/evaluation/name-diversity';

// Review fix (name report): the 3% target is also shown by FIRST WORD, so compound first names ("Maria X") cannot hide the
// concentration of the word the owner writes. Names and counts only.
const counts = (o: Record<string, number>) => new Map(Object.entries(o).map(([name, n]) => [foldWords(name).join(' '), { name, n }]));
let report: ReturnType<typeof nameDiversityReport>;
beforeAll(() => { report = nameDiversityReport(); }, 120_000);

describe('first-word concentration', () => {
  it('counts every compound under its first word; the compound-aware share alone would read as "no name above the target"', () => {
    const c = counts({ 'Maria Lívia': 1, 'Maria Heloísa': 1, 'Maria das Graças': 1, Maria: 1, ...Object.fromEntries(Array.from({ length: 96 }, (_, i) => [`Nome${i}`, 1])) });
    expect(concentration(c).maxShare).toBe(0.01); expect(concentration(c).aboveTarget).toEqual([]);
    expect(firstTokenConcentration(c)).toEqual({ distinct: 97, maxShare: 0.04, aboveTarget: [{ name: 'Maria', count: 4, share: 0.04 }] });
    expect(firstTokenConcentration(counts({ Lia: 1, Téo: 1 }))).toMatchObject({ maxShare: 0.5, distinct: 2 });
    expect(firstTokenConcentration(new Map())).toEqual({ distinct: 0, maxShare: 0, aboveTarget: [] });
  });
  it('the repository report shows it for every corpus and lists every corpus above the target by first word', () => {
    for (const r of report.corpora) expect(r.firstToken.maxShare, r.id).toBeGreaterThanOrEqual(r.maxShare); // grouping never lowers the top share
    expect(report.checks.aboveMaxShareFirstToken).toEqual(report.corpora.filter(r => !r.historical && r.kind !== 'pool' && r.firstToken.maxShare > TARGET_MAX_SHARE)
      .map(r => ({ corpus: r.id, maxShare: r.firstToken.maxShare, tokens: r.firstToken.aboveTarget.map(x => x.name) })));
    const ms = report.corpora.find(r => r.id === 'multi-salon-dev')!;
    // Honest view of the DEV split: listed exactly when its first-word share is above 3%, whatever its compound-aware share.
    expect(report.checks.aboveMaxShareFirstToken.some(x => x.corpus === 'multi-salon-dev')).toBe(ms.firstToken.maxShare > TARGET_MAX_SHARE);
    expect(summaryLines(report).every(l => / maxFirstWord=\d\.\d{3}/.test(l))).toBe(true);
    expect(report.tool).toBe('name-diversity-v2');
  });
  it('reports first words of the corpora\'s own names only (no sentence)', () => {
    const { corpora } = nameCorpora(), firstWords = new Set(corpora.flatMap(c => [...c.counts.values()].map(x => foldWords(x.name)[0])));
    const reported = report.corpora.flatMap(r => r.firstToken.aboveTarget.map(x => x.name));
    expect(reported.filter(n => !firstWords.has(foldWords(n)[0]) || n.split(/\s+/).length !== 1)).toEqual([]);
  });
});
